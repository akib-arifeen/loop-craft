# LoopCraft

A multi-track looper that runs in the browser. Press play and a synthesized demo session starts. You can then edit the drum pattern, mix and effect each track, record loops from the on-screen pads or a microphone, add a ready-made sample loop that fits your key, and export the result as a WAV file.

No third-party audio files, no audio libraries, no server. Every sound is synthesized with the Web Audio API (including the sample shelf), and the timing runs entirely on the audio clock.

## What you can do

- **Hear it straight away, with no microphone.** One tap starts a four-bar demo in A minor (Am7 · Fmaj7 · Cmaj7 · G6) with synthesized drums, bass and keys.
- **Edit the groove.** There's a 16-step drum grid, preset bass and keys patterns, tempo from 60 to 180 BPM, and loops of 1, 2 or 4 bars. The chord lane holds up to eight bars; slots outside the current loop are disabled and labeled until you lengthen it, and their chords are kept either way.
- **Record loops.** Recording is quantised to the loop: it starts on the next loop boundary and captures exactly one pass. The source is either the eight-pad instrument (keys A S D F · H J K L) or a microphone. Recording onto a track that already has audio overdubs it. Undo and redo cover recordings, clears, pattern edits, and removing a loop or sample track (a removed recording is restored with its audio). Removing a built-in drums, bass or keys part asks for a second tap, arms a red **"Remove for good?"** that states the loss in its accessible description, and has no undo because this page cannot add one back; the status line confirms the removal. Tempo and loop length lock while recorded loops exist, and the disabled controls say why. Changing either one drops recorded-buffer undo steps, because their audio belongs to the old loop length.
- **Mix.** Each track has volume, pan, mute and solo, plus a DJ filter, drive, and sends to a tempo-synced delay and a convolution reverb.
- **Export a WAV file.** The export is two loop passes, rendered offline through the same graph you hear, and the file loops seamlessly in other software. Its name states the tempo, bar count, loop count and length (for example `loopcraft-92bpm-4bars-2loops-20.8s.wav`); the length is the actual frame count floored to a tenth of a second, so it never promises more than the file contains. Export waits while a tempo or loop-length retime, or a newly added track render, is still pending.
- **Add samples that fit the key.** A searchable shelf of loops with stated keys, filtered and sorted against the project key. A clashing loop says exactly which note is outside the key before you add it, and its row is tinted and labelled "Out of key".
- **Share a beat.** The tempo, patterns, samples and mix are encoded in the URL hash. A recorded loop, including a silent take, stays in this browser and is left out of the link; the share control says whether the session has no recorded loops or how many will be omitted.
- **Play/pause with Space.** Once the audio has started, when shortcuts are on and no app dialog (chords, samples, project JSON) is open, Space drives play/pause from the page or an ordinary button. Text entries, sliders, selects and ARIA radio/switch controls keep their native Space, and the start gate keeps it until audio starts. Enter activates focused buttons. With shortcuts off, single-key shortcuts are native; Cmd/Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y still undo and redo.
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

### Interaction fixes re-measured (2026-10-26, production build, headless Chrome)

Driven through the real UI and the documented `window.__loopcraft` API; media/audio were the browser's own synthesized engine (no external uploads or paid calls):

| What | Result |
|---|---|
| Space contexts | Ordinary button: Space toggles playback (`true → false → true`) and leaves mute unchanged. ARIA loop-length radio: Space selects 2 bars and leaves playback alone. Shortcuts off: Space activates the focused Mute button while Cmd/Ctrl+Z still undoes an engine edit. Select: Space leaves playback alone. Project JSON textarea: Space inserts one character and leaves playback alone. Chord dialog open: Space activates the focused suggestion without touching transport; the start gate still starts with Space |
| Chord popover | Initial focus is the first suggestion; a held Enter that opened it does not repeat into accepting that suggestion (dialog and bar 1 stay); a fresh Enter does accept, and Escape closes and returns focus to the bar. A global `2` does not change the selected track |
| Loop-length and tempo locks | Both groups expose `aria-disabled`, a title and `aria-describedby`; their controls are focusable `aria-disabled` buttons. Tapping "1 bar" leaves the loop at 4 bars and shows the full reason with no edit command; focusing Slower and pressing Enter shows the tempo reason, leaves 64 BPM and emits no command. The full tempo reason is sr-only at every width; the label reads "BPM · locked" where shown (500/960/1120/1280/1440 px), the BPM lock icon is visible at 720 px and up, and the loop-length lock icon is visible at 320/390 px and again at 720–959 px |
| Recorded-loop removal | Remove Loop A → Undo restores the track, selection, `tempoLocked` and its exact 180000-frame buffer (silent take); the status becomes "Undone." rather than the stale removal prompt |
| Removal across a retime | Remove Loop A → set the loop to 2 bars: buffer history is purged synchronously (`canUndo: false`, "Old recorded-audio undo steps were cleared for the new loop length."), Undo is disabled and restores nothing. A forced failed retime and a deliberately mismatched buffer both refuse restoration with an explicit message; the mismatched buffer is never attached |
| Undo status and track cap | Undo/Redo replace the removal prompt with "Undone."/"Redone."; a cap-blocked removal Undo stays on the stack, explains "Free a track slot, then undo again.", and succeeds once a synth track is removed |
| WAV export | 92 BPM/4 bars: `loopcraft-92bpm-4bars-2loops-20.8s.wav`, 1001738 frames / 20.8695 s. 180/4: `...-4bars-2loops-10.6s.wav`, 512000 frames / 10.6667 s. 180/1: `...-1bar-2loops-2.6s.wav`, 128000 frames / 2.6667 s; 64/1 reads `...-1bar-2loops-7.5s.wav`. Durations are floored, never rounded up. During a retime the button is disabled with a wait reason; adding a sample and exporting in the same tick leaves `exportReady: false` and rejects with "A track is still rendering…"; a failed retime keeps export blocked with "The tempo change didn't finish…" |
| Share link | No recording: "No recorded loops are in this session." / "Link copied. No recorded loops to include." A silent take (`hasAudio: false`, 180000-frame buffer) counts: "1 recorded loop will be left out; it stays in this browser." / "Link copied without 1 recorded loop — it stays in this browser." The code omits `loop-a`; the label resets after the check |
| Out-of-key contrast | Computed from the rendered pixels at 1440, 390 and 320 px: meta **6.55:1**, badge **9.86:1**, reason 5.38:1, name 11.85:1, "Add anyway" 7.28:1, group title 4.8:1 — all ≥4.5:1 on the washed row. The three clash rows keep the red wash, 4 px edge and "Out of key" badge |
| Layout with locks at 1440/1280/1120/960/959/900/800/720/500/390/320 px | 1 row at ≥720 px, 2 rows below, `scrollWidth === clientWidth` and no header overlap at every width; the loop-length lock icon is visible at 720–959 px and at 320/390 px, and the BPM label reads "BPM · locked" where shown |
| Console | Only the pre-existing `/favicon.ico` 404; no page errors *(superseded: `app/icon.svg` supplies the icon and the browser no longer asks for the file — see the table below)* |

