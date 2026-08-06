import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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

function BotaoModo({
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
        ativo
          ? 'bg-brand-600 text-white'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function competenciaAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Os dois pagamentos do mês. */
type ModoPagamento = 'DIA_25' | 'QUINTO_DIA';

/** Perto do dia 25 a folha provável é a do adiantamento. */
function modoInicial(): ModoPagamento {
  return new Date().getDate() >= 20 ? 'DIA_25' : 'QUINTO_DIA';
}

export function Folha() {
  const navigate = useNavigate();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [modo, setModo] = useState<ModoPagamento>(modoInicial());
  const [itens, setItens] = useState<ItemGerar[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** Funcionários com o detalhamento aberto. */
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  const preview = useMutation({
    mutationFn: async () => {
      // Dia 25 paga só o adiantamento; no quinto dia sai o salário (já com o
      // adiantamento descontado de quem recebeu) mais os bônus.
      const body = {
        competencia,
        incluirAdiantamento: modo === 'DIA_25',
        incluirSalario: modo === 'QUINTO_DIA',
        incluirBonus: modo === 'QUINTO_DIA',
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
        flat.length > 0
          ? null
          : modo === 'DIA_25'
            ? 'Ninguém está marcado para receber adiantamento no dia 25.'
            : 'Nenhum salário ou bônus a gerar nesta competência.',
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

  // Uma linha por pessoa (com o total), preservando os índices dos lançamentos
  // que a compõem para o detalhamento e para a geração.
  const grupos = useMemo(() => {
    const porFuncionario = new Map<
      string,
      { funcionarioId: string; nome: string; indices: number[] }
    >();
    itens.forEach((it, idx) => {
      const grupo = porFuncionario.get(it.funcionarioId) ?? {
        funcionarioId: it.funcionarioId,
        nome: it.nome,
        indices: [],
      };
      grupo.indices.push(idx);
      porFuncionario.set(it.funcionarioId, grupo);
    });
    return [...porFuncionario.values()];
  }, [itens]);

  function toggle(idx: number) {
    setItens((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, selecionado: !it.selecionado } : it)),
    );
  }
  function editarValor(idx: number, valor: number) {
    setItens((prev) => prev.map((it, i) => (i === idx ? { ...it, valor } : it)));
  }
  function selecionarGrupo(indices: number[], selecionado: boolean) {
    const alvo = new Set(indices);
    setItens((prev) =>
      prev.map((it, i) => (alvo.has(i) ? { ...it, selecionado } : it)),
    );
  }
  /** Trocar de pagamento invalida a prévia anterior. */
  function trocarModo(novo: ModoPagamento) {
    if (novo === modo) return;
    setModo(novo);
    setItens([]);
    setAbertos({});
    setFeedback(null);
  }
  function alternarDetalhe(funcionarioId: string) {
    setAbertos((prev) => ({ ...prev, [funcionarioId]: !prev[funcionarioId] }));
  }
  /** Total que a pessoa recebe: só o que está marcado. */
  function totalDoGrupo(indices: number[]): number {
    return indices.reduce(
      (s, i) => s + (itens[i].selecionado ? itens[i].valor : 0),
      0,
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Gerar Folha</h1>
      <p className="mb-6 text-sm text-slate-500">
        Calcule os lançamentos da competência e gere as contas a pagar no IXC.
      </p>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Pagamento
            </label>
            <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
              <BotaoModo
                ativo={modo === 'DIA_25'}
                onClick={() => trocarModo('DIA_25')}
              >
                Dia 25 · adiantamento
              </BotaoModo>
              <BotaoModo
                ativo={modo === 'QUINTO_DIA'}
                onClick={() => trocarModo('QUINTO_DIA')}
              >
                Quinto dia · salário
              </BotaoModo>
            </div>
          </div>
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
          <button
            onClick={() => preview.mutate()}
            disabled={preview.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {preview.isPending ? 'Calculando…' : 'Calcular prévia'}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {modo === 'DIA_25'
            ? 'Só o adiantamento de quem recebe no dia 25.'
            : 'Salário e bônus. Quem recebeu no dia 25 vem com o adiantamento descontado; quem não recebe, com o salário cheio.'}
        </p>
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
                  <th className="w-10 px-4 py-3">✓</th>
                  <th className="px-4 py-3">Funcionário</th>
                  <th className="px-4 py-3 text-right">Total a pagar</th>
                </tr>
              </thead>
              {grupos.map((g) => {
                const marcados = g.indices.filter((i) => itens[i].selecionado);
                const todos = marcados.length === g.indices.length;
                const aberto = !!abertos[g.funcionarioId];
                return (
                  <tbody
                    key={g.funcionarioId}
                    className="border-t border-slate-100"
                  >
                    <tr
                      onClick={() => alternarDetalhe(g.funcionarioId)}
                      className={`cursor-pointer hover:bg-slate-50 ${
                        marcados.length === 0 ? 'opacity-40' : ''
                      }`}
                    >
                      <td
                        className="px-4 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={todos}
                          ref={(el) => {
                            if (el) {
                              el.indeterminate = marcados.length > 0 && !todos;
                            }
                          }}
                          onChange={() => selecionarGrupo(g.indices, !todos)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="mr-2 inline-block w-3 text-slate-400">
                          {aberto ? '▾' : '▸'}
                        </span>
                        <span className="font-medium text-slate-700">
                          {g.nome}
                        </span>
                        <span className="ml-2 text-xs text-slate-400">
                          {g.indices
                            .map((i) => TIPO_LABEL[itens[i].tipo])
                            .join(' · ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">
                        {formatBRL(totalDoGrupo(g.indices))}
                      </td>
                    </tr>

                    {aberto && (
                      <tr>
                        <td colSpan={3} className="bg-slate-50 px-4 pb-4 pt-1">
                          <table className="w-full text-sm">
                            <thead className="text-left text-[11px] uppercase text-slate-400">
                              <tr>
                                <th className="w-10 py-1"></th>
                                <th className="py-1">Tipo</th>
                                <th className="py-1">Conta contábil</th>
                                <th className="py-1">Observação</th>
                                <th className="py-1 text-right">Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.indices.map((idx) => {
                                const it = itens[idx];
                                return (
                                  <tr
                                    key={idx}
                                    className={`border-t border-slate-200 ${
                                      it.selecionado ? '' : 'opacity-40'
                                    }`}
                                  >
                                    <td className="py-2">
                                      <input
                                        type="checkbox"
                                        checked={it.selecionado}
                                        onChange={() => toggle(idx)}
                                      />
                                    </td>
                                    <td className="py-2">
                                      {TIPO_LABEL[it.tipo]}
                                      {it.tipo === 'SALARIO' &&
                                        it.cltComAdiantamento && (
                                          <span
                                            title="Carteira assinada: a contabilidade já desconta o adiantamento, então o saldo salarial não é reduzido aqui."
                                            className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                                          >
                                            carteira assinada · sem desconto do dia 25
                                          </span>
                                        )}
                                    </td>
                                    <td className="py-2 text-slate-500">
                                      {it.contaContabil}
                                    </td>
                                    <td className="py-2 text-slate-500">
                                      {it.observacao}
                                    </td>
                                    <td className="py-2 text-right">
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={it.valor}
                                        onChange={(e) =>
                                          editarValor(idx, Number(e.target.value))
                                        }
                                        className="w-28 rounded border border-slate-300 px-2 py-1 text-right"
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
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
