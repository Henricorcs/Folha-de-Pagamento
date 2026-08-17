-- A guia de imposto passa a apontar a conta a pagar que ela gerou no IXC.
-- Null = ainda não virou conta. O índice único é o que impede a mesma guia de
-- virar duas contas: imposto pago em dobro só volta em compensação, meses
-- depois.
ALTER TABLE "guias" ADD COLUMN "conta_pagar_id" TEXT;

CREATE UNIQUE INDEX "guias_conta_pagar_id_key" ON "guias"("conta_pagar_id");

-- Apagar a conta a pagar não apaga a guia: o imposto continua tendo existido, e
-- a guia volta a poder gerar a conta de novo.
ALTER TABLE "guias"
  ADD CONSTRAINT "guias_conta_pagar_id_fkey"
  FOREIGN KEY ("conta_pagar_id") REFERENCES "contas_pagar"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
