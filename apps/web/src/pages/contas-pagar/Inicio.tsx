import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Indicador,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import { TIPO_LABEL } from '../../lib/status';
import type { ContaAberta, ContasAbertas } from '../../lib/types';

/**
 * O que a empresa deve hoje, lido do IXC na hora de abrir.
 *
 * Não há cópia local de propósito: conta em aberto é o estado mais volátil do
 * financeiro — alguém paga uma no caixa e ela deixa de ser devida no mesmo
 * minuto. Um espelho aqui estaria errado a maior parte do dia, e número errado
 * sobre dívida é pior que número nenhum.
 */

/** As fatias do resumo viram filtro: clicar no número mostra as contas dele. */
type Recorte = 'todas' | 'vencidas' | 'semana' | 'demais' | 'sem-data';

export function Inicio() {
  const [recorte, setRecorte] = useState<Recorte>('todas');
  const [busca, setBusca] = useState('');

  const consulta = useQuery({
    queryKey: ['contas-abertas'],
    queryFn: async () =>
      (await api.get<ContasAbertas>('/contas-abertas')).data,
    // Sem retentativa automática, ao contrário do resto do app. Quando o IXC
    // não responde ele costuma não responder por 30 segundos até estourar o
    // tempo — tentar de novo por baixo dobraria a espera com a tela parada em
    // "lendo", sem dizer nada a quem espera. Aqui é melhor falhar rápido e
    // deixar o botão Atualizar à mão.
    retry: 0,
  });

  const contas = useMemo(
    () => filtrar(consulta.data?.contas ?? [], recorte, busca),
    [consulta.data, recorte, busca],
  );

  const resumo = consulta.data?.resumo;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Visão geral"
        titulo="Contas a Pagar"
        descricao="Tudo que está em aberto no IXC, do jeito que está lá agora. Esta tela é de leitura: aprovar, pagar e cancelar continua sendo no IXC."
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
          {consulta.data
            ? ' Os números abaixo são da última leitura que deu certo.'
            : ''}
        </Aviso>
      )}

      {(consulta.data?.avisos ?? []).map((aviso) => (
        <Aviso key={aviso} tom="atencao">
          {aviso}
        </Aviso>
      ))}

      {resumo && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Indicador
            rotulo="Total em aberto"
            valor={formatBRL(resumo.total)}
            detalhe={`${resumo.quantidade} título(s)`}
            acento
            aberto={recorte === 'todas'}
            onClick={() => setRecorte('todas')}
          />
          <Indicador
            rotulo="Vencidas"
            valor={formatBRL(resumo.vencidas.total)}
            detalhe={`${resumo.vencidas.quantidade} título(s)`}
            alerta={
              resumo.vencidas.quantidade > 0
                ? 'Já passou do vencimento'
                : undefined
            }
            aberto={recorte === 'vencidas'}
            onClick={() => setRecorte('vencidas')}
          />
          <Indicador
            rotulo="Vencem em 7 dias"
            valor={formatBRL(resumo.venceEmSeteDias.total)}
            detalhe={`${resumo.venceEmSeteDias.quantidade} título(s)`}
            aberto={recorte === 'semana'}
            onClick={() => setRecorte('semana')}
          />
          <Indicador
            rotulo="Depois disso"
            valor={formatBRL(resumo.demais.total)}
            detalhe={
              resumo.semVencimento.quantidade > 0
                ? `${resumo.demais.quantidade} título(s) · ${resumo.semVencimento.quantidade} sem data`
                : `${resumo.demais.quantidade} título(s)`
            }
            aberto={recorte === 'demais'}
            onClick={() => setRecorte('demais')}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por fornecedor, documento ou observação"
          className="campo max-w-md"
        />
        {recorte !== 'todas' && (
          <button
            onClick={() => setRecorte('todas')}
            className="btn btn-sutil btn-p"
          >
            Ver todas
          </button>
        )}
        {consulta.data && (
          <span className="ml-auto text-xs text-tinta-400">
            Lido do IXC às {formatHora(consulta.data.lidoEm)}
          </span>
        )}
      </div>

      <Bloco semPadding>
        {/*
          A ordem destes casos é a regra mais importante da tela: só dá para
          dizer "não há conta nenhuma" depois de a lista ter chegado. Sem esse
          cuidado, todo instante em que a leitura falha ou está a caminho
          viraria um "a empresa não deve nada" — e essa é a única mentira que
          uma tela de contas a pagar não pode contar.
        */}
        {!consulta.data ? (
          consulta.error ? (
            <Vazio titulo="Não deu para ler o IXC">
              As contas ficam no IXC e ele não respondeu agora, então não há o
              que mostrar — o que não quer dizer que não haja contas em aberto.
              Tente de novo em Atualizar.
            </Vazio>
          ) : (
            <Carregando texto="Lendo as contas no IXC…" />
          )
        ) : contas.length === 0 ? (
          <Vazio titulo="Nenhuma conta aqui">
            {consulta.data.contas.length
              ? 'Nenhuma conta bate com o filtro. Tente "Ver todas".'
              : 'Não há conta em aberto no IXC neste momento.'}
          </Vazio>
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Vencimento</th>
                  <th className="th">Fornecedor</th>
                  <th className="th">Documento</th>
                  <th className="th text-right">Em aberto</th>
                </tr>
              </thead>
              <tbody>
                {contas.map((c) => (
                  <Linha key={c.idFnApagar} conta={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>
    </Pagina>
  );
}

function Linha({ conta }: { conta: ContaAberta }) {
  return (
    <tr className="linha">
      <td className="td whitespace-nowrap">
        <div className="num text-tinta-700">
          {conta.vencimento ? formatData(conta.vencimento) : '—'}
        </div>
        <PrazoDaConta conta={conta} />
      </td>
      <td className="td">
        <div className="text-tinta-800">
          {conta.fornecedor.nome || `Fornecedor ${conta.fornecedor.id ?? '?'}`}
        </div>
        {conta.observacao && (
          <div className="mt-0.5 max-w-lg truncate text-xs text-tinta-400">
            {conta.observacao}
          </div>
        )}
        {conta.origem && (
          <div className="mt-1">
            <Selo
              pequeno
              tom="marca"
              titulo="Esta conta nasceu no módulo Folha de Pagamento — é a mesma dívida, não uma a mais"
            >
              Folha · {TIPO_LABEL[conta.origem.tipo] ?? conta.origem.tipo}
              {conta.origem.beneficiario ? ` · ${conta.origem.beneficiario}` : ''}
            </Selo>
          </div>
        )}
      </td>
      <td className="td num text-tinta-500">{conta.documento ?? '—'}</td>
      <td className="td text-right">
        <span className="valor">{formatBRL(conta.valorAberto)}</span>
        {/* Pagamento parcial: mostrar só o saldo esconderia metade da história. */}
        {conta.valor > conta.valorAberto + 0.005 && (
          <div className="num text-xs text-tinta-400">
            de {formatBRL(conta.valor)}
          </div>
        )}
      </td>
    </tr>
  );
}

/** Há quanto venceu, ou quanto falta — a leitura que decide o que pagar antes. */
function PrazoDaConta({ conta }: { conta: ContaAberta }) {
  if (conta.diasParaVencer === null) {
    return (
      <Selo pequeno tom="neutro" titulo="Sem data de vencimento no IXC">
        sem data
      </Selo>
    );
  }
  if (conta.diasParaVencer < 0) {
    const dias = Math.abs(conta.diasParaVencer);
    return (
      <Selo pequeno tom="erro">
        {dias === 1 ? 'venceu ontem' : `${dias} dias em atraso`}
      </Selo>
    );
  }
  if (conta.diasParaVencer === 0) {
    return (
      <Selo pequeno tom="atencao">
        vence hoje
      </Selo>
    );
  }
  return (
    <Selo pequeno tom={conta.diasParaVencer <= 7 ? 'atencao' : 'neutro'}>
      {conta.diasParaVencer === 1
        ? 'vence amanhã'
        : `em ${conta.diasParaVencer} dias`}
    </Selo>
  );
}

function filtrar(
  contas: ContaAberta[],
  recorte: Recorte,
  busca: string,
): ContaAberta[] {
  const termo = busca.trim().toLowerCase();

  return contas.filter((c) => {
    const dias = c.diasParaVencer;
    const passaRecorte =
      recorte === 'todas' ||
      (recorte === 'vencidas' && dias !== null && dias < 0) ||
      (recorte === 'semana' && dias !== null && dias >= 0 && dias <= 7) ||
      (recorte === 'demais' && dias !== null && dias > 7) ||
      (recorte === 'sem-data' && dias === null);
    if (!passaRecorte) return false;
    if (!termo) return true;

    return [c.fornecedor.nome, c.documento, c.observacao, c.origem?.beneficiario]
      .filter((v): v is string => !!v)
      .some((v) => v.toLowerCase().includes(termo));
  });
}

function formatHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(
    new Date(iso),
  );
}
