import { Injectable } from '@nestjs/common';
import { ConfiguracaoFinanceira } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateConfigFinanceiraDto } from './dto/update-config.dto';

/** Acesso à parametrização financeira (registro único id=1). */
@Injectable()
export class ConfigFinanceiraService {
  constructor(private readonly prisma: PrismaService) {}

  /** Retorna a config, criando com os padrões se ainda não existir. */
  async obter(): Promise<ConfiguracaoFinanceira> {
    const existente = await this.prisma.configuracaoFinanceira.findUnique({
      where: { id: 1 },
    });
    if (existente) return existente;
    return this.prisma.configuracaoFinanceira.create({ data: { id: 1 } });
  }

  async atualizar(
    dto: UpdateConfigFinanceiraDto,
  ): Promise<ConfiguracaoFinanceira> {
    await this.obter(); // garante existência
    return this.prisma.configuracaoFinanceira.update({
      where: { id: 1 },
      data: dto,
    });
  }
}
