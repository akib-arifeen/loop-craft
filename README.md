# LoopCraft

A multi-track looper that runs in the browser. Press play and a synthesized demo session starts. You can then edit the drum pattern, mix and effect each track, record loops from the on-screen pads or a microphone, add a ready-made sample loop that fits your key, and export the result as a WAV file.

No third-party audio files, no audio libraries, no server. Every sound is synthesized with the Web Audio API (including the sample shelf), and the timing runs entirely on the audio clock.

## What you can do

- **Hear it straight away, with no microphone.** One tap starts a four-bar demo in A minor (Am7 · Fmaj7 · Cmaj7 · G6) with synthesized drums, bass and keys.
- **Edit the groove.** There's a 16-step drum grid, preset bass and keys patterns, tempo from 60 to 180 BPM, and loops of 1, 2 or 4 bars. The chord lane holds up to eight bars; slots outside the current loop are disabled and labeled until you lengthen it, and their chords are kept either way.
- **Record loops.** Recording is quantised to the loop: it starts on the next loop boundary and captures exactly one pass. The source is either the eight-pad instrument (keys A S D F · H J K L) or a microphone. Recording onto a track that already has audio overdubs it. Undo and redo cover recordings, clears, pattern edits, and removing a loop or sample track (a removed recording is restored with its audio). Tempo and loop length lock while recorded loops exist, and the disabled controls say why.
- **Mix.** Each track has volume, pan, mute and solo, plus a DJ filter, drive, and sends to a tempo-synced delay and a convolution reverb.
- **Export a WAV file.** The export is two loop passes, rendered offline through the same graph you hear, and the file loops seamlessly in other software. Its name states the tempo, bar count, loop count and length (for example `loopcraft-92bpm-4bars-2loops-21s.wav`).
- **Add samples that fit the key.** A searchable shelf of loops with stated keys, filtered and sorted against the project key. A clashing loop says exactly which note is outside the key before you add it, and its row is tinted and labelled "Out of key".
- **Share a beat.** The tempo, patterns, samples and mix are encoded in the URL hash. Recorded loops stay in this browser and are never included in the link.
- **Play/pause with Space.** Space always drives the transport when shortcuts are on, even if a button still has focus; Enter activates focused buttons. Text fields, sliders and selects keep Space for themselves, and the start gate keeps it until audio starts.
- **Hand the session to an agent.** The whole project is a small documented JSON document: read it, edit it, paste it back, with no account and no server.

## Samples that respect your key

The sample shelf (Browse samples, under the track list) holds 16 loops: drums, bass, chord stabs and arps. Each one is rendered by LoopCraft's own instrument synths from stored note data, so there is nothing to download and no licence to worry about. What makes the shelf useful is that the metadata is honest:

- **A key is only shown when the pack states it.** A loop's key is written down when the loop is authored, and a unit test asserts every pitch of a keyed loop really is inside that key. The app never detects or guesses a key.
- **Drums state "no pitch", not a guessed key.** They fit any key because there is no key to clash with.
- **Compatibility comes from the notes.** When the project key is A minor, the shelf reads each loop's actual pitch classes against the A minor scale and sorts the list into three groups: in key, always fits (drums), and clashes. A clash names the exact offender: "Contains F♯, which is not in A minor."
- **Filters stay musical.** Type (drums / bass / chords / arp), key (including "Fits A minor"), mode, and free-text search over names and tags.
- **A clashing loop is still available, but never quietly.** Its row is marked, the reason is on the row, and its button says "Add anyway".
- **Preview before you add.** Each row's Preview button plays the loop through the same synth and mixer on the audio clock, without adding a track. One loop previews at a time: pressing Stop, previewing another loop, adding a sample, closing the shelf, filtering the row away, replacing the document or suspending the audio context stops it. A preview never touches the project JSON or the undo history. It needs a running audio context; if the browser has paused audio, the shelf says so and offers Resume instead of letting Preview fail silently behind the dialog.

