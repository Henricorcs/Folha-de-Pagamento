-- Recupera a comissao das folhas geradas antes de a coluna existir.
--
-- A fonte nao e o cadastro de vendas: refazer a conta por ele daria um numero
-- que ninguem pagou -- venda lancada depois, ou corrigida depois, reescreveria
-- um mes ja fechado. A fonte e a propria observacao da conta a pagar, que a
-- folha escreveu no momento de gerar e mandou junto para o IXC:
--
--   saldo salarial referente ao mes 07/2026 (COMISSAO: 12 x R$ 50,00 = R$ 600,00)
--
-- E o registro do que de fato saiu. Quem nao tem esse trecho continua em zero:
-- ou nao houve comissao naquele salario, ou ela nunca foi registrada.
-- `folha.observacao.spec.ts` trava esse formato, para mexer no texto do sufixo
-- doer la antes de calar este backfill.
--
-- O "A" com til nao aparece no padrao de proposito: se o arquivo chegar ao
-- banco com outro encoding, uma comparacao literal nao casaria e o backfill
-- viraria um silencio. "COMISS[^:]*:" casa de qualquer jeito.
--
-- Envelopado para nao derrubar o deploy: a API sobe rodando
-- `prisma migrate deploy`, e recuperar historico nao vale o preco de deixar o
-- sistema fora do ar. Falhando, o numero de vendas do passado fica em zero --
-- que e exatamente onde ele ja esta hoje -- e o aviso aparece no log.
DO $backfill$
BEGIN
  WITH lido AS (
    SELECT
      id,
      regexp_match(
        observacao,
        'COMISS[^:]*: ([0-9]+) x R[$] [0-9.,]+ = R[$] ([0-9.,]+)'
      ) AS partes
    FROM "contas_pagar"
    WHERE tipo = 'SALARIO' AND observacao LIKE '%COMISS%'
  )
  UPDATE "contas_pagar" c
  SET
    vendas = (lido.partes)[1]::int,
    -- "1.234,56" -> "1234.56": tira o ponto de milhar, virgula vira ponto.
    comissao_vendas =
      replace(replace((lido.partes)[2], '.', ''), ',', '.')::numeric
  FROM lido
  WHERE c.id = lido.id AND lido.partes IS NOT NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Comissao das folhas antigas nao foi recuperada: %', SQLERRM;
END
$backfill$;
