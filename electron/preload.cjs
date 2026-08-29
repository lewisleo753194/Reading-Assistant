const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('readingAssistant', {
  selectSkillFolder: () => ipcRenderer.invoke('reading-assistant:select-skill-folder'),
  selectLanguageFolder: () => ipcRenderer.invoke('reading-assistant:select-language-folder'),
  movePanelWindow: (id, x, y) => ipcRenderer.send('reading-assistant:move-panel-window', { id, x, y }),
  preparePanelDrag: () => ipcRenderer.send('reading-assistant:prepare-panel-drag'),
  setPanelDragging: (active) => ipcRenderer.send('reading-assistant:set-panel-dragging', { active }),
  setDockZones: (visible, active, dark) => ipcRenderer.send('reading-assistant:set-dock-zones', { visible, active, dark }),
})
