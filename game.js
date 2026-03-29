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
        this.speed = 2.0; // Default to 120 BPM (2 beats per second)
        
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
        this.noteSpeed = 150; // Note falling speed (pixels/sec) - drastically reduced for much slower dropping
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
        this.tileDurationRatio = 0.8;

        this.metronomeEnabled = true;
        this.beatsPerBar = 2; // Default count-in beats, can be changed via UI
        this.metronomeBeatUnit = 1;
        this.metronomeNextBeat = 0;
        this.metronomeGridStart = 0;
        this.metronomeRunning = false;
        this.metronomeGain = 0.2;
        this.metronomeClickDuration = 0.06;
        this.metronomeFlash = 0.0; // Visual metronome indicator opacity
        this.countInTimer = null;
        
        // Transposing instrument support
        this.transpositionInterval = 0; // Semitones: 0 = C instrument, -2 = B♭, -9 = E♭, etc.
        this.instrumentName = 'C Instrument';
        
        // Micro-tuning offset (cents, ±100 cents = ±1 semitone)
        this.tuningOffsetCents = 0;
        
        // Player name for leaderboard
        this.playerName = 'Player';
        
        // Fingering data (reserved interface)
        this.fingeringData = {};

        // Note difficulty tracking: pitchName -> { total, hits, misses, totalSustain, perfectCount }
        this.noteStats = {};

        // Practice mode state
        this.practiceMode = false;
        this.practiceNotes = [];
        this.practiceLoopCount = 0;
        this.practiceMaxLoops = 3;
        this.practiceOriginalNotes = null;
        this.practiceBpmRatio = 0.75; // Slow down to 75% for practice

        // Navigation state
        this.currentTime = 0;
        this.songLength = 0;

        // Initialize
        this.init();
    }

    init() {
        this.resizeCanvas();
        let resizeTimer;
        const debouncedResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this.resizeCanvas(), 100);
        };
        window.addEventListener('resize', debouncedResize);
        window.addEventListener('orientationchange', debouncedResize);
        this.setupEventListeners();
        this.render();
        this.loadDefaultMidi();
        this.displayLeaderboard(); // Load and display leaderboard
        
    }

    resizeCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.canvasWidth = rect.width;
        this.canvasHeight = rect.height;
        this.judgmentLineY = this.canvasHeight - 80;
        if (this.judgmentLineY < 100) this.judgmentLineY = Math.max(this.canvasHeight * 0.8, 50);
    }

    setupEventListeners() {
        // MIDI file upload
        document.getElementById('midi-upload').addEventListener('change', (e) => {
            this.handleMidiUpload(e);
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

        // Note speed control
        const noteSpeedControl = document.getElementById('note-speed-control');
        if (noteSpeedControl) {
            // Initialize noteSpeed from slider value
            this.noteSpeed = parseInt(noteSpeedControl.value);
            document.getElementById('note-speed-value').textContent = this.noteSpeed;
            
            noteSpeedControl.addEventListener('input', (e) => {
                this.noteSpeed = parseInt(e.target.value);
                document.getElementById('note-speed-value').textContent = this.noteSpeed;
                // Recalculate note positions with new note speed
                if (this.midiData) {
                    this.parseMidiData();
                    this.render();
                }
            });
        }

        // Tuning offset control
        const tuningOffsetControl = document.getElementById('tuning-offset');
        if (tuningOffsetControl) {
            // Initialize tuningOffsetCents from slider value
            this.tuningOffsetCents = parseInt(tuningOffsetControl.value);
            this.pitchDetector.tuningOffsetCents = this.tuningOffsetCents;
            document.getElementById('tuning-offset-value').textContent = this.tuningOffsetCents;
            
            tuningOffsetControl.addEventListener('input', (e) => {
                this.tuningOffsetCents = parseInt(e.target.value);
                this.pitchDetector.tuningOffsetCents = this.tuningOffsetCents;
                document.getElementById('tuning-offset-value').textContent = this.tuningOffsetCents;
                console.log(`Tuning offset changed to: ${this.tuningOffsetCents} cents`);
            });
        }

        const metronomeToggle = document.getElementById('metronome-toggle');
        if (metronomeToggle) {
            metronomeToggle.addEventListener('change', (e) => {
                this.metronomeEnabled = e.target.checked;
            });
        }

        // BPM Input Control
        const bpmInput = document.getElementById('bpm-input');
        if (bpmInput) {
            bpmInput.addEventListener('input', (e) => {
                const newBpm = parseFloat(e.target.value);
                if (newBpm && newBpm > 0) {
                    this.speed = newBpm / 60;
                    if (this.midiData) {
                        this.midiData.bpm = newBpm; // Update parser data too
                    }
                    console.log(`BPM updated to: ${newBpm} (Speed: ${this.speed.toFixed(2)})`);
                }
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

        // Player name control
        const playerNameInput = document.getElementById('player-name');
        if (playerNameInput) {
            // Initialize playerName from input value
            this.playerName = playerNameInput.value || 'Player';
            playerNameInput.addEventListener('input', (e) => {
                this.playerName = e.target.value.trim() || 'Player';
                console.log(`Player name changed to: ${this.playerName}`);
            });
        }

        // Microphone button
        document.getElementById('mic-btn').addEventListener('click', () => this.toggleMicrophone());

        // Mic sensitivity control
        const micSensitivityControl = document.getElementById('mic-sensitivity');
        if (micSensitivityControl) {
            micSensitivityControl.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                document.getElementById('mic-sensitivity-value').textContent = value;
                // Map 1-100 slider to RMS threshold: 1=noisiest (0.05), 100=most sensitive (0.001)
                this.pitchDetector.rmsThreshold = 0.05 - (value / 100) * 0.049;
                console.log(`Mic sensitivity: ${value}%, RMS threshold: ${this.pitchDetector.rmsThreshold.toFixed(4)}`);
            });
        }

        // MIDI Drawer Toggling
        const drawer = document.getElementById('midi-drawer');
        const drawerToggle = document.getElementById('drawer-toggle');
        if (drawerToggle) {
            drawerToggle.addEventListener('click', () => {
                drawer.classList.toggle('collapsed');
            });
        }

        // MIDI Drawer Item Clicking
        document.querySelectorAll('.midi-item').forEach(item => {
            item.addEventListener('click', () => {
                const path = item.getAttribute('data-path');
                this.loadMidiFromPath(path);
                
                // Set active state in UI
                document.querySelectorAll('.midi-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });

        // Set default active in drawer
        const defaultItem = document.querySelector('.midi-item[data-path="midi/BananaBoat_bpm60.mid"]');
        if (defaultItem) defaultItem.classList.add('active');
        
        // Preview button
        document.getElementById('preview-btn').addEventListener('click', () => this.previewNotes());

        // Game control buttons
        document.getElementById('play-btn').addEventListener('click', () => this.play());
        document.getElementById('pause-btn').addEventListener('click', () => this.pause());
        document.getElementById('reset-btn').addEventListener('click', () => this.reset());
        
        // Leaderboard clear button
        const clearLeaderboardBtn = document.getElementById('clear-leaderboard');
        if (clearLeaderboardBtn) {
            clearLeaderboardBtn.addEventListener('click', () => this.clearLeaderboard());
        }

        // Practice mode buttons
        const practiceGenerateBtn = document.getElementById('practice-generate-btn');
        if (practiceGenerateBtn) {
            practiceGenerateBtn.addEventListener('click', () => this.generatePracticeExercise());
        }

        const practiceExitBtn = document.getElementById('practice-exit-btn');
        if (practiceExitBtn) {
            practiceExitBtn.addEventListener('click', () => {
                this.exitPracticeMode();
                this.updateStatus('Exited practice mode. Back to normal.');
            });
        }

        const practiceLoopsInput = document.getElementById('practice-loops');
        if (practiceLoopsInput) {
            practiceLoopsInput.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                if (val >= 1 && val <= 10) {
                    this.practiceMaxLoops = val;
                }
            });
        }

        const practiceSpeedInput = document.getElementById('practice-speed');
        if (practiceSpeedInput) {
            practiceSpeedInput.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                if (val >= 25 && val <= 100) {
                    this.practiceBpmRatio = val / 100;
                    document.getElementById('practice-speed-value').textContent = val;
                }
            });
        }
    }

    async handleMidiUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.updateStatus(`Loading ${file.name}...`);
        this.reset();

        try {
            const arrayBuffer = await file.arrayBuffer();
            this.processMidiBuffer(arrayBuffer, file.name);
            
            // Add to drawer "Your MIDIs"
            this.addCustomMidiToDrawer(file.name, arrayBuffer);
        } catch (error) {
            console.error('MIDI load failed:', error);
            this.updateStatus(`MIDI load failed: ${error.message}`);
        }
    }

    async loadMidiFromPath(path) {
        this.updateStatus(`Loading ${path}...`);
        this.reset();

        try {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const arrayBuffer = await response.arrayBuffer();
            this.processMidiBuffer(arrayBuffer, path.split('/').pop());
        } catch (error) {
            console.error('Error loading MIDI from path:', error);
            this.updateStatus(`Error loading MIDI: ${error.message}`);
        }
    }

    // Common logic to process MIDI buffer
    processMidiBuffer(arrayBuffer, fileName) {
        console.log(`Processing MIDI: ${fileName}, size: ${arrayBuffer.byteLength} bytes`);

        // Clear difficulty tracking for new file
        this.noteStats = {};

        // Use local MIDI parser
        this.midiData = new SimpleMidiParser(arrayBuffer);
        console.log('MIDI parsed successfully:', this.midiData);
        
        // Set playback speed based on MIDI BPM (BPM / 60 = beats per second)
        if (this.midiData.bpm) {
            this.speed = this.midiData.bpm / 60;
            console.log(`Playback speed set to: ${this.speed.toFixed(2)} beats/sec (BPM: ${this.midiData.bpm.toFixed(1)})`);
            
            // Update UI BPM display
            const bpmInput = document.getElementById('bpm-input');
            if (bpmInput) {
                bpmInput.value = Math.round(this.midiData.bpm);
            }
        }
        
        this.parseMidiData();
        this.updateStatus(`${fileName} loaded! ${this.totalNotes} notes, ${this.uniqueNotes} unique pitches`);
        this.enableControls();
        this.render();
    }

    addCustomMidiToDrawer(name, buffer) {
        const list = document.getElementById('custom-midi-list');
        if (!list) return;

        // Check if already in list
        const existing = Array.from(list.querySelectorAll('.midi-item'))
                             .find(item => item.textContent.includes(name));
        if (existing) return;

        const button = document.createElement('button');
        button.className = 'midi-item';
        button.innerHTML = `📄 ${name}`;
        button.addEventListener('click', () => {
            this.processMidiBuffer(buffer, name);
            document.querySelectorAll('.midi-item').forEach(i => i.classList.remove('active'));
            button.classList.add('active');
        });

        list.appendChild(button);
        
        // Auto-select the newly uploaded MIDI
        document.querySelectorAll('.midi-item').forEach(i => i.classList.remove('active'));
        button.classList.add('active');
    }

    async loadDefaultMidi() {
        this.updateStatus('Loading default MIDI file...');

        try {
            const response = await fetch('midi/BananaBoat_bpm60.mid');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            console.log('Default MIDI loaded:', arrayBuffer.byteLength, 'bytes');

            this.midiData = new SimpleMidiParser(arrayBuffer);
            console.log('Default MIDI parsed successfully:', this.midiData);

            // Set playback speed based on MIDI BPM (BPM / 60 = beats per second)
            if (this.midiData.bpm) {
                this.speed = this.midiData.bpm / 60;
                console.log(`Playback speed set to: ${this.speed.toFixed(2)} beats/sec (BPM: ${this.midiData.bpm.toFixed(1)})`);

                // Update UI BPM display
                const bpmInput = document.getElementById('bpm-input');
                if (bpmInput) {
                    bpmInput.value = Math.round(this.midiData.bpm);
                }
            }

            this.parseMidiData();
            this.updateStatus(`Default song loaded! Total ${this.totalNotes} notes, ${this.uniqueNotes} unique pitches`);
            this.enableControls();
            this.render();
        } catch (error) {
            console.error('Default MIDI load failed:', error);
            this.updateStatus('Please select a MIDI from the Library to start the game');
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
                    const displayDuration = Math.min(scaledDuration, 1 * this.tileDurationRatio);
                    
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

        // Calculate song length
        this.songLength = this.notes.length > 0 ? Math.max(...this.notes.map(n => n.endTime)) : 0;
        this.currentTime = 0;
        if (typeof musicNav !== 'undefined' && musicNav) musicNav.refresh();

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
        const minLaneWidth = 2;   // Min width - allows more notes on narrow screens
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
            note.width = Math.max(laneWidth - 4, 2); // Leave some gap, min 2px
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
            if (typeof musicNav !== 'undefined' && musicNav) musicNav.refresh();
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
            
            // Adjust start time so the first note hits the line exactly on a beat
            // Find the nearest beat before or at firstNoteTime
            const firstNoteBeat = Math.round(firstNoteTime / this.metronomeBeatUnit) * this.metronomeBeatUnit;
            
            // We want the game to start such that at (firstNoteTime), the note is at judgment line
            // But we also want the metronome to be aligned with the grid
            // So we set the initial time relative to the grid
            
            const initialAdjustedTime = firstNoteTime - timeToTop;
            
            // Set startTime to let first note start from top
            this.resetStats();
            this.resetNotes();

            // Align metronome grid to start exactly at 0 or a multiple of beat unit
            // Since our notes.startTime are already in "beats" (or seconds that correspond to beats if speed=1)
            // We just need to ensure the metronome starts counting from a beat-aligned time
            
            const countInDuration = this.beatsPerBar * (this.metronomeBeatUnit / this.speed);
            const gameStartAudioTime = this.audioContext.currentTime + countInDuration;
            
            // This is the key: startTime defines 0.0 adjusted time
            // If we want the first note (at firstNoteTime) to hit the line at (gameStartAudioTime + timeToTop/speed)
            // Then:
            // audioTime = startTime + (adjustedTime / speed)
            // adjustedTime = (audioTime - startTime) * speed
            // At hit moment: audioTime = gameStartAudioTime + (timeToTop / speed)
            // adjustedTime should be firstNoteTime
            // firstNoteTime = (gameStartAudioTime + timeToTop/speed - startTime) * speed
            // firstNoteTime/speed = gameStartAudioTime + timeToTop/speed - startTime
            // startTime = gameStartAudioTime + timeToTop/speed - firstNoteTime/speed
            // startTime = gameStartAudioTime - (firstNoteTime - timeToTop) / speed
            
            this.startTime = gameStartAudioTime - (initialAdjustedTime / this.speed);
            
            // Initialize metronome to align with the grid (0, 1, 2, 3...)
            // We want the next beat to be the first integer beat after initialAdjustedTime
            this.initializeMetronomeClock(initialAdjustedTime);
            
            // Play count-in based on the same grid that the first note belongs to
            // This aligns the clicks perfectly with the first note's arrival
            this.playCountIn(firstNoteBeat);
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
                if (typeof musicNav !== 'undefined' && musicNav) musicNav.refresh();
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
        if (typeof musicNav !== 'undefined' && musicNav) musicNav.refresh();
    }

    togglePlay() {
        if (this.isPlaying && !this.isPaused) {
            this.pause();
        } else {
            this.play();
        }
    }

    seekTo(targetTime) {
        if (!this.midiData || this.songLength === 0) return;
        
        // Constrain to valid range
        targetTime = Math.max(0, Math.min(this.songLength, targetTime));
        
        this.currentTime = targetTime;
        
        if (this.isPlaying && !this.isPaused) {
            // Adjust startTime so that current audio context time maps to new targetTime
            // targetTime = (audioContext.currentTime - startTime) * speed
            // targetTime / speed = audioContext.currentTime - startTime
            // startTime = audioContext.currentTime - (targetTime / speed)
            this.startTime = this.audioContext.currentTime - (targetTime / this.speed);
            
            // Re-sync metronome
            this.initializeMetronomeClock(targetTime);
            
            // Reset hits for notes after this time, to allow playing them
            this.resetNotesAfter(targetTime);
        } else if (this.isPaused || (!this.isPlaying && this.pauseTime > 0)) {
            // Update pauseTime so when we resume, it starts from here
            // When paused, pauseTime is effectively the elapsed audio time
            // targetTime = pauseTime * speed
            // pauseTime = targetTime / speed
            this.pauseTime = targetTime / this.speed;
            
            // Reset hits
            this.resetNotesAfter(targetTime);
        } else {
            // Not started yet
            this.pauseTime = targetTime / this.speed;
            this.isPaused = true; // Force it to be in paused state so it can resume from here
            this.isPlaying = true;
            document.getElementById('play-btn').disabled = false;
            
            // Reset hits
            this.resetNotesAfter(targetTime);
        }
        
        this.render(targetTime);
        if (typeof musicNav !== 'undefined' && musicNav) musicNav.refresh();
    }

    resetNotesAfter(time) {
        // Reset hit/miss state for notes that haven't been reached yet
        // A little lookahead buffer
        this.notes.forEach(note => {
            if (note.startTime >= time - 0.5) {
                note.hit = false;
                note.missed = false;
                note.accumulatedHoldTime = 0;
                note.isBeingHeld = false;
                note.lastHoldUpdate = null;
            }
        });
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

        // Exit practice mode if active
        if (this.practiceMode) {
            this.exitPracticeMode();
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

        this.updateStatus(this.midiData ? 'Reset, click Start Game' : 'Please select a MIDI from the Library to start');
        
        this.currentTime = 0;
        
        this.render();
        if (typeof musicNav !== 'undefined' && musicNav) musicNav.refresh();
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
        // Grid should start at 0 (or nearest beat)
        this.metronomeGridStart = 0;
        
        // Find the next beat that is >= initialAdjustedTime
        // This ensures the metronome clicks are on integer beats (0, 1, 2...)
        this.metronomeNextBeat = Math.ceil(initialAdjustedTime / this.metronomeBeatUnit) * this.metronomeBeatUnit;
        
        // If we are exactly on a beat, start from there
        if (this.metronomeNextBeat < initialAdjustedTime) {
             this.metronomeNextBeat += this.metronomeBeatUnit;
        }
    }

    playCountIn(firstNoteBeat) {
        // Find the beats that occur exactly before the first note's beat
        // These are the same beats as the song's grid
        for (let i = this.beatsPerBar; i > 0; i--) {
            const countInBeat = firstNoteBeat - i;
            const audioTime = this.startTime + (countInBeat * this.metronomeBeatUnit / this.speed);
            
            // Only play if it's in the future (though count-in should always be)
            if (audioTime >= this.audioContext.currentTime) {
                this.playMetronomeClick(audioTime, i === this.beatsPerBar);
            }
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
        
        // Visual indicator: Flash the judgment line
        // Calculate when to flash (in game loop time)
        // Since audio scheduling is ahead of visual render, we need to schedule the flash
        const timeUntilClick = time - this.audioContext.currentTime;
        if (timeUntilClick >= 0) {
            setTimeout(() => {
                this.triggerMetronomeFlash();
            }, timeUntilClick * 1000);
        }
    }
    
    triggerMetronomeFlash() {
        this.metronomeFlash = 1.0; // Opacity
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

        this.notes.forEach(note => {
            if (note.hit || note.missed) return;
            
            // Allow same note to be hit again after small gap
            if (this.recentlyHitNotes.has(note)) return;

            // Pitch class match (ignore octave)
            const pitchClassMatch = (transposedMidi % 12) === (note.midi % 12);
            if (!pitchClassMatch) return;

            // Short notes get wider hit window
            const isShortNote = (note.duration / this.speed) < 0.3;
            const holdStartThreshold = isShortNote ? this.hitWindow.miss * 2 : this.hitWindow.miss;
            const afterEndTolerance = isShortNote ? 0.3 : 0.1;

            // Note is "active" if current time is within its window
            // window: [startTime - threshold, endTime + tolerance]
            const timeUntilStart = note.startTime - adjustedTime;
            const timeUntilEnd = note.endTime - adjustedTime;
            
            // Check if we are in the hit window or already within the tile duration
            if (timeUntilStart < holdStartThreshold / 1000 && timeUntilEnd > -afterEndTolerance) {
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
        flashEl.style.width = Math.max(this.laneWidth - 2, 1) + 'px';
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

        const isShortNote = (note.duration / this.speed) < 0.3;

        if (isShortNote) {
            // Fast notes: judge on pitch only, skip sustain requirement
            if (note.accumulatedHoldTime > 0) {
                judgment = 'perfect';
                scoreAdd = 150;
                this.combo++;
            } else {
                judgment = 'miss';
                scoreAdd = 0;
                this.combo = 0;
            }
        } else {
            // Sustain-based judgment for normal notes
            const sustainPercentage = note.accumulatedHoldTime / note.duration;

            if (sustainPercentage >= 0.8) {
                judgment = 'perfect';
                scoreAdd = 150;
                this.combo++;
            } else if (sustainPercentage >= 0.5) {
                judgment = 'good';
                scoreAdd = 75;
                this.combo++;
            } else if (sustainPercentage >= 0.2) {
                judgment = 'ok';
                scoreAdd = 25;
                this.combo++;
            } else {
                judgment = 'miss';
                scoreAdd = 0;
                this.combo = 0;
            }
        }

        if (judgment) {
            note.hit = (judgment !== 'miss');
            if (note.hit) {
                this.hitNotes++;
            } else {
                this.missedNotes++;
            }

            const sustainPct = note.duration > 0 ? note.accumulatedHoldTime / note.duration : 0;

            this.score += scoreAdd + (this.combo > 10 ? Math.floor(this.combo / 2) : 0);
            this.updateStats();
            this.showJudgment(judgment, isShortNote ? (judgment === 'perfect') : sustainPct >= 0.80);

            // Track per-note difficulty stats
            const pitchKey = note.name;
            if (!this.noteStats[pitchKey]) {
                this.noteStats[pitchKey] = { total: 0, hits: 0, misses: 0, totalSustain: 0, perfectCount: 0 };
            }
            this.noteStats[pitchKey].total++;
            this.noteStats[pitchKey].totalSustain += sustainPct;
            if (judgment === 'perfect') {
                this.noteStats[pitchKey].hits++;
                this.noteStats[pitchKey].perfectCount++;
            } else if (judgment === 'miss') {
                this.noteStats[pitchKey].misses++;
            } else {
                this.noteStats[pitchKey].hits++;
            }

            console.log(`Judged: ${note.name}${isShortNote ? ' (fast)' : ''}, Sustain: ${(sustainPct * 100).toFixed(1)}%, Judgment: ${judgment}`);
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

    /**
     * Analyze note stats and return struggling notes sorted by difficulty
     * @returns {Array} Array of { name, midi, accuracy, difficulty, attempts }
     */
    getStrugglingNotes() {
        const struggling = [];
        const uniqueMidiMap = {};

        // Build a map of noteName -> midi from current notes
        this.notes.forEach(note => {
            if (!uniqueMidiMap[note.name]) {
                uniqueMidiMap[note.name] = note.midi;
            }
        });

        for (const [name, stats] of Object.entries(this.noteStats)) {
            if (stats.total < 1) continue;
            const avgSustain = stats.totalSustain / stats.total;
            const accuracy = (stats.hits / stats.total) * 100;

            // Difficulty: higher = more difficult. Weighted by low accuracy, high miss rate, low sustain
            const missRate = stats.misses / stats.total;
            const difficulty = (100 - accuracy) * 0.4 + missRate * 100 * 0.3 + (1 - avgSustain) * 100 * 0.3;

            struggling.push({
                name,
                midi: uniqueMidiMap[name] || 60,
                accuracy: accuracy.toFixed(1),
                difficulty: difficulty.toFixed(1),
                attempts: stats.total,
                avgSustain: (avgSustain * 100).toFixed(1)
            });
        }

        // Sort by difficulty descending
        struggling.sort((a, b) => parseFloat(b.difficulty) - parseFloat(a.difficulty));
        return struggling;
    }

    /**
     * Update the practice mode UI with current struggling notes
     */
    updatePracticePanel() {
        const listEl = document.getElementById('practice-struggling-list');
        const generateBtn = document.getElementById('practice-generate-btn');
        const infoEl = document.getElementById('practice-info');
        if (!listEl) return;

        const struggling = this.getStrugglingNotes();

        if (struggling.length === 0) {
            listEl.innerHTML = '<p class="practice-empty">Play a song first to identify difficult notes.</p>';
            if (generateBtn) generateBtn.disabled = true;
            if (infoEl) infoEl.textContent = 'No data yet. Complete a song to track difficulty.';
            return;
        }

        if (generateBtn) generateBtn.disabled = false;

        // Show top 5 most difficult
        const topStruggling = struggling.slice(0, 5);
        listEl.innerHTML = topStruggling.map((s, i) => {
            const diffLevel = parseFloat(s.difficulty) >= 60 ? 'hard' : parseFloat(s.difficulty) >= 30 ? 'medium' : 'easy';
            return `<div class="practice-note-item ${diffLevel}">
                <span class="practice-note-rank">${i + 1}</span>
                <span class="practice-note-name">${s.name}</span>
                <span class="practice-note-stat">${s.accuracy}% accuracy</span>
                <span class="practice-note-stat">${s.attempts} attempts</span>
            </div>`;
        }).join('');

        if (infoEl) {
            infoEl.textContent = `Found ${struggling.length} note${struggling.length > 1 ? 's' : ''} with difficulty data. Top ${topStruggling.length} shown.`;
        }
    }

    /**
     * Generate a practice exercise from struggling notes
     */
    generatePracticeExercise() {
        const struggling = this.getStrugglingNotes();
        if (struggling.length === 0) {
            this.updateStatus('No difficulty data available. Play a song first!');
            return;
        }

        // Take top struggling notes (up to 4)
        const targetNotes = struggling.slice(0, 4);
        const exerciseNotes = [];
        const bpm = this.midiData ? this.midiData.bpm : 120;
        const beatDuration = 60 / (bpm * this.practiceBpmRatio); // Slower for practice

        // Generate a pattern: each note played sequentially, then in pairs
        let currentTime = 0;
        const noteDuration = beatDuration * 1.5; // Generous duration for practice

        // Phase 1: Each note alone, 3 repetitions
        targetNotes.forEach(tn => {
            for (let rep = 0; rep < 3; rep++) {
                exerciseNotes.push({
                    midi: tn.midi,
                    name: tn.name,
                    startTime: currentTime,
                    endTime: currentTime + noteDuration,
                    duration: noteDuration,
                    velocity: 100,
                    track: 0,
                    hit: false,
                    missed: false,
                    accumulatedHoldTime: 0,
                    isBeingHeld: false,
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                    originalDuration: noteDuration,
                    hitWindowOffset: 0,
                    sustainRequired: true
                });
                currentTime += noteDuration + beatDuration;
            }
            currentTime += beatDuration; // Extra gap between notes
        });

        // Phase 2: Alternating pairs (if at least 2 notes)
        if (targetNotes.length >= 2) {
            for (let i = 0; i < targetNotes.length - 1; i++) {
                for (let rep = 0; rep < 2; rep++) {
                    exerciseNotes.push({
                        midi: targetNotes[i].midi,
                        name: targetNotes[i].name,
                        startTime: currentTime,
                        endTime: currentTime + noteDuration,
                        duration: noteDuration,
                        velocity: 100,
                        track: 0,
                        hit: false,
                        missed: false,
                        accumulatedHoldTime: 0,
                        isBeingHeld: false,
                        x: 0,
                        y: 0,
                        width: 0,
                        height: 0,
                        originalDuration: noteDuration,
                        hitWindowOffset: 0,
                        sustainRequired: true
                    });
                    currentTime += noteDuration + beatDuration * 0.75;
                    exerciseNotes.push({
                        midi: targetNotes[i + 1].midi,
                        name: targetNotes[i + 1].name,
                        startTime: currentTime,
                        endTime: currentTime + noteDuration,
                        duration: noteDuration,
                        velocity: 100,
                        track: 0,
                        hit: false,
                        missed: false,
                        accumulatedHoldTime: 0,
                        isBeingHeld: false,
                        x: 0,
                        y: 0,
                        width: 0,
                        height: 0,
                        originalDuration: noteDuration,
                        hitWindowOffset: 0,
                        sustainRequired: true
                    });
                    currentTime += noteDuration + beatDuration * 0.75;
                }
                currentTime += beatDuration;
            }
        }

        // Save original state for restoration
        this.practiceOriginalNotes = {
            notes: [...this.notes],
            totalNotes: this.totalNotes,
            uniqueNotes: this.uniqueNotes,
            songLength: this.songLength,
            speed: this.speed,
            laneWidth: this.laneWidth,
            laneCount: this.laneCount
        };

        // Replace current notes with exercise
        this.notes = exerciseNotes;
        this.totalNotes = exerciseNotes.length;
        this.uniqueNotes = new Set(exerciseNotes.map(n => n.midi)).size;
        this.songLength = currentTime + beatDuration * 2;
        this.speed = bpm * this.practiceBpmRatio / 60;

        // Recalculate positions
        this.calculateNotePositions();

        // Enter practice mode
        this.practiceMode = true;
        this.practiceLoopCount = 0;

        // Update UI
        const loopEl = document.getElementById('practice-loop-info');
        if (loopEl) loopEl.textContent = `Loop 1 / ${this.practiceMaxLoops}`;

        const exitBtn = document.getElementById('practice-exit-btn');
        if (exitBtn) exitBtn.style.display = 'inline-block';

        this.updateStatus(`Practice Mode: ${targetNotes.map(n => n.name).join(', ')} (${exerciseNotes.length} notes, slower tempo)`);
        this.resetStats();
        this.resetNotes();
        this.enableControls();
        this.render();
        if (typeof musicNav !== 'undefined' && musicNav) musicNav.refresh();

        // Auto-play the exercise
        this.play();
    }

    /**
     * Called when the game ends - handles practice loop or normal end
     */
    handleGameEnd() {
        if (this.practiceMode) {
            this.practiceLoopCount++;

            const loopEl = document.getElementById('practice-loop-info');
            if (loopEl) loopEl.textContent = `Loop ${this.practiceLoopCount + 1} / ${this.practiceMaxLoops}`;

            if (this.practiceLoopCount < this.practiceMaxLoops) {
                // Loop: reset and replay
                this.resetStats();
                this.resetNotes();
                this.updateStatus(`Practice Loop ${this.practiceLoopCount + 1}/${this.practiceMaxLoops} - Keep practicing those notes!`);
                setTimeout(() => this.play(), 1000);
                return;
            } else {
                // Done practicing
                this.exitPracticeMode();
                this.updateStatus('Practice complete! Check your accuracy in the stats panel.');
                return;
            }
        }

        // Normal game end
        const accuracy = this.totalNotes > 0
            ? ((this.hitNotes / this.totalNotes) * 100).toFixed(1)
            : 0;
        this.updateStatus(`Game Over! Score: ${this.score} | Accuracy: ${accuracy}% | Max Combo: ${this.combo}`);
        this.showEndScreen();
    }

    /**
     * Exit practice mode and restore original song
     */
    exitPracticeMode() {
        this.practiceMode = false;

        if (this.practiceOriginalNotes) {
            this.notes = this.practiceOriginalNotes.notes;
            this.totalNotes = this.practiceOriginalNotes.totalNotes;
            this.uniqueNotes = this.practiceOriginalNotes.uniqueNotes;
            this.songLength = this.practiceOriginalNotes.songLength;
            this.speed = this.practiceOriginalNotes.speed;
            this.calculateNotePositions();
            this.practiceOriginalNotes = null;
        }

        const exitBtn = document.getElementById('practice-exit-btn');
        if (exitBtn) exitBtn.style.display = 'none';

        const loopEl = document.getElementById('practice-loop-info');
        if (loopEl) loopEl.textContent = '';

        this.resetStats();
        this.resetNotes();
        this.render();
        if (typeof musicNav !== 'undefined' && musicNav) musicNav.refresh();
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
        
        this.currentTime = adjustedTime;
        if (typeof musicNav !== 'undefined' && musicNav) musicNav.refresh();

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
            this.ctx.fillText('Please select a MIDI from the Library to start', this.canvasWidth / 2, this.canvasHeight / 2);
        }
    }

    drawLanes() {
        if (!this.laneCount || !this.laneWidth) return;
        
        const totalWidth = this.laneCount * this.laneWidth;
        const offsetX = (this.canvasWidth - totalWidth) / 2;

        for (let i = 0; i < this.laneCount; i++) {
            const x = offsetX + i * this.laneWidth;
            const w = Math.max(this.laneWidth - 2, 1);
            this.ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.1)';
            this.ctx.fillRect(x, 0, w, this.canvasHeight);
            
            // Draw lane borders
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x, 0, w, this.canvasHeight);
        }
    }

    drawJudgmentLine() {
        // Flash effect
        if (this.metronomeFlash > 0) {
            this.ctx.shadowBlur = 20;
            this.ctx.shadowColor = `rgba(255, 255, 255, ${this.metronomeFlash})`;
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${this.metronomeFlash})`;
            this.ctx.lineWidth = 5;
            this.ctx.beginPath();
            this.ctx.moveTo(0, this.judgmentLineY);
            this.ctx.lineTo(this.canvasWidth, this.judgmentLineY);
            this.ctx.stroke();
            
            this.metronomeFlash -= 0.1; // Fade out
            if (this.metronomeFlash < 0) this.metronomeFlash = 0;
        }

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
        // Chroma-Notes / Boomwhacker color scheme for natural notes,
        // with darker variants for sharps/flats
        const colors = [
            '#E53935', // 0:  C  (red)
            '#C62828', // 1:  C# (dark red)
            '#FF9800', // 2:  D  (orange)
            '#E65100', // 3:  D# (dark orange)
            '#FFEB3B', // 4:  E  (yellow)
            '#4CAF50', // 5:  F  (green)
            '#2E7D32', // 6:  F# (dark green)
            '#00BCD4', // 7:  G  (light blue)
            '#00838F', // 8:  G# (teal)
            '#1565C0', // 9:  A  (dark blue)
            '#0D47A1', // 10: A# (navy)
            '#9C27B0'  // 11: B  (purple)
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
        if (typeof musicNav !== 'undefined' && musicNav) musicNav.refresh();
        if (this.pitchDetectionEnabled && !this.pitchDetectionTimer) {
            this.startPitchDetection();
        }
        this.metronomeRunning = false;
        
        document.getElementById('play-btn').disabled = false;
        document.getElementById('pause-btn').disabled = true;

        // Update practice panel with latest stats
        this.updatePracticePanel();

        this.handleGameEnd();
    }

    // Leaderboard methods
    saveScore() {
        const accuracy = this.totalNotes > 0 
            ? ((this.hitNotes / this.totalNotes) * 100).toFixed(1) 
            : 0;
        
        const scoreEntry = {
            name: this.playerName,
            score: this.score,
            accuracy: accuracy,
            combo: this.combo,
            date: new Date().toISOString().split('T')[0] // YYYY-MM-DD
        };
        
        // Load existing leaderboard
        let leaderboard = JSON.parse(localStorage.getItem('instrumentTilesLeaderboard') || '[]');
        
        // Add new score
        leaderboard.push(scoreEntry);
        
        // Sort by score (descending), then by date (newest first)
        leaderboard.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(b.date) - new Date(a.date);
        });
        
        // Keep top 10 scores
        leaderboard = leaderboard.slice(0, 10);
        
        // Save back to localStorage
        localStorage.setItem('instrumentTilesLeaderboard', JSON.stringify(leaderboard));
        
        // Update display
        this.displayLeaderboard();
        
        console.log(`Score saved: ${this.playerName} - ${this.score} points`);
    }

    loadLeaderboard() {
        return JSON.parse(localStorage.getItem('instrumentTilesLeaderboard') || '[]');
    }

    displayLeaderboard() {
        const leaderboard = this.loadLeaderboard();
        const listElement = document.getElementById('leaderboard-list');
        
        if (!listElement) return;
        
        if (leaderboard.length === 0) {
            listElement.innerHTML = '<li>No scores yet. Be the first!</li>';
            return;
        }
        
        listElement.innerHTML = '';
        
        leaderboard.forEach((entry, index) => {
            const li = document.createElement('li');
            
            // Format position with medal emojis
            let position = '';
            if (index === 0) position = '🥇 ';
            else if (index === 1) position = '🥈 ';
            else if (index === 2) position = '🥉 ';
            else position = `${index + 1}. `;
            
            li.innerHTML = `
                <span class="player-name">${position}${entry.name}</span>
                <span class="player-score">${entry.score}</span>
                <span class="player-date">${entry.date}</span>
            `;
            
            listElement.appendChild(li);
        });
    }

    clearLeaderboard() {
        if (confirm('Are you sure you want to clear all leaderboard scores?')) {
            localStorage.removeItem('instrumentTilesLeaderboard');
            this.displayLeaderboard();
            this.updateStatus('Leaderboard cleared');
        }
    }

    showEndScreen() {
        const accuracy = this.totalNotes > 0 
            ? ((this.hitNotes / this.totalNotes) * 100).toFixed(1) 
            : 0;

        // Save score to leaderboard
        this.saveScore();
        
        // Check leaderboard position
        const leaderboard = this.loadLeaderboard();
        const playerPosition = leaderboard.findIndex(entry => 
            entry.name === this.playerName && entry.score === this.score
        );
        
        let positionMessage = '';
        if (playerPosition !== -1) {
            if (playerPosition === 0) {
                positionMessage = '\n🏆 NEW HIGH SCORE! 🏆\nYou\'re #1 on the leaderboard!';
            } else if (playerPosition < 3) {
                positionMessage = `\n🎉 You're #${playerPosition + 1} on the leaderboard!`;
            } else {
                positionMessage = `\n📊 You're ranked #${playerPosition + 1} on the leaderboard.`;
            }
        }
        
        alert(`🎵 Game Over!\n\nScore: ${this.score}\nAccuracy: ${accuracy}%\nCombo: ${this.combo}${positionMessage}\n\nCheck the leaderboard on the right!`);
    }
}

// Integrated Navigation System
class MusicNavigation {
    constructor(gameInstance) {
        this.game = gameInstance;
        this.positionSlider = null;
        this.currentTimeDisplay = null;
        this.totalTimeDisplay = null;
        this.playPauseBtn = null;
        
        this.init();
    }
    
    init() {
        // Get DOM elements
        this.positionSlider = document.getElementById('position-slider');
        this.currentTimeDisplay = document.getElementById('current-time');
        this.totalTimeDisplay = document.getElementById('total-time');
        this.playPauseBtn = document.getElementById('nav-play-pause');
        
        // Add event listeners
        this.addEventListeners();
        
        // Initial update
        this.update();
    }
    
    addEventListeners() {
        // Position slider - seek to position
        this.positionSlider.addEventListener('input', (e) => {
            const percent = parseInt(e.target.value) / 100;
            const targetTime = percent * this.game.songLength;
            this.game.seekTo(targetTime);
        });
        
        // Navigation buttons
        const buttonActions = {
            'nav-back': () => this.seekRelative(-5),
            'nav-play-pause': () => this.game.togglePlay(),
            'nav-forward': () => this.seekRelative(5)
        };
        
        Object.keys(buttonActions).forEach(id => {
            const button = document.getElementById(id);
            if (button) {
                button.addEventListener('click', buttonActions[id]);
            }
        });
        
        // Spacebar for play/pause
        document.addEventListener('keydown', (e) => {
            // Ignore if typing in an input
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
                return;
            }
            
            if (e.code === 'Space') {
                e.preventDefault();
                this.game.togglePlay();
            }
            
            // Arrow keys for navigation
            if (e.code === 'ArrowLeft') {
                e.preventDefault();
                this.seekRelative(-5);
            }
            if (e.code === 'ArrowRight') {
                e.preventDefault();
                this.seekRelative(5);
            }
        });
    }
    
    seekRelative(seconds) {
        if (!this.game.midiData) return;
        
        const newTime = Math.max(0, Math.min(this.game.songLength, this.game.currentTime + seconds));
        this.game.seekTo(newTime);
    }
    
    update() {
        // Update slider position based on current time
        if (this.game.songLength > 0) {
            const percent = (this.game.currentTime / this.game.songLength) * 100;
            this.positionSlider.value = percent;
            
            // Update time displays
            this.currentTimeDisplay.textContent = this.formatTime(this.game.currentTime);
            this.totalTimeDisplay.textContent = this.formatTime(this.game.songLength);
        }
        
        // Update play/pause button state
        this.updatePlayButton();
    }
    
    updatePlayButton() {
        if (this.playPauseBtn) {
            if (this.game.isPlaying && !this.game.isPaused) {
                this.playPauseBtn.classList.add('playing');
                this.playPauseBtn.title = 'Pause';
                this.playPauseBtn.innerHTML = '⏸';
            } else {
                this.playPauseBtn.classList.remove('playing');
                this.playPauseBtn.title = 'Play';
                this.playPauseBtn.innerHTML = '▶';
            }
        }
    }
    
    formatTime(seconds) {
        if (seconds < 0) return '0:00';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    // Public method to refresh navigation state
    refresh() {
        this.update();
    }
}

// Initialize game
let game;
let musicNav;
document.addEventListener('DOMContentLoaded', () => {
    game = new InstrumentTilesGame();
    musicNav = new MusicNavigation(game);
});
