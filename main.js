const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const os = require('os');
const FitParser = require('fit-file-parser').default;

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
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'Telemetry Sync'
  });

  mainWindow.loadFile('index.html');

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
    properties: ['openFile', 'multiSelections'],
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

// NEW: Direct FIT file parsing function
async function parseFitFileDirect(fitFilePath) {
  return new Promise((resolve, reject) => {
    try {
      console.log('Parsing FIT file directly:', fitFilePath);
      
      // Read the FIT file
      const fitFileData = fs.readFileSync(fitFilePath);
      
      // Parse the FIT file
      const fitParser = new FitParser({
        force: true,
        speedUnit: 'ms', // meters per second
        lengthUnit: 'm',  // meters
        temperatureUnit: 'celsius',
        elapsedRecordField: true,
        mode: 'list'
      });
      
      fitParser.parse(fitFileData, (error, data) => {
        if (error) {
          console.error('Error parsing FIT file:', error);
          reject(new Error(`Failed to parse FIT file: ${error.message}`));
          return;
        }
        
        console.log('FIT file parsed successfully');
        
        // Extract record messages (GPS track points)
        const records = data.records || [];
        console.log(`Found ${records.length} record messages`);
        
        if (records.length === 0) {
          reject(new Error('No GPS track points found in FIT file'));
          return;
        }
        
        // Convert FIT records to GPX-like format
        const allPoints = [];
        
        records.forEach((record, index) => {
          // Always process records that have a timestamp, even if GPS is invalid
          if (record.timestamp) {
            let lat = null;
            let lon = null;
            let isValidCoordinate = false;
            
            // Check if we have position data
            if (record.position_lat !== undefined && record.position_long !== undefined) {
              // The fit-file-parser library already converts coordinates to degrees
              // No need for semicircle conversion!
              lat = record.position_lat;
              lon = record.position_long;
              
              // Debug logging for first few points
              if (index < 5) {
                console.log(`Point ${index}: Lat=${lat}, Lon=${lon}`);
              }
              
              // Check if coordinates are valid (not 0,0 and within valid ranges)
              isValidCoordinate = (
                Math.abs(lat) > 0.0001 || Math.abs(lon) > 0.0001  // Not essentially zero
              ) && (
                lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
              );
              
              // If coordinates are invalid, set them to null but keep the point
              if (!isValidCoordinate) {
                lat = null;
                lon = null;
              }
            }
            
            // Convert FIT timestamp to ISO string
            let timestamp;
            if (record.timestamp instanceof Date) {
              timestamp = record.timestamp.toISOString();
            } else {
              // Handle timestamp as epoch seconds
              timestamp = new Date(record.timestamp * 1000).toISOString();
            }
            
            // Always add the point, even if GPS coordinates are invalid
            // This preserves the timeline for video sync
            allPoints.push({
              lat: lat,
              lon: lon,
              ele: record.enhanced_altitude || record.altitude || null,
              time: timestamp,
              speed: record.enhanced_speed || record.speed || null,
              isValid: isValidCoordinate
            });
          }
        });
        
        if (allPoints.length === 0) {
          reject(new Error('No time points found in FIT file'));
          return;
        }
        
        // Sort by time
        allPoints.sort((a, b) => new Date(a.time) - new Date(b.time));
        
        const validPoints = allPoints.filter(point => point.isValid);
        
        console.log(`Processed ${allPoints.length} total points, ${validPoints.length} valid points`);
        
        // Debug: Show first few valid points
        const firstValidPoints = validPoints.slice(0, 3);
        console.log('First few valid points:', firstValidPoints);
        
        const result = {
          points: allPoints,
          validPoints: validPoints,
          totalPoints: allPoints.length,
          validPointsCount: validPoints.length,
          startTime: allPoints.length > 0 ? allPoints[0].time : null,
          endTime: allPoints.length > 0 ? allPoints[allPoints.length - 1].time : null
        };
        
        resolve(result);
      });
      
    } catch (error) {
      console.error('Error parsing FIT file directly:', error);
      reject(new Error(`Failed to parse FIT file: ${error.message}`));
    }
  });
}

