import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
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
import type { Dashboard as TDashboard } from '../lib/types';

function competenciaAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatComp(comp: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  return m ? `${m[2]}/${m[1]}` : comp;
}

const MES_CURTO = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

function rotuloMes(comp: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  return m ? `${MES_CURTO[Number(m[2]) - 1]}/${m[1].slice(2)}` : comp;
}

export function Dashboard() {
  const [competencia, setCompetencia] = useState(competenciaAtual());

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard', competencia],
    queryFn: async () =>
      (await api.get<TDashboard>('/dashboard', { params: { competencia } }))
        .data,
  });

  const f = data?.funcionarios;
  const folha = data?.folha;
  const vales = data?.vales;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Dashboard"
        titulo={`Folha de ${formatComp(competencia)}`}
        descricao="O que já saiu, o que está parado esperando alguém e o que a competência ainda deve."
        acoes={
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
              rotulo="Folha base mensal"
              valor={formatBRL(f?.folhaBaseMensal)}
              detalhe={
                f && f.bonusFixoMensal > 0
                  ? `${formatBRL(f.salarioBaseMensal)} de base + ${formatBRL(f.bonusFixoMensal)} de bônus fixos`
                  : 'soma da base de quem está ativo'
              }
            />
            <Indicador
              rotulo="Gerado na competência"
              valor={formatBRL(folha?.total)}
              detalhe={`${folha?.quantidade ?? 0} conta(s) a pagar`}
            />
            <Indicador
              rotulo="Confirmado pelo banco"
              valor={formatBRL(folha?.pago)}
              detalhe={`${formatBRL(folha?.emAberto)} ainda em aberto`}
              alerta={
                (folha?.comErro ?? 0) > 0
                  ? `${formatBRL(folha?.comErro)} com erro no IXC`
                  : undefined
              }
            />
            <Indicador
              rotulo="Pessoas ativas"
              valor={f?.ativos ?? '—'}
              detalhe={`${f?.inativos ?? 0} inativas`}
              alerta={
                (f?.semPix ?? 0) > 0 ? `${f?.semPix} sem chave PIX` : undefined
              }
            />
          </div>

          <div className="surgir surgir-2 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Bloco titulo="Últimos 6 meses" className="lg:col-span-2">
              <Serie serie={data.serie} atual={competencia} />
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

          <div className="surgir surgir-3 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Bloco titulo={`Situação em ${formatComp(competencia)}`}>
              {folha && folha.porStatus.length > 0 ? (
                <>
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
                  {folha.porTipo.length > 0 && (
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-tinta-100 pt-4">
                      {folha.porTipo.map((t) => (
                        <span
                          key={t.tipo}
                          className="rounded-lg bg-tinta-50 px-3 py-1.5 text-xs text-tinta-500"
                        >
                          {TIPO_LABEL[t.tipo]}{' '}
                          <strong className="valor text-[13px]">
                            {formatBRL(t.valor)}
                          </strong>
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <Vazio titulo="Nada gerado nesta competência">
                  Quando você calcular a folha, o andamento de cada conta
                  aparece aqui.{' '}
                  <Link to="/folha" className="font-semibold text-brand-700 hover:underline">
                    Gerar folha
                  </Link>
                </Vazio>
              )}
            </Bloco>

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
          </div>

          <div className="surgir surgir-4">
            <Bloco titulo="Últimos lançamentos" semPadding>
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
                          <td className="td text-tinta-500 num">
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

/**
 * Seis meses de folha. A barra inteira é o que foi gerado; a parte sólida é o
 * que o banco confirmou — a distância entre as duas é o que falta acontecer.
 */
function Serie({
  serie,
  atual,
}: {
  serie: { competencia: string; total: number; pago: number }[];
  atual: string;
}) {
  const maior = Math.max(1, ...serie.map((s) => s.total));
  return (
    <div>
      <div className="flex h-56 items-end gap-2 sm:gap-4">
        {serie.map((s, i) => {
          const altura = (s.total / maior) * 100;
          const pago = s.total > 0 ? (s.pago / s.total) * 100 : 0;
          const eAtual = s.competencia === atual;
          return (
            <div
              key={s.competencia}
              className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2"
            >
              <span
                className={`num text-[11px] font-semibold transition ${
                  eAtual ? 'text-tinta-700' : 'text-tinta-400'
                }`}
              >
                {s.total > 0 ? formatBRL(s.total) : ''}
              </span>
              <div
                className="flex w-full origin-bottom animate-crescer items-end justify-center overflow-hidden rounded-t-lg bg-tinta-100 transition group-hover:bg-tinta-200"
                style={{
                  height: `${Math.max(altura, 2)}%`,
                  animationDelay: `${i * 70}ms`,
                }}
                title={`${s.competencia} — gerado ${formatBRL(
                  s.total,
                )}, pago ${formatBRL(s.pago)}`}
              >
                <div
                  className="w-full rounded-t-lg bg-gradient-to-t from-brand-600 to-brand-400"
                  style={{ height: `${pago}%` }}
                />
              </div>
              <span
                className={`text-xs ${
                  eAtual
                    ? 'font-semibold text-tinta-800'
                    : 'text-tinta-400'
                }`}
              >
                {rotuloMes(s.competencia)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-tinta-100 pt-4 text-xs text-tinta-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-brand-600 to-brand-400" />
          pago
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-tinta-100" />
          gerado, ainda não pago
        </span>
      </div>
    </div>
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
