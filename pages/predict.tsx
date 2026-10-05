/**
 * Openfields Predict — served at /predict.
 *
 * Yes or no on a price, settled by the chain itself. Parimutuel: winners
 * split the losing pool. The answer is a time-weighted average price read
 * from an Astroport pair by whoever shows up to read it; no oracle, no
 * operator, no admin. Renders "not live yet" until NEXT_PUBLIC_PREDICT_CONTRACT
 * is set.
 */

import Head from 'next/head'
import type { GetStaticProps } from 'next'
import { useCallback, useEffect, useMemo, useState } from 'react'
import useMyAddress from 'components/hooks/useMyAddress'
import AppShell from 'components/shell/AppShell'
import { Button, Icon } from 'components/ui'
import { ActionButton, Empty, ErrorNote, failureOf, Row, Toast, type Failure } from 'components/swap/common'
import { fromMicro, toMicro, queryNativeBalance } from 'lib/dex'
import {
  LUNA, USDC, LUNA_USDC_PAIR, MIN_LEAD_SECONDS,
  canVoid, fmtCountdown, fmtPrice, fmtWindow, impliedYes, payoutMultiple, phaseOf, secs,
  queryClaimable, queryPosition,
  type Market, type Phase, type Position, type Claimable, type Side,
} from 'lib/predict'
import type { PredictResponse } from 'lib/api/predict'
import { useBet, useClaim, useCreateMarket, useObserve, useResolve, useVoidMarket } from 'components/transactions/usePredict'
import { poll } from 'lib/pageActive'
import { SITE_URL } from 'lib/siteUrl'

const denomLabel = (d: string) => (d === 'uluna' ? 'LUNA' : d.startsWith('ibc/') ? 'USDC' : d.split('/').pop() ?? d)
const amt = (micro: string, d = 6, frac = 2) => fromMicro(micro, d, frac)

// ─── one market ─────────────────────────────────────────────────────────

interface CardProps {
  m: Market; now: number; spot?: number; twapNow?: string | null
  me: string; pos?: Position; claimable?: Claimable; feeBps: number; bountyBps: number
  balance: string; onDone: () => void; onToast: (s: string) => void
}

