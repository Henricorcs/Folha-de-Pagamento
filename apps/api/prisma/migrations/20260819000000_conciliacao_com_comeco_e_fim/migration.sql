-- A conciliação passa a ser um trabalho com começo, meio e fim -- uma conta, um
-- período, um status --, no mesmo recorte da tela do IXC. A marca solta por
-- linha continua valendo: `conciliacao_id` nasce nulo no que já existe.

CREATE TYPE "StatusConciliacao" AS ENUM ('ABERTA', 'FECHADA');

CREATE TABLE "conciliacoes" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "conta_ixc" INTEGER NOT NULL,
    "conta_nome" TEXT NOT NULL,
    "de" TIMESTAMP(3) NOT NULL,
    "ate" TIMESTAMP(3) NOT NULL,
    "status" "StatusConciliacao" NOT NULL DEFAULT 'ABERTA',
    "datasDiferentes" BOOLEAN NOT NULL DEFAULT true,
    "extrato_arquivo" TEXT,
    "extrato_banco" TEXT,
    "extrato_conta" TEXT,
    "extrato_saldo" DECIMAL(14,2),
    "extrato_saldo_em" TIMESTAMP(3),
    "total_entradas" DECIMAL(14,2),
    "total_saidas" DECIMAL(14,2),
    "total_linhas" INTEGER,
    "fechada_em" TIMESTAMP(3),
    "fechada_por" TEXT,
    "criada_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conciliacoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conciliacoes_numero_key" ON "conciliacoes"("numero");
CREATE INDEX "conciliacoes_conta_ixc_de_idx" ON "conciliacoes"("conta_ixc", "de");

-- O extrato do banco fica guardado com a conciliação: o arquivo não volta, e
-- sem as linhas dele o assistente perderia o lado do banco a cada passo.
CREATE TABLE "conciliacao_transacoes" (
    "id" TEXT NOT NULL,
    "conciliacao_id" TEXT NOT NULL,
    "fit_id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "documento" TEXT,
    "id_movim_finan" INTEGER,
    "casada_auto" BOOLEAN NOT NULL DEFAULT false,
    "casada_em" TIMESTAMP(3),
    "ignorada" BOOLEAN NOT NULL DEFAULT false,
    "motivo" TEXT,

    CONSTRAINT "conciliacao_transacoes_pkey" PRIMARY KEY ("id")
);

-- O FITID não se repete dentro da mesma conta: é ele que reconhece a mesma
-- transação quando o extrato é importado de novo.
CREATE UNIQUE INDEX "conciliacao_transacoes_conciliacao_id_fit_id_key" ON "conciliacao_transacoes"("conciliacao_id", "fit_id");
CREATE INDEX "conciliacao_transacoes_conciliacao_id_idx" ON "conciliacao_transacoes"("conciliacao_id");

ALTER TABLE "conciliacao_transacoes"
  ADD CONSTRAINT "conciliacao_transacoes_conciliacao_id_fkey"
  FOREIGN KEY ("conciliacao_id") REFERENCES "conciliacoes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A linha conferida passa a saber em qual conciliação isso aconteceu. Nulo no
-- que já existe, e nulo de novo se a conciliação for apagada: a conferência da
-- linha continua valendo por si.
ALTER TABLE "conciliacao_linhas" ADD COLUMN "conciliacao_id" TEXT;

CREATE INDEX "conciliacao_linhas_conciliacao_id_idx" ON "conciliacao_linhas"("conciliacao_id");

ALTER TABLE "conciliacao_linhas"
  ADD CONSTRAINT "conciliacao_linhas_conciliacao_id_fkey"
  FOREIGN KEY ("conciliacao_id") REFERENCES "conciliacoes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
