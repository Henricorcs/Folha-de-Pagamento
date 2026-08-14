import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DadosBancariosService } from '../ixc/dados-bancarios.service';
import { IxcClient } from '../ixc/ixc.client';
import {
  buildFornecedorPayload,
  inferirTipoChavePix,
  normalizarTipoChavePix,
} from '../ixc/ixc.financeiro';
import {
  CAMPOS_DOC_FORNECEDOR,
  filtrarFornecedores,
  mascararDocumento,
  parseValores,
  REGRA_ESTRANGEIRO,
  somenteDigitos,
  variacoesDocumento,
} from '../ixc/ixc.fornecedor';
import type { IxcFornecedor } from '../ixc/ixc.types';
import { ConfigFinanceiraService } from './config-financeira.service';

/**
 * Um fornecedor que já existe no IXC, como a tela precisa vê-lo — inclusive a
 * aba "Dados bancários", que é de onde sai a chave que de fato paga. Reusar um
 * cadastro sem trazer o que ele já tem obrigaria a redigitar tudo, e o motivo
 * de reusar é justamente não ter de fazer isso.
 */
export interface FornecedorNoIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  /** F | J | E, como o IXC guarda. */
  tipoPessoa: string | null;
  email: string | null;
  telefone: string | null;
  cidadeIxc: number | null;
  ativo: boolean;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  tipoChavePix: string | null;
}

/** O que aconteceu ao ligar alguém daqui a um fornecedor do IXC. */
export interface VinculoNoIxc {
  idFornecedor: number;
  /** Ligado a um cadastro que já existia lá (mesmo CPF/CNPJ), não criado agora */
  reaproveitado: boolean;
  /** O cadastro novo saiu com a marcação que o identifica como diarista */
  marcadoComoDiarista: boolean;
}

/** Campo de texto do IXC: string não vazia, ou null. */
function texto(valor: unknown): string | null {
  const s = String(valor ?? '').trim();
  return s || null;
}

/**
 * Garante que cada beneficiário (funcionário ou avulso) tenha um fornecedor
 * correspondente no IXC — pré-requisito para gerar contas a pagar.
 */
@Injectable()
export class FornecedorService {
  private readonly logger = new Logger(FornecedorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly config: ConfigFinanceiraService,
    private readonly dadosBancarios: DadosBancariosService,
  ) {}

  /** Retorna (criando se preciso) o id_fornecedor do funcionário no IXC. */
  async garantirParaFuncionario(funcionarioId: string): Promise<number> {
    const func = await this.prisma.funcionario.findUnique({
      where: { id: funcionarioId },
    });
    if (!func) throw new NotFoundException('Funcionário não encontrado');
    if (func.idFornecedorIxc) return func.idFornecedorIxc;

    const cfg = await this.config.obter();
    const { id: idFornecedor } = await this.criarFornecedor({
      nome: func.nome,
      cpfCnpj: func.cpfCnpj,
      tipoPessoa: 'F',
      cidadeId: func.cidadeIxc ?? cfg.cidadePadraoId,
      email: func.email,
      celular: func.telefone,
      obs: 'Funcionário — folha de pagamento',
    });

    await this.prisma.funcionario.update({
      where: { id: funcionarioId },
      data: { idFornecedorIxc: idFornecedor },
    });
    return idFornecedor;
  }

  /** Retorna (criando se preciso) o id_fornecedor do diarista. */
  async garantirParaDiarista(diaristaId: string): Promise<number> {
    return (await this.vincularDiarista(diaristaId)).idFornecedor;
  }

  /**
   * O mesmo, contando o que aconteceu: é o que a tela de cadastro precisa para
   * dizer se o fornecedor nasceu agora, se foi reaproveitado um que já existia
   * lá, e se ele saiu marcado como diarista.
   */
  async vincularDiarista(diaristaId: string): Promise<VinculoNoIxc> {
    const d = await this.prisma.diarista.findUnique({
      where: { id: diaristaId },
    });
    if (!d) throw new NotFoundException('Diarista não encontrado');
    if (d.idFornecedorIxc) {
      return {
        idFornecedor: d.idFornecedorIxc,
        reaproveitado: true,
        marcadoComoDiarista: false,
      };
    }

    const cfg = await this.config.obter();
    // A marcação de "Estrangeiro" é o que faz o IXC — e o Sincronizar daqui —
    // reconhecer esta pessoa como diarista. Sem ela o fornecedor nasce igual a
    // qualquer outro, e quem importar do IXC amanhã não o traz de volta.
    const marcacao = await this.marcacaoDeDiarista(cfg);
    const criado = await this.criarFornecedor({
      nome: d.nome,
      cpfCnpj: d.cpfCnpj,
      tipoPessoa: 'F',
      cidadeId: d.cidadeIxc ?? cfg.cidadePadraoId,
      celular: d.telefone,
      obs: 'Diarista — pagamento por diária',
      extras: marcacao,
    });

    await this.prisma.diarista.update({
      where: { id: diaristaId },
      data: { idFornecedorIxc: criado.id },
    });

    return {
      idFornecedor: criado.id,
      reaproveitado: criado.reaproveitado,
      // Reaproveitar é vincular a um cadastro de outra pessoa que já existia
      // lá: mudar o tipo de pessoa dele seria mexer num registro que não é
      // nosso, e que pode ser uma empresa fornecedora de verdade.
      marcadoComoDiarista:
        !criado.reaproveitado && Object.keys(marcacao).length > 0,
    };
  }

