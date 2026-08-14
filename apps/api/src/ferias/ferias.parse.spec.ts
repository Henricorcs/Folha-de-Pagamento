import type { ItemDoPdf } from '../pdf/pdf';
import {
  calcularDataLimite,
  conferir,
  lerPrevisaoDeFerias,
  PrevisaoIlegivelError,
} from './ferias.parse';

/**
 * A "Previsão de Férias" da contabilidade, lida do PDF.
 *
 * As posições abaixo são as do relatório de verdade (Fortes Pessoal, em
 * paisagem) — só os nomes são inventados, porque este repositório é público.
 * Elas importam: o relatório é uma tabela cujas colunas se encostam, e no texto
 * corrido o nome sai grudado no cargo ("FULANO DE TALTECNICO INSTALADOR"). É a
 * posição que separa um do outro.
 *
 * O que este arquivo protege:
 *  - nome e cargo saem inteiros e separados;
 *  - admissão não é confundida com data limite (as duas são datas soltas);
 *  - a fila não nasce de um PDF que não é este relatório.
 */

/** Colunas do relatório, na posição em que ele as desenha. */
const COL = {
  codigo: 30.4,
  nome: 64.1,
  cargo: 204.4,
  admissao: 339.4,
  periodo: 385.1,
  direito: 484.8,
  acumulados: 534.0,
  restam: 583.8,
  dataLimite: 610.8,
  faltam: 686.6,
};

/** Uma linha de empregado como o PDF a desenha. */
function linhaDoEmpregado(
  linha: number,
  campos: {
    codigo: string;
    nome: string;
    cargo: string;
    admissao: string;
    periodo: string;
    direito?: string;
    acumulados?: string;
    restam?: string;
    dataLimite?: string;
    faltam?: string;
  },
): ItemDoPdf[] {
  const itens: ItemDoPdf[] = [
    { texto: campos.codigo, linha, coluna: COL.codigo, largura: 26.9 },
    { texto: campos.nome, linha, coluna: COL.nome, largura: 108.3 },
    { texto: campos.cargo, linha, coluna: COL.cargo, largura: 95.8 },
    { texto: campos.admissao, linha, coluna: COL.admissao, largura: 40.3 },
    { texto: campos.periodo, linha, coluna: COL.periodo, largura: 89.6 },
    { texto: campos.direito ?? '30,0', linha, coluna: COL.direito, largura: 15.7 },
    { texto: campos.acumulados ?? '30,0', linha, coluna: COL.acumulados, largura: 15.7 },
    { texto: campos.restam ?? '30,0', linha, coluna: COL.restam, largura: 15.7 },
  ];
  if (campos.dataLimite) {
    itens.push({
      texto: campos.dataLimite,
      linha,
      coluna: COL.dataLimite,
      largura: 40.3,
    });
  }
  if (campos.faltam) {
    itens.push({ texto: campos.faltam, linha, coluna: COL.faltam, largura: 27.8 });
  }
  // O PDF não desenha em ordem de coluna — é o leitor que ordena.
  return [...itens].reverse();
}

const CABECALHO: ItemDoPdf[] = [
  { texto: 'Férias Previstas', linha: 31.7, coluna: 39.7, largura: 92.2 },
  {
    texto: 'EMPRESA DE TESTE LTDA - CNPJ: 11.222.333/0001-44',
    linha: 68.5,
    coluna: 52.1,
    largura: 347.3,
  },
  {
    texto: 'Período: 06/08/2026 a 06/08/2026',
    linha: 29.6,
    coluna: 73.2,
    largura: 124.5,
  },
  {
    texto: 'Nº de Meses Limite: 11',
    linha: 29.6,
    coluna: 83.8,
    largura: 83.1,
  },
  { texto: 'Código', linha: 30.4, coluna: 100.6, largura: 27.7 },
  { texto: 'Empregado', linha: 64.1, coluna: 100.6, largura: 44.3 },
  { texto: 'Cargo', linha: 204.4, coluna: 100.6, largura: 23.3 },
  { texto: 'Admissão', linha: 340.1, coluna: 100.6, largura: 38.5 },
  { texto: 'Período Aquisitivo', linha: 391.1, coluna: 100.6, largura: 71.2 },
  { texto: 'Direito', linha: 478.4, coluna: 95.8, largura: 25.5 },
  { texto: '(Dias)', linha: 482.3, coluna: 105.5, largura: 22.4 },
  { texto: 'Data Limite', linha: 610.8, coluna: 100.6, largura: 43.4 },
  { texto: 'Faltam', linha: 672.5, coluna: 95.8, largura: 26.0 },
  { texto: 'Dias/(Meses)', linha: 662.4, coluna: 105.5, largura: 49.2 },
  { texto: 'Previsão', linha: 721.8, coluna: 100.6, largura: 33.6 },
];

const RODAPE: ItemDoPdf[] = [
  {
    texto: 'Total Geral: 2 Empregado(s)',
    linha: 999,
    coluna: 700,
    largura: 100,
  },
];

const PRIMEIRA = linhaDoEmpregado(117.4, {
  codigo: '000055',
  nome: 'ANA PAULA DE SOUZA',
  cargo: 'COBRADOR(A) INTERNO',
  admissao: '24/11/2022',
  periodo: '24/11/2024 a 23/11/2025',
  dataLimite: '24/10/2026',
  faltam: '79/(2,6)',
});

