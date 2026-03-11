/**
 * Instrument Tiles - Core Game Logic
 */

console.log('game.js loaded');
console.log('PitchDetector exists:', typeof PitchDetector);

class InstrumentTilesGame {
    constructor() {
        // Game state
        this.isPlaying = false;
        this.isPaused = false;
        this.midiData = null;
        this.notes = [];
        this.speed = 1.0;
        
        // Game stats
        this.score = 0;
        this.combo = 0;
        this.totalNotes = 0;
        this.hitNotes = 0;
        this.missedNotes = 0;
        
        // Canvas and rendering
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        
        // Game parameters
        this.noteSpeed = 300; // Note falling speed (pixels/sec)
        this.judgmentLineY = 0;
        this.hitWindow = {
            perfect: 80,    // Perfect judgment window (ms)
            good: 150,      // Good judgment window
            miss: 200       // Miss judgment window
        };
        
        // Prevent hitting multiple notes at once
        this.lastHitTime = 0;
        this.hitCooldown = 200; // Base cooldown (ms), dynamically adjusted
        this.currentCooldown = 200; // Current actual cooldown
        
        // Audio
        this.audioContext = null;
        this.startTime = 0;
        this.pauseTime = 0;
        
        // Pitch synthesizer (for preview)
        this.synthContext = null;
        
        // Pitch detector
        this.pitchDetector = new PitchDetector();
        this.pitchDetectionEnabled = false;
        this.lastDetectedMidi = null;
        this.pitchDetectionTimer = null;
        this.recentlyHitNotes = new Set(); // Prevent duplicate hits
        
        // Fingering data (reserved interface)
        this.fingeringData = {};
        
        // Initialize
        this.init();
    }

