import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import {
  Aviso,
  Bloco,
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
  ConciliacaoDaConta,
  ContaConciliavel,
  LinhaDaConciliacao,
  ResultadoDoPagamento,
  TituloCandidato,
  TransacaoExtrato,
} from '../../lib/types';

/**
 * Conciliação bancária: o extrato do banco de um lado, a movimentação do IXC do
 * outro.
 *
 * A tela é feita para o jeito como isto já é feito — de cima para baixo, dia a
 * dia, contra o extrato aberto na outra janela. O que ela muda é o trabalho
 * braçal: com o .ofx do banco arrastado aqui, o que bate já vem batido e sobra
 * na tela só o que precisa de gente.
 *
 * Três estados convivem em cada linha, e a tela não os mistura:
 *
 * - **conciliado no IXC** — veio de lá marcado. É leitura; nada a fazer;
 * - **conferido aqui** — marcado nesta tela. Fica gravado deste lado, porque o
 *   webservice do IXC não recebe essa marca (o PUT ignora o campo e ainda apaga
 *   o resto da linha — está provado em `conciliacao.service.ts`);
 * - **pendente** — ninguém conferiu ainda.
 *
 * A saída do extrato que não tem lançamento nenhum no IXC é o achado que
 * justifica a tela: dali dá para achar o título em aberto e dar a baixa na
 * conta certa, sem sair daqui.
 */

/** O recorte da lista. */
type Recorte = 'pendentes' | 'todas' | 'fechadas' | 'so-no-ixc';

/** O lado do dinheiro. */
type Fluxo = 'tudo' | 'saidas' | 'entradas';

