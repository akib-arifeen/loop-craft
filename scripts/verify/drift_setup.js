// Injected into the page via `agent-browser eval --stdin`. Taps the engine's post-compressor master
// output with an AudioWorklet that logs the absolute context frame of every onset (|x| > 0.02 after
// >= 100 ms of quiet). Independent of the engine code: it only reads what the listener would hear.
(async () => {
  const e = window.__loopcraft, d = e.debug, ctx = d.ctx
  const src = `class P extends AudioWorkletProcessor{constructor(){super();this.q=0;this.o=[];this.port.onmessage=m=>{if(m.data==="dump")this.port.postMessage(this.o.slice())}}
  process(i){const c=i[0]&&i[0][0];const f=currentFrame;if(c){for(let k=0;k<c.length;k++){const a=Math.abs(c[k]);if(a>0.02){if(this.q>=4800)this.o.push(f+k);this.q=0}else this.q++}}else this.q+=128;return true}}
  registerProcessor("onset-probe",P)`
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: "text/javascript" })))
  const node = new AudioWorkletNode(ctx, "onset-probe")
  const sink = ctx.createGain(); sink.gain.value = 0
  d.output.connect(node); node.connect(sink); sink.connect(ctx.destination)
  window.__probe = { node, dump: () => new Promise(r => { node.port.onmessage = m => r(m.data); node.port.postMessage("dump") }) }
  return "probe attached @ sampleRate " + ctx.sampleRate
})()
