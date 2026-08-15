import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Aviso, CampoDinheiro, Janela } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type { ContaAberta } from '../../lib/types';

/** Uma conta de onde o dinheiro sai, como o IXC a tem. */
interface ContaDePagamento {
  id: number;
  nome: string;
  ativa: boolean;
  usual: boolean;
}

/** O caixa de onde sai o dinheiro entregue em mãos ("CX - Werick" no IXC). */
const CAIXA_EM_MAOS = 23;

const TIPOS_DE_PAGAMENTO = [
  'Pix',
  'Boleto',
  'Dinheiro',
  'Transferência',
  'Cartão',
] as const;

function hojeISO(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/**
 * Pagar em mãos — uma conta ou várias, na mesma janela.
 *
 * A confirmação mostra o que vai sair e de onde antes de qualquer coisa
 * acontecer: é dinheiro saindo do caixa, e uma tela que só diz "pago" depois
 * do fato não dá chance de conferir a lista.
 *
 * O lote vai uma conta por vez no IXC; o que já saiu fica de pé se a seguinte
 * falhar, e a tela diz quais passaram. Desfazer pagamento que deu certo por
 * causa do que não deu seria tirar dinheiro do caixa duas vezes.
 */
export function PagarEmMaos({
  contas,
  onFechar,
}: {
  contas: ContaAberta[];
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [data, setData] = useState(hojeISO);
  const [resultado, setResultado] = useState<{
    pagas: number;
    total: number;
    falhas: Array<{ idFnApagar: number; erro: string }>;
  } | null>(null);

  const contasIxc = useQuery({
    queryKey: ['contas-pagamento'],
    queryFn: async () =>
      (await api.get<ContaDePagamento[]>('/contas-abertas/contas-pagamento'))
        .data,
  });
  const caixa = contasIxc.data?.find((c) => c.id === CAIXA_EM_MAOS);

  const total = contas.reduce((s, c) => s + c.valorAberto, 0);

  const pagar = useMutation({
    mutationFn: async () => {
      const { data: r } = await api.post<{
        pagas: Array<{ idFnApagar: number }>;
        falhas: Array<{ idFnApagar: number; erro: string }>;
        total: number;
      }>('/contas-abertas/pagar-lote', {
        idsFnApagar: contas.map((c) => c.idFnApagar),
        forma: 'EM_MAOS',
        data,
      });
      return r;
    },
    onSuccess: (r) => {
      setResultado({ pagas: r.pagas.length, total: r.total, falhas: r.falhas });
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      void queryClient.invalidateQueries({ queryKey: ['pagas-no-mes'] });
    },
  });

  if (resultado) {
    return (
      <Janela titulo="Pagamento feito" onFechar={onFechar}>
        <p className="font-display text-lg font-semibold text-tinta-900">
          {resultado.pagas === 1
            ? `${formatBRL(resultado.total)} pago e baixado no IXC`
            : `${resultado.pagas} contas pagas — ${formatBRL(resultado.total)}`}
        </p>
        <p className="mt-1 text-sm text-tinta-500">
          Saiu de {caixa?.nome ?? `conta ${CAIXA_EM_MAOS}`}. No IXC as contas
          constam quitadas; estornar, se precisar, é por lá.
        </p>

        {resultado.falhas.length > 0 && (
          <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="font-semibold">
              {resultado.falhas.length} não saíram:
            </p>
            <ul className="mt-1 space-y-1">
              {resultado.falhas.map((f) => (
                <li key={f.idFnApagar}>
                  Título {f.idFnApagar}: {f.erro}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button onClick={onFechar} className="btn btn-primario">
            Fechar
          </button>
        </div>
      </Janela>
    );
  }

  return (
    <Janela
      titulo={contas.length === 1 ? 'Pagar em mãos' : `Pagar ${contas.length} contas em mãos`}
      onFechar={onFechar}
    >
      <div className="rounded-2xl bg-tinta-50 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm text-tinta-500">Vai sair do caixa</div>
            <div className="valor text-3xl">{formatBRL(total)}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-tinta-500">De onde sai</div>
            <div className="font-semibold text-tinta-900">
              {contasIxc.isLoading
                ? 'lendo…'
                : (caixa?.nome ?? `Conta ${CAIXA_EM_MAOS}`)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 max-h-[40vh] overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Fornecedor</th>
              <th className="th">Vencimento</th>
              <th className="th text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {contas.map((c) => (
              <tr key={c.idFnApagar} className="linha">
                <td className="td">
                  <div className="text-tinta-800">
                    {c.fornecedor.nome || `Fornecedor ${c.fornecedor.id ?? '?'}`}
                  </div>
                  {c.observacao && (
                    <div className="text-xs text-tinta-400">{c.observacao}</div>
                  )}
                </td>
                <td className="td num whitespace-nowrap text-tinta-500">
                  {c.vencimento ? formatData(c.vencimento) : '—'}
                </td>
                <td className="td whitespace-nowrap text-right">
                  <span className="valor">{formatBRL(c.valorAberto)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 max-w-[200px]">
        <label className="rotulo" htmlFor="data-pagamento-lote">
          Dia em que saiu
        </label>
        <input
          id="data-pagamento-lote"
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          className="campo"
        />
      </div>

      {pagar.isError && <Aviso tom="erro">{mensagemErro(pagar.error)}</Aviso>}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-tinta-400">
          Cada conta é aprovada na auditoria e baixada no IXC.
        </span>
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => pagar.mutate()}
          disabled={pagar.isPending}
          className="btn btn-primario"
        >
          {pagar.isPending
            ? 'Pagando no IXC…'
            : `Confirmar pagamento de ${formatBRL(total)}`}
        </button>
      </div>
    </Janela>
  );
}

/**
 * Muda um título que ainda está em aberto: o meio de pagamento, a data, o
 * valor. É a tela para quando a conta chegou ao IXC com algo errado e não vale
 * a pena apagar e lançar de novo.
 */
export function EditarConta({
  conta,
  onFechar,
}: {
  conta: ContaAberta;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [valor, setValor] = useState(String(conta.valorAberto));
  const [vencimento, setVencimento] = useState(
    conta.vencimento ? String(conta.vencimento).slice(0, 10) : hojeISO(),
  );
  const [observacao, setObservacao] = useState(conta.observacao ?? '');
  const [tipoPagamento, setTipoPagamento] = useState('');
  const [contaPagamento, setContaPagamento] = useState('');
  const [chavePix, setChavePix] = useState('');
  const [codigoBarras, setCodigoBarras] = useState('');

  const contasIxc = useQuery({
    queryKey: ['contas-pagamento'],
    queryFn: async () =>
      (await api.get<ContaDePagamento[]>('/contas-abertas/contas-pagamento'))
        .data,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const mudancas: Record<string, unknown> = {};
      if (Number(valor) !== conta.valorAberto) mudancas.valor = Number(valor);
      if (vencimento !== String(conta.vencimento ?? '').slice(0, 10)) {
        mudancas.dataVencimento = vencimento;
      }
      if (observacao !== (conta.observacao ?? '')) {
        mudancas.observacao = observacao;
      }
      if (tipoPagamento) mudancas.tipoPagamento = tipoPagamento;
      if (contaPagamento) mudancas.contaPagamento = Number(contaPagamento);
      if (chavePix) mudancas.chavePix = chavePix;
      if (codigoBarras) mudancas.codigoBarras = codigoBarras;

      await api.patch(`/contas-abertas/${conta.idFnApagar}`, mudancas);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      onFechar();
    },
  });

  return (
    <Janela titulo={`Editar — ${conta.fornecedor.nome}`} onFechar={onFechar}>
      <p className="mb-4 text-sm text-tinta-500">
        A mudança vai direto para o título nº {conta.idFnApagar} no IXC. O que
        for deixado em branco fica como está.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="ed-valor">
            Valor
          </label>
          <CampoDinheiro valor={valor} onChange={setValor} />
        </div>
        <div>
          <label className="rotulo" htmlFor="ed-vencimento">
            Vencimento
          </label>
          <input
            id="ed-vencimento"
            type="date"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="ed-tipo">
            Tipo de pagamento
          </label>
          <select
            id="ed-tipo"
            value={tipoPagamento}
            onChange={(e) => {
              setTipoPagamento(e.target.value);
              if (e.target.value === 'Dinheiro') {
                setContaPagamento(String(CAIXA_EM_MAOS));
              }
            }}
            className="campo"
          >
            <option value="">Como está no IXC</option>
            {TIPOS_DE_PAGAMENTO.map((t) => (
              <option key={t} value={t}>
                {t === 'Dinheiro' ? 'Em mãos (dinheiro)' : t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rotulo" htmlFor="ed-conta">
            Conta de onde sai
          </label>
          <select
            id="ed-conta"
            value={contaPagamento}
            onChange={(e) => setContaPagamento(e.target.value)}
            className="campo"
          >
            <option value="">Como está no IXC</option>
            {(contasIxc.data ?? [])
              .filter((c) => c.usual || c.ativa)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        </div>

        {tipoPagamento === 'Pix' && (
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="ed-pix">
              Chave PIX
            </label>
            <input
              id="ed-pix"
              value={chavePix}
              onChange={(e) => setChavePix(e.target.value)}
              className="campo"
              placeholder="Em branco mantém a que está no IXC"
            />
          </div>
        )}

        {tipoPagamento === 'Boleto' && (
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="ed-boleto">
              Linha digitável do boleto
            </label>
            <input
              id="ed-boleto"
              value={codigoBarras}
              onChange={(e) => setCodigoBarras(e.target.value)}
              className="campo num"
              inputMode="numeric"
              placeholder="Em branco mantém o que está no IXC"
            />
          </div>
        )}

        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="ed-obs">
            Observação
          </label>
          <input
            id="ed-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
          />
        </div>
      </div>

      {salvar.isError && <Aviso tom="erro">{mensagemErro(salvar.error)}</Aviso>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando no IXC…' : 'Salvar no IXC'}
        </button>
      </div>
    </Janela>
  );
}

/**
 * Apagar o título no IXC. Pede confirmação com o valor e o fornecedor na
 * frente: a lista tem centenas de linhas parecidas, e o botão de apagar fica a
 * um centímetro do de pagar.
 */
export function ExcluirConta({
  conta,
  onFechar,
}: {
  conta: ContaAberta;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();

  const excluir = useMutation({
    mutationFn: async () => {
      await api.delete(`/contas-abertas/${conta.idFnApagar}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      onFechar();
    },
  });

  return (
    <Janela titulo="Apagar conta no IXC" onFechar={onFechar}>
      <p className="text-sm text-tinta-700">
        Apagar de vez o título nº {conta.idFnApagar} no IXC?
      </p>
      <div className="mt-3 rounded-2xl bg-tinta-50 p-4">
        <div className="font-semibold text-tinta-900">
          {conta.fornecedor.nome}
        </div>
        <div className="valor mt-1 text-2xl">
          {formatBRL(conta.valorAberto)}
        </div>
        {conta.observacao && (
          <div className="mt-1 text-sm text-tinta-500">{conta.observacao}</div>
        )}
        <div className="num mt-1 text-xs text-tinta-400">
          vence {conta.vencimento ? formatData(conta.vencimento) : 'sem data'}
        </div>
      </div>
      <p className="ajuda">
        Some do IXC e desta lista. Não dá para desfazer daqui — só lançando de
        novo.
      </p>

      {excluir.isError && (
        <Aviso tom="erro">{mensagemErro(excluir.error)}</Aviso>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => excluir.mutate()}
          disabled={excluir.isPending}
          className="btn bg-rose-600 text-white hover:bg-rose-500"
        >
          {excluir.isPending ? 'Apagando…' : 'Apagar no IXC'}
        </button>
      </div>
    </Janela>
  );
}
