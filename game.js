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
        this.noteSpeed = 200; // Note falling speed (pixels/sec) - drastically reduced for much slower dropping
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
        
        // Sustained hit tracking
        this.currentlyHeldNote = null; // Note currently being held
        this.holdStartTime = 0; // When player started holding the note
        this.holdDuration = 0; // How long player has held the note

        // Tile duration ratio (1.0 = original, 0.5 = half length, 2.0 = double length)
        this.tileDurationRatio = 1.0;

        this.metronomeEnabled = true;
        this.beatsPerBar = 2; // Default count-in beats, can be changed via UI
        this.metronomeBeatUnit = 1;
        this.metronomeNextBeat = 0;
        this.metronomeGridStart = 0;
        this.metronomeRunning = false;
        this.metronomeGain = 0.2;
        this.metronomeClickDuration = 0.06;
        this.countInTimer = null;
        
        // Transposing instrument support
        this.transpositionInterval = 0; // Semitones: 0 = C instrument, -2 = B♭, -9 = E♭, etc.
        this.instrumentName = 'C Instrument';
        
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
        this.loadDefaultMidi();
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

        // Tile duration ratio control
        document.getElementById('duration-control').addEventListener('input', (e) => {
            this.tileDurationRatio = parseFloat(e.target.value);
            document.getElementById('duration-value').textContent = this.tileDurationRatio.toFixed(1);
            // Recalculate note positions with new duration ratio
            if (this.midiData) {
                this.parseMidiData();
                this.render();
            }
        });

        const metronomeToggle = document.getElementById('metronome-toggle');
        if (metronomeToggle) {
            metronomeToggle.addEventListener('change', (e) => {
                this.metronomeEnabled = e.target.checked;
            });
        }

        // Instrument selector (transposing instruments)
        const instrumentSelect = document.getElementById('instrument-select');
        if (instrumentSelect) {
            instrumentSelect.addEventListener('change', (e) => {
                this.transpositionInterval = parseInt(e.target.value);
                this.instrumentName = e.target.options[e.target.selectedIndex].text;
                console.log(`Instrument changed: ${this.instrumentName}, transposition: ${this.transpositionInterval} semitones`);
                this.updateStatus(`Using ${this.instrumentName} - Written pitch displayed, sounding pitch detected`);
            });
        }

        // Count-in beats control
        const countInBeatsInput = document.getElementById('count-in-beats');
        if (countInBeatsInput) {
            // Initialize beatsPerBar from input value (default 2)
            const initialValue = parseInt(countInBeatsInput.value);
            if (initialValue >= 1 && initialValue <= 8) {
                this.beatsPerBar = initialValue;
            }
            countInBeatsInput.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                if (value >= 1 && value <= 8) {
                    this.beatsPerBar = value;
                    console.log(`Count-in beats changed to: ${this.beatsPerBar}`);
                }
            });
        }

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

    async loadDefaultMidi() {
        this.updateStatus('Loading default MIDI file...');

        try {
            const response = await fetch('BananaBoat.mid');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            console.log('Default MIDI loaded:', arrayBuffer.byteLength, 'bytes');

            this.midiData = new SimpleMidiParser(arrayBuffer);
            console.log('Default MIDI parsed successfully:', this.midiData);

            this.parseMidiData();
            this.updateStatus(`Default song loaded! Total ${this.totalNotes} notes, ${this.uniqueNotes} unique pitches`);
            this.enableControls();
            this.render();
        } catch (error) {
            console.error('Default MIDI load failed:', error);
            this.updateStatus('Please upload a MIDI file to start the game');
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
                    // Apply duration ratio to tile length
                    const scaledDuration = note.duration * this.tileDurationRatio;
                    // Limit max display length
                    const displayDuration = Math.min(scaledDuration, 0.9 * this.tileDurationRatio);
                    
                    const noteObj = {
                        midi: note.midi,
                        name: note.name,
                        startTime: note.startTime,
                        endTime: note.startTime + displayDuration, // Use scaled duration
                        duration: displayDuration,
                        velocity: note.velocity,
                        track: trackIndex,
                        hit: false,
                        missed: false,
                        accumulatedHoldTime: 0, // NEW: Track total time correctly sustained
                        isBeingHeld: false,    // NEW: Currently being sustained
                        x: 0,
                        y: 0,
                        width: 0,
                        height: 0,
                        originalDuration: note.duration, // Save original duration
                        hitWindowOffset: 0, // Judgment window offset
                        sustainRequired: true // Require sustained hit for perfect
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
        
        // For transposing instruments, play the sounding pitch (what the player would hear)
        // For B♭ instruments: written C sounds as B♭ (2 semitones lower)
        // For F and E♭ instruments, add an octave to avoid too low pitch
        let octaveAdjustment = 0;
        if (this.transpositionInterval <= -7) {
            // F Horn (-7) and E♭ Sax (-9): add octave for better range
            octaveAdjustment = 12;
        }
        const soundingMidi = firstNote.midi + this.transpositionInterval + octaveAdjustment;
        const soundingNoteName = this.midiToNoteName(soundingMidi);
        
        const displayInfo = this.transpositionInterval !== 0 
            ? `${firstNote.name} (sounding: ${soundingNoteName})`
            : firstNote.name;
        
        this.updateStatus(`Playing pitch for the first note: ${displayInfo}...`);
        
        // Play the sounding pitch (transposed)
        const noteDuration = 1.0; // Play for 1 second to be clear
        
        this.playTone(soundingMidi, noteDuration);
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
    

    updateNextNoteDisplayForPreview(note) {
        const nextNoteElement = document.getElementById('next-note-name');
        if (!nextNoteElement) return;
        nextNoteElement.textContent = note.name;
        nextNoteElement.style.color = '#9C27B0';
        nextNoteElement.style.textShadow = '0 0 30px #9C27B0';
    }

    async play() {
        if (!this.midiData) return;

        if (this.isPaused) {
            // Resume from pause
            this.startTime = this.audioContext.currentTime - this.pauseTime;
            this.isPaused = false;
            this.metronomeRunning = this.metronomeEnabled;
            if (this.metronomeRunning) {
                const currentAdjustedTime = (this.audioContext.currentTime - this.startTime) * this.speed;
                this.metronomeNextBeat = Math.ceil(currentAdjustedTime / this.metronomeBeatUnit) * this.metronomeBeatUnit;
            }
            document.getElementById('play-btn').disabled = true;
            document.getElementById('pause-btn').disabled = false;
            this.updateStatus('Game in progress...');
            this.gameLoop();
        } else {
            // New game - set startTime so first note starts from top
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            // Calculate first note time and time to reach judgment line
            const firstNoteTime = this.notes.length > 0 ? this.notes[0].startTime : 0;
            const timeToTop = this.judgmentLineY / this.noteSpeed; // Time from top to judgment line (sec)
            const initialAdjustedTime = firstNoteTime - timeToTop;
            
            // Set startTime to let first note start from top
            this.resetStats();
            this.resetNotes();

            const countInDuration = this.beatsPerBar * (this.metronomeBeatUnit / this.speed);
            const gameStartAudioTime = this.audioContext.currentTime + countInDuration;
            this.startTime = gameStartAudioTime - (initialAdjustedTime / this.speed);
            this.initializeMetronomeClock(initialAdjustedTime);
            this.playCountIn(gameStartAudioTime, countInDuration);
            this.updateStatus('Count-in...');

            document.getElementById('play-btn').disabled = true;
            document.getElementById('pause-btn').disabled = true;

            if (this.countInTimer) {
                clearTimeout(this.countInTimer);
            }

            this.countInTimer = setTimeout(() => {
                this.isPlaying = true;
                this.isPaused = false;
                this.metronomeRunning = this.metronomeEnabled;
                document.getElementById('play-btn').disabled = true;
                document.getElementById('pause-btn').disabled = false;
                this.updateStatus('Game in progress...');
                this.gameLoop();
            }, countInDuration * 1000);
        }
    }

    pause() {
        if (!this.isPlaying) return;

        this.isPaused = true;
        this.pauseTime = this.audioContext.currentTime - this.startTime;
        this.metronomeRunning = false;
        
        document.getElementById('play-btn').disabled = false;
        document.getElementById('pause-btn').disabled = true;
        
        this.updateStatus('Game paused');
    }

    reset() {
        this.isPlaying = false;
        this.isPaused = false;
        this.pauseTime = 0;
        this.metronomeRunning = false;
        if (this.countInTimer) {
            clearTimeout(this.countInTimer);
            this.countInTimer = null;
        }
        
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
            note.accumulatedHoldTime = 0;
            note.isBeingHeld = false;
            note.lastHoldUpdate = null;
        });
        this.currentlyHeldNote = null;
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
                    micBtn.disabled = false;
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
        } else {
            const micBtn = document.getElementById('mic-btn');
            this.pitchDetectionEnabled = false;
            this.stopPitchDetection();
            this.pitchDetector.stop();
            micBtn.textContent = '🎤 Connect Mic';
            micBtn.style.background = '';
            micBtn.disabled = false;
            this.updateStatus('Microphone disconnected');
        }
    }

    initializeMetronomeClock(initialAdjustedTime) {
        this.metronomeGridStart = initialAdjustedTime;
        this.metronomeNextBeat = initialAdjustedTime;
    }

    playCountIn(gameStartAudioTime, countInDuration) {
        const beatDuration = this.metronomeBeatUnit / this.speed;
        const startTime = gameStartAudioTime - countInDuration;
        for (let i = 0; i < this.beatsPerBar; i++) {
            this.playMetronomeClick(startTime + i * beatDuration, i === 0);
        }
    }

    playMetronomeClick(time, accent) {
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'square';

        gainNode.gain.setValueAtTime(0, time);
        gainNode.gain.linearRampToValueAtTime(this.metronomeGain, time + 0.001);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, time + this.metronomeClickDuration);

        oscillator.start(time);
        oscillator.stop(time + this.metronomeClickDuration + 0.02);
    }

    startPitchDetection() {
        const detect = () => {
            if (!this.pitchDetectionEnabled) return;
            
            const pitch = this.pitchDetector.detectPitch();
            const pitchElement = document.getElementById('current-pitch');
            
            if (pitch) {
                // Show transposed (written) pitch for transposing instruments
                const transposedMidi = pitch.midi - this.transpositionInterval;
                const transposedNoteName = this.midiToNoteName(transposedMidi);
                
                if (this.transpositionInterval !== 0) {
                    // Show both written and sounding pitch
                    pitchElement.textContent = `${transposedNoteName} (${pitch.noteName})`;
                } else {
                    pitchElement.textContent = pitch.noteName;
                }
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

        // Transpose detected pitch to written pitch for comparison
        const transposedMidi = pitch.midi - this.transpositionInterval;
        const transposedNoteName = this.midiToNoteName(transposedMidi);

        // Find best matching note with min time diff
        let bestNote = null;
        let bestTimeDiff = Infinity;

        // Threshold for starting a hold (looser window)
        const holdStartThreshold = this.hitWindow.miss;

        this.notes.forEach(note => {
            if (note.hit || note.missed) return;
            
            // Allow same note to be hit again after small gap
            if (this.recentlyHitNotes.has(note)) return;

            // Pitch class match (ignore octave)
            const pitchClassMatch = (transposedMidi % 12) === (note.midi % 12);
            if (!pitchClassMatch) return;

            // Note is "active" if current time is within its window
            // window: [startTime - threshold, endTime]
            const timeUntilStart = note.startTime - adjustedTime;
            const timeUntilEnd = note.endTime - adjustedTime;
            
            // Check if we are in the hit window or already within the tile duration
            if (timeUntilStart < holdStartThreshold / 1000 && timeUntilEnd > -0.1) {
                const timeDiff = Math.abs(timeUntilStart) * 1000;
                if (timeDiff < bestTimeDiff) {
                    bestTimeDiff = timeDiff;
                    bestNote = note;
                }
            }
        });

        // Manage hold state
        if (bestNote) {
            // Update accumulated hold time
            if (!bestNote.lastHoldUpdate) {
                bestNote.lastHoldUpdate = currentTimeMs;
                console.log(`[PITCH] Started sustaining: ${bestNote.name}`);
            } else {
                const delta = (currentTimeMs - bestNote.lastHoldUpdate) / 1000;
                bestNote.accumulatedHoldTime += delta;
                bestNote.lastHoldUpdate = currentTimeMs;
                
                // Optional: visual indicator for sustaining
                bestNote.isBeingHeld = true;
            }
            
            this.currentlyHeldNote = bestNote;
        } else {
            // If we were holding a note, mark it as no longer being held
            if (this.currentlyHeldNote) {
                this.currentlyHeldNote.isBeingHeld = false;
                this.currentlyHeldNote.lastHoldUpdate = null;
                this.currentlyHeldNote = null;
            }
        }
    }

    /**
     * Convert MIDI note number to note name
     * @param {number} midi - MIDI note number
     * @returns {string} Note name (e.g., "C4", "B♭3")
     */
    midiToNoteName(midi) {
        const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        const octave = Math.floor(midi / 12) - 1;
        const noteName = noteNames[midi % 12];
        return `${noteName}${octave}`;
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

    judgeNote(note) {
        let judgment = '';
        let scoreAdd = 0;

        // Sustain-based judgment
        const sustainPercentage = note.accumulatedHoldTime / note.duration;
        
        if (sustainPercentage >= 0.85) {
            judgment = 'perfect';
            scoreAdd = 150;
            this.combo++;
        } else if (sustainPercentage >= 0.5) {
            judgment = 'good';
            scoreAdd = 75;
            this.combo++;
        } else if (sustainPercentage > 0) {
            judgment = 'miss';
            scoreAdd = 0;
            this.combo = 0;
        } else {
            // Truly missed (0 sustain)
            judgment = 'miss';
            scoreAdd = 0;
            this.combo = 0;
        }

        if (judgment) {
            note.hit = (judgment !== 'miss');
            if (note.hit) {
                this.hitNotes++;
            } else {
                this.missedNotes++;
            }
            
            this.score += scoreAdd + (this.combo > 10 ? Math.floor(this.combo / 2) : 0);
            this.updateStats();
            this.showJudgment(judgment, sustainPercentage >= 0.85);
            
            console.log(`Judged: ${note.name}, Sustain: ${(sustainPercentage * 100).toFixed(1)}%, Judgment: ${judgment}`);
        }
    }

    showJudgment(judgment, isSustained = false) {
        // Create judgment effect
        const judgmentEl = document.createElement('div');
        judgmentEl.className = 'hit-effect';
        judgmentEl.textContent = isSustained ? 'PERFECT HOLD! 🎯' : judgment.toUpperCase();
        judgmentEl.style.position = 'absolute';
        judgmentEl.style.bottom = '100px';
        judgmentEl.style.left = '50%';
        judgmentEl.style.transform = 'translateX(-50%)';
        judgmentEl.style.fontSize = isSustained ? '2.5rem' : '2rem';
        judgmentEl.style.fontWeight = 'bold';
        judgmentEl.style.color = this.getJudgmentColor(judgment);
        judgmentEl.style.textShadow = '2px 2px 4px rgba(0,0,0,0.5)';
        judgmentEl.style.pointerEvents = 'none';
        
        if (isSustained) {
            judgmentEl.style.animation = 'sustainedHit 0.5s ease-out forwards';
        }
        
        document.querySelector('.game-area').appendChild(judgmentEl);
        
        setTimeout(() => judgmentEl.remove(), 500);
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

        if (this.metronomeRunning) {
            this.scheduleMetronomeClicks();
        }

        // Finalize judgment for notes that have fully passed the line
        this.notes.forEach(note => {
            if (!note.hit && !note.missed && adjustedTime > note.endTime + 0.1) {
                // If the player was holding it, stop it
                if (this.currentlyHeldNote === note) {
                    this.currentlyHeldNote = null;
                }
                
                // Finalize judgment based on accumulated sustain
                this.judgeNote(note);
                
                // If it wasn't a hit (still marked missed in judgeNote), ensure missed flag
                if (!note.hit) {
                    note.missed = true;
                }
                
                console.log(`Note finalized: ${note.name}, Sustain: ${(note.accumulatedHoldTime / note.duration * 100).toFixed(1)}%`);
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

    scheduleMetronomeClicks() {
        if (!this.audioContext) return;
        const lookaheadSeconds = 0.1;
        const currentAdjustedTime = (this.audioContext.currentTime - this.startTime) * this.speed;
        const scheduleUntilAdjusted = currentAdjustedTime + lookaheadSeconds * this.speed;

        while (this.metronomeNextBeat <= scheduleUntilAdjusted) {
            const beatCount = Math.round((this.metronomeNextBeat - this.metronomeGridStart) / this.metronomeBeatUnit);
            const accent = beatCount % this.beatsPerBar === 0;
            const audioTime = this.startTime + (this.metronomeNextBeat / this.speed);
            this.playMetronomeClick(audioTime, accent);
            this.metronomeNextBeat += this.metronomeBeatUnit;
        }
    }

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
            if (note.hit) return; // Only hide hit notes, let missed notes fall off screen

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
            this.ctx.shadowColor = note.isBeingHeld ? '#fff' : this.getNoteColor(note);
            this.ctx.shadowBlur = note.isBeingHeld ? 30 : 15;

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

            // NEW: Draw sustain fill progress
            if (note.accumulatedHoldTime > 0) {
                const fillPercentage = Math.min(note.accumulatedHoldTime / note.duration, 1.0);
                const fillHeight = Math.max(height, 20) * fillPercentage;
                
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                this.roundRect(
                    note.x,
                    y + Math.max(height, 20) - fillHeight,
                    note.width,
                    fillHeight,
                    5
                );
                this.ctx.fill();
            }

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
        this.metronomeRunning = false;
        
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
