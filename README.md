# central-bridge skill

Agent skill (Claude Code, Codex and any agent that reads `SKILL.md`) that connects a product
repository to the **Central** through the **Central Bridge**:

1. recognizes the project (stack, type, users/plans/payments, existing integration);
2. finds or creates the product with the **Central MCP** and reads its live setup briefing;
3. lets the owner choose the Bridge capabilities;
4. installs and configures the right package (`central/bridge-laravel`,
   `@central/bridge-adonis`, `@central/bridge-web`);
5. sets up checkout, plans, buyer messages (Pix, reminders, receipt), migration of existing
   subscribers and NFS-e invoicing;
6. verifies (`check_product_bridge`, sandbox charge, checklist) and reports what is pending.

It ships the Bridge contract (`references/bridge-contract.md`) and evolves together with the
Bridge packages: same source repository, same release flow.

## Install

In the product repository (installs to `.claude/skills/central-bridge`):

```bash
npx -y github:kellvembarbosa/central-bridge-skill#v1.3.1 install
```

For every project on this machine (`~/.claude/skills`):

```bash
npx -y github:kellvembarbosa/central-bridge-skill#v1.3.1 install --global
```

Other agents: `--dir <skills-dir>` (e.g. `--dir .agents/skills` for Codex).

## Update

```bash
npx -y github:kellvembarbosa/central-bridge-skill check
```

```bash
npx -y github:kellvembarbosa/central-bridge-skill update
```

`update` looks up the newest `vX.Y.Z` tag and installs it in place (add `--global` / `--dir`
for those locations). `uninstall` removes only a folder this tool installed.

## Requirements

- Node.js ≥ 20 (only to run the installer; the skill itself is Markdown).
- The Central MCP added to the agent, for example in Claude Code:

  ```bash
  claude mcp add --transport http gestao https://<central-url>/mcp
  ```

  then authenticate with `/mcp`. The user needs `product.manage` (plus `gateway.manage` /
  `finance.view` for payments).

## Use

Ask the agent in the product repository: "connect this project to the Central" /
"install the Central Bridge" / "sell through the Central checkout". The Bridge token comes
from the panel (copied by the owner) or from the MCP tool `rotate_product_bridge_token`,
which the agent runs only after the owner confirms and writes straight into the gitignored
`.env` / deploy secret, never into chat, logs, commits or memory.

## License

MIT
