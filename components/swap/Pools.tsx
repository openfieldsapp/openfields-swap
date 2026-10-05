/**
 * Pools: every pool on Openfields Swap, Astroport and Skeleton Swap, as a list.
 * Each row says what a pool holds; opening it shows the rest (depth, fees paid
 * to providers, who holds it, your share) and the ways in and out: add both
 * sides, zap in with one token, remove, and its trades.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button, Icon } from 'components/ui'
import { PairIcons } from 'components/TokenIcon'
import LstBoard from 'components/LstBoard'
import useMyAddress from 'components/hooks/useMyAddress'
import { shortAddress } from 'components/wallet/connect'
import { useExitPosition, useProvideLiquidity, useZap } from 'components/transactions/useDex'
import {
  NOBLE_USDC, USDC_INJ_DENOM, assetId, fromMicro, lpConcentration, lpPosition, planZap, queryBalance, queryCw20Balance, smart, toMicro,
  IS_ASTRO, VENUE_INCENTIVES, VENUE_NAME, type KnownToken, type PoolView, type Venue, type ZapPlan,
} from 'lib/dex'
import { fmtAmount, fmtUsd, type ArbPlan } from 'lib/arb'
import { planRoutedZap, routeText, type RoutedZap } from 'lib/route'
import type { BoardResponse } from 'lib/api/dex-leaderboard'
import type { PoolHolders } from 'lib/api/dex-holders'
import type { PoolFeesResponse } from 'lib/api/pool-fees'
import type { TradesResponse } from 'lib/api/dex-trades'
import type { LpFlow } from 'lib/dex-ledger'
import type { WalletStats } from 'lib/trades'
import { TOKEN_META } from 'lib/tokenMeta'
import { SCAN_ADDRESS, SCAN_TX } from 'lib/products'
import { useLang } from 'lib/i18n'
import { PriceChart, poolFeeTextFor } from './SwapBox'
import { ActionButton, amt, compactUsd, Empty, ErrorNote, failureOf, fmtPrice, Row, useDebounced, type Failure } from './common'

/** How the list is ordered. "Suggested" is the house order (SOLID first, then depth). */
type PoolSort = 'suggested' | 'tvl' | 'traded' | 'name'
const POOL_SORT_LABEL: Record<PoolSort, string> = { suggested: 'Suggested', tvl: 'Liquidity', traded: 'Most traded', name: 'Name' }
const DUST_USD = 10
const bpsPct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`

/** Something elsewhere on the page asked Pools to show: a pool by its element id, the liquid staking board, or a token. */
export interface PoolsFocus { elementId: string; dust: boolean; query: string; n: number }

// ── What a wallet put in, against what it holds now ─────────────────

/**
 * What a wallet put into a pool, against what its LP is a claim on now, per
 * token. In tokens, not dollars: pricing a deposit made last Tuesday needs
 * last Tuesday's price. Two sides moving opposite ways is impermanent loss,
 * shown plainly. On the pools, and in the portfolio.
 */
export function PutInRows({ flow, tokens, amounts, usd, px }: { flow?: LpFlow; tokens: [KnownToken, KnownToken]; amounts: [number, number]; usd?: number | null; px?: Record<string, number> | null }) {
  if (!flow) return null
  const [t0, t1] = tokens
  const put = [Number(flow.net[assetId(t0.info)] ?? '0') / 10 ** t0.decimals, Number(flow.net[assetId(t1.info)] ?? '0') / 10 ** t1.decimals]
  if (!(put[0] > 0) && !(put[1] > 0)) return null
  const delta = (i: 0 | 1) => (put[i] > 0 ? (amounts[i] / put[i] - 1) * 100 : null)
  const tag = (v: number | null) => v == null ? null : <span className={v >= 0 ? 'sw-pos' : 'sw-neg'}>{v >= 0 ? '+' : ''}{v.toFixed(1)}%</span>
  const [d0, d1] = [delta(0), delta(1)]
  // Against holding: the position now beside what the tokens put in would be worth had they stayed in the wallet,
  // both at today's prices. Only while nothing has been taken out, so "what was put in" means one thing.
  const p0 = px?.[assetId(t0.info)], p1 = px?.[assetId(t1.info)]
  const held = flow.withdraws === 0 && p0 && p1 ? Math.max(0, put[0]) * p0 + Math.max(0, put[1]) * p1 : null
  const vs = held && held > 0 && usd != null ? (usd / held - 1) * 100 : null
  return (
    <>
      <Row k={`Put in${flow.provides > 1 ? `, ${flow.provides} deposits` : ''}${flow.withdraws > 0 ? `, ${flow.withdraws} out` : ''}`}
        v={<>{fmtAmount(put[0])} {t0.label} + {fmtAmount(put[1])} {t1.label}{(d0 != null || d1 != null) && <> · {tag(d0)} / {tag(d1)}</>}</>} />
      {vs != null && held != null && usd != null && (
        <Row k='Against holding it' v={<>{fmtUsd(usd)} in the pool · {fmtUsd(held)} if kept · {tag(vs)}</>} />
      )}
    </>
  )
}

/**
 * What a pool paid its liquidity providers in the last 7 and 30 days, from its
 * own swap events (/api/pool-fees), at today's prices. History, never a rate.
 */
function PoolFees({ pair }: { pair: string }) {
  const [f, setF] = useState<PoolFeesResponse | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/pool-fees?pair=${pair}`).then(r => (r.ok ? r.json() : null)).then((j: PoolFeesResponse | null) => { if (alive && j) setF(j) }).catch(() => {})
    return () => { alive = false }
  }, [pair])
  if (!f) return null
  // Fees paid in a token without a reference price are counted, not priced.
  const usd = (v: number | null, swaps: number) => (v == null ? `${swaps} swap${swaps === 1 ? '' : 's'}` : fmtUsd(v))
  // A busy pool's scan stops early; then the longer figure covers the days it reached.
  const days = !f.complete && f.since ? Math.max(1, Math.round((f.at - Date.parse(f.since)) / 86_400_000)) : 30
  return (
    <Row k='Fees to providers' tone={f.day30.swaps ? undefined : 'muted'}
      v={!f.day30.swaps ? `no swaps in ${days} days` : days < 7 ? `last ${days} day${days === 1 ? '' : 's'} ${usd(f.day30.usd, f.day30.swaps)}` : `7 days ${usd(f.day7.usd, f.day7.swaps)} · ${days} days ${usd(f.day30.usd, f.day30.swaps)}`} />
  )
}

