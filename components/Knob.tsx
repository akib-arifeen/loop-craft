"use client"

import { useRef, useState } from "react"
import styles from "./Knob.module.css"

interface KnobProps {
  label: string
  value: number
  min: number
  max: number
  def: number
  bipolar?: boolean
  format: (v: number) => string
  onChange: (v: number) => void
}

const C = 22
const R = 17

function pt(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180
  return [C + R * Math.sin(r), C - R * Math.cos(r)]
}

function arc(a: number, b: number): string {
  if (Math.abs(b - a) < 0.01) return ""
  const [x1, y1] = pt(a)
  const [x2, y2] = pt(b)
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 ${Math.abs(b - a) > 180 ? 1 : 0} ${b > a ? 1 : 0} ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

export default function Knob({ label, value, min, max, def, bipolar, format, onChange }: KnobProps) {
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const [drag, setDrag] = useState(false)
  const start = useRef({ y: 0, v: 0 })
  const range = max - min
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const norm = (value - min) / range
  const angle = -135 + 270 * norm
  const from = bipolar ? 0 : -135
  const [px0, py0] = (() => {
    const r = (angle * Math.PI) / 180
    return [C + 6 * Math.sin(r), C - 6 * Math.cos(r)]
  })()
  const [px1, py1] = (() => {
    const r = (angle * Math.PI) / 180
    return [C + 14 * Math.sin(r), C - 14 * Math.cos(r)]
  })()
  const text = format(value)

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: number | null = null
    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        next = value + range * 0.02
        break
      case "ArrowDown":
      case "ArrowLeft":
        next = value - range * 0.02
        break
      case "PageUp":
        next = value + range * 0.1
        break
      case "PageDown":
        next = value - range * 0.1
        break
      case "Home":
        next = min
        break
      case "End":
        next = max
        break
    }
    if (next !== null) {
      e.preventDefault()
      onChange(clamp(next))
    }
  }

  return (
    <div className={styles.wrap} data-active={hover || focus || drag}>
      <div
        className={styles.knob}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={text}
        onKeyDown={onKeyDown}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onDoubleClick={() => onChange(def)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = { y: e.clientY, v: value }
          setDrag(true)
        }}
        onPointerMove={(e) => {
          if (!drag) return
          const scale = e.shiftKey ? 0.25 : 1
          onChange(clamp(start.current.v + ((start.current.y - e.clientY) / 160) * range * scale))
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          setDrag(false)
        }}
        onPointerCancel={() => setDrag(false)}
      >
        <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
          <path className={styles.track} d={arc(-135, 135)} />
          <path className={styles.value} d={arc(from, angle)} />
          <line className={styles.pointer} x1={px0} y1={py0} x2={px1} y2={py1} />
        </svg>
      </div>
      <span className={`mono ${styles.caption}`}>{hover || focus || drag ? text : label}</span>
    </div>
  )
}
