-- Filtro que identifica funcionários no cadastro de fornecedor do IXC
-- (fornecedor ativo com "Contribuinte ICMS" = Isento é funcionário).
ALTER TABLE "config_financeira" ADD COLUMN "fornecedor_campo_icms" TEXT NOT NULL DEFAULT '';
ALTER TABLE "config_financeira" ADD COLUMN "fornecedor_icms_isento" TEXT NOT NULL DEFAULT 'I,ISENTO';
