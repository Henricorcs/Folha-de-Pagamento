-- Guias de imposto que a contabilidade manda todo mes: DARF previdenciario,
-- guia do FGTS Digital e DAS do Simples Nacional. Cada guia guarda a
-- composicao item a item, porque somar o total cru mente:
--   - o INSS descontado do segurado e dinheiro do trabalhador so repassado;
--   - dentro do DAS, so o codigo 1006 (INSS) e custo de pessoal -- IRPJ, CSLL,
--     COFINS, PIS e ICMS sao tributo sobre faturamento;
--   - o consignado do FGTS e emprestimo do trabalhador, nao tributo.
-- Dai a classe em cada item.

-- CreateEnum
CREATE TYPE "TipoGuia" AS ENUM ('DARF_INSS', 'FGTS', 'DAS_SIMPLES', 'OUTRA');

-- CreateEnum
CREATE TYPE "ClasseTributo" AS ENUM ('FOLHA_PATRONAL', 'FOLHA_RETIDO', 'FATURAMENTO');

-- CreateTable
CREATE TABLE "guias" (
    "id" TEXT NOT NULL,
    "tipo" "TipoGuia" NOT NULL,
    "competencia" TEXT NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "valor_total" DECIMAL(14,2) NOT NULL,
    "numero_documento" TEXT,
    "cnpj" TEXT,
    "razao_social" TEXT,
    "trabalhadores" INTEGER,
    "arquivo_nome" TEXT NOT NULL,
    "texto_original" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guias_competencia_idx" ON "guias"("competencia");

-- O mesmo documento nao entra duas vezes: subir o PDF de novo dobraria o valor
-- no grafico sem ninguem perceber.
CREATE UNIQUE INDEX "guias_tipo_competencia_numero_documento_key" ON "guias"("tipo", "competencia", "numero_documento");

-- CreateTable
CREATE TABLE "guia_itens" (
    "id" TEXT NOT NULL,
    "guia_id" TEXT NOT NULL,
    "codigo" TEXT,
    "denominacao" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "classe" "ClasseTributo" NOT NULL,

    CONSTRAINT "guia_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guia_itens_guia_id_idx" ON "guia_itens"("guia_id");

-- AddForeignKey
ALTER TABLE "guia_itens" ADD CONSTRAINT "guia_itens_guia_id_fkey" FOREIGN KEY ("guia_id") REFERENCES "guias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
