import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import type { CategoriaDespesa } from '../../lib/types';

/**
 * O cadastro de "com o que a empresa gasta".
 *
 * É cadastro, e não lista fixa no código, porque o que a empresa compra muda
 * com o tempo e ninguém deveria esperar um deploy para classificar um gasto
 * novo.
 *
 * Categoria que já etiquetou alguma conta não se apaga — desativa. Apagar
 * reescreveria relatório de mês fechado, e um número que muda sozinho depois
 * de fechado não serve para decidir nada.
 */
export function Categorias() {
  const qc = useQueryClient();
  const [nova, setNova] = useState('');
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(
    null,
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  const lista = useQuery({
    queryKey: ['categorias-despesa', 'todas'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa?todas=true')).data,
  });

  function avisar(texto: string, ruim = false) {
    setErro(ruim);
    setFeedback(texto);
    if (!ruim) setTimeout(() => setFeedback(null), 2500);
  }

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ['categorias-despesa'] });
    void qc.invalidateQueries({ queryKey: ['contas-abertas'] });
  }

  const criar = useMutation({
    mutationFn: async (nome: string) =>
      (await api.post<CategoriaDespesa>('/categorias-despesa', { nome })).data,
    onSuccess: (c) => {
      setNova('');
      avisar(`"${c.nome}" criada.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const salvar = useMutation({
    mutationFn: async (args: { id: string; nome: string }) =>
      (
        await api.patch<CategoriaDespesa>(`/categorias-despesa/${args.id}`, {
          nome: args.nome,
        })
      ).data,
    onSuccess: () => {
      setEditando(null);
      avisar('Nome alterado.');
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const alternar = useMutation({
    mutationFn: async (c: CategoriaDespesa) =>
      (
        await api.patch<CategoriaDespesa>(`/categorias-despesa/${c.id}`, {
          ativa: !c.ativa,
        })
      ).data,
    onSuccess: (c) => {
      avisar(`"${c.nome}" ${c.ativa ? 'reativada' : 'desativada'}.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const remover = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/categorias-despesa/${id}`)).data,
    onSuccess: () => {
      avisar('Categoria apagada.');
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const categorias = lista.data ?? [];
  const ocupado =
    criar.isPending || salvar.isPending || alternar.isPending || remover.isPending;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Categorias"
        titulo="Com o que a empresa gasta"
        descricao="A lista que aparece em cada débito e que separa os números do dashboard. Dá para criar, renomear e desativar sem depender de ninguém."
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      <Bloco titulo="Nova categoria" className="surgir mb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nova.trim().length >= 2) criar.mutate(nova);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            placeholder="Ex.: Combustível"
            className="campo flex-1"
          />
          <button
            type="submit"
            disabled={nova.trim().length < 2 || criar.isPending}
            className="btn btn-primario shrink-0"
          >
            {criar.isPending ? 'Criando…' : 'Criar categoria'}
          </button>
        </form>
      </Bloco>

      <Bloco semPadding>
        {lista.isLoading ? (
          <Carregando />
        ) : categorias.length === 0 ? (
          <Vazio titulo="Nenhuma categoria ainda" />
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Categoria</th>
                  <th className="th">Em uso</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {categorias.map((c) => (
                  <tr key={c.id} className="linha">
                    <td className="td">
                      {editando?.id === c.id ? (
                        <input
                          value={editando.nome}
                          onChange={(e) =>
                            setEditando({ id: c.id, nome: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') salvar.mutate(editando);
                            if (e.key === 'Escape') setEditando(null);
                          }}
                          autoFocus
                          className="campo max-w-xs"
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              c.ativa ? 'text-tinta-800' : 'text-tinta-400'
                            }
                          >
                            {c.nome}
                          </span>
                          {!c.ativa && (
                            <Selo
                              pequeno
                              tom="neutro"
                              titulo="Não aparece mais nas opções, mas o que já foi classificado continua valendo"
                            >
                              desativada
                            </Selo>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="td num text-tinta-500">
                      {c.emUso === 0 ? '—' : `${c.emUso} conta(s)`}
                    </td>
                    <td className="td text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {editando?.id === c.id ? (
                          <>
                            <button
                              onClick={() => salvar.mutate(editando)}
                              disabled={ocupado}
                              className="btn btn-primario btn-p"
                            >
                              Salvar
                            </button>
                            <button
                              onClick={() => setEditando(null)}
                              className="btn btn-neutro btn-p"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() =>
                                setEditando({ id: c.id, nome: c.nome })
                              }
                              className="btn btn-neutro btn-p"
                            >
                              Renomear
                            </button>
                            <button
                              onClick={() => alternar.mutate(c)}
                              disabled={ocupado}
                              className="btn btn-sutil btn-p"
                            >
                              {c.ativa ? 'Desativar' : 'Reativar'}
                            </button>
                            {/* Apagar só existe para a que nunca etiquetou
                                nada: com uso, a API recusa e manda desativar. */}
                            {c.emUso === 0 && (
                              <button
                                onClick={() => {
                                  if (confirm(`Apagar "${c.nome}"?`)) {
                                    remover.mutate(c.id);
                                  }
                                }}
                                className="btn btn-sutil btn-p hover:bg-rose-50 hover:text-rose-600"
                              >
                                Excluir
                              </button>
                            )}
                          </>
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
