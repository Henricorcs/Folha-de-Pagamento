import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TransferenciasService } from './transferencias.service';

/**
 * O que este arquivo protege:
 *
 *  - a transferência sai como o extrato do caixa lê: crédito na origem (que é
 *    como o IXC escreve saída) e débito no destino. Invertido, o dinheiro anda
 *    ao contrário e ainda assim "fecha" — só quem contar a gaveta descobre;
 *  - as duas linhas se penduram no **razão** da conta, não no id dela. Com o id
 *    errado não há erro nenhum: o dinheiro sai de um lugar que ninguém mexeu;
 *  - falhando a segunda perna, o que já foi escrito não fica calado.
 */

function montarServico(
  opts: {
    contas?: Array<{ id: number; nome: string; razaoId: number | null }>;
    /** Ids que o IXC devolve, na ordem em que as linhas são escritas. */
    idsCriados?: Array<number | null>;
    falhaNaSegunda?: string;
  } = {},
) {
  const contas = opts.contas ?? [
    { id: 7, nome: 'CX - Werick', razaoId: 101 },
    { id: 9, nome: 'CX - Aurélio', razaoId: 102 },
    { id: 18, nome: 'Sicoob', razaoId: 103 },
  ];

  const criados: Array<Record<string, unknown>> = [];
  const ids = [...(opts.idsCriados ?? [5001, 5002])];

  const ixc = {
    create: jest.fn(async (_t: string, body: Record<string, unknown>) => {
      criados.push(body);
      if (opts.falhaNaSegunda && criados.length === 2) {
        throw new Error(opts.falhaNaSegunda);
      }
      return { id: ids.shift() ?? null, raw: {} };
    }),
  };

  const caixa = {
    listarCaixas: jest.fn().mockResolvedValue({ tabela: 'contas', caixas: contas }),
  };

  const config = {
    obter: jest.fn().mockResolvedValue({ caixaTabelaContas: 'contas' }),
  };

  const prisma = {
    user: { findUnique: jest.fn() },
    transferenciaEntreContas: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 't1',
        ...data,
      })),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const service = new TransferenciasService(
    prisma as never,
    ixc as never,
    caixa as never,
    config as never,
  );
  return { service, ixc, prisma, criados };
}

