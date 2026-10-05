/**
 * OHLC candlesticks with a volume histogram for one pool, from the site's own
 * record (/api/dex-candles, lib/priceHistory). TradingView's lightweight-charts
 * draws it, the same library Astroport and Coinhall use. Price is quote per
 * base; volume is in the quote token. The record fills in over time, so a young
 * chart is sparse and says so.
 */

import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType, CrosshairMode, type IChartApi, type UTCTimestamp } from 'lightweight-charts'
import { fmtPrice } from 'components/swap/common'
import { CANDLE_INTERVALS, type CandleInterval } from 'lib/priceHistory'
import type { CandlesResponse } from 'lib/api/dex-candles'

const LABEL: Record<CandleInterval, string> = { '1h': '1H', '4h': '4H', '1d': '1D' }

/** The canvas cannot read CSS variables, so the design system's colours are read from the page once it is drawn. */
function tokens() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return { text: v('--fg-3'), line: v('--line'), line2: v('--line-2'), surface: v('--bg-2'), up: v('--positive'), down: v('--negative') }
}
/** The same colour, see-through: volume bars sit under the candles. */
const faded = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}80` : hex)

export default function CandleChart({ pair, base, quote }: { pair: string; base: string; quote: string }) {
  const [interval, setInterval] = useState<CandleInterval>('1h')
  const [data, setData] = useState<CandlesResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    let alive = true
    setFailed(false)
    fetch(`/api/dex-candles?pair=${pair}&interval=${interval}`)
      .then(r => (r.ok ? r.json() : null))
      .then((j: CandlesResponse | null) => { if (!alive) return; if (j) setData(j); else setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [pair, interval])

  useEffect(() => {
    const el = box.current
    if (!el || !data) return
    const C = tokens()
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 300,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: C.text, fontFamily: 'inherit', fontSize: 11 },
      grid: { vertLines: { color: C.line }, horzLines: { color: C.line } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: C.text, labelBackgroundColor: C.surface }, horzLine: { color: C.text, labelBackgroundColor: C.surface } },
      rightPriceScale: { borderColor: C.line2 },
      timeScale: { borderColor: C.line2, timeVisible: interval !== '1d', secondsVisible: false },
      handleScale: { axisPressedMouseMove: false },
    })
    chartRef.current = chart
    const candleSeries = chart.addCandlestickSeries({
      upColor: C.up, downColor: C.down, wickUpColor: C.up, wickDownColor: C.down, borderVisible: false,
    })
    candleSeries.setData(data.candles.map(c => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })))
    const volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    volSeries.setData(data.candles.filter(c => c.v > 0).map(c => ({ time: c.t as UTCTimestamp, value: c.v, color: faded(c.c >= c.o ? C.up : C.down) })))
    chart.timeScale().fitContent()

    const onResize = () => chart.applyOptions({ width: el.clientWidth })
    const ro = new ResizeObserver(onResize)
    ro.observe(el)
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
  }, [data, interval])

  const candles = data?.candles ?? []
  const last = candles[candles.length - 1]
  const first = candles[0]
  const change = last && first && first.o > 0 ? (last.c - first.o) / first.o : null

  return (
    <div className='sw-history'>
      <div className='sw-chart-head'>
        <div>
          <span className='sw-fine'>{base} / {quote}</span>{' '}
          {last && <span className='of-num'>{fmtPrice(last.c)} {quote}</span>}{' '}
          {change != null && <span className={`sw-chart-change ${change >= 0 ? 'sw-pos' : 'sw-neg'}`}>{change >= 0 ? '+' : ''}{(change * 100).toFixed(2)}%</span>}
        </div>
        <div className='of-seg sw-ranges' role='radiogroup' aria-label='Interval'>
          {CANDLE_INTERVALS.map(iv => <button key={iv} type='button' role='radio' aria-checked={interval === iv} onClick={() => setInterval(iv)}>{LABEL[iv]}</button>)}
        </div>
      </div>
      <div ref={box} className='sw-candles' />
      {failed && <p className='sw-status'>The chart is not available right now.</p>}
      {!failed && candles.length === 0 && (
        <p className='sw-fine'>No candles yet. The chart is drawn from this site&apos;s own record, which fills in every ten minutes{data?.since ? ` since ${data.since}` : ''}; a pool that trades rarely stays sparse.</p>
      )}
      {!failed && candles.length > 0 && (
        <p className='sw-fine'>From this site&apos;s own record, read from the chain every ten minutes{data?.since ? ` since ${data.since}` : ''}. Volume is in {quote}.</p>
      )}
    </div>
  )
}
