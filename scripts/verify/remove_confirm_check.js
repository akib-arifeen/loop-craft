// Confirm-target regression for the guarded synth removal, at the viewport under test:
//   agent-browser open http://localhost:3102
//   agent-browser click '[role="dialog"] button'      # start the demo; the track list is inert behind the gate
//   agent-browser set viewport 800 520
//   agent-browser eval --stdin < remove_confirm_check.js
//   (reload the page before the next viewport: this check removes the Drums track)
//
// It takes the centre of the unarmed Remove button, taps twice at exactly that point and asserts: the
// first tap only arms, that same point still hits the armed button (so the target cannot slide out
// from under the pointer onto Clear steps), the second tap removes the track, and the drum pattern was
// never cleared. Between the taps it also waits out the 3 s arming timeout and checks that Clear comes
// back and nothing changed. After the removal it asserts the status message and that Undo restores the
// exact pattern (the built-in track is one undo step). Throws on failure.
(async () => {
  const app = window.__loopcraft
  if (!app) throw new Error("window.__loopcraft is missing: load the app before running this check")
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const byLabel = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.getAttribute("aria-label") || ""))
  const drums = () => app.getSnapshot().tracks.find((t) => t.id === "drums")
  const clearButton = () => [...document.querySelectorAll("button")].find((b) => /^(Clear steps|Clear loop)$/.test(b.textContent.trim()))
  const headHeight = () => {
    const rm = byLabel(/^Remove track$/) ?? byLabel(/^Confirm remove track$/)
    return rm ? +rm.closest("div").getBoundingClientRect().height.toFixed(1) : null
  }
  // What a real pointer at (x, y) would activate: the deepest element there, then a normal tap sequence.
  const tap = (x, y) => {
    const el = document.elementFromPoint(x, y)
    if (!el) throw new Error(`nothing at ${x},${y}`)
    const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true, pointerType: "mouse" }
    el.dispatchEvent(new PointerEvent("pointerdown", opts))
    el.dispatchEvent(new MouseEvent("mousedown", opts))
    el.dispatchEvent(new PointerEvent("pointerup", opts))
    el.dispatchEvent(new MouseEvent("mouseup", opts))
    el.dispatchEvent(new MouseEvent("click", opts))
    return el
  }
  const hits = (el, x, y) => {
    const at = document.elementFromPoint(x, y)
    return !!at && !!el && el.contains(at)
  }

  const fails = []
  const facts = {}
  if (!drums()) throw new Error("no Drums track: reload the page so the demo session is fresh")

  document.querySelector('[aria-label="Select Drums"]').click()
  await wait(250)
  byLabel(/^Remove track$/).scrollIntoView({ block: "center" })
  await wait(150)

  const patternBefore = JSON.stringify(drums().drumPattern)
  const hitsBefore = Object.values(drums().drumPattern).flat().filter((v) => v > 0).length
  if (hitsBefore === 0) throw new Error("the Drums pattern is empty before the check starts")

  const remove = byLabel(/^Remove track$/)
  const box = remove.getBoundingClientRect()
  const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  facts.unarmed = { headHeight: headHeight(), removeBox: [box.left, box.top, box.right, box.bottom].map((n) => +n.toFixed(1)) }

  if (!hits(remove, point.x, point.y)) fails.push("the unarmed Remove button is not under its own centre")
  const hit1 = document.elementFromPoint(point.x, point.y)
  facts.firstTapTarget = (hit1.textContent || "").trim() || hit1.tagName

  tap(point.x, point.y)
  await wait(300)

  const armed = byLabel(/^Confirm remove track$/)
  const clear = clearButton()
  if (!armed) fails.push("the first tap did not arm the removal")
  if (!drums()) fails.push("the first tap removed the track instead of only arming")
  if (JSON.stringify(drums()?.drumPattern) !== patternBefore) fails.push("the first tap changed the drum pattern")
  if (!clear || getComputedStyle(clear).display !== "none") fails.push("Clear steps is still shown while the removal is armed")
  const armedBox = armed ? armed.getBoundingClientRect() : null
  const describedBy = armed?.getAttribute("aria-describedby")
  const warning = describedBy ? document.getElementById(describedBy)?.textContent || "" : ""
  facts.armed = {
    headHeight: headHeight(),
    armedBox: armedBox ? [armedBox.left, armedBox.top, armedBox.right, armedBox.bottom].map((n) => +n.toFixed(1)) : null,
    clearDisplay: clear ? getComputedStyle(clear).display : "absent",
    warning,
    pointHitsArmed: armed ? hits(armed, point.x, point.y) : false,
    pointInsideArmedBox: armedBox
      ? point.x >= armedBox.left && point.x <= armedBox.right && point.y >= armedBox.top && point.y <= armedBox.bottom
      : false,
  }
  if (armed && !/Undo/.test(warning)) fails.push(`the removal warning does not mention Undo: "${warning}"`)
  if (armed && !/no other way/.test(warning)) fails.push(`the removal warning does not state there is no other way back: "${warning}"`)
  if (armed && !facts.armed.pointHitsArmed) {
    const at = document.elementFromPoint(point.x, point.y)
    fails.push(`after arming, the tap point hits "${(at?.textContent || at?.tagName || "nothing").trim()}" instead of the confirm button`)
  }

  // Timeout: the arm expires after 3 s and Clear must come back with nothing changed.
  await wait(3200)
  const restoredClear = clearButton()
  facts.afterTimeout = {
    disarmed: !!byLabel(/^Remove track$/),
    clearDisplay: restoredClear ? getComputedStyle(restoredClear).display : "absent",
    tracks: app.getSnapshot().tracks.length,
    patternUnchanged: JSON.stringify(drums()?.drumPattern) === patternBefore,
    message: app.getSnapshot().message,
  }
  if (!facts.afterTimeout.disarmed) fails.push("the removal did not disarm after the timeout")
  if (!restoredClear || getComputedStyle(restoredClear).display === "none") fails.push("Clear steps did not come back after the timeout")
  if (!facts.afterTimeout.patternUnchanged) fails.push("the pattern changed during the arming timeout")

  // Same coordinates again: arm, then confirm. Both taps are ordinary clicks at one point.
  tap(point.x, point.y)
  await wait(300)
  if (!byLabel(/^Confirm remove track$/)) fails.push("the second run did not arm again")
  const hit2 = document.elementFromPoint(point.x, point.y)
  facts.secondTapTarget = (hit2.textContent || "").trim() || hit2.tagName
  tap(point.x, point.y)
  await wait(450)

  const after = app.getSnapshot()
  facts.afterConfirm = {
    tracks: after.tracks.length,
    drumsGone: !after.tracks.some((t) => t.id === "drums"),
    emptyDrumPatternLeft: after.tracks.some((t) => t.kind === "drums"),
    message: after.message,
    canUndo: after.canUndo,
  }
  if (!facts.afterConfirm.drumsGone) fails.push("two taps at one point did not remove the Drums track")
  if (after.tracks.length !== 4) fails.push(`expected 4 tracks after the removal, got ${after.tracks.length}`)
  if (!/Track removed\. Undo restores it\./.test(after.message || "")) fails.push(`the status message was "${after.message}"`)
  if (!after.canUndo) fails.push("the built-in removal did not leave an undo step")

  // Undo is the contract: the exact pattern, slot and selection come back.
  app.undo()
  await wait(250)
  const undone = app.getSnapshot()
  facts.afterUndo = {
    drumsBack: undone.tracks.some((t) => t.id === "drums"),
    tracks: undone.tracks.length,
    patternRestored: JSON.stringify(drums()?.drumPattern) === patternBefore,
    selected: undone.selectedTrackId,
    message: undone.message,
    canRedo: undone.canRedo,
  }
  if (!facts.afterUndo.drumsBack) fails.push("Undo did not restore the removed Drums track")
  if (undone.tracks.length !== 5) fails.push(`expected 5 tracks after Undo, got ${undone.tracks.length}`)
  if (!facts.afterUndo.patternRestored) fails.push("Undo did not restore the exact drum pattern")
  if (undone.selectedTrackId !== "drums") fails.push(`Undo selected "${undone.selectedTrackId}" instead of drums`)
  if (undone.message !== "Undone.") fails.push(`the Undo message was "${undone.message}"`)
  if (!undone.canRedo) fails.push("Undo did not leave a redo step")

  const summary = JSON.stringify({ viewport: `${innerWidth}x${innerHeight}`, point: [+point.x.toFixed(1), +point.y.toFixed(1)], facts })
  if (fails.length) throw new Error(fails.join("; ") + " | " + summary)
  return "PASS " + summary
})()
