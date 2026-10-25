# Verification probes

Independent of the app code: Python (stdlib only) recomputes the expected numbers; the browser side
only reads what a listener would hear. Run from this folder with the dev or production server up
(`agent-browser` drives headless Chromium).

## Loop drift (`drift_setup.js`, `analyze_drift.py`, `ref_timing.py`)
1. `agent-browser --args "--mute-audio" open http://localhost:3102`, click "Play the demo". For a clean
   signal, set up a kick-only loop on `window.__loopcraft`: `stop()`, `setBars(1)`, `setBpm(97)`,
   `clearTrack("drums")`, `toggleStep("drums","kick",0)`, solo drums, delay/reverb sends 0, then `play()`.
2. `agent-browser eval --stdin < drift_setup.js` attaches an AudioWorklet to the master output
   that logs the absolute frame of every onset.
3. Let it play N loops, then dump `window.__probe.dump()` together with bpm, bars, sampleRate,
   loopFrames and startFrame into a JSON file (keys `bpm bars sampleRate loopFrames startFrame onsets`).
4. `python3 analyze_drift.py drift.json` asserts the engine's loopFrames equals the reference
   (`ref_timing.py`) and prints the max deviation of every kick from first + k*L (expected 0 samples).

## WAV export (`verify_wav.py`)
1. In the app, press Export WAV for a known bpm / bars / loops.
2. `python3 verify_wav.py export.wav <bpm> <bars> <loops>` asserts:
   - header and frame count == loops x L, no tail (L from `ref_timing.py`)
   - peak, rms and clipped-sample count
   - WRAP: last pass vs first pass at the same offset (max |diff|), with a one-sample-shift control
     that must differ hugely
   - pass 2 vs pass 3 at the same offset (when loops >= 3), same control

## Narrow-viewport header (`viewport_check.js`)

One viewport per run; the script drives both tempos itself, so no audio start is needed.

```bash
agent-browser open http://localhost:3102
for size in "320 568" "390 844" "420 700" "800 520"; do
  agent-browser set viewport $size
  agent-browser eval --stdin < viewport_check.js
done
```

It sets 92 and 180 BPM through `window.__loopcraft.setBpm` and asserts, per tempo: one header row at
≥720 px and two below, the WAV button still in the first row (a third row is what a wrapped header
looks like), no horizontal page overflow, tempo steps ≥44 px (≥40 px below 332 px, where a
three-digit tempo needs the room) and a tempo numeral that is not clipped. It restores the tempo and
throws on failure: `PASS {...}` means the header survived a three-digit tempo at that width.

## Fake microphone (`make_tone.py`)
`python3 make_tone.py tone.wav` writes a 48 kHz mono beep file (80 ms every 500 ms). Launch Chromium
with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
--use-file-for-fake-audio-capture=/abs/path/tone.wav --disable-features=AudioServiceSandbox --mute-audio`
(without the sandbox flag the audio service cannot read the file and the fake mic is silent), choose Mic,
record a take, and check the beep spacing in `window.__loopcraft.debug.buffer(id)`.
