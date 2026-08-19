import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Aviso,
  CabecalhoPagina,
  Carregando,
  Indicador,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type {
  ConciliacaoAberta,
  ContaConciliavel,
  LinhaDaConciliacao,
  ResultadoDoPagamento,
  TituloCandidato,
  TransacaoDaConciliacao,
} from '../../lib/types';

/**
 * O assistente de conciliação, nos quatro passos da tela do IXC.
 *
 * 1. **Filtros** — a conta, o período e o extrato. É o passo que cria a
 *    conciliação; daí em diante ela existe e dá para sair e voltar;
 * 2. **Conciliação automática** — os dois lados lado a lado, e o botão que liga
 *    o que bate sozinho (mesmo valor; a data desempata);
 * 3. **Conciliação manual** — o que sobrou. Aqui mora o trabalho de verdade:
 *    saída no banco que ninguém lançou vira lançamento, e linha do IXC que o
 *    banco não tem é ligada na mão ou explicada;
 * 4. **Todos os conciliados** — o par a par do que ficou pronto, e o botão que
 *    encerra. Ele só acende com pendência zero dos dois lados: encerrar com
 *    pendência é dar por conferido o que ninguém conferiu.
 */

const PASSOS = [
  'Filtros',
  'Conciliação automática',
  'Conciliação manual',
  'Todos os conciliados',
] as const;

export function ConciliacaoAssistente() {
  const { id } = useParams<{ id: string }>();
  return id === 'nova' ? <NovaConciliacao /> : <Trabalhar id={id!} />;
}

// ---------------------------------------------------------------------------
// Passo 1: a conciliação ainda não existe
// ---------------------------------------------------------------------------

function NovaConciliacao() {
  const navegar = useNavigate();
  const [conta, setConta] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState(mesAtual);
  const [datasDiferentes, setDatasDiferentes] = useState(true);
  const [extrato, setExtrato] = useState<{ nome: string; texto: string } | null>(
    null,
  );
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  const contas = useQuery({
    queryKey: ['conciliacao-contas'],
    queryFn: async () =>
      (await api.get<ContaConciliavel[]>('/contas-abertas/conciliacao/contas'))
        .data,
  });

  const criar = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ id: string; numero: number; transacoes: number }>(
          '/contas-abertas/conciliacoes',
          {
            conta,
            de: periodo.de,
            ate: periodo.ate,
            datasDiferentes,
            ofx: extrato?.texto,
            arquivo: extrato?.nome,
          },
        )
      ).data,
    onSuccess: (r) => navegar(`/contas-pagar/conciliacao/${r.id}`),
    onError: (e) => setErro(mensagemErro(e)),
  });

  const escolhida = (contas.data ?? []).find((c) => c.id === conta) ?? null;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Conciliação bancária"
        titulo="Nova conciliação"
        descricao="Escolha a conta e o mesmo período do extrato que você baixou do banco. O arquivo é opcional: sem ele a conferência é contra a tela do banco, na mão."
        acoes={
          <button
            onClick={() => navegar('/contas-pagar/conciliacao')}
            className="btn btn-neutro"
          >
            Voltar
          </button>
        }
      />

      <BarraDePassos atual={0} />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="card surgir max-w-3xl p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="rotulo">Conta</label>
            <select
              value={conta ?? ''}
              onChange={(e) => setConta(Number(e.target.value) || null)}
              className="campo"
            >
              <option value="">Escolha a conta…</option>
              {(contas.data ?? [])
                .filter((c) => c.ativa)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                    {c.tipo === 'C' ? ' (caixa)' : ''}
                  </option>
                ))}
            </select>
            {escolhida?.tipo === 'C' && (
              <p className="ajuda">
                Caixa de dinheiro em mãos não tem extrato de banco. Para bater a
                gaveta e ver a nota de cada saída, a tela é o Fechamento de
                Caixa — o que for conferido lá conta aqui.
              </p>
            )}
          </div>

          <div>
            <label className="rotulo">Período inicial</label>
            <input
              type="date"
              value={periodo.de}
              onChange={(e) => setPeriodo({ ...periodo, de: e.target.value })}
              className="campo"
            />
          </div>
          <div>
            <label className="rotulo">Período final</label>
            <input
              type="date"
              value={periodo.ate}
              onChange={(e) => setPeriodo({ ...periodo, ate: e.target.value })}
              className="campo"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="rotulo">Arquivo OFX do banco</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={campo}
                type="file"
                accept=".ofx,.OFX,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const arquivo = e.target.files?.[0];
                  e.target.value = '';
                  if (!arquivo) return;
                  setErro(null);
                  try {
                    setExtrato({
                      nome: arquivo.name,
                      texto: await lerArquivo(arquivo),
                    });
                  } catch (err) {
                    setErro(mensagemErro(err));
                  }
                }}
              />
              <button
                onClick={() => campo.current?.click()}
                className="btn btn-ferramenta"
              >
                {extrato ? 'Trocar arquivo' : 'Escolher arquivo…'}
              </button>
              {extrato && (
                <>
                  <span className="text-sm text-tinta-600">{extrato.nome}</span>
                  <button
                    onClick={() => setExtrato(null)}
                    className="btn btn-sutil btn-p"
                  >
                    tirar
                  </button>
                </>
              )}
            </div>
            <p className="ajuda">
              O arquivo fica guardado com a conciliação — dá para sair da tela,
              lançar o que faltava e voltar sem importar de novo.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="rotulo">
              Conciliar automaticamente em caso de datas diferentes
            </label>
            <div className="flex gap-4">
              {[
                { valor: true, rotulo: 'Sim' },
                { valor: false, rotulo: 'Não' },
              ].map((o) => (
                <label key={o.rotulo} className="opcao">
                  <input
                    type="radio"
                    className="accent-brand-600"
                    checked={datasDiferentes === o.valor}
                    onChange={() => setDatasDiferentes(o.valor)}
                  />
                  {o.rotulo}
                </label>
              ))}
            </div>
            <p className="ajuda">
              Com "Sim", o mesmo valor casa com até três dias de diferença — é o
              caso de quem pagou na sexta e lançou na segunda. Com "Não", só
              casa o que caiu no mesmo dia.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={() => criar.mutate()}
            disabled={!conta || criar.isPending}
            className="btn btn-primario"
          >
            {criar.isPending ? 'Lendo o extrato…' : 'Criar e continuar →'}
          </button>
        </div>
      </div>
    </Pagina>
  );
}

