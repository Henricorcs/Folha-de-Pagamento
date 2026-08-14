import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, mensagemErro } from '../lib/api';
import { formatBRL } from '../lib/format';
import type { AssinaturaDiaria, Diaria } from '../lib/types';
import { Janela } from './ui';

/**
 * A coleta da assinatura de um pagamento em mãos.
 *
 * São dois jeitos de acontecer, e a janela abre já com o link nas mãos porque
 * os dois precisam dele:
 *
 * - a pessoa está na frente de quem pagou: passa-se o celular e ela assina ali
 *   mesmo, no botão "Abrir agora";
 * - a pessoa já foi embora: manda-se o link pelo WhatsApp e ela assina de onde
 *   estiver, do aparelho dela.
 *
 * Depois de assinado a janela vira comprovante: mostra o desenho e o caminho
 * do recibo em PDF, que fica guardado aqui dentro.
 */
export function ColetarAssinatura({
  diaria,
  onFechar,
}: {
  diaria: Diaria;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const assinatura = useQuery({
    queryKey: ['assinatura-diaria', diaria.id],
    queryFn: async () =>
      (await api.get<AssinaturaDiaria | null>(`/diarias/${diaria.id}/assinatura`))
        .data,
    // Enquanto a janela está aberta e ninguém assinou, ela fica perguntando.
    // É o que faz a tela de quem pagou virar "assinado" sozinha no instante em
    // que a pessoa levanta o dedo do celular dela, do outro lado da cidade.
    refetchInterval: (q) => (q.state.data?.assinadoEm ? false : 4000),
    // Perguntando **mesmo com a aba no fundo**, que é o caso normal: quem
    // copiou o link foi para o WhatsApp mandar, e é enquanto está lá que a
    // assinatura chega. O app inteiro desliga isto (`refetchOnWindowFocus`
    // falso no main.tsx) porque em tela de listagem só gera tráfego à toa —
    // aqui é o contrário, é a única coisa que a janela está esperando.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const gerar = useMutation({
    mutationFn: async () =>
      (await api.post<AssinaturaDiaria>(`/diarias/${diaria.id}/assinatura`)).data,
    onSuccess: (nova) => {
      queryClient.setQueryData(['assinatura-diaria', diaria.id], nova);
      setErro(null);
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const atual = assinatura.data;
  const assinado = Boolean(atual?.assinadoEm);
  const vencido = Boolean(
    atual && !assinado && new Date(atual.expiraEm) < new Date(),
  );
  const linkValido = Boolean(atual) && !assinado && !vencido;

  // Sem link de pé, a janela abre já criando um: quem clicou em "Coletar
  // assinatura" quer coletar, não apertar mais um botão para começar. O
  // guardião é uma referência porque isto tem de acontecer uma vez só — sem
  // ele, cada resposta da consulta pediria outro link.
  const jaPediu = useRef(false);
  useEffect(() => {
    if (assinatura.isSuccess && !atual && !jaPediu.current) {
      jaPediu.current = true;
      gerar.mutate();
    }
  }, [assinatura.isSuccess, atual, gerar]);

  // Assinou: a lista lá atrás precisa saber, para a linha ganhar o selo sem
  // depender de alguém recarregar a página.
  useEffect(() => {
    if (assinado) {
      void queryClient.invalidateQueries({ queryKey: ['diarias'] });
    }
  }, [assinado, queryClient]);

  const url = atual ? `${window.location.origin}/assinar/${atual.token}` : '';

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setErro('Não deu para copiar sozinho — selecione o endereço e copie.');
    }
  }

  return (
    <Janela titulo="Coletar assinatura" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        <div className="rounded-2xl bg-tinta-50 p-4">
          <div className="text-sm text-tinta-500">
            Pagamento em mãos de{' '}
            <span className="font-semibold text-tinta-800">
              {diaria.diarista?.nome ?? 'diarista'}
            </span>
          </div>
          <div className="valor mt-0.5 text-2xl">{formatBRL(diaria.valor)}</div>
          <div className="mt-0.5 text-sm text-tinta-500">{diaria.descricao}</div>
        </div>

        {assinatura.isLoading && (
          <p className="mt-5 text-sm text-tinta-400">Vendo se já há recibo…</p>
        )}

        {/* --- Já assinado: a janela é o comprovante --- */}
        {assinado && atual && (
          <div className="mt-5">
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span className="text-base">✓</span>
              Assinado por {atual.nomeAssinante} em{' '}
              {formatDataHora(atual.assinadoEm!)}.
            </div>

            {atual.assinaturaPng && (
              <div className="mt-4 rounded-2xl border border-tinta-100 p-4">
                <img
                  src={atual.assinaturaPng}
                  alt="Assinatura de quem recebeu"
                  className="mx-auto max-h-24"
                />
                <div className="mx-auto mt-2 max-w-xs border-t border-tinta-200 pt-2 text-center text-sm font-semibold text-tinta-800">
                  {atual.nomeAssinante}
                </div>
              </div>
            )}

            <a
              href={`/api/diarias/${diaria.id}/recibo.pdf`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primario mt-5 w-full"
            >
              Ver o recibo em PDF
            </a>
            <p className="ajuda text-center">
              O recibo fica guardado aqui — dá para abrir de novo quando
              precisar.
            </p>
          </div>
        )}

        {/* --- Ainda por assinar: o link --- */}
        {!assinado && (
          <div className="mt-5">
            {gerar.isPending && !atual ? (
              <p className="text-sm text-tinta-400">Preparando o recibo…</p>
            ) : (
              <>
                <div className="rotulo">Link de assinatura</div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    readOnly
                    value={url}
                    onFocus={(e) => e.target.select()}
                    className="campo num flex-1 text-xs"
                  />
                  <button
                    onClick={copiar}
                    disabled={!linkValido}
                    className="btn btn-neutro shrink-0"
                  >
                    {copiado ? 'Copiado!' : 'Copiar link'}
                  </button>
                </div>

                {linkValido && atual && (
                  <p className="ajuda">
                    Vale até {formatDataHora(atual.expiraEm)} e some assim que
                    for assinado.
                  </p>
                )}

                {vencido && (
                  <p className="mt-2 text-sm text-amber-700">
                    Este link venceu. Gere outro para mandar de novo.
                  </p>
                )}

                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className={`btn btn-primario flex-1 ${
                      linkValido ? '' : 'pointer-events-none opacity-50'
                    }`}
                  >
                    Abrir a tela de assinar agora
                  </a>
                  <button
                    onClick={() => gerar.mutate()}
                    disabled={gerar.isPending}
                    className="btn btn-neutro"
                  >
                    {vencido ? 'Gerar novo link' : 'Trocar o link'}
                  </button>
                </div>

                <p className="ajuda">
                  Abra na frente da pessoa e passe o aparelho, ou mande o link
                  para ela assinar de onde estiver. Trocar o link derruba o
                  anterior.
                </p>
              </>
            )}
          </div>
        )}

        {erro && (
          <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {erro}
          </p>
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

function formatDataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
