/**
 * O extrato do banco, lido do arquivo que ele exporta: OFX.
 *
 * Vale para os dois OFX que existem por aí, porque os bancos brasileiros
 * mandam tanto um quanto o outro:
 *
 * - **OFX 1.x**, que é SGML: as tags de valor não fecham (`<TRNAMT>-10.00`) e
 *   só as de bloco fecham (`</STMTTRN>`);
 * - **OFX 2.x**, que é XML de verdade (`<TRNAMT>-10.00</TRNAMT>`).
 *
 * Ler os dois com uma regra só é possível porque o que interessa está sempre
 * numa linha: o valor de uma tag vai do `>` até o próximo `<` ou até a quebra
 * de linha. Um parser de XML de verdade recusaria metade dos arquivos.
 *
 * Nada aqui fala com o IXC nem com o banco de dados: entra texto, sai extrato.
 */

/** Uma transação do extrato. */
export interface TransacaoExtrato {
  /**
   * `FITID` — o identificador que o banco dá à transação. Ele não se repete
   * dentro da mesma conta, e é por ele que se reconhece a mesma transação
   * quando o extrato é importado de novo.
   */
  fitId: string;
  /** "AAAA-MM-DD" */
  data: string;
  /** Positivo = entrou na conta; negativo = saiu. */
  valor: number;
  /** O que o banco escreveu (MEMO e NAME, quando os dois vêm). */
  descricao: string;
  /** `CHECKNUM`/`REFNUM` — costuma ser o número do documento. */
  documento: string | null;
  /** `TRNTYPE`: DEBIT, CREDIT, XFER, PAYMENT… */
  tipo: string | null;
}

/** O extrato inteiro: a conta, o período e o que passou nela. */
export interface ExtratoImportado {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  /** "AAAA-MM-DD" — período que o arquivo diz cobrir. */
  de: string | null;
  ate: string | null;
  /** `LEDGERBAL`: o saldo que o banco declara, e o dia dele. */
  saldo: number | null;
  saldoEm: string | null;
  transacoes: TransacaoExtrato[];
}

/** O arquivo não é um extrato, ou é um extrato sem nada dentro. */
export class ExtratoIlegivel extends Error {}

/**
 * Lê o texto de um arquivo OFX.
 *
 * Lança `ExtratoIlegivel` quando não há transação nenhuma — em vez de devolver
 * um extrato vazio, que na tela viraria "o banco não movimentou nada neste
 * período" e mandaria alguém procurar um problema que não existe.
 */
export function lerOfx(texto: string): ExtratoImportado {
  const conteudo = String(texto ?? '');
  if (!conteudo.trim()) {
    throw new ExtratoIlegivel('O arquivo está vazio.');
  }

  const blocos = [...conteudo.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
  if (blocos.length === 0) {
    throw new ExtratoIlegivel(
      !/<OFX>/i.test(conteudo)
        ? 'Este arquivo não é um OFX. Baixe o extrato do banco no formato OFX ' +
          '(também chamado de "Money" ou "MS Money" em alguns bancos).'
        : 'O OFX não traz nenhuma transação (não achei nenhum bloco STMTTRN). ' +
          'Confira se o período pedido ao banco tem movimento.',
    );
  }

  const transacoes: TransacaoExtrato[] = [];
  for (const [, bloco] of blocos) {
    const transacao = lerTransacao(bloco);
    if (transacao) transacoes.push(transacao);
  }

  if (transacoes.length === 0) {
    throw new ExtratoIlegivel(
      'O OFX tem transações, mas nenhuma com data e valor legíveis.',
    );
  }

  const saldo = lerNumero(tag(conteudo, 'BALAMT'));

  return {
    banco: tag(conteudo, 'BANKID'),
    agencia: tag(conteudo, 'BRANCHID'),
    conta: tag(conteudo, 'ACCTID'),
    de: lerData(tag(conteudo, 'DTSTART')),
    ate: lerData(tag(conteudo, 'DTEND')),
    saldo,
    saldoEm: lerData(tag(conteudo, 'DTASOF')),
    // Do mais antigo para o mais novo, que é a ordem em que se confere o
    // extrato. Nem todo banco manda nessa ordem.
    transacoes: transacoes.sort((a, b) => a.data.localeCompare(b.data)),
  };
}

/** Uma transação, ou null quando falta data ou valor — sem os dois não serve. */
function lerTransacao(bloco: string): TransacaoExtrato | null {
  const data = lerData(tag(bloco, 'DTPOSTED')) ?? lerData(tag(bloco, 'DTUSER'));
  const valor = lerNumero(tag(bloco, 'TRNAMT'));
  if (!data || valor === null) return null;

  /*
   * MEMO e NAME dizem coisas diferentes e nem todo banco manda os dois: um
   * traz "PIX ENVIADO" e o outro o nome de quem recebeu. Juntar é o que faz a
   * linha do extrato ser reconhecível ao lado do histórico do IXC — e a
   * repetição é evitada porque há banco que manda o mesmo texto nos dois.
   */
  const partes = [tag(bloco, 'MEMO'), tag(bloco, 'NAME')]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0);
  const descricao = [...new Set(partes)].join(' · ');

  return {
    fitId: tag(bloco, 'FITID') ?? `${data}|${valor.toFixed(2)}`,
    data,
    valor,
    descricao,
    documento: tag(bloco, 'CHECKNUM') ?? tag(bloco, 'REFNUM'),
    tipo: tag(bloco, 'TRNTYPE'),
  };
}

/**
 * O valor de uma tag, no primeiro lugar em que ela aparecer.
 *
 * Vai do `>` até o próximo `<` ou até o fim da linha — é o que faz o mesmo
 * código servir ao OFX que fecha as tags e ao que não fecha.
 */
function tag(texto: string, nome: string): string | null {
  const achado = new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(texto);
  const valor = achado?.[1]?.trim();
  return valor ? valor : null;
}

/**
 * "20260818", "20260818120000" ou "20260818120000[-03:BRT]" viram
 * "2026-08-18".
 *
 * O fuso é ignorado de propósito. O que interessa é o dia em que o banco
 * lançou, e é esse dia que ele escreve nos oito primeiros dígitos; converter
 * para o fuso local jogaria uma transação da meia-noite para o dia anterior.
 */
function lerData(valor: string | null): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(valor ?? '');
  if (!m) return null;
  const [, ano, mes, dia] = m;
  if (Number(mes) < 1 || Number(mes) > 12 || Number(dia) < 1 || Number(dia) > 31) {
    return null;
  }
  return `${ano}-${mes}-${dia}`;
}

/**
 * O número do OFX, com a vírgula que não deveria estar lá.
 *
 * O padrão manda ponto decimal, e a maioria dos bancos obedece. Alguns mandam
 * "-1234,56", e um deles manda "1.234,56". A regra que resolve os três: o
 * último separador que aparecer é o decimal; o que vier antes é milhar.
 */
export function lerNumero(valor: string | null): number | null {
  const cru = (valor ?? '').trim();
  if (!cru) return null;

  const ultimoPonto = cru.lastIndexOf('.');
  const ultimaVirgula = cru.lastIndexOf(',');
  let normalizado = cru;

  if (ultimoPonto >= 0 && ultimaVirgula >= 0) {
    // Tem os dois: o último manda, o outro é separador de milhar.
    normalizado =
      ultimaVirgula > ultimoPonto
        ? cru.replace(/\./g, '').replace(',', '.')
        : cru.replace(/,/g, '');
  } else if (ultimaVirgula >= 0) {
    normalizado = cru.replace(',', '.');
  }

  const n = Number(normalizado.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
