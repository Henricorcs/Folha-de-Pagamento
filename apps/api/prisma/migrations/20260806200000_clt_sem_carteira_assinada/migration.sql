-- Ser CLT e ter a carteira assinada sao coisas diferentes: quem foi
-- contratado como CLT mas ainda nao teve a carteira assinada segue com o
-- adiantamento descontado do saldo salarial. Quem ja tem carteira assinada e,
-- por definicao, CLT.
ALTER TABLE "funcionarios" ADD COLUMN "clt" BOOLEAN NOT NULL DEFAULT false;
UPDATE "funcionarios" SET "clt" = true WHERE "carteira_assinada" = true;
