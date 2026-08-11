-- Pagamento avulso vira um cadastro de gente, como o de diarista, em vez de um
-- formulario que digita tudo de novo a cada servico contratado. O caminho do
-- dinheiro e o mesmo dos dois: conta a pagar no IXC ou dinheiro em maos saindo
-- do caixa -- dai o enum deixar de ser "da diaria" e passar a se chamar so
-- FormaPagamento. Renomear preserva os valores ja gravados nas diarias.

-- AlterEnum (renomeia o tipo; as colunas que o usam seguem valendo)
ALTER TYPE "FormaPagamentoDiaria" RENAME TO "FormaPagamento";

-- AlterTable: o beneficiario avulso ganha o que faltava para o pagamento sair
-- sem erro no IXC. O tipo da chave e o mais importante: sem ele o radio do
-- fn_apagar fica em branco e o banco recusa o PIX.
ALTER TABLE "beneficiarios_avulsos"
  ADD COLUMN "telefone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "tipo_chave_pix" TEXT,
  ADD COLUMN "forma_pagamento" "FormaPagamento" NOT NULL DEFAULT 'IXC',
  ADD COLUMN "observacoes" TEXT,
  ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "fornecedor_novo_no_ixc" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "beneficiarios_avulsos_ativo_idx" ON "beneficiarios_avulsos"("ativo");
CREATE INDEX "beneficiarios_avulsos_nome_idx" ON "beneficiarios_avulsos"("nome");

-- AlterTable: conta contabil dos avulsos, informada pelo usuario (324).
ALTER TABLE "config_financeira"
  ADD COLUMN "conta_contabil_avulso" INTEGER NOT NULL DEFAULT 324;

-- CreateTable: o historico de pagamentos avulsos, espelhando `diarias`.
CREATE TABLE "pagamentos_avulsos" (
    "id" TEXT NOT NULL,
    "beneficiario_id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "conta_contabil" INTEGER NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "conta_pagar_id" TEXT,
    "caixa_ixc" INTEGER,
    "id_lancamento_ixc" INTEGER,
    "lancado_em" TIMESTAMP(3),
    "lancado_manual" BOOLEAN NOT NULL DEFAULT false,
    "erro_ixc" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagamentos_avulsos_pkey" PRIMARY KEY ("id")
);

-- Uma conta a pagar pertence a no maximo um pagamento avulso.
CREATE UNIQUE INDEX "pagamentos_avulsos_conta_pagar_id_key" ON "pagamentos_avulsos"("conta_pagar_id");
CREATE INDEX "pagamentos_avulsos_beneficiario_id_idx" ON "pagamentos_avulsos"("beneficiario_id");
CREATE INDEX "pagamentos_avulsos_data_idx" ON "pagamentos_avulsos"("data");

-- AddForeignKey
ALTER TABLE "pagamentos_avulsos" ADD CONSTRAINT "pagamentos_avulsos_beneficiario_id_fkey" FOREIGN KEY ("beneficiario_id") REFERENCES "beneficiarios_avulsos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Apagar a conta a pagar nao apaga o registro do pagamento: o servico foi
-- feito de qualquer jeito, e sumir com ele esconderia dinheiro que saiu.
ALTER TABLE "pagamentos_avulsos" ADD CONSTRAINT "pagamentos_avulsos_conta_pagar_id_fkey" FOREIGN KEY ("conta_pagar_id") REFERENCES "contas_pagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
