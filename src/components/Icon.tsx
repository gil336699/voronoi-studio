// Small symbols for buttons, drawn on a 24-unit grid to sit with 12–13 px text.
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const PATHS = {
  play: <path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6Z" />,
  pause: <g><rect x="6.5" y="5" width="4" height="14" rx="1.4" /><rect x="13.5" y="5" width="4" height="14" rx="1.4" /></g>,
  dice: <g {...stroke}><rect x="4" y="4" width="16" height="16" rx="4" /><circle cx="9" cy="9" r=".9" fill="currentColor" /><circle cx="15" cy="15" r=".9" fill="currentColor" /><circle cx="15" cy="9" r=".9" fill="currentColor" /><circle cx="9" cy="15" r=".9" fill="currentColor" /></g>,
  relax: <g {...stroke}><path d="M4 7h10M4 12h16M4 17h7" /><path d="m17 4 3 3-3 3" /></g>,
  undo: <g {...stroke}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></g>,
  redo: <g {...stroke}><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></g>,
  move: <path d="M6 3.5v15.2l4.1-3.9 2.7 6.1 2.6-1.1-2.7-6h5.8L6 3.5Z" />,
  add: <g {...stroke}><circle cx="12" cy="12" r="8" /><path d="M12 8.5v7M8.5 12h7" /></g>,
  erase: <g {...stroke}><circle cx="12" cy="12" r="8" /><path d="M8.5 12h7" /></g>,
  pan: <g {...stroke}><path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" /></g>,
  fit: <g {...stroke}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></g>,
  minus: <g {...stroke}><path d="M6 12h12" /></g>,
  plus: <g {...stroke}><path d="M12 6v12M6 12h12" /></g>,
  import: <g {...stroke}><path d="M12 3v11M7.5 9.5 12 14l4.5-4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></g>,
  picture: <g {...stroke}><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="m3.5 16 5-5 4.5 4.5 2.5-2.5 5 5" /><circle cx="15.5" cy="9.5" r="1.4" /></g>,
  swap: <g {...stroke}><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></g>,
}

export type IconName = keyof typeof PATHS

export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">{PATHS[name]}</svg>
}
