import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, mensagemErro } from '../lib/api';
import type { ConfigFinanceira } from '../lib/types';

export function Configuracoes() {
  const qc = useQueryClient();
  const [form, setForm] = useState<ConfigFinanceira | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['config-financeira'],
    queryFn: async () =>
      (await api.get<ConfigFinanceira>('/config-financeira')).data,
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const salvar = useMutation({
    mutationFn: async () => (await api.put('/config-financeira', form)).data,
    onSuccess: () => {
      setFeedback('Configurações salvas.');
      qc.invalidateQueries({ queryKey: ['config-financeira'] });
      setTimeout(() => setFeedback(null), 2500);
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  if (!form) return <div className="p-8 text-slate-400">Carregando…</div>;

  function num<K extends keyof ConfigFinanceira>(k: K, v: string) {
    setForm((f) => (f ? { ...f, [k]: Number(v) } : f));
  }
  function txt<K extends keyof ConfigFinanceira>(k: K, v: string) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Configurações financeiras</h1>
      <p className="mb-6 text-sm text-slate-500">
        Parâmetros usados ao gerar contas a pagar no IXC.
      </p>

      {feedback && (
        <div className="mb-5 max-w-2xl rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {feedback}
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        <Bloco titulo="IDs da integração">
          <CampoNum label="Conta de pagamento (id_contas)" valor={form.contaPagamentoId} onChange={(v) => num('contaPagamentoId', v)} />
          <CampoNum label="Filial (filial_id)" valor={form.filialId} onChange={(v) => num('filialId', v)} />
          <CampoNum label="Cidade padrão (fornecedor)" valor={form.cidadePadraoId} onChange={(v) => num('cidadePadraoId', v)} />
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Tipo de pagamento (fn_apagar)
            </label>
            <input
              value={form.tipoPagamentoPadrao}
              onChange={(e) => txt('tipoPagamentoPadrao', e.target.value)}
              className={inputCls}
              placeholder='Ex.: "Dinheiro" ou "Pix"'
            />
          </div>
        </Bloco>

        <Bloco titulo="Contas contábeis (id_conta / planejamento analítico)">
          <CampoNum label="Salário" valor={form.contaContabilSalario} onChange={(v) => num('contaContabilSalario', v)} />
          <CampoNum label="Adiantamento" valor={form.contaContabilAdiantamento} onChange={(v) => num('contaContabilAdiantamento', v)} />
          <CampoNum label="Bônus" valor={form.contaContabilBonus} onChange={(v) => num('contaContabilBonus', v)} />
        </Bloco>

        <Bloco titulo="Filtro de funcionários (cadastro de fornecedor)">
          <div className="sm:col-span-3 -mt-1 text-xs text-slate-500">
            Fornecedor ativo com “Contribuinte ICMS” = Isento é tratado como
            funcionário. Confira o resultado em Funcionários → “Filtro de
            fornecedores” antes de importar.
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Campo do ICMS (vazio = detectar)
            </label>
            <input
              value={form.fornecedorCampoIcms}
              onChange={(e) => txt('fornecedorCampoIcms', e.target.value)}
              className={inputCls}
              placeholder="Ex.: contribuinte_icms"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Valores que significam Isento
            </label>
            <input
              value={form.fornecedorIcmsIsento}
              onChange={(e) => txt('fornecedorIcmsIsento', e.target.value)}
              className={inputCls}
              placeholder="Ex.: I,ISENTO"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Tabela dos dados bancários (vazio = descobrir)
            </label>
            <input
              value={form.fornecedorTabelaBanco}
              onChange={(e) => txt('fornecedorTabelaBanco', e.target.value)}
              className={inputCls}
              placeholder="Ex.: fornecedor_dados_bancarios"
            />
          </div>
        </Bloco>

        <Bloco titulo="Templates de observação ({competencia} → MM/AAAA)">
          <CampoTxt label="Salário" valor={form.obsSalarioTemplate} onChange={(v) => txt('obsSalarioTemplate', v)} />
          <CampoTxt label="Adiantamento" valor={form.obsAdiantamentoTemplate} onChange={(v) => txt('obsAdiantamentoTemplate', v)} />
          <CampoTxt label="Bônus" valor={form.obsBonusTemplate} onChange={(v) => txt('obsBonusTemplate', v)} />
        </Bloco>

        <button
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending}
          className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </div>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {titulo}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{children}</div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';

function CampoNum({ label, valor, onChange }: { label: string; valor: number; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <input type="number" value={valor} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </div>
  );
}

function CampoTxt({ label, valor, onChange }: { label: string; valor: string; onChange: (v: string) => void }) {
  return (
    <div className="sm:col-span-3">
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <input value={valor} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </div>
  );
}
