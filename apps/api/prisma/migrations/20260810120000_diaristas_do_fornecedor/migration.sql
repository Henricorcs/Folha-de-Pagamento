-- Diaristas importados do cadastro de fornecedor do IXC.
-- Regra: fornecedor ativo com "Tipo de pessoa" = Estrangeiro e diarista.
-- O nome fantasia entra na busca porque e por ele que a pessoa e reconhecida
-- ("Deda pedreiro"), e os dados bancarios vem da aba do fornecedor.

-- AlterTable
ALTER TABLE "diaristas" ADD COLUMN "nome_fantasia" TEXT;
ALTER TABLE "diaristas" ADD COLUMN "banco" TEXT;
ALTER TABLE "diaristas" ADD COLUMN "agencia" TEXT;
ALTER TABLE "diaristas" ADD COLUMN "conta" TEXT;
ALTER TABLE "diaristas" ADD COLUMN "importado_do_ixc" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "diaristas_nome_fantasia_idx" ON "diaristas"("nome_fantasia");

-- AlterTable: filtro que identifica diaristas no cadastro de fornecedor
-- (vazio no campo = deteccao automatica da coluna).
ALTER TABLE "config_financeira" ADD COLUMN "fornecedor_campo_tipo_pessoa" TEXT NOT NULL DEFAULT '';
ALTER TABLE "config_financeira" ADD COLUMN "fornecedor_tipo_estrangeiro" TEXT NOT NULL DEFAULT 'E,ESTRANGEIRO';
