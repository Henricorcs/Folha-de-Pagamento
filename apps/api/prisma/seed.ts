import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Cria o usuário administrador inicial.
 * Defina ADMIN_EMAIL e ADMIN_SENHA no ambiente; há valores padrão só p/ dev.
 */
async function main() {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@folha.local').toLowerCase();
  const senha = process.env.ADMIN_SENHA ?? 'admin123';

  const senhaHash = await bcrypt.hash(senha, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      nome: 'Administrador',
      email,
      senhaHash,
      role: UserRole.ADMIN,
    },
  });

  console.log(`Usuário admin garantido: ${user.email}`);
  if (senha === 'admin123') {
    console.warn(
      '⚠️  Senha padrão em uso (admin123). Troque ADMIN_SENHA em produção!',
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
