-- A prestacao de contas vira conta a pagar.
--
-- Ate aqui o dinheiro entregue na rua saia da gaveta e nunca virava saida no
-- IXC: a pessoa voltava com a nota, o gasto era anotado neste banco e o caixa
-- do IXC seguia sem saber que aquele dinheiro tinha ido embora. A nota existia
-- no papel e o financeiro nao a via.
--
-- Agora a prestacao pode lancar a conta a pagar da despesa -- criada, aprovada
-- e baixada no caixa escolhido, na data em que o dinheiro de fato saiu, que
-- costuma ser dias antes de alguem sentar para prestar contas.
--
-- E isso muda a conta do saldo. Antes, a entrega era descontada da gaveta e o
-- troco somado, porque nada daquilo passava pelo IXC. Com a despesa lancada, o
-- gasto passa a aparecer tambem como saida do IXC -- e descontar os dois seria
-- tirar o mesmo dinheiro duas vezes. Por isso o dia da baixa fica guardado: o
-- periodo que contem essa data soma o gasto de volta, anulando a metade que o
-- IXC ja desconta.
--
-- `gasto_pago_em` so e preenchido quando a baixa no IXC deu certo. Titulo
-- criado que nao chegou a ser baixado nao gera saida la, e portanto nao pode
-- gerar compensacao aqui.
ALTER TABLE "dinheiro_na_rua"
  ADD COLUMN "id_fn_apagar_ixc" INTEGER,
  ADD COLUMN "conta_pagar_id"   TEXT,
  ADD COLUMN "fornecedor_nome"  TEXT,
  ADD COLUMN "gasto_pago_em"    TIMESTAMP(3);

-- O periodo pergunta "que gastos o IXC ja desconta neste recorte?", e essa
-- pergunta e por caixa e por data da baixa.
CREATE INDEX "dinheiro_na_rua_caixa_id_gasto_pago_em_idx"
  ON "dinheiro_na_rua"("caixa_id", "gasto_pago_em");
