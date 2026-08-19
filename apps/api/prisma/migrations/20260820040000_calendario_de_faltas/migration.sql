-- Calendario de faltas.
--
-- Falta injustificada custa o dia e custa o descanso da semana: pela CLT, quem
-- falta sem justificativa perde o DSR daquela semana. Sao dois descontos por
-- uma ausencia, e o segundo e o que sempre escapava -- quem calculava na mao
-- descontava o dia e esquecia o domingo.
--
-- Aqui se marca o dia; o DSR sai sozinho. Uma semana com tres faltas perde um
-- domingo, nao tres: o descanso e um por semana, e e por isso que a conta e por
-- semana e nao por falta.
--
-- So para quem nao tem carteira assinada. Com carteira, quem desconta falta e a
-- contabilidade, na folha oficial -- descontar de novo aqui tiraria o mesmo dia
-- duas vezes da mesma pessoa.
CREATE TABLE "faltas_funcionario" (
    "id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    -- O dia da falta, a meia-noite local.
    "data" TIMESTAMP(3) NOT NULL,
    -- "AAAA-MM" do mes trabalhado. Guardado, e nao derivado na leitura, para a
    -- folha achar as faltas do mes sem varrer datas.
    "competencia" TEXT NOT NULL,
    "observacao" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faltas_funcionario_pkey" PRIMARY KEY ("id")
);

-- O mesmo dia nao se falta duas vezes.
CREATE UNIQUE INDEX "faltas_funcionario_funcionario_id_data_key"
  ON "faltas_funcionario"("funcionario_id", "data");
CREATE INDEX "faltas_funcionario_funcionario_id_competencia_idx"
  ON "faltas_funcionario"("funcionario_id", "competencia");

ALTER TABLE "faltas_funcionario"
  ADD CONSTRAINT "faltas_funcionario_funcionario_id_fkey"
  FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
