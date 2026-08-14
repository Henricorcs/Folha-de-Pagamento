-- Como a assinatura do recibo foi feita.
--
-- Nem todo mundo que trabalha por diaria assina o proprio nome. Para quem nao
-- escreve, a tela passa a gerar a assinatura a partir do nome completo -- e e
-- justamente por existir esse caminho que o modo precisa ficar gravado.
--
-- Um recibo que aparenta punho proprio sem ser nao vale mais que um sem
-- assinatura nenhuma: vale menos, porque engana quem o le. Entao o modo sai
-- impresso no PDF e aparece na tela, e o papel diz com todas as letras quando a
-- assinatura foi gerada a pedido de quem nao assina.
--
-- O que ja foi assinado ate aqui foi desenhado com o dedo, entao DESENHADA e o
-- padrao e tambem o valor certo para as linhas antigas.

-- CreateEnum
CREATE TYPE "ModoAssinatura" AS ENUM ('DESENHADA', 'DIGITADA');

-- AlterTable
ALTER TABLE "assinaturas_diaria"
  ADD COLUMN "modo" "ModoAssinatura" NOT NULL DEFAULT 'DESENHADA';
