/**
 * Clicar em qualquer ponto de um campo de data abre o calendário.
 *
 * O navegador só abre o calendário pelo ícone, no canto do campo — um alvo de
 * uns dezesseis pixels. Clicar sobre o dia, o mês ou o ano apenas seleciona
 * aquele pedaço para digitar, e quem esperava o calendário conclui que o campo
 * travou. São vinte campos de data e mês espalhados pelos dois módulos, e a
 * correção é sempre a mesma, então ela mora num ouvinte só, no documento, em
 * vez de vinte vezes na mão.
 *
 * Digitar continua funcionando: o campo segue com o foco e o calendário aberto
 * não impede que se escreva a data.
 */
export function abrirCalendarioAoClicar(): void {
  document.addEventListener('click', (evento) => {
    const alvo = evento.target;
    if (!(alvo instanceof HTMLInputElement)) return;
    if (alvo.type !== 'date' && alvo.type !== 'month') return;
    if (alvo.disabled || alvo.readOnly) return;

    try {
      alvo.showPicker();
    } catch {
      // Navegador sem `showPicker`, ou clique que ele não aceitou como gesto
      // da pessoa. Fica o comportamento nativo — o ícone continua abrindo.
    }
  });
}
