class TelemetryApp {
    constructor() {
        this.followDot = false;
        this.fitFilePath = null;
        this.videoFilePaths = [];
        this.stitchedVideoPath = null;
        this.gpxData = null;
        this.videoMetadata = null;
        this.syncOffset = 0;
        this.isPlaying = false;
        this.currentFrame = 0;
        
        this.map = null;
        this.trackPolyline = null;
        this.currentPositionMarker = null;
        this.interpolatedPoints = [];
        this.distancePoints = [];
        
        this.animationFrameId = null;
        this.lastUpdateTime = 0;
        this.targetPosition = null;
        this.currentPosition = null;
        this.lastValidPosition = null;
        
        this.isResizing = false;
        this.startX = 0;
        this.startVideoWidth = 0;
        
        // Widget dragging
        this.isDraggingWidget = false;
        this.widgetStartX = 0;
        this.widgetStartY = 0;
        this.widgetStartLeft = 0;
        this.widgetStartTop = 0;
        
        // Graph canvas
        this.graphCanvas = null;
        this.graphCtx = null;
        
        this.initializeUI();
        this.initializeMap();
        this.initializeSplitter();
        this.initializeWidget();
    }

    initializeUI() {
        document.getElementById('select-fit-btn').addEventListener('click', () => this.selectFitFile());
        document.getElementById('select-video-btn').addEventListener('click', () => this.selectVideoFiles());
        document.getElementById('remove-video-btn').addEventListener('click', () => this.removeSelectedVideo());
        document.getElementById('load-btn').addEventListener('click', () => this.loadAndSync());
        
        document.getElementById('play-pause-btn').addEventListener('click', () => this.togglePlayPause());
        document.getElementById('timeline-slider').addEventListener('input', (e) => this.seekToPosition(e.target.value));
        document.getElementById('sync-btn').addEventListener('click', () => this.applySyncOffset());
        
        const video = document.getElementById('video-player');
        video.addEventListener('loadedmetadata', () => this.onVideoLoaded());
        video.addEventListener('timeupdate', () => this.onVideoTimeUpdate());
        video.addEventListener('play', () => this.onVideoPlay());
        video.addEventListener('pause', () => this.onVideoPause());

        document.getElementById('follow-toggle').addEventListener('change', (e) => {
            this.followDot = e.target.checked;
        });

        document.getElementById('video-list').addEventListener('click', (e) => {
            if (e.target.classList.contains('video-item')) {
                this.selectVideoInList(e.target);
            }
        });
        
        this.startSmoothAnimation();
    }

    initializeWidget() {
        const widget = document.getElementById('telemetry-widget');
        const header = widget.querySelector('.widget-header');
        const collapseBtn = document.getElementById('collapse-widget');
        const closeBtn = document.getElementById('close-widget');
        const showBtn = document.getElementById('show-telemetry-btn');
        const content = widget.querySelector('.widget-content');

        // Make widget draggable
        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('widget-btn')) return;
            
            this.isDraggingWidget = true;
            this.widgetStartX = e.clientX;
            this.widgetStartY = e.clientY;
            
            const rect = widget.getBoundingClientRect();
            this.widgetStartLeft = rect.left;
            this.widgetStartTop = rect.top;
            
            document.addEventListener('mousemove', this.handleWidgetMove.bind(this));
            document.addEventListener('mouseup', this.handleWidgetUp.bind(this));
            
