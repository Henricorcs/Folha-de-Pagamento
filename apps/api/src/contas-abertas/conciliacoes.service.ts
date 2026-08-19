import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrigemConciliacao, StatusConciliacao } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { casar, TOLERANCIA_DIAS, type LinhaParaCasar } from './conciliacao.casar';
import { ExtratoIlegivel, lerOfx } from './conciliacao.ofx';
import {
  ConciliacaoService,
  resumirLinhas,
  type ContaConciliavel,
  type LinhaDaConciliacao,
} from './conciliacao.service';

/**
 * A conciliação como trabalho, e não como marca solta.
 *
 * O modelo é o da tela do IXC: cada conciliação é **uma conta, um período e um
 * status**. Ela abre, alguém liga os dois lados, e num dado momento acaba — e
 * "acabou" é a informação que marcação linha a linha não guarda. Sem ela, quem
 * chega na segunda-feira não tem como saber até onde a semana passada foi
 * conferida.
 *
 * Três coisas moram aqui:
 *
 * - **o extrato**, gravado transação por transação. O arquivo não volta, e sem
 *   guardá-lo o assistente perderia o lado do banco toda vez que alguém saísse
 *   da tela para lançar a despesa que estava faltando;
 * - **as ligações** entre a transação do banco e a linha do IXC, feitas em lote
 *   pelo casamento automático ou uma a uma na mão;
 * - **o fecho**, que só é permitido quando não sobrou pendência de nenhum lado.
 *   É a única regra dura desta tela, e é ela que faz a conciliação valer alguma
 *   coisa: um fecho com pendência é um período que alguém vai dar por conferido
 *   sem ter conferido.
 *
 * O lado do IXC não é guardado: ele é lido na hora, toda vez
 * (`ConciliacaoService.linhasDaConta`). Guardá-lo seria criar uma segunda
 * verdade sobre o dinheiro da empresa, que envelhece sozinha — e a leitura
 * custa menos de três segundos até na conta do PIX, com três mil linhas no mês.
 */

/** Uma conciliação na grade. */
export interface ConciliacaoNaLista {
  id: string;
  numero: number;
  contaIxc: number;
  contaNome: string;
  de: string;
  ate: string;
  status: StatusConciliacao;
  /** Quantas transações do extrato ela tem, e quantas já estão ligadas. */
  transacoes: number;
  ligadas: number;
  extratoArquivo: string | null;
  fechadaEm: string | null;
  fechadaPor: string | null;
  criadaPor: string | null;
  criadaEm: string;
}

/** Uma transação do extrato dentro de uma conciliação. */
export interface TransacaoDaConciliacao {
  id: string;
  fitId: string;
  data: string;
  valor: number;
  descricao: string;
  documento: string | null;
  /** A linha do IXC ligada a ela, quando há. */
  idMovimFinan: number | null;
  casadaAuto: boolean;
  ignorada: boolean;
  motivo: string | null;
}

/** Tudo o que o assistente precisa para trabalhar uma conciliação. */
export interface ConciliacaoAberta {
  conciliacao: {
    id: string;
    numero: number;
    conta: ContaConciliavel;
    de: string;
    ate: string;
    status: StatusConciliacao;
    datasDiferentes: boolean;
    extrato: {
      arquivo: string | null;
      banco: string | null;
      conta: string | null;
      saldo: number | null;
      saldoEm: string | null;
    } | null;
    fechadaEm: string | null;
    fechadaPor: string | null;
  };
  /** A movimentação do IXC, lida agora. */
  linhas: LinhaDaConciliacao[];
  /** O extrato do banco, como foi importado. */
  transacoes: TransacaoDaConciliacao[];
  resumo: {
    /** Do lado do IXC. */
    linhas: number;
    linhasLigadas: number;
    linhasPendentes: number;
    entradas: number;
    saidas: number;
    /** Do lado do banco. */
    transacoes: number;
    transacoesLigadas: number;
    transacoesPendentes: number;
    entradasBanco: number;
    saidasBanco: number;
    /** Nada pendente dos dois lados: dá para encerrar. */
    podeFechar: boolean;
  };
  avisos: string[];
}

@Injectable()
export class ConciliacoesService {
  private readonly logger = new Logger(ConciliacoesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conciliacao: ConciliacaoService,
  ) {}