// ---------------------------------------------------------------------------
// Passos 2 a 4: a conciliação existe
// ---------------------------------------------------------------------------

function Trabalhar({ id }: { id: string }) {
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const [passo, setPasso] = useState(1);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  /** O par sendo montado na mão: a transação e a linha escolhidas. */
  const [escolhidaBanco, setEscolhidaBanco] = useState<string | null>(null);
  const [escolhidaIxc, setEscolhidaIxc] = useState<number | null>(null);
  const [procurando, setProcurando] = useState<TransacaoDaConciliacao | null>(null);
  const [ignorando, setIgnorando] = useState<TransacaoDaConciliacao | null>(null);

  const consulta = useQuery({
    queryKey: ['conciliacao', id],
    retry: 0,
    queryFn: async () =>
      (await api.get<ConciliacaoAberta>(`/contas-abertas/conciliacoes/${id}`))
        .data,
  });

  function recarregar() {
    void queryClient.invalidateQueries({ queryKey: ['conciliacao', id] });
    void queryClient.invalidateQueries({ queryKey: ['conciliacoes'] });
  }

  /** Toda ação do assistente passa por aqui: age, relê, e conta o que houve. */
  function acao<T>(
    chamada: (dados: T) => Promise<unknown>,
    aoTerminar?: (r: unknown) => void,
  ) {
    return async (dados: T) => {
      setErro(null);
      setRecado(null);
      try {
        const r = await chamada(dados);
        aoTerminar?.(r);
        recarregar();
      } catch (e) {
        setErro(mensagemErro(e));
      }
    };
  }

  const casar = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ ligadas: number; sobraramBanco: number; sobraramIxc: number }>(
          `/contas-abertas/conciliacoes/${id}/casar`,
        )
      ).data,
    onSuccess: (r) => {
      setErro(null);
      setRecado(
        r.ligadas === 0
          ? 'Nada casou sozinho. Vá para a conciliação manual: ali dá para ligar ' +
              'um a um, lançar o que faltou e explicar o que não é do contas a pagar.'
          : `${r.ligadas} ligação(ões) feitas. Sobraram ${r.sobraramBanco} do ` +
              `banco e ${r.sobraramIxc} do IXC.`,
      );
      if (r.sobraramBanco > 0 || r.sobraramIxc > 0) setPasso(2);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const ligar = acao<{ fitId: string; idMovimFinan: number }>(
    (d) => api.post(`/contas-abertas/conciliacoes/${id}/ligar`, d),
    () => {
      setEscolhidaBanco(null);
      setEscolhidaIxc(null);
    },
  );
  const desligar = acao<string>((fitId) =>
    api.post(`/contas-abertas/conciliacoes/${id}/desligar`, { fitId }),
  );
  const conferir = acao<number[]>((ids) =>
    api.post(`/contas-abertas/conciliacoes/${id}/conferir`, { ids }),
  );
  const desconferir = acao<number[]>((ids) =>
    api.post(`/contas-abertas/conciliacoes/${id}/desconferir`, { ids }),
  );
  const desistirDeIgnorar = acao<string>((fitId) =>
    api.post(`/contas-abertas/conciliacoes/${id}/desistir-de-ignorar`, { fitId }),
  );

  const fechar = useMutation({
    mutationFn: async () =>
      api.post(`/contas-abertas/conciliacoes/${id}/fechar`),
    onSuccess: () => {
      recarregar();
      navegar('/contas-pagar/conciliacao');
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const reabrir = useMutation({
    mutationFn: async () =>
      api.post(`/contas-abertas/conciliacoes/${id}/reabrir`),
    onSuccess: recarregar,
    onError: (e) => setErro(mensagemErro(e)),
  });

  if (consulta.isLoading) {
    return (
      <Pagina>
        <div className="card">
          <Carregando texto="Lendo a movimentação no IXC…" />
        </div>
      </Pagina>
    );
  }
  if (consulta.isError || !consulta.data) {
    return (
      <Pagina>
        <Aviso tom="erro">{mensagemErro(consulta.error)}</Aviso>
      </Pagina>
    );
  }

  const { conciliacao: c, linhas, transacoes, resumo, avisos } = consulta.data;
  const fechada = c.status === 'FECHADA';

  const linhasPendentes = linhas.filter(
    (l) => !l.extrato && !l.conciliadoNoIxc && !l.conferida,
  );
  const transacoesPendentes = transacoes.filter(
    (t) => t.idMovimFinan === null && !t.ignorada,
  );

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Conciliação bancária"
        titulo={`Conciliação nº ${c.numero} — ${c.conta.nome}`}
        descricao={
          <>
            {formatData(c.de)} a {formatData(c.ate)}
            {c.extrato?.arquivo && <> · extrato: {c.extrato.arquivo}</>}
            {c.extrato?.saldo !== null && c.extrato?.saldo !== undefined && (
              <>
                {' '}
                · saldo do banco em {formatData(c.extrato.saldoEm)}:{' '}
                <strong className="num">{formatBRL(c.extrato.saldo)}</strong>
              </>
            )}
          </>
        }
        acoes={
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => navegar('/contas-pagar/conciliacao')}
              className="btn btn-neutro"
            >
              Voltar à lista
            </button>
            {fechada ? (
              <button
                onClick={() => reabrir.mutate()}
                disabled={reabrir.isPending}
                className="btn btn-neutro"
              >
                Reabrir
              </button>
            ) : (
              <button
                onClick={() => consulta.refetch()}
                disabled={consulta.isFetching}
                className="btn btn-acao"
              >
                {consulta.isFetching ? 'Lendo o IXC…' : 'Atualizar'}
              </button>
            )}
          </div>
        }
      />

      <BarraDePassos atual={passo} onIr={setPasso} />

      {fechada && (
        <Aviso tom="pago">
          Conciliação encerrada
          {c.fechadaEm ? ` em ${formatData(c.fechadaEm)}` : ''}
          {c.fechadaPor ? ` por ${c.fechadaPor}` : ''}. Para mexer nela, reabra.
        </Aviso>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {recado && <Aviso tom="marca">{recado}</Aviso>}
      {avisos.map((a) => (
        <Aviso key={a} tom="atencao">
          {a}
        </Aviso>
      ))}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          acento
          rotulo="Falta resolver"
          valor={resumo.linhasPendentes + resumo.transacoesPendentes}
          detalhe={`${resumo.transacoesPendentes} do banco · ${resumo.linhasPendentes} do IXC`}
        />
        <Indicador
          rotulo="Ligados"
          valor={resumo.transacoesLigadas}
          detalhe={`de ${resumo.transacoes} transação(ões) do extrato`}
        />
        <Indicador
          rotulo="Saiu da conta"
          valor={formatBRL(resumo.saidas)}
          detalhe={`no extrato: ${formatBRL(resumo.saidasBanco)}`}
          alerta={
            Math.abs(resumo.saidas - resumo.saidasBanco) > 0.005
              ? `diferença de ${formatBRL(Math.abs(resumo.saidas - resumo.saidasBanco))}`
              : undefined
          }
        />
        <Indicador
          rotulo="Entrou na conta"
          valor={formatBRL(resumo.entradas)}
          detalhe={`no extrato: ${formatBRL(resumo.entradasBanco)}`}
          alerta={
            Math.abs(resumo.entradas - resumo.entradasBanco) > 0.005
              ? `diferença de ${formatBRL(Math.abs(resumo.entradas - resumo.entradasBanco))}`
              : undefined
          }
        />
      </div>

      {passo === 1 && (
        <Automatica
          linhas={linhas}
          transacoes={transacoes}
          fechada={fechada}
          rodando={casar.isPending}
          onCasar={() => casar.mutate()}
          onDesligar={desligar}
        />
      )}

      {passo === 2 && (
        <Manual
          linhasPendentes={linhasPendentes}
          transacoesPendentes={transacoesPendentes}
          ignoradas={transacoes.filter((t) => t.ignorada)}
          fechada={fechada}
          escolhidaBanco={escolhidaBanco}
          escolhidaIxc={escolhidaIxc}
          onEscolherBanco={setEscolhidaBanco}
          onEscolherIxc={setEscolhidaIxc}
          onLigar={() =>
            escolhidaBanco !== null &&
            escolhidaIxc !== null &&
            ligar({ fitId: escolhidaBanco, idMovimFinan: escolhidaIxc })
          }
          onAcharTitulo={setProcurando}
          onIgnorar={setIgnorando}
          onDesistirDeIgnorar={desistirDeIgnorar}
          onConferir={(idLinha) => conferir([idLinha])}
        />
      )}

      {passo === 3 && (
        <Conciliados
          linhas={linhas}
          transacoes={transacoes}
          fechada={fechada}
          podeFechar={resumo.podeFechar}
          fechando={fechar.isPending}
          pendencias={resumo.linhasPendentes + resumo.transacoesPendentes}
          onFechar={() => fechar.mutate()}
          onDesligar={desligar}
          onDesconferir={(idLinha) => desconferir([idLinha])}
        />
      )}

      {procurando && (
        <AcharTitulo
          transacao={procurando}
          conta={c.conta.id}
          onFechar={() => setProcurando(null)}
          onBaixou={() => {
            setProcurando(null);
            setRecado(
              'Baixa feita. O lançamento aparece na movimentação do IXC — rode a ' +
                'conciliação automática para ligá-lo a esta transação.',
            );
            recarregar();
          }}
        />
      )}

      {ignorando && (
        <ExplicarIgnorada
          transacao={ignorando}
          onFechar={() => setIgnorando(null)}
          onPronto={async (motivo) => {
            setErro(null);
            try {
              await api.post(`/contas-abertas/conciliacoes/${id}/ignorar`, {
                fitId: ignorando.fitId,
                motivo,
              });
              setIgnorando(null);
              recarregar();
            } catch (e) {
              setErro(mensagemErro(e));
            }
          }}
        />
      )}
    </Pagina>
  );
}

/** Passo 2: os dois lados, e o botão que liga o que bate. */
function Automatica({
  linhas,
  transacoes,
  fechada,
  rodando,
  onCasar,
  onDesligar,
}: {
  linhas: LinhaDaConciliacao[];
  transacoes: TransacaoDaConciliacao[];
  fechada: boolean;
  rodando: boolean;
  onCasar: () => void;
  onDesligar: (fitId: string) => void;
}) {
  return (
    <>
      <div className="surgir mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={onCasar}
          disabled={fechada || rodando}
          className="btn btn-primario"
        >
          {rodando ? 'Ligando…' : 'Conciliação automática'}
        </button>
        <p className="text-sm text-tinta-500">
          Liga o que tem o mesmo valor, usando a data para desempatar. Cada linha
          é usada uma vez só, e o que já foi ligado na mão fica como está.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="faixa-titulo px-4 py-3">
            <h2 className="titulo-bloco">Movimentação financeira (IXC)</h2>
          </div>
          <TabelaIxc linhas={linhas} />
        </div>

        <div className="card overflow-hidden">
          <div className="faixa-titulo px-4 py-3">
            <h2 className="titulo-bloco">Extrato bancário</h2>
          </div>
          <TabelaBanco
            transacoes={transacoes}
            fechada={fechada}
            onDesligar={onDesligar}
          />
        </div>
      </div>
    </>
  );
}

function TabelaIxc({ linhas }: { linhas: LinhaDaConciliacao[] }) {
  if (linhas.length === 0) {
    return <Vazio titulo="Sem movimento no período">Nada saiu nem entrou nesta conta.</Vazio>;
  }
  return (
    <div className="max-h-[32rem] overflow-auto rolagem-fina">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-papel">
          <tr>
            <th className="th w-10">Conc.</th>
            <th className="th">Data</th>
            <th className="th">Histórico</th>
            <th className="th text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} className="linha">
              <td className="td text-center">
                <MarcaDeLigacao ligada={l.extrato !== null || l.conciliadoNoIxc || !!l.conferida} />
              </td>
              <td className="td num whitespace-nowrap">{formatData(l.data)}</td>
              <td className="td">
                <div className="text-tinta-800">{l.historico || '—'}</div>
                <div className="flex flex-wrap gap-1.5 text-xs text-tinta-400">
                  {l.titulo && <span className="num">título nº {l.titulo.idFnApagar}</span>}
                  {l.conciliadoNoIxc && (
                    <Selo pequeno tom="pago" titulo="Já conciliada na tela do IXC">
                      IXC
                    </Selo>
                  )}
                  {l.conferida?.onde === 'fechamento-caixa' && (
                    <Selo pequeno tom="info" titulo="Conferida no Fechamento de Caixa">
                      caixa
                    </Selo>
                  )}
                </div>
              </td>
              <td className="td whitespace-nowrap text-right">
                <Valor valor={l.valor} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaBanco({
  transacoes,
  fechada,
  onDesligar,
}: {
  transacoes: TransacaoDaConciliacao[];
  fechada: boolean;
  onDesligar: (fitId: string) => void;
}) {
  if (transacoes.length === 0) {
    return (
      <Vazio titulo="Sem extrato">
        Esta conciliação foi aberta sem arquivo. A conferência é contra a tela do
        banco, ligando na mão no passo seguinte.
      </Vazio>
    );
  }
  return (
    <div className="max-h-[32rem] overflow-auto rolagem-fina">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-papel">
          <tr>
            <th className="th w-10">Conc.</th>
            <th className="th">Data</th>
            <th className="th">Histórico</th>
            <th className="th text-right">Valor</th>
            <th className="th"></th>
          </tr>
        </thead>
        <tbody>
          {transacoes.map((t) => (
            <tr key={t.fitId} className="linha">
              <td className="td text-center">
                <MarcaDeLigacao ligada={t.idMovimFinan !== null} ignorada={t.ignorada} />
              </td>
              <td className="td num whitespace-nowrap">{formatData(t.data)}</td>
              <td className="td">
                <div className="text-tinta-800">{t.descricao || '—'}</div>
                {t.ignorada && t.motivo && (
                  <div className="text-xs text-amber-700 dark:text-amber-300">
                    fora da conciliação: {t.motivo}
                  </div>
                )}
              </td>
              <td className="td whitespace-nowrap text-right">
                <Valor valor={t.valor} />
              </td>
              <td className="td text-right">
                {t.idMovimFinan !== null && !fechada && (
                  <button
                    onClick={() => onDesligar(t.fitId)}
                    className="btn btn-sutil btn-p"
                    title="Desfaz a ligação desta transação com a linha do IXC"
                  >
                    desligar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Passo 3: o que sobrou dos dois lados — onde o trabalho acontece. */
function Manual({
  linhasPendentes,
  transacoesPendentes,
  ignoradas,
  fechada,
  escolhidaBanco,
  escolhidaIxc,
  onEscolherBanco,
  onEscolherIxc,
  onLigar,
  onAcharTitulo,
  onIgnorar,
  onDesistirDeIgnorar,
  onConferir,
}: {
  linhasPendentes: LinhaDaConciliacao[];
  transacoesPendentes: TransacaoDaConciliacao[];
  ignoradas: TransacaoDaConciliacao[];
  fechada: boolean;
  escolhidaBanco: string | null;
  escolhidaIxc: number | null;
  onEscolherBanco: (fitId: string | null) => void;
  onEscolherIxc: (id: number | null) => void;
  onLigar: () => void;
  onAcharTitulo: (t: TransacaoDaConciliacao) => void;
  onIgnorar: (t: TransacaoDaConciliacao) => void;
  onDesistirDeIgnorar: (fitId: string) => void;
  onConferir: (idLinha: number) => void;
}) {
  const podeLigar = escolhidaBanco !== null && escolhidaIxc !== null;

  if (transacoesPendentes.length === 0 && linhasPendentes.length === 0) {
    return (
      <div className="card surgir">
        <Vazio titulo="Nada pendente">
          Os dois lados estão resolvidos. Vá para "Todos os conciliados" e
          encerre a conciliação.
        </Vazio>
      </div>
    );
  }

  return (
    <>
      {podeLigar && !fechada && (
        <div className="surgir barra-selecao mb-4">
          <span className="barra-selecao-titulo">
            Ligar a transação escolhida à linha do IXC escolhida
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={onLigar} className="btn btn-pagar btn-p">
              Ligar as duas
            </button>
            <button
              onClick={() => {
                onEscolherBanco(null);
                onEscolherIxc(null);
              }}
              className="btn btn-sutil btn-p text-white/80 hover:bg-white/10 hover:text-white"
            >
              Limpar
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="faixa-titulo px-4 py-3">
            <h2 className="titulo-bloco">
              No banco e não no IXC ({transacoesPendentes.length})
            </h2>
          </div>
          {transacoesPendentes.length === 0 ? (
            <Vazio titulo="Nada do lado do banco">
              Todas as transações do extrato foram resolvidas.
            </Vazio>
          ) : (
            <div className="max-h-[30rem] overflow-auto rolagem-fina">
              <table className="w-full text-sm">
                <tbody>
                  {transacoesPendentes.map((t) => (
                    <tr
                      key={t.fitId}
                      className={`linha ${escolhidaBanco === t.fitId ? 'linha-marcada' : ''}`}
                    >
                      <td className="td w-10">
                        <input
                          type="radio"
                          className="accent-brand-600"
                          checked={escolhidaBanco === t.fitId}
                          onChange={() => onEscolherBanco(t.fitId)}
                          disabled={fechada}
                          aria-label={`Escolher ${t.descricao}`}
                        />
                      </td>
                      <td className="td num whitespace-nowrap">{formatData(t.data)}</td>
                      <td className="td">{t.descricao || '—'}</td>
                      <td className="td whitespace-nowrap text-right">
                        <Valor valor={t.valor} />
                      </td>
                      <td className="td whitespace-nowrap text-right">
                        {!fechada && (
                          <>
                            {t.valor < 0 && (
                              <button
                                onClick={() => onAcharTitulo(t)}
                                className="btn btn-neutro btn-p"
                                title="Acha o título em aberto que esta saída pagou e dá a baixa"
                              >
                                Lançar
                              </button>
                            )}
                            <button
                              onClick={() => onIgnorar(t)}
                              className="btn btn-sutil btn-p ml-1"
                              title="Esta transação não é do contas a pagar"
                            >
                              não é daqui
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="faixa-titulo px-4 py-3">
            <h2 className="titulo-bloco">
              No IXC e não no banco ({linhasPendentes.length})
            </h2>
          </div>
          {linhasPendentes.length === 0 ? (
            <Vazio titulo="Nada do lado do IXC">
              Toda a movimentação do período tem par ou já estava conferida.
            </Vazio>
          ) : (
            <div className="max-h-[30rem] overflow-auto rolagem-fina">
              <table className="w-full text-sm">
                <tbody>
                  {linhasPendentes.map((l) => (
                    <tr
                      key={l.id}
                      className={`linha ${escolhidaIxc === l.id ? 'linha-marcada' : ''}`}
                    >
                      <td className="td w-10">
                        <input
                          type="radio"
                          className="accent-brand-600"
                          checked={escolhidaIxc === l.id}
                          onChange={() => onEscolherIxc(l.id)}
                          disabled={fechada}
                          aria-label={`Escolher ${l.historico}`}
                        />
                      </td>
                      <td className="td num whitespace-nowrap">{formatData(l.data)}</td>
                      <td className="td">
                        <div>{l.historico || '—'}</div>
                        {l.titulo && (
                          <div className="num text-xs text-tinta-400">
                            título nº {l.titulo.idFnApagar}
                          </div>
                        )}
                      </td>
                      <td className="td whitespace-nowrap text-right">
                        <Valor valor={l.valor} />
                      </td>
                      <td className="td text-right">
                        {!fechada && (
                          <button
                            onClick={() => onConferir(l.id)}
                            className="btn btn-sutil btn-p"
                            title="O banco não mostra esta linha e ela está certa assim — transferência interna, provisão. Fica conferida."
                          >
                            está certa
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {ignoradas.length > 0 && (
        <div className="card surgir mt-4 overflow-hidden">
          <div className="faixa-titulo px-4 py-3">
            <h2 className="titulo-bloco">
              Fora da conciliação ({ignoradas.length})
            </h2>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {ignoradas.map((t) => (
                <tr key={t.fitId} className="linha">
                  <td className="td num whitespace-nowrap">{formatData(t.data)}</td>
                  <td className="td">
                    <div>{t.descricao || '—'}</div>
                    <div className="text-xs text-amber-700 dark:text-amber-300">
                      {t.motivo}
                    </div>
                  </td>
                  <td className="td whitespace-nowrap text-right">
                    <Valor valor={t.valor} />
                  </td>
                  <td className="td text-right">
                    {!fechada && (
                      <button
                        onClick={() => onDesistirDeIgnorar(t.fitId)}
                        className="btn btn-sutil btn-p"
                      >
                        voltar para pendentes
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Passo 4: o par a par do que ficou pronto, e o botão que encerra. */
function Conciliados({
  linhas,
  transacoes,
  fechada,
  podeFechar,
  fechando,
  pendencias,
  onFechar,
  onDesligar,
  onDesconferir,
}: {
  linhas: LinhaDaConciliacao[];
  transacoes: TransacaoDaConciliacao[];
  fechada: boolean;
  podeFechar: boolean;
  fechando: boolean;
  pendencias: number;
  onFechar: () => void;
  onDesligar: (fitId: string) => void;
  onDesconferir: (idLinha: number) => void;
}) {
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const pares = transacoes
    .filter((t) => t.idMovimFinan !== null)
    .map((t) => ({ transacao: t, linha: porId.get(t.idMovimFinan!) ?? null }));
  const conferidasSemPar = linhas.filter(
    (l) => !l.extrato && (l.conferida !== null || l.conciliadoNoIxc),
  );

  return (
    <>
      <div className="surgir card mb-4 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="eyebrow">Encerrar a conciliação</p>
          <p className="mt-1 text-sm text-tinta-500">
            {fechada
              ? 'Esta conciliação já está encerrada.'
              : podeFechar
                ? 'Os dois lados estão resolvidos. Pode encerrar.'
                : `Ainda falta resolver ${pendencias} item(ns) na conciliação manual.`}
          </p>
        </div>
        <button
          onClick={onFechar}
          disabled={fechada || !podeFechar || fechando}
          className="btn btn-pagar"
          title={
            podeFechar
              ? 'Encerra o período: ele passa a constar conferido'
              : 'Resolva as pendências antes — encerrar com pendência é dar por conferido o que ninguém conferiu'
          }
        >
          {fechando ? 'Encerrando…' : 'Finalizar conciliação'}
        </button>
      </div>

      <div className="card surgir overflow-hidden">
        <div className="faixa-titulo px-4 py-3">
          <h2 className="titulo-bloco">Ligados ({pares.length})</h2>
        </div>
        {pares.length === 0 ? (
          <Vazio titulo="Nenhum par ainda">
            Rode a conciliação automática, ou ligue na mão.
          </Vazio>
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Banco</th>
                  <th className="th">IXC</th>
                  <th className="th text-right">Valor</th>
                  <th className="th">Como</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {pares.map(({ transacao: t, linha }) => (
                  <tr key={t.fitId} className="linha">
                    <td className="td">
                      <div className="num text-xs text-tinta-400">
                        {formatData(t.data)}
                      </div>
                      {t.descricao || '—'}
                    </td>
                    <td className="td">
                      <div className="num text-xs text-tinta-400">
                        {linha ? formatData(linha.data) : '—'}
                      </div>
                      {linha?.historico ?? (
                        <span className="text-tinta-400">
                          fora do período lido agora
                        </span>
                      )}
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      <Valor valor={t.valor} />
                    </td>
                    <td className="td">
                      <Selo pequeno tom={t.casadaAuto ? 'marca' : 'neutro'}>
                        {t.casadaAuto ? 'automática' : 'na mão'}
                      </Selo>
                    </td>
                    <td className="td text-right">
                      {!fechada && (
                        <button
                          onClick={() => onDesligar(t.fitId)}
                          className="btn btn-sutil btn-p"
                        >
                          desligar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {conferidasSemPar.length > 0 && (
        <div className="card surgir mt-4 overflow-hidden">
          <div className="faixa-titulo px-4 py-3">
            <h2 className="titulo-bloco">
              Conferidas sem par no extrato ({conferidasSemPar.length})
            </h2>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {conferidasSemPar.map((l) => (
                <tr key={l.id} className="linha">
                  <td className="td num whitespace-nowrap">{formatData(l.data)}</td>
                  <td className="td">{l.historico || '—'}</td>
                  <td className="td">
                    {l.conciliadoNoIxc ? (
                      <Selo pequeno tom="pago">conciliada no IXC</Selo>
                    ) : l.conferida?.onde === 'fechamento-caixa' ? (
                      <Selo pequeno tom="info">conferida no caixa</Selo>
                    ) : (
                      <Selo pequeno tom="marca">dada por certa aqui</Selo>
                    )}
                  </td>
                  <td className="td whitespace-nowrap text-right">
                    <Valor valor={l.valor} />
                  </td>
                  <td className="td text-right">
                    {!fechada && l.conferida?.onde === 'conciliacao' && (
                      <button
                        onClick={() => onDesconferir(l.id)}
                        className="btn btn-sutil btn-p"
                      >
                        desfazer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** A janela que explica por que uma transação do banco fica de fora. */
function ExplicarIgnorada({
  transacao,
  onFechar,
  onPronto,
}: {
  transacao: TransacaoDaConciliacao;
  onFechar: () => void;
  onPronto: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  return (
    <Janela titulo="Esta transação não é do contas a pagar" onFechar={onFechar}>
      <div className="mb-4 rounded-xl border border-tinta-200 bg-tinta-50 px-4 py-3 text-sm">
        <strong className="valor">{formatBRL(transacao.valor)}</strong> em{' '}
        {formatData(transacao.data)} — {transacao.descricao || 'sem descrição'}
      </div>
      <label className="rotulo">Por quê?</label>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="tarifa lançada pela contabilidade, estorno de cliente, transferência entre contas…"
        className="campo"
        autoFocus
      />
      <p className="ajuda">
        O motivo fica gravado com a conciliação. É ele que distingue "resolvi" de
        "tirei da frente" quando alguém reabrir isto daqui a seis meses.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => onPronto(motivo)}
          disabled={motivo.trim().length < 3}
          className="btn btn-primario"
        >
          Deixar de fora
        </button>
      </div>
    </Janela>
  );
}

/**
 * Achar o título em aberto que a saída do extrato pagou, e baixá-lo.
 *
 * É o caminho do "provavelmente não foi lançado": o dinheiro saiu, o banco
 * mostra, e no contas a pagar a conta continua em aberto. A busca começa pelo
 * valor, que é o que os dois têm igual.
 */
function AcharTitulo({
  transacao,
  conta,
  onFechar,
  onBaixou,
}: {
  transacao: TransacaoDaConciliacao;
  conta: number;
  onFechar: () => void;
  onBaixou: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [porValor, setPorValor] = useState(true);
  const [feito, setFeito] = useState<ResultadoDoPagamento | null>(null);
  const valor = Math.abs(transacao.valor);

  const candidatos = useQuery({
    queryKey: ['conciliacao-titulos', valor, transacao.data, busca, porValor],
    queryFn: async () =>
      (
        await api.get<TituloCandidato[]>(
          '/contas-abertas/conciliacao/titulos-abertos',
          {
            params: {
              valor: porValor && !busca ? valor : undefined,
              data: transacao.data,
              busca: busca || undefined,
            },
          },
        )
      ).data,
  });

  const baixar = useMutation({
    mutationFn: async (idFnApagar: number) =>
      (
        await api.post<ResultadoDoPagamento>('/contas-abertas/conciliacao/baixar', {
          idFnApagar,
          conta,
          data: transacao.data,
        })
      ).data,
    onSuccess: setFeito,
  });

  if (feito) {
    return (
      <Janela titulo="Baixa feita no IXC" onFechar={onBaixou}>
        <Aviso tom={feito.paga ? 'pago' : 'atencao'}>
          {feito.paga ? (
            <>
              O título nº <strong className="num">{feito.idFnApagar}</strong>{' '}
              está quitado no IXC: <strong className="num">{formatBRL(feito.valor)}</strong>{' '}
              em {formatData(transacao.data)}.
            </>
          ) : (
            <>
              O título nº <strong className="num">{feito.idFnApagar}</strong> foi
              aprovado, mas o IXC ainda não o mostra quitado. Confira por lá
              antes de tentar de novo.
            </>
          )}
        </Aviso>
        {feito.avisos.map((a) => (
          <Aviso key={a} tom="atencao">
            {a}
          </Aviso>
        ))}
        <div className="mt-4 flex justify-end">
          <button onClick={onBaixou} className="btn btn-primario">
            Fechar e atualizar
          </button>
        </div>
      </Janela>
    );
  }

  return (
    <Janela titulo="Achar o título desta saída" onFechar={onFechar}>
      <div className="mb-4 rounded-xl border border-tinta-200 bg-tinta-50 px-4 py-3 text-sm">
        <p className="text-tinta-500">O banco lançou</p>
        <p className="mt-0.5">
          <strong className="valor text-base">{formatBRL(transacao.valor)}</strong>{' '}
          em {formatData(transacao.data)} — {transacao.descricao || 'sem descrição'}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar pelo nome do fornecedor"
          className="campo max-w-sm"
        />
        <button
          onClick={() => {
            setBusca('');
            setPorValor(true);
          }}
          className={`btn btn-p ${porValor && !busca ? 'btn-acao' : 'btn-neutro'}`}
        >
          Só os de {formatBRL(valor)}
        </button>
        <button
          onClick={() => setPorValor(false)}
          className={`btn btn-p ${!porValor && !busca ? 'btn-acao' : 'btn-neutro'}`}
        >
          Todos em aberto
        </button>
      </div>

      {baixar.isError && <Aviso tom="erro">{mensagemErro(baixar.error)}</Aviso>}

      <Aviso tom="atencao">
        A baixa sai no IXC agora, na conta desta conciliação e na data do
        extrato. Confira o título antes: pagar duas vezes o mesmo é o erro que
        esta tela pode cometer.
      </Aviso>

      {candidatos.isLoading ? (
        <Carregando texto="Procurando títulos em aberto…" />
      ) : (candidatos.data ?? []).length === 0 ? (
        <Vazio titulo="Nenhum título em aberto bate com isso">
          Pode ter juros ou desconto, ou ter quitado mais de um título. Procure
          pelo nome do fornecedor — ou lance a despesa em "Nova despesa" e volte
          para ligar aqui.
        </Vazio>
      ) : (
        <div className="overflow-x-auto rolagem-fina">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Fornecedor</th>
                <th className="th">Vencimento</th>
                <th className="th text-right">Em aberto</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {(candidatos.data ?? []).map((t) => (
                <tr key={t.idFnApagar} className="linha">
                  <td className="td">
                    <div className="text-tinta-800">{t.fornecedor}</div>
                    <div className="num text-xs text-tinta-400">
                      título nº {t.idFnApagar}
                      {t.documento && ` · doc. ${t.documento}`}
                    </div>
                  </td>
                  <td className="td num whitespace-nowrap">
                    {formatData(t.vencimento)}
                    {t.diasDoExtrato !== null && (
                      <div className="text-xs text-tinta-400">
                        {t.diasDoExtrato === 0
                          ? 'no dia do extrato'
                          : t.diasDoExtrato > 0
                            ? `${t.diasDoExtrato} dia(s) depois`
                            : `${Math.abs(t.diasDoExtrato)} dia(s) antes`}
                      </div>
                    )}
                  </td>
                  <td className="td whitespace-nowrap text-right">
                    <span className="valor">{formatBRL(t.valorAberto)}</span>
                    {Math.abs(t.valorAberto - valor) > 0.005 && (
                      <div className="text-xs text-amber-700 dark:text-amber-300">
                        {formatBRL(t.valorAberto - valor)} de diferença
                      </div>
                    )}
                  </td>
                  <td className="td text-right">
                    <button
                      onClick={() => baixar.mutate(t.idFnApagar)}
                      disabled={baixar.isPending}
                      className="btn btn-pagar btn-p"
                    >
                      {baixar.isPending ? 'Baixando…' : 'Dar baixa'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Janela>
  );
}

// ---------------------------------------------------------------------------

function BarraDePassos({
  atual,
  onIr,
}: {
  atual: number;
  onIr?: (passo: number) => void;
}) {
  return (
    <div className="surgir mb-5 flex flex-wrap gap-1.5">
      {PASSOS.map((nome, i) => {
        const feito = i < atual;
        return (
          <button
            key={nome}
            onClick={() => onIr?.(i)}
            disabled={!onIr || i === 0}
            className={`btn btn-p ${
              i === atual ? 'btn-acao' : feito ? 'btn-neutro' : 'btn-sutil'
            } ${!onIr || i === 0 ? 'cursor-default' : ''}`}
          >
            {i + 1}. {nome}
          </button>
        );
      })}
    </div>
  );
}

/** O ✓ e o ✗ da grade do IXC: ligado ou não. */
function MarcaDeLigacao({
  ligada,
  ignorada = false,
}: {
  ligada: boolean;
  ignorada?: boolean;
}) {
  if (ignorada) {
    return (
      <span className="text-amber-600 dark:text-amber-300" title="Fora da conciliação">
        —
      </span>
    );
  }
  return ligada ? (
    <span className="text-emerald-600 dark:text-emerald-300" title="Ligada">
      ✓
    </span>
  ) : (
    <span className="text-rose-500 dark:text-rose-300" title="Sem par">
      ✗
    </span>
  );
}

function Valor({ valor }: { valor: number }) {
  return (
    <span
      className={`valor ${
        valor < 0
          ? 'text-rose-600 dark:text-rose-300'
          : 'text-emerald-700 dark:text-emerald-300'
      }`}
    >
      {formatBRL(valor)}
    </span>
  );
}

/**
 * O texto do arquivo, no encoding certo.
 *
 * O OFX dos bancos brasileiros costuma vir em windows-1252, e lido como UTF-8
 * ele enche a tela de "" no lugar dos acentos. O cabeçalho do próprio
 * arquivo diz (`CHARSET:1252`) — e quando não diz, o caractere de substituição
 * entrega que a leitura foi errada.
 */
async function lerArquivo(arquivo: File): Promise<string> {
  const bytes = await arquivo.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (/CHARSET:\s*1252/i.test(utf8) || utf8.includes('�')) {
    return new TextDecoder('windows-1252').decode(bytes);
  }
  return utf8;
}

/** Do dia 1º até hoje: o mês que se está conciliando. */
function mesAtual(): { de: string; ate: string } {
  const hoje = new Date();
  return {
    de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
    ate: iso(hoje),
  };
}

/** Data local em "AAAA-MM-DD" — sem passar por UTC, que rouba um dia. */
function iso(data: Date): string {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}
