import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

/**
 * O quadro onde a pessoa desenha o nome com o dedo.
 *
 * Duas coisas mandam no desenho aqui: ele é feito com o dedo, num celular, e o
 * que sair vai virar a assinatura de um recibo de quitação. Por isso o traço é
 * grosso e arredondado (dedo não tem a precisão de caneta), a tela acompanha a
 * densidade do aparelho (senão o traço sai serrilhado no retina) e o toque não
 * rola a página junto — `touch-action: none` é o que impede a assinatura de
 * virar um arrastão de scroll no meio da letra.
 */

export interface AssinaturaCanvasRef {
  /** PNG em data URL, ou null se ninguém desenhou nada ainda. */
  exportar: () => string | null;
  limpar: () => void;
}

interface Props {
  controle: RefObject<AssinaturaCanvasRef>;
  /** Avisa a tela quando deixa de estar em branco (para soltar o botão). */
  onMudou?: (temTraco: boolean) => void;
  disabled?: boolean;
}

/** Proporção do quadro: largo e baixo, do formato de uma linha de assinatura. */
const ALTURA = 190;

export function AssinaturaCanvas({ controle, onMudou, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const [temTraco, setTemTraco] = useState(false);

  // O canvas é redimensionado em pixels reais do aparelho. Mudar o tamanho de
  // um canvas apaga o conteúdo, então isto roda uma vez e no giro da tela.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function ajustar() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const escala = window.devicePixelRatio || 1;
      const largura = canvas.clientWidth;
      canvas.width = Math.round(largura * escala);
      canvas.height = Math.round(ALTURA * escala);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(escala, escala);
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
    }

    ajustar();
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
  }, []);

  useImperativeHandle(controle, () => ({
    exportar: () => (temTraco ? (canvasRef.current?.toDataURL('image/png') ?? null) : null),
    limpar: () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      // O clear vai em pixels reais; o resto do desenho trabalha em CSS px.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      setTemTraco(false);
      onMudou?.(false);
    },
  }));

  function posicao(e: ReactPointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function comecar(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    // Segurar o ponteiro faz o traço continuar mesmo se o dedo escapar da
    // borda do quadro no meio da letra.
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = posicao(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    desenhando.current = true;
  }

  function mover(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = posicao(e);
    ctx.lineTo(x, y);
    ctx.stroke();

    if (!temTraco) {
      setTemTraco(true);
      onMudou?.(true);
    }
  }

  function terminar() {
    if (!desenhando.current) return;
    desenhando.current = false;
    // Um toque seco (ponto, sem arrastar) também conta como traço: é assim que
    // se pinga o pingo do "i".
    if (!temTraco) {
      setTemTraco(true);
      onMudou?.(true);
    }
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        onPointerDown={comecar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerLeave={terminar}
        onPointerCancel={terminar}
        style={{ height: ALTURA, touchAction: 'none' }}
        className={`w-full rounded-2xl border-2 border-dashed bg-white ${
          disabled
            ? 'cursor-not-allowed border-tinta-100'
            : 'cursor-crosshair border-tinta-200'
        }`}
      />

      {/* A linha de assinatura fica sob o dedo, como a de um papel. Não
          intercepta o toque — quem manda no ponteiro é o canvas. */}
      <div className="pointer-events-none absolute inset-x-6 bottom-11 border-b border-tinta-200" />

      {!temTraco && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-sm text-tinta-300">Assine aqui com o dedo</span>
        </div>
      )}
    </div>
  );
}
