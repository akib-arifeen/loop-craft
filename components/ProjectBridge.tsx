"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Download, X } from "./icons"
import { setModalOpen, useEngine } from "./useEngine"
import styles from "./ProjectBridge.module.css"

/**
 * The agentic bridge in the UI: show the documented project JSON, copy/download it, or paste one back
 * and apply it. It is the same shape `engine.exportProject()` / `engine.importProject()` use, so an
 * external agent (Claude Code, a script, a human) reads and writes exactly what this panel shows.
 */
export default function ProjectBridge({ onNotice }: { onNotice: (text: string) => void }) {
  const { engine } = useEngine()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const openDialog = () => {
    setText(engine.exportProject())
    setStatus(null)
    setOpen(true)
  }

  const closeDialog = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    areaRef.current?.focus()
    setModalOpen(true)
    // Document-level so Escape and the Tab trap keep working if focus ever leaves the dialog.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        closeDialog()
        return
      }
      if (e.key !== "Tab") return
      const container = dialogRef.current
      if (!container) return
      const items = Array.from(container.querySelectorAll<HTMLElement>("button, input, select, textarea")).filter((el) => !el.hasAttribute("disabled"))
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!container.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && (active === first || active === container)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      setModalOpen(false)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, closeDialog])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus({ kind: "ok", text: "Copied. Give it to an agent, then paste its version back here and Load JSON." })
    } catch {
      setStatus({ kind: "error", text: "Couldn't copy. Select the text and copy it by hand." })
    }
  }

  const download = () => {
    const blob = new Blob([text], { type: "application/json" })
    const href = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = href
    a.download = "loopcraft-project.json"
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  const apply = () => {
    const result = engine.importProject(text)
    if (result.ok) {
      setStatus({ kind: "ok", text: "Loaded: key, tempo, chord lane, patterns and mix updated. Your recorded loops are untouched." })
      onNotice("Project loaded")
    } else {
      setStatus({ kind: "error", text: result.error ?? "That project couldn't be loaded." })
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label="Project JSON for agents"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Project JSON. read or write this session from an agent"
        onClick={openDialog}
      >
        <span className="mono">{"{ }"}</span>
      </button>

      {open && (
        <div className={styles.overlay} role="presentation" onPointerDown={(e) => e.target === e.currentTarget && closeDialog()}>
          <div
            ref={dialogRef}
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-json-title"
            data-testid="project-bridge"
            tabIndex={-1}
          >
            <div className={styles.head}>
              <div>
                <h2 id="project-json-title" className={styles.title}>
                  Project JSON
                </h2>
                <p className={styles.lede}>
                  A small documented document an agent can read and write: key, tempo, chord lane, tracks, patterns and mix. Recorded loops stay in
                  this browser and are never included.
                </p>
              </div>
              <button type="button" className={styles.close} aria-label="Close project JSON" onClick={closeDialog}>
                <X size={18} />
              </button>
            </div>

            <textarea
              ref={areaRef}
              className={`mono ${styles.code}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              aria-label="Project JSON"
            />

            {status && (
              <p className={styles.status} data-kind={status.kind} role="status">
                {status.text}
              </p>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={copy}>
                Copy
              </button>
              <button type="button" className={styles.btn} onClick={download}>
                <Download size={14} /> Download
              </button>
              <button type="button" className={styles.btn} onClick={openDialog}>
                Reload current
              </button>
              <span className={styles.grow} />
              <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={apply}>
                Load JSON
              </button>
            </div>

            <p className={styles.hint}>
              Agents can drive the running app too: <code>window.__loopcraft.exportProject()</code>, <code>importProject(json)</code>,{" "}
              <code>getDocument()</code>, <code>dispatch(command)</code>. The shape is documented in the README.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
