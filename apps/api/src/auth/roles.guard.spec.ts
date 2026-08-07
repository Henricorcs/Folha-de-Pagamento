import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function contexto(
  role: UserRole | null,
  method = 'GET',
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : undefined, method }),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guard(requeridos?: UserRole[]) {
  const reflector = {
    getAllAndOverride: () => requeridos,
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('rota pública (sem usuário) passa', () => {
    expect(guard().canActivate(contexto(null, 'POST'))).toBe(true);
  });

  it('VISUALIZADOR lê à vontade', () => {
    expect(guard().canActivate(contexto(UserRole.VISUALIZADOR, 'GET'))).toBe(
      true,
    );
  });

  it('VISUALIZADOR não escreve', () => {
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() =>
        guard().canActivate(contexto(UserRole.VISUALIZADOR, metodo)),
      ).toThrow(ForbiddenException);
    }
  });

  it('RH e ADMIN escrevem sem anotação', () => {
    expect(guard().canActivate(contexto(UserRole.RH, 'POST'))).toBe(true);
    expect(guard().canActivate(contexto(UserRole.ADMIN, 'DELETE'))).toBe(true);
  });

  it('rota marcada só para ADMIN barra o RH', () => {
    const g = guard([UserRole.ADMIN]);
    expect(g.canActivate(contexto(UserRole.ADMIN, 'POST'))).toBe(true);
    expect(() => g.canActivate(contexto(UserRole.RH, 'POST'))).toThrow(
      ForbiddenException,
    );
  });

  it('rota liberada a todos os perfis deixa o VISUALIZADOR escrever', () => {
    // É o caso de trocar a própria senha.
    const g = guard([UserRole.ADMIN, UserRole.RH, UserRole.VISUALIZADOR]);
    expect(g.canActivate(contexto(UserRole.VISUALIZADOR, 'POST'))).toBe(true);
  });
});
