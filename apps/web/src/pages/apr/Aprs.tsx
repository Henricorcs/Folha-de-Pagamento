import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IconeAlerta, IconeCapacete } from '../../components/icones';
import {
  Bloco,
  CabecalhoPagina,
  Carregando,
  Indicador,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import {
  GRAVIDADE_LABEL,
  GRAVIDADE_TOM,
  STATUS_APR_LABEL,
  STATUS_APR_TOM,
} from '../../lib/status';
import type { AprResumo, StatusApr } from '../../lib/types';
import { DetalheApr } from './DetalheApr';
import { FormularioApr } from './FormularioApr';

/**
 * As análises de risco da empresa — a visão de quem supervisiona.
 *
 * O que se procura aqui não é uma APR específica: é o serviço que marcou choque
 * elétrico, o que respondeu "não" na conferência, o que está aberto desde
 * ontem sem ninguém ter encerrado. Por isso a lista mostra os riscos e os
 * alertas de cada uma na própria linha, e não só o número e o local.
 */

const FILTROS: { valor: StatusApr | 'TODAS'; label: string }[] = [
  { valor: 'TODAS', label: 'Todas' },
  { valor: 'LIBERADA', label: 'Liberadas' },
  { valor: 'RASCUNHO', label: 'Rascunhos' },
  { valor: 'CANCELADA', label: 'Canceladas' },
];

export function Aprs() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusApr | 'TODAS'>('TODAS');
  const [busca, setBusca] = useState('');

  const lista = useQuery({
    queryKey: ['aprs', status, busca],
    queryFn: async () =>
      (
        await api.get<AprResumo[]>('/apr', {
          params: {
            status: status === 'TODAS' ? undefined : status,
            busca: busca.trim() || undefined,
          },
        })
      ).data,
  });

  const aprs = lista.data ?? [];
  const emAndamento = aprs.filter(
    (a) => a.status === 'LIBERADA' && !a.fimEm,
  ).length;
  const comAlerta = aprs.filter((a) => a.alertas > 0).length;
  const semSupervisao = aprs.filter(
    (a) => a.status === 'LIBERADA' && !a.supervisionada,
  ).length;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Segurança do Trabalho"
        titulo="Análises de Risco"
        descricao="A APR de cada serviço: o que a equipe marcou, o que ela conferiu antes de subir e quem assinou."
        acoes={
          <button
            type="button"
            onClick={() => navigate('/seguranca/aprs/nova')}
            className="btn btn-primario"
          >
            <IconeCapacete className="h-4 w-4" />
            Nova APR
          </button>
        }
      />

      <div className="surgir surgir-1 mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador
          rotulo="Em campo agora"
          valor={emAndamento}
          detalhe="Liberadas e ainda sem encerramento"
          acento
        />
        <Indicador
          rotulo="Com &quot;não&quot; na conferência"
          valor={comAlerta}
          detalhe="Alguma pergunta do relato foi respondida com não"
          alerta={comAlerta > 0 ? 'Vale abrir e ler a providência' : undefined}
        />
        <Indicador
          rotulo="Sem supervisão"
          valor={semSupervisao}
          detalhe="Liberadas que ninguém conferiu e assinou embaixo"
        />
      </div>

      <div className="surgir surgir-2 mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setStatus(f.valor)}
              aria-pressed={status === f.valor}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                status === f.valor
                  ? 'bg-tinta-900 text-white'
                  : 'border border-tinta-200 bg-papel text-tinta-600 hover:border-tinta-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="campo max-w-xs"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Local, coordenador, número, executante…"
          aria-label="Procurar APR"
        />
      </div>

      <Bloco semPadding>
        {lista.isLoading && <Carregando texto="Buscando as APRs…" />}

        {lista.isError && (
          <p className="px-5 py-6 text-sm text-rose-700">
            {mensagemErro(lista.error)}
          </p>
        )}

        {!lista.isLoading && aprs.length === 0 && (
          <Vazio titulo="Nenhuma APR por aqui">
            As análises de risco que os técnicos preencherem em campo aparecem
            nesta lista.
          </Vazio>
        )}

        {aprs.length > 0 && (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr>
                  <th className="th">APR</th>
                  <th className="th">Local e equipe</th>
                  <th className="th">Riscos</th>
                  <th className="th">Quando</th>
                  <th className="th">Situação</th>
                </tr>
              </thead>
              <tbody>
                {aprs.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => navigate(`/seguranca/aprs/${a.id}`)}
                    className="linha cursor-pointer"
                  >
                    <td className="td whitespace-nowrap font-semibold text-tinta-900 num">
                      nº {a.numero}
                    </td>
                    <td className="td">
                      <div className="font-medium text-tinta-900">{a.local}</div>
                      <div className="text-xs text-tinta-400">
                        {a.coordenador}
                        {a.executantes.length > 0
                          ? ` · ${a.executantes.length} executante${a.executantes.length > 1 ? 's' : ''}`
                          : ''}
                      </div>
                    </td>
                    <td className="td">
                      <div className="max-w-sm text-xs leading-snug text-tinta-500">
                        {a.riscos.slice(0, 4).join(' · ')}
                        {a.riscos.length > 4 ? ` +${a.riscos.length - 4}` : ''}
                      </div>
                    </td>
                    <td className="td whitespace-nowrap text-xs text-tinta-500">
                      {formatDataHora(a.inicioEm)}
                      {a.fimEm ? (
                        <span className="block text-tinta-400">
                          até {formatDataHora(a.fimEm)}
                        </span>
                      ) : a.status === 'LIBERADA' ? (
                        <span className="block text-amber-700">em campo</span>
                      ) : null}
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Selo tom={STATUS_APR_TOM[a.status]} ponto pequeno>
                          {STATUS_APR_LABEL[a.status]}
                        </Selo>
                        <Selo tom={GRAVIDADE_TOM[a.gravidade]} pequeno>
                          {GRAVIDADE_LABEL[a.gravidade]}
                        </Selo>
                        {a.alertas > 0 && (
                          <span
                            title={`${a.alertas} pergunta(s) respondida(s) com "não"`}
                            className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                          >
                            <IconeAlerta className="h-3 w-3" />
                            {a.alertas}
                          </span>
                        )}
                        {a.assinaturasFaltando > 0 && (
                          <Selo tom="erro" pequeno>
                            {a.assinaturasFaltando} sem assinar
                          </Selo>
                        )}
                      </div>
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

/** Uma APR aberta pelo módulo. */
export function AprAberta() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [continuando, setContinuando] = useState(false);

  if (!id) return null;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Segurança do Trabalho"
        titulo={continuando ? 'Preenchendo a APR' : 'Análise de risco'}
        voltar={() =>
          continuando ? setContinuando(false) : navigate('/seguranca/aprs')
        }
      />
      {continuando ? (
        <FormularioApr
          aprId={id}
          onSair={() => setContinuando(false)}
          onPronta={() => setContinuando(false)}
        />
      ) : (
        <DetalheApr id={id} onContinuar={() => setContinuando(true)} />
      )}
    </Pagina>
  );
}

/** Uma APR nova aberta pelo módulo — mesma tela que o técnico usa em campo. */
export function AprNova() {
  const navigate = useNavigate();

  return (
    <Pagina>
      <FormularioApr
        onSair={() => navigate('/seguranca/aprs')}
        onPronta={(id) =>
          navigate(`/seguranca/aprs/${id}`, { replace: true })
        }
      />
    </Pagina>
  );
}

function formatDataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
