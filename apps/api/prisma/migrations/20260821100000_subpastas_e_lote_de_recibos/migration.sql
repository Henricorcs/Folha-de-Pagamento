-- Pasta dentro de pasta, e o lote de recibos que da para desfazer.
--
-- Duas coisas que so aparecem com a estante em uso: a gaveta de cada um precisa
-- de divisoria ("Exames" dentro do Fulano, "2026" dentro de "Recibos de
-- pagamento"), e separar o PDF do mes e uma acao que toca vinte e tres pastas
-- de uma vez -- o engano so aparece depois de tudo guardado, e desfazer nao
-- pode ser apagar documento por documento.

-- A pasta que contem esta. Nulo = pasta de primeiro nivel, a da estante.
ALTER TABLE "pastas_rh" ADD COLUMN "pai_id" TEXT;

CREATE INDEX "pastas_rh_pai_id_idx" ON "pastas_rh"("pai_id");

-- RESTRICT: apagar a pasta de cima nao pode levar junto o que ha dentro dela.
-- Quem apaga pasta ja recusa fazer isso com documento ou subpasta dentro.
ALTER TABLE "pastas_rh"
  ADD CONSTRAINT "pastas_rh_pai_id_fkey"
  FOREIGN KEY ("pai_id") REFERENCES "pastas_rh"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Uma vez em que o PDF da folha foi separado e guardado.
CREATE TABLE "lotes_de_recibos" (
    "id" TEXT NOT NULL,
    -- "AAAA-MM" do mes que foi separado.
    "competencia" TEXT NOT NULL,
    "arquivo_nome" TEXT NOT NULL,
    -- Quantos recibos entraram. Guardado porque o desfazer apaga os documentos,
    -- e o historico continua tendo de dizer o que aquele dia fez.
    "quantidade" INTEGER NOT NULL,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lotes_de_recibos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lotes_de_recibos_competencia_idx" ON "lotes_de_recibos"("competencia");

-- De que lote veio este documento, quando veio de um.
ALTER TABLE "documentos_rh" ADD COLUMN "lote_id" TEXT;

CREATE INDEX "documentos_rh_lote_id_idx" ON "documentos_rh"("lote_id");

-- SET NULL: apagar o registro do lote nao pode levar junto o recibo de alguem.
-- Quem apaga os documentos e o desfazer, que sabe o que esta fazendo.
ALTER TABLE "documentos_rh"
  ADD CONSTRAINT "documentos_rh_lote_id_fkey"
  FOREIGN KEY ("lote_id") REFERENCES "lotes_de_recibos"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
