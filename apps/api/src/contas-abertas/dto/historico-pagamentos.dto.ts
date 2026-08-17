import { IsOptional, Matches } from 'class-validator';

/**
 * O período do histórico, em datas ISO ("2026-08-17").
 *
 * As duas pontas são opcionais e o serviço completa o que faltar. O formato é
 * exigido em vez de aceito de qualquer jeito porque "01/08/2026" e "2026-08-01"
 * lidos pelo mesmo caminho já trocaram dia por mês em outros lugares — e aqui
 * isso mostraria o histórico do mês errado com cara de certo.
 */
export class PeriodoPagamentosDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data inicial precisa estar no formato AAAA-MM-DD.',
  })
  de?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data final precisa estar no formato AAAA-MM-DD.',
  })
  ate?: string;
}
