import type { ReactNode } from "react"

function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

type P = { size?: number }

export const Play = (p: P) => <Svg {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></Svg>
export const Stop = (p: P) => <Svg {...p}><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" /></Svg>
export const Record = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="5.5" fill="currentColor" /></Svg>
export const Undo = (p: P) => <Svg {...p}><path d="M9 7 4.5 11.5 9 16" /><path d="M5 11.5h8.5a5.5 5.5 0 0 1 0 11" transform="translate(0 -4)" /></Svg>
export const Redo = (p: P) => <Svg {...p}><path d="m15 7 4.5 4.5L15 16" /><path d="M19 11.5h-8.5a5.5 5.5 0 0 0 0 11" transform="translate(0 -4)" /></Svg>
export const Metronome = (p: P) => <Svg {...p}><path d="M9 3h6l3.5 17h-13z" /><path d="m12 15 4-8" /></Svg>
export const Download = (p: P) => <Svg {...p}><path d="M12 4v11" /><path d="m7.5 11 4.5 4.5 4.5-4.5" /><path d="M5 20h14" /></Svg>
export const Link = (p: P) => <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>
export const Mic = (p: P) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></Svg>
export const Grid = (p: P) => <Svg {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></Svg>
export const Trash = (p: P) => <Svg {...p}><path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="m6.5 7 1 12.5h9l1-12.5" /></Svg>
export const Plus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
export const Lock = (p: P) => <Svg {...p}><rect x="5.5" y="11" width="13" height="9" rx="2" /><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></Svg>
export const Keyboard = (p: P) => <Svg {...p}><rect x="3" y="6.5" width="18" height="11" rx="2" /><path d="M7 10.5h.01M11 10.5h.01M15 10.5h.01M17.5 13.5h.01M6.5 14h8" /></Svg>
export const X = (p: P) => <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>
