import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import { STATUS_LABEL, TIPO_LABEL } from '../lib/status';
import type {
  ComposicaoSalario,
  ContaJaGerada,
  ContaPagar,
  LancamentoCalculado,
  ParcelaValeFolha,
  PreviewFuncionario,
  SituacaoAdiantamento,
} from '../lib/types';

interface ItemGerar extends LancamentoCalculado {
  funcionarioId: string;
  nome: string;
  selecionado: boolean;
  /** Carteira assinada + adiantamento: o saldo sai cheio de propósito. */
  cltComAdiantamento: boolean;
  /** Situação do dia 25 desta pessoa nesta competência. */
  adiantamento: SituacaoAdiantamento | null;
  /** Como o saldo salarial foi montado. */
  composicao: ComposicaoSalario;
  /** Parcelas de vale/acerto desta competência. */
  vales: ParcelaValeFolha[];
  /** Conta de salário que já existe nesta competência. */
  salarioJaGerado: ContaJaGerada | null;
  /**
   * Abater o adiantamento do dia 25 deste salário. Vem ligado (é como a API
   * calculou), mas quem não tem carteira assinada pode desligar — ex.: o dia
   * 25 não foi gerado, então não há o que descontar.
   */
  descontarAdiantamento: boolean;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Valor do salário conforme o desconto do dia 25 esteja ligado ou não. */
function saldoComOpcao(it: ItemGerar): number {
  return it.descontarAdiantamento
    ? it.composicao.saldo
    : arredondar(it.composicao.saldo + it.composicao.adiantamentoDescontado);
}

/**
 * Avisa quando o salário daquela pessoa já saiu nesta competência. Gerar de
 * novo cria um segundo pagamento — e é justamente por isso que o vale já
 * abatido não é descontado outra vez.
 */
function SeloSalarioGerado({ conta }: { conta: ContaJaGerada | null }) {
  if (!conta) return null;
  return (
    <Selo
      cor={conta.situacao === 'PAGO' ? 'vermelho' : 'ambar'}
      titulo="Já existe conta a pagar de salário nesta competência. Gerar de novo paga duas vezes — confira em Contas a Pagar antes."
    >
      {conta.situacao === 'PAGO'
        ? `salário já pago${conta.pagoEm ? ` em ${formatData(conta.pagoEm)}` : ''}`
        : `salário já gerado · ${STATUS_LABEL[conta.status].toLowerCase()}`}
    </Selo>
  );
}

/**
 * Escolha de abater ou não o adiantamento do dia 25 daquele salário. Só existe
 * para quem não tem carteira assinada (quem tem já sai sem desconto, porque a
 * contabilidade cuida disso) e serve principalmente para quando o pagamento do
 * dia 25 não chegou a sair.
 */
function OpcaoDia25({
  item,
  onChange,
}: {
  item: ItemGerar | null;
  onChange: (descontar: boolean) => void;
}) {
  if (!item || item.composicao.adiantamentoDescontado <= 0) return null;
  const naoGerado = item.adiantamento?.situacao === 'NAO_GERADO';
  return (
    <label className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <input
        type="checkbox"
        checked={item.descontarAdiantamento}
        onChange={(e) => onChange(e.target.checked)}
      />
      Descontar o adiantamento do dia 25 (
      {formatBRL(item.composicao.adiantamentoDescontado)}) deste salário
      {!item.descontarAdiantamento && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
          saindo cheio
        </span>
      )}
      {naoGerado && item.descontarAdiantamento && (
        <span className="text-amber-700">
          — o dia 25 não foi gerado nesta competência; confira se a pessoa
          recebeu mesmo.
        </span>
      )}
    </label>
  );
}

/** Parcelas de vale que já foram acertadas e por isso não entram no saldo. */
function ValesJaBaixados({ vales }: { vales: ParcelaValeFolha[] }) {
  const baixadas = vales.filter((v) => v.descontada);
  if (baixadas.length === 0) return null;
  return (
    <p className="mb-3 text-xs text-slate-500">
      Já acertado nesta competência (fora deste saldo):{' '}
      {baixadas
        .map(
          (v) =>
            `${v.descricao} ${v.numero}/${v.de} ${
              v.sentido === 'CREDITO' ? '+' : '−'
            }${formatBRL(v.valor)}`,
        )
        .join(' · ')}
      .
    </p>
  );
}

