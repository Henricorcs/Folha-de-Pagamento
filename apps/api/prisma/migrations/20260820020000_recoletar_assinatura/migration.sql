-- Coletar a assinatura de novo.
--
-- Assinado era o fim: o link morria e nao havia como reabrir. Na pratica ha
-- motivo -- a pessoa assinou no lugar errado, assinou com o dedo tremido e o
-- traco saiu ilegivel, ou quem entregou o celular era outra pessoa. Sem
-- caminho, a saida era apagar a diaria e lancar de novo, o que mexe no caixa
-- para consertar um rabisco.
--
-- Agora da para reabrir, e a tela pergunta antes: substituir apaga a assinatura
-- que esta la.
--
-- Enquanto a nova nao chega, a antiga fica. O recibo dela pode ja ser a nota de
-- um lancamento do caixa, e limpar a assinatura no momento de reabrir deixaria
-- essa nota sem documento ate alguem assinar de novo.
ALTER TABLE "assinaturas_diaria"
  ADD COLUMN "recoletando_desde" TIMESTAMP(3),
  ADD COLUMN "recoletado_por"    TEXT,
  -- Quantas vezes foi refeita. Nao e enfeite: um recibo assinado tres vezes e
  -- uma pergunta que alguem vai querer fazer.
  ADD COLUMN "recoletas"         INTEGER NOT NULL DEFAULT 0;
