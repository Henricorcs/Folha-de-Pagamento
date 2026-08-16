import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Selo,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatData } from '../../lib/format';
import { PERFIL_DESCRICAO, PERFIL_LABEL, PERFIL_TOM } from '../../lib/status';
import type { PerfilUsuario, UsuarioAdmin } from '../../lib/types';

const PERFIS: PerfilUsuario[] = ['ADMIN', 'RH', 'VISUALIZADOR'];

export function Usuarios() {
  const qc = useQueryClient();
  const { usuario: eu } = useAuth();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  const lista = useQuery({
    queryKey: ['usuarios'],
    queryFn: async () => (await api.get<UsuarioAdmin[]>('/usuarios')).data,
  });

  function avisar(texto: string, falhou = false) {
    setErro(falhou);
    setFeedback(texto);
    if (!falhou) setTimeout(() => setFeedback(null), 4000);
  }
  function invalidar() {
    qc.invalidateQueries({ queryKey: ['usuarios'] });
  }

  const alterar = useMutation({
    mutationFn: async ({
      id,
      dados,
    }: {
      id: string;
      dados: Record<string, unknown>;
    }) => (await api.patch<UsuarioAdmin>(`/usuarios/${id}`, dados)).data,
    onSuccess: (u) => {
      avisar(`Login de ${u.nome} atualizado.`);
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/usuarios/${id}`)).data,
    onSuccess: () => {
      avisar('Login excluído.');
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  function novaSenha(u: UsuarioAdmin) {
    const senha = prompt(
      `Nova senha para ${u.nome} (mínimo 8 caracteres).\nAnote: você não verá de novo.`,
    );
    if (!senha) return;
    if (senha.length < 8) {
      avisar('A senha precisa de pelo menos 8 caracteres.', true);
      return;
    }
    alterar.mutate({ id: u.id, dados: { senha } });
  }

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Usuários"
        titulo="Quem entra no sistema"
        descricao="Cada pessoa com um login próprio. O perfil decide o que ela consegue fazer."
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      <NovoUsuario
        onCriado={(nome) => {
          avisar(`Login de ${nome} criado. Passe a senha para a pessoa.`);
          invalidar();
        }}
        onErro={(m) => avisar(m, true)}
      />

      <div className="surgir surgir-2 mt-6">
        <Bloco titulo="Logins ativos e inativos" semPadding>
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-tinta-200">
                  <th className="th">Pessoa</th>
                  <th className="th">Perfil</th>
                  <th className="th">Criado em</th>
                  <th className="th text-center">Acesso</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.isLoading && (
                  <tr>
                    <td colSpan={5}>
                      <Carregando />
                    </td>
                  </tr>
                )}
                {lista.data?.map((u) => {
                  const souEu = u.id === eu?.id;
                  return (
                    <tr key={u.id} className={`linha ${u.ativo ? '' : 'opacity-50'}`}>
                      <td className="td">
                        <div className="font-medium text-tinta-900">
                          {u.nome}
                          {souEu && (
                            <span className="ml-2 text-[11px] font-normal text-tinta-400">
                              você
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-tinta-400">{u.email}</div>
                      </td>
                      <td className="td">
                        <select
                          value={u.role}
                          disabled={souEu || alterar.isPending}
                          onChange={(e) =>
                            alterar.mutate({
                              id: u.id,
                              dados: { role: e.target.value },
                            })
                          }
                          className="campo w-auto py-1.5 text-xs disabled:opacity-60"
                          title={PERFIL_DESCRICAO[u.role]}
                        >
                          {PERFIS.map((p) => (
                            <option key={p} value={p}>
                              {PERFIL_LABEL[p]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="td num text-tinta-500">
                        {formatData(u.createdAt)}
                      </td>
                      <td className="td text-center">
                        {souEu ? (
                          <Selo tom="pago" ponto>
                            Ativo
                          </Selo>
                        ) : (
                          <button
                            onClick={() =>
                              alterar.mutate({
                                id: u.id,
                                dados: { ativo: !u.ativo },
                              })
                            }
                            title={
                              u.ativo
                                ? 'Desligar o acesso sem apagar o histórico'
                                : 'Devolver o acesso'
                            }
                          >
                            <Selo tom={u.ativo ? 'pago' : 'neutro'} ponto>
                              {u.ativo ? 'Ativo' : 'Desligado'}
                            </Selo>
                          </button>
                        )}
                      </td>
                      <td className="td text-right">
                        <div className="flex justify-end gap-3 text-xs font-semibold">
                          <button
                            onClick={() => novaSenha(u)}
                            className="text-brand-700 hover:underline"
                          >
                            trocar senha
                          </button>
                          {!souEu && (
                            <button
                              onClick={() => {
                                if (
                                  confirm(
                                    `Excluir o login de ${u.nome}? Se for só afastamento, prefira desligar o acesso.`,
                                  )
                                )
                                  excluir.mutate(u.id);
                              }}
                              className="text-rose-500 hover:underline"
                            >
                              excluir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Bloco>
      </div>

      <div className="surgir surgir-3 mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {PERFIS.map((p) => (
          <div key={p} className="card p-5">
            <Selo tom={PERFIL_TOM[p]}>{PERFIL_LABEL[p]}</Selo>
            <p className="mt-2.5 text-sm leading-relaxed text-tinta-500">
              {PERFIL_DESCRICAO[p]}
            </p>
          </div>
        ))}
      </div>
    </Pagina>
  );
}

function NovoUsuario({
  onCriado,
  onErro,
}: {
  onCriado: (nome: string) => void;
  onErro: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [role, setRole] = useState<PerfilUsuario>('RH');

  const criar = useMutation({
    mutationFn: async () =>
      (await api.post<UsuarioAdmin>('/usuarios', { nome, email, senha, role }))
        .data,
    onSuccess: (u) => {
      setNome('');
      setEmail('');
      setSenha('');
      setRole('RH');
      onCriado(u.nome);
    },
    onError: (err) => onErro(mensagemErro(err)),
  });

  const valido =
    nome.trim().length >= 2 && email.includes('@') && senha.length >= 8;

  return (
    <Bloco titulo="Criar login" className="surgir surgir-1">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="rotulo" htmlFor="u-nome">
            Nome
          </label>
          <input
            id="u-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="campo"
            placeholder="Ex.: Maria Souza"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="u-email">
            E-mail
          </label>
          <input
            id="u-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="campo"
            placeholder="maria@empresa.com"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="u-senha">
            Senha provisória
          </label>
          <input
            id="u-senha"
            type="text"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="campo"
            placeholder="mínimo 8 caracteres"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="u-perfil">
            Perfil
          </label>
          <select
            id="u-perfil"
            value={role}
            onChange={(e) => setRole(e.target.value as PerfilUsuario)}
            className="campo"
          >
            {PERFIS.map((p) => (
              <option key={p} value={p}>
                {PERFIL_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-tinta-100 pt-5">
        <button
          onClick={() => criar.mutate()}
          disabled={!valido || criar.isPending}
          className="btn btn-primario"
        >
          {criar.isPending ? 'Criando…' : 'Criar login'}
        </button>
        <p className="text-xs text-tinta-500">
          {PERFIL_DESCRICAO[role]} A pessoa troca a senha depois, em Minha
          conta.
        </p>
      </div>
    </Bloco>
  );
}
