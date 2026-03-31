
class MusicXmlParser {
    constructor(xmlString, tileDurationRatio = 0.8) {
        this.bpm = 120;
        this.timeSignature = { numerator: 4, denominator: 4 };
        this.divisions = 4;
        this.tracks = [];
        this.tiles = [];
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

        const partwise = doc.querySelector('score-partwise');
        const timewise = doc.querySelector('score-timewise');

        if (partwise) {
            this.parsePartwise(doc);
        } else if (timewise) {
            this.parseTimewise(doc);
        } else {
            throw new Error('Unknown MusicXML format');
        }

        this.calculateStats();
        console.log(`MusicXML: ${this.tiles.length} tiles, ${this.bpm} BPM, ${this.timeSignature.numerator}/${this.timeSignature.denominator}, divisions=${this.divisions}`);
    }

    calculateStats() {
        const midiSet = new Set(this.tiles.map(t => t.midi));
        this.uniqueNotes = midiSet.size;

        if (this.tiles.length > 0) {
            const midis = this.tiles.map(t => t.midi);
            this.minMidi = Math.min(...midis);
            this.maxMidi = Math.max(...midis);
        }

        const lastTile = this.tiles.reduce((latest, t) =>
            t.endTime > latest.endTime ? t : latest, { endTime: 0 });
        this.songLength = lastTile.endTime + 2;

        this.tracks = [{ notes: this.tiles.map(t => ({
            midi: t.midi, name: t.name,
            startTime: t.startTime, endTime: t.endTime,
            duration: t.originalDuration, velocity: t.velocity, channel: 0
        }))}];
    }

    parsePartwise(doc) {
        const parts = doc.querySelectorAll('score-partwise > part');

        parts.forEach((part, partIndex) => {
            const notes = [];
            let offsetInDivisions = 0; // current position within the piece, in divisions
            let prevDivisions = this.divisions;

            const measures = part.querySelectorAll('measure');
            measures.forEach((measure, measureIndex) => {
                const measureStartInDivisions = offsetInDivisions;

                // Process children in document order
                Array.from(measure.children).forEach(child => {
                    const tag = child.tagName;

                    if (tag === 'attributes') {
                        const divEl = child.querySelector('divisions');
                        if (divEl) {
                            const d = parseInt(divEl.textContent.trim());
                            if (!isNaN(d) && d > 0) this.divisions = d;
                        }
                        const beatsEl = child.querySelector('beats');
                        const beatTypeEl = child.querySelector('beat-type');
                        if (beatsEl && beatTypeEl) {
                            this.timeSignature.numerator = parseInt(beatsEl.textContent.trim());
                            this.timeSignature.denominator = parseInt(beatTypeEl.textContent.trim());
                        }
                    }
                    else if (tag === 'direction') {
                        // Try <per-minute> first, then <sound tempo="">
                        const pmEl = child.querySelector('per-minute');
                        if (pmEl) {
                            const t = parseFloat(pmEl.textContent.trim());
                            if (!isNaN(t) && t > 0) this.bpm = t;
                        } else {
                            const soundEl = child.querySelector('sound[tempo]');
                            if (soundEl) {
                                const t = parseFloat(soundEl.getAttribute('tempo'));
                                if (!isNaN(t) && t > 0) this.bpm = t;
                            }
                        }
                    }
                    else if (tag === 'note') {
                        const isRest = child.querySelector('rest') !== null;
                        const isChord = child.querySelector('chord') !== null;

                        const durEl = child.querySelector('duration');
                        let durDiv = durEl ? parseInt(durEl.textContent.trim()) : 0;
                        if (isNaN(durDiv) || durDiv <= 0) durDiv = this.divisions;

                        // Advance offset for rests too
                        if (isRest) {
                            if (!isChord) offsetInDivisions += durDiv;
                            return;
                        }

                        const pitchEl = child.querySelector('pitch');
                        if (!pitchEl) {
                            if (!isChord) offsetInDivisions += durDiv;
                            return;
                        }

                        const step = pitchEl.querySelector('step')?.textContent?.trim() || 'C';
                        const alter = pitchEl.querySelector('alter')?.textContent?.trim() || '0';
                        const octave = pitchEl.querySelector('octave')?.textContent?.trim() || '4';
                        const midi = this.pitchToMidi(step, parseInt(alter), parseInt(octave));

                        // Use <accidental> for display name if present (e.g. flat → Bb not A#)
                        const accidentalEl = child.querySelector('accidental');
                        const accidental = accidentalEl?.textContent?.trim();
                        const name = this.pitchToName(step, parseInt(alter), parseInt(octave), accidental);

                        // Start time: use offset for non-chord, reuse last time for chord
                        let noteStartDiv;
                        if (isChord && notes.length > 0) {
                            noteStartDiv = notes[notes.length - 1]._startDiv;
                        } else {
                            noteStartDiv = offsetInDivisions;
                            offsetInDivisions += durDiv;
                        }

                        // Convert divisions to beats
                        const startBeats = noteStartDiv / this.divisions;
                        const durBeats = durDiv / this.divisions;

                        // Tie info
                        let tieType = null;
                        child.querySelectorAll('tie').forEach(tie => {
                            tieType = tie.getAttribute('type');
                        });

                        notes.push({
                            midi, name,
                            startTime: startBeats,
                            endTime: startBeats + durBeats,
                            duration: durBeats,
                            velocity: parseFloat(child.getAttribute('dynamics') || '80') / 127,
                            channel: 0,
                            tieType,
                            track: partIndex,
                            _startDiv: noteStartDiv // internal, for chord handling
                        });
                    }
                    else if (tag === 'backup') {
                        const durEl = child.querySelector('duration');
                        if (durEl) {
                            const b = parseInt(durEl.textContent.trim());
                            if (!isNaN(b)) offsetInDivisions = Math.max(measureStartInDivisions, offsetInDivisions - b);
                        }
                    }
                    else if (tag === 'forward') {
                        const durEl = child.querySelector('duration');
                        if (durEl) {
                            const f = parseInt(durEl.textContent.trim());
                            if (!isNaN(f) && f > 0) offsetInDivisions += f;
                        }
                    }
                });

                // Measure end: jump to next measure boundary based on time signature
                const measureLenDiv = this.timeSignature.numerator * this.divisions;
                offsetInDivisions = measureStartInDivisions + measureLenDiv;
            });

            // Merge tied notes
            this.mergeTiedNotes(notes);

            // Convert to tiles
            notes.forEach(note => {
                delete note._startDiv;
                const tile = this.noteToTile(note, partIndex);
                this.tiles.push(tile);
            });

            console.log(`Part ${partIndex}: ${notes.length} notes`);
            if (notes.length > 0) {
                console.log('First 5:', notes.slice(0, 5).map(n =>
                    `${n.name} ${n.startTime.toFixed(2)}-${n.endTime.toFixed(2)} (${n.duration.toFixed(2)})`
                ));
            }
        });
    }

