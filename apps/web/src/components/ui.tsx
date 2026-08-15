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

/**
 * Janela por cima da tela, para o que precisa de resposta agora — pagar alguém,
 * por exemplo. Um bloco no rodapé da página resolveria o mesmo, mas nasce fora
 * da área visível: quem clica em "Pagar" no meio de uma tabela longa não vê
 * nada acontecer e conclui que o botão está quebrado.
 */
export function Janela({
  titulo,
  onFechar,
  children,
}: {
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    // Rolar a página atrás da janela tira do lugar o que se está lendo nela.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [onFechar]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center overflow-y-auto rolagem-fina bg-barra/60 p-4 backdrop-blur-sm sm:p-6"
      onClick={onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className="surgir my-auto h-fit w-full max-w-3xl rounded-2xl bg-papel shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-tinta-100 px-5 py-4 sm:px-6">
          <h2 className="titulo-bloco">{titulo}</h2>
          <button
            onClick={onFechar}
            aria-label="Fechar"
            className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-lg leading-none text-tinta-400 transition hover:bg-tinta-100 hover:text-tinta-700"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6">{children}</div>
      </div>
    </div>
  );
}

/** Indicador de topo: rótulo pequeno, número grande, contexto embaixo. */
export function Indicador({
  rotulo,
  valor,
  detalhe,
  alerta,
  acento = false,
  onClick,
  aberto = false,
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  /** Texto em vermelho: algo aqui precisa de você. */
  alerta?: string;
  /** Destaca o indicador principal da tela. */
  acento?: boolean;
  /**
   * Abre o detalhamento deste número. Com ele o cartão vira botão: o valor
   * fica limpo e o que explica sai da letra miúda para um painel legível.
   */
  onClick?: () => void;
  /** Este é o cartão cujo detalhe está aberto. */
  aberto?: boolean;
}) {
  const conteudo = (
    <>
      {acento && (
        <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-500 to-brand-300" />
      )}
      <p className="eyebrow">{rotulo}</p>
      <p className="mt-2 font-display text-[26px] font-semibold leading-none tracking-tight text-tinta-900 num">
        {valor}
      </p>
      {detalhe && (
        <p className="mt-2 text-xs leading-snug text-tinta-400">{detalhe}</p>
      )}
      {alerta && (
        <p className="mt-1.5 text-xs font-semibold text-rose-600">{alerta}</p>
      )}
      {onClick && (
        <span
          className={`mt-3 flex items-center gap-1 text-xs font-semibold transition ${
            aberto ? 'text-brand-700' : 'text-tinta-400'
          }`}
        >
          {aberto ? 'Fechar' : 'Ver detalhe'}
          <span className={`transition-transform ${aberto ? 'rotate-90' : ''}`}>
            ▸
          </span>
        </span>
      )}
    </>
  );

  const estilo = `card relative overflow-hidden p-5 ${
    acento ? 'ring-1 ring-brand-200' : ''
  } ${aberto ? 'ring-2 ring-brand-400' : ''}`;

  if (!onClick) {
    return <div className={`${estilo} card-hover`}>{conteudo}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={aberto}
      className={`${estilo} card-hover w-full cursor-pointer text-left`}
    >
      {conteudo}
    </button>
  );
}

/**
 * As cores de estado não vêm da escala `tinta`, então não viram do avesso
 * sozinhas: no tema escuro um `bg-emerald-50` seria uma etiqueta quase branca
 * acesa no meio da tabela. A versão escura troca o fundo sólido por um véu da
 * própria cor e clareia o texto — a etiqueta continua verde, só que legível.
 */
const TONS = {
  neutro: 'bg-tinta-100 text-tinta-600',
  marca: 'bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300',
  pago: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  atencao: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  erro: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  info: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
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
    neutro: 'border-tinta-200 bg-papel text-tinta-600',
    marca:
      'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200',
    pago: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
    atencao:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
    erro: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
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