export function Conciliacao() {
  const queryClient = useQueryClient();
  const [contaId, setContaId] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState(mesAtual);
  const [recorte, setRecorte] = useState<Recorte>('pendentes');
  const [fluxo, setFluxo] = useState<Fluxo>('tudo');
  const [busca, setBusca] = useState('');
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set());
  /** O extrato importado: fica no navegador e sobe junto com cada leitura. */
  const [extrato, setExtrato] = useState<{ nome: string; texto: string } | null>(
    null,
  );
  /** A transação do banco para a qual estamos procurando um título em aberto. */
  const [procurando, setProcurando] = useState<TransacaoExtrato | null>(null);
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null);

  const contas = useQuery({
    queryKey: ['conciliacao-contas'],
    queryFn: async () =>
      (await api.get<ContaConciliavel[]>('/contas-abertas/conciliacao/contas'))
        .data,
  });

  // A primeira conta da lista é uma das que pagam as contas da empresa — o
  // serviço já as põe na frente. Escolher sozinho evita a tela vazia de
  // abertura, que faria todo mundo clicar no mesmo lugar toda vez.
  const conta = contaId ?? contas.data?.find((c) => c.ativa)?.id ?? null;

  const chaveDoExtrato = extrato ? `${extrato.nome}:${extrato.texto.length}` : '';
  const conciliacao = useQuery({
    queryKey: ['conciliacao', conta, periodo.de, periodo.ate, chaveDoExtrato],
    enabled: conta !== null,
    // O IXC leva o tempo que leva, e quando ele não responde costuma demorar
    // 30 segundos até estourar — repetir por baixo dobraria a espera.
    retry: 0,
    queryFn: async () =>
      (
        await api.post<ConciliacaoDaConta>('/contas-abertas/conciliacao/ver', {
          conta,
          de: periodo.de,
          ate: periodo.ate,
          ofx: extrato?.texto,
        })
      ).data,
  });

  /** Marca (ou desmarca) linhas sem reler o IXC: a resposta é imediata. */
  function aplicarNaTela(
    ids: number[],
    conferida: LinhaDaConciliacao['conferida'],
  ) {
    queryClient.setQueryData<ConciliacaoDaConta>(
      ['conciliacao', conta, periodo.de, periodo.ate, chaveDoExtrato],
      (antes) =>
        antes && {
          ...antes,
          linhas: antes.linhas.map((l) =>
            ids.includes(l.id) ? { ...l, conferida } : l,
          ),
          resumo: recontar(antes.linhas, ids, conferida),
        },
    );
  }

  const conferir = useMutation({
    mutationFn: async (linhas: LinhaDaConciliacao[]) => {
      await api.post('/contas-abertas/conciliacao/conferir', {
        conta,
        linhas: linhas.map((l) => ({
          id: l.id,
          data: l.data,
          valor: l.valor,
          fitId: l.extrato?.fitId,
        })),
      });
      return linhas;
    },
    onSuccess: (linhas) => {
      aplicarNaTela(
        linhas.map((l) => l.id),
        {
          em: new Date().toISOString(),
          por: null,
          origem: linhas.some((l) => l.extrato) ? 'EXTRATO' : 'MANUAL',
          fitId: null,
        },
      );
      setMarcadas(new Set());
    },
  });

  const desconferir = useMutation({
    mutationFn: async (ids: number[]) => {
      await api.post('/contas-abertas/conciliacao/desconferir', { ids });
      return ids;
    },
    onSuccess: (ids) => {
      aplicarNaTela(ids, null);
      setMarcadas(new Set());
    },
  });

  const dados = conciliacao.data;
  const linhas = useMemo(
    () => filtrar(dados?.linhas ?? [], recorte, fluxo, busca),
    [dados, recorte, fluxo, busca],
  );
  const porDia = useMemo(() => agruparPorDia(linhas), [linhas]);

  /** O que o extrato casou e ninguém conferiu ainda — o botão de um clique só. */
  const prontasParaConferir = (dados?.linhas ?? []).filter(
    (l) => l.extrato && !l.conferida && !l.conciliadoNoIxc,
  );

  const selecionadas = (dados?.linhas ?? []).filter((l) => marcadas.has(l.id));

  async function escolherArquivo(arquivo: File | null) {
    if (!arquivo) return;
    setErroDoArquivo(null);
    try {
      setExtrato({ nome: arquivo.name, texto: await lerArquivo(arquivo) });
      // Com extrato na mão o que interessa é o que sobrou dos dois lados.
      setRecorte('pendentes');
    } catch (err) {
      setErroDoArquivo(mensagemErro(err));
    }
  }

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contas a Pagar"
        titulo="Conciliação bancária"
        descricao="O extrato do banco contra a movimentação do IXC, conta por conta. O que já está conciliado no IXC vem marcado de lá; o que você conferir aqui fica guardado aqui."
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            <ImportarExtrato
              extrato={extrato}
              onEscolher={escolherArquivo}
              onLimpar={() => setExtrato(null)}
            />
            <button
              onClick={() => conciliacao.refetch()}
              disabled={conciliacao.isFetching || conta === null}
              className="btn btn-acao"
            >
              {conciliacao.isFetching ? 'Lendo o IXC…' : 'Atualizar'}
            </button>
          </div>
        }
      />

      <SeletorDeConta
        contas={contas.data ?? []}
        escolhida={conta}
        onEscolher={(id) => {
          setContaId(id);
          setMarcadas(new Set());
        }}
      />

      <SeletorDePeriodo
        periodo={periodo}
        onEscolher={(p) => {
          setPeriodo(p);
          setMarcadas(new Set());
        }}
      />

      {erroDoArquivo && <Aviso tom="erro">{erroDoArquivo}</Aviso>}
      {conciliacao.isError && (
        <Aviso tom="erro">{mensagemErro(conciliacao.error)}</Aviso>
      )}
      {conferir.isError && <Aviso tom="erro">{mensagemErro(conferir.error)}</Aviso>}
      {(dados?.avisos ?? []).map((aviso) => (
        <Aviso key={aviso} tom="atencao">
          {aviso}
        </Aviso>
      ))}

      {dados && <Resumo dados={dados} />}

      {dados?.extrato && dados.extrato.soNoBanco.length > 0 && (
        <SoNoBanco
          transacoes={dados.extrato.soNoBanco}
          onAchar={setProcurando}
        />
      )}

      {conciliacao.isLoading ? (
        <Bloco>
          <Carregando texto="Lendo a movimentação no IXC…" />
        </Bloco>
      ) : !dados ? null : (
        <>
          {marcadas.size > 0 && (
            <div className="surgir barra-selecao mb-4">
              <span className="barra-selecao-titulo">
                {marcadas.size} linha(s) marcada(s)
              </span>
              <span className="num opacity-80">
                {formatBRL(
                  selecionadas.reduce((s, l) => s + Math.abs(l.valor), 0),
                )}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  onClick={() => conferir.mutate(selecionadas)}
                  disabled={conferir.isPending}
                  className="btn btn-pagar btn-p"
                >
                  {conferir.isPending ? 'Conferindo…' : 'Conferir'}
                </button>
                <button
                  onClick={() => desconferir.mutate([...marcadas])}
                  disabled={desconferir.isPending}
                  className="btn btn-neutro btn-p"
                >
                  Desfazer conferência
                </button>
                <button
                  onClick={() => setMarcadas(new Set())}
                  className="btn btn-sutil btn-p text-white/80 hover:bg-white/10 hover:text-white"
                >
                  Limpar
                </button>
              </div>
            </div>
          )}

          <div className="surgir card overflow-hidden">
            <Filtros
              recorte={recorte}
              onRecorte={setRecorte}
              fluxo={fluxo}
              onFluxo={setFluxo}
              busca={busca}
              onBusca={setBusca}
              temExtrato={dados.extrato !== null}
              mostrando={linhas.length}
              total={dados.linhas.length}
              prontas={prontasParaConferir.length}
              onConferirQueBateram={() =>
                conferir.mutate(prontasParaConferir)
              }
              conferindo={conferir.isPending}
            />

            {linhas.length === 0 ? (
              <Vazio titulo="Nada aqui">
                {dados.linhas.length === 0
                  ? 'Esta conta não teve movimento no período escolhido.'
                  : 'Nenhuma linha bate com o filtro. Tente "Todas".'}
              </Vazio>
            ) : (
              /* Uma tabela só, com um `tbody` por dia: as colunas precisam
                 ficar alinhadas de ponta a ponta. Uma tabela por dia deixava a
                 coluna do valor dançando de um dia para o outro, que é
                 justamente o que atrapalha quem confere de cima para baixo. */
              <div className="overflow-x-auto rolagem-fina">
                <table className="w-full text-sm">
                  {porDia.map((dia) => (
                    <Dia
                      key={dia.data}
                      dia={dia}
                      marcadas={marcadas}
                      onAlternar={(id) =>
                        setMarcadas((antes) => alternar(antes, id))
                      }
                      onAlternarDia={(ids, marcar) =>
                        setMarcadas((antes) => {
                          const novo = new Set(antes);
                          for (const id of ids) {
                            if (marcar) novo.add(id);
                            else novo.delete(id);
                          }
                          return novo;
                        })
                      }
                    />
                  ))}
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {procurando && conta !== null && (
        <AcharTitulo
          transacao={procurando}
          conta={conta}
          onFechar={() => setProcurando(null)}
          onBaixou={() => {
            setProcurando(null);
            void conciliacao.refetch();
          }}
        />
      )}
    </Pagina>
  );
}

/** Os cartões de cima: o estado da conta no período, em cinco números. */
function Resumo({ dados }: { dados: ConciliacaoDaConta }) {
  const { resumo, extrato } = dados;
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Indicador
        acento
        rotulo="Falta conferir"
        valor={resumo.pendentes}
        detalhe={`de ${resumo.linhas} lançamento(s) no período`}
      />
      <Indicador
        rotulo="Já conferido"
        valor={resumo.fechadas}
        detalhe="conciliado no IXC ou conferido aqui"
      />
      <Indicador
        rotulo="Saiu da conta"
        valor={formatBRL(resumo.saidas)}
        detalhe={
          extrato
            ? `no extrato do banco: ${formatBRL(extrato.saidas)}`
            : 'segundo o IXC'
        }
        alerta={
          extrato && diferente(extrato.saidas, resumo.saidas)
            ? `diferença de ${formatBRL(Math.abs(extrato.saidas - resumo.saidas))}`
            : undefined
        }
      />
      <Indicador
        rotulo="Entrou na conta"
        valor={formatBRL(resumo.entradas)}
        detalhe={
          extrato
            ? `no extrato do banco: ${formatBRL(extrato.entradas)}`
            : 'segundo o IXC'
        }
        alerta={
          extrato && diferente(extrato.entradas, resumo.entradas)
            ? `diferença de ${formatBRL(Math.abs(extrato.entradas - resumo.entradas))}`
            : undefined
        }
      />
      {extrato && (
        <div className="sm:col-span-2 xl:col-span-4">
          <Aviso tom={extrato.soNoBanco.length > 0 ? 'atencao' : 'pago'}>
            Extrato lido: <strong className="num">{extrato.transacoes}</strong>{' '}
            transação(ões)
            {extrato.de && extrato.ate && (
              <>
                {' '}
                de {formatData(extrato.de)} a {formatData(extrato.ate)}
              </>
            )}
            {extrato.saldo !== null && (
              <>
                {' '}
                · saldo do banco em {formatData(extrato.saldoEm)}:{' '}
                <strong className="num">{formatBRL(extrato.saldo)}</strong>
              </>
            )}
            {extrato.soNoBanco.length > 0 && (
              <>
                {' '}
                ·{' '}
                <strong>
                  {extrato.soNoBanco.length} não achou par no IXC
                </strong>
              </>
            )}
          </Aviso>
        </div>
      )}
    </div>
  );
}

/**
 * O que saiu (ou entrou) no banco e não existe no IXC.
 *
 * É a lista que justifica a tela: aqui estão as saídas que ninguém lançou. Para
 * cada uma dá para achar o título em aberto e baixá-lo na conta certa.
 */
function SoNoBanco({
  transacoes,
  onAchar,
}: {
  transacoes: TransacaoExtrato[];
  onAchar: (t: TransacaoExtrato) => void;
}) {
  return (
    <Bloco
      titulo={`No banco e não no IXC (${transacoes.length})`}
      className="mb-5"
      semPadding
    >
      <div className="overflow-x-auto rolagem-fina">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Dia</th>
              <th className="th">O que o banco escreveu</th>
              <th className="th text-right">Valor</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {transacoes.map((t) => (
              <tr key={t.fitId} className="linha">
                <td className="td num whitespace-nowrap">{formatData(t.data)}</td>
                <td className="td">
                  <div className="text-tinta-800">{t.descricao || '—'}</div>
                  {t.documento && (
                    <div className="num text-xs text-tinta-400">
                      doc. {t.documento}
                    </div>
                  )}
                </td>
                <td className="td whitespace-nowrap text-right">
                  <span className={t.valor < 0 ? 'valor text-rose-600 dark:text-rose-300' : 'valor text-emerald-700 dark:text-emerald-300'}>
                    {formatBRL(t.valor)}
                  </span>
                </td>
                <td className="td text-right">
                  {t.valor < 0 ? (
                    <button
                      onClick={() => onAchar(t)}
                      className="btn btn-neutro btn-p"
                    >
                      Achar título
                    </button>
                  ) : (
                    <span
                      className="text-xs text-tinta-400"
                      title="Entrada de dinheiro é do contas a receber, que não se lança por aqui."
                    >
                      recebimento
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Bloco>
  );
}

/**
 * Achar o título em aberto que a saída do extrato pagou, e baixá-lo.
 *
 * A busca começa pelo valor, que é o que o banco e o título têm igual. Quando
 * não acha — pagamento com juros, com desconto, ou vários títulos num PIX só —
 * sobra procurar pelo nome do fornecedor.
 */
function AcharTitulo({
  transacao,
  conta,
  onFechar,
  onBaixou,
}: {
  transacao: TransacaoExtrato;
  conta: number;
  onFechar: () => void;
  onBaixou: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [porValor, setPorValor] = useState(true);
  /**
   * O que o IXC respondeu à baixa. A janela não fecha sozinha ao dar certo: o
   * pagamento pode ter saído **com ressalva** — o IXC recusa a resposta e grava
   * assim mesmo —, e quem clicou precisa ler isso antes de a tela virar.
   */
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
        await api.post<ResultadoDoPagamento>(
          '/contas-abertas/conciliacao/baixar',
          { idFnApagar, conta, data: transacao.data },
        )
      ).data,
    onSuccess: setFeito,
  });

  // Depois da baixa a janela vira recibo: o que saiu, e o que o IXC ressalvou.
  if (feito) {
    return (
      <Janela titulo="Baixa feita no IXC" onFechar={onBaixou}>
        <Aviso tom={feito.paga ? 'pago' : 'atencao'}>
          {feito.paga ? (
            <>
              O título nº <strong className="num">{feito.idFnApagar}</strong>{' '}
              está quitado no IXC:{' '}
              <strong className="num">{formatBRL(feito.valor)}</strong> na data
              do extrato ({formatData(transacao.data)}).
            </>
          ) : (
            <>
              O título nº <strong className="num">{feito.idFnApagar}</strong> foi
              aprovado, mas o IXC ainda não o mostra como quitado. Confira por
              lá antes de tentar de novo — pagar duas vezes tira o dinheiro
              duas vezes.
            </>
          )}
        </Aviso>

        {feito.avisos.map((aviso) => (
          <Aviso key={aviso} tom="atencao">
            {aviso}
          </Aviso>
        ))}

        <p className="text-sm text-tinta-500">
          O lançamento aparece nesta conciliação assim que a tela reler o IXC —
          é o que acontece ao fechar esta janela.
        </p>
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
          Talvez o pagamento tenha juros ou desconto, ou tenha quitado mais de
          um título. Procure pelo nome do fornecedor.
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

/** Um dia do extrato: o cabeçalho com os totais e as linhas embaixo. */
function Dia({
  dia,
  marcadas,
  onAlternar,
  onAlternarDia,
}: {
  dia: DiaDaConciliacao;
  marcadas: Set<number>;
  onAlternar: (id: number) => void;
  onAlternarDia: (ids: number[], marcar: boolean) => void;
}) {
  const ids = dia.linhas.map((l) => l.id);
  const todasMarcadas = ids.every((id) => marcadas.has(id));

  return (
    <tbody>
      <tr>
        <td colSpan={4} className="bg-tinta-50/60 px-4 py-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="opcao">
              <input
                type="checkbox"
                className="accent-brand-600"
                checked={todasMarcadas}
                onChange={() => onAlternarDia(ids, !todasMarcadas)}
              />
              <strong className="num text-tinta-700">
                {formatData(dia.data)}
              </strong>
            </label>
            <span className="num text-tinta-400">
              {dia.linhas.length} lançamento(s)
            </span>
            {dia.entradas > 0 && (
              <span className="num text-emerald-700 dark:text-emerald-300">
                + {formatBRL(dia.entradas)}
              </span>
            )}
            {dia.saidas > 0 && (
              <span className="num text-rose-600 dark:text-rose-300">
                − {formatBRL(dia.saidas)}
              </span>
            )}
          </div>
        </td>
      </tr>
      {dia.linhas.map((linha) => (
        <Linha
          key={linha.id}
          linha={linha}
          marcada={marcadas.has(linha.id)}
          onAlternar={() => onAlternar(linha.id)}
        />
      ))}
    </tbody>
  );
}

function Linha({
  linha,
  marcada,
  onAlternar,
}: {
  linha: LinhaDaConciliacao;
  marcada: boolean;
  onAlternar: () => void;
}) {
  const saida = linha.valor < 0;
  return (
    <tr className={`linha ${marcada ? 'linha-marcada' : ''}`}>
      <td className="td w-10">
        <input
          type="checkbox"
          className="accent-brand-600"
          checked={marcada}
          onChange={onAlternar}
          aria-label={`Marcar ${linha.historico}`}
        />
      </td>
      <td className="td">
        <div className="text-tinta-800">{linha.historico || '—'}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-tinta-400">
          {linha.titulo && (
            <span className="num">
              título nº {linha.titulo.idFnApagar}
              {linha.titulo.beneficiario && ` · ${linha.titulo.beneficiario}`}
            </span>
          )}
          {linha.documento && <span className="num">doc. {linha.documento}</span>}
          {linha.extrato && (
            <span
              title={`No banco: ${linha.extrato.descricao || 'sem descrição'}`}
              className="text-tinta-500"
            >
              banco:{' '}
              {linha.extrato.diasDeDiferenca === 0
                ? 'mesmo dia'
                : `${formatData(linha.extrato.data)} (${linha.extrato.diasDeDiferenca} dia(s) de diferença)`}
            </span>
          )}
        </div>
      </td>
      <td className="td whitespace-nowrap">
        <Estado linha={linha} />
      </td>
      <td className="td whitespace-nowrap text-right">
        <span
          className={`valor ${
            saida
              ? 'text-rose-600 dark:text-rose-300'
              : 'text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {formatBRL(linha.valor)}
        </span>
      </td>
    </tr>
  );
}

/** O estado da linha, em um selo só — e cada um diz de onde a marca veio. */
function Estado({ linha }: { linha: LinhaDaConciliacao }) {
  if (linha.conciliadoNoIxc) {
    return (
      <Selo tom="pago" titulo="Já está conciliada na tela do IXC.">
        conciliado no IXC
      </Selo>
    );
  }
  if (linha.conferida) {
    return (
      <Selo
        tom="marca"
        titulo={`Conferida aqui em ${formatData(linha.conferida.em)}${
          linha.conferida.por ? ` por ${linha.conferida.por}` : ''
        }. No IXC ela continua marcada como não conciliada — o webservice não recebe essa marca.`}
      >
        conferido aqui
      </Selo>
    );
  }
  if (linha.extrato) {
    return (
      <Selo
        tom="info"
        titulo={
          linha.extrato.como === 'documento'
            ? 'Bateu pelo número do documento — é o casamento mais seguro.'
            : linha.extrato.como === 'exato'
              ? 'Mesmo valor, mesmo dia.'
              : 'Mesmo valor, com alguns dias de diferença. Confira antes.'
        }
      >
        bateu com o extrato
      </Selo>
    );
  }
  return <Selo tom="neutro">pendente</Selo>;
}

/** A barra de filtros da lista. */
function Filtros({
  recorte,
  onRecorte,
  fluxo,
  onFluxo,
  busca,
  onBusca,
  temExtrato,
  mostrando,
  total,
  prontas,
  onConferirQueBateram,
  conferindo,
}: {
  recorte: Recorte;
  onRecorte: (r: Recorte) => void;
  fluxo: Fluxo;
  onFluxo: (f: Fluxo) => void;
  busca: string;
  onBusca: (b: string) => void;
  temExtrato: boolean;
  mostrando: number;
  total: number;
  prontas: number;
  onConferirQueBateram: () => void;
  conferindo: boolean;
}) {
  const recortes: Array<{ id: Recorte; label: string; titulo: string }> = [
    { id: 'pendentes', label: 'Falta conferir', titulo: 'O que ninguém conciliou ainda' },
    { id: 'todas', label: 'Todas', titulo: 'Tudo que passou na conta' },
    { id: 'fechadas', label: 'Conferidas', titulo: 'Conciliadas no IXC ou aqui' },
    ...(temExtrato
      ? [
          {
            id: 'so-no-ixc' as const,
            label: 'Não veio no extrato',
            titulo:
              'Lançado no IXC e sem par no extrato — ou o banco ainda não lançou, ou o lançamento não existe',
          },
        ]
      : []),
  ];

  return (
    <div className="faixa-titulo flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex flex-wrap gap-1.5">
        {recortes.map((r) => (
          <button
            key={r.id}
            title={r.titulo}
            onClick={() => onRecorte(r.id)}
            className={`btn btn-p ${recorte === r.id ? 'btn-acao' : 'btn-sutil'}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { id: 'tudo', label: 'Tudo' },
            { id: 'saidas', label: 'Só saídas' },
            { id: 'entradas', label: 'Só entradas' },
          ] as Array<{ id: Fluxo; label: string }>
        ).map((f) => (
          <button
            key={f.id}
            onClick={() => onFluxo(f.id)}
            className={`btn btn-p ${fluxo === f.id ? 'btn-acao' : 'btn-sutil'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <input
        value={busca}
        onChange={(e) => onBusca(e.target.value)}
        placeholder="Buscar no histórico, documento ou valor"
        className="campo max-w-xs"
      />

      <span className="num text-xs text-tinta-400">
        {mostrando} de {total}
      </span>

      {prontas > 0 && (
        <button
          onClick={onConferirQueBateram}
          disabled={conferindo}
          className="btn btn-pagar btn-p ml-auto"
          title="Marca de uma vez tudo que casou com o extrato importado"
        >
          {conferindo ? 'Conferindo…' : `Conferir as ${prontas} que bateram`}
        </button>
      )}
    </div>
  );
}

/** As contas, com as que costumam pagar as contas da empresa na frente. */
function SeletorDeConta({
  contas,
  escolhida,
  onEscolher,
}: {
  contas: ContaConciliavel[];
  escolhida: number | null;
  onEscolher: (id: number) => void;
}) {
  const usuais = contas.filter((c) => c.usual);
  const resto = contas.filter((c) => !c.usual && c.ativa);

  return (
    <div className="surgir mb-3 flex flex-wrap items-center gap-2">
      {usuais.map((c) => (
        <button
          key={c.id}
          onClick={() => onEscolher(c.id)}
          className={`btn btn-p ${escolhida === c.id ? 'btn-acao' : 'btn-neutro'}`}
        >
          {c.nome}
        </button>
      ))}
      {resto.length > 0 && (
        <select
          value={usuais.some((c) => c.id === escolhida) ? '' : (escolhida ?? '')}
          onChange={(e) => e.target.value && onEscolher(Number(e.target.value))}
          className="campo max-w-xs py-1.5 text-xs"
        >
          <option value="">Outra conta…</option>
          {resto.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome} {c.tipo === 'C' ? '(caixa)' : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** O período. Mês fechado de um clique, e datas soltas para o resto. */
function SeletorDePeriodo({
  periodo,
  onEscolher,
}: {
  periodo: { de: string; ate: string };
  onEscolher: (p: { de: string; ate: string }) => void;
}) {
  return (
    <div className="surgir mb-4 flex flex-wrap items-center gap-2 text-sm">
      <button
        onClick={() => onEscolher(mesVizinho(periodo, -1))}
        className="btn btn-neutro btn-p"
        aria-label="Mês anterior"
      >
        ‹
      </button>
      <button onClick={() => onEscolher(mesAtual())} className="btn btn-neutro btn-p">
        Este mês
      </button>
      <button
        onClick={() => onEscolher(mesVizinho(periodo, 1))}
        className="btn btn-neutro btn-p"
        aria-label="Próximo mês"
      >
        ›
      </button>
      <input
        type="date"
        value={periodo.de}
        onChange={(e) => onEscolher({ ...periodo, de: e.target.value })}
        className="campo w-auto py-1.5 text-xs"
      />
      <span className="text-tinta-400">até</span>
      <input
        type="date"
        value={periodo.ate}
        onChange={(e) => onEscolher({ ...periodo, ate: e.target.value })}
        className="campo w-auto py-1.5 text-xs"
      />
    </div>
  );
}

/** O botão que abre o arquivo do banco. */
function ImportarExtrato({
  extrato,
  onEscolher,
  onLimpar,
}: {
  extrato: { nome: string; texto: string } | null;
  onEscolher: (arquivo: File | null) => void;
  onLimpar: () => void;
}) {
  const campo = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2">
      <input
        ref={campo}
        type="file"
        accept=".ofx,.OFX,text/plain"
        className="hidden"
        onChange={(e) => {
          onEscolher(e.target.files?.[0] ?? null);
          // Sem isto, escolher o mesmo arquivo de novo (depois de corrigi-lo no
          // banco) não dispara nada e parece que o botão quebrou.
          e.target.value = '';
        }}
      />
      <button
        onClick={() => campo.current?.click()}
        className="btn btn-ferramenta"
        title="O arquivo .ofx que o banco exporta. Ele fica no navegador — nada é guardado no servidor."
      >
        {extrato ? 'Trocar extrato' : 'Importar extrato (.ofx)'}
      </button>
      {extrato && (
        <button
          onClick={onLimpar}
          className="btn btn-sutil btn-p"
          title={extrato.nome}
        >
          tirar “{encurtar(extrato.nome)}”
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface DiaDaConciliacao {
  data: string;
  linhas: LinhaDaConciliacao[];
  entradas: number;
  saidas: number;
}

function agruparPorDia(linhas: LinhaDaConciliacao[]): DiaDaConciliacao[] {
  const dias = new Map<string, DiaDaConciliacao>();
  for (const linha of linhas) {
    let dia = dias.get(linha.data);
    if (!dia) {
      dia = { data: linha.data, linhas: [], entradas: 0, saidas: 0 };
      dias.set(linha.data, dia);
    }
    dia.linhas.push(linha);
    if (linha.valor > 0) dia.entradas += linha.valor;
    else dia.saidas += -linha.valor;
  }
  return [...dias.values()].sort((a, b) => a.data.localeCompare(b.data));
}

function filtrar(
  linhas: LinhaDaConciliacao[],
  recorte: Recorte,
  fluxo: Fluxo,
  busca: string,
): LinhaDaConciliacao[] {
  const texto = busca.trim().toLowerCase();
  return linhas.filter((l) => {
    const fechada = l.conciliadoNoIxc || l.conferida !== null;
    if (recorte === 'pendentes' && fechada) return false;
    if (recorte === 'fechadas' && !fechada) return false;
    if (recorte === 'so-no-ixc' && l.extrato) return false;

    if (fluxo === 'saidas' && l.valor >= 0) return false;
    if (fluxo === 'entradas' && l.valor <= 0) return false;

    if (!texto) return true;
    return (
      l.historico.toLowerCase().includes(texto) ||
      (l.documento ?? '').toLowerCase().includes(texto) ||
      String(Math.abs(l.valor).toFixed(2)).includes(texto.replace(',', '.')) ||
      String(l.titulo?.idFnApagar ?? '').includes(texto) ||
      (l.titulo?.beneficiario ?? '').toLowerCase().includes(texto)
    );
  });
}

/** O resumo depois de uma conferência, sem ter de reler o IXC. */
function recontar(
  linhas: LinhaDaConciliacao[],
  ids: number[],
  conferida: LinhaDaConciliacao['conferida'],
): ConciliacaoDaConta['resumo'] {
  const depois = linhas.map((l) =>
    ids.includes(l.id) ? { ...l, conferida } : l,
  );
  const fechadas = depois.filter(
    (l) => l.conciliadoNoIxc || l.conferida !== null,
  ).length;
  return {
    linhas: depois.length,
    fechadas,
    pendentes: depois.length - fechadas,
    entradas: soma(depois.filter((l) => l.valor > 0).map((l) => l.valor)),
    saidas: soma(depois.filter((l) => l.valor < 0).map((l) => -l.valor)),
  };
}

function soma(valores: number[]): number {
  return Math.round(valores.reduce((s, v) => s + v, 0) * 100) / 100;
}

function alternar(marcadas: Set<number>, id: number): Set<number> {
  const novo = new Set(marcadas);
  if (novo.has(id)) novo.delete(id);
  else novo.add(id);
  return novo;
}

/** Centavo de diferença é arredondamento; daí para cima é assunto. */
function diferente(a: number, b: number): boolean {
  return Math.abs(a - b) > 0.005;
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

/** Do dia 1º até hoje: é o mês que está sendo conciliado. */
function mesAtual(): { de: string; ate: string } {
  const hoje = new Date();
  return {
    de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
    ate: iso(hoje),
  };
}

/** O mês inteiro anterior (ou seguinte) ao que está na tela. */
function mesVizinho(
  periodo: { de: string; ate: string },
  passo: number,
): { de: string; ate: string } {
  const [ano, mes] = periodo.de.split('-').map(Number);
  const primeiro = new Date(ano, mes - 1 + passo, 1);
  const ultimo = new Date(ano, mes + passo, 0);
  return { de: iso(primeiro), ate: iso(ultimo) };
}

/** Data local em "AAAA-MM-DD" — sem passar por UTC, que rouba um dia. */
function iso(data: Date): string {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

function encurtar(nome: string): string {
  return nome.length > 22 ? `${nome.slice(0, 20)}…` : nome;
}
