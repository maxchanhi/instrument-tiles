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

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.0.0 or higher)
- [uv](https://github.com/astral-sh/uv) (for running Python scripts if needed)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/maxchanhi/instrument-tiles.git
   cd instrument-tiles
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Visit `http://localhost:3000` (or the port specified in your console) to play!

## How to Play

1. **Upload MIDI File** - Click the "Upload MIDI File" button to select your MIDI file.
2. **Connect Microphone** - Click "Connect Mic" to enable pitch detection.
3. **Preview Pitch** - (Optional) Click "Preview Pitch" to hear the starting note.
4. **Adjust Speed** - Use the slider to set a comfortable practice speed.
5. **Tile Duration** - Adjust how long the notes appear visually.
6. **Start Game** - Click the "Start Game" button.
7. **Sustain Your Pitch** - When a note hits the red judgment line, play and **hold** the corresponding pitch on your instrument for the entire tile duration to get a **PERFECT HOLD**!
8. **Feedback** - Watch for visual feedback and your score.

## Tech Stack

- **Node.js & Express** - Backend server
- **HTML5 Canvas** - Game rendering with "Neon Symphony" theme
- **Web Audio API** - Pitch detection and audio synthesis
- **Native JavaScript** - Core game logic
- **CSS3** - Modern UI with glassmorphism and neon effects

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

You can adjust game parameters directly in the UI or in `game.js`:

### UI Controls
- **Speed** - Playback speed slider (0.2x to 2.0x, default 1.0x)
- **Note Speed** - Tile falling speed (pixels/sec, default 150)
- **Tile Duration** - Display duration of tiles (beats)
- **Count-In Beats** - Number of metronome beats before playback starts (default 2, auto-adjusts for compound time)
- **Tuning Offset** - Pitch detection tuning offset in cents

### Key Code Defaults
```javascript
// Note falling speed (pixels/sec)
this.noteSpeed = 150;

// Hit timing windows (ms)
this.hitWindow = {
    perfect: 80,    // Perfect timing window
    good: 150,      // Good timing window
    miss: 200       // Miss timing window
};

// Time signature defaults (auto-detected from MIDI)
this.beatsPerBar = 2;
this.metronomeBeatUnit = 1; // 1 for simple time, 1.5 for compound (6/8, 9/8, 12/8)
```

### Judgment System (Sustain-Based)

| Rating | Sustain % | Points |
|--------|-----------|--------|
| PERFECT | ≥ 80% | 150 |
| GOOD | ≥ 50% | 75 |
| OK | ≥ 20% | 25 |
| MISS | < 20% | 0 |

Short notes (< 0.3s duration) are judged on pitch only — any hold is PERFECT, no hold is MISS.

### Responsive Canvas
- Canvas height auto-adjusts: 45vh on tablets, 40vh on phones, 35vh on very small screens
- Tile minimum width: 2px (ensures visibility on narrow screens)

### Tile Colors (Chroma-Notes / Boomwhacker)
| Note | Color |
|------|-------|
| C | Red |
| D | Orange |
| E | Yellow |
| F | Green |
| G | Light Blue |
| A | Dark Blue |
| B | Purple |

Sharp/flat variants use darker shades of the natural note color.



**Happy Practicing!** 🎶
