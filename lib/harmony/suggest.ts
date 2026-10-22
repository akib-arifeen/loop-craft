// Next-chord suggestions with reasons. Pure — unit-tested under Node.

import type { Chord, ChordSuggestion, Degree, Key, Mode } from "./types.ts"
import { MODE_STEPS, QUALITY_SHAPES, chordNotes, chordOnRoot, chordPitchClasses, chordQuality, chordSymbol, diatonicQuality, formatNoteName, harmonicFunction, makeChord, pitchClass, romanNumeral, transposeSpelled } from "./theory.ts"

/**
 * Ranked suggestions for the chord that follows `prev` (and leads into `next` when given). Candidates:
 *  1. diatonic — every diatonic chord of the key (size = prev's effective chord-tone count ≥ 4 ? 4 : 3),
 *     except an identical chord. Score by root motion from prev: down a fifth / up a fourth 0.9; to the tonic
 *     from a dominant-function chord 0.85; down a third 0.7; up a second 0.6; others 0.4. Reason names the real
 *     notes, e.g. "Root falls a fifth, A to D — the strongest move in tonal music." or
 *     "Shares two notes with Am7 (C, E) — a smooth step."
 *  2. secondary-dominant — when `next` is given, V7 of next (root a perfect fifth above next's root, quality dom7,
 *     applied: { of: next.degree }), score 0.8, reason "V7 of <next symbol>: <leading tone> pulls up to <next root>."
 *     Without `next`, V7/ii, V7/IV, V7/V, V7/vi of the key, score 0.5.
 *  3. modal-interchange — chords borrowed from the parallel mode (ionian ↔ aeolian; for other modes use the
 *     parallel aeolian or ionian, whichever differs more): in major keys iv, ♭VI, ♭VII, ♭III; in minor keys IV and
 *     V7 (harmonic minor, "raises the leading tone"). Score 0.55; reason "Borrowed from <mode>: its <note> (<degree>)
 *     <colour>." naming the chord tone that lies outside the current scale.
 *  4. tritone-sub — when `next` is given and a dominant 7th leads there, ♭II7 relative to next (root a half step
 *     above next's root, quality dom7), score 0.6, reason "Tritone substitute for <V7 symbol>: shares <a>–<b>,
 *     slides down a half step to <next root>."
 *  5. deceptive — when prev is a dominant (V or V7 diatonic), vi (major keys) or ♭VI (minor keys), score 0.75,
 *     reason "Deceptive cadence: the dominant resolves to <symbol> instead of the tonic."
 * De-duplicate by (root pitch class, quality), keeping the higher score; sort by score desc then by category
 * order above; return the first `n`. Every suggestion carries roman + symbol (romanNumeral / chordSymbol, unicode).
 */
