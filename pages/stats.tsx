/**
 * /stats: Terra's DEX activity in one place, read from the chain and from this
 * repository's public status log. Liquidity on both sites and what the
 * deepest pools paid their providers, liquid staking tokens against their
 * hubs, pools that drifted off the market, what Openfields Swap's routing is used
 * for and adds, and uptime. No accounts, and nothing is stored about visitors.
 */

import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import AppShell from 'components/shell/AppShell'
import LstBoard from 'components/LstBoard'
import { PairIcons } from 'components/TokenIcon'
import { Icon } from 'components/ui'
import { Figures } from 'components/swap/common'
import { VENUE_NAME, annotateMarket, annotateValues, type PoolView } from 'lib/dex'
import { arbPlans, fmtAmount, fmtUsd } from 'lib/arb'
import type { DexResponse } from 'lib/api/dex'
import type { VenueResponse } from 'lib/api/dex-venue'
import type { StatsResponse } from 'lib/api/stats'
import type { PoolFeesResponse } from 'lib/api/pool-fees'

const REPO = 'https://github.com/openfieldsapp/openfields-swap'
const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const ago = (iso: string | null) => (iso ? `${Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 86_400_000))} days` : '')

/** What a pool paid its providers, read when the row comes near the screen (/api/pool-fees): every read is a request the host counts. */
function Fees({ pair }: { pair: string }) {
  const ref = useRef<HTMLElement>(null)
  const [near, setNear] = useState(false)
  const [f, setF] = useState<PoolFeesResponse | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setNear(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  useEffect(() => {
    if (!near) return
    let alive = true
    fetch(`/api/pool-fees?pair=${pair}`).then(r => (r.ok ? r.json() : null)).then((j: PoolFeesResponse | null) => { if (alive && j) setF(j) }).catch(() => {})
    return () => { alive = false }
  }, [near, pair])
  const days = f && !f.complete && f.since ? Math.max(1, Math.round((f.at - Date.parse(f.since)) / 86_400_000)) : 30
  const money = (v: number | null, n: number) => (v == null ? `${n} swaps` : fmtUsd(v))
  return (
    <small ref={ref}>
      {!f ? '…'
        : !f.day30.swaps ? 'no swaps'
        : days < 7 ? `${money(f.day30.usd, f.day30.swaps)} to providers in ${days} d`
        : `${money(f.day7.usd, f.day7.swaps)} in 7 d · ${money(f.day30.usd, f.day30.swaps)} in ${days} d`}
    </small>
  )
}

export default function StatsPage() {
  const [dex, setDex] = useState<DexResponse | null>(null)
  const [venue, setVenue] = useState<VenueResponse | null>(null)
  const [px, setPx] = useState<Record<string, number> | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [statsFailed, setStatsFailed] = useState(false)
  useEffect(() => {
    const json = <T,>(u: string) => fetch(u).then(r => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)
    json<DexResponse>('/api/dex').then(setDex)
    json<VenueResponse>('/api/dex-venue').then(setVenue)
    json<{ px?: Record<string, number> }>('/api/dex-market').then(j => setPx(j?.px ?? null))
    json<StatsResponse>('/api/stats').then(j => { if (j?.router) setStats(j); else setStatsFailed(true) })
  }, [])

  const own = useMemo(() => {
    const pools = (dex?.pools ?? []).filter(p => !p.empty).map(p => ({ ...p }))
    if (px) { annotateMarket(pools, px); annotateValues(pools, px) }
    return pools
  }, [dex, px])
  const all = useMemo<PoolView[]>(() => [...own, ...(venue?.pools ?? [])], [own, venue])
  const tvl = (v: 'terraswap' | 'astroport') => all.filter(p => p.venue === v).reduce((s, p) => s + (p.tvlUsd ?? 0), 0)
  const deep = useMemo(() => [...all].sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)).slice(0, 12), [all])
  const gaps = useMemo(() => (px ? arbPlans(own, px).slice(0, 6) : []), [own, px])
  const r = stats?.router, t = stats?.tagged

  return (
    <>
      <Head>
        <title>Stats · Openfields Swap</title>
      </Head>
      <AppShell page='stats'>
        <article className='sw-page'>
          <h1 className='sw-title'>Stats</h1>
          <p className='sw-lede'>From the chain and the <a className='sw-link' href={`${REPO}/tree/status`} target='_blank' rel='noopener noreferrer'>public status log</a>. The <a className='sw-link' href={`${REPO}/tree/status/reports`} target='_blank' rel='noopener noreferrer'>monthly reports</a> go deeper.</p>

          <h2 className='sw-h2 sw-section'>Liquidity</h2>
          <div className='sw-card'>
            <Figures items={[
              { label: 'Openfields Swap', value: dex ? fmtUsd(tvl('terraswap')) : '…', sub: dex ? `${all.filter(p => p.venue === 'terraswap').length} pools` : undefined },
              { label: 'Astroport, listed tokens', value: venue ? fmtUsd(tvl('astroport')) : '…', sub: venue ? `${all.filter(p => p.venue === 'astroport').length} pools` : undefined },
            ]} />
          </div>
          {deep.length > 0 && (
            <div className='sw-list sw-gap'>
              {deep.map(p => (
                <Link key={p.contract_addr} href={`/pool/${p.contract_addr}`} prefetch={false} className='sw-item'>
                  <PairIcons a={p.tokens[0].label} b={p.tokens[1].label} size={24} />
                  <span className='sw-item-main'>
                    <span className='sw-item-title'><span>{p.label}</span></span>
                    <span className='sw-item-sub'>{VENUE_NAME[p.venue]}{p.pairType !== 'xyk' ? `, ${p.pairType}` : ''}</span>
                  </span>
                  <span className='sw-item-end'>{p.tvlUsd != null ? fmtUsd(p.tvlUsd) : '–'}<Fees pair={p.contract_addr} /></span>
                </Link>
              ))}
            </div>
          )}
          <p className='sw-fine sw-gap'>Valued at Astroport&apos;s deepest markets. Fees are what each pool&apos;s swaps paid its providers, less Astroport&apos;s maker share, at today&apos;s prices.</p>

          <h2 className='sw-h2 sw-section'>Liquid staking against the hubs</h2>
          <LstBoard />

          <h2 className='sw-h2 sw-section'>Pools off the market</h2>
          {!px && <p className='sw-status'>Reading the market…</p>}
          {px && gaps.length === 0 && <p className='sw-status'>Every Openfields Swap pool is within a few percent of the market right now.</p>}
          {gaps.length > 0 && (
            <div className='sw-list'>
              {gaps.map(g => (
                <Link key={g.pool.contract_addr} prefetch={false} className='sw-item' href={`/?from=${encodeURIComponent(g.inToken.key)}&to=${encodeURIComponent(g.outToken.key)}&amount=${g.inAmount.toFixed(6)}`}>
                  <span className='sw-item-main'>
                    <span className='sw-item-title'><span>{g.pool.label}</span><span className='sw-tag is-warn'>{g.off.toFixed(g.off >= 10 ? 0 : 2)}× off</span></span>
                    <span className='sw-item-sub'>{fmtAmount(g.inAmount)} {g.inToken.label} for {fmtAmount(g.outAmount)} {g.outToken.label}, about {fmtUsd(g.profitUsd)} over the market</span>
                  </span>
                  <Icon name='chevronRight' size={16} />
                </Link>
              ))}
            </div>
          )}

          <h2 className='sw-h2 sw-section'>Openfields Swap&apos;s router, last 30 days</h2>
          {!stats && <p className='sw-status'>{statsFailed ? 'The chain did not answer in time. Try again in a moment.' : 'Reading 30 days of transactions…'}</p>}
          {r && r.read === false && <p className='sw-status'>The chain&apos;s transaction history did not answer in time. Reload in a minute.</p>}
          {r && t && r.read !== false && (
            <div className='sw-card'>
              <Figures items={[
                { label: 'Swaps', value: String(r.swaps), sub: `${r.wallets} wallet${r.wallets === 1 ? '' : 's'}${r.complete ? '' : `, last ${ago(r.since)}`}` },
                { label: 'Volume', value: fmtUsd(r.volumeUsd), sub: r.unpriced ? `${r.unpriced} unpriced` : 'at today’s prices' },
                { label: 'Arrived swapped', value: String(r.arrivals), sub: 'over IBC' },
                { label: 'Routing added', value: t.avgGainPct != null ? signed(t.avgGainPct) : '–', sub: `${t.improved} of ${t.swaps} tagged swaps${t.extraUsd > 0 ? `, ${fmtUsd(t.extraUsd)} more delivered` : ''}` },
              ]} />
              {t.vsQuotePct != null && <p className='sw-fine sw-gap'>What arrived against the quote, on average: <span className={t.vsQuotePct >= -0.05 ? 'sw-pos' : 'sw-warn'}>{signed(t.vsQuotePct)}</span></p>}
            </div>
          )}
          {stats && stats.benchmark.length > 0 && (
            <>
              <h3 className='sw-label sw-gap'>Priced now, three ways</h3>
              <div className='sw-list'>
                {stats.benchmark.map(b => (
                  <div key={b.trade} className='sw-item' title={b.route}>
                    <span className='sw-item-main'>
                      <span className='sw-item-title'><span>{b.trade}</span></span>
                      <span className='sw-item-sub'>One pool {b.onePool ?? '–'} · up to two {b.twoPools ?? '–'}</span>
                    </span>
                    <span className='sw-item-end'>{b.site}<small className={b.vsTwoPct != null && b.vsTwoPct >= 0.005 ? 'sw-pos' : undefined}>{b.vsTwoPct != null ? (Math.abs(b.vsTwoPct) < 0.005 ? 'no gain' : signed(b.vsTwoPct)) : '–'}</small></span>
                  </div>
                ))}
              </div>
              <p className='sw-fine sw-gap'>Before the network fee, pool fees included, at 1% slippage.</p>
            </>
          )}

          <h2 className='sw-h2 sw-section'>Uptime</h2>
          {!stats && <p className='sw-status'>…</p>}
          {stats && !stats.uptime && <p className='sw-status'>This month&apos;s log could not be read.</p>}
          {stats?.uptime && (
            <div className='sw-card'>
              <Figures items={stats.uptime.sites.map(s => ({ label: s.site, value: `${s.pct.toFixed(s.pct === 100 ? 0 : 2)}%`, sub: `${s.up} of ${s.checks} checks in ${stats.uptime!.month}` }))} />
            </div>
          )}
          <p className='sw-fine sw-gap'>Checked every ten minutes from GitHub&apos;s machines: up means the page loads and its data is live. The log is on the <a className='sw-link' href={`${REPO}/tree/status/uptime`} target='_blank' rel='noopener noreferrer'>status branch</a>.</p>
        </article>
      </AppShell>
    </>
  )
}
