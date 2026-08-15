-- AlterTable
ALTER TABLE "contas_pagar" ADD COLUMN     "recorrente_id" TEXT;

-- CreateTable
CREATE TABLE "despesas_recorrentes" (
    "id" TEXT NOT NULL,
    "id_fornecedor_ixc" INTEGER NOT NULL,
    "fornecedor_nome" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "observacao" TEXT NOT NULL,
    "proximo_vencimento" TIMESTAMP(3) NOT NULL,
    "dias_de_antecedencia" INTEGER NOT NULL DEFAULT 5,
    "conta_contabil" INTEGER,
    "conta_pagamento" INTEGER,
    "tipo_pagamento_ixc" TEXT,
    "categoria_id" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ultima_geracao_em" TIMESTAMP(3),
    "ultimo_erro" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "despesas_recorrentes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "despesas_recorrentes_ativa_proximo_vencimento_idx" ON "despesas_recorrentes"("ativa", "proximo_vencimento");

-- AddForeignKey
ALTER TABLE "despesas_recorrentes" ADD CONSTRAINT "despesas_recorrentes_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_despesa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_recorrente_id_fkey" FOREIGN KEY ("recorrente_id") REFERENCES "despesas_recorrentes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
