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
import type {
  ContaPagar,
  Paginado,
  ResultadoSincronizacao,
  ResumoSincronizacao,
  StatusContaPagar,
} from '../lib/types';

const STATUS_FILTROS: (StatusContaPagar | 'todos')[] = [
  'todos',
  'AGUARDANDO_APROVACAO',
  'AGUARDANDO_PAGAMENTO',
  'PAGO',
  'REPROVADO',
  'CANCELADO',
  'ERRO',
];

/** As quatro paradas de uma conta, do jeito que acontecem. */
const ETAPAS = [
  ['Salvar', 'a conta nasce no IXC'],
  ['Aprovar', 'auditoria libera'],
  ['Pagar', 'ModoBank, na tela do IXC'],
  ['Conferir', 'o banco confirma aqui'],
];

/**
 * Dá para mudar de ideia nos dois sentidos: reprovada volta a ser aprovada e
 * vice-versa, do mesmo jeito que na auditoria do IXC. Só o pagamento
 * confirmado pelo banco é ponto final — e conta que nunca chegou ao IXC não
 * tem o que auditar.
 */
function podeAprovar(c: ContaPagar): boolean {
  if (c.idFnApagarIxc === null || c.status === 'PAGO') return false;
  return c.status !== 'AGUARDANDO_PAGAMENTO' && c.status !== 'APROVADO';
}

function podeReprovar(c: ContaPagar): boolean {
  if (c.idFnApagarIxc === null || c.status === 'PAGO') return false;
  return c.status !== 'REPROVADO';
}

/** O que dizer depois de conferir uma conta no IXC. */
function resumoDaVerificacao(r: ResultadoSincronizacao): string {
  if (r.removida) {
    return 'Essa conta não existe mais no IXC — foi apagada daqui também.';
  }
  if (r.mudouStatus && r.conta) {
    return `O IXC mudou a situação: agora está "${STATUS_LABEL[r.conta.status]}".`;
  }
  return 'Nada mudou no IXC: a conta segue como está.';
}

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
    onSuccess: (d, args) => {
      const nomes: Record<string, string> = {
        aprovar: 'Conta aprovada — no IXC também.',
        reprovar: 'Conta reprovada — no IXC também.',
        enviar: 'Conta reenviada ao IXC.',
      };
      setFeedback(
        args.op === 'sincronizar'
          ? resumoDaVerificacao(d as ResultadoSincronizacao)
          : (nomes[args.op] ?? 'Pronto.'),
      );
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/contas-pagar/${id}`)).data,
    onSuccess: () => {
      setFeedback('Conta apagada aqui e no IXC.');
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const sincronizarTudo = useMutation({
    mutationFn: async () =>
      (
        await api.post<ResumoSincronizacao>(
          '/contas-pagar/sincronizar-pendentes',
        )
      ).data,
    onSuccess: (d) => {
      const partes = [`${d.verificadas} conta(s) verificadas no IXC`];
      if (d.pagas > 0) partes.push(`${d.pagas} o banco acabou de confirmar`);
      const outras = d.atualizadas - d.pagas;
      if (outras > 0) partes.push(`${outras} mudaram de situação lá`);
      if (d.removidas > 0) {
        partes.push(`${d.removidas} não existem mais lá e saíram daqui`);
      }
      if (partes.length === 1) partes.push('nada mudou');
      setFeedback(`${partes.join(' — ')}.`);
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  function aprovar(c: ContaPagar) {
    const mudandoDeIdeia = c.status !== 'AGUARDANDO_APROVACAO';
    const motivo = prompt(
      mudandoDeIdeia
        ? `Voltar atrás e aprovar a conta de ${c.beneficiarioNome}. Motivo:`
        : 'Motivo da aprovação:',
      'Aprovado',
    );
    if (motivo !== null) acao.mutate({ id: c.id, op: 'aprovar', motivo });
  }

  function reprovar(c: ContaPagar) {
    const mudandoDeIdeia = c.status !== 'AGUARDANDO_APROVACAO';
    const motivo = prompt(
      mudandoDeIdeia
        ? `Voltar atrás e reprovar a conta de ${c.beneficiarioNome}. Motivo:`
        : 'Motivo da reprovação:',
    );
    if (motivo) acao.mutate({ id: c.id, op: 'reprovar', motivo });
  }

  function apagar(c: ContaPagar) {
    const ok = confirm(
      `Apagar a conta de ${c.beneficiarioNome} — ${formatBRL(c.valor)}?\n\n` +
        (c.idFnApagarIxc
          ? 'Ela sai daqui e o lançamento é apagado no IXC. Não dá para desfazer.'
          : 'Ela nunca chegou ao IXC, então só sai daqui.'),
    );
    if (ok) excluir.mutate(c.id);
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
        descricao="Cada conta nasce aqui, passa pela auditoria e só vira dinheiro quando o banco confirma. O que você faz nesta tela vale no IXC — e o que mudar lá volta no botão Verificar."
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
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {podeAprovar(c) && (
                        <button
                          onClick={() => aprovar(c)}
                          className="btn btn-p bg-brand-600 text-white hover:bg-brand-700"
                        >
                          Aprovar
                        </button>
                      )}
                      {podeReprovar(c) && (
                        <button
                          onClick={() => reprovar(c)}
                          className="btn btn-p border border-rose-200 text-rose-600 hover:bg-rose-50"
                        >
                          Reprovar
                        </button>
                      )}
                      {(c.status === 'ERRO' || c.status === 'RASCUNHO') && (
                        <button
                          onClick={() => acao.mutate({ id: c.id, op: 'enviar' })}
                          className="btn btn-p bg-amber-500 text-white hover:bg-amber-600"
                        >
                          Reenviar
                        </button>
                      )}
                      {c.idFnApagarIxc !== null && (
                        <button
                          onClick={() =>
                            acao.mutate({ id: c.id, op: 'sincronizar' })
                          }
                          title="Traz do IXC o que mudou por lá: pagamento, aprovação, reprovação ou exclusão"
                          className="btn btn-neutro btn-p"
                        >
                          Verificar
                        </button>
                      )}
                      {c.status !== 'PAGO' && (
                        <button
                          onClick={() => apagar(c)}
                          disabled={excluir.isPending}
                          title="Apaga aqui e no IXC"
                          className="btn btn-sutil btn-p hover:bg-rose-50 hover:text-rose-600"
                        >
                          Excluir
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
