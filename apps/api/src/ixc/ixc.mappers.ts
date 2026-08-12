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

  const bancarios = extrairDadosBancarios(raw);
  const salario = parseIxcDecimal(raw.salario);

  const ativoNoIxc = parseIxcBool(raw.ativo);

  const common = {
    nome: (raw.funcionario ?? '').trim() || `Funcionário ${ixcId}`,
    cpfCnpj: emptyToNull(raw.cpf_cnpj),
    email: emptyToNull(raw.email),
    telefone: emptyToNull(raw.fone_celular) ?? emptyToNull(raw.fone),
    filialId: parseIxcId(raw.filial_id),
    idFuncao: parseIxcId(raw.id_funcao),
    idDepartamento: parseIxcId(raw.id_departamento),
    dataAdmissao: parseIxcDate(raw.data_admissao),
    dataDemissao: parseIxcDate(raw.data_demissao),
    ixcRaw: raw as unknown as Prisma.InputJsonValue,
    ultimoSyncAt: new Date(),
  };

  // Desativar aqui tira a pessoa das próximas folhas, e é o que se faz quando
  // alguém pede para sair. O cadastro no IXC costuma continuar ativo por
  // semanas depois disso — reler `ativo` de lá ressuscitava a pessoa na folha
  // seguinte. O sync só desativa: reativar é decisão de quem desativou.
  const ativoUpdate = ativoNoIxc ? {} : { ativo: false };

  // Dados bancários (banco/agência/conta/PIX) da tabela `funcionarios` do IXC
  // costumam vir vazios — o real fica no fornecedor. No update só sobrescreve
  // o campo que o IXC informou; senão preserva o valor local (vindo do
  // fornecedor ou digitado à mão), que antes era zerado a cada sync. Ver
  // [[project]].
  const bancariosUpdate = {
    ...(bancarios.banco ? { banco: bancarios.banco } : {}),
    ...(bancarios.agencia ? { agencia: bancarios.agencia } : {}),
    ...(bancarios.conta ? { conta: bancarios.conta } : {}),
    ...(bancarios.chavePix ? { chavePix: bancarios.chavePix } : {}),
  };

  // Mesma história do salário: muito funcionário está no IXC com o campo
  // `salario` em branco (quem é CLT recebe pela contabilidade, quem entrou
  // pelo fornecedor nunca teve esse campo). Zerar no update apagava o valor
  // digitado aqui a cada sincronização — só sobrescreve quando o IXC informa.
  const salarioUpdate =
    salario > 0 ? { salarioBase: new Prisma.Decimal(salario) } : {};

  return {
    ixcId,
    create: {
      ixcId,
      ...common,
      ativo: ativoNoIxc,
      salarioBase: new Prisma.Decimal(salario),
      ...bancarios,
    },
    update: { ...common, ...ativoUpdate, ...salarioUpdate, ...bancariosUpdate },
  };
}

export interface DadosBancariosIxc {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
}

/** Extrai banco/agência/conta/PIX de um registro cru (funcionário/fornecedor). */
export function extrairDadosBancarios(
  raw: Record<string, unknown>,
): DadosBancariosIxc {
  return {
    banco: emptyToNull(raw.banco),
    agencia: emptyToNull(raw.agencia),
    conta: emptyToNull(raw.conta),
    chavePix: extrairChavePix(raw),
  };
}

/**
 * Extrai a chave PIX de um registro cru do IXC (fornecedor/funcionário).
 * O IXC costuma usar o campo `chave_pix`, mas por robustez procura qualquer
 * campo cujo nome contenha "pix" com valor preenchido.
 */
export function extrairChavePix(raw: Record<string, unknown>): string | null {
  const direto = emptyToNull(raw.chave_pix);
  if (direto) return direto;
  for (const [chave, valor] of Object.entries(raw)) {
    if (/pix/i.test(chave)) {
      const s = emptyToNull(valor);
      if (s) return s;
    }
  }
  return null;
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
