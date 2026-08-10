import { conferir, GuiaIlegivelError, lerGuia, parseValor } from './guias.parse';

/**
 * Os textos abaixo são cópias fiéis do que o leitor de PDF devolve para as
 * guias de verdade — mesma ordem de linhas, mesmas tabulações, mesmas colunas
 * embaralhadas. Só CNPJ, razão social, números de documento e valores foram
 * trocados por fictícios: o que se testa aqui é o layout, não o dinheiro.
 */

const DARF_INSS = `Documento de Arrecadação
de Receitas Federais
11.222.333/0001-44 EMPRESA EXEMPLO SERVICOS LTDA
Período de Apuração Data de Vencimento Número do Documento
07.16.11111.2222222-3 Pagar este documento até
20/08/2026\tObservações
Nº Recibo Declaração: 50000000000001 Valor Total do Documento
1.234,56
CNPJ Razão Social
Julho/2026 20/08/2026
Código Principal\tDenominação Total\tMulta Juros
Composição do Documento de Arrecadação
1082 CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO 1.000,00 1.000,00
01 CP SEGURADOS - EMPREGADOS/AVULSO
PA:07/2026 Vencimento:20/08/2026
1099 CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL 234,56 234,56
01 CP SEGURADOS - CONTRIBUINTES INDIVIDUAIS - 11%
PA:07/2026 Vencimento:20/08/2026
Totais 1.234,56 1.234,56
SENDA (Versão:5.2.10) 07/08/2026 14:50:43\t1 1\tPágina: /
85830000043 2 10760385262 2 32071626219 7 81347004552 6 AUTENTICAÇÃO MECÂNICA
Documento de Arrecadação de Receitas Federais
85830000043 2 10760385262 2 32071626219 7 11.222.333/0001-44
Número: 07.16.11111.2222222-3
Pagar até: 20/08/2026
Valor: 1.234,56
81347004552 6 CNPJ:
Pague com o PIX
`;

const DAS_SIMPLES = `Documento de Arrecadação
do Simples Nacional
11.222.333/0001-44 EMPRESA EXEMPLO SERVICOS LTDA
Período de Apuração Data de Vencimento Número do Documento
07.20.11111.3333333-2 Pagar este documento até
20/07/2026\tObservações
Valor Total do Documento
6.500,00
CNPJ Razão Social
Junho/2026 20/07/2026
Código Principal\tDenominação Total\tMulta Juros
Composição do Documento de Arrecadação
1001 IRPJ - SIMPLES NACIONAL 100,00 100,00
06/2026
1002 CSLL - SIMPLES NACIONAL 200,00 200,00
06/2026
1004 COFINS - SIMPLES NACIONAL 300,00 300,00
06/2026
1005 PIS - SIMPLES NACIONAL 400,00 400,00
06/2026
1006 INSS - SIMPLES NACIONAL 5.000,00 5.000,00
06/2026
1007 ICMS - SIMPLES NACIONAL 500,00 500,00
MA - 06/2026
Totais 6.500,00 6.500,00
SENDA (Versão:5.2.9) 16/07/2026 11:55:51\t1 1\tPágina: /
85870000226 2 88270328262 5 01072026197 7 59903383128 0 AUTENTICAÇÃO MECÂNICA
Documento de Arrecadação do Simples Nacional
85870000226 2 88270328262 5 01072026197 7 11.222.333/0001-44
Número: 07.20.11111.3333333-2
Pagar até: 20/07/2026
Valor: 6.500,00
59903383128 0 CNPJ:
Pague com o PIX
`;

const FGTS = `CPF/CNPJ do Empregador
11.222.333
Nome/Razão Social do Empregador
EMPRESA EXEMPLO SERVICOS LTDA
Núm. de Pág.
1
Identificador
0126080754056798-7
Tag
11222333 07/2026 MENSAL
Pagar este documento até
20/08/2026
Valor a recolher
2.500,00
GFD - Guia do FGTS Digital
às 21:59:59 (Brasília)
Composição do Documento
Competência
Quantidade
Trabalhadores FGTS Mensal FGTS Rescisório
Indenização
Compensatória Encargos FGTS Total
2.000,00\t0,00\t2.000,00 0,00 0,00\t07/2026 12
Total FGTS: 2.000,00\t0,00\t2.000,00 0,00 0,00
Informações de recolhimentos do FGTS
Competência Consignado Total\tEncargos Consignado
500,00\t500,00\t07/2026 0,00
500,00\tTotal Consignado: 500,00\t0,00
Total da Guia: 2.500,00
Informações de recolhimentos do Consignado
Observações
Data de geração da Guia: 07/08/2026 às 14:48:47 - Página 1/1
O detalhamento da guia pode ser consultado através do endereço https://fgtsdigital.sistema.gov.br
PIX Copia e Cola:
`;

