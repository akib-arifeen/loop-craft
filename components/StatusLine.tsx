"use client"

import { useEffect, useState } from "react"
import styles from "./StatusLine.module.css"

export interface Notice {
  text: string
  n: number
}

export default function StatusLine({ message, notice }: { message: string | null; notice: Notice | null }) {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    if (message) setText(message)
  }, [message])
  useEffect(() => {
    if (notice) setText(notice.text)
  }, [notice])
  useEffect(() => {
    if (!text) return
    const t = setTimeout(() => setText(null), 4000)
    return () => clearTimeout(t)
  }, [text, message, notice])

  return (
    <div className={styles.line} aria-live="polite" role="status" data-visible={text ? "true" : "false"}>
      {text}
    </div>
  )
}
