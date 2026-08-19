import { ExtratoIlegivel, lerNumero, lerOfx } from './conciliacao.ofx';

/**
 * O extrato chega como o banco manda, e cada um manda de um jeito.
 *
 * O que este arquivo protege é a leitura sobreviver às diferenças que já se
 * viu em arquivo de verdade: OFX que fecha as tags e OFX que não fecha, data
 * com e sem fuso, valor com vírgula, transação sem MEMO. E, sobretudo, que um
 * arquivo que não é extrato seja **recusado** em vez de virar um extrato vazio
 * — que na tela seria "o banco não movimentou nada", mandando alguém procurar
 * um problema que não existe.
 */

/** OFX 1.x, que é SGML: as tags de valor não fecham. */
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM><BANKID>756<BRANCHID>4436<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260801<DTEND>20260831
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260813120000[-03:BRT]
<TRNAMT>-756.57
<FITID>2026081300001
<CHECKNUM>36508
<MEMO>PAGAMENTO BOLETO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260814
<TRNAMT>82.91
<FITID>2026081400002
<NAME>REC TITULOS
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>15320.44<DTASOF>20260831</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

/** OFX 2.x, que é XML de verdade. */
const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<OFX>
  <BANKMSGSRSV1><STMTTRNRS><STMTRS>
    <BANKACCTFROM><BANKID>237</BANKID><ACCTID>0009999</ACCTID></BANKACCTFROM>
    <BANKTRANLIST>
      <STMTTRN>
        <TRNTYPE>DEBIT</TRNTYPE>
        <DTPOSTED>20260817</DTPOSTED>
        <TRNAMT>-50000,00</TRNAMT>
        <FITID>ABC123</FITID>
        <MEMO>PIX ENVIADO</MEMO>
        <NAME>MOISES DE OLIVEIRA SOUSA</NAME>
      </STMTTRN>
    </BANKTRANLIST>
  </STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe('lerOfx', () => {
  it('lê o OFX que não fecha as tags', () => {
    const extrato = lerOfx(OFX_SGML);

    expect(extrato.banco).toBe('756');
    expect(extrato.agencia).toBe('4436');
    expect(extrato.conta).toBe('12345-6');
    expect(extrato.de).toBe('2026-08-01');
    expect(extrato.ate).toBe('2026-08-31');
    expect(extrato.saldo).toBe(15320.44);
    expect(extrato.saldoEm).toBe('2026-08-31');
    expect(extrato.transacoes).toHaveLength(2);
  });

  it('guarda o sinal do banco: negativo é dinheiro que saiu', () => {
    const [saida, entrada] = lerOfx(OFX_SGML).transacoes;

    expect(saida.valor).toBe(-756.57);
    expect(saida.data).toBe('2026-08-13');
    expect(saida.documento).toBe('36508');
    expect(saida.descricao).toBe('PAGAMENTO BOLETO');

    expect(entrada.valor).toBe(82.91);
    expect(entrada.descricao).toBe('REC TITULOS');
  });

  it('lê o OFX em XML, com vírgula no valor', () => {
    const extrato = lerOfx(OFX_XML);

    expect(extrato.transacoes).toHaveLength(1);
    expect(extrato.transacoes[0].valor).toBe(-50000);
    expect(extrato.transacoes[0].fitId).toBe('ABC123');
  });

  it('junta MEMO e NAME, que dizem coisas diferentes', () => {
    expect(lerOfx(OFX_XML).transacoes[0].descricao).toBe(
      'PIX ENVIADO · MOISES DE OLIVEIRA SOUSA',
    );
  });

  it('não repete o texto quando o banco manda o mesmo nos dois campos', () => {
    const igual = OFX_XML.replace('<NAME>MOISES DE OLIVEIRA SOUSA</NAME>', '<NAME>PIX ENVIADO</NAME>');
    expect(lerOfx(igual).transacoes[0].descricao).toBe('PIX ENVIADO');
  });

  it('ignora o fuso: o dia é o que o banco escreveu', () => {
    // 20260813 às 00:00 no fuso -03 viraria dia 12 se alguém convertesse.
    const meiaNoite = OFX_SGML.replace('20260813120000[-03:BRT]', '20260813000000[-03:BRT]');
    expect(lerOfx(meiaNoite).transacoes[0].data).toBe('2026-08-13');
  });

  it('recusa arquivo que não é extrato, em vez de devolver extrato vazio', () => {
    expect(() => lerOfx('data;valor\n13/08/2026;-756,57')).toThrow(ExtratoIlegivel);
    expect(() => lerOfx('')).toThrow(ExtratoIlegivel);
  });

  it('recusa OFX sem nenhuma transação', () => {
    expect(() => lerOfx('<OFX><BANKTRANLIST></BANKTRANLIST></OFX>')).toThrow(
      /nenhuma transação/i,
    );
  });

  it('descarta a transação sem data ou sem valor, e mantém as boas', () => {
    const capenga = OFX_SGML.replace('<TRNAMT>82.91\n', '');
    const extrato = lerOfx(capenga);
    expect(extrato.transacoes).toHaveLength(1);
    expect(extrato.transacoes[0].valor).toBe(-756.57);
  });

  it('inventa um FITID quando o banco não manda — sem ele não há como referir a linha', () => {
    const semFitid = OFX_XML.replace('<FITID>ABC123</FITID>', '');
    expect(lerOfx(semFitid).transacoes[0].fitId).toBe('2026-08-17|-50000.00');
  });
});

describe('lerNumero', () => {
  it.each([
    ['-756.57', -756.57],
    ['-756,57', -756.57],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['0.00', 0],
    ['+15320.44', 15320.44],
  ])('%s → %s', (entrada, esperado) => {
    expect(lerNumero(entrada)).toBe(esperado);
  });

  it('devolve null para o que não é número', () => {
    expect(lerNumero('')).toBeNull();
    expect(lerNumero(null)).toBeNull();
  });
});