export function suggestNext(key: Key, prev: Chord, next: Chord | null, n?: number): ChordSuggestion[] {
  const prevRoot = rootPc(key, prev)
  const prevPcs = chordPitchClasses(key, prev)
  const prevSymbol = chordSymbol(key, prev)
  const prevSize: 3 | 4 = QUALITY_SHAPES[chordQuality(key, prev)].semitones.length >= 4 ? 4 : 3
  const cands: ChordSuggestion[] = []
  const add = (category: ChordSuggestion["category"], chord: Chord | null, score: number, reason: string) => {
    if (!chord) return
    cands.push({ chord, roman: romanNumeral(key, chord), name: chordSymbol(key, chord), category, reason, score })
  }
  const isPrev = (c: Chord) => rootPc(key, c) === prevRoot && chordQuality(key, c) === chordQuality(key, prev)

  // 1. diatonic
  for (const degree of [1, 2, 3, 4, 5, 6, 7] as Degree[]) {
    const chord: Chord = { degree, alter: 0, size: prevSize, inversion: 0 }
    if (isPrev(chord)) continue
    const notes = chordNotes(key, chord)
    const up = mod(pitchClass(notes[0]) - prevRoot, 12)
    const from = formatNoteName(chordNotes(key, prev)[0])
    const to = formatNoteName(notes[0])
    const shared = notes.filter((n) => prevPcs.includes(pitchClass(n)))
    const sharedReason = shared.length >= 2
      ? `Shares ${COUNT_WORDS[shared.length] ?? shared.length} notes with ${prevSymbol} (${shared.map((n) => formatNoteName(n)).join(", ")}) \u2014 a smooth step.`
      : null
    let score = 0.4
    let reason = sharedReason ?? `Root moves ${from} to ${to} \u2014 a change of colour.`
    if (up === 5) {
      score = 0.9
      reason = `Root falls a fifth, ${from} to ${to} \u2014 the strongest move in tonal music.`
    } else if (degree === 1 && harmonicFunction(key, prev) === "dominant") {
      score = 0.85
      reason = `Resolves home: the dominant ${prevSymbol} pulls to the tonic ${chordSymbol(key, chord)}.`
    } else if (up === 8 || up === 9) {
      score = 0.7
      reason = sharedReason ?? `Root falls a third, ${from} to ${to} \u2014 a gentle, related move.`
    } else if (up === 1 || up === 2) {
      score = 0.6
      reason = sharedReason ?? `Root steps up a second, ${from} to ${to} \u2014 builds momentum.`
    }
    add("diatonic", chord, score, reason)
  }

  // 2. secondary dominants
  const secondary = (target: Chord, score: number) => {
    if (target.alter !== 0 || target.applied) return
    const targetNotes = chordNotes(key, target)
    const v7 = chordOnRoot(key, transposeSpelled(targetNotes[0], 4, 7), "dom7", 0, { of: target.degree })
    if (!v7 || isPrev(v7)) return
    const leading = formatNoteName(chordNotes(key, v7)[1])
    add("secondary-dominant", v7, score, `V7 of ${chordSymbol(key, target)}: ${leading} pulls up to ${formatNoteName(targetNotes[0])}.`)
  }
  if (next) secondary(next, 0.8)
  else for (const degree of [2, 4, 5, 6] as Degree[]) secondary({ degree, alter: 0, size: prevSize, inversion: 0 }, 0.5)

  // 3. modal interchange
  const borrowMode = borrowedMode(key.mode)
  const borrowKey: Key = { tonic: key.tonic, mode: borrowMode }
  const stepsOwn = MODE_STEPS[key.mode]
  const stepsBorrow = MODE_STEPS[borrowMode]
  const borrow = (degree: Degree, colour: string) => {
    const alter = stepsBorrow[degree - 1] - stepsOwn[degree - 1]
    if (alter < -1 || alter > 1) return
    const q = diatonicQuality(borrowKey, degree, 3)
    const chord = makeChord(key, degree, alter as -1 | 0 | 1, q)
    const alreadyDiatonic = alter === 0 && q === diatonicQuality(key, degree, 3)
    if (alreadyDiatonic || isPrev(chord)) return
    add("modal-interchange", chord, 0.55, `Borrowed from ${borrowMode}: ${outsideNote(key, chord)}${colour}.`)
  }
  if (borrowMode === "aeolian") {
    borrow(4, "gives a darker, wistful turn")
    borrow(6, "adds a warm, cinematic colour")
    borrow(7, "adds an open, bluesy colour")
    borrow(3, "gives a bright lift")
  } else {
    borrow(4, "gives a brighter, major lift")
    const alter = MODE_STEPS["harmonic-minor"][4] - stepsOwn[4]
    if (alter >= -1 && alter <= 1) {
      const chord = makeChord(key, 5, alter as -1 | 0 | 1, "dom7")
      const alreadyDiatonic = alter === 0 && diatonicQuality(key, 5, 4) === "dom7"
      if (!alreadyDiatonic && !isPrev(chord)) add("modal-interchange", chord, 0.55, `Borrowed from harmonic minor: ${outsideNote(key, chord)}is a leading tone that pulls up to the tonic.`)
    }
  }

  // 4. tritone substitution
  if (next) {
    const nextRoot = chordNotes(key, next)[0]
    const v7 = chordOnRoot(key, transposeSpelled(nextRoot, 4, 7), "dom7")
    const sub = chordOnRoot(key, transposeSpelled(nextRoot, 1, 1), "dom7")
    if (v7 && sub && !isPrev(sub)) {
      const vn = chordNotes(key, v7)
      add("tritone-sub", sub, 0.6, `Tritone substitute for ${chordSymbol(key, v7)}: shares ${formatNoteName(vn[1])}\u2013${formatNoteName(vn[3])}, slides down a half step to ${formatNoteName(nextRoot)}.`)
    }
  }

  // 5. deceptive cadence
  const prevQuality = chordQuality(key, prev)
  if (prev.degree === 5 && prev.alter === 0 && !prev.applied && (prevQuality === "maj" || prevQuality === "dom7")) {
    const major = diatonicQuality(key, 1, 3) === "maj"
    const chord = major
      ? makeChord(key, 6, 0, diatonicQuality(key, 6, prevSize))
      : chordOnRoot(key, transposeSpelled(key.tonic, 5, 8), prevSize === 4 ? "maj7" : "maj")
    if (chord) add("deceptive", chord, 0.75, `Deceptive cadence: the dominant resolves to ${chordSymbol(key, chord)} instead of the tonic.`)
  }

  // de-duplicate by (root pitch class, quality), keeping the higher score (the earlier candidate on a tie)
  const best = new Map<string, ChordSuggestion>()
  for (const c of cands) {
    const id = `${rootPc(key, c.chord)}:${chordQuality(key, c.chord)}`
    const old = best.get(id)
    if (!old || c.score > old.score) best.set(id, c)
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
    .slice(0, n ?? 6)
}

const CATEGORY_ORDER: ChordSuggestion["category"][] = ["diatonic", "secondary-dominant", "modal-interchange", "tritone-sub", "deceptive"]
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five"]

function mod(a: number, b: number): number {
  return ((a % b) + b) % b
}

function rootPc(key: Key, chord: Chord): number {
  return chordPitchClasses(key, chord)[0]
}

/** The parallel mode to borrow from: ionian for aeolian, aeolian for ionian, else whichever of the two differs more. */
function borrowedMode(mode: Mode): Mode {
  if (mode === "ionian") return "aeolian"
  if (mode === "aeolian") return "ionian"
  const diff = (m: Mode) => MODE_STEPS[mode].filter((s, i) => s !== MODE_STEPS[m][i]).length
  return diff("aeolian") > diff("ionian") ? "aeolian" : "ionian"
}

/** "its F (♭6)" — the first chord tone outside the key's scale, labelled by its letter-based degree; "" if none. */
function outsideNote(key: Key, chord: Chord): string {
  const scale = MODE_STEPS[key.mode]
  const tonicPc = pitchClass(key.tonic)
  const tonicLetter = LETTER_ORDER.indexOf(key.tonic.letter)
  for (const n of chordNotes(key, chord)) {
    const rel = mod(pitchClass(n) - tonicPc, 12)
    if (scale.includes(rel)) continue
    const degree = mod(LETTER_ORDER.indexOf(n.letter) - tonicLetter, 7) + 1
    let alter = rel - scale[degree - 1]
    if (alter > 6) alter -= 12
    if (alter < -6) alter += 12
    const sign = alter < 0 ? "\u266d".repeat(-alter) : "\u266f".repeat(alter)
    return `its ${formatNoteName(n)} (${sign}${degree}) `
  }
  return ""
}

const LETTER_ORDER = ["C", "D", "E", "F", "G", "A", "B"]