  /** Retorna (criando se preciso) o id_fornecedor do beneficiário avulso. */
  async garantirParaAvulso(beneficiarioId: string): Promise<number> {
    const ben = await this.prisma.beneficiarioAvulso.findUnique({
      where: { id: beneficiarioId },
    });
    if (!ben) throw new NotFoundException('Beneficiário não encontrado');
    if (ben.idFornecedorIxc) return ben.idFornecedorIxc;

    const cfg = await this.config.obter();
    const { id: idFornecedor } = await this.criarFornecedor({
      nome: ben.nome,
      cpfCnpj: ben.cpfCnpj,
      tipoPessoa: ben.tipoPessoa,
      cidadeId: ben.cidadeIxc ?? cfg.cidadePadraoId,
      email: ben.email,
      celular: ben.telefone,
      obs: 'Beneficiário avulso — pagamento',
      // Quem cadastrou foi avisado de que já existia fornecedor com aquele
      // documento e mesmo assim quis um novo: aqui a busca não roda.
      semReuso: ben.fornecedorNovoNoIxc,
    });

    await this.prisma.beneficiarioAvulso.update({
      where: { id: beneficiarioId },
      data: { idFornecedorIxc: idFornecedor },
    });
    return idFornecedor;
  }

  /**
   * Procura no IXC um fornecedor com aquele CPF/CNPJ, para a tela poder
   * perguntar antes de cadastrar em vez de decidir sozinha. Reaproveitar é
   * quase sempre o certo — é no cadastro antigo que estão os dados bancários —
   * mas "quase sempre" não é sempre, e quem sabe é quem está cadastrando.
   */
  async procurarNoIxcPorCpfCnpj(
    cpfCnpj: string,
  ): Promise<FornecedorNoIxc | null> {
    const bruto = await this.procurarFornecedorBruto(cpfCnpj);
    if (!bruto) return null;

    const id = Number(bruto.id);
    if (!Number.isInteger(id) || id <= 0) return null;

    const cfg = await this.config.obter();
    const banco = await this.dadosBancarios.doFornecedor(
      id,
      cfg.fornecedorTabelaBanco,
    );

    return {
      idFornecedor: id,
      nome: texto(bruto.razao) ?? texto(bruto.fantasia) ?? `Fornecedor ${id}`,
      nomeFantasia: texto(bruto.fantasia),
      cpfCnpj: texto(bruto.cnpj_cpf) ?? texto(bruto.cpf_cnpj),
      tipoPessoa: texto(bruto.tipo_pessoa),
      email: texto(bruto.email),
      telefone: texto(bruto.celular) ?? texto(bruto.telefone),
      cidadeIxc: Number(bruto.cidade) || null,
      ativo: String(bruto.ativo ?? '').toUpperCase() !== 'N',
      ...banco,
    };
  }

  /**
   * Espelha a chave PIX na aba "Dados bancários" do fornecedor no IXC. É o que
   * faz o próximo pagamento não precisar da chave digitada de novo — e o que
   * deixa a tela de contas a pagar do IXC preencher sozinha quando alguém
   * lançar por lá.
   *
   * Devolve o motivo quando não deu, em vez de lançar: o pagamento daqui não
   * depende disto (a chave vai no payload do fn_apagar), então falhar aqui é
   * uma comodidade perdida, não um pagamento perdido.
   */
  async espelharPixNoIxc(
    idFornecedor: number,
    chavePix: string,
    tipoChavePix: string | null,
  ): Promise<string | null> {
    const cfg = await this.config.obter();
    const r = await this.dadosBancarios.gravarPix(
      idFornecedor,
      chavePix,
      normalizarTipoChavePix(tipoChavePix) ?? inferirTipoChavePix(chavePix),
      cfg.fornecedorTabelaBanco,
    );
    return r.gravado ? null : (r.motivo ?? 'motivo desconhecido');
  }

