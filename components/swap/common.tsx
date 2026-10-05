/**
 * The pieces the swap's screens share: numbers written for people, the token
 * picker, the quiet rows, errors in plain words, and the prices and depth the
 * page publishes once for every picker.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, cx, Disclosure, Icon, Modal } from 'components/ui'
import { TokenIcon } from 'components/TokenIcon'
import useMyAddress from 'components/hooks/useMyAddress'
import { askToConnect } from 'components/wallet/connect'
import { assetId, fromMicro, isListed, queryCw20Balance, tokenFor, type PoolView } from 'lib/dex'
import { fmtAmount } from 'lib/arb'
import { lcdFetch } from 'lib/lcd'
import { humanizeTxError } from 'lib/errors'
import { TOKEN_META, tokenScore } from 'lib/tokenMeta'
import { toggleFavorite, usePrefs } from 'lib/alerts'
import { useLang } from 'lib/i18n'

// ── Numbers ──────────────────────────────────────────────────────────

/** A number at its first significant digits when it is tiny: 0.00000026, never 0 or 2.6e-7. */
export function sig(n: number, digits = 3): string {
  if (!(n > 0) || !Number.isFinite(n)) return '0'
  const places = Math.min(18, Math.max(0, digits - 1 - Math.floor(Math.log10(n))))
  return n.toFixed(places).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}

/**
 * An amount in smallest units, for reading: as lib/dex fromMicro writes it, except that a balance too small
 * for its places shows its first significant digits instead of a false zero.
 */
export function amt(micro: string | number | bigint, decimals = 6, maxFrac = 4): string {
  const s = fromMicro(String(micro), decimals, maxFrac)
  const n = Number(micro) / 10 ** decimals
  return n > 0 && /^0(\.0*)?$/.test(s) ? sig(n, 2) : s
}

/** Prices for people: no scientific notation, ever. 2.6e-7 becomes 0.00000026. */
export function fmtPrice(n: number): string {
  if (!(n > 0)) return '–'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toFixed(3)
  return sig(n, 3)
}

/** "$41k", "$3.2M": dollars at a glance. */
export const compactUsd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : n >= 1 ? `$${Math.round(n)}` : n > 0 ? `$${n.toFixed(2)}` : '')

export function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

// ── Prices and depth, published once by the page for every picker ───

let tokenData: { px: Record<string, number> | null; liquidity: Map<string, number> } = { px: null, liquidity: new Map() }
const tokenDataListeners = new Set<() => void>()
export function publishTokenData(next: typeof tokenData) {
  tokenData = next
  tokenDataListeners.forEach(f => f())
}
export function useTokenData() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump(n => n + 1)
    tokenDataListeners.add(f)
    return () => { tokenDataListeners.delete(f) }
  }, [])
  return tokenData
}
/** Half of each pool's value counts toward each of its two tokens. */
export function liquidityByToken(pools: PoolView[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of pools) {
    if (!p.tvlUsd) continue
    for (const t of p.tokens) m.set(assetId(t.info), (m.get(assetId(t.info)) ?? 0) + p.tvlUsd / 2)
  }
  return m
}

type TokenOption = { key: string; label: string; info: Parameters<typeof assetId>[0]; decimals?: number; cw20?: boolean }

/** Every listed token this wallet holds: native balances in one read, cw20s one query each. */
export const balanceCache = new Map<string, { at: number; v: Record<string, string> }>()
export async function walletBalances(addr: string, options: ReadonlyArray<TokenOption>): Promise<Record<string, string>> {
  const hit = balanceCache.get(addr)
  if (hit && Date.now() - hit.at < 20_000) return hit.v
  const out: Record<string, string> = {}
  try {
    const r = await lcdFetch(`/cosmos/bank/v1beta1/balances/${addr}?pagination.limit=300`)
    if (r.ok) for (const c of ((await r.json())?.balances ?? []) as { denom: string; amount: string }[]) out[c.denom] = c.amount
  } catch { /* balances are a nicety; the picker works without them */ }
  await Promise.all(options.filter(t => 'token' in t.info).map(async t => {
    const id = assetId(t.info)
    const b = await queryCw20Balance(id, addr)
    if (b !== '0') out[id] = b
  }))
  balanceCache.set(addr, { at: Date.now(), v: out })
  return out
}

