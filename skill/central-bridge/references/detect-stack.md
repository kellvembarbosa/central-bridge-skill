# Recognize the project

Read manifests, not guesses. First match wins (a monorepo may hold several products: ask
which one).

| Signal | Stack (Central enum) | Bridge package |
|---|---|---|
| `composer.json` requires `laravel/framework` | `laravel` | `central/bridge-laravel` (Composer, `vcs` repo) |
| `package.json` has `@adonisjs/core` | `adonisjs` | `@central/bridge-adonis` (GitHub tag) |
| `package.json` has `next` | `nextjs` | `@central/bridge-web` |
| `package.json` has `astro` | `astro` | `@central/bridge-web` |
| `package.json` has `@sveltejs/kit` | `sveltekit` | `@central/bridge-web` |
| `package.json` has `@tanstack/react-start` / `@tanstack/start` | `tanstack_start` | `@central/bridge-web` |
| `wrangler.toml` / `wrangler.jsonc` and none of the above | `cloudflare` | `@central/bridge-web` |
| `*.xcodeproj` / `Package.swift` with SwiftUI | `swiftui` | none (RevenueCat + AdMob) |
| `build.gradle(.kts)` with `androidx.compose` | `compose` | none |
| `build.gradle(.kts)` Android, no Compose | `kotlin` | none |
| `pubspec.yaml` with `flutter` | `flutter` | none |
| anything else with an HTTP server | `other` | implement the contract (or `@central/bridge-web` if it runs Web `Request`/`Response`) |

**Type**: mobile stacks → `app_ios` / `app_android`; web with accounts and paid plans →
`saas`; content/landing/shop without accounts → `site`.

## Existing integration

- Bridge installed? `npm ls @central/bridge-adonis @central/bridge-web` /
  `composer show central/bridge-laravel`. Note the version.
- Third-party `applu/central-bridge` (namespace `Applu\CentralBridge`) is wire-compatible but
  not ours: propose migrating to `central/bridge-laravel`, never edit it.
- `CLAUDE.md` section "Conexão com a Central" → briefing version and date.
- `.env.example` with `CENTRAL_BRIDGE_*` → slug and expected vars.
- Routes under `central-api/v1` → hand-written implementation (`other`).

## Domain map (needed for capabilities and payments)

Find and note file paths for:

- the user model (id used as `user_ref` / `product_user_ref`; email; suspended flag);
- plans/subscriptions/entitlements (how "user has plan X until date" is stored);
- current payment code (gateway SDKs, webhooks, stored gateway ids) and whether there are
  live subscribers — they are migrated, never dropped;
- mailer/push/WhatsApp channel (for `payment_notices` / `password_reset`);
- test framework and how other HTTP routes are tested.