describe('DARF previdenciário', () => {
  const guia = lerGuia(DARF_INSS);

  it('lê competência, vencimento e total', () => {
    expect(guia).toMatchObject({
      tipo: 'DARF_INSS',
      competencia: '2026-07',
      vencimento: '2026-08-20',
      valorTotal: 1234.56,
      numeroDocumento: '07.16.11111.2222222-3',
      cnpj: '11.222.333/0001-44',
      razaoSocial: 'EMPRESA EXEMPLO SERVICOS LTDA',
    });
  });

  /**
   * O que a empresa desconta do trabalhador e repassa não é custo dela. Marcar
   * como patronal aqui inflaria o "quanto custa meu funcionário".
   */
  it('trata os dois códigos como retido do trabalhador', () => {
    expect(guia.itens).toEqual([
      {
        codigo: '1082',
        denominacao: 'CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO',
        valor: 1000,
        classe: 'FOLHA_RETIDO',
        classeIncerta: false,
      },
      {
        codigo: '1099',
        denominacao: 'CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL',
        valor: 234.56,
        classe: 'FOLHA_RETIDO',
        classeIncerta: false,
      },
    ]);
  });

  /** Linhas soltas do documento não podem virar item da composição. */
  it('ignora rodapé, código de barras e detalhe do item', () => {
    expect(guia.itens).toHaveLength(2);
  });

  it('a soma dos itens bate com o total impresso', () => {
    expect(conferir(guia)).toBeNull();
  });
});

describe('DAS do Simples Nacional', () => {
  const guia = lerGuia(DAS_SIMPLES);

  it('lê a competência do mês anterior ao vencimento', () => {
    expect(guia).toMatchObject({
      tipo: 'DAS_SIMPLES',
      competencia: '2026-06',
      vencimento: '2026-07-20',
      valorTotal: 6500,
    });
  });

  /**
   * O ponto do documento inteiro: dentro do DAS, só o INSS é custo de pessoal.
   * Somar o DAS todo como "imposto da folha" mais que dobra o número.
   */
  it('separa o INSS patronal do tributo sobre faturamento', () => {
    const porClasse = (classe: string) =>
      guia.itens
        .filter((i) => i.classe === classe)
        .reduce((s, i) => s + i.valor, 0);

    expect(porClasse('FOLHA_PATRONAL')).toBe(5000);
    expect(porClasse('FATURAMENTO')).toBe(1500);
    expect(guia.itens.every((i) => !i.classeIncerta)).toBe(true);
  });

  it('a soma dos itens bate com o total impresso', () => {
    expect(conferir(guia)).toBeNull();
  });
});

describe('guia do FGTS Digital', () => {
  const guia = lerGuia(FGTS);

  it('lê pelos totais rotulados, não pela posição das colunas', () => {
    expect(guia).toMatchObject({
      tipo: 'FGTS',
      competencia: '2026-07',
      vencimento: '2026-08-20',
      valorTotal: 2500,
      trabalhadores: 12,
      razaoSocial: 'EMPRESA EXEMPLO SERVICOS LTDA',
      numeroDocumento: '0126080754056798-7',
    });
  });

  /** Consignado é empréstimo do trabalhador sendo repassado — não é tributo. */
  it('separa o FGTS do consignado', () => {
    expect(guia.itens).toEqual([
      {
        codigo: null,
        denominacao: 'FGTS mensal',
        valor: 2000,
        classe: 'FOLHA_PATRONAL',
        classeIncerta: false,
      },
      {
        codigo: null,
        denominacao: 'Consignado retido do trabalhador',
        valor: 500,
        classe: 'FOLHA_RETIDO',
        classeIncerta: false,
      },
    ]);
  });

  it('a soma dos itens bate com o total da guia', () => {
    expect(conferir(guia)).toBeNull();
  });
});

describe('quando o leitor não dá conta', () => {
  it('PDF de outra coisa não vira guia', () => {
    expect(() => lerGuia('Nota fiscal de serviço\nValor: 100,00')).toThrow(
      GuiaIlegivelError,
    );
  });

  /**
   * Código de receita que ainda não existia. O lançamento não trava — mas o
   * item sai marcado para alguém conferir a classificação na tela.
   */
  it('código desconhecido é lido, classificado no palpite e marcado', () => {
    const guia = lerGuia(
      DARF_INSS.replace(
        '1099 CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL 234,56 234,56',
        '1410 CONTRIBUICAO NOVA QUALQUER 234,56 234,56',
      ),
    );
    const novo = guia.itens[1];
    expect(novo).toMatchObject({
      codigo: '1410',
      classe: 'FATURAMENTO',
      classeIncerta: true,
    });
  });

  /** Item perdido na leitura tem de aparecer como divergência, não passar. */
  it('avisa quando a soma dos itens não fecha com o total', () => {
    const guia = lerGuia(DARF_INSS.replace('Valor: 1.234,56', 'Valor: 9.999,99'));
    expect(conferir(guia)).toMatch(/não bate/);
  });
});

describe('parseValor', () => {
  it('entende o formato brasileiro', () => {
    expect(parseValor('4.310,76')).toBe(4310.76);
    expect(parseValor('22.688,27')).toBe(22688.27);
    expect(parseValor('178,31')).toBe(178.31);
  });
});
