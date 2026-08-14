import {
  IconeCalculo,
  IconeChave,
  IconeDia,
  IconeEngrenagem,
  IconeGuia,
  IconeMoeda,
  IconePainel,
  IconePessoas,
  IconeRecibo,
  IconeSaida,
  IconeSol,
  type Icone,
} from '../components/icones';

/**
 * O caminho é relativo à base do módulo: dentro de uma rota aninhada o
 * NavLink resolve `dashboard` como `/folha/dashboard` sozinho. Assim a base
 * aparece uma vez só, no módulo.
 */
export interface ItemMenu {
  to: string;
  label: string;
  icone: Icone;
  somenteAdmin?: boolean;
}

export interface Modulo {
  id: string;
  nome: string;
  /** O que o cartão promete de dentro do módulo. */
  descricao: string;
  base: string;
  /** Para onde o cartão leva — o caminho relativo da primeira tela. */
  inicio: string;
  icone: Icone;
  /** Cor do quadrado do ícone no cartão: cada módulo tem a sua. */
  tom: string;
  menu: ItemMenu[];
}

const folha: Modulo = {
  id: 'folha',
  nome: 'Folha de Pagamento',
  descricao:
    'Funcionários, diaristas, vales, férias, impostos e a folha do mês',
  base: '/folha',
  inicio: 'dashboard',
  icone: IconePessoas,
  tom: 'bg-brand-500/15 text-brand-300',
  menu: [
    { to: 'dashboard', label: 'Dashboard', icone: IconePainel },
    { to: 'funcionarios', label: 'Funcionários', icone: IconePessoas },
    { to: 'diaristas', label: 'Diaristas', icone: IconeDia },
    { to: 'vales', label: 'Vales e Acertos', icone: IconeMoeda },
    { to: 'ferias', label: 'Férias', icone: IconeSol },
    { to: 'gerar-folha', label: 'Gerar Folha', icone: IconeCalculo },
    { to: 'pagamentos', label: 'Pagamentos da Folha', icone: IconeSaida },
    { to: 'avulsos', label: 'Pagamentos Avulsos', icone: IconeRecibo },
    { to: 'impostos', label: 'Impostos', icone: IconeGuia },
    { to: 'configuracoes', label: 'Configurações', icone: IconeEngrenagem },
    {
      to: 'usuarios',
      label: 'Usuários',
      icone: IconeChave,
      somenteAdmin: true,
    },
  ],
};

const contasPagar: Modulo = {
  id: 'contas-pagar',
  nome: 'Contas a Pagar',
  descricao: 'Todas as saídas da empresa, com vencimentos e comprovantes',
  base: '/contas-pagar',
  inicio: 'inicio',
  icone: IconeSaida,
  tom: 'bg-emerald-500/15 text-emerald-300',
  menu: [{ to: 'inicio', label: 'Visão geral', icone: IconePainel }],
};

/** A ordem daqui é a ordem dos cartões na tela de módulos. */
export const MODULOS: Modulo[] = [folha, contasPagar];

export const MODULO_FOLHA = folha;
export const MODULO_CONTAS_PAGAR = contasPagar;

export function caminhoInicial(modulo: Modulo): string {
  return `${modulo.base}/${modulo.inicio}`;
}
