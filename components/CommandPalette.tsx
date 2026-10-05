/**
 * Search everything the site does: ⌘K (Ctrl+K), or the search button in the
 * header. Sections and pages, the things people miss (bringing money in from
 * another chain, liquid staking against the hubs, closing a gap), every token
 * to buy or sell, and every pool with liquidity. Typing filters on the label,
 * the description and a few extra words each item answers to; arrows and Enter
 * pick. The site does a lot, and most of it was only findable by accident.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IconButton } from 'components/ui'

export interface PaletteItem {
  id: string
  group: string
  label: string
  hint?: string
  /** other words it answers to */
  keywords?: string
  icon?: React.ReactNode
  run: () => void
}

/** Shown before anything is typed, in this order. Tokens and pools wait for a query: there are too many. */
const RESTING = ['Do', 'Go to', 'Pages']
/**
 * When groups match equally well, the one more likely wanted comes first: typing "luna" means buying or
 * selling LUNA before it means one of the thirty pools holding it. Pools are capped so a common token
 * cannot push everything else out of the list.
 */
const PRIORITY: Record<string, number> = { 'Do': 3, 'Go to': 3, 'Pages': 2, 'Tokens': 2, 'Pools': 0 }
const CAP: Record<string, number> = { 'Tokens': 8, 'Pools': 8 }

function score(item: PaletteItem, words: string[]): number {
  const label = item.label.toLowerCase()
  const parts = label.split(/[\s/·]+/)
  const hay = `${label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase()
  let s = 0
  for (const w of words) {
    if (!hay.includes(w)) return 0
    s += parts.includes(w) ? 5 : label.startsWith(w) ? 4 : parts.some(part => part.startsWith(w)) ? 3 : label.includes(w) ? 2 : 1
  }
  return s
}

export default function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /** Phones get no keyboard hints; the palette only ever opens in the browser, so window is there. */
  const [touch] = useState(() => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches)
  // Focus goes to the search box, and back to wherever it was (the Search button, usually) on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => { before?.focus?.() }
  }, [])

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      return items.filter(i => RESTING.includes(i.group)).sort((a, b) => RESTING.indexOf(a.group) - RESTING.indexOf(b.group))
    }
    // Best match first, and each group kept together so its heading appears once.
    const hits = items.map(i => ({ i, s: score(i, words) })).filter(x => x.s > 0)
    const best = new Map<string, number>()
    for (const h of hits) best.set(h.i.group, Math.max(best.get(h.i.group) ?? 0, h.s + (PRIORITY[h.i.group] ?? 1)))
    const shown = new Map<string, number>()
    return hits
      .sort((a, b) => (best.get(b.i.group)! - best.get(a.i.group)!) || a.i.group.localeCompare(b.i.group) || b.s - a.s)
      .filter(x => {
        const n = (shown.get(x.i.group) ?? 0) + 1
        shown.set(x.i.group, n)
        return n <= (CAP[x.i.group] ?? Infinity)
      })
      .slice(0, 40)
      .map(x => x.i)
  }, [items, q])
  useEffect(() => { setActive(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (item: PaletteItem) => { onClose(); item.run() }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'Tab') { e.preventDefault(); setActive(a => (list.length ? (a + (e.shiftKey ? list.length - 1 : 1)) % list.length : 0)) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(0, list.length - 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && list[active]) { e.preventDefault(); pick(list[active]) }
  }

  return (
    <div className='of-overlay sw-pal-overlay' onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className='sw-pal' role='dialog' aria-modal='true' aria-label='Search everything' onKeyDown={onKey}>
        <div className='sw-pal-head'>
          <Icon name='search' size={18} />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} aria-label='Search'
            placeholder='A token, a pool, or what you want to do' spellCheck={false} autoComplete='off'
            role='combobox' aria-expanded='true' aria-controls='sw-pal-list' aria-activedescendant={list[active] ? `sw-pal-${active}` : undefined} />
          <IconButton icon='close' label='Close' onClick={onClose} />
        </div>
        <div ref={listRef} id='sw-pal-list' role='listbox' className='sw-pal-list'>
          {list.length === 0 && <p className='sw-pal-empty'>Nothing matches. Try LUNA, bridge, pool or history.</p>}
          {list.map((item, idx) => (
            <div key={item.id}>
              {(idx === 0 || list[idx - 1].group !== item.group) && <div className='sw-pal-group'>{item.group}</div>}
              <div id={`sw-pal-${idx}`} data-row={idx} role='option' aria-selected={idx === active} className={`sw-pal-item${idx === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(idx)} onClick={() => pick(item)}>
                {item.icon && <span className='sw-pal-icon' aria-hidden>{item.icon}</span>}
                <div>
                  <b>{item.label}</b>
                  {item.hint && <span>{item.hint}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
        {!q && !touch && <div className='sw-pal-foot'>Arrows to move, Enter to open, Esc to close.</div>}
      </div>
    </div>
  )
}
