-- Transferencia entre contas.
--
-- Sai 1.500 do caixa do Werick e entra no caixa do Aurelio, ou vai para a
-- Sicoob. O dinheiro nao some nem aparece: ele muda de lugar. Ate aqui isso so
-- existia na tela do IXC (Financeiro > Transferencia entre contas), e quem
-- transferia tinha de lembrar de lancar la -- esquecendo, o caixa de origem
-- fechava sobrando e o de destino faltando, pelo mesmo valor, sem nada ligando
-- os dois.
--
-- No IXC uma transferencia sao duas linhas da movimentacao financeira
-- (`fn_movim_finan`): credito no razao da origem (que e como o IXC escreve
-- saida) e debito no razao do destino. Sao elas que o fechamento de caixa ja
-- le, entao a transferencia aparece sozinha nos dois extratos, sem precisar de
-- nenhum termo novo na conta do saldo.
--
-- Esta tabela guarda o que foi feito daqui e os ids das duas linhas la. Ela
-- nao e a verdade do dinheiro -- a verdade e o IXC --, e sim o registro de
-- quem mandou, quando, e para onde olhar se algo nao bater.
CREATE TABLE "transferencias_entre_contas" (
    "id" TEXT NOT NULL,

    "origem_id"     INTEGER NOT NULL,
    "origem_nome"   TEXT NOT NULL,
    "destino_id"    INTEGER NOT NULL,
    "destino_nome"  TEXT NOT NULL,

    "valor"     DECIMAL(14,2) NOT NULL,
    "data"      TIMESTAMP(3) NOT NULL,
    "historico" TEXT NOT NULL,
    -- Dinheiro, Pix, Deposito... e so descricao: o IXC recebe isso dentro do
    -- historico, porque a coluna de tipo da movimentacao nao esta documentada
    -- e escrever a esmo num campo do financeiro real nao se faz.
    "forma"     TEXT,

    -- As duas linhas criadas no IXC. Nulas quando a escrita la falhou pela
    -- metade -- e o unico estado que pede olho humano, entao ele fica visivel.
    "id_movim_origem"  INTEGER,
    "id_movim_destino" INTEGER,

    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transferencias_entre_contas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transferencias_entre_contas_data_idx"
  ON "transferencias_entre_contas"("data");
CREATE INDEX "transferencias_entre_contas_origem_id_idx"
  ON "transferencias_entre_contas"("origem_id");
