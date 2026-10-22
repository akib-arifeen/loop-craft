# LoopCraft

A multi-track looper that runs in the browser. Press play and a synthesized demo session starts. You can then edit the drum pattern, mix and effect each track, record loops from the on-screen pads or a microphone, and export the result as a WAV file.

No samples, no audio libraries, no server. Every sound is synthesized with the Web Audio API, and the timing runs entirely on the audio clock.

## What you can do

- **Hear it straight away, with no microphone.** One tap starts a four-bar demo in A minor (Am7 · Fmaj7 · Cmaj7 · G6) with synthesized drums, bass and keys.
- **Edit the groove.** There's a 16-step drum grid, preset bass and keys patterns, tempo from 60 to 180 BPM, and loops of 1, 2 or 4 bars.
- **Record loops.** Recording is quantised to the loop: it starts on the next loop boundary and captures exactly one pass. The source is either the eight-pad instrument (keys A S D F · H J K L) or a microphone. Recording onto a track that already has audio overdubs it. Undo and redo cover recordings, clears and pattern edits.
- **Mix.** Each track has volume, pan, mute and solo, plus a DJ filter, drive, and sends to a tempo-synced delay and a convolution reverb.
- **Export a WAV file.** The export is rendered offline through the same graph you hear, and the file loops seamlessly in other software.
- **Share a beat.** The tempo, patterns and mix are encoded in the URL hash.

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

Unit tests use Node's built-in runner with no dependencies. There are 159 of them, covering the timing math, DSP helpers, WAV encoder, share codec, the engine's command API and input validation, and the recorder worklet (run in a Node VM with a stub processor), including seeded property and fuzz tests:

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
public/worklets/recorder.js   AudioWorklet that captures exact frame windows
components/         React UI (CSS Modules, no UI library)
tests/              node --test suites for the pure modules
```

This project started as a UI prototype with no audio engine. It was rebuilt from scratch in October 2026.
