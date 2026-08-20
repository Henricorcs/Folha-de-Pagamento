import { useEffect, useState } from 'react';
import { Janela } from '../../components/ui';
import { formatBRL } from '../../lib/format';

/** O que circula: cédulas de 200 a 2, moedas de 1 real a 1 centavo. */
const CEDULAS = [200, 100, 50, 20, 10, 5, 2];
const MOEDAS = [1, 0.5, 0.25, 0.1, 0.05, 0.01];

/** Quantas de cada valor, guardado pelo valor em centavos. */
type Contagem = Record<string, string>;

/**
 * Contar a gaveta, cédula por cédula.
 *
 * Bater o caixa termina sempre no mesmo lugar: alguém com o maço na mão
 * somando de cabeça e um número escrito no campo do fechamento. A soma de
 * cabeça é onde o erro entra — e, quando o total não bate, ela se refaz
 * inteira, porque não sobrou registro de quantas notas de cinquenta havia.
 *
 * Aqui a contagem fica de pé: quantas de cada, o subtotal de cada uma, o total
 * e a distância até o que a gaveta deveria ter. E como fica escrito o que há
 * de cada valor, dar troco deixa de ser adivinhação — que é a outra metade do
 * dia de quem opera o caixa.
 */
export function CalculadoraDaGaveta({
  caixaId,
  esperado,
  onUsar,
  onFechar,
}: {
  caixaId: number;
  /** O que a gaveta deveria ter. Null quando ainda não há de onde partir. */
  esperado: number | null;
  /** Leva o total para o campo da contagem, no fechamento. */
  onUsar?: (total: number) => void;
  onFechar: () => void;
}) {
  const [contagem, setContagem] = useState<Contagem>(() =>
    lerRascunho(caixaId),
  );

  /*
   * A contagem sobrevive a um F5, mas não ao dia seguinte.
   *
   * Contar uma gaveta cheia leva minutos, e perder isso porque a tela
   * recarregou é o tipo de coisa que faz ninguém mais usar. Guardar para
   * sempre seria pior: a contagem de ontem, aberta hoje, é um número errado
   * com cara de certo.
   */
  useEffect(() => guardarRascunho(caixaId, contagem), [caixaId, contagem]);

  const totalDe = (valores: number[]) =>
    arredondar(
      valores.reduce((s, v) => s + v * (Number(contagem[chave(v)]) || 0), 0),
    );
  const emCedulas = totalDe(CEDULAS);
  const emMoedas = totalDe(MOEDAS);
  const total = arredondar(emCedulas + emMoedas);
  const diferenca = esperado === null ? null : arredondar(total - esperado);
  const contou = Object.values(contagem).some((q) => Number(q) > 0);

  return (
    <Janela titulo="Contar a gaveta" onFechar={onFechar}>
      <div className="grid gap-6 sm:grid-cols-2">
        <Grupo
          titulo="Cédulas"
          valores={CEDULAS}
          contagem={contagem}
          soma={emCedulas}
          onMudar={setContagem}
        />
        <Grupo
          titulo="Moedas"
          valores={MOEDAS}
          contagem={contagem}
          soma={emMoedas}
          onMudar={setContagem}
        />
      </div>

      <div className="mt-6 rounded-xl border border-tinta-200 bg-tinta-50/60 px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="rotulo mb-0">Contado na gaveta</span>
          <span className="valor text-xl">{formatBRL(total)}</span>
        </div>

        {/*
          A distância até o esperado, na hora — e não só depois de fechar.
          Quem está com o dinheiro na mão ainda pode recontar; quem já assinou
          o fechamento, não.
        */}
        {esperado === null ? (
          <p className="ajuda mt-1">
            Este caixa ainda não tem saldo esperado — sem um fechamento
            anterior, não há com o que comparar. O total acima vale como a
            contagem de partida.
          </p>
        ) : !contou ? (
          <p className="ajuda mt-1">
            A gaveta deveria ter {formatBRL(esperado)}. Diga quantas de cada e o
            resto sai daqui.
          </p>
        ) : Math.abs(diferenca ?? 0) < 0.005 ? (
          <p className="mt-1 text-sm text-emerald-600">
            Bate com o esperado, {formatBRL(esperado)}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-amber-600">
            {(diferenca ?? 0) > 0 ? 'Sobra' : 'Falta'}{' '}
            <span className="valor">
              {formatBRL(Math.abs(diferenca ?? 0))}
            </span>{' '}
            em relação aos {formatBRL(esperado)} que a soma esperava.
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setContagem({})}
          disabled={!contou}
          className="btn btn-p btn-sutil"
        >
          Limpar
        </button>
        {onUsar && (
          <button
            type="button"
            onClick={() => {
              onUsar(total);
              onFechar();
            }}
            disabled={!contou}
            className="btn btn-acao"
            title="Escreve este total no campo da contagem do fechamento"
          >
            Usar como contagem
          </button>
        )}
      </div>
    </Janela>
  );
}

/** Cédulas ou moedas: a mesma lista, com o subtotal do grupo embaixo. */
function Grupo({
  titulo,
  valores,
  contagem,
  soma,
  onMudar,
}: {
  titulo: string;
  valores: number[];
  contagem: Contagem;
  soma: number;
  onMudar: (f: (atual: Contagem) => Contagem) => void;
}) {
  return (
    <div>
      <p className="rotulo">{titulo}</p>
      <div className="flex flex-col gap-1.5">
        {valores.map((v) => (
          <Linha
            key={v}
            valor={v}
            qtd={contagem[chave(v)] ?? ''}
            onQtd={(q) => onMudar((atual) => ({ ...atual, [chave(v)]: q }))}
          />
        ))}
      </div>
      <div className="mt-2 flex items-baseline justify-between border-t border-tinta-200 pt-2 text-sm">
        <span className="text-tinta-500">em {titulo.toLowerCase()}</span>
        <span className="num text-tinta-700">{formatBRL(soma)}</span>
      </div>
    </div>
  );
}

function Linha({
  valor,
  qtd,
  onQtd,
}: {
  valor: number;
  qtd: string;
  onQtd: (q: string) => void;
}) {
  const subtotal = valor * (Number(qtd) || 0);

  return (
    <div className="flex items-center gap-2">
      <span className="w-[74px] shrink-0 text-sm font-medium text-tinta-700">
        {formatBRL(valor)}
      </span>
      <span className="text-tinta-400">×</span>
      <input
        // Só quantidade inteira entra, e o celular abre o teclado numérico.
        inputMode="numeric"
        value={qtd}
        onChange={(e) => onQtd(e.target.value.replace(/\D/g, '').slice(0, 4))}
        placeholder="0"
        aria-label={`Quantas de ${formatBRL(valor)}`}
        className="campo w-16 py-1.5 text-right"
      />
      <span className="num ml-auto text-sm text-tinta-500">
        {subtotal ? formatBRL(subtotal) : '—'}
      </span>
    </div>
  );
}

/** A chave do rascunho: o valor em centavos, para não depender de vírgula. */
function chave(valor: number): string {
  return String(Math.round(valor * 100));
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function chaveDoRascunho(caixaId: number): string {
  return `folha.gaveta.contagem.${caixaId}`;
}

function hoje(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function lerRascunho(caixaId: number): Contagem {
  try {
    const cru = localStorage.getItem(chaveDoRascunho(caixaId));
    if (!cru) return {};
    const guardado = JSON.parse(cru) as { dia?: string; contagem?: Contagem };
    return guardado.dia === hoje() ? (guardado.contagem ?? {}) : {};
  } catch {
    // Rascunho é conveniência: se o que está guardado não se lê, começa vazio.
    return {};
  }
}

function guardarRascunho(caixaId: number, contagem: Contagem) {
  try {
    localStorage.setItem(
      chaveDoRascunho(caixaId),
      JSON.stringify({ dia: hoje(), contagem }),
    );
  } catch {
    // Sem espaço ou sem permissão, a contagem vale só nesta tela.
  }
}
