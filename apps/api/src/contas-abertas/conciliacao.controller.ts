import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { ConciliacaoService } from './conciliacao.service';

/** "AAAA-MM-DD" — o formato em que datas andam entre a tela e a API. */
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export class VerConciliacaoDto {
  @IsInt()
  @Min(1)
  conta!: number;

  @Matches(DATA_ISO, { message: 'de: use AAAA-MM-DD' })
  de!: string;

  @Matches(DATA_ISO, { message: 'ate: use AAAA-MM-DD' })
  ate!: string;

  /**
   * O texto do arquivo OFX, quando há extrato para cruzar.
   *
   * Vai no corpo, e por isso esta leitura é POST: extrato de mês cheio de conta
   * movimentada passa de um megabyte, e isso não cabe numa URL.
   */
  @IsOptional()
  @IsString()
  @MaxLength(8_000_000, {
    message: 'O extrato passa de 8 MB. Importe um período menor.',
  })
  ofx?: string;
}

export class LinhaConferidaDto {
  /** `fn_movim_finan.id` */
  @IsInt()
  @Min(1)
  id!: number;

  @Matches(DATA_ISO, { message: 'data: use AAAA-MM-DD' })
  data!: string;

  @IsNumber()
  valor!: number;

  /** `FITID` da transação do extrato, quando a conferência veio de um arquivo. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fitId?: string;
}

export class ConferirDto {
  @IsInt()
  @Min(1)
  conta!: number;

  @IsArray()
  // Um lote grande é só escrita no banco daqui, sem ida ao IXC — mas mil
  // linhas por clique já é mais do que qualquer extrato de um mês.
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => LinhaConferidaDto)
  linhas!: LinhaConferidaDto[];
}

export class DesconferirDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  ids!: number[];
}

export class BaixarDto {
  /** O título que a saída do extrato pagou. */
  @IsInt()
  @Min(1)
  idFnApagar!: number;

  /** A conta da conciliação — de onde o dinheiro saiu, segundo o extrato. */
  @IsInt()
  @Min(1)
  conta!: number;

  /** O dia em que o banco lançou. */
  @Matches(DATA_ISO, { message: 'data: use AAAA-MM-DD' })
  data!: string;
}

function usuarioNome(req: Request): string | undefined {
  return (req.user as { nome?: string } | undefined)?.nome;
}

/**
 * A conciliação bancária: o extrato do banco contra a movimentação do IXC.
 *
 * Só ADMIN. A leitura já mostra a conta inteira da empresa, e a baixa daqui
 * quita um título de verdade no IXC — as duas coisas são de quem cuida do
 * dinheiro, não de quem só lança folha.
 */
@Controller('contas-abertas/conciliacao')
@Roles('ADMIN')
export class ConciliacaoController {
  constructor(private readonly service: ConciliacaoService) {}

  /** As contas de banco e caixa que dá para conciliar. */
  @Get('contas')
  contas() {
    return this.service.contas();
  }

  /** A conciliação de uma conta num período, com ou sem extrato. */
  @Post('ver')
  @HttpCode(200)
  ver(@Body() dto: VerConciliacaoDto) {
    return this.service.ver(dto);
  }

  @Post('conferir')
  @HttpCode(200)
  conferir(@Body() dto: ConferirDto, @Req() req: Request) {
    return this.service.conferir(dto.conta, dto.linhas, usuarioNome(req));
  }

  @Post('desconferir')
  @HttpCode(200)
  desconferir(@Body() dto: DesconferirDto) {
    return this.service.desconferir(dto.ids);
  }

  /** Títulos em aberto que podem ser a saída que apareceu no extrato. */
  @Get('titulos-abertos')
  titulosEmAberto(
    @Query('valor') valor?: string,
    @Query('data') data?: string,
    @Query('busca') busca?: string,
  ) {
    const numero = Number(valor);
    return this.service.titulosEmAberto({
      valor: Number.isFinite(numero) && numero > 0 ? numero : undefined,
      data: data && DATA_ISO.test(data) ? data : undefined,
      busca: busca?.trim() || undefined,
    });
  }

  /** Dá baixa no título que a linha do extrato pagou. */
  @Post('baixar')
  @HttpCode(200)
  baixar(@Body() dto: BaixarDto, @Req() req: Request) {
    return this.service.baixar({ ...dto, usuario: usuarioNome(req) });
  }
}
