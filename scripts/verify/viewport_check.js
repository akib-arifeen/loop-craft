// Header and tap-target check for one viewport. Run it once per size with the app served:
//   agent-browser open http://localhost:3102
//   agent-browser viewport 320 568
//   agent-browser eval --stdin < viewport_check.js
// (repeat for 420 700, 340 760, 390 844, 800 520, 1024 768)
//
// It sets the tempo to 92 and 180 BPM through the documented window.__loopcraft API and asserts, per
// tempo: one header row at >= 720 px and two below, the WAV button still in the first row, no
// horizontal overflow, and tempo steps of at least 44 px (40 px below 332 px, where a three-digit
// tempo needs the room). It restores the tempo it found and throws on failure, so the command fails
// loudly instead of printing a pass-shaped result.
(async () => {
  const app = window.__loopcraft
  if (!app) throw new Error("window.__loopcraft is missing: load the app before running this check")
  const before = app.getSnapshot().bpm
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const centre = (el) => {
    const r = el.getBoundingClientRect()
    return r.top + r.height / 2
  }

  // Header rows: elements on the same flex line share a vertical centre; wrapped ones do not.
  const headerRows = () => {
    const header = document.querySelector("header")
    const items = [...header.children].filter((el) => {
      const s = getComputedStyle(el)
      return s.display !== "none" && el.getBoundingClientRect().height >= 20
    })
    const bands = []
    for (const el of items.sort((a, b) => centre(a) - centre(b))) {
      const c = centre(el)
      const band = bands.find((b) => Math.abs(b.c - c) <= 4)
      if (band) band.n += 1
      else bands.push({ c, n: 1 })
    }
    return bands.length
  }

  const measure = () => {
    const header = document.querySelector("header")
    const slower = document.querySelector('[aria-label="Slower"]').getBoundingClientRect()
    const faster = document.querySelector('[aria-label="Faster"]').getBoundingClientRect()
    const play = header.querySelector('[aria-label="Play"], [aria-label="Stop"]')
    const wav = [...header.querySelectorAll("button")].find((b) => /WAV|Rendering/.test(b.textContent))
    const numeral = document.querySelector('[aria-label="Tempo"] .mono').getBoundingClientRect()
    const tempo = document.querySelector('[aria-label="Tempo"]').getBoundingClientRect()
    return {
      width: innerWidth,
      rows: headerRows(),
      noHorizontalOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
      wavInFirstRow: !!wav && !!play && Math.abs(centre(wav) - centre(play)) <= 3,
      steps: [slower.width, slower.height, faster.width, faster.height].map((n) => Math.round(n)),
      numeralClipped: numeral.right > tempo.right + 0.5,
    }
  }

  // Phones and tablets take the 44 px touch target (40 px only below 332 px, where a three-digit tempo
  // needs the room); the one-row desktop header keeps its denser 32 px mouse controls.
  const need = innerWidth < 332 ? 40 : innerWidth < 720 ? 44 : 32
  const expectRows = innerWidth >= 720 ? 1 : 2
  const fails = []
  const runs = {}
  for (const bpm of [92, 180]) {
    app.setBpm(bpm)
    await wait(400)
    const m = measure()
    runs[bpm] = m
    if (m.rows !== expectRows) fails.push(`${bpm} BPM at ${m.width} px: ${m.rows} header rows, expected ${expectRows}`)
    if (!m.noHorizontalOverflow) fails.push(`${bpm} BPM at ${m.width} px: the page scrolls horizontally`)
    if (!m.wavInFirstRow) fails.push(`${bpm} BPM at ${m.width} px: the WAV button left the first header row`)
    if (m.steps.some((n) => n < need)) fails.push(`${bpm} BPM at ${m.width} px: tempo steps ${m.steps.join("/")} px, need at least ${need}`)
    if (m.numeralClipped) fails.push(`${bpm} BPM at ${m.width} px: the tempo numeral is clipped`)
  }
  app.setBpm(before)
  await wait(150)

  const summary = JSON.stringify({ viewport: `${innerWidth}x${innerHeight}`, need, runs })
  if (fails.length) throw new Error(fails.join("; ") + " | " + summary)
  return "PASS " + summary
})()
