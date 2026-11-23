import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SKILL_NAME, VERSION, install, installedVersion, newer, skillsDir, uninstall } from '../bin/cli.mjs'

const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url))
const tmp = () => mkdtempSync(join(tmpdir(), 'cbs-'))

test('install copies the skill with VERSION and a real contract file', () => {
  const dir = tmp()
  const dest = install(dir)
  assert.equal(dest, join(dir, SKILL_NAME))
  assert.equal(installedVersion(dest), VERSION)
  const skill = readFileSync(join(dest, 'SKILL.md'), 'utf8')
  assert.match(skill, /^---\nname: central-bridge\ndescription: /)
  const contract = join(dest, 'references', 'bridge-contract.md')
  assert.equal(lstatSync(contract).isSymbolicLink(), false)
  assert.match(readFileSync(contract, 'utf8'), /Contrato da Bridge/)
  for (const ref of ['detect-stack.md', 'mcp-tools.md', 'payments.md']) {
    assert.ok(existsSync(join(dest, 'references', ref)), ref)
  }
})

test('reinstall replaces files; foreign folder needs --force', () => {
  const dir = tmp()
  const dest = install(dir)
  writeFileSync(join(dest, 'stale.md'), 'x')
  install(dir)
  assert.equal(existsSync(join(dest, 'stale.md')), false)

  const other = tmp()
  mkdirSync(join(other, SKILL_NAME))
  assert.throws(() => install(other), /--force/)
  install(other, { force: true })
  assert.equal(installedVersion(join(other, SKILL_NAME)), VERSION)
})

test('uninstall removes only what it installed', () => {
  const dir = tmp()
  assert.equal(uninstall(dir), null)
  install(dir)
  uninstall(dir)
  assert.equal(existsSync(join(dir, SKILL_NAME)), false)
  mkdirSync(join(dir, SKILL_NAME))
  assert.throws(() => uninstall(dir), /not installed by this tool/)
})

test('skillsDir: project default, --dir, --global', () => {
  assert.equal(skillsDir({}, '/p'), '/p/.claude/skills')
  assert.equal(skillsDir({ dir: '.agents/skills' }, '/p'), '/p/.agents/skills')
  assert.match(skillsDir({ global: true }), /\.claude\/skills$/)
})

test('newer compares semver', () => {
  assert.equal(newer('1.0.1', '1.0.0'), true)
  assert.equal(newer('1.10.0', '1.9.9'), true)
  assert.equal(newer('1.0.0', '1.0.0'), false)
  assert.equal(newer('0.9.0', '1.0.0'), false)
})

test('cli install into the cwd project', () => {
  const cwd = tmp()
  const out = execFileSync(process.execPath, [cli, 'install'], { cwd, encoding: 'utf8' })
  assert.match(out, /installed at/)
  assert.equal(installedVersion(join(cwd, '.claude', 'skills', SKILL_NAME)), VERSION)
})
