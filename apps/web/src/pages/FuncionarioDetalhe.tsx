import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import { TIPO_LABEL } from '../lib/status';
import type {
  FuncionarioDetalhe as TFunc,
  LancamentoFixo,
  TipoLancamento,
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

          <LancamentosFixosBloco
            funcionarioId={id!}
            lancamentos={data.lancamentosFixos}
          />

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
  const [carteira, setCarteira] = useState(!!data.carteiraAssinada);
  const [recebeAdto, setRecebeAdto] = useState(!!data.recebeAdiantamento);
  const [salario, setSalario] = useState(String(data.salarioBase ?? '0'));
  const [ok, setOk] = useState(false);

  const salvar = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/funcionarios/${funcionarioId}`, {
          carteiraAssinada: carteira,
          recebeAdiantamento: recebeAdto,
          salarioBase: Number(salario),
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
            checked={carteira}
            onChange={(e) => setCarteira(e.target.checked)}
          />
          Carteira assinada (CLT) — adiantamento já descontado pela contabilidade
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={recebeAdto}
            onChange={(e) => setRecebeAdto(e.target.checked)}
          />
          Recebe adiantamento (dia 25)
        </label>
        <div className="flex items-end gap-3">
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

// --- Lançamentos fixos (descontos/adiantamentos/bônus recorrentes) ---
function LancamentosFixosBloco({
  funcionarioId,
  lancamentos,
}: {
  funcionarioId: string;
  lancamentos: LancamentoFixo[];
}) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<TipoLancamento>('DESCONTO');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');

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
        })
      ).data,
    onSuccess: () => {
      setDescricao('');
      setValor('');
      invalidar();
    },
  });

  const remover = useMutation({
    mutationFn: async (lancId: string) =>
      (await api.delete(`/funcionarios/lancamentos/${lancId}`)).data,
    onSuccess: invalidar,
  });

  return (
    <Bloco titulo="Lançamentos fixos (mensais)">
      {lancamentos.length === 0 ? (
        <p className="mb-3 text-sm text-slate-400">Nenhum lançamento fixo.</p>
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
                <td className="py-1.5">{l.descricao}</td>
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
