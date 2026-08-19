import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { IxcClient } from '../ixc/ixc.client';
import { CaixaService } from '../ixc/caixa.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A tabela da movimentação financeira do IXC.
 *
 * É a mesma que o fechamento de caixa já lê para montar o extrato. Diferente
 * das candidatas que o `CaixaService` procura por tentativa, esta tem esquema
 * documentado — a coleção do Postman a chama de "Contabilidade" e traz o POST
 * com os campos abaixo.
 */
const TABELA_MOVIMENTO = 'fn_movim_finan';

/**
 * Transferir dinheiro de uma conta para outra.
 *
 * Sai 1.500 do caixa do Werick e entra no caixa do Aurélio, ou vai para a
 * Sicoob. O dinheiro não some nem aparece: muda de lugar. Sem registrar, o
 * caixa de origem fecha sobrando e o de destino faltando — pelo mesmo valor, e
 * sem nada ligando os dois, que é a diferença mais difícil de achar depois.
 *
 * No IXC uma transferência são duas linhas da movimentação financeira: crédito
 * no razão da origem e débito no do destino. A convenção não é adivinhada — é a
 * mesma que o extrato do caixa já usa para ler: linha com `credito` preenchido
 * é saída, com `debito` é entrada. Escrevendo assim, a transferência aparece
 * sozinha nos dois extratos, e o saldo esperado da gaveta acompanha sem
 * precisar de nenhum termo novo na conta.
 */
@Injectable()
export class TransferenciasService {
  private readonly logger = new Logger(TransferenciasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly caixa: CaixaService,
    private readonly config: ConfigFinanceiraService,
  ) {}

  /**
   * Confere a senha de quem está pedindo para abrir a tela.
   *
   * É a senha da própria pessoa, e não uma segunda combinada à parte: senha de
   * tela vira bilhete colado no monitor, e quem sabe a de alguém já entra como
   * essa pessoa de qualquer jeito. O perfil ADMIN é que fecha a porta de
   * verdade, no servidor; isto aqui é o segundo passo para ninguém mover
   * dinheiro por engano numa sessão deixada aberta.
   */
  async destravar(usuarioId: string | undefined, senha: string) {
    /*
     * A recusa é 403, e nunca 401.
     *
     * 401 é "sua sessão acabou", e a tela reage a ele deslogando — errar a
     * senha aqui jogava a pessoa para fora do sistema inteiro, que é o oposto
     * do que uma conferência de senha deveria fazer.
     */
    if (!usuarioId) throw new ForbiddenException('Sessão sem usuário.');

    const user = await this.prisma.user.findUnique({ where: { id: usuarioId } });
    if (!user || !user.ativo) {
      throw new ForbiddenException('Login inválido.');
    }
    if (!(await bcrypt.compare(senha, user.senhaHash))) {
      // Sem dizer o que estava errado: aqui só há um campo, e detalhar a
      // recusa só ajudaria quem está tentando adivinhar.
      throw new ForbiddenException('Senha incorreta.');
    }

    this.logger.log(`Transferências destravadas por ${user.email}`);
    return { ok: true };
  }

  /** As contas do IXC entre as quais se transfere: caixas e bancos. */
  async listarContas() {
    const cfg = await this.config.obter();
    const { tabela, caixas } = await this.caixa.listarCaixas(
      cfg.caixaTabelaContas,
    );
    return { tabela, contas: caixas };
  }

  /** O que já foi transferido daqui. */
  async listar(limite = 100) {
    return this.prisma.transferenciaEntreContas.findMany({
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
      take: limite,
    });
  }