    init() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.setupEventListeners();
        this.render();
    }

    resizeCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.canvasWidth = rect.width;
        this.canvasHeight = rect.height;
        this.judgmentLineY = this.canvasHeight - 80;
    }

    setupEventListeners() {
        // MIDI file upload
        document.getElementById('midi-upload').addEventListener('change', (e) => {
            this.handleMidiUpload(e);
        });

        // Speed control
        document.getElementById('speed-control').addEventListener('input', (e) => {
            this.speed = parseFloat(e.target.value);
            document.getElementById('speed-value').textContent = this.speed.toFixed(1);
        });

        // Microphone button
        document.getElementById('mic-btn').addEventListener('click', () => this.toggleMicrophone());
        
        // Preview button
        document.getElementById('preview-btn').addEventListener('click', () => this.previewNotes());

        // Game control buttons
        document.getElementById('play-btn').addEventListener('click', () => this.play());
        document.getElementById('pause-btn').addEventListener('click', () => this.pause());
        document.getElementById('reset-btn').addEventListener('click', () => this.reset());
    }

    async handleMidiUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.updateStatus('Loading MIDI file...');

        try {
            const arrayBuffer = await file.arrayBuffer();
            console.log('MIDI file size:', file.size, 'bytes');
            
            // Use local MIDI parser
            this.midiData = new SimpleMidiParser(arrayBuffer);
            console.log('MIDI parsed successfully:', this.midiData);
            
            this.parseMidiData();
            this.updateStatus(`MIDI file loaded successfully! Total ${this.totalNotes} notes, ${this.uniqueNotes} unique pitches`);
            this.enableControls();
            this.render();
        } catch (error) {
            console.error('MIDI load failed:', error);
            console.error('Error stack:', error.stack);
            this.updateStatus(`MIDI file load failed: ${error.message}`);
        }
    }

    parseMidiData() {
        this.notes = [];
        this.totalNotes = 0;
        this.uniqueNotes = 0;

        // Scan all notes, count unique pitches
        const uniqueMidiNotes = new Set();
        const noteMap = new Map();
        
        this.midiData.tracks.forEach((track, trackIndex) => {
            console.log(`Processing track ${trackIndex}, ${track.notes.length} notes`);
            
            track.notes.forEach(note => {
                uniqueMidiNotes.add(note.midi);
                
                const noteKey = `${note.midi}-${note.startTime}`;
                if (!noteMap.has(noteKey)) {
                    // Limit max display length
                    const displayDuration = Math.min(note.duration, 0.5);
                    
                    const noteObj = {
                        midi: note.midi,
                        name: note.name,
                        startTime: note.startTime,
                        endTime: note.startTime + displayDuration, // Use fixed max length
                        duration: displayDuration,
                        velocity: note.velocity,
                        track: trackIndex,
                        hit: false,
                        missed: false,
                        x: 0,
                        y: 0,
                        width: 0,
                        height: 0,
                        originalDuration: note.duration, // Save original duration
                        hitWindowOffset: 0 // Judgment window offset
                    };
                    noteMap.set(noteKey, noteObj);
                    this.notes.push(noteObj);
                    this.totalNotes++;
                }
            });
        });

        console.log(`Total: ${this.totalNotes} notes, ${this.uniqueNotes} unique pitches`);

        // Detect consecutive same notes, dynamically adjust judgment window
        this.adjustConsecutiveNotes();

        // Calculate unique pitch count
        this.uniqueNotes = uniqueMidiNotes.size;
        
        // Calculate min MIDI note (for key mapping)
        const midiNotes = this.notes.map(n => n.midi);
        this.minMidi = midiNotes.length > 0 ? Math.min(...midiNotes) : 60;

        // Sort by start time
        this.notes.sort((a, b) => a.startTime - b.startTime);

        // Calculate note positions on tracks (adjust based on unique pitch count)
        this.calculateNotePositions();
    }

    /**
     * Detect consecutive same notes, adjust judgment window offset and cooldown
     */
    adjustConsecutiveNotes() {
        const consecutiveThreshold = 0.5; // Consecutive note time threshold (sec)
        
        for (let i = 1; i < this.notes.length; i++) {
            const prevNote = this.notes[i - 1];
            const currNote = this.notes[i];
            
            // Check for consecutive same notes or rapid consecutive notes
            const timeGap = currNote.startTime - prevNote.startTime;
            
            if (timeGap < consecutiveThreshold) {
                // Dynamic cooldown: 1/8 of note interval, min 50ms, max 300ms
                const dynamicCooldown = Math.max(50, Math.min(300, timeGap / 8 * 1000));
                
                if (currNote.midi === prevNote.midi) {
                    // Same note consecutive - reduce offset, make judgment window looser
                    prevNote.hitWindowOffset = -timeGap * 0.2;
                    currNote.hitWindowOffset = timeGap * 0.1;
                    
                    console.log(`Consecutive same notes: ${prevNote.name} -> ${currNote.name}, interval: ${timeGap.toFixed(3)}s, cooldown: ${dynamicCooldown.toFixed(0)}ms`);
                } else {
                    // Different note but rapid consecutive
                    console.log(`Rapid consecutive notes: ${prevNote.name} -> ${currNote.name}, interval: ${timeGap.toFixed(3)}s, cooldown: ${dynamicCooldown.toFixed(0)}ms`);
                }
                
                // Update cooldown (take min to adapt to rapid sections)
                this.currentCooldown = Math.min(this.currentCooldown, dynamicCooldown);
            }
        }
        
        console.log(`Global cooldown: ${this.currentCooldown.toFixed(0)}ms`);
    }

    calculateNotePositions() {
        // Find note range
        const midiNotes = this.notes.map(n => n.midi);
        const minMidi = Math.min(...midiNotes);
        const maxMidi = Math.max(...midiNotes);
        
        // Use unique pitch count to calculate lane width
        const laneCount = Math.max(this.uniqueNotes, 1);
        
        // If few notes, wider blocks; if many, compress appropriately
        // Set min and max lane width
        const minLaneWidth = 40;  // Min width
        const maxLaneWidth = 120; // Max width
        
        // Calculate lane width dynamically based on unique pitch count
        let laneWidth = this.canvasWidth / laneCount;
        
        // If lane too wide, limit max width and recalculate needed lanes
        if (laneWidth > maxLaneWidth && laneCount < 12) {
            // Few notes, use fixed width, center display
            laneWidth = Math.min(maxLaneWidth, this.canvasWidth / Math.max(laneCount, 1));
        } else if (laneWidth < minLaneWidth) {
            // Too many notes, merge some lanes
            laneWidth = minLaneWidth;
        }
        
        this.laneWidth = laneWidth;
        this.laneCount = laneCount;

        // Create MIDI to lane mapping
        const midiToLane = new Map();
        let laneIndex = 0;
        
        // Assign a lane for each unique MIDI note
        const uniqueMidiNotes = [...new Set(midiNotes)].sort((a, b) => a - b);
        uniqueMidiNotes.forEach(midi => {
            midiToLane.set(midi, laneIndex++);
        });

        // Calculate total width for centering
        const totalWidth = laneCount * laneWidth;
        const offsetX = (this.canvasWidth - totalWidth) / 2;

        this.notes.forEach(note => {
            const lane = midiToLane.get(note.midi);
            note.x = offsetX + lane * laneWidth;
            note.width = laneWidth - 4; // Leave some gap
        });
    }

    enableControls() {
        document.getElementById('play-btn').disabled = false;
        document.getElementById('reset-btn').disabled = false;
        document.getElementById('preview-btn').disabled = false;
    }

    updateStatus(text) {
        document.getElementById('status-text').textContent = text;
    }

    /**
     * Preview note pitch
     */
    previewNotes() {
        if (!this.midiData || this.notes.length === 0) return;
        
        // Create audio context
        if (!this.synthContext) {
            this.synthContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Ensure AudioContext is running (needed for some browsers)
        if (this.synthContext.state === 'suspended') {
            this.synthContext.resume();
        }
        
        const previewBtn = document.getElementById('preview-btn');
        previewBtn.disabled = true;
        previewBtn.textContent = '🎵 Playing...';
        
        // Get the first note of the MIDI
        const firstNote = this.notes[0];
        
        this.updateStatus(`Playing pitch for the first note: ${firstNote.name}...`);
        
        // Play the single note
        const noteDuration = 1.0; // Play for 1 second to be clear
        
        this.playTone(firstNote.midi, noteDuration);
        this.updateNextNoteDisplayForPreview(firstNote);
        
        // Reset button after playback
        setTimeout(() => {
            previewBtn.disabled = false;
            previewBtn.textContent = '🎵 Preview Pitch';
            this.updateStatus('Pitch preview completed, ready to start!');
            // document.getElementById('next-note-name').textContent = '--';
        }, noteDuration * 1000 + 100); // Add small buffer to ensure it executes after sound
    }
    
    /**
     * Play a single tone
     */
    playTone(midi, duration) {
        if (!this.synthContext) return;
        
        const frequency = 440 * Math.pow(2, (midi - 69) / 12);
        
        const oscillator = this.synthContext.createOscillator();
        const gainNode = this.synthContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.synthContext.destination);
        
        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';
        
        // Volume envelope
        gainNode.gain.setValueAtTime(0, this.synthContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, this.synthContext.currentTime + 0.05);
        gainNode.gain.linearRampToValueAtTime(0.3, this.synthContext.currentTime + duration - 0.05);
        gainNode.gain.linearRampToValueAtTime(0, this.synthContext.currentTime + duration);
        
        oscillator.start(this.synthContext.currentTime);
        oscillator.stop(this.synthContext.currentTime + duration);
    }
    


    /**
     * Update note display during preview
     */
    updateNextNoteDisplayForPreview(note) {
        const nextNoteElement = document.getElementById('next-note-name');
        if (!nextNoteElement) return;
        nextNoteElement.textContent = note.name;
        nextNoteElement.style.color = '#9C27B0';
        nextNoteElement.style.textShadow = '0 0 30px #9C27B0';
    }

    play() {
        if (!this.midiData) return;

        if (this.isPaused) {
            // Resume from pause
            this.startTime = this.audioContext.currentTime - this.pauseTime;
            this.isPaused = false;
        } else {
            // New game - set startTime so first note starts from top
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Calculate first note time and time to reach judgment line
            const firstNoteTime = this.notes.length > 0 ? this.notes[0].startTime : 0;
            const timeToTop = this.judgmentLineY / this.noteSpeed; // Time from top to judgment line (sec)
            
            // Set startTime to let first note start from top
            this.startTime = this.audioContext.currentTime - firstNoteTime + timeToTop;
            
            this.resetStats();
        }

        this.isPlaying = true;
        this.isPaused = false;

        document.getElementById('play-btn').disabled = true;
        document.getElementById('pause-btn').disabled = false;

        this.updateStatus('Game in progress...');
        this.gameLoop();
    }

    pause() {
        if (!this.isPlaying) return;

        this.isPaused = true;
        this.pauseTime = this.audioContext.currentTime - this.startTime;
        
        document.getElementById('play-btn').disabled = false;
        document.getElementById('pause-btn').disabled = true;
        
        this.updateStatus('Game paused');
    }

    reset() {
        this.isPlaying = false;
        this.isPaused = false;
        this.pauseTime = 0;
        
        // Reset cooldown
        this.currentCooldown = 200;

        this.resetStats();
        this.resetNotes();
        
        // Reset preview button
        const previewBtn = document.getElementById('preview-btn');
        previewBtn.disabled = !this.midiData;
        previewBtn.textContent = '🎵 Preview Pitch';

        document.getElementById('play-btn').disabled = !this.midiData;
        document.getElementById('pause-btn').disabled = true;

        this.updateStatus(this.midiData ? 'Reset, click Start Game' : 'Please upload a MIDI file to start');
        this.render();
    }

    stopPitchDetection() {
        if (this.pitchDetectionTimer) {
            cancelAnimationFrame(this.pitchDetectionTimer);
            this.pitchDetectionTimer = null;
        }
    }

    resetStats() {
        this.score = 0;
        this.combo = 0;
        this.hitNotes = 0;
        this.missedNotes = 0;
        this.updateStats();
    }

    resetNotes() {
        this.notes.forEach(note => {
            note.hit = false;
            note.missed = false;
        });
    }

    updateStats() {
        document.getElementById('score').textContent = this.score;
        document.getElementById('combo').textContent = this.combo;
        
        const total = this.hitNotes + this.missedNotes;
        const accuracy = total > 0 ? ((this.hitNotes / total) * 100).toFixed(1) : 100;
        document.getElementById('accuracy').textContent = `${accuracy}%`;
    }

    async toggleMicrophone() {
        console.log('Microphone button clicked');
        
        if (!this.pitchDetectionEnabled) {
            // Enable microphone
            const micBtn = document.getElementById('mic-btn');
            micBtn.disabled = true;
            micBtn.textContent = '🎤 Connecting...';
            
            console.log('Initializing microphone...');
            
            try {
                const success = await this.pitchDetector.init();
                
                if (success) {
                    console.log('Microphone initialized successfully');
                    this.pitchDetectionEnabled = true;
                    micBtn.textContent = '✓ Mic Connected';
                    micBtn.style.background = '#4CAF50';
                    this.updateStatus('Microphone connected, ready to start!');

                    // Start pitch detection loop
                    this.startPitchDetection();
                } else {
                    console.log('Microphone initialization failed');
                    micBtn.textContent = '🎤 Connection Failed';
                    micBtn.disabled = false;
                    this.updateStatus('Microphone connection failed, please check permission settings');
                }
            } catch (error) {
                console.error('Microphone connection error:', error);
                micBtn.textContent = '🎤 Connection Failed';
                micBtn.disabled = false;
                this.updateStatus(`Microphone connection failed: ${error.message}`);
            }
        }
    }

    startPitchDetection() {
        const detect = () => {
            if (!this.pitchDetectionEnabled) return;
            
            const pitch = this.pitchDetector.detectPitch();
            const pitchElement = document.getElementById('current-pitch');
            
            if (pitch) {
                pitchElement.textContent = pitch.noteName;
                pitchElement.classList.add('detected');
                
                // If game is playing, check for hit
                if (this.isPlaying && !this.isPaused) {
                    this.checkPitchHit(pitch);
                }
                
                setTimeout(() => pitchElement.classList.remove('detected'), 300);
            } else {
                pitchElement.textContent = '--';
            }
            
            this.pitchDetectionTimer = requestAnimationFrame(detect);
        };
        
        detect();
    }

    checkPitchHit(pitch) {
        const currentTime = this.audioContext.currentTime - this.startTime;
        const adjustedTime = currentTime * this.speed;
        const currentTimeMs = Date.now();

        // Find best matching note with min time diff
        let bestNote = null;
        let bestTimeDiff = Infinity;

        this.notes.forEach(note => {
            if (note.hit || note.missed) return;
            
            // Prevent duplicate hits
            if (this.recentlyHitNotes.has(note)) return;

            // Check pitch match (allow different octaves, check note name only)
            const pitchClassMatch = (pitch.midi % 12) === (note.midi % 12);
            
            if (!pitchClassMatch) return;

            // Calculate time diff (ms), apply dynamic window offset
            let timeDiff = Math.abs(note.startTime - adjustedTime) * 1000;
            
            // Apply judgment window offset (consecutive notes)
            timeDiff -= note.hitWindowOffset * 1000;
            
            // For consecutive same notes, use looser judgment window
            let effectiveHitWindow = this.hitWindow.miss;
            if (note.hitWindowOffset !== 0) {
                // Consecutive notes use larger judgment window
                effectiveHitWindow = this.hitWindow.miss * 1.5;
            }
            
            // Find note with min time diff
            if (timeDiff < bestTimeDiff && timeDiff < effectiveHitWindow) {
                bestTimeDiff = timeDiff;
                bestNote = note;
            }
        });

        // Hit best matching note
        if (bestNote) {
            // Consecutive same notes skip cooldown check
            const skipCooldown = bestNote.hitWindowOffset !== 0;
            
            if (!skipCooldown && currentTimeMs - this.lastHitTime < this.currentCooldown) {
                return;
            }
            
            this.lastHitTime = currentTimeMs;
            
            // Mark as recently hit, prevent duplicate detection
            this.recentlyHitNotes.add(bestNote);
            
            // Remove mark after 500ms
            setTimeout(() => {
                this.recentlyHitNotes.delete(bestNote);
            }, 500);
            
            this.judgeNote(bestNote, bestTimeDiff);
            
            console.log(`Hit: ${bestNote.name}, Detected Pitch: ${pitch.noteName}, timeDiff: ${bestTimeDiff.toFixed(0)}ms, Consecutive: ${skipCooldown}`);
        }
    }

    showKeyFeedback(key) {
        // Highlight pressed lane
        const keyToMidiOffset = this.getKeyToMidiOffset();
        if (!keyToMidiOffset.hasOwnProperty(key)) return;
        
        const midiOffset = keyToMidiOffset[key];
        const targetMidi = this.minMidi + midiOffset;
        
        // Find corresponding lane
        const laneIndex = [...new Set(this.notes.map(n => n.midi))].indexOf(targetMidi);
        if (laneIndex === -1) return;
        
        const flashX = (this.canvasWidth - this.laneCount * this.laneWidth) / 2 + laneIndex * this.laneWidth;
        
        // Create flash effect
        const flashEl = document.createElement('div');
        flashEl.style.position = 'absolute';
        flashEl.style.left = flashX + 'px';
        flashEl.style.top = '0';
        flashEl.style.width = (this.laneWidth - 2) + 'px';
        flashEl.style.height = '100%';
        flashEl.style.background = 'rgba(255, 255, 255, 0.3)';
        flashEl.style.pointerEvents = 'none';
        flashEl.style.transition = 'opacity 0.1s ease-out';
        
        document.querySelector('.game-area').appendChild(flashEl);
        
        setTimeout(() => {
            flashEl.style.opacity = '0';
            setTimeout(() => flashEl.remove(), 100);
        }, 50);
    }

    judgeNote(note, timeDiff) {
        let judgment = '';
        let scoreAdd = 0;

        // Adjust judgment standards based on note type
        let perfectWindow = this.hitWindow.perfect;
        let goodWindow = this.hitWindow.good;
        
        // Consecutive notes use stricter judgment
        if (note.hitWindowOffset !== 0) {
            perfectWindow = this.hitWindow.perfect * 0.8;
            goodWindow = this.hitWindow.good * 0.8;
        }

        if (timeDiff < perfectWindow) {
            judgment = 'perfect';
            scoreAdd = 100;
            this.combo++;
        } else if (timeDiff < goodWindow) {
            judgment = 'good';
            scoreAdd = 50;
            this.combo++;
        } else if (timeDiff < this.hitWindow.miss) {
            judgment = 'miss';
            scoreAdd = 0;
            this.combo = 0;
        }

        if (judgment) {
            note.hit = true;
            this.hitNotes++;
            this.score += scoreAdd + (this.combo > 10 ? this.combo : 0);
            this.updateStats();
            this.showJudgment(judgment);
            
            // Reserved fingering display interface
            this.showFingering(note);
            
            console.log(`Hit: ${note.name}, timeDiff: ${timeDiff.toFixed(0)}ms, Judgment: ${judgment}`);
        }
    }

    showJudgment(judgment) {
        // Create judgment effect
        const judgmentEl = document.createElement('div');
        judgmentEl.className = 'hit-effect';
        judgmentEl.textContent = judgment.toUpperCase();
        judgmentEl.style.position = 'absolute';
        judgmentEl.style.bottom = '100px';
        judgmentEl.style.left = '50%';
        judgmentEl.style.transform = 'translateX(-50%)';
        judgmentEl.style.fontSize = '2rem';
        judgmentEl.style.fontWeight = 'bold';
        judgmentEl.style.color = this.getJudgmentColor(judgment);
        judgmentEl.style.textShadow = '2px 2px 4px rgba(0,0,0,0.5)';
        judgmentEl.style.pointerEvents = 'none';
        
        document.querySelector('.game-area').appendChild(judgmentEl);
        
        setTimeout(() => judgmentEl.remove(), 300);
    }

    getJudgmentColor(judgment) {
        switch(judgment) {
            case 'perfect': return '#ffd700';
            case 'good': return '#4CAF50';
            case 'miss': return '#ff6b6b';
            default: return '#fff';
        }
    }

    showFingering(note) {
        // Reserved fingering display interface
        // When user uploads fingering data, corresponding fingering will be displayed here
        const fingeringDisplay = document.getElementById('fingering-display');
        
        if (this.fingeringData[note.name]) {
            fingeringDisplay.innerHTML = `
                <h3>Current Note: ${note.name}</h3>
                <div class="fingering-chart">${this.fingeringData[note.name]}</div>
            `;
        } else {
            fingeringDisplay.innerHTML = `
                <p class="placeholder">Fingering Display (Coming Soon)</p>
                <p>Note: ${note.name} (MIDI: ${note.midi})</p>
            `;
        }
    }

    /**
     * Set fingering data
     * @param {Object} data - Fingering data, format: { "C4": "Fingering Info", "D4": "Fingering Info", ... }
     */
    setFingeringData(data) {
        this.fingeringData = data;
    }

    gameLoop() {
        if (!this.isPlaying || this.isPaused) return;

        const currentTime = this.audioContext.currentTime - this.startTime;
        const adjustedTime = currentTime * this.speed;

        // Update next note hint
        this.updateNextNoteDisplay(adjustedTime);

        // Check missed notes - shrink miss judgment window
        this.notes.forEach(note => {
            if (!note.hit && !note.missed && adjustedTime > note.startTime + 0.3) {
                note.missed = true;
                this.missedNotes++;
                this.combo = 0;
                this.updateStats();
            }
        });

        this.render(adjustedTime);

        // Check if game ended
        const lastNoteTime = Math.max(...this.notes.map(n => n.endTime));
        if (adjustedTime > lastNoteTime + 1) {
            this.endGame();
            return;
        }

        requestAnimationFrame(() => this.gameLoop());
    }

    /**
     * Update next note display
     */
    updateNextNoteDisplay(currentTime) {
        const nextNoteElement = document.getElementById('next-note-name');
        if (!nextNoteElement) return;
        
        // Find next unhit note
        const nextNote = this.notes.find(note => {
            return !note.hit && !note.missed && note.startTime > currentTime - 0.5;
        });

        if (nextNote) {
            nextNoteElement.textContent = nextNote.name;
            // Change color based on proximity
            const timeUntilHit = nextNote.startTime - currentTime;
            if (timeUntilHit < 0.3) {
                nextNoteElement.style.color = '#ff6b6b'; // Approaching, red warning
                nextNoteElement.style.textShadow = '0 0 30px #ff6b6b';
            } else {
                nextNoteElement.style.color = '#ffd700';
                nextNoteElement.style.textShadow = '0 0 20px #ffd700';
            }
        } else {
            nextNoteElement.textContent = '--';
        }
    }

    render(currentTime = 0) {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

        // Draw background lanes
        this.drawLanes();

        // Draw judgment line
        this.drawJudgmentLine();

        // Draw notes
        this.drawNotes(currentTime);

        // If no game, show hint
        if (!this.midiData) {
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            this.ctx.font = '20px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('Please upload a MIDI file to start', this.canvasWidth / 2, this.canvasHeight / 2);
        }
    }

    drawLanes() {
        if (!this.laneCount || !this.laneWidth) return;
        
        const totalWidth = this.laneCount * this.laneWidth;
        const offsetX = (this.canvasWidth - totalWidth) / 2;

        for (let i = 0; i < this.laneCount; i++) {
            const x = offsetX + i * this.laneWidth;
            this.ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.1)';
            this.ctx.fillRect(x, 0, this.laneWidth - 2, this.canvasHeight);
            
            // Draw lane borders
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x, 0, this.laneWidth - 2, this.canvasHeight);
        }
    }

    drawJudgmentLine() {
        this.ctx.strokeStyle = '#ff6b6b';
        this.ctx.lineWidth = 3;
        this.ctx.shadowColor = '#ff6b6b';
        this.ctx.shadowBlur = 10;
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.judgmentLineY);
        this.ctx.lineTo(this.canvasWidth, this.judgmentLineY);
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
    }

    drawNotes(currentTime) {
        const visibleWindow = 5; // Visible time window (sec)

        this.notes.forEach(note => {
            if (note.hit || note.missed) return;

            // Calculate note Y position
            // Make note bottom (front) touch judgment line at startTime
            const timeUntilHit = note.startTime - currentTime;
            const y = this.judgmentLineY - (timeUntilHit * this.noteSpeed) - (note.duration * this.noteSpeed);
            const height = note.duration * this.noteSpeed;

            // Draw only within visible range
            if (y + height < -50 || y > this.canvasHeight + 50) return;
            if (currentTime > note.endTime + visibleWindow || currentTime < note.startTime - visibleWindow) return;

            // Draw note
            this.ctx.fillStyle = this.getNoteColor(note);
            this.ctx.shadowColor = this.getNoteColor(note);
            this.ctx.shadowBlur = 15;

            // Round rect
            this.roundRect(
                note.x,
                y,
                note.width,
                Math.max(height, 20),
                5
            );

            this.ctx.fill();
            this.ctx.shadowBlur = 0;

            // Draw note border
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Draw note name - Large font, black, almost full width
            this.ctx.fillStyle = '#000';
            this.ctx.font = 'bold 32px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            // Calculate suitable font size to fill the width
            const textWidth = note.width - 10; // 5px padding
            const fontSize = Math.min(24, textWidth);
            this.ctx.font = `bold ${fontSize}px Arial`;
            
            this.ctx.fillText(
                note.name,
                note.x + note.width / 2,
                y + Math.max(height, 20) / 2
            );
        });
    }

    getNoteColor(note) {
        // Return different colors based on pitch
        const octave = Math.floor(note.midi / 12) - 1;
        const colors = [
            '#FF6B6B', // C
            '#FFA500', // C#
            '#FFD700', // D
            '#90EE90', // D#
            '#00CED1', // E
            '#4169E1', // F
            '#9370DB', // F#
            '#FF69B4', // G
            '#FFA500', // G#
            '#FFD700', // A
            '#90EE90', // A#
            '#00CED1'  // B
        ];
        return colors[note.midi % 12];
    }

    roundRect(x, y, width, height, radius) {
        this.ctx.beginPath();
        this.ctx.moveTo(x + radius, y);
        this.ctx.lineTo(x + width - radius, y);
        this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        this.ctx.lineTo(x + width, y + height - radius);
        this.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        this.ctx.lineTo(x + radius, y + height);
        this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        this.ctx.lineTo(x, y + radius);
        this.ctx.quadraticCurveTo(x, y, x + radius, y);
        this.ctx.closePath();
    }

    endGame() {
        this.isPlaying = false;
        this.isPaused = false;
        if (this.pitchDetectionEnabled && !this.pitchDetectionTimer) {
            this.startPitchDetection();
        }
        
        document.getElementById('play-btn').disabled = false;
        document.getElementById('pause-btn').disabled = true;
        
        const accuracy = this.totalNotes > 0 
            ? ((this.hitNotes / this.totalNotes) * 100).toFixed(1) 
            : 0;
        
        this.updateStatus(`Game Over! Score: ${this.score} | Accuracy: ${accuracy}% | Max Combo: ${this.combo}`);
        
        // Show game over screen
        this.showEndScreen();
    }

    showEndScreen() {
        const accuracy = this.totalNotes > 0 
            ? ((this.hitNotes / this.totalNotes) * 100).toFixed(1) 
            : 0;
        
        alert(`🎵 Game Over!\n\nScore: ${this.score}\nAccuracy: ${accuracy}%\nCombo: ${this.combo}\n\nChallenge yourself for a higher score!`);
    }
}

// Initialize game
let game;
document.addEventListener('DOMContentLoaded', () => {
    game = new InstrumentTilesGame();
});
