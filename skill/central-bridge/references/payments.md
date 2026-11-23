# Payments through the Central

Contract §10 is the spec. This file is the decision flow. Ask the owner each decision; write
to the Central only after confirmation.

## 1. How does this product get paid?

| Situation | Path |
|---|---|
| New product, sells plans/access | **Central checkout** (below). Recommended. |
| Already sells with its own gateway code | Central checkout + **migration** (§5); remove gateway keys from the product only after the owner confirms the cut-over. |
| Mobile app with in-app purchases | RevenueCat (briefing app section) + `create_gateway_link` `match_app_id`. No checkout. |
| Charges created by the product in a gateway account shared with other products | Keep, but implement `payment_owner` and link with `ask_product`. |

## 2. Gateway account

1. `list_connections` → existing accounts (provider, environment, webhook health).
2. Pick the account that creates the charges (Woovi for Pix one-off; Asaas for card /
   recurring). `set_product_checkout_gateway({ productId, gatewayAccountId })`. The tool
   refuses providers that cannot create charges yet.
3. No suitable account → the owner creates it in the panel (keys are secrets: never through
   you). Use a **sandbox** account while developing.

## 3. Plans

Ask for each plan: `slug` (stable, used by the product code), name, price in **cents**,
optional `original_amount_cents`, badge, features, sort order, `interval` +
`interval_count` (`lifetime` = forever), `recurring` (needs a gateway with subscriptions,
e.g. Asaas; Woovi is one-off only), optional per-plan gateway account.
`list_product_plans` first; then `create_product_plan` / `update_product_plan`.

Product side: read plans with `GET /api/v1/plans` (never hard-code prices), keep plan slugs
in code only as identifiers.

## 4. Charge flow in the product

1. User picks a plan → `POST /api/v1/payments` with `X-Idempotency-Key` (one key per purchase
   attempt; on `502 gateway_error` retry with a **new** key) and body
   `{plan, customer: {name, email, document?}, product_user_ref, method?, tracking?}`.
2. Show `pix.copy_paste` / QR or redirect to `checkout_url`.
3. Return page polls `GET /api/v1/payments/{id}` until `paid` / `expired` / `failed`.
4. `payment_events` handler: `payment.paid` and `subscription.renewed` → store
   "user has plan until `payment.access_until`" (null = lifetime); `payment.refunded` →
   revoke; `payment.expired` → mark the attempt; `subscription.ended` → no more renewals,
   access still valid until `access_until`. Idempotent by `event.id` and, for granting, by
   `payment.id`. Find the user by `payment.product_user_ref`.
5. One-off plans have no expiry event: the product checks `now >= access_until`.

The package's `CentralClient` signs these calls (`X-Central-Product` + same token/signature).

## 5. Migration of existing subscribers (contract §10.6)

Needs the `subscriptions` capability returning `plan` = **Central plan slug**.
`migrate_product_subscriptions({ productId, apply: false })` → show the preview (adopted,
imported, ignored + reasons, slugs that do not match) → fix → run with `apply: true` only
after the owner approves. Idempotent; never charges anyone.

## 6. Buyer messages: Pix, reminders, receipt (contract §10.7)

`get_payment_notices` → defaults. Decide:

- **channel**: `email` (default; the Central sends with its Resend sender and the product
  name — nothing to build) or `bridge` (product implements `payment_notices` and delivers
  `message.subject`/`message.text` by its own channel; never changes access there);
- reminders (up to 3, `delayMinutes` 5–1435) and texts; placeholders: `name`, `first_name`,
  `email`, `product`, `plan`, `amount`, `pix_code`, `payment_url`, `expires_at`,
  `access_until` (unknown placeholders are refused).

Apply with `update_payment_notices`; check with `list_payment_notices`.

## 7. Attribution when charges do not come from the checkout

`create_gateway_link` with `exclusive` (whole account is this product), `ask_product`
(shared account → `payment_owner` required: store the gateway charge/subscription ids when
creating charges), `match_app_id` (RevenueCat app id) or `match_price` (gateway price id).

## 8. Verify

Sandbox charge → `list_checkout_payments` shows it `paid` with the event delivered → user
has access in the product. Failed delivery: fix the handler, then `retry_payment_event`.
