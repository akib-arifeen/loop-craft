// The mixer graph. createMixer() is used for BOTH the live AudioContext and the offline export
// context, so an export is the same graph rendered faster than real time: what you hear is what
// you get.
//
//   source(s) → channel.input → highpass → lowpass → preGain → shaper → makeup → fader → panner → mute ─┬→ master
//                                                                                              ├→ delaySend → delay bus → master
//                                                                                              └→ reverbSend → reverb bus → master
//   master (sum) → masterVolume → compressor → output → ctx.destination
//
// Drive: the shaper holds ONE fixed curve (driveCurve(1), k = 16) and is bypassed (curve null) below
// drive 0.01. The drive amount only moves preGain = (1 + 15 d) / 16 and makeup, which glide with
// setParam, so dragging the knob never swaps curves (no clicks). tanh(16 * preGain * x) / tanh(16)
// equals the old per-drive tanh(k x) / tanh(k), and makeup = driveMakeup(d) * tanh(16) / tanh(k)
// restores the old output scale. The curve changes only when crossing the 0.01 bypass threshold.
//
// Delay bus: DelayNode (max 2 s, time = dottedEighthSeconds(bpm)) with a feedback loop
// (gain 0.38) through a 3.5 kHz low-pass and a 200 Hz high-pass; wet return gain 0.6.
// Reverb bus: 250 Hz high-pass → ConvolverNode (the given impulse) → return gain 0.8.
// Compressor: threshold -10 dB, knee 6, ratio 8, attack 3 ms, release 150 ms.

import type { TrackFx } from "./types.ts"
import { dottedEighthSeconds } from "./timing.ts"
import { driveCurve, driveMakeup, faderToGain, filterSettings, peakLevel, reverbImpulse } from "./dsp.ts"

export interface ChannelParams {
  volume: number
  pan: number
  fx: TrackFx
  /** Result of dsp.isAudible for this track (mute + solo resolved). */
  audible: boolean
}

export interface MixerChannel {
  /** Connect track sources here. */
  readonly input: AudioNode
  /**
   * Applies params. Gains, pan and filter frequencies glide with setTargetAtTime (time constant
   * 15 ms) from ctx.currentTime so there is no zipper noise; when `immediate` is true they are set
   * with setValueAtTime at time 0 instead (used by the offline export before rendering).
   */
  update(params: ChannelParams, immediate?: boolean): void
  /** Peak 0..1 of the most recent ~21 ms analyser window (fftSize 1024), post-fader; not "since the previous call" (0 when meters are disabled). */
  meter(): number
  /** Disconnects every node of this channel. */
  dispose(): void
}

/**
 * The master DynamicsCompressor delays everything by a fixed look-ahead (measured in Chromium:
 * 288 frames at 48 kHz). It is uniform across tracks, so it is compensated wherever "what the
 * listener hears" matters: record latency, the playhead, and the start of an exported WAV.
 */
export const MASTER_LOOKAHEAD_S = 0.006

export interface Mixer {
  /**
   * Master sum, pre-compressor. Sources that must sound in time with the tracks but are not
   * channels (the metronome, the count-in) connect here so they share the compressor's look-ahead.
   */
  readonly input: AudioNode
  /** Post-compressor output, already connected to ctx.destination. */
  readonly output: AudioNode
  /** A fresh channel strip wired into master and both send buses. */
  createChannel(): MixerChannel
  /** Re-syncs the delay time to the tempo. */
  setTempo(bpm: number): void
  /** 0..1 fader position (dsp.faderToGain). */
  setMasterVolume(volume: number, immediate?: boolean): void
  /** Peak 0..1 of the master output over the most recent ~21 ms analyser window (fftSize 1024), not "since the previous call" (0 when meters are disabled). */
  masterMeter(): number
  dispose(): void
}

export interface MixerOptions {
  bpm: number
  masterVolume: number
  /** Stereo impulse for the reverb bus (built from dsp.reverbImpulse). */
  impulse: AudioBuffer
  /** Live context: true (AnalyserNode meters, fftSize 1024). Offline export: false. */
  meters: boolean
}

const SMOOTH_SECONDS = 0.015
const METER_FFT = 1024

/** Glides to v (time constant 15 ms), or jumps there when immediate. */
function setParam(ctx: BaseAudioContext, param: AudioParam, v: number, immediate: boolean): void {
  if (immediate) {
    param.cancelScheduledValues(0)
    param.setValueAtTime(v, ctx.currentTime)
  } else {
    param.setTargetAtTime(v, ctx.currentTime, SMOOTH_SECONDS)
  }
}

function peakOf(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf)
  return peakLevel(buf)
}

