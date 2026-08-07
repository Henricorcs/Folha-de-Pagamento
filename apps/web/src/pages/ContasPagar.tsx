import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../components/ui';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import { STATUS_LABEL, STATUS_TOM, TIPO_LABEL } from '../lib/status';
import type { ContaPagar, Paginado, StatusContaPagar } from '../lib/types';

const STATUS_FILTROS: (StatusContaPagar | 'todos')[] = [
  'todos',
  'AGUARDANDO_APROVACAO',
  'AGUARDANDO_PAGAMENTO',
  'PAGO',
  'REPROVADO',
  'ERRO',
];

/** As quatro paradas de uma conta, do jeito que acontecem. */
const ETAPAS = [
  ['Salvar', 'a conta nasce no IXC'],
  ['Aprovar', 'auditoria libera'],
  ['Pagar', 'ModoBank, na tela do IXC'],
  ['Conferir', 'o banco confirma aqui'],
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
      return (await api.get<Paginado<ContaPagar>>('/contas-pagar', { params }))
        .data;
    },
  });

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['contas-pagar'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  const acao = useMutation({
    mutationFn: async (args: { id: string; op: string; motivo?: string }) => {
      const url = `/contas-pagar/${args.id}/${args.op}`;
      return (await api.post(url, args.motivo ? { motivo: args.motivo } : {}))
        .data;
    },
    onSuccess: (_d, args) => {
      const nomes: Record<string, string> = {
        aprovar: 'Conta aprovada.',
        reprovar: 'Conta reprovada.',
        sincronizar: 'Situação atualizada com o IXC.',
        enviar: 'Conta reenviada ao IXC.',
      };
      setFeedback(nomes[args.op] ?? 'Pronto.');
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const sincronizarTudo = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ verificadas: number; pagas: number }>(
          '/contas-pagar/sincronizar-pendentes',
        )
      ).data,
    onSuccess: (d) => {
      setFeedback(
        `${d.verificadas} conta(s) verificadas no IXC — ${d.pagas} já constam como pagas.`,
      );
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

  const total = (lista.data?.itens ?? []).reduce(
    (s, c) => s + Number(c.valor),
    0,
  );

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contas a pagar"
        titulo="Pagamentos no IXC"
        descricao="Cada conta nasce aqui, passa pela auditoria e só vira dinheiro quando o banco confirma."
        acoes={
          <button
            onClick={() => sincronizarTudo.mutate()}
            disabled={sincronizarTudo.isPending}
            className="btn btn-acao"
          >
            {sincronizarTudo.isPending
              ? 'Verificando…'
              : 'Verificar pagamentos no IXC'}
          </button>
        }
      />

      {feedback && <Aviso tom="marca">{feedback}</Aviso>}

      <Bloco className="surgir surgir-1 mb-6">
        <ol className="flex flex-wrap gap-x-8 gap-y-4">
          {ETAPAS.map(([nome, oque], i) => (
            <li key={nome} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-tinta-900 font-display text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-tinta-800">
                  {nome}
                </div>
                <div className="text-xs text-tinta-400">{oque}</div>
              </div>
            </li>
          ))}
        </ol>
      </Bloco>

      <div className="surgir surgir-2 mb-4 flex flex-wrap gap-2">
        {STATUS_FILTROS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              status === s
                ? 'bg-tinta-900 text-white'
                : 'border border-tinta-200 bg-white text-tinta-600 hover:border-tinta-300'
            }`}
          >
            {s === 'todos' ? 'Todas' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <Bloco className="surgir surgir-3" semPadding>
        <div className="overflow-x-auto rolagem-fina">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Beneficiário</th>
                <th className="th">Tipo</th>
                <th className="th">Comp.</th>
                <th className="th">Emissão</th>
                <th className="th text-right">Valor</th>
                <th className="th text-center">Situação</th>
                <th className="th text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {lista.isLoading && (
                <tr>
                  <td colSpan={7}>
                    <Carregando />
                  </td>
                </tr>
              )}
              {lista.data?.itens.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <Vazio titulo="Nenhuma conta nesta situação">
                      As contas aparecem aqui depois que você gera a folha.
                    </Vazio>
                  </td>
                </tr>
              )}
              {lista.data?.itens.map((c) => (
                <tr key={c.id} className="linha">
                  <td className="td">
                    <div className="font-medium text-tinta-900">
                      {c.beneficiarioNome}
                    </div>
                    <div className="mt-0.5 max-w-md text-xs text-tinta-400">
                      {c.observacao}
                    </div>
                    {c.erro && (
                      <div className="mt-1 text-xs text-rose-600">{c.erro}</div>
                    )}
                  </td>
                  <td className="td text-tinta-500">{TIPO_LABEL[c.tipo]}</td>
                  <td className="td num text-tinta-500">
                    {c.competencia ?? '—'}
                  </td>
                  <td className="td num text-tinta-500">
                    {formatData(c.dataEmissao)}
                  </td>
                  <td className="td text-right">
                    <span className="valor">{formatBRL(c.valor)}</span>
                  </td>
                  <td className="td text-center">
                    <Selo tom={STATUS_TOM[c.status]} ponto>
                      {STATUS_LABEL[c.status]}
                    </Selo>
                  </td>
                  <td className="td text-right">
                    <div className="flex justify-end gap-1.5">
                      {c.status === 'AGUARDANDO_APROVACAO' && (
                        <>
                          <button
                            onClick={() => aprovar(c.id)}
                            className="btn btn-p bg-brand-600 text-white hover:bg-brand-700"
                          >
                            Aprovar
                          </button>
                          <button
                            onClick={() => reprovar(c.id)}
                            className="btn btn-p border border-rose-200 text-rose-600 hover:bg-rose-50"
                          >
                            Reprovar
                          </button>
                        </>
                      )}
                      {(c.status === 'AGUARDANDO_PAGAMENTO' ||
                        c.status === 'APROVADO') && (
                        <button
                          onClick={() =>
                            acao.mutate({ id: c.id, op: 'sincronizar' })
                          }
                          className="btn btn-neutro btn-p"
                        >
                          Verificar
                        </button>
                      )}
                      {c.status === 'ERRO' && (
                        <button
                          onClick={() => acao.mutate({ id: c.id, op: 'enviar' })}
                          className="btn btn-p bg-amber-500 text-white hover:bg-amber-600"
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

        {(lista.data?.itens.length ?? 0) > 0 && (
          <div className="flex items-center justify-between border-t border-tinta-100 px-5 py-3.5 text-sm">
            <span className="text-tinta-500 num">
              {lista.data?.itens.length} de {lista.data?.total} conta(s)
            </span>
            <span className="text-tinta-500">
              Soma da página{' '}
              <strong className="valor ml-1 text-[15px]">
                {formatBRL(total)}
              </strong>
            </span>
          </div>
        )}
      </Bloco>
    </Pagina>
  );
}
