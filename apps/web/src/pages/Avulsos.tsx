import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Pagina,
} from '../components/ui';
import { api, mensagemErro } from '../lib/api';
import { formatBRL } from '../lib/format';
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
  const [erro, setErro] = useState(false);

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
      setErro(conta.status === 'ERRO');
      setFeedback(
        conta.status === 'ERRO'
          ? `Salvo aqui, mas o IXC recusou: ${conta.erro}`
          : 'Pagamento criado no IXC. Abrindo Contas a Pagar…',
      );
      if (conta.status !== 'ERRO')
        setTimeout(() => navigate('/contas-pagar'), 1200);
    },
    onError: (err) => {
      setErro(true);
      setFeedback(mensagemErro(err));
    },
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
    <Pagina>
      <CabecalhoPagina
        secao="Pagamentos avulsos"
        titulo="Pagar quem não é da folha"
        descricao="Patrocínio, serviço pontual, ajuda de custo. O beneficiário vira fornecedor no IXC automaticamente."
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      <div className="max-w-3xl">
        <Bloco className="surgir surgir-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo label="Nome ou razão social" span2>
              <input
                value={form.nome}
                onChange={(e) => set('nome', e.target.value)}
                className="campo"
                placeholder="Ex.: João da Silva"
              />
            </Campo>
            <Campo label="Tipo de pessoa">
              <select
                value={form.tipoPessoa}
                onChange={(e) => set('tipoPessoa', e.target.value)}
                className="campo"
              >
                <option value="F">Física</option>
                <option value="J">Jurídica</option>
              </select>
            </Campo>
            <Campo label="CPF ou CNPJ">
              <input
                value={form.cpfCnpj}
                onChange={(e) => set('cpfCnpj', e.target.value)}
                className="campo"
              />
            </Campo>
            <Campo label="Chave PIX">
              <input
                value={form.chavePix}
                onChange={(e) => set('chavePix', e.target.value)}
                className="campo"
                placeholder="Sem ela o banco não paga"
              />
            </Campo>
            <Campo label="Conta contábil (id_conta)">
              <input
                type="number"
                value={form.contaContabil}
                onChange={(e) => set('contaContabil', e.target.value)}
                className="campo"
                placeholder="Ex.: 13916"
              />
            </Campo>
            <Campo label="Valor (R$)" span2>
              <CampoDinheiro
                valor={form.valor}
                onChange={(v) => set('valor', v)}
              />
            </Campo>
            <Campo label="Observação — é o que aparece no IXC" span2>
              <input
                value={form.observacao}
                onChange={(e) => set('observacao', e.target.value)}
                className="campo"
                placeholder="Ex.: patrocínio do campeonato de julho"
              />
            </Campo>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-tinta-100 pt-5">
            <button
              onClick={() => criar.mutate()}
              disabled={!valido || criar.isPending}
              className="btn btn-primario"
            >
              {criar.isPending ? 'Criando…' : 'Criar pagamento no IXC'}
            </button>
            {Number(form.valor) > 0 && (
              <span className="text-sm text-tinta-500">
                Vai sair{' '}
                <strong className="valor text-[15px]">
                  {formatBRL(Number(form.valor))}
                </strong>
              </span>
            )}
          </div>
        </Bloco>
      </div>
    </Pagina>
  );
}

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
      <label className="rotulo">{label}</label>
      {children}
    </div>
  );
}