  /** A grade: as conciliações, da mais nova para a mais velha. */
  async listar(filtro: { conta?: number } = {}): Promise<ConciliacaoNaLista[]> {
    const registros = await this.prisma.conciliacao.findMany({
      where: filtro.conta ? { contaIxc: filtro.conta } : undefined,
      orderBy: { numero: 'desc' },
      take: 300,
      include: {
        _count: { select: { transacoes: true } },
        transacoes: { where: { NOT: { idMovimFinan: null } }, select: { id: true } },
      },
    });

    return registros.map((c) => ({
      id: c.id,
      numero: c.numero,
      contaIxc: c.contaIxc,
      contaNome: c.contaNome,
      de: dia(c.de),
      ate: dia(c.ate),
      status: c.status,
      transacoes: c._count.transacoes,
      ligadas: c.transacoes.length,
      extratoArquivo: c.extratoArquivo,
      fechadaEm: c.fechadaEm?.toISOString() ?? null,
      fechadaPor: c.fechadaPor,
      criadaPor: c.criadaPor,
      criadaEm: c.createdAt.toISOString(),
    }));
  }

  /**
   * Abre uma conciliação nova — o primeiro passo do assistente.
   *
   * O extrato vem junto e é gravado aqui: é o que permite sair da tela e voltar
   * sem ter de importar de novo. Vir sem extrato é permitido — há conta cujo
   * banco não exporta OFX, e ali a conciliação é feita na mão contra a tela do
   * banco.
   */
  async criar(input: {
    conta: number;
    de: string;
    ate: string;
    datasDiferentes?: boolean;
    ofx?: string | null;
    arquivo?: string | null;
    usuario?: string;
  }): Promise<{ id: string; numero: number; transacoes: number }> {
    const conta = (await this.conciliacao.contas()).find(
      (c) => c.id === input.conta,
    );
    if (!conta) {
      throw new BadRequestException(
        `A conta ${input.conta} não existe no IXC, ou não tem conta do razão.`,
      );
    }
    const { de, ate } = periodo(input.de, input.ate);

    /*
     * Duas conciliações abertas para a mesma conta e o mesmo período seriam
     * duas pessoas conferindo o mesmo dinheiro sem saber uma da outra, e a
     * segunda a fechar apagaria o trabalho da primeira da vista de todo mundo.
     * Fechadas podem se repetir: refazer um período conferido é legítimo.
     */
    const jaAberta = await this.prisma.conciliacao.findFirst({
      where: {
        contaIxc: input.conta,
        status: StatusConciliacao.ABERTA,
        de: new Date(`${de}T00:00:00Z`),
        ate: new Date(`${ate}T00:00:00Z`),
      },
      select: { numero: true },
    });
    if (jaAberta) {
      throw new BadRequestException(
        `Já existe a conciliação nº ${jaAberta.numero} aberta para esta conta ` +
          'neste mesmo período. Continue aquela em vez de abrir outra.',
      );
    }

    const extrato = input.ofx?.trim() ? this.lerExtrato(input.ofx) : null;
    if (extrato) {
      const fora = extrato.transacoes.filter(
        (t) => t.data < de || t.data > ate,
      ).length;
      if (fora === extrato.transacoes.length) {
        throw new BadRequestException(
          'Nenhuma transação do extrato cai no período escolhido. Confira as ' +
            `datas: o arquivo cobre de ${extrato.de ?? '?'} a ${extrato.ate ?? '?'}.`,
        );
      }
    }

    const criada = await this.prisma.conciliacao.create({
      data: {
        contaIxc: conta.id,
        contaNome: conta.nome,
        de: new Date(`${de}T00:00:00Z`),
        ate: new Date(`${ate}T00:00:00Z`),
        datasDiferentes: input.datasDiferentes ?? true,
        extratoArquivo: input.arquivo?.slice(0, 200) ?? null,
        extratoBanco: extrato?.banco ?? null,
        extratoConta: extrato?.conta ?? null,
        extratoSaldo: extrato?.saldo ?? null,
        extratoSaldoEm: extrato?.saldoEm
          ? new Date(`${extrato.saldoEm}T00:00:00Z`)
          : null,
        criadaPor: input.usuario ?? null,
        transacoes: extrato
          ? {
              // Só o que cai no período: o extrato do mês inteiro importado
              // numa conciliação de quinzena encheria a tela de pendência que
              // não é desta conciliação.
              create: extrato.transacoes
                .filter((t) => t.data >= de && t.data <= ate)
                .map((t) => ({
                  fitId: t.fitId,
                  data: new Date(`${t.data}T00:00:00Z`),
                  valor: t.valor,
                  descricao: t.descricao,
                  documento: t.documento,
                })),
            }
          : undefined,
      },
      include: { _count: { select: { transacoes: true } } },
    });

    this.logger.log(
      `Conciliação nº ${criada.numero} aberta para a conta ${conta.id} ` +
        `(${conta.nome}), ${de} a ${ate}, com ${criada._count.transacoes} ` +
        'transação(ões) de extrato.',
    );
    return {
      id: criada.id,
      numero: criada.numero,
      transacoes: criada._count.transacoes,
    };
  }

