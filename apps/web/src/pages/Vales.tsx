import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import { SENTIDO_CLASSE, SENTIDO_CURTO, SENTIDO_LABEL } from '../lib/status';
import type {
  Funcionario,
  Paginado,
  SentidoVale,
  ValeComSaldo,
  ValeParcela,
} from '../lib/types';

type Situacao = 'ABERTO' | 'QUITADO' | 'CANCELADO' | 'TODOS';

function competenciaAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatComp(comp: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  return m ? `${m[2]}/${m[1]}` : comp;
}

export function Vales() {
  const qc = useQueryClient();
  const [situacao, setSituacao] = useState<Situacao>('ABERTO');
  const [sentido, setSentido] = useState<SentidoVale | 'TODOS'>('TODOS');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['vales', situacao, sentido, busca],
    queryFn: async () => {
      const params: Record<string, string> = { situacao };
      if (sentido !== 'TODOS') params.sentido = sentido;
      if (busca.trim()) params.busca = busca.trim();
      return (await api.get<ValeComSaldo[]>('/vales', { params })).data;
    },
  });

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['vales'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  const alterar = useMutation({
    mutationFn: async ({
      id,
      dados,
    }: {
      id: string;
      dados: Record<string, unknown>;
    }) => (await api.patch(`/vales/${id}`, dados)).data,
    onSuccess: invalidar,
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/vales/${id}`)).data,
    onSuccess: () => {
      setFeedback('Vale excluído.');
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const marcarParcela = useMutation({
    mutationFn: async ({
      parcelaId,
      descontada,
    }: {
      parcelaId: string;
      descontada: boolean;
    }) =>
      (await api.patch(`/vales/parcelas/${parcelaId}`, { descontada })).data,
    onSuccess: invalidar,
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const totais = useMemo(() => {
    const itens = lista.data ?? [];
    const soma = (s: SentidoVale) =>
      itens
        .filter((v) => v.vale.sentido === s && !v.vale.cancelado)
        .reduce((acc, v) => acc + v.saldo, 0);
    return { deve: soma('DESCONTO'), receber: soma('CREDITO') };
  }, [lista.data]);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Vales e Acertos</h1>
      <p className="mb-6 text-sm text-slate-500">
        Acerto de contas entre a pessoa e a empresa — nos dois sentidos, avulso
        ou parcelado. O que estiver marcado para lançar na folha entra
        automaticamente no salário da competência de cada parcela.
      </p>

      {feedback && (
        <div className="mb-5 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {feedback}
        </div>
      )}

      <NovoVale onCriado={() => { setFeedback('Registrado.'); invalidar(); }} />

      <div className="mb-4 mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card
          titulo="Funcionários devem à empresa"
          valor={formatBRL(totais.deve)}
          detalhe="saldo em aberto nesta lista"
        />
        <Card
          titulo="Empresa deve aos funcionários"
          valor={formatBRL(totais.receber)}
          detalhe="saldo em aberto nesta lista"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Situação
          </label>
          <select
            value={situacao}
            onChange={(e) => setSituacao(e.target.value as Situacao)}
            className={inputCls}
          >
            <option value="ABERTO">Em aberto</option>
            <option value="QUITADO">Quitados</option>
            <option value="CANCELADO">Cancelados</option>
            <option value="TODOS">Todos</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Sentido
          </label>
          <select
            value={sentido}
            onChange={(e) => setSentido(e.target.value as SentidoVale | 'TODOS')}
            className={inputCls}
          >
            <option value="TODOS">Os dois</option>
            <option value="DESCONTO">Funcionário paga a empresa</option>
            <option value="CREDITO">Empresa paga o funcionário</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Buscar
          </label>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome da pessoa ou descrição…"
            className={`${inputCls} w-full`}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Pessoa</th>
                <th className="px-4 py-3 font-semibold">Descrição</th>
                <th className="px-4 py-3 text-center font-semibold">Parcelas</th>
                <th className="px-4 py-3 text-right font-semibold">Parcela</th>
                <th className="px-4 py-3 text-right font-semibold">Saldo</th>
                <th className="px-4 py-3 text-center font-semibold">Folha</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            {lista.isLoading && (
              <tbody>
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Carregando…
                  </td>
                </tr>
              </tbody>
            )}
            {lista.data?.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    Nenhum vale nesta situação.
                  </td>
                </tr>
              </tbody>
            )}
            {lista.data?.map((v) => {
              const expandido = !!aberto[v.vale.id];
              return (
                <tbody key={v.vale.id} className="border-t border-slate-100">
                  <tr
                    className={`cursor-pointer hover:bg-slate-50 ${
                      v.vale.cancelado ? 'opacity-50' : ''
                    }`}
                    onClick={() =>
                      setAberto((p) => ({ ...p, [v.vale.id]: !p[v.vale.id] }))
                    }
                  >
                    <td className="px-4 py-3">
                      <span className="mr-2 inline-block w-3 text-slate-400">
                        {expandido ? '▾' : '▸'}
                      </span>
                      <Link
                        to={`/funcionarios/${v.vale.funcionarioId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {v.funcionarioNome}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {v.vale.descricao}
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          SENTIDO_CLASSE[v.vale.sentido]
                        }`}
                      >
                        {SENTIDO_CURTO[v.vale.sentido]}
                      </span>
                      {v.vale.cancelado && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          cancelado
                        </span>
                      )}
                      {v.quitado && !v.vale.cancelado && (
                        <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">
                          quitado
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">
                      {v.parcelasDescontadas}/{v.vale.quantidadeParcelas}
                      {v.proximaParcela && (
                        <span className="ml-1 text-xs text-slate-400">
                          · próx. {formatComp(v.proximaParcela.competencia)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {formatBRL(v.vale.valorParcela)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${
                        v.vale.sentido === 'CREDITO'
                          ? 'text-emerald-700'
                          : 'text-slate-800'
                      }`}
                    >
                      {formatBRL(v.saldo)}
                      <div className="text-[10px] font-normal text-slate-400">
                        de {formatBRL(v.vale.valorTotal)}
                      </div>
                    </td>
                    <td
                      className="px-4 py-3 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={v.vale.descontarDaFolha}
                        disabled={v.vale.cancelado || alterar.isPending}
                        onChange={(e) =>
                          alterar.mutate({
                            id: v.vale.id,
                            dados: { descontarDaFolha: e.target.checked },
                          })
                        }
                        title="Lançar as parcelas na folha de pagamento"
                      />
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {v.vale.cancelado ? (
                        <button
                          onClick={() =>
                            alterar.mutate({
                              id: v.vale.id,
                              dados: { cancelado: false },
                            })
                          }
                          className="text-xs text-brand-600 hover:underline"
                        >
                          reativar
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            alterar.mutate({
                              id: v.vale.id,
                              dados: { cancelado: true },
                            })
                          }
                          className="text-xs text-amber-600 hover:underline"
                        >
                          cancelar
                        </button>
                      )}
                      {v.parcelasDescontadas === 0 && (
                        <button
                          onClick={() => excluir.mutate(v.vale.id)}
                          className="ml-3 text-xs text-red-500 hover:underline"
                        >
                          excluir
                        </button>
                      )}
                    </td>
                  </tr>

                  {expandido && (
                    <tr>
                      <td colSpan={7} className="bg-slate-50 px-4 pb-4 pt-2">
                        {v.vale.observacao && (
                          <p className="mb-2 text-xs text-slate-500">
                            {v.vale.observacao}
                          </p>
                        )}
                        <p className="mb-2 text-xs text-slate-500">
                          {SENTIDO_LABEL[v.vale.sentido]} · registrado em{' '}
                          {formatData(v.vale.data)} · já{' '}
                          {v.vale.sentido === 'CREDITO' ? 'pago' : 'descontado'}:{' '}
                          {formatBRL(v.totalDescontado)}
                        </p>
                        <ParcelasTabela
                          parcelas={v.vale.parcelas}
                          onMarcar={(parcelaId, descontada) =>
                            marcarParcela.mutate({ parcelaId, descontada })
                          }
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>
    </div>
  );
}

function ParcelasTabela({
  parcelas,
  onMarcar,
}: {
  parcelas: ValeParcela[];
  onMarcar: (parcelaId: string, descontada: boolean) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[11px] uppercase text-slate-400">
        <tr>
          <th className="w-10 py-1">✓</th>
          <th className="py-1">Parcela</th>
          <th className="py-1">Competência</th>
          <th className="py-1 text-right">Valor</th>
          <th className="py-1 text-right">Baixa</th>
        </tr>
      </thead>
      <tbody>
        {parcelas.map((p) => (
          <tr key={p.id} className="border-t border-slate-200">
            <td className="py-1.5">
              <input
                type="checkbox"
                checked={p.descontada}
                onChange={(e) => onMarcar(p.id, e.target.checked)}
                title="Marcar como acertada fora da folha"
              />
            </td>
            <td className="py-1.5">{p.numero}</td>
            <td className="py-1.5">{formatComp(p.competencia)}</td>
            <td className="py-1.5 text-right font-medium">
              {formatBRL(p.valor)}
            </td>
            <td className="py-1.5 text-right text-xs text-slate-500">
              {p.descontadaEm ? formatData(p.descontadaEm) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Formulário de novo vale/acerto ---
function NovoVale({ onCriado }: { onCriado: () => void }) {
  const [sentido, setSentido] = useState<SentidoVale>('DESCONTO');
  const [funcionarioId, setFuncionarioId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [parcelas, setParcelas] = useState('1');
  const [valorParcela, setValorParcela] = useState('');
  const [competenciaInicio, setCompetenciaInicio] = useState(competenciaAtual());
  const [naFolha, setNaFolha] = useState(true);
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const funcionarios = useQuery({
    queryKey: ['funcionarios', 'select'],
    queryFn: async () =>
      (
        await api.get<Paginado<Funcionario>>('/funcionarios', {
          params: { pageSize: 200, ativo: 'true' },
        })
      ).data,
  });

  const criar = useMutation({
    mutationFn: async () =>
      (
        await api.post('/vales', {
          funcionarioId,
          sentido,
          descricao,
          quantidadeParcelas: Number(parcelas),
          valorParcela: Number(valorParcela),
          competenciaInicio,
          descontarDaFolha: naFolha,
          observacao: observacao || undefined,
        })
      ).data,
    onSuccess: () => {
      setDescricao('');
      setValorParcela('');
      setParcelas('1');
      setObservacao('');
      setErro(null);
      onCriado();
    },
    onError: (err) => setErro(mensagemErro(err)),
  });

  const qtd = Number(parcelas) || 0;
  const total = qtd * (Number(valorParcela) || 0);
  const valido =
    !!funcionarioId &&
    descricao.trim().length >= 2 &&
    qtd >= 1 &&
    Number(valorParcela) > 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Novo vale / acerto
      </h2>

      <div className="mb-4 inline-flex rounded-lg border border-slate-300 p-0.5">
        <BotaoSentido
          ativo={sentido === 'DESCONTO'}
          onClick={() => setSentido('DESCONTO')}
        >
          Funcionário paga a empresa
        </BotaoSentido>
        <BotaoSentido
          ativo={sentido === 'CREDITO'}
          onClick={() => setSentido('CREDITO')}
        >
          Empresa paga o funcionário
        </BotaoSentido>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Campo label="Funcionário">
          <select
            value={funcionarioId}
            onChange={(e) => setFuncionarioId(e.target.value)}
            className={`${inputCls} w-full`}
          >
            <option value="">Selecione…</option>
            {funcionarios.data?.itens.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Descrição" span2>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={
              sentido === 'DESCONTO'
                ? 'Ex.: celular comprado na empresa'
                : 'Ex.: material que comprou para a obra'
            }
            className={`${inputCls} w-full`}
          />
        </Campo>
        <Campo label="Nº de parcelas">
          <input
            type="number"
            min={1}
            value={parcelas}
            onChange={(e) => setParcelas(e.target.value)}
            className={`${inputCls} w-full`}
          />
        </Campo>
        <Campo label="Valor de cada parcela (R$)">
          <input
            type="number"
            step="0.01"
            value={valorParcela}
            onChange={(e) => setValorParcela(e.target.value)}
            className={`${inputCls} w-full`}
          />
        </Campo>
        <Campo label="Primeira parcela na folha de">
          <input
            type="month"
            value={competenciaInicio}
            onChange={(e) => setCompetenciaInicio(e.target.value)}
            className={`${inputCls} w-full`}
          />
        </Campo>
        <Campo label="Observação" span2>
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className={`${inputCls} w-full`}
          />
        </Campo>
        <Campo>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={naFolha}
              onChange={(e) => setNaFolha(e.target.checked)}
            />
            {sentido === 'DESCONTO' ? 'Descontar da folha' : 'Somar na folha'}
          </label>
        </Campo>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          onClick={() => criar.mutate()}
          disabled={!valido || criar.isPending}
          className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {criar.isPending ? 'Registrando…' : 'Registrar'}
        </button>
        {total > 0 && (
          <span className="text-sm text-slate-500">
            Total: <strong className="text-slate-700">{formatBRL(total)}</strong>{' '}
            em {qtd}x de {formatBRL(Number(valorParcela))} a partir de{' '}
            {formatComp(competenciaInicio)}
          </span>
        )}
        {!naFolha && (
          <span className="text-xs text-amber-700">
            Fora da folha: fica só registrado para controle.
          </span>
        )}
      </div>
      {erro && <p className="mt-3 text-sm text-red-500">{erro}</p>}
    </div>
  );
}

const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

function Campo({
  label,
  span2,
  children,
}: {
  /** Sem rótulo, o espaço é preservado para alinhar com os vizinhos. */
  label?: string;
  span2?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="mb-1 block text-xs font-medium text-slate-500">
        {label ?? ' '}
      </label>
      {children}
    </div>
  );
}

function BotaoSentido({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        ativo ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function Card({
  titulo,
  valor,
  detalhe,
}: {
  titulo: string;
  valor: React.ReactNode;
  detalhe?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {titulo}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-800">{valor}</div>
      {detalhe && <div className="text-xs text-slate-400">{detalhe}</div>}
    </div>
  );
}
