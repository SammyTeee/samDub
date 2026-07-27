# Dubstation

Dubstation is a focused Windows performance deck for live dub-style manipulation.

## Run it

1. Install Node.js 20+.
2. Open PowerShell in this folder.
3. Run `npm install` once.
4. Run `npm start`.

You can load a local WAV/MP3/OGG, play it, ride the tempo, turn the low-pass filter, throw feedback delay, add space/crush, fire the siren, and trigger the eight built-in one-shots with Q/W/E/R and A/S/D/F.

For a MIDI controller, enable MIDI learn, click a control, and move a knob/fader or press a pad. MIDI learn currently maps incoming CC values to the selected control during the active session.

## Next useful build steps

- Add saved projects and a user sample folder for replacing the built-in synth one-shots.
- Add a second synced deck and quantised loop/cue points.
- Package with Electron Forge into an installer and add a Windows audio-device selector.
