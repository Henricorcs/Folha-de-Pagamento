import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

/** Os módulos do app, como a tela os chama. */
export const MODULOS = ['folha', 'contas-pagar', 'rh'] as const;
export type ModuloId = (typeof MODULOS)[number];

/**
 * De que módulo é cada rota, pelo primeiro pedaço do caminho.
 *
 * Tabela, e não anotação em cada controlador: uma rota nova nasce coberta pelo
 * prefixo que já existe, em vez de esperar alguém lembrar do decorador. Duas
 * coisas a notar aqui, porque confundem:
 *
 * - `contas-pagar` é a tela da **folha** (as contas que a folha gera); o módulo
 *   Contas a Pagar responde por `contas-abertas` e `pagamentos-feitos`;
 * - `avulsos`, `categorias-despesa` e `fornecedores-ixc` servem aos dois, e por
 *   isso passam para quem tiver qualquer um deles.
 *
 * O que não está aqui é livre: login, saúde, gerenciamento de usuários e a
 * assinatura pública do recibo não pertencem a módulo nenhum.
 */
const MODULO_DA_ROTA: Array<[string, ModuloId[]]> = [
  ['rh', ['rh']],

  ['contas-abertas', ['contas-pagar']],
  ['pagamentos-feitos', ['contas-pagar']],
  ['recorrentes', ['contas-pagar']],
  ['transferencias', ['contas-pagar']],
  ['caixa', ['contas-pagar']],

  ['funcionarios', ['folha']],
  ['diaristas', ['folha']],
  ['diarias', ['folha']],
  ['ferias', ['folha']],
  ['vales', ['folha']],
  ['impostos', ['folha']],
  ['contas-pagar', ['folha']],
  ['config-financeira', ['folha']],
  ['sync', ['folha']],
  ['dashboard', ['folha']],

  ['avulsos', ['folha', 'contas-pagar']],
  ['categorias-despesa', ['folha', 'contas-pagar']],
  ['fornecedores-ixc', ['folha', 'contas-pagar']],
];

/**
 * Quem abre qual módulo.
 *
 * O perfil diz o que a pessoa pode fazer; isto diz onde. São perguntas
 * diferentes: a Luzimeire é RH e mexe em tudo dentro do RH, e não tem o que
 * fazer no caixa da empresa.
 *
 * A lista vem do banco a cada requisição (o `JwtStrategy` relê o usuário), e
 * não do token: tirar um módulo de alguém tem efeito no clique seguinte, e não
 * quando o login dela expirar.
 */
@Injectable()
export class ModulosGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const usuario = req.user as
      | { role?: UserRole; modulos?: string[] }
      | undefined;

    // Rota pública: o JwtAuthGuard já deixou passar.
    if (!usuario?.role) return true;
    // ADMIN distribui o acesso; ele não se restringe.
    if (usuario.role === UserRole.ADMIN) return true;
    // Lista vazia = sem restrição. Ver o comentário da coluna no schema.
    const permitidos = usuario.modulos ?? [];
    if (permitidos.length === 0) return true;

    const exigidos = moduloDaRota(req.path);
    if (!exigidos) return true;
    if (exigidos.some((m) => permitidos.includes(m))) return true;

    throw new ForbiddenException(
      'Seu login não abre este módulo. Peça a um administrador para liberar.',
    );
  }
}

/** Os módulos que uma rota exige, ou null quando ela não é de módulo nenhum. */
export function moduloDaRota(caminho: string): ModuloId[] | null {
  // "/api/rh/pastas" -> "rh"
  const pedacos = caminho.split('/').filter(Boolean);
  const primeiro = pedacos[0] === 'api' ? pedacos[1] : pedacos[0];
  if (!primeiro) return null;

  const achado = MODULO_DA_ROTA.find(([prefixo]) => prefixo === primeiro);
  return achado ? achado[1] : null;
}
