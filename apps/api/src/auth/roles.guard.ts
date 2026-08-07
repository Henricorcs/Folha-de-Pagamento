import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';

/** Métodos que mudam alguma coisa — é neles que o perfil pesa. */
const ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Perfis de acesso. Em vez de marcar rota por rota (e esquecer a próxima), a
 * regra é geral: quem é VISUALIZADOR só faz leitura. Rotas que precisam de
 * algo diferente usam `@Roles()` — por exemplo, gerenciar logins é só ADMIN, e
 * trocar a própria senha vale para todo mundo.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requeridos = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const req = context.switchToHttp().getRequest<Request>();
    const usuario = req.user as { role?: UserRole } | undefined;

    // Rota pública: o JwtAuthGuard já deixou passar, não há perfil a checar.
    if (!usuario?.role) return true;

    if (requeridos && requeridos.length > 0) {
      if (!requeridos.includes(usuario.role)) {
        throw new ForbiddenException(
          'Seu perfil não tem acesso a esta operação.',
        );
      }
      return true;
    }

    if (usuario.role === UserRole.VISUALIZADOR && ESCRITA.has(req.method)) {
      throw new ForbiddenException(
        'Seu acesso é somente leitura. Peça a um administrador para alterar seu perfil.',
      );
    }
    return true;
  }
}
