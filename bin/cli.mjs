#!/usr/bin/env node
// Installs / updates the `central-bridge` agent skill.
//
//   npx -y github:kellvembarbosa/central-bridge-skill install [--global | --dir <skills-dir>] [--force]
//   npx -y github:kellvembarbosa/central-bridge-skill update  [--global | --dir <skills-dir>]
//   npx -y github:kellvembarbosa/central-bridge-skill check
//   npx -y github:kellvembarbosa/central-bridge-skill uninstall [--global | --dir <skills-dir>]
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SKILL_NAME = 'central-bridge'
export const REPO = 'kellvembarbosa/central-bridge-skill'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

/** Skills directory chosen by the flags (default: the project's `.claude/skills`). */
export function skillsDir(flags, cwd = process.cwd()) {
  if (flags.dir) return resolve(cwd, flags.dir)
  if (flags.global) return join(homedir(), '.claude', 'skills')
  return join(cwd, '.claude', 'skills')
}

export function installedVersion(dest) {
  const file = join(dest, 'VERSION')
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null
}

/** true when semver `a` is newer than `b`. */
export function newer(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

export function install(dir, { force = false } = {}) {
  const dest = join(dir, SKILL_NAME)
  if (existsSync(dest) && !installedVersion(dest) && !force) {
    throw new Error(`${dest} exists and was not installed by this tool. Use --force to replace it.`)
  }
  rmSync(dest, { recursive: true, force: true })
  cpSync(join(root, 'skill', SKILL_NAME), dest, { recursive: true })
  materializeLinks(dest)
  writeFileSync(join(dest, 'VERSION'), `${VERSION}\n`)
  return dest
}

/**
 * Inside the monorepo the contract is a symlink to docs/central (cpSync keeps
 * nested links even with `dereference`): replace each link by a real file.
 */
function materializeLinks(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      const target = realpathSync(path)
      rmSync(path)
      copyFileSync(target, path)
    } else if (entry.isDirectory()) {
      materializeLinks(path)
    }
  }
}

export function uninstall(dir) {
  const dest = join(dir, SKILL_NAME)
  if (!existsSync(dest)) return null
  if (!installedVersion(dest)) throw new Error(`${dest} was not installed by this tool; not removing.`)
  rmSync(dest, { recursive: true, force: true })
  return dest
}

/** Newest released version (highest `vX.Y.Z` tag), or null when GitHub is unreachable. */
export async function latestVersion() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/tags?per_page=100`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'central-bridge-skill' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const tags = (await res.json())
      .map((t) => t.name)
      .filter((n) => /^v\d+\.\d+\.\d+$/.test(n))
      .map((n) => n.slice(1))
    return tags.reduce((max, v) => (max === null || newer(v, max) ? v : max), null)
  } catch {
    return null
  }
}

function parse(argv) {
  const flags = { global: false, force: false, dir: null }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--global' || a === '-g') flags.global = true
    else if (a === '--force') flags.force = true
    else if (a === '--dir') flags.dir = argv[++i]
    else rest.push(a)
  }
  return { command: rest[0] ?? 'help', flags }
}

const HELP = `central-bridge-skill v${VERSION}

Usage:
  install    [--global | --dir <skills-dir>] [--force]  copy the skill (default: ./.claude/skills)
  update     [--global | --dir <skills-dir>]            install the newest released version
  check                                                 installed vs newest version
  uninstall  [--global | --dir <skills-dir>]

--global = ~/.claude/skills. Other agents: --dir .agents/skills (Codex), etc.`

async function main(argv) {
  const { command, flags } = parse(argv)
  const dir = skillsDir(flags)

  if (command === 'install') {
    const dest = install(dir, flags)
    console.log(`central-bridge skill v${VERSION} installed at ${dest}`)
    return
  }

  if (command === 'update') {
    const latest = await latestVersion()
    if (latest && newer(latest, VERSION)) {
      console.log(`Updating to v${latest}…`)
      const passthrough = flags.dir ? ['--dir', resolve(flags.dir)] : flags.global ? ['--global'] : []
      const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
      const r = spawnSync(npx, ['-y', `github:${REPO}#v${latest}`, 'install', '--force', ...passthrough], {
        stdio: 'inherit',
      })
      process.exitCode = r.status ?? 1
      return
    }
    if (!latest) console.log('Could not reach GitHub; installing this version.')
    const dest = install(dir, { force: true })
    console.log(`central-bridge skill v${VERSION} installed at ${dest}`)
    return
  }

  if (command === 'check') {
    const latest = await latestVersion()
    const places = [
      ['project', join(skillsDir({}), SKILL_NAME)],
      ['global', join(skillsDir({ global: true }), SKILL_NAME)],
    ]
    for (const [label, path] of places) {
      console.log(`${label.padEnd(8)} ${installedVersion(path) ?? 'not installed'}  (${path})`)
    }
    console.log(`latest   ${latest ?? 'unknown (GitHub unreachable)'}`)
    const outdated = places.some(([, p]) => {
      const v = installedVersion(p)
      return v && latest && newer(latest, v)
    })
    if (outdated) console.log(`Update: npx -y github:${REPO}#v${latest} update`)
    return
  }

  if (command === 'uninstall') {
    const dest = uninstall(dir)
    console.log(dest ? `Removed ${dest}` : 'Nothing to remove.')
    return
  }

  console.log(HELP)
}

// npx runs the bin through a symlink in node_modules/.bin.
const entry = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : ''
if (import.meta.url === entry) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message)
    process.exitCode = 1
  })
}