export function createMixer(ctx: BaseAudioContext, opts: MixerOptions): Mixer {
  const gain = (v: number) => {
    const g = ctx.createGain()
    g.gain.value = v
    return g
  }
  const biquad = (type: BiquadFilterType, hz: number) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = hz
    return f
  }

  // Master chain.
  const master = gain(1)
  const masterVol = gain(faderToGain(opts.masterVolume))
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -10
  compressor.knee.value = 6
  compressor.ratio.value = 8
  compressor.attack.value = 0.003
  compressor.release.value = 0.15
  const output = gain(1)
  master.connect(masterVol)
  masterVol.connect(compressor)
  compressor.connect(output)
  output.connect(ctx.destination)

  let masterAnalyser: AnalyserNode | null = null
  const masterBuf = new Float32Array(METER_FFT)
  if (opts.meters) {
    masterAnalyser = ctx.createAnalyser()
    masterAnalyser.fftSize = METER_FFT
    output.connect(masterAnalyser)
  }

  // Delay bus.
  const delayIn = gain(1)
  const delay = ctx.createDelay(2)
  delay.delayTime.value = dottedEighthSeconds(opts.bpm)
  const delayWet = gain(0.6)
  const fbLow = biquad("lowpass", 3500)
  const fbHigh = biquad("highpass", 200)
  const fbGain = gain(0.38)
  delayIn.connect(delay)
  delay.connect(delayWet)
  delayWet.connect(master)
  delay.connect(fbLow)
  fbLow.connect(fbHigh)
  fbHigh.connect(fbGain)
  fbGain.connect(delay)

  // Reverb bus.
  const reverbIn = gain(1)
  const reverbHigh = biquad("highpass", 250)
  const convolver = ctx.createConvolver()
  convolver.normalize = true
  convolver.buffer = opts.impulse
  const reverbWet = gain(0.8)
  reverbIn.connect(reverbHigh)
  reverbHigh.connect(convolver)
  convolver.connect(reverbWet)
  reverbWet.connect(master)

  const channels = new Set<MixerChannel>()

  function createChannel(): MixerChannel {
    const input = gain(1)
    const hp = biquad("highpass", 10)
    const lp = biquad("lowpass", 20000)
    const preGain = gain(1)
    const shaper = ctx.createWaveShaper()
    // No oversampling: "2x" added 128 frames of latency to driven tracks only (measured), which
    // skewed them against clean tracks. On these band-limited sources the aliasing is negligible.
    shaper.oversample = "none"
    const makeup = gain(1)
    const fader = gain(1)
    const panner = ctx.createStereoPanner()
    const mute = gain(1)
    const delaySend = gain(0)
    const reverbSend = gain(0)
    input.connect(hp)
    hp.connect(lp)
    lp.connect(preGain)
    preGain.connect(shaper)
    shaper.connect(makeup)
    makeup.connect(fader)
    fader.connect(panner)
    panner.connect(mute)
    mute.connect(master)
    mute.connect(delaySend)
    delaySend.connect(delayIn)
    mute.connect(reverbSend)
    reverbSend.connect(reverbIn)

    let analyser: AnalyserNode | null = null
    const buf = new Float32Array(METER_FFT)
    if (opts.meters) {
      analyser = ctx.createAnalyser()
      analyser.fftSize = METER_FFT
      mute.connect(analyser)
    }

    // Fixed curve (k = 16), installed only while drive >= 0.01.
    const fixedCurve = driveCurve(1) as Float32Array<ArrayBuffer>
    let curveOn = false
    const nodes: AudioNode[] = [input, hp, lp, preGain, shaper, makeup, fader, panner, mute, delaySend, reverbSend]
    if (analyser) nodes.push(analyser)

    const channel: MixerChannel = {
      input,
      update(params, immediate = false) {
        const { fx } = params
        const f = filterSettings(fx.filter)
        setParam(ctx, hp.frequency, f.highpassHz, immediate)
        setParam(ctx, hp.Q, f.q, immediate)
        setParam(ctx, lp.frequency, f.lowpassHz, immediate)
        setParam(ctx, lp.Q, f.q, immediate)
        setParam(ctx, fader.gain, faderToGain(params.volume), immediate)
        setParam(ctx, panner.pan, params.pan, immediate)
        setParam(ctx, mute.gain, params.audible ? 1 : 0, immediate)
        setParam(ctx, delaySend.gain, fx.delay, immediate)
        setParam(ctx, reverbSend.gain, fx.reverb, immediate)
        const driven = fx.drive >= 0.01
        // Jump (don't glide) when the curve switches, or the gains would lag the new curve for ~15 ms.
        const jump = immediate || driven !== curveOn
        setParam(ctx, preGain.gain, driven ? (1 + 15 * fx.drive) / 16 : 1, jump)
        setParam(ctx, makeup.gain, driven ? (driveMakeup(fx.drive) * Math.tanh(16)) / Math.tanh(1 + 15 * fx.drive) : 1, jump)
        if (driven !== curveOn) {
          // Cast: lib.dom types the curve as Float32Array<ArrayBuffer>, driveCurve returns the wider type.
          shaper.curve = driven ? fixedCurve : null
          curveOn = driven
        }
      },
      meter() {
        return analyser ? peakOf(analyser, buf) : 0
      },
      dispose() {
        for (const n of nodes) n.disconnect()
        channels.delete(channel)
      },
    }
    channels.add(channel)
    return channel
  }

  return {
    input: master,
    output,
    createChannel,
    setTempo(bpm) {
      delay.delayTime.setTargetAtTime(dottedEighthSeconds(bpm), ctx.currentTime, 0.05)
    },
    setMasterVolume(volume, immediate = false) {
      setParam(ctx, masterVol.gain, faderToGain(volume), immediate)
    },
    masterMeter() {
      return masterAnalyser ? peakOf(masterAnalyser, masterBuf) : 0
    },
    dispose() {
      for (const c of [...channels]) c.dispose()
      const nodes: AudioNode[] = [master, masterVol, compressor, output, delayIn, delay, delayWet, fbLow, fbHigh, fbGain, reverbIn, reverbHigh, convolver, reverbWet]
      if (masterAnalyser) nodes.push(masterAnalyser)
      for (const n of nodes) n.disconnect()
    },
  }
}

/** Reverb impulse as an AudioBuffer: dsp.reverbImpulse(ctx.sampleRate, 2.4, 3.2, 7). */
export function createImpulse(ctx: BaseAudioContext): AudioBuffer {
  const [l, r] = reverbImpulse(ctx.sampleRate, 2.4, 3.2, 7)
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: l.length, sampleRate: ctx.sampleRate })
  buffer.copyToChannel(l as Float32Array<ArrayBuffer>, 0)
  buffer.copyToChannel(r as Float32Array<ArrayBuffer>, 1)
  return buffer
}
