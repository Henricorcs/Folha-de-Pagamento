/**
 * Contas da diária: quantos dias, por quanto, e o texto que explica o
 * pagamento nos dois lugares onde ele aparece — a observação da conta a pagar
 * no IXC e o histórico da saída no caixa.
 */

/** Arredonda para centavos (dinheiro não tem terceira casa). */
function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Total de uma diária. `valor` informado vence o cálculo — é comum acertar um
 * valor redondo na hora (dois dias e meio de serviço por R$ 300).
 */
export function calcularTotalDiaria(input: {
  quantidade: number;
  valorDiaria: number;
  valor?: number | null;
}): number {
  if (input.valor != null && input.valor > 0) return arredondar(input.valor);
  return arredondar(input.quantidade * input.valorDiaria);
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
  return `${qtd} ${plural} de ${formatBRL(valorDiaria)}`;
}

/**
 * Observação da conta a pagar no IXC. Quem abrir o lançamento lá precisa
 * entender o pagamento sem voltar para cá: o serviço primeiro, a conta da
 * diária depois.
 */
export function montarObservacaoDiaria(input: {
  descricao: string;
  quantidade: number;
  valorDiaria: number;
}): string {
  const servico = input.descricao.trim();
  const conta = descreverDiarias(input.quantidade, input.valorDiaria);
  return servico ? `${servico} (${conta})` : `Diária (${conta})`;
}

/**
 * Histórico da saída no caixa. Aqui o nome de quem recebeu é obrigatório: na
 * movimentação financeira do IXC é só esse texto que sobra para conferir o
 * dinheiro que saiu da gaveta.
 */
export function montarHistoricoCaixa(input: {
  nome: string;
  descricao: string;
  quantidade: number;
  valorDiaria: number;
}): string {
  const partes = [
    `Diária ${input.nome.trim()}`,
    descreverDiarias(input.quantidade, input.valorDiaria),
  ];
  const servico = input.descricao.trim();
  if (servico) partes.push(servico);
  return partes.join(' — ');
}

/** R$ no formato brasileiro, para os textos que vão ao IXC. */
function formatBRL(valor: number): string {
  return `R$ ${arredondar(valor)
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
