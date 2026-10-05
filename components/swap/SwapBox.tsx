/**
 * The swap box: pay (token and amount, the balance beside it) becomes receive
 * (estimated), and one button. The rate, the least you receive, the price
 * impact and the network fee are quiet rows under it; the route, the slippage
 * setting and the pools behind it are one step away.
 *
 * Every number comes from lib/route: the best path over Openfields Swap's,
 * Astroport's and Skeleton Swap's pools, priced by the pools' own simulations,
 * and priced again before the wallet opens.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button, Disclosure, Icon, IconButton, Modal } from 'components/ui'
import { TokenIcon } from 'components/TokenIcon'
import DepthCurve from 'components/DepthCurve'
import useMyAddress from 'components/hooks/useMyAddress'
import { askToConnect } from 'components/wallet/connect'
import { useLstBond, useLstUnbond, useTradeSwap } from 'components/transactions/useDex'
import {
  assetId, fromMicro, isListed, queryBalance, sameAsset, toMicro, HOME_VENUE, IS_ASTRO, VENUE_NAME,
  type KnownToken, type PoolView,
} from 'lib/dex'
import { fmtAmount } from 'lib/arb'
import { quoteBest, quoteExactOut, planRoute, planTrade, tradeText, tradeMemo, reachable, type Quotes, type TradePlan } from 'lib/route'
import { tradeMsgs } from 'lib/msgs'
import { estimateFee } from 'lib/gas'
import { explainTx, type TxFix } from 'lib/errors'
import { recentMovePct, suggestSlippage, type SlipAdvice } from 'lib/slippage'
import { hubForToken, hubInfo, type HubInfo } from 'lib/lst'
import { plainAmount } from 'lib/csv'
import type { DepthResponse } from 'lib/api/depth'
import type { PricesResponse } from 'lib/api/dex-prices'
import { useLang } from 'lib/i18n'
import { SCAN_TX, STAKE_URL, TERRA_HOME_URL } from 'lib/products'
import { amt, ErrorNote, failureOf, fmtPrice, Row, TokenSelect, useDebounced, useTokenData, type Failure } from './common'

/** A pair and a size handed to the swap box from somewhere else on the page. */
export interface SwapPreset { fromId: string; toId: string; amount: string; n: number }

