-- A APR tambem vai para a pasta de quem executou o servico.
--
-- Ate aqui a copia era uma so, na pasta da empresa, ordenada por mes. Ela
-- responde "quais servicos houve em agosto?" e nao responde a pergunta que
-- aparece quando alguem cobra: "cade a prova de que o Fulano foi orientado
-- antes de subir no poste?". Essa se procura na pasta do Fulano, junto do
-- contrato e do exame -- e e la que ela passa a ficar, em "Seguranca do
-- Trabalho".
--
-- Uma coluna por executante, e nao uma lista na APR: e a pessoa que tem a
-- copia, e e por ela que se sabe qual documento apagar quando o papel muda
-- (supervisao assinada depois, prorrogacao, cancelamento).

ALTER TABLE "executantes_apr" ADD COLUMN "documento_rh_id" TEXT;

-- Um documento e a copia de um executante so. O @unique tambem e o que faz o
-- rearquivamento trocar a folha em vez de acumular copias.
CREATE UNIQUE INDEX "executantes_apr_documento_rh_id_key"
  ON "executantes_apr"("documento_rh_id");

-- SET NULL: apagar o documento pela tela do RH nao tira ninguem da equipe nem
-- desfaz a APR. A proxima mudanca arquiva de novo.
ALTER TABLE "executantes_apr"
  ADD CONSTRAINT "executantes_apr_documento_rh_id_fkey"
  FOREIGN KEY ("documento_rh_id") REFERENCES "documentos_rh"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
