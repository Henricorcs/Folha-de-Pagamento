-- O saldo que deve estar na gaveta.
--
-- O webservice do IXC nao devolve saldo de conta: o cadastro tem
-- `saldo_abertura`, que e o saldo do dia em que a conta nasceu, e nada mais.
-- Somar a historia inteira a cada abertura de tela nao serve -- e a leitura que
-- ja derrubou esta pagina com 502.
--
-- Entao o saldo se encadeia: cada fechamento guarda com quanto o periodo abriu
-- e com quanto fechou, e o proximo comeca de onde o anterior parou. O primeiro
-- de cada caixa pede o valor a quem esta contando a gaveta.
--
-- `saldo_final` nao e saldo contabil. O dinheiro entregue na rua sai da gaveta
-- sem virar saida no IXC, e o troco volta do mesmo jeito -- os dois entram na
-- conta, ou o numero na tela nao seria o que a pessoa tem na mao.
--
-- Default de zero so para as linhas que ja existem; fechamento novo sempre
-- informa os dois.
ALTER TABLE "fechamentos_caixa"
  ADD COLUMN "saldo_inicial" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "saldo_final"   DECIMAL(14,2) NOT NULL DEFAULT 0;
