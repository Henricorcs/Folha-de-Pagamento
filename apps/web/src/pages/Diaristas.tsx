import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../components/ui';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import { FORMA_PAGAMENTO_LABEL, STATUS_LABEL, STATUS_TOM } from '../lib/status';
import { TIPOS_CHAVE_PIX } from '../lib/types';
import type {
  Diaria,
  Diarista,
  DiaristaComResumo,
  FormaPagamento,
  ResultadoLoteDiarias,
  SyncDiaristasResult,
} from '../lib/types';

/** Cadastro em branco: a forma habitual começa no IXC, que é a rastreável. */
const CADASTRO_VAZIO = {
  nome: '',
  nomeFantasia: '',
  cpfCnpj: '',
  telefone: '',
  chavePix: '',
  tipoChavePix: '',
  valorDiaria: '',
  formaPagamento: 'IXC' as FormaPagamento,
  observacoes: '',
};

type Cadastro = typeof CADASTRO_VAZIO;

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A diária em mãos ainda não virou lançamento no caixa do IXC. */
function pendenteNoCaixa(d: Diaria): boolean {
  return d.forma === 'EM_MAOS' && !d.idLancamentoIxc && !d.lancadoManual;
}

export function Diaristas() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [verInativos, setVerInativos] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  /** Cadastro aberto no formulário: null = fechado, string = editando. */
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<Cadastro>(CADASTRO_VAZIO);
  /** Diarista com o histórico aberto. */
  const [aberto, setAberto] = useState<string | null>(null);
  /** Diarista para quem estamos lançando uma diária. */
  const [pagando, setPagando] = useState<Diarista | null>(null);

  const lista = useQuery({
    queryKey: ['diaristas', busca, verInativos],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (busca) params.busca = busca;
      if (verInativos) params.todos = 'true';
      return (
        await api.get<DiaristaComResumo[]>('/diaristas', { params })
      ).data;
    },
  });

  const diarias = useQuery({
    queryKey: ['diarias', aberto],
    queryFn: async () =>
      (
        await api.get<Diaria[]>('/diaristas/diarias', {
          params: { diaristaId: aberto },
        })
      ).data,
    enabled: !!aberto,
  });

  /** As que não vão sair sozinhas — ficam fora do gasto e precisam de decisão. */
  const travadas = useQuery({
    queryKey: ['diarias-travadas'],
    queryFn: async () =>
      (await api.get<Diaria[]>('/diaristas/diarias/travadas')).data,
  });

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['diaristas'] });
    qc.invalidateQueries({ queryKey: ['diarias'] });
    qc.invalidateQueries({ queryKey: ['diarias-travadas'] });
    qc.invalidateQueries({ queryKey: ['contas-pagar'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  const limparTravadas = useMutation({
    mutationFn: async (ids: string[]) =>
      (
        await api.post<ResultadoLoteDiarias>('/diaristas/diarias/excluir-lote', {
          ids,
        })
      ).data,
    onSuccess: (r) => {
      avisar(
        r.falhas.length === 0
          ? `${r.sucesso} diária(s) apagada(s).`
          : `${r.sucesso} apagada(s); ${r.falhas.length} ficaram: ${r.falhas
              .map((f) => f.erro)
              .join(' · ')}`,
        r.falhas.length > 0,
      );
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  function avisar(texto: string, ruim = false) {
    setErro(ruim);
    setFeedback(texto);
  }

  /**
   * Importa do IXC quem está marcado como "Estrangeiro" no fornecedor. Quem já
   * é funcionário fica de fora — a mesma pessoa não pode receber pela folha e
   * por diária ao mesmo tempo.
   */
  const sincronizar = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ resultado: SyncDiaristasResult }>('/sync/diaristas')
      ).data.resultado,
    onSuccess: (r) => {
      const partes = [
        `${r.totalLidos} estrangeiro(s) no IXC — ${r.totalNovos} novo(s), ${r.totalAtualizados} atualizado(s).`,
      ];
      if (r.ignoradosPorSerFuncionario.length > 0) {
        partes.push(
          `Fora por já serem funcionários: ${r.ignoradosPorSerFuncionario.join(', ')}.`,
        );
      }
      if (r.totalLidos === 0) {
        partes.push(
          r.campoTipoPessoa
            ? `Nenhum fornecedor com o código configurado no campo "${r.campoTipoPessoa}". Confira em Configurações.`
            : 'Não achei o campo de tipo de pessoa no fornecedor. Informe o nome dele em Configurações.',
        );
      }
      avisar(partes.join(' '), r.totalLidos === 0);
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const body = {
        nome: form.nome,
        nomeFantasia: form.nomeFantasia || undefined,
        cpfCnpj: form.cpfCnpj || undefined,
        telefone: form.telefone || undefined,
        chavePix: form.chavePix || undefined,
        tipoChavePix: form.tipoChavePix,
        valorDiaria: form.valorDiaria || null,
        formaPagamento: form.formaPagamento,
        observacoes: form.observacoes || undefined,
      };
      return editando
        ? (await api.patch<Diarista>(`/diaristas/${editando}`, body)).data
        : (await api.post<Diarista>('/diaristas', body)).data;
    },
    onSuccess: (d) => {
      avisar(editando ? `${d.nome} atualizado.` : `${d.nome} cadastrado.`);
      fecharCadastro();
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const alternarAtivo = useMutation({
    mutationFn: async (d: Diarista) =>
      (await api.patch<Diarista>(`/diaristas/${d.id}`, { ativo: !d.ativo })).data,
    onSuccess: (d) => {
      avisar(`${d.nome} ${d.ativo ? 'reativado' : 'desativado'}.`);
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/diaristas/${id}`)).data,
    onSuccess: () => {
      avisar('Cadastro apagado.');
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const pagar = useMutation({
    mutationFn: async (args: {
      diaristaId: string;
      body: Record<string, unknown>;
    }) =>
      (
        await api.post<Diaria>(`/diaristas/${args.diaristaId}/diarias`, args.body)
      ).data,
    onSuccess: (d) => {
      setPagando(null);
      setAberto(d.diaristaId);
      avisar(resumoDoPagamento(d), !!d.erroIxc || d.contaPagar?.status === 'ERRO');
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const acaoDiaria = useMutation({
    mutationFn: async (args: {
      id: string;
      op: 'lancar-caixa' | 'marcar-lancado';
    }) =>
      (await api.post<Diaria>(`/diaristas/diarias/${args.id}/${args.op}`)).data,
    onSuccess: (d, args) => {
      avisar(
        args.op === 'marcar-lancado'
          ? 'Marcada como lançada no IXC à mão.'
          : resumoDoPagamento(d),
        !!d.erroIxc,
      );
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const excluirDiaria = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/diaristas/diarias/${id}`)).data,
    onSuccess: () => {
      avisar('Diária apagada.');
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  function abrirNovo() {
    setEditando(null);
    setForm(CADASTRO_VAZIO);
    setEditando('novo');
  }
  function abrirEdicao(d: Diarista) {
    setForm({
      nome: d.nome,
      nomeFantasia: d.nomeFantasia ?? '',
      cpfCnpj: d.cpfCnpj ?? '',
      telefone: d.telefone ?? '',
      chavePix: d.chavePix ?? '',
      tipoChavePix: d.tipoChavePix ?? '',
      valorDiaria: d.valorDiaria ?? '',
      formaPagamento: d.formaPagamento,
      observacoes: d.observacoes ?? '',
    });
    setEditando(d.id);
  }
  function fecharCadastro() {
    setEditando(null);
    setForm(CADASTRO_VAZIO);
  }

  const itens = lista.data ?? [];
  const pendentes = itens.reduce((s, i) => s + i.pendentesNoCaixa, 0);
  const abertoDiarista = itens.find((i) => i.diarista.id === aberto)?.diarista;
  const editandoNovo = editando === 'novo';
  const nomeValido = form.nome.trim().length >= 2;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Diaristas"
        titulo="Quem trabalha por dia"
        descricao="Quem está marcado como “Estrangeiro” no cadastro de fornecedor do IXC é diarista (quem é isento de ICMS é funcionário, e aparece na outra tela). O pagamento sai pelo IXC (conta a pagar, como a folha) ou em mãos — e aí o dinheiro é descontado do caixa configurado."
        acoes={
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => sincronizar.mutate()}
              disabled={sincronizar.isPending}
              className="btn btn-acao"
            >
              {sincronizar.isPending ? 'Importando…' : 'Sincronizar com o IXC'}
            </button>
            <button onClick={abrirNovo} className="btn btn-primario">
              Cadastrar diarista
            </button>
          </div>
        }
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      {pendentes > 0 && (
        <Aviso tom="atencao">
          {pendentes} diária(s) paga(s) em mãos ainda não saíram do caixa no IXC.
          Abra a pessoa para tentar de novo ou marcar que você lançou à mão.
        </Aviso>
      )}

      {(travadas.data ?? []).length > 0 && (
        <DiariasTravadas
          diarias={travadas.data ?? []}
          ocupado={limparTravadas.isPending}
          onApagar={(ids) => limparTravadas.mutate(ids)}
        />
      )}

      {editando && (
        <Bloco
          titulo={editandoNovo ? 'Novo diarista' : 'Editar cadastro'}
          className="surgir mb-6"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Campo label="Nome" span2>
              <input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                className="campo"
                placeholder="Ex.: João da Silva"
              />
            </Campo>
            <Campo label="Como é conhecido">
              <input
                value={form.nomeFantasia}
                onChange={(e) =>
                  setForm({ ...form, nomeFantasia: e.target.value })
                }
                className="campo"
                placeholder="Ex.: Deda pedreiro"
              />
            </Campo>
            <Campo label="CPF">
              <input
                value={form.cpfCnpj}
                onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })}
                className="campo"
              />
            </Campo>
            <Campo label="Telefone">
              <input
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                className="campo"
              />
            </Campo>
            <Campo label="Valor da diária (R$)">
              <CampoDinheiro
                valor={form.valorDiaria}
                onChange={(v) => setForm({ ...form, valorDiaria: v })}
                placeholder="Sugere o valor na hora de pagar"
              />
            </Campo>
            <Campo label="Como costuma receber">
              <select
                value={form.formaPagamento}
                onChange={(e) =>
                  setForm({
                    ...form,
                    formaPagamento: e.target.value as FormaPagamento,
                  })
                }
                className="campo"
              >
                <option value="IXC">Pelo IXC (conta a pagar)</option>
                <option value="EM_MAOS">Em mãos (sai do caixa)</option>
              </select>
            </Campo>
            <Campo label="Chave PIX">
              <input
                value={form.chavePix}
                onChange={(e) => setForm({ ...form, chavePix: e.target.value })}
                className="campo"
                placeholder="Só para quem recebe pelo IXC"
              />
            </Campo>
            <Campo label="Tipo da chave">
              <select
                value={form.tipoChavePix}
                onChange={(e) =>
                  setForm({ ...form, tipoChavePix: e.target.value })
                }
                className="campo"
              >
                <option value="">Pelo formato da chave</option>
                {TIPOS_CHAVE_PIX.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Observações" span2>
              <input
                value={form.observacoes}
                onChange={(e) =>
                  setForm({ ...form, observacoes: e.target.value })
                }
                className="campo"
                placeholder="O que essa pessoa faz, combinados…"
              />
            </Campo>
          </div>

          <div className="mt-5 flex flex-wrap gap-3 border-t border-tinta-100 pt-4">
            <button
              onClick={() => salvar.mutate()}
              disabled={!nomeValido || salvar.isPending}
              className="btn btn-primario"
            >
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </button>
            <button onClick={fecharCadastro} className="btn btn-neutro">
              Cancelar
            </button>
          </div>
        </Bloco>
      )}

      <div className="surgir surgir-1 mb-4 flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, fantasia ou CPF"
          className="campo max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-tinta-600">
          <input
            type="checkbox"
            className="accent-brand-600"
            checked={verInativos}
            onChange={(e) => setVerInativos(e.target.checked)}
          />
          Mostrar desativados
        </label>
      </div>

      <Bloco className="surgir surgir-2" semPadding>
        <div className="overflow-x-auto rolagem-fina">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Diarista</th>
                <th className="th">Chave PIX</th>
                <th className="th">Costuma receber</th>
                <th className="th text-right">Diária</th>
                <th className="th text-right">Já pago</th>
                <th className="th">Última</th>
                <th className="th text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {lista.isLoading && (
                <tr>
                  <td colSpan={7}>
                    <Carregando />
                  </td>
                </tr>
              )}
              {!lista.isLoading && itens.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <Vazio titulo="Nenhum diarista cadastrado">
                      Cadastre quem trabalha por dia para registrar as diárias
                      pagas — pelo IXC ou em mãos.
                    </Vazio>
                  </td>
                </tr>
              )}
              {itens.map(({ diarista: d, ...resumo }) => (
                <tr
                  key={d.id}
                  className={`linha ${d.ativo ? '' : 'opacity-50'}`}
                >
                  <td className="td">
                    <button
                      onClick={() => setAberto(aberto === d.id ? null : d.id)}
                      className="flex flex-wrap items-center gap-2 text-left"
                    >
                      <span
                        className={`text-tinta-300 transition-transform ${
                          aberto === d.id ? 'rotate-90' : ''
                        }`}
                      >
                        ▸
                      </span>
                      <span className="font-medium text-tinta-900">{d.nome}</span>
                      {!d.ativo && (
                        <Selo tom="neutro" pequeno>
                          desativado
                        </Selo>
                      )}
                      {d.importadoDoIxc && (
                        <Selo
                          tom="info"
                          pequeno
                          titulo="Veio do cadastro de fornecedor do IXC (tipo de pessoa Estrangeiro)"
                        >
                          do IXC
                        </Selo>
                      )}
                      {resumo.pendentesNoCaixa > 0 && (
                        <Selo tom="atencao" pequeno>
                          {resumo.pendentesNoCaixa} fora do caixa
                        </Selo>
                      )}
                      {resumo.quantidadeComErro > 0 && (
                        <Selo
                          tom="erro"
                          pequeno
                          titulo="O IXC recusou a conta a pagar — corrija e reenvie em Contas a Pagar"
                        >
                          {resumo.quantidadeComErro} com erro
                        </Selo>
                      )}
                    </button>
                    {d.nomeFantasia && (
                      <div className="mt-0.5 text-xs text-tinta-500">
                        {d.nomeFantasia}
                      </div>
                    )}
                    {d.cpfCnpj && (
                      <div className="mt-0.5 num text-xs text-tinta-400">
                        {d.cpfCnpj}
                      </div>
                    )}
                  </td>
                  <td className="td text-tinta-500">
                    {d.chavePix || (
                      <Selo tom="atencao" pequeno>
                        sem PIX
                      </Selo>
                    )}
                  </td>
                  <td className="td text-tinta-500">
                    {FORMA_PAGAMENTO_LABEL[d.formaPagamento]}
                  </td>
                  <td className="td text-right text-tinta-500">
                    {d.valorDiaria && Number(d.valorDiaria) > 0 ? (
                      <span className="valor">{formatBRL(d.valorDiaria)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="td text-right">
                    <span className="valor">{formatBRL(resumo.totalPago)}</span>
                    <div className="text-xs text-tinta-400 num">
                      {resumo.quantidadePagas} diária(s)
                    </div>
                    {resumo.totalAguardando > 0 && (
                      <div
                        className="mt-0.5 num text-xs text-amber-600"
                        title="Lançado no IXC, ainda não pago pelo banco"
                      >
                        + {formatBRL(resumo.totalAguardando)} a caminho
                      </div>
                    )}
                  </td>
                  <td className="td num text-tinta-500">
                    {resumo.ultimaDiaria ? formatData(resumo.ultimaDiaria) : '—'}
                  </td>
                  <td className="td text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        onClick={() => setPagando(d)}
                        disabled={!d.ativo}
                        className="btn btn-p bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
                      >
                        Pagar diária
                      </button>
                      <button
                        onClick={() => abrirEdicao(d)}
                        className="btn btn-neutro btn-p"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => alternarAtivo.mutate(d)}
                        className="btn btn-sutil btn-p"
                      >
                        {d.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                      {resumo.quantidadeDiarias === 0 && (
                        <button
                          onClick={() => {
                            if (confirm(`Apagar o cadastro de ${d.nome}?`)) {
                              excluir.mutate(d.id);
                            }
                          }}
                          className="btn btn-sutil btn-p hover:bg-rose-50 hover:text-rose-600"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bloco>

      {abertoDiarista && <DadosBancarios diarista={abertoDiarista} />}

      {aberto && (
        <Bloco
          titulo="Diárias pagas"
          className="surgir surgir-3 mt-6"
          acao={
            <button
              onClick={() => setAberto(null)}
              className="btn btn-sutil btn-p"
            >
              Fechar
            </button>
          }
          semPadding
        >
          {diarias.isLoading ? (
            <Carregando />
          ) : (diarias.data ?? []).length === 0 ? (
            <Vazio titulo="Nenhuma diária paga ainda" />
          ) : (
            <div className="overflow-x-auto rolagem-fina">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-tinta-100">
                    <th className="th">Data</th>
                    <th className="th">Serviço</th>
                    <th className="th text-right">Valor</th>
                    <th className="th">Saiu por</th>
                    <th className="th text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {(diarias.data ?? []).map((d) => (
                    <tr key={d.id} className="linha">
                      <td className="td num text-tinta-500">
                        {formatData(d.data)}
                      </td>
                      <td className="td">
                        <div className="text-tinta-800">{d.descricao}</div>
                        <div className="mt-0.5 num text-xs text-tinta-400">
                          {Number(d.quantidade)} × {formatBRL(d.valorDiaria)}
                        </div>
                        {d.erroIxc && (
                          <div className="mt-1 max-w-lg text-xs text-rose-600">
                            {d.erroIxc}
                          </div>
                        )}
                      </td>
                      <td className="td text-right">
                        <span className="valor">{formatBRL(d.valor)}</span>
                      </td>
                      <td className="td">
                        <SituacaoDiaria diaria={d} />
                      </td>
                      <td className="td text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {pendenteNoCaixa(d) && (
                            <>
                              <button
                                onClick={() =>
                                  acaoDiaria.mutate({
                                    id: d.id,
                                    op: 'lancar-caixa',
                                  })
                                }
                                disabled={acaoDiaria.isPending}
                                className="btn btn-p bg-amber-500 text-white hover:bg-amber-600"
                              >
                                Lançar no caixa
                              </button>
                              <button
                                onClick={() =>
                                  acaoDiaria.mutate({
                                    id: d.id,
                                    op: 'marcar-lancado',
                                  })
                                }
                                title="Marque quando você mesmo lançou a saída na tela do IXC"
                                className="btn btn-neutro btn-p"
                              >
                                Já lancei à mão
                              </button>
                            </>
                          )}
                          {!d.idLancamentoIxc && (
                            <button
                              onClick={() => {
                                if (
                                  confirm(
                                    `Apagar a diária de ${formatBRL(d.valor)}?` +
                                      (d.contaPagarId
                                        ? '\n\nA conta a pagar também será apagada no IXC.'
                                        : ''),
                                  )
                                ) {
                                  excluirDiaria.mutate(d.id);
                                }
                              }}
                              className="btn btn-sutil btn-p hover:bg-rose-50 hover:text-rose-600"
                            >
                              Excluir
                            </button>
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
      )}

      {pagando && (
        <FormularioDiaria
          diarista={pagando}
          ocupado={pagar.isPending}
          onCancelar={() => setPagando(null)}
          onConfirmar={(body) =>
            pagar.mutate({ diaristaId: pagando.id, body })
          }
        />
      )}
    </Pagina>
  );
}

/**
 * As diárias que ficaram no meio do caminho: lançadas pelo IXC, mas com a
 * conta a pagar reprovada, recusada — ou apagada de lá, que é o que deixa a
 * diária sem conta nenhuma.
 *
 * Nenhuma vai sair sozinha, então já não contam no gasto do mês. Ficarem fora
 * *e* invisíveis é que seria ruim: ou alguém refaz o pagamento, ou apaga o
 * registro aqui — e é isto que este bloco serve para fazer.
 */
function DiariasTravadas({
  diarias,
  ocupado,
  onApagar,
}: {
  diarias: Diaria[];
  ocupado: boolean;
  onApagar: (ids: string[]) => void;
}) {
  const total = diarias.reduce((s, d) => s + Number(d.valor), 0);

  return (
    <Bloco
      titulo="Diárias paradas no meio do caminho"
      className="surgir mb-6"
      acao={
        <button
          onClick={() => {
            if (
              confirm(
                `Apagar ${diarias.length} diária(s) travada(s), somando ${formatBRL(total)}?\n\n` +
                  'Nenhuma delas tem conta a pagar viva no IXC. O registro some daqui e não volta.',
              )
            ) {
              onApagar(diarias.map((d) => d.id));
            }
          }}
          disabled={ocupado}
          className="btn btn-p bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40"
        >
          {ocupado ? 'Apagando…' : 'Apagar todas'}
        </button>
      }
      semPadding
    >
      <p className="px-5 pb-3 text-xs leading-relaxed text-tinta-500 sm:px-6">
        A conta a pagar destas foi reprovada, recusada ou apagada no IXC — elas
        já não entram no gasto do mês. Apague as que foram teste; para as que
        eram de verdade, pague de novo pela pessoa na lista abaixo.
      </p>
      <div className="overflow-x-auto rolagem-fina">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-tinta-100">
              <th className="th">Diarista</th>
              <th className="th">Data</th>
              <th className="th">Serviço</th>
              <th className="th text-right">Valor</th>
              <th className="th">Situação</th>
              <th className="th text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {diarias.map((d) => (
              <tr key={d.id} className="linha">
                <td className="td font-medium text-tinta-800">
                  {d.diarista?.nome ?? '—'}
                </td>
                <td className="td num text-tinta-500">{formatData(d.data)}</td>
                <td className="td text-tinta-500">{d.descricao}</td>
                <td className="td text-right">
                  <span className="valor">{formatBRL(d.valor)}</span>
                </td>
                <td className="td">
                  {d.contaPagar ? (
                    <Selo pequeno tom={STATUS_TOM[d.contaPagar.status]} ponto>
                      {STATUS_LABEL[d.contaPagar.status]}
                    </Selo>
                  ) : (
                    <Selo
                      pequeno
                      tom="neutro"
                      titulo="O fn_apagar dela não existe mais no IXC"
                    >
                      conta apagada no IXC
                    </Selo>
                  )}
                </td>
                <td className="td text-right">
                  <button
                    onClick={() => {
                      if (confirm(`Apagar a diária de ${formatBRL(d.valor)}?`)) {
                        onApagar([d.id]);
                      }
                    }}
                    disabled={ocupado}
                    className="btn btn-sutil btn-p hover:bg-rose-50 hover:text-rose-600"
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Bloco>
  );
}

/**
 * Como essa pessoa recebe. Vem da aba "Dados bancários" do fornecedor no IXC,
 * a mesma fonte usada para os funcionários. É a chave PIX que de fato paga.
 */
function DadosBancarios({ diarista }: { diarista: Diarista }) {
  const nada =
    !diarista.banco &&
    !diarista.agencia &&
    !diarista.conta &&
    !diarista.chavePix;

  return (
    <Bloco titulo="Como recebe" className="surgir surgir-3 mt-6">
      {nada ? (
        <p className="text-sm text-tinta-500">
          Sem dados de pagamento. Edite o cadastro para informar a chave PIX, ou
          preencha a aba “Dados bancários” do fornecedor no IXC e sincronize.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <CampoLeitura rotulo="Banco" valor={diarista.banco} />
          <CampoLeitura rotulo="Agência" valor={diarista.agencia} mono />
          <CampoLeitura rotulo="Conta" valor={diarista.conta} mono />
          <CampoLeitura rotulo="Chave PIX" valor={diarista.chavePix} mono />
          <CampoLeitura
            rotulo="Tipo da chave"
            valor={diarista.tipoChavePix ?? 'pelo formato da chave'}
          />
        </div>
      )}
    </Bloco>
  );
}

function CampoLeitura({
  rotulo,
  valor,
  mono,
}: {
  rotulo: string;
  valor: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="rotulo">{rotulo}</div>
      <div className={`text-sm text-tinta-800 ${mono ? 'num' : ''}`}>
        {valor || '—'}
      </div>
    </div>
  );
}

/** Por onde a diária saiu — e o que ainda falta, quando falta. */
function SituacaoDiaria({ diaria }: { diaria: Diaria }) {
  if (diaria.forma === 'IXC') {
    const conta = diaria.contaPagar;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Selo pequeno tom="info">
          IXC
        </Selo>
        {conta && (
          <Selo pequeno tom={STATUS_TOM[conta.status]} ponto>
            {STATUS_LABEL[conta.status]}
          </Selo>
        )}
      </div>
    );
  }

  if (diaria.idLancamentoIxc) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Selo pequeno tom="pago">
          caixa {diaria.caixaIxc ?? '?'}
        </Selo>
        <span className="num text-xs text-tinta-400">
          lanç. {diaria.idLancamentoIxc}
        </span>
      </div>
    );
  }
  if (diaria.lancadoManual) {
    return (
      <Selo pequeno tom="pago" titulo="Lançado na tela do IXC por você">
        lançado à mão
      </Selo>
    );
  }
  return (
    <Selo
      pequeno
      tom="atencao"
      titulo="O dinheiro saiu em mãos, mas a saída ainda não está no caixa do IXC."
    >
      fora do caixa
    </Selo>
  );
}

/** O que dizer depois de pagar (ou de tentar lançar no caixa de novo). */
function resumoDoPagamento(d: Diaria): string {
  if (d.forma === 'IXC') {
    if (d.contaPagar?.status === 'ERRO') {
      return `O IXC recusou: ${d.contaPagar.erro ?? 'erro desconhecido'} — corrija e reenvie em Contas a Pagar.`;
    }
    return 'Diária lançada como conta a pagar no IXC — aprove em Contas a Pagar.';
  }
  if (d.erroIxc) return d.erroIxc;
  if (d.idLancamentoIxc) {
    return `Diária paga em mãos e descontada do caixa ${d.caixaIxc} no IXC (lançamento ${d.idLancamentoIxc}).`;
  }
  return 'Diária registrada.';
}

/**
 * Lançar uma diária. Quantidade × valor do dia dá o total, mas o total é
 * editável: é comum acertar um valor redondo na hora.
 */
function FormularioDiaria({
  diarista,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  diarista: Diarista;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (body: Record<string, unknown>) => void;
}) {
  const [data, setData] = useState(hojeISO());
  const [quantidade, setQuantidade] = useState('1');
  const [valorDiaria, setValorDiaria] = useState(diarista.valorDiaria ?? '');
  const [total, setTotal] = useState('');
  const [descricao, setDescricao] = useState('');
  const [forma, setForma] = useState<FormaPagamento>(
    diarista.formaPagamento,
  );
  const [chavePix, setChavePix] = useState(diarista.chavePix ?? '');
  const [tipoChavePix, setTipoChavePix] = useState(diarista.tipoChavePix ?? '');

  const calculado = (Number(quantidade) || 0) * (Number(valorDiaria) || 0);
  const totalEfetivo = Number(total) > 0 ? Number(total) : calculado;
  const valido = totalEfetivo >= 0.01 && descricao.trim().length >= 3;

  return (
    <Bloco titulo={`Pagar diária — ${diarista.nome}`} className="surgir mt-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Dia trabalhado">
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="campo"
          />
        </Campo>
        <Campo label="Quantas diárias">
          <input
            type="number"
            step="0.5"
            min="0.5"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            className="campo"
          />
        </Campo>
        <Campo label="Valor do dia (R$)">
          <CampoDinheiro valor={valorDiaria} onChange={setValorDiaria} />
        </Campo>
        <Campo label="Total (R$) — vazio usa a conta acima">
          <CampoDinheiro
            valor={total}
            onChange={setTotal}
            placeholder={calculado > 0 ? formatBRL(calculado) : ''}
          />
        </Campo>
        <Campo label="Como vai pagar">
          <select
            value={forma}
            onChange={(e) => setForma(e.target.value as FormaPagamento)}
            className="campo"
          >
            <option value="IXC">Pelo IXC (conta a pagar)</option>
            <option value="EM_MAOS">Em mãos (desconta do caixa)</option>
          </select>
        </Campo>
        <Campo label="Serviço feito — vai para o IXC" span2>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="campo"
            placeholder="Ex.: pintura do galpão"
          />
        </Campo>
        {forma === 'IXC' && (
          <>
            <Campo label="Chave PIX — vai exata para o IXC">
              <input
                value={chavePix}
                onChange={(e) => setChavePix(e.target.value)}
                className="campo"
                placeholder="Ex.: (99) 99230-0993"
              />
            </Campo>
            <Campo label="Tipo da chave">
              <select
                value={tipoChavePix}
                onChange={(e) => setTipoChavePix(e.target.value)}
                className="campo"
              >
                <option value="">Pelo formato da chave</option>
                {TIPOS_CHAVE_PIX.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Campo>
          </>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-tinta-500">
        {forma === 'IXC'
          ? 'Vai virar conta a pagar no IXC: o diarista é cadastrado como fornecedor, e o pagamento passa pela auditoria como o da folha. A chave e o tipo ficam gravados no cadastro para o próximo pagamento.'
          : 'O dinheiro já saiu da sua mão: a diária é registrada como paga e a saída é lançada no caixa configurado em Configurações.'}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-tinta-100 pt-4">
        <button
          onClick={() =>
            onConfirmar({
              data,
              quantidade: Number(quantidade) || 1,
              valorDiaria: valorDiaria || undefined,
              valor: total || undefined,
              descricao,
              forma,
              ...(forma === 'IXC' ? { chavePix, tipoChavePix } : {}),
            })
          }
          disabled={!valido || ocupado}
          className="btn btn-primario"
        >
          {ocupado ? 'Registrando…' : 'Confirmar pagamento'}
        </button>
        <button onClick={onCancelar} className="btn btn-neutro">
          Cancelar
        </button>
        {totalEfetivo > 0 && (
          <span className="text-sm text-tinta-500">
            Vai sair{' '}
            <strong className="valor text-[15px]">
              {formatBRL(totalEfetivo)}
            </strong>
          </span>
        )}
      </div>
    </Bloco>
  );
}

function Campo({
  label,
  span2,
  children,
}: {
  label: string;
  span2?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="rotulo">{label}</label>
      {children}
    </div>
  );
}