  /** Troca o extrato de uma conciliação aberta — importar de novo, ou o certo. */
  async importarExtrato(
    id: string,
    input: { ofx: string; arquivo?: string | null },
  ): Promise<{ transacoes: number }> {
    const conciliacao = await this.exigirAberta(id);
    const extrato = this.lerExtrato(input.ofx);
    const de = dia(conciliacao.de);
    const ate = dia(conciliacao.ate);

    const doPeriodo = extrato.transacoes.filter(
      (t) => t.data >= de && t.data <= ate,
    );
    if (doPeriodo.length === 0) {
      throw new BadRequestException(
        'Nenhuma transação do arquivo cai no período desta conciliação ' +
          `(${formatarDia(de)} a ${formatarDia(ate)}).`,
      );
    }

    /*
     * O extrato antigo sai inteiro, e com ele as ligações que vieram dele.
     * Reimportar é dizer "o arquivo certo é este outro" — manter ligação de
     * transação que não existe mais no arquivo daria uma conciliação que fecha
     * apoiada em linha que ninguém mais consegue ver.
     */
    await this.prisma.$transaction([
      this.prisma.conciliacaoTransacao.deleteMany({ where: { conciliacaoId: id } }),
      this.prisma.conciliacao.update({
        where: { id },
        data: {
          extratoArquivo: input.arquivo?.slice(0, 200) ?? null,
          extratoBanco: extrato.banco,
          extratoConta: extrato.conta,
          extratoSaldo: extrato.saldo,
          extratoSaldoEm: extrato.saldoEm
            ? new Date(`${extrato.saldoEm}T00:00:00Z`)
            : null,
          transacoes: {
            create: doPeriodo.map((t) => ({
              fitId: t.fitId,
              data: new Date(`${t.data}T00:00:00Z`),
              valor: t.valor,
              descricao: t.descricao,
              documento: t.documento,
            })),
          },
        },
      }),
    ]);

    this.logger.log(
      `Conciliação nº ${conciliacao.numero}: extrato trocado, ` +
        `${doPeriodo.length} transação(ões).`,
    );
    return { transacoes: doPeriodo.length };
  }

