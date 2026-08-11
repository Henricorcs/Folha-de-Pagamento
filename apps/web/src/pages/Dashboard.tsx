import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarrasComparadas,
  BarrasEmpilhadas,
  PALETA,
  type SerieGrafico,
} from '../components/graficos';
import {
  Bloco,
  CabecalhoPagina,
  Carregando,
  Indicador,
  Pagina,
  Selo,
  Vazio,
} from '../components/ui';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import { STATUS_LABEL, STATUS_TOM, TIPO_LABEL } from '../lib/status';
import type { Dashboard as TDashboard, TipoLancamento } from '../lib/types';

function competenciaAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatComp(comp: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  return m ? `${m[2]}/${m[1]}` : comp;
}

/** Quantos meses as séries cobrem. Um mês só vira leitura do mês fechado. */
const PERIODOS = [1, 3, 6, 12];

/** Do que a empresa gasta com gente — ordem fixa, do maior ao mais eventual. */
const SERIES_CUSTO: SerieGrafico[] = [
  { chave: 'folha', rotulo: 'Folha', cor: PALETA[0] },
  { chave: 'diaristas', rotulo: 'Diaristas', cor: PALETA[1] },
  { chave: 'encargos', rotulo: 'Encargos patronais', cor: PALETA[2] },
];

const SERIES_TIPO: SerieGrafico[] = [
  { chave: 'salario', rotulo: 'Salário', cor: PALETA[0] },
  { chave: 'adiantamento', rotulo: 'Adiantamento', cor: PALETA[1] },
  { chave: 'bonus', rotulo: 'Bônus', cor: PALETA[2] },
  { chave: 'diaria', rotulo: 'Diária', cor: PALETA[3] },
  { chave: 'avulso', rotulo: 'Avulso', cor: PALETA[4] },
];

/**
 * Mesma cor para o mesmo tipo em toda a tela: o bônus é azul na barra do mês e
 * azul na repartição. Cor segue a coisa, nunca a posição no ranking.
 */
const COR_DO_TIPO: Record<TipoLancamento, string> = {
  SALARIO: PALETA[0],
  ADIANTAMENTO: PALETA[1],
  BONUS: PALETA[2],
  DIARIA: PALETA[3],
  AVULSO: PALETA[4],
  DESCONTO: PALETA[4],
};

const SERIES_IMPOSTO: SerieGrafico[] = [
  { chave: 'folhaPatronal', rotulo: 'Patronal (custo)', cor: PALETA[0] },
  { chave: 'folhaRetido', rotulo: 'Retido (repasse)', cor: PALETA[1] },
  { chave: 'faturamento', rotulo: 'Sobre faturamento', cor: PALETA[2] },
];

