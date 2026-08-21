import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { moduloDaRota, ModulosGuard } from './modulos.guard';

/**
 * O perfil diz o que a pessoa pode fazer; isto diz onde.
 *
 * O que este arquivo protege é o mapa de rotas — a parte que erra calado. Um
 * prefixo no módulo errado tranca alguém do lado de fora do próprio trabalho,
 * ou abre a pasta de RH para quem só devia ver o caixa, e nos dois casos a
 * tela não denuncia nada: ela simplesmente não mostra o que deveria.
 */
function contexto(
  usuario: { role: UserRole; modulos?: string[] } | null,
  path: string,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: usuario ?? undefined, path }),
    }),
  } as unknown as ExecutionContext;
}

const guard = new ModulosGuard();

describe('de que módulo é cada rota', () => {
  it('acha o módulo pelo primeiro pedaço do caminho', () => {
    expect(moduloDaRota('/api/rh/pastas')).toEqual(['rh']);
    expect(moduloDaRota('/api/funcionarios/123/faltas')).toEqual(['folha']);
    expect(moduloDaRota('/api/contas-abertas')).toEqual(['contas-pagar']);
  });

  /*
   * A confusão que mais custa: `contas-pagar` é a tela da **folha** (as contas
   * que a folha gera), e o módulo Contas a Pagar responde por `contas-abertas`
   * e `pagamentos-feitos`. Trocar os dois tiraria a folha de quem cuida dela.
   */
  it('não confunde a tela de contas da folha com o módulo Contas a Pagar', () => {
    expect(moduloDaRota('/api/contas-pagar/preview')).toEqual(['folha']);
    expect(moduloDaRota('/api/pagamentos-feitos')).toEqual(['contas-pagar']);
  });

  /* Avulsos vive nos dois módulos, com os mesmos dados. */
  it('rota compartilhada aceita qualquer um dos dois', () => {
    expect(moduloDaRota('/api/avulsos')).toEqual(['folha', 'contas-pagar']);
    expect(moduloDaRota('/api/categorias-despesa')).toEqual([
      'folha',
      'contas-pagar',
    ]);
  });

  it('o que não é de módulo nenhum fica de fora do mapa', () => {
    expect(moduloDaRota('/api/auth/login')).toBeNull();
    expect(moduloDaRota('/api/usuarios')).toBeNull();
    expect(moduloDaRota('/api/health')).toBeNull();
    expect(moduloDaRota('/api/assinaturas/abc123')).toBeNull();
  });
});

describe('quem abre qual módulo', () => {
  it('rota pública passa sem usuário', () => {
    expect(guard.canActivate(contexto(null, '/api/rh/pastas'))).toBe(true);
  });

  /* É o ADMIN quem distribui o acesso; trancar a si mesmo não teria conserto
     pela tela. */
  it('ADMIN abre tudo, mesmo com lista curta', () => {
    const admin = { role: UserRole.ADMIN, modulos: ['folha'] };
    expect(guard.canActivate(contexto(admin, '/api/rh/pastas'))).toBe(true);
  });

  /* Lista vazia = sem restrição: é o que os logins de antes da coluna
     significam, e é o que impede uma migração de trancar todo mundo. */
  it('lista vazia abre tudo', () => {
    const usuario = { role: UserRole.RH, modulos: [] };
    expect(guard.canActivate(contexto(usuario, '/api/caixa/caixas'))).toBe(true);
  });

  it('abre o que está na lista', () => {
    const usuario = { role: UserRole.RH, modulos: ['rh'] };
    expect(guard.canActivate(contexto(usuario, '/api/rh/pastas'))).toBe(true);
  });

  it('recusa o que não está', () => {
    const usuario = { role: UserRole.RH, modulos: ['rh'] };
    expect(() =>
      guard.canActivate(contexto(usuario, '/api/caixa/caixas')),
    ).toThrow(ForbiddenException);
  });

  it('a rota de dois módulos passa com qualquer um deles', () => {
    const soFolha = { role: UserRole.RH, modulos: ['folha'] };
    const soContas = { role: UserRole.RH, modulos: ['contas-pagar'] };
    expect(guard.canActivate(contexto(soFolha, '/api/avulsos'))).toBe(true);
    expect(guard.canActivate(contexto(soContas, '/api/avulsos'))).toBe(true);
  });

  /* Login e troca da própria senha não pertencem a módulo nenhum: quem só abre
     o RH ainda precisa entrar no sistema. */
  it('o que está fora do mapa passa para qualquer um', () => {
    const usuario = { role: UserRole.RH, modulos: ['rh'] };
    expect(guard.canActivate(contexto(usuario, '/api/usuarios/eu/senha'))).toBe(
      true,
    );
    expect(guard.canActivate(contexto(usuario, '/api/auth/me'))).toBe(true);
  });
});
