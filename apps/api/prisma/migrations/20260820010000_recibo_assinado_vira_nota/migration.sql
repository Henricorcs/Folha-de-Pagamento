-- O recibo assinado do diarista vale como nota do pagamento no caixa.
--
-- A diaria paga em maos vira conta a pagar baixada no caixa, e a saida aparece
-- na conferencia pedindo foto da nota -- so que a nota daquele pagamento ja
-- existe neste sistema: e o recibo que a pessoa assinou com o dedo na tela. Sem
-- a ligacao, quem fecha o caixa imprimia o recibo, fotografava o papel e
-- anexava a foto do papel que o proprio sistema tinha gerado.
--
-- A nota passa a poder ser uma de duas coisas: uma foto (data URL) ou um recibo
-- de diaria. O recibo nao e copiado para ca -- ele e montado na hora, a partir
-- do retrato congelado em `assinaturas_diaria`, e reimprimir o de marco tem de
-- dar o mesmo papel que saiu em marco. Guardar uma copia seria criar uma
-- segunda verdade sobre o mesmo pagamento.
ALTER TABLE "fotos_da_nota" ALTER COLUMN "foto" DROP NOT NULL;

ALTER TABLE "fotos_da_nota" ADD COLUMN "diaria_id" TEXT;

CREATE INDEX "fotos_da_nota_diaria_id_idx" ON "fotos_da_nota"("diaria_id");

ALTER TABLE "fotos_da_nota"
  ADD CONSTRAINT "fotos_da_nota_diaria_id_fkey"
  FOREIGN KEY ("diaria_id") REFERENCES "diarias"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma coisa ou outra, nunca as duas e nunca nenhuma: uma linha sem foto e sem
-- recibo seria uma nota que nao mostra nada, e a conferencia contaria uma nota
-- que nao existe.
ALTER TABLE "fotos_da_nota"
  ADD CONSTRAINT "fotos_da_nota_foto_ou_recibo"
  CHECK (("foto" IS NOT NULL) <> ("diaria_id" IS NOT NULL));

-- O mesmo recibo nao se anexa duas vezes.
CREATE UNIQUE INDEX "fotos_da_nota_diaria_id_key"
  ON "fotos_da_nota"("diaria_id") WHERE "diaria_id" IS NOT NULL;
