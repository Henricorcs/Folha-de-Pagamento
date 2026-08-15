import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  LeitorDeCodigo,
  leitorDeCodigoSuportado,
} from '../../components/LeitorDeCodigo';
import { CampoDinheiro, Carregando, Janela, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL } from '../../lib/format';
import {
  TIPOS_CHAVE_PIX,
  type CategoriaDespesa,
  type ConfigFinanceira,
} from '../../lib/types';

/** Um fornecedor achado no IXC pela busca desta tela. */
interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
}

interface DespesaLancada {
  conta: { id: string; idFnApagarIxc: number | null; status: string };
  contas: Array<{ id: string; idFnApagarIxc: number | null }>;
  avisoCategoria: string | null;
}

/** Uma conta de onde o dinheiro sai, como o IXC a tem. */
interface ContaDePagamento {
  id: number;
  nome: string;
  ativa: boolean;
  usual: boolean;
}

/**
 * Os tipos que o IXC entende. É lista fechada de propósito: o rótulo vai exato
 * para o `fn_apagar.tipo_pagamento`, e um tipo inventado aqui vira uma conta
 * que o financeiro de lá não sabe pagar.
 */
const TIPOS_DE_PAGAMENTO = [
  {
    valor: 'Pix',
    rotulo: 'Pix',
    nota: 'O banco paga pela chave — ou pelo copia e cola do QR.',
  },
  {
    valor: 'Boleto',
    rotulo: 'Boleto',
    nota: 'Precisa da linha digitável; sem ela o IXC não tem como pagar.',
  },
  {
    valor: 'Dinheiro',
    rotulo: 'Em mãos (dinheiro)',
    nota: 'Sai do caixa, não do banco. Escolha o caixa na conta ao lado.',
  },
  { valor: 'Transferência', rotulo: 'Transferência', nota: 'TED ou DOC.' },
  { valor: 'Cartão', rotulo: 'Cartão', nota: 'Cartão da empresa.' },
] as const;

/**
 * O caixa de onde sai o dinheiro entregue em mãos: "CX - Werick" no IXC.
 * Escolher "Dinheiro" e deixar a conta do banco lançaria a saída no lugar
 * errado, e o acerto disso é no IXC, à mão.
 */
const CAIXA_EM_MAOS = 23;

/** Uma parcela na tela, antes de virar conta a pagar. */
interface Parcela {
  /** Valor canônico, como o CampoDinheiro devolve ("1234.56"). */
  valor: string;
  /** "AAAA-MM-DD" */
  vencimento: string;
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
  const [codigoBarras, setCodigoBarras] = useState('');
  const [documento, setDocumento] = useState('');
  const [numeroNota, setNumeroNota] = useState('');
  const [chavePix, setChavePix] = useState('');
  const [tipoChavePix, setTipoChavePix] = useState('');
  const [contaPagamento, setContaPagamento] = useState('');
  /** Qual leitor está aberto: o do boleto, o do QR do PIX, ou nenhum. */
  const [lendo, setLendo] = useState<'boleto' | 'pix' | null>(null);

  /** Repetir todo mês: esta conta vira uma regra, e as próximas nascem sozinhas. */
  const [recorrente, setRecorrente] = useState(false);

