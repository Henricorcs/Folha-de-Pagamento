# ILNET FINANCE

Sistema de gestão interna da ilnet, **integrado ao IXC Provedor** via API e
organizado em módulos. Depois do login você escolhe em qual trabalhar:

| Módulo             | Rota             | O que faz                                                    |
| ------------------ | ---------------- | ------------------------------------------------------------ |
| Folha de Pagamento | `/folha`         | Funcionários, diaristas, vales, férias, impostos e a folha    |
| Contas a Pagar     | `/contas-pagar`  | Todas as saídas da empresa (em construção)                    |

Um módulo novo se declara em `apps/web/src/lib/modulos.ts` — o cartão na tela
de escolha e a barra lateral saem dali.

> **Status:** Fase 1 (fatia vertical) — integração IXC + cadastro de
> funcionários funcionando ponta a ponta. Veja o roadmap em [PLANO.md](PLANO.md).

## Arquitetura

Monorepo com dois apps independentes (npm workspaces):

```
folha-pagamento/
├── apps/
│   ├── api/          # Backend NestJS + Prisma (PostgreSQL) + integração IXC
│   └── web/          # Frontend React + Vite + Tailwind
├── docker-compose.yml    # Ambiente local completo (db + api + web)
├── .env.example          # Modelo das variáveis de ambiente
├── PLANO.md              # Roadmap por fases
└── DEPLOY-EASYPANEL.md   # Guia de deploy no EasyPanel
```

**Backend (NestJS)** — organizado em módulos para escalar:

| Módulo         | Responsabilidade                                            |
| -------------- | ----------------------------------------------------------- |
| `ixc`          | Cliente do webservice do IXC (auth, paginação, parsing)     |
| `sync`         | Sincroniza funcionários e adiantamentos do IXC (idempotente)|
| `funcionarios` | API REST do cadastro (listar, detalhar, editar, resumo)     |
| `auth`         | Login JWT; todas as rotas protegidas por padrão             |
| `prisma`       | Acesso ao PostgreSQL                                         |

**Frontend (React)** — `src/pages/Modulos.tsx` é a escolha de módulo; as telas
de cada módulo ficam em `src/pages/<módulo>/`. O `Layout` recebe o módulo e
monta a barra lateral a partir do registro em `src/lib/modulos.ts`.

**Integração IXC** — o IXC é a fonte de verdade dos colaboradores. A
sincronização faz *upsert* por `ixc_id`, então rodar de novo não duplica. O
payload cru do IXC é guardado em `ixc_raw` para não perder nenhum campo.

## Como rodar localmente

### Opção A — Docker (recomendado, igual à produção)

```bash
cp .env.example .env          # preencha IXC_HOST, IXC_TOKEN e os segredos
docker compose up --build
docker compose exec api npm run db:seed   # cria o usuário admin
```

- Web: http://localhost:8080
- API: http://localhost:3333/api/health

### Opção B — Sem Docker (Node + Postgres na máquina)

Requer um PostgreSQL rodando e o `DATABASE_URL` apontando para ele.

```bash
npm install
# Backend
cd apps/api
cp ../../.env.example .env     # ajuste DATABASE_URL e IXC_*
npm run db:migrate             # cria as tabelas
npm run db:seed                # cria o admin
npm run dev                    # API em http://localhost:3333
# Frontend (outro terminal)
cd apps/web
npm run dev                    # Web em http://localhost:5173
```

## Configuração do IXC

1. No IXC: **Configurações → Integrações → Tokens da API** — gere um token.
2. Preencha no `.env`:
   - `IXC_HOST` — domínio do IXC, sem `https://` (ex.: `provedor.exemplo.com.br`)
   - `IXC_TOKEN` — no formato `id:hash` (ex.: `41:5a63...`)
3. Clique em **Sincronizar com IXC** na tela de funcionários.

> ⚠️ **Segurança:** o token dá acesso ao seu IXC. Nunca versione o `.env`.
> No EasyPanel, configure-o como variável de ambiente do serviço da API.

## Testes

```bash
npm test              # testes unitários do backend (parsing, mappers, cliente IXC)
```

## Deploy

Veja **[DEPLOY-EASYPANEL.md](DEPLOY-EASYPANEL.md)** para o passo a passo no
EasyPanel (Postgres + serviço da API + serviço Web).
