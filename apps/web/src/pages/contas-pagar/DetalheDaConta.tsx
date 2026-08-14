import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Carregando, Janela, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import { TIPO_LABEL } from '../../lib/status';
import type { ContaAberta, DetalheDoTitulo } from '../../lib/types';

/**
 * A ficha de um débito: o que é, de quem, quanto, quando vence — e, no fim,
 * por que ele aparece nesta lista.
 *
 * Essa última parte não é enfeite técnico. O nome das colunas do `fn_apagar`
 * muda entre versões do IXC e a documentação não fecha a lista; o filtro desta
 * seção já errou duas vezes por isso, e nas duas a resposta estava num campo
 * que ninguém conseguia ver. Aqui os campos que decidem aparecem com o valor
 * que veio do IXC, então discordar do filtro deixa de ser palavra contra
 * palavra.
 */
export function DetalheDaConta({
  conta,
  onFechar,
}: {
  conta: ContaAberta;
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [verTudo, setVerTudo] = useState(false);

  const detalhe = useQuery({
    queryKey: ['conta-bruta', conta.idFnApagar],
    queryFn: async () =>
      (
        await api.get<DetalheDoTitulo>(
          `/contas-abertas/${conta.idFnApagar}/bruto`,
        )
      ).data,
    retry: 0,
  });

  const campos = Object.entries(detalhe.data?.campos ?? {})
    .map(([campo, valor]) => ({ campo, valor: String(valor ?? '') }))
    .filter((c) => c.valor.trim() && c.valor.trim() !== '0')
    .sort((a, b) => a.campo.localeCompare(b.campo));

  async function copiar() {
    await navigator.clipboard.writeText(
      JSON.stringify(detalhe.data?.campos ?? {}, null, 2),
    );
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }

  const parcial = conta.valor > conta.valorAberto + 0.005;

  return (
    <Janela titulo="Detalhe do débito" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        {/* --- O essencial, do tamanho de quem confere de longe --- */}
        <div className="rounded-2xl bg-tinta-50 p-5">
          <div className="text-sm text-tinta-500">Devido a</div>
          <div className="font-display text-lg font-semibold text-tinta-900">
            {conta.fornecedor.nome || `Fornecedor ${conta.fornecedor.id ?? '?'}`}
          </div>
          <div className="valor mt-2 text-3xl">
            {formatBRL(conta.valorAberto)}
          </div>
          {parcial && (
            <div className="num mt-0.5 text-sm text-tinta-500">
              de {formatBRL(conta.valor)} — o resto já foi pago
            </div>
          )}
          <div className="mt-3">
            <PrazoDoDebito conta={conta} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Dado rotulo="Vencimento">
            {conta.vencimento ? formatData(conta.vencimento) : 'sem data no IXC'}
          </Dado>
          <Dado rotulo="Emissão">
            {conta.emissao ? formatData(conta.emissao) : '—'}
          </Dado>
          <Dado rotulo="Documento">{conta.documento ?? '—'}</Dado>
          <Dado rotulo="Título no IXC">nº {conta.idFnApagar}</Dado>
          <Dado rotulo="Categoria da despesa">
            {conta.categoria.nome ??
              (conta.categoria.id ? `conta ${conta.categoria.id}` : '—')}
          </Dado>
          <Dado rotulo="Auditoria">
            {conta.statusAuditoria === 'A'
              ? 'aprovada'
              : conta.statusAuditoria === 'R'
                ? 'reprovada'
                : conta.statusAuditoria === 'C'
                  ? 'cancelada'
                  : 'não auditada'}
          </Dado>
        </div>

        {conta.observacao && (
          <div className="mt-4">
            <div className="rotulo">Observação no IXC</div>
            <p className="text-sm text-tinta-700">{conta.observacao}</p>
          </div>
        )}

        {conta.origem && (
          <div className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
            Esta conta nasceu no módulo Folha de Pagamento —{' '}
            {TIPO_LABEL[conta.origem.tipo] ?? conta.origem.tipo}
            {conta.origem.beneficiario ? ` de ${conta.origem.beneficiario}` : ''}
            . É a mesma dívida, não uma a mais.
          </div>
        )}

        {/* --- Por que ele está nesta lista --- */}
        <div className="mt-6 border-t border-tinta-100 pt-5">
          <div className="rotulo">Por que este débito aparece aqui</div>

          {detalhe.isLoading && <Carregando texto="Lendo o título no IXC…" />}

          {detalhe.error && (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {mensagemErro(detalhe.error)}
            </p>
          )}

          {detalhe.data && (
            <>
              <p className="mb-3 text-xs leading-relaxed text-tinta-500">
                {detalhe.data.filtro.aberta
                  ? 'O IXC devolveu este título com saldo a pagar e sem marca de pagamento ou cancelamento. Se ele não deveria estar aqui, é um dos campos abaixo que está sendo lido diferente do que o IXC entende.'
                  : `Este título ficou de fora da lista (${detalhe.data.filtro.motivo?.motivo}).`}
              </p>

              <div className="overflow-hidden rounded-xl border border-tinta-100">
                <table className="w-full text-sm">
                  <tbody>
                    {detalhe.data.filtro.olhou.map((c) => (
                      <tr key={c.campo} className="linha">
                        <td className="td num w-2/5 align-top text-xs text-tinta-500">
                          {c.campo}
                          <div className="mt-0.5 text-[11px] text-tinta-300">
                            {c.nota}
                          </div>
                        </td>
                        <td className="td break-all align-top font-semibold text-tinta-800">
                          {c.valor}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setVerTudo((v) => !v)}
                  className="btn btn-sutil btn-p"
                >
                  {verTudo
                    ? 'Esconder os demais campos'
                    : `Ver todos os ${campos.length} campos do IXC`}
                </button>
                <button onClick={copiar} className="btn btn-neutro btn-p">
                  {copiado ? 'Copiado!' : 'Copiar tudo'}
                </button>
              </div>

              {verTudo && (
                <div className="mt-3 max-h-[40vh] overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
                  <table className="w-full text-sm">
                    <tbody>
                      {campos.map(({ campo, valor }) => (
                        <tr key={campo} className="linha">
                          <td className="td num w-2/5 align-top text-xs text-tinta-500">
                            {campo}
                          </td>
                          <td className="td break-all align-top text-tinta-800">
                            {valor}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onFechar} className="btn btn-neutro">
            Fechar
          </button>
        </div>
      </div>
    </Janela>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="border-b border-tinta-100 py-2.5 last:border-0">
      <div className="text-xs text-tinta-400">{rotulo}</div>
      <div className="text-sm text-tinta-800">{children}</div>
    </div>
  );
}

/** O mesmo semáforo da lista: vermelho venceu, amarelo hoje, verde no prazo. */
function PrazoDoDebito({ conta }: { conta: ContaAberta }) {
  const dias = conta.diasParaVencer;
  if (dias === null) {
    return (
      <Selo tom="neutro" titulo="Sem data de vencimento no IXC">
        sem data de vencimento
      </Selo>
    );
  }
  if (dias < 0) {
    const atraso = Math.abs(dias);
    return (
      <Selo tom="erro">
        {atraso === 1 ? 'venceu ontem' : `${atraso} dias em atraso`}
      </Selo>
    );
  }
  if (dias === 0) return <Selo tom="atencao">vence hoje</Selo>;
  return (
    <Selo tom="pago">
      {dias === 1 ? 'vence amanhã' : `vence em ${dias} dias`}
    </Selo>
  );
}
