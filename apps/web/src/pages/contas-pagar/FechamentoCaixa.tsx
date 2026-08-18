import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Indicador,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { reduzirFoto } from '../../lib/foto';
import { formatBRL, formatData } from '../../lib/format';
import type {
  CaixasDoFechamento,
  DinheiroNaRua,
  ExtratoDoCaixa,
  LancamentoDoCaixa,
} from '../../lib/types';

/** Primeiro e último dia do mês corrente, que é o recorte mais pedido. */
function mesCorrente(): { de: string; ate: string } {
  const hoje = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  return {
    de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
    ate: iso(hoje),
  };
}

/**
 * Bater o caixa do dinheiro em mãos.
 *
 * A tela existe para substituir a folha de papel: as saídas do período vêm do
 * IXC, cada uma é conferida e ganha a foto da nota, e o que saiu com alguém e
 * ainda não voltou fica declarado — sem isso a contagem nunca fecha e a
 * explicação vive na memória de quem entregou.
 */
export function FechamentoCaixa() {
  const [caixaId, setCaixaId] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState(mesCorrente);

  const caixas = useQuery({
    queryKey: ['caixa', 'caixas'],
    queryFn: async () =>
      (await api.get<CaixasDoFechamento>('/caixa/caixas')).data,
  });

  // O caixa do dinheiro em mãos já vem escolhido: é ele que se bate quase
  // sempre, e quem quiser outro troca no seletor.
  useEffect(() => {
    if (caixaId === null && caixas.data) {
      setCaixaId(caixas.data.emUso ?? caixas.data.caixas[0]?.id ?? null);
    }
  }, [caixas.data, caixaId]);

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Fechamento de Caixa"
        titulo="Bater o caixa"
        descricao="As saídas do período, uma a uma, com a foto da nota no lugar do papel. O que está na rua com alguém entra na conta."
      />

      <Bloco titulo="Que caixa, e de quando até quando" className="surgir mb-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="rotulo" htmlFor="caixa">
              Caixa
            </label>
            <select
              id="caixa"
              className="campo"
              value={caixaId ?? ''}
              disabled={caixas.isLoading}
              onChange={(e) => setCaixaId(Number(e.target.value) || null)}
            >
              <option value="">
                {caixas.isLoading ? 'lendo do IXC…' : 'Escolha o caixa'}
              </option>
              {(caixas.data?.caixas ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.id === caixas.data?.emUso ? ' — dinheiro em mãos' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="rotulo" htmlFor="de">
              De
            </label>
            <input
              id="de"
              type="date"
              className="campo"
              value={periodo.de}
              onChange={(e) =>
                setPeriodo((p) => ({ ...p, de: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="rotulo" htmlFor="ate">
              Até
            </label>
            <input
              id="ate"
              type="date"
              className="campo"
              value={periodo.ate}
              onChange={(e) =>
                setPeriodo((p) => ({ ...p, ate: e.target.value }))
              }
            />
          </div>
        </div>

        {caixas.isError && (
          <p className="mt-3 text-sm text-rose-600">
            {mensagemErro(caixas.error)}
          </p>
        )}
        {caixas.data && caixas.data.caixas.length === 0 && (
          <p className="ajuda mt-3">
            Nenhum caixa veio do IXC. Confira em Configurações a tabela de
            contas de caixa.
          </p>
        )}
      </Bloco>

      {caixaId && periodo.de && periodo.ate ? (
        <Conferencia caixaId={caixaId} de={periodo.de} ate={periodo.ate} />
      ) : (
        <Vazio titulo="Escolha o caixa e o período">
          A conferência aparece aqui.
        </Vazio>
      )}
    </Pagina>
  );
}

function Conferencia({
  caixaId,
  de,
  ate,
}: {
  caixaId: number;
  de: string;
  ate: string;
}) {
  const qc = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  /*
   * A lista abre nas saídas.
   *
   * Um caixa de provedor recebe muito mais do que paga — 109 recebimentos de
   * cliente para 52 saídas, no primeiro mês desta tela. Os recebimentos entram
   * no saldo e por isso continuam à mão, mas quem vem bater o caixa vem olhar
   * o que saiu: é disso que se pede nota, e é isso que o fechamento cobra.
   */
  const [soSaidas, setSoSaidas] = useState(true);

  const extrato = useQuery({
    queryKey: ['caixa', 'extrato', caixaId, de, ate],
    queryFn: async () =>
      (
        await api.get<ExtratoDoCaixa>(`/caixa/${caixaId}/extrato`, {
          params: { de, ate },
        })
      ).data,
  });

  const chaveDoExtrato = ['caixa', 'extrato', caixaId, de, ate];

  function recarregar() {
    setErro(null);
    void qc.invalidateQueries({ queryKey: ['caixa', 'extrato'] });
  }

  /**
   * Marcar um lançamento mexe só naquele lançamento, no cache.
   *
   * Antes disto cada clique invalidava o extrato inteiro, e o extrato é uma
   * leitura do IXC: conferir os 52 do mês custava 52 releituras da conta lá,
   * com a tela piscando em cada uma. O servidor já guardou a marca — o que
   * falta é a tela concordar com ele.
   */
  function marcarNoCache(idLancamento: number, conferido: boolean) {
    setErro(null);
    qc.setQueryData<ExtratoDoCaixa>(chaveDoExtrato, (atual) => {
      if (!atual) return atual;
      const lancamentos = atual.lancamentos.map((l) =>
        l.id === idLancamento ? { ...l, conferido } : l,
      );
      const conferidos = lancamentos.filter((l) => l.conferido).length;
      const saidasConferidas = lancamentos.filter(
        (l) => l.tipo === 'SAIDA' && l.conferido,
      ).length;
      return {
        ...atual,
        lancamentos,
        resumo: { ...atual.resumo, conferidos, saidasConferidas },
      };
    });
  }

  /** A foto entrou ou saiu: mesma ideia, sem reler o IXC. */
  function marcarNotaNoCache(idLancamento: number, temNota: boolean) {
    setErro(null);
    qc.setQueryData<ExtratoDoCaixa>(chaveDoExtrato, (atual) =>
      atual
        ? {
            ...atual,
            lancamentos: atual.lancamentos.map((l) =>
              l.id === idLancamento ? { ...l, temNota } : l,
            ),
          }
        : atual,
    );
  }

  const fechar = useMutation({
    mutationFn: async (observacao: string) =>
      (await api.post('/caixa/fechar', { caixaId, de, ate, observacao })).data,
    onSuccess: recarregar,
    onError: (e) => setErro(mensagemErro(e)),
  });

  if (extrato.isLoading) return <Carregando texto="Lendo o caixa no IXC…" />;
  if (extrato.isError) {
    return <Aviso tom="erro">{mensagemErro(extrato.error)}</Aviso>;
  }
  if (!extrato.data) return null;

  const { lancamentos, naRua, resumo, fechamentos } = extrato.data;
  const faltam = resumo.qtdSaidas - resumo.saidasConferidas;
  const qtdSaidas = resumo.qtdSaidas;
  const qtdEntradas = lancamentos.length - qtdSaidas;
  const visiveis = soSaidas
    ? lancamentos.filter((l) => l.tipo === 'SAIDA')
    : lancamentos;
  /*
   * Duas áreas, e não uma coluna de marcados no meio da lista.
   *
   * A fila de cima é o que falta olhar; a de baixo, o que já passou. O que foi
   * revisado sai da frente em vez de virar uma linha apagada no meio das
   * outras — numa conferência de cinquenta saídas, achar a próxima é o gesto
   * que mais se repete, e ele fica mais curto a cada OK.
   */
  const aConferir = visiveis.filter((l) => !l.conferido);
  const revisados = visiveis.filter((l) => l.conferido);

  return (
    <>
      <div className="surgir surgir-1 mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Saídas do período"
          valor={formatBRL(resumo.saidas)}
          detalhe={qtdSaidas === 1 ? '1 saída' : `${qtdSaidas} saídas`}
          acento
        />
        <Indicador
          rotulo="Entradas"
          valor={formatBRL(resumo.entradas)}
          detalhe={
            qtdEntradas === 0
              ? 'nenhuma no período'
              : qtdEntradas === 1
                ? '1 entrada — reforço, devolução ou troco'
                : `${qtdEntradas} entradas — reforço, devolução ou troco`
          }
        />
        <Indicador
          rotulo="Saídas conferidas"
          valor={`${resumo.saidasConferidas} de ${qtdSaidas}`}
          detalhe={
            faltam > 0
              ? faltam === 1
                ? 'falta 1'
                : `faltam ${faltam}`
              : 'tudo conferido'
          }
          alerta={faltam > 0 ? 'Ainda há o que olhar' : undefined}
        />
        <Indicador
          rotulo="Na rua"
          valor={formatBRL(resumo.naRua)}
          detalhe={
            resumo.pessoasNaRua === 1
              ? 'com 1 pessoa'
              : `com ${resumo.pessoasNaRua} pessoas`
          }
          alerta={resumo.naRua > 0 ? 'Não está na gaveta' : undefined}
        />
      </div>

      <DinheiroNaRuaBloco
        caixaId={caixaId}
        itens={naRua}
        onMudou={recarregar}
      />

      <Bloco
        titulo={soSaidas ? 'Saídas a conferir' : 'Lançamentos a conferir'}
        semPadding
        className="surgir surgir-3"
        acao={
          <div className="flex items-center gap-3">
            {aConferir.length > 0 && (
              <span className="text-xs text-tinta-500">
                {aConferir.length === 1
                  ? 'falta 1'
                  : `faltam ${aConferir.length}`}
              </span>
            )}
            <button
              type="button"
              onClick={() => setSoSaidas((v) => !v)}
              className="btn btn-p btn-neutro"
              title="Os recebimentos entram no saldo, mas não é deles que se pede nota"
            >
              {soSaidas
                ? `Mostrar as ${qtdEntradas} entradas também`
                : 'Mostrar só as saídas'}
            </button>
          </div>
        }
      >
        {aConferir.length === 0 ? (
          <Vazio
            titulo={
              visiveis.length === 0
                ? soSaidas
                  ? 'Nenhuma saída neste período'
                  : 'Nenhum lançamento neste período'
                : 'Tudo conferido'
            }
          >
            {visiveis.length === 0
              ? soSaidas && qtdEntradas > 0
                ? `Houve ${qtdEntradas} entrada(s) — o botão acima mostra.`
                : 'Confira as datas, ou se este é mesmo o caixa do dinheiro em mãos.'
              : 'O fechamento fica logo abaixo, na lista dos revisados.'}
          </Vazio>
        ) : (
          <TabelaDeLancamentos
            caixaId={caixaId}
            itens={aConferir}
            revisados={false}
            onConferiu={marcarNoCache}
            onMudouNota={marcarNotaNoCache}
            onErro={setErro}
          />
        )}
      </Bloco>

      {erro && (
        <div className="mt-4">
          <Aviso tom="erro">{erro}</Aviso>
        </div>
      )}

      {/* O que já passou, e onde o período se fecha. */}
      <Bloco
        titulo="Revisados"
        semPadding
        className="surgir mt-5"
        acao={
          revisados.length > 0 ? (
            <Selo tom="pago">
              {revisados.length === 1
                ? '1 revisado'
                : `${revisados.length} revisados`}
            </Selo>
          ) : undefined
        }
      >
        {revisados.length > 0 && (
          <TabelaDeLancamentos
            caixaId={caixaId}
            itens={revisados}
            revisados
            onConferiu={marcarNoCache}
            onMudouNota={marcarNotaNoCache}
            onErro={setErro}
          />
        )}

        {revisados.length === 0 && qtdSaidas > 0 && (
          <Vazio titulo="Nada revisado ainda">
            Dê OK nas saídas acima; elas passam para cá, e é daqui que o período
            se fecha.
          </Vazio>
        )}

        {/* Semana sem saída nenhuma também se fecha: "olhei, não saiu nada" é
            uma conferência como outra qualquer, e sem isto o botão ficaria
            preso atrás de uma lista que nunca vai existir. */}
        {(revisados.length > 0 || qtdSaidas === 0) && (
          <Fechar
            faltam={faltam}
            naRua={resumo.naRua}
            semSaidas={qtdSaidas === 0}
            pendente={fechar.isPending}
            onFechar={(obs) => fechar.mutate(obs)}
          />
        )}
      </Bloco>

      {fechamentos.length > 0 && (
        <Bloco titulo="Fechamentos deste período" className="surgir mt-5">
          <ul className="lista-dividida">
            {fechamentos.map((f) => (
              <li key={f.id} className="py-2 text-sm">
                <span className="font-medium text-tinta-800">
                  {formatData(f.de)} a {formatData(f.ate)}
                </span>{' '}
                — {f.conferidos} lançamento(s), saídas de{' '}
                <span className="valor">{formatBRL(Number(f.totalSaidas))}</span>
                {Number(f.totalNaRua) > 0 && (
                  <>
                    , com{' '}
                    <span className="valor">
                      {formatBRL(Number(f.totalNaRua))}
                    </span>{' '}
                    ainda na rua
                  </>
                )}
                {f.observacao && (
                  <div className="text-xs text-tinta-400">{f.observacao}</div>
                )}
              </li>
            ))}
          </ul>
        </Bloco>
      )}
    </>
  );
}

/** A mesma tabela nas duas áreas: o que muda é a coluna da ação. */
function TabelaDeLancamentos({
  caixaId,
  itens,
  revisados,
  onConferiu,
  onMudouNota,
  onErro,
}: {
  caixaId: number;
  itens: LancamentoDoCaixa[];
  revisados: boolean;
  onConferiu: (id: number, conferido: boolean) => void;
  onMudouNota: (id: number, temNota: boolean) => void;
  onErro: (m: string) => void;
}) {
  return (
    <div className="overflow-x-auto rolagem-fina">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th">Data</th>
            <th className="th">Histórico</th>
            <th className="th text-right">Valor</th>
            <th className="th">Nota</th>
            <th className="th text-right">{revisados ? '' : 'Conferir'}</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((l) => (
            <LinhaDoLancamento
              key={l.id}
              caixaId={caixaId}
              lancamento={l}
              revisado={revisados}
              onConferiu={onConferiu}
              onMudouNota={onMudouNota}
              onErro={onErro}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LinhaDoLancamento({
  caixaId,
  lancamento: l,
  revisado,
  onConferiu,
  onMudouNota,
  onErro,
}: {
  caixaId: number;
  lancamento: LancamentoDoCaixa;
  revisado: boolean;
  onConferiu: (id: number, conferido: boolean) => void;
  onMudouNota: (id: number, temNota: boolean) => void;
  onErro: (m: string) => void;
}) {
  const [vendoNota, setVendoNota] = useState(false);

  const conferir = useMutation({
    mutationFn: async (conferido: boolean) => {
      await api.put(`/caixa/${caixaId}/lancamentos/${l.id}/conferir`, {
        conferido,
      });
      return conferido;
    },
    onSuccess: (conferido) => onConferiu(l.id, conferido),
    onError: (e) => onErro(mensagemErro(e)),
  });

  const salvarNota = useMutation({
    mutationFn: async (notaFoto: string | null) => {
      await api.put(`/caixa/${caixaId}/lancamentos/${l.id}/nota`, { notaFoto });
      return notaFoto;
    },
    onSuccess: (notaFoto) => onMudouNota(l.id, !!notaFoto),
    onError: (e) => onErro(mensagemErro(e)),
  });

  return (
    <>
      <tr className="linha">
        <td className="td num whitespace-nowrap">{formatData(l.data)}</td>
        <td className="td">
          {l.historico || <span className="text-tinta-400">sem histórico</span>}
          {l.tipo === 'ENTRADA' && (
            <Selo pequeno tom="pago">
              entrada
            </Selo>
          )}
        </td>
        <td className="td whitespace-nowrap text-right">
          <span className="valor">{formatBRL(l.valor)}</span>
        </td>
        <td className="td">
          <EscolherNota
            temNota={l.temNota}
            pendente={salvarNota.isPending}
            onEscolher={(dataUrl) => salvarNota.mutate(dataUrl)}
            onVer={() => setVendoNota(true)}
            onTirar={() => salvarNota.mutate(null)}
            onErro={onErro}
          />
        </td>
        <td className="td text-right">
          {revisado ? (
            /* Desfazer: um OK dado por engano tem de ter volta, ou a
               conferência vira uma armadilha de um clique. */
            <button
              type="button"
              onClick={() => conferir.mutate(false)}
              disabled={conferir.isPending}
              className="btn btn-p btn-sutil"
              title="Devolve este lançamento para a lista de cima"
            >
              Desfazer
            </button>
          ) : (
            <button
              type="button"
              onClick={() => conferir.mutate(true)}
              disabled={conferir.isPending}
              className="btn btn-p btn-pagar"
              title="Confere este lançamento e manda para os revisados"
            >
              {conferir.isPending ? '…' : 'OK'}
            </button>
          )}
        </td>
      </tr>
      {vendoNota && (
        <tr>
          <td colSpan={5} className="bg-tinta-50/80 px-4 pb-4">
            <VerNota
              url={`/caixa/${caixaId}/lancamentos/${l.id}/nota`}
              onFechar={() => setVendoNota(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/** O botão de anexar/ver/tirar a foto, com a redução feita antes do envio. */
function EscolherNota({
  temNota,
  pendente,
  onEscolher,
  onVer,
  onTirar,
  onErro,
}: {
  temNota: boolean;
  pendente: boolean;
  onEscolher: (dataUrl: string) => void;
  onVer: () => void;
  onTirar: () => void;
  onErro: (m: string) => void;
}) {
  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    // O input é limpo sempre: sem isso, escolher a mesma foto de novo depois de
    // um erro não dispara evento nenhum.
    e.target.value = '';
    if (!arquivo) return;
    try {
      onEscolher(await reduzirFoto(arquivo));
    } catch (err) {
      onErro(err instanceof Error ? err.message : String(err));
    }
  }

  if (temNota) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onVer} className="btn btn-p btn-ferramenta">
          Ver nota
        </button>
        <button
          type="button"
          onClick={onTirar}
          disabled={pendente}
          className="btn btn-p btn-sutil"
          title="Tira a foto que está guardada aqui"
        >
          Tirar
        </button>
      </div>
    );
  }

  return (
    <label
      className="btn btn-p btn-neutro w-fit cursor-pointer"
      title="Fotografe a nota ou escolha uma imagem já salva"
    >
      {pendente ? 'Enviando…' : 'Anexar nota'}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={aoEscolher}
      />
    </label>
  );
}

/** A foto vem sob demanda: ela não trafega na listagem. */
function VerNota({ url, onFechar }: { url: string; onFechar: () => void }) {
  const nota = useQuery({
    queryKey: ['caixa', 'nota', url],
    queryFn: async () =>
      (await api.get<{ notaFoto: string | null }>(url)).data,
  });

  return (
    <div className="pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="rotulo mb-0">Nota anexada</span>
        <button type="button" onClick={onFechar} className="btn btn-p btn-sutil">
          Fechar
        </button>
      </div>
      {nota.isLoading && <Carregando texto="Abrindo a foto…" />}
      {nota.data?.notaFoto ? (
        <img
          src={nota.data.notaFoto}
          alt="Foto da nota"
          className="max-h-[28rem] rounded-xl border border-tinta-200"
        />
      ) : (
        !nota.isLoading && <p className="ajuda">A foto não está mais aqui.</p>
      )}
    </div>
  );
}

/**
 * O dinheiro que saiu com alguém.
 *
 * Fica acima da lista de lançamentos de propósito: é o valor que explica a
 * diferença entre o que a soma diz e o que existe na gaveta, e quem bate o
 * caixa precisa vê-lo antes de começar a riscar linha.
 */
function DinheiroNaRuaBloco({
  caixaId,
  itens,
  onMudou,
}: {
  caixaId: number;
  itens: DinheiroNaRua[];
  onMudou: () => void;
}) {
  const [pessoa, setPessoa] = useState('');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [prestando, setPrestando] = useState<DinheiroNaRua | null>(null);

  const entregar = useMutation({
    mutationFn: async () =>
      api.post('/caixa/dinheiro-na-rua', {
        caixaId,
        pessoa,
        valor: Number(valor),
        motivo: motivo || undefined,
      }),
    onSuccess: () => {
      setPessoa('');
      setValor('');
      setMotivo('');
      setErro(null);
      onMudou();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const apagar = useMutation({
    mutationFn: async (id: string) => api.delete(`/caixa/dinheiro-na-rua/${id}`),
    onSuccess: onMudou,
    onError: (e) => setErro(mensagemErro(e)),
  });

  const total = useMemo(
    () => itens.reduce((s, i) => s + Number(i.valor), 0),
    [itens],
  );
  const podeEntregar = pessoa.trim().length >= 2 && Number(valor) > 0;

  return (
    <Bloco
      titulo="Dinheiro na rua"
      className="surgir surgir-2 mb-5"
      acao={
        total > 0 ? (
          <Selo tom="atencao">{formatBRL(total)} fora da gaveta</Selo>
        ) : undefined
      }
    >
      <p className="ajuda mb-3">
        O que saiu com alguém para pagar algo na rua e ainda não voltou. Enquanto
        estiver aqui, o valor não está na gaveta nem virou despesa — é ele que
        faz a contagem bater.
      </p>

      {itens.length > 0 && (
        <ul className="lista-dividida mb-4">
          {itens.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <span className="font-medium text-tinta-800">{i.pessoa}</span>{' '}
                <span className="valor">{formatBRL(Number(i.valor))}</span>
                <span className="ml-2 text-xs text-tinta-400">
                  desde {formatData(i.entregueEm)}
                </span>
                {i.motivo && (
                  <div className="text-xs text-tinta-400">{i.motivo}</div>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setPrestando(i)}
                  className="btn btn-p btn-primario"
                  title="Registrar a nota que a pessoa trouxe e o troco"
                >
                  Prestar contas
                </button>
                <button
                  type="button"
                  onClick={() => apagar.mutate(i.id)}
                  disabled={apagar.isPending}
                  className="btn btn-p btn-sutil"
                  title="Lançado por engano"
                >
                  Apagar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-1">
          <label className="rotulo" htmlFor="pessoa">
            Com quem está
          </label>
          <input
            id="pessoa"
            value={pessoa}
            onChange={(e) => setPessoa(e.target.value)}
            placeholder="Ex.: Jeferson"
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="valor-rua">
            Quanto levou
          </label>
          <CampoDinheiro valor={valor} onChange={setValor} />
        </div>
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="motivo">
            Para quê
          </label>
          <div className="flex gap-2">
            <input
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="opcional — peça de reposição, combustível…"
              className="campo flex-1"
            />
            <button
              type="button"
              onClick={() => entregar.mutate()}
              disabled={!podeEntregar || entregar.isPending}
              className="btn btn-primario shrink-0"
            >
              {entregar.isPending ? 'Anotando…' : 'Anotar saída'}
            </button>
          </div>
        </div>
      </div>

      {erro && <p className="mt-3 text-sm text-rose-600">{erro}</p>}

      {prestando && (
        <PrestarContas
          entrega={prestando}
          onPronto={() => {
            setPrestando(null);
            onMudou();
          }}
          onFechar={() => setPrestando(null)}
        />
      )}
    </Bloco>
  );
}

/**
 * A volta do dinheiro: quanto virou nota, quanto voltou de troco.
 *
 * A soma dos dois tem de bater com o que saiu, e a tela diz a diferença
 * enquanto se digita — o servidor recusa de todo jeito, mas descobrir isso
 * depois de enviar é o que faz a pessoa desistir de usar.
 */
function PrestarContas({
  entrega,
  onPronto,
  onFechar,
}: {
  entrega: DinheiroNaRua;
  onPronto: () => void;
  onFechar: () => void;
}) {
  const [gasto, setGasto] = useState('');
  const [troco, setTroco] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const saiu = Number(entrega.valor);
  const soma = (Number(gasto) || 0) + (Number(troco) || 0);
  const diferenca = Math.round((soma - saiu) * 100) / 100;
  const fecha = Math.abs(diferenca) < 0.005 && Number(gasto) >= 0;

  const baixar = useMutation({
    mutationFn: async () =>
      api.post(`/caixa/dinheiro-na-rua/${entrega.id}/baixar`, {
        valorGasto: Number(gasto) || 0,
        troco: Number(troco) || 0,
        notaFoto: foto ?? undefined,
        observacao: observacao || undefined,
      }),
    onSuccess: onPronto,
    onError: (e) => setErro(mensagemErro(e)),
  });

  return (
    <div className="mt-4 rounded-2xl border border-brand-500/30 bg-brand-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold text-tinta-800">
          Prestação de contas — {entrega.pessoa},{' '}
          <span className="valor">{formatBRL(saiu)}</span>
        </p>
        <button type="button" onClick={onFechar} className="btn btn-p btn-sutil">
          Fechar
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="rotulo">Valor da nota</label>
          <CampoDinheiro valor={gasto} onChange={setGasto} />
        </div>
        <div>
          <label className="rotulo">Troco devolvido</label>
          <CampoDinheiro valor={troco} onChange={setTroco} />
        </div>
        <div>
          <label className="rotulo">Foto da nota</label>
          {foto ? (
            <div className="flex items-center gap-2">
              <img
                src={foto}
                alt="Nota"
                className="h-[42px] w-16 rounded-lg border border-tinta-200 object-cover"
              />
              <button
                type="button"
                onClick={() => setFoto(null)}
                className="btn btn-p btn-sutil"
              >
                Trocar
              </button>
            </div>
          ) : (
            <label className="btn btn-neutro w-fit cursor-pointer">
              Anexar foto
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const arquivo = e.target.files?.[0];
                  e.target.value = '';
                  if (!arquivo) return;
                  try {
                    setFoto(await reduzirFoto(arquivo));
                    setErro(null);
                  } catch (err) {
                    setErro(err instanceof Error ? err.message : String(err));
                  }
                }}
              />
            </label>
          )}
        </div>
      </div>

      <div className="mt-3">
        <label className="rotulo" htmlFor="obs-prestacao">
          Observação
        </label>
        <input
          id="obs-prestacao"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          className="campo"
          placeholder="opcional"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => baixar.mutate()}
          disabled={!fecha || baixar.isPending}
          className="btn btn-primario"
        >
          {baixar.isPending ? 'Registrando…' : 'Dar baixa'}
        </button>
        {fecha ? (
          <Selo tom="pago">A conta fecha</Selo>
        ) : (
          <span className="text-sm text-tinta-500">
            Nota + troco somam{' '}
            <span className="valor">{formatBRL(soma)}</span>;{' '}
            {diferenca > 0 ? (
              <>
                é <span className="valor">{formatBRL(diferenca)}</span> a mais do
                que saiu
              </>
            ) : (
              <>
                faltam <span className="valor">{formatBRL(-diferenca)}</span>
              </>
            )}
          </span>
        )}
      </div>

      {erro && <p className="mt-2 text-sm text-rose-600">{erro}</p>}
    </div>
  );
}

function Fechar({
  faltam,
  naRua,
  semSaidas,
  pendente,
  onFechar,
}: {
  faltam: number;
  naRua: number;
  /** Período sem saída nenhuma: não há o que conferir, e ainda assim fecha. */
  semSaidas: boolean;
  pendente: boolean;
  onFechar: (observacao: string) => void;
}) {
  const [observacao, setObservacao] = useState('');

  return (
    /* Sem cartão próprio: ele já vive dentro do cartão dos revisados, e um
       cartão dentro do outro só empurraria o botão para longe da lista que o
       habilita. */
    <div className="border-t border-tinta-200 px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="rotulo" htmlFor="obs-fechamento">
            Observação do fechamento
          </label>
          <input
            id="obs-fechamento"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
            placeholder="opcional — o que explica este período"
          />
        </div>
        <button
          type="button"
          onClick={() => onFechar(observacao)}
          disabled={faltam > 0 || pendente}
          className="btn btn-acao shrink-0"
          title={
            faltam > 0
              ? 'Confira todos os lançamentos antes de fechar'
              : 'Guarda os números deste período'
          }
        >
          {pendente ? 'Fechando…' : 'Dar o período por conferido'}
        </button>
      </div>

      <p className="ajuda mt-2">
        {faltam > 0 ? (
          <>
            {faltam === 1 ? 'Falta 1 saída' : `Faltam ${faltam} saídas`} por
            conferir. O fechamento diz "olhei tudo" — por isso ele espera. Os
            recebimentos entram no saldo, mas não seguram o fechamento.
          </>
        ) : semSaidas ? (
          'Nenhuma saída no período — dá para fechar assim mesmo.'
        ) : naRua > 0 ? (
          <>
            Fecha com <strong>{formatBRL(naRua)}</strong> ainda na rua. Isso não
            impede: o valor fica registrado no fechamento como parte da
            explicação.
          </>
        ) : (
          'Tudo conferido e nada na rua.'
        )}
      </p>
    </div>
  );
}
