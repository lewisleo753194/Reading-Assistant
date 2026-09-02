import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createReadStream } from 'node:fs'

export const CACHE_LIMIT_BYTES = 128 * 1024 * 1024

const transientLegacyEntries = new Set([
  'cache',
  'code cache',
  'gpucache',
  'dawncache',
  'dawngraphitecache',
  'dawnwebgpucache',
  'grshadercache',
  'shadercache',
  'crashpad',
])

const samePath = (first, second) => path.resolve(first).toLocaleLowerCase() === path.resolve(second).toLocaleLowerCase()

function packagedStorageBase(executablePath) {
  const executableFolder = path.dirname(executablePath)
  const releaseFolder = path.dirname(executableFolder)
  if (path.basename(executableFolder).toLocaleLowerCase() === 'win-unpacked' && /^release-\d/i.test(path.basename(releaseFolder))) {
    return path.dirname(releaseFolder)
  }
  return executableFolder
}

export function storageRootCandidates({ overrideRoot = '', portableExecutableDir = '', isDevelopmentInstance = false, isPackaged = true, executablePath, appPath, documentsPath, legacyUserData }) {
  const candidates = []
  if (overrideRoot.trim()) candidates.push(path.resolve(overrideRoot.trim()))
  if (isDevelopmentInstance) candidates.push(path.join(appPath, 'RaidData', 'Development'))
  else if (portableExecutableDir.trim()) candidates.push(path.join(path.resolve(portableExecutableDir), 'RaidData'))
  else if (isPackaged) candidates.push(path.join(packagedStorageBase(executablePath), 'RaidData'))
  else candidates.push(path.join(appPath, 'RaidData'))
  candidates.push(path.join(documentsPath, 'RaidData'))
  candidates.push(path.join(path.dirname(legacyUserData), 'RaidData'))
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))]
}

export function selectWritableStorageRoot(candidates) {
  let lastError = null
  for (const candidate of candidates) {
    const probe = path.join(candidate, `.raid-write-test-${process.pid}`)
    try {
      fs.mkdirSync(candidate, { recursive: true })
      fs.writeFileSync(probe, 'ok', { flag: 'wx' })
      fs.rmSync(probe, { force: true })
      return candidate
    } catch (error) {
      lastError = error
      try { fs.rmSync(probe, { force: true }) } catch { /* Try the next location. */ }
    }
  }
  throw lastError || new Error('Raid could not find a writable data directory.')
}

export function createStorageLayout(root) {
  const layout = {
    root,
    dataDir: path.join(root, 'Data'),
    runtimeDir: path.join(root, 'Runtime'),
    cacheDir: path.join(root, 'Cache'),
  }
  for (const directory of [layout.dataDir, layout.runtimeDir, layout.cacheDir]) fs.mkdirSync(directory, { recursive: true })
  return layout
}

export function directorySize(directory) {
  if (!fs.existsSync(directory)) return 0
  let total = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    try {
      if (entry.isDirectory()) total += directorySize(entryPath)
      else if (entry.isFile()) total += fs.statSync(entryPath).size
    } catch {
      // A concurrently released Chromium file can disappear while it is measured.
    }
  }
  return total
}

export function cleanupDirectoryContents(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory)) {
    try { fs.rmSync(path.join(directory, entry), { recursive: true, force: true, maxRetries: 2 }) } catch { /* Retry on the next launch. */ }
  }
}

export function pruneCache(directory, limitBytes = CACHE_LIMIT_BYTES) {
  const previousBytes = directorySize(directory)
  if (previousBytes <= limitBytes) return { cleared: false, previousBytes }
  cleanupDirectoryContents(directory)
  return { cleared: true, previousBytes }
}

export function pruneChromiumCaches(userDataDirectory, dedicatedCacheDirectory, limitBytes = CACHE_LIMIT_BYTES) {
  const cacheDirectories = [
    dedicatedCacheDirectory,
    ...['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache']
      .map((name) => path.join(userDataDirectory, name)),
  ]
  const previousBytes = cacheDirectories.reduce((total, directory) => total + directorySize(directory), 0)
  if (previousBytes <= limitBytes) return { cleared: false, previousBytes }
  for (const directory of cacheDirectories) cleanupDirectoryContents(directory)
  return { cleared: true, previousBytes }
}

function shouldMigrate(relativePath) {
  if (!relativePath) return true
  const segments = relativePath.split(path.sep)
  const first = segments[0].toLocaleLowerCase()
  const name = segments.at(-1) || ''
  return !transientLegacyEntries.has(first) && !/^singleton/i.test(name) && name.toLocaleLowerCase() !== 'lockfile' && name !== 'startup.log'
}

function fileDigest(filePath) {
  const digest = createHash('sha256')
  const descriptor = fs.openSync(filePath, 'r')
  const chunk = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead = 0
    do {
      bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null)
      if (bytesRead > 0) digest.update(chunk.subarray(0, bytesRead))
    } while (bytesRead > 0)
    return digest.digest('hex')
  } finally {
    fs.closeSync(descriptor)
  }
}

function persistentManifest(root) {
  const manifest = []
  if (!fs.existsSync(root)) return manifest
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      const relativePath = path.relative(root, entryPath)
      if (!shouldMigrate(relativePath)) continue
      if (entry.isDirectory()) visit(entryPath)
      else if (entry.isFile()) {
        const stats = fs.statSync(entryPath)
        manifest.push({ path: relativePath, size: stats.size, sha256: fileDigest(entryPath) })
      }
    }
  }
  visit(root)
  return manifest.sort((first, second) => first.path.localeCompare(second.path))
}