const APP_NAME = IS_ASTRO ? 'Openfields Pools' : 'Openfields Swap'
const bpsPct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`
/** One leg's pool fee, for a pool on any venue. Openfields Swap's factory sends all of it to LPs; Skeleton Swap's pools each set their own. */
export const poolFeeTextFor = (p: PoolView) => p.venue === 'terraswap'
  ? '0.3% to LPs on Openfields Swap'
  : p.venue === 'skeleton'
    ? p.fees ? `${bpsPct(p.fees.lpBps + p.fees.protocolBps + p.fees.burnBps)}, ${bpsPct(p.fees.lpBps)} of it to LPs, on Skeleton Swap` : 'fee set by the pool, on Skeleton Swap'
    : `${p.pairType === 'xyk' ? '0.3%' : p.pairType === 'stable' ? '0.05%' : 'dynamic'} on Astroport`

const AMOUNT_RE = /^\d{1,12}(\.\d{1,8})?$/

// ── The price, quietly ───────────────────────────────────────────────

/** A pool's price over its recorded trades, and the last few trades, read from the chain. */
export function PriceChart({ pool, from, to }: { pool: PoolView; from: KnownToken; to: KnownToken }) {
  const [data, setData] = useState<PricesResponse | null>(null)
  const [read, setRead] = useState(false)
  useEffect(() => {
    let alive = true
    setData(null); setRead(false)
    fetch(`/api/dex-prices?pair=${pool.contract_addr}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setData(j) }).catch(() => {})
      .finally(() => { if (alive) setRead(true) })
    return () => { alive = false }
  }, [pool.contract_addr])

  // Shown as "to per from" (1 from = N to). The API returns quote-per-base with base = pool.tokens[0].
  const fromIsBase = sameAsset(from.info, pool.tokens[0].info)
  const spot = fromIsBase ? pool.price : (pool.price > 0 ? 1 / pool.price : 0)
  const series = useMemo(() => {
    const raw = (data?.points ?? []).map(pt => (fromIsBase ? pt.p : (pt.p > 0 ? 1 / pt.p : 0))).filter(n => Number.isFinite(n) && n > 0)
    if (spot > 0) raw.push(spot)
    return raw
  }, [data, fromIsBase, spot])
  const change = series.length >= 2 ? (series[series.length - 1] - series[0]) / series[0] * 100 : null
  const W = 300, H = 64, PAD = 3
  const path = useMemo(() => {
    if (series.length < 2) return ''
    const min = Math.min(...series), max = Math.max(...series), span = max - min || 1
    return series.map((v, i) => `${i === 0 ? 'M' : 'L'}${(PAD + (i / (series.length - 1)) * (W - PAD * 2)).toFixed(1)},${(H - PAD - ((v - min) / span) * (H - PAD * 2)).toFixed(1)}`).join(' ')
  }, [series])

  return (
    <div className='sw-chart'>
      <div className='sw-chart-head'>
        <div>
          <div className='sw-fine'>1 {from.label}</div>
          <div className='sw-chart-price'>{spot > 0 ? `${fmtPrice(spot)} ${to.label}` : '–'}</div>
        </div>
        {change !== null && <span className={`sw-chart-change ${change >= 0 ? 'sw-pos' : 'sw-neg'}`}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span>}
      </div>
      {series.length >= 2
        ? <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' role='img' aria-label={`Price of ${from.label} in ${to.label} over the last ${series.length} trades`}>
            <path d={path} fill='none' stroke='currentColor' className={change !== null && change < 0 ? 'sw-neg' : 'sw-pos'} strokeWidth='1.75' vectorEffect='non-scaling-stroke' strokeLinejoin='round' strokeLinecap='round' />
          </svg>
        : <p className='sw-fine'>{read ? 'Not enough trades for a chart yet.' : 'Reading trades…'}</p>}
      {data && data.tape.length > 0 && (
        <div className='sw-tape' aria-label='Recent trades'>
          {data.tape.slice(0, 3).map(r => {
            const bt = pool.tokens[0], qt = pool.tokens[1]
            return (
              <a key={r.tx} href={SCAN_TX(r.tx)} target='_blank' rel='noopener noreferrer'>
                <span className={r.side === 'buy' ? 'sw-pos' : 'sw-neg'}>{r.side === 'buy' ? 'Bought' : 'Sold'}</span>
                <span>{fmtAmount(r.base)} {bt.label} for {fmtAmount(r.quote)} {qt.label}</span>
                <span className='sw-tape-end'>#{r.h.toLocaleString('en-US')}</span>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** How much a pool has moved over its last trades (lib/slippage recentMovePct), read at most once a minute per pool. */
const moveCache = new Map<string, { at: number; pct: Promise<number> }>()
function poolMovePct(pair: string): Promise<number> {
  const hit = moveCache.get(pair)
  if (hit && Date.now() - hit.at < 60_000) return hit.pct
  const pct = fetch(`/api/dex-prices?pair=${pair}`)
    .then(r => (r.ok ? r.json() : null))
    .then((j: PricesResponse | null) => recentMovePct(j?.points ?? []))
    .catch(() => 0)
  moveCache.set(pair, { at: Date.now(), pct })
  return pct
}

/**
 * The route drawn: for each part of the trade, the tokens it passes through
 * and the site whose pool each hop uses, with what that hop returns at the
 * quote. A split shows both paths with their share of the amount.
 */
function RouteMap({ parts }: { parts: TradePlan['parts'] }) {
  const { t } = useLang()
  const first = Math.round(parts[0].share * 100)
  const tok = (k: KnownToken, micro: string) => <span className='sw-route-tok'><TokenIcon label={k.label} size={16} />{fmtAmount(Number(micro) / 10 ** k.decimals)} {k.label}</span>
  return (
    <div className='sw-route'>
      <p className='sw-fine'>{t(parts.length > 1 ? 'Split over two paths that share no pool' : 'Route')}</p>
      {parts.map((part, i) => (
        <div key={i} className='sw-route-path'>
          {parts.length > 1 && <b>{i === 0 ? first : 100 - first}%</b>}
          {tok(part.quote.legs[0].offer, part.quote.legs[0].offerMicro)}
          {part.quote.legs.map((l, k) => (
            <Fragment key={k}>
              <span className='sw-route-hop' title={`${l.pool.label} · ${poolFeeTextFor(l.pool)}${l.pool.tvlUsd != null ? ` · $${Math.round(l.pool.tvlUsd).toLocaleString('en-US')} liquidity` : ''}`}>
                <Icon name='chevronRight' size={14} />{VENUE_NAME[l.pool.venue]}<Icon name='chevronRight' size={14} />
              </span>
              {tok(l.ask, l.returnMicro)}
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  )
}

/** How large this trade could be before its price moves (lib/depth, /api/depth), read once per pair and kept for the visit. */
const depthCache = new Map<string, Promise<DepthResponse | null>>()
const sizeText = (usd: number) => (usd >= 10_000 ? `$${Math.round(usd / 1000).toLocaleString('en-US')}k` : usd >= 1000 ? `$${(usd / 1000).toFixed(1)}k` : `$${Math.round(usd)}`)

function SizeRows({ from, to, amount }: { from: KnownToken; to: KnownToken; amount: string }) {
  const { t } = useLang()
  const { px } = useTokenData()
  const [d, setD] = useState<DepthResponse | null>(null)
  useEffect(() => {
    let alive = true
    setD(null)
    const key = `${from.key}|${to.key}`
    let job = depthCache.get(key)
    if (!job) {
      job = fetch(`/api/depth?from=${encodeURIComponent(from.key)}&to=${encodeURIComponent(to.key)}`)
        .then(r => (r.ok ? (r.json() as Promise<DepthResponse>) : null))
        .catch(() => null)
        .then(j => { if (!j) depthCache.delete(key); return j })
      depthCache.set(key, job)
    }
    job.then(j => { if (alive) setD(j) })
    return () => { alive = false }
  }, [from.key, to.key])
  if (!d || d.kind !== 'route') return null
  const last = d.points[d.points.length - 1]?.usd ?? 0
  const marks = d.marks.map(m => t('{pct}% at {size}', {
    pct: m.pct,
    size: m.usd == null ? t('over {size}', { size: sizeText(last) }) : m.below ? t('under {size}', { size: sizeText(Math.max(m.usd, 1)) }) : t('about {size}', { size: sizeText(m.usd) }),
  }))
  const price = px?.[assetId(from.info)]
  const atUsd = price && Number(amount) > 0 ? Number(amount) * price : null
  return (
    <>
      <Row k={t('Size before the price moves')} v={marks.join(' · ')} tone='muted' />
      <DepthCurve depth={d} atUsd={atUsd} height={80} />
    </>
  )
}

/**
 * A liquid staking token's hub can beat the pool: redeeming there pays the full
 * exchange rate after unbonding, and minting there can cost less than buying.
 * When it does, say by how much and offer it next to the swap. See lib/lst.
 */
function HubAlternative({ from, to, micro, swapOut, blocked, onDone }: {
  from: KnownToken; to: KnownToken; micro: string | null; swapOut: string | null; blocked: boolean; onDone: () => void
}) {
  const me = useMyAddress()
  const bond = useLstBond()
  const unbond = useLstUnbond()
  const fromId = assetId(from.info), toId = assetId(to.info)
  const minting = fromId === 'uluna'
  const hub = minting ? hubForToken(toId) : toId === 'uluna' ? hubForToken(fromId) : null
  const [info, setInfo] = useState<HubInfo | null>(null)
  const [err, setErr] = useState<Failure | null>(null)
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setInfo(null); setErr(null); setDone(null)
    if (hub) hubInfo(hub).then(v => { if (alive) setInfo(v) }).catch(() => {})
    return () => { alive = false }
  }, [hub])
  if (!hub || !info || !micro || micro === '0') return null
  // LUNA, ampLUNA and bLUNA all have 6 decimals, so the amounts compare directly.
  const hubOut = Math.floor(minting ? Number(micro) / info.rate : Number(micro) * info.rate)
  const swap = Number(swapOut ?? 0)
  const edge = swap > 0 ? (hubOut / swap - 1) * 100 : null
  // Worth a line only when the hub pays noticeably more than the swap, or there is no swap at all.
  if (edge !== null && edge < 0.1) return null
  const out = amt(String(hubOut), 6, 4)
  const days = `${Math.round(info.unbondDays)} to ${Math.round(info.unbondDays + info.epochDays)} days`
  const busy = bond.isLoading || unbond.isLoading
  const go = async () => {
    if (!me || blocked || busy) return
    setErr(null); setDone(null)
    try {
      if (minting) {
        await bond.mutateAsync({ hub: hub.hub, amount: micro, sender: me })
        setDone(`Staked at ${hub.provider}. The ${hub.key} is in your wallet.`)
      } else {
        await unbond.mutateAsync({ token: hub.token, hub: hub.hub, amount: micro, sender: me })
        setDone(`Queued at ${hub.provider}. Withdraw the LUNA from Portfolio when it is ready, in about ${days}.`)
      }
      onDone()
    } catch (e) { setErr(failureOf(e)) }
  }
  return (
    <div className='sw-alt'>
      {minting
        ? <p><b>Or stake at {hub.provider}:</b> {out} {hub.key} at the hub&apos;s rate{edge !== null && <>, <span className='sw-pos'>{edge.toFixed(2)}% more</span> than this swap</>}. Instant.</p>
        : <p><b>Or unstake at {hub.provider}:</b> about {out} LUNA{edge !== null && <>, <span className='sw-pos'>{edge.toFixed(2)}% more</span> than selling now</>}, ready in about {days}.</p>}
      <ErrorNote error={err} />
      {done && <p className='sw-ok'><Icon name='check' size={16} />{done}</p>}
      {me && (
        <Button size='sm' onClick={go} disabled={blocked} busy={busy}>
          {busy ? 'Confirm in your wallet' : minting ? `Stake at ${hub.provider} instead` : `Unstake at ${hub.provider} instead`}
        </Button>
      )}
    </div>
  )
}

// ── The box ──────────────────────────────────────────────────────────

export default function SwapBox({ pools, venuePools, feeBps, crystal, onDone, preset, onNext }: {
  pools: PoolView[]; venuePools: PoolView[]; feeBps: number; crystal: boolean; onDone: () => void
  preset?: SwapPreset | null
  /** after a swap lands: open History, or Pools filtered to the token that arrived */
  onNext?: (where: 'history' | 'pools', tokenKey?: string) => void
}) {
  const me = useMyAddress()
  const swap = useTradeSwap()
  const { t } = useLang()
  const { px } = useTokenData()
  const tradable = useMemo(() => pools.filter(p => !p.empty), [pools])
  // Both sites' pools. A swap takes whichever path pays best (lib/route).
  const routePools = useMemo(() => [...tradable, ...venuePools.filter(p => !p.empty)], [tradable, venuePools])
  const tokens = useMemo(() => {
    const m = new Map<string, KnownToken>()
    for (const p of routePools) for (const tk of p.tokens) m.set(assetId(tk.info), tk)
    return Array.from(m.values())
  }, [routePools])
  /* Anyone can make a token and open a pool for it on Openfields Swap's factories, so the pickers offer only the
     tokens this site lists. An unlisted one is offered only when this visit asked for it by address (a link's
     ?from= or ?to=, or a preset), and then it is marked, and a swap with it waits for the address to be checked. */
  const [asked, setAsked] = useState<string[]>([])
  const offered = useMemo(() => tokens.filter(tk => isListed(tk.info) || asked.includes(assetId(tk.info))), [tokens, asked])
  const ask = useCallback((...ids: string[]) => {
    const want = ids.filter(id => id && !asked.includes(id) && tokens.some(tk => assetId(tk.info) === id && !isListed(tk.info)))
    if (want.length) setAsked(a => [...a, ...want])
  }, [asked, tokens])

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  /** 'in': what to pay is typed. 'out': what should arrive is typed, and what to pay is worked out for it (lib/route quoteExactOut). */
  const [mode, setMode] = useState<'in' | 'out'>('in')
  const [receive, setReceive] = useState('')
  const [solving, setSolving] = useState(false)
  const [noSolve, setNoSolve] = useState(false)
  /** Bumped when the price moved under a "receive exactly" swap, so what to pay is worked out again. */
  const [solveTick, setSolveTick] = useState(0)
  const [slippage, setSlippage] = useState('auto')
  const [advice, setAdvice] = useState<SlipAdvice | null>(null)
  const [settings, setSettings] = useState(false)
  const [balance, setBalance] = useState('0')
  const [err, setErr] = useState<Failure | null>(null)
  const [phase, setPhase] = useState<0 | 1 | 2>(0)
  const [receipt, setReceipt] = useState<{ from: KnownToken; to: KnownToken; amtIn: string; amtOut: string; tx: string; route?: string } | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  // Swap prices the trade again before the wallet opens; when it got worse, the new number is shown first (go).
  const [checking, setChecking] = useState(false)
  const [moved, setMoved] = useState<{ was: string; now: string } | null>(null)
  const [netFee, setNetFee] = useState<string | null>(null)
  /** The chain's own simulation of these exact messages says they would fail right now, and why (lib/gas estimateFee). */
  const [simFail, setSimFail] = useState<{ text: string; fix: TxFix } | null>(null)
  /** What would fix the swap that just failed. */
  const [failFix, setFailFix] = useState<TxFix>(null)
  const retryAfterSlip = useRef(false)
  const [copied, setCopied] = useState(false)

  /* The receive side a preset or a shared link asked for, parked until `toOptions` has been rebuilt around the new pay side. */
  const [wantTo, setWantTo] = useState('')
  /* The first pair is chosen once: by a shared link (?from=LUNA&to=SOLID&amount=100, see share below) when
     there is one, otherwise by the first impression. One effect and a ref, so nothing can choose after it,
     not even React running mount effects twice in development. The other site's pools arrive a little after
     this site's, so a linked token only they carry is waited for. */
  const firstPair = useRef(false)
  useEffect(() => {
    if (firstPair.current || fromId || !tokens.length) return
    const q = new URLSearchParams(window.location.search)
    const wantFrom = q.get('from'), wantTok = q.get('to')
    const find = (v: string | null) => (v ? tokens.find(tk => tk.key.toLowerCase() === v.toLowerCase() || assetId(tk.info) === v) : undefined)
    const f = find(wantFrom), tt = find(wantTok)
    if (wantFrom && (!f || (wantTok && !tt)) && venuePools.length === 0) return
    firstPair.current = true
    ask(...[f, tt].filter((x): x is KnownToken => !!x).map(x => assetId(x.info)))
    if (f) {
      setFromId(assetId(f.info))
      const a = q.get('amount') ?? ''
      if (AMOUNT_RE.test(a)) setAmount(a)
      // ?receive=5: a link that asks for an amount to arrive, like a payment request.
      const rcv = q.get('receive') ?? ''
      if (tt && AMOUNT_RE.test(rcv) && Number(rcv) > 0) { setMode('out'); setReceive(rcv) }
      if (tt) setWantTo(assetId(tt.info))
      return
    }
    // First impression: the deepest pool, LUNA on the pay side when it has one.
    const deepest = [...tradable].filter(p => p.tokens.every(x => isListed(x.info))).sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0]
    const pick = deepest ? (deepest.tokens.find(x => x.key === 'LUNA') ?? deepest.tokens[0]) : offered[0]
    if (pick) setFromId(assetId(pick.info))
  }, [tokens, offered, fromId, tradable, venuePools.length, ask])

  const from = offered.find(tk => assetId(tk.info) === fromId) ?? null
  // Anything reachable in one or two hops across both sites.
  const toOptions = useMemo(() => (from ? reachable(routePools, from, offered) : []), [from, routePools, offered])
  useEffect(() => {
    if (toOptions.find(tk => assetId(tk.info) === toId)) return
    // Default to the other side of the deepest pool the pay token sits in, so LUNA opens on LUNA/USDC.
    const deepest = from
      ? tradable.filter(p => p.tokens.some(tk => sameAsset(tk.info, from.info))).sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0]
      : undefined
    const other = deepest && from ? deepest.tokens.find(tk => !sameAsset(tk.info, from.info)) : undefined
    const pick = (other && toOptions.find(tk => sameAsset(tk.info, other.info))) || toOptions[0]
    setToId(pick ? assetId(pick.info) : '')
  }, [toOptions, toId, from, tradable])

  /* A preset arrives as a pair plus a size. The pay side and the amount land immediately; the receive side
     waits one pass for `toOptions` to be rebuilt around the new pay side. */
  const presetSeen = useRef(0)
  useEffect(() => {
    if (!preset || preset.n === presetSeen.current) return
    presetSeen.current = preset.n
    ask(preset.fromId, preset.toId)
    setFromId(preset.fromId); setAmount(preset.amount); setWantTo(preset.toId); setMode('in'); setReceipt(null)
  }, [preset, ask])
  useEffect(() => {
    if (wantTo && toOptions.some(tk => assetId(tk.info) === wantTo)) { setToId(wantTo); setWantTo('') }
  }, [wantTo, toOptions])

  const to = toOptions.find(tk => assetId(tk.info) === toId) ?? null
  // The deepest direct pool for the pair on either site. The chart and the tab title read from it; the trade follows the route.
  const pool = useMemo(() => {
    if (!from || !to) return null
    const both = routePools.filter(p => p.tokens.some(tk => sameAsset(tk.info, from.info)) && p.tokens.some(tk => sameAsset(tk.info, to.info)))
    return both.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0] ?? null
  }, [from, to, routePools])

  const [balTick, setBalTick] = useState(0)
  useEffect(() => {
    if (!me || !from) { setBalance('0'); return }
    queryBalance(me, from.info).then(setBalance)
  }, [me, from, balTick])

  const micro = from ? toMicro(amount, from.decimals) : null
  const debounced = useDebounced(micro, 350)
  const receiveMicro = to && mode === 'out' ? toMicro(receive, to.decimals) : null
  const receiveDebounced = useDebounced(receiveMicro, 450)
  // Auto follows the route (lib/slippage, advice below); a number picked by hand is used as it is.
  const slipPct = slippage === 'auto' ? advice?.pct ?? 1 : Number(slippage)
  const slip = Math.min(0.5, Math.max(0.001, slipPct / 100 || 0.01))
  // Quote every path on both sites, and a split over two paths when that pays. A background refresh of the
  // pools re-quotes quietly; only a new pair or amount clears the number shown.
  const [quotes, setQuotes] = useState<Quotes | null>(null)
  const quoteKey = useRef('')
  useEffect(() => {
    let alive = true
    const key = `${fromId}|${toId}|${debounced ?? ''}`
    if (key !== quoteKey.current) { quoteKey.current = key; setQuotes(null); setMoved(null) }
    if (!from || !to || !debounced || debounced === '0') return
    quoteBest(routePools, from, to, debounced, HOME_VENUE, { slip, split: true }).then(q => { if (alive) setQuotes(q) }).catch(() => {})
    return () => { alive = false }
  }, [routePools, from, to, fromId, toId, debounced, slip])
  const route = quotes?.best ?? null

  // Receive exactly: when what should arrive is typed, work out what to pay and put it in the pay field, where
  // the quote above prices it as it prices any amount. Rounded up to eight decimals, so the minimum still covers it.
  useEffect(() => {
    if (mode !== 'out') return
    setNoSolve(false)
    if (!from || !to || !receiveDebounced || receiveDebounced === '0') { setSolving(false); if (!receive.trim()) setAmount(''); return }
    let alive = true
    setSolving(true)
    quoteExactOut(routePools, from, to, receiveDebounced, HOME_VENUE, { slip })
      .then(x => {
        if (!alive) return
        if (!x) { setNoSolve(true); setAmount(''); return }
        const unit = BigInt(`1${'0'.repeat(Math.max(0, from.decimals - 8))}`)
        const up = ((BigInt(x.amountMicro) + unit - BigInt(1)) / unit) * unit
        setAmount(plainAmount(up.toString(), from.decimals))
      })
      .catch(() => { if (alive) setNoSolve(true) })
      .finally(() => { if (alive) setSolving(false) })
    return () => { alive = false }
  // Not on every background refresh of the pools: the quote above re-prices with fresh pools anyway.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, receiveDebounced, fromId, toId, slip, solveTick])

  const fee = '0'
  const insufficient = !!me && !!micro && BigInt(micro) + BigInt(fee) > BigInt(balance || '0')
  /* A token this site does not list, on either side, only because a link asked for it by address: named in full,
     and the swap waits until the box saying the address was checked is ticked. Unticked for every new pair. */
  const unlisted = [from, to].filter((x): x is KnownToken => !!x && !isListed(x.info))
  const [unlistedOk, setUnlistedOk] = useState(false)
  useEffect(() => { setUnlistedOk(false) }, [fromId, toId])
  // How a trade is signed decides what arrives (lib/route planRoute): through a router the quote itself, as separate swaps (listed tokens only) a little less.
  const trade: TradePlan | null = useMemo(() => (quotes?.best ? planTrade(quotes.split ?? [{ quote: quotes.best, share: 1 }], slip) : null), [quotes, slip])
  const impact = trade ? trade.impactPct : 0
  const minOut = trade?.minOut ?? '0'
  const perLeg = !!trade && trade.parts.some(p => p.plan.kind === 'legs' && p.quote.legs.length > 1)
  const quoted = !!trade && !!micro && micro === quotes?.amountMicro
  // The quote must be for the amount on screen, not the one before the debounce caught up.
  const canSwap = !!me && !!route && !!trade && !!from && !!to && !!micro && quoted
    && trade.parts.every(p => p.plan.legs.every(l => l.offerAmount !== '0') && p.plan.minOut !== '0') && minOut !== '0' && !insufficient && !swap.isLoading && !checking
    && (unlisted.length === 0 || unlistedOk)
    // Receive exactly signs only a trade whose minimum covers what was asked for.
    && (mode !== 'out' || (!solving && !!receiveMicro && receiveMicro !== '0' && BigInt(minOut) >= BigInt(receiveMicro)))

  // The network fee the wallet will propose, from the chain's own simulation of these exact messages (lib/gas).
  // It needs the wallet's balances, so it is only shown with a wallet connected.
  const tradeRef = useRef(trade)
  tradeRef.current = trade
  const feeKey = me && trade && micro && micro === quotes?.amountMicro && !insufficient && minOut !== '0' ? `${me}|${micro}|${slip}|${tradeText(trade.parts)}` : ''
  useEffect(() => {
    setNetFee(null); setSimFail(null)
    const tr = tradeRef.current
    if (!feeKey || !tr) return
    let alive = true
    const timer = setTimeout(() => {
      estimateFee(me, tradeMsgs(me, tr, slip)).then(f => { if (alive) setNetFee(f.uluna) }).catch(e => { if (alive) setSimFail(explainTx(e)) })
    }, 400)
    return () => { alive = false; clearTimeout(timer) }
  }, [feeKey, me, slip])

  // Auto slippage reads how the route's pools have been moving and how deep they are. The last advice stays until a new route is priced.
  const routeKey = trade ? Array.from(new Set(trade.parts.flatMap(p => p.quote.legs.map(l => l.pool.contract_addr)))).join(',') : ''
  useEffect(() => {
    const tr = tradeRef.current
    if (!routeKey || !tr) return
    let alive = true
    const used = new Map<string, PoolView>()
    for (const p of tr.parts) for (const l of p.quote.legs) used.set(l.pool.contract_addr, l.pool)
    const list = Array.from(used.values())
    const advise = (moves: number[]) => { if (alive) setAdvice(suggestSlippage({ pools: list.map((p, i) => ({ label: p.label, tvlUsd: p.tvlUsd, movePct: moves[i] })), separateLegs: perLeg })) }
    // A busy pool's trade history can take several seconds to read. Advise from depth and route length first, then again once the moves are in.
    const soon = (p: Promise<number>) => Promise.race([p, new Promise<number>(r => setTimeout(() => r(0), 1500))])
    const moves = list.map(p => poolMovePct(p.contract_addr))
    Promise.all(moves.map(soon)).then(advise).catch(() => {})
    Promise.all(moves).then(advise).catch(() => {})
    return () => { alive = false }
  }, [routeKey, perLeg])

  /** The next slippage worth trying after a swap landed past its limit; none once it is already 3%. */
  const wider = slipPct < 1 ? '1' : slipPct < 3 ? '3' : null
  // "Try again at 3%": once the new setting is in the plan, the swap goes again. It is a new signature in the wallet.
  useEffect(() => {
    if (!retryAfterSlip.current || !canSwap) return
    retryAfterSlip.current = false
    void go()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSwap, slip])

  /** A link that opens this swap filled in, and unfurls as it in chats (middleware.ts, /api/og/swap). */
  const share = () => {
    if (!from || !to) return
    const u = new URL(window.location.origin)
    u.searchParams.set('from', from.key)
    u.searchParams.set('to', to.key)
    if (mode === 'out' && AMOUNT_RE.test(receive.trim()) && Number(receive) > 0) u.searchParams.set('receive', receive.trim())
    else if (AMOUNT_RE.test(amount.trim()) && Number(amount) > 0) u.searchParams.set('amount', amount.trim())
    navigator.clipboard?.writeText(u.toString()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }

  const flip = useCallback(() => {
    if (!from || !to) return
    const nf = toId, nt = fromId
    setFromId(nf); setToId(nt); setQuotes(null); setErr(null); setMode('in')
  }, [from, to, toId, fromId])

  // Keyboard: `/` jumps to the amount, `f` flips, 0 to 3 pick slippage. Only when not already typing somewhere.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[aria-modal="true"]')) return
      if (e.key === '/') { e.preventDefault(); amountRef.current?.focus() }
      if (e.key === 'f' || e.key === 'F') flip()
      if (e.key === '0') setSlippage('auto')
      if (e.key === '1') setSlippage('0.5')
      if (e.key === '2') setSlippage('1')
      if (e.key === '3') setSlippage('3')
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [flip])

  // The tab title carries the live rate.
  const spot = pool && from ? (sameAsset(from.info, pool.tokens[0].info) ? pool.price : (pool.price > 0 ? 1 / pool.price : 0)) : 0
  useEffect(() => {
    if (!from || !to || !(spot > 0)) return
    document.title = `1 ${from.label} = ${fmtPrice(spot)} ${to.label} · ${APP_NAME}`
    return () => { document.title = APP_NAME }
  }, [from, to, spot])

  const go = async () => {
    if (!canSwap || !route || !trade || !from || !to || !micro) return
    setErr(null); setReceipt(null); setFailFix(null)
    // The quote on screen can be a minute old. Price it again before the wallet opens: if it now delivers
    // more than half the slippage less, show the new number and let the next press sign that.
    let signed = trade
    let short = quotes?.short ?? null
    const key = quoteKey.current
    setChecking(true)
    try {
      const fresh = await quoteBest(routePools, from, to, micro, HOME_VENUE, { slip, split: true })
      if (quoteKey.current !== key) return
      if (fresh.best) {
        const next = planTrade(fresh.split ?? [{ quote: fresh.best, share: 1 }], slip)
        setQuotes(fresh)
        if (BigInt(next.expectedOut) * BigInt(20_000) < BigInt(trade.expectedOut) * BigInt(20_000 - Math.round(slip * 10_000))) {
          setMoved({ was: trade.expectedOut, now: next.expectedOut })
          return
        }
        // Receive exactly: if the fresh price no longer covers what was asked for, work out what to pay again first.
        if (mode === 'out' && receiveMicro && BigInt(next.minOut) < BigInt(receiveMicro)) {
          setMoved({ was: trade.expectedOut, now: next.expectedOut })
          setSolveTick(n => n + 1)
          return
        }
        signed = next
        short = fresh.short
      }
    } catch {
      // An endpoint had a bad moment. The quote on screen still carries its minimum, so that is what gets signed.
    } finally { setChecking(false) }
    setMoved(null)
    // Asking the wallet, then sending.
    setPhase(1)
    const p2 = setTimeout(() => setPhase(2), 2500)
    try {
      // The memo says what was quoted and what the routing added, so the wallet's history and the monthly report can check it.
      const r = await swap.mutateAsync({ trade: signed, maxSpread: slip, sender: me, memo: tradeMemo(signed, short, slip, to) })
      clearTimeout(p2); setPhase(0)
      const hash = (r as { transactionHash?: string })?.transactionHash ?? ''
      const first = signed.parts[0].quote
      setReceipt({
        from, to, amtIn: amt(micro, from.decimals, 6), amtOut: amt(signed.expectedOut, to.decimals, 6), tx: hash,
        route: signed.parts.length > 1 || first.legs.length > 1 || first.legs[0].pool.venue !== HOME_VENUE ? tradeText(signed.parts) : undefined,
      })
      setAmount(''); setReceive(''); setMode('in')
      setBalTick(n => n + 1)
      onDone()
    } catch (e) {
      clearTimeout(p2); setPhase(0)
      const f = failureOf(e)
      setErr({ ...f, text: t(f.text) })
      setFailFix(explainTx(e).fix)
    }
  }

  // ── What the screen says ──
  const usdOf = (tk: KnownToken | null, m: string | null) => {
    const p = tk ? px?.[assetId(tk.info)] : undefined
    const n = tk && m ? Number(m) / 10 ** tk.decimals : 0
    return p && n > 0 ? `≈ $${(n * p).toLocaleString('en-US', { maximumFractionDigits: n * p >= 100 ? 0 : 2 })}` : ''
  }
  const outMicro = trade && quoted ? trade.expectedOut : null
  const receiveValue = mode === 'out' ? receive : outMicro && to ? fromMicro(outMicro, to.decimals, 6).replace(/,/g, '') : ''

  const notes: { text: React.ReactNode; tone?: 'good' | 'bad' | 'info' }[] = []
  if (pool && from && to && pool.deviation != null && (pool.deviation > 1.25 || pool.deviation < 0.8) && (!route || (route.legs.length === 1 && route.legs[0].pool.contract_addr === pool.contract_addr))) {
    const off = pool.deviation > 1 ? pool.deviation : 1 / pool.deviation
    // Is the token you receive cheap here (good for you) or expensive (bad)?
    const cheapHere = pool.deviation > 1 ? pool.tokens[1] : pool.tokens[0]
    notes.push(sameAsset(cheapHere.info, to.info)
      ? { text: `This pool sells ${to.label} ${off.toFixed(1)}× cheaper than the market. It is a small pool.`, tone: 'good' }
      : { text: `This pool is ${off.toFixed(1)}× off the market, against you: ${to.label} costs ${off.toFixed(1)}× more here than on Astroport.`, tone: 'bad' })
  }
  if (mode === 'out' && !solving && noSolve) notes.push({ text: t('No amount found that delivers that right now. The pools may be too thin.') })
  if (impact > 5 && quoted) notes.push({ text: t('High price impact: even the best path is thin for this size. Trade smaller.') })
  if (slippage !== 'auto' && advice && trade && Number(slippage) < advice.pct) {
    notes.push({ text: <>{slippage}% is tighter than this route has been moving{advice.reasons[0] ? ` (${advice.reasons[0]})` : ''}, so the swap may fail. Auto would use {advice.pct}%. <button type='button' className='sw-wallet-btn' onClick={() => setSlippage('auto')}>Use Auto</button></> })
  }
  if (moved && to) notes.push({ text: t('The price moved while this was open: the swap now gives about {now} {token} instead of {was}. Press Swap again to take the new price.', { now: amt(moved.now, to.decimals, 6), token: to.label, was: amt(moved.was, to.decimals, 6) }) })
  // Checked before anyone signs: the chain's simulation of these exact messages. Shown only for causes a person can act on.
  if (!err && simFail && (simFail.fix === 'slippage' || simFail.fix === 'balance')) {
    notes.push({ text: <>{t('Checked against the chain before you sign: as it stands this would fail.')} {t(simFail.text)}{simFail.fix === 'slippage' && wider && <> <button type='button' className='sw-wallet-btn' onClick={() => setSlippage(wider)}>{t('Use {pct}%', { pct: wider })}</button></>}</>, tone: 'bad' })
  }

  let label: string
  if (!from || !to) label = t('Select a token')
  else if (mode === 'out' && solving) label = t('Finding what to pay…')
  else if (!micro || micro === '0') label = t('Enter an amount')
  else if (insufficient) label = t('Not enough {token}', { token: from.label })
  else if (!quoted && (!quotes || quotes.amountMicro !== micro)) label = t('Getting the best price…')
  else if (!route) label = t('No route for this pair right now')
  else if (unlisted.length > 0 && !unlistedOk) label = t('Check the address first')
  else if (checking) label = t('Checking the price…')
  else if (phase === 2) label = t('Sending…')
  else if (swap.isLoading || phase === 1) label = t('Confirm in your wallet')
  else if (impact > 5) label = t('Swap anyway')
  else label = t('Swap')
  const busy = checking || swap.isLoading || phase > 0 || (!!micro && micro !== '0' && !quoted && !!from && !!to && !insufficient && (!quotes || quotes.amountMicro !== micro))

  if (tradable.length === 0) {
    return (
      <section className='sw-page sw-narrow'>
        <h1 className='sw-title'>{t('Swap')}</h1>
        <p className='sw-lede'>No pool has liquidity yet.</p>
        {onNext && <div className='sw-gap'><Button onClick={() => onNext('pools')}>Open Pools</Button></div>}
      </section>
    )
  }

  return (
    <section className='sw-page sw-swap sw-narrow' aria-labelledby='sw-swap-title'>
      <div className='sw-head'>
        <h1 id='sw-swap-title' className='sw-title'>{t('Swap')}</h1>
        <div className='sw-head-end'>
          <IconButton icon='settings' label={t('Swap settings')} onClick={() => setSettings(true)} />
        </div>
      </div>

      <div className='sw-box'>
        <div className='sw-field'>
          <div className='sw-field-head'>
            <label htmlFor='sw-pay'>{t('You pay')}</label>
            {me && from && (
              <span className='sw-field-bal'>
                {t('Balance')} {amt(balance, from.decimals)}
                {Number(balance) > 0 && (
                  <button type='button' className='sw-max'
                    onClick={() => { setMode('in'); setReceipt(null); setAmount(fromMicro((BigInt(balance) * BigInt(10_000 - feeBps - 1) / BigInt(10_000)).toString(), from.decimals, 6).replace(/,/g, '')) }}>
                    {t('Max')}
                  </button>
                )}
              </span>
            )}
          </div>
          <div className='sw-field-main'>
            <input id='sw-pay' ref={amountRef} className='sw-amount' type='number' inputMode='decimal' min='0' step='any' autoComplete='off'
              placeholder={mode === 'out' && solving ? '…' : '0'} value={amount}
              onChange={e => { setMode('in'); setReceipt(null); setErr(null); setAmount(e.target.value) }} />
            <TokenSelect value={fromId} onChange={v => { setFromId(v); setReceipt(null) }} options={offered} label={t('You pay')} />
          </div>
          <div className='sw-field-foot'>{usdOf(from, micro)}</div>
        </div>

        <div className='sw-flip-row'>
          <button type='button' className='sw-flip' onClick={flip} disabled={!from || !to} aria-label={t('Flip the pair')} title={`${t('Flip the pair')} (f)`}>
            <Icon name='flip' size={18} />
          </button>
        </div>

        <div className='sw-field'>
          <div className='sw-field-head'>
            <label htmlFor='sw-receive'>{t('You receive')}</label>
            {mode === 'out' && <span className='sw-field-bal'>{t('exactly')}</span>}
          </div>
          <div className='sw-field-main'>
            {/* Shows what the swap delivers; typing in it asks for that amount to arrive instead. */}
            <input id='sw-receive' className={`sw-amount${mode === 'in' ? ' is-quoted' : ''}`} type='number' inputMode='decimal' min='0' step='any' autoComplete='off' data-receive
              placeholder='0' value={receiveValue}
              onChange={e => { setMode('out'); setReceipt(null); setErr(null); setReceive(e.target.value) }} />
            <TokenSelect value={toId} onChange={v => { setToId(v); setReceipt(null) }} options={toOptions} label={t('You receive')} />
          </div>
          <div className='sw-field-foot'>{usdOf(to, mode === 'out' ? receiveMicro : outMicro)}</div>
        </div>

        {from && to && (route && trade && quoted ? (
          <div className='sw-box-rows'>
            <dl className='sw-rows'>
              <Row k={t('Rate')} v={`1 ${from.label} = ${fmtPrice((Number(trade.expectedOut) / 10 ** to.decimals) / (Number(micro) / 10 ** from.decimals))} ${to.label}`} />
              <Row k={t(perLeg ? 'Minimum received ({pct}% per swap)' : 'Minimum received', { pct: slipPct })} v={`${amt(minOut, to.decimals)} ${to.label}`} />
              <Row k={t('Price impact')} v={`${impact < 0.01 ? '<0.01' : impact.toFixed(2)}%`} tone={impact > 5 ? 'bad' : impact > 3 ? 'warn' : undefined} />
              {feeBps > 0 && <Row k='Protocol fee' v={crystal ? '0, Crystal' : `${amt(fee, from.decimals)} ${from.label}`} />}
              <Row k={t('Network fee')} v={netFee ? `≈ ${amt(netFee, 6, 4)} LUNA` : me && feeKey && !simFail ? '…' : t('a little LUNA')} tone='muted' />
            </dl>
            <Disclosure summary={t('Route and details')} className='sw-box-more'>
              <RouteMap parts={trade.parts} />
              <dl className='sw-rows'>
                {mode === 'out' && receiveMicro && <Row k={t('You receive at least')} v={`${amt(receiveMicro, to.decimals, 6)} ${to.label}`} />}
                {trade.parts.length > 1 && (() => {
                  // What splitting is worth, against the best single path.
                  const gain = (Number(trade.expectedOut) / Math.max(1, Number(planRoute(route, slip).expectedOut)) - 1) * 100
                  return gain > 0.01 ? <Row k={t('vs one path')} v={t('+{pct}% more {token}', { pct: gain.toFixed(2), token: to.label })} tone='good' /> : null
                })()}
                {(() => {
                  // What routing is worth, measured against this site's own pools alone.
                  if (!trade.parts.some(p => p.quote.legs.some(l => l.pool.venue !== HOME_VENUE))) return null
                  const home = quotes?.home
                  if (!home) return <Row k={`${VENUE_NAME[HOME_VENUE]} alone`} v='no path for this pair' tone='muted' />
                  const gain = (Number(trade.expectedOut) / Math.max(1, Number(planRoute(home, slip).expectedOut)) - 1) * 100
                  return gain > 0.05 ? <Row k={t('vs {venue} alone', { venue: VENUE_NAME[HOME_VENUE] })} v={t('+{pct}% more {token}', { pct: gain >= 100 ? gain.toFixed(0) : gain.toFixed(1), token: to.label })} tone='good' /> : null
                })()}
                {(() => {
                  const used = new Map<string, PoolView>()
                  for (const p of trade.parts) for (const l of p.quote.legs) used.set(l.pool.contract_addr, l.pool)
                  // Pools with the same fee say it once.
                  return <Row k={t(used.size > 1 ? 'Pool fees' : 'Pool fee')} v={Array.from(new Set(Array.from(used.values()).map(poolFeeTextFor))).join(' · ')} tone='muted' />
                })()}
                <Row k={t('Slippage')} v={slippage === 'auto' ? `${slipPct}%, ${t('auto')}` : `${slipPct}%`} tone='muted' />
              </dl>
              <SizeRows from={from} to={to} amount={amount} />
              <p className='sw-fine'>
                {mode === 'out' && <>{t('The amount to pay includes {pct}% room for the price to move. If the price holds, a little more arrives.', { pct: slipPct })} </>}
                {trade.parts.length > 1
                  ? 'One transaction. Each path has its own minimum; if either lands short, all of it reverts.'
                  : trade.parts[0].plan.kind === 'router'
                    ? "One transaction through Astroport's router. Reverts if less than the minimum arrives."
                    : trade.parts[0].plan.kind === 'multi'
                      ? "One transaction through Openfields Swap's router. Reverts if less than the minimum arrives."
                      : route.legs.length > 1 ? `One transaction, ${route.legs.length} swaps. If any leg lands past its limit, all of it reverts.` : 'Reverts if less than the minimum arrives.'}
                {trade.leftover.length > 0 && <> At the quoted prices about {trade.leftover.map(x => `${amt(x.micro, x.token.decimals, 6)} ${x.token.label}`).join(' and ')} stays in your wallet.</>}
              </p>
              {pool && <div className='sw-gap'><PriceChart pool={pool} from={from} to={to} /></div>}
            </Disclosure>
          </div>
        ) : spot > 0 && (
          <div className='sw-box-rows'>
            <dl className='sw-rows'><Row k={t('Rate')} v={`1 ${from.label} ≈ ${fmtPrice(spot)} ${to.label}`} tone='muted' /></dl>
          </div>
        ))}
      </div>

      {(notes.length > 0 || unlisted.length > 0) && (
        <ul className='sw-notes sw-gap' aria-label={t('Before you swap')}>
          {notes.map((n, i) => <li key={i} className={n.tone ? `is-${n.tone}` : undefined}>{n.text}</li>)}
          {unlisted.map(x => (
            <li key={assetId(x.info)} className='is-bad'>
              {t('{token} is not a token this site lists. Its address: {id}', { token: x.label, id: assetId(x.info) })} {t('Anyone can make a token and open a pool for it. Swap only if you know this exact address is the token you mean.')}
            </li>
          ))}
          {unlisted.length > 0 && (
            <li className='is-info'>
              <label className='sw-check'><input type='checkbox' checked={unlistedOk} onChange={e => setUnlistedOk(e.target.checked)} />{t('I checked the address')}</label>
            </li>
          )}
        </ul>
      )}

      {from && to && <HubAlternative from={from} to={to} micro={micro} swapOut={trade?.expectedOut ?? null} blocked={insufficient} onDone={onDone} />}

      {receipt ? (
        <div className='sw-done sw-gap' role='status'>
          <p className='sw-done-head'><span className='sw-done-icon' aria-hidden><Icon name='check' size={16} /></span>{t('Swapped')}</p>
          <p className='sw-done-sub'>{receipt.amtIn} {receipt.from.label} for about {receipt.amtOut} {receipt.to.label}{receipt.route ? `, via ${receipt.route}` : ''}.</p>
          <div className='of-next'>
            {receipt.tx && <Link href={`/tx/${receipt.tx}`} className='of-btn of-btn--quiet of-btn--sm'>{t('Receipt')}</Link>}
            {onNext && <button type='button' className='of-btn of-btn--quiet of-btn--sm' onClick={() => onNext('history')}>{t('History')}</button>}
            {onNext && <button type='button' className='of-btn of-btn--quiet of-btn--sm' onClick={() => onNext('pools', receipt.to.key)}>{t('Pools with {token}', { token: receipt.to.label })}</button>}
            {/* The same wallet in the apps built for the rest of it: all of it in Openfields Home, and LUNA just received can be staked. */}
            {!IS_ASTRO && <a href={`${TERRA_HOME_URL}/`} className='of-btn of-btn--quiet of-btn--sm'>Openfields Home<Icon name='external' size={14} /></a>}
            {!IS_ASTRO && receipt.to.key === 'LUNA' && <a href={`${STAKE_URL}/#stake`} className='of-btn of-btn--quiet of-btn--sm'>{t('Stake it')}<Icon name='external' size={14} /></a>}
          </div>
        </div>
      ) : (
        <div className='sw-act sw-act--dock'>
          <ErrorNote error={err} />
          {err && failFix === 'slippage' && wider && (
            <Button onClick={() => { retryAfterSlip.current = true; setErr(null); setFailFix(null); setSlippage(wider) }}>
              {t('Try again at {pct}% slippage', { pct: wider })}
            </Button>
          )}
          {me
            ? <Button variant='primary' size='lg' block disabled={!canSwap && !busy} busy={busy && !!from && !!to} onClick={go}>{label}</Button>
            : <Button variant='primary' size='lg' block onClick={askToConnect}>{t('Connect wallet')}</Button>}
        </div>
      )}

      <Modal open={settings} onClose={() => setSettings(false)} title={t('Swap settings')}>
        <div className='sw-stack'>
          <div>
            <p className='sw-label' id='sw-slip-label'>{t('Slippage')}</p>
            <div className='of-seg' role='radiogroup' aria-labelledby='sw-slip-label'>
              {(['auto', '0.5', '1', '3'] as const).map(s => (
                <button key={s} type='button' role='radio' aria-checked={slippage === s} onClick={() => setSlippage(s)}>
                  {s === 'auto' ? `${t('Auto')}${advice ? ` ${advice.pct}%` : ''}` : `${s}%`}
                </button>
              ))}
            </div>
            <p className='sw-hint'>
              {slippage === 'auto'
                ? advice?.reasons.length ? `Auto: ${advice.reasons.join(' · ')}` : "Auto follows how the route's pools have been moving."
                : 'The swap reverts if the price moves further than this before it lands.'}
            </p>
          </div>
          {from && to && (
            <Button block onClick={share}>
              <Icon name={copied ? 'check' : 'link'} size={16} />{t(copied ? 'Link copied' : 'Copy a link to this swap')}
            </Button>
          )}
        </div>
      </Modal>
    </section>
  )
}
