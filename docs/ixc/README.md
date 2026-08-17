# Webservice do IXC — o que este app chama

A coleção Postman oficial está aqui em `API-IXC-Provedor.postman_collection.json`,
com **1.067 chamadas documentadas**. Ela vive no repositório porque a falta dela
já custou caro: a baixa de conta a pagar apontava para um recurso inexistente e
ninguém tinha como saber, porque o IXC responde a isso do mesmo jeito que
responde a uma requisição malformada.

> A credencial que vinha embutida na coleção foi retirada — os campos de auth
> saem como `{{IXC_TOKEN}}`. Ao importar no Postman, preencha com o seu token.

## Como procurar um endpoint aqui

```bash
node -e "const d=require('./docs/ixc/API-IXC-Provedor.postman_collection.json');(function a(n,c){for(const i of n.item??[]){const p=[...c,i.name];const u=i.request?.url?.raw??i.request?.url??'';if(u&&/BUSCA/i.test(p.join(' ')+u))console.log(i.request.method,u,'<-',p.join(' > '));if(i.item)a(i,p)}})(d,[])"
```

Troque `BUSCA` pelo que procura (`baixa`, `fornecedor`, `auditoria`…).

## O que o app usa, e o que foi conferido contra a base real

| Uso | Recurso | Situação |
| --- | --- | --- |
| Contas a pagar (ler, criar, editar, apagar) | `fn_apagar` | documentado |
| Aprovar/reprovar na auditoria | `fn_apagar_auditoria` | documentado |
| **Quitar uma conta a pagar** | `botao_pagar_26409` | documentado — "Baixa manual (Pagar)"; confirmado quitando um título real |
| Estornar uma baixa | `fn_apagar_baixas/{id}` (DELETE) | documentado, ainda não usado aqui |
| Ler as baixas (o dia em que o dinheiro saiu) | `fn_apagar_baixas` (GET) | **não documentado**; sondado em tempo de execução (ver abaixo) |
| Fornecedores | `fornecedor` | documentado |
| Funcionários | `funcionarios` | documentado |
| Adiantamento de salário | `fl_adto_salario` | documentado |
| Contas de pagamento (banco/caixa) | `contas` | documentado |
| Dados bancários e PIX do fornecedor | `dados_bancarios` | **não documentado**, confirmado na base |
| Lançamento na movimentação financeira | — | **não existe** (ver abaixo) |

### `data_pagamento` não é o dia em que o dinheiro saiu

Em `fn_apagar`, essa coluna guarda o dia em que a **baixa foi registrada**. Quem
paga o boleto pelo aplicativo do banco e só depois vem lançar registra sempre
depois: uma compra vencida em 15/08 e paga no dia, lançada no dia 16, fica lá
com `data_pagamento = 16/08` — e o histórico daqui acusava "pago 1 dia depois"
de um pagamento feito no vencimento.

O dia informado por quem baixou está na **linha de baixa**, a mesma que a aba
"Pagamentos" do título mostra na tela do IXC (ID, Documento, Conta/Caixa, Data,
Valor, Histórico). Ela não tem leitura documentada do lado do pagar: a coleção
traz a listagem do lado do receber (`fn_areceber_baixas`, filtrando por
`fn_movim_finan.*`) e, do lado do pagar, só o DELETE de estorno —
`fn_apagar_baixas/{id_movim_finan}`, que é de onde saem o nome do recurso e a
tabela por trás dele.

Por isso `baixas-do-ixc.service.ts` **pergunta à base** em vez de confiar num
nome: testa `fn_apagar_baixas` e `fn_movim_finan`, nos dois formatos de data, e
guarda o que responder com linhas reconhecíveis — linha que não aponte um título
não serve, mesmo vindo sem erro. Não achando caminho, o histórico mostra a data
do registro e diz na tela que é ela.

### Duas armadilhas que já morderam

**A coleção documenta dois nomes para a mesma baixa, e um deles está aposentado.**
`botao_pagar_26409` (Sistema > Pagar > Botões) e `fn_apagar_pagamentos_baixas`
(🔘 Botões > Pagar) aparecem com o mesmo corpo. Só o primeiro é servido por esta
instalação — o segundo responde `Erro inesperado, tente novamente!` a qualquer
chamada, até a uma leitura, enquanto um recurso realmente desconhecido responde
`Recurso X não está disponível!`. Ou seja, o endpoint aposentado se disfarça de
requisição malformada. **Se um endpoint retornar "erro inesperado" sempre,
desconfie do nome antes do payload** — e prefira o que a base responde ao que a
documentação lista primeiro.

**O motivo do erro nem sempre vem em `message`.** Nas baixas ele vem em `valor`:

```json
{"type":"error","valor":"Erro inesperado, tente novamente!"}
```

`IxcClient` lê `message`, `valor` e `mensagem`, nessa ordem.

### O caixa que não dá para lançar

A movimentação financeira (Financeiro > Movimentação > Financeira) **não tem
endpoint no webservice**. Os oito nomes prováveis foram testados um a um contra
o IXC e todos responderam "não está disponível"; a coleção também não traz
equivalente — o que ela tem de "caixa" é caixa de fibra, do mapa da rede.

Por isso o pagamento em mãos não lança a saída do caixa sozinho: ele marca o
pagamento como "lançar no IXC à mão". Não é bug, é o limite do webservice — e
está assim documentado em `ixc.caixa.ts`.
