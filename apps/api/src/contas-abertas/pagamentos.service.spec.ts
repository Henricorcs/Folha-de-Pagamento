import { BadRequestException } from '@nestjs/common';
import {
  buildBaixaContaPagarPayload,
  formatValorBaixaIxc,
} from '../ixc/ixc.financeiro';
import { PagamentosService } from './pagamentos.service';

/**
 * Pagar daqui mexe no financeiro de verdade da empresa. O que este arquivo
 * protege:
 *
 *  - conta já paga não é paga de novo (o erro mais caro desta tela: o dinheiro
 *    sairia duas vezes do caixa);
 *  - conta cancelada ou reprovada na auditoria não passa por cima de quem
 *    decidiu isso;
 *  - o valor vai no formato que o IXC entende — com vírgula. Com ponto ele
 *    grava outro número sem reclamar, e a conta consta paga por valor errado;
 *  - "pelo banco" não dá baixa nenhuma: só aprova. Quem paga é o banco depois.
 */

const CFG = {
  contaPagamentoId: 18,
  contaPagamentoCaixaId: 23,
  contaContabilAvulso: 324,
  filialId: 1,
};

function montarServico(
  opts: {
    titulo?: Record<string, unknown> | null;
    /** Como o título fica quando relido depois da baixa. */
    depoisDaBaixa?: Record<string, unknown>;
    /** O IXC recusa a baixa com esta mensagem. */
    recusaABaixa?: string;
    /** A releitura de conferência também falha. */
    naoDeixaReler?: boolean;
  } = {},
) {
  const titulo =
    'titulo' in opts
      ? opts.titulo
      : {
          id: '4242',
          status: 'A',
          valor: '1500.00',
          valor_aberto: '1500.00',
          id_contas: '18',
          id_conta: '2420',
          filial_id: '1',
          documento: 'NF 123',
        };

  const criados: Array<{ recurso: string; payload: Record<string, unknown> }> = [];
  let leituras = 0;

  const ixc = {
    getById: jest.fn(async () => {
      leituras += 1;
      // A segunda leitura é a conferência de depois da baixa: por padrão o IXC
      // devolve o título já quitado, que é o que acontece quando dá certo.
      if (leituras > 1) {
        if (opts.naoDeixaReler) throw new Error('IXC fora do ar');
        return (
          opts.depoisDaBaixa ?? {
            ...titulo,
            status: 'P',
            valor_aberto: '0',
            valor_total_pago: titulo?.valor_aberto,
            data_pagamento: '15/08/2026',
          }
        );
      }
      return titulo;
    }),
    create: jest.fn(async (recurso: string, payload: Record<string, unknown>) => {
      criados.push({ recurso, payload });
      return { id: 1, raw: {} };
    }),
    // A baixa vai pelo endpoint de botão do IXC, não pelo CRUD.
    action: jest.fn(async (recurso: string, payload: Record<string, unknown>) => {
      criados.push({ recurso, payload });
      if (opts.recusaABaixa) throw new Error(opts.recusaABaixa);
      return {};
    }),
  };

  const config = { obter: jest.fn().mockResolvedValue(CFG) };
  const prisma = {
    contaPagar: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      // De onde sai o nome de quem recebeu, para o histórico da baixa. Sem
      // cadastro daqui o serviço cai no que o título trouxer.
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const service = new PagamentosService(
    ixc as never,
    config as never,
    prisma as never,
  );
  return { service, ixc, criados, prisma };
}

describe('PagamentosService.pagar', () => {
  it('pela conta do ModoBank: só aprova, sem baixa', async () => {
    const { service, criados } = montarServico();

    // 18 é a `contaPagamentoId` da configuração — a conta que o banco paga
    // sozinho, pela tela do IXC.
    const r = await service.pagar(4242, { contaPagamento: 18 }, 'Aurelio');

    expect(r).toMatchObject({
      aprovada: true,
      paga: false,
      aguardandoBanco: true,
      valor: 1500,
    });
    expect(criados.map((c) => c.recurso)).toEqual(['fn_apagar_auditoria']);
  });

  it('por qualquer outra conta: aprova e dá a baixa nela', async () => {
    const { service, criados } = montarServico();

    const r = await service.pagar(
      4242,
      { contaPagamento: CFG.contaPagamentoCaixaId, data: '2026-08-15' },
      'Aurelio',
    );

    expect(criados.map((c) => c.recurso)).toEqual([
      'fn_apagar_auditoria',
      'botao_pagar_26409',
    ]);
    const baixa = criados[1].payload;
    expect(baixa).toMatchObject({
      id_pagar: 4242,
      // O dinheiro sai do caixa configurado, não da conta do banco do título.
      conta_: CFG.contaPagamentoCaixaId,
      id_conta: 2420,
      data: '15/08/2026',
      documento: 'NF 123',
      valor_total_pago: '1500,00',
    });
    expect(r.paga).toBe(true);
  });

  it('título já pago não é pago de novo', async () => {
    const { service, criados } = montarServico({
      titulo: {
        id: '4242',
        status: 'P',
        valor: '1500.00',
        valor_aberto: '0',
        valor_total_pago: '1500.00',
        data_pagamento: '10/08/2026',
      },
    });

    await expect(service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(criados).toHaveLength(0);
  });

  it('título cancelado no IXC não é pago', async () => {
    const { service, criados } = montarServico({
      titulo: { id: '4242', status: 'C', valor: '1500.00', valor_aberto: '1500.00' },
    });

    await expect(service.pagar(4242, { contaPagamento: 18 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(criados).toHaveLength(0);
  });

  it('reprovado na auditoria não é destravado por baixo', async () => {
    const { service, criados } = montarServico({
      titulo: {
        id: '4242',
        status: 'A',
        valor: '1500.00',
        valor_aberto: '1500.00',
        status_auditoria: 'R',
      },
    });

    await expect(service.pagar(4242, { contaPagamento: 18 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(criados).toHaveLength(0);
  });

  it('já aprovado antes não é aprovado de novo', async () => {
    const { service, criados } = montarServico({
      titulo: {
        id: '4242',
        status: 'A',
        valor: '1500.00',
        valor_aberto: '1500.00',
        status_auditoria: 'A',
      },
    });

    const r = await service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId });

    expect(r.aprovada).toBe(true);
    expect(criados.map((c) => c.recurso)).toEqual(['botao_pagar_26409']);
  });

  it('paga o saldo em aberto, não o valor cheio do título', async () => {
    const { service, criados } = montarServico({
      titulo: {
        id: '4242',
        status: 'A',
        valor: '1500.00',
        // Metade já foi paga antes; o que sai agora é o resto.
        valor_aberto: '500.00',
        valor_total_pago: '1000.00',
      },
    });

    const r = await service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId });

    expect(r.valor).toBe(500);
    expect(criados[1].payload).toMatchObject({ valor_total_pago: '500,00' });
  });

  it('avisa quando o IXC aceita a baixa mas o título segue aberto lá', async () => {
    const { service } = montarServico({
      depoisDaBaixa: {
        id: '4242',
        status: 'A',
        valor: '1500.00',
        valor_aberto: '1500.00',
      },
    });

    const r = await service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId });

    expect(r.paga).toBe(false);
    expect(r.avisos.join(' ')).toContain('continua aparecendo como aberto');
  });
});

describe('formatValorBaixaIxc', () => {
  it('usa vírgula decimal e duas casas', () => {
    expect(formatValorBaixaIxc(1500)).toBe('1500,00');
    expect(formatValorBaixaIxc(0.2)).toBe('0,20');
    expect(formatValorBaixaIxc(1234.567)).toBe('1234,57');
  });

  it('não põe separador de milhar', () => {
    // "1.234,56" faria o IXC ler 1,23456 — a conta constaria paga por um real.
    expect(formatValorBaixaIxc(1234.56)).not.toContain('.');
  });
});

describe('buildBaixaContaPagarPayload', () => {
  it('manda as três colunas de valor iguais numa quitação de uma vez', () => {
    const p = buildBaixaContaPagarPayload({
      idFnApagar: 7,
      contaPagamentoId: 23,
      contaContabilId: 2420,
      filialId: 1,
      valor: 340.5,
      data: new Date(Date.UTC(2026, 7, 15)),
      historico: 'Pagamento em mãos',
    });

    expect(p).toMatchObject({
      valor_parcela: '340,50',
      debito: '340,50',
      valor_total_pago: '340,50',
      tipo_pagamento: 'D',
      tipo_lanc: 'P',
      data: '15/08/2026',
    });
  });
});

/**
 * O IXC recusando a baixa que ele mesmo gravou.
 *
 * Aconteceu em produção: HTTP 200, `type: "error"`, sem mensagem — e a conta
 * quitada do outro lado. A tela dizia "0 contas pagas / 1 não saíram", e o
 * passo seguinte natural de quem lê isso é pagar de novo, tirando o dinheiro
 * duas vezes.
 *
 * A regra que este bloco fixa: quem decide se o pagamento saiu não é a resposta
 * da chamada, é o estado do título no IXC depois dela.
 */
describe('PagamentosService.pagar — quando o IXC recusa a baixa', () => {
  const RECUSA = 'IXC (/botao_pagar_26409): recusou sem dizer o motivo (HTTP 200)';

  it('recusou mas quitou: vale como pago, com o aviso para ninguém repetir', async () => {
    const { service } = montarServico({ recusaABaixa: RECUSA });

    const r = await service.pagar(4242, {
      contaPagamento: CFG.contaPagamentoCaixaId,
    });

    expect(r.paga).toBe(true);
    expect(r.valor).toBe(1500);
    expect(r.avisos.join(' ')).toContain('não repita');
  });

  /** Recusou e a conta continua aberta: aí a recusa e recusa mesmo. */
  it('recusou e não quitou: falha, para ninguém dar por pago o que não saiu', async () => {
    const { service } = montarServico({
      recusaABaixa: RECUSA,
      depoisDaBaixa: {
        id: '4242',
        status: 'A',
        valor: '1500.00',
        valor_aberto: '1500.00',
      },
    });

    await expect(
      service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId }),
    ).rejects.toThrow(/recusou sem dizer o motivo/);
  });

  /**
   * Recusou e nem deu para conferir. Sem saber, o unico caminho honesto e
   * parar e mandar olhar o IXC — dizer "pago" seria adivinhar sobre dinheiro,
   * e dizer "não saiu" convidaria a pagar de novo.
   */
  it('recusou e não deu para conferir: manda olhar no IXC antes de repetir', async () => {
    const { service } = montarServico({
      recusaABaixa: RECUSA,
      naoDeixaReler: true,
    });

    await expect(
      service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId }),
    ).rejects.toThrow(/antes de pagar de novo/);
  });

  it('baixa aceita continua sem aviso nenhum', async () => {
    const { service } = montarServico();

    const r = await service.pagar(4242, {
      contaPagamento: CFG.contaPagamentoCaixaId,
    });

    expect(r.paga).toBe(true);
    expect(r.avisos).toEqual([]);
  });
});