  private async criarFornecedor(input: {
    nome: string;
    cpfCnpj?: string | null;
    tipoPessoa: string;
    cidadeId: number;
    email?: string | null;
    celular?: string | null;
    obs?: string;
    /** Não reaproveitar cadastro existente: quem pediu já foi avisado. */
    semReuso?: boolean;
    /** Campos a mais no payload (a marcação de diarista, por exemplo). */
    extras?: Record<string, string>;
  }): Promise<{ id: number; reaproveitado: boolean }> {
    // Reutiliza fornecedor existente no IXC (por CPF/CNPJ) antes de criar um
    // novo — fornecedores já cadastrados costumam ter dados bancários/PIX que
    // a tela de contas a pagar do IXC preenche automaticamente.
    const existente = input.semReuso
      ? null
      : await this.buscarPorCpfCnpj(input.cpfCnpj);
    if (existente) {
      this.logger.log(
        `Fornecedor existente vinculado: #${existente} (${input.nome})`,
      );
      return { id: existente, reaproveitado: true };
    }

    // O cadastro de fornecedor do IXC exige "Classificação de ISS" (e possíveis
    // outros defaults tributários). Como o código válido é específico da base,
    // copia-o de um fornecedor já existente em vez de adivinhar.
    const extrasIss = await this.camposClassificacaoIss();
    const payload = {
      ...buildFornecedorPayload({
        ...input,
        // O IXC guarda o documento com pontos e hífen. Gravar só os dígitos
        // esconde o cadastro da busca de lá — e da nossa, no dia em que essa
        // pessoa for cadastrada de novo.
        cpfCnpj: mascararDocumento(input.cpfCnpj) ?? input.cpfCnpj,
      }),
      ...extrasIss,
      // Por último: a marcação de diarista escreve no `tipo_pessoa`, e é ela
      // que tem de valer sobre o "F" que o payload padrão põe ali.
      ...(input.extras ?? {}),
    };
    const { id } = await this.ixc.create('fornecedor', payload);
    if (!id) {
      throw new Error('IXC não retornou o id do fornecedor criado');
    }
    this.logger.log(`Fornecedor criado no IXC: #${id} (${input.nome})`);
    return { id, reaproveitado: false };
  }

