import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IxcClient } from '../ixc/ixc.client';
import { buildFornecedorPayload } from '../ixc/ixc.financeiro';
import { ConfigFinanceiraService } from './config-financeira.service';

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
  ) {}

  /** Retorna (criando se preciso) o id_fornecedor do funcionário no IXC. */
  async garantirParaFuncionario(funcionarioId: string): Promise<number> {
    const func = await this.prisma.funcionario.findUnique({
      where: { id: funcionarioId },
    });
    if (!func) throw new NotFoundException('Funcionário não encontrado');
    if (func.idFornecedorIxc) return func.idFornecedorIxc;

    const cfg = await this.config.obter();
    const idFornecedor = await this.criarFornecedor({
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

  /** Retorna (criando se preciso) o id_fornecedor do beneficiário avulso. */
  async garantirParaAvulso(beneficiarioId: string): Promise<number> {
    const ben = await this.prisma.beneficiarioAvulso.findUnique({
      where: { id: beneficiarioId },
    });
    if (!ben) throw new NotFoundException('Beneficiário não encontrado');
    if (ben.idFornecedorIxc) return ben.idFornecedorIxc;

    const cfg = await this.config.obter();
    const idFornecedor = await this.criarFornecedor({
      nome: ben.nome,
      cpfCnpj: ben.cpfCnpj,
      tipoPessoa: ben.tipoPessoa,
      cidadeId: ben.cidadeIxc ?? cfg.cidadePadraoId,
      obs: 'Beneficiário avulso — pagamento',
    });

    await this.prisma.beneficiarioAvulso.update({
      where: { id: beneficiarioId },
      data: { idFornecedorIxc: idFornecedor },
    });
    return idFornecedor;
  }

  private async criarFornecedor(input: {
    nome: string;
    cpfCnpj?: string | null;
    tipoPessoa: string;
    cidadeId: number;
    email?: string | null;
    celular?: string | null;
    obs?: string;
  }): Promise<number> {
    // Reutiliza fornecedor existente no IXC (por CPF/CNPJ) antes de criar um
    // novo — fornecedores já cadastrados costumam ter dados bancários/PIX que
    // a tela de contas a pagar do IXC preenche automaticamente.
    const existente = await this.buscarPorCpfCnpj(input.cpfCnpj);
    if (existente) {
      this.logger.log(
        `Fornecedor existente vinculado: #${existente} (${input.nome})`,
      );
      return existente;
    }

    // O cadastro de fornecedor do IXC exige "Classificação de ISS" (e possíveis
    // outros defaults tributários). Como o código válido é específico da base,
    // copia-o de um fornecedor já existente em vez de adivinhar.
    const extrasIss = await this.camposClassificacaoIss();
    const payload = { ...buildFornecedorPayload(input), ...extrasIss };
    const { id } = await this.ixc.create('fornecedor', payload);
    if (!id) {
      throw new Error('IXC não retornou o id do fornecedor criado');
    }
    this.logger.log(`Fornecedor criado no IXC: #${id} (${input.nome})`);
    return id;
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
    const doc = (cpfCnpj ?? '').trim();
    if (!doc) return null;
    try {
      const res = await this.ixc.list<{ id: string }>('fornecedor', {
        qtype: 'fornecedor.cpf_cnpj',
        query: doc,
        oper: '=',
        rp: 1,
      });
      const id = Number(res.registros[0]?.id);
      return Number.isInteger(id) && id > 0 ? id : null;
    } catch (err) {
      // Falha na busca não deve impedir a criação; loga e segue.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Busca de fornecedor por CPF falhou: ${message}`);
      return null;
    }
  }
}