// ── Trades: who trades a pool, and how ───────────────────────────────

/** Blocks to rough wall time at about 6 s a block. */
function gapLabel(blocks: number): string {
  const s = blocks * 6
  if (s < 90) return `${Math.round(s)} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  if (s < 129_600) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86_400)} d`
}

function WalletLine({ s, base, quote }: { s: WalletStats; base: string; quote: string }) {
  return (
    <dl className='sw-rows'>
      <Row k='Trades here' v={<>{s.trades} · <span className='sw-pos'>{s.buys} bought</span> {fmtAmount(s.baseBought)} {base} · <span className='sw-neg'>{s.sells} sold</span> {fmtAmount(s.baseSold)} {base}</>} />
      <Row k={`Average, ${quote} per ${base}`} v={<>buy {s.avgBuy == null ? '–' : fmtPrice(s.avgBuy)} · sell {s.avgSell == null ? '–' : fmtPrice(s.avgSell)}{s.spreadPct != null && <> · spread <span className={s.spreadPct >= 0 ? 'sw-pos' : 'sw-neg'}>{s.spreadPct >= 0 ? '+' : ''}{s.spreadPct.toFixed(1)}%</span></>}</>} />
      {s.medianGapBlocks != null && <Row k='How often' v={`about every ${gapLabel(s.medianGapBlocks)} · #${s.firstH.toLocaleString('en-US')} to #${s.lastH.toLocaleString('en-US')}`} tone='muted' />}
    </dl>
  )
}

/**
 * A pool opened up: its chart, its tape, and the wallets behind the tape.
 * Click a wallet and everything narrows to it: what it bought and sold here,
 * at what average prices, how often it trades, and where else it trades.
 * Nobody gets labelled a bot.
 */
