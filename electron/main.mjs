import { app, BrowserWindow, dialog, ipcMain, nativeImage, session, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/index.mjs'
import { cleanupDirectoryContents, createStorageLayout, migrateLegacyUserDataAsync, pruneChromiumCaches, selectWritableStorageRoot, storageRootCandidates } from './storage-manager.mjs'

let localServer = null
let mainWindow = null
const dockZoneWindows = new Map()
const modalHiddenPanelWindows = new Set()
const panelDragBounds = new WeakMap()
const panelPreparedBounds = new WeakMap()
const dirname = path.dirname(fileURLToPath(import.meta.url))
const sourceAppIconPath = path.join(dirname, process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png')
const packagedAppIconPath = path.join(process.resourcesPath, process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png')
const appIconPath = app.isPackaged ? packagedAppIconPath : sourceAppIconPath
const appIconImage = nativeImage.createFromPath(appIconPath)
const dockZoneWidth = 32
const textFileExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv', '.tsv', '.tex'])
const isDevelopmentInstance = process.argv.includes('--development-instance')
const defaultUserData = app.getPath('userData')
const legacyUserData = isDevelopmentInstance ? `${defaultUserData}-development` : defaultUserData
if (isDevelopmentInstance) app.setPath('userData', legacyUserData)
// Keep the single-instance identity on the pre-2.3 path. Besides preventing an
// old and a new Raid process from migrating the same profile concurrently,
// this avoids creating a second lock namespace merely because storage moved.
const hasSingleInstanceLock = app.requestSingleInstanceLock()
const storageRoot = selectWritableStorageRoot(storageRootCandidates({
  overrideRoot: process.env.RAID_DATA_ROOT || '',
  portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR || '',
  isDevelopmentInstance,
  isPackaged: app.isPackaged,
  executablePath: process.execPath,
  appPath: app.getAppPath(),
  documentsPath: app.getPath('documents'),
  legacyUserData,
}))
const storageLayout = createStorageLayout(storageRoot)
const storageBootstrapLog = path.join(storageLayout.root, 'storage-bootstrap.log')
const logStorageBootstrap = (message) => {
  try { fs.appendFileSync(storageBootstrapLog, `${new Date().toISOString()} ${message}\n`) } catch { /* Startup must continue when diagnostics cannot be written. */ }
}
logStorageBootstrap(`Legacy user data: ${legacyUserData}`)
cleanupDirectoryContents(storageLayout.runtimeDir)
let migrationResult = { migrated: false, reason: 'not-attempted' }
const activeUserData = storageLayout.dataDir
app.setPath('userData', activeUserData)
// Chromium stores persistent web data (including IndexedDB/localStorage) under
// sessionData as well as disposable caches, so it must stay with Data. Only
// explicitly disposable cache folders are pruned below.
app.setPath('sessionData', activeUserData)
app.setPath('temp', storageLayout.runtimeDir)
app.setAppLogsPath(path.join(activeUserData, 'Logs'))
logStorageBootstrap(`Active user data: ${activeUserData}`)
try {
  if (process.platform === 'win32') app.setAppUserModelId('cn.lxymol.readingassistant')
  logStorageBootstrap('Application ID configured')
} catch (error) {
  logStorageBootstrap(`Application ID fallback: ${error instanceof Error ? error.message : String(error)}`)
}
const internalPort = isDevelopmentInstance ? 18788 : 18787
logStorageBootstrap(`Single instance lock: ${hasSingleInstanceLock}`)

function logStartup(message) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'startup.log'), `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Logging must never prevent the reader from opening.
  }
}

function readTextFiles(folderPath, options = {}) {
  const { requiredName = '', maxFiles = 48, maxBytes = 1024 * 1024 } = options
  const files = []
  let totalBytes = 0
  const visit = (currentPath) => {
    if (files.length >= maxFiles || totalBytes >= maxBytes) return
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const absolutePath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        visit(absolutePath)
        continue
      }
      if (!entry.isFile() || (!textFileExtensions.has(path.extname(entry.name).toLowerCase()) && entry.name !== requiredName)) continue
      const size = fs.statSync(absolutePath).size
      if (size > 256 * 1024 || totalBytes + size > maxBytes) continue
      files.push({ path: path.relative(folderPath, absolutePath).replaceAll('\\', '/'), content: fs.readFileSync(absolutePath, 'utf8') })
      totalBytes += size
      if (files.length >= maxFiles || totalBytes >= maxBytes) return
    }
  }
  visit(folderPath)
  return files
}

async function selectImportFolder(kind) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: kind === 'skill' ? '选择 Skill 文件夹' : '选择语言包文件夹',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  const folderPath = path.resolve(result.filePaths[0])
  try {
    const files = readTextFiles(folderPath, { requiredName: kind === 'skill' ? 'SKILL.md' : 'language.json' })
    if (kind === 'skill' && !files.some((file) => file.path.toLowerCase() === 'skill.md')) {
      return { error: '所选文件夹根目录中没有 SKILL.md。' }
    }
    const languageFiles = files.filter((file) => file.path.toLowerCase() === 'language.json' || file.path.toLowerCase().endsWith('.json'))
    if (kind === 'language' && !languageFiles.length) return { error: '所选文件夹中没有 language.json 或其他 JSON 语言包。' }
    return { folderPath, files: kind === 'language' ? languageFiles : files }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '无法读取所选文件夹。' }
  }
}

ipcMain.handle('reading-assistant:select-skill-folder', () => selectImportFolder('skill'))
ipcMain.handle('reading-assistant:select-language-folder', () => selectImportFolder('language'))
const getPanelWindow = (sender) => {
  const panelWindow = BrowserWindow.fromWebContents(sender)
  return mainWindow && panelWindow && !panelWindow.isDestroyed() && panelWindow.getParentWindow() === mainWindow ? panelWindow : null
}

function getDockZoneWindow(side) {
  const existing = dockZoneWindows.get(side)
  if (existing && !existing.isDestroyed()) return existing
  const zoneWindow = new BrowserWindow({
    width: dockZoneWidth,
    height: 300,
    show: false,
    frame: false,
    transparent: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  zoneWindow.setIgnoreMouseEvents(true)
  zoneWindow.setAlwaysOnTop(true, 'screen-saver')
  zoneWindow.raidActive = false
  zoneWindow.raidDark = false
  zoneWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;contain:strict;clip-path:inset(0)}body::before{content:"";position:absolute;inset:6% 0;opacity:.5;filter:blur(9px);background:radial-gradient(ellipse at left center,rgba(55,148,255,.92),rgba(55,148,255,.34) 42%,transparent 74%);transition:opacity .1s}body.right::before{transform:scaleX(-1)}body.dark::before{background:radial-gradient(ellipse at left center,rgba(246,195,55,.9),rgba(246,195,55,.34) 42%,transparent 74%)}body.active::before{opacity:.95;filter:blur(7px)}</style><body class="${side}"></body>`)}`)
  zoneWindow.webContents.on('did-finish-load', () => {
    void zoneWindow.webContents.executeJavaScript(`document.body.classList.toggle('active', ${zoneWindow.raidActive});document.body.classList.toggle('dark', ${zoneWindow.raidDark})`).catch(() => undefined)
  })
  zoneWindow.on('closed', () => dockZoneWindows.delete(side))
  dockZoneWindows.set(side, zoneWindow)
  return zoneWindow
}

function setDockZones(visible, active = null, dark = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!visible) {
    for (const zoneWindow of dockZoneWindows.values()) if (!zoneWindow.isDestroyed()) zoneWindow.hide()
    return
  }
  for (const side of ['left', 'right']) {
    const zoneWindow = getDockZoneWindow(side)
    const bounds = mainWindow.getBounds()
    zoneWindow.setBounds({ x: side === 'left' ? bounds.x : bounds.x + bounds.width - dockZoneWidth, y: bounds.y, width: dockZoneWidth, height: bounds.height }, false)
    zoneWindow.raidActive = active === side
    zoneWindow.raidDark = dark
    void zoneWindow.webContents.executeJavaScript(`document.body.classList.toggle('active', ${zoneWindow.raidActive});document.body.classList.toggle('dark', ${zoneWindow.raidDark})`).catch(() => undefined)
    zoneWindow.showInactive()
  }
}

function setPanelPositionPreservingSize(panelWindow, x, y, lockedBounds) {
  let width = lockedBounds.width
  let height = lockedBounds.height
  for (let attempt = 0; attempt < 3; attempt += 1) {
    panelWindow.setBounds({ x, y, width, height }, false)
    const actual = panelWindow.getBounds()
    const widthError = lockedBounds.width - actual.width
    const heightError = lockedBounds.height - actual.height
    if (widthError === 0 && heightError === 0) break
    width += widthError
    height += heightError
  }
}

ipcMain.on('reading-assistant:move-panel-window', (event, payload) => {
  const x = Math.round(Number(payload?.x))
  const y = Math.round(Number(payload?.y))
  const panelWindow = getPanelWindow(event.sender)
  if (!panelWindow) return
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  const lockedBounds = panelDragBounds.get(panelWindow)
  if (lockedBounds) setPanelPositionPreservingSize(panelWindow, x, y, lockedBounds)
  else panelWindow.setPosition(x, y, false)
})
ipcMain.on('reading-assistant:prepare-panel-drag', (event) => {
  const panelWindow = getPanelWindow(event.sender)
  if (!panelWindow || panelDragBounds.has(panelWindow)) return
  const { width, height } = panelWindow.getBounds()
  panelPreparedBounds.set(panelWindow, { width, height })
})
ipcMain.on('reading-assistant:set-panel-dragging', (event, payload) => {
  const panelWindow = getPanelWindow(event.sender)
  if (!panelWindow) return
  if (payload?.active) {
    const currentBounds = panelWindow.getBounds()
    const lockedBounds = panelPreparedBounds.get(panelWindow) ?? { width: currentBounds.width, height: currentBounds.height }
    panelDragBounds.set(panelWindow, lockedBounds)
    setPanelPositionPreservingSize(panelWindow, currentBounds.x, currentBounds.y, lockedBounds)
    return
  }
  const lockedBounds = panelDragBounds.get(panelWindow)
  if (lockedBounds) {
    const { x, y } = panelWindow.getBounds()
    setPanelPositionPreservingSize(panelWindow, x, y, lockedBounds)
  }
  panelDragBounds.delete(panelWindow)
  if (lockedBounds) panelPreparedBounds.set(panelWindow, lockedBounds)
})
ipcMain.on('reading-assistant:set-dock-zones', (event, payload) => {
  if (!getPanelWindow(event.sender)) return
  const active = payload?.active === 'left' || payload?.active === 'right' ? payload.active : null
  setDockZones(Boolean(payload?.visible), active, Boolean(payload?.dark))
})

ipcMain.on('reading-assistant:set-modal-overlay-active', (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return
  if (payload?.active) {
    for (const panelWindow of mainWindow.getChildWindows()) {
      if (panelWindow.isDestroyed() || !panelWindow.isVisible()) continue
      modalHiddenPanelWindows.add(panelWindow)
      panelWindow.hide()
    }
    mainWindow.show()
    mainWindow.focus()
    return
  }
  for (const panelWindow of modalHiddenPanelWindows) {
    if (!panelWindow.isDestroyed()) panelWindow.showInactive()
  }
  modalHiddenPanelWindows.clear()
})

async function createWindow() {
  logStartup('Starting local service')
  const started = await startServer(internalPort, { runtimeDirectory: storageLayout.runtimeDir })
  localServer = started.server
  logStartup(`Local service ready on ${started.port}`)

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 640,
    show: true,
    title: isDevelopmentInstance ? 'Raid · Test' : 'Raid',
    backgroundColor: '#171a20',
    autoHideMenuBar: true,
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(dirname, 'preload.cjs'),
    },
  })

  if (!appIconImage.isEmpty()) mainWindow.setIcon(appIconImage)
  else logStartup(`Application icon unavailable: ${appIconPath}`)
  mainWindow.setMenuBarVisibility(false)
  mainWindow.on('closed', () => {
    for (const zoneWindow of dockZoneWindows.values()) if (!zoneWindow.isDestroyed()) zoneWindow.destroy()
    dockZoneWindows.clear()
    modalHiddenPanelWindows.clear()
    mainWindow = null
  })
  logStartup('Browser window created')
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && frameName.startsWith('reading-assistant-panel-')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow,
          modal: false,
          frame: false,
          autoHideMenuBar: true,
          minWidth: 260,
          minHeight: 220,
          backgroundColor: '#252526',
          icon: appIconPath,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(dirname, 'preload.cjs') },
        },
      }
    }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const localOrigin = `http://127.0.0.1:${started.port}`
    if (!url.startsWith(localOrigin)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  await mainWindow.loadURL(`http://127.0.0.1:${started.port}`)
  const importBridgeReady = await mainWindow.webContents.executeJavaScript("Boolean(window.readingAssistant?.selectSkillFolder && window.readingAssistant?.selectLanguageFolder && window.readingAssistant?.movePanelWindow)")
  logStartup(`Folder import bridge ready: ${importBridgeReady}`)
  console.log(`Raid folder import bridge: ${importBridgeReady ? 'ready' : 'unavailable'}`)
  logStartup('Reader interface loaded')
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.whenReady().then(async () => {
    logStorageBootstrap('Electron ready')
    try {
      migrationResult = await migrateLegacyUserDataAsync({ legacyUserData, dataDir: storageLayout.dataDir, allowExisting: true })
      logStorageBootstrap(`Migration result: ${JSON.stringify(migrationResult)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logStorageBootstrap(`Migration failed: ${message}`)
      dialog.showErrorBox('Raid 数据迁移失败', `旧数据仍安全保存在：\n${legacyUserData}\n\n${message}\n\n请关闭其他 Raid 实例后重试。`)
      throw error
    }
    const cachePruneResult = pruneChromiumCaches(activeUserData, storageLayout.cacheDir)
    session.defaultSession.setCodeCachePath(path.join(storageLayout.cacheDir, 'Code'))
    logStartup('Electron ready')
    logStartup(`Storage root: ${storageLayout.root}`)
    logStartup(`Legacy migration: ${JSON.stringify(migrationResult)}`)
    if (cachePruneResult.cleared) logStartup(`Cache pruned after exceeding 128 MB: ${cachePruneResult.previousBytes} bytes`)
    return createWindow()
  }).catch((error) => {
    logStartup(`Startup failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
    console.error(error)
    app.quit()
  })
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  setDockZones(false)
  localServer?.close()
  localServer = null
})

app.on('will-quit', () => {
  cleanupDirectoryContents(storageLayout.runtimeDir)
})
