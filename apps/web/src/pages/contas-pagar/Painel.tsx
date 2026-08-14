import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  BarrasComparadas,
  BarrasEmpilhadas,
  PALETA,
  type SerieGrafico,
} from '../../components/graficos';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL } from '../../lib/format';
import type { ContaAberta, ContasAbertas } from '../../lib/types';

/**
 * O painel do que a empresa deve, pelas três perguntas que se faz olhando uma
 * carteira de contas: **com o quê** se está devendo, **quando** vence, e **a
 * quem** se deve.
 *
 * Roda sobre a mesma leitura da tela de lista — mesma chave de consulta, mesma
 * resposta do IXC. Trocar de aba não faz o IXC ser consultado de novo, e os
 * dois lados nunca mostram totais diferentes por terem lido em momentos
 * distintos.
 */

/** Quantas fatias os gráficos mostram antes de juntar o resto. */
const TETO_DE_FATIAS = 8;

export function Painel() {
  const consulta = useQuery({
    queryKey: ['contas-abertas'],
    queryFn: async () => (await api.get<ContasAbertas>('/contas-abertas')).data,
    retry: 0,
  });

  // A lista vazia sai de um `useMemo` para ser sempre o mesmo array: um `[]`
  // criado a cada render refaria todos os agrupamentos abaixo sem nada ter
  // mudado.
  const contas = useMemo(() => consulta.data?.contas ?? [], [consulta.data]);

  const porCategoria = useMemo(
    () =>
      agrupar(contas, (c) => c.categoria.nome ?? rotuloDaContaSemNome(c)),
    [contas],
  );
  const porFornecedor = useMemo(
    () => agrupar(contas, (c) => c.fornecedor.nome || 'Sem fornecedor'),
    [contas],
  );
  const porMes = useMemo(() => agruparPorMes(contas), [contas]);
  const semCategoria = useMemo(
    () => contas.filter((c) => !c.categoria.nome).length,
    [contas],
  );

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Painel"
        titulo="Com o que a empresa está devendo"
        descricao="A mesma leitura da lista, vista por categoria de despesa, por mês de vencimento e por credor."
        acoes={
          <button
            onClick={() => consulta.refetch()}
            disabled={consulta.isFetching}
            className="btn btn-acao"
          >
            {consulta.isFetching ? 'Lendo o IXC…' : 'Atualizar'}
          </button>
        }
      />

      {consulta.error && (
        <Aviso tom="erro">
          Não deu para ler as contas do IXC: {mensagemErro(consulta.error)}
          {consulta.data ? ' Os gráficos são da última leitura que deu certo.' : ''}
        </Aviso>
      )}

      {!consulta.data ? (
        <Bloco semPadding>
          {consulta.error ? (
            <Vazio titulo="Não deu para ler o IXC">
              Os gráficos saem das contas que estão no IXC, e ele não respondeu
              agora. Tente de novo em Atualizar.
            </Vazio>
          ) : (
            <Carregando texto="Lendo as contas no IXC…" />
          )}
        </Bloco>
      ) : contas.length === 0 ? (
        <Bloco semPadding>
          <Vazio titulo="Nada em aberto">
            Não há conta em aberto no IXC neste momento — por isso não há o que
            desenhar.
          </Vazio>
        </Bloco>
      ) : (
        <div className="space-y-6">
          <Bloco titulo="Por urgência" className="surgir surgir-1">
            <FaixaDeUrgencia contas={contas} />
          </Bloco>

          <Bloco titulo="Por categoria de despesa" className="surgir surgir-2">
            {semCategoria > 0 && (
              <p className="mb-4 text-xs leading-relaxed text-tinta-500">
                {semCategoria === contas.length
                  ? 'Nenhum título veio com a conta de despesa preenchida no IXC — sem ela, o agrupamento fica pelo código da conta.'
                  : `${semCategoria} título(s) estão sem conta de despesa no IXC e aparecem agrupados à parte.`}
              </p>
            )}
            <BarrasComparadas itens={paraBarras(porCategoria)} />
          </Bloco>

          <Bloco titulo="Por mês de vencimento" className="surgir surgir-3">
            <BarrasEmpilhadas meses={porMes} series={SERIES_DO_MES} />
            <p className="ajuda">
              A primeira coluna junta tudo que já venceu, de qualquer ano. As
              seguintes são os próximos doze meses, um a um — é a leitura que
              diz quanto o caixa precisa ter e quando.
            </p>
          </Bloco>

          <Bloco titulo="Maiores credores" className="surgir surgir-4">
            <BarrasComparadas itens={paraBarras(porFornecedor)} />
          </Bloco>
        </div>
      )}
    </Pagina>
  );
}

/**
 * A régua de cores da casa, na mesma leitura da lista: vermelho já venceu,
 * amarelo vence hoje, verde ainda tem prazo. Uma barra só, proporcional ao
 * dinheiro — não à quantidade de títulos, que esconde uma conta de cem mil no
 * meio de trinta de cinquenta reais.
 */
