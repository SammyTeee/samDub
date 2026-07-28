# samDub

samDub is a focused desktop workstation for live dub-style performance. It is designed for a maximized 1920×1080 window and keeps the playable controls immediate while putting deeper shaping in Settings.

## Run it

Double-click `run-samDub.bat`, or run:

```powershell
npm install
npm run setup-electron
npm start
```

The BAT file handles the one-time Electron setup automatically. The app does not hot-reload: close and reopen it after changing source files.
`run-dubstation.bat` remains as a compatibility alias for older shortcuts.

## Package it

Build the Windows x64 installer locally:

```powershell
npm ci
npm run dist:win
```

The installer creates a `samDub` Start Menu shortcut and keeps the app's library and settings in the current user's writable application-data folder.

The Intel Mac DMG and ZIP are built on GitHub's `macos-15-intel` runner:

```powershell
npm run dist:mac:intel
```

Release packages are currently unsigned. Windows SmartScreen or macOS Gatekeeper may therefore ask the user to confirm the app.

## Site

The minimal product page lives in `site/samDub/` and is published at [sam.taylor.org.uk/samDub/](https://sam.taylor.org.uk/samDub/).
Versioned Windows x64 and Intel Mac packages, plus their SHA-256 manifests, are published in the [v0.5.0 GitHub release](https://github.com/SammyTeee/samDub/releases/tag/v0.5.0).

## Performance workflow

- Add or drop one or more local WAV, MP3, OGG, FLAC, M4A, AAC or AIFF files. Batch imports enter the library together.
- samDub draws the real waveform, estimates BPM, and overlays a confidence-aware approximate beat grid.
- Added tracks are remembered with their original path. Embedded Title and Artist tags are preferred when available, with a filename fallback.
- Long track titles scroll only when they overflow, so short names stay still.
- Filter, echo, space and grit remain direct macro controls. BYPASS ALL is a true dry signal path.
- Turn the single BUILD knob to close the filter and raise space together; press DROP or Enter for an immediate release.
- Echo has Slap, Dub and Deep characters. Dub and Deep timing follows the confidently analyzed BPM of the audible deck.
- Enable Advanced effect controls in Settings for exact echo time, feedback, tone, filter resonance and space decay.
- A playing Deck A is protected. Adding, dropping or selecting another track prepares it on Deck B; use the crossfader, then TAKE B to promote it cleanly.
- Click anywhere on the waveform to seek, whether paused or playing.
- REC SET captures the limited master output. Cancelling Save keeps the take ready, and samDub warns before closing with an unsaved take.
- The header meter is driven by the real stereo output, and the master limiter catches unexpected feedback peaks.
- MASTER SPECTRUM spans the stage beneath the siren and trigger bank. It uses the real post-limiter stereo signal for display-synced logarithmic bars and peak holds, with a seven-blade weed leaf kept as a quiet watermark.
- Removed library items can be restored immediately with Undo or Ctrl+Z.
- Fire the siren with Space and the eight one-shots with Q/W/E/R and A/S/D/F.
- MIDI learn can map Filter, Echo, Build, or an exact individual trigger pad, and reconnects saved devices when available.
- Xbox/XInput-compatible controllers are plug-and-play: RT controls BUILD/DROP, LB/RB hold the siren/echo throw, the sticks shape Filter/Echo, A/B/X/Y and the D-pad fire all eight pads, and Menu/View control transport.

Beat analysis is intentionally lightweight and offline. Percussive material should produce a useful grid; silence, ambient material and uncertain rhythms are labelled honestly instead of being given a fabricated tempo.
