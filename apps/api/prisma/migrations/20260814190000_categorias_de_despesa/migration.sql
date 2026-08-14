-- Com o que a empresa gasta.
--
-- O IXC tem um campo de conta de despesa, mas ele nao serve para esta
-- pergunta: vem vazio na maioria dos titulos (`id_conta = 0`) e segue o plano
-- de contas da contabilidade. O que se quer aqui e outra coisa -- "isso foi
-- mao de obra ou compra de veiculo?" --, entao a etiqueta mora deste lado,
-- amarrada ao titulo pelo id do fn_apagar.
--
-- E cadastro, e nao lista fixa no codigo, porque o que a empresa compra muda
-- com o tempo e ninguem deveria esperar um deploy para classificar um gasto
-- novo. As quinze primeiras ja nascem com a tabela.

-- CreateTable
CREATE TABLE "categorias_despesa" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categorias_despesa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_despesa_nome_key" ON "categorias_despesa"("nome");

-- CreateTable
CREATE TABLE "classificacoes_conta" (
    "id" TEXT NOT NULL,
    "id_fn_apagar" INTEGER NOT NULL,
    "categoria_id" TEXT NOT NULL,
    "classificado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classificacoes_conta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "classificacoes_conta_id_fn_apagar_key" ON "classificacoes_conta"("id_fn_apagar");

-- CreateIndex
CREATE INDEX "classificacoes_conta_categoria_id_idx" ON "classificacoes_conta"("categoria_id");

-- AddForeignKey
-- Restrict, e nao Cascade: apagar uma categoria que ja etiquetou contas
-- reescreveria relatorio de mes fechado. Quem sai de uso e desativada.
ALTER TABLE "classificacoes_conta" ADD CONSTRAINT "classificacoes_conta_categoria_id_fkey"
  FOREIGN KEY ("categoria_id") REFERENCES "categorias_despesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- As quinze de partida, na ordem em que foram pedidas. Os codigos sao fixos
-- para a migracao poder rodar de novo sem duplicar.
INSERT INTO "categorias_despesa" ("id", "nome", "ordem", "updated_at") VALUES
  ('c0000000-0000-4000-8000-000000000001', 'Mão de obra',                 1,  CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000002', 'Compra de veículos',          2,  CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000003', 'Compra de imóveis',           3,  CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000004', 'Energia',                     4,  CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000005', 'Serviços de terceiros',       5,  CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000006', 'Patrocínios',                 6,  CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000007', 'Publicidade',                 7,  CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000008', 'Máquinas pesadas',            8,  CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000009', 'Equipamentos de informática', 9,  CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000010', 'Cabos e fios',                10, CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000011', 'Material de construção',      11, CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000012', 'Ferragens',                   12, CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000013', 'Manutenção de veículos',      13, CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000014', 'Manutenção de máquinas',      14, CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000015', 'Manutenção de equipamentos',  15, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
