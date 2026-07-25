import { TipoPagamento } from '@prisma/client';
import {
  extrairChavePix,
  extrairDadosBancarios,
  mapAdiantamento,
  mapFuncionario,
} from './ixc.mappers';
import type { IxcAdiantamento, IxcFuncionario } from './ixc.types';

describe('mapFuncionario', () => {
  it('mapeia campos essenciais do IXC', () => {
    const raw: IxcFuncionario = {
      id: '16',
      funcionario: 'HENRICO',
      cpf_cnpj: '123.456.789-00',
      salario: '1412.00',
      ativo: 'S',
      fone_celular: '75999998888',
      chave_pix: 'henrico@pix',
      data_admissao: '2023-01-10',
      filial_id: '1',
    };
    const { ixcId, create } = mapFuncionario(raw);
    expect(ixcId).toBe(16);
    expect(create.nome).toBe('HENRICO');
    expect(create.ativo).toBe(true);
    expect(Number(create.salarioBase)).toBe(1412);
    expect(create.telefone).toBe('75999998888');
    expect(create.chavePix).toBe('henrico@pix');
    expect((create.dataAdmissao as Date).toISOString()).toBe(
      '2023-01-10T00:00:00.000Z',
    );
  });

  it('usa nome padrão quando vazio e trata inativo', () => {
    const { create } = mapFuncionario({ id: '5', funcionario: '  ', ativo: 'N' });
    expect(create.nome).toBe('Funcionário 5');
    expect(create.ativo).toBe(false);
  });

  it('lança erro se id inválido', () => {
    expect(() => mapFuncionario({ id: '0', funcionario: 'X' })).toThrow();
  });

  it('no update, não sobrescreve dados bancários quando o IXC não informa', () => {
    const { create, update } = mapFuncionario({ id: '7', funcionario: 'X' });
    // Sem dados no IXC: create fixa null, mas update não toca nesses campos.
    expect(create.chavePix).toBeNull();
    expect(create.banco).toBeNull();
    expect(create.agencia).toBeNull();
    expect(create.conta).toBeNull();
    expect('chavePix' in update).toBe(false);
    expect('banco' in update).toBe(false);
    expect('agencia' in update).toBe(false);
    expect('conta' in update).toBe(false);
  });

  it('no update, sobrescreve dados bancários que o IXC informa', () => {
    const { update } = mapFuncionario({
      id: '7',
      funcionario: 'X',
      chave_pix: 'x@pix',
      banco: '001',
      agencia: '1234',
      conta: '',
    });
    expect(update.chavePix).toBe('x@pix');
    expect(update.banco).toBe('001');
    expect(update.agencia).toBe('1234');
    // conta vazia: preserva o valor local (não entra no update).
    expect('conta' in update).toBe(false);
  });
});

describe('extrairChavePix', () => {
  it('lê o campo chave_pix', () => {
    expect(extrairChavePix({ chave_pix: 'ana@pix' })).toBe('ana@pix');
  });

  it('acha qualquer campo com "pix" no nome', () => {
    expect(extrairChavePix({ pix_chave: '  123  ' })).toBe('123');
  });

  it('retorna null quando não há PIX', () => {
    expect(extrairChavePix({ chave_pix: '', razao: 'ACME' })).toBeNull();
  });
});

describe('extrairDadosBancarios', () => {
  it('extrai banco/agência/conta/PIX preenchidos', () => {
    expect(
      extrairDadosBancarios({
        banco: '001',
        agencia: '1234',
        conta: '56789-0',
        chave_pix: 'joao@pix',
      }),
    ).toEqual({
      banco: '001',
      agencia: '1234',
      conta: '56789-0',
      chavePix: 'joao@pix',
    });
  });

  it('vazios viram null', () => {
    expect(extrairDadosBancarios({ banco: '  ', razao: 'ACME' })).toEqual({
      banco: null,
      agencia: null,
      conta: null,
      chavePix: null,
    });
  });
});

describe('mapAdiantamento', () => {
  it('mapeia e resolve tipo de pagamento', () => {
    const raw: IxcAdiantamento = {
      id: '99',
      id_funcionario: '2',
      descricao: 'Contas pendentes',
      data: '21/06/2024',
      tipo_pagamento: 'D',
      valor: '200',
      conta_: '1',
    };
    const { ixcId, create } = mapAdiantamento(raw, 'local-uuid-2');
    expect(ixcId).toBe(99);
    expect(create.funcionarioId).toBe('local-uuid-2');
    expect(create.tipoPagamento).toBe(TipoPagamento.DINHEIRO);
    expect(Number(create.valor)).toBe(200);
    expect((create.data as Date).toISOString()).toBe('2024-06-21T00:00:00.000Z');
  });

  it('tipo desconhecido vira OUTRO', () => {
    const { create } = mapAdiantamento(
      { id: '1', id_funcionario: '1', valor: '10', tipo_pagamento: 'X' },
      'x',
    );
    expect(create.tipoPagamento).toBe(TipoPagamento.OUTRO);
  });
});
