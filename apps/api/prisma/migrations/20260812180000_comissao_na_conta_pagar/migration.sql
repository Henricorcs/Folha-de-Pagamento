-- Quanto de um pagamento era comissao de venda, gravado na hora em que a folha
-- e gerada.
--
-- Antes o gasto com vendas do funcionario era refeito a partir das vendas
-- lancadas no mes trabalhado, quando existisse salario naquela competencia.
-- Isso da um numero que ninguem pagou: a venda lancada depois da folha, ou
-- corrigida depois, reescrevia um mes ja fechado -- e vendas lancadas antes de
-- o sistema comecar a pagar comissao apareciam como gasto que nunca saiu.
--
-- Agora so conta o que esta escrito na conta a pagar. As contas antigas ficam
-- em zero de proposito: a comissao delas nao foi registrada, e chutar seria
-- repetir o mesmo erro.
ALTER TABLE "contas_pagar"
  ADD COLUMN "vendas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "comissao_vendas" DECIMAL(14,2) NOT NULL DEFAULT 0;
