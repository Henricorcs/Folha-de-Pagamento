-- O fornecedor tem, na aba "Dados bancarios", um tipo de PIX preferencial
-- (celular, CPF/CNPJ, e-mail). A conta a pagar do IXC passa a marcar o mesmo
-- tipo, em vez de deduzir pelo formato da chave.
ALTER TABLE "funcionarios" ADD COLUMN "tipo_chave_pix" TEXT;