function FaixaDeUrgencia({ contas }: { contas: ContaAberta[] }) {
  const fatias = [
    {
      rotulo: 'Vencidas',
      cor: '#E11D48',
      contas: contas.filter((c) => c.diasParaVencer !== null && c.diasParaVencer < 0),
    },
    {
      rotulo: 'Vencem hoje',
      cor: '#F59E0B',
      contas: contas.filter((c) => c.diasParaVencer === 0),
    },
    {
      rotulo: 'Ainda no prazo',
      cor: '#10B981',
      contas: contas.filter((c) => c.diasParaVencer !== null && c.diasParaVencer > 0),
    },
    {
      rotulo: 'Sem vencimento',
      cor: '#94A3B8',
      contas: contas.filter((c) => c.diasParaVencer === null),
    },
  ]
    .map((f) => ({
      ...f,
      total: somar(f.contas),
    }))
    .filter((f) => f.contas.length > 0);

  const total = fatias.reduce((s, f) => s + f.total, 0) || 1;

  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-tinta-100">
        {fatias.map((f) => (
          <div
            key={f.rotulo}
            style={{ width: `${(f.total / total) * 100}%`, background: f.cor }}
            title={`${f.rotulo}: ${formatBRL(f.total)}`}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        {fatias.map((f) => (
          <span key={f.rotulo} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: f.cor }}
            />
            <span className="text-tinta-500">{f.rotulo}</span>
            <span className="valor text-[12px] text-tinta-700">
              {formatBRL(f.total)}
            </span>
            <span className="text-tinta-400">({f.contas.length})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const SERIES_DO_MES: SerieGrafico[] = [
  { chave: 'vencido', rotulo: 'Já vencido', cor: '#E11D48' },
  { chave: 'aVencer', rotulo: 'A vencer', cor: PALETA[0] },
];

interface Grupo {
  rotulo: string;
  total: number;
  quantidade: number;
}

/**
 * Soma por chave e devolve do maior para o menor. O que não cabe nas primeiras
 * fatias vira uma linha só — trinta barrinhas de um por cento não são um
 * gráfico, são uma lista ruim.
 */
function agrupar(
  contas: ContaAberta[],
  chave: (c: ContaAberta) => string,
): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const c of contas) {
    const k = chave(c);
    const atual = mapa.get(k) ?? { rotulo: k, total: 0, quantidade: 0 };
    atual.total += c.valorAberto;
    atual.quantidade += 1;
    mapa.set(k, atual);
  }

  const ordenado = [...mapa.values()].sort((a, b) => b.total - a.total);
  if (ordenado.length <= TETO_DE_FATIAS) return ordenado;

  const cabem = ordenado.slice(0, TETO_DE_FATIAS);
  const resto = ordenado.slice(TETO_DE_FATIAS);
  cabem.push({
    rotulo: `Outras ${resto.length}`,
    total: resto.reduce((s, g) => s + g.total, 0),
    quantidade: resto.reduce((s, g) => s + g.quantidade, 0),
  });
  return cabem;
}

function paraBarras(grupos: Grupo[]) {
  return grupos.map((g, i) => ({
    rotulo: g.rotulo,
    valor: g.total,
    cor: PALETA[i % PALETA.length],
    detalhe: `${g.quantidade} tít.`,
  }));
}

/** Quantos meses à frente o calendário mostra antes de juntar o resto. */
const MESES_A_FRENTE = 12;

/**
 * O calendário da dívida, contado a partir de hoje.
 *
 * A primeira versão desenhava do mês do título mais antigo ao do mais novo. Só
 * que uma conta esquecida de 2023 no meio de uma carteira de 2026 abre três
 * anos de eixo: as colunas viravam quarenta, o corte pegava as primeiras, e o
 * gráfico mostrava dezoito meses vazios de 2023 e 2024 enquanto escondia
 * justamente onde está o dinheiro.
 *
 * Agora o eixo é o que serve para planejar o caixa: tudo que já venceu numa
 * coluna só na frente — não importa de que ano —, os doze meses seguintes um a
 * um, e o que passa disso numa última coluna. Os meses vazios do meio ficam,
 * porque é o vazio que mostra o fôlego entre um vencimento e outro.
 */
function agruparPorMes(
  contas: ContaAberta[],
): Array<{ competencia: string; vencido: number; aVencer: number }> {
  const comData = contas.filter((c) => c.vencimento !== null);
  if (comData.length === 0) return [];

  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const janela = mesesSeguintes(mesAtual, MESES_A_FRENTE);
  const ultimoDaJanela = janela[janela.length - 1];

  const vencidas = { competencia: 'Vencidas', vencido: 0, aVencer: 0 };
  const depois = { competencia: 'Depois', vencido: 0, aVencer: 0 };
  const porMes = new Map(
    janela.map((m) => [m, { competencia: m, vencido: 0, aVencer: 0 }]),
  );

  for (const c of comData) {
    const mes = String(c.vencimento).slice(0, 7);
    if (c.diasParaVencer !== null && c.diasParaVencer < 0) {
      vencidas.vencido += c.valorAberto;
      continue;
    }
    const alvo =
      mes > ultimoDaJanela ? depois : (porMes.get(mes) ?? depois);
    alvo.aVencer += c.valorAberto;
  }

  // As pontas só aparecem quando têm o que mostrar: uma coluna "vencidas"
  // zerada faria procurar um atraso que não existe.
  return [
    ...(vencidas.vencido > 0 ? [vencidas] : []),
    ...janela.map((m) => porMes.get(m)!),
    ...(depois.aVencer > 0 ? [depois] : []),
  ];
}

/** O mês dado e os seguintes, em sequência. */
function mesesSeguintes(inicio: string, quantos: number): string[] {
  const [anoInicial, mesInicial] = inicio.split('-').map(Number);
  const meses: string[] = [];

  let ano = anoInicial;
  let mes = mesInicial;
  for (let i = 0; i < quantos; i++) {
    meses.push(`${ano}-${String(mes).padStart(2, '0')}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}

/** Conta sem nome de categoria: mostra o código, que ao menos é rastreável. */
function rotuloDaContaSemNome(c: ContaAberta): string {
  return c.categoria.id === null ? 'Sem categoria' : `Conta ${c.categoria.id}`;
}

function somar(contas: ContaAberta[]): number {
  return contas.reduce((s, c) => s + c.valorAberto, 0);
}
