import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconePasta } from '../../components/icones';
import {
  Aviso,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatData } from '../../lib/format';
import type { EstanteRh, PastaRh } from '../../lib/types';

/**
 * A estante: uma pasta por pessoa, mais a da empresa.
 *
 * As pastas de funcionário nascem sozinhas, do cadastro — abrir a estante e
 * ter de criar a pasta do Fulano antes de guardar o contrato dele seria
 * trabalho que o sistema já sabe fazer. O botão de criar existe para quem não
 * está no cadastro: o sócio, o estagiário da faculdade, quem já saiu antes de o
 * sistema existir.
 */
export function PastasRh() {
  const qc = useQueryClient();
  const [termo, setTermo] = useState('');
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const estante = useQuery({
    queryKey: ['rh', 'pastas'],
    queryFn: async () => (await api.get<EstanteRh>('/rh/pastas')).data,
  });

  const pastas = useMemo(() => {
    const todas = estante.data?.pastas ?? [];
    const busca = termo.trim().toLowerCase();
    if (!busca) return todas;
    return todas.filter((p) =>
      [p.nome, p.apelido, p.funcao, p.cpf]
        .filter(Boolean)
        .some((campo) => String(campo).toLowerCase().includes(busca)),
    );
  }, [estante.data, termo]);

  const criar = useMutation({
    mutationFn: async (dados: { nome: string; cpf?: string }) =>
      (await api.post<PastaRh>('/rh/pastas', dados)).data,
    onSuccess: () => {
      setCriando(false);
      setErro(null);
      void qc.invalidateQueries({ queryKey: ['rh', 'pastas'] });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const comPendencia = pastas.filter((p) => p.vencidos > 0 || p.aVencer > 0);

  return (
    <Pagina>
      <CabecalhoPagina
        secao="RH"
        titulo="Pastas"
        descricao="Onde os documentos da casa ficam: uma pasta por pessoa, mais a da empresa. Contrato, exame, advertência e o recibo de pagamento de cada mês."
        acoes={
          <button
            type="button"
            onClick={() => {
              setErro(null);
              setCriando(true);
            }}
            className="btn btn-primario"
          >
            Nova pasta
          </button>
        }
      />

      {erro && !criando && <Aviso tom="erro">{erro}</Aviso>}

      {comPendencia.length > 0 && (
        <Aviso tom="atencao">
          {comPendencia.length === 1
            ? '1 pasta tem documento vencido ou vencendo'
            : `${comPendencia.length} pastas têm documento vencido ou vencendo`}{' '}
          — o crachá vermelho na pasta diz quantos.
        </Aviso>
      )}

      <div className="surgir mb-5">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Procurar por nome, apelido, função ou CPF"
          className="campo max-w-md"
        />
      </div>

      {estante.isLoading ? (
        <Carregando texto="Abrindo a estante…" />
      ) : pastas.length === 0 ? (
        <Vazio
          titulo={termo ? 'Nenhuma pasta com esse nome' : 'A estante está vazia'}
        >
          {termo
            ? 'Procure por outro pedaço do nome, ou crie a pasta.'
            : 'As pastas dos funcionários nascem do cadastro. Sem nenhuma aqui, sincronize os funcionários no módulo da folha.'}
        </Vazio>
      ) : (
        <div className="surgir grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pastas.map((p) => (
            <CartaoDaPasta key={p.id} pasta={p} />
          ))}
        </div>
      )}

      {criando && (
        <Janela titulo="Nova pasta" onFechar={() => setCriando(false)}>
          <FormularioDaPasta
            pendente={criar.isPending}
            erro={erro}
            onSalvar={(dados) => criar.mutate(dados)}
          />
        </Janela>
      )}
    </Pagina>
  );
}

/** A pasta na estante: o nome, o que há dentro e o que está vencendo. */
function CartaoDaPasta({ pasta }: { pasta: PastaRh }) {
  return (
    <Link
      to={`/rh/pastas/${pasta.id}`}
      className="group flex items-start gap-3 rounded-2xl border border-tinta-200 bg-papel p-4 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-sm"
    >
      <span
        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          pasta.daEmpresa
            ? 'bg-brand-500/15 text-brand-600'
            : 'bg-amber-500/15 text-amber-600'
        }`}
      >
        <IconePasta className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-tinta-800">
            {pasta.nome}
          </span>
          {pasta.inativo && (
            <Selo pequeno tom="neutro" titulo="Não trabalha mais aqui">
              saiu
            </Selo>
          )}
          {pasta.avulsa && (
            <Selo pequeno tom="neutro" titulo="Criada à mão, fora do cadastro">
              avulsa
            </Selo>
          )}
        </div>

        <p className="truncate text-xs text-tinta-400">
          {pasta.apelido ? `"${pasta.apelido}" · ` : ''}
          {pasta.funcao ?? (pasta.daEmpresa ? 'Documentos da empresa' : '—')}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-tinta-500">
          <span className="num">
            {pasta.qtd === 0
              ? 'nenhum documento'
              : pasta.qtd === 1
                ? '1 documento'
                : `${pasta.qtd} documentos`}
          </span>
          {pasta.ultimoEm && (
            <span className="text-tinta-400">
              · último em {formatData(pasta.ultimoEm)}
            </span>
          )}
          {pasta.vencidos > 0 && (
            <Selo pequeno tom="erro">
              {pasta.vencidos} vencido{pasta.vencidos > 1 ? 's' : ''}
            </Selo>
          )}
          {pasta.aVencer > 0 && (
            <Selo pequeno tom="atencao">
              {pasta.aVencer} vencendo
            </Selo>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Nome e CPF: o CPF é o que faz o recibo do mês achar esta pasta sozinho. */
function FormularioDaPasta({
  pendente,
  erro,
  onSalvar,
}: {
  pendente: boolean;
  erro: string | null;
  onSalvar: (dados: { nome: string; cpf?: string }) => void;
}) {
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (nome.trim().length >= 2) {
          onSalvar({ nome: nome.trim(), cpf: cpf.trim() || undefined });
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="nome-da-pasta">
            De quem é a pasta
          </label>
          <input
            id="nome-da-pasta"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome completo"
            className="campo"
            autoFocus
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="cpf-da-pasta">
            CPF <span className="text-tinta-400">(opcional)</span>
          </label>
          <input
            id="cpf-da-pasta"
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="000.000.000-00"
            inputMode="numeric"
            className="campo"
          />
          <p className="ajuda">
            É por ele que o recibo de pagamento acha esta pasta sozinho quando o
            PDF do mês for separado. Nome muda de grafia; CPF não.
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
          disabled={nome.trim().length < 2 || pendente}
          className="btn btn-primario"
        >
          {pendente ? 'Criando…' : 'Criar pasta'}
        </button>
      </div>
    </form>
  );
}
