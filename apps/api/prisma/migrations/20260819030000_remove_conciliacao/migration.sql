-- A conciliação bancária sai do app.
--
-- O motivo é do IXC, não do código: o webservice dele não deixa registrar
-- conciliação. O campo `fn_movim_finan.conciliado` é legível por filtro e
-- ignorado em toda escrita (POST, PUT e as variações de header foram testadas
-- numa linha descartável), e a tabela da tela -- `fn_conciliacao_lote`, com o
-- assistente em `fn_conciliacao_lote_wizard`, botão da tela 31544 -- não é
-- servida pela API desta instalação.
--
-- Sem isso, conciliar aqui criava uma segunda verdade sobre o dinheiro da
-- empresa, que envelhece sozinha ao lado da do IXC. O que estas tabelas
-- guardavam era só o estado da conferência; nada de financeiro morava nelas --
-- baixa e despesa sempre foram escritas no IXC e continuam lá.
--
-- O achado sobre o webservice está em `docs/ixc/README.md`, para quem voltar ao
-- assunto quando o suporte do IXC liberar os recursos.

DROP TABLE IF EXISTS "conciliacao_transacoes";
DROP TABLE IF EXISTS "conciliacao_linhas";
DROP TABLE IF EXISTS "conciliacoes";

DROP TYPE IF EXISTS "OrigemConciliacao";
DROP TYPE IF EXISTS "StatusConciliacao";
