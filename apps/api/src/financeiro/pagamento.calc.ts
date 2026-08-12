/**
 * As partes de um pagamento a quem não é da folha — diarista ou beneficiário
 * avulso. Os dois recebem pelo mesmo desenho: o serviço (dias trabalhados ou
 * trabalho pontual), a comissão das vendas que fecharam e um extra quando
 * fizeram algo por fora no mesmo acerto.
 *
 * Sai **um pagamento só**: é assim que a pessoa recebe, e uma conta a pagar por
 * parte encheria a auditoria do IXC de linhas de R$ 50. As partes continuam
 * separadas no registro porque "quanto o mês custou em venda" é uma pergunta
 * que a dashboard responde.
 *
 * O total é sempre a soma das partes — não há campo de total que as
 * sobrescreva. Para fechar um número redondo, o número redondo é o serviço.
 */

import { formatValorBR } from './folha.calc';

export interface PartesDoPagamento {
  /** Dias trabalhados (diarista); zero quando o pagamento não é por dia */
  quantidade?: number;
  valorDiaria?: number;
  /** Trabalho pontual (avulso), que não é contado por dia */
  valorServico?: number;
  vendas?: number;
  valorPorVenda?: number;
  valorExtra?: number;
  /** O que foi o extra, quando vale dizer */
  descricaoExtra?: string | null;
}

/** Comissão das vendas fechadas: quantas × quanto cada uma paga. */
export function calcularComissaoVendas(p: PartesDoPagamento): number {
  return arredondar((p.vendas ?? 0) * (p.valorPorVenda ?? 0));
}

/** O serviço sozinho: os dias trabalhados, ou o valor do trabalho pontual. */
export function calcularServico(p: PartesDoPagamento): number {
  return arredondar(
    (p.quantidade ?? 0) * (p.valorDiaria ?? 0) + (p.valorServico ?? 0),
  );
}

/** Serviço + comissão de venda + extra: o que a pessoa recebe de uma vez. */
export function calcularTotalPagamento(p: PartesDoPagamento): number {
  return arredondar(
    calcularServico(p) +
      calcularComissaoVendas(p) +
      arredondar(p.valorExtra ?? 0),
  );
}

/**
 * Cada parte em uma frase, na ordem em que se confere: serviço, vendas, extra.
 * Parte zerada não aparece — dizer "0 vendas" só ocupa espaço.
 */
export function descreverPartes(p: PartesDoPagamento): string[] {
  const partes: string[] = [];

  const diarias = arredondar((p.quantidade ?? 0) * (p.valorDiaria ?? 0));
  if (diarias > 0) {
    partes.push(descreverDiarias(p.quantidade ?? 0, p.valorDiaria ?? 0));
  }
  const servico = arredondar(p.valorServico ?? 0);
  if (servico > 0) partes.push(`serviço ${formatValorBR(servico)}`);

  const comissao = calcularComissaoVendas(p);
  if (comissao > 0) {
    const plural = p.vendas === 1 ? 'venda' : 'vendas';
    partes.push(
      `${p.vendas} ${plural} de ${formatValorBR(p.valorPorVenda ?? 0)} = ` +
        formatValorBR(comissao),
    );
  }

  const extra = arredondar(p.valorExtra ?? 0);
  if (extra > 0) {
    const oQue = (p.descricaoExtra ?? '').trim();
    partes.push(`extra ${formatValorBR(extra)}${oQue ? `: ${oQue}` : ''}`);
  }

  return partes;
}

/** "2 diárias de R$ 120,00" — ou "1 diária de …" no singular. */
export function descreverDiarias(
  quantidade: number,
  valorDiaria: number,
): string {
  const qtd = Number.isInteger(quantidade)
    ? String(quantidade)
    : quantidade.toFixed(2).replace('.', ',');
  const plural = quantidade === 1 ? 'diária' : 'diárias';
  return `${qtd} ${plural} de ${formatValorBR(valorDiaria)}`;
}

/**
 * Observação da conta a pagar no IXC. Quem abrir o lançamento lá precisa
 * entender o pagamento sem voltar para cá: o serviço primeiro, a conta depois.
 */
export function montarObservacaoPagamento(
  p: PartesDoPagamento & { descricao: string },
): string {
  const oQue = p.descricao.trim();
  const conta = descreverPartes(p).join(' · ');
  return oQue ? `${oQue} (${conta})` : conta;
}

/**
 * Histórico da saída no caixa. Aqui o nome de quem recebeu é obrigatório: na
 * movimentação financeira do IXC é só esse texto que sobra para conferir o
 * dinheiro que saiu da gaveta.
 */
export function montarHistoricoCaixa(
  p: PartesDoPagamento & { nome: string; descricao: string },
): string {
  const temDiarias = (p.quantidade ?? 0) * (p.valorDiaria ?? 0) > 0;
  const linha = [
    `${temDiarias ? 'Diária' : 'Pagamento'} ${p.nome.trim()}`,
    descreverPartes(p).join(' · '),
  ];
  const oQue = p.descricao.trim();
  if (oQue) linha.push(oQue);
  return linha.join(' — ');
}

/** Arredonda para centavos (dinheiro não tem terceira casa). */
function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
