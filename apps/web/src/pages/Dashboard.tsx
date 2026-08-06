import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import { STATUS_CLASSE, STATUS_LABEL, TIPO_LABEL } from '../lib/status';
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

  if (isError)
    return <div className="p-8 text-red-500">{mensagemErro(error)}</div>;

  const f = data?.funcionarios;
  const folha = data?.folha;
  const vales = data?.vales;
  const maiorDaSerie = Math.max(1, ...(data?.serie.map((s) => s.total) ?? [1]));

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Como está a folha de {formatComp(competencia)} e o que ela deixa
            pendente.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Competência
          </label>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {isLoading && <p className="text-slate-400">Carregando…</p>}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card
              titulo="Folha base mensal"
              valor={formatBRL(f?.folhaBaseMensal)}
              detalhe={
                f && f.bonusFixoMensal > 0
                  ? `salários ${formatBRL(f.salarioBaseMensal)} + bônus fixos ${formatBRL(f.bonusFixoMensal)}`
                  : 'soma dos salários base dos ativos'
              }
            />
            <Card
              titulo="Funcionários ativos"
              valor={f?.ativos ?? '—'}
              detalhe={`${f?.inativos ?? 0} inativos`}
              link="/funcionarios"
            />
            <Card
              titulo={`Gerado em ${formatComp(competencia)}`}
              valor={formatBRL(folha?.total)}
              detalhe={`${folha?.quantidade ?? 0} conta(s) a pagar`}
              link="/contas-pagar"
            />
            <Card
              titulo="Pago x em aberto"
              valor={formatBRL(folha?.pago)}
              detalhe={`${formatBRL(folha?.emAberto)} ainda em aberto`}
              destaque={
                (folha?.comErro ?? 0) > 0
                  ? `${formatBRL(folha?.comErro)} com erro no IXC`
                  : undefined
              }
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Bloco titulo="Últimos 6 meses" className="lg:col-span-2">
              <div className="flex h-52 items-end gap-3">
                {data.serie.map((s) => {
                  const altura = (s.total / maiorDaSerie) * 100;
                  const pago = s.total > 0 ? (s.pago / s.total) * 100 : 0;
                  return (
                    <div
                      key={s.competencia}
                      className="flex flex-1 flex-col items-center gap-1"
                    >
                      <span className="text-[10px] text-slate-500">
                        {s.total > 0 ? formatBRL(s.total) : ''}
                      </span>
                      <div
                        className="flex w-full items-end justify-center rounded-t bg-slate-100"
                        style={{ height: `${Math.max(altura, 2)}%` }}
                        title={`${formatComp(s.competencia)} — total ${formatBRL(
                          s.total,
                        )}, pago ${formatBRL(s.pago)}`}
                      >
                        <div
                          className="w-full rounded-t bg-brand-500"
                          style={{ height: `${pago}%` }}
                        />
                      </div>
                      <span
                        className={`text-xs ${
                          s.competencia === competencia
                            ? 'font-semibold text-slate-700'
                            : 'text-slate-400'
                        }`}
                      >
                        {rotuloMes(s.competencia)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Barra cheia = total gerado na competência; a parte colorida é o
                que o banco já confirmou como pago.
              </p>
            </Bloco>

            <Bloco titulo="Vales e acertos">
              <Linha
                rotulo="Funcionários devem"
                valor={formatBRL(vales?.saldoDevedor)}
              />
              <Linha
                rotulo="Empresa deve"
                valor={formatBRL(vales?.saldoAPagar)}
              />
              <Linha
                rotulo={`Desconto em ${formatComp(competencia)}`}
                valor={formatBRL(vales?.descontoNaCompetencia)}
              />
              <Linha
                rotulo={`A pagar a mais em ${formatComp(competencia)}`}
                valor={formatBRL(vales?.creditoNaCompetencia)}
              />
              <Linha
                rotulo="Vales em aberto"
                valor={String(vales?.valesEmAberto ?? 0)}
              />
              <Link
                to="/vales"
                className="mt-3 inline-block text-sm text-brand-700 hover:underline"
              >
                Ver vales e acertos →
              </Link>
            </Bloco>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Bloco titulo={`Situação das contas de ${formatComp(competencia)}`}>
              {folha && folha.porStatus.length > 0 ? (
                <table className="w-full text-sm">
                  <tbody>
                    {folha.porStatus.map((s) => (
                      <tr key={s.status} className="border-t border-slate-100">
                        <td className="py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              STATUS_CLASSE[s.status]
                            }`}
                          >
                            {STATUS_LABEL[s.status]}
                          </span>
                        </td>
                        <td className="py-2 text-right text-slate-500">
                          {s.quantidade}
                        </td>
                        <td className="py-2 text-right font-medium text-slate-700">
                          {formatBRL(s.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-400">
                  Nada gerado nesta competência ainda.{' '}
                  <Link to="/folha" className="text-brand-700 hover:underline">
                    Gerar folha
                  </Link>
                </p>
              )}

              {folha && folha.porTipo.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {folha.porTipo.map((t) => (
                    <span
                      key={t.tipo}
                      className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600"
                    >
                      {TIPO_LABEL[t.tipo]}:{' '}
                      <strong className="text-slate-800">
                        {formatBRL(t.valor)}
                      </strong>{' '}
                      ({t.quantidade})
                    </span>
                  ))}
                </div>
              )}
            </Bloco>

            <Bloco titulo="Pontos de atenção">
              <ul className="space-y-2 text-sm">
                <Atencao
                  ok={(f?.semPix ?? 0) === 0}
                  texto={
                    (f?.semPix ?? 0) === 0
                      ? 'Todos os ativos têm chave PIX.'
                      : `${f?.semPix} funcionário(s) ativo(s) sem chave PIX — o pagamento vai falhar.`
                  }
                  para="/funcionarios"
                />
                <Atencao
                  ok={(folha?.comErro ?? 0) === 0}
                  texto={
                    (folha?.comErro ?? 0) === 0
                      ? 'Nenhuma conta com erro no IXC.'
                      : `${formatBRL(folha?.comErro)} em contas com erro no IXC.`
                  }
                  para="/contas-pagar"
                />
                <Atencao
                  ok={(folha?.emAberto ?? 0) === 0}
                  texto={
                    (folha?.emAberto ?? 0) === 0
                      ? 'Nada pendente de pagamento nesta competência.'
                      : `${formatBRL(folha?.emAberto)} aguardando aprovação ou pagamento.`
                  }
                  para="/contas-pagar"
                />
              </ul>
              {data.ultimoSync && (
                <p className="mt-4 text-xs text-slate-400">
                  Última sincronização com o IXC:{' '}
                  {formatData(
                    data.ultimoSync.concluidoEm ?? data.ultimoSync.iniciadoEm,
                  )}{' '}
                  · {data.ultimoSync.recurso} · {data.ultimoSync.totalLidos}{' '}
                  registro(s)
                </p>
              )}
            </Bloco>
          </div>

          <Bloco titulo="Últimos lançamentos" className="mt-6">
            {data.ultimasContas.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhuma conta a pagar ainda.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="py-1">Beneficiário</th>
                    <th className="py-1">Tipo</th>
                    <th className="py-1">Competência</th>
                    <th className="py-1">Status</th>
                    <th className="py-1 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ultimasContas.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="py-2">{c.beneficiarioNome}</td>
                      <td className="py-2 text-slate-500">
                        {TIPO_LABEL[c.tipo]}
                      </td>
                      <td className="py-2 text-slate-500">
                        {c.competencia ? formatComp(c.competencia) : '—'}
                      </td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATUS_CLASSE[c.status]
                          }`}
                        >
                          {STATUS_LABEL[c.status]}
                        </span>
                      </td>
                      <td className="py-2 text-right font-medium">
                        {formatBRL(c.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Bloco>
        </>
      )}
    </div>
  );
}

function Card({
  titulo,
  valor,
  detalhe,
  destaque,
  link,
}: {
  titulo: string;
  valor: React.ReactNode;
  detalhe?: string;
  destaque?: string;
  link?: string;
}) {
  const conteudo = (
    <div className="h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {titulo}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-800">{valor}</div>
      {detalhe && <div className="mt-0.5 text-xs text-slate-400">{detalhe}</div>}
      {destaque && (
        <div className="mt-1 text-xs font-medium text-red-600">{destaque}</div>
      )}
    </div>
  );
  return link ? (
    <Link to={link} className="block transition hover:opacity-80">
      {conteudo}
    </Link>
  ) : (
    conteudo
  );
}

function Bloco({
  titulo,
  className = '',
  children,
}: {
  titulo: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {titulo}
      </h2>
      {children}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{rotulo}</span>
      <span className="font-medium text-slate-800">{valor}</span>
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
    <li className="flex items-start gap-2">
      <span className={ok ? 'text-green-600' : 'text-amber-600'}>
        {ok ? '✓' : '!'}
      </span>
      {ok ? (
        <span className="text-slate-500">{texto}</span>
      ) : (
        <Link to={para} className="text-slate-700 hover:underline">
          {texto}
        </Link>
      )}
    </li>
  );
}
