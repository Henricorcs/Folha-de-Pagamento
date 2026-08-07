import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mensagemErro } from '../lib/api';
import { baseDaFolha, usaValorAReceber } from '../lib/folha';
import { formatBRL } from '../lib/format';
import type { Funcionario, Paginado, Resumo, SyncResult } from '../lib/types';

export function Funcionarios() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');
  const [ativo, setAtivo] = useState<'todos' | 'true' | 'false'>('todos');
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);

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
            Fornecedores ativos isentos de ICMS, sincronizados do IXC
          </p>
        </div>
        <button
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {sync.isPending ? 'Sincronizando…' : '↻ Sincronizar com IXC'}
        </button>
      </div>

      {feedback && (
        <div className="mb-5 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {feedback}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card titulo="Funcionários ativos" valor={resumo.data?.ativos ?? '—'} />
        <Card titulo="Inativos" valor={resumo.data?.inativos ?? '—'} />
        <Card
          titulo="Folha base mensal"
          valor={formatBRL(resumo.data?.folhaBaseMensal)}
          detalhe={
            Number(resumo.data?.bonusFixoMensal ?? 0) > 0
              ? `salários ${formatBRL(resumo.data?.salarioBaseMensal)} + bônus fixos ${formatBRL(resumo.data?.bonusFixoMensal)}`
              : 'soma dos salários base dos ativos'
          }
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
                <th className="px-4 py-3 font-semibold">Chave PIX</th>
                <th className="px-4 py-3 text-right font-semibold">
                  Base da folha
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
                    {f.chavePix || (
                      <span className="text-amber-600">sem PIX</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700">
                    {formatBRL(baseDaFolha(f))}
                    {usaValorAReceber(f) && (
                      <div className="text-[10px] font-normal text-slate-400">
                        salário base {formatBRL(f.salarioBase)}
                      </div>
                    )}
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
      {detalhe && <div className="mt-0.5 text-xs text-slate-400">{detalhe}</div>}
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
