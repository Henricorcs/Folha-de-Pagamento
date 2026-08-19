-- A conciliação bancária feita por aqui.
--
-- O IXC guarda a marca em `fn_movim_finan.conciliado` e não deixa escrevê-la
-- pelo webservice (o PUT ignora o campo e apaga o resto da linha). Esta tabela
-- é onde ficam as conferências feitas nesta casa; o que o IXC já conciliou
-- continua sendo lido de lá.

CREATE TYPE "OrigemConciliacao" AS ENUM ('MANUAL', 'EXTRATO');

CREATE TABLE "conciliacao_linhas" (
    "id" TEXT NOT NULL,
    "id_movim_finan" INTEGER NOT NULL,
    "conta_ixc" INTEGER NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "origem" "OrigemConciliacao" NOT NULL DEFAULT 'MANUAL',
    "fit_id" TEXT,
    "conferido_por" TEXT,
    "conferido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conciliacao_linhas_pkey" PRIMARY KEY ("id")
);

-- Conferir a mesma linha duas vezes é a mesma conferência.
CREATE UNIQUE INDEX "conciliacao_linhas_id_movim_finan_key" ON "conciliacao_linhas"("id_movim_finan");

-- A tela sempre pergunta por conta e período.
CREATE INDEX "conciliacao_linhas_conta_ixc_data_idx" ON "conciliacao_linhas"("conta_ixc", "data");