  // --- Parcelamento ---
  const [parcelado, setParcelado] = useState(false);
  const [quantasParcelas, setQuantasParcelas] = useState('2');
  /** Dias entre uma parcela e a seguinte: quinzenal ou mensal. */
  const [intervalo, setIntervalo] = useState<15 | 30>(30);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
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
          codigoBarras: digitos(codigoBarras) || undefined,
          documento: documento.trim() || undefined,
          numeroNota: numeroNota.trim() || undefined,
          chavePix: chavePix.trim() || undefined,
          // QR lido é sempre copia e cola: dizer isso ao IXC evita que ele
          // tente ler o EMV como se fosse CPF ou celular.
          tipoChavePix:
            (ehCopiaECola ? 'Código copia e cola' : tipoChavePix) || undefined,
          contaPagamento: contaPagamento ? Number(contaPagamento) : undefined,
          parcelas: parcelado
            ? parcelas.map((p) => ({
                valor: Number(p.valor),
                dataVencimento: p.vencimento,
              }))
            : undefined,
        },
      );
      /*
       * A repetição guarda a regra a partir do MÊS SEGUINTE: a conta deste mês
       * é a que acabou de ser lançada. Registrar a partir do mesmo vencimento
       * faria a rotina gerar hoje mesmo uma segunda conta igual.
       */
      if (recorrente) {
        await api.post('/recorrentes', {
          idFornecedorIxc: fornecedor!.idFornecedor,
          fornecedorNome: fornecedor!.nome,
          valor: Number(valor),
          observacao: observacao.trim(),
          proximoVencimento: mesSeguinte(vencimento),
          contaPagamento: contaPagamento ? Number(contaPagamento) : undefined,
          tipoPagamentoIxc: tipoPagamento.trim() || undefined,
          categoriaId: categoriaId || undefined,
        });
      }

      return data;
    },
    onSuccess: (data) => {
      setLancada(data);
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      void queryClient.invalidateQueries({ queryKey: ['categorias-despesa'] });
      void queryClient.invalidateQueries({ queryKey: ['recorrentes'] });
    },
  });

  const contasPagamento = useQuery({
    queryKey: ['contas-pagamento'],
    queryFn: async () =>
      (
        await api.get<ContaDePagamento[]>('/contas-abertas/contas-pagamento')
      ).data,
  });

  const usuais = (contasPagamento.data ?? []).filter((c) => c.usual);
  const demais = (contasPagamento.data ?? []).filter((c) => !c.usual);
  const nomeDaContaPadrao = contasPagamento.data?.find(
    (c) => c.id === config.data?.contaPagamentoId,
  )?.nome;

  /**
   * Redivide a nota assim que o valor total, a data ou o ritmo mudam.
   *
   * A divisão sobra centavos quase sempre (100 em 3 dá 33,33 três vezes e
   * perde um centavo), e o que sobra vai na primeira parcela: é onde ninguém
   * se incomoda, e a soma fecha com a nota. Editar qualquer linha depois é
   * livre — daí em diante manda o que está na tela.
   */
  function gerarParcelas(
    quantidade: number,
    total: number,
    primeiroVencimento: string,
    dias: number,
  ): Parcela[] {
    if (quantidade < 1 || !primeiroVencimento) return [];
    const centavos = Math.round(total * 100);
    const base = Math.floor(centavos / quantidade);
    const sobra = centavos - base * quantidade;

    return Array.from({ length: quantidade }, (_, i) => ({
      valor: (((i === 0 ? base + sobra : base) / 100) || 0).toFixed(2),
      vencimento: somarDias(primeiroVencimento, dias * i),
    }));
  }

  function refazerParcelas(
    quantidade = Number(quantasParcelas) || 0,
    dias = intervalo,
  ) {
    setParcelas(gerarParcelas(quantidade, Number(valor) || 0, vencimento, dias));
  }

  const somaDasParcelas = parcelas.reduce(
    (s, p) => s + (Number(p.valor) || 0),
    0,
  );
  const diferenca = Math.round((somaDasParcelas - (Number(valor) || 0)) * 100) / 100;

  const ehBoleto = /boleto/i.test(tipoPagamento);
  const ehPix = /pix/i.test(tipoPagamento);
  const boletoValido = [44, 47, 48].includes(digitos(codigoBarras).length);
  const ehCopiaECola = /^0002/.test(chavePix.trim());

  const podeLancar =
    !!fornecedor &&
    Number(valor) > 0 &&
    observacao.trim().length >= 3 &&
    // Boleto com código pela metade não é recusado aqui, mas com código errado
    // sim: a conta chegaria ao IXC com um número que o banco não reconhece.
    (!ehBoleto || !codigoBarras || boletoValido);

  // Depois de lançada a tela vira recibo: a conta já existe no IXC e mostrar o
  // formulário de novo convidaria a lançar a mesma despesa duas vezes.
  if (lancada) {
    return (
      <Janela titulo="Conta lançada" onFechar={onFechar}>
        <div className="text-center">
          <p className="font-display text-lg font-semibold text-tinta-900">
            {lancada.contas.length > 1
              ? `${lancada.contas.length} contas criadas no IXC`
              : 'A conta foi criada no IXC'}
          </p>
          <p className="mt-1 text-sm text-tinta-500">
            {lancada.contas.length > 1
              ? `Títulos ${lancada.contas
                  .map((c) => c.idFnApagarIxc ?? '?')
                  .join(', ')} — uma parcela cada, todas no aguardo da auditoria.`
              : lancada.conta.idFnApagarIxc
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
          {/* Lista fechada, e não campo com sugestão: o rótulo tem de ser
              exatamente um dos que o IXC conhece, e digitar livre era convite
              a criar um tipo que o financeiro de lá não entende. */}
          <select
            id="tipo-pagamento"
            value={tipoPagamento}
            onChange={(e) => {
              const novo = e.target.value;
              setTipoPagamento(novo);
              // Em mãos o dinheiro sai do caixa, não do banco: a conta do
              // caixa já vem escolhida, porque escolher "Dinheiro" e deixar a
              // conta do banco lançaria a saída no lugar errado.
              if (novo === 'Dinheiro') setContaPagamento(String(CAIXA_EM_MAOS));
              else if (contaPagamento === String(CAIXA_EM_MAOS)) {
                setContaPagamento('');
              }
            }}
            className="campo"
          >
            {TIPOS_DE_PAGAMENTO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
          <p className="ajuda">
            {TIPOS_DE_PAGAMENTO.find((t) => t.valor === tipoPagamento)?.nota ??
              'O rótulo tem de ser o mesmo do seu IXC.'}
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="conta-pagamento">
            Conta de onde sai
          </label>
          <select
            id="conta-pagamento"
            value={contaPagamento}
            onChange={(e) => setContaPagamento(e.target.value)}
            className="campo"
            disabled={contasPagamento.isLoading}
          >
            <option value="">
              {config.data
                ? `Padrão — ${nomeDaContaPadrao ?? config.data.contaPagamentoId}`
                : 'Padrão das Configurações'}
            </option>
            {usuais.length > 0 && (
              <optgroup label="As que costumam pagar">
                {usuais.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            )}
            {demais.length > 0 && (
              <optgroup label="Outras contas do IXC">
                {demais.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                    {c.ativa ? '' : ' (inativa)'}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="ajuda">
            {contasPagamento.error
              ? 'Não deu para ler as contas do IXC — a padrão vale.'
              : 'É de onde o dinheiro sai: o banco, ou o caixa no pagamento em mãos.'}
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

        {/*
          O boleto só aparece quando é boleto que vai pagar: é o campo mais
          longo da tela, e deixá-lo aberto o tempo todo empurraria o resto para
          baixo em toda conta paga por PIX.
        */}
        {ehBoleto && (
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="codigo-barras">
              Linha digitável do boleto
            </label>
            <div className="flex gap-2">
              <input
                id="codigo-barras"
                value={codigoBarras}
                onChange={(e) => setCodigoBarras(e.target.value)}
                className="campo num"
                inputMode="numeric"
                placeholder="Cole os números do boleto — pontos e espaços vão embora"
              />
              {/* No celular, ler é mais rápido e erra menos que digitar 47
                  dígitos. O botão só existe onde o navegador sabe ler. */}
              {leitorDeCodigoSuportado() && (
                <button
                  type="button"
                  onClick={() => setLendo('boleto')}
                  className="btn btn-neutro shrink-0"
                  title="Ler o código de barras com a câmera"
                >
                  Ler boleto
                </button>
              )}
            </div>
            <p
              className={`ajuda ${
                codigoBarras && !boletoValido ? 'text-amber-700' : ''
              }`}
            >
              {!codigoBarras
                ? 'Sem o código, a conta chega ao IXC sem como ser paga por boleto.'
                : boletoValido
                  ? `${digitos(codigoBarras).length} dígitos — ok.`
                  : `${digitos(codigoBarras).length} dígitos. O esperado é 44, 47 ou 48 — confira se copiou a linha inteira.`}
            </p>
          </div>
        )}

        {/*
          A chave só aparece no PIX, e é opcional: em branco, vale a do cadastro
          do fornecedor no IXC. O QR de uma cobrança é outra coisa — o "copia e
          cola" dele vale só para aquele pagamento, com valor e beneficiário
          dentro —, e é por isso que ele fica aqui, na conta, e não no cadastro.
        */}
        {ehPix && (
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="chave-pix">
              Chave PIX desta conta
            </label>
            <div className="flex gap-2">
              <input
                id="chave-pix"
                value={chavePix}
                onChange={(e) => {
                  setChavePix(e.target.value);
                  if (!e.target.value) setTipoChavePix('');
                }}
                className="campo"
                placeholder="Em branco usa a chave do fornecedor no IXC"
              />
              {leitorDeCodigoSuportado() && (
                <button
                  type="button"
                  onClick={() => setLendo('pix')}
                  className="btn btn-neutro shrink-0"
                  title="Ler o QR Code do PIX com a câmera"
                >
                  Ler QR Code
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={tipoChavePix}
                onChange={(e) => setTipoChavePix(e.target.value)}
                className="campo max-w-[220px]"
                disabled={!chavePix}
              >
                <option value="">Tipo pelo formato da chave</option>
                {TIPOS_CHAVE_PIX.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {ehCopiaECola && (
                <span className="text-xs text-emerald-700 dark:text-emerald-300">
                  QR lido: código copia e cola, {chavePix.length} caracteres.
                </span>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="rotulo" htmlFor="documento">
            Documento
          </label>
          <input
            id="documento"
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
            className="campo"
            placeholder="opcional"
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="numero-nota">
            Número da nota
          </label>
          <input
            id="numero-nota"
            value={numeroNota}
            onChange={(e) => setNumeroNota(e.target.value)}
            className="campo"
            placeholder="opcional"
          />
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

        {/* --- Serviço que se repete todo mês --- */}
        {!parcelado && (
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-tinta-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={recorrente}
                onChange={(e) => setRecorrente(e.target.checked)}
              />
              Repetir todo mês — internet, aluguel, contabilidade
            </label>
            {recorrente && (
              <p className="ajuda">
                Esta conta é lançada agora, vencendo em{' '}
                {vencimento ? formatarDia(vencimento) : '—'}. Daí em diante, todo
                mês uma nova nasce sozinha no IXC{' '}
                <strong>5 dias antes de vencer</strong>, com o mesmo valor e a
                mesma categoria. Dá para mudar o valor, desligar ou apagar a
                repetição na aba Recorrentes.
              </p>
            )}
          </div>
        )}

        {/* --- Parcelamento --- */}
        {!recorrente && (
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-tinta-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={parcelado}
              onChange={(e) => {
                setParcelado(e.target.checked);
                if (e.target.checked) refazerParcelas();
                else setParcelas([]);
              }}
            />
            Lançar em parcelas — uma conta a pagar para cada uma no IXC
          </label>

          {parcelado && (
            <div className="mt-2 rounded-xl border border-tinta-100 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="rotulo" htmlFor="quantas">
                    Parcelas
                  </label>
                  <input
                    id="quantas"
                    type="number"
                    min={1}
                    max={60}
                    value={quantasParcelas}
                    onChange={(e) => {
                      setQuantasParcelas(e.target.value);
                      refazerParcelas(Number(e.target.value) || 0);
                    }}
                    className="campo w-24"
                  />
                </div>
                <div>
                  <span className="rotulo">A cada</span>
                  <div className="flex gap-1.5">
                    {([15, 30] as const).map((dias) => (
                      <button
                        key={dias}
                        type="button"
                        onClick={() => {
                          setIntervalo(dias);
                          refazerParcelas(undefined, dias);
                        }}
                        className={
                          intervalo === dias
                            ? 'btn btn-p bg-brand-600 text-white'
                            : 'btn btn-p btn-neutro'
                        }
                      >
                        {dias} dias
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => refazerParcelas()}
                  className="btn btn-neutro btn-p"
                  title="Refaz as parcelas a partir do valor total e do primeiro vencimento"
                >
                  Recalcular
                </button>
                <span className="ml-auto text-xs text-tinta-400">
                  A primeira vence em {vencimento ? formatarDia(vencimento) : '—'}
                </span>
              </div>

              {parcelas.length > 0 && (
                <div className="mt-3 overflow-x-auto rolagem-fina">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="th w-10">#</th>
                        <th className="th">Vencimento</th>
                        <th className="th">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parcelas.map((p, i) => (
                        <tr key={i} className="linha">
                          <td className="td num text-tinta-400">{i + 1}</td>
                          <td className="td">
                            <input
                              type="date"
                              value={p.vencimento}
                              onChange={(e) =>
                                setParcelas((atual) =>
                                  atual.map((x, j) =>
                                    j === i
                                      ? { ...x, vencimento: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                              className="campo py-1"
                            />
                          </td>
                          <td className="td">
                            <CampoDinheiro
                              valor={p.valor}
                              onChange={(v) =>
                                setParcelas((atual) =>
                                  atual.map((x, j) =>
                                    j === i ? { ...x, valor: v } : x,
                                  ),
                                )
                              }
                              className="campo py-1"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className={`ajuda ${diferenca !== 0 ? 'text-amber-700' : ''}`}>
                {diferenca === 0
                  ? `As ${parcelas.length} parcelas somam ${formatBRL(somaDasParcelas)} — igual ao total da nota.`
                  : `As parcelas somam ${formatBRL(somaDasParcelas)}, ${
                      diferenca > 0 ? 'a mais' : 'a menos'
                    } que o total da nota (${formatBRL(Math.abs(diferenca))} de diferença).`}
              </p>
            </div>
          )}
        </div>
        )}

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
              : !(Number(valor) > 0)
                ? 'Informe o valor.'
                : observacao.trim().length < 3
                  ? 'Escreva a observação (o que é essa conta).'
                  : 'Confira a linha digitável do boleto.'}
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

      {lendo && (
        <LeitorDeCodigo
          alvo={lendo}
          onLido={(codigo) => {
            if (lendo === 'boleto') {
              setCodigoBarras(codigo);
            } else {
              setChavePix(codigo);
              setTipoChavePix('Código copia e cola');
            }
            setLendo(null);
          }}
          onFechar={() => setLendo(null)}
        />
      )}
    </Janela>
  );
}

/** Só os dígitos: boleto copiado vem com pontos, espaços e a máscara do banco. */
function digitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

/**
 * Soma dias a uma data "AAAA-MM-DD", em UTC.
 *
 * Em UTC porque o horário de verão, em fuso que o tenha, faria "+30 dias" cair
 * uma hora antes e virar o dia anterior — uma parcela vencendo dia 30 em vez de
 * 31 é erro pequeno na tela e grande no caixa.
 */
function somarDias(iso: string, dias: number): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * O mesmo dia do mês que vem, em "AAAA-MM-DD". Dia 31 em mês de 30 cai no
 * último dia dele — pular para o dia 1º do mês seguinte jogaria a conta de
 * janeiro para março.
 */
function mesSeguinte(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  const ultimoDoProximo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(ano, mes, Math.min(dia, ultimoDoProximo)));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** "AAAA-MM-DD" → "15/08/2026", sem passar por Date (que escorrega de fuso). */
function formatarDia(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

/** Hoje em "AAAA-MM-DD", que é o formato do input de data. */
function hoje(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}
