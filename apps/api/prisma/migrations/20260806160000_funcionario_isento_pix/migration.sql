-- Só quem é fornecedor ativo isento de ICMS conta como funcionário: a
-- listagem, o resumo e a folha passam a usar essa marca.
ALTER TABLE "funcionarios" ADD COLUMN "isento_icms" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "funcionarios_isento_icms_idx" ON "funcionarios"("isento_icms");

-- Tabela da aba "Dados bancários" do fornecedor (vazio = descobre sozinho).
ALTER TABLE "config_financeira" ADD COLUMN "fornecedor_tabela_banco" TEXT NOT NULL DEFAULT '';

-- Pagamento via PIX na conta a pagar do IXC.
ALTER TABLE "config_financeira" ALTER COLUMN "tipo_pagamento_padrao" SET DEFAULT 'Pix';
UPDATE "config_financeira" SET "tipo_pagamento_padrao" = 'Pix' WHERE "tipo_pagamento_padrao" = 'Dinheiro';