// NEW: Test function to compare FIT parsing methods
ipcMain.handle('test-fit-parsing', async (event, fitFilePath) => {
  try {
    console.log('\n=== TESTING FIT PARSING METHODS ===');
    
    // Method 1: GPSBabel (existing)
    console.log('1. Testing GPSBabel method...');
    let gpsbabelResult = null;
    try {
      const gpxFilePath = await convertFitToGpxInternal(fitFilePath);
      gpsbabelResult = await parseGpxInternal(gpxFilePath);
      console.log(`GPSBabel result: ${gpsbabelResult.totalPoints} total, ${gpsbabelResult.validPointsCount} valid`);
    } catch (error) {
      console.log('GPSBabel method failed:', error.message);
    }
    
    // Method 2: Direct FIT parsing (new)
    console.log('2. Testing direct FIT parsing...');
    let directResult = null;
    try {
      directResult = await parseFitFileDirect(fitFilePath);
      console.log(`Direct FIT result: ${directResult.totalPoints} total, ${directResult.validPointsCount} valid`);
    } catch (error) {
      console.log('Direct FIT method failed:', error.message);
    }
    
    // Compare results
    let comparison = {
      gpsbabelSuccess: gpsbabelResult !== null,
      directSuccess: directResult !== null,
      gpsbabelPoints: gpsbabelResult ? gpsbabelResult.totalPoints : 0,
      directPoints: directResult ? directResult.totalPoints : 0,
      gpsbabelValid: gpsbabelResult ? gpsbabelResult.validPointsCount : 0,
      directValid: directResult ? directResult.validPointsCount : 0
    };
    
    if (gpsbabelResult && directResult) {
      const pointDiff = Math.abs(gpsbabelResult.totalPoints - directResult.totalPoints);
      const validDiff = Math.abs(gpsbabelResult.validPointsCount - directResult.validPointsCount);
      
      comparison.pointsDifference = pointDiff;
      comparison.validPointsDifference = validDiff;
      comparison.closeMatch = pointDiff <= 5 && validDiff <= 5; // Allow small differences
      
      console.log(`Point count difference: ${pointDiff}`);
      console.log(`Valid point difference: ${validDiff}`);
      console.log(`Close match: ${comparison.closeMatch}`);
    }
    
    console.log('=== TEST COMPLETE ===\n');
    
    return comparison;
    
  } catch (error) {
    throw new Error(`Test failed: ${error.message}`);
  }
});

// Convert FIT to GPX using bundled GPSBabel (existing function, now internal)
async function convertFitToGpxInternal(fitFilePath) {
  return new Promise((resolve, reject) => {
    const gpxFilePath = fitFilePath.replace(/\.fit$/i, '.gpx');
    
    if (fs.existsSync(gpxFilePath)) {
      resolve(gpxFilePath);
      return;
    }
    
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
}

// NEW: Parse FIT file directly (primary method)
ipcMain.handle('parse-fit-direct', async (event, fitFilePath) => {
  return parseFitFileDirect(fitFilePath);
});

// Convert FIT to GPX using bundled GPSBabel (fallback method)
ipcMain.handle('convert-fit-to-gpx', async (event, fitFilePath) => {
  return convertFitToGpxInternal(fitFilePath);
});

// Check if videos can be concatenated without re-encoding
async function checkVideoCompatibility(videoPaths) {
  return new Promise((resolve, reject) => {
    let videoSpecs = [];
    let processed = 0;
    let hasError = false;
    
    videoPaths.forEach((videoPath, index) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err || hasError) {
          if (!hasError) {
            hasError = true;
            reject(new Error(`Cannot analyze video file: ${videoPath}`));
          }
          return;
        }
        
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        if (!videoStream) {
          if (!hasError) {
            hasError = true;
            reject(new Error(`No video stream found in: ${videoPath}`));
          }
          return;
        }
        
        videoSpecs[index] = {
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height,
          fps: videoStream.r_frame_rate,
          pixelFormat: videoStream.pix_fmt,
          profile: videoStream.profile
        };
        
        processed++;
        if (processed === videoPaths.length && !hasError) {
          const firstSpec = videoSpecs[0];
          const allCompatible = videoSpecs.every(spec => 
            spec.codec === firstSpec.codec &&
            spec.width === firstSpec.width &&
            spec.height === firstSpec.height &&
            spec.fps === firstSpec.fps &&
            spec.pixelFormat === firstSpec.pixelFormat &&
            spec.profile === firstSpec.profile
          );
          
          if (!allCompatible) {
            const incompatibilities = [];
            videoSpecs.forEach((spec, i) => {
              if (spec.codec !== firstSpec.codec) incompatibilities.push(`Video ${i+1}: different codec (${spec.codec} vs ${firstSpec.codec})`);
              if (spec.width !== firstSpec.width || spec.height !== firstSpec.height) {
                incompatibilities.push(`Video ${i+1}: different resolution (${spec.width}x${spec.height} vs ${firstSpec.width}x${firstSpec.height})`);
              }
              if (spec.fps !== firstSpec.fps) incompatibilities.push(`Video ${i+1}: different frame rate (${spec.fps} vs ${firstSpec.fps})`);
            });
            
            reject(new Error(`Videos are not compatible for fast stitching:\n${incompatibilities.join('\n')}\n\nPlease ensure all videos have identical format, resolution, frame rate, and codec.`));
            return;
          }
          
          resolve(true);
        }
      });
    });
  });
}

