import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type { ContaPagar } from '../../lib/types';

/**
 * As despesas que ficaram entre as duas telas.
 *
 * Uma despesa recusada pelo IXC era gravada aqui, marcada com o motivo, e
 * sumia: a lista de contas em aberto é lida do IXC — e é lá que ela não está —
 * e a tela de Pagamentos da Folha exclui despesa por definição. Quem lançou via
 * a mensagem de erro uma vez e depois não tinha mais onde procurar; o caminho
 * de volta existia só como rota da API.
 *
 * Por isso ela mora no topo da lista de contas em aberto, e não numa tela
 * própria: o buraco não é falta de lugar para administrar essas despesas, é a
 * pessoa não saber que elas existem. Aparece só quando há alguma, e some
 * sozinha quando a última é resolvida.
 */
export function DespesasNaoEnviadas() {
  const qc = useQueryClient();
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['despesas-nao-enviadas'],
    queryFn: async () =>
      (await api.get<ContaPagar[]>('/contas-abertas/despesas-nao-enviadas'))
        .data,
  });

  function aoTerminar() {
    setErroAcao(null);
    void qc.invalidateQueries({ queryKey: ['despesas-nao-enviadas'] });
    void qc.invalidateQueries({ queryKey: ['contas-abertas'] });
  }

  const reenviar = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<ContaPagar>(`/contas-pagar/${id}/enviar`)).data,
    onSuccess: (c) => {
      // Reenviar não garante que passou: a rota devolve a conta do jeito que
      // ficou, e sem número do IXC ela continua parada — com o motivo novo.
      if (c.idFnApagarIxc) aoTerminar();
      else {
        setErroAcao(c.erro ?? 'O IXC recusou de novo.');
        void qc.invalidateQueries({ queryKey: ['despesas-nao-enviadas'] });
      }
    },
    onError: (e) => setErroAcao(mensagemErro(e)),
  });

  const descartar = useMutation({
    mutationFn: async (id: string) => api.delete(`/contas-pagar/${id}`),
    onSuccess: aoTerminar,
    onError: (e) => setErroAcao(mensagemErro(e)),
  });

  const itens = lista.data ?? [];
  if (itens.length === 0) return null;

  const ocupado = reenviar.isPending || descartar.isPending;

  return (
    /* As cores do `Aviso tom="erro"`, mas em caixa própria: o Aviso põe os
       filhos num `<span>`, e uma lista com botões dentro dele fica espremida
       contra a borda. */
    <div className="surgir mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
      <div>
        <p className="font-semibold">
          {itens.length === 1
            ? 'Uma despesa não chegou ao IXC'
            : `${itens.length} despesas não chegaram ao IXC`}
        </p>
        <p className="mt-0.5 text-sm opacity-90">
          Foram lançadas aqui, o IXC recusou, e por isso não aparecem na lista
          abaixo — que é lida de lá. Enquanto estiverem assim, ninguém as paga.
        </p>

        <ul className="lista-dividida mt-3">
          {itens.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-start justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {c.beneficiarioNome}{' '}
                  <span className="valor">{formatBRL(Number(c.valor))}</span>
                  <span className="ml-2 text-xs opacity-70">
                    venc. {formatData(c.dataVencimento)}
                  </span>
                </div>
                {c.observacao && (
                  <div className="text-xs opacity-70">{c.observacao}</div>
                )}
                {/* O motivo é o que decide o que fazer: corrigir o cadastro,
                    esperar o IXC voltar, ou desistir da despesa. */}
                <div className="mt-0.5 text-xs">
                  {c.erro ?? 'Ficou em rascunho — o envio não chegou a terminar.'}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => reenviar.mutate(c.id)}
                  disabled={ocupado}
                  title="Tenta mandar de novo ao IXC, do jeito que a despesa está"
                  className="btn btn-p bg-amber-500 text-white hover:bg-amber-600"
                >
                  {reenviar.isPending ? 'Reenviando…' : 'Reenviar'}
                </button>
                <button
                  type="button"
                  onClick={() => descartar.mutate(c.id)}
                  disabled={ocupado}
                  title="Apaga o registro daqui. Nada é apagado no IXC — esta despesa nunca chegou lá"
                  className="btn btn-p btn-neutro"
                >
                  Descartar
                </button>
              </div>
            </li>
          ))}
        </ul>

        {erroAcao && <p className="mt-2 text-sm font-medium">{erroAcao}</p>}
      </div>
    </div>
  );
}