describe('transferência entre contas', () => {
  it('sai como crédito na origem e entra como débito no destino', async () => {
    const { service, criados } = montarServico();

    await service.transferir({
      origemId: 7,
      destinoId: 9,
      valor: 1500,
      data: '2026-08-19',
    });

    expect(criados).toHaveLength(2);
    // Crédito é saída, na convenção que o extrato do caixa já lê.
    expect(criados[0].credito).toBe('1500.00');
    expect(criados[0].debito).toBe('');
    expect(criados[1].debito).toBe('1500.00');
    expect(criados[1].credito).toBe('');
  });

  /*
   * Foi por confundir o id da conta com o do razão que os pagamentos deste app
   * sumiram da conciliação uma vez. Aqui o erro seria pior: as duas linhas
   * nasceriam penduradas noutra conta, sem erro nenhum.
   */
  it('pendura as linhas no razão da conta, e não no id dela', async () => {
    const { service, criados } = montarServico();

    await service.transferir({ origemId: 7, destinoId: 18, valor: 100 });

    expect(criados[0].id_conta).toBe('101');
    expect(criados[1].id_conta).toBe('103');
  });

  it('manda a data no formato do IXC', async () => {
    const { service, criados } = montarServico();

    await service.transferir({
      origemId: 7,
      destinoId: 9,
      valor: 10,
      data: '2026-08-19',
    });

    expect(criados[0].data).toBe('19/08/2026');
  });

  it('o histórico nasce dizendo de onde para onde, quando ninguém escreve um', async () => {
    const { service, criados } = montarServico();

    await service.transferir({
      origemId: 7,
      destinoId: 9,
      valor: 10,
      forma: 'Dinheiro',
    });

    expect(criados[0].historico).toBe(
      'Transferência de CX - Werick para CX - Aurélio (Dinheiro)',
    );
    // As duas linhas contam a mesma história: é o que liga uma à outra no IXC.
    expect(criados[1].historico).toBe(criados[0].historico);
  });

  it('guarda os dois lançamentos do IXC no registro daqui', async () => {
    const { service, prisma } = montarServico();

    await service.transferir({ origemId: 7, destinoId: 9, valor: 1500 });

    const [{ data }] = prisma.transferenciaEntreContas.create.mock.calls[0];
    expect(data.idMovimOrigem).toBe(5001);
    expect(data.idMovimDestino).toBe(5002);
    expect(data.origemNome).toBe('CX - Werick');
    expect(data.destinoNome).toBe('CX - Aurélio');
  });

  it('recusa transferir de uma conta para ela mesma', async () => {
    const { service } = montarServico();

    await expect(
      service.transferir({ origemId: 7, destinoId: 7, valor: 100 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('recusa valor zero', async () => {
    const { service } = montarServico();

    await expect(
      service.transferir({ origemId: 7, destinoId: 9, valor: 0 }),
    ).rejects.toThrow(/maior que zero/i);
  });

  it('conta sem razão no IXC não recebe transferência', async () => {
    const { service, ixc } = montarServico({
      contas: [
        { id: 7, nome: 'CX - Werick', razaoId: 101 },
        { id: 9, nome: 'CX - Aurélio', razaoId: null },
      ],
    });

    await expect(
      service.transferir({ origemId: 7, destinoId: 9, valor: 100 }),
    ).rejects.toThrow(/id_planejamento/);
    // E nada é escrito: melhor não começar do que parar no meio.
    expect(ixc.create).not.toHaveBeenCalled();
  });

  /*
   * O IXC não tem transação para desfazer. Dinheiro que saiu de uma conta e não
   * entrou em nenhuma é a diferença que ninguém acha três meses depois — então
   * o que existe é gravado, e a mensagem diz o número do lançamento solto.
   */
  it('falhando a entrada, registra a metade e diz o que ficou solto', async () => {
    const { service, prisma } = montarServico({
      falhaNaSegunda: 'IXC fora do ar.',
    });

    await expect(
      service.transferir({ origemId: 7, destinoId: 9, valor: 1500 }),
    ).rejects.toThrow(/#5001/);

    const [{ data }] = prisma.transferenciaEntreContas.create.mock.calls[0];
    expect(data.idMovimOrigem).toBe(5001);
    expect(data.idMovimDestino).toBeNull();
  });

  it('IXC que aceita mas não devolve o número é falha, e não silêncio', async () => {
    const { service } = montarServico({ idsCriados: [null] });

    await expect(
      service.transferir({ origemId: 7, destinoId: 9, valor: 100 }),
    ).rejects.toThrow(/não devolveu o número/);
  });
});

describe('a senha que abre a tela', () => {
  it('sessão sem usuário não destrava', async () => {
    const { service } = montarServico();

    await expect(service.destravar(undefined, 'x')).rejects.toThrow(
      /sessão sem usuário/i,
    );
  });

  it('login inativo não destrava', async () => {
    const { service, prisma } = montarServico();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      ativo: false,
      senhaHash: 'x',
    });

    await expect(service.destravar('u1', 'seja-o-que-for')).rejects.toThrow(
      /login inválido/i,
    );
  });

  /*
   * 401 é "sua sessão acabou", e a tela reage a ele deslogando: errar a senha
   * aqui jogava a pessoa para fora do sistema inteiro.
   */
  it('a recusa é 403, para errar a senha não deslogar', async () => {
    const { service, prisma } = montarServico();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      ativo: true,
      email: 'a@b.c',
      senhaHash: '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXY12',
    });

    await expect(service.destravar('u1', 'errada')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('senha errada não destrava', async () => {
    const { service, prisma } = montarServico();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      ativo: true,
      email: 'a@b.c',
      // Hash de outra coisa: o bcrypt real roda, e é ele que recusa.
      senhaHash: '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXY12',
    });

    await expect(service.destravar('u1', 'errada')).rejects.toThrow(
      /senha incorreta/i,
    );
  });
});
