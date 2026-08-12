-- Diarista e beneficiario avulso tambem sao vendedores externos: fecham venda
-- e recebem comissao. E as vezes, no mesmo acerto, fizeram um servico por fora
-- que rende um troco a mais. As tres partes (dias/servico, comissao e extra)
-- viram um pagamento so -- que e como a pessoa recebe -- mas cada uma fica
-- gravada, senao nao da para responder quanto o mes custou em venda.

-- AlterTable: o valor por venda combinado com a pessoa, igual ao do
-- funcionario. So sugere o valor na hora de pagar.
ALTER TABLE "diaristas"
  ADD COLUMN "valor_por_venda" DECIMAL(14,2);

ALTER TABLE "beneficiarios_avulsos"
  ADD COLUMN "valor_por_venda" DECIMAL(14,2);

-- AlterTable: as partes de cada pagamento. `comissao_vendas` e congelada de
-- proposito -- corrigir o valor por venda no cadastro nao pode reescrever o
-- gasto de um mes ja fechado.
ALTER TABLE "diarias"
  ADD COLUMN "vendas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "valor_por_venda" DECIMAL(14,2),
  ADD COLUMN "comissao_vendas" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "valor_extra" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "descricao_extra" TEXT;

ALTER TABLE "pagamentos_avulsos"
  ADD COLUMN "vendas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "valor_por_venda" DECIMAL(14,2),
  ADD COLUMN "comissao_vendas" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "valor_extra" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "descricao_extra" TEXT;
