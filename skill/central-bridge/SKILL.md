---
name: central-bridge
description: Connect a product repository to the Central (gestão panel) through the Central Bridge. Recognizes the project stack, finds or creates the product with the Central MCP, reads its setup briefing, lets the owner choose capabilities, installs and configures the Bridge package, sets up checkout/plans/payment notices/invoicing, and verifies the connection. Also upgrades an existing integration. Use when the user asks to install, connect, integrate, configure, update or debug the Central Bridge, sell through the Central checkout, or wire a project to the Central.
---

# Central Bridge

The **Central** is the owner's management panel (sales, subscriptions, NFS-e, revenue,
alerts for every product). The **Bridge** is a small HMAC-signed API each product exposes at
`/central-api/v1` so the Central can ask the product questions (who owns this payment? list
users, change plan, deliver an invoice, payment events…). The Central never writes to the
product database: it asks, the product decides.

You run inside the **product** repository. You talk to the Central through its **MCP server**
(tools such as `whoami`, `list_products`, `get_product_briefing`; the prefix depends on how the
server was added, usually `mcp__gestao__…`).

## Sources of truth (in this order)

1. **The product briefing** (`get_product_briefing`): generated live by the Central from this
   product's record. It has the exact package versions, install commands, env var names,
   required capabilities and checklists for this stack. Always prefer it.
2. `references/bridge-contract.md`: the wire contract (signature, errors, routes, shapes,
   checkout §10). Bundled with this skill; the briefing wins if they disagree (the skill may be
   older — run the update check below).
3. The installed package README (`node_modules/@central/bridge-*/README.md` or
   `vendor/central/bridge-laravel/README.md`).

Other references: `references/detect-stack.md` (recognize the project),
`references/mcp-tools.md` (which tool for which step), `references/payments.md`
(checkout, plans, notices, migration, shared gateways).

## Hard rules

