-- Liga a parcela de vale a conta a pagar que a consumiu. Sem isso nao da para
-- estornar a baixa quando a conta e removida ou reprovada, e gerar a folha
-- duas vezes no mesmo mes descontaria o vale duas vezes.

-- AlterTable
ALTER TABLE "vale_parcelas" ADD COLUMN "conta_pagar_id" TEXT;

-- CreateIndex
CREATE INDEX "vale_parcelas_conta_pagar_id_idx" ON "vale_parcelas"("conta_pagar_id");

-- AddForeignKey
ALTER TABLE "vale_parcelas" ADD CONSTRAINT "vale_parcelas_conta_pagar_id_fkey" FOREIGN KEY ("conta_pagar_id") REFERENCES "contas_pagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
