const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');

// Get paths for bundled tools
const isDev = process.env.NODE_ENV === 'development';
const resourcesPath = isDev ? __dirname : process.resourcesPath;

// Set paths for bundled FFmpeg and GPSBabel
const ffmpegPath = path.join(resourcesPath, 'tools', 'ffmpeg', 'ffmpeg.exe');
const ffprobePath = path.join(resourcesPath, 'tools', 'ffmpeg', 'ffprobe.exe');
const gpsbabelPath = path.join(resourcesPath, 'tools', 'gpsbabel', 'gpsbabel.exe');

// Configure FFmpeg to use bundled binaries
if (fs.existsSync(ffmpegPath)) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}
if (fs.existsSync(ffprobePath)) {
  ffmpeg.setFfprobePath(ffprobePath);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'), // Optional icon
    title: 'Telemetry Sync'
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// File selection handlers
ipcMain.handle('select-fit-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'FIT Files', extensions: ['fit'] },
      { name: 'GPX Files', extensions: ['gpx'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Convert FIT to GPX using bundled GPSBabel
ipcMain.handle('convert-fit-to-gpx', async (event, fitFilePath) => {
  return new Promise((resolve, reject) => {
    const gpxFilePath = fitFilePath.replace(/\.fit$/i, '.gpx');
    
    // Check if already converted
    if (fs.existsSync(gpxFilePath)) {
      resolve(gpxFilePath);
      return;
    }
    
    // Use bundled GPSBabel if available, otherwise try system GPSBabel
    const gpsbabelExecutable = fs.existsSync(gpsbabelPath) ? gpsbabelPath : 'gpsbabel';
    
    const gpsbabel = spawn(gpsbabelExecutable, [
      '-i', 'garmin_fit,allpoints=1',
      '-f', fitFilePath,
      '-o', 'gpx',
      '-F', gpxFilePath
    ]);
    
    let stderr = '';
    
    gpsbabel.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    gpsbabel.on('close', (code) => {
      if (code === 0) {
        resolve(gpxFilePath);
      } else {
        reject(new Error(`GPSBabel failed: ${stderr}`));
      }
    });
    
    gpsbabel.on('error', (err) => {
      reject(new Error(`Failed to run GPSBabel: ${err.message}`));
    });
  });
});

// Get video metadata
ipcMain.handle('get-video-metadata', async (event, videoPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      const creationTime = metadata.format.tags?.creation_time;
      
      resolve({
        duration: metadata.format.duration,
        fps: eval(videoStream.r_frame_rate), // Convert fraction to decimal
        width: videoStream.width,
        height: videoStream.height,
        creationTime: creationTime
      });
    });
  });
});

// Parse GPX file
ipcMain.handle('parse-gpx', async (event, gpxFilePath) => {
  try {
    const xmlData = fs.readFileSync(gpxFilePath, 'utf8');
    
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_"
    });
    
    const result = parser.parse(xmlData);
    const gpx = result.gpx;
    
    if (!gpx.trk || !gpx.trk.trkseg) {
      throw new Error('No track segments found in GPX file');
    }
    
    // Handle both single and multiple track segments
    const segments = Array.isArray(gpx.trk) ? gpx.trk : [gpx.trk];
    const allPoints = [];
    
    segments.forEach(track => {
      const trackSegments = Array.isArray(track.trkseg) ? track.trkseg : [track.trkseg];
      
      trackSegments.forEach(segment => {
        if (!segment.trkpt) return;
        
        const points = Array.isArray(segment.trkpt) ? segment.trkpt : [segment.trkpt];
        
        points.forEach(point => {
          if (point["@_lat"] && point["@_lon"] && point.time) {
            allPoints.push({
              lat: parseFloat(point["@_lat"]),
              lon: parseFloat(point["@_lon"]),
              ele: point.ele ? parseFloat(point.ele) : null,
              time: point.time,
              speed: point.speed ? parseFloat(point.speed) : null
            });
          }
        });
      });
    });
    
    // Sort by time
    allPoints.sort((a, b) => new Date(a.time) - new Date(b.time));
    
    return {
      points: allPoints,
      totalPoints: allPoints.length,
      startTime: allPoints.length > 0 ? allPoints[0].time : null,
      endTime: allPoints.length > 0 ? allPoints[allPoints.length - 1].time : null
    };
  } catch (error) {
    throw new Error(`Failed to parse GPX: ${error.message}`);
  }
});