function PoolTrades({ p }: { p: PoolView }) {
  const [t0, t1] = p.tokens
  const [who, setWho] = useState<string | null>(null)
  const [data, setData] = useState<TradesResponse | null>(null)
  const [across, setAcross] = useState<TradesResponse | null>(null)
  useEffect(() => {
    let alive = true
    setData(null)
    fetch(`/api/dex-trades?pair=${p.contract_addr}${who ? `&address=${who}` : ''}`)
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive) setData(j) }).catch(() => {})
    return () => { alive = false }
  }, [p.contract_addr, who])
  useEffect(() => {
    let alive = true
    setAcross(null)
    if (!who) return
    fetch(`/api/dex-trades?address=${who}`)
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive) setAcross(j) }).catch(() => {})
    return () => { alive = false }
  }, [who])
  const elsewhere = (across?.byPool ?? []).filter(b => b.pair !== p.contract_addr)
  const walletBtn = (a: string) => <button type='button' className='sw-wallet-btn' onClick={() => setWho(a)} title='Show only this wallet'>{shortAddress(a)}</button>

  return (
    <div className='sw-pool-form'>
      <PriceChart pool={p} from={t0} to={t1} />
      {!data ? <p className='sw-status'>Reading the trades…</p> : (
        <>
          {who ? (
            <div>
              <div className='sw-card-head'>
                <span className='sw-card-title'>{shortAddress(who)}</span>
                <span className='sw-head-end'>
                  <a className='of-btn of-btn--quiet of-btn--sm' href={SCAN_ADDRESS(who)} target='_blank' rel='noopener noreferrer'>Openfields Scan<Icon name='external' size={14} /></a>
                  <Button size='sm' variant='quiet' onClick={() => setWho(null)}>All wallets</Button>
                </span>
              </div>
              {data.wallets[0] && data.wallets[0].trades > 0 ? <WalletLine s={data.wallets[0]} base={t0.label} quote={t1.label} /> : <p className='sw-fine'>No trades in this pool.</p>}
              {elsewhere.length > 0 && <p className='sw-fine'>Also trades {elsewhere.map(b => `${b.label} ×${b.stats.trades}`).join(' · ')}</p>}
            </div>
          ) : (
            <div>
              <p className='sw-fine'>{data.total} trade{data.total === 1 ? '' : 's'} · <span className='sw-pos'>{data.buys} buys</span> · <span className='sw-neg'>{data.sells} sells</span>. A buy takes {t0.label} out.</p>
              <div className='sw-tape'>
                {data.wallets.map(s => (
                  <div key={s.address}>
                    {walletBtn(s.address)}
                    <span>{s.trades} trades · <span className='sw-pos'>{s.buys} buys</span> · <span className='sw-neg'>{s.sells} sells</span></span>
                    {s.spreadPct != null && <span>spread {s.spreadPct >= 0 ? '+' : ''}{s.spreadPct.toFixed(1)}%</span>}
                    {s.medianGapBlocks != null && <span className='sw-tape-end'>every ~{gapLabel(s.medianGapBlocks)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className='sw-label'>{who ? 'Their trades here' : 'Every trade'}, newest first</p>
            {data.tape.length === 0 && <p className='sw-fine'>No trades yet.</p>}
            <div className='sw-tape'>
              {data.tape.map(tr => (
                <div key={tr.tx}>
                  <span className={tr.side === 'buy' ? 'sw-pos' : 'sw-neg'}>{tr.side === 'buy' ? 'Buy' : 'Sell'}</span>
                  <span>{fmtAmount(tr.base)} {t0.label} for {fmtAmount(tr.quote)} {t1.label} at {fmtPrice(tr.price)}</span>
                  {!who && walletBtn(tr.address)}
                  <a className='sw-tape-end' href={SCAN_TX(tr.tx)} target='_blank' rel='noopener noreferrer'>#{tr.h.toLocaleString('en-US')}</a>
                </div>
              ))}
            </div>
            {data.unpriced > 0 && <p className='sw-fine'>{data.unpriced} older swap{data.unpriced === 1 ? '' : 's'} recorded before amounts were kept, counted but not shown.</p>}
          </div>
        </>
      )}
    </div>
  )
}

// ── One pool ─────────────────────────────────────────────────────────

function PoolRow({ p, routePools, onDone, firstHand, arb, onTake, holders, flow }: {
  p: PoolView; routePools: PoolView[]; onDone: () => void
  firstHand?: { address: string; height: number; txhash?: string }; arb?: ArbPlan; onTake: (a: ArbPlan) => void; holders?: PoolHolders; flow?: LpFlow
}) {
  const me = useMyAddress()
  const provide = useProvideLiquidity()
  const withdraw = useExitPosition()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'none' | 'add' | 'remove' | 'trades'>('none')
  const [a0, setA0] = useState(''); const [a1, setA1] = useState('')
  const [lp, setLp] = useState('0'); const [lpAmt, setLpAmt] = useState('')
  const [err, setErr] = useState<Failure | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [t0, t1] = p.tokens

  // A cw20 LP token answers its own balance query; a TokenFactory LP denom (Skeleton Swap's pools, Astroport's newer ones) sits in the bank.
  useEffect(() => {
    if (!me) return
    const read = p.liquidity_token.startsWith('terra1') ? queryCw20Balance(p.liquidity_token, me) : queryBalance(me, { native_token: { denom: p.liquidity_token } })
    read.then(setLp)
  }, [me, p.liquidity_token, ok])
  // LP staked in Astroport's incentives contract is still this wallet's. Count it, and let Remove unstake whatever the wallet does not hold.
  const [staked, setStaked] = useState('0')
  useEffect(() => {
    const inc = VENUE_INCENTIVES[p.venue]
    if (!me || !inc) { setStaked('0'); return }
    smart<string>(inc, { deposit: { lp_token: p.liquidity_token, user: me } }).then(v => setStaked(typeof v === 'string' ? v : '0'))
  }, [me, p.venue, p.liquidity_token, ok])
  const lpAll = (BigInt(lp || '0') + BigInt(staked || '0')).toString()

  // Both sides' wallet balances, read while the add form is open: how much of either side is in the wallet,
  // and how much of the other side is needed.
  const [bal, setBal] = useState<[string, string]>(['0', '0'])
  useEffect(() => {
    if (!me || mode !== 'add') return
    let alive = true
    Promise.all([queryBalance(me, t0.info), queryBalance(me, t1.info)]).then(b => { if (alive) setBal([b[0], b[1]]) })
    return () => { alive = false }
  }, [me, mode, t0, t1, ok])

  // Either amount drives the other at the pool ratio, so a provider can't deposit at a wrong price and get arbed. An empty pool leaves both free.
  const dp = (tk: KnownToken) => (tk.decimals >= 8 ? 8 : 6)
  const plain = (n: number, places: number) => (Number.isFinite(n) && n > 0 ? n.toFixed(places).replace(/\.?0+$/, '') : '')
  const onA0 = (v: string) => { setA0(v); if (!p.empty) setA1(v ? plain(Number(v) * p.reserveRatio, dp(t1)) : '') }
  const onA1 = (v: string) => { setA1(v); if (!p.empty && p.reserveRatio > 0) setA0(v ? plain(Number(v) / p.reserveRatio, dp(t0)) : '') }
  const human = (micro: string, tk: KnownToken) => Number(micro) / 10 ** tk.decimals
  // Gas is paid in LUNA, so a LUNA side keeps a little back.
  const spendable = (i: 0 | 1) => Math.max(0, human(bal[i], p.tokens[i]) - (assetId(p.tokens[i].info) === 'uluna' ? 0.5 : 0))
  /** The largest both-sides deposit this wallet can fund at the pool ratio. */
  const fillMax = () => {
    if (p.empty || !(p.reserveRatio > 0)) return
    const x = Math.min(spendable(0), spendable(1) / p.reserveRatio) * 0.999
    if (x > 0) onA0(plain(x, dp(t0)))
  }
  /** All of one side, rounded down; on a pool with liquidity the other side follows at the pool ratio. */
  const fillSide = (i: 0 | 1) => {
    const places = dp(p.tokens[i])
    const x = Math.floor(spendable(i) * 10 ** places) / 10 ** places
    if (!(x > 0)) return
    const v = plain(x, places)
    if (i === 0) onA0(v); else onA1(v)
  }
  const short: [number, number] = [Math.max(0, (Number(a0) || 0) - human(bal[0], t0)), Math.max(0, (Number(a1) || 0) - human(bal[1], t1))]
  /** USD per whole token on side i, at the market reference. */
  const unitUsd = (i: 0 | 1) => { const r = human(p.reserves[i], p.tokens[i]); return p.sideUsd && r > 0 ? p.sideUsd[i] / r : null }
  /** xyk: taking y out of a side holding Y moves the price about y / (Y − y). */
  const impactFor = (i: 0 | 1, y: number) => { const Y = human(p.reserves[i], p.tokens[i]); return y >= Y ? Infinity : (y / (Y - y)) * 100 }
  const m0 = toMicro(a0, t0.decimals), m1 = toMicro(a1, t1.decimals)
  const canAdd = !!me && !!m0 && !!m1 && m0 !== '0' && m1 !== '0' && !provide.isLoading

  // ── zap: one token in, swap-half-then-provide in a single signature ──
  const zap = useZap()
  const [side, setSide] = useState<'both' | 'zap'>('both')
  /** A pool of USDC from Noble and USDC.inj takes both sides only: a zap would swap one dollar for the other, which this site never does. */
  const twoDollars = p.tokens.some(tk => assetId(tk.info) === NOBLE_USDC) && p.tokens.some(tk => assetId(tk.info) === USDC_INJ_DENOM)
  // Zap sizing is constant-product maths, so it is offered on xyk pools only. Not on Skeleton Swap's: its in-pool swap limit is Astroport-shaped.
  const canZapHere = !p.empty && p.pairType === 'xyk' && !twoDollars && p.venue !== 'skeleton'
  const [zIdx, setZIdx] = useState<0 | 1>(0)
  const [zAmt, setZAmt] = useState('')
  const [zBal, setZBal] = useState('0')
  const [zPlan, setZPlan] = useState<ZapPlan | null>(null)
  const [zRouted, setZRouted] = useState<RoutedZap | null>(null)
  const zTok = p.tokens[zIdx]
  const zMicro = toMicro(zAmt, zTok.decimals)
  const zDebounced = useDebounced(zMicro, 350)
  useEffect(() => { if (me && side === 'zap') queryBalance(me, zTok.info).then(setZBal); else setZBal('0') }, [me, side, zTok, ok])
  // Routing pools refresh in the background; plan against the latest without re-planning on each refresh.
  const routeRef = useRef(routePools)
  routeRef.current = routePools
  useEffect(() => {
    let alive = true; setZPlan(null); setZRouted(null)
    if (side !== 'zap' || p.empty || !zDebounced || zDebounced === '0') return
    planZap(p, zIdx, zDebounced, 0.01).then(pl => { if (alive) setZPlan(pl) })
    // The same zap with its swap done through the best path elsewhere. On a thin pool that is the difference between 10% impact and almost none.
    planRoutedZap(routeRef.current, p, zIdx, zDebounced, 0.01).then(rz => { if (alive) setZRouted(rz) }).catch(() => {})
    return () => { alive = false }
  }, [side, p, zIdx, zDebounced])
  // Routed wins when it moves the price meaningfully less than swapping inside this pool.
  const useRouted = !!zRouted && (!zPlan || zRouted.impactPct + 0.5 < zPlan.impact)
  const zInsufficient = !!zMicro && BigInt(zMicro) > BigInt(zBal || '0')
  const canZap = !!me && (useRouted || !!zPlan) && !zInsufficient && !zap.isLoading
  const doZap = async () => {
    if (!canZap) return
    setErr(null); setOk(null)
    try {
      if (useRouted && zRouted) {
        const tOut = p.tokens[zIdx === 0 ? 1 : 0]
        const keep = { info: zTok.info, amount: zRouted.keepMicro }, got = { info: tOut.info, amount: zRouted.getMicro }
        await zap.mutateAsync({ pair: p.contract_addr, route: zRouted.plan, maxSpread: 0.01, provide: zIdx === 0 ? [keep, got] : [got, keep], slippage: 0.02, sender: me })
      } else if (zPlan) {
        await zap.mutateAsync({ pair: p.contract_addr, offer: { info: zTok.info, amount: zPlan.swapAmount }, limitReturn: zPlan.limitReturn, maxSpread: 0.01, provide: zPlan.provide, slippage: 0.02, sender: me })
      } else return
      setOk(useRouted && zRouted ? `Added in one signature. The swap went through ${Array.from(new Set(zRouted.swap.legs.map(l => VENUE_NAME[l.pool.venue]))).join(' and ')}.` : 'Added in one signature, both sides.')
      setZAmt(''); setMode('none'); onDone()
    } catch (e) { setErr(failureOf(e)) }
  }
  const add = async () => {
    if (!canAdd || !m0 || !m1) return
    setErr(null); setOk(null)
    try {
      await provide.mutateAsync({ pair: p.contract_addr, assets: [{ info: t0.info, amount: m0 }, { info: t1.info, amount: m1 }], slippage: 0.01, sender: me, venue: p.venue })
      setOk('Liquidity added.'); setA0(''); setA1(''); setMode('none'); onDone()
    } catch (e) { setErr(failureOf(e)) }
  }
  const lpMicro = toMicro(lpAmt, 6)
  const canRemove = !!me && !!lpMicro && lpMicro !== '0' && BigInt(lpMicro) <= BigInt(lpAll) && !withdraw.isLoading
  const remove = async () => {
    if (!canRemove || !lpMicro) return
    setErr(null); setOk(null)
    try {
      await withdraw.mutateAsync({ pair: p.contract_addr, lpToken: p.liquidity_token, incentives: VENUE_INCENTIVES[p.venue], walletLp: lp, stakedLp: staked, amount: lpMicro, sender: me })
      setOk('Liquidity removed.'); setLpAmt(''); setMode('none'); onDone()
    } catch (e) { setErr(failureOf(e)) }
  }

  const pos = lpPosition(p, lpAll)
  const off = p.deviation != null ? (p.deviation > 1 ? p.deviation : 1 / p.deviation) : 1
  const offMarket = p.deviation != null && off >= 1.15
  const toggle = (m: typeof mode) => { setErr(null); setOk(null); setMode(cur => (cur === m ? 'none' : m)) }
  const bodyId = `pool-body-${p.contract_addr}`
  const conc = holders ? lpConcentration(holders.total, holders.holders) : null

  return (
    <div id={`pool-${p.contract_addr}`}>
      <button type='button' className='sw-item' aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(o => !o)}>
        <PairIcons a={t0.label} b={t1.label} size={24} />
        <span className='sw-item-main'>
          <span className='sw-item-title'>
            <span>{p.label}</span>
            {pos && <span className='sw-tag'>yours</span>}
          </span>
          <span className='sw-item-sub'>
            {VENUE_NAME[p.venue]}
            {p.empty ? ' · empty' : offMarket ? <span className='sw-warn'> · {off.toFixed(off >= 10 ? 0 : 1)}× off the market</span> : ''}
          </span>
        </span>
        <span className='sw-item-end'>{p.tvlUsd != null && !p.empty ? compactUsd(p.tvlUsd) || '$0' : ''}</span>
        <Icon name='chevronRight' size={16} />
      </button>
      {open && (
        <div id={bodyId} className='sw-item-body'>
          <dl className='sw-rows'>
            {!p.empty && p.tvlUsd != null && <Row k='Liquidity' v={`$${p.tvlUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />}
            {!p.empty && (p.sideUsd
              ? (() => {
                  const [va, vb] = p.sideUsd
                  const tot = va + vb
                  const pct = (v: number) => (tot > 0 ? Math.round((v / tot) * 100) : 50)
                  return <Row k='Each side' v={`${amt(p.reserves[0], t0.decimals)} ${t0.label} (${pct(va)}%) · ${amt(p.reserves[1], t1.decimals)} ${t1.label} (${pct(vb)}%)`} tone='muted' />
                })()
              : <Row k='Each side' v={`${amt(p.reserves[0], t0.decimals)} ${t0.label} · ${amt(p.reserves[1], t1.decimals)} ${t1.label}`} tone='muted' />)}
            {!p.empty && p.price > 0 && (
              <Row k='Price' tone={offMarket ? (off > 2 ? 'bad' : 'warn') : undefined}
                v={`1 ${t0.label} = ${fmtPrice(p.price)} ${t1.label}${p.deviation != null ? offMarket ? `, ${off.toFixed(off >= 10 ? 0 : 1)}× off the market (${fmtPrice(p.marketPrice ?? 0)})` : ', at the market' : ''}`} />
            )}
            {!p.empty && p.tvlUsd != null && p.tvlUsd > 0 && (() => {
              // xyk: a $100 trade against one side (about tvl/2) moves the price by about 100/(side+100).
              const imp = 100 / (p.tvlUsd / 2 + 100) * 100
              return <Row k='A $100 swap moves it' v={`about ${imp.toFixed(imp >= 10 ? 0 : 1)}%`} tone={imp > 10 ? 'bad' : imp > 3 ? 'warn' : undefined} />
            })()}
            <Row k='Pool fee' v={poolFeeTextFor(p)} tone='muted' />
            {/* Skeleton Swap's pools: their owner can pause swaps, deposits or withdrawals. */}
            {p.venue === 'skeleton' && [p.swapsEnabled === false ? 'swaps' : '', p.depositsEnabled === false ? 'deposits' : '', p.withdrawalsEnabled === false ? 'withdrawals' : ''].some(Boolean) && (
              <Row k='Paused by its owner' v={[p.swapsEnabled === false ? 'swaps' : '', p.depositsEnabled === false ? 'deposits' : '', p.withdrawalsEnabled === false ? 'withdrawals' : ''].filter(Boolean).join(', ')} tone='warn' />
            )}
            {p.venue === 'skeleton' && p.fees && <Row k='Fee split' v={`${bpsPct(p.fees.lpBps)} to providers · ${bpsPct(p.fees.protocolBps)} to White Whale${p.fees.burnBps > 0 ? ` · ${bpsPct(p.fees.burnBps)} burned` : ''}`} tone='muted' />}
            {/* Fees paid are read from Astroport-code swap events; White Whale's pairs write theirs differently. */}
            {!p.empty && p.venue !== 'skeleton' && (p.tvlUsd ?? 0) >= DUST_USD && <PoolFees pair={p.contract_addr} />}
            {/* How easily this pool can walk away: depth is what a trade costs today; this is whether it is still here tomorrow. */}
            {conc && <Row k='Liquidity held by' tone={conc.toHalf === 1 ? 'warn' : undefined}
              v={`${conc.count} ${conc.count === 1 ? 'wallet' : 'wallets'}, the largest ${conc.topPct.toFixed(0)}%${conc.toHalf === 1 ? '; one signature empties it' : `; ${conc.toHalf} hold the majority`}`} />}
            {firstHand && <Row k='First liquidity' tone='muted' v={firstHand.txhash
              ? <a href={SCAN_TX(firstHand.txhash)} target='_blank' rel='noopener noreferrer'>{shortAddress(firstHand.address)} at #{firstHand.height.toLocaleString('en-US')}</a>
              : `${shortAddress(firstHand.address)} at #${firstHand.height.toLocaleString('en-US')}`} />}
            {/* An LP balance is a claim on a fraction of the pool: say which fraction, of what, and what it is worth. */}
            {pos && <Row k={`Yours, ${pos.sharePct.toFixed(pos.sharePct >= 10 ? 0 : 1)}% of the pool${staked !== '0' ? `, ${amt(staked, 6)} LP staked` : ''}`} tone='strong'
              v={`${fmtAmount(pos.amounts[0])} ${t0.label} + ${fmtAmount(pos.amounts[1])} ${t1.label}${pos.usd != null ? ` · ${pos.usd >= 10 ? `$${Math.round(pos.usd).toLocaleString('en-US')}` : `$${pos.usd.toFixed(2)}`}` : ''}`} />}
            {pos && <PutInRows flow={flow} tokens={p.tokens} amounts={pos.amounts} />}
          </dl>

          {/* The gap, sized: "1.9× off the market" is a warning nobody can act on; with the number it is a trade of known size. */}
          {arb && (
            <div className='sw-alt'>
              <p><b>{fmtAmount(arb.inAmount)} {arb.inToken.label}</b> ({fmtUsd(arb.inUsd)}) closes the gap and returns <b>{fmtAmount(arb.outAmount)} {arb.outToken.label}</b>, about <span className='sw-pos'>{fmtUsd(arb.profitUsd)}</span> over reference prices. Someone else can close it first.</p>
              <Button size='sm' onClick={() => onTake(arb)}>Close the gap</Button>
            </div>
          )}

          <div className='sw-pool-actions'>
            {p.depositsEnabled !== false && <Button size='sm' variant={mode === 'add' ? 'primary' : 'secondary'} aria-pressed={mode === 'add'} onClick={() => toggle('add')}>Add</Button>}
            {Number(lpAll) > 0 && p.withdrawalsEnabled !== false && <Button size='sm' variant={mode === 'remove' ? 'primary' : 'secondary'} aria-pressed={mode === 'remove'} onClick={() => toggle('remove')}>Remove</Button>}
            {/* This site's trade tape reads its own ledger, which does not follow Skeleton Swap's pools. */}
            {!p.empty && p.venue !== 'skeleton' && <Button size='sm' variant='quiet' aria-pressed={mode === 'trades'} onClick={() => toggle('trades')}>Trades</Button>}
            {p.venue !== 'skeleton' && <Link href={`/pool/${p.contract_addr}`} prefetch={false} className='of-btn of-btn--quiet of-btn--sm'>Details</Link>}
          </div>

          {mode === 'add' && (
            <div className='sw-pool-form'>
              {p.empty && <p className='sw-hint'>An empty pool: the ratio you deposit sets its opening price.{p.marketPrice ? <> The market says 1 {t0.label} ≈ {fmtPrice(p.marketPrice)} {t1.label}.</> : null}</p>}
              {!p.empty && p.deviation != null && (p.deviation > 1.25 || p.deviation < 0.8) && (
                <ul className='sw-notes'><li className='is-bad'>This pool is {off.toFixed(1)}× off the market. Adding at this ratio hands the difference to whoever closes the gap. Swap it back toward {fmtPrice(p.marketPrice ?? 0)} {t1.label} per {t0.label} first.</li></ul>
              )}
              {canZapHere && (
                <div className='of-seg' role='radiogroup' aria-label='How to add'>
                  <button type='button' role='radio' aria-checked={side === 'both'} onClick={() => setSide('both')}>Both tokens</button>
                  <button type='button' role='radio' aria-checked={side === 'zap'} onClick={() => setSide('zap')}>One token</button>
                </div>
              )}
              {side === 'both' || !canZapHere ? (
                <>
                  <div className='sw-pair'>
                    <input className='sw-input' type='number' inputMode='decimal' min='0' step='any' placeholder={`0 ${t0.label}`} aria-label={`${t0.label} to add`} value={a0} onChange={e => onA0(e.target.value)} />
                    <input className='sw-input' type='number' inputMode='decimal' min='0' step='any' placeholder={`0 ${t1.label}`} aria-label={`${t1.label} to add`} value={a1} onChange={e => onA1(e.target.value)} />
                  </div>
                  {me && (
                    <div className='sw-field-head'>
                      <span className='sw-field-bal'>In wallet {amt(bal[0], t0.decimals)} {t0.label} · {amt(bal[1], t1.decimals)} {t1.label}</span>
                      <span>
                        {([0, 1] as const).filter(i => spendable(i) > 0).map(i => (
                          <button key={i} type='button' className='sw-max' onClick={() => fillSide(i)}>Max {p.tokens[i].label}</button>
                        ))}
                        {!p.empty && spendable(0) > 0 && spendable(1) > 0 && <button type='button' className='sw-max' onClick={fillMax}>Max both</button>}
                      </span>
                    </div>
                  )}
                  {/* What is missing, sized, and what fetching it here would cost. */}
                  {me && !p.empty && (short[0] > 0 || short[1] > 0) && (() => {
                    const gaps = ([0, 1] as const).filter(i => short[i] > 0)
                    const one = gaps.length === 1 ? gaps[0] : null
                    const imp = one == null || p.pairType !== 'xyk' ? null : impactFor(one, short[one])
                    return (
                      <ul className='sw-notes'>
                        <li>
                          You need {gaps.map((i, k) => { const usd = unitUsd(i); return <span key={i}>{k > 0 ? ' and ' : ''}{fmtAmount(short[i])} {p.tokens[i].label}{usd ? ` (${fmtUsd(short[i] * usd)})` : ''}</span> })} more for this deposit.
                          {one != null && imp != null && (Number.isFinite(imp)
                            ? <> Buying it in this pool would move the price about {imp.toFixed(imp >= 10 ? 0 : 1)}%{imp > 3 ? ', so a deeper market is cheaper.' : '.'}</>
                            : <> That is more than this pool holds, so it has to come from somewhere else.</>)}
                        </li>
                      </ul>
                    )
                  })()}
                  <ActionButton me={me} label='Add liquidity' onClick={add} disabled={!canAdd} busy={provide.isLoading} />
                </>
              ) : (
                <>
                  <div className='sw-pair'>
                    <input className='sw-input' type='number' inputMode='decimal' min='0' step='any' placeholder={`0 ${zTok.label}`} aria-label={`${zTok.label} to add`} value={zAmt} onChange={e => setZAmt(e.target.value)} />
                    <div className='of-seg' role='radiogroup' aria-label='Which token'>
                      {([0, 1] as const).map(i => (
                        <button key={i} type='button' role='radio' aria-checked={zIdx === i} onClick={() => { setZIdx(i); setZAmt('') }}>{p.tokens[i].label}</button>
                      ))}
                    </div>
                  </div>
                  {me && (
                    <div className='sw-field-head'>
                      <span className='sw-field-bal'>Balance {amt(zBal, zTok.decimals)} {zTok.label}</span>
                      {Number(zBal) > 0 && <button type='button' className='sw-max' onClick={() => setZAmt(fromMicro((BigInt(zBal) * BigInt(9_960) / BigInt(10_000)).toString(), zTok.decimals, 6).replace(/,/g, ''))}>Max</button>}
                    </div>
                  )}
                  {useRouted && zRouted ? (() => {
                    const tOut = p.tokens[zIdx === 0 ? 1 : 0]
                    const via = zRouted.plan.kind === 'multi' ? " in one call to Openfields Swap's router" : zRouted.plan.kind === 'router' ? " in one call to Astroport's router" : ''
                    return (
                      <dl className='sw-rows'>
                        <Row k='1. Swap' v={`${amt(zRouted.plan.legs[0].offerAmount, zTok.decimals, 6)} ${zTok.label} for at least ${amt(zRouted.getMicro, tOut.decimals, 6)} ${tOut.label}`} />
                        <Row k='Route' v={`${routeText(zRouted.swap)}${via}`} tone='muted' />
                        <Row k='Price impact' v={`${zRouted.impactPct.toFixed(2)}%${zPlan ? `, against ${zPlan.impact.toFixed(1)}% inside this pool` : ''}`} tone={zRouted.impactPct > 3 ? 'warn' : undefined} />
                        <Row k='2. Add' v={`${amt(zRouted.keepMicro, zTok.decimals, 6)} ${zTok.label} + ${amt(zRouted.getMicro, tOut.decimals, 6)} ${tOut.label}`} />
                        <p className='sw-fine'>Anything the swap returns above that, and any {zTok.label} not needed to match, stays in your wallet.</p>
                      </dl>
                    )
                  })() : zPlan && (() => {
                    const tOut = p.tokens[zIdx === 0 ? 1 : 0]
                    const keep = zPlan.provide[zIdx], got = zPlan.provide[zIdx === 0 ? 1 : 0]
                    return (
                      <dl className='sw-rows'>
                        <Row k='1. Swap' v={`${amt(zPlan.swapAmount, zTok.decimals, 6)} ${zTok.label} for about ${amt(zPlan.expectedReturn, tOut.decimals, 6)} ${tOut.label}`} />
                        <Row k='Price impact' v={`${zPlan.impact.toFixed(2)}%`} tone={zPlan.impact > 3 ? 'warn' : undefined} />
                        <Row k='2. Add' v={`${amt(keep.amount, zTok.decimals, 6)} ${zTok.label} + ${amt(got.amount, tOut.decimals, 6)} ${tOut.label}`} />
                        <p className='sw-fine'>Pool fee {poolFeeTextFor(p)}. Dust from rounding stays in your wallet.</p>
                      </dl>
                    )
                  })()}
                  {zInsufficient && <p className='sw-hint is-bad'>Not enough {zTok.label}.</p>}
                  <ActionButton me={me} label={zap.isLoading ? 'Confirm in your wallet' : zMicro && zMicro !== '0' ? 'Add in one signature' : 'Enter an amount'} onClick={doZap} disabled={!canZap} busy={zap.isLoading} />
                </>
              )}
            </div>
          )}
          {mode === 'remove' && (
            <div className='sw-pool-form'>
              <div className='sw-pair'>
                <input className='sw-input' type='number' inputMode='decimal' min='0' step='any' placeholder='LP amount' aria-label='LP amount to remove' value={lpAmt} onChange={e => setLpAmt(e.target.value)} />
                <Button onClick={() => setLpAmt(fromMicro(lpAll, 6, 6).replace(/,/g, ''))}>All</Button>
              </div>
              <ActionButton me={me} label={withdraw.isLoading ? 'Confirm in your wallet' : 'Remove liquidity'} onClick={remove} disabled={!canRemove} busy={withdraw.isLoading} />
            </div>
          )}
          {mode === 'trades' && <PoolTrades p={p} />}
          <div className='sw-gap'>
            <ErrorNote error={err} />
            {ok && <p className='sw-ok'><Icon name='check' size={16} />{ok}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── The list ─────────────────────────────────────────────────────────

export default function Pools({ pools, ownPools, routePools, board, holders, arbs, focus, onDone, onTake, onCreate, onTrade }: {
  pools: PoolView[]; ownPools: PoolView[]; routePools: PoolView[]; board: BoardResponse | null; holders: Record<string, PoolHolders>; arbs: ArbPlan[]
  focus: PoolsFocus | null; onDone: () => void; onTake: (a: ArbPlan) => void; onCreate: () => void
  onTrade: (fromId: string, toId: string, amount: string) => void
}) {
  const me = useMyAddress()
  const { t } = useLang()
  const [venue, setVenue] = useState<'all' | Venue>('all')
  /** Find a pool by any of its tokens: "luna", "sol usdc". Every word has to match. */
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PoolSort>(IS_ASTRO ? 'tvl' : 'suggested')
  /* Anyone can open a pool, so most of them are empty shells someone made to see what happened. Showing
     fifteen of those buries the five that matter. A search looks through all of them. */
  const [showDust, setShowDust] = useState(false)

  // Something elsewhere asked for a pool, a token or the liquid staking board: clear whatever would hide it, then go there.
  const seen = useRef(0)
  useEffect(() => {
    if (!focus || focus.n === seen.current) return
    seen.current = focus.n
    setVenue('all'); setQuery(focus.query); if (focus.dust) setShowDust(true)
    if (focus.elementId) setTimeout(() => {
      const el = document.getElementById(focus.elementId)
      el?.scrollIntoView({ behavior: 'smooth', block: focus.elementId === 'lst' ? 'start' : 'center' })
      el?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click()
    }, 150)
  }, [focus])

  const sorted = useMemo(() => {
    const activity = (p: PoolView) => board?.poolActivity?.[p.contract_addr]?.count ?? 0
    const solidFirst = (p: PoolView) => (!IS_ASTRO && p.tokens.some(tk => tk.key === 'SOLID') ? 0 : 1)
    const tvl = (p: PoolView) => p.tvlUsd ?? 0
    const cmp: Record<PoolSort, (a: PoolView, b: PoolView) => number> = {
      suggested: (a, b) => solidFirst(a) - solidFirst(b) || tvl(b) - tvl(a),
      tvl: (a, b) => tvl(b) - tvl(a),
      traded: (a, b) => activity(b) - activity(a) || tvl(b) - tvl(a),
      name: (a, b) => a.label.localeCompare(b.label),
    }
    const words = query.toLowerCase().split(/[\s/]+/).filter(Boolean)
    const matches = (p: PoolView) => {
      const hay = `${p.label} ${p.tokens.map(tk => `${tk.key} ${TOKEN_META[tk.key]?.name ?? ''}`).join(' ')}`.toLowerCase()
      return words.every(w => hay.includes(w))
    }
    return pools.filter(p => (venue === 'all' || p.venue === venue) && matches(p)).sort(cmp[sort])
  }, [pools, venue, query, sort, board])
  const visible = useMemo(() => (showDust || query.trim() ? sorted : sorted.filter(p => (p.tvlUsd ?? 0) >= DUST_USD)), [sorted, showDust, query])
  const dustCount = sorted.length - sorted.filter(p => (p.tvlUsd ?? 0) >= DUST_USD).length
  const venues = (['all', 'terraswap', 'astroport', 'skeleton'] as const).filter(v => v === 'all' || pools.some(p => p.venue === v))
  const venueWord: Record<'all' | Venue, string> = { all: t('All'), terraswap: 'Openfields', astroport: 'Astroport', skeleton: 'Skeleton' }

  return (
    <section className='sw-page' aria-labelledby='sw-pools-title'>
      <div className='sw-head'>
        <h1 id='sw-pools-title' className='sw-title'>{t('Pools')}</h1>
        <Button size='sm' onClick={onCreate}><Icon name='plus' size={16} />{t('Open a pool')}</Button>
      </div>

      {pools.length === 0 ? (
        <Empty title={IS_ASTRO ? 'Could not read the pool list' : 'No pools yet'}>
          {!IS_ASTRO && <Button variant='primary' onClick={onCreate}>Open the first one</Button>}
        </Empty>
      ) : (
        <>
          <div className='sw-toolbar'>
            <input className='sw-input sw-input--sm' value={query} onChange={e => setQuery(e.target.value)} aria-label={t('Find a pool')}
              placeholder={t('Find a pool: LUNA, SOLID USDC…')} spellCheck={false} autoComplete='off' type='search' />
          </div>
          <div className='sw-filters'>
            {venues.length > 2 && (
              <div className='of-seg' role='radiogroup' aria-label='Site'>
                {venues.map(v => (
                  <button key={v} type='button' role='radio' aria-checked={venue === v} onClick={() => { setVenue(v); setShowDust(false) }}>{venueWord[v]}</button>
                ))}
              </div>
            )}
            <label className='sw-select'>
              <span className='of-sr'>Sort by</span>
              <select value={sort} onChange={e => setSort(e.target.value as PoolSort)}>
                {(['suggested', 'tvl', 'traded', 'name'] as const).filter(s => s !== 'suggested' || !IS_ASTRO).map(s => <option key={s} value={s}>{POOL_SORT_LABEL[s]}</option>)}
              </select>
              <Icon name='chevronDown' size={14} />
            </label>
          </div>

          {query.trim() && visible.length === 0 ? (
            <Empty title='No pool holds that'>
              <Button onClick={onCreate}>{t('Open a pool')}</Button>
            </Empty>
          ) : (
            <div className='sw-list'>
              {visible.map(p => (
                <PoolRow key={p.contract_addr} p={p} routePools={routePools} onDone={onDone} onTake={onTake}
                  firstHand={board?.firstHands?.[p.contract_addr]} arb={arbs.find(a => a.pool.contract_addr === p.contract_addr)}
                  holders={holders[p.contract_addr]} flow={me ? board?.flows?.[`${me}|${p.contract_addr}`] : undefined} />
              ))}
            </div>
          )}
          {dustCount > 0 && !query.trim() && (
            <div className='sw-gap'>
              <Button variant='quiet' size='sm' onClick={() => setShowDust(s => !s)}>
                {showDust ? 'Hide the empty ones' : `Show ${dustCount} pool${dustCount === 1 ? '' : 's'} under $${DUST_USD}`}
              </Button>
            </div>
          )}

          {!query.trim() && ownPools.some(p => !p.empty) && (
            <div id='lst'>
              <h2 className='sw-h2 sw-section'>Liquid staking against the hubs</h2>
              {/* "Swap" opens the trade in the swap box, which offers the hub when it is the better side. */}
              <LstBoard onTrade={onTrade} />
            </div>
          )}
        </>
      )}
    </section>
  )
}