A sample is fixed-pitch audio rendered from its own notes, so it deliberately does **not** follow key or chord changes. Change the key and the track detail panel tells you whether the loop still fits, and why not. Recorded loops (mic, pads) never get a key label at all, because nothing states one.

## Read and write the project from an agent

There is no backend, so "integration" means a file and a small runtime API, not an account. The header `{ }` button shows the project JSON, copies or downloads it, and loads a document you paste back. The same shape is available to a script driving the page:

```js
window.__loopcraft.exportProject()            // documented JSON string
window.__loopcraft.importProject(json)        // { ok: true } or { ok: false, error }
window.__loopcraft.getDocument()              // the engine's serialisable document
window.__loopcraft.auditionSample("keys-am7-rhodes") // preview a shelf loop; stopAudition() ends it
window.__loopcraft.dispatch({ type: "setChord", index: 1, roman: "IVmaj7" })
window.__loopcraft.onCommand(events => ...)   // every applied edit, with seq/origin
window.__loopcraft.getClock()                 // loop frames, start time, heard step
```

The document is deliberately small:

```json
{
  "format": "loopcraft-project",
  "version": 1,
  "tempo": 92,
  "bars": 4,
  "key": { "tonic": "A", "mode": "aeolian" },
  "chordLane": ["i7", "VImaj7", "IIImaj7", "VIIadd6"],
  "metronome": false,
  "masterVolume": 0.9,
  "tracks": [
    { "id": "drums", "name": "Drums", "kind": "drums", "volume": 0.85, "pan": 0, "muted": false, "soloed": false,
      "fx": { "filter": 0, "drive": 0.1, "delay": 0, "reverb": 0.08 },
      "drumPattern": { "kick": [0, 2, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 0], "snare": ["…"], "clap": ["…"], "hat": ["…"] } },
    { "id": "bass", "name": "Bass", "kind": "bass", "patternId": "bass-pulse", "volume": 0.8, "pan": 0, "muted": false,
      "soloed": false, "fx": { "filter": -0.15, "drive": 0.25, "delay": 0, "reverb": 0 } },
    { "id": "sample-1", "name": "Am7 Rhodes", "kind": "sample", "sampleId": "keys-am7-rhodes", "volume": 0.72, "pan": 0.15,
      "muted": false, "soloed": false, "fx": { "filter": -0.1, "drive": 0, "delay": 0.2, "reverb": 0.3 } }
  ]
}
```

Rules that make it safe to hand to an agent:

- `key` plus `chordLane` (one Roman numeral per bar, 1 to 8) is the harmony. Bass and keys patterns are harmony-relative, so they follow it.
- A bass or keys `patternId` must name a preset of that track's kind. A cross-family id (a keys track asking for a bass part, or the reverse) or an unknown id is rejected by project import, share links and `setPattern` alike, with no partial change.
- Track ids stay unique. If an incoming project or share code reuses a recorded loop's id, the incoming track gets a deterministic suffix (`-p` for a project, `-s` for a share, then `-2`, `-3`, …), so the recorded loop keeps its id and the exported project always re-imports.
- `kind: "sample"` loops are absolute: `sampleId` names a stated loop from `lib/samples/library.ts`. Unknown ids are rejected rather than silently dropped.
- Recorded audio is local-only and never appears in the file; importing a project leaves the recorded tracks you already have untouched.
- Numbers are clamped (`tempo` 60 to 180, `bars` snaps to 1, 2 or 4), every structural error rejects the whole document with one readable sentence, and nothing is half-applied. `lib/audio/project.ts` is the source of truth and has its own test suite.

### Strudel and AGPL

Strudel is the natural text-pattern complement to this project, so I evaluated it rather than adding it. **Strudel is AGPL-3.0.** Vendoring or bundling its runtime into LoopCraft would make the distributed app a derivative work and require releasing the whole app's source under AGPL, which is not acceptable for this proprietary codebase. An iframe or link out to strudel.cc keeps the code separate but still leaves the UX split across two apps.