  async transferir(
    dados: {
      origemId: number;
      destinoId: number;
      valor: number;
      /** Dia em que o dinheiro mudou de lugar (AAAA-MM-DD). Vazio = hoje. */
      data?: string;
      historico?: string;
      /** Dinheiro, Pix, Depósito… entra no histórico. */
      forma?: string;
    },
    usuarioId?: string,
  ) {
    if (dados.origemId === dados.destinoId) {
      throw new BadRequestException(
        'A conta de origem e a de destino são a mesma — não há transferência.',
      );
    }
    if (!(dados.valor > 0)) {
      throw new BadRequestException('O valor precisa ser maior que zero.');
    }

    const cfg = await this.config.obter();
    const { caixas } = await this.caixa.listarCaixas(cfg.caixaTabelaContas);
    const origem = caixas.find((c) => c.id === dados.origemId);
    const destino = caixas.find((c) => c.id === dados.destinoId);
    if (!origem) throw new BadRequestException('A conta de origem não existe.');
    if (!destino) throw new BadRequestException('A conta de destino não existe.');

    /*
     * A movimentação se liga à conta pelo **razão**, e não pelo id dela.
     *
     * Foi por confundir os dois que os pagamentos deste app sumiram da
     * conciliação uma vez. Escrever com o id errado aqui não daria erro: as
     * duas linhas nasceriam penduradas noutra conta, e o dinheiro apareceria
     * saindo de um lugar que ninguém mexeu.
     */
    const razaoOrigem = origem.razaoId;
    const razaoDestino = destino.razaoId;
    if (razaoOrigem === null || razaoDestino === null) {
      const semRazao = razaoOrigem === null ? origem : destino;
      throw new ServiceUnavailableException(
        `A conta "${semRazao.nome}" não tem conta do razão no cadastro do IXC ` +
          '(`contas.id_planejamento`), e é por ela que a movimentação se liga ' +
          'à conta. Abra o cadastro dela no IXC e informe o planejamento.',
      );
    }

    const quando = dados.data ? dataDoDia(dados.data) : new Date();
    const valor = arredondar(dados.valor);
    const historico =
      dados.historico?.trim() ||
      `Transferência de ${origem.nome} para ${destino.nome}` +
        (dados.forma ? ` (${dados.forma})` : '');

    /*
     * Crédito na origem, débito no destino.
     *
     * A convenção é a mesma que o extrato do caixa usa para ler esta tabela —
     * linha com `credito` é saída, com `debito` é entrada. Inverter os dois
     * faria o dinheiro andar ao contrário, e ainda assim fecharia: a soma das
     * duas contas continuaria a mesma, e só a pessoa que fosse contar a gaveta
     * descobriria.
     */
    const saida = await this.escrever({
      idConta: razaoOrigem,
      credito: valor,
      quando,
      historico,
    });
    let entrada: number | null = null;
    try {
      entrada = await this.escrever({
        idConta: razaoDestino,
        debito: valor,
        quando,
        historico,
      });
    } catch (err) {
      /*
       * A segunda perna falhou e a primeira já está lá.
       *
       * O IXC não tem transação para desfazer, então o que resta é não deixar
       * o buraco calado: o registro é gravado com a perna que existe e a que
       * falta em branco, e a tela mostra isso em vermelho. Dinheiro que saiu de
       * uma conta e não entrou em nenhuma é exatamente o tipo de diferença que
       * ninguém acha três meses depois.
       */
      const motivo = err instanceof Error ? err.message : String(err);
      await this.registrar(dados, origem, destino, valor, quando, historico, {
        idMovimOrigem: saida,
        idMovimDestino: null,
        usuarioId,
      });
      this.logger.error(
        `Transferência pela metade: saiu ${valor} de "${origem.nome}" ` +
          `(lançamento #${saida}) e não entrou em "${destino.nome}": ${motivo}`,
      );
      throw new ServiceUnavailableException(
        `A saída de ${formatar(valor)} foi lançada em "${origem.nome}" ` +
          `(lançamento #${saida}), mas a entrada em "${destino.nome}" não: ` +
          `${motivo} Lance a entrada à mão no IXC, ou apague o lançamento ` +
          '#' +
          `${saida} por lá — do jeito que está, esse valor sumiu de uma conta ` +
          'sem aparecer na outra.',
      );
    }

    const registro = await this.registrar(
      dados,
      origem,
      destino,
      valor,
      quando,
      historico,
      { idMovimOrigem: saida, idMovimDestino: entrada, usuarioId },
    );
    this.logger.log(
      `Transferência de ${valor}: "${origem.nome}" #${saida} -> ` +
        `"${destino.nome}" #${entrada}`,
    );
    return registro;
  }

  /** Uma linha da movimentação financeira do IXC. */
  private async escrever(l: {
    idConta: number;
    credito?: number;
    debito?: number;
    quando: Date;
    historico: string;
  }): Promise<number> {
    const { id } = await this.ixc.create(TABELA_MOVIMENTO, {
      id_conta: String(l.idConta),
      // O IXC recebe data no formato dele, não em ISO.
      data: dataBR(l.quando),
      debito: l.debito === undefined ? '' : l.debito.toFixed(2),
      credito: l.credito === undefined ? '' : l.credito.toFixed(2),
      historico: l.historico,
    });
    if (!id) {
      throw new Error(
        'O IXC aceitou a chamada mas não devolveu o número do lançamento.',
      );
    }
    return id;
  }

  private registrar(
    dados: { forma?: string },
    origem: { id: number; nome: string },
    destino: { id: number; nome: string },
    valor: number,
    quando: Date,
    historico: string,
    ids: {
      idMovimOrigem: number | null;
      idMovimDestino: number | null;
      usuarioId?: string;
    },
  ) {
    return this.prisma.transferenciaEntreContas.create({
      data: {
        origemId: origem.id,
        origemNome: origem.nome,
        destinoId: destino.id,
        destinoNome: destino.nome,
        valor: new Prisma.Decimal(valor),
        data: quando,
        historico,
        forma: dados.forma?.trim() || null,
        idMovimOrigem: ids.idMovimOrigem,
        idMovimDestino: ids.idMovimDestino,
        criadoPor: ids.usuarioId ?? null,
      },
    });
  }
}

/** "AAAA-MM-DD" para Date, recusando o que não é data. */
function dataDoDia(valor: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor).trim());
  if (!m) {
    throw new BadRequestException('A data precisa estar no formato AAAA-MM-DD.');
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Esta data não existe no calendário.');
  }
  return d;
}

/** Date para "DD/MM/AAAA", que é como o IXC recebe. */
function dataBR(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatar(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
