import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, mensagemErro } from '../lib/api';
import type { ContaPagar } from '../lib/types';

export function Avulsos() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    nome: '',
    cpfCnpj: '',
    tipoPessoa: 'F',
    chavePix: '',
    valor: '',
    contaContabil: '',
    observacao: '',
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  const criar = useMutation({
    mutationFn: async () => {
      const body = {
        nome: form.nome,
        cpfCnpj: form.cpfCnpj || undefined,
        tipoPessoa: form.tipoPessoa,
        chavePix: form.chavePix || undefined,
        valor: Number(form.valor),
        contaContabil: Number(form.contaContabil),
        observacao: form.observacao,
      };
      return (await api.post<ContaPagar>('/avulsos', body)).data;
    },
    onSuccess: (conta) => {
      setFeedback(
        conta.status === 'ERRO'
          ? `Criado localmente, mas houve erro no IXC: ${conta.erro}`
          : 'Pagamento avulso criado no IXC. Redirecionando…',
      );
      if (conta.status !== 'ERRO') setTimeout(() => navigate('/contas-pagar'), 1200);
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  const valido =
    form.nome.trim().length >= 2 &&
    Number(form.valor) > 0 &&
    Number(form.contaContabil) > 0 &&
    form.observacao.trim().length >= 3;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Pagamentos Avulsos</h1>
      <p className="mb-6 text-sm text-slate-500">
        Pague alguém sem cadastro de funcionário (ex.: patrocínio). O beneficiário é
        criado como fornecedor no IXC automaticamente.
      </p>

      {feedback && (
        <div className="mb-5 max-w-2xl rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {feedback}
        </div>
      )}

      <div className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Nome / Razão social" span2>
            <input
              value={form.nome}
              onChange={(e) => set('nome', e.target.value)}
              className={inputCls}
              placeholder="Ex.: João da Silva"
            />
          </Campo>
          <Campo label="Tipo de pessoa">
            <select
              value={form.tipoPessoa}
              onChange={(e) => set('tipoPessoa', e.target.value)}
              className={inputCls}
            >
              <option value="F">Física</option>
              <option value="J">Jurídica</option>
            </select>
          </Campo>
          <Campo label="CPF / CNPJ">
            <input
              value={form.cpfCnpj}
              onChange={(e) => set('cpfCnpj', e.target.value)}
              className={inputCls}
            />
          </Campo>
          <Campo label="Chave PIX">
            <input
              value={form.chavePix}
              onChange={(e) => set('chavePix', e.target.value)}
              className={inputCls}
            />
          </Campo>
          <Campo label="Conta contábil (id_conta)">
            <input
              type="number"
              value={form.contaContabil}
              onChange={(e) => set('contaContabil', e.target.value)}
              className={inputCls}
              placeholder="Ex.: 13916"
            />
          </Campo>
          <Campo label="Valor (R$)">
            <input
              type="number"
              step="0.01"
              value={form.valor}
              onChange={(e) => set('valor', e.target.value)}
              className={inputCls}
            />
          </Campo>
          <Campo label="Observação" span2>
            <input
              value={form.observacao}
              onChange={(e) => set('observacao', e.target.value)}
              className={inputCls}
              placeholder="Ex.: Patrocínio evento X"
            />
          </Campo>
        </div>
        <button
          onClick={() => criar.mutate()}
          disabled={!valido || criar.isPending}
          className="mt-5 rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
        >
          {criar.isPending ? 'Criando…' : 'Criar pagamento no IXC'}
        </button>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

function Campo({
  label,
  span2,
  children,
}: {
  label: string;
  span2?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      {children}
    </div>
  );
}
