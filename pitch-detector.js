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
        
        // Continuous detection buffer, improve accuracy
        this.pitchHistory = [];
        this.historySize = 3;
        
        // Currently detected pitch
        this.currentPitch = null;
        this.currentMidi = null;
        this.currentNoteName = null;
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
            console.log('AudioContext created successfully');

            // Request microphone permission
            console.log('Requesting microphone permission...');
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseCancellation: true,
                    autoGainControl: false
                }
            });
            console.log('Microphone permission granted');

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
        
        // 添加到历史记录
        this.pitchHistory.push(midi);
        if (this.pitchHistory.length > this.historySize) {
            this.pitchHistory.shift();
        }
        
        // 使用历史记录的中值，提高稳定性
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
    
    /**
     * 从历史记录中获取稳定的音高（众数）
     */
    getStablePitch() {
        if (this.pitchHistory.length === 0) return this.currentMidi || 60;
        
        const validHistory = this.pitchHistory.filter(p => p !== null);
        if (validHistory.length === 0) return this.currentMidi || 60;
        
        // 返回出现次数最多的音高
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
     * 自相关算法检测基频
     */
    autoCorrelate(buffer, sampleRate) {
        // 计算信号的 RMS
        let rms = 0;
        for (let i = 0; i < buffer.length; i++) {
            rms += buffer[i] * buffer[i];
        }
        rms = Math.sqrt(rms / buffer.length);

        // 如果信号太弱，返回 null
        if (rms < 0.01) return null;

        // 计算自相关函数
        const r = new Array(buffer.length).fill(0);
        for (let i = 0; i < buffer.length; i++) {
            for (let j = 0; j < buffer.length - i; j++) {
                r[i] += buffer[j] * buffer[j + i];
            }
        }

        // 找到自相关函数的峰值
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

        // 抛物线插值提高精度
        const x1 = r[T0 - 1];
        const x2 = r[T0];
        const x3 = r[T0 + 1];
        const a = (x1 + x3 - 2 * x2) / 2;
        const b = (x3 - x1) / 2;
        
        if (a) {
            T0 = T0 - b / (2 * a);
        }

        // 计算频率
        const frequency = sampleRate / T0;
        
        // 计算置信度
        const confidence = maxval / r[0];

        return { frequency, confidence };
    }

    frequencyToMidi(frequency) {
        return Math.round(12 * Math.log2(frequency / 440) + 69);
    }

    midiToNoteName(midi) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midi / 12) - 1;
        const noteName = noteNames[midi % 12];
        return noteName + octave;
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
    }

    /**
     * 检测是否接近目标音符
     * @param {number} targetMidi - 目标 MIDI 音符编号
     * @returns {boolean} 是否击中目标音符
     */
    isHitTarget(targetMidi) {
        if (this.currentMidi === null) return false;
        return Math.abs(this.currentMidi - targetMidi) <= 1; // 允许 ±1 个半音的误差
    }
}
