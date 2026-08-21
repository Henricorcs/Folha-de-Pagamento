import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<AppConfig['jwt']>('jwt').secret,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      // Os módulos vêm do banco, e não do token: tirar um de alguém tem efeito
      // no clique seguinte, e não quando o login dela expirar.
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        ativo: true,
        modulos: true,
      },
    });
    if (!user || !user.ativo) {
      throw new UnauthorizedException('Usuário inválido ou inativo');
    }
    return user;
  }
}
