import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../components/ui';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import {
  CLASSE_CURTA,
  CLASSE_LABEL,
  TIPO_GUIA_LABEL,
  type ClasseTributo,
  type Guia,
  type ItemGuia,
  type LeituraDaGuia,
} from '../lib/types';

const CLASSES: ClasseTributo[] = [
  'FOLHA_PATRONAL',
  'FOLHA_RETIDO',
  'FATURAMENTO',
];

const TOM_DA_CLASSE: Record<ClasseTributo, 'marca' | 'atencao' | 'neutro'> = {
  FOLHA_PATRONAL: 'marca',
  FOLHA_RETIDO: 'atencao',
  FATURAMENTO: 'neutro',
};

function formatComp(comp: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  return m ? `${m[2]}/${m[1]}` : comp;
}

/**
 * As guias que a contabilidade manda todo mês. O PDF é lido aqui, mas nada é
 * gravado antes de alguém conferir na tela: leitor de PDF erra, e o número
 * daqui vai virar o gráfico de custo com pessoal.
 */
export function Impostos() {
  const qc = useQueryClient();
  const [leitura, setLeitura] = useState<LeituraDaGuia | null>(null);
  const [itens, setItens] = useState<ItemGuia[]>([]);
  const [feedback, setFeedback] = useState('');
  const [erro, setErro] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const guias = useQuery({
    queryKey: ['guias'],
    queryFn: async () => (await api.get<Guia[]>('/impostos/guias')).data,
  });

  function avisar(texto: string, ruim = false) {
    setFeedback(texto);
    setErro(ruim);
  }

  const ler = useMutation({
    mutationFn: async (arquivo: File) => {
      const form = new FormData();
      form.append('arquivo', arquivo);
      const { data } = await api.post<LeituraDaGuia>('/impostos/guias/ler', form);
      return data;
    },
    onSuccess: (data) => {
      setLeitura(data);
      setItens(data.guia.itens);
      avisar('');
    },
    onError: (err) => {
      setLeitura(null);
      avisar(mensagemErro(err), true);
    },
  });

  const gravar = useMutation({
    mutationFn: async () => {
      if (!leitura) throw new Error('Nada para gravar');
      const { data } = await api.post<Guia>('/impostos/guias', {
        ...leitura.guia,
        itens: itens.map(({ codigo, denominacao, valor, classe }) => ({
          codigo: codigo ?? undefined,
          denominacao,
          valor,
          classe,
        })),
        arquivoNome: leitura.arquivoNome,
        textoOriginal: leitura.textoOriginal,
      });
      return data;
    },
    onSuccess: (guia) => {
      avisar(
        `Guia de ${TIPO_GUIA_LABEL[guia.tipo]} de ${formatComp(guia.competencia)} lançada.`,
      );
      cancelar();
      qc.invalidateQueries({ queryKey: ['guias'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => api.delete(`/impostos/guias/${id}`),
    onSuccess: () => {
      avisar('Guia apagada.');
      qc.invalidateQueries({ queryKey: ['guias'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  function cancelar() {
    setLeitura(null);
    setItens([]);
    if (inputArquivo.current) inputArquivo.current.value = '';
  }

  const soma = itens.reduce((s, i) => s + i.valor, 0);
  const bate = leitura ? Math.abs(soma - leitura.guia.valorTotal) < 0.01 : false;
  const incertos = itens.filter((i) => i.classeIncerta).length;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Impostos"
        titulo="Guias da contabilidade"
        descricao="Jogue o PDF do DARF, do FGTS ou do DAS. O app lê, você confere, e só então o valor entra no custo com pessoal."
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      <Bloco titulo="Lançar uma guia" className="surgir">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputArquivo}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) ler.mutate(arquivo);
            }}
            className="block w-full max-w-md text-sm text-tinta-500 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-700"
          />
          {ler.isPending && (
            <span className="text-sm text-tinta-400">Lendo o PDF…</span>
          )}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-tinta-500">
          Entende DARF previdenciário, guia do FGTS Digital e DAS do Simples
          Nacional. O arquivo precisa ser o PDF original da contabilidade — se
          for digitalizado, não tem texto para ler.
        </p>
      </Bloco>

      {leitura && (
        <Bloco
          titulo={`Confira antes de gravar — ${TIPO_GUIA_LABEL[leitura.guia.tipo]}`}
          className="surgir mt-6"
        >
          {leitura.jaExiste && (
            <Aviso tom="erro">
              Esta guia já foi lançada (
              {formatComp(leitura.jaExiste.competencia)},{' '}
              {formatBRL(leitura.jaExiste.valorTotal)}). Gravar de novo contaria
              o mesmo imposto duas vezes — apague a anterior se quiser
              substituir.
            </Aviso>
          )}
          {leitura.divergencia && (
            <Aviso tom="erro">
              {leitura.divergencia} Confira o papel antes de gravar: pode ter
              escapado uma linha.
            </Aviso>
          )}
          {incertos > 0 && (
            <Aviso tom="atencao">
              {incertos === 1
                ? 'Um item tem código que eu não conheço'
                : `${incertos} itens têm código que eu não conheço`}{' '}
              — classifiquei no palpite. Confira a coluna "Conta como" antes de
              gravar.
            </Aviso>
          )}

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Leitura rotulo="Apuração" valor={formatComp(leitura.guia.competencia)} />
            <Leitura rotulo="Vencimento" valor={formatData(leitura.guia.vencimento)} />
            <Leitura rotulo="Total" valor={formatBRL(leitura.guia.valorTotal)} forte />
            <Leitura
              rotulo="Documento"
              valor={leitura.guia.numeroDocumento ?? '—'}
            />
            <Leitura
              rotulo={leitura.guia.trabalhadores ? 'Trabalhadores' : 'CNPJ'}
              valor={
                leitura.guia.trabalhadores
                  ? String(leitura.guia.trabalhadores)
                  : (leitura.guia.cnpj ?? '—')
              }
            />
          </div>

          <div className="mt-5 overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-tinta-100">
                  <th className="th">Código</th>
                  <th className="th">Denominação</th>
                  <th className="th text-right">Valor</th>
                  <th className="th">Conta como</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item, i) => (
                  <tr key={`${item.codigo ?? 'x'}-${i}`} className="linha">
                    <td className="td num text-tinta-500">{item.codigo ?? '—'}</td>
                    <td className="td text-tinta-800">
                      {item.denominacao}
                      {item.classeIncerta && (
                        <Selo pequeno tom="atencao">
                          código novo
                        </Selo>
                      )}
                    </td>
                    <td className="td text-right">
                      <span className="valor">{formatBRL(item.valor)}</span>
                    </td>
                    <td className="td">
                      <select
                        value={item.classe}
                        onChange={(e) =>
                          setItens(
                            itens.map((it, j) =>
                              j === i
                                ? {
                                    ...it,
                                    classe: e.target.value as ClasseTributo,
                                    classeIncerta: false,
                                  }
                                : it,
                            ),
                          )
                        }
                        className="campo py-1.5 text-xs"
                      >
                        {CLASSES.map((c) => (
                          <option key={c} value={c}>
                            {CLASSE_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-tinta-100 pt-4">
            <button
              onClick={() => gravar.mutate()}
              disabled={!bate || gravar.isPending || !!leitura.jaExiste}
              className="btn btn-primario"
            >
              {gravar.isPending ? 'Gravando…' : 'Confirmar e gravar'}
            </button>
            <button onClick={cancelar} className="btn btn-neutro">
              Cancelar
            </button>
            <span className="text-sm text-tinta-500">
              Soma dos itens{' '}
              <strong className="valor text-[15px]">{formatBRL(soma)}</strong>
              {!bate && (
                <span className="text-rose-600">
                  {' '}
                  — não bate com o total do documento
                </span>
              )}
            </span>
          </div>
        </Bloco>
      )}

      <Bloco titulo="Guias lançadas" className="surgir surgir-2 mt-6" semPadding>
        {guias.isLoading ? (
          <Carregando />
        ) : (guias.data ?? []).length === 0 ? (
          <Vazio titulo="Nenhuma guia lançada ainda">
            Suba o primeiro PDF acima e o imposto passa a aparecer na dashboard.
          </Vazio>
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-tinta-100">
                  <th className="th">Guia</th>
                  <th className="th">Apuração</th>
                  <th className="th">Vencimento</th>
                  <th className="th">Composição</th>
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {(guias.data ?? []).map((g) => (
                  <tr key={g.id} className="linha">
                    <td className="td font-medium text-tinta-800">
                      {TIPO_GUIA_LABEL[g.tipo]}
                      {g.trabalhadores != null && (
                        <div className="text-xs text-tinta-400">
                          {g.trabalhadores} trabalhadores
                        </div>
                      )}
                    </td>
                    <td className="td num text-tinta-500">
                      {formatComp(g.competencia)}
                    </td>
                    <td className="td num text-tinta-500">
                      {formatData(g.vencimento)}
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1.5">
                        {resumirClasses(g.itens).map(([classe, valor]) => (
                          <Selo key={classe} pequeno tom={TOM_DA_CLASSE[classe]}>
                            {CLASSE_CURTA[classe]} {formatBRL(valor)}
                          </Selo>
                        ))}
                      </div>
                    </td>
                    <td className="td text-right">
                      <span className="valor">{formatBRL(g.valorTotal)}</span>
                    </td>
                    <td className="td text-right">
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Apagar a guia de ${TIPO_GUIA_LABEL[g.tipo]} de ${formatComp(g.competencia)}?\n\nEla sai do custo com pessoal na dashboard.`,
                            )
                          ) {
                            excluir.mutate(g.id);
                          }
                        }}
                        className="btn btn-sutil btn-p hover:bg-rose-50 hover:text-rose-600"
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>
    </Pagina>
  );
}

/** Quanto cada classe pesou dentro de uma guia. */
function resumirClasses(itens: ItemGuia[]): [ClasseTributo, number][] {
  const soma = new Map<ClasseTributo, number>();
  for (const item of itens) {
    soma.set(item.classe, (soma.get(item.classe) ?? 0) + Number(item.valor));
  }
  return CLASSES.filter((c) => (soma.get(c) ?? 0) > 0).map((c) => [
    c,
    soma.get(c) ?? 0,
  ]);
}

function Leitura({
  rotulo,
  valor,
  forte,
}: {
  rotulo: string;
  valor: string;
  forte?: boolean;
}) {
  return (
    <div>
      <div className="rotulo">{rotulo}</div>
      <div
        className={
          forte
            ? 'font-display text-lg font-semibold num text-tinta-800'
            : 'num text-sm text-tinta-700'
        }
      >
        {valor}
      </div>
    </div>
  );
}
