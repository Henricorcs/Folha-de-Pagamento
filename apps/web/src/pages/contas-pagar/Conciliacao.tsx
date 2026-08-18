import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type { PagamentoTorto, ResultadoDaCorrecao } from '../../lib/types';

/**
 * O conserto dos pagamentos que este app deu por pagos e que não chegaram à
 * conciliação bancária do IXC.
 *
 * A baixa cria duas linhas na movimentação financeira: uma do dinheiro saindo
 * da conta e outra da despesa. A conciliação lê a primeira, e por um erro nosso
 * as duas iam para a conta da despesa — o pagamento constava pago no título e
 * não existia para quem batia o extrato.
 *
 * Consertar é estornar a baixa e refazê-la na conta certa, um título de cada
 * vez. É por isso que esta tela mostra tudo antes e não faz nada sozinha: entre
 * o estorno e a nova baixa o título fica em aberto no IXC.
 */
export function Conciliacao() {
  const queryClient = useQueryClient();
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [resultado, setResultado] = useState<ResultadoDaCorrecao | null>(null);

  const pendentes = useQuery({
    queryKey: ['conciliacao-pendentes'],
    queryFn: async () =>
      (
        await api.get<PagamentoTorto[]>(
          '/contas-abertas/conciliacao/pendentes',
        )
      ).data,
  });

  const corrigir = useMutation({
    mutationFn: async () =>
      (
        await api.post<ResultadoDaCorrecao>(
          '/contas-abertas/conciliacao/corrigir',
          { idsFnApagar: [...marcados] },
        )
      ).data,
    onSuccess: (r) => {
      setResultado(r);
      setMarcados(new Set());
      void queryClient.invalidateQueries({ queryKey: ['conciliacao-pendentes'] });
    },
  });

  const lista = pendentes.data ?? [];
  const total = lista
    .filter((p) => marcados.has(p.idFnApagar))
    .reduce((s, p) => s + p.valor, 0);

  function alternar(id: number) {
    setMarcados((antes) => {
      const novo = new Set(antes);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function marcarTodos(marcar: boolean) {
    setMarcados(marcar ? new Set(lista.map((p) => p.idFnApagar)) : new Set());
  }

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contas a Pagar"
        titulo="Pagamentos fora da conciliação"
        descricao="Pagamentos que este app deu por pagos antes de 18/08/2026 e que não aparecem na conciliação bancária do IXC. A baixa deles foi lançada na conta da despesa em vez da conta de onde o dinheiro saiu."
      />

      {resultado && <Resultado r={resultado} />}

      {corrigir.isError && <Aviso tom="erro">{mensagemErro(corrigir.error)}</Aviso>}

      <Aviso tom="atencao">
        Consertar é <strong>estornar a baixa e refazê-la</strong> no IXC, um
        título de cada vez. Entre uma coisa e outra o título fica em aberto por
        instantes — se algo falhar no meio, a fila para na hora e o título que
        ficou aberto aparece aqui, com o número. Não rode isto junto com alguém
        pagando contas no IXC.
      </Aviso>

      {pendentes.isLoading ? (
        <Bloco>
          <Carregando />
        </Bloco>
      ) : pendentes.isError ? (
        <Aviso tom="erro">{mensagemErro(pendentes.error)}</Aviso>
      ) : lista.length === 0 ? (
        <Bloco className="surgir">
          <Vazio titulo="Nada fora da conciliação">
            Todos os pagamentos que este app fez estão lançados na conta certa.
          </Vazio>
        </Bloco>
      ) : (
        <div className="surgir card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-tinta-100 px-5 py-3 text-sm text-tinta-600">
            <span>
              <strong className="num text-tinta-900">{lista.length}</strong>{' '}
              pagamento(s) fora da conciliação
            </span>
            <button
              onClick={() => marcarTodos(true)}
              className="btn btn-neutro btn-p"
            >
              Marcar todos
            </button>
            <button
              onClick={() => marcarTodos(false)}
              className="btn btn-neutro btn-p"
            >
              Desmarcar todos
            </button>
          </div>

          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th w-10"></th>
                  <th className="th">Beneficiário</th>
                  <th className="th">Saiu em</th>
                  <th className="th">De onde saiu</th>
                  <th className="th">Conta do lançamento</th>
                  <th className="th text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.idFnApagar} className="linha">
                    <td className="td">
                      <input
                        type="checkbox"
                        className="accent-brand-600"
                        checked={marcados.has(p.idFnApagar)}
                        onChange={() => alternar(p.idFnApagar)}
                      />
                    </td>
                    <td className="td">
                      <div className="text-tinta-800">{p.beneficiario}</div>
                      <div className="text-xs text-tinta-400 num">
                        título nº {p.idFnApagar}
                      </div>
                    </td>
                    <td className="td num whitespace-nowrap text-tinta-500">
                      {p.data ? formatData(p.data) : '—'}
                    </td>
                    <td className="td text-tinta-500">
                      {p.contaPagamentoNome ?? p.contaPagamento}
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Selo tom="erro" pequeno titulo="Onde a baixa foi lançada — a conta da despesa.">
                          está em {p.contaAtual}
                        </Selo>
                        <span className="text-tinta-300">→</span>
                        <Selo tom="pago" pequeno titulo="A conta de onde o dinheiro saiu; é dela que a conciliação lê.">
                          vai para {p.contaCerta}
                        </Selo>
                      </div>
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      <span className="valor">{formatBRL(p.valor)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-tinta-100 bg-papel px-5 py-4">
            <div>
              <p className="eyebrow">Marcado</p>
              <p className="valor mt-1 font-display text-2xl">
                {formatBRL(total)}
              </p>
              <p className="mt-0.5 text-xs text-tinta-400">
                {marcados.size} de {lista.length} pagamento(s)
              </p>
            </div>
            <button
              onClick={() => corrigir.mutate()}
              disabled={corrigir.isPending || marcados.size === 0}
              className="btn btn-primario"
            >
              {corrigir.isPending
                ? 'Refazendo no IXC…'
                : `Refazer ${marcados.size} baixa(s) no IXC`}
            </button>
          </div>
        </div>
      )}
    </Pagina>
  );
}

/** O que aconteceu na última passada — o que consertou e, sobretudo, o que não. */
function Resultado({ r }: { r: ResultadoDaCorrecao }) {
  return (
    <>
      {r.emAberto.length > 0 && (
        <Aviso tom="erro">
          <strong>
            {r.emAberto.length} título(s) ficaram EM ABERTO no IXC.
          </strong>{' '}
          O estorno saiu e a nova baixa não. Enquanto estiverem assim eles
          parecem não pagos — e alguém pode pagá-los de novo. Resolva agora, na
          tela do IXC:{' '}
          {r.emAberto
            .map((e) => `nº ${e.idFnApagar} (${e.erro})`)
            .join(' · ')}
          .
          {r.naoTentados.length > 0 && (
            <>
              {' '}
              A fila parou aí: {r.naoTentados.length} pagamento(s) não chegaram
              a ser tentados.
            </>
          )}
        </Aviso>
      )}

      {r.corrigidos.length > 0 && (
        <Aviso tom="marca">
          {r.corrigidos.length} baixa(s) refeitas na conta certa. Confira na
          conciliação do IXC — elas devem aparecer na data em que o dinheiro
          saiu.
        </Aviso>
      )}

      {r.pulados.length > 0 && (
        <Aviso tom="atencao">
          {r.pulados.length} pagamento(s) ficaram como estavam:{' '}
          {r.pulados.map((p) => `nº ${p.idFnApagar} (${p.motivo})`).join(' · ')}
        </Aviso>
      )}
    </>
  );
}
