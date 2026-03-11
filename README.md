# 🎵 Instrument Tiles

A web-based pedagogical music game designed for practicing instrument intonation and rhythm. Players can upload MIDI files to generate game tiles, control playback speed, and use real instruments (via microphone) to play the game.

## Features

- ✅ **MIDI File Upload** - Supports standard MIDI file formats (.mid, .midi)
- ✅ **Real-time Pitch Detection** - Play your real instrument to hit the notes
- ✅ **Microphone Integration** - Detects pitch directly from your instrument
- ✅ **Speed Control** - Adjustable playback speed from 0.5x to 2.0x
- ✅ **Falling Notes** - Classic rhythm game visual experience
- ✅ **Judgment System** - Perfect/Good/Miss judgment based on timing and pitch accuracy
- ✅ **Score Statistics** - Real-time display of score, combo, and accuracy
- ✅ **Pitch Preview** - Listen to the pitch of the first note before starting

## Quick Start

### Method 1: Open Directly
Simply open the `index.html` file in your browser.

### Method 2: Use Local Server (Recommended)
You can use Python or Node.js to start a local server:

```bash
# Using Python
python -m http.server 8000

# Or using Node.js
npx http-server

# Then visit http://localhost:8000
```

## How to Play

1. **Upload MIDI File** - Click the "Upload MIDI File" button to select your MIDI file.
2. **Connect Microphone** - Click "Connect Mic" to enable pitch detection.
3. **Preview Pitch** - (Optional) Click "Preview Pitch" to hear the starting note.
4. **Adjust Speed** - Use the slider to set a comfortable practice speed.
5. **Start Game** - Click the "Start Game" button.
6. **Play Your Instrument** - When a note hits the red judgment line, play the corresponding pitch on your instrument.
7. **Feedback** - Watch for visual feedback (Perfect/Good/Miss) and your score.

## Tech Stack

- **HTML5 Canvas** - Game rendering
- **Web Audio API** - Pitch detection and audio synthesis
- **Native JavaScript** - Core game logic (no heavy frameworks)
- **CSS3** - Modern UI design

## Project Structure

```
music_game/
├── index.html          # Main entry page
├── style.css           # Stylesheet
├── game.js             # Core game logic
├── pitch-detector.js   # Microphone pitch detection logic
├── midi-parser.js      # MIDI file parsing logic
└── README.md           # Documentation
```

## Fingering Display (Coming Soon)

The fingering display feature interface is reserved. Once fingering data is ready, it can be added via:

```javascript
// Set fingering data
game.setFingeringData({
    "C4": "Fingering diagram or description",
    "D4": "Fingering diagram or description",
    // ...
});
```

Fingering data can include:
- Fingering charts/images
- Text descriptions
- Fingering animations

## Game Configuration

You can adjust game parameters in `game.js`:

```javascript
// Note falling speed
this.noteSpeed = 300; // pixels/second

// Judgment windows (ms)
this.hitWindow = {
    perfect: 80,    // Perfect judgment
    good: 150,      // Good judgment
    miss: 200       // Miss judgment
};
```

## Browser Compatibility

- ✅ Chrome / Edge (Recommended)
- ✅ Firefox
- ✅ Safari
- ⚠️ Other browsers may need testing for Web Audio API support

## Roadmap

- [ ] Add real audio playback for MIDI backing tracks
- [ ] Implement piano keyboard input support
- [ ] Add instrument-specific fingering displays (Flute, Violin, etc.)
- [ ] Support multiple MIDI tracks
- [ ] Skin/Theme system
- [ ] Save game records/high scores
- [ ] Multiplayer mode

## License

MIT License

## Contributing

Issues and Pull Requests are welcome!

---

**Happy Practicing!** 🎶
