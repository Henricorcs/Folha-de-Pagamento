import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SyncStatus } from '@prisma/client';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { DadosBancariosService } from '../ixc/dados-bancarios.service';
import { IxcClient } from '../ixc/ixc.client';
import {
  distribuicaoDoCampo,
  filtrarFornecedores,
  montarUpdateDiaristaDoFornecedor,
  montarUpdateDoFornecedor,
  parseValores,
  REGRA_ESTRANGEIRO,
  REGRA_ICMS_ISENTO,
  somenteDigitos,
  type DiaristaLocal,
  type FuncionarioLocal,
  type OcorrenciaCampo,
  type PessoaDoFornecedor,
  type VinculoLocal,
} from '../ixc/ixc.fornecedor';
import { mapAdiantamento, mapFuncionario } from '../ixc/ixc.mappers';
import type {
  IxcAdiantamento,
  IxcFornecedor,
  IxcFuncionario,
} from '../ixc/ixc.types';
import { PrismaService } from '../prisma/prisma.service';

export interface SyncResult {
  recurso: string;
  totalLidos: number;
  totalNovos: number;
  totalAtualizados: number;
}

/** Prévia do filtro de funcionários no cadastro de fornecedor. */
export interface PreviewFornecedores {
  /** Coluna de "Contribuinte ICMS" usada (null = não encontrada). */
  campoIcms: string | null;
  /** Valores considerados "Isento" (configuráveis). */
  valoresIsento: string[];
  /** Tabela da aba "Dados bancários" em uso (null = nenhuma encontrada). */
  tabelaBanco: string | null;
  totalFornecedoresAtivos: number;
  /** Todos os valores do campo de ICMS na base, para conferência. */
  distribuicao: OcorrenciaCampo[];
  funcionarios: Array<PessoaDoFornecedor & { jaCadastrado: boolean }>;
}

/** Prévia do filtro de diaristas no cadastro de fornecedor. */
export interface PreviewDiaristas {
  /** Coluna de "Tipo de pessoa" usada (null = não encontrada). */
  campoTipoPessoa: string | null;
  /** Valores considerados "Estrangeiro" (configuráveis). */
  valoresEstrangeiro: string[];
  tabelaBanco: string | null;
  totalFornecedoresAtivos: number;
  /** Todos os valores do campo na base — é o que confirma o código correto. */
  distribuicao: OcorrenciaCampo[];
  /**
   * Colunas do primeiro fornecedor lido. Serve para achar o nome certo quando
   * a detecção automática erra e o filtro vem vazio.
   */
  camposDisponiveis: string[];
  diaristas: Array<
    PessoaDoFornecedor & { jaCadastrado: boolean; jaEhFuncionario: boolean }
  >;
}

/** Resultado da importação de diaristas, com quem ficou de fora e por quê. */
export interface SyncDiaristasResult extends SyncResult {
  campoTipoPessoa: string | null;
  /** Quem não entrou porque já está cadastrado como funcionário. */
  ignoradosPorSerFuncionario: string[];
}

