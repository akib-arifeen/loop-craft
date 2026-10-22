"use client"

import { useEffect, useRef } from "react"
import type { TrackState } from "@/lib/audio/types"
import { useAnimationFrame, useEngine } from "./useEngine"

const BINS = 96

export default function LoopRing({ track, size = 40 }: { track: TrackState; size?: number }) {
  const { engine, snap } = useEngine()
  const canvas = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ track, record: snap.record })
  const colors = useRef({ tc: "", base: "", rec: "" })

  useEffect(() => {
    latest.current = { track, record: snap.record }
  })

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const cs = getComputedStyle(el)
    const root = getComputedStyle(document.documentElement)
    colors.current = {
      tc: cs.getPropertyValue("--tc").trim(),
      base: root.getPropertyValue("--color-paper-3").trim(),
      rec: root.getPropertyValue("--color-rec").trim(),
    }
    // --tc may itself be var(--track-n); resolve through a probe so canvas gets a concrete colour.
    const probe = document.createElement("span")
    probe.style.color = colors.current.tc
    el.parentElement?.appendChild(probe)
    colors.current.tc = getComputedStyle(probe).color
    probe.remove()
  }, [track.id])

  useAnimationFrame(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext("2d")
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const px = Math.round(size * dpr)
    if (el.width !== px) {
      el.width = px
      el.height = px
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    const { track: t, record } = latest.current
    const { tc, base, rec } = colors.current
    const c = size / 2
    const outer = c - 1.5
    const mine = record.kind !== "idle" && record.trackId === t.id

    ctx.lineWidth = 2
    ctx.strokeStyle = base
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(c, c, outer, 0, Math.PI * 2)
    ctx.stroke()

    if (t.kind === "audio" && !t.hasAudio) {
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = base
      ctx.beginPath()
      ctx.arc(c, c, outer, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (t.hasAudio && t.peaks.length > 0) {
      ctx.strokeStyle = tc
      ctx.lineWidth = 1
      ctx.lineCap = "round"
      const r0 = outer * 0.55
      for (let i = 0; i < BINS; i++) {
        const peak = t.peaks[Math.min(t.peaks.length - 1, Math.floor((i / BINS) * t.peaks.length))]
        const r1 = r0 + (outer - r0) * Math.max(0.06, Math.min(1, peak))
        const a = (i / BINS) * Math.PI * 2 - Math.PI / 2
        ctx.beginPath()
        ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0)
        ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1)
        ctx.stroke()
      }
    }

    if (mine && record.kind === "waiting") {
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 2
      ctx.strokeStyle = rec
      ctx.beginPath()
      ctx.arc(c, c, outer, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    } else if (mine && record.kind === "recording") {
      const now = engine.debug.ctx?.currentTime ?? record.startsAt
      const frac = Math.max(0, Math.min(1, (now - record.startsAt) / (record.endsAt - record.startsAt)))
      ctx.lineWidth = 2.5
      ctx.strokeStyle = rec
      ctx.beginPath()
      ctx.arc(c, c, outer, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
      ctx.stroke()
    }

    const phase = engine.getPhase()
    if (phase !== null) {
      const a = phase * Math.PI * 2 - Math.PI / 2
      const x = c + Math.cos(a) * outer
      const y = c + Math.sin(a) * outer
      ctx.globalAlpha = 0.35
      ctx.lineWidth = 1
      ctx.strokeStyle = tc
      ctx.beginPath()
      ctx.moveTo(c, c)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.fillStyle = tc
      ctx.beginPath()
      ctx.arc(x, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  })

  return <canvas ref={canvas} width={size} height={size} style={{ width: size, height: size, display: "block" }} aria-hidden="true" />
}
