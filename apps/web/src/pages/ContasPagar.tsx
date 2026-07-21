import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import { STATUS_CLASSE, STATUS_LABEL, TIPO_LABEL } from '../lib/status';
import type { ContaPagar, Paginado, StatusContaPagar } from '../lib/types';

const STATUS_FILTROS: (StatusContaPagar | 'todos')[] = [
  'todos',
  'AGUARDANDO_APROVACAO',
  'AGUARDANDO_PAGAMENTO',
  'PAGO',
  'REPROVADO',
  'ERRO',
];

export function ContasPagar() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusContaPagar | 'todos'>('todos');
  const [feedback, setFeedback] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['contas-pagar', status],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (status !== 'todos') params.status = status;
      return (await api.get<Paginado<ContaPagar>>('/contas-pagar', { params })).data;
    },
  });

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['contas-pagar'] });
  }

  const acao = useMutation({
    mutationFn: async (args: { id: string; op: string; motivo?: string }) => {
      const url = `/contas-pagar/${args.id}/${args.op}`;
      return (await api.post(url, args.motivo ? { motivo: args.motivo } : {})).data;
    },
    onSuccess: (_d, args) => {
      setFeedback(`Ação "${args.op}" concluída.`);
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const sincronizarTudo = useMutation({
    mutationFn: async () =>
      (await api.post<{ verificadas: number; pagas: number }>(
        '/contas-pagar/sincronizar-pendentes',
      )).data,
    onSuccess: (d) => {
      setFeedback(`Sincronização: ${d.verificadas} verificadas, ${d.pagas} pagas.`);
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  function aprovar(id: string) {
    const motivo = prompt('Motivo da aprovação:', 'Aprovado');
    if (motivo !== null) acao.mutate({ id, op: 'aprovar', motivo });
  }
  function reprovar(id: string) {
    const motivo = prompt('Motivo da reprovação:');
    if (motivo) acao.mutate({ id, op: 'reprovar', motivo });
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Contas a Pagar</h1>
          <p className="text-sm text-slate-500">
            Fluxo: salvar → aprovar (auditoria) → pagar (ModoBank no IXC) → pago.
          </p>
        </div>
        <button
          onClick={() => sincronizarTudo.mutate()}
          disabled={sincronizarTudo.isPending}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {sincronizarTudo.isPending ? 'Sincronizando…' : '↻ Sincronizar pagamentos'}
        </button>
      </div>

      {feedback && (
        <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {feedback}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTROS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              status === s
                ? 'bg-brand-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            {s === 'todos' ? 'Todos' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Beneficiário</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Comp.</th>
                <th className="px-4 py-3">Emissão</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Carregando…
                  </td>
                </tr>
              )}
              {lista.data?.itens.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    Nenhuma conta a pagar. Gere pela tela “Gerar Folha”.
                  </td>
                </tr>
              )}
              {lista.data?.itens.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-700">{c.beneficiarioNome}</div>
                    <div className="text-xs text-slate-400">{c.observacao}</div>
                  </td>
                  <td className="px-4 py-3">{TIPO_LABEL[c.tipo]}</td>
                  <td className="px-4 py-3 text-slate-500">{c.competencia ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{formatData(c.dataEmissao)}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatBRL(c.valor)}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSE[c.status]}`}
                      title={c.erro ?? undefined}
                    >
                      {STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      {c.status === 'AGUARDANDO_APROVACAO' && (
                        <>
                          <button
                            onClick={() => aprovar(c.id)}
                            className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700"
                          >
                            Aprovar
                          </button>
                          <button
                            onClick={() => reprovar(c.id)}
                            className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600"
                          >
                            Reprovar
                          </button>
                        </>
                      )}
                      {(c.status === 'AGUARDANDO_PAGAMENTO' ||
                        c.status === 'APROVADO') && (
                        <button
                          onClick={() => acao.mutate({ id: c.id, op: 'sincronizar' })}
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Verificar pgto.
                        </button>
                      )}
                      {c.status === 'ERRO' && (
                        <button
                          onClick={() => acao.mutate({ id: c.id, op: 'enviar' })}
                          className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600"
                        >
                          Reenviar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
