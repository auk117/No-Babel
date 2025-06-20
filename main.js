const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const os = require('os');

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

// Updated video file selection to support multiple files
ipcMain.handle('select-video-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'], // Enable multiple file selection
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths;
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

// New function to stitch multiple videos together
ipcMain.handle('stitch-videos', async (event, videoPaths) => {
  return new Promise((resolve, reject) => {
    if (!videoPaths || videoPaths.length === 0) {
      reject(new Error('No video files provided'));
      return;
    }
    
    if (videoPaths.length === 1) {
      resolve(videoPaths[0]);
      return;
    }
    
    // Create temporary directory for intermediate files
    const tempDir = path.join(os.tmpdir(), 'telemetry-sync-videos');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Create output path
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `stitched_video_${timestamp}.mp4`);
    
    // Create concat list file for FFmpeg
    const concatListPath = path.join(tempDir, `concat_list_${timestamp}.txt`);
    const concatContent = videoPaths.map(videoPath => `file '${videoPath.replace(/\\/g, '/')}'`).join('\n');
    
    try {
      fs.writeFileSync(concatListPath, concatContent, 'utf8');
    } catch (err) {
      reject(new Error(`Failed to create concat list: ${err.message}`));
      return;
    }
    
    // Use FFmpeg to concatenate videos
    const ffmpegCommand = ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset', 'fast',
        '-crf', '23',
        '-movflags', '+faststart'
      ])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        console.log('Stitching progress:', progress.percent ? progress.percent.toFixed(2) + '%' : 'Processing...');
        // Send progress to renderer if needed
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('stitch-progress', progress);
        }
      })
      .on('end', () => {
        console.log('Video stitching completed');
        // Clean up concat list file
        try {
          fs.unlinkSync(concatListPath);
        } catch (err) {
          console.warn('Failed to clean up concat list file:', err.message);
        }
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        // Clean up files on error
        try {
          if (fs.existsSync(concatListPath)) {
            fs.unlinkSync(concatListPath);
          }
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch (cleanupErr) {
          console.warn('Failed to clean up files after error:', cleanupErr.message);
        }
        reject(new Error(`Video stitching failed: ${err.message}`));
      });
    
    // Start the FFmpeg process
    ffmpegCommand.run();
  });
});

// Enhanced video metadata function to handle potential issues with stitched videos
ipcMain.handle('get-video-metadata', async (event, videoPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      const creationTime = metadata.format.tags?.creation_time;
      
      if (!videoStream) {
        reject(new Error('No video stream found in file'));
        return;
      }
      
      // Calculate FPS more safely
      let fps = 30; // default fallback
      if (videoStream.r_frame_rate) {
        try {
          fps = eval(videoStream.r_frame_rate); // Convert fraction to decimal
        } catch (e) {
          console.warn('Failed to parse frame rate, using default 30fps');
        }
      } else if (videoStream.avg_frame_rate) {
        try {
          fps = eval(videoStream.avg_frame_rate);
        } catch (e) {
          console.warn('Failed to parse average frame rate, using default 30fps');
        }
      }
      
      resolve({
        duration: metadata.format.duration,
        fps: fps,
        width: videoStream.width,
        height: videoStream.height,
        creationTime: creationTime,
        bitrate: metadata.format.bit_rate,
        size: metadata.format.size
      });
    });
  });
});

// Parse GPX file (unchanged)
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
            const lat = parseFloat(point["@_lat"]);
            const lon = parseFloat(point["@_lon"]);
            
            // Check if coordinates are valid (not 0,0 and within reasonable bounds)
            const isValidCoordinate = (
              lat !== 0 || lon !== 0
            ) && (
              lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
            );
            
            allPoints.push({
              lat: lat,
              lon: lon,
              ele: point.ele ? parseFloat(point.ele) : null,
              time: point.time,
              speed: point.speed ? parseFloat(point.speed) : null,
              isValid: isValidCoordinate
            });
          }
        });
      });
    });
    
    // Sort by time
    allPoints.sort((a, b) => new Date(a.time) - new Date(b.time));
    
    // Separate valid points for track drawing
    const validPoints = allPoints.filter(point => point.isValid);
    
    return {
      points: allPoints, // All points including invalid ones for timing
      validPoints: validPoints, // Only valid points for track drawing
      totalPoints: allPoints.length,
      validPointsCount: validPoints.length,
      startTime: allPoints.length > 0 ? allPoints[0].time : null,
      endTime: allPoints.length > 0 ? allPoints[allPoints.length - 1].time : null
    };
  } catch (error) {
    throw new Error(`Failed to parse GPX: ${error.message}`);
  }
});

// Clean up temporary files on app quit
app.on('before-quit', () => {
  const tempDir = path.join(os.tmpdir(), 'telemetry-sync-videos');
  if (fs.existsSync(tempDir)) {
    try {
      // Clean up old stitched videos (older than 1 hour)
      const files = fs.readdirSync(tempDir);
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      
      files.forEach(file => {
        const filePath = path.join(tempDir, file);
        const stats = fs.statSync(filePath);
        if (stats.mtime.getTime() < oneHourAgo) {
          fs.unlinkSync(filePath);
        }
      });
    } catch (err) {
      console.warn('Failed to clean up temporary files:', err.message);
    }
  }
});