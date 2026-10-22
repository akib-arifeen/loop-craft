"use client"

import { useEffect, useRef } from "react"
import type { TrackState } from "@/lib/audio/types"
import { useAnimationFrame, useEngine } from "./useEngine"

export default function LoopLane({ track }: { track: TrackState }) {
  const { engine, snap } = useEngine()
  const canvas = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ track, record: snap.record })
  const colors = useRef({ bar: "", ink: "", rec: "", dash: "" })

  useEffect(() => {
    latest.current = { track, record: snap.record }
  })

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    // Resolve token colours to concrete values via a probe element so canvas can use them.
    const probe = document.createElement("span")
    el.parentElement?.appendChild(probe)
    const resolve = (css: string) => {
      probe.style.color = css
      return getComputedStyle(probe).color
    }
    colors.current = {
      bar: resolve("color-mix(in oklch, var(--tc) 70%, var(--color-paper-2))"),
      ink: resolve("var(--color-ink)"),
      rec: resolve("color-mix(in oklch, var(--color-rec) 30%, transparent)"),
      dash: resolve("var(--color-paper-4)"),
    }
    probe.remove()
  }, [track.id])

  useAnimationFrame(() => {
    const el = canvas.current
    if (!el || el.clientWidth === 0) return
    const dpr = window.devicePixelRatio || 1
    const w = el.clientWidth
    const h = el.clientHeight
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
    }
    const ctx = el.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const { track: t, record } = latest.current
    const { bar, ink, rec, dash } = colors.current
    const mid = h / 2

    if (t.hasAudio && t.peaks.length > 0) {
      const n = t.peaks.length
      const bw = w / n
      ctx.fillStyle = bar
      for (let i = 0; i < n; i++) {
        const half = Math.max(0.5, Math.min(1, t.peaks[i]) * (mid - 2))
        ctx.fillRect(i * bw, mid - half, Math.max(1, bw - 0.5), half * 2)
      }
    } else {
      ctx.strokeStyle = dash
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(w, mid)
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (record.kind === "recording" && record.trackId === t.id) {
      const now = engine.debug.ctx?.currentTime ?? record.startsAt
      const f = Math.max(0, Math.min(1, (now - record.startsAt) / (record.endsAt - record.startsAt)))
      ctx.fillStyle = rec
      ctx.fillRect(0, 0, w * f, h)
    }

    const phase = engine.getPhase()
    if (phase !== null) {
      ctx.fillStyle = ink
      ctx.fillRect(phase * w - 0.75, 0, 1.5, h)
    }
  })

  return <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block" }} aria-hidden="true" />
}
