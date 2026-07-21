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
    const payload = buildFornecedorPayload(input);
    const { id } = await this.ixc.create('fornecedor', payload);
    if (!id) {
      throw new Error('IXC não retornou o id do fornecedor criado');
    }
    this.logger.log(`Fornecedor criado no IXC: #${id} (${input.nome})`);
    return id;
  }
}