    parseTimewise(doc) {
        // Fallback: flatten to partwise-like structure
        const partNotes = {};
        const measures = doc.querySelectorAll('score-timewise > measure');

        measures.forEach(measure => {
            measure.querySelectorAll('part').forEach(part => {
                const id = part.getAttribute('id');
                if (!partNotes[id]) partNotes[id] = [];
                part.querySelectorAll('note').forEach(n => {
                    const pitchEl = n.querySelector('pitch');
                    if (!pitchEl) return;
                    const step = pitchEl.querySelector('step')?.textContent?.trim() || 'C';
                    const alter = pitchEl.querySelector('alter')?.textContent?.trim() || '0';
                    const octave = pitchEl.querySelector('octave')?.textContent?.trim() || '4';
                    const durEl = n.querySelector('duration');
                    const durDiv = durEl ? parseInt(durEl.textContent.trim()) : this.divisions;
                    const durBeats = durDiv / this.divisions;
                    const midi = this.pitchToMidi(step, parseInt(alter), parseInt(octave));
                    let tieType = null;
                    n.querySelectorAll('tie').forEach(t => tieType = t.getAttribute('type'));
                    partNotes[id].push({
                        midi, name: this.midiToNoteName(midi),
                        startTime: 0, endTime: durBeats, duration: durBeats,
                        velocity: 0.8, channel: 0, tieType, track: 0
                    });
                });
            });
        });

        Object.entries(partNotes).forEach(([id, notes], idx) => {
            this.mergeTiedNotes(notes);
            // Reconstruct proper start times
            let offset = 0;
            notes.forEach(n => {
                n.startTime = offset;
                n.endTime = offset + n.duration;
                offset += n.duration;
                delete n.tieType;
                this.tiles.push(this.noteToTile(n, idx));
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
            velocity: note.velocity || 0.8,
            track: trackIndex,
            hit: false,
            missed: false,
            accumulatedHoldTime: 0,
            isBeingHeld: false,
            x: 0, y: 0, width: 0, height: 0,
            originalDuration: note.duration,
            hitWindowOffset: 0,
            sustainRequired: true
        };
    }

    mergeTiedNotes(notes) {
        notes.sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);
        let i = 0, merged = 0;

        while (i < notes.length - 1) {
            const cur = notes[i], nxt = notes[i + 1];
            const samePitch = cur.midi === nxt.midi;
            const isTied = cur.tieType === 'start' && nxt.tieType === 'stop';

            // Only merge if explicit tie markers present (MusicXML is explicit about ties)
            if (samePitch && isTied) {
                cur.endTime = Math.max(cur.endTime, nxt.endTime);
                cur.duration = cur.endTime - cur.startTime;
                cur.tieType = nxt.tieType === 'stop' ? null : nxt.tieType;
                cur.velocity = Math.max(cur.velocity, nxt.velocity);
                notes.splice(i + 1, 1);
                merged++;
            } else {
                i++;
            }
        }
        notes.forEach(n => delete n.tieType);
        if (merged > 0) console.log(`Merged ${merged} ties, ${notes.length} notes remain`);
    }

    pitchToMidi(step, alter, octave) {
        const map = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        return (parseInt(octave) + 1) * 12 + (map[step] || 0) + (parseInt(alter) || 0);
    }

    // Convert pitch to display name, using MusicXML accidental if present
    pitchToName(step, alter, octave, accidental) {
        if (accidental === 'flat' || (alter < 0 && !accidental)) {
            return step + 'b' + octave;
        }
        if (accidental === 'sharp' || alter > 0) {
            return step + '#' + octave;
        }
        if (accidental === 'natural') {
            return step + octave;
        }
        if (accidental === 'double-flat') {
            return step + 'bb' + octave;
        }
        if (accidental === 'double-sharp') {
            return step + 'x' + octave;
        }
        return step + octave;
    }

    midiToNoteName(midi) {
        const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return names[midi % 12] + (Math.floor(midi / 12) - 1);
    }
}
