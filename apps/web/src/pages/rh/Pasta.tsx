import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatData } from '../../lib/format';
import type { DocumentoRh, EstanteRh, PrazoDoDocumento } from '../../lib/types';

/** O que a pasta aceita — o mesmo que a API guarda. */
const ACEITOS =
  '.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.doc,.docx,.xls,.xlsx,.txt,.csv';

/**
 * Uma pasta aberta: o que há dentro dela.
 *
 * Os documentos vêm sem o arquivo — são megabytes cada, e a lista mostra
 * dezenas de linhas. Quem clica em "ver" pede aquele arquivo, e ele abre numa
 * aba: PDF e digitalização se leem no visualizador do navegador, que é melhor
 * do que qualquer coisa que esta tela fosse desenhar.
 */
export function PastaRhAberta() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [termo, setTermo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [editando, setEditando] = useState<DocumentoRh | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const estante = useQuery({
    queryKey: ['rh', 'pastas'],
    queryFn: async () => (await api.get<EstanteRh>('/rh/pastas')).data,
  });

  const documentos = useQuery({
    queryKey: ['rh', 'documentos', id, termo],
    queryFn: async () =>
      (
        await api.get<DocumentoRh[]>('/rh/documentos', {
          params: { pastaId: id, termo: termo || undefined },
        })
      ).data,
    enabled: !!id,
  });

  const pasta = estante.data?.pastas.find((p) => p.id === id);

  function avisar(texto: string) {
    setFeito(texto);
    setTimeout(() => setFeito(null), 3000);
  }

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['rh', 'documentos'] });
    void qc.invalidateQueries({ queryKey: ['rh', 'pastas'] });
  }

  const guardar = useMutation({
    mutationFn: async (dados: Record<string, unknown>) =>
      (await api.post<DocumentoRh>('/rh/documentos', { ...dados, pastaId: id }))
        .data,
    onSuccess: (d) => {
      setGuardando(false);
      setErro(null);
      avisar(`"${d.titulo}" guardado.`);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const editar = useMutation({
    mutationFn: async (dados: { id: string } & Record<string, unknown>) =>
      (await api.patch<DocumentoRh>(`/rh/documentos/${dados.id}`, dados)).data,
    onSuccess: () => {
      setEditando(null);
      setErro(null);
      avisar('Documento corrigido.');
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const apagar = useMutation({
    mutationFn: async (docId: string) => api.delete(`/rh/documentos/${docId}`),
    onSuccess: () => {
      avisar('Documento apagado.');
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const lista = documentos.data ?? [];

  return (
    <Pagina>
      <CabecalhoPagina
        secao={
          pasta?.daEmpresa ? 'Pasta da empresa' : (pasta?.funcao ?? 'Pasta')
        }
        titulo={pasta?.nome ?? 'Pasta'}
        descricao={
          pasta?.daEmpresa
            ? 'Contrato social, alvará, certidões — o que é da empresa e não de uma pessoa.'
            : 'Contrato, exames, advertências e os recibos de pagamento desta pessoa.'
        }
        acoes={
          <div className="flex flex-wrap gap-2">
            <Link to="/rh/pastas" className="btn btn-neutro">
              Todas as pastas
            </Link>
            <button
              type="button"
              onClick={() => {
                setErro(null);
                setGuardando(true);
              }}
              className="btn btn-primario"
            >
              Guardar documento
            </button>
          </div>
        }
      />

      {feito && <Aviso tom="pago">{feito}</Aviso>}
      {erro && !guardando && !editando && <Aviso tom="erro">{erro}</Aviso>}

      <div className="surgir mb-5">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Procurar nesta pasta"
          className="campo max-w-md"
        />
      </div>

      {documentos.isLoading ? (
        <Carregando texto="Abrindo a pasta…" />
      ) : lista.length === 0 ? (
        <Vazio titulo={termo ? 'Nada com esse nome nesta pasta' : 'Pasta vazia'}>
          {termo
            ? 'Procure por outro pedaço do nome, do tipo ou da descrição.'
            : 'Guarde aqui o contrato, a CTPS, os exames e o que mais for desta pessoa. O recibo de pagamento do mês entra sozinho, pela tela de recibos da folha.'}
        </Vazio>
      ) : (
        <Bloco semPadding>
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Documento</th>
                  <th className="th">Tipo</th>
                  <th className="th">Datas</th>
                  <th className="th text-right">Arquivo</th>
                  <th className="th text-right" />
                </tr>
              </thead>
              <tbody>
                {lista.map((d) => (
                  <LinhaDoDocumento
                    key={d.id}
                    documento={d}
                    onEditar={() => {
                      setErro(null);
                      setEditando(d);
                    }}
                    onApagar={() => {
                      if (
                        confirm(
                          `Apagar "${d.titulo}"? O arquivo sai daqui e não volta.`,
                        )
                      ) {
                        apagar.mutate(d.id);
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Bloco>
      )}

      {guardando && (
        <Janela titulo="Guardar documento" onFechar={() => setGuardando(false)}>
          <FormularioDoDocumento
            tipos={estante.data?.tipos ?? []}
            pendente={guardar.isPending}
            erro={erro}
            onSalvar={(dados) => guardar.mutate(dados)}
          />
        </Janela>
      )}

      {editando && (
        <Janela
          titulo={`Corrigir — ${editando.titulo}`}
          onFechar={() => setEditando(null)}
        >
          <FormularioDoDocumento
            documento={editando}
            tipos={estante.data?.tipos ?? []}
            pendente={editar.isPending}
            erro={erro}
            onSalvar={(dados) => editar.mutate({ id: editando.id, ...dados })}
          />
        </Janela>
      )}
    </Pagina>
  );
}

function LinhaDoDocumento({
  documento: d,
  onEditar,
  onApagar,
}: {
  documento: DocumentoRh;
  onEditar: () => void;
  onApagar: () => void;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * O arquivo vem pela API autenticada, e não por um `href` direto: o token
   * vive no cabeçalho, e uma aba aberta na mão chegaria lá sem ele.
   */
  async function abrir() {
    setAbrindo(true);
    setErro(null);
    try {
      const { data } = await api.get<Blob>(`/rh/documentos/${d.id}/arquivo`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAbrindo(false);
    }
  }

  return (
    <tr className="linha">
      <td className="td">
        <div className="font-medium text-tinta-800">{d.titulo}</div>
        {d.descricao && (
          <div className="text-xs text-tinta-400">{d.descricao}</div>
        )}
        {erro && <div className="text-xs text-rose-600">{erro}</div>}
      </td>
      <td className="td">
        <Selo pequeno tom="neutro">
          {d.tipo}
        </Selo>
        {d.competencia && (
          <span className="ml-2 text-xs text-tinta-400">
            {d.competencia.slice(5)}/{d.competencia.slice(0, 4)}
          </span>
        )}
      </td>
      <td className="td whitespace-nowrap text-xs text-tinta-500">
        {d.emitidoEm && <div>emitido {formatData(d.emitidoEm)}</div>}
        {d.valeAte && (
          <div className="flex items-center gap-1.5">
            vale até {formatData(d.valeAte)}
            <SeloDoPrazo prazo={d.prazo} />
          </div>
        )}
        {!d.emitidoEm && !d.valeAte && <span className="text-tinta-400">—</span>}
      </td>
      <td className="td whitespace-nowrap text-right text-xs text-tinta-400">
        <div className="num">{emTamanho(d.arquivoTamanho)}</div>
        <div className="truncate">{d.arquivoNome}</div>
      </td>
      <td className="td whitespace-nowrap text-right">
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={abrir}
            disabled={abrindo}
            className="btn btn-p btn-ferramenta"
          >
            {abrindo ? 'Abrindo…' : 'Ver'}
          </button>
          <button
            type="button"
            onClick={onEditar}
            className="btn btn-p btn-neutro"
          >
            Corrigir
          </button>
          <button
            type="button"
            onClick={onApagar}
            className="btn btn-p btn-sutil"
            title="Apaga o documento e o arquivo"
          >
            Apagar
          </button>
        </div>
      </td>
    </tr>
  );
}

function SeloDoPrazo({ prazo }: { prazo: PrazoDoDocumento }) {
  if (prazo === 'vencido') {
    return (
      <Selo pequeno tom="erro">
        vencido
      </Selo>
    );
  }
  if (prazo === 'a-vencer') {
    return (
      <Selo pequeno tom="atencao">
        vencendo
      </Selo>
    );
  }
  return null;
}

/**
 * O formulário do documento — o mesmo para guardar e para corrigir.
 *
 * Corrigindo, o arquivo não aparece: trocar o conteúdo por baixo do mesmo
 * título é como um documento vira outro sem ninguém perceber. Errou o arquivo,
 * apaga e sobe de novo.
 */
function FormularioDoDocumento({
  documento,
  tipos,
  pendente,
  erro,
  onSalvar,
}: {
  documento?: DocumentoRh;
  tipos: string[];
  pendente: boolean;
  erro: string | null;
  onSalvar: (dados: Record<string, unknown>) => void;
}) {
  const [titulo, setTitulo] = useState(documento?.titulo ?? '');
  const [tipo, setTipo] = useState(documento?.tipo ?? '');
  const [descricao, setDescricao] = useState(documento?.descricao ?? '');
  const [emitidoEm, setEmitidoEm] = useState(documento?.emitidoEm ?? '');
  const [valeAte, setValeAte] = useState(documento?.valeAte ?? '');
  const [arquivo, setArquivo] = useState<{ nome: string; dados: string } | null>(
    null,
  );
  const [lendo, setLendo] = useState(false);
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null);

  const editando = !!documento;
  const podeSalvar =
    titulo.trim().length >= 2 &&
    tipo.trim().length >= 2 &&
    (editando || !!arquivo);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const escolhido = e.target.files?.[0];
    e.target.value = '';
    if (!escolhido) return;

    setLendo(true);
    setErroDoArquivo(null);
    try {
      const dados = await lerComoDataUrl(escolhido);
      setArquivo({ nome: escolhido.name, dados });
      // O nome do arquivo vira o título quando ninguém escreveu um: é o que
      // quem está subindo dez digitalizações não quer digitar dez vezes.
      if (!titulo.trim()) setTitulo(semExtensao(escolhido.name));
    } catch (err) {
      setErroDoArquivo(err instanceof Error ? err.message : String(err));
    } finally {
      setLendo(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!podeSalvar) return;
        onSalvar({
          titulo: titulo.trim(),
          tipo: tipo.trim(),
          descricao: descricao.trim() || undefined,
          emitidoEm: emitidoEm || undefined,
          valeAte: valeAte || undefined,
          ...(arquivo
            ? { arquivo: arquivo.dados, arquivoNome: arquivo.nome }
            : {}),
        });
      }}
    >
      {!editando && (
        <div className="mb-4">
          <label className="rotulo">O arquivo</label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn btn-neutro w-fit cursor-pointer">
              {lendo ? 'Lendo…' : arquivo ? 'Trocar arquivo' : 'Escolher arquivo'}
              <input
                type="file"
                accept={ACEITOS}
                className="hidden"
                onChange={escolher}
              />
            </label>
            {arquivo && (
              <span className="truncate text-sm text-tinta-600">
                {arquivo.nome}
              </span>
            )}
          </div>
          <p className="ajuda">
            PDF, foto, digitalização, documento do Word ou planilha — até 15 MB.
          </p>
          {erroDoArquivo && (
            <p className="mt-1 text-sm text-rose-600">{erroDoArquivo}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="titulo-do-documento">
            Como este documento se chama
          </label>
          <input
            id="titulo-do-documento"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Contrato de experiência"
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="tipo-do-documento">
            Tipo
          </label>
          <input
            id="tipo-do-documento"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            placeholder="Ex.: Contrato"
            list="tipos-de-documento"
            className="campo"
          />
          <datalist id="tipos-de-documento">
            {[...new Set([...tipos, ...SUGESTOES])].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="descricao-do-documento">
            Observação <span className="text-tinta-400">(opcional)</span>
          </label>
          <input
            id="descricao-do-documento"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="O que alguém precisaria saber sem abrir o arquivo"
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="emitido-em">
            Data do documento <span className="text-tinta-400">(opcional)</span>
          </label>
          <input
            id="emitido-em"
            type="date"
            value={emitidoEm}
            onChange={(e) => setEmitidoEm(e.target.value)}
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="vale-ate">
            Vale até <span className="text-tinta-400">(opcional)</span>
          </label>
          <input
            id="vale-ate"
            type="date"
            value={valeAte}
            onChange={(e) => setValeAte(e.target.value)}
            className="campo"
          />
          <p className="ajuda">
            Exame e certidão vencem. Preenchendo aqui, a pasta avisa antes.
          </p>
        </div>
      </div>

      {erro && (
        <div className="mt-4">
          <Aviso tom="erro">{erro}</Aviso>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={!podeSalvar || pendente || lendo}
          className="btn btn-primario"
        >
          {pendente
            ? 'Guardando…'
            : editando
              ? 'Salvar correção'
              : 'Guardar na pasta'}
        </button>
      </div>
    </form>
  );
}

/** Os tipos que toda pasta de RH acaba tendo, para a lista nunca nascer vazia. */
const SUGESTOES = [
  'Contrato',
  'CTPS',
  'Documento pessoal',
  'Exame médico',
  'Advertência',
  'Férias',
  'Rescisão',
  'Recibo de pagamento',
  'Certidão',
  'Alvará',
];

/** O arquivo como data URL — é assim que ele chega à API. */
function lerComoDataUrl(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () =>
      reject(new Error('Não consegui ler este arquivo do seu computador.'));
    leitor.readAsDataURL(arquivo);
  });
}

function semExtensao(nome: string): string {
  return nome.replace(/\.[^.]+$/, '').slice(0, 120);
}

function emTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
