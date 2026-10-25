import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { LoopEngine } from "../lib/audio/engine.ts"
import { decodeShare, encodeShare } from "../lib/audio/share.ts"
import { demoHarmony } from "../lib/harmony/presets.ts"
import { chordSymbol, formatNoteName } from "../lib/harmony/theory.ts"
import type { CommandEvent, ShareData } from "../lib/audio/types.ts"
import type { Harmony } from "../lib/harmony/types.ts"

function setup() {
  const e = new LoopEngine()
  const events: CommandEvent[] = []
  e.onCommand((ev) => events.push(ev))
  return { e, events }
}
const symbols = (h: Harmony) => h.chords.map((s) => chordSymbol(h.key, s.chord))
const keyText = (h: Harmony) => `${formatNoteName(h.key.tonic, true)} ${h.key.mode}`

describe("harmony in the snapshot and document", () => {
  test("snapshot.harmony equals demoHarmony()", () => {
    const { e } = setup()
    assert.deepEqual(e.getSnapshot().harmony, demoHarmony())
  })

  test("getDocument().harmony is a deep copy", () => {
    const { e } = setup()
    const d = e.getDocument()
    assert.deepEqual(d.harmony, e.getSnapshot().harmony)
    assert.notEqual(d.harmony, e.getSnapshot().harmony)
    assert.deepEqual(JSON.parse(JSON.stringify(d)), d)
    d.harmony.chords[0].start = 99
    d.harmony.key.mode = "locrian"
    assert.deepEqual(e.getSnapshot().harmony, demoHarmony())
  })
})

describe("setKey", () => {
  test("updates the key, emits one CommandEvent, undoable", () => {
    const { e, events } = setup()
    e.setKey("D", "dorian")
    const h = e.getSnapshot().harmony
    assert.equal(keyText(h), "D dorian")
    assert.equal(events.length, 1)
    assert.equal(events[0].origin, "user")
    assert.deepEqual(events[0].command, { type: "setKey", tonic: "D", mode: "dorian" })
    assert.equal(e.getSnapshot().canUndo, true)
    // chords stay Roman numerals: same degrees, new key
    assert.deepEqual(h.chords.map((s) => s.chord), demoHarmony().chords.map((s) => s.chord))
    assert.deepEqual(symbols(h), ["Dm7", "Bm7♭5", "Fmaj7", "C6"])
    e.undo()
    assert.deepEqual(e.getSnapshot().harmony, demoHarmony())
    assert.equal(e.getSnapshot().canUndo, false)
    e.redo()
    assert.equal(keyText(e.getSnapshot().harmony), "D dorian")
  })

  test("diatonic chords take the new mode's qualities", () => {
    const { e } = setup()
    e.setKey("A", "dorian") // degree 6 in A dorian is F#, m7b5
    assert.equal(symbols(e.getSnapshot().harmony)[1], "F♯m7♭5")
    e.setKey("C", "ionian")
    assert.deepEqual(symbols(e.getSnapshot().harmony).slice(0, 3), ["Cmaj7", "Am7", "Em7"])
  })

  test("invalid tonic -> no change, no event, nothing to undo", () => {
    const { e, events } = setup()
    e.setKey("H", "dorian")
    assert.deepEqual(e.getSnapshot().harmony, demoHarmony())
    assert.equal(events.length, 0)
    assert.equal(e.getSnapshot().canUndo, false)
  })
})

describe("setChord", () => {
  test("setChord(1, 'V7/V') -> true, slot 1 changed, undoable", () => {
    const { e, events } = setup()
    assert.equal(e.setChord(1, "V7/V"), true)
    const h = e.getSnapshot().harmony
    assert.equal(h.chords[1].chord.applied?.of, 5)
    assert.equal(chordSymbol(h.key, h.chords[1].chord), "B7") // V of V in A minor: E -> B
    assert.equal(h.chords[1].start, 4)
    assert.equal(h.chords[1].length, 4)
    assert.deepEqual(h.chords[0], demoHarmony().chords[0])
    assert.deepEqual(h.chords[2], demoHarmony().chords[2])
    assert.equal(events.length, 1)
    assert.deepEqual(events[0].command, { type: "setChord", index: 1, roman: "V7/V" })
    e.undo()
    assert.deepEqual(e.getSnapshot().harmony, demoHarmony())
  })

  test("out-of-range index or unparseable numeral -> false, no event, no undo entry", () => {
    const { e, events } = setup()
    assert.equal(e.setChord(9, "ii"), false)
    assert.equal(e.setChord(0, "zz"), false)
    assert.equal(e.setChord(-1, "ii"), false)
    assert.deepEqual(e.getSnapshot().harmony, demoHarmony())
    assert.equal(events.length, 0)
    assert.equal(e.getSnapshot().canUndo, false)
  })
})

