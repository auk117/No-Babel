const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFitFile: () => ipcRenderer.invoke('select-fit-file'),
  selectVideoFiles: () => ipcRenderer.invoke('select-video-files'),
  getVideoMetadata: (videoPath) => ipcRenderer.invoke('get-video-metadata', videoPath),
  parseGpx: (gpxFilePath) => ipcRenderer.invoke('parse-gpx', gpxFilePath),
  stitchVideos: (videoPaths) => ipcRenderer.invoke('stitch-videos', videoPaths),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Direct FIT parsing
  parseFitDirect: (fitFilePath) => ipcRenderer.invoke('parse-fit-direct', fitFilePath),
  
  onStitchProgress: (callback) => {
    ipcRenderer.on('stitch-progress', (event, progress) => {
      callback(progress);
    });
  },
  
  removeStitchProgressListener: () => {
    ipcRenderer.removeAllListeners('stitch-progress');
  }
});