-- Fechamento de caixa.
--
-- O caixa e do IXC e continua sendo: os lancamentos sao lidos de la e nada e
-- escrito de volta. O que nasce aqui e o que o IXC nao tem onde guardar -- o
-- "ja conferi este", a foto da nota, e o dinheiro que saiu com alguem e ainda
-- nao voltou.
--
-- Este ultimo e o que fazia a conta nao fechar no papel. Sai R$ 100,00 com o
-- Jeferson para pagar algo na rua; ate ele voltar com a nota e o troco, aquele
-- dinheiro nao esta na gaveta nem virou despesa -- esta com ele. Sem registrar,
-- a contagem nunca bate e a explicacao vive na memoria de quem entregou.

-- Conferencia de um lancamento do caixa.
--
-- A chave e o par caixa + lancamento do IXC, e nao o fechamento: conferido uma
-- vez, continua conferido se o mesmo dia for consultado de novo ou se o periodo
-- for aberto com outro recorte.
CREATE TABLE "conferencias_caixa" (
    "id" TEXT NOT NULL,
    "caixa_id" INTEGER NOT NULL,
    "id_lancamento_ixc" INTEGER NOT NULL,
    "conferido" BOOLEAN NOT NULL DEFAULT false,
    "conferido_em" TIMESTAMP(3),
    "conferido_por" TEXT,
    "nota_foto" TEXT,
    "observacao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conferencias_caixa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conferencias_caixa_caixa_id_id_lancamento_ixc_key"
  ON "conferencias_caixa"("caixa_id", "id_lancamento_ixc");
CREATE INDEX "conferencias_caixa_caixa_id_idx" ON "conferencias_caixa"("caixa_id");

-- Dinheiro que saiu com uma pessoa e ainda nao prestou contas. Enquanto esta
-- aberto o valor continua sendo do caixa: saiu da gaveta, mas ainda e da
-- empresa. Ao voltar, gasto e troco sao registrados, e a soma dos dois tem de
-- fechar com o que saiu.
CREATE TABLE "dinheiro_na_rua" (
    "id" TEXT NOT NULL,
    "caixa_id" INTEGER NOT NULL,
    "pessoa" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "entregue_em" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "baixado_em" TIMESTAMP(3),
    "baixado_por" TEXT,
    "valor_gasto" DECIMAL(14,2),
    "troco" DECIMAL(14,2),
    "nota_foto" TEXT,
    "observacao" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dinheiro_na_rua_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dinheiro_na_rua_caixa_id_baixado_em_idx"
  ON "dinheiro_na_rua"("caixa_id", "baixado_em");

-- O periodo dado por conferido, com os numeros do momento em que fechou. Os
-- totais sao copiados, e nao recalculados na leitura: um fechamento e o que se
-- viu naquele dia, e lancamento que apareca no IXC depois, com data de periodo
-- ja fechado, nao reescreve o que foi assinado.
CREATE TABLE "fechamentos_caixa" (
    "id" TEXT NOT NULL,
    "caixa_id" INTEGER NOT NULL,
    "caixa_nome" TEXT NOT NULL,
    "de" TIMESTAMP(3) NOT NULL,
    "ate" TIMESTAMP(3) NOT NULL,
    "total_entradas" DECIMAL(14,2) NOT NULL,
    "total_saidas" DECIMAL(14,2) NOT NULL,
    "lancamentos" INTEGER NOT NULL,
    "conferidos" INTEGER NOT NULL,
    "total_na_rua" DECIMAL(14,2) NOT NULL,
    "observacao" TEXT,
    "fechado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fechamentos_caixa_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fechamentos_caixa_caixa_id_de_idx" ON "fechamentos_caixa"("caixa_id", "de");
