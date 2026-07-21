import { Prisma, TipoPagamento } from '@prisma/client';
import {
  parseIxcBool,
  parseIxcDate,
  parseIxcDecimal,
  parseIxcId,
} from './ixc.parse';
import type { IxcAdiantamento, IxcFuncionario } from './ixc.types';

/** Dados para upsert de Funcionario a partir do registro cru do IXC. */
export function mapFuncionario(raw: IxcFuncionario): {
  ixcId: number;
  create: Prisma.FuncionarioCreateInput;
  update: Prisma.FuncionarioUpdateInput;
} {
  const ixcId = parseIxcId(raw.id);
  if (ixcId === null) {
    throw new Error(`Funcionário do IXC sem id válido: ${JSON.stringify(raw.id)}`);
  }

  const common = {
    nome: (raw.funcionario ?? '').trim() || `Funcionário ${ixcId}`,
    cpfCnpj: emptyToNull(raw.cpf_cnpj),
    email: emptyToNull(raw.email),
    telefone: emptyToNull(raw.fone_celular) ?? emptyToNull(raw.fone),
    salarioBase: new Prisma.Decimal(parseIxcDecimal(raw.salario)),
    filialId: parseIxcId(raw.filial_id),
    idFuncao: parseIxcId(raw.id_funcao),
    idDepartamento: parseIxcId(raw.id_departamento),
    dataAdmissao: parseIxcDate(raw.data_admissao),
    dataDemissao: parseIxcDate(raw.data_demissao),
    ativo: parseIxcBool(raw.ativo),
    banco: emptyToNull(raw.banco),
    agencia: emptyToNull(raw.agencia),
    conta: emptyToNull(raw.conta),
    chavePix: emptyToNull(raw.chave_pix),
    ixcRaw: raw as unknown as Prisma.InputJsonValue,
    ultimoSyncAt: new Date(),
  };

  return {
    ixcId,
    create: { ixcId, ...common },
    update: { ...common },
  };
}

const TIPO_PAGAMENTO_MAP: Record<string, TipoPagamento> = {
  D: TipoPagamento.DINHEIRO,
  C: TipoPagamento.CHEQUE,
  O: TipoPagamento.DEPOSITO,
};

/**
 * Dados para upsert de Adiantamento. Requer o id local do funcionário já
 * resolvido (mapa ixcId -> id local), pois a FK é local.
 */
export function mapAdiantamento(
  raw: IxcAdiantamento,
  funcionarioLocalId: string,
): {
  ixcId: number;
  create: Prisma.AdiantamentoUncheckedCreateInput;
  update: Prisma.AdiantamentoUncheckedUpdateInput;
} {
  const ixcId = parseIxcId(raw.id);
  if (ixcId === null) {
    throw new Error(`Adiantamento do IXC sem id válido: ${JSON.stringify(raw.id)}`);
  }

  const tipo =
    TIPO_PAGAMENTO_MAP[String(raw.tipo_pagamento ?? '').trim().toUpperCase()] ??
    TipoPagamento.OUTRO;

  const common = {
    funcionarioId: funcionarioLocalId,
    descricao: (raw.descricao ?? '').trim() || 'Adiantamento',
    data: parseIxcDate(raw.data) ?? new Date(),
    valor: new Prisma.Decimal(parseIxcDecimal(raw.valor)),
    tipoPagamento: tipo,
    documento: emptyToNull(raw.documento),
    contaId: parseIxcId(raw.conta_) ?? parseIxcId(raw.id_conta),
    ixcRaw: raw as unknown as Prisma.InputJsonValue,
    ultimoSyncAt: new Date(),
  };

  return {
    ixcId,
    create: { ixcId, ...common },
    update: { ...common },
  };
}

function emptyToNull(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s ? s : null;
}