The recommendation, not yet built, is a **data-only bridge**: export the chord lane and patterns as Strudel pattern text for copy-paste (and parse simple Strudel text back into the same project JSON). Text that a user copies between tools is not linked code, so there is no AGPL contamination. It also matches the agent-first idea better than an embedded editor.

## How it works

### One timing model: integer-frame loops on the audio thread

The loop length is an integer number of sample frames, computed once from tempo, bar count and sample rate. Every grid step, loop boundary and capture window is derived from that integer.

Each track holds exactly one buffer of that length, which plays through a looping `AudioBufferSourceNode`. The audio thread does all the counting. No `setTimeout` restarts or schedules a loop, so a busy or frozen main thread can't make a track drift.

Synthesized tracks are rendered into their loop buffers with an `OfflineAudioContext`. Notes that ring past the loop end, such as a hi-hat tail, are folded back onto the loop start, so the seam doesn't click. Editing a step re-renders the buffer and crossfades to it (6 ms) at the same loop position.

### Recording on exact frames, with latency compensation

An `AudioWorklet` recorder slices the input by absolute context frame (`currentFrame`), so a capture covers exactly one loop pass.

The capture window is shifted later by the round-trip latency:

- **Output latency:** `baseLatency + outputLatency + the master compressor's look-ahead`. This is how long after scheduling a player hears a note.
- **Input latency:** the microphone's reported input latency. It's added only when recording from the mic; pad audio is generated at the moment you press, so only the output part applies.

A ±ms nudge is available for anything the browser misreports. The latencies come from the browser; the compensation has been measured in Chromium only.

### One graph for listening and exporting

`createMixer()` builds the channel strips, send buses and master compressor on any `BaseAudioContext`. The live context and the export's `OfflineAudioContext` use the same function, so the export matches what you heard.

### What measuring turned up

Each of these changed the code:

- **Chromium stops looping some buffer lengths.** A looping `AudioBufferSourceNode` plays one pass and then goes silent when `(length / sampleRate) * sampleRate` rounds up past `length` in double precision. The plain rounded length for the demo (92 BPM, 4 bars, 48 kHz) is 500870 frames, which goes silent after 10.4 s; 500869 loops indefinitely. `loopFrameCount()` now picks the nearest length that round-trips exactly, never more than a few frames from the exact value.
- **Oversampling skewed tracks against each other.** A `WaveShaperNode` with `oversample = "2x"` delays its track by 128 frames, but only while drive is active. Driven tracks therefore played 2.7 ms after clean ones. The shaper now runs without oversampling, so every channel has the same latency.
- **The compressor's look-ahead needed compensating.** The master `DynamicsCompressorNode` delays everything by 288 frames (6 ms at 48 kHz). The metronome now goes through the same bus. The delay is included in record latency and the playhead, and it's trimmed from the start of exported files.

## Verification

Measured in headless Chromium, using a probe `AudioWorklet` tapped on the master output that logs the absolute frame of every onset. The reference loop lengths and the WAV checks come from a separate Python implementation, not from this code.

| What | Result |
|---|---|
| Time to sound, first visit, no mic (production build) | start screen 1.1–1.7 s after opening the page; first sound 0.8–1.3 s after the click across repeat runs (3.4 s once, on a cold browser start) |
| Loop drift, 97 BPM / 1 bar (118762 frames) | three runs (26, 25 and 24 loops): every kick-to-kick interval exactly 118762 frames, max deviation **0 samples** |
| Same runs under stress (live buffer swaps, a 20-step drive sweep, an agent-dispatched edit, two 1.5 s main-thread freezes) | still 0 samples |
| Latency to the output: clean track, driven track, metronome | 288–289 frames on every path (uniform) |
| Mic recording (Chromium fake device fed a 0.5 s beep file) | buffer exactly one loop long. 17 of 20 beep intervals exactly 24000 frames; the other 3 are 24276 and fall exactly every 4.0 s, where Chromium's fake device wraps its 4 s test file (adding 276 frames each time). Between wraps the capture is frame-exact |
| WAV export | 16-bit stereo PCM; frame count exactly loops × L (no tail); plays in `afinfo` and `ffprobe`; 0 clipped samples |
| Export loop seam | a 2-loop export from the WAV button, last pass against first pass at the same offset (the wrap a DAW plays): max difference 436 of 32768. Shifting by one sample: 26871 |

