import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Aviso,
  CabecalhoPagina,
  CampoDinheiro,
  Pagina,
  Selo,
  Vazio,
  type Tom,
} from '../components/ui';
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

// ---------------------------------------------------------------------------
// A régua: o saldo salarial aberto termo a termo, do jeito que se confere uma
// conta no papel. É a peça central da tela — se um número surpreende, é aqui
// que a pessoa descobre de onde ele veio.
// ---------------------------------------------------------------------------
interface Termo {
  rotulo: string;
  valor: number;
  nota?: string;
  sinal: '+' | '−';
}

function Regua({
  c,
  descontarAdiantamento,
}: {
  c: ComposicaoSalario;
  descontarAdiantamento: boolean;
}) {
  const termos: Termo[] = [
    {
      rotulo: c.usouValorAReceber ? 'A receber na folha' : 'Salário base',
      valor: c.salarioBase,
      sinal: '+',
    },
  ];
  if (c.comissao > 0) {
    termos.push({
      rotulo: 'Comissão',
      valor: c.comissao,
      nota: `${c.vendas} × ${formatBRL(c.valorPorVenda)}`,
      sinal: '+',
    });
  }
  if (c.horasExtras > 0) {
    termos.push({ rotulo: 'Horas extras', valor: c.horasExtras, sinal: '+' });
  }
  if (c.valesCredito > 0) {
    termos.push({
      rotulo: 'Acerto a favor',
      valor: c.valesCredito,
      sinal: '+',
    });
  }
  if (c.descontos > 0) {
    termos.push({ rotulo: 'Descontos fixos', valor: c.descontos, sinal: '−' });
  }
  if (c.vales > 0) {
    termos.push({ rotulo: 'Vale do mês', valor: c.vales, sinal: '−' });
  }
  if (c.adiantamentoDescontado > 0 && descontarAdiantamento) {
    termos.push({
      rotulo: 'Adiantamento dia 25',
      valor: c.adiantamentoDescontado,
      sinal: '−',
    });
  }

  const saldo = descontarAdiantamento
    ? c.saldo
    : arredondar(c.saldo + c.adiantamentoDescontado);

  // Um termo só: o salário fala por si.
  if (termos.length === 1) return null;

  return (
    <div className="mb-4 overflow-x-auto rolagem-fina">
      <div className="flex min-w-max items-stretch gap-1">
        {termos.map((t, i) => (
          <div key={t.rotulo} className="flex items-stretch gap-1">
            {i > 0 && (
              <span className="flex items-center px-1 font-display text-lg font-medium text-tinta-300">
                {t.sinal}
              </span>
            )}
            <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-tinta-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-tinta-400">
                {t.rotulo}
              </div>
              <div
                className={`font-display text-[15px] font-semibold leading-tight num ${
                  t.sinal === '−' ? 'text-rose-600' : 'text-tinta-900'
                }`}
              >
                {t.sinal === '−' ? '−' : ''}
                {formatBRL(t.valor)}
              </div>
              {t.nota && (
                <div className="text-[10px] text-tinta-400 num">{t.nota}</div>
              )}
            </div>
          </div>
        ))}
        <span className="flex items-center px-1.5 font-display text-lg font-medium text-tinta-300">
          =
        </span>
        <div className="rounded-lg bg-tinta-900 px-4 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-300">
            A pagar
          </div>
          <div className="font-display text-[15px] font-semibold leading-tight text-white num">
            {formatBRL(saldo)}
          </div>
        </div>
      </div>
    </div>
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
    <label className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs text-tinta-600 ring-1 ring-tinta-100">
      <input
        type="checkbox"
        className="accent-brand-600"
        checked={item.descontarAdiantamento}
        onChange={(e) => onChange(e.target.checked)}
      />
      Descontar o adiantamento do dia 25 (
      <span className="num font-semibold">
        {formatBRL(item.composicao.adiantamentoDescontado)}
      </span>
      ) deste salário
      {!item.descontarAdiantamento && (
        <Selo tom="atencao" pequeno>
          saindo cheio
        </Selo>
      )}
      {naoGerado && item.descontarAdiantamento && (
        <span className="text-amber-700">
          — o dia 25 não saiu nesta competência; confira se a pessoa recebeu.
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
    <p className="mb-4 text-xs text-tinta-500">
      Já acertado nesta competência, fora deste saldo:{' '}
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

/**
 * Avisa quando o salário daquela pessoa já saiu nesta competência. Gerar de
 * novo cria um segundo pagamento — e é justamente por isso que o vale já
 * abatido não é descontado outra vez.
 */
function SeloSalarioGerado({ conta }: { conta: ContaJaGerada | null }) {
  if (!conta) return null;
  return (
    <Selo
      tom={conta.situacao === 'PAGO' ? 'erro' : 'atencao'}
      pequeno
      titulo="Já existe conta a pagar de salário nesta competência. Gerar de novo paga duas vezes — confira em Contas a Pagar antes."
    >
      {conta.situacao === 'PAGO'
        ? `salário já pago${conta.pagoEm ? ` em ${formatData(conta.pagoEm)}` : ''}`
        : `salário já gerado · ${STATUS_LABEL[conta.status].toLowerCase()}`}
    </Selo>
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
        pequeno
        tom={situacao === 'PAGO' ? 'pago' : 'atencao'}
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
      <Selo pequeno tom="pago" titulo="Adiantamento do dia 25 confirmado pelo banco.">
        dia 25 pago{pagoEm ? ` em ${formatData(pagoEm)}` : ''}
      </Selo>
    );
  }
  if (situacao === 'PENDENTE') {
    return (
      <Selo
        pequeno
        tom="atencao"
        titulo="A conta do dia 25 existe, mas o banco ainda não confirmou o pagamento."
      >
        dia 25 ainda não pago
      </Selo>
    );
  }
  const tom: Tom = descontado ? 'erro' : 'neutro';
  return (
    <Selo
      pequeno
      tom={tom}
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
        }. Abrindo Contas a Pagar…`,
      );
      setTimeout(() => navigate('/contas-pagar'), 1200);
    },
    onError: (err) => setFeedback(`Não deu para gerar: ${mensagemErro(err)}`),
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

  const marcados = itens.filter((i) => i.selecionado).length;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Gerar folha"
        titulo={
          modo === 'DIA_25' ? 'Adiantamento do dia 25' : 'Salário do quinto dia'
        }
        descricao={
          modo === 'DIA_25'
            ? 'Só o adiantamento de quem recebe no dia 25.'
            : 'Salário e bônus. Quem recebeu no dia 25 vem com o adiantamento descontado; quem não recebe, com o salário cheio.'
        }
      />

      <div className="surgir surgir-1 card mb-6 flex flex-wrap items-end gap-5 p-5">
        <div>
          <span className="rotulo">Pagamento</span>
          <div className="inline-flex rounded-xl bg-tinta-100 p-1">
            <BotaoModo
              ativo={modo === 'DIA_25'}
              onClick={() => trocarModo('DIA_25')}
            >
              Dia 25
            </BotaoModo>
            <BotaoModo
              ativo={modo === 'QUINTO_DIA'}
              onClick={() => trocarModo('QUINTO_DIA')}
            >
              Quinto dia
            </BotaoModo>
          </div>
        </div>
        <div>
          <label className="rotulo" htmlFor="comp-folha">
            Competência
          </label>
          <input
            id="comp-folha"
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="campo"
          />
        </div>
        <button
          onClick={() => preview.mutate()}
          disabled={preview.isPending}
          className="btn btn-primario"
        >
          {preview.isPending ? 'Calculando…' : 'Calcular prévia'}
        </button>
      </div>

      {feedback && <Aviso tom="marca">{feedback}</Aviso>}

      {comOpcaoDia25.length > 0 && (
        <div className="surgir card mb-6 flex flex-wrap items-center gap-3 p-4 text-sm text-tinta-600">
          <span>
            Adiantamento do dia 25 em{' '}
            <strong className="num text-tinta-900">
              {comOpcaoDia25.length}
            </strong>{' '}
            salário(s) de quem não tem carteira assinada:
          </span>
          <button
            onClick={() => descontarDia25(comOpcaoDia25, true)}
            className="btn btn-neutro btn-p"
          >
            Descontar de todos
          </button>
          <button
            onClick={() => descontarDia25(comOpcaoDia25, false)}
            className="btn btn-neutro btn-p"
          >
            Não descontar de ninguém
          </button>
          <span className="text-xs text-tinta-400">
            Use quando o pagamento do dia 25 não chegou a sair.
          </span>
        </div>
      )}

      {itens.length === 0 && !preview.isPending && (
        <div className="card">
          <Vazio titulo="Nada calculado ainda">
            Escolha o pagamento e a competência e clique em “Calcular prévia”.
            Nada é enviado ao IXC até você conferir.
          </Vazio>
        </div>
      )}

      {itens.length > 0 && (
        <div className="surgir surgir-2 card overflow-hidden">
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th w-10"></th>
                  <th className="th">Pessoa</th>
                  <th className="th text-right">Total a pagar</th>
                </tr>
              </thead>
              {grupos.map((g) => {
                const marcadosGrupo = g.indices.filter(
                  (i) => itens[i].selecionado,
                );
                const todos = marcadosGrupo.length === g.indices.length;
                const aberto = !!abertos[g.funcionarioId];
                const temSalario = g.salarioIdx !== null;
                return (
                  <tbody key={g.funcionarioId}>
                    <tr
                      onClick={() => alternarDetalhe(g.funcionarioId)}
                      className={`linha cursor-pointer ${
                        marcadosGrupo.length === 0 ? 'opacity-45' : ''
                      }`}
                    >
                      <td className="td" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="accent-brand-600"
                          checked={todos}
                          ref={(el) => {
                            if (el) {
                              el.indeterminate =
                                marcadosGrupo.length > 0 && !todos;
                            }
                          }}
                          onChange={() => selecionarGrupo(g.indices, !todos)}
                        />
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-tinta-300 transition-transform ${
                              aberto ? 'rotate-90' : ''
                            }`}
                          >
                            ▸
                          </span>
                          <span className="font-medium text-tinta-900">
                            {g.nome}
                          </span>
                          <span className="text-[11px] uppercase tracking-wider text-tinta-400">
                            {g.indices
                              .map((i) => TIPO_LABEL[itens[i].tipo])
                              .join(' · ')}
                          </span>
                          <SeloAdiantamento
                            modo={modo}
                            adiantamento={g.adiantamento}
                            descontado={descontaDia25(g.salarioIdx)}
                          />
                          {temSalario && (
                            <SeloSalarioGerado
                              conta={itens[g.indices[0]].salarioJaGerado}
                            />
                          )}
                        </div>
                      </td>
                      <td className="td text-right">
                        <span className="valor text-[15px]">
                          {formatBRL(totalDoGrupo(g.indices))}
                        </span>
                      </td>
                    </tr>

                    {aberto && (
                      <tr>
                        <td colSpan={3} className="bg-tinta-50/80 px-5 pb-5 pt-4">
                          {temSalario && (
                            <>
                              <Regua
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
                            <thead>
                              <tr>
                                <th className="th w-10 !py-2"></th>
                                <th className="th !py-2">Lançamento</th>
                                <th className="th !py-2">Conta contábil</th>
                                <th className="th !py-2">
                                  Observação enviada ao IXC
                                </th>
                                <th className="th !py-2 text-right">Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.indices.map((idx) => {
                                const it = itens[idx];
                                return (
                                  <tr
                                    key={idx}
                                    className={`border-t border-tinta-200/70 ${
                                      it.selecionado ? '' : 'opacity-45'
                                    }`}
                                  >
                                    <td className="td !py-2.5">
                                      <input
                                        type="checkbox"
                                        className="accent-brand-600"
                                        checked={it.selecionado}
                                        onChange={() => toggle(idx)}
                                      />
                                    </td>
                                    <td className="td !py-2.5">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-medium text-tinta-800">
                                          {TIPO_LABEL[it.tipo]}
                                        </span>
                                        {it.tipo === 'SALARIO' &&
                                          it.cltComAdiantamento && (
                                            <Selo
                                              pequeno
                                              tom="atencao"
                                              titulo="Carteira assinada: a contabilidade já desconta o adiantamento, então o saldo salarial não é reduzido aqui."
                                            >
                                              carteira assinada
                                            </Selo>
                                          )}
                                        {it.tipo === 'SALARIO' &&
                                          it.composicao.adiantamentoDescontado >
                                            0 &&
                                          it.descontarAdiantamento && (
                                            <Selo
                                              pequeno
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
                                      </div>
                                    </td>
                                    <td className="td !py-2.5 num text-tinta-400">
                                      {it.contaContabil}
                                    </td>
                                    <td className="td !py-2.5 max-w-md text-xs text-tinta-500">
                                      {it.observacao}
                                    </td>
                                    <td className="td !py-2.5 text-right">
                                      <CampoDinheiro
                                        valor={String(it.valor)}
                                        onChange={(v) =>
                                          editarValor(idx, Number(v) || 0)
                                        }
                                        className="campo w-32 py-1.5 text-right"
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

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-tinta-100 bg-white px-5 py-4">
            <div>
              <p className="eyebrow">Total selecionado</p>
              <p className="valor mt-1 font-display text-2xl">
                {formatBRL(totalSelecionado)}
              </p>
              <p className="mt-0.5 text-xs text-tinta-400">
                {marcados} lançamento(s) em {grupos.length} pessoa(s)
              </p>
            </div>
            <button
              onClick={() => gerar.mutate()}
              disabled={gerar.isPending || totalSelecionado <= 0}
              className="btn btn-primario"
            >
              {gerar.isPending ? 'Gerando…' : 'Gerar contas a pagar no IXC'}
            </button>
          </div>
        </div>
      )}
    </Pagina>
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
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
        ativo
          ? 'bg-white text-tinta-900 shadow-sm'
          : 'text-tinta-500 hover:text-tinta-800'
      }`}
    >
      {children}
    </button>
  );
}
