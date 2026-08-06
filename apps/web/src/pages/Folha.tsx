import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, mensagemErro } from '../lib/api';
import { formatBRL } from '../lib/format';
import { TIPO_LABEL } from '../lib/status';
import type { ContaPagar, LancamentoCalculado, PreviewFuncionario } from '../lib/types';

interface ItemGerar extends LancamentoCalculado {
  funcionarioId: string;
  nome: string;
  selecionado: boolean;
  /** Carteira assinada + adiantamento: o saldo sai cheio de propósito. */
  cltComAdiantamento: boolean;
}

function competenciaAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function Folha() {
  const navigate = useNavigate();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [incluir, setIncluir] = useState({
    adiantamento: true,
    salario: true,
    bonus: true,
  });
  const [itens, setItens] = useState<ItemGerar[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  const preview = useMutation({
    mutationFn: async () => {
      const body = {
        competencia,
        incluirAdiantamento: incluir.adiantamento,
        incluirSalario: incluir.salario,
        incluirBonus: incluir.bonus,
      };
      return (
        await api.post<PreviewFuncionario[]>('/contas-pagar/preparar-folha', body)
      ).data;
    },
    onSuccess: (data) => {
      const flat: ItemGerar[] = [];
      for (const f of data) {
        for (const l of f.lancamentos) {
          flat.push({
            ...l,
            funcionarioId: f.funcionarioId,
            nome: f.nome,
            selecionado: true,
            cltComAdiantamento: f.carteiraAssinada && f.recebeAdiantamento,
          });
        }
      }
      setItens(flat);
      setFeedback(
        flat.length === 0
          ? 'Nenhum lançamento gerado para os filtros selecionados.'
          : null,
      );
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const gerar = useMutation({
    mutationFn: async () => {
      const selecionados = itens.filter((i) => i.selecionado);
      const body = {
        itens: selecionados.map((i) => ({
          funcionarioId: i.funcionarioId,
          tipo: i.tipo,
          valor: i.valor,
          contaContabil: i.contaContabil,
          observacao: i.observacao,
          competencia,
        })),
      };
      return (await api.post<ContaPagar[]>('/contas-pagar', body)).data;
    },
    onSuccess: (data) => {
      const comErro = data.filter((c) => c.status === 'ERRO').length;
      setFeedback(
        `${data.length} conta(s) criada(s) no IXC${
          comErro ? `, ${comErro} com erro` : ''
        }. Redirecionando…`,
      );
      setTimeout(() => navigate('/contas-pagar'), 1200);
    },
    onError: (err) => setFeedback(`Erro ao gerar: ${mensagemErro(err)}`),
  });

  const totalSelecionado = itens
    .filter((i) => i.selecionado)
    .reduce((s, i) => s + i.valor, 0);

  function toggle(idx: number) {
    setItens((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, selecionado: !it.selecionado } : it)),
    );
  }
  function editarValor(idx: number, valor: number) {
    setItens((prev) => prev.map((it, i) => (i === idx ? { ...it, valor } : it)));
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Gerar Folha</h1>
      <p className="mb-6 text-sm text-slate-500">
        Calcule os lançamentos da competência e gere as contas a pagar no IXC.
      </p>

      <div className="mb-5 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Competência
          </label>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-4 text-sm">
          {(['adiantamento', 'salario', 'bonus'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={incluir[k]}
                onChange={(e) => setIncluir({ ...incluir, [k]: e.target.checked })}
              />
              {k === 'adiantamento' ? 'Adiantamento' : k === 'salario' ? 'Salário' : 'Bônus'}
            </label>
          ))}
        </div>
        <button
          onClick={() => preview.mutate()}
          disabled={preview.isPending}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {preview.isPending ? 'Calculando…' : 'Calcular prévia'}
        </button>
      </div>

      {feedback && (
        <div className="mb-5 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {feedback}
        </div>
      )}

      {itens.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">✓</th>
                  <th className="px-4 py-3">Funcionário</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Conta contábil</th>
                  <th className="px-4 py-3">Observação</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itens.map((it, idx) => (
                  <tr key={idx} className={it.selecionado ? '' : 'opacity-40'}>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={it.selecionado}
                        onChange={() => toggle(idx)}
                      />
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-700">
                      {it.nome}
                      {it.tipo === 'SALARIO' && it.cltComAdiantamento && (
                        <span
                          title="Carteira assinada: a contabilidade já desconta o adiantamento, então o saldo salarial não é reduzido aqui."
                          className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                        >
                          carteira assinada · sem desconto do dia 25
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">{TIPO_LABEL[it.tipo]}</td>
                    <td className="px-4 py-2 text-slate-500">{it.contaContabil}</td>
                    <td className="px-4 py-2 text-slate-500">{it.observacao}</td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={it.valor}
                        onChange={(e) => editarValor(idx, Number(e.target.value))}
                        className="w-28 rounded border border-slate-300 px-2 py-1 text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-sm text-slate-600">
              Total selecionado:{' '}
              <strong className="text-slate-800">{formatBRL(totalSelecionado)}</strong>
            </span>
            <button
              onClick={() => gerar.mutate()}
              disabled={gerar.isPending || totalSelecionado <= 0}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
            >
              {gerar.isPending ? 'Gerando…' : 'Salvar contas a pagar no IXC'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
