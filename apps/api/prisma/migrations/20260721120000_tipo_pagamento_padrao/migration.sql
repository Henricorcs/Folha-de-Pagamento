-- Tipo de pagamento configurável para o fn_apagar (ex.: "Dinheiro", "Pix")
ALTER TABLE "config_financeira"
  ADD COLUMN "tipo_pagamento_padrao" TEXT NOT NULL DEFAULT 'Dinheiro';