The probes behind these rows are in `scripts/verify/`.

### Re-measured on the key-aware sample lane (2026-10-24, production build, headless Chromium)

The same probe scripts, run against this branch, from a real click on "Play the demo":

| What | Result |
|---|---|
| Time to sound | **1358 ms** after the click (context `running`, master peak 0.71, every synth track metering above zero) |
| Loop drift, 97 BPM / 1 bar (118762 frames) | 22 kick onsets = **21 loops**, every interval exactly **118762 frames**, max deviation **0 samples** |
| Fake-mic recording (Chromium fake device fed a 0.5 s beep file) | mic granted; capture is exactly one loop, **500869 frames**; 21 beeps, spacing **24000 frames** except at the fake device's 4.0 s file wrap (**24276**, same as the earlier measurement) |
| WAV export | 2 loops × 500869 = **1001738 frames** exactly, 16-bit stereo 48 kHz, peak 0.787, **0 clipped samples**; export seam wrap last vs first pass max diff **163**, one-sample-shift control **8167** |
| Sample shelf metadata | unit tests assert every keyed loop's notes are inside its stated key; 9 in key / 4 always-fit / 3 clashing loops for the demo's A minor, groups and reasons rendered in the shelf |
| Project JSON | 2453 characters for the demo session plus a sample; UI shows it, loads an edited document (tempo 120, C ionian accepted), and rejects a malformed one with "Expected format \"loopcraft-project\"." while leaving the session untouched |

Browser probes at 1280×800 and 390×844 found no console or page errors, no horizontal overflow on the phone layout, and the two-row phone header still intact.

### Interaction fixes re-measured (2026-10-25, production build, headless Chrome)

Driven through the real UI and the documented `window.__loopcraft` API; media/audio were the browser's own synthesized engine (no external uploads or paid calls):

| What | Result |
|---|---|
| Space with focus on a control | Mouse- or keyboard-focused "Mute Drums": Space toggles playback (`true → false → true`) and leaves mute unchanged; Enter still activates the button. Space on a select keeps the select's native behaviour; the start gate still starts with Space |
| Chord popover | Initial focus lands on the first suggestion (a `BUTTON` inside the dialog), a global `2` does not change the selected track, Space activates the suggestion without touching transport, Escape closes it even after focus is blurred, and focus returns to the bar |
| Loop-length lock | All three choices are `aria-disabled` with a title and `aria-describedby`; tapping "1 bar" leaves the loop at 4 bars, shows "Loop length is locked while recorded loops exist. Clear the recorded loops to change it." and emits no edit command; the reason is visible at desktop width, and a lock icon marks the group ("locked" caption where the header has room) |
| Recorded-loop removal | Remove Loop A → Undo restores the track in its slot, the selection, `tempoLocked: true`, and the exact 500869-frame buffer; Redo removes it again |
| WAV export | Clicking the button downloads `loopcraft-92bpm-4bars-2loops-21s.wav`; the file is 2 × 500869 = **1001738 frames / 20.8695 s**, 16-bit stereo 48 kHz; the button reads "WAV 21s" and its accessible name states 2 loops of 4 bars at 92 BPM, about 21 seconds |
| Share link | Copying shows a check at the button and "Link copied"; with a recorded loop the status says "Link copied without recorded loops — they stay in this browser." and the share code does not contain `loop-a`; the button's accessible name states the limitation at rest |
| Sample shelf | "3 loops are out of key with A minor; they are marked below." The three clash rows have a red wash and a 4 px red edge (vs the 2 px in-key edge) and read "Out of key" |
| Layout at 1440/1280/1120/960/800/720/400/390/360/320 px | 1 header row at ≥720 px and 2 rows below, no horizontal overflow at any width, no overlapping header controls |
| Touch targets on a 390 px phone | Play/Record/share/WAV/selects/track mute+solo/volume/remove/clear/record source/nudges are 44 px; the dense row-2 icons are 40 px and the BPM ± are 36 px (the 2-row header cannot fit 44 px there) |
| Console | Only the pre-existing `/favicon.ico` 404; no page errors |

