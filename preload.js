const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  selectFitFile: () => ipcRenderer.invoke('select-fit-file'),
  selectVideoFiles: () => ipcRenderer.invoke('select-video-files'), // Updated to support multiple files
  convertFitToGpx: (fitFilePath) => ipcRenderer.invoke('convert-fit-to-gpx', fitFilePath),
  getVideoMetadata: (videoPath) => ipcRenderer.invoke('get-video-metadata', videoPath),
  parseGpx: (gpxFilePath) => ipcRenderer.invoke('parse-gpx', gpxFilePath),
  stitchVideos: (videoPaths) => ipcRenderer.invoke('stitch-videos', videoPaths), // New method for stitching
  
  // Add listener for stitching progress (optional)
  onStitchProgress: (callback) => {
    ipcRenderer.on('stitch-progress', (event, progress) => {
      callback(progress);
    });
  },
  
  // Remove listener
  removeStitchProgressListener: () => {
    ipcRenderer.removeAllListeners('stitch-progress');
  }
});