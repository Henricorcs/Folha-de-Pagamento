-- Comissao por venda (na pratica R$ 5 ou R$ 50), vendas e horas extras do mes,
-- e os vales/acertos (avulsos ou parcelados) nos dois sentidos: o funcionario
-- devendo a empresa (desconta da folha) ou a empresa devendo ao funcionario
-- (soma na folha).

-- CreateEnum
CREATE TYPE "SentidoVale" AS ENUM ('DESCONTO', 'CREDITO');

-- AlterTable
ALTER TABLE "funcionarios" ADD COLUMN "valor_por_venda" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "variaveis_mes" (
    "id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "vendas" INTEGER NOT NULL DEFAULT 0,
    "valor_por_venda" DECIMAL(14,2),
    "horas_extras" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variaveis_mes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vales" (
    "id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    "sentido" "SentidoVale" NOT NULL DEFAULT 'DESCONTO',
    "descricao" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valor_total" DECIMAL(14,2) NOT NULL,
    "quantidade_parcelas" INTEGER NOT NULL DEFAULT 1,
    "valor_parcela" DECIMAL(14,2) NOT NULL,
    "descontar_da_folha" BOOLEAN NOT NULL DEFAULT true,
    "competencia_inicio" TEXT NOT NULL,
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vale_parcelas" (
    "id" TEXT NOT NULL,
    "vale_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "competencia" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "descontada" BOOLEAN NOT NULL DEFAULT false,
    "descontada_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vale_parcelas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "variaveis_mes_competencia_idx" ON "variaveis_mes"("competencia");

-- CreateIndex
CREATE UNIQUE INDEX "variaveis_mes_funcionario_id_competencia_key" ON "variaveis_mes"("funcionario_id", "competencia");

-- CreateIndex
CREATE INDEX "vales_funcionario_id_idx" ON "vales"("funcionario_id");

-- CreateIndex
CREATE INDEX "vales_cancelado_idx" ON "vales"("cancelado");

-- CreateIndex
CREATE INDEX "vales_sentido_idx" ON "vales"("sentido");

-- CreateIndex
CREATE INDEX "vale_parcelas_competencia_idx" ON "vale_parcelas"("competencia");

-- CreateIndex
CREATE UNIQUE INDEX "vale_parcelas_vale_id_numero_key" ON "vale_parcelas"("vale_id", "numero");

-- AddForeignKey
ALTER TABLE "variaveis_mes" ADD CONSTRAINT "variaveis_mes_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vales" ADD CONSTRAINT "vales_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vale_parcelas" ADD CONSTRAINT "vale_parcelas_vale_id_fkey" FOREIGN KEY ("vale_id") REFERENCES "vales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