const RECENT_KEY = 'terra_recent_tokens'
function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] }
}
function rememberToken(id: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter(x => x !== id)].slice(0, 6))) } catch { /* private mode */ }
}

// ── The token picker ─────────────────────────────────────────────────

/**
 * Picking a token by looking for it, not by scrolling a list: search by
 * ticker, name, chain, what it is ("bitcoin", "gold", "staked") or a pasted
 * address. Tokens you hold come first with their value, then the rest by how
 * much liquidity stands behind them. Tokens that share a name (USDC and
 * USDC.inj) always say where they come from. A sheet from the bottom on a phone.
 */
function TokenPicker({ open, options, value, onPick, onClose }: {
  open: boolean; options: ReadonlyArray<TokenOption>; value: string; onPick: (id: string) => void; onClose: () => void
}) {
  const me = useMyAddress()
  const { px, liquidity } = useTokenData()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [bal, setBal] = useState<Record<string, string>>({})
  const { favorites } = usePrefs()
  const { t: tr } = useLang()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    setQ('')
    // With a keyboard, straight into the search; on a phone the list first, without the keyboard over it.
    const t = window.matchMedia('(hover: hover)').matches ? setTimeout(() => inputRef.current?.focus(), 60) : undefined
    return () => clearTimeout(t)
  }, [open])
  useEffect(() => {
    if (!me || !open) return
    let alive = true
    walletBalances(me, options).then(b => { if (alive) setBal(b) }).catch(() => {})
    return () => { alive = false }
  }, [me, options, open])

  const decimalsOf = (t: TokenOption) => t.decimals ?? tokenFor(t.info).decimals
  const held = (t: TokenOption) => Number(bal[assetId(t.info)] ?? 0) / 10 ** decimalsOf(t)
  const usdHeld = (t: TokenOption) => { const p = px?.[assetId(t.info)]; return p ? held(t) * p : 0 }
  const liq = (t: TokenOption) => liquidity.get(assetId(t.info)) ?? 0
  /** Tokens sharing a name with another listed token, so each can say which one it is not. */
  const namesakes = useMemo(() => {
    const byName = new Map<string, string[]>()
    for (const t of options) { const n = TOKEN_META[t.key]?.name ?? t.label; byName.set(n, [...(byName.get(n) ?? []), t.label]) }
    return byName
  }, [options])

  const rank = (score: number) => (score >= 90 ? 2 : score >= 40 ? 1 : 0)
  const list = useMemo(() => {
    const rows = options
      .map(t => ({ t, score: tokenScore({ key: t.key, label: t.label, id: assetId(t.info) }, q) }))
      .filter(r => r.score > 0)
    return q.trim()
      // An exact ticker or address goes first; among the other real matches, the deepest market wins.
      ? rows.sort((a, b) => rank(b.score) - rank(a.score) || liq(b.t) - liq(a.t)).map(r => r.t)
      : rows.map(r => r.t).sort((a, b) => Number(favorites.includes(assetId(b.info))) - Number(favorites.includes(assetId(a.info))) || Number(held(b) > 0) - Number(held(a) > 0) || usdHeld(b) - usdHeld(a) || liq(b) - liq(a))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, q, bal, px, liquidity, favorites])
  useEffect(() => { setActive(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const popular = useMemo(() => [...options].sort((a, b) => liq(b) - liq(a)).slice(0, 5),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, liquidity])
  const recent = useMemo(() => (open ? readRecent() : []).map(id => options.find(t => assetId(t.info) === id)).filter((t): t is TokenOption => !!t).slice(0, 5), [options, open])
  const favs = favorites.map(id => options.find(t => assetId(t.info) === id)).filter((t): t is TokenOption => !!t).slice(0, 8)
  const pick = (t: TokenOption) => { rememberToken(assetId(t.info)); onPick(assetId(t.info)) }
  const looksLikeAddress = /^(terra1|ibc\/|factory\/|cw20:)/i.test(q.trim())

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(0, list.length - 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && list[active]) { e.preventDefault(); pick(list[active]) }
  }
  const chips = (label: string, ts: TokenOption[]) => ts.length > 0 && (
    <div className='sw-chip-row'>
      <span>{label}</span>
      {ts.map(t => <button key={t.key} type='button' className='of-chip' onClick={() => pick(t)}><TokenIcon label={t.label} size={20} />{t.label}</button>)}
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={tr('Select a token')}>
      <div className='sw-picker' onKeyDown={onKey}>
        <input ref={inputRef} className='sw-input sw-input--sm' value={q} onChange={e => setQ(e.target.value)} placeholder={tr('Name, ticker, chain, or paste an address')}
          aria-label={tr('Search tokens')} spellCheck={false} autoComplete='off' />
        {!q.trim() && (
          <div className='sw-picker-chips'>
            {chips(tr('Starred'), favs)}
            {chips(tr('Recent'), recent)}
            {chips(tr('Deepest'), popular)}
          </div>
        )}
        <div ref={listRef} className='sw-toks' role='listbox' aria-label={tr('Tokens')}>
          {list.length === 0 && (
            <p className='of-note'>
              {tr(looksLikeAddress ? 'That address is not one of the listed tokens here. Unlisted tokens are not offered, so a look-alike cannot slip in.' : 'No listed token matches that.')}
            </p>
          )}
          {list.map((t, i) => {
            const id = assetId(t.info)
            const meta = TOKEN_META[t.key]
            const h = held(t), usd = usdHeld(t), depth = liq(t)
            const others = (namesakes.get(meta?.name ?? t.label) ?? []).filter(l => l !== t.label)
            const fav = favorites.includes(id)
            // Only there because a link asked for it by address (the swap box): say so, with the whole address.
            const unlisted = !isListed(t.info)
            return (
              <div key={id} data-row={i} role='option' aria-selected={id === value} className={cx('sw-tok', i === active && 'is-active')}
                onMouseEnter={() => setActive(i)} onClick={() => pick(t)}>
                <TokenIcon label={t.label} size={32} />
                <div className='sw-tok-main'>
                  <span className='sw-tok-name'>{t.label}{meta?.name && meta.name !== t.label && <small>{meta.name}</small>}</span>
                  {unlisted
                    ? <span className='sw-tok-sub sw-neg'>{tr('Unlisted token')} · {id}</span>
                    : (meta?.origin || others.length > 0 || 'token' in t.info) && (
                      <span className={cx('sw-tok-sub', others.length > 0 && 'is-twin')}>
                        {meta?.origin ?? (('token' in t.info) ? 'Terra, cw20' : '')}{others.length > 0 ? ` · ${tr('a different token from {others}', { others: others.join(' and ') })}` : ''}
                      </span>
                    )}
                </div>
                <div className='sw-tok-end'>
                  {h > 0
                    ? <><span>{fmtAmount(h)}</span><small>{compactUsd(usd)}</small></>
                    : depth > 0 ? <small>{tr('{amount} liquidity', { amount: compactUsd(depth) })}</small> : null}
                </div>
                <button type='button' className='of-icon-btn sw-star' aria-pressed={fav} aria-label={fav ? `Unstar ${t.label}` : `Star ${t.label}`} title={fav ? 'Starred: shown first' : 'Star it to keep it at the top'}
                  onClick={e => { e.stopPropagation(); toggleFavorite(id) }}>
                  <Icon name={fav ? 'starFilled' : 'star'} size={16} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

/** The button that opens the token picker: the mark, the ticker, a chevron. `block` fills its row. */
export function TokenSelect({ value, onChange, options, block, label }: {
  value: string; onChange: (v: string) => void; options: ReadonlyArray<TokenOption>; block?: boolean; label?: string
}) {
  const [open, setOpen] = useState(false)
  const cur = options.find(t => assetId(t.info) === value)
  return (
    <>
      <button type='button' className={cx('sw-token', block && 'sw-token--block', !cur && 'sw-token--empty')} onClick={() => setOpen(true)} aria-haspopup='dialog'
        aria-label={cur ? `${label ? `${label}: ` : ''}${cur.label}. Change token` : 'Select a token'}>
        {cur ? <><TokenIcon label={cur.label} size={24} /><span className='sw-token-name'>{cur.label}</span>{!isListed(cur.info) && <span className='sw-unlisted'>unlisted</span>}</> : <span>Select</span>}
        <Icon name='chevronDown' size={16} />
      </button>
      <TokenPicker open={open} options={options} value={value} onPick={v => { onChange(v); setOpen(false) }} onClose={() => setOpen(false)} />
    </>
  )
}

/** A token that cannot be changed here, shown the way the token button is. */
export function TokenFixed({ label }: { label: string }) {
  return <span className='sw-token' aria-label={label}><TokenIcon label={label} size={24} /><span className='sw-token-name'>{label}</span></span>
}

// ── Rows, notes, errors ──────────────────────────────────────────────

export type Tone = 'muted' | 'warn' | 'bad' | 'good' | 'strong'

export function Row({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: Tone }) {
  return (
    <div className={cx('sw-row', tone && `is-${tone}`)}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}

/** An error as people read it, and the wallet's or the chain's own words under Details. */
export interface Failure { text: string; detail?: string }
export function ErrorNote({ error }: { error: Failure | null }) {
  if (!error) return null
  return (
    <div className='sw-error' role='alert'>
      <p>{error.text}</p>
      {error.detail && error.detail !== error.text && <Disclosure summary='Details'><pre className='of-code'>{error.detail}</pre></Disclosure>}
    </div>
  )
}
/** The raw message of anything thrown, for Details. */
export const detailOf = (e: unknown): string => String((e as Error)?.message ?? e ?? '').slice(0, 600)
/** What a failed signature or transaction means for the person, and the raw words behind it. */
export function failureOf(e: unknown): Failure {
  const raw = detailOf(e)
  if (/reject|denied|cancel/i.test(raw)) return { text: 'You declined in the wallet. Nothing was sent.' }
  return { text: humanizeTxError(e), detail: raw }
}

/** The one button of a form: Connect when no wallet is connected, otherwise the action. */
export function ActionButton({ me, label, onClick, disabled, busy, variant = 'primary' }: {
  me: string; label: ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean; variant?: 'primary' | 'secondary'
}) {
  const { t } = useLang()
  if (!me) return <Button variant='primary' size='lg' block onClick={askToConnect}>{t('Connect wallet')}</Button>
  return <Button variant={variant} size='lg' block onClick={onClick} disabled={disabled} busy={busy}>{label}</Button>
}

/** A heading and one action, for a screen with nothing to show yet. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className='sw-empty'>
      <p className='sw-empty-title'>{title}</p>
      {children}
    </div>
  )
}

/** A few numbers side by side: the label, the number, a line under it. */
export function Figures({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <dl className='sw-figs'>
      {items.map(f => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd className='of-num'>{f.value}</dd>
          {f.sub && <dd className='sw-fine'>{f.sub}</dd>}
        </div>
      ))}
    </dl>
  )
}

/** A short-lived line at the bottom of the screen. */
export function Toast({ msg, href, onDone }: { msg: string; href?: string; onDone: () => void }) {
  // Re-armed on every new message: a toast that replaces another gets its full time.
  useEffect(() => { const t = setTimeout(onDone, 5200); return () => clearTimeout(t) }, [msg, href, onDone])
  return (
    <div className='sw-toast' role='status'>
      <span>{msg}</span>
      {href && <a href={href} target='_blank' rel='noopener noreferrer'>View on Openfields Scan</a>}
    </div>
  )
}
