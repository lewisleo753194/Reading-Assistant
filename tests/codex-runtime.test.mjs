import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCodexProcessSpec } from '../server/codex-runtime.mjs'

const env = { LOCALAPPDATA: 'C:/Reader Profile/AppData/Local', ComSpec: 'cmd.exe' }
const readDirectory = async () => ['old', 'current', 'broken'].map(name => ({ name, isDirectory: () => true }))

test('new desktop CLI replaces an older PATH CLI and broken installation is ignored', async () => {
  const spec = await resolveCodexProcessSpec({ platform: 'win32', env, readDirectory, getVersion: async spec => {
    if (spec.command === 'cmd.exe') return '0.148.0'
    if (spec.command.includes('broken')) throw new Error('missing executable')
    return spec.command.includes('current') ? '0.159.2' : '0.99.0'
  } })
  assert.match(spec.command, /current[\\/]codex\.exe$/)
  assert.deepEqual(spec.args, ['app-server'])
})

test('newer independent CLI wins over older desktop bundles using numeric version comparison', async () => {
  const spec = await resolveCodexProcessSpec({ platform: 'win32', env, readDirectory, getVersion: async spec => spec.command === 'cmd.exe' ? '0.160.0' : '0.99.0' })
  assert.deepEqual(spec, { command: 'cmd.exe', args: ['/d', '/s', '/c', 'codex app-server'] })
})

test('desktop-only installation works when PATH CLI is absent', async () => {
  const spec = await resolveCodexProcessSpec({ platform: 'win32', env, readDirectory, getVersion: async spec => {
    if (spec.command === 'cmd.exe') throw new Error('not found')
    return '0.159.2'
  } })
  assert.match(spec.command, /codex\.exe$/)
  assert.deepEqual(spec.args, ['app-server'])
})

test('explicit CLI path is authoritative and is passed directly even with spaces', async () => {
  const command = 'D:/Custom Tools/codex.exe'
  const unexpected = () => { throw new Error('must not discover or probe overrides') }
  assert.deepEqual(await resolveCodexProcessSpec({ platform: 'win32', env: { ...env, CODEX_CLI_PATH: command }, readDirectory: unexpected, getVersion: unexpected }), { command, args: ['app-server'] })
})

test('missing desktop installation and failed probes preserve PATH fallback', async () => {
  for (const read of [async () => { throw new Error('not installed') }, readDirectory]) {
    const spec = await resolveCodexProcessSpec({ platform: 'win32', env, readDirectory: read, getVersion: async () => { throw new Error('timeout') } })
    assert.deepEqual(spec, { command: 'cmd.exe', args: ['/d', '/s', '/c', 'codex app-server'] })
  }
})

test('non-Windows resolution preserves the system Codex executable', async () => {
  assert.deepEqual(await resolveCodexProcessSpec({ platform: 'linux', env: {} }), { command: 'codex', args: ['app-server'] })
})