### Small-window and tap-target fixes re-measured (2026-10-26, production build, headless Chrome)

| What | Result |
|---|---|
| 800×520 record panel | Two full pad rows at **44.8 px** each, no overlap: the grid box used to be 64.8 px tall against 112 px of rows, which spilled the second row **16.8 px** over the keyboard hint. The panel needs no scroll at this size (the pad height carries the 4 px body padding added for focus rings) |
| Shorter than 520 px | The pads grid keeps a two-row floor (44 px minimum), so what cannot fit scrolls inside the record panel instead of covering the hint or the effects row; viewports below ~510 px scroll rather than overlap |
| Tempo steps at 320/340/360/379/380/390/400/414/419/420/440/480/520/600/719 px, at 92 and 180 BPM | BPM − and + measure **44×44** and row 1 still fits: two header rows, `scrollWidth === clientWidth` at every width. Below 332 px (measured: 332 px fits, 331 px wraps to a third row) they take **40×40** with a 15 px numeral, so a three-digit 180 BPM keeps two rows even at 320 px; 332 px and up keep 44 px. The wordmark is visually hidden below 420 px to make the room and returns at 420 px. `scripts/verify/viewport_check.js` re-runs this at any viewport |
| Other phone header sizes | 380–399 px no longer wrap to a third header row |
| Removing a built-in track | Drums: the first tap arms a red-edged, tinted **"Remove for good?"** whose accessible name is `Remove Drums for good` and whose description (via `aria-describedby`) reads "Removing Drums can't be undone, and this synth track can't be added back from this page."; the label measures **4.91:1** on the tint. The second tap removes it, the track name stays readable in the head (the head wraps instead of truncating), and the live status region (`role="status"`, `aria-live="polite"`) announces **"Drums removed. This can't be undone."**; Undo stays disabled and restores nothing. An empty Loop A and a sample track still remove in one tap, keep "Track removed. Undo restores it.", and their Undo still restores them with "Undone." |
| Focus rings in the record panel | The record body carries 4 px padding and the pads block keeps its two-row floor, so a focused control's 2 px outline plus 2 px offset stays inside the scrollport: measured slack ≥0 px at 800×520 (no scroll), 800×500 and 800×480 (scrolled to the end), 390×844 and 320×568 for the first and last pad, the source buttons and the record button |
| Console | Clean at 800×520, 390×844 and 320×568: no page errors and no `/favicon.ico` 404 — `app/icon.svg` supplies the icon and the browser no longer asks for the missing file, which fixes the 404 in the row above |

The unit suite covers the retime/undo ordering directly: a remove → setBars/setBpm → Undo that restores nothing, a failed retime that cannot resurrect old audio, a mismatched buffer rejected with a message, cap-blocked Undo preserving its step, and the export filename/duration arithmetic for 92→180 BPM and 1-bar 180/64 cases.

Unit tests use Node's built-in runner with no dependencies. There are 342 of them, covering the timing math, DSP helpers, WAV encoder, export filename/duration arithmetic, share codec, the engine's command API and input validation, sample audition state, loop and sample removal undo and the removal status message, retime-safe history, export readiness across queued and in-flight renders, the recorder worklet (run in a Node VM with a stub processor), the harmony core, the sample library's stated metadata and key compatibility, and the project JSON round-trip and validation, including seeded property and fuzz tests:

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