  /** O estado completo de uma conciliação, para o assistente desenhar. */
  async abrir(id: string): Promise<ConciliacaoAberta> {
    const registro = await this.prisma.conciliacao.findUnique({
      where: { id },
      include: { transacoes: { orderBy: [{ data: 'asc' }, { valor: 'desc' }] } },
    });
    if (!registro) {
      throw new NotFoundException('Esta conciliação não existe mais.');
    }

    const { conta, linhas, avisos } = await this.conciliacao.linhasDaConta(
      registro.contaIxc,
      dia(registro.de),
      dia(registro.ate),
    );

    // A ligação mora na transação do extrato; a linha do IXC a recebe aqui, do
    // jeito que a tela mostra — de um lado e do outro, o mesmo par.
    const porLinha = new Map(
      registro.transacoes
        .filter((t) => t.idMovimFinan !== null)
        .map((t) => [t.idMovimFinan!, t]),
    );
    for (const linha of linhas) {
      const par = porLinha.get(linha.id);
      if (!par) continue;
      linha.extrato = {
        fitId: par.fitId,
        data: dia(par.data),
        valor: Number(par.valor),
        descricao: par.descricao,
        como: par.casadaAuto ? 'exato' : 'documento',
        diasDeDiferenca: diasEntre(dia(par.data), linha.data),
      };
    }

    const transacoes: TransacaoDaConciliacao[] = registro.transacoes.map((t) => ({
      id: t.id,
      fitId: t.fitId,
      data: dia(t.data),
      valor: Number(t.valor),
      descricao: t.descricao,
      documento: t.documento,
      idMovimFinan: t.idMovimFinan,
      casadaAuto: t.casadaAuto,
      ignorada: t.ignorada,
      motivo: t.motivo,
    }));

    const doIxc = resumirLinhas(linhas);
    const linhasLigadas = linhas.filter((l) => l.extrato !== null).length;
    /*
     * O que ainda pede gente, do lado do IXC: linha sem par no extrato que
     * ninguém conferiu e que o IXC também não conciliou. Linha já conciliada lá
     * não é pendência desta tela — ela foi conferida antes, por outro caminho.
     */
    const linhasPendentes = linhas.filter(
      (l) => !l.extrato && !l.conciliadoNoIxc && !l.conferida,
    ).length;
    const transacoesPendentes = transacoes.filter(
      (t) => t.idMovimFinan === null && !t.ignorada,
    ).length;

    return {
      conciliacao: {
        id: registro.id,
        numero: registro.numero,
        conta,
        de: dia(registro.de),
        ate: dia(registro.ate),
        status: registro.status,
        datasDiferentes: registro.datasDiferentes,
        extrato: registro.extratoArquivo || registro.extratoBanco || transacoes.length
          ? {
              arquivo: registro.extratoArquivo,
              banco: registro.extratoBanco,
              conta: registro.extratoConta,
              saldo: registro.extratoSaldo ? Number(registro.extratoSaldo) : null,
              saldoEm: registro.extratoSaldoEm ? dia(registro.extratoSaldoEm) : null,
            }
          : null,
        fechadaEm: registro.fechadaEm?.toISOString() ?? null,
        fechadaPor: registro.fechadaPor,
      },
      linhas,
      transacoes,
      resumo: {
        linhas: doIxc.linhas,
        linhasLigadas,
        linhasPendentes,
        entradas: doIxc.entradas,
        saidas: doIxc.saidas,
        transacoes: transacoes.length,
        transacoesLigadas: transacoes.filter((t) => t.idMovimFinan !== null).length,
        transacoesPendentes,
        entradasBanco: soma(
          transacoes.filter((t) => t.valor > 0).map((t) => t.valor),
        ),
        saidasBanco: soma(
          transacoes.filter((t) => t.valor < 0).map((t) => -t.valor),
        ),
        podeFechar:
          registro.status === StatusConciliacao.ABERTA &&
          linhasPendentes === 0 &&
          transacoesPendentes === 0,
      },
      avisos,
    };
  }

  /**
   * O botão "Conciliação automática": liga o que bate sozinho.
   *
   * Mesmo valor manda; a data desempata. Só mexe no que ainda está solto dos
   * dois lados — rodar de novo depois de acertos manuais não desfaz nada do que
   * foi feito à mão.
   */
  async casarAutomatico(
    id: string,
    usuario?: string,
  ): Promise<{ ligadas: number; sobraramBanco: number; sobraramIxc: number }> {
    const registro = await this.exigirAberta(id);
    const { linhas } = await this.conciliacao.linhasDaConta(
      registro.contaIxc,
      dia(registro.de),
      dia(registro.ate),
    );

    const transacoes = await this.prisma.conciliacaoTransacao.findMany({
      where: { conciliacaoId: id, idMovimFinan: null, ignorada: false },
    });
    const jaLigadas = new Set(
      (
        await this.prisma.conciliacaoTransacao.findMany({
          where: { conciliacaoId: id, NOT: { idMovimFinan: null } },
          select: { idMovimFinan: true },
        })
      ).map((t) => t.idMovimFinan!),
    );

    const livres: LinhaParaCasar[] = linhas
      .filter((l) => !jaLigadas.has(l.id))
      .map((l) => ({
        id: l.id,
        data: l.data,
        valor: l.valor,
        historico: l.historico,
        documento: l.documento,
      }));

    const resultado = casar(
      livres,
      transacoes.map((t) => ({
        fitId: t.fitId,
        data: dia(t.data),
        valor: Number(t.valor),
        descricao: t.descricao,
        documento: t.documento,
        tipo: null,
      })),
      // "Conciliar em caso de datas diferentes" é a mesma pergunta do IXC:
      // desligado, só casa o que caiu no mesmo dia.
      { toleranciaDias: registro.datasDiferentes ? TOLERANCIA_DIAS : 0 },
    );

    const agora = new Date();
    for (const par of resultado.casados) {
      await this.prisma.conciliacaoTransacao.updateMany({
        where: { conciliacaoId: id, fitId: par.transacao.fitId },
        data: { idMovimFinan: par.linha.id, casadaAuto: true, casadaEm: agora },
      });
      await this.marcarLinha(registro.id, registro.contaIxc, par.linha, usuario);
    }

    this.logger.log(
      `Conciliação nº ${registro.numero}: ${resultado.casados.length} ligação(ões) ` +
        `automáticas, sobraram ${resultado.soNoBanco.length} do banco e ` +
        `${resultado.soNoIxc.length} do IXC.`,
    );
    return {
      ligadas: resultado.casados.length,
      sobraramBanco: resultado.soNoBanco.length,
      sobraramIxc: resultado.soNoIxc.length,
    };
  }