// Fast concatenation without re-encoding
async function performFastConcat(videoPaths) {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(os.tmpdir(), 'telemetry-sync-videos');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `stitched_video_${timestamp}.mp4`);
    const concatListPath = path.join(tempDir, `concat_list_${timestamp}.txt`);
    
    const concatContent = videoPaths.map(videoPath => {
      const escapedPath = videoPath.replace(/\\/g, '/').replace(/'/g, "\\'");
      return `file '${escapedPath}'`;
    }).join('\n');
    
    try {
      fs.writeFileSync(concatListPath, concatContent, 'utf8');
    } catch (err) {
      reject(new Error(`Failed to create concat list: ${err.message}`));
      return;
    }
    
    const startTime = Date.now();
    let lastProgress = 0;
    
    ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy', '-avoid_negative_ts', 'make_zero'])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('Fast concat started - CPU usage should be minimal');
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('stitch-progress', {
            percent: 0,
            mode: 'fast_concat',
            message: 'Starting fast concatenation...'
          });
        }
      })
      .on('progress', (progress) => {
        const elapsed = (Date.now() - startTime) / 1000;
        const percent = progress.percent || 0;
        
        if (percent - lastProgress >= 5) {
          console.log(`Fast concat: ${percent.toFixed(1)}% (${elapsed.toFixed(1)}s)`);
          lastProgress = percent;
        }
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('stitch-progress', {
            percent: percent,
            mode: 'fast_concat',
            elapsed: elapsed,
            message: `Concatenating videos: ${percent.toFixed(1)}%`
          });
        }
      })
      .on('end', () => {
        const totalTime = (Date.now() - startTime) / 1000;
        console.log(`Fast concat completed in ${totalTime.toFixed(1)} seconds`);
        
        try {
          fs.unlinkSync(concatListPath);
        } catch (err) {
          console.warn('Failed to clean up concat list file:', err.message);
        }
        
        resolve(outputPath);
      })
      .on('error', (err) => {
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
        
        reject(new Error(`Fast concatenation failed: ${err.message}`));
      })
      .run();
  });
}

// Fast concatenation only - reject incompatible videos
ipcMain.handle('stitch-videos', async (event, videoPaths) => {
  return new Promise(async (resolve, reject) => {
    if (!videoPaths || videoPaths.length === 0) {
      reject(new Error('No video files provided'));
      return;
    }
    
    if (videoPaths.length === 1) {
      resolve(videoPaths[0]);
      return;
    }
    
    try {
      const areCompatible = await checkVideoCompatibility(videoPaths);
      
      if (!areCompatible) {
        reject(new Error('Videos have different formats/codecs. Please ensure all videos have the same format, resolution, and codec for fast stitching.'));
        return;
      }
      
      const outputPath = await performFastConcat(videoPaths);
      resolve(outputPath);
      
    } catch (error) {
      reject(error);
    }
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
      
      if (!videoStream) {
        reject(new Error('No video stream found in file'));
        return;
      }
      
      let fps = 30;
      if (videoStream.r_frame_rate) {
        try {
          fps = eval(videoStream.r_frame_rate);
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

// Parse GPX file (existing function, now internal)
async function parseGpxInternal(gpxFilePath) {
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
    
    allPoints.sort((a, b) => new Date(a.time) - new Date(b.time));
    
    const validPoints = allPoints.filter(point => point.isValid);
    
    return {
      points: allPoints,
      validPoints: validPoints,
      totalPoints: allPoints.length,
      validPointsCount: validPoints.length,
      startTime: allPoints.length > 0 ? allPoints[0].time : null,
      endTime: allPoints.length > 0 ? allPoints[allPoints.length - 1].time : null
    };
  } catch (error) {
    throw new Error(`Failed to parse GPX: ${error.message}`);
  }
}

// Parse GPX file (existing public function)
ipcMain.handle('parse-gpx', async (event, gpxFilePath) => {
  return parseGpxInternal(gpxFilePath);
});

// Open external URL
ipcMain.handle('open-external', async (event, url) => {
  shell.openExternal(url);
});

// Clean up temporary files on app quit
app.on('before-quit', () => {
  const tempDir = path.join(os.tmpdir(), 'telemetry-sync-videos');
  if (fs.existsSync(tempDir)) {
    try {
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