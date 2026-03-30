
class SimpleMidiParser {
    constructor(arrayBuffer) {
        this.data = new DataView(arrayBuffer);
        this.pos = 0;
        this.tracks = [];
        this.ticksPerBeat = 480;
        this.bpm = 120; // Default MIDI tempo
        this.timeSignature = { numerator: 4, denominator: 4 }; // Default 4/4
        this.parse();
    }

    parse() {
        // Read file header
        const headerChunk = this.readString(4);
        if (headerChunk !== 'MThd') {
            throw new Error('Invalid MIDI file');
        }

        const headerLength = this.data.getUint32(this.pos);
        this.pos += 4;

        const formatType = this.data.getUint16(this.pos);
        this.pos += 2;

        const numTracks = this.data.getUint16(this.pos);
        this.pos += 2;

        this.ticksPerBeat = this.data.getUint16(this.pos);
        this.pos += 2;

        // Skip remaining header info
        this.pos += (headerLength - 6);

        // Read all tracks
        for (let i = 0; i < numTracks; i++) {
            this.readTrack();
        }
    }

    readTrack() {
        const trackChunk = this.readString(4);
        if (trackChunk !== 'MTrk') {
            throw new Error('Invalid track chunk');
        }

        const trackLength = this.data.getUint32(this.pos);
        this.pos += 4;

        const trackEnd = this.pos + trackLength;
        const notes = [];
        let currentTime = 0;
        const runningStatus = { value: 0 };
        const activeNotes = new Map(); // Track pressed notes

        while (this.pos < trackEnd) {
            // Read delta time
            const deltaTime = this.readVarInt();
            currentTime += deltaTime;

            // Read event
            let status = this.data.getUint8(this.pos);

            // Handle running status
            if ((status & 0x80) === 0) {
                status = runningStatus.value;
            } else {
                this.pos++;
                runningStatus.value = status;
            }

            // Handle different event types
            if (status === 0xFF) {
                // Meta event
                const metaType = this.data.getUint8(this.pos++);
                const metaLength = this.readVarInt();
                
                if (metaType === 0x2F) {
                    // Track end
                    this.pos += metaLength;
                    break;
                } else if (metaType === 0x51 && metaLength === 3) {
                    // Set Tempo (microseconds per quarter note)
                    const microsecondsPerBeat = (this.data.getUint8(this.pos) << 16) |
                                                 (this.data.getUint8(this.pos + 1) << 8) |
                                                 (this.data.getUint8(this.pos + 2));
                    this.bpm = 60000000 / microsecondsPerBeat;
                     console.log(`BPM: ${this.bpm.toFixed(2)}`);
                     this.pos += 3;
                } else if (metaType === 0x58 && metaLength === 4) {
                    // Time Signature
                    const numerator = this.data.getUint8(this.pos);
                    const denominator = Math.pow(2, this.data.getUint8(this.pos + 1));
                    this.timeSignature = { numerator, denominator };
                    console.log(`Time Signature: ${numerator}/${denominator}`);
                    this.pos += 4;
                } else {
                    this.pos += metaLength;
                }
            } else if (status === 0xF0 || status === 0xF7) {
                // SysEx event
                const sysexLength = this.readVarInt();
                this.pos += sysexLength;
            } else {
                // MIDI event
                const dataBytes = this.getMidiEventDataBytes(status);
                const data1 = dataBytes > 0 ? this.data.getUint8(this.pos++) : 0;
                const data2 = dataBytes > 1 ? this.data.getUint8(this.pos++) : 0;

                const eventType = status & 0xF0;
                const channel = status & 0x0F;

                // Note On - All channels
                if (eventType === 0x90 && data2 > 0) {
                    activeNotes.set(data1, {
                        midi: data1,
                        startTime: currentTime,
                        velocity: data2,
                        channel: channel
                    });
                }
                // Note Off - All channels
                else if (eventType === 0x80 || (eventType === 0x90 && data2 === 0)) {
                    const noteOn = activeNotes.get(data1);
                    if (noteOn) {
                        const timeInBeats = currentTime / this.ticksPerBeat;
                        const startTimeInBeats = noteOn.startTime / this.ticksPerBeat;
                        const duration = timeInBeats - startTimeInBeats;

                        notes.push({
                            midi: data1,
                            name: this.midiToNoteName(data1),
                            startTime: startTimeInBeats,
                            endTime: timeInBeats,
                            duration: Math.max(duration, 0.05), // Reduce min duration
                            velocity: noteOn.velocity / 127,
                            channel: noteOn.channel
                        });
                        activeNotes.delete(data1);
                    }
                }
            }
        }

        // Merge tied notes (consecutive same-pitch notes with no gap)
        this.mergeTiedNotes(notes);

        this.tracks.push({ notes });
        
        // Debug info
        console.log(`Track ${this.tracks.length - 1}: ${notes.length} notes`);
        if (notes.length > 0) {
            console.log('First 5 notes:', notes.slice(0, 5).map(n => ({
                name: n.name,
                start: n.startTime.toFixed(3),
                end: n.endTime.toFixed(3),
                duration: n.duration.toFixed(3)
            })));
        }
    }

    getMidiEventDataBytes(status) {
        const highNibble = status & 0xF0;
        switch (highNibble) {
            case 0x80: // Note Off
            case 0x90: // Note On
            case 0xA0: // Aftertouch
            case 0xB0: // Control Change
            case 0xE0: // Pitch Bend
                return 2;
            case 0xC0: // Program Change
            case 0xD0: // Channel Pressure
                return 1;
            default:
                return 0;
        }
    }

    readVarInt() {
        let value = 0;
        while (true) {
            const byte = this.data.getUint8(this.pos++);
            value = (value << 7) | (byte & 0x7F);
            if ((byte & 0x80) === 0) {
                break;
            }
        }
        return value;
    }

    readString(length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(this.data.getUint8(this.pos++));
        }
        return str;
    }

    midiToNoteName(midi) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midi / 12) - 1;
        const noteName = noteNames[midi % 12];
        return noteName + octave;
    }

    mergeTiedNotes(notes) {
        // Sort by start time, then by midi pitch
        notes.sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);

        // Tolerance in beats — handles ties with small gaps or overlaps
        // 0.2 beats ≈ 96 ticks at 480 tpqn, enough for quantization artifacts
        const tolerance = 0.2;
        let merged = 0;
        let i = 0;

        while (i < notes.length - 1) {
            const current = notes[i];
            const next = notes[i + 1];

            const samePitch = current.midi === next.midi;
            const sameChannel = current.channel === next.channel;
            const gap = next.startTime - current.endTime;

            // Merge if same pitch+channel AND:
            // 1. Next starts right when current ends (gap ≈ 0)
            // 2. Next starts before current ends (overlap / legato)
            // 3. Small gap within tolerance
            if (samePitch && sameChannel && gap < tolerance) {
                // Extend current to cover the full span
                current.endTime = Math.max(current.endTime, next.endTime);
                current.duration = current.endTime - current.startTime;
                current.duration = Math.max(current.duration, 0.05);
                current.velocity = Math.max(current.velocity, next.velocity);
                notes.splice(i + 1, 1);
                merged++;
                // Don't increment i — check if the next note also ties
            } else {
                i++;
            }
        }

        console.log(`After merging ties: ${notes.length} notes (${merged} merged)`);
    }
}
