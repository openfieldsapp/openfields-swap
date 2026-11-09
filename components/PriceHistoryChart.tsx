/**
 * A price over time from the site's own record (lib/priceHistory,
 * /api/price-history): a token's dollar price, or a pool's own price drawn
 * over the market for the same pair, so a pool that drifts shows as two lines
 * parting. Ranges from a day to ninety, a crosshair that reads any point, and
 * a plain empty state while the record is young.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtPrice } from 'components/swap/common'
import type { Point, Range, Series } from 'lib/priceHistory'

const RANGES: Range[] = ['1d', '7d', '30d', '90d']
const W = 640, H = 190, PAD_Y = 10

const when = (ms: number, range: Range) => new Date(ms).toLocaleString('en-GB', range === '1d'
  ? { hour: '2-digit', minute: '2-digit' }
  : { day: 'numeric', month: 'short', ...(range === '7d' ? { hour: '2-digit', minute: '2-digit' } : {}) })

export default function PriceHistoryChart({ query, unit, marketName = 'Market' }: {
  /** "token=LUNA", or "pool=terra1…&base=LUNA&quote=USDC" */
  query: string
  /** '$' for dollars, otherwise the quote token's label */
  unit: string
  marketName?: string
}) {
  const [range, setRange] = useState<Range>('7d')
  const [data, setData] = useState<Series | null>(null)
  const [failed, setFailed] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setFailed(false)
    fetch(`/api/price-history?${query}&range=${range}`)
      .then(r => (r.ok ? r.json() : null))
      .then((j: Series | null) => { if (!alive) return; if (j) setData(j); else setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [query, range])

  const points = useMemo(() => data?.points ?? [], [data])
  const market = useMemo(() => data?.market ?? [], [data])
  const scale = useMemo(() => {
    const all = [...points, ...market]
    if (all.length < 2) return null
    const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0]))
    let lo = Math.min(...all.map(p => p[1])), hi = Math.max(...all.map(p => p[1]))
    if (hi === lo) { lo *= 0.99; hi *= 1.01 }
    const pad = (hi - lo) * 0.06
    lo -= pad; hi += pad
    return {
      x: (t: number) => (t1 > t0 ? ((t - t0) / (t1 - t0)) * W : W / 2),
      y: (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (H - PAD_Y * 2),
      t0, t1,
    }
  }, [points, market])

  /** A path that lifts the pen across a gap longer than three steps, so a pause in recording is not drawn as a flat line. */
  const pathOf = (pts: Point[]) => {
    if (!scale || pts.length < 2) return ''
    const steps = pts.slice(1).map((p, i) => p[0] - pts[i][0]).sort((a, b) => a - b)
    const typical = steps[Math.floor(steps.length / 2)] || 1
    return pts.map((p, i) => `${i === 0 || p[0] - pts[i - 1][0] > typical * 3 ? 'M' : 'L'}${scale.x(p[0]).toFixed(1)},${scale.y(p[1]).toFixed(1)}`).join(' ')
  }

  const first = points[0]?.[1], last = points[points.length - 1]?.[1]
  const change = points.length >= 2 && first && last ? (last / first - 1) * 100 : null
  const up = (change ?? 0) >= 0
  const tone = change == null ? '' : up ? 'sw-pos' : 'sw-neg'
  const fmtNum = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString('en-US') : fmtPrice(n))
  const show = (v: number) => (unit === '$' ? `$${fmtNum(v)}` : `${fmtNum(v)} ${unit}`)
  const nearest = (pts: Point[], t: number) => pts.reduce<Point | null>((b, p) => (!b || Math.abs(p[0] - t) < Math.abs(b[0] - t) ? p : b), null)
  const hp = hover != null && scale ? nearest(points.length ? points : market, scale.t0 + (hover / W) * (scale.t1 - scale.t0)) : null
  const hm = hp && market.length ? nearest(market, hp[0]) : null

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect()
    if (!r || !r.width) return
    setHover(Math.max(0, Math.min(W, ((e.clientX - r.left) / r.width) * W)))
  }

  return (
    <div className='sw-history'>
      <div className='sw-chart-head'>
        <div>
          <span className='sw-chart-price'>{hp ? show(hp[1]) : last ? show(last) : '–'}</span>{' '}
          {!hp && change != null && <span className={`sw-chart-change ${tone}`}>{up ? '+' : ''}{change.toFixed(2)}%</span>}
          {hp && <span className='sw-fine'>{new Date(hp[0]).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{hm ? `, ${marketName.toLowerCase()} ${show(hm[1])}` : ''}</span>}
        </div>
        <div className='of-seg sw-ranges' role='radiogroup' aria-label='Range'>
          {RANGES.map(r => <button key={r} type='button' role='radio' aria-checked={range === r} onClick={() => setRange(r)}>{r.toUpperCase()}</button>)}
        </div>
      </div>
      {scale ? (
        <div ref={box} className='sw-history-plot' onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' role='img' aria-label={`Price over ${range}`}>
            {market.length > 1 && <path className='sw-svg-faint' d={pathOf(market)} fill='none' strokeWidth='1.5' strokeDasharray='4 4' vectorEffect='non-scaling-stroke' />}
            {points.length > 1 && <path className={tone || 'sw-svg-line'} stroke='currentColor' d={pathOf(points)} fill='none' strokeWidth='1.75' vectorEffect='non-scaling-stroke' strokeLinejoin='round' strokeLinecap='round' />}
            {hp && <line className='sw-svg-grid' x1={scale.x(hp[0])} x2={scale.x(hp[0])} y1={0} y2={H} strokeWidth='1' vectorEffect='non-scaling-stroke' />}
            {hp && <circle className={tone || 'sw-svg-line'} fill='currentColor' cx={scale.x(hp[0])} cy={scale.y(hp[1])} r='3.5' vectorEffect='non-scaling-stroke' />}
          </svg>
          <div className='sw-axis'>
            <span>{when(scale.t0, range)}</span>
            {market.length > 1 && <span>solid: this pool · dashed: {marketName.toLowerCase()}</span>}
            <span>{when(scale.t1, range)}</span>
          </div>
        </div>
      ) : (
        <p className='sw-status sw-history-empty'>
          {failed
            ? 'The price record did not answer. Try again in a moment.'
            : !data
              ? 'Reading the price record…'
              : data.since
                ? `Recorded every ten minutes since ${new Date(`${data.since}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. This range fills in as it goes.`
                : 'Prices are recorded every ten minutes from the first recording on, so the chart starts empty.'}
        </p>
      )}
    </div>
  )
}
