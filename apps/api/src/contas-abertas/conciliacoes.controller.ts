import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { ConciliacoesService } from './conciliacoes.service';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export class CriarConciliacaoDto {
  @IsInt()
  @Min(1)
  conta!: number;

  @Matches(DATA_ISO, { message: 'de: use AAAA-MM-DD' })
  de!: string;

  @Matches(DATA_ISO, { message: 'ate: use AAAA-MM-DD' })
  ate!: string;

  /** Casar valor igual com data diferente, ou exigir o mesmo dia. */
  @IsOptional()
  @IsBoolean()
  datasDiferentes?: boolean;

  /** O texto do .ofx. Vai no corpo porque extrato de mês passa de um megabyte. */
  @IsOptional()
  @IsString()
  @MaxLength(8_000_000, {
    message: 'O extrato passa de 8 MB. Importe um período menor.',
  })
  ofx?: string;

  /** Nome do arquivo, só para a tela dizer de onde veio. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  arquivo?: string;
}

export class ImportarExtratoDto {
  @IsString()
  @MaxLength(8_000_000, {
    message: 'O extrato passa de 8 MB. Importe um período menor.',
  })
  ofx!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  arquivo?: string;
}

export class LigarDto {
  /** A transação do extrato. */
  @IsString()
  @MaxLength(120)
  fitId!: string;

  /** A linha da movimentação do IXC (`fn_movim_finan.id`). */
  @IsInt()
  @Min(1)
  idMovimFinan!: number;
}

export class IgnorarDto {
  @IsString()
  @MaxLength(120)
  fitId!: string;

  /**
   * Por que esta transação não é do contas a pagar. Obrigatório de propósito:
   * é o que separa "resolvi" de "tirei da frente".
   */
  @IsString()
  @MinLength(3, { message: 'Escreva por que esta transação fica de fora.' })
  @MaxLength(300)
  motivo!: string;
}

export class LinhasDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(2000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  ids!: number[];
}

function usuarioNome(req: Request): string | undefined {
  return (req.user as { nome?: string } | undefined)?.nome;
}

/**
 * As conciliações bancárias: uma conta, um período, um status.
 *
 * Só ADMIN, como o resto do dinheiro da casa.
 */
@Controller('contas-abertas/conciliacoes')
@Roles('ADMIN')
export class ConciliacoesController {
  constructor(private readonly service: ConciliacoesService) {}

  /** A grade das conciliações. */
  @Get()
  listar(@Query('conta') conta?: string) {
    const n = Number(conta);
    return this.service.listar({
      conta: Number.isInteger(n) && n > 0 ? n : undefined,
    });
  }

  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarConciliacaoDto, @Req() req: Request) {
    return this.service.criar({ ...dto, usuario: usuarioNome(req) });
  }

  /** O estado completo, para o assistente. */
  @Get(':id')
  abrir(@Param('id') id: string) {
    return this.service.abrir(id);
  }

  @Post(':id/extrato')
  @HttpCode(200)
  importarExtrato(@Param('id') id: string, @Body() dto: ImportarExtratoDto) {
    return this.service.importarExtrato(id, dto);
  }

  /** O botão "Conciliação automática". */
  @Post(':id/casar')
  @HttpCode(200)
  casar(@Param('id') id: string, @Req() req: Request) {
    return this.service.casarAutomatico(id, usuarioNome(req));
  }

  @Post(':id/ligar')
  @HttpCode(200)
  ligar(@Param('id') id: string, @Body() dto: LigarDto, @Req() req: Request) {
    return this.service.ligar(id, dto, usuarioNome(req));
  }

  @Post(':id/desligar')
  @HttpCode(200)
  desligar(@Param('id') id: string, @Body() dto: { fitId: string }) {
    return this.service.desligar(id, String(dto.fitId ?? ''));
  }

  @Post(':id/ignorar')
  @HttpCode(200)
  ignorar(@Param('id') id: string, @Body() dto: IgnorarDto) {
    return this.service.ignorar(id, dto.fitId, dto.motivo);
  }

  @Post(':id/desistir-de-ignorar')
  @HttpCode(200)
  desistirDeIgnorar(@Param('id') id: string, @Body() dto: { fitId: string }) {
    return this.service.desistirDeIgnorar(id, String(dto.fitId ?? ''));
  }

  /** Dá por conferida a linha do IXC que o extrato não tem. */
  @Post(':id/conferir')
  @HttpCode(200)
  conferir(@Param('id') id: string, @Body() dto: LinhasDto, @Req() req: Request) {
    return this.service.conferirLinhas(id, dto.ids, usuarioNome(req));
  }

  @Post(':id/desconferir')
  @HttpCode(200)
  desconferir(@Param('id') id: string, @Body() dto: LinhasDto) {
    return this.service.desconferirLinhas(id, dto.ids);
  }

  @Post(':id/fechar')
  @HttpCode(200)
  fechar(@Param('id') id: string, @Req() req: Request) {
    return this.service.fechar(id, usuarioNome(req));
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  reabrir(@Param('id') id: string) {
    return this.service.reabrir(id);
  }

  @Delete(':id')
  apagar(@Param('id') id: string) {
    return this.service.apagar(id);
  }
}