  /** Liga uma transação do banco a uma linha do IXC, na mão. */
  async ligar(
    id: string,
    input: { fitId: string; idMovimFinan: number },
    usuario?: string,
  ): Promise<{ ligadas: number }> {
    const registro = await this.exigirAberta(id);

    const ocupada = await this.prisma.conciliacaoTransacao.findFirst({
      where: {
        conciliacaoId: id,
        idMovimFinan: input.idMovimFinan,
        NOT: { fitId: input.fitId },
      },
      select: { fitId: true, data: true, valor: true },
    });
    if (ocupada) {
      throw new BadRequestException(
        `Esta linha do IXC já está ligada à transação de ${formatarDia(dia(ocupada.data))} ` +
          `no valor de ${Number(ocupada.valor).toFixed(2)}. Desfaça aquela ligação primeiro.`,
      );
    }

    const { linhas } = await this.conciliacao.linhasDaConta(
      registro.contaIxc,
      dia(registro.de),
      dia(registro.ate),
    );
    const linha = linhas.find((l) => l.id === input.idMovimFinan);
    if (!linha) {
      throw new BadRequestException(
        'Esta linha não está na movimentação do IXC deste período.',
      );
    }

    const { count } = await this.prisma.conciliacaoTransacao.updateMany({
      where: { conciliacaoId: id, fitId: input.fitId },
      data: {
        idMovimFinan: input.idMovimFinan,
        casadaAuto: false,
        casadaEm: new Date(),
        ignorada: false,
      },
    });
    if (count === 0) {
      throw new BadRequestException('Esta transação não está nesta conciliação.');
    }
    await this.marcarLinha(registro.id, registro.contaIxc, linha, usuario);
    return { ligadas: count };
  }

  /** Desfaz a ligação de uma transação — e a conferência que veio com ela. */
  async desligar(id: string, fitId: string): Promise<{ desligadas: number }> {
    await this.exigirAberta(id);
    const transacao = await this.prisma.conciliacaoTransacao.findFirst({
      where: { conciliacaoId: id, fitId },
    });
    if (!transacao) {
      throw new BadRequestException('Esta transação não está nesta conciliação.');
    }

    await this.prisma.conciliacaoTransacao.update({
      where: { id: transacao.id },
      data: { idMovimFinan: null, casadaAuto: false, casadaEm: null },
    });
    /*
     * A conferência da linha do IXC sai junto — mas só a que esta conciliação
     * criou. Marca de outra conciliação, ou solta, continua de pé: ela não é
     * consequência desta ligação.
     */
    if (transacao.idMovimFinan !== null) {
      await this.prisma.conciliacaoLinha.deleteMany({
        where: { idMovimFinan: transacao.idMovimFinan, conciliacaoId: id },
      });
    }
    return { desligadas: 1 };
  }

