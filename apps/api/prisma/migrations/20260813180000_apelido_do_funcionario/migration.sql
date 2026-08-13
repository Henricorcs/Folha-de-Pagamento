-- Apelido do funcionario: como a pessoa e chamada no dia a dia.
--
-- O IXC nao tem esse campo para funcionario, so o diarista tinha equivalente
-- (nome_fantasia). Sem ele, achar alguem na lista exige lembrar o nome de
-- batismo -- que e justamente o que ninguem usa para falar da pessoa.
ALTER TABLE "funcionarios" ADD COLUMN "apelido" TEXT;

CREATE INDEX "funcionarios_apelido_idx" ON "funcionarios"("apelido");
