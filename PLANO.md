# Roadmap — Folha de Pagamento

Evolução planejada por fases. Cada fase entrega valor de forma incremental.

## ✅ Fase 1 — Fatia vertical: IXC + Cadastro (entregue)

- [x] Monorepo (NestJS + React) com infra Docker/EasyPanel
- [x] Cliente do webservice IXC (auth por token, paginação, parsing pt-BR)
- [x] Sincronização idempotente de **funcionários** e **adiantamentos**
- [x] API REST de funcionários (listar, buscar, editar, resumo)
- [x] Autenticação JWT (rotas protegidas por padrão)
- [x] Frontend: login, lista com busca/filtro, sync com IXC, detalhe
- [x] Migration inicial + seed do admin
- [x] Testes unitários do núcleo de integração

## ✅ Fase 2 — Folha → Contas a pagar no IXC (entregue)

- [x] Config financeira parametrizável (conta pagamento 18, filial 1, contas
      contábeis: salário 2420 / adiantamento 2662 / bônus 13916, templates de obs)
- [x] Cadastro de funcionário com **carteira assinada** e **recebe adiantamento**,
      salário e **lançamentos fixos** (descontos/adiantamentos/bônus recorrentes)
- [x] Regra do adiantamento dia 25: CLT não desconta do saldo (contabilidade já
      fez); não-CLT desconta
- [x] Motor de cálculo do saldo salarial + prévia da folha por competência
- [x] Geração de **contas a pagar** no IXC (`fn_apagar`): emissão/vencimento hoje,
      valor da folha, conta contábil por tipo, filial 1, observações padronizadas
- [x] Fornecedor criado/vinculado automaticamente por pessoa (`fornecedor`)
- [x] Fluxo: salvar → **aprovar na auditoria** (`fn_apagar_auditoria`) →
      pagar com ModoBank (no IXC) → **monitorar retorno do banco** (polling do status)
- [x] **Pagamentos avulsos** (ex.: patrocínio a quem não é funcionário)
- [x] Telas: Gerar Folha, Contas a Pagar (com ações), Avulsos, Configurações

- [x] Lançamentos **avulsos** por funcionário (competência específica), além dos fixos
- [x] Polling automático do retorno do banco (SYNC_PAGAMENTOS_INTERVALO_MIN, padrão 10 min)
- [x] PIX no fn_apagar (chave do beneficiário) + tipo de pagamento configurável
- [x] Reuso de fornecedor existente no IXC por CPF/CNPJ

### Pendências desta fase (dependem de você)
- [ ] Automatizar o clique "pagar com ModoBank" — só se o IXC expuser esse
      endpoint (hoje é ação manual na tela do IXC; o app cria/aprova/monitora)
- [ ] Confirmar `cidade` padrão para criação de fornecedores no seu IXC
- [ ] Conferir o rótulo exato do tipo de pagamento PIX no seu IXC (Configurações)

## 🔜 Fase 2b — Réplica completa da planilha (proventos/descontos detalhados)

- [ ] **Proventos** extras: comissão, bônus de metas, férias, 13º, salário
      família, horas extras
- [ ] **Descontos** extras: INSS, vales, faltas (com tabela de horas/periculosidade),
      celular, internet
- [ ] Parâmetros de hora (normal/50%/100%) e falta/periculosidade
- [ ] Divisão do pagamento: **depositar** × **pagar em mãos** + receitas extras
- [ ] Tela de fechamento mensal consolidado por competência

## 🔜 Fase 3 — Importação do histórico

- [ ] Importar as 14 abas da planilha `.xlsx` (JAN/25 → FEV/26)
- [ ] Conciliação com os funcionários sincronizados do IXC
- [ ] Validação e relatório de divergências

## 🔜 Fase 4 — Comissões e provisões via IXC

- [ ] Puxar vendas por vendedor (`vd_saida`) e contratos ativados
- [ ] Cálculo automático de comissões
- [ ] Provisão de férias e 13º
- [ ] Enviar adiantamentos de volta ao IXC (`fl_adto_salario` POST)

## 🔜 Fase 5 — Relatórios, holerite e governança

- [ ] Holerite/recibo em PDF por funcionário
- [ ] Relatórios e exportações (Excel/CSV) por competência
- [ ] Remessa bancária / lista de PIX para pagamento
- [ ] Perfis de acesso (ADMIN, RH, VISUALIZADOR) aplicados por rota
- [ ] Log de auditoria (quem alterou o quê)
- [ ] Agendamento automático da sincronização com o IXC

## Notas técnicas / decisões

- **PostgreSQL + Prisma**: valores monetários em `Decimal(14,2)`; migrations
  versionadas.
- **IXC como fonte de verdade** do cadastro; a folha é calculada e armazenada
  localmente (o IXC não cobre todo o modelo de proventos/descontos da planilha).
- **Idempotência**: sync por `upsert(ixc_id)`; payload cru salvo em `ixc_raw`.
- **Escala**: apps stateless (API e Web) atrás do EasyPanel; podem ser
  replicados horizontalmente com o Postgres como estado compartilhado.
