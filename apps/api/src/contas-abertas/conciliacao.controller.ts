import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/roles.decorator';
import { ConciliacaoService } from './conciliacao.service';

/** Quais pagamentos refazer. Vem da lista que a tela mostrou. */
export class CorrigirConciliacaoDto {
  @IsArray()
  @ArrayNotEmpty()
  // Cada título é um estorno mais uma baixa no IXC — duas escritas, e o
  // dobro disso em leituras de conferência. Lote grande estoura o tempo da
  // requisição no meio, que é justamente quando um título fica em aberto.
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  idsFnApagar!: number[];
}

/**
 * O conserto dos pagamentos que não chegaram à conciliação bancária.
 *
 * Só ADMIN: cada correção estorna e refaz uma baixa no financeiro de verdade
 * da empresa, e entre uma coisa e outra o título fica em aberto.
 */
@Controller('contas-abertas/conciliacao')
@Roles('ADMIN')
export class ConciliacaoController {
  constructor(private readonly service: ConciliacaoService) {}

  /** Lista o que está fora da conciliação. Não toca em nada. */
  @Get('pendentes')
  pendentes() {
    return this.service.pendentes();
  }

  @Post('corrigir')
  @HttpCode(200)
  corrigir(@Body() dto: CorrigirConciliacaoDto) {
    return this.service.corrigir(dto.idsFnApagar);
  }
}