/** Abre o saldo salarial: o que somou e o que saiu. */
function ComposicaoSaldo({
  c,
  descontarAdiantamento,
}: {
  c: ComposicaoSalario;
  descontarAdiantamento: boolean;
}) {
  const partes: { rotulo: string; valor: number; sinal: '+' | '-' }[] = [
    {
      rotulo: c.usouValorAReceber ? 'A receber na folha' : 'Salário base',
      valor: c.salarioBase,
      sinal: '+',
    },
  ];
  if (c.comissao > 0) {
    partes.push({
      rotulo: `Comissão (${c.vendas} × ${formatBRL(c.valorPorVenda)})`,
      valor: c.comissao,
      sinal: '+',
    });
  }
  if (c.horasExtras > 0) {
    partes.push({ rotulo: 'Horas extras', valor: c.horasExtras, sinal: '+' });
  }
  if (c.valesCredito > 0) {
    partes.push({
      rotulo: 'Acerto a favor da pessoa',
      valor: c.valesCredito,
      sinal: '+',
    });
  }
  if (c.descontos > 0) {
    partes.push({ rotulo: 'Descontos fixos', valor: c.descontos, sinal: '-' });
  }
  if (c.vales > 0) {
    partes.push({ rotulo: 'Vale (parcela do mês)', valor: c.vales, sinal: '-' });
  }
  if (c.adiantamentoDescontado > 0 && descontarAdiantamento) {
    partes.push({
      rotulo: 'Adiantamento do dia 25',
      valor: c.adiantamentoDescontado,
      sinal: '-',
    });
  }
  const saldo = descontarAdiantamento
    ? c.saldo
    : Math.round((c.saldo + c.adiantamentoDescontado) * 100) / 100;

  // Só salário base: não há o que explicar.
  if (partes.length === 1) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
      {partes.map((p, i) => (
        <span key={p.rotulo} className="whitespace-nowrap">
          {i > 0 && <span className="mr-1 text-slate-400">{p.sinal}</span>}
          {p.rotulo}{' '}
          <strong
            className={p.sinal === '-' ? 'text-red-600' : 'text-slate-800'}
          >
            {formatBRL(p.valor)}
          </strong>
        </span>
      ))}
      <span className="whitespace-nowrap">
        <span className="mr-1 text-slate-400">=</span>
        <strong className="text-slate-800">{formatBRL(saldo)}</strong>
      </span>
    </div>
  );
}

/**
 * Diz se o adiantamento do dia 25 daquela pessoa já saiu. No quinto dia é o
 * que justifica (ou desmente) o desconto no salário; no dia 25 serve de aviso
 * para não gerar o mesmo pagamento duas vezes.
 */
function SeloAdiantamento({
  modo,
  adiantamento,
  descontado,
}: {
  modo: ModoPagamento;
  adiantamento: SituacaoAdiantamento | null;
  /** Se o desconto está mesmo valendo — pode ter sido desligado na tela. */
  descontado: boolean;
}) {
  if (!adiantamento) return null;
  const { situacao, valor, pagoEm } = adiantamento;

  if (modo === 'DIA_25') {
    if (situacao === 'NAO_GERADO') return null;
    return (
      <Selo
        cor={situacao === 'PAGO' ? 'verde' : 'ambar'}
        titulo="Este adiantamento já foi gerado nesta competência — gerar de novo duplica o pagamento."
      >
        {situacao === 'PAGO'
          ? `já pago${pagoEm ? ` em ${formatData(pagoEm)}` : ''}`
          : 'já gerado · aguardando pagamento'}
      </Selo>
    );
  }

  if (situacao === 'PAGO') {
    return (
      <Selo cor="verde" titulo="Adiantamento do dia 25 confirmado pelo banco.">
        dia 25 pago{pagoEm ? ` em ${formatData(pagoEm)}` : ''}
      </Selo>
    );
  }
  if (situacao === 'PENDENTE') {
    return (
      <Selo
        cor="ambar"
        titulo="A conta do dia 25 existe, mas o banco ainda não confirmou o pagamento."
      >
        dia 25 ainda não pago
      </Selo>
    );
  }
  return (
    <Selo
      cor={descontado ? 'vermelho' : 'cinza'}
      titulo={
        descontado
          ? `Não há conta a pagar do dia 25 nesta competência, mas ${formatBRL(valor)} estão sendo descontados do salário. Confira antes de gerar.`
          : 'Não há conta a pagar do dia 25 nesta competência.'
      }
    >
      dia 25 não gerado{descontado ? ` · ${formatBRL(valor)} descontados` : ''}
    </Selo>
  );
}

