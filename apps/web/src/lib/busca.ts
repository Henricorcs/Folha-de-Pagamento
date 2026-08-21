/**
 * Como esta casa compara texto digitado com texto guardado.
 *
 * Ninguém digita acento numa caixa de busca. Quem procura o posto escreve "sao
 * domin", e o que está guardado é "Posto São Domingos" — comparando cru, a tela
 * responde "nenhum pagamento aqui" para uma lista cheia deles, que é o pior
 * jeito de uma busca falhar: ela não erra o resultado, ela nega o que existe.
 *
 * Vale para o que é digitado e para o que vem do banco: os dois passam pela
 * mesma peneira antes de se encontrarem.
 */

/** Texto como a busca o vê: sem acento e sem caixa. */
export function semAcento(texto: string): string {
  // `\p{M}` é a classe dos acentos que o NFD separou da letra: em ASCII puro,
  // sem depender de como este arquivo foi salvo.
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/**
 * Algum destes campos contém o termo?
 *
 * O termo já vem peneirado por quem chama (uma vez por busca, e não uma vez por
 * linha); os campos são peneirados aqui. Campo vazio não conta.
 */
export function combina(
  campos: Array<string | null | undefined>,
  termo: string,
): boolean {
  if (!termo) return true;
  return campos.some((v) => !!v && semAcento(v).includes(termo));
}
