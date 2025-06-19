class TelemetryApp {
    constructor() {

        this.followDot = false;

        this.fitFilePath = null;
        this.videoFilePath = null;
        this.gpxData = null;
        this.videoMetadata = null;
        this.syncOffset = 0; // milliseconds
        this.isPlaying = false;
        this.currentFrame = 0;
        
        this.map = null;
        this.trackPolyline = null;
        this.currentPositionMarker = null;
        this.interpolatedPoints = [];
        
        // Smooth animation properties
        this.animationFrameId = null;
        this.lastUpdateTime = 0;
        this.targetPosition = null;
        this.currentPosition = null;
        this.lastValidPosition = null; // Track last valid GPS position
        
        // Splitter properties
        this.isResizing = false;
        this.startX = 0;
        this.startVideoWidth = 0;
        
        this.initializeUI();
        this.initializeMap();
        this.initializeSplitter();
    }

    initializeUI() {
        // File selection
        document.getElementById('select-fit-btn').addEventListener('click', () => this.selectFitFile());
        document.getElementById('select-video-btn').addEventListener('click', () => this.selectVideoFile());
        document.getElementById('load-btn').addEventListener('click', () => this.loadAndSync());
        
        // Video controls
        document.getElementById('play-pause-btn').addEventListener('click', () => this.togglePlayPause());
        document.getElementById('timeline-slider').addEventListener('input', (e) => this.seekToPosition(e.target.value));
        document.getElementById('sync-btn').addEventListener('click', () => this.applySyncOffset());
        
        // Video events
        const video = document.getElementById('video-player');
        video.addEventListener('loadedmetadata', () => this.onVideoLoaded());
        video.addEventListener('timeupdate', () => this.onVideoTimeUpdate());
        video.addEventListener('play', () => this.onVideoPlay());
        video.addEventListener('pause', () => this.onVideoPause());

        document.getElementById('follow-toggle').addEventListener('change', (e) => {
            this.followDot = e.target.checked;
        });

        
        // Start smooth animation loop
        this.startSmoothAnimation();
    }

    initializeSplitter() {
        const splitter = document.getElementById('splitter');
        const videoPanel = document.getElementById('video-panel');
        const mapPanel = document.getElementById('map-panel');
        const container = document.getElementById('content-container');

        splitter.addEventListener('mousedown', (e) => {
            this.isResizing = true;
            this.startX = e.clientX;
            this.startVideoWidth = videoPanel.offsetWidth;
            
            document.addEventListener('mousemove', this.handleSplitterMove.bind(this));
            document.addEventListener('mouseup', this.handleSplitterUp.bind(this));
            
            // Prevent text selection during drag
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
            
            e.preventDefault();
        });
    }

    handleSplitterMove(e) {
        if (!this.isResizing) return;
        
        const container = document.getElementById('content-container');
        const videoPanel = document.getElementById('video-panel');
        const splitter = document.getElementById('splitter');
        
        const deltaX = e.clientX - this.startX;
        const containerWidth = container.offsetWidth;
        const splitterWidth = splitter.offsetWidth;
        
        let newVideoWidth = this.startVideoWidth + deltaX;
        
        // Enforce minimum widths
        const minWidth = 300;
        const maxVideoWidth = containerWidth - minWidth - splitterWidth;
        
        newVideoWidth = Math.max(minWidth, Math.min(newVideoWidth, maxVideoWidth));
        
        // Update panel widths
        const videoWidthPercent = (newVideoWidth / containerWidth) * 100;
        videoPanel.style.width = `${videoWidthPercent}%`;
        
        // Force map to resize
        if (this.map) {
            setTimeout(() => {
                this.map.invalidateSize();
            }, 100);
        }
    }

    handleSplitterUp() {
        this.isResizing = false;
        document.removeEventListener('mousemove', this.handleSplitterMove);
        document.removeEventListener('mouseup', this.handleSplitterUp);
        
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        
        // Final map resize
        if (this.map) {
            setTimeout(() => {
                this.map.invalidateSize();
            }, 200);
        }
    }

    startSmoothAnimation() {
        const animate = (currentTime) => {
            if (this.isPlaying && this.targetPosition && this.currentPositionMarker) {
                this.updateSmoothPosition(currentTime);
            }
            this.animationFrameId = requestAnimationFrame(animate);
        };
        animate(performance.now());
    }

    updateSmoothPosition(currentTime) {
        if (!this.targetPosition || !this.currentPosition) return;
        
        const deltaTime = currentTime - this.lastUpdateTime;
        const animationSpeed = 0.1; // Adjust for smoother/faster animation
        
        // Lerp (linear interpolation) between current and target position
        this.currentPosition.lat += (this.targetPosition.lat - this.currentPosition.lat) * animationSpeed;
        this.currentPosition.lon += (this.targetPosition.lon - this.currentPosition.lon) * animationSpeed;
        
        // Update marker position
        this.currentPositionMarker.setLatLng([this.currentPosition.lat, this.currentPosition.lon]);

        if (this.followDot && this.map) {
            this.map.setView([this.currentPosition.lat, this.currentPosition.lon]);
        }

        
        this.lastUpdateTime = currentTime;
    }

    initializeMap() {
        this.map = L.map('map', {
            zoomControl: true,
            attributionControl: true
        }).setView([24.8474, 46.7342], 13);
        
        // Add tile layers
        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        });
        
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 18,
            attribution: '© Esri'
        });
        
        osmLayer.addTo(this.map);
        
        // Add layer control
        L.control.layers({
            'OpenStreetMap': osmLayer,
            'Satellite': satelliteLayer
        }).addTo(this.map);
        
        // Handle window resize
        window.addEventListener('resize', () => {
            setTimeout(() => {
                if (this.map) {
                    this.map.invalidateSize();
                }
            }, 100);
        });
    }

    async selectFitFile() {
        try {
            const filePath = await window.electronAPI.selectFitFile();
            if (filePath) {
                this.fitFilePath = filePath;
                const fileName = filePath.split(/[\\/]/).pop();
                document.getElementById('fit-file-name').textContent = fileName;
                document.getElementById('fit-file-name').classList.add('selected');
                this.checkFilesReady();
            }
        } catch (error) {
            this.showError('Failed to select FIT file: ' + error.message);
        }
    }

    async selectVideoFile() {
        try {
            const filePath = await window.electronAPI.selectVideoFile();
            if (filePath) {
                this.videoFilePath = filePath;
                const fileName = filePath.split(/[\\/]/).pop();
                document.getElementById('video-file-name').textContent = fileName;
                document.getElementById('video-file-name').classList.add('selected');
                this.checkFilesReady();
            }
        } catch (error) {
            this.showError('Failed to select video file: ' + error.message);
        }
    }

    checkFilesReady() {
        const loadBtn = document.getElementById('load-btn');
        if (this.fitFilePath && this.videoFilePath) {
            loadBtn.disabled = false;
        }
    }

    async loadAndSync() {
        try {
            this.showLoading(true);
            
            // Convert FIT to GPX if needed
            let gpxFilePath = this.fitFilePath;
            if (this.fitFilePath.toLowerCase().endsWith('.fit')) {
                console.log('Converting FIT to GPX...');
                gpxFilePath = await window.electronAPI.convertFitToGpx(this.fitFilePath);
            }
            
            // Parse GPX data
            console.log('Parsing GPX data...');
            this.gpxData = await window.electronAPI.parseGpx(gpxFilePath);
            console.log(`Loaded ${this.gpxData.totalPoints} GPS points (${this.gpxData.validPointsCount} valid)`);
            
            // Get video metadata
            console.log('Getting video metadata...');
            this.videoMetadata = await window.electronAPI.getVideoMetadata(this.videoFilePath);
            console.log('Video metadata:', this.videoMetadata);
            
            // Process and interpolate GPS data
            this.processGpsData();
            
            // Load video
            const video = document.getElementById('video-player');
            video.src = `file://${this.videoFilePath}`;
            
            // Show main content
            document.getElementById('file-panel').style.display = 'none';
            document.getElementById('main-content').classList.remove('hidden');
            
            this.showLoading(false);
            
        } catch (error) {
            this.showError('Failed to load files: ' + error.message);
            this.showLoading(false);
        }
    }

    processGpsData() {
        if (!this.gpxData || !this.gpxData.points.length) return;
        
        const validPoints = this.gpxData.validPoints;
        
        // Calculate total distance using only valid points
        let totalDistance = 0;
        for (let i = 1; i < validPoints.length; i++) {
            const dist = this.calculateDistance(
                validPoints[i-1].lat, validPoints[i-1].lon,
                validPoints[i].lat, validPoints[i].lon
            );
            totalDistance += dist;
        }
        
        document.getElementById('total-distance').textContent = (totalDistance / 1000).toFixed(2);
        
        // Create interpolated points based on video FPS
        this.interpolateGpsPoints();
        
        // Draw track on map using only valid points
        this.drawTrackOnMap();
    }

    interpolateGpsPoints() {
        if (!this.gpxData || !this.videoMetadata) return;
        
        const points = this.gpxData.points; // Use all points for timing
        const fps = this.videoMetadata.fps;
        const videoDuration = this.videoMetadata.duration;
        
        const startTime = new Date(points[0].time).getTime();
        const endTime = new Date(points[points.length - 1].time).getTime();
        const totalFrames = Math.floor(videoDuration * fps);
        
        this.interpolatedPoints = [];
        
        for (let frame = 0; frame < totalFrames; frame++) {
            const videoTime = (frame / fps) * 1000; // milliseconds
            const gpsTime = startTime + videoTime + this.syncOffset;
            
            // Find closest GPS points (using all points for timing accuracy)
            const interpolatedPoint = this.interpolateGpsPoint(gpsTime, points);
            if (interpolatedPoint) {
                interpolatedPoint.frame = frame;
                interpolatedPoint.videoTime = videoTime;
                this.interpolatedPoints.push(interpolatedPoint);
            }
        }
        
        console.log(`Created ${this.interpolatedPoints.length} interpolated points`);
    }

    interpolateGpsPoint(targetTime, points) {
        // Find the two closest points in time
        let beforePoint = null;
        let afterPoint = null;
        
        for (let i = 0; i < points.length; i++) {
            const pointTime = new Date(points[i].time).getTime();
            
            if (pointTime <= targetTime) {
                beforePoint = points[i];
            } else {
                afterPoint = points[i];
                break;
            }
        }
        
        if (!beforePoint && !afterPoint) return null;
        if (!beforePoint) return this.createInterpolatedPoint(afterPoint);
        if (!afterPoint) return this.createInterpolatedPoint(beforePoint);
        
        // Check if we have valid GPS data for interpolation
        const beforeValid = beforePoint.isValid;
        const afterValid = afterPoint.isValid;
        
        // If neither point is valid, return null (will hold last valid position)
        if (!beforeValid && !afterValid) {
            return null;
        }
        
        // If only one point is valid, use that one
        if (!beforeValid && afterValid) {
            return this.createInterpolatedPoint(afterPoint);
        }
        if (beforeValid && !afterValid) {
            return this.createInterpolatedPoint(beforePoint);
        }
        
        // Both points are valid - do linear interpolation
        const beforeTime = new Date(beforePoint.time).getTime();
        const afterTime = new Date(afterPoint.time).getTime();
        const ratio = (targetTime - beforeTime) / (afterTime - beforeTime);
        
        return {
            lat: beforePoint.lat + (afterPoint.lat - beforePoint.lat) * ratio,
            lon: beforePoint.lon + (afterPoint.lon - beforePoint.lon) * ratio,
            ele: beforePoint.ele !== null && afterPoint.ele !== null ? 
                 beforePoint.ele + (afterPoint.ele - beforePoint.ele) * ratio : 
                 (beforePoint.ele !== null ? beforePoint.ele : afterPoint.ele),
            speed: beforePoint.speed !== null && afterPoint.speed !== null ? 
                   beforePoint.speed + (afterPoint.speed - beforePoint.speed) * ratio : 
                   (beforePoint.speed !== null ? beforePoint.speed : afterPoint.speed),
            time: new Date(targetTime).toISOString(),
            isValid: true
        };
    }

    createInterpolatedPoint(sourcePoint) {
        return {
            lat: sourcePoint.lat,
            lon: sourcePoint.lon,
            ele: sourcePoint.ele,
            speed: sourcePoint.speed,
            time: sourcePoint.time,
            isValid: sourcePoint.isValid
        };
    }

    drawTrackOnMap() {
        if (!this.gpxData || !this.map) return;
        
        // Remove existing track
        if (this.trackPolyline) {
            this.map.removeLayer(this.trackPolyline);
        }
        
        // Create polyline from valid GPS points only
        const validPoints = this.gpxData.validPoints;
        if (validPoints.length === 0) {
            console.warn('No valid GPS points to draw track');
            return;
        }
        
        const latlngs = validPoints.map(point => [point.lat, point.lon]);
        
        this.trackPolyline = L.polyline(latlngs, {
            color: 'red',
            weight: 3,
            opacity: 0.8
        }).addTo(this.map);
        
        // Fit map to track bounds
        this.map.fitBounds(this.trackPolyline.getBounds());
        
        // Add click handler for seeking
        this.trackPolyline.on('click', (e) => {
            this.seekToMapPosition(e.latlng);
        });
        
        // Create current position marker using first valid point
        if (validPoints.length > 0) {
            const firstValidPoint = validPoints[0];
            this.currentPositionMarker = L.circleMarker([firstValidPoint.lat, firstValidPoint.lon], {
                radius: 8,
                fillColor: '#007acc',
                color: '#ffffff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8,
                className: 'smooth-marker'
            }).addTo(this.map);
            
            // Initialize smooth animation positions
            this.currentPosition = { lat: firstValidPoint.lat, lon: firstValidPoint.lon };
            this.targetPosition = { lat: firstValidPoint.lat, lon: firstValidPoint.lon };
            this.lastValidPosition = { lat: firstValidPoint.lat, lon: firstValidPoint.lon };
            
            // Make marker draggable for seeking
            this.currentPositionMarker.on('mousedown', () => {
                this.map.dragging.disable();
                this.isDragging = true;
            });
            
            this.map.on('mousemove', (e) => {
                if (this.isDragging) {
                    this.currentPositionMarker.setLatLng(e.latlng);
                }
            });
            
            this.map.on('mouseup', (e) => {
                if (this.isDragging) {
                    this.map.dragging.enable();
                    this.isDragging = false;
                    this.seekToMapPosition(e.latlng);
                }
            });
        }
    }

    seekToMapPosition(latlng) {
        if (!this.interpolatedPoints.length) return;
        
        // Find closest valid interpolated point
        let closestPoint = null;
        let closestDistance = Infinity;
        
        for (const point of this.interpolatedPoints) {
            if (point && point.isValid) {
                const distance = this.calculateDistance(latlng.lat, latlng.lng, point.lat, point.lon);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestPoint = point;
                }
            }
        }
        
        if (closestPoint) {
            const video = document.getElementById('video-player');
            video.currentTime = closestPoint.videoTime / 1000;
            this.updateMarkerPosition(closestPoint.frame);
        }
    }

    onVideoLoaded() {
        const video = document.getElementById('video-player');
        const slider = document.getElementById('timeline-slider');
        
        slider.max = video.duration;
        document.getElementById('video-fps').textContent = this.videoMetadata.fps.toFixed(2);
        
        this.updateTimeDisplay();
    }

    onVideoTimeUpdate() {
        if (this.isDragging) return; // Don't update during manual seeking
        
        const video = document.getElementById('video-player');
        const currentTimeMs = video.currentTime * 1000;
        const currentFrame = Math.floor(video.currentTime * this.videoMetadata.fps);
        
        this.currentFrame = currentFrame;
        
        // Update UI
        this.updateTimeDisplay();
        this.updateVideoStats();
        this.updateMarkerPosition(currentFrame);
        this.updateTelemetryDisplay(currentFrame);
        
        // Update timeline slider
        const slider = document.getElementById('timeline-slider');
        slider.value = video.currentTime;
    }

    updateMarkerPosition(frame) {
        if (!this.currentPositionMarker || !this.interpolatedPoints.length) return;
        
        const point = this.interpolatedPoints.find(p => p && p.frame === frame);
        
        if (point) {
            if (point.isValid) {
                // Update target position for smooth animation
                this.targetPosition = { lat: point.lat, lon: point.lon };
                this.lastValidPosition = { lat: point.lat, lon: point.lon };
                
                // If not playing or dragging, jump immediately
                if (!this.isPlaying || this.isDragging) {
                    this.currentPosition = { lat: point.lat, lon: point.lon };
                    this.currentPositionMarker.setLatLng([point.lat, point.lon]);
                }
            } else {
                // Invalid GPS data - hold at last valid position
                if (this.lastValidPosition) {
                    this.targetPosition = { lat: this.lastValidPosition.lat, lon: this.lastValidPosition.lon };
                    
                    if (!this.isPlaying || this.isDragging) {
                        this.currentPosition = { lat: this.lastValidPosition.lat, lon: this.lastValidPosition.lon };
                        this.currentPositionMarker.setLatLng([this.lastValidPosition.lat, this.lastValidPosition.lon]);
                    }
                }
            }
            
            // Add popup with current data
            const popupContent = `
                <div style="color: white;">
                    <strong>Frame:</strong> ${frame}<br>
                    <strong>GPS Valid:</strong> ${point.isValid ? 'Yes' : 'No'}<br>
                    <strong>Lat:</strong> ${point.isValid ? point.lat.toFixed(6) : 'Invalid'}<br>
                    <strong>Lon:</strong> ${point.isValid ? point.lon.toFixed(6) : 'Invalid'}<br>
                    <strong>Speed:</strong> ${point.speed ? point.speed.toFixed(2) + ' m/s' : 'N/A'}<br>
                    <strong>Elevation:</strong> ${point.ele ? point.ele.toFixed(1) + ' m' : 'N/A'}
                </div>
            `;
            
            this.currentPositionMarker.bindPopup(popupContent);
        }
    }

    updateTelemetryDisplay(frame) {
        if (!this.interpolatedPoints.length) return;
        
        const point = this.interpolatedPoints.find(p => p && p.frame === frame);
        if (point) {
            document.getElementById('current-lat').textContent = point.isValid ? point.lat.toFixed(6) : 'Invalid';
            document.getElementById('current-lon').textContent = point.isValid ? point.lon.toFixed(6) : 'Invalid';
            document.getElementById('current-speed').textContent = point.speed ? point.speed.toFixed(2) : '--';
            document.getElementById('current-elevation').textContent = point.ele ? point.ele.toFixed(1) : '--';
        }
    }

    updateVideoStats() {
        document.getElementById('current-frame').textContent = this.currentFrame;
        document.getElementById('video-time').textContent = this.formatTime(document.getElementById('video-player').currentTime);
    }

    updateTimeDisplay() {
        const video = document.getElementById('video-player');
        const current = this.formatTime(video.currentTime);
        const total = this.formatTime(video.duration);
        document.getElementById('time-display').textContent = `${current} / ${total}`;
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '00:00';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    togglePlayPause() {
        const video = document.getElementById('video-player');
        const btn = document.getElementById('play-pause-btn');
        
        if (video.paused) {
            video.play();
            btn.textContent = 'Pause';
            this.isPlaying = true;
        } else {
            video.pause();
            btn.textContent = 'Play';
            this.isPlaying = false;
        }
    }

    onVideoPlay() {
        document.getElementById('play-pause-btn').textContent = 'Pause';
        this.isPlaying = true;
    }

    onVideoPause() {
        document.getElementById('play-pause-btn').textContent = 'Play';
        this.isPlaying = false;
    }

    seekToPosition(value) {
        const video = document.getElementById('video-player');
        video.currentTime = parseFloat(value);
    }

    applySyncOffset() {
        const offsetInput = document.getElementById('offset-input');
        this.syncOffset = parseInt(offsetInput.value) || 0;
        
        // Recalculate interpolated points with new offset
        this.interpolateGpsPoints();
        
        // Update current position
        const video = document.getElementById('video-player');
        const currentFrame = Math.floor(video.currentTime * this.videoMetadata.fps);
        this.updateMarkerPosition(currentFrame);
        this.updateTelemetryDisplay(currentFrame);
        
        console.log(`Applied sync offset: ${this.syncOffset}ms`);
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth's radius in meters
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (show) {
            loading.classList.remove('hidden');
        } else {
            loading.classList.add('hidden');
        }
    }

    showError(message) {
        alert('Error: ' + message);
        console.error(message);
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new TelemetryApp();
});