The unit suite covers the removal-undo path directly, including restoring an audio buffer and re-locking the tempo. Browser-only checks above (Space, focus, touch sizes, download name) have no DOM test runner in this project.

Unit tests use Node's built-in runner with no dependencies. There are 330 of them, covering the timing math, DSP helpers, WAV encoder, share codec, the engine's command API and input validation, sample audition state, loop and sample removal undo, the recorder worklet (run in a Node VM with a stub processor), the harmony core, the sample library's stated metadata and key compatibility, and the project JSON round-trip and validation, including seeded property and fuzz tests:

```bash
npm test
```

## Run it

```bash
npm install
npm run dev        # http://localhost:3102
npm run build      # production build, type-checked
```

Requires Node 20.9 or newer. Built with Next.js 16, React 19 and TypeScript, with no runtime dependencies beyond those.

## Embedding

LoopCraft works inside a cross-origin iframe:

```html
<iframe src="https://loop-craft-six.vercel.app" allow="autoplay; microphone" width="800" height="520"></iframe>
```

- **Start gate:** audio starts from the first tap inside the frame.
- **Without microphone access:** if the mic isn't delegated or is denied, recording falls back to the pads.
- **Sizes:** the layout fits 800×520 with no scrolling and works on phones down to 320 px wide.

These were tested in a real cross-origin frame. With `allow="autoplay; microphone"`, the mic records inside the frame. Without `microphone`, the Mic option shows "Blocked", recording switches to the pads, and a pads loop records normally. No `X-Frame-Options` or CSP header is sent.

## Extension points

Three small, typed seams, all in `lib/audio/types.ts`, so new capabilities can plug in without reworking the engine:

- **`LoopSource`:** anything that can render one loop buffer. Today the offline synth and recorded audio implement it (`lib/audio/sources.ts`); an external pattern source would implement the same interface.
- **`EngineCommand`, `dispatch()` and `onCommand()`:** every session edit is a command (pad hits, export and start-up are not). UI calls and programmatic calls share one code path: each applied command emits a `CommandEvent`, input is validated, and undoable edits (patterns, recordings, clears) land on the same undo stack whoever made them. `getDocument()` returns the session as JSON.
- **`getClock()`:** tempo, loop length, the AudioContext start time of the loop, and the heard bar, beat and step, for anything that needs to schedule in time with the transport.

## Layout

```
lib/audio/          the engine (framework-free TypeScript)
  types.ts          the contract between engine and UI
  timing.ts         integer-frame loop math
  engine.ts         AudioContext lifecycle, transport, recording, undo
  mixer.ts          channel strips, send buses, master (live and offline)
  render.ts synth.ts  offline loop rendering, synth voices
  exporter.ts wav.ts  offline mixdown, WAV encoder
  share.ts patterns.ts  share-link codec, demo session
  project.ts        documented agent JSON: export, validate, import
lib/samples/
  library.ts        the 16-loop shelf, stated keys and key-compatibility math
public/worklets/recorder.js   AudioWorklet that captures exact frame windows
components/         React UI (CSS Modules, no UI library)
tests/              node --test suites for the pure modules
```

This project started as a UI prototype with no audio engine. It was rebuilt from scratch in October 2026.
