import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/index.mjs'

let localServer = null
let mainWindow = null
const dirname = path.dirname(fileURLToPath(import.meta.url))
const textFileExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv', '.tsv', '.tex'])
const isDevelopmentInstance = process.argv.includes('--development-instance')
if (isDevelopmentInstance) app.setPath('userData', `${app.getPath('userData')}-development`)
const internalPort = isDevelopmentInstance ? 18788 : 18787
const hasSingleInstanceLock = app.requestSingleInstanceLock()

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

async function createWindow() {
  logStartup('Starting local service')
  const started = await startServer(internalPort)
  localServer = started.server
  logStartup(`Local service ready on ${started.port}`)

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 640,
    show: true,
    title: isDevelopmentInstance ? 'Reading Assistant · Test' : 'Reading Assistant',
    backgroundColor: '#171a20',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(dirname, 'preload.mjs'),
    },
  })

  mainWindow.setMenuBarVisibility(false)
  logStartup('Browser window created')
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
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
  app.whenReady().then(() => {
    logStartup('Electron ready')
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
  localServer?.close()
  localServer = null
})