/**
 * Sincroniza dados do IXC para o banco local (pull).
 * Usa upsert por `ixcId` para ser idempotente: rodar de novo não duplica.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly ixc: IxcClient,
    private readonly prisma: PrismaService,
    private readonly config: ConfigFinanceiraService,
    private readonly dadosBancarios: DadosBancariosService,
  ) {}

  /**
   * Sincroniza funcionários (tabela `funcionarios` + cadastro de fornecedor) e,
   * em seguida, seus adiantamentos.
   */
  async syncTudo(): Promise<SyncResult[]> {
    const funcionarios = await this.syncFuncionarios();
    const fornecedores = await this.syncFuncionariosDoFornecedor();
    const adiantamentos = await this.syncAdiantamentos();
    return [funcionarios, fornecedores, adiantamentos];
  }

  async syncFuncionarios(): Promise<SyncResult> {
    const log = await this.prisma.syncLog.create({
      data: { recurso: 'funcionarios', status: SyncStatus.EM_ANDAMENTO },
    });

    try {
      const registros = await this.ixc.listAll<IxcFuncionario>('funcionarios', {
        qtype: 'funcionarios.id',
        query: '0',
        oper: '>',
        sortname: 'funcionarios.id',
        sortorder: 'asc',
      });

      let novos = 0;
      let atualizados = 0;

      for (const raw of registros) {
        const { ixcId, create, update } = mapFuncionario(raw);
        const existente = await this.prisma.funcionario.findUnique({
          where: { ixcId },
          select: { id: true },
        });
        await this.prisma.funcionario.upsert({
          where: { ixcId },
          create,
          update,
        });
        if (existente) atualizados++;
        else novos++;
      }

      // Os dados bancários (banco/agência/conta/PIX) não vêm daqui: são lidos
      // da aba "Dados bancários" do fornecedor em syncFuncionariosDoFornecedor.

      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: SyncStatus.SUCESSO,
          totalLidos: registros.length,
          totalNovos: novos,
          totalAtual: atualizados,
          concluidoEm: new Date(),
        },
      });

      this.logger.log(
        `Funcionários sincronizados: ${registros.length} (novos ${novos}, atualizados ${atualizados})`,
      );
      return {
        recurso: 'funcionarios',
        totalLidos: registros.length,
        totalNovos: novos,
        totalAtualizados: atualizados,
      };
    } catch (err) {
      await this.marcarErro(log.id, err);
      throw err;
    }
  }

  async syncAdiantamentos(): Promise<SyncResult> {
    const log = await this.prisma.syncLog.create({
      data: { recurso: 'adiantamentos', status: SyncStatus.EM_ANDAMENTO },
    });

    try {
      const registros = await this.ixc.listAll<IxcAdiantamento>(
        'fl_adto_salario',
        {
          qtype: 'fl_adto_salario.id',
          query: '0',
          oper: '>',
          sortname: 'fl_adto_salario.id',
          sortorder: 'asc',
        },
      );

      // Mapa ixcId(funcionario) -> id local, para resolver a FK.
      const funcionarios = await this.prisma.funcionario.findMany({
        where: { ixcId: { not: null } },
        select: { id: true, ixcId: true },
      });
      const mapaFunc = new Map(funcionarios.map((f) => [f.ixcId!, f.id]));

      let novos = 0;
      let atualizados = 0;
      let ignorados = 0;

      for (const raw of registros) {
        const funcIxcId = Number(raw.id_funcionario);
        const localId = mapaFunc.get(funcIxcId);
        if (!localId) {
          ignorados++;
          continue; // adiantamento de funcionário ainda não sincronizado
        }
        const { ixcId, create, update } = mapAdiantamento(raw, localId);
        const existente = await this.prisma.adiantamento.findUnique({
          where: { ixcId },
          select: { id: true },
        });
        await this.prisma.adiantamento.upsert({
          where: { ixcId },
          create,
          update,
        });
        if (existente) atualizados++;
        else novos++;
      }

      if (ignorados > 0) {
        this.logger.warn(
          `${ignorados} adiantamento(s) ignorado(s): funcionário não sincronizado`,
        );
      }

      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: SyncStatus.SUCESSO,
          totalLidos: registros.length,
          totalNovos: novos,
          totalAtual: atualizados,
          concluidoEm: new Date(),
        },
      });

      return {
        recurso: 'adiantamentos',
        totalLidos: registros.length,
        totalNovos: novos,
        totalAtualizados: atualizados,
      };
    } catch (err) {
      await this.marcarErro(log.id, err);
      throw err;
    }
  }

  /**
   * Importa os funcionários a partir do cadastro de `fornecedor` do IXC:
   * fornecedor **ativo** com "Contribuinte ICMS" = **Isento** é funcionário.
   * Traz junto os dados de pagamento (banco/agência/conta/PIX), que só existem
   * no fornecedor, e já vincula o `id_fornecedor` usado nas contas a pagar.
   *
   * Casamento com o cadastro local, nesta ordem: `idFornecedorIxc` → CPF/CNPJ
   * (só dígitos) → cria novo. Quem entra no filtro fica marcado com
   * `isentoIcms` (é o que faz aparecer na listagem e na folha); quem sai perde
   * a marca, mas continua no banco e nunca é desativado.
   */
  async syncFuncionariosDoFornecedor(): Promise<SyncResult> {
    const log = await this.prisma.syncLog.create({
      data: { recurso: 'fornecedores', status: SyncStatus.EM_ANDAMENTO },
    });

    try {
      const { campoIcms, funcionarios, totalAtivos } =
        await this.lerFuncionariosDoFornecedor();

      if (!campoIcms) {
        this.logger.warn(
          'Campo "Contribuinte ICMS" não encontrado no fornecedor — nenhum ' +
            'funcionário importado. Veja a prévia (GET /sync/fornecedores/preview).',
        );
      } else if (funcionarios.length === 0) {
        this.logger.warn(
          `Nenhum fornecedor ativo com ICMS isento em "${campoIcms}" (${totalAtivos} lidos). ` +
            'Confira os valores na prévia e ajuste em Configurações.',
        );
      }

      const indice = await this.indiceFuncionarios();
      const marcados: string[] = [];
      let novos = 0;
      let atualizados = 0;

      for (const dados of funcionarios) {
        const local =
          indice.porFornecedor.get(dados.idFornecedor) ??
          indice.porDoc.get(somenteDigitos(dados.cpfCnpj));

        if (local) {
          const data = {
            ...montarUpdateDoFornecedor(local, dados),
            isentoIcms: true,
          };
          await this.prisma.funcionario.update({
            where: { id: local.id },
            data,
          });
          marcados.push(local.id);
          atualizados++;
          continue;
        }

        const criado = await this.prisma.funcionario.create({
          data: {
            nome: dados.nome,
            cpfCnpj: dados.cpfCnpj,
            email: dados.email,
            telefone: dados.telefone,
            banco: dados.banco,
            agencia: dados.agencia,
            conta: dados.conta,
            chavePix: dados.chavePix,
            tipoChavePix: dados.tipoChavePix,
            cidadeIxc: dados.cidadeIxc,
            idFornecedorIxc: dados.idFornecedor,
            ativo: true,
            isentoIcms: true,
          },
        });
        this.indexar(indice, criado);
        marcados.push(criado.id);
        novos++;
      }

      // Quem deixou de ser fornecedor isento sai da folha e da listagem — mas
      // só quando o filtro realmente rodou (senão desmarcaria todo mundo).
      let desmarcados = 0;
      if (campoIcms) {
        const res = await this.prisma.funcionario.updateMany({
          where: { isentoIcms: true, id: { notIn: marcados } },
          data: { isentoIcms: false },
        });
        desmarcados = res.count;
        if (desmarcados > 0) {
          this.logger.log(
            `${desmarcados} funcionário(s) saíram do filtro de ICMS isento`,
          );
        }
      }

      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: SyncStatus.SUCESSO,
          totalLidos: funcionarios.length,
          totalNovos: novos,
          totalAtual: atualizados,
          concluidoEm: new Date(),
        },
      });

      this.logger.log(
        `Funcionários do fornecedor (ICMS isento): ${funcionarios.length} de ` +
          `${totalAtivos} fornecedores ativos (novos ${novos}, atualizados ${atualizados})`,
      );
      return {
        recurso: 'fornecedores',
        totalLidos: funcionarios.length,
        totalNovos: novos,
        totalAtualizados: atualizados,
      };
    } catch (err) {
      await this.marcarErro(log.id, err);
      throw err;
    }
  }

  /**
   * Roda o filtro sem gravar nada. Além da lista, devolve o campo de ICMS
   * detectado e a distribuição de valores na base — é o que permite confirmar
   * qual código significa "Isento" quando o resultado vier vazio ou inflado.
   */
  async previewFuncionariosDoFornecedor(): Promise<PreviewFornecedores> {
    const { campoIcms, funcionarios, registros, valoresIsento, tabelaBanco } =
      await this.lerFuncionariosDoFornecedor();

    const indice = await this.indiceFuncionarios();

    return {
      campoIcms,
      valoresIsento,
      tabelaBanco: tabelaBanco ?? null,
      totalFornecedoresAtivos: registros.length,
      distribuicao: distribuicaoDoCampo(registros, campoIcms),
      funcionarios: funcionarios.map((f) => ({
        ...f,
        jaCadastrado:
          indice.porFornecedor.has(f.idFornecedor) ||
          indice.porDoc.has(somenteDigitos(f.cpfCnpj)),
      })),
    };
  }

  /**
   * Importa os diaristas a partir do cadastro de `fornecedor` do IXC:
   * fornecedor **ativo** com "Tipo de pessoa" = **Estrangeiro** é diarista.
   * Traz junto os dados de pagamento (banco/agência/conta/PIX) da aba "Dados
   * bancários" e já vincula o `id_fornecedor` usado nas contas a pagar.
   *
   * Três diferenças deliberadas em relação ao sync de funcionários:
   *
   * - **Funcionário vence**: quem já está cadastrado como funcionário não entra
   *   como diarista. As duas regras leem colunas diferentes do mesmo cadastro,
   *   então a mesma pessoa pode casar nas duas — e aí receberia pela folha e por
   *   diária, contra o mesmo fornecedor, sem ninguém perceber.
   * - **Nunca desativa nem apaga**: diarista também nasce à mão, então sair do
   *   filtro não pode sumir com o cadastro (o de funcionário desmarca `isentoIcms`).
   * - **O que está escrito aqui vence**: o update só completa campo vazio.
   */
  async syncDiaristasDoFornecedor(): Promise<SyncDiaristasResult> {
    const log = await this.prisma.syncLog.create({
      data: { recurso: 'diaristas', status: SyncStatus.EM_ANDAMENTO },
    });

    try {
      const { campoTipoPessoa, diaristas, totalAtivos } =
        await this.lerDiaristasDoFornecedor();

      if (!campoTipoPessoa) {
        this.logger.warn(
          'Campo "Tipo de pessoa" não encontrado no fornecedor — nenhum ' +
            'diarista importado. Veja a prévia (GET /sync/diaristas/preview).',
        );
      } else if (diaristas.length === 0) {
        this.logger.warn(
          `Nenhum fornecedor ativo é "Estrangeiro" em "${campoTipoPessoa}" ` +
            `(${totalAtivos} lidos). Confira os valores na prévia e ajuste em Configurações.`,
        );
      }

      // Quem **é** funcionário pela regra da casa (fornecedor isento de ICMS),
      // e não qualquer linha da tabela: estar cadastrado lá sem ser isento não
      // pode impedir de virar diarista.
      const funcionarios = await this.indiceFuncionarios({ isentoIcms: true });
      const indice = await this.indiceDiaristas();
      /** Cadastros locais já usados nesta rodada, para dois fornecedores
       * distintos não colapsarem no mesmo diarista. */
      const consumidos = new Set<string>();
      const ignoradosPorSerFuncionario: string[] = [];
      let novos = 0;
      let atualizados = 0;

      for (const dados of diaristas) {
        const doc = somenteDigitos(dados.cpfCnpj);

        if (
          funcionarios.porFornecedor.has(dados.idFornecedor) ||
          (doc && funcionarios.porDoc.has(doc))
        ) {
          ignoradosPorSerFuncionario.push(dados.nome);
          continue;
        }

        const local =
          indice.porFornecedor.get(dados.idFornecedor) ??
          (doc ? indice.porDoc.get(doc) : undefined);

        if (local && !consumidos.has(local.id)) {
          consumidos.add(local.id);
          await this.prisma.diarista.update({
            where: { id: local.id },
            data: montarUpdateDiaristaDoFornecedor(local, dados),
          });
          atualizados++;
          continue;
        }

        if (local) {
          this.logger.warn(
            `Fornecedor #${dados.idFornecedor} (${dados.nome}) casa com um ` +
              'diarista já usado nesta rodada — provável CPF duplicado no IXC. Pulado.',
          );
          continue;
        }

        const criado = await this.prisma.diarista.create({
          data: {
            nome: dados.nome,
            nomeFantasia: dados.nomeFantasia,
            cpfCnpj: dados.cpfCnpj,
            telefone: dados.telefone,
            banco: dados.banco,
            agencia: dados.agencia,
            conta: dados.conta,
            chavePix: dados.chavePix,
            tipoChavePix: dados.tipoChavePix,
            cidadeIxc: dados.cidadeIxc,
            idFornecedorIxc: dados.idFornecedor,
            importadoDoIxc: true,
          },
        });
        this.indexar(indice, criado);
        consumidos.add(criado.id);
        novos++;
      }

      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: SyncStatus.SUCESSO,
          totalLidos: diaristas.length,
          totalNovos: novos,
          totalAtual: atualizados,
          concluidoEm: new Date(),
        },
      });

      this.logger.log(
        `Diaristas do fornecedor (Estrangeiro): ${diaristas.length} de ` +
          `${totalAtivos} fornecedores ativos (novos ${novos}, atualizados ${atualizados}` +
          `, já funcionários ${ignoradosPorSerFuncionario.length})`,
      );
      return {
        recurso: 'diaristas',
        totalLidos: diaristas.length,
        totalNovos: novos,
        totalAtualizados: atualizados,
        campoTipoPessoa,
        ignoradosPorSerFuncionario,
      };
    } catch (err) {
      await this.marcarErro(log.id, err);
      throw err;
    }
  }

  /**
   * Roda o filtro de diaristas sem gravar nada. A distribuição e as colunas
   * disponíveis existem porque o código que o IXC guarda para "Estrangeiro" não
   * é documentado: é aqui que se confirma qual é, antes de importar.
   */
  async previewDiaristasDoFornecedor(): Promise<PreviewDiaristas> {
    const {
      campoTipoPessoa,
      diaristas,
      registros,
      valoresEstrangeiro,
      tabelaBanco,
    } = await this.lerDiaristasDoFornecedor();

    // Mesma régua da importação: só barra quem é isento de ICMS de verdade.
    const funcionarios = await this.indiceFuncionarios({ isentoIcms: true });
    const indice = await this.indiceDiaristas();

    return {
      campoTipoPessoa,
      valoresEstrangeiro,
      tabelaBanco: tabelaBanco ?? null,
      totalFornecedoresAtivos: registros.length,
      distribuicao: distribuicaoDoCampo(registros, campoTipoPessoa),
      camposDisponiveis: registros[0] ? Object.keys(registros[0]).sort() : [],
      diaristas: diaristas.map((d) => {
        const doc = somenteDigitos(d.cpfCnpj);
        return {
          ...d,
          jaCadastrado:
            indice.porFornecedor.has(d.idFornecedor) ||
            (!!doc && indice.porDoc.has(doc)),
          jaEhFuncionario:
            funcionarios.porFornecedor.has(d.idFornecedor) ||
            (!!doc && funcionarios.porDoc.has(doc)),
        };
      }),
    };
  }

  /** Lê os fornecedores ativos do IXC e aplica o filtro de diarista. */
  private async lerDiaristasDoFornecedor(): Promise<{
    registros: IxcFornecedor[];
    campoTipoPessoa: string | null;
    valoresEstrangeiro: string[];
    diaristas: PessoaDoFornecedor[];
    totalAtivos: number;
    tabelaBanco: string | null | undefined;
  }> {
    const cfg = await this.config.obter();
    const valoresEstrangeiro = parseValores(
      cfg.fornecedorTipoEstrangeiro,
      REGRA_ESTRANGEIRO,
    );

    const registros = await this.lerFornecedoresAtivos();

    const { campo, pessoas } = filtrarFornecedores(registros, REGRA_ESTRANGEIRO, {
      campo: cfg.fornecedorCampoTipoPessoa,
      valores: valoresEstrangeiro,
    });

    await this.completarDadosBancarios(pessoas, cfg.fornecedorTabelaBanco);

    return {
      registros,
      campoTipoPessoa: campo,
      valoresEstrangeiro,
      diaristas: pessoas,
      totalAtivos: registros.length,
      tabelaBanco: this.dadosBancarios.tabelaEmUso,
    };
  }

  /** Lê os fornecedores ativos do IXC e aplica o filtro de funcionário. */
  private async lerFuncionariosDoFornecedor(): Promise<{
    registros: IxcFornecedor[];
    campoIcms: string | null;
    valoresIsento: string[];
    funcionarios: PessoaDoFornecedor[];
    totalAtivos: number;
    tabelaBanco: string | null | undefined;
  }> {
    const cfg = await this.config.obter();
    const valoresIsento = parseValores(
      cfg.fornecedorIcmsIsento,
      REGRA_ICMS_ISENTO,
    );

    const registros = await this.lerFornecedoresAtivos();

    const { campo, pessoas } = filtrarFornecedores(registros, REGRA_ICMS_ISENTO, {
      campo: cfg.fornecedorCampoIcms,
      valores: valoresIsento,
    });

    await this.completarDadosBancarios(pessoas, cfg.fornecedorTabelaBanco);

    return {
      registros,
      campoIcms: campo,
      valoresIsento,
      funcionarios: pessoas,
      totalAtivos: registros.length,
      tabelaBanco: this.dadosBancarios.tabelaEmUso,
    };
  }

  /** Todos os fornecedores ativos do IXC — base dos dois filtros. */
  private lerFornecedoresAtivos(): Promise<IxcFornecedor[]> {
    return this.ixc.listAll<IxcFornecedor>('fornecedor', {
      qtype: 'fornecedor.ativo',
      query: 'S',
      oper: '=',
      sortname: 'fornecedor.id',
      sortorder: 'asc',
    });
  }

  /**
   * Busca banco/agência/conta/PIX na aba "Dados bancários" de cada fornecedor
   * do filtro. É uma consulta por funcionário, mas o filtro já reduziu a lista
   * a quem é funcionário de fato. O grid vence o registro do fornecedor, que
   * costuma vir sem esses campos.
   */
  private async completarDadosBancarios(
    pessoas: PessoaDoFornecedor[],
    tabelaConfigurada: string,
  ): Promise<void> {
    let comPix = 0;
    for (const f of pessoas) {
      const grid = await this.dadosBancarios.doFornecedor(
        f.idFornecedor,
        tabelaConfigurada,
      );
      f.banco = grid.banco ?? f.banco;
      f.agencia = grid.agencia ?? f.agencia;
      f.conta = grid.conta ?? f.conta;
      // Chave e tipo preferencial andam juntos: são a mesma decisão.
      if (grid.chavePix) {
        f.chavePix = grid.chavePix;
        f.tipoChavePix = grid.tipoChavePix;
      }
      if (f.chavePix) comPix++;
    }
    if (pessoas.length > 0) {
      this.logger.log(
        `Dados bancários lidos: ${comPix} de ${pessoas.length} pessoa(s) com chave PIX`,
      );
    }
  }

  /** Índice dos funcionários locais por id de fornecedor e por CPF/CNPJ. */
  /**
   * Índice dos cadastros locais de funcionário.
   *
   * Sem filtro, traz **todas** as linhas da tabela — inclusive quem veio do
   * cadastro de funcionários do IXC sem ser isento de ICMS. É o que a
   * sincronização de funcionários precisa para achar o cadastro que já existe:
   * filtrar aqui criaria um segundo para quem acabou de virar isento.
   *
   * Quem quer saber "esta pessoa **é** funcionário?" passa
   * `{ isentoIcms: true }` — estar na tabela não é a mesma coisa que ser, e
   * confundir os dois barrava de virar diarista quem está marcado
   * "Estrangeiro" no fornecedor e "Contribuinte ICMS: Sim".
   */
  private async indiceFuncionarios(
    where?: Prisma.FuncionarioWhereInput,
  ): Promise<Indice<FuncionarioLocal>> {
    const locais = await this.prisma.funcionario.findMany({
      where,
      select: {
        id: true,
        ixcId: true,
        nome: true,
        cpfCnpj: true,
        email: true,
        telefone: true,
        cidadeIxc: true,
        idFornecedorIxc: true,
      },
    });
    return this.montarIndice(locais);
  }

  /**
   * Índice dos diaristas locais. Inclui os inativos de propósito: quem foi
   * desativado à mão não pode voltar como cadastro novo na próxima importação.
   */
  private async indiceDiaristas(): Promise<Indice<DiaristaLocal>> {
    const locais = await this.prisma.diarista.findMany({
      select: {
        id: true,
        nome: true,
        nomeFantasia: true,
        cpfCnpj: true,
        telefone: true,
        banco: true,
        agencia: true,
        conta: true,
        chavePix: true,
        cidadeIxc: true,
        idFornecedorIxc: true,
      },
    });
    return this.montarIndice(locais);
  }

  private montarIndice<T extends VinculoLocal>(locais: T[]): Indice<T> {
    const indice: Indice<T> = { porFornecedor: new Map(), porDoc: new Map() };
    for (const local of locais) this.indexar(indice, local);
    return indice;
  }

  private indexar<T extends VinculoLocal>(indice: Indice<T>, local: T): void {
    if (local.idFornecedorIxc) {
      indice.porFornecedor.set(local.idFornecedorIxc, local);
    }
    const doc = somenteDigitos(local.cpfCnpj);
    // Primeiro cadastro com o documento vence: evita trocar o vínculo quando há
    // duplicidade de CPF no IXC. Documento vazio nunca indexa — senão todo mundo
    // sem CPF viraria a mesma pessoa.
    if (doc && !indice.porDoc.has(doc)) indice.porDoc.set(doc, local);
  }

  private async marcarErro(logId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`Falha na sincronização: ${message}`);
    await this.prisma.syncLog.update({
      where: { id: logId },
      data: { status: SyncStatus.ERRO, erro: message, concluidoEm: new Date() },
    });
  }

  /** Últimos registros de sincronização, para exibir no frontend. */
  async historico(limite = 20) {
    return this.prisma.syncLog.findMany({
      orderBy: { iniciadoEm: 'desc' },
      take: limite,
    });
  }
}

/** Cadastros locais indexados para casar com os fornecedores lidos. */
interface Indice<T extends VinculoLocal> {
  porFornecedor: Map<number, T>;
  porDoc: Map<string, T>;
}
