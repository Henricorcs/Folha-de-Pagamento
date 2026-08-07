-- Quem tem carteira assinada recebe o salario oficial pela contabilidade; a
-- folha daqui paga o combinado, que pode ser outro valor. Quando preenchido,
-- e ele que serve de base para o calculo no lugar do salario base.
ALTER TABLE "funcionarios" ADD COLUMN "valor_a_receber_folha" DECIMAL(14,2);