- **Secrets never pass through you.** The MCP briefing always masks `CENTRAL_BRIDGE_TOKEN`.
  The owner copies the real token from the panel (Produto → Bridge, or Briefing → "Mostrar com
  os valores") straight into `.env` / the deploy platform. Never ask for it in chat, never
  print, log, commit or store it in memory. Confirm `git check-ignore .env` prints `.env`.
- **The Central owns checkout, prices and access dates.** The product never stores gateway
  keys (no `WOOVI_APP_ID`, `ASAAS_API_KEY`…) and never computes access periods: it stores
  `access_until` from the Central.
- **Money is integer cents + ISO currency.** Never floats.
- **Ask before every MCP write** (`create_product`, `update_product`, plans, gateway,
  notices, links, migration with `apply: true`). Show the exact values first; these change
  what real customers are charged. Read-only tools need no confirmation.
- **Use names exactly** as the briefing/contract spells them (env vars, routes, headers,
  capability keys). A wrong name fails silently on the Central side.
- `PENDENTE: …` in the briefing means the value does not exist yet. Never invent it: leave the
  variable empty, finish the rest, and list it for the owner.
- Never edit the Bridge packages inside `node_modules`/`vendor`, and never touch the Central
  repository from here. Package bugs go to the owner as a report.
- Never create real charges to "test". Use a sandbox gateway account or ask the owner.

## Step 0 — Preconditions

1. **Skill version.** If `npx` is available, run
   `npx -y github:kellvembarbosa/central-bridge-skill check` once per session. If it reports a
   newer version, tell the owner and suggest `… update` (do not block on it).
2. **MCP.** Call `whoami`. If no Central MCP tool exists, stop and tell the owner to add it
   (they run it, OAuth opens in the browser):

   ```bash
   claude mcp add --transport http gestao https://<central-url>/mcp
   ```

   then `/mcp` → authenticate, and restart the session. The user needs the `product.manage`
   permission (plus `gateway.manage` / `finance.view` for payments). Without MCP you can still
   proceed if the owner pastes the briefing Markdown; skip the MCP-only steps and say so.

## Step 1 — Recognize the project

Follow `references/detect-stack.md`. Produce a short profile and show it to the owner:

- **stack** (Central enum: `laravel | adonisjs | nextjs | astro | sveltekit | tanstack_start |
  cloudflare | swiftui | kotlin | compose | flutter | other`) and **type** (`saas | site |
  app_ios | app_android`);
- **mode**: `install` (no Bridge yet), `update` (Bridge present, older version or older
  briefing) or `repair` (present but `/health` failing or capabilities missing);
- where users, plans/subscriptions and payments live today (models/tables), and whether the
  project already sells (existing gateway code, subscribers) — this drives Steps 4–6.

## Step 2 — Find the product in the Central

1. If `.env`/`.env.example` has `CENTRAL_BRIDGE_PRODUCT`, that is the slug.
2. Otherwise `list_products` and match by slug, URL/domain, name or repo name. Show the
   candidates; let the owner confirm.
3. None matches → propose `create_product` with name, type, stack, url (apps: call
   `lookup_store_app` first to prefill). Confirm, then create.
4. Product stack differs from the detected one → propose `update_product` (`stack`).

## Step 3 — Read the briefing

`get_product_briefing({ id })`. Read it **entirely** before changing code. Extract: briefing
version, package + version for this stack, env vars (`where: env | app`), required vs optional
capabilities, `PENDENTE` items, checklist.

Mode `update`: compare with the "Conexão com a Central" section in the project `CLAUDE.md`
(briefing version) and the installed package version. Upgrade the package to the briefing
version and re-check every section against the current code.

## Step 4 — Choose capabilities with the owner

Present one table: capability · required/recommended/optional (from the briefing) · what it
means in **this** project (which model/service answers it). Ask the owner which optional ones
to implement (offer the recommended set as default). Capabilities and handlers are in
contract §6; the briefing marks as **obrigatório** what this product's Central setup needs:

- `payment_events` — required when the product sells through the Central checkout.
- `payment_owner` — required when a gateway account is shared (`ask_product` link).
- `invoices` — required when automatic NFS-e is on.
- `payment_notices` — only if buyer messages go through the product (channel `bridge`).
- `subscriptions` — required to migrate a site that already has subscribers.
- `users_search` + `user_detail`, `metrics` — recommended.
- `change_plan`, `password_reset`, `suspend` — optional support actions.

Implement only what was chosen; missing handlers answer `501 capability_unsupported`.

## Step 5 — Install and configure the Bridge

Follow the briefing section for the stack (install command pinned to the version it gives,
provider/route registration, handlers). Then:

1. Add every env var name to `.env.example` **without value**; real values only in `.env`.
   `CENTRAL_BRIDGE_ENABLED=true`, `CENTRAL_BRIDGE_PRODUCT=<slug>`, `CENTRAL_URL=<central>`,
   `CENTRAL_BRIDGE_TOKEN=` (owner fills), `CENTRAL_BRIDGE_ALLOWED_IPS=` (optional).
2. Web runtimes (`@central/bridge-web`): token is a server secret (never `PUBLIC_`/`VITE_`/
   `NEXT_PUBLIC_`); writes need an atomic idempotency store (D1 or Upstash Redis, not KV);
   IP allow-list needs a platform IP resolver; rewrites must keep the signed path.
3. Handlers: idempotent (`event.id`, `notice.id`, `invoice_id`, `payment.id`), never leak
   secrets (the sanitizer is the last barrier, not the first), unknown user → 404.
4. Write tests in the project's framework: signed `GET /central-api/v1/health` returns
   `{version, product, capabilities}` with the chosen capabilities; unsigned → 401; one test
   per handler (e.g. `payment.paid` grants access until `access_until`, replay is a no-op).
5. Update the project `CLAUDE.md` section **"Conexão com a Central"**: briefing version and
   date, what was implemented, env var **names**, link to the briefing. Never values.

## Step 6 — Payments (if the product sells)

Read `references/payments.md` and walk the owner through the decisions (gateway account,
plans, recurring vs one-off, buyer messages channel, migration of existing subscribers,
shared-account attribution). Configure the Central side with the MCP tools (each write
confirmed), then build the product side: plans page from `GET /api/v1/plans`, create the
charge with `POST /api/v1/payments`, show Pix/checkout URL, return page polling
`GET /api/v1/payments/{id}`, and the `payment_events` handler.

## Step 7 — Invoicing (optional)

If the owner wants NFS-e: `get_nfse_issuer` (issuer must be configured in the Central),
`update_product` (`autoInvoice`, `invoiceServiceCode`, `invoiceDescription`) after
confirmation, and the `invoices` capability (`invoiceRequest` + `receiveInvoice`), or call
the invoicing API (contract §9) through the package's `CentralClient`.

## Step 8 — Apps (iOS / Android)

Follow the briefing app sections (RevenueCat stable `app_user_id`, entitlement, restore
purchases; AdMob). Public keys are set with `update_product_briefing` (they are not secrets).
Apps usually have no Bridge: their backend, if any, is a separate product.

## Step 9 — Verify

1. Project tests and typecheck pass.
2. After the owner deploys with the env vars set: if the product has no `bridgeUrl`, propose
   `update_product` with `https://<domain>/central-api/v1`; then `check_product_bridge`. The
   capabilities it reports must equal the chosen set.
3. Payments: `list_checkout_payments` and `get_gateway_event_health` after a sandbox charge;
   `list_payment_notices` if notices are on.
4. Walk the briefing "Checklist final" item by item; only report done when every item is
   confirmed.

## Step 10 — Report to the owner

Short summary: what was implemented, capabilities live, env var names to set in production,
`PENDENTE` items, Central-side changes made through MCP (with ids), and anything not verified.
