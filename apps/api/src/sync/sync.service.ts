import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SyncStatus } from '@prisma/client';
import { IxcClient } from '../ixc/ixc.client';
import {
  extrairDadosBancarios,
  mapAdiantamento,
  mapFuncionario,
} from '../ixc/ixc.mappers';
import type { IxcAdiantamento, IxcFuncionario } from '../ixc/ixc.types';
import { PrismaService } from '../prisma/prisma.service';

export interface SyncResult {
  recurso: string;
  totalLidos: number;
  totalNovos: number;
  totalAtualizados: number;
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
  ) {}

  /** Sincroniza funcionários e, em seguida, seus adiantamentos. */
  async syncTudo(): Promise<SyncResult[]> {
    const funcionarios = await this.syncFuncionarios();
    const adiantamentos = await this.syncAdiantamentos();
    return [funcionarios, adiantamentos];
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
        existente ? atualizados++ : novos++;
      }

      // Os dados bancários (banco/agência/conta/PIX) do funcionário costumam
      // estar no fornecedor, não na tabela `funcionarios`. Completa o que faltou.
      await this.enriquecerDadosBancarios();

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
        existente ? atualizados++ : novos++;
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
   * Completa os dados bancários (banco/agência/conta/PIX) dos funcionários a
   * partir do fornecedor no IXC. Para cada funcionário com algum campo bancário
   * vazio e com CPF/CNPJ, busca o fornecedor pelo documento e copia só os
   * campos que estão vazios no local — nunca apaga valor já existente (manual
   * ou de sync anterior). Falha em um funcionário não aborta os demais.
   */
  private async enriquecerDadosBancarios(): Promise<number> {
    const incompletos = await this.prisma.funcionario.findMany({
      where: {
        cpfCnpj: { not: null },
        OR: [
          { banco: null },
          { banco: '' },
          { agencia: null },
          { agencia: '' },
          { conta: null },
          { conta: '' },
          { chavePix: null },
          { chavePix: '' },
        ],
      },
      select: {
        id: true,
        cpfCnpj: true,
        banco: true,
        agencia: true,
        conta: true,
        chavePix: true,
      },
    });

    let preenchidos = 0;
    for (const f of incompletos) {
      const doc = (f.cpfCnpj ?? '').trim();
      if (!doc) continue;
      try {
        const fornecedor = await this.ixc.getById<Record<string, unknown>>(
          'fornecedor',
          'fornecedor.cpf_cnpj',
          doc,
        );
        if (!fornecedor) continue;
        const dados = extrairDadosBancarios(fornecedor);

        const data: Prisma.FuncionarioUpdateInput = {};
        if (vazio(f.banco) && dados.banco) data.banco = dados.banco;
        if (vazio(f.agencia) && dados.agencia) data.agencia = dados.agencia;
        if (vazio(f.conta) && dados.conta) data.conta = dados.conta;
        if (vazio(f.chavePix) && dados.chavePix) data.chavePix = dados.chavePix;
        if (Object.keys(data).length === 0) continue;

        await this.prisma.funcionario.update({ where: { id: f.id }, data });
        preenchidos++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Falha ao buscar dados bancários do fornecedor (CPF/CNPJ ${doc}): ${message}`,
        );
      }
    }

    if (preenchidos > 0) {
      this.logger.log(
        `Dados bancários preenchidos a partir do fornecedor: ${preenchidos} funcionário(s)`,
      );
    }
    return preenchidos;
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

/** true quando a string é nula/vazia (só espaços). */
function vazio(valor: string | null): boolean {
  return !valor || valor.trim() === '';
}
