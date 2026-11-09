/**
 * /pool/[addr]: a page per pool. Its liquidity and both sides, its price over
 * time beside the market for the same pair, how much trades before its price
 * moves either way, what its swaps paid its providers, its recent trades, and
 * the ways in: a swap either way, or adding liquidity. Read in the browser from
 * the same endpoints as /stats; the title is rendered on the server from the
 * pool's pair query.
 */

import Link from 'next/link'
import type { GetStaticPaths, GetStaticProps } from 'next'
import { useEffect, useMemo, useState } from 'react'
import AppShell from 'components/shell/AppShell'
import { Disclosure, Icon } from 'components/ui'
import { PairIcons } from 'components/TokenIcon'
import { Figures, Row, amt, fmtPrice } from 'components/swap/common'
import PriceHistoryChart from 'components/PriceHistoryChart'
import dynamic from 'next/dynamic'
const CandleChart = dynamic(() => import('components/CandleChart'), { ssr: false })
import DepthCurve, { markLine } from 'components/DepthCurve'
import {
  KNOWN_TOKENS, NOBLE_USDC, USDC_INJ_DENOM, VENUE_NAME, annotateMarket, annotateValues, assetId, fromMicro, smart, tokenFor,
  type AssetInfo, type PoolView,
} from 'lib/dex'
import { fmtAmount, fmtUsd } from 'lib/arb'
import type { DexResponse } from 'lib/api/dex'
import type { VenueResponse } from 'lib/api/dex-venue'
import type { PoolFeesResponse } from 'lib/api/pool-fees'
import type { PricesResponse } from 'lib/api/dex-prices'
import type { DepthResponse } from 'lib/api/depth'
import { SITE_URL } from 'lib/siteUrl'
import { SCAN_ADDRESS, SCAN_TX } from 'lib/products'

const ADDR = /^terra1[02-9ac-hj-np-z]{38,58}$/
const enc = encodeURIComponent

/**
 * Built on the first visit and kept (incremental static regeneration): the
 * page is client-rendered, and the server only names the pool for its social
 * card. Rendered per request before 2026-09-27, which cost CPU on every visit
 * that missed the CDN (Vercel's Hobby plan).
 *
 * Only an address that answers as a pair is kept. Anything else, or a chain
 * that did not answer in time, is a 404 (pages/404), which Next holds in
 * memory for a minute and never writes to disk, so any number of made-up
 * addresses cannot fill it with pages.
 */
export const getStaticPaths: GetStaticPaths = async () => ({ paths: [], fallback: 'blocking' })

export const getStaticProps: GetStaticProps = async ctx => {
  const addr = String(ctx.params?.addr ?? '')
  if (!ADDR.test(addr)) return { notFound: true, revalidate: 86_400 }
  const base = SITE_URL
  let label = ''
  let share = ''
  try {
    const info = await Promise.race([
      smart<{ asset_infos?: AssetInfo[] }>(addr, { pair: {} }),
      new Promise<null>(r => setTimeout(() => r(null), 3500)),
    ])
    if (info?.asset_infos?.length === 2) {
      const [t0, t1] = info.asset_infos.map(tokenFor)
      label = `${t0.label} / ${t1.label}`
      const listed = [t0, t1].every(t => KNOWN_TOKENS.some(k => k.key === t.key))
      const dollars = [t0, t1].map(t => assetId(t.info))
      if (listed && !(dollars.includes(NOBLE_USDC) && dollars.includes(USDC_INJ_DENOM))) share = `?from=${enc(t0.key)}&to=${enc(t1.key)}`
    }
  } catch { /* not a pair, or no answer: a 404 below */ }
  // Not a pair, or the chain did not answer in time: asked again in a minute, and nothing is written.
  if (!label) return { notFound: true, revalidate: 60 }
  return {
    // A day once the pool's name is known: a pair never changes its tokens.
    revalidate: 86_400,
    props: {
      addr,
      label,
      og: {
        title: label ? `${label} pool on Terra` : 'A pool on Terra',
        description: `${label ? `The ${label} pool's` : 'Its'} liquidity, price, depth, fees paid to providers and recent trades.`,
        image: `${base}/api/og/swap${share}`,
        url: `${base}/pool/${addr}`,
        type: 'website',
      },
    },
  }
}

