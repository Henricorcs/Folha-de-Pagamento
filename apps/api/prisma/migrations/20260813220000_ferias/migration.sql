-- Ferias: a "Previsao de Ferias" que a contabilidade manda todo mes, lida do
-- PDF, e o registro de quem ja foi mandado para ferias.
--
-- Duas datas mandam na fila:
--   - fim do periodo aquisitivo: so a partir do dia seguinte a pessoa pode sair;
--   - data limite: ultimo dia em que as ferias podem comecar sem a empresa cair
--     no pagamento em dobro (art. 137 da CLT). E ela que ordena a fila.
--
-- A previsao e unica por data de relatorio: subir o mesmo arquivo de novo
-- substitui a fila em vez de duplica-la.

-- CreateTable
CREATE TABLE "previsoes_ferias" (
    "id" TEXT NOT NULL,
    "data_relatorio" TIMESTAMP(3) NOT NULL,
    "empresa" TEXT,
    "cnpj" TEXT,
    "meses_limite" INTEGER,
    "arquivo_nome" TEXT NOT NULL,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "previsoes_ferias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "previsoes_ferias_data_relatorio_key" ON "previsoes_ferias"("data_relatorio");

-- CreateTable
CREATE TABLE "itens_previsao_ferias" (
    "id" TEXT NOT NULL,
    "previsao_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cargo" TEXT,
    "admissao" TIMESTAMP(3),
    "periodo_inicio" TIMESTAMP(3) NOT NULL,
    "periodo_fim" TIMESTAMP(3) NOT NULL,
    "data_limite" TIMESTAMP(3) NOT NULL,
    "dias_direito" DECIMAL(5,1) NOT NULL DEFAULT 30,
    "dias_acumulados" DECIMAL(5,1),
    "dias_restantes" DECIMAL(5,1),
    "funcionario_id" TEXT,

    CONSTRAINT "itens_previsao_ferias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "itens_previsao_ferias_previsao_id_idx" ON "itens_previsao_ferias"("previsao_id");

-- CreateIndex
CREATE INDEX "itens_previsao_ferias_data_limite_idx" ON "itens_previsao_ferias"("data_limite");

-- CreateTable
CREATE TABLE "ferias_marcadas" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "funcionario_id" TEXT,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "dias" INTEGER NOT NULL DEFAULT 30,
    "periodo_inicio" TIMESTAMP(3) NOT NULL,
    "periodo_fim" TIMESTAMP(3) NOT NULL,
    "observacao" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ferias_marcadas_pkey" PRIMARY KEY ("id")
);

-- O mesmo periodo aquisitivo nao e concedido duas vezes.
CREATE UNIQUE INDEX "ferias_marcadas_codigo_periodo_fim_key" ON "ferias_marcadas"("codigo", "periodo_fim");

-- CreateIndex
CREATE INDEX "ferias_marcadas_inicio_idx" ON "ferias_marcadas"("inicio");

-- AddForeignKey
ALTER TABLE "itens_previsao_ferias" ADD CONSTRAINT "itens_previsao_ferias_previsao_id_fkey" FOREIGN KEY ("previsao_id") REFERENCES "previsoes_ferias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_previsao_ferias" ADD CONSTRAINT "itens_previsao_ferias_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ferias_marcadas" ADD CONSTRAINT "ferias_marcadas_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
