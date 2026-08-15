import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CampoDinheiro, Carregando, Janela, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import type { CategoriaDespesa, ConfigFinanceira } from '../../lib/types';

/** Um fornecedor achado no IXC pela busca desta tela. */
interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
}

interface DespesaLancada {
  conta: { id: string; idFnApagarIxc: number | null; status: string };
  avisoCategoria: string | null;
}

/**
 * Lançar uma conta a pagar à mão — energia, aluguel, material —, sem passar
 * pela folha.
 *
 * O fornecedor é escolhido entre os que já existem no IXC porque é ele que o
 * `fn_apagar` exige. Cadastrar um novo daqui encheria a base de duplicados: a
 * Cemar já está lá, o que falta é achá-la.
 */
export function NovaDespesa({ onFechar }: { onFechar: () => void }) {
  const queryClient = useQueryClient();

  const [termo, setTermo] = useState('');
  const [fornecedor, setFornecedor] = useState<FornecedorIxc | null>(null);
  const [valor, setValor] = useState('');
  const [emissao, setEmissao] = useState(hoje);
  const [vencimento, setVencimento] = useState(hoje);
  const [categoriaId, setCategoriaId] = useState('');
  const [tipoPagamento, setTipoPagamento] = useState('');
  const [observacao, setObservacao] = useState('');
  const [lancada, setLancada] = useState<DespesaLancada | null>(null);

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  const config = useQuery({
    queryKey: ['config-financeira'],
    queryFn: async () =>
      (await api.get<ConfigFinanceira>('/config-financeira')).data,
  });

  // O tipo de pagamento começa no padrão das Configurações e fica editável: a
  // folha sai por PIX, mas a conta de energia costuma ser boleto, e mandar o
  // rótulo errado deixa o pagamento preso no IXC.
  useEffect(() => {
    if (config.data && !tipoPagamento) {
      setTipoPagamento(config.data.tipoPagamentoPadrao);
    }
  }, [config.data, tipoPagamento]);

  // A busca só sai depois que quem digita para de digitar: cada tecla aqui é
  // uma consulta ao IXC, que é lento e não é nosso.
  const [buscaEfetiva, setBuscaEfetiva] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setBuscaEfetiva(termo.trim()), 400);
    return () => clearTimeout(id);
  }, [termo]);

  const fornecedores = useQuery({
    queryKey: ['fornecedores-ixc', buscaEfetiva],
    queryFn: async () =>
      (
        await api.get<FornecedorIxc[]>('/fornecedores-ixc', {
          params: { busca: buscaEfetiva },
        })
      ).data,
    enabled: buscaEfetiva.length >= 2 && !fornecedor,
    retry: 0,
  });

  const lancar = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<DespesaLancada>(
        '/contas-abertas/despesa',
        {
          idFornecedorIxc: fornecedor!.idFornecedor,
          fornecedorNome: fornecedor!.nome,
          valor: Number(valor),
          dataEmissao: emissao,
          dataVencimento: vencimento,
          observacao: observacao.trim(),
          categoriaId: categoriaId || null,
          tipoPagamento: tipoPagamento.trim() || undefined,
        },
      );
      return data;
    },
    onSuccess: (data) => {
      setLancada(data);
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      void queryClient.invalidateQueries({ queryKey: ['categorias-despesa'] });
    },
  });

  const podeLancar =
    !!fornecedor && Number(valor) > 0 && observacao.trim().length >= 3;

  // Depois de lançada a tela vira recibo: a conta já existe no IXC e mostrar o
  // formulário de novo convidaria a lançar a mesma despesa duas vezes.
  if (lancada) {
    return (
      <Janela titulo="Conta lançada" onFechar={onFechar}>
        <div className="text-center">
          <p className="font-display text-lg font-semibold text-tinta-900">
            A conta foi criada no IXC
          </p>
          <p className="mt-1 text-sm text-tinta-500">
            {lancada.conta.idFnApagarIxc
              ? `Título nº ${lancada.conta.idFnApagarIxc}, no aguardo da auditoria do IXC como qualquer outra.`
              : 'A conta foi salva aqui, mas o IXC ainda não devolveu o número dela.'}
          </p>
          {lancada.avisoCategoria && (
            <p className="mx-auto mt-4 max-w-md rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {lancada.avisoCategoria}
            </p>
          )}
          <button onClick={onFechar} className="btn btn-primario mt-6">
            Voltar para a lista
          </button>
        </div>
      </Janela>
    );
  }

  return (
    <Janela titulo="Lançar conta a pagar" onFechar={onFechar}>
      <p className="mb-5 text-sm leading-relaxed text-tinta-500">
        Uma conta só, lançada à mão — energia, aluguel, uma compra. Ela vira
        conta a pagar no IXC na hora, pelo mesmo caminho da folha, e de lá segue
        para a auditoria como todas as outras.
      </p>

      {/* --- Fornecedor --- */}
      <div className="mb-5">
        <label className="rotulo" htmlFor="fornecedor">
          Fornecedor no IXC
        </label>
        {fornecedor ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-tinta-100 bg-tinta-50 px-4 py-3">
            <div className="min-w-0">
              <div className="font-semibold text-tinta-900">
                {fornecedor.nome}
              </div>
              <div className="num text-xs text-tinta-500">
                nº {fornecedor.idFornecedor}
                {fornecedor.cpfCnpj ? ` · ${fornecedor.cpfCnpj}` : ''}
              </div>
            </div>
            <button
              onClick={() => {
                setFornecedor(null);
                setTermo('');
              }}
              className="btn btn-sutil btn-p"
            >
              Trocar
            </button>
          </div>
        ) : (
          <>
            <input
              id="fornecedor"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Nome, nome fantasia ou CPF/CNPJ"
              className="campo"
              autoFocus
            />
            <p className="ajuda">
              A busca vai ao IXC. Só aparecem fornecedores ativos.
            </p>

            {fornecedores.isFetching && <Carregando texto="Procurando no IXC…" />}

            {fornecedores.error && (
              <p className="mt-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {mensagemErro(fornecedores.error)}
              </p>
            )}

            {fornecedores.data && fornecedores.data.length === 0 && (
              <p className="mt-2 text-sm text-tinta-500">
                Nenhum fornecedor ativo com esse nome. Se ele ainda não existe,
                cadastre-o no IXC — é lá que este app o procura.
              </p>
            )}

            {!!fornecedores.data?.length && (
              <div className="mt-2 max-h-56 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
                {fornecedores.data.map((f) => (
                  <button
                    key={f.idFornecedor}
                    onClick={() => setFornecedor(f)}
                    className="flex w-full items-center justify-between gap-3 border-b border-tinta-100 px-4 py-2.5 text-left last:border-0 hover:bg-tinta-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-tinta-800">
                        {f.nome}
                      </span>
                      {f.nomeFantasia && f.nomeFantasia !== f.nome && (
                        <span className="block truncate text-xs text-tinta-400">
                          {f.nomeFantasia}
                        </span>
                      )}
                    </span>
                    <span className="num shrink-0 text-xs text-tinta-400">
                      {f.cpfCnpj ?? `nº ${f.idFornecedor}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="valor">
            Valor
          </label>
          <CampoDinheiro valor={valor} onChange={setValor} placeholder="0,00" />
        </div>

        <div>
          <label className="rotulo" htmlFor="tipo-pagamento">
            Tipo de pagamento
          </label>
          <input
            id="tipo-pagamento"
            list="tipos-pagamento"
            value={tipoPagamento}
            onChange={(e) => setTipoPagamento(e.target.value)}
            className="campo"
            placeholder="Pix"
          />
          <datalist id="tipos-pagamento">
            <option value="Pix" />
            <option value="Boleto" />
            <option value="Dinheiro" />
            <option value="Transferência" />
            <option value="Cartão" />
          </datalist>
          <p className="ajuda">
            O rótulo tem de ser o mesmo do seu IXC.
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="emissao">
            Emissão
          </label>
          <input
            id="emissao"
            type="date"
            value={emissao}
            onChange={(e) => setEmissao(e.target.value)}
            className="campo"
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="vencimento">
            Vencimento
          </label>
          <input
            id="vencimento"
            type="date"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
            className="campo"
          />
          {vencimento < emissao && (
            <p className="ajuda text-amber-700">
              O vencimento está antes da emissão — confira se é isso mesmo.
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="categoria">
            A que se refere
          </label>
          <select
            id="categoria"
            className="campo"
            value={categoriaId}
            disabled={categorias.isLoading}
            onChange={(e) => setCategoriaId(e.target.value)}
          >
            <option value="">Sem classificação</option>
            {(categorias.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <p className="ajuda">
            É por esta escolha que o painel separa os gastos. Ela fica guardada
            aqui — o IXC não tem onde recebê-la.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="observacao">
            Observação
          </label>
          <textarea
            id="observacao"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
            className="campo"
            placeholder="Energia da fazenda, competência 08/2026"
          />
          <p className="ajuda">
            Vai para o campo de observação do IXC — é o que se lê na lista de
            contas a pagar de lá.
          </p>
        </div>
      </div>

      {lancar.isError && (
        <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {mensagemErro(lancar.error)}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
        {!podeLancar && (
          <span className="mr-auto text-xs text-tinta-400">
            {!fornecedor
              ? 'Escolha o fornecedor para continuar.'
              : Number(valor) > 0
                ? 'Escreva a observação (o que é essa conta).'
                : 'Informe o valor.'}
          </span>
        )}
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => lancar.mutate()}
          disabled={!podeLancar || lancar.isPending}
          className="btn btn-primario"
        >
          {lancar.isPending ? 'Lançando no IXC…' : 'Lançar conta'}
        </button>
      </div>

      {fornecedor && (
        <p className="mt-3 text-right text-xs text-tinta-400">
          A conta vai para o IXC agora.{' '}
          <Selo pequeno tom="atencao">
            some com ela só pelo IXC
          </Selo>
        </p>
      )}
    </Janela>
  );
}

/** Hoje em "AAAA-MM-DD", que é o formato do input de data. */
function hoje(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}