/** The pool's recorded trades as one line. */
export function Spark({ points }: { points: number[] }) {
  const W = 300, H = 56, PAD = 3
  if (points.length < 2) return null
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(PAD + (i / (points.length - 1)) * (W - PAD * 2)).toFixed(1)},${(H - PAD - ((v - min) / span) * (H - PAD * 2)).toFixed(1)}`).join(' ')
  const up = points[points.length - 1] >= points[0]
  return (
    <svg className='sw-chart-line' viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' aria-hidden>
      <path d={d} fill='none' stroke='currentColor' className={up ? 'sw-pos' : 'sw-neg'} strokeWidth='1.75' vectorEffect='non-scaling-stroke' strokeLinejoin='round' strokeLinecap='round' />
    </svg>
  )
}

export default function PoolPage({ addr, label }: { addr: string; label: string }) {
  const [dex, setDex] = useState<DexResponse | null>(null)
  const [venue, setVenue] = useState<VenueResponse | null>(null)
  const [px, setPx] = useState<Record<string, number> | null>(null)
  const [done, setDone] = useState(false)
  const [fees, setFees] = useState<PoolFeesResponse | null>(null)
  const [feesFailed, setFeesFailed] = useState(false)
  const [prices, setPrices] = useState<PricesResponse | null>(null)
  const [depth, setDepth] = useState<DepthResponse | null | 'failed'>(null)

  useEffect(() => {
    let alive = true
    const json = <T,>(u: string) => fetch(u).then(r => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)
    Promise.all([json<DexResponse>('/api/dex'), json<VenueResponse>('/api/dex-venue'), json<{ px?: Record<string, number> }>('/api/dex-market')])
      .then(([d, v, m]) => { if (!alive) return; setDex(d); setVenue(v); setPx(m?.px ?? null); setDone(true) })
    json<PoolFeesResponse>(`/api/pool-fees?pair=${addr}`).then(f => { if (!alive) return; if (f) setFees(f); else setFeesFailed(true) })
    json<PricesResponse>(`/api/dex-prices?pair=${addr}`).then(p => { if (alive && p) setPrices(p) })
    json<DepthResponse>(`/api/depth?pool=${addr}`).then(d => { if (alive) setDepth(d ?? 'failed') })
    return () => { alive = false }
  }, [addr])

  const pool = useMemo<PoolView | null>(() => {
    const own = (dex?.pools ?? []).map(p => ({ ...p }))
    if (px) { const live = own.filter(p => !p.empty); annotateMarket(live, px); annotateValues(live, px) }
    return [...own, ...(venue?.pools ?? [])].find(p => p.contract_addr === addr) ?? null
  }, [dex, venue, px, addr])

  const title = pool?.label ?? (label || 'A pool')
  if (!pool) {
    return (
      <AppShell page='pools'>
        <section className='sw-page sw-narrow'>
          <h1 className='sw-title'>{title}</h1>
          {done
            ? <>
                <p className='sw-lede'>Not a pool this site lists, or the chain did not answer just now.</p>
                <div className='sw-gap'><a className='of-btn of-btn--secondary' href={SCAN_ADDRESS(addr)} target='_blank' rel='noopener noreferrer'>See it on Openfields Scan<Icon name='external' size={14} /></a></div>
              </>
            : <p className='sw-status sw-gap'><span className='of-spin' aria-hidden /> Reading the pool…</p>}
        </section>
      </AppShell>
    )
  }

  const [t0, t1] = pool.tokens
  const ids = pool.tokens.map(t => assetId(t.info))
  const bothDollars = ids.includes(NOBLE_USDC) && ids.includes(USDC_INJ_DENOM)
  const off = pool.deviation != null && pool.deviation > 0 ? (pool.deviation > 1 ? pool.deviation : 1 / pool.deviation) : null
  const feeText = pool.venue === 'terraswap'
    ? '0.3% per swap, all of it to liquidity providers'
    : `${pool.pairType === 'xyk' ? '0.3%' : pool.pairType === 'stable' ? '0.05%' : 'A dynamic fee'} per swap, set by Astroport's pool, part of it to Astroport`
  const days = fees && !fees.complete && fees.since ? Math.max(1, Math.round((fees.at - Date.parse(fees.since)) / 86_400_000)) : 30
  const money = (v: { usd: number | null; swaps: number }) => {
    const swaps = `${v.swaps} swap${v.swaps === 1 ? '' : 's'}`
    return v.usd != null ? `${fmtUsd(v.usd)} from ${swaps}` : `${swaps}, in a token without a market price`
  }
  const series = (prices?.points ?? []).map(p => p.p).filter(v => Number.isFinite(v) && v > 0)
  const known = (key: string) => KNOWN_TOKENS.some(k => k.key === key)
  const charted = known(t0.key) && known(t1.key)
  const sides = depth && depth !== 'failed' && depth.kind === 'pool' ? [depth.sell0, depth.sell1] : null

  return (
    <AppShell page='pools'>
      <article className='sw-page'>
        <div className='sw-head'>
          <div className='sw-title-row'>
            <PairIcons a={t0.label} b={t1.label} size={32} />
            <h1 className='sw-title'>{pool.label}</h1>
          </div>
        </div>
        <p className='sw-lede'>{VENUE_NAME[pool.venue]}{pool.pairType !== 'xyk' ? `, ${pool.pairType}` : ''}. {feeText}.</p>

        <div className='sw-card sw-gap'>
          <Figures items={[
            { label: 'Liquidity', value: pool.empty ? 'Empty' : pool.tvlUsd != null ? fmtUsd(pool.tvlUsd) : '–' },
            ...(pool.price > 0 ? [{ label: `1 ${t0.label}`, value: `${fmtPrice(pool.price)} ${t1.label}`, sub: `1 ${t1.label} = ${fmtPrice(1 / pool.price)} ${t0.label}` }] : []),
            ...(off != null ? [{ label: 'Against the market', value: off < 1.03 ? 'In line' : `${off.toFixed(off >= 10 ? 0 : 2)}× off`, sub: off < 1.03 ? 'within 3%' : undefined }] : []),
          ]} />
          <dl className='sw-rows sw-divide'>
            {pool.tokens.map((t, i) => (
              <Row key={i} k={`${t.label} in the pool`} v={`${amt(pool.reserves[i], t.decimals)}${pool.sideUsd ? ` · ${fmtUsd(pool.sideUsd[i])}` : ''}`} />
            ))}
            {fees && fees.day30.swaps > 0 && days >= 7 && <Row k='Paid to providers, 7 days' v={money(fees.day7)} />}
            {fees && fees.day30.swaps > 0 && <Row k={`Paid to providers, ${days} days`} v={money(fees.day30)} />}
            {fees && fees.day30.swaps === 0 && <Row k='Paid to providers' v='no swaps in 30 days' tone='muted' />}
            {!fees && !feesFailed && <Row k='Paid to providers' v='…' tone='muted' />}
          </dl>
        </div>

        <div className='sw-act'>
          {!pool.empty && !bothDollars && <Link prefetch={false} href={`/?from=${enc(t0.key)}&to=${enc(t1.key)}`} className='of-btn of-btn--primary of-btn--lg of-btn--block'>Swap {t0.label} for {t1.label}</Link>}
          <div className='of-next'>
            {!pool.empty && !bothDollars && <Link prefetch={false} href={`/?from=${enc(t1.key)}&to=${enc(t0.key)}`} className='of-btn of-btn--quiet of-btn--sm'>Swap {t1.label} for {t0.label}</Link>}
            <Link prefetch={false} href={`/?tab=pools&pool=${pool.contract_addr}`} className='of-btn of-btn--quiet of-btn--sm'>{pool.empty ? 'Add the first liquidity' : 'Add liquidity'}</Link>
          </div>
        </div>

        {charted && !pool.empty && (
          <>
            <h2 className='sw-h2 sw-section'>Price over time</h2>
            <p className='sw-hint'>{t1.label} per {t0.label}, hourly, beside the market price. Where the lines part, the pool drifted.</p>
            <div className='sw-card sw-gap'><PriceHistoryChart query={`pool=${pool.contract_addr}&base=${enc(t0.key)}&quote=${enc(t1.key)}`} unit={t1.label} marketName='Market' /></div>
          </>
        )}

        {!pool.empty && (
          <>
            <h2 className='sw-h2 sw-section'>Recent trades</h2>
            {!prices && <p className='sw-status'>Reading trades…</p>}
            {prices && prices.tape.length === 0 && <p className='sw-status'>No trades found in its recent history.</p>}
            {prices && prices.tape.length > 0 && (
              <div className='sw-card'>
                <Spark points={series} />
                <div className='sw-tape'>
                  {prices.tape.slice(0, 6).map(r => (
                    <a key={r.tx} href={SCAN_TX(r.tx)} target='_blank' rel='noopener noreferrer'>
                      <span className={r.side === 'buy' ? 'sw-pos' : 'sw-neg'}>{r.side === 'buy' ? 'Bought' : 'Sold'}</span>
                      <span>{fmtAmount(r.base)} {t0.label} for {fmtAmount(r.quote)} {t1.label}</span>
                      <span className='sw-tape-end'>#{r.h.toLocaleString('en-US')}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!pool.empty && (
          <Disclosure summary='Candlesticks' className='sw-section'>
            <p className='sw-hint'>From this site&apos;s own record, which grows over time.</p>
            <div className='sw-card sw-gap'><CandleChart pair={pool.contract_addr} base={t0.label} quote={t1.label} /></div>
          </Disclosure>
        )}

        {!pool.empty && (
          <Disclosure summary='How much trades before the price moves' className='sw-gap'>
            <p className='sw-hint'>Selling each side into this pool alone, fee added back. The swap routes around a thin pool.</p>
            {depth === null && <p className='sw-status sw-gap'>Pricing a dozen sizes…</p>}
            {depth === 'failed' && <p className='sw-status sw-gap'>No market price for its tokens right now.</p>}
            {sides && (
              <div className='sw-sides sw-gap'>
                {sides.map((d, i) => (
                  <div key={i} className='sw-card'>
                    <p className='sw-card-title'>Selling {pool.tokens[i].label}</p>
                    {d ? <><p className='sw-card-sub'>Price impact {markLine(d)}</p><DepthCurve depth={d} /></> : <p className='sw-card-sub'>No market price for {pool.tokens[i].label}.</p>}
                  </div>
                ))}
              </div>
            )}
          </Disclosure>
        )}

        <Disclosure summary='Contract' className='sw-gap'>
          <dl className='sw-rows sw-gap'>
            <Row k='Pool contract' v={<a className='sw-mono' href={SCAN_ADDRESS(pool.contract_addr)} target='_blank' rel='noopener noreferrer'>{pool.contract_addr}</a>} />
            <Row k='LP token' v={<span className='sw-mono'>{pool.liquidity_token}</span>} />
            <Row k='LP tokens issued' v={fromMicro(pool.totalShare, 6)} />
            <Row k='Tokens' v={<>{pool.tokens.map((t, i) => <span key={t.key}>{i > 0 ? ' · ' : ''}{known(t.key) ? <Link href={`/token/${enc(t.key)}`}>{t.label}</Link> : t.label}</span>)}</>} />
          </dl>
          {pool.venue === 'terraswap' && <p className='sw-fine'>Openfields Swap&apos;s pools have no admin that can change them and no fee for anyone but their providers. <Link className='sw-link' href='/verify'>Check it from your browser</Link>.</p>}
        </Disclosure>
      </article>
    </AppShell>
  )
}
