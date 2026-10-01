import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const runFile = promisify(execFile)

async function probeVersion(spec) {
  const { stdout } = await runFile(spec.command, spec.versionArgs || ['--version'], {
    windowsHide: true, timeout: 3000, maxBuffer: 64 * 1024, cwd: os.tmpdir(),
  })
  return String(stdout).match(/codex-cli\s+(\d+\.\d+\.\d+)/)?.[1] || ''
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number), b = right.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

export async function resolveCodexProcessSpec({ platform = process.platform, env = process.env, readDirectory = readdir, getVersion = probeVersion } = {}) {
  const configuredPath = String(env.CODEX_CLI_PATH || '').trim()
  if (configuredPath) return { command: configuredPath, args: ['app-server'] }
  if (platform !== 'win32') return { command: 'codex', args: ['app-server'] }

  const fallback = {
    command: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'codex app-server'],
    versionArgs: ['/d', '/s', '/c', 'codex --version'],
  }
  const candidates = []
  if (env.LOCALAPPDATA) {
    const bin = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
    const entries = await readDirectory(bin, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isDirectory()) candidates.push({ command: path.join(bin, entry.name, 'codex.exe'), args: ['app-server'] })
    }
  }
  if (!candidates.length) return { command: fallback.command, args: fallback.args }

  // Probe versions, never a model turn. A stale or broken installation cannot hide a working CLI.
  const results = await Promise.all([fallback, ...candidates].map(async spec => {
    try {
      const version = await getVersion(spec)
      return /^\d+\.\d+\.\d+$/.test(version) ? { spec, version } : null
    } catch { return null }
  }))
  let selected = null
  for (const result of results) {
    if (result && (!selected || compareVersions(result.version, selected.version) >= 0)) selected = result
  }
  const spec = selected?.spec || fallback
  return { command: spec.command, args: spec.args }
}
