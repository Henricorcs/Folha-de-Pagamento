-- Radio "Tipo da chave Pix" da conta a pagar do IXC. Em branco o banco recusa
-- o PIX, e o nome da coluna / o codigo de cada tipo variam por instalacao.
-- Vazio = o app aprende das contas feitas na tela do IXC.
ALTER TABLE "config_financeira" ADD COLUMN "pix_campo_tipo_chave" TEXT NOT NULL DEFAULT '';
-- Formato: "Celular=C,E-mail=E,CPF/CNPJ=D,Aleatoria=A"
ALTER TABLE "config_financeira" ADD COLUMN "pix_codigos_tipo_chave" TEXT NOT NULL DEFAULT '';