async function fileDigestAsync(filePath) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) digest.update(chunk)
  return digest.digest('hex')
}

async function persistentManifestAsync(root) {
  const manifest = []
  if (!fs.existsSync(root)) return manifest
  const visit = async (directory) => {
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      const relativePath = path.relative(root, entryPath)
      if (!shouldMigrate(relativePath)) continue
      if (entry.isDirectory()) await visit(entryPath)
      else if (entry.isFile()) {
        const stats = await fs.promises.stat(entryPath)
        manifest.push({ path: relativePath, size: stats.size, sha256: await fileDigestAsync(entryPath) })
      }
    }
  }
  await visit(root)
  return manifest.sort((first, second) => first.path.localeCompare(second.path))
}

function manifestContains(sourceManifest, targetManifest) {
  const targetFiles = new Map(targetManifest.map((entry) => [entry.path, entry]))
  return sourceManifest.every((source) => {
    const target = targetFiles.get(source.path)
    return target?.size === source.size && target.sha256 === source.sha256
  })
}

export function migrateLegacyUserData({ legacyUserData, dataDir, copySync = fs.cpSync }) {
  const markerPath = path.join(dataDir, '.raid-storage-migration.json')
  if (samePath(legacyUserData, dataDir) || !fs.existsSync(legacyUserData)) return { migrated: false, reason: 'not-needed' }
  if (fs.existsSync(markerPath)) {
    try { fs.rmSync(legacyUserData, { recursive: true, force: true, maxRetries: 2 }) } catch { /* Leave it for the next launch. */ }
    return { migrated: false, reason: 'already-migrated' }
  }
  if (fs.readdirSync(dataDir).length > 0) return { migrated: false, reason: 'target-not-empty' }

  let sourceManifest
  try {
    sourceManifest = persistentManifest(legacyUserData)
    copySync(legacyUserData, dataDir, {
      recursive: true,
      errorOnExist: false,
      filter: (source) => shouldMigrate(path.relative(legacyUserData, source)),
    })
    const targetManifest = persistentManifest(dataDir)
    if (!manifestContains(sourceManifest, targetManifest)) {
      throw new Error('Raid legacy data verification failed; the original data was preserved.')
    }
  } catch (error) {
    cleanupDirectoryContents(dataDir)
    throw error
  }
  fs.writeFileSync(markerPath, JSON.stringify({ migratedAt: new Date().toISOString(), source: legacyUserData, files: sourceManifest.length }, null, 2))
  try { fs.rmSync(legacyUserData, { recursive: true, force: true, maxRetries: 2 }) } catch { /* Verified data is already safe on the target drive. */ }
  return { migrated: true, files: sourceManifest.length }
}

export async function migrateLegacyUserDataAsync({ legacyUserData, dataDir, allowExisting = false }) {
  const markerPath = path.join(dataDir, '.raid-storage-migration.json')
  if (samePath(legacyUserData, dataDir) || !fs.existsSync(legacyUserData)) return { migrated: false, reason: 'not-needed' }
  if (fs.existsSync(markerPath)) {
    const remainingFiles = await persistentManifestAsync(legacyUserData)
    if (remainingFiles.length) return { migrated: false, reason: 'legacy-changed-after-migration', files: remainingFiles.length }
    await fs.promises.rm(legacyUserData, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined)
    return { migrated: false, reason: 'already-migrated' }
  }
  if (!allowExisting && (await fs.promises.readdir(dataDir)).length > 0) return { migrated: false, reason: 'target-not-empty' }

  const stagingDir = `${dataDir}.migration-${process.pid}-${Date.now()}`
  let sourceManifest
  try {
    sourceManifest = await persistentManifestAsync(legacyUserData)
    await fs.promises.mkdir(stagingDir, { recursive: true })
    await fs.promises.cp(legacyUserData, stagingDir, {
      recursive: true,
      errorOnExist: false,
      filter: (source) => shouldMigrate(path.relative(legacyUserData, source)),
    })
    const stagedManifest = await persistentManifestAsync(stagingDir)
    if (!manifestContains(sourceManifest, stagedManifest)) {
      throw new Error('Raid legacy data verification failed; the original data was preserved.')
    }

    const existingFiles = new Map((await persistentManifestAsync(dataDir)).map((entry) => [entry.path, entry]))
    const conflictingFile = sourceManifest.find((source) => {
      const existing = existingFiles.get(source.path)
      return existing && (existing.size !== source.size || existing.sha256 !== source.sha256)
    })
    if (conflictingFile) throw new Error(`Raid legacy data conflicts with the new data at ${conflictingFile.path}; both copies were preserved.`)

    await fs.promises.cp(stagingDir, dataDir, { recursive: true, errorOnExist: false, force: false })
    const targetManifest = await persistentManifestAsync(dataDir)
    if (!manifestContains(sourceManifest, targetManifest)) throw new Error('Raid legacy data verification failed after merge; the original data was preserved.')
  } catch (error) {
    await fs.promises.rm(stagingDir, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined)
    throw error
  }
  await fs.promises.writeFile(markerPath, JSON.stringify({ migratedAt: new Date().toISOString(), source: legacyUserData, files: sourceManifest.length }, null, 2))
  await fs.promises.rm(stagingDir, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined)
  await fs.promises.rm(legacyUserData, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined)
  return { migrated: true, files: sourceManifest.length }
}