  /**
   * Tira uma transação do banco da conta das pendências, com o motivo escrito.
   *
   * Existe porque nem tudo que passa na conta é do contas a pagar: tarifa que a
   * contabilidade lança por fora, estorno de cliente, transferência entre
   * contas da casa. Sem isto a conciliação nunca fecharia — e o caminho fácil
   * de "fechar assim mesmo" é o que transforma conferência em carimbo.
   */
  async ignorar(
    id: string,
    fitId: string,
    motivo: string,
  ): Promise<{ ignoradas: number }> {
    await this.exigirAberta(id);
    const { count } = await this.prisma.conciliacaoTransacao.updateMany({
      where: { conciliacaoId: id, fitId, idMovimFinan: null },
      data: { ignorada: true, motivo: motivo.trim().slice(0, 300) || null },
    });
    if (count === 0) {
      throw new BadRequestException(
        'Esta transação não está nesta conciliação, ou já está ligada a um lançamento.',
      );
    }
    return { ignoradas: count };
  }

  /** Volta atrás: a transação ignorada conta como pendência de novo. */
  async desistirDeIgnorar(id: string, fitId: string): Promise<{ ok: true }> {
    await this.exigirAberta(id);
    await this.prisma.conciliacaoTransacao.updateMany({
      where: { conciliacaoId: id, fitId },
      data: { ignorada: false, motivo: null },
    });
    return { ok: true };
  }

  /**
   * Dá por conferida uma linha do IXC que o extrato não tem.
   *
   * O caso legítimo é a linha que o banco não mostra porque não é dele —
   * transferência interna, lançamento de provisão que caiu na conta. Quem marca
   * está dizendo "olhei e está certa", e é isso que a tela guarda.
   */
  async conferirLinhas(
    id: string,
    ids: number[],
    usuario?: string,
  ): Promise<{ conferidas: number }> {
    const registro = await this.exigirAberta(id);
    const { linhas } = await this.conciliacao.linhasDaConta(
      registro.contaIxc,
      dia(registro.de),
      dia(registro.ate),
    );
    const porId = new Map(linhas.map((l) => [l.id, l]));

    let conferidas = 0;
    for (const idLinha of ids) {
      const linha = porId.get(idLinha);
      if (!linha) continue;
      await this.marcarLinha(registro.id, registro.contaIxc, linha, usuario, true);
      conferidas += 1;
    }
    return { conferidas };
  }

  /** Desfaz a conferência de uma linha, quando ela foi feita nesta conciliação. */
  async desconferirLinhas(id: string, ids: number[]): Promise<{ desfeitas: number }> {
    await this.exigirAberta(id);
    const { count } = await this.prisma.conciliacaoLinha.deleteMany({
      where: { conciliacaoId: id, idMovimFinan: { in: ids } },
    });
    return { desfeitas: count };
  }

  /**
   * Encerra a conciliação.
   *
   * Só com tudo ligado ou explicado dos dois lados. É a regra que dá sentido ao
   * resto: um fecho com pendência é um período dado por conferido sem ter sido,
   * e ninguém depois consegue distinguir um do outro.
   */
  async fechar(id: string, usuario?: string): Promise<ConciliacaoNaLista> {
    const aberta = await this.abrir(id);
    if (aberta.conciliacao.status === StatusConciliacao.FECHADA) {
      throw new BadRequestException('Esta conciliação já está fechada.');
    }
    if (!aberta.resumo.podeFechar) {
      throw new BadRequestException(
        `Ainda falta resolver: ${aberta.resumo.transacoesPendentes} transação(ões) ` +
          `do banco sem lançamento e ${aberta.resumo.linhasPendentes} linha(s) do ` +
          'IXC sem par no extrato. Ligue, lance ou explique cada uma antes de encerrar.',
      );
    }

    await this.prisma.conciliacao.update({
      where: { id },
      data: {
        status: StatusConciliacao.FECHADA,
        fechadaEm: new Date(),
        fechadaPor: usuario ?? null,
        // Congelados: recalcular depois daria outro número, porque o IXC
        // continua andando.
        totalEntradas: aberta.resumo.entradas,
        totalSaidas: aberta.resumo.saidas,
        totalLinhas: aberta.resumo.linhas,
      },
    });

    this.logger.log(
      `Conciliação nº ${aberta.conciliacao.numero} fechada por ${usuario ?? 'alguém'}: ` +
        `${aberta.resumo.linhas} linha(s), ${aberta.resumo.transacoes} transação(ões).`,
    );
    const [naLista] = await this.listar();
    return naLista;
  }

