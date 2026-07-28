const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dubstation', {
  pickAudio: () => ipcRenderer.invoke('audio:pick'),
  inspectAudioPaths: filePaths => ipcRenderer.invoke('audio:inspect', filePaths),
  readAudio: filePath => ipcRenderer.invoke('audio:read', filePath),
  revealFile: filePath => ipcRenderer.invoke('audio:reveal', filePath),
  saveRecording: (bytes, mimeType) => ipcRenderer.invoke('recording:save', { bytes, mimeType }),
  setRecordingState: active => ipcRenderer.send('recording:state', Boolean(active)),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  }
});
