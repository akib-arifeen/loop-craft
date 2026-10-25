// Built-in track cap-recovery check, at the viewport under test. Start from a fresh demo:
//   agent-browser open http://localhost:3102
//   agent-browser click '[role="dialog"] button'      # start the demo and render the tracks
//   agent-browser eval --stdin < cap_recovery_check.js
//
// It fills the eight-track cap with empty loops (which are not undo steps), removes the built-in Keys
// track at that cap, refills the slot and asserts the Undo is cap-blocked with "Free a track slot,
// then undo again." It then frees the slot by removing the filler—itself an undoable removal—and
// asserts the waiting step still applies first: Keys comes back with its exact state, rendered buffer,
// original slot and selection, the count never exceeds eight, and the freeing removal stays on the
// stack for a later retry. Throws on failure.
(async () => {
  const app = window.__loopcraft
  if (!app) throw new Error("window.__loopcraft is missing: load the app before running this check")
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 100 && app.getSnapshot().rendering; i++) await wait(50)

  const snap = () => app.getSnapshot()
  const byId = (id) => snap().tracks.find((t) => t.id === id)
  const fails = []
  const facts = { viewport: `${innerWidth}x${innerHeight}`, steps: [] }

  while (snap().tracks.length < 8) {
    const id = app.addAudioTrack()
    if (!id) break
    app.selectTrack(id)
  }
  facts.full = snap().tracks.length
  if (facts.full !== 8) fails.push(`could not fill the cap: ${facts.full} tracks`)

  const keysBefore = JSON.parse(JSON.stringify(byId("keys")))
  const keysBuffer = app.debug.buffer("keys")
  const keysIndex = snap().tracks.findIndex((t) => t.id === "keys")
  const selectedBefore = snap().selectedTrackId
  app.removeTrack("keys")
  facts.removed = { tracks: snap().tracks.length, message: snap().message }
  if (facts.removed.tracks !== 7) fails.push(`expected 7 tracks after removing Keys at the cap, got ${facts.removed.tracks}`)
  if (!/Track removed\. Undo restores it\./.test(snap().message || "")) fails.push(`the removal message was "${snap().message}"`)

  const filler = app.addAudioTrack()
  if (!filler) fails.push("could not add a filler loop track")
  facts.refilled = { tracks: snap().tracks.length, filler }
  if (facts.refilled.tracks !== 8) fails.push(`expected the cap at 8, got ${facts.refilled.tracks}`)

  app.undo()
  facts.blocked = {
    tracks: snap().tracks.length,
    keysGone: !byId("keys"),
    canUndo: snap().canUndo,
    message: snap().message,
  }
  if (!facts.blocked.keysGone) fails.push("the cap-blocked Undo restored Keys anyway")
  if (facts.blocked.canUndo !== true) fails.push("the cap-blocked Undo dropped its step")
  if (facts.blocked.tracks !== 8) fails.push(`the cap-blocked Undo changed the track count to ${facts.blocked.tracks}`)
  if (!/Free a track slot, then undo again\./.test(snap().message || "")) fails.push(`the cap-blocked message was "${snap().message}"`)

  // Freeing the slot is a removal of its own. It must sit below the waiting step, not bury it.
  app.removeTrack(filler)
  facts.freed = { tracks: snap().tracks.length, message: snap().message }
  if (facts.freed.tracks !== 7) fails.push(`expected 7 tracks after freeing the slot, got ${facts.freed.tracks}`)

  app.undo()
  await wait(150)
  const restored = snap()
  const keysAfter = byId("keys")
  facts.restored = {
    tracks: restored.tracks.length,
    keysBack: !!keysAfter,
    exactState: JSON.stringify(keysAfter) === JSON.stringify(keysBefore),
    exactBuffer: app.debug.buffer("keys") === keysBuffer && keysBuffer !== null,
    slot: restored.tracks[keysIndex]?.id,
    selected: restored.selectedTrackId,
    message: restored.message,
    canUndo: restored.canUndo,
    canRedo: restored.canRedo,
  }
  if (!facts.restored.keysBack) fails.push("the waiting Undo did not restore Keys after the slot was freed")
  if (facts.restored.tracks !== 8) fails.push(`restoring Keys left ${facts.restored.tracks} tracks, expected 8`)
  if (!facts.restored.exactState) fails.push("Keys did not come back with its exact state and peaks")
  if (!facts.restored.exactBuffer) fails.push("Keys did not come back with its exact rendered buffer")
  if (facts.restored.slot !== "keys") fails.push(`Keys returned in slot ${facts.restored.slot}, not slot ${keysIndex}`)
  if (facts.restored.selected !== selectedBefore) fails.push(`selection ${facts.restored.selected} was restored instead of ${selectedBefore}`)
  if (facts.restored.message !== "Undone.") fails.push(`the Undo message was "${facts.restored.message}"`)
  if (!facts.restored.canUndo) fails.push("the freeing removal was dropped from the undo stack")
  if (!facts.restored.canRedo) fails.push("the restored removal did not leave a redo step")

  // The freeing removal is still on the stack; restoring it needs a slot of its own, so it waits.
  app.undo()
  facts.retry = { tracks: snap().tracks.length, fillerBack: !!byId(filler), canUndo: snap().canUndo, message: snap().message }
  if (facts.retry.fillerBack) fails.push("the freeing removal bypassed the cap")
  if (facts.retry.tracks !== 8) fails.push(`the retry changed the track count to ${facts.retry.tracks}`)
  if (!facts.retry.canUndo) fails.push("the cap-blocked freeing removal dropped its step")
  if (!/Free a track slot, then undo again\./.test(snap().message || "")) fails.push(`the retry message was "${snap().message}"`)

  facts.dom = {
    rows: document.querySelectorAll('[aria-label^="Select "]').length,
    keysRow: !!document.querySelector('[aria-label="Select Keys"]'),
    noHorizontalOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
  }
  if (facts.dom.rows !== 8) fails.push(`the track list shows ${facts.dom.rows} rows, expected 8`)
  if (!facts.dom.keysRow) fails.push("the restored Keys row is not in the track list")
  if (!facts.dom.noHorizontalOverflow) fails.push("the page scrolls horizontally")

  const summary = JSON.stringify(facts)
  if (fails.length) throw new Error(fails.join("; ") + " | " + summary)
  return "PASS " + summary
})()
