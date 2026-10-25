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

## Guarded-removal confirm target (`remove_confirm_check.js`)

One viewport per run, on a freshly loaded demo session (the check removes Drums, then Undo puts it
back, so reload before the next size):

```bash
agent-browser open http://localhost:3102
agent-browser click '[role="dialog"] button'      # start the demo; the track list is inert behind the gate
agent-browser set viewport 800 520
agent-browser eval --stdin < remove_confirm_check.js
agent-browser open http://localhost:3102           # fresh session
agent-browser click '[role="dialog"] button'
agent-browser set viewport 320 568
agent-browser eval --stdin < remove_confirm_check.js
```

It takes the centre of the unarmed Remove button and taps twice at exactly that point: the first tap
must only arm, the point must still hit the armed button (Clear steps is hidden while arming, so the
header cannot wrap and slide the confirmation out from under the pointer), the second tap must remove
the track, and the drum pattern must never be cleared. It also waits out the 3 s arming timeout and
asserts Clear comes back with the pattern unchanged. With Clear left visible the same check fails with
*"the tap point hits \"Clear steps\" instead of the confirm button"*. After the removal it asserts the
status line ("Track removed. Undo restores it.") and that Undo brings the Drums track, pattern, slot
and selection back with "Undone.".

## Built-in track cap recovery (`cap_recovery_check.js`)

One viewport per run, on a freshly started demo (it fills the cap, so reload before the next size):

```bash
agent-browser open http://localhost:3102
agent-browser click '[role="dialog"] button'      # start the demo and render the tracks
agent-browser set viewport 390 844
agent-browser eval --stdin < cap_recovery_check.js
```

It fills the eight-track cap with empty loops, removes the built-in Keys track at that cap, and
refills the slot with another empty loop. Undo must then stay on the stack with "Free a track slot,
then undo again." and the count must stay at eight. It frees the slot by removing the filler—an
undoable removal—and asserts the waiting step applies first: Keys returns with its exact state,
rendered buffer, original slot and selection, the freeing removal remains undoable, and a further
Undo is cap-blocked rather than bypassing the cap. Run it at 800×520, 390×844 and 320×568.

## Fake microphone (`make_tone.py`)
`python3 make_tone.py tone.wav` writes a 48 kHz mono beep file (80 ms every 500 ms). Launch Chromium
with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
--use-file-for-fake-audio-capture=/abs/path/tone.wav --disable-features=AudioServiceSandbox --mute-audio`
(without the sandbox flag the audio service cannot read the file and the fake mic is silent), choose Mic,
record a take, and check the beep spacing in `window.__loopcraft.debug.buffer(id)`.
