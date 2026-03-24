/**
 * Pitch Detector - Uses microphone to detect user's pitch
 */

console.log('pitch-detector.js loaded');

class PitchDetector {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.mediaStream = null;
        this.dataArray = null;
        this.isListening = false;

        // Pitch detection parameters
        this.minFrequency = 52.0;  // Min frequency (C2)
        this.maxFrequency = 2093.0; // Max frequency (C7)
        this.smoothing = 0.5; // Lower smoothing, increase response speed
        this.tuningOffsetCents = 0; // Micro-tuning offset in cents (±100 = ±1 semitone)

        // Continuous detection buffer, improve accuracy
        this.pitchHistory = [];
        this.historySize = 3;

        // Currently detected pitch
        this.currentPitch = null;
        this.currentMidi = null;
        this.currentNoteName = null;

        // RMS threshold for noise filtering (lower = more sensitive)
        this.rmsThreshold = 0.005;
    }

    async init() {
        console.log('PitchDetector.init() called');

        try {
            // Check browser support
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Your browser does not support microphone access');
            }

            console.log('Browser supports getUserMedia');

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('AudioContext created, state:', this.audioContext.state);

            // Resume if suspended (required after user gesture)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
                console.log('AudioContext resumed');
            }

            // Request microphone permission
            console.log('Requesting microphone permission...');
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: true
                }
            });
            console.log('Microphone permission granted, tracks:', this.mediaStream.getTracks().length);

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = this.smoothing;

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.analyser);

            this.dataArray = new Float32Array(this.analyser.fftSize);
            this.isListening = true;

            console.log('Microphone initialized successfully');
            return true;
        } catch (error) {
            console.error('PitchDetector.init() failed:', error);
            throw error;
        }
    }

    /**
     * Use autocorrelation algorithm to detect pitch
     * @returns {Object|null} Detected pitch info
     */
    detectPitch() {
        if (!this.isListening || !this.analyser) return null;

        this.analyser.getFloatTimeDomainData(this.dataArray);

        // Use autocorrelation algorithm to detect fundamental frequency
        const acf = this.autoCorrelate(this.dataArray, this.audioContext.sampleRate);

        if (acf === null || acf.frequency < this.minFrequency || acf.frequency > this.maxFrequency) {
            // Add to history
            this.pitchHistory.push(null);
            if (this.pitchHistory.length > this.historySize) {
                this.pitchHistory.shift();
            }

            this.currentPitch = null;
            this.currentMidi = null;
            this.currentNoteName = null;
            return null;
        }

        // Calculate MIDI note number
        const midi = this.frequencyToMidi(acf.frequency);
        const noteName = this.midiToNoteName(midi);

        // Add to history
        this.pitchHistory.push(midi);
        if (this.pitchHistory.length > this.historySize) {
            this.pitchHistory.shift();
        }

        // Use mode from history for stability
        const stableMidi = this.getStablePitch();

        this.currentPitch = acf.frequency;
        this.currentMidi = stableMidi;
        this.currentNoteName = this.midiToNoteName(stableMidi);

        return {
            frequency: acf.frequency,
            midi: stableMidi,
            noteName: this.currentNoteName,
            confidence: acf.confidence
        };
    }

    stop() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.isListening = false;
        this.analyser = null;
        this.dataArray = null;
    }

    /**
     * Get stable pitch from history (mode)
     */
    getStablePitch() {
        if (this.pitchHistory.length === 0) return this.currentMidi || 60;

        const validHistory = this.pitchHistory.filter(p => p !== null);
        if (validHistory.length === 0) return this.currentMidi || 60;

        // Return most frequent pitch
        const counts = {};
        let maxCount = 0;
        let mostFrequent = validHistory[0];

        for (const midi of validHistory) {
            counts[midi] = (counts[midi] || 0) + 1;
            if (counts[midi] > maxCount) {
                maxCount = counts[midi];
                mostFrequent = midi;
            }
        }

        return mostFrequent;
    }

    /**
     * Autocorrelation algorithm for fundamental frequency detection
     */
    autoCorrelate(buffer, sampleRate) {
        // Calculate signal RMS
        let rms = 0;
        for (let i = 0; i < buffer.length; i++) {
            rms += buffer[i] * buffer[i];
        }
        rms = Math.sqrt(rms / buffer.length);

        // If signal too weak, return null (configurable threshold)
        if (rms < this.rmsThreshold) return null;

        // Calculate autocorrelation function
        const r = new Array(buffer.length).fill(0);
        for (let i = 0; i < buffer.length; i++) {
            for (let j = 0; j < buffer.length - i; j++) {
                r[i] += buffer[j] * buffer[j + i];
            }
        }

        // Find peak of autocorrelation function
        let d = 0;
        while (d < r.length - 1 && r[d] > r[d + 1]) {
            d++;
        }

        let maxval = -1;
        let maxpos = -1;

        for (let i = d; i < r.length; i++) {
            if (r[i] > maxval) {
                maxval = r[i];
                maxpos = i;
            }
        }

        let T0 = maxpos;

        // Parabolic interpolation for precision
        if (T0 > 0 && T0 < r.length - 1) {
            const x1 = r[T0 - 1];
            const x2 = r[T0];
            const x3 = r[T0 + 1];
            const a = (x1 + x3 - 2 * x2) / 2;
            const b = (x3 - x1) / 2;

            if (a) {
                T0 = T0 - b / (2 * a);
            }
        }

        // Calculate frequency
        const frequency = sampleRate / T0;

        // Calculate confidence
        const confidence = maxval / r[0];

        return { frequency, confidence };
    }

    frequencyToMidi(frequency) {
        const midi = 12 * Math.log2(frequency / 440) + 69 - (this.tuningOffsetCents / 100);
        return Math.round(midi);
    }

    midiToNoteName(midi) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midi / 12) - 1;
        const noteName = noteNames[midi % 12];
        return noteName + octave;
    }

    /**
     * Check if detected pitch is close to target
     * @param {number} targetMidi - Target MIDI note number
     * @returns {boolean} Whether hit target
     */
    isHitTarget(targetMidi) {
        if (this.currentMidi === null) return false;
        return Math.abs(this.currentMidi - targetMidi) <= 1;
    }
}