const CORES_SELO = {
  verde: 'bg-green-100 text-green-700',
  ambar: 'bg-amber-100 text-amber-700',
  vermelho: 'bg-red-100 text-red-700',
  cinza: 'bg-slate-100 text-slate-500',
} as const;

function Selo({
  cor,
  titulo,
  children,
}: {
  cor: keyof typeof CORES_SELO;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={titulo}
      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${CORES_SELO[cor]}`}
    >
      {children}
    </span>
  );
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
          // Pagamento que já existe na competência vem desmarcado: o certo é
          // conferir em Contas a Pagar antes de gerar outro.
          const jaExiste =
            (l.tipo === 'SALARIO' && !!f.salarioJaGerado) ||
            (l.tipo === 'ADIANTAMENTO' &&
              !!f.adiantamento &&
              f.adiantamento.situacao !== 'NAO_GERADO');
          flat.push({
            ...l,
            funcionarioId: f.funcionarioId,
            nome: f.nome,
            selecionado: !jaExiste,
            cltComAdiantamento: f.carteiraAssinada && f.recebeAdiantamento,
            adiantamento: f.adiantamento,
            composicao: f.composicao,
            vales: f.vales,
            salarioJaGerado: f.salarioJaGerado,
            descontarAdiantamento: true,
          });
        }
      }
      setItens(flat);
      const jaGerados = flat.filter((i) => !i.selecionado).length;
      setFeedback(
        flat.length === 0
          ? modo === 'DIA_25'
            ? 'Ninguém está marcado para receber adiantamento no dia 25.'
            : 'Nenhum salário ou bônus a gerar nesta competência.'
          : jaGerados > 0
            ? `${jaGerados} pagamento(s) já existem nesta competência e vieram desmarcados — marque só se quiser mesmo gerar de novo.`
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

  // Uma linha por pessoa (com o total), preservando os índices dos lançamentos
  // que a compõem para o detalhamento e para a geração.
  const grupos = useMemo(() => {
    const porFuncionario = new Map<
      string,
      {
        funcionarioId: string;
        nome: string;
        indices: number[];
        adiantamento: SituacaoAdiantamento | null;
        /** Índice do lançamento de SALÁRIO, onde mora a opção do dia 25. */
        salarioIdx: number | null;
      }
    >();
    itens.forEach((it, idx) => {
      const grupo = porFuncionario.get(it.funcionarioId) ?? {
        funcionarioId: it.funcionarioId,
        nome: it.nome,
        indices: [],
        adiantamento: it.adiantamento,
        salarioIdx: null,
      };
      grupo.indices.push(idx);
      if (it.tipo === 'SALARIO') grupo.salarioIdx = idx;
      porFuncionario.set(it.funcionarioId, grupo);
    });
    return [...porFuncionario.values()];
  }, [itens]);

  /** O desconto do dia 25 está valendo para essa pessoa? */
  function descontaDia25(salarioIdx: number | null): boolean {
    if (salarioIdx === null) return false;
    const it = itens[salarioIdx];
    return it.descontarAdiantamento && it.composicao.adiantamentoDescontado > 0;
  }

  /**
   * Índices dos salários em que dá para escolher descontar o dia 25 ou não.
   * Só SALÁRIO: a composição existe em todo item, mas o abatimento só acontece
   * ali (no modo dia 25 não há salário nenhum na lista).
   */
  const comOpcaoDia25 = itens
    .map((it, i) => ({ it, i }))
    .filter(
      ({ it }) =>
        it.tipo === 'SALARIO' && it.composicao.adiantamentoDescontado > 0,
    )
    .map(({ i }) => i);

  function toggle(idx: number) {
    setItens((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, selecionado: !it.selecionado } : it)),
    );
  }
  function editarValor(idx: number, valor: number) {
    setItens((prev) => prev.map((it, i) => (i === idx ? { ...it, valor } : it)));
  }
  /**
   * Liga/desliga o abatimento do dia 25 num salário e recalcula o valor. Só
   * aparece para quem não tem carteira assinada — quem tem já sai sem desconto.
   */
  function descontarDia25(indices: number[], descontar: boolean) {
    const alvo = new Set(indices);
    setItens((prev) =>
      prev.map((it, i) => {
        if (!alvo.has(i) || it.tipo !== 'SALARIO') return it;
        if (it.composicao.adiantamentoDescontado <= 0) return it;
        const atualizado = { ...it, descontarAdiantamento: descontar };
        return { ...atualizado, valor: saldoComOpcao(atualizado) };
      }),
    );
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

      {comOpcaoDia25.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          <span>
            Adiantamento do dia 25 em{' '}
            <strong className="text-slate-800">{comOpcaoDia25.length}</strong>{' '}
            salário(s) de quem não tem carteira assinada:
          </span>
          <button
            onClick={() => descontarDia25(comOpcaoDia25, true)}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50"
          >
            Descontar de todos
          </button>
          <button
            onClick={() => descontarDia25(comOpcaoDia25, false)}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50"
          >
            Não descontar de ninguém
          </button>
          <span className="text-xs text-slate-400">
            Use quando o pagamento do dia 25 não chegou a sair.
          </span>
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
                        <SeloAdiantamento
                          modo={modo}
                          adiantamento={g.adiantamento}
                          descontado={descontaDia25(g.salarioIdx)}
                        />
                        {g.indices.some((i) => itens[i].tipo === 'SALARIO') && (
                          <SeloSalarioGerado
                            conta={itens[g.indices[0]].salarioJaGerado}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">
                        {formatBRL(totalDoGrupo(g.indices))}
                      </td>
                    </tr>

                    {aberto && (
                      <tr>
                        <td colSpan={3} className="bg-slate-50 px-4 pb-4 pt-2">
                          {g.indices.some(
                            (i) => itens[i].tipo === 'SALARIO',
                          ) && (
                            <>
                              <ComposicaoSaldo
                                c={itens[g.indices[0]].composicao}
                                descontarAdiantamento={descontaDia25(
                                  g.salarioIdx,
                                )}
                              />
                              <ValesJaBaixados
                                vales={itens[g.indices[0]].vales}
                              />
                              <OpcaoDia25
                                item={
                                  g.salarioIdx !== null
                                    ? itens[g.salarioIdx]
                                    : null
                                }
                                onChange={(descontar) =>
                                  g.salarioIdx !== null &&
                                  descontarDia25([g.salarioIdx], descontar)
                                }
                              />
                            </>
                          )}
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
                                          <Selo
                                            cor="ambar"
                                            titulo="Carteira assinada: a contabilidade já desconta o adiantamento, então o saldo salarial não é reduzido aqui."
                                          >
                                            carteira assinada · sem desconto do dia 25
                                          </Selo>
                                        )}
                                      {it.tipo === 'SALARIO' &&
                                        it.composicao.adiantamentoDescontado >
                                          0 &&
                                        it.descontarAdiantamento && (
                                          <Selo
                                            cor="cinza"
                                            titulo="Valor do dia 25 já abatido deste saldo salarial."
                                          >
                                            −{' '}
                                            {formatBRL(
                                              it.composicao
                                                .adiantamentoDescontado,
                                            )}{' '}
                                            do dia 25
                                          </Selo>
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
