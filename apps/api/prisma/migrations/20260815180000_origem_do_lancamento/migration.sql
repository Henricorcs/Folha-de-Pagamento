-- A divisa entre os dois módulos.
--
-- A folha e o contas a pagar dividem estas tabelas, e o pagamento feito a um
-- fornecedor pelo módulo Contas a Pagar estava entrando nos números da folha:
-- no custo do mês, na fatia "Pagamentos avulsos" e na lista de últimos
-- lançamentos. Daqui em diante cada linha sabe de onde veio.

CREATE TYPE "OrigemLancamento" AS ENUM ('FOLHA', 'CONTAS_PAGAR');

ALTER TABLE "contas_pagar"
  ADD COLUMN "origem" "OrigemLancamento" NOT NULL DEFAULT 'FOLHA';

ALTER TABLE "pagamentos_avulsos"
  ADD COLUMN "origem" "OrigemLancamento" NOT NULL DEFAULT 'FOLHA';

ALTER TABLE "beneficiarios_avulsos"
  ADD COLUMN "origem" "OrigemLancamento" NOT NULL DEFAULT 'FOLHA';

-- --------------------------------------------------------------------------
-- O que já foi lançado
-- --------------------------------------------------------------------------
-- A tela de avulsos do Contas a Pagar, que abre pela lista de fornecedores do
-- IXC, entrou no ar em 15/08/2026 (commit bc32013). Todo cadastro nascido
-- daquela lista tem `id_fornecedor_ixc` preenchido e foi criado a partir
-- daquela data — antes dela não havia como criar um assim. É por esses dois
-- fatos juntos que dá para reconhecer o que veio do outro módulo.
--
-- O corte é deliberadamente estreito: quem tem `id_fornecedor_ixc` mas foi
-- cadastrado antes é gente que a folha registrou e ligou a um fornecedor já
-- existente no IXC, e continua sendo da folha. Errar para esse lado é deixar
-- passar um lançamento; errar para o outro seria apagar da folha um pagamento
-- que é dela — e é isso que mexeria nos relatórios.
UPDATE "beneficiarios_avulsos"
   SET "origem" = 'CONTAS_PAGAR'
 WHERE "id_fornecedor_ixc" IS NOT NULL
   AND "created_at" >= TIMESTAMP '2026-08-15 05:00:00';

UPDATE "pagamentos_avulsos" p
   SET "origem" = 'CONTAS_PAGAR'
  FROM "beneficiarios_avulsos" b
 WHERE p."beneficiario_id" = b."id"
   AND b."origem" = 'CONTAS_PAGAR'
   AND p."created_at" >= TIMESTAMP '2026-08-15 05:00:00';

-- A conta a pagar de cada um desses pagamentos vai junto: é ela que aparece
-- em "Últimos lançamentos" e que soma no custo do mês.
UPDATE "contas_pagar" c
   SET "origem" = 'CONTAS_PAGAR'
  FROM "pagamentos_avulsos" p
 WHERE p."conta_pagar_id" = c."id"
   AND p."origem" = 'CONTAS_PAGAR';

-- Despesa lançada à mão sempre foi do Contas a Pagar — já ficava de fora da
-- folha pelo tipo, e agora fica pelos dois caminhos.
UPDATE "contas_pagar"
   SET "origem" = 'CONTAS_PAGAR'
 WHERE "tipo" = 'DESPESA';

CREATE INDEX "contas_pagar_origem_idx" ON "contas_pagar"("origem");
CREATE INDEX "pagamentos_avulsos_origem_idx" ON "pagamentos_avulsos"("origem");
