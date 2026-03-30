
class MusicXmlParser {
    constructor(xmlString) {
        this.bpm = 120;
        this.timeSignature = { numerator: 4, denominator: 4 };
        this.divisions = 4; // divisions per quarter note (default)
        this.tracks = [];
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

        console.log(`MusicXML parsed: ${this.tracks.length} parts, ${this.bpm} BPM, ${this.timeSignature.numerator}/${this.timeSignature.denominator}`);
    }

    parsePartwise(doc) {
        const parts = doc.querySelectorAll('score-partwise > part');

        parts.forEach(part => {
            const partId = part.getAttribute('id');
            const notes = [];
            let currentBeat = 0; // position in quarter notes
            this.divisions = 4;

            const measures = part.querySelectorAll('measure');
            measures.forEach(measure => {
                // Update divisions if changed
                const divisionsEl = measure.querySelector('divisions');
                if (divisionsEl) {
                    this.divisions = parseInt(divisionsEl.textContent);
                }

                // Update tempo
                const tempoEl = measure.querySelector('per-minute');
                if (tempoEl) {
                    const tempo = parseFloat(tempoEl.textContent);
                    if (!isNaN(tempo) && tempo > 0) {
                        this.bpm = tempo;
                    }
                }

                // Update time signature
                const beatsEl = measure.querySelector('beats');
                const beatTypeEl = measure.querySelector('beat-type');
                if (beatsEl && beatTypeEl) {
                    this.timeSignature.numerator = parseInt(beatsEl.textContent);
                    this.timeSignature.denominator = parseInt(beatTypeEl.textContent);
                }

                // Calculate measure start in beats
                const measureStart = currentBeat;

                // Process notes in this measure
                let noteOffset = 0; // offset within measure in divisions
                let lastNoteTime = -1; // track last non-chord note time for chord handling

                const noteElements = measure.querySelectorAll('note');
                noteElements.forEach(noteEl => {
                    // Check if rest
                    const isRest = noteEl.querySelector('rest') !== null;

                    // Check if chord (shares start time with previous note)
                    const isChord = noteEl.querySelector('chord') !== null;

                    // Get duration in divisions
                    const durationEl = noteEl.querySelector('duration');
                    const durationDivisions = durationEl ? parseInt(durationEl.textContent) : this.divisions;
                    const durationBeats = durationDivisions / this.divisions;

                    if (isRest) {
                        if (!isChord) {
                            noteOffset += durationDivisions;
                        }
                        return;
                    }

                    // Get pitch
                    const pitchEl = noteEl.querySelector('pitch');
                    if (!pitchEl) return;

                    const step = pitchEl.querySelector('step')?.textContent || 'C';
                    const alter = pitchEl.querySelector('alter')?.textContent || '0';
                    const octave = pitchEl.querySelector('octave')?.textContent || '4';

                    const midi = this.pitchToMidi(step, parseInt(alter), parseInt(octave));
                    const name = this.midiToNoteName(midi);

                    // Calculate start time in beats
                    let startTimeBeats;
                    if (isChord && lastNoteTime >= 0) {
                        startTimeBeats = lastNoteTime;
                    } else {
                        startTimeBeats = measureStart + noteOffset / this.divisions;
                        lastNoteTime = startTimeBeats;
                        noteOffset += durationDivisions;
                    }

                    const endTimeBeats = startTimeBeats + durationBeats;

                    // Get tie info from MusicXML (explicit tied notes)
                    const ties = noteEl.querySelectorAll('tie');
                    let tieType = null;
                    ties.forEach(tie => {
                        tieType = tie.getAttribute('type'); // 'start' or 'stop'
                    });

                    // Get velocity from dynamics if available
                    const velocity = 0.8; // default; MusicXML dynamics are complex

                    notes.push({
                        midi: midi,
                        name: name,
                        startTime: startTimeBeats,
                        endTime: endTimeBeats,
                        duration: durationBeats,
                        velocity: velocity,
                        channel: 0,
                        tieType: tieType // 'start', 'stop', or null
                    });
                });

                // Advance to next measure
                const measureDurationEl = measure.querySelector('duration');
                if (measureDurationEl) {
                    currentBeat += parseInt(measureDurationEl.textContent) / this.divisions;
                } else {
                    // Calculate from time signature
                    currentBeat += this.timeSignature.numerator * (4 / this.timeSignature.denominator);
                }
            });

            // Merge tied notes (explicit MusicXML ties)
            this.mergeTiedNotes(notes);

            this.tracks.push({ notes });
            console.log(`Part ${partId}: ${notes.length} notes`);
        });
    }

    parseTimewise(doc) {
        // Timewise format: measures first, then parts within each measure
        const measures = doc.querySelectorAll('score-timewise > measure');

        // Collect parts and their notes
        const partNotes = {};

        measures.forEach(measure => {
            const parts = measure.querySelectorAll('part');
            parts.forEach(part => {
                const partId = part.getAttribute('id');
                if (!partNotes[partId]) {
                    partNotes[partId] = [];
                }

                // Reuse the note processing logic from partwise
                this.divisions = 4;
                let noteOffset = 0;
                let lastNoteTime = -1;

                const noteElements = part.querySelectorAll('note');
                noteElements.forEach(noteEl => {
                    const isRest = noteEl.querySelector('rest') !== null;
                    const isChord = noteEl.querySelector('chord') !== null;
                    const durationEl = noteEl.querySelector('duration');
                    const durationDivisions = durationEl ? parseInt(durationEl.textContent) : this.divisions;
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
                        tieType
                    });
                });
            });
        });

        Object.entries(partNotes).forEach(([partId, notes]) => {
            this.mergeTiedNotes(notes);
            this.tracks.push({ notes });
        });
    }

    mergeTiedNotes(notes) {
        // MusicXML has explicit tie markers — much more reliable than MIDI
        notes.sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);

        let i = 0;
        let merged = 0;

        while (i < notes.length - 1) {
            const current = notes[i];
            const next = notes[i + 1];

            const samePitch = current.midi === next.midi;
            const isTied = current.tieType === 'start' && next.tieType === 'stop';
            const gap = next.startTime - current.endTime;

            // Merge if:
            // 1. Explicitly tied (tie start/stop), OR
            // 2. Same pitch with no gap (backwards compat for files without tie markup)
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

        // Clean up tieType property (game doesn't need it)
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