function MarketCard({ m, now, spot, twapNow, me, pos, claimable, feeBps, bountyBps, balance, onDone, onToast }: CardProps) {
  const phase: Phase = phaseOf(m, now)
  const voidable = canVoid(m, now)
  const yes = impliedYes(m)
  const close = secs(m.close_at), resolve = secs(m.resolve_at)
  const windowStart = resolve - m.twap_window
  const den = denomLabel(m.denom)
  const [amount, setAmount] = useState('')
  const [err, setErr] = useState<Failure | null>(null)
  const bet = useBet(), observe = useObserve(), settle = useResolve(), voidTx = useVoidMarket(), claim = useClaim()
  const busy = bet.isLoading || observe.isLoading || settle.isLoading || voidTx.isLoading || claim.isLoading

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setErr(null)
    try { await fn(); onToast(done); setAmount(''); setTimeout(onDone, 2500) } catch (e) { setErr(failureOf(e)) }
  }
  const place = (side: Side) => {
    const micro = toMicro(amount, 6)
    if (!micro || micro === '0') return setErr({ text: 'Enter an amount.' })
    if (BigInt(micro) < BigInt(m.min_bet)) return setErr({ text: `The minimum is ${amt(m.min_bet)} ${den}.` })
    if (BigInt(micro) > BigInt(balance || '0')) return setErr({ text: 'Not enough balance.' })
    return run(() => bet.mutateAsync({ sender: me, marketId: m.id, side, denom: m.denom, amountMicro: micro }), `${side === 'yes' ? 'Yes' : 'No'} placed.`)
  }

  const outcome = m.resolution?.outcome
  const status: { text: string; tone?: 'good' | 'warn' | 'bad' | 'muted' } = (() => {
    switch (phase) {
      case 'open': return { text: `Open, closes in ${fmtCountdown(close, now)}`, tone: 'good' as const }
      case 'waiting': return { text: `Closed, the window opens in ${fmtCountdown(windowStart, now)}`, tone: 'muted' as const }
      case 'observe': return { text: `Window open, needs an observer (${fmtCountdown(windowStart + Math.floor(m.twap_window / 2), now)} left)`, tone: 'warn' as const }
      case 'missed': return { text: `Nobody observed; settles void at ${new Date(resolve * 1000).toLocaleString()} and refunds`, tone: 'bad' as const }
      case 'averaging': return { text: `Averaging, ${fmtPrice(twapNow)} so far, settles in ${fmtCountdown(resolve, now)}` }
      case 'resolve': return { text: m.observation ? 'Ready to settle' : 'Ready to settle as void, with refunds', tone: 'warn' as const }
      case 'resolved': return outcome === 'void'
        ? { text: 'Void, every stake refundable', tone: 'muted' as const }
        : { text: `${outcome === 'yes' ? 'Yes' : 'No'}, settled at ${fmtPrice(m.resolution!.twap)}`, tone: outcome === 'yes' ? 'good' as const : 'bad' as const }
    }
  })()

  const myYes = Number(pos?.yes ?? 0), myNo = Number(pos?.no ?? 0)
  const claimableAmt = Number(claimable?.amount ?? 0)
  const pays = (side: Side) => { const x = payoutMultiple(m, side); return x && Number.isFinite(x) ? `, pays ${x.toFixed(2)}×` : '' }

  return (
    <article className='sw-card'>
      <h2 className='sw-card-title'>{m.question}</h2>
      <p className='sw-card-sub'>Yes if the {fmtWindow(m.twap_window)} average is at least {fmtPrice(m.threshold)}. Now {fmtPrice(spot)}.</p>
      <dl className='sw-rows sw-gap'>
        <Row k='Status' v={status.text} tone={status.tone} />
        <Row k='Yes' v={`${amt(m.yes_total)} ${den}${yes != null ? `, ${Math.round(yes * 100)}%` : ''}`} />
        <Row k='No' v={`${amt(m.no_total)} ${den}${yes != null ? `, ${Math.round((1 - yes) * 100)}%` : ''}`} />
        {(myYes > 0 || myNo > 0) && <Row k='Yours' tone='strong' v={[myYes > 0 && `${amt(String(myYes))} ${den} on yes`, myNo > 0 && `${amt(String(myNo))} ${den} on no`].filter(Boolean).join(' · ')} />}
        {yes == null && <p className='sw-fine'>Empty. The first stake sets the odds.</p>}
      </dl>

      <div className='sw-act'>
        {phase === 'open' && (me ? (
          <>
            <input className='sw-input' type='number' inputMode='decimal' min='0' step='any' placeholder={`${amt(m.min_bet)} ${den} or more`} aria-label={`Stake in ${den}`} value={amount} onChange={e => setAmount(e.target.value)} />
            <div className='sw-pair'>
              <Button size='lg' disabled={busy} onClick={() => place('yes')}>Yes{pays('yes')}</Button>
              <Button size='lg' disabled={busy} onClick={() => place('no')}>No{pays('no')}</Button>
            </div>
            <p className='sw-fine'>Balance {amt(balance)} {den}. Payouts at today&apos;s pools, before the {feeBps / 100}% fee and {bountyBps / 100}% bounty taken from the losing side.</p>
          </>
        ) : <ActionButton me={me} label='' onClick={() => {}} />)}

        {phase === 'observe' && <ActionButton me={me} busy={busy} onClick={() => run(() => observe.mutateAsync({ sender: me, marketId: m.id }), 'Observed. Half the bounty is yours at settlement.')} label='Observe the window, for half the bounty' />}
        {phase === 'resolve' && <ActionButton me={me} busy={busy} onClick={() => run(() => settle.mutateAsync({ sender: me, marketId: m.id }), 'Settled by the chain.')} label={m.observation ? 'Settle, for half the bounty' : 'Settle as void, refunding everyone'} />}
        {voidable && me && <Button variant='quiet' disabled={busy} onClick={() => run(() => voidTx.mutateAsync({ sender: me, marketId: m.id }), 'Voided. Stakes are refundable.')}>Void it, unresolved for a week</Button>}

        {phase === 'resolved' && me && (claimableAmt > 0
          ? <Button variant='primary' size='lg' block busy={busy} onClick={() => run(() => claim.mutateAsync({ sender: me, marketId: m.id }), 'Claimed.')}>Claim {amt(String(claimableAmt))} {den}</Button>
          : claimable?.claimed
            ? <p className='sw-ok'><Icon name='check' size={16} />Claimed</p>
            : (myYes > 0 || myNo > 0) ? <p className='sw-status'>Not this time.</p> : null)}
        <ErrorNote error={err} />
      </div>
    </article>
  )
}

// ─── open a market ──────────────────────────────────────────────────────

const CLOSE_OPTIONS = [['1h', 3600], ['6h', 21_600], ['24h', 86_400], ['3d', 259_200], ['7d', 604_800]] as const
const WINDOW_OPTIONS = [['10 min', 600], ['1 hour', 3600], ['6 hours', 21_600], ['24 hours', 86_400]] as const

