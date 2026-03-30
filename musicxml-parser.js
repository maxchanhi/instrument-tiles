
class MusicXmlParser {
    constructor(xmlString, tileDurationRatio = 0.8) {
        this.bpm = 120;
        this.timeSignature = { numerator: 4, denominator: 4 };
        this.divisions = 4; // divisions per quarter note (default)
        this.tracks = []; // kept for compatibility
        this.tiles = []; // direct tile output
        this.uniqueNotes = 0;
        this.minMidi = 60;
        this.maxMidi = 72;
        this.songLength = 0;
        this.tileDurationRatio = tileDurationRatio;
        this.parse(xmlString);
    }

    parse(xmlString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, 'application/xml');

        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            throw new Error('Invalid MusicXML: ' + parseError.textContent.slice(0, 100));
        }

        // Detect format: partwise vs timewise
        const partwise = doc.querySelector('score-partwise');
        const timewise = doc.querySelector('score-timewise');

        if (partwise) {
            this.parsePartwise(doc);
        } else if (timewise) {
            this.parseTimewise(doc);
        } else {
            throw new Error('Unknown MusicXML format (expected score-partwise or score-timewise)');
        }

        // Post-processing
        this.calculateStats();
        console.log(`MusicXML parsed: ${this.tiles.length} tiles, ${this.bpm} BPM, ${this.timeSignature.numerator}/${this.timeSignature.denominator}`);
    }

    calculateStats() {
        // Calculate unique pitches
        const midiSet = new Set(this.tiles.map(t => t.midi));
        this.uniqueNotes = midiSet.size;

        // Calculate min/max MIDI
        if (this.tiles.length > 0) {
            const midis = this.tiles.map(t => t.midi);
            this.minMidi = Math.min(...midis);
            this.maxMidi = Math.max(...midis);
        }

        // Calculate song length
        const lastTile = this.tiles.reduce((latest, t) =>
            t.endTime > latest.endTime ? t : latest, { endTime: 0 });
        this.songLength = lastTile.endTime + 2; // 2 beats buffer

        // Build tracks for compatibility
        this.tracks = [{ notes: this.tiles.map(t => ({
            midi: t.midi,
            name: t.name,
            startTime: t.startTime,
            endTime: t.endTime,
            duration: t.originalDuration,
            velocity: t.velocity,
            channel: 0
        }))}];
    }

    parsePartwise(doc) {
        const parts = doc.querySelectorAll('score-partwise > part');

        parts.forEach((part, partIndex) => {
            const partId = part.getAttribute('id');
            const notes = []; // raw notes before tile conversion
            let currentBeat = 0;
            this.divisions = 4;

            const measures = part.querySelectorAll('measure');
            measures.forEach(measure => {
                const measureStart = currentBeat;
                let noteOffset = 0;
                let lastNoteTime = -1;

                Array.from(measure.children).forEach(child => {
                    if (child.tagName === 'attributes') {
                        const divEl = child.querySelector('divisions');
                        if (divEl) {
                            const newDiv = parseInt(divEl.textContent);
                            if (!isNaN(newDiv) && newDiv > 0) this.divisions = newDiv;
                        }
                        const beatsEl = child.querySelector('beats');
                        const beatTypeEl = child.querySelector('beat-type');
                        if (beatsEl && beatTypeEl) {
                            this.timeSignature.numerator = parseInt(beatsEl.textContent);
                            this.timeSignature.denominator = parseInt(beatTypeEl.textContent);
                        }
                    } else if (child.tagName === 'note') {
                        const isRest = child.querySelector('rest') !== null;
                        const isChord = child.querySelector('chord') !== null;

                        const durationEl = child.querySelector('duration');
                        let durationDivisions = durationEl ? parseInt(durationEl.textContent) : 0;
                        if (isNaN(durationDivisions) || durationDivisions <= 0) {
                            durationDivisions = this.divisions;
                        }
                        const durationBeats = durationDivisions / this.divisions;

                        if (!isRest) {
                            const pitchEl = child.querySelector('pitch');
                            if (pitchEl) {
                                const step = pitchEl.querySelector('step')?.textContent || 'C';
                                const alter = pitchEl.querySelector('alter')?.textContent || '0';
                                const octave = pitchEl.querySelector('octave')?.textContent || '4';
                                const midi = this.pitchToMidi(step, parseInt(alter), parseInt(octave));
                                const name = this.midiToNoteName(midi);

                                let startTimeBeats;
                                if (isChord && lastNoteTime >= 0) {
                                    startTimeBeats = lastNoteTime;
                                } else {
                                    startTimeBeats = measureStart + noteOffset / this.divisions;
                                    lastNoteTime = startTimeBeats;
                                }

                                const ties = child.querySelectorAll('tie');
                                let tieType = null;
                                ties.forEach(tie => {
                                    tieType = tie.getAttribute('type');
                                });

                                notes.push({
                                    midi, name,
                                    startTime: startTimeBeats,
                                    endTime: startTimeBeats + durationBeats,
                                    duration: durationBeats,
                                    velocity: 0.8,
                                    channel: 0,
                                    tieType,
                                    track: partIndex
                                });
                            }
                        }

                        if (!isChord) {
                            noteOffset += durationDivisions;
                        }
                    } else if (child.tagName === 'backup') {
                        const durEl = child.querySelector('duration');
                        if (durEl) {
                            const backup = parseInt(durEl.textContent);
                            if (!isNaN(backup)) noteOffset = Math.max(0, noteOffset - backup);
                        }
                    } else if (child.tagName === 'forward') {
                        const durEl = child.querySelector('duration');
                        if (durEl) {
                            const fwd = parseInt(durEl.textContent);
                            if (!isNaN(fwd) && fwd > 0) noteOffset += fwd;
                        }
                    } else if (child.tagName === 'direction') {
                        const tempoEl = child.querySelector('per-minute');
                        if (tempoEl) {
                            const tempo = parseFloat(tempoEl.textContent);
                            if (!isNaN(tempo) && tempo > 0) this.bpm = tempo;
                        }
                    }
                });

                const measureDurationEl = measure.querySelector('duration');
                if (measureDurationEl) {
                    currentBeat += parseInt(measureDurationEl.textContent) / this.divisions;
                } else {
                    currentBeat += this.timeSignature.numerator * (4 / this.timeSignature.denominator);
                }
            });

            // Merge tied notes
            this.mergeTiedNotes(notes);

            // Convert to tiles
            const noteMap = new Map();
            notes.forEach(note => {
                const noteKey = `${note.midi}-${note.startTime}`;
                if (!noteMap.has(noteKey)) {
                    const tile = this.noteToTile(note, partIndex);
                    noteMap.set(noteKey, tile);
                    this.tiles.push(tile);
                }
            });

            console.log(`Part ${partId}: ${notes.length} notes → tiles`);
        });
    }

    parseTimewise(doc) {
        const measures = doc.querySelectorAll('score-timewise > measure');
        const partNotes = {};

        measures.forEach(measure => {
            const parts = measure.querySelectorAll('part');
            parts.forEach(part => {
                const partId = part.getAttribute('id');
                if (!partNotes[partId]) {
                    partNotes[partId] = [];
                }

                this.divisions = 4;
                let noteOffset = 0;
                let lastNoteTime = -1;

                const noteElements = part.querySelectorAll('note');
                noteElements.forEach(noteEl => {
                    const isRest = noteEl.querySelector('rest') !== null;
                    const isChord = noteEl.querySelector('chord') !== null;
                    const durationEl = noteEl.querySelector('duration');
                    let durationDivisions = durationEl ? parseInt(durationEl.textContent) : 0;
                    if (isNaN(durationDivisions) || durationDivisions <= 0) {
                        durationDivisions = this.divisions;
                    }
                    const durationBeats = durationDivisions / this.divisions;

                    if (isRest) {
                        if (!isChord) noteOffset += durationDivisions;
                        return;
                    }

                    const pitchEl = noteEl.querySelector('pitch');
                    if (!pitchEl) return;

                    const step = pitchEl.querySelector('step')?.textContent || 'C';
                    const alter = pitchEl.querySelector('alter')?.textContent || '0';
                    const octave = pitchEl.querySelector('octave')?.textContent || '4';
                    const midi = this.pitchToMidi(step, parseInt(alter), parseInt(octave));
                    const name = this.midiToNoteName(midi);

                    let startTimeBeats;
                    if (isChord && lastNoteTime >= 0) {
                        startTimeBeats = lastNoteTime;
                    } else {
                        startTimeBeats = noteOffset / this.divisions;
                        lastNoteTime = startTimeBeats;
                        noteOffset += durationDivisions;
                    }

                    const ties = noteEl.querySelectorAll('tie');
                    let tieType = null;
                    ties.forEach(tie => {
                        tieType = tie.getAttribute('type');
                    });

                    partNotes[partId].push({
                        midi, name,
                        startTime: startTimeBeats,
                        endTime: startTimeBeats + durationBeats,
                        duration: durationBeats,
                        velocity: 0.8,
                        channel: 0,
                        tieType,
                        track: 0
                    });
                });
            });
        });

        Object.entries(partNotes).forEach(([partId, notes], partIndex) => {
            this.mergeTiedNotes(notes);
            const noteMap = new Map();
            notes.forEach(note => {
                const noteKey = `${note.midi}-${note.startTime}`;
                if (!noteMap.has(noteKey)) {
                    const tile = this.noteToTile(note, partIndex);
                    noteMap.set(noteKey, tile);
                    this.tiles.push(tile);
                }
            });
        });
    }

    noteToTile(note, trackIndex) {
        const scaledDuration = note.duration * this.tileDurationRatio;
        const displayDuration = note.duration <= 1
            ? Math.min(scaledDuration, 1 * this.tileDurationRatio)
            : scaledDuration;

        return {
            midi: note.midi,
            name: note.name,
            startTime: note.startTime,
            endTime: note.startTime + displayDuration,
            duration: displayDuration,
            velocity: note.velocity,
            track: trackIndex,
            hit: false,
            missed: false,
            accumulatedHoldTime: 0,
            isBeingHeld: false,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            originalDuration: note.duration,
            hitWindowOffset: 0,
            sustainRequired: true
        };
    }

    mergeTiedNotes(notes) {
        notes.sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);

        let i = 0;
        let merged = 0;

        while (i < notes.length - 1) {
            const current = notes[i];
            const next = notes[i + 1];

            const samePitch = current.midi === next.midi;
            const isTied = current.tieType === 'start' && next.tieType === 'stop';
            const gap = next.startTime - current.endTime;

            if (samePitch && (isTied || Math.abs(gap) < 0.001)) {
                current.endTime = Math.max(current.endTime, next.endTime);
                current.duration = current.endTime - current.startTime;
                current.tieType = next.tieType === 'stop' ? null : next.tieType;
                current.velocity = Math.max(current.velocity, next.velocity);
                notes.splice(i + 1, 1);
                merged++;
            } else {
                i++;
            }
        }

        notes.forEach(n => delete n.tieType);

        if (merged > 0) {
            console.log(`Merged ${merged} tied notes, ${notes.length} remaining`);
        }
    }

    pitchToMidi(step, alter, octave) {
        const stepToSemitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        const semitone = stepToSemitone[step] || 0;
        return (octave + 1) * 12 + semitone + (alter || 0);
    }

    midiToNoteName(midi) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midi / 12) - 1;
        return noteNames[midi % 12] + octave;
    }
}
