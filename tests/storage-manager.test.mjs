import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { cleanupDirectoryContents, createStorageLayout, migrateLegacyUserData, migrateLegacyUserDataAsync, pruneChromiumCaches, storageRootCandidates } from '../electron/storage-manager.mjs'

test('desktop startup keeps the legacy instance lock and protects persistent web storage', async () => {
  const main = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8')
  const lockIndex = main.indexOf('app.requestSingleInstanceLock()')
  const userDataIndex = main.indexOf("app.setPath('userData', activeUserData)")
  assert.ok(lockIndex >= 0 && lockIndex < userDataIndex)
  assert.match(main, /app\.setPath\('sessionData', activeUserData\)/)
  assert.match(main, /app\.setPath\('temp', storageLayout\.runtimeDir\)/)
})

test('storage roots stay on the portable or stable application drive', () => {
  const common = { overrideRoot: '', isPackaged: true, executablePath: 'D:\\Apps\\Raid\\release-2.3.0\\win-unpacked\\Raid.exe', appPath: 'D:\\Apps\\Raid', documentsPath: 'C:\\Users\\reader\\Documents', legacyUserData: 'C:\\Users\\reader\\AppData\\Roaming\\Raid' }
  assert.equal(storageRootCandidates({ ...common, portableExecutableDir: '', isDevelopmentInstance: false })[0], path.resolve('D:\\Apps\\Raid\\RaidData'))
  assert.equal(storageRootCandidates({ ...common, portableExecutableDir: 'E:\\Portable\\Raid', isDevelopmentInstance: false })[0], path.resolve('E:\\Portable\\Raid\\RaidData'))
  assert.equal(storageRootCandidates({ ...common, portableExecutableDir: 'D:\\Apps\\Raid\\release-2.4.1', isDevelopmentInstance: false })[0], path.resolve('D:\\Apps\\Raid\\RaidData'))
  assert.equal(storageRootCandidates({ ...common, portableExecutableDir: '', isDevelopmentInstance: true })[0], path.resolve('D:\\Apps\\Raid\\RaidData\\Development'))
})

test('legacy data is verified before the old C-drive directory is removed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'raid-storage-test-'))
  try {
    const legacy = path.join(root, 'legacy')
    const layout = createStorageLayout(path.join(root, 'RaidData'))
    await mkdir(path.join(legacy, 'IndexedDB'), { recursive: true })
    await mkdir(path.join(legacy, 'Cache'), { recursive: true })
    await writeFile(path.join(legacy, 'IndexedDB', 'project.bin'), 'important project data')
    await writeFile(path.join(legacy, 'Cache', 'temporary.bin'), 'temporary cache')
    const result = migrateLegacyUserData({ legacyUserData: legacy, dataDir: layout.dataDir })
    assert.equal(result.migrated, true)
    assert.equal(await readFile(path.join(layout.dataDir, 'IndexedDB', 'project.bin'), 'utf8'), 'important project data')
    await assert.rejects(stat(legacy))
    await assert.rejects(stat(path.join(layout.dataDir, 'Cache')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runtime cleanup and cache cap only remove disposable partitions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'raid-cache-test-'))
  try {
    const layout = createStorageLayout(root)
    await writeFile(path.join(layout.runtimeDir, 'leftover.tmp'), 'temporary')
    await mkdir(path.join(layout.dataDir, 'GPUCache'), { recursive: true })
    await writeFile(path.join(layout.dataDir, 'GPUCache', 'cache.bin'), Buffer.alloc(65))
    await writeFile(path.join(layout.cacheDir, 'code-cache.bin'), Buffer.alloc(64))
    cleanupDirectoryContents(layout.runtimeDir)
    const result = pruneChromiumCaches(layout.dataDir, layout.cacheDir, 128)
    assert.equal(result.cleared, true)
    await assert.rejects(stat(path.join(layout.runtimeDir, 'leftover.tmp')))
    await assert.rejects(stat(path.join(layout.cacheDir, 'code-cache.bin')))
    await assert.rejects(stat(path.join(layout.dataDir, 'GPUCache', 'cache.bin')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed legacy migration removes the unverified partial copy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'raid-migration-failure-test-'))
  try {
    const legacy = path.join(root, 'legacy')
    const layout = createStorageLayout(path.join(root, 'RaidData'))
    await mkdir(legacy, { recursive: true })
    await writeFile(path.join(legacy, 'project.bin'), 'original')
    assert.throws(() => migrateLegacyUserData({
      legacyUserData: legacy,
      dataDir: layout.dataDir,
      copySync: (_source, target) => {
        fs.writeFileSync(path.join(target, 'partial.bin'), 'partial')
        throw new Error('simulated locked file')
      },
    }), /simulated locked file/)
    assert.deepEqual(await readdir(layout.dataDir), [])
    assert.equal(await readFile(path.join(legacy, 'project.bin'), 'utf8'), 'original')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('asynchronous migration keeps large-file hashing off the startup thread', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'raid-async-migration-test-'))
  try {
    const legacy = path.join(root, 'legacy')
    const layout = createStorageLayout(path.join(root, 'RaidData'))
    await mkdir(path.join(legacy, 'IndexedDB'), { recursive: true })
    await writeFile(path.join(legacy, 'IndexedDB', 'large-project.bin'), Buffer.alloc(2 * 1024 * 1024, 7))
    await writeFile(path.join(layout.dataDir, 'electron-bootstrap.tmp'), 'new runtime metadata')
    const result = await migrateLegacyUserDataAsync({ legacyUserData: legacy, dataDir: layout.dataDir, allowExisting: true })
    assert.equal(result.migrated, true)
    assert.equal((await stat(path.join(layout.dataDir, 'IndexedDB', 'large-project.bin'))).size, 2 * 1024 * 1024)
    assert.equal(await readFile(path.join(layout.dataDir, 'electron-bootstrap.tmp'), 'utf8'), 'new runtime metadata')
    await assert.rejects(stat(legacy))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('asynchronous migration preserves both sides when existing data conflicts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'raid-migration-conflict-test-'))
  try {
    const legacy = path.join(root, 'legacy')
    const layout = createStorageLayout(path.join(root, 'RaidData'))
    await mkdir(path.join(legacy, 'IndexedDB'), { recursive: true })
    await mkdir(path.join(layout.dataDir, 'IndexedDB'), { recursive: true })
    await writeFile(path.join(legacy, 'IndexedDB', 'project.bin'), 'legacy copy')
    await writeFile(path.join(layout.dataDir, 'IndexedDB', 'project.bin'), 'new copy')
    await assert.rejects(
      migrateLegacyUserDataAsync({ legacyUserData: legacy, dataDir: layout.dataDir, allowExisting: true }),
      /conflicts with the new data/,
    )
    assert.equal(await readFile(path.join(legacy, 'IndexedDB', 'project.bin'), 'utf8'), 'legacy copy')
    assert.equal(await readFile(path.join(layout.dataDir, 'IndexedDB', 'project.bin'), 'utf8'), 'new copy')
    assert.deepEqual((await readdir(root)).filter((name) => name.includes('.migration-')), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
