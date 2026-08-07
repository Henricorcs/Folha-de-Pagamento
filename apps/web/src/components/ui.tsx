import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatNumeroBR, parseValorBR } from '../lib/format';

/**
 * Peças compartilhadas da interface. A regra da casa: o número é o herói —
 * tudo em volta (rótulo, moldura, cor) existe para deixá-lo conferível.
 */

/**
 * Campo de dinheiro. É `text` de propósito: `input type="number"` não entende
 * o formato que a gente escreve e cola do IXC ("2.107,03") — o navegador
 * devolvia string vazia e o valor sumia sem avisar ninguém.
 *
 * Entra do jeito que vier (ponto de milhar, vírgula, "R$", ponto decimal) e
 * sai sempre canônico — ponto decimal, como a API espera. Ao sair do campo, o
 * que ficou valendo aparece formatado, para conferir antes de salvar.
 */
export function CampoDinheiro({
  valor,
  onChange,
  className = 'campo',
  placeholder,
}: {
  /** Valor canônico: "2107.03" ou "" quando vazio. */
  valor: string;
  onChange: (valor: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [texto, setTexto] = useState(() => paraExibicao(valor));
  const emitido = useRef(valor);

  // Valor que não saiu daqui veio de fora (recarregou o cadastro, recalculou a
  // folha): aí sim reescreve o campo. Enquanto se digita, o que está na tela é
  // o que a pessoa escreveu — nada de reformatar embaixo do cursor.
  useEffect(() => {
    if (valor === emitido.current) return;
    emitido.current = valor;
    setTexto(paraExibicao(valor));
  }, [valor]);

  function emitir(digitado: string) {
    setTexto(digitado);
    const n = parseValorBR(digitado);
    const canonico = n === null ? '' : String(n);
    emitido.current = canonico;
    onChange(canonico);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={texto}
      placeholder={placeholder}
      className={className}
      onChange={(e) => emitir(e.target.value)}
      onBlur={() => {
        // Mostra o que ficou valendo, para conferir antes de salvar.
        const n = parseValorBR(texto);
        setTexto(n === null ? '' : formatNumeroBR(n));
      }}
    />
  );
}

/** Canônico ("2107.03") → o que se lê no campo ("2.107,03"). */
function paraExibicao(valor: string): string {
  if (!valor) return '';
  const n = Number(valor);
  return Number.isFinite(n) ? formatNumeroBR(n) : '';
}

export function Pagina({ children }: { children: ReactNode }) {
  return (
    // pt-20 no celular: o conteúdo passa por baixo do botão do menu.
    <div className="mx-auto w-full max-w-[1400px] px-6 pb-10 pt-20 sm:px-8 lg:px-10 lg:pt-8">
      {children}
    </div>
  );
}

export function CabecalhoPagina({
  secao,
  titulo,
  descricao,
  acoes,
}: {
  /** Onde a pessoa está — a mesma palavra da barra lateral. */
  secao: string;
  titulo: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <header className="surgir mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="eyebrow mb-2">{secao}</p>
        <h1 className="titulo-pagina">{titulo}</h1>
        {descricao && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-tinta-500">
            {descricao}
          </p>
        )}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </header>
  );
}

export function Bloco({
  titulo,
  acao,
  className = '',
  semPadding = false,
  children,
}: {
  titulo?: string;
  acao?: ReactNode;
  className?: string;
  /** Para tabelas, que sangram até a borda do cartão. */
  semPadding?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {titulo && (
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
          <h2 className="titulo-bloco">{titulo}</h2>
          {acao}
        </div>
      )}
      <div className={semPadding ? '' : `px-5 pb-5 sm:px-6 sm:pb-6 ${titulo ? '' : 'pt-5 sm:pt-6'}`}>
        {children}
      </div>
    </section>
  );
}

/** Indicador de topo: rótulo pequeno, número grande, contexto embaixo. */
export function Indicador({
  rotulo,
  valor,
  detalhe,
  alerta,
  acento = false,
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  /** Texto em vermelho: algo aqui precisa de você. */
  alerta?: string;
  /** Destaca o indicador principal da tela. */
  acento?: boolean;
}) {
  return (
    <div
      className={`card card-hover relative overflow-hidden p-5 ${
        acento ? 'ring-1 ring-brand-200' : ''
      }`}
    >
      {acento && (
        <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-500 to-brand-300" />
      )}
      <p className="eyebrow">{rotulo}</p>
      <p className="mt-2 font-display text-[26px] font-semibold leading-none tracking-tight text-tinta-900 num">
        {valor}
      </p>
      {detalhe && <p className="mt-2 text-xs leading-snug text-tinta-400">{detalhe}</p>}
      {alerta && (
        <p className="mt-1.5 text-xs font-semibold text-rose-600">{alerta}</p>
      )}
    </div>
  );
}

const TONS = {
  neutro: 'bg-tinta-100 text-tinta-600',
  marca: 'bg-brand-50 text-brand-800',
  pago: 'bg-emerald-50 text-emerald-700',
  atencao: 'bg-amber-50 text-amber-700',
  erro: 'bg-rose-50 text-rose-700',
  info: 'bg-sky-50 text-sky-700',
} as const;

export type Tom = keyof typeof TONS;

export function Selo({
  tom = 'neutro',
  ponto = false,
  titulo,
  pequeno = false,
  children,
}: {
  tom?: Tom;
  /** Bolinha antes do texto, para status que mudam sozinhos. */
  ponto?: boolean;
  titulo?: string;
  pequeno?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      title={titulo}
      className={`${pequeno ? 'selo-p' : 'selo'} ${TONS[tom]}`}
    >
      {ponto && (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      )}
      {children}
    </span>
  );
}

export function Aviso({
  tom = 'info',
  children,
  acao,
}: {
  tom?: Tom;
  children: ReactNode;
  acao?: ReactNode;
}) {
  const cores: Record<Tom, string> = {
    neutro: 'border-tinta-200 bg-white text-tinta-600',
    marca: 'border-brand-200 bg-brand-50 text-brand-900',
    pago: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    atencao: 'border-amber-200 bg-amber-50 text-amber-900',
    erro: 'border-rose-200 bg-rose-50 text-rose-800',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
  };
  return (
    <div
      className={`surgir mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${cores[tom]}`}
    >
      <span>{children}</span>
      {acao}
    </div>
  );
}

/** Tela vazia é convite para agir, não beco sem saída. */
export function Vazio({
  titulo,
  children,
}: {
  titulo: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-display text-sm font-semibold text-tinta-500">
        {titulo}
      </p>
      {children && (
        <p className="mx-auto mt-1.5 max-w-md text-sm text-tinta-400">
          {children}
        </p>
      )}
    </div>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-14 text-sm text-tinta-400">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-tinta-200 border-t-brand-500" />
      {texto}
    </div>
  );
}
