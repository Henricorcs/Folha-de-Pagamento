# Frontend React/Vite servido por nginx. Contexto de build = raiz do repositório.
# ---- Build ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
RUN npm install

COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN npm run build

# ---- Runtime (nginx) ----
FROM nginx:1.27-alpine AS runtime
# Host:porta do serviço da API (ajuste no EasyPanel: <projeto>_api:3333).
ENV API_UPSTREAM=api:3333
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
