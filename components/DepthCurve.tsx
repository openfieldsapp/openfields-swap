/**
 * Price impact against trade size (lib/depth): the ladder drawn on a log
 * scale of dollars, lines at 0.5%, 1% and 2%, and where an amount sits on it.
 */

import type { Depth, DepthMark } from 'lib/depth'

const W = 320, H = 96

const usd = (n: number) => (n >= 10_000 ? `$${Math.round(n / 1000).toLocaleString('en-US')}k` : n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`)

/** "about $4.8k", "under $50", "over $250k" */
export function markText(m: DepthMark, last: number): string {
  if (m.usd == null) return `over ${usd(last)}`
  return m.below ? `under ${usd(Math.max(m.usd, 1))}` : `about ${usd(m.usd)}`
}

export function markLine(d: Depth): string {
  const last = d.points[d.points.length - 1]?.usd ?? 0
  return d.marks.map(m => `${m.pct}% ${markText(m, last)}`).join(' · ')
}

export default function DepthCurve({ depth, atUsd, height = H }: { depth: Depth; atUsd?: number | null; height?: number }) {
  const pts = depth.points
  if (pts.length < 2) return null
  const minX = Math.log10(pts[0].usd), maxX = Math.log10(pts[pts.length - 1].usd)
  const top = Math.max(2.5, Math.min(6, Math.max(...pts.map(p => p.impactPct)) * 1.1))
  const x = (v: number) => ((Math.log10(Math.max(v, pts[0].usd)) - minX) / (maxX - minX || 1)) * W
  const y = (pct: number) => H - 6 - (Math.min(pct, top) / top) * (H - 14)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.usd).toFixed(1)},${y(p.impactPct).toFixed(1)}`).join(' ')
  const at = atUsd && atUsd > 0 ? Math.min(Math.max(atUsd, pts[0].usd), pts[pts.length - 1].usd) : null
  return (
    <div className='sw-depth'>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' height={height} role='img' aria-label={`Price impact by size: ${markLine(depth)}`}>
        {[0.5, 1, 2].filter(p => p <= top).map(p => (
          <g key={p}>
            <line className='sw-svg-grid' x1={0} x2={W} y1={y(p)} y2={y(p)} strokeWidth='1' vectorEffect='non-scaling-stroke' />
            <text className='sw-svg-text' x={W - 2} y={y(p) - 2} textAnchor='end' fontSize='8'>{p}%</text>
          </g>
        ))}
        <path className='sw-svg-line' d={d} fill='none' strokeWidth='1.75' vectorEffect='non-scaling-stroke' strokeLinejoin='round' />
        {at != null && <line className='sw-svg-mark' x1={x(at)} x2={x(at)} y1={0} y2={H} strokeWidth='1' strokeDasharray='3 3' vectorEffect='non-scaling-stroke' />}
      </svg>
      <div className='sw-axis'>
        <span>{usd(pts[0].usd)}</span>
        {at != null && <span>this amount</span>}
        <span>{usd(pts[pts.length - 1].usd)}</span>
      </div>
    </div>
  )
}
