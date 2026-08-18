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
  /*
   * O que dá para consertar daqui. O resto aparece na lista — continua fora da
   * conciliação, e escondê-lo seria pior — mas sem caixa de marcar: ali o
   * dinheiro saiu de uma conta e o título aponta outra, e refazer a baixa
   * mudaria o pagamento de banco.
   */
  const corrigiveis = lista.filter((p) => p.corrigivel);
  const total = corrigiveis
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
    setMarcados(
      marcar ? new Set(corrigiveis.map((p) => p.idFnApagar)) : new Set(),
    );
  }

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contas a Pagar"
        titulo="Pagamentos fora da conciliação"
        descricao="Pagamentos que este app deu por pagos antes de 18/08/2026 e que não aparecem na conciliação bancária do IXC: a baixa foi lançada na conta da despesa em vez da conta de onde o dinheiro saiu. Conta lançada por competência tem duas linhas na movimentação: a da provisão e a do pagamento. Só a do pagamento conta aqui — a provisão fica em outra conta e é assim mesmo."
      />

      {resultado && <Resultado r={resultado} />}

      {corrigir.isError && <Aviso tom="erro">{mensagemErro(corrigir.error)}</Aviso>}

      <Aviso tom="erro">
        <strong>O conserto automático está desligado.</strong> Ele estornava a
        baixa para refazê-la na conta certa, mas o estorno do webservice apaga a
        linha do dinheiro <em>sem</em> desfazer o pagamento — e o serviço, lendo
        “ainda pago”, concluía errado nos dois caminhos. Três títulos ficaram
        com o lançamento pela metade (37015, 36992, 37010): seguem pagos e com
        valor aberto zero, mas falta uma perna na movimentação. Estes precisam
        ser refeitos na tela do IXC.
      </Aviso>

      <Aviso tom="atencao">
        A lista abaixo continua valendo — ela só lê. É por ela que se sabe quais
        pagamentos não chegam à conciliação, para acertar um a um no IXC:
        estornar a baixa por lá e refazê-la escolhendo a conta de onde o dinheiro
        saiu.
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
              {corrigiveis.length !== lista.length && (
                <>
                  {' '}
                  — <strong className="num text-tinta-900">
                    {corrigiveis.length}
                  </strong>{' '}
                  que dá para consertar daqui
                </>
              )}
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
                      {p.corrigivel ? (
                        <input
                          type="checkbox"
                          className="accent-brand-600"
                          checked={marcados.has(p.idFnApagar)}
                          onChange={() => alternar(p.idFnApagar)}
                        />
                      ) : (
                        <span
                          className="text-tinta-300"
                          title="Este não se conserta daqui — ver a coluna ao lado."
                        >
                          —
                        </span>
                      )}
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
                      {/* O nome vem do título — e o título pode estar errado.
                          Quando a linha do pagamento aponta outra conta, é ela
                          que diz por onde o dinheiro passou. */}
                      {p.contaRealNome ? (
                        <>
                          <div className="text-tinta-800">{p.contaRealNome}</div>
                          <div className="text-xs text-amber-700 dark:text-amber-300">
                            o título diz{' '}
                            {p.contaPagamentoNome ?? p.contaPagamento}
                          </div>
                        </>
                      ) : (
                        (p.contaPagamentoNome ?? p.contaPagamento)
                      )}
                    </td>
                    <td className="td">
                      {p.corrigivel ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Selo tom="erro" pequeno titulo="Onde a baixa foi lançada — a conta da despesa.">
                            está em {p.contaAtual}
                          </Selo>
                          <span className="text-tinta-300">→</span>
                          <Selo tom="pago" pequeno titulo="A conta de onde o dinheiro saiu; é dela que a conciliação lê.">
                            vai para {p.contaCerta}
                          </Selo>
                        </div>
                      ) : (
                        <p className="max-w-md text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                          {p.motivo}
                        </p>
                      )}
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
                {marcados.size} de {corrigiveis.length} pagamento(s)
              </p>
            </div>
            <button
              disabled
              title="Desligado: o estorno pelo webservice deixa o lançamento pela metade. Refaça na tela do IXC."
              className="btn btn-primario"
            >
              Refazer no IXC (desligado)
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