export function Dashboard() {
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [meses, setMeses] = useState(12);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard', competencia, meses],
    queryFn: async () =>
      (
        await api.get<TDashboard>('/dashboard', {
          params: { competencia, meses },
        })
      ).data,
    // É a tela que fica aberta o dia todo, enquanto o dinheiro anda em outro
    // lugar (a auditoria do IXC, o retorno do banco). Voltar para ela relê os
    // números em vez de mostrar a foto de quando a aba foi aberta.
    refetchOnWindowFocus: true,
  });

  const f = data?.funcionarios;
  const folha = data?.folha;
  const vales = data?.vales;

  // Números do mês em foco, que é sobre o que os cartões falam.
  const custoDoMes = data?.custoPessoal.find((c) => c.competencia === competencia);
  const tiposDoMes = data?.serieTipos.find((t) => t.competencia === competencia);
  const diariasDoMes = data?.diaristas.serie.find(
    (d) => d.competencia === competencia,
  );
  const impostoDoMes = data?.impostos.serie.find(
    (i) => i.competencia === competencia,
  );
  const semGuia = (data?.impostos.guias.length ?? 0) === 0;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Dashboard"
        titulo={`Folha de ${formatComp(competencia)}`}
        descricao="Quanto custa a operação, para onde o dinheiro foi e o que ainda está parado esperando alguém."
        acoes={
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="rotulo" htmlFor="competencia">
                Competência
              </label>
              <input
                id="competencia"
                type="month"
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
                className="campo"
              />
            </div>
            <div>
              <span className="rotulo">Histórico</span>
              <div className="flex gap-1 rounded-xl bg-tinta-100 p-1">
                {PERIODOS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setMeses(n)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      meses === n
                        ? 'bg-white text-tinta-800 shadow-aba'
                        : 'text-tinta-500 hover:text-tinta-700'
                    }`}
                  >
                    {n === 1 ? '1 mês' : `${n} meses`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        }
      />

      {isError && (
        <div className="card p-6 text-sm text-rose-600">
          {mensagemErro(error)}
        </div>
      )}
      {isLoading && (
        <div className="card">
          <Carregando />
        </div>
      )}

      {data && (
        <div className="space-y-6">
          <div className="surgir surgir-1 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Indicador
              acento
              rotulo={`Custo com pessoal em ${formatComp(competencia)}`}
              valor={formatBRL(custoDoMes?.total)}
              detalhe={
                custoDoMes
                  ? `${formatBRL(custoDoMes.folha)} de folha + ${formatBRL(custoDoMes.diaristas)} de diárias + ${formatBRL(custoDoMes.encargos)} de encargos`
                  : 'nada lançado nesta competência'
              }
            />
            <Indicador
              rotulo="Bônus pago"
              valor={formatBRL(tiposDoMes?.bonus)}
              detalhe={
                f && f.bonusFixoMensal > 0
                  ? `${formatBRL(f.bonusFixoMensal)} de bônus fixos no cadastro`
                  : 'sem bônus fixo no cadastro'
              }
            />
            <Indicador
              rotulo="Gasto com diaristas"
              valor={formatBRL(diariasDoMes?.valor)}
              detalhe={
                <>
                  {`${diariasDoMes?.quantidade ?? 0} diária(s) · ${diariasDoMes?.pessoas ?? 0} pessoa(s)`}
                  {!!diariasDoMes?.travadas && (
                    <>
                      <br />
                      {formatBRL(diariasDoMes.travado)} em{' '}
                      {diariasDoMes.travadas} diária(s) travadas no IXC ficaram
                      de fora
                    </>
                  )}
                </>
              }
              alerta={
                diariasDoMes && diariasDoMes.aCaminho > 0
                  ? `${formatBRL(diariasDoMes.aCaminho)} lançado, esperando o banco`
                  : undefined
              }
            />
            <Indicador
              rotulo="Encargos patronais"
              valor={formatBRL(impostoDoMes?.folhaPatronal)}
              detalhe={
                impostoDoMes && impostoDoMes.folhaRetido > 0
                  ? `+ ${formatBRL(impostoDoMes.folhaRetido)} retido do trabalhador`
                  : 'FGTS e a parte patronal do INSS'
              }
              alerta={semGuia ? 'nenhuma guia lançada' : undefined}
            />
          </div>

          <div className="surgir surgir-2 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Bloco
              titulo={
                meses === 1
                  ? 'Custo com pessoal no mês'
                  : `Custo com pessoal — ${meses} meses`
              }
              className="lg:col-span-2"
            >
              <BarrasEmpilhadas
                meses={data.custoPessoal}
                series={SERIES_CUSTO}
                atual={competencia}
              />
              <p className="mt-3 text-xs leading-relaxed text-tinta-400">
                O INSS descontado do trabalhador fica fora: é dinheiro dele
                passando pela conta da empresa, e somar aqui contaria o mesmo
                salário duas vezes.
              </p>
            </Bloco>

            <Bloco titulo={`Para onde foi em ${formatComp(competencia)}`}>
              {folha && folha.porTipo.length > 0 ? (
                <BarrasComparadas
                  itens={folha.porTipo
                    .filter((t) => t.valor > 0)
                    .map((t) => ({
                      rotulo: TIPO_LABEL[t.tipo],
                      valor: t.valor,
                      cor: COR_DO_TIPO[t.tipo],
                      detalhe: `${t.quantidade}×`,
                    }))}
                />
              ) : (
                <Vazio titulo="Nada gerado nesta competência">
                  Quando você calcular a folha, a repartição aparece aqui.{' '}
                  <Link
                    to="/folha"
                    className="font-semibold text-brand-700 hover:underline"
                  >
                    Gerar folha
                  </Link>
                </Vazio>
              )}
            </Bloco>
          </div>

          <div className="surgir surgir-3 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Bloco titulo="O que a folha pagou, mês a mês">
              <BarrasEmpilhadas
                meses={data.serieTipos}
                series={SERIES_TIPO}
                atual={competencia}
                altura="h-48"
              />
            </Bloco>

            <Bloco
              titulo="Impostos"
              acao={
                <Link
                  to="/impostos"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  Lançar guia
                </Link>
              }
            >
              {semGuia ? (
                <Vazio titulo="Nenhuma guia lançada">
                  Suba o PDF do DARF, do FGTS, do DAS ou do DARE que a
                  contabilidade manda e o imposto entra aqui.{' '}
                  <Link
                    to="/impostos"
                    className="font-semibold text-brand-700 hover:underline"
                  >
                    Lançar a primeira
                  </Link>
                </Vazio>
              ) : (
                <>
                  <BarrasEmpilhadas
                    meses={data.impostos.serie}
                    series={SERIES_IMPOSTO}
                    atual={competencia}
                    altura="h-48"
                  />
                  <p className="mt-3 text-xs leading-relaxed text-tinta-400">
                    Só o patronal é custo da empresa. O retido é do trabalhador,
                    e o de faturamento não tem a ver com gente.
                  </p>
                </>
              )}
            </Bloco>
          </div>

          <div className="surgir surgir-3 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Bloco titulo="Diaristas">
              <BarrasEmpilhadas
                meses={data.diaristas.serie}
                series={[
                  { chave: 'valor', rotulo: 'Diárias', cor: PALETA[1] },
                ]}
                atual={competencia}
                altura="h-40"
              />
            </Bloco>

            <Bloco titulo={`Situação em ${formatComp(competencia)}`}>
              {folha && folha.porStatus.length > 0 ? (
                <div className="space-y-2.5">
                  {folha.porStatus.map((s) => (
                    <div
                      key={s.status}
                      className="flex items-center justify-between gap-3"
                    >
                      <Selo tom={STATUS_TOM[s.status]} ponto>
                        {STATUS_LABEL[s.status]}
                      </Selo>
                      <div className="flex items-baseline gap-3">
                        <span className="text-xs text-tinta-400">
                          {s.quantidade}
                        </span>
                        <span className="valor text-sm">
                          {formatBRL(s.valor)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Vazio titulo="Nada gerado nesta competência" />
              )}
            </Bloco>

            <Bloco
              titulo="Vales e acertos"
              acao={
                <Link
                  to="/vales"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  Ver todos
                </Link>
              }
            >
              <div className="space-y-3">
                <SaldoVale
                  rotulo="Funcionários devem"
                  valor={formatBRL(vales?.saldoDevedor)}
                  tom="text-amber-700"
                />
                <SaldoVale
                  rotulo="Empresa deve"
                  valor={formatBRL(vales?.saldoAPagar)}
                  tom="text-emerald-700"
                />
                <div className="border-t border-tinta-100 pt-3">
                  <Linha
                    rotulo={`Desconta em ${formatComp(competencia)}`}
                    valor={formatBRL(vales?.descontoNaCompetencia)}
                  />
                  <Linha
                    rotulo={`Paga a mais em ${formatComp(competencia)}`}
                    valor={formatBRL(vales?.creditoNaCompetencia)}
                  />
                  <Linha
                    rotulo="Vales em aberto"
                    valor={String(vales?.valesEmAberto ?? 0)}
                  />
                </div>
              </div>
            </Bloco>
          </div>

          <div className="surgir surgir-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Bloco titulo="Pontos de atenção">
              <ul className="space-y-3">
                <Atencao
                  ok={(f?.semPix ?? 0) === 0}
                  para="/funcionarios"
                  texto={
                    (f?.semPix ?? 0) === 0
                      ? 'Todo mundo ativo tem chave PIX.'
                      : `${f?.semPix} pessoa(s) ativa(s) sem chave PIX — o pagamento não sai.`
                  }
                />
                <Atencao
                  ok={(folha?.comErro ?? 0) === 0}
                  para="/contas-pagar"
                  texto={
                    (folha?.comErro ?? 0) === 0
                      ? 'Nenhuma conta com erro no IXC.'
                      : `${formatBRL(folha?.comErro)} em contas que o IXC recusou — reenvie.`
                  }
                />
                <Atencao
                  ok={(folha?.emAberto ?? 0) === 0}
                  para="/contas-pagar"
                  texto={
                    (folha?.emAberto ?? 0) === 0
                      ? 'Nada pendente nesta competência.'
                      : `${formatBRL(folha?.emAberto)} esperando aprovação ou pagamento.`
                  }
                />
                <Atencao
                  ok={(diariasDoMes?.travadas ?? 0) === 0}
                  para="/diaristas"
                  texto={
                    (diariasDoMes?.travadas ?? 0) === 0
                      ? 'Nenhuma diária parada no meio do caminho.'
                      : `${diariasDoMes?.travadas} diária(s) com a conta a pagar reprovada, recusada ou apagada no IXC — fora do gasto do mês.`
                  }
                />
                <Atencao
                  ok={!semGuia}
                  para="/impostos"
                  texto={
                    semGuia
                      ? 'Nenhuma guia de imposto lançada — o custo com pessoal está incompleto.'
                      : `${data.impostos.guias.length} guia(s) lançada(s) no período.`
                  }
                />
              </ul>
              {data.ultimoSync && (
                <p className="mt-5 border-t border-tinta-100 pt-4 text-xs text-tinta-400">
                  Última sincronização com o IXC em{' '}
                  {formatData(
                    data.ultimoSync.concluidoEm ?? data.ultimoSync.iniciadoEm,
                  )}{' '}
                  · {data.ultimoSync.recurso} · {data.ultimoSync.totalLidos}{' '}
                  registro(s)
                </p>
              )}
            </Bloco>

            <Bloco titulo="Últimos lançamentos" className="lg:col-span-2" semPadding>
              {data.ultimasContas.length === 0 ? (
                <Vazio titulo="Nenhuma conta a pagar ainda">
                  Comece pela tela Gerar Folha.
                </Vazio>
              ) : (
                <div className="overflow-x-auto rolagem-fina">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-tinta-100">
                        <th className="th">Beneficiário</th>
                        <th className="th">Tipo</th>
                        <th className="th">Competência</th>
                        <th className="th">Situação</th>
                        <th className="th text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ultimasContas.map((c) => (
                        <tr key={c.id} className="linha">
                          <td className="td font-medium text-tinta-800">
                            {c.beneficiarioNome}
                          </td>
                          <td className="td text-tinta-500">
                            {TIPO_LABEL[c.tipo]}
                          </td>
                          <td className="td num text-tinta-500">
                            {c.competencia ? formatComp(c.competencia) : '—'}
                          </td>
                          <td className="td">
                            <Selo tom={STATUS_TOM[c.status]}>
                              {STATUS_LABEL[c.status]}
                            </Selo>
                          </td>
                          <td className="td text-right">
                            <span className="valor">{formatBRL(c.valor)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Bloco>
          </div>
        </div>
      )}
    </Pagina>
  );
}

function SaldoVale({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string;
  valor: string;
  tom: string;
}) {
  return (
    <div>
      <p className="text-xs text-tinta-400">{rotulo}</p>
      <p className={`font-display text-xl font-semibold num ${tom}`}>{valor}</p>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-tinta-500">{rotulo}</span>
      <span className="num font-medium text-tinta-800">{valor}</span>
    </div>
  );
}

function Atencao({
  ok,
  texto,
  para,
}: {
  ok: boolean;
  texto: string;
  para: string;
}) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
          ok ? 'bg-emerald-500' : 'bg-amber-500'
        }`}
      >
        {ok ? '✓' : '!'}
      </span>
      {ok ? (
        <span className="text-tinta-500">{texto}</span>
      ) : (
        <Link
          to={para}
          className="text-tinta-700 underline decoration-tinta-200 underline-offset-4 hover:decoration-tinta-400"
        >
          {texto}
        </Link>
      )}
    </li>
  );
}
