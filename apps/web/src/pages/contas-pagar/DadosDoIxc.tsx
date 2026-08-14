import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Carregando, Janela } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL } from '../../lib/format';
import type { ContaAberta } from '../../lib/types';

/**
 * O título como o IXC o guarda, campo por campo.
 *
 * Não é tela de curiosidade. O nome das colunas do `fn_apagar` muda entre
 * versões do IXC e a documentação do webservice não fecha a lista — o filtro
 * desta seção já errou duas vezes por causa disso, e nas duas a resposta
 * estava num campo que ninguém conseguia olhar. Com esta janela, "por que esta
 * conta aparece aqui?" deixa de ser adivinhação: é só abrir e ver.
 *
 * O botão de copiar existe pelo mesmo motivo — é assim que o registro chega a
 * quem vai corrigir a regra.
 */
export function DadosDoIxc({
  conta,
  onFechar,
}: {
  conta: ContaAberta;
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [verVazios, setVerVazios] = useState(false);

  const bruto = useQuery({
    queryKey: ['conta-bruta', conta.idFnApagar],
    queryFn: async () =>
      (
        await api.get<Record<string, unknown>>(
          `/contas-abertas/${conta.idFnApagar}/bruto`,
        )
      ).data,
    retry: 0,
  });

  const campos = Object.entries(bruto.data ?? {})
    .map(([campo, valor]) => ({ campo, valor: String(valor ?? '') }))
    .filter((c) => verVazios || (c.valor.trim() && c.valor.trim() !== '0'))
    .sort((a, b) => a.campo.localeCompare(b.campo));

  const vazios = Object.keys(bruto.data ?? {}).length - campos.length;

  async function copiar() {
    await navigator.clipboard.writeText(
      JSON.stringify(bruto.data ?? {}, null, 2),
    );
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }

  return (
    <Janela titulo={`Título ${conta.idFnApagar} no IXC`} onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        <div className="rounded-2xl bg-tinta-50 p-4">
          <div className="text-sm text-tinta-500">
            {conta.fornecedor.nome || `Fornecedor ${conta.fornecedor.id ?? '?'}`}
          </div>
          <div className="valor mt-0.5 text-2xl">
            {formatBRL(conta.valorAberto)}
          </div>
        </div>

        {bruto.isLoading && <Carregando texto="Lendo o título no IXC…" />}

        {bruto.error && (
          <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {mensagemErro(bruto.error)}
          </p>
        )}

        {bruto.data && (
          <>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <span className="rotulo mb-0">
                Campos do fn_apagar ({campos.length})
              </span>
              <div className="flex gap-2">
                {vazios > 0 && !verVazios && (
                  <button
                    onClick={() => setVerVazios(true)}
                    className="btn btn-sutil btn-p"
                  >
                    Mostrar os {vazios} vazios
                  </button>
                )}
                <button onClick={copiar} className="btn btn-neutro btn-p">
                  {copiado ? 'Copiado!' : 'Copiar tudo'}
                </button>
              </div>
            </div>

            <div className="mt-2 max-h-[50vh] overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
              <table className="w-full text-sm">
                <tbody>
                  {campos.map(({ campo, valor }) => (
                    <tr key={campo} className="linha">
                      <td className="td num w-1/2 align-top text-xs text-tinta-500">
                        {campo}
                      </td>
                      <td className="td break-all align-top text-tinta-800">
                        {valor || <span className="text-tinta-300">vazio</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="mt-6 flex justify-end">
          <button onClick={onFechar} className="btn btn-neutro">
            Fechar
          </button>
        </div>
      </div>
    </Janela>
  );
}
