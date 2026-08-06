import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import type {
  Funcionario,
  Paginado,
  PreviewFornecedores,
  Resumo,
  SyncResult,
} from '../lib/types';

export function Funcionarios() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');
  const [ativo, setAtivo] = useState<'todos' | 'true' | 'false'>('todos');
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [mostrarPreview, setMostrarPreview] = useState(false);

  const resumo = useQuery({
    queryKey: ['resumo'],
    queryFn: async () => (await api.get<Resumo>('/funcionarios/resumo')).data,
  });

  const lista = useQuery({
    queryKey: ['funcionarios', buscaAtiva, ativo, page],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, pageSize: 25 };
      if (buscaAtiva) params.busca = buscaAtiva;
      if (ativo !== 'todos') params.ativo = ativo;
      return (await api.get<Paginado<Funcionario>>('/funcionarios', { params }))
        .data;
    },
  });

  const sync = useMutation({
    mutationFn: async () =>
      (await api.post<{ resultados: SyncResult[] }>('/sync')).data,
    onSuccess: (data) => {
      const f = data.resultados.find((r) => r.recurso === 'funcionarios');
      const forn = data.resultados.find((r) => r.recurso === 'fornecedores');
      setFeedback(
        `Sincronização concluída — ${f?.totalLidos ?? 0} funcionários (${
          f?.totalNovos ?? 0
        } novos, ${f?.totalAtualizados ?? 0} atualizados). ` +
          `Fornecedores isentos de ICMS: ${forn?.totalLidos ?? 0} (${
            forn?.totalNovos ?? 0
          } novos).`,
      );
      invalidarListas();
    },
    onError: (err) => setFeedback(`Erro ao sincronizar: ${mensagemErro(err)}`),
  });

  // Filtro do cadastro de fornecedor: ativo + "Contribuinte ICMS" isento.
  const preview = useQuery({
    queryKey: ['preview-fornecedores'],
    queryFn: async () =>
      (await api.get<PreviewFornecedores>('/sync/fornecedores/preview')).data,
    enabled: mostrarPreview,
    staleTime: 60_000,
  });

  const importar = useMutation({
    mutationFn: async () =>
      (await api.post<{ resultado: SyncResult }>('/sync/fornecedores')).data,
    onSuccess: ({ resultado }) => {
      setFeedback(
        `Importados do fornecedor: ${resultado.totalLidos} isentos de ICMS (${resultado.totalNovos} novos, ${resultado.totalAtualizados} atualizados).`,
      );
      invalidarListas();
      qc.invalidateQueries({ queryKey: ['preview-fornecedores'] });
    },
    onError: (err) => setFeedback(`Erro ao importar: ${mensagemErro(err)}`),
  });

  function invalidarListas() {
    qc.invalidateQueries({ queryKey: ['funcionarios'] });
    qc.invalidateQueries({ queryKey: ['resumo'] });
  }

  function submitBusca(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setBuscaAtiva(busca.trim());
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Funcionários</h1>
          <p className="text-sm text-slate-500">
            Cadastro sincronizado com o IXC
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setMostrarPreview((v) => !v)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {mostrarPreview ? 'Ocultar filtro' : '🔎 Filtro de fornecedores'}
          </button>
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {sync.isPending ? 'Sincronizando…' : '↻ Sincronizar com IXC'}
          </button>
        </div>
      </div>

      {feedback && (
        <div className="mb-5 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {feedback}
        </div>
      )}

      {mostrarPreview && (
        <PainelFornecedores
          carregando={preview.isLoading}
          erro={preview.isError ? mensagemErro(preview.error) : null}
          dados={preview.data}
          importando={importar.isPending}
          onImportar={() => importar.mutate()}
        />
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card titulo="Funcionários ativos" valor={resumo.data?.ativos ?? '—'} />
        <Card titulo="Inativos" valor={resumo.data?.inativos ?? '—'} />
        <Card
          titulo="Folha base mensal"
          valor={formatBRL(resumo.data?.folhaBaseMensal)}
        />
      </div>

      <form onSubmit={submitBusca} className="mb-4 flex flex-wrap gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, CPF ou e-mail…"
          className="min-w-[240px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <select
          value={ativo}
          onChange={(e) => {
            setPage(1);
            setAtivo(e.target.value as typeof ativo);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          <option value="todos">Todos</option>
          <option value="true">Ativos</option>
          <option value="false">Inativos</option>
        </select>
        <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Buscar
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Nome</th>
                <th className="px-4 py-3 font-semibold">CPF/CNPJ</th>
                <th className="px-4 py-3 font-semibold">Admissão</th>
                <th className="px-4 py-3 text-right font-semibold">
                  Salário base
                </th>
                <th className="px-4 py-3 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Carregando…
                  </td>
                </tr>
              )}
              {lista.isError && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-red-500">
                    {mensagemErro(lista.error)}
                  </td>
                </tr>
              )}
              {lista.data?.itens.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    Nenhum funcionário. Clique em “Sincronizar com IXC”.
                  </td>
                </tr>
              )}
              {lista.data?.itens.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/funcionarios/${f.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {f.nome}
                    </Link>
                    {f.ixcId && (
                      <span className="ml-2 text-xs text-slate-400">
                        IXC #{f.ixcId}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{f.cpfCnpj ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatData(f.dataAdmissao)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700">
                    {formatBRL(f.salarioBase)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge ativo={f.ativo} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {lista.data && lista.data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              Página {lista.data.page} de {lista.data.totalPages} ·{' '}
              {lista.data.total} registros
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                disabled={page >= lista.data.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Prévia do filtro que identifica funcionários no cadastro de fornecedor do
 * IXC: fornecedor ativo com "Contribuinte ICMS" = Isento. A distribuição de
 * valores serve para conferir qual código a sua base usa para "Isento".
 */
function PainelFornecedores({
  carregando,
  erro,
  dados,
  importando,
  onImportar,
}: {
  carregando: boolean;
  erro: string | null;
  dados?: PreviewFornecedores;
  importando: boolean;
  onImportar: () => void;
}) {
  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Funcionários no cadastro de fornecedor
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Fornecedor ativo com “Contribuinte ICMS” = Isento é funcionário. A
            importação traz também PIX, banco, agência e conta.
          </p>
        </div>
        <button
          onClick={onImportar}
          disabled={importando || !dados || dados.funcionarios.length === 0}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {importando
            ? 'Importando…'
            : `Importar ${dados?.funcionarios.length ?? 0}`}
        </button>
      </div>

      {carregando && <p className="text-sm text-slate-400">Consultando o IXC…</p>}
      {erro && <p className="text-sm text-red-500">{erro}</p>}

      {dados && (
        <>
          <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
            <span>
              Campo do ICMS:{' '}
              <code className="text-slate-700">
                {dados.campoIcms ?? 'não encontrado'}
              </code>
            </span>
            <span>
              Vale como isento:{' '}
              <code className="text-slate-700">
                {dados.valoresIsento.join(', ')}
              </code>
            </span>
            <span>
              Fornecedores ativos lidos: {dados.totalFornecedoresAtivos}
            </span>
          </div>

          {dados.funcionarios.length === 0 && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Nenhum fornecedor bateu com o filtro. Veja abaixo os valores que a
              sua base usa nesse campo e ajuste em Configurações → “Filtro de
              funcionários (fornecedor)”.
            </p>
          )}

          {dados.distribuicao.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Valores encontrados no campo de ICMS
              </div>
              <div className="flex flex-wrap gap-2">
                {dados.distribuicao.map((d) => {
                  const isento = dados.valoresIsento.includes(
                    d.valor.toUpperCase(),
                  );
                  return (
                    <span
                      key={d.valor}
                      title={d.exemplos.join(' · ')}
                      className={`rounded-full px-3 py-1 text-xs ${
                        isento
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <strong>{d.valor}</strong> · {d.quantidade}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {dados.funcionarios.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Nome</th>
                    <th className="px-4 py-2 font-semibold">CPF/CNPJ</th>
                    <th className="px-4 py-2 font-semibold">Chave PIX</th>
                    <th className="px-4 py-2 font-semibold">Banco / ag. / conta</th>
                    <th className="px-4 py-2 text-center font-semibold">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dados.funcionarios.map((f) => (
                    <tr key={f.idFornecedor}>
                      <td className="px-4 py-2">
                        {f.nome}
                        <span className="ml-2 text-xs text-slate-400">
                          fornecedor #{f.idFornecedor}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {f.cpfCnpj ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {f.chavePix ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {[f.banco, f.agencia, f.conta].filter(Boolean).join(' / ') ||
                          '—'}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            f.jaCadastrado
                              ? 'bg-slate-100 text-slate-500'
                              : 'bg-brand-100 text-brand-700'
                          }`}
                        >
                          {f.jaCadastrado ? 'Já cadastrado' : 'Novo'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Card({ titulo, valor }: { titulo: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {titulo}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-800">{valor}</div>
    </div>
  );
}

function StatusBadge({ ativo }: { ativo: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ativo ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {ativo ? 'Ativo' : 'Inativo'}
    </span>
  );
}
