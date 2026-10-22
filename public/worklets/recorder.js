// LoopCraft recorder — AudioWorkletProcessor "loopcraft-recorder".
//
// Protocol (node.port):
//   main → worklet  { type: "capture", id, from, to }   absolute context frames, to exclusive
//   main → worklet  { type: "cancel", id }
//   worklet → main  { type: "done", id, samples: Float32Array(to - from), late: boolean }   (samples transferred)
//   worklet → main  { type: "level", peak }   every 16 render quanta: max |input| since the last report
//
// Frame accounting uses the AudioWorkletGlobalScope `currentFrame` (frame index of sample 0 of
// the current render quantum, the same clock as AudioContext.currentTime * sampleRate), so the
// capture is cut at exact sample positions regardless of main-thread timing.
// Input is downmixed to mono (average of channels). Missing input (no channels) records silence.
// If `from` is already in the past when the first block of the capture is processed, the missed
// frames stay zero and the result is flagged late: true. Only one capture is active at a time; a new "capture"
// replaces the previous one (which is dropped without a "done").
// The node has 1 input and 1 output; the output is silent (the node is connected to a zero-gain
// sink only so the graph keeps pulling it). process() always returns true.

class LoopcraftRecorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.cap = null
    this.peak = 0
    this.blocks = 0
    this.scratch = new Float32Array(128)
    this.port.onmessage = (e) => {
      const m = e.data
      if (m.type === "capture") {
        this.cap = {
          id: m.id,
          from: m.from,
          to: m.to,
          samples: new Float32Array(m.to - m.from),
          late: false,
          started: false,
        }
      } else if (m.type === "cancel") {
        if (this.cap && this.cap.id === m.id) this.cap = null
      }
    }
  }

  process(inputs, outputs) {
    const n = (outputs[0] && outputs[0][0] && outputs[0][0].length) || 128
    const frame0 = currentFrame
    const input = inputs[0]
    let mono = null
    if (input && input.length === 1) {
      mono = input[0]
    } else if (input && input.length > 1) {
      if (this.scratch.length < n) this.scratch = new Float32Array(n)
      const s = this.scratch
      const ch = input.length
      for (let i = 0; i < n; i++) {
        let sum = 0
        for (let c = 0; c < ch; c++) sum += input[c][i]
        s[i] = sum / ch
      }
      mono = s
    }

    if (mono) {
      let p = this.peak
      for (let i = 0; i < n; i++) {
        const v = Math.abs(mono[i])
        if (v > p) p = v
      }
      this.peak = p
    }
    if (++this.blocks >= 16) {
      this.port.postMessage({ type: "level", peak: this.peak })
      this.peak = 0
      this.blocks = 0
    }

    const cap = this.cap
    if (cap) {
      if (!cap.started) {
        cap.started = true
        cap.late = frame0 > cap.from // frames [from, frame0) were missed
      }
      const s = Math.max(cap.from, frame0)
      const e = Math.min(cap.to, frame0 + n)
      if (mono && e > s) cap.samples.set(mono.subarray(s - frame0, e - frame0), s - cap.from)
      if (frame0 + n >= cap.to) {
        this.port.postMessage({ type: "done", id: cap.id, samples: cap.samples, late: cap.late }, [cap.samples.buffer])
        this.cap = null
      }
    }
    return true
  }
}

registerProcessor("loopcraft-recorder", LoopcraftRecorder)