            widget.style.cursor = 'grabbing';
            e.preventDefault();
        });

        // Collapse/expand functionality
        collapseBtn.addEventListener('click', () => {
            const isCollapsed = content.style.display === 'none';
            content.style.display = isCollapsed ? 'block' : 'none';
            collapseBtn.textContent = isCollapsed ? '−' : '+';
        });

        // Close widget
        closeBtn.addEventListener('click', () => {
            widget.classList.add('hidden');
            showBtn.classList.remove('hidden');
        });

        // Show widget
        showBtn.addEventListener('click', () => {
            widget.classList.remove('hidden');
            showBtn.classList.add('hidden');
        });
    }

    handleWidgetMove(e) {
        if (!this.isDraggingWidget) return;
        
        const widget = document.getElementById('telemetry-widget');
        const deltaX = e.clientX - this.widgetStartX;
        const deltaY = e.clientY - this.widgetStartY;
        
        const newLeft = this.widgetStartLeft + deltaX;
        const newTop = this.widgetStartTop + deltaY;
        
        // Keep widget within viewport bounds
        const maxLeft = window.innerWidth - widget.offsetWidth;
        const maxTop = window.innerHeight - widget.offsetHeight;
        
        widget.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + 'px';
        widget.style.top = Math.max(0, Math.min(newTop, maxTop)) + 'px';
    }

    handleWidgetUp() {
        this.isDraggingWidget = false;
        document.removeEventListener('mousemove', this.handleWidgetMove);
        document.removeEventListener('mouseup', this.handleWidgetUp);
        
        const widget = document.getElementById('telemetry-widget');
        widget.style.cursor = 'default';
    }

    initializeSplitter() {
        const splitter = document.getElementById('splitter');
        const videoPanel = document.getElementById('video-panel');

        splitter.addEventListener('mousedown', (e) => {
            this.isResizing = true;
            this.startX = e.clientX;
            this.startVideoWidth = videoPanel.offsetWidth;
            
            document.addEventListener('mousemove', this.handleSplitterMove.bind(this));
            document.addEventListener('mouseup', this.handleSplitterUp.bind(this));
            
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
        
        const minWidth = 300;
        const maxVideoWidth = containerWidth - minWidth - splitterWidth;
        
        newVideoWidth = Math.max(minWidth, Math.min(newVideoWidth, maxVideoWidth));
        
        const videoWidthPercent = (newVideoWidth / containerWidth) * 100;
        videoPanel.style.width = `${videoWidthPercent}%`;
        
        if (this.map) {
            setTimeout(() => {
                this.map.invalidateSize();
            }, 100);
        }
        
        // Redraw graph when resizing
        if (this.graphCanvas) {
            setTimeout(() => {
                this.drawDistanceGraph();
            }, 100);
        }
    }

    handleSplitterUp() {
        this.isResizing = false;
        document.removeEventListener('mousemove', this.handleSplitterMove);
        document.removeEventListener('mouseup', this.handleSplitterUp);
        
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        
        if (this.map) {
            setTimeout(() => {
                this.map.invalidateSize();
            }, 200);
        }
        
        // Redraw graph after resizing
        if (this.graphCanvas) {
            setTimeout(() => {
                this.drawDistanceGraph();
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
        
        const animationSpeed = 0.1;
        
        this.currentPosition.lat += (this.targetPosition.lat - this.currentPosition.lat) * animationSpeed;
        this.currentPosition.lon += (this.targetPosition.lon - this.currentPosition.lon) * animationSpeed;
        
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
        
        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        });
        
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 18,
            attribution: '© Esri'
        });
        
        osmLayer.addTo(this.map);
        
        L.control.layers({
            'OpenStreetMap': osmLayer,
            'Satellite': satelliteLayer
        }).addTo(this.map);
        
        window.addEventListener('resize', () => {
            setTimeout(() => {
                if (this.map) {
                    this.map.invalidateSize();
                }
                if (this.graphCanvas) {
                    this.drawDistanceGraph();
                }
            }, 100);
        });
    }

    initializeGraph() {
        this.graphCanvas = document.getElementById('distance-graph');
        this.graphCtx = this.graphCanvas.getContext('2d');
        
        // Make graph canvas responsive
        const resizeCanvas = () => {
            const panel = document.getElementById('distance-graph-panel');
            this.graphCanvas.width = panel.offsetWidth;
            this.graphCanvas.height = 120;
            this.drawDistanceGraph();
        };
        
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        
        // Add click interaction for seeking
        this.graphCanvas.addEventListener('click', (e) => {
            this.handleGraphClick(e);
        });
    }

    handleGraphClick(e) {
        if (!this.videoMetadata || !this.distancePoints.length) return;
        
        const rect = this.graphCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const graphWidth = this.graphCanvas.width - 80; // Account for margins
        const clickRatio = (x - 40) / graphWidth; // 40px left margin
        
        if (clickRatio >= 0 && clickRatio <= 1) {
            const targetTime = clickRatio * this.videoMetadata.duration;
            const video = document.getElementById('video-player');
            video.currentTime = targetTime;
        }
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

    async selectVideoFiles() {
        try {
            const filePaths = await window.electronAPI.selectVideoFiles();
            if (filePaths && filePaths.length > 0) {
                this.videoFilePaths = [...this.videoFilePaths, ...filePaths];
                this.updateVideoFilesList();
                this.checkFilesReady();
            }
        } catch (error) {
            this.showError('Failed to select video files: ' + error.message);
        }
    }

    updateVideoFilesList() {
        const videoList = document.getElementById('video-list');
        videoList.innerHTML = '';
        
        this.videoFilePaths.forEach((filePath, index) => {
            const fileName = filePath.split(/[\\/]/).pop();
            const listItem = document.createElement('div');
            listItem.className = 'video-item';
            listItem.dataset.index = index;
            listItem.innerHTML = `
                <span class="video-name">${fileName}</span>
                <span class="video-remove" data-index="${index}">×</span>
            `;
            
            listItem.querySelector('.video-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeVideoFile(index);
            });
            
            videoList.appendChild(listItem);
        });

        const fileCount = document.getElementById('video-file-count');
        if (this.videoFilePaths.length > 0) {
            fileCount.textContent = `${this.videoFilePaths.length} video file(s) selected`;
            fileCount.classList.add('selected');
        } else {
            fileCount.textContent = '';
            fileCount.classList.remove('selected');
        }
    }

    removeVideoFile(index) {
        this.videoFilePaths.splice(index, 1);
        this.updateVideoFilesList();
        this.checkFilesReady();
    }

    removeSelectedVideo() {
        const selectedItem = document.querySelector('.video-item.selected');
        if (selectedItem) {
            const index = parseInt(selectedItem.dataset.index);
            this.removeVideoFile(index);
        }
    }

    selectVideoInList(item) {
        document.querySelectorAll('.video-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
    }

    checkFilesReady() {
        const loadBtn = document.getElementById('load-btn');
        if (this.fitFilePath && this.videoFilePaths.length > 0) {
            loadBtn.disabled = false;
        } else {
            loadBtn.disabled = true;
        }
    }

    async loadAndSync() {
        try {
            this.showLoading(true, 'Processing files...');
            
            let gpxFilePath = this.fitFilePath;
            if (this.fitFilePath.toLowerCase().endsWith('.fit')) {
                console.log('Converting FIT to GPX...');
                this.showLoading(true, 'Converting FIT to GPX...');
                gpxFilePath = await window.electronAPI.convertFitToGpx(this.fitFilePath);
            }
            
            console.log('Parsing GPX data...');
            this.showLoading(true, 'Parsing GPS data...');
            this.gpxData = await window.electronAPI.parseGpx(gpxFilePath);
            console.log(`Loaded ${this.gpxData.totalPoints} GPS points (${this.gpxData.validPointsCount} valid)`);
            
            if (this.videoFilePaths.length > 1) {
                console.log('Checking video compatibility...');
                this.showLoading(true, 'Checking video compatibility...');
                
                try {
                    this.showLoading(true, 'Stitching videos together (fast mode)...');
                    this.stitchedVideoPath = await window.electronAPI.stitchVideos(this.videoFilePaths);
                    console.log('Videos stitched successfully');
                } catch (stitchError) {
                    if (stitchError.message.includes('not compatible') || 
                        stitchError.message.includes('different formats') ||
                        stitchError.message.includes('different codec')) {
                        
                        this.showVideoCompatibilityError(stitchError.message);
                        this.showLoading(false);
                        return;
                    } else {
                        throw stitchError;
                    }
                }
            } else {
                this.stitchedVideoPath = this.videoFilePaths[0];
            }
            
            console.log('Getting video metadata...');
            this.showLoading(true, 'Getting video metadata...');
            this.videoMetadata = await window.electronAPI.getVideoMetadata(this.stitchedVideoPath);
            console.log('Video metadata:', this.videoMetadata);
            
            this.showLoading(true, 'Processing GPS data...');
            this.processGpsData();
            
            const video = document.getElementById('video-player');
            video.src = `file://${this.stitchedVideoPath}`;
            
            document.getElementById('file-panel').style.display = 'none';
            document.getElementById('main-content').classList.remove('hidden');
            
            // Show telemetry widget and initialize graph
            document.getElementById('telemetry-widget').classList.remove('hidden');
            this.initializeGraph();
            
            this.showLoading(false);
            
        } catch (error) {
            this.showError('Failed to load files: ' + error.message);
            this.showLoading(false);
        }
    }

    showVideoCompatibilityError(message) {
        const errorDialog = document.createElement('div');
        errorDialog.className = 'error-dialog';
        errorDialog.innerHTML = `
            <div class="error-overlay">
                <div class="error-content">
                    <h3>Video Compatibility Issue</h3>
                    <div class="error-message">
                        <p>${message}</p>
                    </div>
                    <div class="error-suggestions">
                        <h4>Suggestions:</h4>
                        <ul>
                            <li>Use videos from the same camera/device</li>
                            <li>Ensure all videos have the same resolution (e.g., all 1080p or all 4K)</li>
                            <li>Check that all videos use the same frame rate (e.g., all 30fps or all 60fps)</li>
                            <li>Use a video converter to standardize your videos before importing</li>
                            <li>Try processing one video at a time</li>
                        </ul>
                    </div>
                    <div class="error-actions">
                        <button class="btn secondary" onclick="window.electronAPI.openExternal('https://handbrake.fr/')">Download HandBrake (Free Converter)</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(errorDialog);
    }

    processGpsData() {
        if (!this.gpxData || !this.gpxData.points.length) return;
        
        const validPoints = this.gpxData.validPoints;
        
        let totalDistance = 0;
        this.distancePoints = [{ time: 0, distance: 0 }]; // Start at origin
        
        for (let i = 1; i < validPoints.length; i++) {
            const dist = this.calculateDistance(
                validPoints[i-1].lat, validPoints[i-1].lon,
                validPoints[i].lat, validPoints[i].lon
            );
            totalDistance += dist;
            
            // Calculate time offset from start
            const startTime = new Date(validPoints[0].time).getTime();
            const currentTime = new Date(validPoints[i].time).getTime();
            const timeOffsetSeconds = (currentTime - startTime) / 1000;
            
            this.distancePoints.push({
                time: timeOffsetSeconds,
                distance: totalDistance / 1000 // Convert to km
            });
        }
        
        document.getElementById('total-distance').textContent = (totalDistance / 1000).toFixed(2);
        
        this.interpolateGpsPoints();
        this.drawTrackOnMap();
    }

    drawDistanceGraph() {
        if (!this.graphCtx || !this.distancePoints.length || !this.videoMetadata) return;
        
        const canvas = this.graphCanvas;
        const ctx = this.graphCtx;
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        // Set up margins
        const margin = { top: 20, right: 20, bottom: 30, left: 40 };
        const graphWidth = width - margin.left - margin.right;
        const graphHeight = height - margin.top - margin.bottom;
        
        // Find max values for scaling
        const maxTime = this.videoMetadata.duration;
        const maxDistance = Math.max(...this.distancePoints.map(p => p.distance));
        
        // Draw background
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        
        // Draw grid lines
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        
        // Vertical grid lines (time)
        const timeSteps = 10;
        for (let i = 0; i <= timeSteps; i++) {
            const x = margin.left + (i / timeSteps) * graphWidth;
            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, height - margin.bottom);
            ctx.stroke();
        }
        
        // Horizontal grid lines (distance)
        const distSteps = 5;
        for (let i = 0; i <= distSteps; i++) {
            const y = margin.top + (i / distSteps) * graphHeight;
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(width - margin.right, y);
            ctx.stroke();
        }
        
        // Draw the distance curve
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        let firstPoint = true;
        for (const point of this.distancePoints) {
            const x = margin.left + (point.time / maxTime) * graphWidth;
            const y = height - margin.bottom - (point.distance / maxDistance) * graphHeight;
            
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        
        // Draw current position marker
        const video = document.getElementById('video-player');
        if (video && !isNaN(video.currentTime)) {
            const currentTime = video.currentTime;
            const currentX = margin.left + (currentTime / maxTime) * graphWidth;
            
            // Find current distance by interpolation
            let currentDistance = 0;
            for (let i = 1; i < this.distancePoints.length; i++) {
                if (this.distancePoints[i].time >= currentTime) {
                    const prev = this.distancePoints[i - 1];
                    const curr = this.distancePoints[i];
                    const ratio = (currentTime - prev.time) / (curr.time - prev.time);
                    currentDistance = prev.distance + (curr.distance - prev.distance) * ratio;
                    break;
                }
            }
            
            const currentY = height - margin.bottom - (currentDistance / maxDistance) * graphHeight;
            
            // Draw vertical line
            ctx.strokeStyle = '#007acc';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(currentX, margin.top);
            ctx.lineTo(currentX, height - margin.bottom);
            ctx.stroke();
            
            // Draw dot
            ctx.fillStyle = '#007acc';
            ctx.beginPath();
            ctx.arc(currentX, currentY, 4, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // Draw labels
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        
        // Time labels (bottom)
        const timeLabels = 6;
        for (let i = 0; i <= timeLabels; i++) {
            const time = (i / timeLabels) * maxTime;
            const x = margin.left + (i / timeLabels) * graphWidth;
            const timeStr = this.formatTime(time);
            ctx.fillText(timeStr, x, height - 5);
        }
        
        // Distance labels (left)
        ctx.textAlign = 'right';
        const distLabels = 4;
        for (let i = 0; i <= distLabels; i++) {
            const dist = (i / distLabels) * maxDistance;
            const y = height - margin.bottom - (i / distLabels) * graphHeight;
            ctx.fillText(dist.toFixed(1) + 'km', margin.left - 10, y + 4);
        }
    }

    interpolateGpsPoints() {
        if (!this.gpxData || !this.videoMetadata) return;
        
        const points = this.gpxData.points;
        const fps = this.videoMetadata.fps;
        const videoDuration = this.videoMetadata.duration;
        
        const startTime = new Date(points[0].time).getTime();
        const endTime = new Date(points[points.length - 1].time).getTime();
        const totalFrames = Math.floor(videoDuration * fps);
        
        this.interpolatedPoints = [];
        
        for (let frame = 0; frame < totalFrames; frame++) {
            const videoTime = (frame / fps) * 1000;
            const gpsTime = startTime + videoTime + this.syncOffset;
            
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
        
        const beforeValid = beforePoint.isValid;
        const afterValid = afterPoint.isValid;
        
        if (!beforeValid && !afterValid) {
            return null;
        }
        
        if (!beforeValid && afterValid) {
            return this.createInterpolatedPoint(afterPoint);
        }
        if (beforeValid && !afterValid) {
            return this.createInterpolatedPoint(beforePoint);
        }
        
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
                   beforePoint.speed + (afterPoint.speed - afterPoint.speed) * ratio : 
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
        
        if (this.trackPolyline) {
            this.map.removeLayer(this.trackPolyline);
        }
        
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
        
        this.map.fitBounds(this.trackPolyline.getBounds());
        
        this.trackPolyline.on('click', (e) => {
            this.seekToMapPosition(e.latlng);
        });
        
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
            
            this.currentPosition = { lat: firstValidPoint.lat, lon: firstValidPoint.lon };
            this.targetPosition = { lat: firstValidPoint.lat, lon: firstValidPoint.lon };
            this.lastValidPosition = { lat: firstValidPoint.lat, lon: firstValidPoint.lon };
            
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
        
        this.updateTimeDisplay();
    }

    onVideoTimeUpdate() {
        if (this.isDragging) return;
        
        const video = document.getElementById('video-player');
        const currentTimeMs = video.currentTime * 1000;
        const currentFrame = Math.floor(video.currentTime * this.videoMetadata.fps);
        
        this.currentFrame = currentFrame;
        
        this.updateTimeDisplay();
        this.updateMarkerPosition(currentFrame);
        this.updateTelemetryDisplay(currentFrame);
        
        const slider = document.getElementById('timeline-slider');
        slider.value = video.currentTime;
        
        // Redraw graph to update current position marker
        if (this.graphCanvas) {
            this.drawDistanceGraph();
        }
    }

    updateMarkerPosition(frame) {
        if (!this.currentPositionMarker || !this.interpolatedPoints.length) return;
        
        const point = this.interpolatedPoints.find(p => p && p.frame === frame);
        
        if (point) {
            if (point.isValid) {
                this.targetPosition = { lat: point.lat, lon: point.lon };
                this.lastValidPosition = { lat: point.lat, lon: point.lon };
                
                if (!this.isPlaying || this.isDragging) {
                    this.currentPosition = { lat: point.lat, lon: point.lon };
                    this.currentPositionMarker.setLatLng([point.lat, point.lon]);
                }
            } else {
                if (this.lastValidPosition) {
                    this.targetPosition = { lat: this.lastValidPosition.lat, lon: this.lastValidPosition.lon };
                    
                    if (!this.isPlaying || this.isDragging) {
                        this.currentPosition = { lat: this.lastValidPosition.lat, lon: this.lastValidPosition.lon };
                        this.currentPositionMarker.setLatLng([this.lastValidPosition.lat, this.lastValidPosition.lon]);
                    }
                }
            }
            
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
        
        this.interpolateGpsPoints();
        
        const video = document.getElementById('video-player');
        const currentFrame = Math.floor(video.currentTime * this.videoMetadata.fps);
        this.updateMarkerPosition(currentFrame);
        this.updateTelemetryDisplay(currentFrame);
        
        // Recalculate distance points and redraw graph
        this.processGpsData();
        this.drawDistanceGraph();
        
        console.log(`Applied sync offset: ${this.syncOffset}ms`);
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000;
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

    showLoading(show, message = 'Processing files...') {
        const loading = document.getElementById('loading');
        const loadingText = document.getElementById('loading-text');
        if (show) {
            loading.classList.remove('hidden');
            if (loadingText) {
                loadingText.textContent = message;
            }
        } else {
            loading.classList.add('hidden');
        }
    }

    showError(message) {
        if (message.includes('not compatible') || message.includes('different formats')) {
            this.showVideoCompatibilityError(message);
        } else {
            alert('Error: ' + message);
            console.error(message);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
  new TelemetryApp();

  const okButton = document.createElement('button');
  okButton.className = 'btn primary';
  okButton.textContent = 'OK';
  okButton.onclick = function () {
    this.closest('.error-dialog')?.remove();
  };

  // Append the button somewhere, for example to the body or a specific container
  document.body.appendChild(okButton);
});