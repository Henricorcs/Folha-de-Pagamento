import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import { SENTIDO_CLASSE, SENTIDO_CURTO, TIPO_LABEL } from '../lib/status';
import type {
  FuncionarioDetalhe as TFunc,
  Lancamento,
  TipoLancamento,
  ValeComSaldo,
  VariavelMes,
} from '../lib/types';

export function FuncionarioDetalhe() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [observacoes, setObservacoes] = useState('');
  const [chavePix, setChavePix] = useState('');
  const [salvo, setSalvo] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['funcionario', id],
    queryFn: async () => (await api.get<TFunc>(`/funcionarios/${id}`)).data,
    enabled: !!id,
  });

  useEffect(() => {
    if (data) {
      setObservacoes(data.observacoes ?? '');
      setChavePix(data.chavePix ?? '');
    }
  }, [data]);

  const salvar = useMutation({
    mutationFn: async () =>
      (await api.patch(`/funcionarios/${id}`, { observacoes, chavePix })).data,
    onSuccess: () => {
      setSalvo(true);
      qc.invalidateQueries({ queryKey: ['funcionario', id] });
      setTimeout(() => setSalvo(false), 2500);
    },
  });

  if (isLoading) return <div className="p-8 text-slate-400">Carregando…</div>;
  if (isError)
    return <div className="p-8 text-red-500">{mensagemErro(error)}</div>;
  if (!data) return null;

  return (
    <div className="p-8">
      <Link
        to="/funcionarios"
        className="text-sm text-brand-700 hover:underline"
      >
        ← Voltar
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-800">{data.nome}</h1>
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
            data.ativo ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {data.ativo ? 'Ativo' : 'Inativo'}
        </span>
        {data.ixcId && (
          <span className="text-xs text-slate-400">IXC #{data.ixcId}</span>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-6">
          <Bloco titulo="Dados cadastrais" grade>
            <Campo rotulo="CPF/CNPJ" valor={data.cpfCnpj} />
            <Campo rotulo="E-mail" valor={data.email} />
            <Campo rotulo="Telefone" valor={data.telefone} />
            <Campo rotulo="Função" valor={data.funcao} />
            <Campo rotulo="Departamento" valor={data.departamento} />
            <Campo rotulo="Admissão" valor={formatData(data.dataAdmissao)} />
            <Campo
              rotulo="Salário base"
              valor={formatBRL(data.salarioBase)}
            />
          </Bloco>

          <Bloco titulo="Dados bancários" grade>
            <Campo rotulo="Banco" valor={data.banco} />
            <Campo rotulo="Agência" valor={data.agencia} />
            <Campo rotulo="Conta" valor={data.conta} />
            <Campo rotulo="Chave PIX" valor={data.chavePix} />
          </Bloco>

          <ConfigFolhaBloco data={data} funcionarioId={id!} />

          <VariaveisMesBloco
            funcionarioId={id!}
            variaveis={data.variaveisMes ?? []}
            valorPorVendaPadrao={data.valorPorVenda ?? null}
            carteiraAssinada={!!data.carteiraAssinada}
          />

          <ValesBloco funcionarioId={id!} />

          <LancamentosBloco funcionarioId={id!} lancamentos={data.lancamentos} />

          <Bloco titulo="Adiantamentos recentes">
            {data.adiantamentos.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum adiantamento.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="py-1">Data</th>
                    <th className="py-1">Descrição</th>
                    <th className="py-1 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.adiantamentos.map((a) => (
                    <tr key={a.id} className="border-t border-slate-100">
                      <td className="py-1.5">{formatData(a.data)}</td>
                      <td className="py-1.5">{a.descricao}</td>
                      <td className="py-1.5 text-right font-medium">
                        {formatBRL(a.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Bloco>
        </section>

        <section className="space-y-4">
          <Bloco titulo="Notas internas">
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Chave PIX (complementar)
            </label>
            <input
              value={chavePix}
              onChange={(e) => setChavePix(e.target.value)}
              className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Observações
            </label>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <button
              onClick={() => salvar.mutate()}
              disabled={salvar.isPending}
              className="mt-3 w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </button>
            {salvo && (
              <p className="mt-2 text-center text-xs text-green-600">
                Salvo com sucesso.
              </p>
            )}
          </Bloco>
        </section>
      </div>
    </div>
  );
}

function Bloco({
  titulo,
  children,
  grade = false,
}: {
  titulo: string;
  children: React.ReactNode;
  /** Quando true, distribui os filhos em grade de 2 colunas (listas de campos). */
  grade?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {titulo}
      </h2>
      {grade ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function Campo({
  rotulo,
  valor,
}: {
  rotulo: string;
  valor: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-slate-400">{rotulo}</div>
      <div className="text-sm text-slate-700">{valor || '—'}</div>
    </div>
  );
}

// --- Configuração da folha (flags + salário) ---
function ConfigFolhaBloco({
  data,
  funcionarioId,
}: {
  data: TFunc;
  funcionarioId: string;
}) {
  const qc = useQueryClient();
  const [clt, setClt] = useState(!!data.clt);
  const [carteira, setCarteira] = useState(!!data.carteiraAssinada);
  const [recebeAdto, setRecebeAdto] = useState(!!data.recebeAdiantamento);
  const [salario, setSalario] = useState(String(data.salarioBase ?? '0'));
  const [valorAdto, setValorAdto] = useState(data.valorAdiantamento ?? '');
  const [comissao, setComissao] = useState(() =>
    opcaoComissao(data.valorPorVenda),
  );
  const [comissaoOutro, setComissaoOutro] = useState(() =>
    opcaoComissao(data.valorPorVenda) === 'outro'
      ? String(Number(data.valorPorVenda))
      : '',
  );
  const [ok, setOk] = useState(false);

  const valorPorVenda = comissao === 'outro' ? comissaoOutro : comissao;

  const salvar = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/funcionarios/${funcionarioId}`, {
          clt,
          carteiraAssinada: carteira,
          recebeAdiantamento: recebeAdto,
          salarioBase: Number(salario),
          valorAdiantamento: recebeAdto ? valorAdto : '',
          valorPorVenda,
        })
      ).data,
    onSuccess: () => {
      setOk(true);
      qc.invalidateQueries({ queryKey: ['funcionario', funcionarioId] });
      setTimeout(() => setOk(false), 2000);
    },
  });

  return (
    <Bloco titulo="Configuração da folha">
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={clt}
            onChange={(e) => {
              setClt(e.target.checked);
              if (!e.target.checked) setCarteira(false);
            }}
          />
          Contratado como CLT
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={carteira}
            disabled={!clt}
            onChange={(e) => setCarteira(e.target.checked)}
          />
          <span className={clt ? '' : 'text-slate-400'}>
            Carteira assinada — a contabilidade já desconta o adiantamento
          </span>
        </label>
        {clt && !carteira && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            CLT com carteira ainda não assinada: o adiantamento do dia 25
            continua sendo descontado do saldo salarial. Marque “Carteira
            assinada” quando o registro sair.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={recebeAdto}
            onChange={(e) => setRecebeAdto(e.target.checked)}
          />
          Recebe adiantamento (dia 25)
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Salário base (R$)
            </label>
            <input
              type="number"
              step="0.01"
              value={salario}
              onChange={(e) => setSalario(e.target.value)}
              className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {recebeAdto && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Valor do dia 25 (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={valorAdto}
                onChange={(e) => setValorAdto(e.target.value)}
                placeholder="vazio = 40%"
                className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Comissão por venda
            </label>
            <select
              value={comissao}
              onChange={(e) => setComissao(e.target.value)}
              className="w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Não comissiona</option>
              <option value="5">R$ 5,00 por venda</option>
              <option value="50">R$ 50,00 por venda</option>
              <option value="outro">Outro valor…</option>
            </select>
          </div>
          {comissao === 'outro' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Valor por venda (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={comissaoOutro}
                onChange={(e) => setComissaoOutro(e.target.value)}
                className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          )}
          <button
            onClick={() => salvar.mutate()}
            disabled={salvar.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          {ok && <span className="text-xs text-green-600">Salvo.</span>}
        </div>
      </div>
    </Bloco>
  );
}

/** Qual opção do select representa o valor por venda salvo. */
function opcaoComissao(valor: string | null | undefined): string {
  const n = Number(valor ?? 0);
  if (!n) return '';
  if (n === 5) return '5';
  if (n === 50) return '50';
  return 'outro';
}

/** "AAAA-MM" do mês passado — é o mês trabalhado que a folha atual paga. */
function mesTrabalhadoPadrao(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// --- Vendas e horas extras do mês trabalhado ---
function VariaveisMesBloco({
  funcionarioId,
  variaveis,
  valorPorVendaPadrao,
  carteiraAssinada,
}: {
  funcionarioId: string;
  variaveis: VariavelMes[];
  valorPorVendaPadrao: string | null;
  carteiraAssinada: boolean;
}) {
  const qc = useQueryClient();
  const [competencia, setCompetencia] = useState(mesTrabalhadoPadrao());
  const [vendas, setVendas] = useState('');
  const [valorVenda, setValorVenda] = useState('');
  const [horasExtras, setHorasExtras] = useState('');
  const [observacao, setObservacao] = useState('');
  const [ok, setOk] = useState(false);

  const doMes = useMemo(
    () => variaveis.find((v) => v.competencia === competencia) ?? null,
    [variaveis, competencia],
  );

  // Trocar de mês carrega o que já estava lançado nele (ou limpa o formulário).
  useEffect(() => {
    setVendas(doMes && doMes.vendas ? String(doMes.vendas) : '');
    setValorVenda(doMes?.valorPorVenda ? String(Number(doMes.valorPorVenda)) : '');
    setHorasExtras(
      doMes && Number(doMes.horasExtras) ? String(Number(doMes.horasExtras)) : '',
    );
    setObservacao(doMes?.observacao ?? '');
  }, [doMes]);

  const salvar = useMutation({
    mutationFn: async () =>
      (
        await api.put(`/funcionarios/${funcionarioId}/variaveis`, {
          competencia,
          vendas: Number(vendas) || 0,
          valorPorVenda: valorVenda,
          horasExtras: carteiraAssinada ? 0 : Number(horasExtras) || 0,
          observacao,
        })
      ).data,
    onSuccess: () => {
      setOk(true);
      qc.invalidateQueries({ queryKey: ['funcionario', funcionarioId] });
      setTimeout(() => setOk(false), 2000);
    },
  });

  const remover = useMutation({
    mutationFn: async (comp: string) =>
      (await api.delete(`/funcionarios/${funcionarioId}/variaveis/${comp}`)).data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['funcionario', funcionarioId] }),
  });

  const unitario = Number(valorVenda) || Number(valorPorVendaPadrao ?? 0);
  const comissaoPrevista = (Number(vendas) || 0) * unitario;

  return (
    <Bloco titulo="Vendas e horas extras do mês">
      <p className="mb-3 text-xs text-slate-500">
        Lançamento por <strong>mês trabalhado</strong>: o que você registrar em{' '}
        {formatComp(competencia)} entra no saldo salarial da folha do mês
        seguinte, detalhado na observação da conta a pagar.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Mês trabalhado
          </label>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Vendas no mês
          </label>
          <input
            type="number"
            min={0}
            value={vendas}
            onChange={(e) => setVendas(e.target.value)}
            placeholder="0"
            className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Valor por venda (R$)
          </label>
          <input
            type="number"
            step="0.01"
            value={valorVenda}
            onChange={(e) => setValorVenda(e.target.value)}
            placeholder={
              valorPorVendaPadrao
                ? `padrão ${formatBRL(valorPorVendaPadrao)}`
                : 'sem padrão'
            }
            className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {!carteiraAssinada && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Horas extras (R$)
            </label>
            <input
              type="number"
              step="0.01"
              value={horasExtras}
              onChange={(e) => setHorasExtras(e.target.value)}
              placeholder="0,00"
              className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        )}
        <div className="min-w-[160px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Observação
          </label>
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar mês'}
        </button>
        {ok && <span className="text-xs text-green-600">Salvo.</span>}
      </div>

      {carteiraAssinada && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Carteira assinada: as horas extras saem pela contabilidade, então não
          entram no cálculo daqui.
        </p>
      )}
      {comissaoPrevista > 0 && (
        <p className="mt-3 text-sm text-slate-600">
          Comissão de {formatComp(competencia)}:{' '}
          <strong className="text-slate-800">
            {formatBRL(comissaoPrevista)}
          </strong>{' '}
          ({vendas} × {formatBRL(unitario)})
        </p>
      )}

      {variaveis.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="py-1">Mês</th>
              <th className="py-1 text-right">Vendas</th>
              <th className="py-1 text-right">Comissão</th>
              <th className="py-1 text-right">Horas extras</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {variaveis.map((v) => {
              const unit = Number(v.valorPorVenda ?? valorPorVendaPadrao ?? 0);
              return (
                <tr key={v.id} className="border-t border-slate-100">
                  <td className="py-1.5">{formatComp(v.competencia)}</td>
                  <td className="py-1.5 text-right">{v.vendas}</td>
                  <td className="py-1.5 text-right">
                    {formatBRL(v.vendas * unit)}
                  </td>
                  <td className="py-1.5 text-right">
                    {formatBRL(v.horasExtras)}
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => remover.mutate(v.competencia)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      remover
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Bloco>
  );
}

// --- Vales e acertos desta pessoa ---
function ValesBloco({ funcionarioId }: { funcionarioId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['vales', 'funcionario', funcionarioId],
    queryFn: async () =>
      (
        await api.get<ValeComSaldo[]>('/vales', {
          params: { funcionarioId, situacao: 'TODOS' },
        })
      ).data,
  });

  const abertos = (data ?? []).filter(
    (v) => !v.vale.cancelado && !v.quitado,
  );

  return (
    <Bloco titulo="Vales e acertos">
      {isLoading && <p className="text-sm text-slate-400">Carregando…</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-slate-400">
          Nenhum vale ou acerto registrado.
        </p>
      )}
      {data && data.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="py-1">Descrição</th>
              <th className="py-1 text-center">Parcelas</th>
              <th className="py-1 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {data.map((v) => (
              <tr
                key={v.vale.id}
                className={`border-t border-slate-100 ${
                  v.vale.cancelado ? 'opacity-50' : ''
                }`}
              >
                <td className="py-1.5">
                  {v.vale.descricao}
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      SENTIDO_CLASSE[v.vale.sentido]
                    }`}
                  >
                    {SENTIDO_CURTO[v.vale.sentido]}
                  </span>
                  {!v.vale.descontarDaFolha && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      fora da folha
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-center text-slate-600">
                  {v.parcelasDescontadas}/{v.vale.quantidadeParcelas}
                </td>
                <td className="py-1.5 text-right font-medium">
                  {formatBRL(v.saldo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Link to="/vales" className="text-brand-700 hover:underline">
          Registrar vale ou acerto →
        </Link>
        {abertos.length > 0 && (
          <span className="text-xs text-slate-500">
            {abertos.length} em aberto
          </span>
        )}
      </div>
    </Bloco>
  );
}

// --- Lançamentos: fixos (todo mês) e avulsos (só numa competência) ---
function LancamentosBloco({
  funcionarioId,
  lancamentos,
}: {
  funcionarioId: string;
  lancamentos: Lancamento[];
}) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<TipoLancamento>('DESCONTO');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [competencia, setCompetencia] = useState('');

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['funcionario', funcionarioId] });
  }

  const adicionar = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/funcionarios/${funcionarioId}/lancamentos`, {
          tipo,
          descricao,
          valor: Number(valor),
          ...(competencia ? { competencia } : {}),
        })
      ).data,
    onSuccess: () => {
      setDescricao('');
      setValor('');
      setCompetencia('');
      invalidar();
    },
  });

  const remover = useMutation({
    mutationFn: async (lancId: string) =>
      (await api.delete(`/funcionarios/lancamentos/${lancId}`)).data,
    onSuccess: invalidar,
  });

  return (
    <Bloco titulo="Lançamentos (fixos e avulsos)">
      {lancamentos.length === 0 ? (
        <p className="mb-3 text-sm text-slate-400">Nenhum lançamento.</p>
      ) : (
        <table className="mb-4 w-full text-sm">
          <tbody>
            {lancamentos.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-1.5">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                    {TIPO_LABEL[l.tipo]}
                  </span>
                </td>
                <td className="py-1.5">
                  {l.descricao}{' '}
                  <span
                    className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      l.competencia
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-sky-100 text-sky-700'
                    }`}
                  >
                    {l.competencia ? `Avulso ${formatComp(l.competencia)}` : 'Fixo'}
                  </span>
                </td>
                <td className="py-1.5 text-right font-medium">{formatBRL(l.valor)}</td>
                <td className="py-1.5 pl-2 text-right">
                  <button
                    onClick={() => remover.mutate(l.id)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoLancamento)}
          className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        >
          <option value="DESCONTO">Desconto</option>
          <option value="ADIANTAMENTO">Adiantamento</option>
          <option value="BONUS">Bônus</option>
        </select>
        <input
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Descrição"
          className="min-w-[140px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="number"
          step="0.01"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Valor"
          className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div>
          <label className="mb-0.5 block text-[10px] text-slate-400">
            Mês (vazio = fixo)
          </label>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={() => adicionar.mutate()}
          disabled={
            adicionar.isPending || descricao.trim().length < 2 || Number(valor) <= 0
          }
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          Adicionar
        </button>
      </div>
    </Bloco>
  );
}

function formatComp(comp: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  return m ? `${m[2]}/${m[1]}` : comp;
}
