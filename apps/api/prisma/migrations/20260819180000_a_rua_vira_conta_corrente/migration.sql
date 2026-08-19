-- O dinheiro na rua vira conta corrente da pessoa.
--
-- Ate aqui a entrega era tudo-ou-nada: saiam R$ 100,00 com alguem, e a
-- prestacao so era aceita se nota mais troco fechassem exatamente os R$ 100,00.
-- Nao e assim que acontece. A pessoa leva 100, traz nota de 50 e fica com os
-- outros 50 para a proxima compra; as vezes a compra passa do que ela tem e
-- mais dinheiro sai da gaveta para completar. Entre a saida e o acerto final ha
-- varios movimentos, e o que existia era um unico campo `valor_gasto`.
--
-- Agora a entrega e uma conta aberta e cada acerto e um lancamento dela:
--
--   NOTA    -- comprovou um gasto (e o que vira conta a pagar no IXC)
--   TROCO   -- devolveu dinheiro para a gaveta
--   REFORCO -- levou mais dinheiro para completar a compra
--
-- O saldo da pessoa e a entrega mais os reforcos, menos as notas e os trocos.
-- Zerou, a conta se fecha sozinha (`baixado_em`).
CREATE TYPE "TipoMovimentoDaRua" AS ENUM ('NOTA', 'TROCO', 'REFORCO');

CREATE TABLE "movimentos_da_rua" (
    "id" TEXT NOT NULL,
    "entrega_id" TEXT NOT NULL,
    "tipo" "TipoMovimentoDaRua" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    -- Dia em que aconteceu, que nao e o dia em que foi digitado: quem leva
    -- dinheiro na segunda so senta para prestar contas na sexta, e e a data do
    -- acontecimento que decide em que periodo do caixa ele pesa.
    "data" TIMESTAMP(3) NOT NULL,
    "observacao" TEXT,
    "nota_foto" TEXT,

    -- So para NOTA que virou conta a pagar no IXC.
    "id_fn_apagar_ixc" INTEGER,
    "conta_pagar_id" TEXT,
    "fornecedor_nome" TEXT,
    -- Dia em que o IXC deu a saida do gasto no caixa. Preenchido so quando a
    -- baixa la deu certo -- e a chave da compensacao que impede o mesmo
    -- dinheiro de ser descontado duas vezes.
    "gasto_pago_em" TIMESTAMP(3),

    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_da_rua_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "movimentos_da_rua_entrega_id_idx" ON "movimentos_da_rua"("entrega_id");
CREATE INDEX "movimentos_da_rua_data_idx" ON "movimentos_da_rua"("data");
CREATE INDEX "movimentos_da_rua_gasto_pago_em_idx" ON "movimentos_da_rua"("gasto_pago_em");

ALTER TABLE "movimentos_da_rua"
  ADD CONSTRAINT "movimentos_da_rua_entrega_id_fkey"
  FOREIGN KEY ("entrega_id") REFERENCES "dinheiro_na_rua"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- As prestacoes que ja existiam viram lancamentos, para o saldo continuar
-- fechando e o historico nao ficar mentindo. O id sai de md5 em vez de
-- gen_random_uuid() so por portabilidade de versao do Postgres -- e uma vez, na
-- migracao, e o formato e o mesmo uuid em texto que o Prisma gera.
INSERT INTO "movimentos_da_rua"
  ("id", "entrega_id", "tipo", "valor", "data", "observacao", "nota_foto",
   "id_fn_apagar_ixc", "conta_pagar_id", "fornecedor_nome", "gasto_pago_em",
   "criado_por", "created_at")
SELECT
  md5(random()::text || clock_timestamp()::text)::uuid::text,
  "id", 'NOTA', "valor_gasto", COALESCE("gasto_pago_em", "baixado_em"),
  "observacao", "nota_foto", "id_fn_apagar_ixc", "conta_pagar_id",
  "fornecedor_nome", "gasto_pago_em", "baixado_por", "created_at"
FROM "dinheiro_na_rua"
WHERE "baixado_em" IS NOT NULL AND COALESCE("valor_gasto", 0) > 0;

INSERT INTO "movimentos_da_rua"
  ("id", "entrega_id", "tipo", "valor", "data", "criado_por", "created_at")
SELECT
  md5(random()::text || clock_timestamp()::text)::uuid::text,
  "id", 'TROCO', "troco", "baixado_em", "baixado_por", "created_at"
FROM "dinheiro_na_rua"
WHERE "baixado_em" IS NOT NULL AND COALESCE("troco", 0) > 0;

-- O que virou lancamento sai da entrega: dois lugares guardando o mesmo numero
-- e como o mesmo dinheiro sai duas vezes de uma conta.
DROP INDEX IF EXISTS "dinheiro_na_rua_caixa_id_gasto_pago_em_idx";

ALTER TABLE "dinheiro_na_rua"
  DROP COLUMN "valor_gasto",
  DROP COLUMN "troco",
  DROP COLUMN "nota_foto",
  DROP COLUMN "id_fn_apagar_ixc",
  DROP COLUMN "conta_pagar_id",
  DROP COLUMN "fornecedor_nome",
  DROP COLUMN "gasto_pago_em";