describe("setProgression", () => {
  test("'ii7 V7 Imaj7 vi7' -> 4 slots of 4 beats", () => {
    const { e, events } = setup()
    assert.equal(e.setProgression("ii7 V7 Imaj7 vi7"), true)
    const h = e.getSnapshot().harmony
    assert.equal(h.chords.length, 4)
    assert.deepEqual(h.chords.map((s) => [s.start, s.length]), [[0, 4], [4, 4], [8, 4], [12, 4]])
    assert.deepEqual(symbols(h), ["Bm7", "E7", "Amaj7", "Fm7"])
    assert.equal(events.length, 1)
    assert.deepEqual(events[0].command, { type: "setProgression", romans: "ii7 V7 Imaj7 vi7" })
    e.undo()
    assert.deepEqual(e.getSnapshot().harmony, demoHarmony())
    e.redo()
    assert.deepEqual(symbols(e.getSnapshot().harmony), ["Bm7", "E7", "Amaj7", "Fm7"])
  })

  test("1..8 chords are accepted; '' , 9 chords and a bad numeral are rejected unchanged", () => {
    const { e, events } = setup()
    assert.equal(e.setProgression("i"), true)
    assert.equal(e.getSnapshot().harmony.chords.length, 1)
    assert.equal(e.setProgression("i ii iii iv v vi vii i"), true)
    assert.equal(e.getSnapshot().harmony.chords.length, 8)
    const before = structuredClone(e.getSnapshot().harmony)
    const n = events.length
    assert.equal(e.setProgression(""), false)
    assert.equal(e.setProgression("i ii iii iv v vi vii i ii"), false)
    assert.equal(e.setProgression("i ii nonsense"), false)
    assert.deepEqual(e.getSnapshot().harmony, before)
    assert.equal(events.length, n)
  })

  test("rejected on a fresh engine: nothing to undo", () => {
    const { e, events } = setup()
    assert.equal(e.setProgression(""), false)
    assert.equal(e.setProgression("I V bogus"), false)
    assert.equal(events.length, 0)
    assert.equal(e.getSnapshot().canUndo, false)
    assert.deepEqual(e.getSnapshot().harmony, demoHarmony())
  })
})

describe("undo / redo and track removal", () => {
  test("several harmony edits undo in reverse order and redo forward", () => {
    const { e } = setup()
    e.setKey("D", "dorian")
    e.setChord(2, "V7")
    e.setProgression("I IV V I")
    e.undo()
    assert.equal(chordSymbol(e.getSnapshot().harmony.key, e.getSnapshot().harmony.chords[2].chord), "A7")
    assert.equal(e.getSnapshot().harmony.chords.length, 4)
    e.undo()
    assert.equal(keyText(e.getSnapshot().harmony), "D dorian")
    assert.equal(e.getSnapshot().harmony.chords[2].chord.quality, undefined)
    e.undo()
    assert.deepEqual(e.getSnapshot().harmony, demoHarmony())
    e.redo()
    e.redo()
    e.redo()
    assert.deepEqual(symbols(e.getSnapshot().harmony), ["D", "G", "A", "D"])
  })

  test("removeTrack does not drop harmony history", () => {
    const { e } = setup()
    e.setKey("D", "dorian")
    e.removeTrack("keys")
    e.removeTrack("bass")
    // Each removal is one step of its own; the key change sits beneath both of them.
    e.undo()
    assert.equal(e.getSnapshot().tracks.some((t) => t.id === "bass"), true)
    e.undo()
    assert.equal(e.getSnapshot().tracks.some((t) => t.id === "keys"), true)
    e.undo()
    assert.deepEqual(e.getSnapshot().harmony, demoHarmony())
  })
})

describe("share round trip", () => {
  test("shareCode/loadShare keeps the key and every chord", () => {
    const a = setup().e
    a.setKey("D", "dorian")
    assert.equal(a.setProgression("ii7 V7 Imaj7 vi7 bVII"), true)
    const want = a.getSnapshot().harmony
    const b = new LoopEngine()
    assert.equal(b.loadShare(a.shareCode()), true)
    const got = b.getSnapshot().harmony
    assert.equal(keyText(got), keyText(want))
    assert.deepEqual(symbols(got), symbols(want))
    assert.equal(got.chords.length, 5)
  })

  const noHarmony: ShareData = {
    v: 1,
    bpm: 92,
    bars: 4,
    tracks: [
      {
        id: "bass",
        kind: "bass",
        name: "Bass",
        volume: 0.8,
        pan: 0,
        muted: false,
        soloed: false,
        fx: { filter: 0, drive: 0, delay: 0, reverb: 0 },
        patternId: "bass-pulse",
      },
    ],
  }

  test("a code made without harmony decodes with harmony absent", () => {
    const d = decodeShare(encodeShare(noHarmony))
    assert.ok(d)
    assert.equal(d.harmony, undefined)
    assert.equal("harmony" in d, false)
  })

  test("loadShare of a code without harmony applies the demo harmony", () => {
    const { e } = setup()
    e.setKey("D", "dorian")
    e.setProgression("I IV V I")
    assert.equal(e.loadShare(encodeShare(noHarmony)), true)
    assert.deepEqual(e.getSnapshot().harmony, demoHarmony())
  })

  test("garbage code leaves the harmony unchanged", () => {
    const { e } = setup()
    e.setKey("E", "phrygian")
    const before = structuredClone(e.getSnapshot().harmony)
    assert.equal(e.loadShare("garbage"), false)
    assert.deepEqual(e.getSnapshot().harmony, before)
  })
})
