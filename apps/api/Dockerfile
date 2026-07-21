# Backend NestJS + Prisma. Contexto de build = raiz do repositório.
FROM node:22-alpine
WORKDIR /app

# Instala dependências do workspace da API (só apps/api é copiado, então o
# workspace resolve apenas @folha/api).
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
RUN npm install

# Código-fonte + geração do Prisma Client + build
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
EXPOSE 3333

# Aplica migrações pendentes e sobe a API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