  /** Reabre uma conciliação fechada — achou-se algo depois. */
  async reabrir(id: string): Promise<{ ok: true }> {
    const registro = await this.prisma.conciliacao.findUnique({ where: { id } });
    if (!registro) throw new NotFoundException('Esta conciliação não existe mais.');
    if (registro.status === StatusConciliacao.ABERTA) {
      throw new BadRequestException('Esta conciliação já está aberta.');
    }
    await this.prisma.conciliacao.update({
      where: { id },
      data: { status: StatusConciliacao.ABERTA, fechadaEm: null, fechadaPor: null },
    });
    this.logger.log(`Conciliação nº ${registro.numero} reaberta.`);
    return { ok: true };
  }

  /**
   * Apaga uma conciliação aberta.
   *
   * As conferências que ela criou vão junto — elas eram dela. Fechada não se
   * apaga: é registro de um período dado por conferido, e apagá-lo sumiria com
   * a única prova de que alguém olhou aquilo.
   */
  async apagar(id: string): Promise<{ ok: true }> {
    const registro = await this.prisma.conciliacao.findUnique({ where: { id } });
    if (!registro) throw new NotFoundException('Esta conciliação não existe mais.');
    if (registro.status === StatusConciliacao.FECHADA) {
      throw new BadRequestException(
        `A conciliação nº ${registro.numero} está fechada. Reabra antes, se for ` +
          'mesmo para apagar.',
      );
    }
    await this.prisma.conciliacaoLinha.deleteMany({ where: { conciliacaoId: id } });
    await this.prisma.conciliacao.delete({ where: { id } });
    this.logger.log(`Conciliação nº ${registro.numero} apagada.`);
    return { ok: true };
  }

  // -------------------------------------------------------------------------

  /**
   * Registra que a linha do IXC foi conferida por esta conciliação.
   *
   * Pede só o que usa — id, dia e valor —, porque a linha chega de dois lugares
   * diferentes: da leitura da tela e do resultado do casamento.
   */
  private async marcarLinha(
    conciliacaoId: string,
    contaIxc: number,
    linha: { id: number; data: string; valor: number },
    usuario?: string,
    naMao = false,
  ): Promise<void> {
    const dados = {
      contaIxc,
      data: new Date(`${linha.data}T00:00:00Z`),
      valor: linha.valor,
      origem: naMao ? OrigemConciliacao.MANUAL : OrigemConciliacao.EXTRATO,
      conferidoPor: usuario ?? null,
      conciliacaoId,
    };
    await this.prisma.conciliacaoLinha.upsert({
      where: { idMovimFinan: linha.id },
      update: dados,
      create: { idMovimFinan: linha.id, ...dados },
    });
  }

  private lerExtrato(ofx: string) {
    try {
      return lerOfx(ofx);
    } catch (err) {
      if (err instanceof ExtratoIlegivel) throw new BadRequestException(err.message);
      throw err;
    }
  }

  private async exigirAberta(id: string) {
    const registro = await this.prisma.conciliacao.findUnique({ where: { id } });
    if (!registro) throw new NotFoundException('Esta conciliação não existe mais.');
    if (registro.status === StatusConciliacao.FECHADA) {
      throw new BadRequestException(
        `A conciliação nº ${registro.numero} está fechada. Reabra para mexer nela.`,
      );
    }
    return registro;
  }
}

/** Data do banco em "AAAA-MM-DD", sem passar pelo fuso local. */
function dia(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function formatarDia(iso: string): string {
  const [ano, mes, d] = iso.split('-');
  return `${d}/${mes}/${ano}`;
}

function diasEntre(a: string, b: string): number {
  const umDia = 24 * 60 * 60 * 1000;
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / umDia,
  );
}

function soma(valores: number[]): number {
  return Math.round(valores.reduce((s, v) => s + v, 0) * 100) / 100;
}

/** Período aceitável: datas legíveis, na ordem certa, de no máximo um ano. */
function periodo(de: string, ate: string): { de: string; ate: string } {
  const inicio = (de ?? '').slice(0, 10);
  const fim = (ate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    throw new BadRequestException('As datas do período precisam ser AAAA-MM-DD.');
  }
  if (inicio > fim) {
    throw new BadRequestException('O período começa depois de terminar.');
  }
  const dias =
    (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) /
    (24 * 60 * 60 * 1000);
  if (dias > 366) {
    throw new BadRequestException('O período não pode passar de um ano.');
  }
  return { de: inicio, ate: fim };
}
