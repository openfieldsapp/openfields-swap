/**
 * The few icons the Openfields apps use (the same set as Openfields Ask), drawn on one 24px grid with one stroke,
 * in the colour of the text around them. An icon is decoration: whatever it
 * sits on carries the words (a label or aria-label).
 */

const PATHS = {
  arrowUp: <path d='M12 19V5M5.5 11.5 12 5l6.5 6.5' />,
  chevronDown: <path d='m7 10 5 5 5-5' />,
  chevronRight: <path d='m10 7 5 5-5 5' />,
  chevronLeft: <path d='m14 7-5 5 5 5' />,
  check: <path d='m5 12.5 4.5 4.5L19 7.5' />,
  external: <path d='M8 16 16 8M9.5 8H16v6.5' />,
  plus: <path d='M12 5v14M5 12h14' />,
  close: <path d='M6.5 6.5l11 11M17.5 6.5l-11 11' />,
  copy: <><rect x='8.5' y='8.5' width='11' height='11' rx='2.5' /><path d='M15.5 5.5v-.5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h.5' /></>,
  retry: <path d='M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4' />,
  flip: <path d='M8 4.5v15M4.5 8 8 4.5 11.5 8M16 19.5v-15M12.5 16l3.5 3.5 3.5-3.5' />,
  search: <><circle cx='11' cy='11' r='6.5' /><path d='m16 16 4 4' /></>,
  settings: <path d='M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4' />,
  star: <path d='m12 4.5 2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z' />,
  starFilled: <path d='m12 4.5 2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z' fill='currentColor' />,
  link: <path d='M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' />,
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={1.75} strokeLinecap='round' strokeLinejoin='round' aria-hidden focusable='false'>
      {PATHS[name]}
    </svg>
  )
}
