/**
 * Closing a gap, done properly: buy the cheap side in the drifted pool and sell
 * it straight back through the best path elsewhere, in one transaction, ending
 * in the token it started with. Offered only when even the worst case, every
 * leg slipping to its limit, ends ahead. First come: the gap moves on every trade.
 */

import { useEffect, useRef, useState } from 'react'
import { Button, Icon, IconButton } from 'components/ui'
import useMyAddress from 'components/hooks/useMyAddress'
import { useRouteSwap } from 'components/transactions/useDex'
import { VENUE_NAME, type PoolView } from 'lib/dex'
import type { ArbPlan } from 'lib/arb'
import { planRoute, quoteLoop, type Loop } from 'lib/route'
import { SCAN_TX } from 'lib/products'
import { ActionButton, amt, ErrorNote, failureOf, Row, type Failure } from './common'

const LOOP_SLIP = 0.005

export default function LoopCard({ plan, pools, onClose, onOneSided, onDone }: {
  plan: ArbPlan; pools: PoolView[]; onClose: () => void; onOneSided: (p: ArbPlan) => void; onDone: () => void
}) {
  const me = useMyAddress()
  const run = useRouteSwap()
  const poolsRef = useRef(pools)
  poolsRef.current = pools
  const [loop, setLoop] = useState<Loop | null | undefined>(undefined)
  const [err, setErr] = useState<Failure | null>(null)
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setLoop(undefined); setErr(null); setDone(null)
    quoteLoop(poolsRef.current, plan.pool, plan.inToken, plan.inMicro, LOOP_SLIP)
      .then(l => { if (alive) setLoop(l) })
      .catch(() => { if (alive) setLoop(null) })
    return () => { alive = false }
  }, [plan])
  const start = plan.inToken
  const a = (m: string) => amt(m, start.decimals, 6)
  const go = async () => {
    if (!loop || !me) return
    setErr(null)
    try {
      const r = await run.mutateAsync({ plan: planRoute(loop.quote, LOOP_SLIP), maxSpread: LOOP_SLIP, sender: me, memo: 'close a gap' })
      setDone((r as { transactionHash?: string })?.transactionHash ?? 'ok')
      onDone()
    } catch (e) { setErr(failureOf(e)) }
  }
  return (
    <section className='sw-page sw-narrow sw-loop' aria-labelledby='sw-loop-title'>
      <div className='sw-card'>
        <div className='sw-card-head'>
          <div>
            <h2 id='sw-loop-title' className='sw-card-title'>Close the gap</h2>
            <p className='sw-card-sub'>{plan.pool.label} is {plan.off.toFixed(2)}× off the market.</p>
          </div>
          <IconButton icon='close' label='Close' onClick={onClose} />
        </div>
        {loop === undefined && <p className='sw-status sw-gap'>Pricing the way back through every site…</p>}
        {loop === null && (
          <div className='sw-gap sw-stack'>
            <p className='sw-status'>No round trip pays right now: selling back elsewhere costs more than the gap is worth.</p>
            <Button onClick={() => onOneSided(plan)}>Trade one side instead</Button>
          </div>
        )}
        {loop && (
          <div className='sw-gap sw-stack'>
            <dl className='sw-rows'>
              {loop.quote.legs.map((l, i) => (
                <Row key={i} k={`${i + 1}. ${l.offer.label} to ${l.ask.label}`} v={`on ${VENUE_NAME[l.pool.venue]}${l.pool.contract_addr === plan.pool.contract_addr ? ', the drifted pool' : ''}`} tone='muted' />
              ))}
              <Row k='You put in' v={`${a(loop.inMicro)} ${start.label}`} />
              <Row k='Expected back' v={`${a(loop.expectedOutMicro)} ${start.label}`} />
              <Row k={`At worst, ${LOOP_SLIP * 100}% slippage`} v={`${a(loop.worstOutMicro)} ${start.label}, +${a(loop.worstGainMicro)}`} tone='good' />
            </dl>
            <p className='sw-fine'>One transaction, before the network fee. If any leg would land past its limit, all of it reverts. Someone else can close it first.</p>
            <ErrorNote error={err} />
            {done
              ? <p className='sw-ok'><Icon name='check' size={16} />Closed.{done !== 'ok' && <a href={SCAN_TX(done)} target='_blank' rel='noopener noreferrer'>View transaction</a>}</p>
              : <ActionButton me={me} label={run.isLoading ? 'Confirm in your wallet' : 'Close it'} onClick={go} busy={run.isLoading} />}
          </div>
        )}
      </div>
    </section>
  )
}
