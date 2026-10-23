import { test } from "node:test"
import assert from "node:assert/strict"
import {
  SAMPLE_CATALOG,
  SAMPLE_TYPES,
  findSample,
  keyLabel,
  modeName,
  pitchClassName,
  sampleFit,
  samplePitchClasses,
  searchSamples,
  sortSamples,
  statedKeys,
} from "../lib/samples/library.ts"
import { STEPS_PER_BAR, DRUM_VOICES } from "../lib/audio/types.ts"
import { MODES } from "../lib/harmony/types.ts"
import type { Key } from "../lib/harmony/types.ts"
import { parseNoteName, scalePitchClasses } from "../lib/harmony/theory.ts"

const A_MINOR: Key = { tonic: parseNoteName("A")!, mode: "aeolian" }
const C_MAJOR: Key = { tonic: parseNoteName("C")!, mode: "ionian" }

test("sample catalog: ids are unique, well formed and resolvable", () => {
  assert.ok(SAMPLE_CATALOG.length >= 12)
  const ids = new Set<string>()
  for (const s of SAMPLE_CATALOG) {
    assert.match(s.id, /^[a-z0-9-]+$/)
    assert.ok(!ids.has(s.id), `duplicate sample id ${s.id}`)
    ids.add(s.id)
    assert.equal(findSample(s.id), s)
    assert.ok(SAMPLE_TYPES.includes(s.type), `${s.id}: bad type`)
    assert.ok(s.name.length > 0 && s.name.length <= 24)
    assert.ok(s.tags.length > 0)
  }
  assert.equal(findSample("nope"), undefined)
  assert.equal(findSample(undefined), undefined)
})

test("stated key metadata is real (never invented): every pitched note is inside its stated key", () => {
  let pitched = 0
  for (const s of SAMPLE_CATALOG) {
    if (s.key === null) {
      assert.equal(s.atonal, true, `${s.id}: no key must mean atonal`)
      assert.equal(s.key, null)
      assert.equal(samplePitchClasses(s).length, 0, `${s.id}: atonal sample must not play pitched notes`)
      continue
    }
    pitched++
    assert.equal(s.atonal, false, `${s.id}: a keyed sample is not atonal`)
    const tonic = parseNoteName(s.key.tonic)
    assert.ok(tonic, `${s.id}: unreadable tonic ${s.key.tonic}`)
    assert.ok((MODES as readonly string[]).includes(s.key.mode), `${s.id}: unknown mode`)
    const scale = new Set(scalePitchClasses({ tonic: tonic!, mode: s.key.mode }))
    assert.ok((s.notes?.length ?? 0) > 0, `${s.id}: a keyed sample needs notes`)
    for (const n of s.notes!) {
      assert.ok(Number.isInteger(n.midi) && n.midi >= 0 && n.midi <= 127, `${s.id}: midi out of range`)
      assert.ok(scale.has(((n.midi % 12) + 12) % 12), `${s.id}: midi ${n.midi} is outside the stated key ${keyLabel(s.key)}`)
      assert.ok(n.step >= 0 && n.length > 0 && n.velocity > 0 && n.velocity <= 1)
    }
  }
  assert.ok(pitched >= 8)
})

test("drum samples carry a valid one-bar pattern and state no key", () => {
  for (const s of SAMPLE_CATALOG.filter((x) => x.voice === "drums")) {
    assert.equal(s.key, null)
    assert.equal(s.atonal, true)
    assert.ok(s.drumPattern)
    for (const voice of DRUM_VOICES) {
      const lane: number[] = s.drumPattern![voice]
      assert.equal(lane.length, STEPS_PER_BAR)
      for (const cell of lane) assert.ok([0, 1, 2].includes(cell))
    }
  }
})

