-- O ICMS tambem e pago todo mes, e nao vinha por nenhuma das guias federais:
-- ele chega no DARE do estado (na pratica, o DIFAL). E receita estadual, entao
-- entra inteiro como tributo sobre faturamento -- nada dele e custo de pessoal.
--
-- O valor novo vai depois de DAS_SIMPLES e antes de OUTRA para o enum seguir a
-- ordem de leitura das guias; no Postgres isso e um ADD VALUE posicionado, sem
-- reescrever a tabela.

-- AlterEnum
ALTER TYPE "TipoGuia" ADD VALUE IF NOT EXISTS 'DARE_ICMS' BEFORE 'OUTRA';