function CreatePanel({ me, spot, minWindow, onDone, onToast }: { me: string; spot?: number; minWindow: number; onDone: () => void; onToast: (s: string) => void }) {
  const [threshold, setThreshold] = useState(spot ? spot.toFixed(4) : '')
  const [closeIn, setCloseIn] = useState<number>(86_400)
  const [windowS, setWindowS] = useState<number>(3600)
  const [minBet, setMinBet] = useState('1')
  const [question, setQuestion] = useState('')
  const [err, setErr] = useState<Failure | null>(null)
  const create = useCreateMarket()
  useEffect(() => { if (!threshold && spot) setThreshold(spot.toFixed(4)) }, [spot, threshold])
  const autoQuestion = threshold ? `1 LUNA ≥ ${threshold} USDC?` : ''
  const q = question.trim() || autoQuestion

  const go = async () => {
    setErr(null)
    const t = Number(threshold)
    if (!(t > 0)) return setErr({ text: 'The threshold must be a positive price.' })
    if (windowS < minWindow) return setErr({ text: `The window must be at least ${fmtWindow(minWindow)}.` })
    const mb = toMicro(minBet || '1', 6)
    if (!mb || mb === '0') return setErr({ text: 'The minimum stake must be positive.' })
    if (!q) return setErr({ text: 'Write the question.' })
    const now = Math.floor(Date.now() / 1000)
    const closeAt = now + Math.max(closeIn, MIN_LEAD_SECONDS + 60)
    try {
      await create.mutateAsync({
        sender: me, question: q, pair: LUNA_USDC_PAIR, base: LUNA, quote: USDC, baseDecimals: 6, quoteDecimals: 6,
        threshold: threshold.trim(), denom: 'uluna', minBetMicro: mb, closeAt, resolveAt: closeAt + windowS, twapWindow: windowS,
      })
      onToast('Market open.')
      setQuestion(''); setTimeout(onDone, 2500)
    } catch (e) { setErr(failureOf(e)) }
  }

  return (
    <div className='sw-card sw-stack'>
      <div>
        <h2 className='sw-card-title'>Open a market</h2>
        <p className='sw-card-sub'>Yes or no on the LUNA price in USDC, settled by the average on Astroport&apos;s LUNA/USDC pool over the window after betting closes.</p>
      </div>
      <div className='sw-form-grid'>
        <div><label className='sw-label' htmlFor='pr-threshold'>Yes if 1 LUNA is at least, in USDC</label><input id='pr-threshold' className='sw-input sw-input--sm' type='number' inputMode='decimal' min='0' step='any' value={threshold} onChange={e => setThreshold(e.target.value)} placeholder={spot ? spot.toFixed(4) : '0.05'} /></div>
        <div><label className='sw-label' htmlFor='pr-close'>Betting closes in</label>
          <span className='sw-select sw-select--block'><select id='pr-close' value={closeIn} onChange={e => setCloseIn(Number(e.target.value))}>{CLOSE_OPTIONS.map(([l, s]) => <option key={s} value={s}>{l}</option>)}</select><Icon name='chevronDown' size={14} /></span></div>
        <div><label className='sw-label' htmlFor='pr-window'>Averaging window</label>
          <span className='sw-select sw-select--block'><select id='pr-window' value={windowS} onChange={e => setWindowS(Number(e.target.value))}>{WINDOW_OPTIONS.filter(([, s]) => s >= minWindow).map(([l, s]) => <option key={s} value={s}>{l}</option>)}</select><Icon name='chevronDown' size={14} /></span></div>
        <div><label className='sw-label' htmlFor='pr-min'>Minimum stake, LUNA</label><input id='pr-min' className='sw-input sw-input--sm' type='number' inputMode='decimal' min='0' step='any' value={minBet} onChange={e => setMinBet(e.target.value)} /></div>
      </div>
      <div>
        <label className='sw-label' htmlFor='pr-question'>Question</label>
        <input id='pr-question' className='sw-input sw-input--sm' value={question} onChange={e => setQuestion(e.target.value)} placeholder={autoQuestion || 'Write it the way a friend would ask it'} maxLength={200} />
        <p className='sw-hint'>Settles {fmtWindow(windowS)} after betting closes. Now {fmtPrice(spot)}.</p>
      </div>
      <ErrorNote error={err} />
      <ActionButton me={me} busy={create.isLoading} onClick={go} label={create.isLoading ? 'Opening…' : 'Open the market'} />
    </div>
  )
}

// ─── page ───────────────────────────────────────────────────────────────

type Tab = 'live' | 'settled' | 'create'
const PHASE_RANK: Record<Phase, number> = { open: 0, observe: 1, resolve: 2, averaging: 3, waiting: 4, missed: 5, resolved: 6 }