test("sampleFit: drums always fit, pitched loops are judged by their actual pitch classes", () => {
  const drums = SAMPLE_CATALOG.find((s) => s.voice === "drums")!
  assert.deepEqual(sampleFit(drums, A_MINOR), {
    fit: "any",
    group: 1,
    label: "Always fits",
    reason: "Drums have no key, so they can't clash with one.",
    clashes: [],
  })

  const rhodes = findSample("keys-am7-rhodes")!
  const inKey = sampleFit(rhodes, A_MINOR)
  assert.equal(inKey.fit, "in-key")
  assert.deepEqual(inKey.clashes, [])

  // C major and A minor share the same notes, so a C major loop is usable in A minor (same pitch set).
  assert.equal(sampleFit(rhodes, C_MAJOR).fit, "in-key")

  // C lydian has F#, which A aeolian does not: the badge must say exactly which note is outside.
  const lydian = findSample("arp-c-lydian-bells")!
  const clash = sampleFit(lydian, A_MINOR)
  assert.equal(clash.fit, "clash")
  assert.equal(clash.group, 2)
  assert.deepEqual(clash.clashes, ["F♯"])
  assert.match(clash.reason, /F♯/)
  assert.match(clash.reason, /A minor/)
})

test("sampleFit names more than one offender", () => {
  const walk = findSample("bass-f-aeolian-walk")!
  const clash = sampleFit(walk, A_MINOR)
  assert.equal(clash.fit, "clash")
  // spelled the way the loop's own F minor key spells them, not as sharps
  assert.deepEqual(clash.clashes.sort(), ["A♭", "B♭", "D♭", "E♭"].sort())
  assert.match(clash.reason, /not in A minor/)
  const haze = sampleFit(findSample("keys-bb-haze")!, A_MINOR)
  assert.equal(haze.fit, "clash")
  assert.deepEqual(haze.clashes, ["B♭"], "a B-flat loop must be spelled with flats")
})

test("sortSamples puts compatible loops first and clashes last", () => {
  const rows = sortSamples(SAMPLE_CATALOG, A_MINOR)
  const groups = rows.map((r) => r.fit.group)
  assert.deepEqual(groups, [...groups].sort((a, b) => a - b))
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    if (a.fit.group === b.fit.group) assert.ok(a.sample.name.localeCompare(b.sample.name) <= 0)
  }
  const rhodesAt = rows.findIndex((r) => r.sample.id === "keys-am7-rhodes")
  const lydianAt = rows.findIndex((r) => r.sample.id === "arp-c-lydian-bells")
  assert.ok(rhodesAt < lydianAt)
})

test("searchSamples matches names and tags, case-insensitively; empty query matches all", () => {
  assert.equal(searchSamples(SAMPLE_CATALOG, "").length, SAMPLE_CATALOG.length)
  assert.deepEqual(
    searchSamples(SAMPLE_CATALOG, "FUNK").map((s) => s.id),
    ["bass-d-dorian-funk"],
  )
  assert.deepEqual(searchSamples(SAMPLE_CATALOG, "rhodes").map((s) => s.id), ["keys-am7-rhodes"])
  assert.deepEqual(searchSamples(SAMPLE_CATALOG, "zzz"), [])
})

test("statedKeys and display helpers", () => {
  const keys = statedKeys()
  assert.ok(keys.length > 0)
  const seen = new Set<string>()
  for (const k of keys) {
    const short = `${k.tonic}:${k.mode}`
    assert.ok(!seen.has(short))
    seen.add(short)
  }
  assert.equal(keyLabel({ tonic: "A", mode: "aeolian" }), "A minor")
  assert.equal(keyLabel({ tonic: "C", mode: "ionian" }), "C major")
  assert.equal(keyLabel({ tonic: "D", mode: "dorian" }), "D dorian")
  assert.equal(keyLabel(A_MINOR), "A minor")
  assert.equal(modeName("aeolian"), "minor")
  assert.equal(pitchClassName(6), "F♯")
  assert.equal(pitchClassName(10), "A♯")
})
