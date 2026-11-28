# Central MCP tools by step

Names are bare; the client adds a prefix (e.g. `mcp__gestao__list_products`). The server
only exposes tools the signed-in user may use; a missing tool usually means a missing
permission — tell the owner which one.

Writes (✎) need the owner's confirmation with the exact values first.

| Step | Tool | Use |
|---|---|---|
| 0 | `whoami` | MCP connected? who am I, which permissions |
| 2 | `list_products`, `get_product` | find the product (Bridge health, capabilities) |
| 2 | `lookup_store_app` | prefill an app from App Store / Google Play |
| 2 | ✎ `create_product` | name, type, stack, url, bridgeUrl |
| 2,7,9 | ✎ `update_product` | stack, url, `bridgeUrl`, `autoInvoice`, `invoiceServiceCode`, `invoiceDescription` |
| 5,9 | ✎ `rotate_product_bridge_token` | new `CENTRAL_BRIDGE_TOKEN` in plain text, once; the old one stops working at once. Write it only to `.env` / deploy secret |
| 3 | `get_product_briefing` | the setup Markdown (token masked; never pass `reveal: true`, that is for the owner in the app) |
| 8 | ✎ `update_product_briefing` | stack + public app keys (RevenueCat SDK key, entitlement, AdMob ids) |
| 6 | `list_connections`, `get_gateway_event_health` | gateway accounts and webhook health |
| 6 | ✎ `create_gateway_link`, `delete_gateway_link` | attribute an account's charges to the product (`exclusive`, `ask_product`, `match_app_id`, `match_price`) |
| 6 | ✎ `set_product_checkout_gateway` | account (Central keys) that creates charges; `null` turns checkout off |
| 6 | `list_product_plans` / ✎ `create_product_plan`, `update_product_plan`, `delete_product_plan` | plans sold by the product (prefer `active=false` to delete) |
| 6 | `get_payment_notices` / ✎ `update_payment_notices` / `list_payment_notices` | Pix, reminders and receipt messages; channel `email` or `bridge` |
| 6 | ✎ `migrate_product_subscriptions` | bring existing subscribers (`apply: false` = preview, always first) |
| 6,9 | `list_checkout_payments` | charges created for the product + delivery status of each event |
| 6 | ✎ `retry_payment_event` | resend a failed event to the Bridge after fixing the handler |
| 7 | `get_nfse_issuer` | NFS-e issuer configured? |
| 9 | `check_product_bridge` | call `/health` now and refresh capabilities |
| 9 | `search_product_users`, `get_product_user` | exercise `users_search` / `user_detail` |
| any | `list_alerts`, `list_divergences` | problems the Central detected for the product |
