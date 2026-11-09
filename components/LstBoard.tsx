/**
 * Liquid staking tokens against their hubs (/api/lst, lib/lstBoard): what the
 * best route through either site's pools pays for selling ampLUNA or bLUNA,
 * beside redeeming at the hub's rate after unbonding, and what it gets for
 * buying, beside minting at the hub. In Pools and on /stats.
 */

import Link from 'next/link'
import { Fragment, useEffect, useState } from 'react'
import type { LstResponse } from 'lib/api/lst'
import type { LstSide } from 'lib/lstBoard'
import { poll } from 'lib/pageActive'

const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const dollars = (n: number) => `$${n.toLocaleString('en-US')}`
/** Past this, the size is simply too big for the pools: the figure measures how thin they are, not the hub. */
const THIN_PCT = 10

export default function LstBoard({ onTrade }: {
  /** Open the swap box on this trade. Without it the board links to the swap page instead. */
  onTrade?: (fromId: string, toId: string, amount: string) => void
}) {
  const [data, setData] = useState<LstResponse | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const pull = () => fetch('/api/lst')
      .then(r => (r.ok ? r.json() : null))
      .then((j: LstResponse | null) => { if (!alive) return; if (j?.rows?.length) { setData(j); setFailed(false) } else if (!data) setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
    // As often as the board is rebuilt (lib/scanPlan), and only while someone is looking.
    const stop = poll(pull, 300_000)
    return () => { alive = false; stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const action = (fromId: string, toId: string, fromKey: string, toKey: string, side: LstSide) => (
    onTrade
      ? <button type='button' className='of-btn of-btn--quiet of-btn--sm' onClick={() => onTrade(fromId, toId, side.amount)}>Swap</button>
      : <Link prefetch={false} className='of-btn of-btn--quiet of-btn--sm' href={`/?from=${encodeURIComponent(fromKey)}&to=${encodeURIComponent(toKey)}&amount=${side.amount}`}>Swap</Link>
  )
  const against = (v: number, good: boolean, text: string, thin: string) => Math.abs(v) > THIN_PCT
    ? <span className='sw-item-sub'>{thin} ({signed(v)})</span>
    : <span className={`sw-item-sub ${good ? 'sw-pos' : 'sw-warn'}`}>{signed(v)} {text}</span>

  if (!data) return <p className='sw-status'>{failed ? 'The hubs did not answer. Try again in a moment.' : 'Pricing both ways through every site…'}</p>
  return (
    <div className='sw-stack'>
      {data.rows.map(row => {
        const days = `${Math.round(row.unbondDays)} to ${Math.round(row.unbondDays + row.epochDays)} days`
        return (
          <div key={row.key} className='sw-list'>
            <div className='sw-item'>
              <span className='sw-item-main'>
                <span className='sw-item-title'>{row.key}</span>
                <span className='sw-item-sub'>1 {row.key} = {row.rate.toFixed(4)} LUNA at {row.provider}&apos;s hub · redeeming takes about {days}</span>
              </span>
            </div>
            {row.sizes.map(s => (
              <Fragment key={s.usd}>
                {!s.sell && !s.buy && <p className='sw-item sw-fine'>{dollars(s.usd)}: the pools could not be priced just now.</p>}
                {s.sell && (
                  <div className='sw-item' title={s.sell.route}>
                    <span className='sw-item-main'>
                      <span className='sw-item-title'>Sell {dollars(s.usd)} <span className='sw-tag'>{s.sell.rate.toFixed(4)} LUNA each</span></span>
                      {against(s.sell.vsHubPct, s.sell.vsHubPct >= -0.05, s.sell.vsHubPct < -0.05 ? `against redeeming at ${row.provider}` : 'against the hub rate', `The pools are too thin for this size; redeeming at ${row.provider} pays the rate`)}
                    </span>
                    {action(row.token, 'uluna', row.key, 'LUNA', s.sell)}
                  </div>
                )}
                {s.buy && (
                  <div className='sw-item' title={s.buy.route}>
                    <span className='sw-item-main'>
                      <span className='sw-item-title'>Buy {dollars(s.usd)} <span className='sw-tag'>{s.buy.rate.toFixed(4)} {row.key} per LUNA</span></span>
                      {against(s.buy.vsHubPct, s.buy.vsHubPct > 0.05, `against minting at ${row.provider}`, `The pools are too thin for this size; minting at ${row.provider} pays the rate`)}
                    </span>
                    {action('uluna', row.token, 'LUNA', row.key, s.buy)}
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )
      })}
      <p className='sw-fine'>
        Priced {new Date(data.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. Pool fees included, gas not. Negative on selling: redeeming at the hub pays more, after unbonding. Positive on buying: the pool gives more than minting. Today&apos;s numbers, not a forecast.
      </p>
    </div>
  )
}