/** Quem ainda está juntando os 12 meses: acumulou 27,5 dos 30. */
const SEGUNDA = linhaDoEmpregado(129.4, {
  codigo: '000075',
  nome: 'JOSUÉ COSTA DE CARVALHO',
  cargo: 'ATENDENTE CALL CENTER',
  admissao: '12/09/2024',
  periodo: '12/09/2025 a 11/09/2026',
  acumulados: '27,5',
  dataLimite: '12/08/2027',
  faltam: '371/(12,4)',
});

const PDF = [...CABECALHO, ...PRIMEIRA, ...SEGUNDA, ...RODAPE];

describe('lerPrevisaoDeFerias', () => {
  it('lê o cabeçalho do relatório', () => {
    const previsao = lerPrevisaoDeFerias(PDF);

    expect(previsao.dataRelatorio.toISOString()).toBe(
      '2026-08-06T00:00:00.000Z',
    );
    expect(previsao.empresa).toBe('EMPRESA DE TESTE LTDA');
    expect(previsao.cnpj).toBe('11.222.333/0001-44');
    expect(previsao.mesesLimite).toBe(11);
    expect(previsao.totalDeclarado).toBe(2);
  });

  it('separa nome e cargo, que no texto corrido saem colados', () => {
    const [primeiro, segundo] = lerPrevisaoDeFerias(PDF).itens;

    expect(primeiro.nome).toBe('ANA PAULA DE SOUZA');
    expect(primeiro.cargo).toBe('COBRADOR(A) INTERNO');
    expect(segundo.nome).toBe('JOSUÉ COSTA DE CARVALHO');
    expect(segundo.cargo).toBe('ATENDENTE CALL CENTER');
  });

  it('lê as datas que governam a fila', () => {
    const [primeiro] = lerPrevisaoDeFerias(PDF).itens;

    expect(primeiro.ordem).toBe(1);
    expect(primeiro.codigo).toBe('000055');
    expect(dia(primeiro.admissao)).toBe('2022-11-24');
    expect(dia(primeiro.periodoInicio)).toBe('2024-11-24');
    expect(dia(primeiro.periodoFim)).toBe('2025-11-23');
    expect(dia(primeiro.dataLimite)).toBe('2026-10-24');
  });

  it('lê os dias de direito e o que já foi acumulado', () => {
    const [primeiro, segundo] = lerPrevisaoDeFerias(PDF).itens;

    expect(primeiro.diasDireito).toBe(30);
    expect(primeiro.diasAcumulados).toBe(30);
    expect(primeiro.diasRestantes).toBe(30);
    // Ainda dentro do período aquisitivo: 2,5 dias por mês trabalhado.
    expect(segundo.diasAcumulados).toBe(27.5);
  });

  it('calcula a data limite quando o relatório não traz a coluna', () => {
    const semLimite = [
      ...CABECALHO,
      ...linhaDoEmpregado(117.4, {
        codigo: '000055',
        nome: 'ANA PAULA DE SOUZA',
        cargo: 'COBRADOR(A) INTERNO',
        admissao: '24/11/2022',
        periodo: '24/11/2024 a 23/11/2025',
      }),
    ];

    const [item] = lerPrevisaoDeFerias(semLimite).itens;
    expect(dia(item.dataLimite)).toBe('2026-10-24');
    // A admissão continua sendo admissão: ela é anterior ao período.
    expect(dia(item.admissao)).toBe('2022-11-24');
  });

  it('não confunde matrícula curta com contagem de dias', () => {
    const curta = [
      ...CABECALHO,
      ...linhaDoEmpregado(117.4, {
        codigo: '055',
        nome: 'ANA PAULA DE SOUZA',
        cargo: 'COBRADOR(A) INTERNO',
        admissao: '24/11/2022',
        periodo: '24/11/2024 a 23/11/2025',
        dataLimite: '24/10/2026',
      }),
    ];

    const [item] = lerPrevisaoDeFerias(curta).itens;
    expect(item.codigo).toBe('055');
    expect(item.diasDireito).toBe(30);
  });

  it('recusa PDF que não é este relatório', () => {
    expect(() =>
      lerPrevisaoDeFerias([
        { texto: 'DARF', linha: 10, coluna: 10, largura: 20 },
      ]),
    ).toThrow(PrevisaoIlegivelError);
  });

  it('recusa relatório sem nenhuma linha de empregado', () => {
    expect(() => lerPrevisaoDeFerias([...CABECALHO, ...RODAPE])).toThrow(
      /nenhuma linha de empregado/i,
    );
  });
});

describe('conferir', () => {
  it('cala quando o que foi lido bate com o rodapé', () => {
    expect(conferir(lerPrevisaoDeFerias(PDF))).toBeNull();
  });

  it('avisa quando escapou gente', () => {
    const faltando = [...CABECALHO, ...PRIMEIRA, ...RODAPE];
    expect(conferir(lerPrevisaoDeFerias(faltando))).toMatch(
      /diz ter 2 empregado\(s\), e eu li 1/,
    );
  });
});

describe('calcularDataLimite', () => {
  it('é o fim do período concessivo menos os dias de férias', () => {
    // O mesmo que a contabilidade imprime nestes dois casos.
    expect(dia(calcularDataLimite(iso('2025-11-23'), 30))).toBe('2026-10-24');
    expect(dia(calcularDataLimite(iso('2026-03-14'), 30))).toBe('2027-02-12');
  });
});

function dia(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function iso(texto: string): Date {
  return new Date(`${texto}T00:00:00.000Z`);
}