  /**
   * O campo e o código que marcam alguém como diarista no fornecedor do IXC.
   *
   * O código de "Estrangeiro" não está na documentação do webservice e varia de
   * base para base, então ele é **aprendido com a própria base**: lê os
   * fornecedores ativos, vê quem o filtro de diarista já pega hoje e copia o
   * valor cru que eles têm ali. É o mesmo caminho da Classificação de ISS e do
   * rádio de tipo de chave PIX — copiar do que existe em vez de adivinhar.
   *
   * Sem nenhum estrangeiro na base para copiar, cai no que está em
   * Configurações; sem achar o campo, devolve vazio e o cadastro sai sem marca
   * (com o aviso subindo para a tela).
   */
  private async marcacaoDeDiarista(cfg: {
    fornecedorCampoTipoPessoa: string;
    fornecedorTipoEstrangeiro: string;
  }): Promise<Record<string, string>> {
    const valores = parseValores(
      cfg.fornecedorTipoEstrangeiro,
      REGRA_ESTRANGEIRO,
    );

    try {
      const registros = await this.lerFornecedoresAtivos();
      const { campo, pessoas } = filtrarFornecedores(
        registros,
        REGRA_ESTRANGEIRO,
        { campo: cfg.fornecedorCampoTipoPessoa, valores },
      );
      if (!campo) {
        this.logger.warn(
          'Não achei no fornecedor do IXC o campo de tipo de pessoa — ' +
            'o cadastro vai sair sem a marcação de diarista.',
        );
        return {};
      }

      const codigo = pessoas[0]?.valorFiltro?.trim() || valores[0];
      this.logger.log(
        `Marcação de diarista: ${campo}=${codigo}` +
          (pessoas[0] ? ` (copiada do fornecedor #${pessoas[0].idFornecedor})` : ''),
      );
      return { [campo]: codigo };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Não deu para descobrir a marcação de diarista: ${message}`);
      return {};
    }
  }

  /** Uma amostra dos fornecedores ativos, para aprender o formato da base. */
  private async lerFornecedoresAtivos(): Promise<IxcFornecedor[]> {
    const res = await this.ixc.list<IxcFornecedor>('fornecedor', {
      qtype: 'fornecedor.ativo',
      query: 'S',
      oper: '=',
      rp: 200,
      sortname: 'fornecedor.id',
      sortorder: 'desc',
    });
    return res.registros;
  }

  /**
   * Lê a classificação de ISS de um fornecedor já existente para reaproveitar
   * num cadastro novo (campo obrigatório no IXC). Copia os campos cujo nome
   * contém "iss" + "class" (ex.: `id_class_iss`), preenchidos. Falha aqui não
   * impede a tentativa de criação — apenas loga.
   */
  private async camposClassificacaoIss(): Promise<Record<string, string>> {
    try {
      const res = await this.ixc.list<Record<string, unknown>>('fornecedor', {
        qtype: 'fornecedor.ativo',
        query: 'S',
        oper: '=',
        rp: 1,
        sortname: 'fornecedor.id',
        sortorder: 'desc',
      });
      const modelo = res.registros[0];
      if (!modelo) {
        this.logger.warn(
          'Nenhum fornecedor modelo encontrado para copiar a Classificação de ISS',
        );
        return {};
      }
      const extras: Record<string, string> = {};
      for (const [chave, valor] of Object.entries(modelo)) {
        const k = chave.toLowerCase();
        if (k.includes('iss') && k.includes('class')) {
          const s = String(valor ?? '').trim();
          if (s) extras[chave] = s;
        }
      }
      if (Object.keys(extras).length === 0) {
        this.logger.warn(
          `Fornecedor modelo #${String(modelo.id)} sem Classificação de ISS preenchida`,
        );
      } else {
        this.logger.log(
          `Classificação de ISS copiada do fornecedor #${String(modelo.id)}: ${JSON.stringify(extras)}`,
        );
      }
      return extras;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao ler Classificação de ISS modelo: ${message}`);
      return {};
    }
  }

  private async buscarPorCpfCnpj(
    cpfCnpj?: string | null,
  ): Promise<number | null> {
    try {
      const bruto = await this.procurarFornecedorBruto(cpfCnpj ?? '');
      const id = Number(bruto?.id);
      return Number.isInteger(id) && id > 0 ? id : null;
    } catch (err) {
      // Falha na busca não deve impedir a criação; loga e segue.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Busca de fornecedor por CPF falhou: ${message}`);
      return null;
    }
  }

  /**
   * O fornecedor daquele documento, procurado em todas as formas em que a base
   * pode tê-lo guardado: as duas colunas conhecidas (`cpf_cnpj`/`cnpj_cpf`) e o
   * documento com e sem máscara. Procurar só o que foi digitado é o que fazia
   * "já cadastrado no IXC" responder que não havia cadastro nenhum.
   *
   * O documento do registro devolvido é conferido pelos dígitos: se a base
   * ignorar um `qtype` que ela não conhece e devolver o primeiro fornecedor da
   * tabela, o resultado é descartado. Vincular a pessoa errada seria pagar a
   * pessoa errada — não achar apenas cria um cadastro novo.
   *
   * Erro numa tentativa não condena a consulta (a coluna pode não existir aqui);
   * só quando nenhuma responde é que o IXC é dado como indisponível.
   */
  private async procurarFornecedorBruto(
    cpfCnpj: string,
  ): Promise<Record<string, unknown> | null> {
    const variacoes = variacoesDocumento(cpfCnpj);
    if (variacoes.length === 0) return null;
    const digitos = somenteDigitos(cpfCnpj);

    let ultimoErro: unknown = null;
    let algumaRespondeu = false;

    for (const campo of CAMPOS_DOC_FORNECEDOR) {
      for (const query of variacoes) {
        let res;
        try {
          res = await this.ixc.list<Record<string, unknown>>('fornecedor', {
            qtype: `fornecedor.${campo}`,
            query,
            oper: '=',
            rp: 1,
          });
        } catch (err) {
          // Coluna que esta base não tem: as outras máscaras dela vão falhar
          // igual, então passa para a próxima coluna.
          ultimoErro = err;
          break;
        }
        algumaRespondeu = true;
        const bruto = res.registros[0];
        if (bruto && documentoDoFornecedor(bruto) === digitos) return bruto;
      }
    }

    if (!algumaRespondeu && ultimoErro) throw ultimoErro;
    return null;
  }
}

/** Dígitos do CPF/CNPJ de um fornecedor cru, seja qual for o nome da coluna. */
function documentoDoFornecedor(bruto: Record<string, unknown>): string {
  for (const campo of CAMPOS_DOC_FORNECEDOR) {
    const doc = somenteDigitos(texto(bruto[campo]));
    if (doc) return doc;
  }
  return '';
}
