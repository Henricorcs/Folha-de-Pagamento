-- O que o app descobriu sozinho sobre o radio "Tipo da chave Pix" do fn_apagar.
-- Guardado no banco para nao reaprender a cada reinicio da API, e para nao
-- depender de a conta-exemplo continuar dentro das 200 mais recentes do IXC.
-- Os codigos se acumulam por tipo (CPF/CNPJ, Celular, E-mail, Aleatoria,
-- copia e cola): cada um e aprendido uma vez e fica sabido.
ALTER TABLE "config_financeira" ADD COLUMN "pix_campo_tipo_chave_aprendido" TEXT NOT NULL DEFAULT '';
ALTER TABLE "config_financeira" ADD COLUMN "pix_codigos_tipo_chave_aprendidos" TEXT NOT NULL DEFAULT '';
