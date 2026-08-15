import { useEffect, useRef, useState } from 'react';

/**
 * Lê o código de barras do boleto pela câmera do celular.
 *
 * Usa o `BarcodeDetector` do próprio navegador em vez de uma biblioteca de
 * leitura: é o que o Chrome do Android já traz pronto, e uma biblioteca de
 * visão computacional pesa mais do que todo o resto desta tela junto. Onde ele
 * não existe — o Safari do iPhone é o caso — o botão nem aparece, e resta
 * colar a linha digitável, que continua funcionando.
 *
 * O boleto bancário é impresso em ITF (2 de 5 intercalado) e as contas de
 * consumo também; `code_128` entra porque alguns carnês usam esse formato.
 */

/** O `BarcodeDetector` ainda não está na tipagem padrão do DOM. */
interface CodigoLido {
  rawValue: string;
  format: string;
}
interface DetectorDeCodigo {
  detect(fonte: CanvasImageSource): Promise<CodigoLido[]>;
}
type ConstrutorDoDetector = new (opcoes?: {
  formats?: string[];
}) => DetectorDeCodigo;

function detectorDisponivel(): ConstrutorDoDetector | null {
  const janela = window as unknown as {
    BarcodeDetector?: ConstrutorDoDetector;
  };
  return janela.BarcodeDetector ?? null;
}

/** O navegador lê código de barras? Decide se o botão da câmera aparece. */
export function leitorDeBoletoSuportado(): boolean {
  return (
    detectorDisponivel() !== null &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Tamanhos válidos: 44 do código de barras, 47 da cobrança, 48 das concessionárias. */
function pareceBoleto(digitos: string): boolean {
  return [44, 47, 48].includes(digitos.length);
}

/**
 * O QR do PIX é o próprio "copia e cola": um texto no padrão EMV que começa em
 * "0002" e traz o domínio do Banco Central no meio. Ler o QR e guardar essa
 * string é exatamente o que fazer o "copiar código" no aplicativo do banco
 * faria — e é ela que paga.
 */
function pareceCopiaECola(texto: string): boolean {
  const limpo = texto.trim();
  return limpo.startsWith('0002') && /BR\.GOV\.BCB\.PIX/i.test(limpo);
}

/** O que se está lendo: muda o formato aceito e o texto da tela. */
export type AlvoDaLeitura = 'boleto' | 'pix';

const ALVOS = {
  boleto: {
    titulo: 'Aponte para o código de barras do boleto',
    ajuda:
      'Encaixe o código na faixa. Assim que ele for lido, o campo é preenchido sozinho.',
    formatos: ['itf', 'code_128'],
    // O boleto vira só dígitos; o PIX vai inteiro, do jeito que veio.
    aceitar: (bruto: string) => {
      const digitos = bruto.replace(/\D/g, '');
      return pareceBoleto(digitos) ? digitos : null;
    },
  },
  pix: {
    titulo: 'Aponte para o QR Code do PIX',
    ajuda:
      'O código copia e cola do QR é gravado no campo — é ele que o banco usa para pagar.',
    formatos: ['qr_code'],
    aceitar: (bruto: string) =>
      pareceCopiaECola(bruto) ? bruto.trim() : null,
  },
} as const;

export function LeitorDeBoleto({
  alvo = 'boleto',
  onLido,
  onFechar,
}: {
  alvo?: AlvoDaLeitura;
  onLido: (codigo: string) => void;
  onFechar: () => void;
}) {
  const modo = ALVOS[alvo];
  const video = useRef<HTMLVideoElement | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(true);

  useEffect(() => {
    const Detector = detectorDisponivel();
    if (!Detector) {
      setErro('Este navegador não lê código de barras.');
      return;
    }

    let parado = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;

    async function comecar() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // A de trás é a que enxerga o papel na mesa.
          video: { facingMode: { ideal: 'environment' } },
        });
        if (parado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }

        const detector = new Detector!({ formats: [...modo.formatos] });

        const procurar = async () => {
          if (parado || !video.current) return;
          try {
            const achados = await detector.detect(video.current);
            for (const achado of achados) {
              const aceito = modo.aceitar(achado.rawValue);
              if (aceito) {
                setLendo(false);
                onLido(aceito);
                return;
              }
            }
          } catch {
            // Quadro que não deu para analisar: tenta o próximo.
          }
          // Umas seis leituras por segundo dão conta e não fritam a bateria.
          timer = window.setTimeout(() => void procurar(), 160);
        };

        void procurar();
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        setErro(
          /denied|permission/i.test(motivo)
            ? 'A câmera foi bloqueada. Libere o acesso no navegador e tente de novo.'
            : `Não deu para abrir a câmera: ${motivo}`,
        );
      }
    }

    void comecar();

    return () => {
      parado = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onLido, modo]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-barra/95 p-4">
      <div className="flex items-center justify-between gap-3 pb-3">
        <span className="text-sm font-semibold text-white">{modo.titulo}</span>
        <button
          onClick={onFechar}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          Fechar
        </button>
      </div>

      {erro ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-sm text-center text-sm text-rose-200">{erro}</p>
        </div>
      ) : (
        <div className="relative flex-1 overflow-hidden rounded-2xl bg-black">
          <video
            ref={video}
            playsInline
            muted
            className="h-full w-full object-cover"
          />
          {/* A mira acompanha o formato: o código de barras é largo e baixo, o
              QR é quadrado. Mirar no formato certo acelera muito a leitura. */}
          <div
            className={
              alvo === 'pix'
                ? 'pointer-events-none absolute left-1/2 top-1/2 aspect-square w-56 max-w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-white/70'
                : 'pointer-events-none absolute inset-x-6 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/70'
            }
          />
        </div>
      )}

      <p className="pt-3 text-center text-xs text-white/60">
        {lendo ? modo.ajuda : 'Código lido.'}
      </p>
    </div>
  );
}
