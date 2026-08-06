-- Adiantamento do dia 25: valor por funcionário e, na falta dele, um
-- percentual do salário base (40% por padrão). O valor apurado é abatido do
-- saldo salarial de quem não é CLT.
ALTER TABLE "config_financeira" ADD COLUMN "percentual_adiantamento" INTEGER NOT NULL DEFAULT 40;
ALTER TABLE "funcionarios" ADD COLUMN "valor_adiantamento" DECIMAL(14,2);
