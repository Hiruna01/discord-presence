const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('frame', {
  getState: () => ipcRenderer.invoke('frame:get-state'),
  saveSettings: settings => ipcRenderer.invoke('frame:save-settings', settings),
  pairCode: () => ipcRenderer.invoke('frame:pair-code'),
  copy: text => ipcRenderer.invoke('frame:copy', text),
  openPortal: () => ipcRenderer.invoke('frame:open-portal'),
  openYouTube: () => ipcRenderer.invoke('frame:open-youtube'),
  openVideo: () => ipcRenderer.invoke('frame:open-video'),
  extensionFolder: () => ipcRenderer.invoke('frame:extension-folder'),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('frame:state', listener);
    return () => ipcRenderer.removeListener('frame:state', listener);
  },
});
