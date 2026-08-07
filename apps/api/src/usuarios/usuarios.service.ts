import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AtualizarUsuarioDto, CriarUsuarioDto } from './dto/usuario.dto';

/** Nunca devolva o hash da senha para o cliente. */
const CAMPOS = {
  id: true,
  nome: true,
  email: true,
  role: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
} as const;

const CUSTO_HASH = 10;

@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  listar() {
    return this.prisma.user.findMany({
      select: CAMPOS,
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
    });
  }

  async criar(dto: CriarUsuarioDto) {
    try {
      return await this.prisma.user.create({
        data: {
          nome: dto.nome.trim(),
          email: dto.email,
          senhaHash: await bcrypt.hash(dto.senha, CUSTO_HASH),
          role: dto.role ?? UserRole.RH,
        },
        select: CAMPOS,
      });
    } catch (err) {
      throw this.traduzirErro(err);
    }
  }

  async atualizar(id: string, dto: AtualizarUsuarioDto, usuarioLogadoId: string) {
    await this.assertExiste(id);

    // Ninguém tira o próprio acesso sem querer — e o app não pode ficar sem
    // nenhum administrador ativo.
    if (id === usuarioLogadoId) {
      if (dto.ativo === false) {
        throw new BadRequestException('Você não pode desativar o próprio login');
      }
      if (dto.role && dto.role !== UserRole.ADMIN) {
        throw new BadRequestException('Você não pode rebaixar o próprio perfil');
      }
    }
    if (dto.ativo === false || (dto.role && dto.role !== UserRole.ADMIN)) {
      await this.assertNaoDeixaSemAdmin(id);
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          nome: dto.nome?.trim(),
          email: dto.email,
          role: dto.role,
          ativo: dto.ativo,
          ...(dto.senha
            ? { senhaHash: await bcrypt.hash(dto.senha, CUSTO_HASH) }
            : {}),
        },
        select: CAMPOS,
      });
    } catch (err) {
      throw this.traduzirErro(err);
    }
  }

  async remover(id: string, usuarioLogadoId: string) {
    await this.assertExiste(id);
    if (id === usuarioLogadoId) {
      throw new BadRequestException('Você não pode excluir o próprio login');
    }
    await this.assertNaoDeixaSemAdmin(id);
    await this.prisma.user.delete({ where: { id } });
  }

  /** Troca da própria senha: exige a atual, então ninguém troca por você. */
  async trocarSenha(id: string, senhaAtual: string, novaSenha: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const confere = await bcrypt.compare(senhaAtual, user.senhaHash);
    if (!confere) throw new BadRequestException('A senha atual não confere');
    if (await bcrypt.compare(novaSenha, user.senhaHash)) {
      throw new BadRequestException('A nova senha precisa ser diferente da atual');
    }

    await this.prisma.user.update({
      where: { id },
      data: { senhaHash: await bcrypt.hash(novaSenha, CUSTO_HASH) },
    });
    return { ok: true };
  }

  /** O último administrador ativo não pode ser desligado nem rebaixado. */
  private async assertNaoDeixaSemAdmin(idAlvo: string) {
    const outros = await this.prisma.user.count({
      where: { role: UserRole.ADMIN, ativo: true, id: { not: idAlvo } },
    });
    if (outros === 0) {
      throw new BadRequestException(
        'Este é o único administrador ativo — promova outra pessoa antes.',
      );
    }
  }

  private async assertExiste(id: string) {
    const existe = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Usuário não encontrado');
  }

  private traduzirErro(err: unknown): Error {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException('Já existe um login com esse e-mail');
    }
    return err as Error;
  }
}
