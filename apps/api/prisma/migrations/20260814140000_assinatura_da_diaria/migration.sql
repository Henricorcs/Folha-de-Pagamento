-- Recibo assinado da diaria paga em maos.
--
-- Dinheiro entregue na mao nao deixa rastro em banco nenhum. O comprovante e a
-- assinatura de quem recebeu: quem paga gera um link, a pessoa desenha o nome
-- com o dedo -- no celular de quem pagou ou no dela, de onde estiver -- e o
-- recibo fica guardado aqui dentro.
--
-- O link e um segredo sorteado que morre ao ser usado e vence em 7 dias. Uma
-- diaria tem no maximo um recibo (diaria_id e unico): gerar o link de novo
-- reaproveita a linha e sorteia outro token, enquanto ninguem tiver assinado.
--
-- Valor, servico, nomes e o CNPJ de quem pagou sao copiados para ca quando o
-- link nasce, em vez de serem lidos do cadastro na hora de imprimir -- e e esse
-- mesmo texto que a pessoa le antes de assinar. Um recibo e o retrato do que
-- ela concordou ter recebido: se amanha alguem corrigir o cadastro dela ou o
-- valor da diaria, o papel que ela assinou nao pode mudar junto.

-- CreateTable
CREATE TABLE "assinaturas_diaria" (
    "id" TEXT NOT NULL,
    "diaria_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "assinatura_png" TEXT,
    "assinado_em" TIMESTAMP(3),
    "nome_assinante" TEXT,
    "cpf_assinante" TEXT,
    "valor" DECIMAL(14,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "data_diaria" TIMESTAMP(3) NOT NULL,
    "detalhamento" TEXT,
    "empresa_nome" TEXT NOT NULL,
    "empresa_cnpj" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assinaturas_diaria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_diaria_diaria_id_key" ON "assinaturas_diaria"("diaria_id");

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_diaria_token_key" ON "assinaturas_diaria"("token");

-- AddForeignKey
ALTER TABLE "assinaturas_diaria" ADD CONSTRAINT "assinaturas_diaria_diaria_id_fkey"
  FOREIGN KEY ("diaria_id") REFERENCES "diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quem paga, como sai impresso no cabecalho do recibo. Um recibo que nao diz
-- quem entregou o dinheiro nao prova nada, entao ja nasce com um nome.
ALTER TABLE "config_financeira"
  ADD COLUMN "empresa_nome" TEXT NOT NULL DEFAULT 'ILNET',
  ADD COLUMN "empresa_cnpj" TEXT NOT NULL DEFAULT '';
