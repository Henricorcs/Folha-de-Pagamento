-- Diaristas: quem trabalha por dia e recebe por diaria, sem vinculo de folha.
-- O pagamento sai pelo IXC (conta a pagar como qualquer beneficiario) ou em
-- maos, e nesse caso o dinheiro sai do caixa configurado ("CX - Werick").

-- AlterEnum
ALTER TYPE "TipoLancamento" ADD VALUE 'DIARIA';

-- CreateEnum
CREATE TYPE "FormaPagamentoDiaria" AS ENUM ('IXC', 'EM_MAOS');

-- CreateTable
CREATE TABLE "diaristas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf_cnpj" TEXT,
    "telefone" TEXT,
    "chave_pix" TEXT,
    "tipo_chave_pix" TEXT,
    "valor_diaria" DECIMAL(14,2),
    "forma_pagamento" "FormaPagamentoDiaria" NOT NULL DEFAULT 'IXC',
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "id_fornecedor_ixc" INTEGER,
    "cidade_ixc" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diaristas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diaristas_ativo_idx" ON "diaristas"("ativo");
CREATE INDEX "diaristas_nome_idx" ON "diaristas"("nome");

-- CreateTable
CREATE TABLE "diarias" (
    "id" TEXT NOT NULL,
    "diarista_id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "quantidade" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "valor_diaria" DECIMAL(14,2) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "forma" "FormaPagamentoDiaria" NOT NULL,
    "conta_pagar_id" TEXT,
    "caixa_ixc" INTEGER,
    "id_lancamento_ixc" INTEGER,
    "lancado_em" TIMESTAMP(3),
    "lancado_manual" BOOLEAN NOT NULL DEFAULT false,
    "erro_ixc" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diarias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "diarias_conta_pagar_id_key" ON "diarias"("conta_pagar_id");
CREATE INDEX "diarias_diarista_id_idx" ON "diarias"("diarista_id");
CREATE INDEX "diarias_data_idx" ON "diarias"("data");

-- AlterTable: conta a pagar de diarista, e o tipo de pagamento por conta
-- (a diaria em maos vai como Dinheiro, nao como Pix).
ALTER TABLE "contas_pagar" ADD COLUMN "diarista_id" TEXT;
ALTER TABLE "contas_pagar" ADD COLUMN "tipo_pagamento_ixc" TEXT;

-- CreateIndex
CREATE INDEX "contas_pagar_diarista_id_idx" ON "contas_pagar"("diarista_id");

-- AlterTable: conta contabil da diaria e o caixa do pagamento em maos.
ALTER TABLE "config_financeira" ADD COLUMN "conta_contabil_diaria" INTEGER NOT NULL DEFAULT 2420;
ALTER TABLE "config_financeira" ADD COLUMN "caixa_em_maos_id" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "config_financeira" ADD COLUMN "caixa_em_maos_nome" TEXT NOT NULL DEFAULT 'CX - Werick';
ALTER TABLE "config_financeira" ADD COLUMN "caixa_tabela_contas" TEXT NOT NULL DEFAULT '';
ALTER TABLE "config_financeira" ADD COLUMN "caixa_tabela_movimento" TEXT NOT NULL DEFAULT '';

-- AddForeignKey
ALTER TABLE "diarias" ADD CONSTRAINT "diarias_diarista_id_fkey" FOREIGN KEY ("diarista_id") REFERENCES "diaristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "diarias" ADD CONSTRAINT "diarias_conta_pagar_id_fkey" FOREIGN KEY ("conta_pagar_id") REFERENCES "contas_pagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_diarista_id_fkey" FOREIGN KEY ("diarista_id") REFERENCES "diaristas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
