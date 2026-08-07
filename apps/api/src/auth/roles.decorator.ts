import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restringe a rota aos perfis listados. Sem esta anotação vale a regra geral
 * do `RolesGuard`: ADMIN e RH fazem tudo, VISUALIZADOR só lê.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
