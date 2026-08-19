-- Varias fotos por nota, e o historico do que foi conferido.
--
-- Uma nota nao cabe sempre numa foto so: cupom comprido sai em duas, nota com
-- verso escrito sai em duas, e a foto tremida pede a segunda tentativa sem
-- perder a primeira. O campo era um: anexar de novo apagava o anterior, sem
-- avisar.
--
-- As fotos saem para uma tabela propria em vez de virar uma lista na linha.
-- Assim a listagem continua podendo perguntar "quantas ha?" sem carregar
-- nenhuma -- sao centenas de KB cada, e uma semana de caixa viraria megabytes
-- de resposta para desenhar uma tabela.
CREATE TABLE "fotos_da_nota" (
    "id" TEXT NOT NULL,
    -- Uma das duas, nunca as duas: a foto e da conferencia de um lancamento do
    -- caixa, ou do acerto de quem levou dinheiro para a rua.
    "conferencia_id" TEXT,
    "movimento_id"   TEXT,
    "foto"       TEXT NOT NULL,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fotos_da_nota_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fotos_da_nota_conferencia_id_idx" ON "fotos_da_nota"("conferencia_id");
CREATE INDEX "fotos_da_nota_movimento_id_idx" ON "fotos_da_nota"("movimento_id");

ALTER TABLE "fotos_da_nota"
  ADD CONSTRAINT "fotos_da_nota_conferencia_id_fkey"
  FOREIGN KEY ("conferencia_id") REFERENCES "conferencias_caixa"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fotos_da_nota"
  ADD CONSTRAINT "fotos_da_nota_movimento_id_fkey"
  FOREIGN KEY ("movimento_id") REFERENCES "movimentos_da_rua"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- As fotos que ja existiam viram a primeira de cada nota. O id sai de md5 por
-- portabilidade de versao do Postgres; o formato e o mesmo uuid em texto.
INSERT INTO "fotos_da_nota" ("id", "conferencia_id", "foto", "criado_por", "created_at")
SELECT md5(random()::text || clock_timestamp()::text)::uuid::text,
       "id", "nota_foto", "conferido_por", "created_at"
FROM "conferencias_caixa" WHERE "nota_foto" IS NOT NULL;

INSERT INTO "fotos_da_nota" ("id", "movimento_id", "foto", "criado_por", "created_at")
SELECT md5(random()::text || clock_timestamp()::text)::uuid::text,
       "id", "nota_foto", "criado_por", "created_at"
FROM "movimentos_da_rua" WHERE "nota_foto" IS NOT NULL;

ALTER TABLE "conferencias_caixa" DROP COLUMN "nota_foto";
ALTER TABLE "movimentos_da_rua"  DROP COLUMN "nota_foto";

-- O retrato do lancamento no momento em que foi conferido.
--
-- Sem isto nao ha historico para pesquisar: a conferencia guardava so a marca
-- ("olhei este") e o numero do lancamento no IXC, e achar um pagamento de tres
-- meses atras exigiria varrer o IXC mes a mes -- que e a leitura que ja
-- derrubou esta pagina com 502. Copiado, e nao lido de novo, pelo mesmo motivo
-- que o fechamento copia os totais: o que se viu naquele dia nao muda depois.
ALTER TABLE "conferencias_caixa"
  ADD COLUMN "data_lancamento" TIMESTAMP(3),
  ADD COLUMN "valor"           DECIMAL(14,2),
  ADD COLUMN "historico"       TEXT;

CREATE INDEX "conferencias_caixa_data_lancamento_idx"
  ON "conferencias_caixa"("data_lancamento");
