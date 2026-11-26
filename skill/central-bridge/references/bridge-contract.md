# Contrato da Bridge — v1

A Bridge é a API de administração que **cada produto** expõe para a Central.
A Central nunca grava no banco de um produto: ela pede, o produto decide.

Existem três implementações do mesmo contrato, e todas são testadas contra os
mesmos vetores em `packages/bridge-test-vectors/`:

| Stack                                                                                 | Pacote                              | Pasta                             | Repositório público (MIT)                                                                         |
| ------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Laravel                                                                               | `central/bridge-laravel` (Composer) | `packages/central-laravel-bridge` | [kellvembarbosa/central-laravel-bridge](https://github.com/kellvembarbosa/central-laravel-bridge) |
| AdonisJS                                                                              | `@central/bridge-adonis` (npm)      | `packages/central-bridge-adonis`  | [kellvembarbosa/central-bridge-adonis](https://github.com/kellvembarbosa/central-bridge-adonis)   |
| Web standards (Cloudflare Workers, Vercel, Astro, Next.js, TanStack Start, SvelteKit) | `@central/bridge-web` (npm)         | `packages/central-bridge-web`     | [kellvembarbosa/central-bridge-web](https://github.com/kellvembarbosa/central-bridge-web)         |

O contrato é compatível no fio com o `applu/central-bridge` 1.x do applu-gestor
(pacote de terceiro, só referência: nunca alterado nem publicado por nós): um
produto que já usa aquele pacote fala com esta Central sem mudar nada.

A mesma assinatura serve no sentido contrário (produto → Central) para a **API
de faturação** (§9) e o **checkout da Central** (§10), e os pacotes trazem esse
cliente (`CentralClient`).

**A Central é dona do checkout, dos pagamentos e do prazo de acesso** (§10): o
produto não guarda chave de gateway nenhuma e não faz conta de data. Ele lê os
planos, pede a cobrança, mostra o Pix/link ao comprador e grava o acesso até
`access_until` quando a Central avisa (`payment-events`). Site que já vendia
migra os assinantes existentes por §10.6.

---

## 1. Configuração no produto

| Variável                     | Significado                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `CENTRAL_BRIDGE_ENABLED`     | `true` liga as rotas. Desligada, toda rota responde 404 `not_found`.                                         |
| `CENTRAL_BRIDGE_TOKEN`       | Token do produto, gerado na Central (tela do produto → "Gerar token", ou MCP `rotate_product_bridge_token`). |
| `CENTRAL_BRIDGE_PRODUCT`     | Slug do produto na Central. O `/health` devolve este valor; a Central recusa Bridge que responde outro.      |
| `CENTRAL_BRIDGE_ALLOWED_IPS` | IPs da Central separados por vírgula. Vazio = qualquer IP.                                                   |
| `CENTRAL_URL`                | URL base da Central (só para o cliente de faturação, §9).                                                    |

Constantes: prefixo `central-api/v1`, tolerância de relógio **300 s**,
idempotência guardada por **24 h**, página com **25** itens.

Produtos em runtimes Web (`@central/bridge-web`) leem as mesmas variáveis e,
além disso:

- O token é segredo de servidor: `wrangler secret put` / env criptografada da
  Vercel, nunca com prefixo `PUBLIC_`, `VITE_` ou `NEXT_PUBLIC_`.
- `CENTRAL_BRIDGE_ALLOWED_IPS` exige um resolvedor de IP da plataforma
  (`cloudflareIp`, `vercelIp`, `nodeSocketIp`); sem ele, toda requisição é
  recusada. `x-forwarded-for` nunca é confiado por padrão.
- Escritas exigem um armazenamento de idempotência compartilhado com trava
  atômica (D1 ou Upstash Redis); sem ele, todo `POST` responde 500. Workers
  KV não serve (não é atômico).
- Rewrites/proxies não podem alterar o caminho assinado; quando alteram, o
  produto informa o caminho original (`getSignedPath`).

## 2. Assinatura (toda requisição)

Cabeçalhos:

| Cabeçalho              | Valor                                   |
| ---------------------- | --------------------------------------- |
| `X-Central-Timestamp`  | segundos Unix, só dígitos, no máximo 12 |
| `X-Central-Signature`  | HMAC-SHA256 em hex minúsculo            |
| `X-Central-Request-Id` | opcional, para correlação de log        |

```
payload   = UPPER(method) + "\n" + pathWithQuery + "\n" + timestamp + "\n" + sha256_hex(rawBody)
signature = hex(hmac_sha256(token, payload))
```

- `pathWithQuery` é o caminho exato da requisição com a query string crua,
  como chegou (`/central-api/v1/users?q=ana%40x.com&page=2`).
- Corpo vazio → `sha256("")`.
- Comparação em tempo constante; a assinatura recebida é normalizada para
  minúsculas antes de comparar.
- `|now - timestamp| > 300` → 401 `timestamp_skew`.
- Ordem das verificações: desligada (404) → IP (403) → falta token/assinatura/
  timestamp inválido (401 `unauthorized`) → relógio (401 `timestamp_skew`) →
  assinatura (401 `signature_invalid`).

## 3. Escritas: ator e idempotência

Toda rota `POST` exige:

| Cabeçalho           | Regra                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| `X-Central-Actor`   | e-mail de quem pediu na Central; ausente ou inválido → 422 `missing_actor` |
| `X-Idempotency-Key` | 1–128 caracteres; ausente → 422 `validation_failed`                        |

- Impressão digital = `sha256(METHOD + "\n" + path + "\n" + rawBody)`.
- Mesma chave e mesma impressão → devolve a resposta guardada, com o cabeçalho
  `X-Idempotency-Replayed: true`.
- Mesma chave e impressão diferente → 409 `idempotency_conflict`.
- Mesma chave ainda em execução → 409 `idempotency_conflict` com a mensagem
  "Outra requisição com esta chave de idempotência ainda está em andamento."
- Só respostas com status < 500 são guardadas.

## 4. Erros

Sempre `{"error": {"code": "<código>", "message": "<pt-BR>"}}`.

| Código                   | HTTP | Mensagem padrão                                             |
| ------------------------ | ---- | ----------------------------------------------------------- |
| `unauthorized`           | 401  | Requisição sem autenticação válida da Central.              |
| `signature_invalid`      | 401  | Assinatura da Central inválida.                             |
| `timestamp_skew`         | 401  | Requisição expirada: o relógio difere em mais de 5 minutos. |
| `ip_not_allowed`         | 403  | Endereço IP não autorizado.                                 |
| `not_found`              | 404  | Recurso não encontrado.                                     |
| `idempotency_conflict`   | 409  | Esta chave de idempotência já foi usada com outro conteúdo. |
| `validation_failed`      | 422  | Dados inválidos.                                            |
| `missing_actor`          | 422  | Informe quem pediu a ação (X-Central-Actor).                |
| `internal_error`         | 500  | Erro interno no produto.                                    |
| `capability_unsupported` | 501  | Este produto não oferece esta operação.                     |

Exceção não tratada no handler → 500 `internal_error`, sem detalhe na resposta
(o produto registra no log dele).

## 5. Sanitizador

Última barreira: nenhuma resposta 200 leva chave cujo nome contenha um
segmento proibido: `password, senha, hash, token, secret, segredo, document,
documento, cpf, cnpj, remember, recovery`.

- Segmentos = nome em snake*case partido por `*`**e** o nome original em
minúsculas partido por`_`(depois de trocar`-`e espaço por`_`).
`rememberToken`, `recovery-codes`, `cnpjNumber`, `documentType` caem.
- Recursivo em objetos e listas; o caminho com ponto ignora índices de lista.
- Exceção por caminho exato: só `taker.document` em `invoice-request`.

## 6. Capacidades

O produto implementa só os handlers que quiser. Rota cujo handler não existe →
501 `capability_unsupported`. O `/health` anuncia o que existe.

| Capacidade                    | Handler (Laravel: interface / AdonisJS: método do objeto `handlers`)                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment_owner`               | `ProvidesPaymentOwnership::paymentOwner(provider, paymentId)`                                                                                                    |
| `subscriptions`               | `ProvidesSubscriptions::subscriptions(status, page, perPage)`                                                                                                    |
| `users_search`, `user_detail` | `ProvidesUsers::searchUsers(query, page, perPage)` / `findUser(ref)`                                                                                             |
| `change_plan`                 | `ManagesUserPlans::changePlan(ref, {plan, until, reason}, actor)`                                                                                                |
| `password_reset`              | `SendsPasswordResets::sendPasswordReset(ref, actor)`                                                                                                             |
| `suspend`                     | `SuspendsUsers::suspend(ref, reason, actor)` / `unsuspend(...)`                                                                                                  |
| `metrics`                     | `ProvidesMetrics::metrics(from, to)`                                                                                                                             |
| `invoices`                    | **dois** handlers: `ProvidesInvoiceRequests::invoiceRequest(provider, paymentId)` e `ReceivesInvoices::receiveInvoice(delivery, actor)`                          |
| `payment_events`              | `ReceivesPaymentEvents::paymentEvent(event, actor)` — avisos de pagamento do checkout da Central (§10). Idempotente por `event.id`.                              |
| `payment_notices`             | `paymentNotice(notice, actor)` — mensagens ao comprador (Pix, recuperação, recibo) quando o produto escolhe o canal Bridge (§10.7). Idempotente por `notice.id`. |

Usuário inexistente → 404 `not_found`.

## 7. Rotas (`/central-api/v1`)

| Método | Rota                                       | Resposta 200                                                                          |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| GET    | `health`                                   | `{version, product, capabilities: string[]}`                                          |
| GET    | `payments/{provider}/{id}/owner`           | `{owned, user_ref, kind: "subscription"\|"order"\|null, local_status}`                |
| GET    | `payments/{provider}/{id}/invoice-request` | `{requested, request_ref, email, service_description, taker: {document, name}\|null}` |
| GET    | `subscriptions?status=&page=`              | Página de `SubscriptionRecord`                                                        |
| GET    | `users?q=&page=`                           | Página de `UserSummary`                                                               |
| GET    | `users/{ref}`                              | `UserDetail`                                                                          |
| GET    | `metrics?from=YYYY-MM-DD&to=YYYY-MM-DD`    | `{data: [{date, metrics: {chave: inteiro}}]}`                                         |
| POST   | `users/{ref}/plan`                         | corpo `{plan (≤64), until: YYYY-MM-DD\|null, reason (≤500)}` → `{ok: true}`           |
| POST   | `users/{ref}/password-reset`               | `{ok: true, message: "E-mail de redefinição enviado."}`                               |
| POST   | `users/{ref}/suspend`                      | corpo `{reason}` → `{ok: true}`                                                       |
| POST   | `users/{ref}/unsuspend`                    | corpo `{reason}` → `{ok: true}`                                                       |
| POST   | `invoices`                                 | corpo `InvoiceDelivery` → `{ok: true}`                                                |
| POST   | `payment-events`                           | corpo `PaymentEvent` (§10) → `{ok: true}`                                             |
| POST   | `payment-notices`                          | corpo `PaymentNotice` (§10.7) → `{ok: true}`                                          |

`status` de assinatura: `trialing, active, past_due, canceled, expired, paused`.
`q` com no máximo 191 caracteres; `page` ≥ 1.

### Formas (snake_case no fio)

```
Page<T>            {data: T[], page, per_page, has_more}
SubscriptionRecord {ref, user_ref, provider, provider_subscription_id, status, plan,
                    amount_cents, currency, interval, current_period_end}
UserSummary        {ref, email, name, plan, suspended, created_at, last_seen_at}
UserDetail         UserSummary + {limits: {k: int|string|null}, usage: {k: int},
                    subscriptions: SubscriptionRecord[], recent_events: [{type, at, description}]}
InvoiceDelivery    {invoice_id, request_ref, provider, payment_id, status: "issued"|"canceled",
                    number, access_key, issued_at, pdf_url, xml_url, message, view_url?}
```

`receiveInvoice` deve ser idempotente por `invoice_id`.

## 8. Testes de conformidade

- `packages/bridge-test-vectors/signature.json`: casos com `method, path,
timestamp, body, now, signature, expect` (`valid`, `timestamp_skew`,
  `signature_invalid`). Toda implementação deve reproduzir `signature` para os
  casos `valid` e chegar ao mesmo `expect` em todos.
- `packages/bridge-test-vectors/sanitizer.json`: `input`, `allow`, `output`.
- `packages/bridge-test-vectors/payment_event.json`: um `PaymentEvent` no fio
  (`wire`) e a forma camelCase que o handler recebe (`parsed`); também o
  `PaymentRecord` de `GET /api/v1/payments/{id}` (`payment_wire` →
  `payment_parsed`), um `Plan` (`plan_wire` → `plan_parsed`) e o
  `PaymentNotice` (`notice_wire`/`reminder_wire` → `*_parsed`,
  `invalid_notices`).

## 9. API de faturação (produto → Central)

O produto chama a Central com o **mesmo token** e a mesma assinatura (§2),
mais o cabeçalho `X-Central-Product: <slug>`. Escritas exigem
`X-Idempotency-Key` (mesmas regras de §3, sem `X-Central-Actor`).

| Método | Rota na Central                |                                                                                                        |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| POST   | `/api/v1/invoices`             | emite NFS-e: `{taker: {document, name, email?}, amount_cents, description, service_code?, reference?}` |
| GET    | `/api/v1/invoices`             | lista as notas do produto (`?page=`)                                                                   |
| GET    | `/api/v1/invoices/{id}`        | detalhe                                                                                                |
| GET    | `/api/v1/invoices/{id}/pdf`    | DANFSe (PDF)                                                                                           |
| GET    | `/api/v1/invoices/{id}/xml`    | XML autorizado                                                                                         |
| POST   | `/api/v1/invoices/{id}/cancel` | `{reason}` (15–255 caracteres)                                                                         |

O produto só enxerga as próprias notas. Documentação viva em `/api/docs`.

## 10. Checkout da Central (produto → Central → gateway → produto)

A Central cria e confirma as cobranças com as **chaves dela**. O produto
nunca configura gateway (nada de `WOOVI_APP_ID` & cia.) e nunca define preço:
só escolhe o plano pelo `slug`.

### 10.1 Configuração (painel da Central)

Tela do produto → **Checkout e planos**:

- **Conta que cobra (padrão)**: conta de gateway da Central que cria as
  cobranças (hoje Woovi, Asaas e Stripe; qualquer conector com `createCharge` entra).
  Na Stripe a cobrança é uma Checkout Session hospedada (`checkout_url`, sem
  `pix` inline): o comprador paga na página da Stripe (cartão, Pix ou boleto,
  conforme ativos na conta) e volta para a URL do produto. Cadastre no
  endpoint da Stripe os eventos `checkout.session.*` além dos de cobrança e
  assinatura.
- **Planos**: slug, nome, preço em centavos (com preço riscado opcional),
  selo, benefícios, ordem, à venda ou não, e **gateway próprio** opcional
  (ex.: Pix avulso na Woovi e assinatura no cartão pelo Asaas).
- `interval` + `interval_count` = quanto tempo **um pagamento** libera
  (`day`/`week`/`month`/`year`; `lifetime` = para sempre). `recurring: true` =
  o gateway cobra de novo a cada período (precisa de gateway com assinatura,
  ex. Asaas ou Stripe no cartão; a Woovi só faz avulso).

O mesmo pode ser feito pelo MCP (`create_product_plan`,
`set_product_checkout_gateway`, `list_checkout_payments`…).

### 10.2 Rotas na Central (assinadas como §9)

| Método | Rota                    |                                                                                       |
| ------ | ----------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/api/v1/plans`         | `{data: Plan[]}` — só planos à venda, na ordem                                        |
| POST   | `/api/v1/payments`      | cria a cobrança; exige `X-Idempotency-Key` → 201 `{data: PaymentRecord}`              |
| GET    | `/api/v1/payments/{id}` | `{data: PaymentRecord}`; se pendente, a Central consulta o gateway antes de responder |

Corpo do `POST /api/v1/payments`:

```
{plan: "<slug>", customer: {name, email, document?}, product_user_ref: "<id do usuário no produto>",
 method?: "pix"|"card"|"boleto"|null, tracking?: {chave: texto}}
```

- `method` ausente/null = padrão do gateway (no Asaas o comprador escolhe na
  página hospedada). Método que o gateway não aceita → 502 `gateway_error`.
- Mesma chave + mesmo corpo → mesma cobrança (200, `X-Idempotency-Replayed:
true`); outro corpo → 409 `idempotency_conflict`.
- Erros: 422 `validation_failed` (com `fields`) / `plan_unavailable`;
  503 `checkout_unavailable` (sem gateway configurado); 502 `gateway_error`
  (o pagamento fica `failed`; tente de novo com **outra** chave).

### 10.3 Formas

```
Plan          {slug, name, description, interval: "day"|"week"|"month"|"year"|"lifetime",
               interval_count, recurring, amount_cents, original_amount_cents|null,
               currency: "BRL"|"USD"|"EUR", badge|null, features: string[], sort_order}
PaymentRecord {id (uuid), status: "pending"|"paid"|"expired"|"refunded"|"failed",
               plan: {slug, name, interval, interval_count, recurring},
               amount_cents, refunded_cents, currency, method: "pix"|"card"|"boleto"|"other",
               product_user_ref, customer: {name, email},
               pix: {copy_paste, qr_code_image_url|null, expires_at|null}|null,  // só pendente
               checkout_url|null,                                             // só pendente
               tracking: {..}, access_until|null,
               created_at, paid_at|null, refunded_at|null, expires_at|null}
PaymentEvent  {id: "evt_…", type, occurred_at, payment: PaymentRecord,
               subscription: {status, current_period_end|null}|null}
```

`currency` do plano é a moeda da cobrança (`PaymentRecord.currency` igual).
`USD`/`EUR` só com gateway que cobra nela (Stripe); Woovi e Asaas cobram só
`BRL`, e Pix só existe em `BRL`. O produto formata o preço pela moeda.

`type`: `payment.paid` (grave o acesso até `payment.access_until`),
`payment.refunded` (estorno total ou chargeback: revogue), `payment.expired`
(pendente que venceu), `subscription.renewed` (novo `access_until`) e
`subscription.ended` (o gateway não cobra mais; o acesso vale até
`access_until`).

`subscription` vem em todo plano pago **com período**, recorrente ou avulso
(`status` + `current_period_end` = `payment.access_until`); `null` só em plano
vitalício e em cobrança nunca paga.

### 10.4 Confirmação e aviso

1. O gateway avisa a Central (webhook verificado). Webhook sozinho **não
   libera**: a Central consulta o gateway pela API autenticada e só marca
   `paid` se o status for pago **e** o valor for cheio. Valor menor → fica
   pendente e gera alerta.
2. A Central grava no livro-razão (dono = o produto, usuário =
   `product_user_ref`) e emite o `PaymentEvent`.
3. A Central chama `POST {bridge}/payment-events` assinado (§2), com
   `X-Central-Actor` e `X-Idempotency-Key = event.id`. Falhou ou não respondeu
   2xx → tenta de novo (1, 5, 15, 30 min, 1, 2, 4, 8, 12 h… até 20 vezes) e
   alerta no painel na 3ª falha.
4. O produto libera/revoga localmente e responde `{ok: true}`. **Idempotente
   por `event.id`** (e, para liberar, por `payment.id`): o mesmo aviso pode
   chegar mais de uma vez.

Webhook perdido: o `GET /api/v1/payments/{id}` (tela de retorno do produto) e
a rotina `payments:pending` (a cada 5 min) consultam o gateway. O produto pode
liberar tanto pelo aviso quanto pelo `GET` que devolver `paid` — os dois são
idempotentes pelo `payment.id`.

### 10.5 Prazo de acesso (`access_until`)

A Central calcula até quando cada pagamento libera acesso; o produto só grava
a data (`null` = vitalício ou ainda não pago).

- **Plano avulso**: `paid_at` + `interval × interval_count`. Se o usuário
  (`product_user_ref`) ainda tem período pago em curso **de qualquer plano** do
  produto (também um importado por §10.6), o novo período começa no fim dele:
  trocar de plano (Pix → cartão, mensal → anual) não perde os dias restantes.
- **Plano recorrente**: o período do gateway, quando ele já passou da cobrança;
  senão vencimento da cobrança + período do plano (o webhook de pagamento do
  Asaas chega sem a assinatura atualizada).
- A assinatura do gateway é ligada à cobrança pelo id devolvido na criação
  (`checkouts.provider_subscription_id`), sem depender da ordem dos webhooks.
- Plano avulso não tem aviso de vencimento: o produto encerra pelo relógio
  (`agora ≥ access_until`).

### 10.6 Migrar assinaturas que o produto já tinha

Para um site que vendia antes da Central. Painel: Produto → Checkout e planos
→ **Migrar assinaturas existentes** (prévia, depois migrar). MCP:
`migrate_product_subscriptions` (`apply: false` = prévia).

A Central lê `GET subscriptions` da Bridge (§7) e, para cada assinatura
`active`/`trialing`/`past_due`:

| Caso                                                                            | O que acontece                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider_subscription_id` existe no livro-razão (mesmo `provider`)             | **Adotada**: a assinatura passa a ser do produto e do `user_ref`; cada cobrança paga depois da migração vira `subscription.renewed` e o cancelamento vira `subscription.ended`. |
| `provider_subscription_id` nulo e `current_period_end` futuro                   | **Importada**: período avulso já pago; o próximo pagamento avulso pela Central (de qualquer plano) soma a ele. Exige a conta que cobra configurada.                             |
| Assinatura de gateway fora do livro-razão, de outro produto, ou sem data de fim | Ignorada, com o motivo na prévia.                                                                                                                                               |

- `plan` deve ser o **slug do plano na Central**; a prévia lista os que não
  batem.
- Não cobra, não grava no produto e não emite aviso. Idempotente por `ref`:
  rodar de novo só atualiza, e nunca encurta um período que uma renovação
  já estendeu.
- Cada assinatura migrada vira uma cobrança `paid` de origem `migration`; os
  avisos seguintes levam esse `payment.id` (novo para o produto), por isso o
  produto localiza o usuário por `payment.product_user_ref`.

### 10.7 Mensagens ao comprador: Pix, recuperação e recibo

A Central monta as mensagens ao comprador de cada cobrança com **modelos por
produto** (Produto → Checkout e planos → "Pix, recuperação e recibo"; MCP
`get_payment_notices` / `update_payment_notices` / `list_payment_notices`):

| Tipo                           | Quando                                                             | Só se                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `payment.created` (step 0)     | logo após `POST /api/v1/payments` criar a cobrança                 | ainda pendente                                                                                                                   |
| `payment.reminder` (step 1..3) | `delayMinutes` após a criação (5–1435 min, dentro das 24 h do Pix) | pendente, não vencida e a cobrança **mais recente** do mesmo `product_user_ref`; com vários vencidos de uma vez, só o último sai |
| `payment.confirmed` (step 0)   | até 1 min depois de o pagamento ser confirmado (janela de 2 h)     | `paid`, origem checkout (nunca migração)                                                                                         |

Curingas (`{{nome}}` desconhecido é recusado ao salvar): `name`,
`first_name`, `email`, `product`, `plan`, `amount` (`R$ 10,90`), `pix_code`,
`payment_url`, `expires_at` (`dd/mm/aaaa hh:mm` no fuso do produto),
`access_until` (`dd/mm/aaaa` ou "sem prazo").

**Canal**, por produto:

- `email` (padrão): a Central envia pelo Resend configurado em
  **Configurações → E-mail** (chave da API e remetente padrão; em branco = `.env`).
  Remetente = endereço da Central com o **nome do produto**, `Reply-To` opcional
  do produto. HTML com o texto, o valor e, enquanto pendente, o QR Code, o Pix
  copia e cola e o botão "Abrir link de pagamento". Não exige nada do produto.
- `bridge`: a Central chama `POST {bridge}/payment-notices` assinado (§2), com
  `X-Central-Actor` e `X-Idempotency-Key = notice.id`. Só envia se o
  `/health` anuncia `payment_notices`. O produto entrega `message` pelo canal
  dele (e-mail, push, WhatsApp) e responde `{ok: true}`. **Nunca** mexe no
  acesso aqui (isso é `payment-events`).

```
PaymentNotice {id: "ntc_…", type: "payment.created"|"payment.reminder"|"payment.confirmed",
               step, occurred_at, payment: PaymentRecord,
               message: {subject, text}}   // já montados, curingas preenchidos
```

Falhou: tenta de novo em 1, 3, 10 e 30 min (5 tentativas; mensagem atrasada
não serve) e alerta no painel na última. Um aviso que deixou de valer
(cobrança paga, vencida ou substituída; avisos desligados) é descartado
(`skipped`) em vez de enviado. Rotina: `payments:notices` (a cada 1 min).
