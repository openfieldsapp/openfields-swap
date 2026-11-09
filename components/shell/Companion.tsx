/**
 * ✦ Openfields Ask in the corner (v0 outside Home; plan in openfields-ops/proposals/ask-everywhere-2026-10-06.md).
 * The same file in Stake, Swap and Data, with styles/companion.css; Home has its own, with the portfolio.
 *
 * One quiet button that opens a small panel: what waits for the connected wallet as Openfields Home reads it
 * (its reader's /waiting, no model), each line opening its card in Home; a link to the whole wallet there; and a
 * field that opens the question in Openfields Ask, filled in but not sent.
 *
 * Never opens by itself, never animates, never a count. When something touches the person's money (a loan near
 * its limit, LUNA ready to withdraw) the button carries one calm dot, and says so to a screen reader. Read once
 * the page has settled and kept for a few minutes; if Home cannot answer, the panel still has the link and field.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { usePopover } from './usePopover'
import { Icon } from 'components/ui'
import { ASK_URL, TERRA_HOME_URL } from 'lib/products'

interface Line { id: string; text: string; urgent: boolean }
type Waiting = 'none' | 'reading' | 'failed' | Line[]

/** Read again after this long within one visit. */
const KEEP_MS = 3 * 60_000
const KEY = 'openfields:waiting:v1:'
/** Lines shown, as in Home's panel. */
const MAX = 4

const isLine = (x: unknown): x is Line => {
  const l = x as Partial<Line> | null
  return typeof l?.id === 'string' && /^[A-Za-z0-9.-]{1,40}$/.test(l.id) && typeof l.text === 'string' && l.text.length > 0 && l.text.length < 200
}

function kept(address: string): Line[] | null {
  try {
    const k = JSON.parse(sessionStorage.getItem(KEY + address) ?? 'null') as { at: number; items: Line[] } | null
    return k && Date.now() - k.at < KEEP_MS && Array.isArray(k.items) ? k.items.filter(isLine) : null
  } catch { return null }
}

function keep(address: string, items: Line[]) {
  try { sessionStorage.setItem(KEY + address, JSON.stringify({ at: Date.now(), items })) } catch { /* read again next time */ }
}

async function readWaiting(address: string): Promise<Line[] | null> {
  try {
    const r = await fetch(`${TERRA_HOME_URL}/api/h/waiting?address=${address}`, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) return null
    const j = await r.json() as { address?: string; items?: unknown[] }
    if (j?.address !== address || !Array.isArray(j.items)) return null
    return j.items.filter(isLine).slice(0, MAX).map(l => ({ id: l.id, text: l.text, urgent: l.urgent === true }))
  } catch { return null }
}

/** Runs `fn` once the browser is idle (or soon after, where it cannot say); returns how to call it off. */
function whenIdle(fn: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 4000 })
    return () => w.cancelIdleCallback!(id)
  }
  const id = window.setTimeout(fn, 1500)
  return () => window.clearTimeout(id)
}

export default function Companion({ address = '' }: { address?: string }) {
  const { open, setOpen, root } = usePopover()
  const [q, setQ] = useState('')
  const [waiting, setWaiting] = useState<Waiting>('none')

  useEffect(() => {
    if (!address) { setWaiting('none'); return }
    const have = kept(address)
    if (have) { setWaiting(have); return }
    setWaiting('reading')
    let alive = true
    const stop = whenIdle(() => {
      readWaiting(address).then(l => {
        if (!alive) return
        if (l) keep(address, l)
        setWaiting(l ?? 'failed')
      })
    })
    return () => { alive = false; stop() }
  }, [address])

  const lines = Array.isArray(waiting) ? waiting : []
  const urgent = lines.some(l => l.urgent)
  const home = address ? `${TERRA_HOME_URL}/?address=${address}` : TERRA_HOME_URL

  const ask = (e: FormEvent) => {
    e.preventDefault()
    const text = q.trim()
    if (!text) return
    // Opened in Openfields Ask, filled in but not sent: the person reads it there and presses Ask.
    window.open(`${ASK_URL}/?q=${encodeURIComponent(text.slice(0, 1500))}`, '_blank', 'noopener,noreferrer')
    setQ('')
    setOpen(false)
  }

  return (
    <div className='of-cmp' ref={root}>
      {open && (
        <div className='of-cmp-pop' role='dialog' aria-label='Openfields Ask'>
          {address && (
            <>
              <p className='of-cmp-label'>{Array.isArray(waiting) && waiting.length === 0 ? 'Nothing waits for this wallet' : 'For this wallet'}</p>
              {waiting === 'reading' && <p className='of-cmp-note'>Reading…</p>}
              {waiting === 'failed' && <p className='of-cmp-note'>Openfields Home could not be read just now.</p>}
              {lines.map(l => (
                <a key={l.id} className='of-cmp-item' href={`${home}&do=${encodeURIComponent(l.id)}`}>
                  {l.urgent && <span className='of-cmp-dot' aria-hidden />}
                  <span>{l.text}</span>
                  <Icon name='chevronRight' size={16} />
                </a>
              ))}
            </>
          )}
          <a className='of-cmp-item of-cmp-home' href={home}>
            <span>{address ? 'Everything in Openfields Home' : 'Your wallet in Openfields Home'}</span>
            <Icon name='chevronRight' size={16} />
          </a>
          <form className='of-cmp-ask' onSubmit={ask}>
            <input className='of-cmp-input' placeholder='Ask Openfields Ask' aria-label='Ask Openfields Ask' value={q} onChange={e => setQ(e.target.value)} maxLength={1500} />
            <button type='submit' className='of-icon-btn' aria-label='Open in Openfields Ask' disabled={!q.trim()}><Icon name='arrowUp' size={16} /></button>
          </form>
        </div>
      )}
      <button type='button' className='of-cmp-btn' aria-expanded={open} aria-label={urgent ? 'Openfields Ask: something waits for you' : 'Openfields Ask'} onClick={() => setOpen(o => !o)}>
        <span aria-hidden>✦</span>
        {urgent && <span className='of-cmp-dot of-cmp-dot--on' aria-hidden />}
      </button>
    </div>
  )
}
