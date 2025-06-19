const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  selectFitFile: () => ipcRenderer.invoke('select-fit-file'),
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  convertFitToGpx: (fitFilePath) => ipcRenderer.invoke('convert-fit-to-gpx', fitFilePath),
  getVideoMetadata: (videoPath) => ipcRenderer.invoke('get-video-metadata', videoPath),
  parseGpx: (gpxFilePath) => ipcRenderer.invoke('parse-gpx', gpxFilePath)
});