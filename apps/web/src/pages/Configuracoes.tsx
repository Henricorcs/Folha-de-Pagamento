import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
} from '../components/ui';
import { api, mensagemErro } from '../lib/api';
import type { ConfigFinanceira } from '../lib/types';

export function Configuracoes() {
  const qc = useQueryClient();
  const [form, setForm] = useState<ConfigFinanceira | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

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
      setErro(false);
      setFeedback('Configurações salvas.');
      qc.invalidateQueries({ queryKey: ['config-financeira'] });
      setTimeout(() => setFeedback(null), 2500);
    },
    onError: (err) => {
      setErro(true);
      setFeedback(mensagemErro(err));
    },
  });

  if (!form)
    return (
      <Pagina>
        <Carregando />
      </Pagina>
    );

  function num<K extends keyof ConfigFinanceira>(k: K, v: string) {
    setForm((f) => (f ? { ...f, [k]: Number(v) } : f));
  }
  function txt<K extends keyof ConfigFinanceira>(k: K, v: string) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Configurações"
        titulo="Parâmetros da integração"
        descricao="Tudo o que a folha usa para montar uma conta a pagar no IXC. Mexer aqui muda as próximas gerações, não o que já foi enviado."
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      <div className="max-w-3xl space-y-6">
        <Bloco titulo="IDs da integração" className="surgir surgir-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CampoNum
              label="Conta de pagamento (id_contas)"
              valor={form.contaPagamentoId}
              onChange={(v) => num('contaPagamentoId', v)}
            />
            <CampoNum
              label="Filial (filial_id)"
              valor={form.filialId}
              onChange={(v) => num('filialId', v)}
            />
            <CampoNum
              label="Cidade padrão do fornecedor"
              valor={form.cidadePadraoId}
              onChange={(v) => num('cidadePadraoId', v)}
            />
            <CampoNum
              label="Adiantamento do dia 25 (% do salário base)"
              valor={form.percentualAdiantamento}
              onChange={(v) => num('percentualAdiantamento', v)}
            />
            <div className="sm:col-span-2">
              <label className="rotulo">Tipo de pagamento no fn_apagar</label>
              <input
                value={form.tipoPagamentoPadrao}
                onChange={(e) => txt('tipoPagamentoPadrao', e.target.value)}
                className="campo"
                placeholder='O rótulo exato do seu IXC, ex.: "Pix"'
              />
            </div>
          </div>
        </Bloco>

        <Bloco titulo="Contas contábeis" className="surgir surgir-2">
          <p className="mb-4 text-xs text-tinta-500">
            É o <span className="num">id_conta</span> do planejamento analítico
            — o que separa salário de bônus no relatório do IXC.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CampoNum
              label="Salário"
              valor={form.contaContabilSalario}
              onChange={(v) => num('contaContabilSalario', v)}
            />
            <CampoNum
              label="Adiantamento"
              valor={form.contaContabilAdiantamento}
              onChange={(v) => num('contaContabilAdiantamento', v)}
            />
            <CampoNum
              label="Bônus"
              valor={form.contaContabilBonus}
              onChange={(v) => num('contaContabilBonus', v)}
            />
          </div>
        </Bloco>

        <Bloco titulo="Quem conta como funcionário" className="surgir surgir-3">
          <p className="mb-4 text-xs leading-relaxed text-tinta-500">
            Fornecedor ativo com “Contribuinte ICMS” = Isento entra na folha.
            Confira o resultado antes de importar.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="rotulo">Campo do ICMS</label>
              <input
                value={form.fornecedorCampoIcms}
                onChange={(e) => txt('fornecedorCampoIcms', e.target.value)}
                className="campo"
                placeholder="vazio = detectar"
              />
            </div>
            <div>
              <label className="rotulo">Valores que significam Isento</label>
              <input
                value={form.fornecedorIcmsIsento}
                onChange={(e) => txt('fornecedorIcmsIsento', e.target.value)}
                className="campo"
                placeholder="Ex.: I,ISENTO"
              />
            </div>
            <div>
              <label className="rotulo">Tabela dos dados bancários</label>
              <input
                value={form.fornecedorTabelaBanco}
                onChange={(e) => txt('fornecedorTabelaBanco', e.target.value)}
                className="campo"
                placeholder="vazio = descobrir"
              />
            </div>
          </div>
        </Bloco>

        <Bloco titulo="Observação de cada pagamento" className="surgir surgir-4">
          <p className="mb-4 text-xs text-tinta-500">
            É o texto que a pessoa vê no IXC.{' '}
            <span className="num">{'{competencia}'}</span> vira MM/AAAA.
          </p>
          <div className="space-y-4">
            <CampoTxt
              label="Salário"
              valor={form.obsSalarioTemplate}
              onChange={(v) => txt('obsSalarioTemplate', v)}
            />
            <CampoTxt
              label="Adiantamento"
              valor={form.obsAdiantamentoTemplate}
              onChange={(v) => txt('obsAdiantamentoTemplate', v)}
            />
            <CampoTxt
              label="Bônus"
              valor={form.obsBonusTemplate}
              onChange={(v) => txt('obsBonusTemplate', v)}
            />
          </div>
        </Bloco>

        <button
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </div>
    </Pagina>
  );
}

function CampoNum({
  label,
  valor,
  onChange,
}: {
  label: string;
  valor: number;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="rotulo">{label}</label>
      <input
        type="number"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="campo"
      />
    </div>
  );
}

function CampoTxt({
  label,
  valor,
  onChange,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="rotulo">{label}</label>
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="campo"
      />
    </div>
  );
}
