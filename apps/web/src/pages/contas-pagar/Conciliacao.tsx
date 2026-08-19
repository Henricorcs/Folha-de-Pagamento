import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Aviso,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatData } from '../../lib/format';
import type { ConciliacaoNaLista } from '../../lib/types';

/**
 * A grade das conciliações bancárias.
 *
 * Cada linha é um trabalho: uma conta, um período, e um status que diz se ele
 * acabou. É o mesmo recorte da tela do IXC, e pelo mesmo motivo — conciliação
 * não é marca solta por lançamento, é serviço que começa, anda e termina.
 * Marcando linha por linha ninguém consegue responder "até onde a semana
 * passada foi conferida", que é a primeira pergunta de quem senta para
 * conferir.
 *
 * As conciliações do IXC não entram nesta lista: a tabela delas não tem
 * endpoint no webservice. O que atravessa é o resultado — linha já conciliada
 * lá abre aqui sem pendência, e a conciliação nova sobre um período já
 * conferido no IXC nasce fechada de trabalho.
 */
export function Conciliacao() {
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['conciliacoes'],
    queryFn: async () =>
      (
        await api.get<ConciliacaoNaLista[]>('/contas-abertas/conciliacoes')
      ).data,
  });

  const apagar = useMutation({
    mutationFn: async (id: string) =>
      api.delete(`/contas-abertas/conciliacoes/${id}`),
    onSuccess: () => {
      setErro(null);
      void queryClient.invalidateQueries({ queryKey: ['conciliacoes'] });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const conciliacoes = lista.data ?? [];
  const abertas = conciliacoes.filter((c) => c.status === 'ABERTA');

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contas a Pagar"
        titulo="Conciliação bancária"
        descricao="Cada conciliação é uma conta e um período: importa o extrato, liga o que bate, resolve o que sobra e encerra. O que o IXC já conciliou vem marcado de lá."
        acoes={
          <button
            onClick={() => navegar('/contas-pagar/conciliacao/nova')}
            className="btn btn-primario"
          >
            Nova conciliação
          </button>
        }
      />

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}

      {abertas.length > 0 && (
        <Aviso tom="atencao">
          {abertas.length === 1
            ? 'Há uma conciliação em andamento.'
            : `Há ${abertas.length} conciliações em andamento.`}{' '}
          Enquanto elas não forem encerradas, o período delas continua sem
          resposta.
        </Aviso>
      )}

      {lista.isLoading ? (
        <div className="card">
          <Carregando />
        </div>
      ) : conciliacoes.length === 0 ? (
        <div className="card surgir">
          <Vazio titulo="Nenhuma conciliação ainda">
            Comece pela conta e pelo período do extrato que você baixou do
            banco — o mesmo período, para os dois lados terem o que comparar.
          </Vazio>
        </div>
      ) : (
        <div className="surgir card overflow-hidden">
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th w-16">Nº</th>
                  <th className="th">Conta</th>
                  <th className="th">Período</th>
                  <th className="th">Status</th>
                  <th className="th">Extrato</th>
                  <th className="th">Quem</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {conciliacoes.map((c) => (
                  <tr key={c.id} className="linha">
                    <td className="td num text-tinta-500">{c.numero}</td>
                    <td className="td">
                      <div className="text-tinta-800">{c.contaNome}</div>
                      <div className="num text-xs text-tinta-400">
                        conta {c.contaIxc}
                      </div>
                    </td>
                    <td className="td num whitespace-nowrap">
                      {formatData(c.de)} a {formatData(c.ate)}
                    </td>
                    <td className="td">
                      {c.status === 'FECHADA' ? (
                        <Selo
                          tom="pago"
                          titulo={
                            c.fechadaEm
                              ? `Encerrada em ${formatData(c.fechadaEm)}${
                                  c.fechadaPor ? ` por ${c.fechadaPor}` : ''
                                }`
                              : undefined
                          }
                        >
                          Fechada
                        </Selo>
                      ) : (
                        <Selo tom="atencao" ponto>
                          Aberta
                        </Selo>
                      )}
                    </td>
                    <td className="td">
                      {c.transacoes === 0 ? (
                        <span className="text-xs text-tinta-400">
                          sem arquivo
                        </span>
                      ) : (
                        <>
                          <div className="num text-tinta-700">
                            {c.ligadas} de {c.transacoes} ligadas
                          </div>
                          {c.extratoArquivo && (
                            <div
                              className="max-w-[16rem] truncate text-xs text-tinta-400"
                              title={c.extratoArquivo}
                            >
                              {c.extratoArquivo}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="td text-xs text-tinta-500">
                      {c.status === 'FECHADA'
                        ? (c.fechadaPor ?? '—')
                        : (c.criadaPor ?? '—')}
                      <div className="text-tinta-400">
                        {formatData(c.status === 'FECHADA' ? c.fechadaEm : c.criadaEm)}
                      </div>
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      <Link
                        to={`/contas-pagar/conciliacao/${c.id}`}
                        className="btn btn-neutro btn-p"
                      >
                        {c.status === 'FECHADA' ? 'Ver' : 'Continuar'}
                      </Link>
                      {c.status === 'ABERTA' && (
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                `Apagar a conciliação nº ${c.numero}? As ligações ` +
                                  'feitas nela vão junto. O que o IXC conciliou não é tocado.',
                              )
                            ) {
                              apagar.mutate(c.id);
                            }
                          }}
                          disabled={apagar.isPending}
                          className="btn btn-perigo btn-p ml-1"
                        >
                          Apagar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Pagina>
  );
}
