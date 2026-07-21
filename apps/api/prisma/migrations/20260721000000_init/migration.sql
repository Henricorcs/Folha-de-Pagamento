-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'RH', 'VISUALIZADOR');

-- CreateEnum
CREATE TYPE "TipoPagamento" AS ENUM ('DINHEIRO', 'CHEQUE', 'DEPOSITO', 'OUTRO');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('EM_ANDAMENTO', 'SUCESSO', 'ERRO');

-- CreateEnum
CREATE TYPE "TipoLancamento" AS ENUM ('SALARIO', 'ADIANTAMENTO', 'BONUS', 'DESCONTO', 'AVULSO');

-- CreateEnum
CREATE TYPE "StatusContaPagar" AS ENUM ('RASCUNHO', 'AGUARDANDO_APROVACAO', 'APROVADO', 'REPROVADO', 'AGUARDANDO_PAGAMENTO', 'PAGO', 'CANCELADO', 'ERRO');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'RH',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funcionarios" (
    "id" TEXT NOT NULL,
    "ixc_id" INTEGER,
    "nome" TEXT NOT NULL,
    "cpf_cnpj" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "salario_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "filial_id" INTEGER,
    "id_funcao" INTEGER,
    "id_departamento" INTEGER,
    "funcao" TEXT,
    "departamento" TEXT,
    "data_admissao" TIMESTAMP(3),
    "data_demissao" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "banco" TEXT,
    "agencia" TEXT,
    "conta" TEXT,
    "chave_pix" TEXT,
    "observacoes" TEXT,
    "carteira_assinada" BOOLEAN NOT NULL DEFAULT false,
    "recebe_adiantamento" BOOLEAN NOT NULL DEFAULT false,
    "id_fornecedor_ixc" INTEGER,
    "cidade_ixc" INTEGER,
    "ixc_raw" JSONB,
    "ultimo_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funcionarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adiantamentos" (
    "id" TEXT NOT NULL,
    "ixc_id" INTEGER,
    "funcionario_id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "tipo_pagamento" "TipoPagamento" NOT NULL DEFAULT 'OUTRO',
    "documento" TEXT,
    "conta_id" INTEGER,
    "ixc_raw" JSONB,
    "ultimo_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adiantamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "total_lidos" INTEGER NOT NULL DEFAULT 0,
    "total_novos" INTEGER NOT NULL DEFAULT 0,
    "total_atualizados" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "iniciado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluido_em" TIMESTAMP(3),

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_financeira" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "conta_pagamento_id" INTEGER NOT NULL DEFAULT 18,
    "filial_id" INTEGER NOT NULL DEFAULT 1,
    "conta_contabil_salario" INTEGER NOT NULL DEFAULT 2420,
    "conta_contabil_adiantamento" INTEGER NOT NULL DEFAULT 2662,
    "conta_contabil_bonus" INTEGER NOT NULL DEFAULT 13916,
    "cidade_padrao_id" INTEGER NOT NULL DEFAULT 1,
    "obs_salario_template" TEXT NOT NULL DEFAULT 'saldo salarial referente ao mês {competencia}',
    "obs_adiantamento_template" TEXT NOT NULL DEFAULT 'adiantamento',
    "obs_bonus_template" TEXT NOT NULL DEFAULT 'bônus referente ao mês {competencia}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_financeira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamentos_fixos" (
    "id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    "tipo" "TipoLancamento" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lancamentos_fixos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiarios_avulsos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf_cnpj" TEXT,
    "tipo_pessoa" TEXT NOT NULL DEFAULT 'F',
    "chave_pix" TEXT,
    "id_fornecedor_ixc" INTEGER,
    "cidade_ixc" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beneficiarios_avulsos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_pagar" (
    "id" TEXT NOT NULL,
    "competencia" TEXT,
    "tipo" "TipoLancamento" NOT NULL,
    "funcionario_id" TEXT,
    "beneficiario_avulso_id" TEXT,
    "beneficiario_nome" TEXT NOT NULL,
    "id_fornecedor_ixc" INTEGER,
    "valor" DECIMAL(14,2) NOT NULL,
    "conta_contabil" INTEGER NOT NULL,
    "conta_pagamento" INTEGER NOT NULL,
    "filial_id" INTEGER NOT NULL,
    "data_emissao" TIMESTAMP(3) NOT NULL,
    "data_vencimento" TIMESTAMP(3) NOT NULL,
    "observacao" TEXT NOT NULL,
    "status" "StatusContaPagar" NOT NULL DEFAULT 'RASCUNHO',
    "erro" TEXT,
    "id_fn_apagar_ixc" INTEGER,
    "ixc_status_raw" JSONB,
    "aprovado_por" TEXT,
    "aprovado_em" TIMESTAMP(3),
    "motivo_auditoria" TEXT,
    "pago_em" TIMESTAMP(3),
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_pagar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "funcionarios_ixc_id_key" ON "funcionarios"("ixc_id");

-- CreateIndex
CREATE INDEX "funcionarios_ativo_idx" ON "funcionarios"("ativo");

-- CreateIndex
CREATE INDEX "funcionarios_nome_idx" ON "funcionarios"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "adiantamentos_ixc_id_key" ON "adiantamentos"("ixc_id");

-- CreateIndex
CREATE INDEX "adiantamentos_funcionario_id_idx" ON "adiantamentos"("funcionario_id");

-- CreateIndex
CREATE INDEX "adiantamentos_data_idx" ON "adiantamentos"("data");

-- CreateIndex
CREATE INDEX "sync_logs_recurso_iniciado_em_idx" ON "sync_logs"("recurso", "iniciado_em");

-- CreateIndex
CREATE INDEX "lancamentos_fixos_funcionario_id_tipo_idx" ON "lancamentos_fixos"("funcionario_id", "tipo");

-- CreateIndex
CREATE INDEX "contas_pagar_status_idx" ON "contas_pagar"("status");

-- CreateIndex
CREATE INDEX "contas_pagar_competencia_idx" ON "contas_pagar"("competencia");

-- CreateIndex
CREATE INDEX "contas_pagar_funcionario_id_idx" ON "contas_pagar"("funcionario_id");

-- CreateIndex
CREATE INDEX "contas_pagar_id_fn_apagar_ixc_idx" ON "contas_pagar"("id_fn_apagar_ixc");

-- AddForeignKey
ALTER TABLE "adiantamentos" ADD CONSTRAINT "adiantamentos_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_fixos" ADD CONSTRAINT "lancamentos_fixos_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_beneficiario_avulso_id_fkey" FOREIGN KEY ("beneficiario_avulso_id") REFERENCES "beneficiarios_avulsos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

