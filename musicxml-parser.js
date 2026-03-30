
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

                // Calculate measure start in beats
                const measureStart = currentBeat;

                // Process all elements in measure order (notes, rests, backup, forward)
                let noteOffset = 0; // offset within measure in divisions
                let lastNoteTime = -1; // track last non-chord note time for chord handling

                // Process child elements in document order
                Array.from(measure.children).forEach(child => {
                    if (child.tagName === 'attributes') {
                        // Update divisions from attributes
                        const divEl = child.querySelector('divisions');
                        if (divEl) {
                            const newDiv = parseInt(divEl.textContent);
                            if (!isNaN(newDiv) && newDiv > 0) this.divisions = newDiv;
                        }
                        // Update time signature
                        const beatsEl = child.querySelector('beats');
                        const beatTypeEl = child.querySelector('beat-type');
                        if (beatsEl && beatTypeEl) {
                            this.timeSignature.numerator = parseInt(beatsEl.textContent);
                            this.timeSignature.denominator = parseInt(beatTypeEl.textContent);
                        }
                    } else if (child.tagName === 'note') {
                        const isRest = child.querySelector('rest') !== null;
                        const isChord = child.querySelector('chord') !== null;

                        // Get duration in divisions
                        const durationEl = child.querySelector('duration');
                        let durationDivisions = durationEl ? parseInt(durationEl.textContent) : 0;
                        if (isNaN(durationDivisions) || durationDivisions <= 0) {
                            durationDivisions = this.divisions;
                        }
                        const durationBeats = durationDivisions / this.divisions;

                        if (!isRest) {
                            // Get pitch
                            const pitchEl = child.querySelector('pitch');
                            if (pitchEl) {
                                const step = pitchEl.querySelector('step')?.textContent || 'C';
                                const alter = pitchEl.querySelector('alter')?.textContent || '0';
                                const octave = pitchEl.querySelector('octave')?.textContent || '4';
                                const midi = this.pitchToMidi(step, parseInt(alter), parseInt(octave));
                                const name = this.midiToNoteName(midi);

                                // Calculate start time
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
                                    tieType
                                });
                            }
                        }

                        // Advance offset (unless it's a chord note)
                        if (!isChord) {
                            noteOffset += durationDivisions;
                        }
                    } else if (child.tagName === 'backup') {
                        // Move position backward
                        const durEl = child.querySelector('duration');
                        if (durEl) {
                            const backup = parseInt(durEl.textContent);
                            if (!isNaN(backup)) noteOffset = Math.max(0, noteOffset - backup);
                        }
                    } else if (child.tagName === 'forward') {
                        // Move position forward
                        const durEl = child.querySelector('duration');
                        if (durEl) {
                            const fwd = parseInt(durEl.textContent);
                            if (!isNaN(fwd) && fwd > 0) noteOffset += fwd;
                        }
                    } else if (child.tagName === 'direction') {
                        // Check for tempo marking
                        const tempoEl = child.querySelector('per-minute');
                        if (tempoEl) {
                            const tempo = parseFloat(tempoEl.textContent);
                            if (!isNaN(tempo) && tempo > 0) this.bpm = tempo;
                        }
                    }
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
            if (notes.length > 0) {
                console.log('First 5 notes:', notes.slice(0, 5).map(n => ({
                    name: n.name,
                    start: n.startTime.toFixed(3),
                    end: n.endTime.toFixed(3),
                    duration: n.duration.toFixed(3)
                })));
            }
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
