-- Conta de pagamento de quem recebe em maos.
--
-- Pagar em maos e pagar pelo banco sao a mesma conta a pagar no IXC: muda so
-- de onde o dinheiro sai. 18 e o banco, 23 e o caixa.
--
-- Antes o "em maos" nao virava conta a pagar nenhuma -- ele tentava escrever
-- direto na movimentacao financeira do IXC, uma tabela que nao esta na
-- documentacao do webservice e nao existe com nenhum dos nomes conhecidos
-- nesta base. O dinheiro saia da gaveta e nao saia de lugar nenhum no IXC.
ALTER TABLE "config_financeira"
  ADD COLUMN "conta_pagamento_caixa_id" INTEGER NOT NULL DEFAULT 23;
