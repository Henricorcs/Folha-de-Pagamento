-- A estante de documentos do RH: as pastas e o que ha dentro delas.
--
-- A pasta de RH de uma empresa pequena vive em tres lugares ao mesmo tempo: uma
-- gaveta de aco, o e-mail de quem cadastrou e o WhatsApp do contador. A
-- pergunta que ninguem responde e sempre a mesma -- "cade o contrato do
-- Fulano?" --, e e para ela que estas duas tabelas existem.
--
-- O arquivo mora aqui dentro (bytea), e nao numa pasta do servidor. E a escolha
-- que faz o backup ser um so: o dump que salva a folha salva os documentos
-- junto. Um volume a parte seria mais barato por megabyte e teria custado a
-- primeira restauracao -- a que se descobre estar sem os arquivos no dia em que
-- se precisa deles.

-- A pasta existe antes do primeiro documento: e ela que a tela mostra vazia
-- esperando o contrato, e e nela que o recibo do mes cai quando o PDF da
-- contabilidade e separado.
CREATE TABLE "pastas_rh" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    -- A prateleira da empresa -- contrato social, alvara, certidao. So uma.
    "da_empresa" BOOLEAN NOT NULL DEFAULT false,
    -- Quando a pasta e de alguem que o sistema ja conhece.
    "funcionario_id" TEXT,
    -- So os digitos. E por ele que o recibo de pagamento acha a pasta sozinho:
    -- nome muda de grafia entre a contabilidade e o cadastro, CPF nao.
    "cpf" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pastas_rh_pkey" PRIMARY KEY ("id")
);

-- Um funcionario tem uma pasta, e nao duas.
CREATE UNIQUE INDEX "pastas_rh_funcionario_id_key" ON "pastas_rh"("funcionario_id");
CREATE INDEX "pastas_rh_cpf_idx" ON "pastas_rh"("cpf");

CREATE TABLE "documentos_rh" (
    "id" TEXT NOT NULL,
    "pasta_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    -- A prateleira dentro da pasta: Contrato, CTPS, Exame medico, Recibo de
    -- pagamento... Texto livre de proposito: a lista de tipos de uma casa nao e
    -- a de outra.
    "tipo" TEXT NOT NULL,
    "descricao" TEXT,
    -- "AAAA-MM" quando o documento e de um mes (recibo de pagamento).
    "competencia" TEXT,
    -- O dia impresso no documento e, quando ele tem prazo, ate quando vale.
    -- Certidao e exame vencem, e documento vencido na gaveta e o mesmo que nao
    -- ter documento nenhum.
    "emitido_em" DATE,
    "vale_ate" DATE,
    "arquivo_nome" TEXT NOT NULL,
    "arquivo_tipo" TEXT NOT NULL,
    -- Em bytes, guardado a parte: a listagem diz o tamanho sem ler o arquivo.
    "arquivo_tamanho" INTEGER NOT NULL,
    "arquivo" BYTEA NOT NULL,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documentos_rh_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "documentos_rh_pasta_id_idx" ON "documentos_rh"("pasta_id");
CREATE INDEX "documentos_rh_tipo_idx" ON "documentos_rh"("tipo");
-- Para achar o que esta vencendo sem varrer a tabela inteira.
CREATE INDEX "documentos_rh_vale_ate_idx" ON "documentos_rh"("vale_ate");

-- O mesmo recibo nao entra duas vezes na mesma pasta. Competencia nula nao
-- colide com nada (no Postgres, NULL e sempre distinto de NULL): quem nao e de
-- um mes -- contrato, exame, certidao -- pode repetir o tipo a vontade.
CREATE UNIQUE INDEX "documentos_rh_pasta_id_tipo_competencia_key"
  ON "documentos_rh"("pasta_id", "tipo", "competencia");

-- RESTRICT nos dois: apagar um funcionario nao pode levar junto o contrato
-- dele, e apagar uma pasta cheia nao pode levar junto o que esta dentro. Hoje
-- nada apaga funcionario (a sincronizacao marca inativo), entao a primeira
-- nunca aparece -- e no dia em que aparecer, ela reclama alto em vez de sumir
-- com a pasta de alguem em silencio.
ALTER TABLE "pastas_rh"
  ADD CONSTRAINT "pastas_rh_funcionario_id_fkey"
  FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "documentos_rh"
  ADD CONSTRAINT "documentos_rh_pasta_id_fkey"
  FOREIGN KEY ("pasta_id") REFERENCES "pastas_rh"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
