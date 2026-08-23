import { app, BrowserWindow, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { startServer } from '../server/index.mjs'

let localServer = null
let mainWindow = null
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
