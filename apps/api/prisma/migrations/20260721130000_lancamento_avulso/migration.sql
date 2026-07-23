-- Lançamento avulso: competencia = "AAAA-MM" (null = fixo mensal)
ALTER TABLE "lancamentos_fixos" ADD COLUMN "competencia" TEXT;
