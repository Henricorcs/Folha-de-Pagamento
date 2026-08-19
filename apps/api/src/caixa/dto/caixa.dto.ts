import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const numeroOuIndefinido = ({ value }: { value: unknown }) =>
  value === '' || value == null ? undefined : Number(value);

/**
 * Teto da foto da nota, em caracteres do data URL.
 *
 * Um milhão de caracteres é ~750 KB de imagem — bem acima do que a tela manda
 * (ela reduz a foto antes de enviar) e bem abaixo do que uma foto crua de
 * celular teria. O limite existe para o caso de alguém mandar pela API: uma
 * tabela de fotos cruas enche o disco do servidor, que é o mesmo do banco.
 */
const TETO_DA_FOTO = 1_000_000;

const RECADO_DA_FOTO =
  'A foto ficou grande demais. Tire de novo pela tela, que ela reduz sozinha.';

export class PeriodoDoCaixaDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data inicial precisa estar no formato AAAA-MM-DD.',
  })
  de!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data final precisa estar no formato AAAA-MM-DD.',
  })
  ate!: string;
}

export class ConferirLancamentoDto {
  @IsOptional()
  @IsBoolean()
  conferido?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;
}

export class NotaDto {
  /** Data URL da imagem. `null` tira a foto que estava lá. */
  @IsOptional()
  @IsString()
  @MaxLength(TETO_DA_FOTO, { message: RECADO_DA_FOTO })
  @Matches(/^data:image\/(png|jpe?g|webp);base64,/, {
    message: 'A nota precisa ser uma imagem (PNG, JPEG ou WebP).',
  })
  notaFoto?: string | null;
}

/** Dinheiro que sai do caixa com alguém para pagar algo na rua. */
export class EntregarDinheiroDto {
  @IsInt()
  @Transform(numeroOuIndefinido)
  caixaId!: number;

  @IsString()
  @MinLength(2, { message: 'Diga com quem o dinheiro está.' })
  @MaxLength(120)
  pessoa!: string;

  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0.01, { message: 'O valor precisa ser maior que zero.' })
  valor!: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data da entrega precisa estar no formato AAAA-MM-DD.',
  })
  entregueEm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}

/**
 * A despesa que a prestação lança: onde o dinheiro da rua foi gasto.
 *
 * Sem ela o gasto fica sabido só aqui, e o caixa do IXC segue sem saber que
 * aquele dinheiro saiu — é a nota que existe na gaveta e não existe no
 * financeiro. Com ela, o gasto vira conta a pagar criada, aprovada e baixada
 * no caixa de onde o dinheiro saiu.
 */
export class DespesaDaPrestacaoDto {
  /** Quem recebeu, entre os fornecedores que já existem no IXC. */
  @Transform(numeroOuIndefinido)
  @IsInt({ message: 'Escolha o fornecedor da nota.' })
  @Min(1)
  idFornecedorIxc!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fornecedorNome!: string;

  /** O que foi comprado. Vira a observação do título no IXC. */
  @IsString()
  @MinLength(3, { message: 'Diga em que o dinheiro foi gasto.' })
  @MaxLength(500)
  descricao!: string;

  /**
   * Dia em que o dinheiro saiu (AAAA-MM-DD). Vazio = o dia da entrega.
   *
   * Quase sempre está no passado: quem levou dinheiro na segunda só senta para
   * prestar contas na sexta, e a saída no IXC tem de cair na segunda, ou o
   * caixa daquela semana não bate.
   */
  @IsOptional()
  @IsISO8601()
  pagoEm?: string;

  /** A etiqueta desta casa, para a despesa entrar classificada. */
  @IsOptional()
  @IsUUID()
  categoriaId?: string | null;

  /** Dinheiro, Pix… Vazio = o padrão das Configurações. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tipoPagamento?: string;

  /** Conta contábil (`id_conta`). Vazio = a de avulsos da configuração. */
  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsInt()
  @Min(1)
  contaContabil?: number;
}

/**
 * A prestação de contas de quem levou dinheiro.
 *
 * Nota e troco vêm juntos porque é a soma dos dois que fecha com o que saiu —
 * receber um sem o outro deixaria a diferença passar sem ninguém olhar.
 */
export class BaixarDinheiroDto {
  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0, { message: 'O valor da nota não pode ser negativo.' })
  valorGasto!: number;

  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0, { message: 'O troco não pode ser negativo.' })
  troco?: number;

  @IsOptional()
  @IsString()
  @MaxLength(TETO_DA_FOTO, { message: RECADO_DA_FOTO })
  @Matches(/^data:image\/(png|jpe?g|webp);base64,/, {
    message: 'A nota precisa ser uma imagem (PNG, JPEG ou WebP).',
  })
  notaFoto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;

  /**
   * A conta a pagar do que foi gasto. Vazio = prestação só registrada aqui,
   * que é o que se faz quando a despesa já foi lançada no IXC por outro
   * caminho.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => DespesaDaPrestacaoDto)
  despesa?: DespesaDaPrestacaoDto;
}

export class FecharCaixaDto {
  @IsInt()
  @Transform(numeroOuIndefinido)
  caixaId!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data inicial precisa estar no formato AAAA-MM-DD.',
  })
  de!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data final precisa estar no formato AAAA-MM-DD.',
  })
  ate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string;

  /**
   * Quanto havia na gaveta no início do período.
   *
   * Só faz falta no primeiro fechamento de cada caixa: do segundo em diante, o
   * anterior diz de onde a contagem parte.
   */
  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsNumber()
  saldoInicial?: number;

  /**
   * Quanto se contou na gaveta ao fechar.
   *
   * Opcional, mas é o número que faz o fechamento valer alguma coisa: sem ele o
   * período fecha pelo cálculo, e cálculo não encontra dinheiro que sumiu nem
   * dinheiro que apareceu.
   */
  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0, { message: 'A gaveta não conta valor negativo.' })
  saldoContado?: number;
}

/** A contagem da gaveta de um fechamento já assinado, corrigida. */
export class ContagemDaGavetaDto {
  @Transform(numeroOuIndefinido)
  @IsNumber({}, { message: 'Diga quanto foi contado na gaveta.' })
  @Min(0, { message: 'A gaveta não conta valor negativo.' })
  saldoContado!: number;
}