function PredictPageInner() {
  const me = useMyAddress()
  const [data, setData] = useState<PredictResponse | null>(null)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [tab, setTab] = useState<Tab>('live')
  const [mine, setMine] = useState<Record<number, { pos: Position; claimable: Claimable }>>({})
  const [balance, setBalance] = useState('0')
  const [toast, setToast] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/predict', { cache: 'no-store' })
      if (r.ok) setData(await r.json())
    } catch { /* keep the last frame */ }
  }, [])
  useEffect(() => poll(() => { refresh() }, 15_000), [refresh])
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!me || !data?.live) { setMine({}); return }
    let alive = true
    ;(async () => {
      const rows = await Promise.all(data.markets.map(async m => {
        const [pos, claimable] = await Promise.all([queryPosition(m.id, me), queryClaimable(m.id, me)])
        return [m.id, pos, claimable] as const
      }))
      if (!alive) return
      const next: typeof mine = {}
      for (const [id, pos, cl] of rows) if (pos && cl) next[id] = { pos, claimable: cl }
      setMine(next)
      setBalance(await queryNativeBalance(me, 'uluna'))
    })()
    return () => { alive = false }
  }, [me, data])

  const showToast = (msg: string) => setToast(msg)
  const clearToast = useCallback(() => setToast(null), [])

  const sorted = useMemo(() => {
    if (!data) return []
    return [...data.markets].sort((a, b) => {
      const pa = PHASE_RANK[phaseOf(a, now)], pb = PHASE_RANK[phaseOf(b, now)]
      if (pa !== pb) return pa - pb
      return a.resolution && b.resolution ? secs(b.resolution.resolved_at) - secs(a.resolution.resolved_at) : secs(a.resolve_at) - secs(b.resolve_at)
    })
  }, [data, now])
  const live = sorted.filter(m => !m.resolution)
  const settled = sorted.filter(m => !!m.resolution)
  const spotLuna = data?.spot[LUNA_USDC_PAIR]
  const feeBps = data?.config?.fee_bps ?? 0, bountyBps = data?.config?.bounty_bps ?? 0
  const list = tab === 'live' ? live : settled

  return (
    <>
      <Head>
        <title>Openfields Predict</title>
      </Head>
      <AppShell page='predict'>
        <section className='sw-page sw-narrow' aria-labelledby='pr-title'>
          <h1 id='pr-title' className='sw-title'>Predict</h1>
          <p className='sw-lede'>Yes or no on the LUNA price, settled by the chain. Experimental.</p>
          {!data && <p className='sw-status sw-gap'><span className='of-spin' aria-hidden /> Reading the chain…</p>}
          {data && !data.live && <Empty title='Not live yet' />}
          {data?.live && (
            <>
              <div className='of-seg sw-gap sw-tabs' role='tablist' aria-label='Markets'>
                {([['live', `Live, ${live.length}`], ['settled', `Settled, ${settled.length}`], ['create', 'Open one']] as const).map(([k, text]) => (
                  <button key={k} type='button' role='tab' aria-selected={tab === k} onClick={() => setTab(k)}>{text}</button>
                ))}
              </div>
              <p className='sw-fine sw-gap'>LUNA {fmtPrice(spotLuna)} USDC now.</p>
              <div className='sw-stack sw-gap'>
                {tab === 'create' && <CreatePanel me={me} spot={spotLuna} minWindow={data.config?.min_window ?? 600} onDone={refresh} onToast={showToast} />}
                {tab !== 'create' && (list.length === 0
                  ? <Empty title={tab === 'live' ? 'No open markets' : 'Nothing settled yet'}>{tab === 'live' && <Button variant='primary' onClick={() => setTab('create')}>Open one</Button>}</Empty>
                  : list.map(m => (
                      <MarketCard key={m.id} m={m} now={now} spot={data.spot[m.pair]} twapNow={data.twap[m.id]?.twap ?? null} me={me}
                        pos={mine[m.id]?.pos} claimable={mine[m.id]?.claimable} feeBps={feeBps} bountyBps={bountyBps} balance={balance} onDone={refresh} onToast={showToast} />
                    )))}
              </div>
              <p className='sw-fine sw-section'>
                Parimutuel: winners split the losing pool. The {feeBps / 100}% fee and the {bountyBps / 100}% bounty come from the losing side only.
                The price is the time-weighted average on Astroport&apos;s pool over the window: half the bounty to the first observer, half to whoever settles.
                With no observer, the market is void and every stake is refundable. No admin can change any of this.
              </p>
            </>
          )}
        </section>
      </AppShell>
      {toast && <Toast msg={toast} onDone={clearToast} />}
    </>
  )
}

export default function PredictPage() {
  return <PredictPageInner />
}

/** Built with the site: nothing here changes between requests (per request before 2026-09-27, Vercel's Hobby plan). */
export const getStaticProps: GetStaticProps = async () => {
  const base = SITE_URL
  return ({
  props: {
    og: {
      title: 'Openfields Predict',
      image: `${base}/api/og/swap`,
      contract: '', token: '',
      description: 'Yes or no on the LUNA price, settled by the chain itself. Parimutuel, no oracle, no admin. Experimental.',
      url: `${base}/predict`,
      type: 'website',
    },
  },
})
}
