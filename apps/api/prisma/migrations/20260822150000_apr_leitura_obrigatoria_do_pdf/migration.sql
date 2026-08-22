-- Liberar a APR passa a exigir ter aberto o PDF ao menos uma vez.
--
-- As orientacoes de seguranca e o plano de resgate e emergencia ficam no fim
-- do documento, e so nele -- nao existe campo nenhum na tela que os mostre.
-- Sem esta marca, dava para marcar toda a equipe, colher as assinaturas e
-- liberar o servico sem ninguem ter lido o que fazer em caso de acidente.

ALTER TABLE "aprs" ADD COLUMN "visualizou_pdf_em" TIMESTAMP(3);
