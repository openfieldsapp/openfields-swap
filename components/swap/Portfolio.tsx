/**
 * Portfolio: what the connected wallet holds in pools and in the wallet, and
 * what it did. Positions on every site with the ways out; the wallet's tokens,
 * selling small leftovers in one signature, sending, price alerts; and the
 * history read back from the chain, with a CSV for tax software.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { fromBech32 } from '@cosmjs/encoding'
import { Button, Icon, IconButton } from 'components/ui'
import { PairIcons, TokenIcon } from 'components/TokenIcon'
import useMyAddress from 'components/hooks/useMyAddress'
import { askToConnect, shortAddress } from 'components/wallet/connect'
import { useAstroLegacyExit, useClaimRewards, useExitPosition, useLstWithdraw, useStakeLp, useTerraMsgs, useUnstake } from 'components/transactions/useDex'
import {
  KNOWN_TOKENS, ASTRO_CONVERTER, ASTRO_CW20, ASTRO_STAKING, XASTRO_CW20, VENUE_INCENTIVES, VENUE_NAME, IS_ASTRO,
  assetId, fromMicro, queryBalance, resolveToken, sameAsset, toMicro, tokenFor, type KnownToken, type PoolView,
} from 'lib/dex'
import { fmtAmount, fmtUsd } from 'lib/arb'
import { routeMsgs, sendMsg } from 'lib/msgs'
import type { RoutePlan } from 'lib/route'
import { SWEEP_KEEP_LUNA_MICRO, SWEEP_MAX, planSweep, poolsFor, type SweepLine, type SweepPick } from 'lib/sweep'
import { LUNA } from 'lib/gasDrop'
import { lcdFetch } from 'lib/lcd'
import { historyCsv } from 'lib/csv'
import { removeContact, rememberRecipient, saveContact, useContacts } from 'lib/contacts'
import { disablePush, enablePush, usePush } from 'lib/push'
import { askNotifications, fmtUsdPrice, notificationsAllowed, removeAlert, usePrefs } from 'lib/alerts'
import type { PositionsResponse } from 'lib/api/positions'
import type { HistoryResponse } from 'lib/api/history'
import type { HistoryRow, Moved } from 'lib/history'
import type { LpFlow } from 'lib/dex-ledger'
import { SCAN_TX, TERRA_HOME_URL } from 'lib/products'
import { useLang } from 'lib/i18n'
import { PutInRows } from './Pools'
import { ActionButton, amt, balanceCache, Empty, ErrorNote, failureOf, Row, TokenSelect, useTokenData, walletBalances, type Failure } from './common'

export type PortfolioView = 'positions' | 'wallet' | 'history'

// ── Positions ────────────────────────────────────────────────────────

/**
 * Every pool position the connected wallet holds on Openfields Swap, Astroport
 * or Skeleton Swap, LP staked in Astroport's incentives contract included,
 * with the ways out. Nobody has to open another app to find or leave one.
 */
function Positions({ onDone, flows, again }: { onDone: () => void; flows?: Record<string, LpFlow>; again: number }) {
  const me = useMyAddress()
  const exit = useExitPosition()
  const unstake = useUnstake()
  const claim = useClaimRewards()
  const stake = useStakeLp()
  const astroExit = useAstroLegacyExit()
  const withdrawLst = useLstWithdraw()
  const { px: tokenPx } = useTokenData()
  const day = (s: number | null) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : 'soon')
  const [data, setData] = useState<PositionsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<Failure | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  useEffect(() => { if (again) setReload(again) }, [again])
  useEffect(() => {
    if (!me) { setData(null); return }
    let alive = true
    setLoading(true)
    fetch(`/api/positions?address=${me}${reload ? `&_=${reload}` : ''}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((j: PositionsResponse | null) => { if (alive && j?.positions) setData(j) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [me, reload])

  const run = async (key: string, f: () => Promise<unknown>, msg: string) => {
    setErr(null); setOk(null); setBusy(key)
    try {
      await f()
      setOk(msg); onDone()
      // The block lands in about 6 s and the endpoint indexes it a moment later.
      ;[5000, 11000].forEach(ms => setTimeout(() => setReload(Date.now()), ms))
    } catch (e) { setErr(failureOf(e)) } finally { setBusy(null) }
  }
  const label = (key: string, text: string) => (busy === key ? 'Confirm in your wallet' : text)

  const positions = data?.positions ?? []
  const incentives = data?.incentives ?? null
  const claimable = positions.filter(p => p.pending.length > 0)
  const ax = data?.astro && (data.astro.xastro !== '0' || data.astro.astroCw20 !== '0') ? data.astro : null
  const unstaking = data?.unstaking ?? []
  const nothing = !!data && positions.length === 0 && !ax && unstaking.length === 0

  if (loading && !data) return <p className='sw-status'><span className='of-spin' aria-hidden /> Reading your positions from the chain…</p>
  if (nothing) return <Empty title='No pool positions yet'><Link href='/?tab=pools' className='of-btn of-btn--secondary'>See the pools</Link></Empty>

  return (
    <div className='sw-stack'>
      {incentives && claimable.length > 0 && (
        <Button variant='primary' size='lg' block busy={busy === 'claim'} disabled={!!busy && busy !== 'claim'}
          onClick={() => run('claim', () => claim.mutateAsync({ incentives, lpTokens: claimable.map(p => p.pool.liquidity_token), sender: me }), 'Rewards claimed to your wallet.')}>
          {label('claim', `Claim rewards from ${claimable.length} pool${claimable.length === 1 ? '' : 's'}`)}
        </Button>
      )}
      {positions.length > 0 && (
        <div className='sw-list'>
          {positions.map(pos => {
            const { pool } = pos
            const [t0, t1] = pool.tokens
            const key = pool.contract_addr
            const total = BigInt(pos.walletLp || '0') + BigInt(pos.stakedLp || '0')
            const part = (pct: number) => ((total * BigInt(pct)) / BigInt(100)).toString()
            const staked = BigInt(pos.stakedLp || '0') > BigInt(0)
            return (
              <div key={key} className='sw-item-body sw-position'>
                <div className='sw-item'>
                  <PairIcons a={t0.label} b={t1.label} size={24} />
                  <span className='sw-item-main'>
                    <span className='sw-item-title'><span>{pool.label}</span></span>
                    <span className='sw-item-sub'>{VENUE_NAME[pool.venue]}</span>
                  </span>
                  {pos.usd != null && <span className='sw-item-end'>{fmtUsd(pos.usd)}</span>}
                </div>
                <dl className='sw-rows'>
                  <Row k='A claim on' v={`${fmtAmount(pos.amounts[0])} ${t0.label} + ${fmtAmount(pos.amounts[1])} ${t1.label}`} />
                  <PutInRows flow={data?.flows?.[`${me}|${key}`] ?? flows?.[`${me}|${key}`]} tokens={pool.tokens} amounts={pos.amounts} usd={pos.usd} px={tokenPx} />
                  <Row k='LP' v={`${amt(pos.walletLp, 6)} in wallet${staked ? ` · ${amt(pos.stakedLp, 6)} staked in Astroport Incentives` : ''}`} tone='muted' />
                  {pos.pending.length > 0 && <Row k='Rewards waiting' v={pos.pending.map(r => `${amt(r.amount, r.token.decimals)} ${r.token.label}`).join(' · ')} tone='good' />}
                </dl>
                <div className='sw-pool-actions'>
                  {[25, 50, 100].map(pct => (
                    <Button key={pct} size='sm' variant={pct === 100 ? 'secondary' : 'quiet'} busy={busy === `${key}:${pct}`} disabled={!!busy && busy !== `${key}:${pct}`}
                      onClick={() => run(`${key}:${pct}`, () => exit.mutateAsync({
                        pair: key, lpToken: pool.liquidity_token, incentives: VENUE_INCENTIVES[pool.venue],
                        walletLp: pos.walletLp, stakedLp: pos.stakedLp, amount: part(pct), sender: me,
                      }), pct === 100 ? `Left ${pool.label}. Both tokens are in your wallet.` : `Withdrew ${pct}% of ${pool.label}.`)}>
                      {label(`${key}:${pct}`, pct === 100 ? 'Withdraw all' : `Withdraw ${pct}%`)}
                    </Button>
                  ))}
                  {staked && incentives && (
                    <Button size='sm' variant='quiet' busy={busy === `${key}:unstake`} disabled={!!busy && busy !== `${key}:unstake`}
                      onClick={() => run(`${key}:unstake`, () => unstake.mutateAsync({ incentives, lpToken: pool.liquidity_token, amount: pos.stakedLp, sender: me }), 'Unstaked. The LP is back in your wallet.')}>
                      {label(`${key}:unstake`, 'Unstake only')}
                    </Button>
                  )}
                  {pos.rewardsActive && incentives && BigInt(pos.walletLp || '0') > BigInt(0) && (
                    <Button size='sm' variant='quiet' busy={busy === `${key}:stake`} disabled={!!busy && busy !== `${key}:stake`}
                      onClick={() => run(`${key}:stake`, () => stake.mutateAsync({ incentives, lpToken: pool.liquidity_token, amount: pos.walletLp, sender: me }), 'Staked in Astroport Incentives.')}>
                      {label(`${key}:stake`, 'Stake for rewards')}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {ax && (() => {
        // Convert what unstaking returns (a hair under the estimate, in case the ratio moves) plus what is already held.
        const convertAmount = (BigInt(ax.astroCw20) + (BigInt(ax.leaveEstimate) * BigInt(9_999)) / BigInt(10_000)).toString()
        // The converter pays out of its own balance and nothing else, so only offer a conversion it can pay.
        const canConvert = BigInt(ax.converterFunds || '0') >= BigInt(convertAmount)
        const hasX = ax.xastro !== '0'
        return (
          <div className='sw-card'>
            <h2 className='sw-card-title'>Old ASTRO on Terra</h2>
            <dl className='sw-rows sw-gap'>
              {hasX && <Row k='xASTRO in the first staking' v={`${amt(ax.xastro, 6)}, unstakes to about ${amt(ax.leaveEstimate, 6)} ASTRO.cw20`} />}
              {ax.astroCw20 !== '0' && <Row k='ASTRO.cw20 in wallet' v={amt(ax.astroCw20, 6)} />}
            </dl>
            <p className='sw-hint'>
              {canConvert
                ? `Astroport now uses the ASTRO that comes over IBC from Neutron. This ${hasX ? 'unstakes the xASTRO and ' : ''}converts all ASTRO.cw20 through Astroport's own converter, in one signature.`
                : `Astroport's converter has nothing left to pay out right now, so a conversion would fail. ${hasX ? 'Unstaking still works and returns ASTRO.cw20 to your wallet.' : 'The ASTRO.cw20 stays in your wallet.'}`}
            </p>
            {(canConvert || hasX) && (
              <div className='sw-gap'>
                <Button variant='primary' block busy={busy === 'astro'} disabled={!!busy && busy !== 'astro'}
                  onClick={() => run('astro', () => astroExit.mutateAsync({
                    staking: ASTRO_STAKING, xastro: XASTRO_CW20, converter: ASTRO_CONVERTER, astroCw20: ASTRO_CW20,
                    xastroAmount: ax.xastro, convertAmount: canConvert ? convertAmount : '0', sender: me,
                  }), canConvert ? 'Done. The ASTRO is in your wallet.' : 'Unstaked. The ASTRO.cw20 is in your wallet.')}>
                  {label('astro', canConvert ? (hasX ? 'Unstake and convert to ASTRO' : 'Convert to ASTRO') : 'Unstake to ASTRO.cw20')}
                </Button>
              </div>
            )}
          </div>
        )
      })()}
      {unstaking.length > 0 && (
        <div className='sw-card'>
          <h2 className='sw-card-title'>Unstaking at liquid staking hubs</h2>
          {unstaking.map(u => (
            <div key={u.hub} className='sw-gap'>
              <dl className='sw-rows'>
                {u.requests.map(r => (
                  <Row key={`${u.hub}:${r.batch}`} k={`${u.key} at ${u.provider}`} tone={r.status === 'ready' ? 'good' : undefined}
                    v={`about ${amt(r.lunaMicro, 6)} LUNA, ${r.status === 'ready' ? 'ready to withdraw'
                      : r.status === 'queued' ? `in the next batch, ready about ${day(r.readyAt)}`
                      : r.readyAt && r.readyAt * 1000 < Date.now() ? `settling at ${u.provider}` : `ready about ${day(r.readyAt)}`}`} />
                ))}
              </dl>
              {BigInt(u.readyMicro) > BigInt(0) && (
                <Button variant='primary' block busy={busy === `lst:${u.hub}`} disabled={!!busy && busy !== `lst:${u.hub}`}
                  onClick={() => run(`lst:${u.hub}`, () => withdrawLst.mutateAsync({ hub: u.hub, sender: me }), `Withdrawn from ${u.provider}. The LUNA is in your wallet.`)}>
                  {label(`lst:${u.hub}`, `Withdraw ${amt(u.readyMicro, 6)} LUNA from ${u.provider}`)}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <ErrorNote error={err} />
      {ok && <p className='sw-ok'><Icon name='check' size={16} />{ok}</p>}
    </div>
  )
}

// ── Wallet: what it holds, and the leftovers sold in one go ──────────

/**
 * Every listed token in the connected wallet with its value, and a way to sell
 * the small leftover balances in one signature (lib/sweep): tick them, pick
 * USDC or LUNA, sign once. Balances under $10 start ticked. LUNA never does,
 * and selling it always leaves one LUNA behind for fees.
 */
function Holdings({ pools, onDone, again }: { pools: PoolView[]; onDone: () => void; again: number }) {
  const me = useMyAddress()
  const { px } = useTokenData()
  const send = useTerraMsgs()
  const [bal, setBal] = useState<Record<string, string> | null>(null)
  const [reload, setReload] = useState(0)
  const [targetKey, setTargetKey] = useState<'USDC' | 'LUNA'>('USDC')
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [touched, setTouched] = useState(false)
  const [lines, setLines] = useState<SweepLine[] | null>(null)
  const [pricing, setPricing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<Failure | null>(null)
  const [ok, setOk] = useState<{ text: string; tx: string } | null>(null)
  const SLIP = 0.02
  const tokens = useMemo(() => {
    const m = new Map<string, KnownToken>()
    for (const p of pools) for (const t of p.tokens) m.set(assetId(t.info), t)
    return Array.from(m.values())
  }, [pools])
  const target = useMemo(() => KNOWN_TOKENS.find(t => t.key === targetKey) ?? LUNA, [targetKey])
  useEffect(() => { if (again) setReload(again) }, [again])

  useEffect(() => {
    if (!me || tokens.length === 0) { setBal(null); return }
    let alive = true
    if (reload) balanceCache.delete(me)
    walletBalances(me, tokens).then(b => { if (alive) setBal(b) }).catch(() => {})
    return () => { alive = false }
  }, [me, tokens, reload])

  const holdings = useMemo(() => {
    if (!bal) return []
    return tokens
      .map(t => {
        const micro = bal[assetId(t.info)] ?? '0'
        const p = px?.[assetId(t.info)]
        return { token: t, micro, usd: p ? (Number(micro) / 10 ** t.decimals) * p : null }
      })
      .filter(h => h.micro !== '0')
      .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1))
  }, [bal, tokens, px])

  /** What of a holding a sale into the target can sell, smallest units, or null. */
  const sellable = useCallback((h: { token: KnownToken; micro: string }) => {
    if (sameAsset(h.token.info, target.info) || poolsFor(pools, h.token, target).length === 0) return null
    const keep = assetId(h.token.info) === 'uluna' ? SWEEP_KEEP_LUNA_MICRO : BigInt(0)
    const can = BigInt(h.micro) - keep
    return can > BigInt(0) ? can.toString() : null
  }, [pools, target])

  // Small balances start ticked, until the person ticks something themselves.
  useEffect(() => {
    if (touched) return
    const next = new Set<string>()
    for (const h of holdings) {
      if (next.size >= SWEEP_MAX) break
      if (h.usd != null && h.usd < 10 && assetId(h.token.info) !== 'uluna' && sellable(h)) next.add(assetId(h.token.info))
    }
    setPicked(next)
  }, [holdings, sellable, touched])

  const picks: SweepPick[] = holdings
    .filter(h => picked.has(assetId(h.token.info)))
    .map(h => ({ token: h.token, micro: sellable(h) ?? '0' }))
    .filter(p => p.micro !== '0')
  const pickKey = `${targetKey}|${picks.map(p => `${assetId(p.token.info)}:${p.micro}`).join(',')}`
  const picksRef = useRef(picks)
  picksRef.current = picks
  useEffect(() => {
    setLines(null)
    const now = picksRef.current
    if (now.length === 0) { setPricing(false); return }
    let alive = true
    setPricing(true)
    const t = setTimeout(() => {
      planSweep(pools, now, target, SLIP)
        .then(l => { if (alive) setLines(l) })
        .catch(() => {})
        .finally(() => { if (alive) setPricing(false) })
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey])

  const ready = (lines ?? []).filter((l): l is SweepLine & { plan: RoutePlan } => !!l.plan)
  const totalOut = ready.reduce((s, l) => s + BigInt(l.plan.expectedOut), BigInt(0))
  const totalMin = ready.reduce((s, l) => s + BigInt(l.plan.minOut), BigInt(0))
  const canGo = !!me && ready.length > 0 && !busy && !pricing
  const toggle = (id: string, on: boolean) => {
    setTouched(true)
    setPicked(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  }
  const go = async () => {
    if (!canGo) return
    setErr(null); setOk(null); setBusy(true)
    try {
      const msgs = ready.flatMap(l => routeMsgs(me, l.plan, SLIP))
      const r = await send.mutateAsync({ msgs, memo: `sweep ${ready.length} token${ready.length === 1 ? '' : 's'} into ${target.label}` }) as { transactionHash?: string }
      setOk({ text: `Sold ${ready.map(l => l.token.label).join(', ')} into ${target.label}.`, tx: r?.transactionHash ?? '' })
      setTouched(true); setPicked(new Set()); setLines(null)
      onDone()
      ;[5000, 11000].forEach(ms => setTimeout(() => setReload(Date.now()), ms))
    } catch (e) { setErr(failureOf(e)) } finally { setBusy(false) }
  }

  if (!bal) return <p className='sw-status'><span className='of-spin' aria-hidden /> Reading the wallet…</p>
  if (holdings.length === 0) return <Empty title='None of the listed tokens yet'><Link href='/' className='of-btn of-btn--secondary'>Swap</Link></Empty>
  const total = holdings.reduce((s, h) => s + (h.usd ?? 0), 0)

  return (
    <div className='sw-stack'>
      <div className='sw-list'>
        <div className='sw-item'>
          <span className='sw-item-main'><span className='sw-item-title'>Tokens</span>{!IS_ASTRO && <a className='sw-item-sub' href={`${TERRA_HOME_URL}/`}>Staking, loans and votes in Openfields Home</a>}</span>
          <span className='sw-item-end'>{fmtUsd(total)}</span>
        </div>
        {holdings.map(h => {
          const id = assetId(h.token.info)
          const can = sellable(h)
          const on = picked.has(id)
          const line = lines?.find(l => assetId(l.token.info) === id)
          const why = sameAsset(h.token.info, target.info) ? 'what they become' : id === 'uluna' ? 'one LUNA stays for fees' : `never swapped for ${target.label} here`
          return (
            <label key={id} className='sw-item sw-hold'>
              <input type='checkbox' checked={on} disabled={!can || busy || (!on && picked.size >= SWEEP_MAX)} onChange={e => toggle(id, e.target.checked)} aria-label={`Sell ${h.token.label}`} />
              <TokenIcon label={h.token.label} size={32} />
              <span className='sw-item-main'>
                <span className='sw-item-title'><span>{h.token.label}</span></span>
                <span className='sw-item-sub'>
                  {!can ? why : on ? (line ? (line.plan ? `becomes ${amt(line.plan.expectedOut, target.decimals, 4)} ${target.label}` : line.why) : pricing ? 'pricing…' : 'to sell') : `${amt(h.micro, h.token.decimals, 6)}`}
                </span>
              </span>
              <span className='sw-item-end'>
                <span>{h.usd != null ? fmtUsd(h.usd) : '–'}</span>
                <small>{amt(h.micro, h.token.decimals, 4)}</small>
              </span>
            </label>
          )
        })}
      </div>
      <div className='sw-card'>
        <div className='sw-card-head'>
          <h2 className='sw-card-title'>Sell the ticked ones</h2>
          <div className='of-seg' role='radiogroup' aria-label='Into'>
            {(['USDC', 'LUNA'] as const).map(k => (
              <button key={k} type='button' role='radio' aria-checked={targetKey === k} onClick={() => { setTargetKey(k); setTouched(false) }}>into {k}</button>
            ))}
          </div>
        </div>
        <p className='sw-card-sub'>Up to {SWEEP_MAX} tokens in one signature, each with its own minimum. If any would arrive short, nothing is sold.</p>
        {picks.length > 0 && (
          <dl className='sw-rows sw-gap'>
            <Row k='You receive' v={lines ? `${amt(totalOut.toString(), target.decimals, 4)} ${target.label}` : 'pricing…'} tone='strong' />
            {lines && ready.length > 0 && <Row k={`At least, ${SLIP * 100}% slippage on each`} v={`${amt(totalMin.toString(), target.decimals, 4)} ${target.label}`} tone='muted' />}
          </dl>
        )}
        <div className='sw-act'>
          <ErrorNote error={err} />
          {ok && <p className='sw-ok'><Icon name='check' size={16} />{ok.text}{ok.tx && <a href={SCAN_TX(ok.tx)} target='_blank' rel='noopener noreferrer'>View transaction</a>}</p>}
          <ActionButton me={me} onClick={go} disabled={!canGo} busy={busy || pricing}
            label={busy ? 'Confirm in your wallet' : pricing ? 'Pricing…' : ready.length > 0 ? `Sell ${ready.length} into ${target.label}` : picks.length > 0 ? 'Nothing ticked can be sold right now' : 'Tick what to sell'} />
        </div>
      </div>
    </div>
  )
}

/**
 * Sending a listed token to another Terra address. The address is checked
 * before anything is signed: that it is a Terra address, that it is not this
 * wallet, whether it has ever been used, and whether it is a contract. A memo
 * goes through exactly as typed, for an exchange that asks for one.
 */
function Send({ pools, onDone }: { pools: PoolView[]; onDone: () => void }) {
  const me = useMyAddress()
  const send = useTerraMsgs()
  const tokens = useMemo(() => {
    const m = new Map<string, KnownToken>([['uluna', LUNA]])
    for (const p of pools) for (const t of p.tokens) if (KNOWN_TOKENS.some(k => k.key === t.key)) m.set(assetId(t.info), t)
    return Array.from(m.values())
  }, [pools])
  const [tokenId, setTokenId] = useState('uluna')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [bal, setBal] = useState('0')
  const [seen, setSeen] = useState<'used' | 'new' | 'unknown' | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<Failure | null>(null)
  const [ok, setOk] = useState<{ text: string; tx: string } | null>(null)
  // The address book and the addresses sent to lately, in this browser only (lib/contacts).
  const { contacts, recent } = useContacts()
  const [saveName, setSaveName] = useState('')
  const token = tokens.find(t => assetId(t.info) === tokenId) ?? LUNA
  useEffect(() => {
    if (!me) { setBal('0'); return }
    queryBalance(me, token.info).then(setBal).catch(() => {})
  }, [me, token, ok])

  const addr = to.trim()
  const kind = (() => {
    try {
      const { prefix, data } = fromBech32(addr)
      return prefix === 'terra' && (data.length === 20 || data.length === 32) ? (data.length === 32 ? 'contract' : 'wallet') : null
    } catch { return null }
  })()
  useEffect(() => {
    setSeen(null)
    if (!kind) return
    let alive = true
    lcdFetch(`/cosmos/auth/v1beta1/accounts/${addr}`)
      .then(r => { if (alive) setSeen(r.ok ? 'used' : r.status === 404 ? 'new' : 'unknown') })
      .catch(() => { if (alive) setSeen('unknown') })
    return () => { alive = false }
  }, [addr, kind])

  const micro = toMicro(amount, token.decimals)
  const isLuna = assetId(token.info) === 'uluna'
  const insufficient = !!micro && BigInt(micro) > BigInt(bal || '0')
  const self = !!me && addr === me
  const canSend = !!me && !!kind && !self && !!micro && micro !== '0' && !insufficient && !busy
  const go = async () => {
    if (!canSend || !micro) return
    setErr(null); setOk(null); setBusy(true)
    try {
      // A typed memo goes exactly as typed (an exchange reads it); without one, the memo says the send was made here.
      const r = await send.mutateAsync({ msgs: [sendMsg({ sender: me, recipient: addr, info: token.info, amount: micro })], ...(memo.trim() ? { memo: memo.trim(), raw: true } : { memo: 'send' }) }) as { transactionHash?: string }
      setOk({ text: `Sent ${amt(micro, token.decimals, 6)} ${token.label} to ${shortAddress(addr)}.`, tx: r?.transactionHash ?? '' })
      rememberRecipient(addr)
      setAmount('')
      onDone()
    } catch (e) { setErr(failureOf(e)) } finally { setBusy(false) }
  }
  const saved = contacts.find(c => c.address === addr)
  const lately = recent.filter(a => a !== me && !contacts.some(c => c.address === a)).slice(0, 4)

  return (
    <div className='sw-card sw-stack'>
      <div>
        <h2 className='sw-card-title'>Send</h2>
        <p className='sw-card-sub'>A send cannot be undone. The address is checked before you sign.</p>
      </div>
      <div>
        <div className='sw-field-head'>
          <label className='sw-label' htmlFor='sw-send-amount'>Amount</label>
          <span className='sw-field-bal'>
            Balance {amt(bal, token.decimals)} {token.label}
            {BigInt(bal || '0') > BigInt(0) && (
              <button type='button' className='sw-max' onClick={() => {
                // Sending all LUNA would leave nothing for this transaction's fee, or the next one.
                const keep = isLuna ? BigInt(100_000) : BigInt(0)
                const max = BigInt(bal) > keep ? BigInt(bal) - keep : BigInt(0)
                setAmount(fromMicro(max.toString(), token.decimals, 6).replace(/,/g, ''))
              }}>Max</button>
            )}
          </span>
        </div>
        <div className='sw-pair'>
          <input id='sw-send-amount' className='sw-input' type='number' inputMode='decimal' min='0' step='any' placeholder='0' value={amount} onChange={e => setAmount(e.target.value)} />
          <TokenSelect value={tokenId} onChange={setTokenId} options={tokens} label='Token to send' />
        </div>
      </div>
      <div>
        <label className='sw-label' htmlFor='sw-send-to'>To a Terra address</label>
        {(contacts.length > 0 || lately.length > 0) && (
          <div className='sw-chip-row sw-send-book'>
            {contacts.map(c => <button key={c.address} type='button' className='of-chip' aria-pressed={addr === c.address} title={c.address} onClick={() => { setTo(c.address); setMemo(c.memo ?? '') }}>{c.name}</button>)}
            {lately.map(a => <button key={a} type='button' className='of-chip' aria-pressed={addr === a} title={`Sent to lately: ${a}`} onClick={() => setTo(a)}>{shortAddress(a)}</button>)}
          </div>
        )}
        <input id='sw-send-to' className='sw-input sw-input--mono' placeholder='terra1…' value={to} onChange={e => setTo(e.target.value)} spellCheck={false} autoComplete='off' aria-invalid={!!addr && (!kind || self)} />
        {addr && !kind && <p className='sw-hint is-bad'>That is not a Terra address.</p>}
        {self && <p className='sw-hint is-bad'>That is this wallet.</p>}
        {kind && !self && seen === 'new' && <p className='sw-hint is-warn'>This address has never been used on Terra. Check every character before sending.</p>}
        {kind === 'contract' && !self && <p className='sw-hint is-warn'>This is a contract address. Send only if it accepts {token.label}; tokens sent to a contract that does not handle them can be lost.</p>}
        {kind === 'wallet' && !self && seen === 'used' && <p className='sw-hint'>An address that has been used on Terra before.</p>}
        {kind && !self && (saved ? (
          <p className='sw-hint'>In your address book as {saved.name}{saved.memo ? ', with its memo' : ''}. <button type='button' className='sw-wallet-btn' onClick={() => removeContact(addr)}>Remove</button></p>
        ) : (
          <div className='sw-pair sw-gap'>
            <input className='sw-input sw-input--sm' value={saveName} onChange={e => setSaveName(e.target.value.slice(0, 32))} placeholder='Name it to save it' aria-label='Name for this address' />
            <Button size='sm' disabled={!saveName.trim()} onClick={() => { saveContact({ address: addr, name: saveName, memo }); setSaveName('') }}>{memo.trim() ? 'Save with memo' : 'Save'}</Button>
          </div>
        ))}
      </div>
      <div>
        <label className='sw-label' htmlFor='sw-send-memo'>Memo, only if the receiver asks for one</label>
        <input id='sw-send-memo' className='sw-input sw-input--sm' placeholder='For example an exchange deposit memo' value={memo} onChange={e => setMemo(e.target.value.slice(0, 256))} spellCheck={false} autoComplete='off' />
      </div>
      <ErrorNote error={err} />
      {ok && <p className='sw-ok'><Icon name='check' size={16} />{ok.text}{ok.tx && <Link href={`/tx/${ok.tx}`}>Receipt</Link>}</p>}
      <ActionButton me={me} onClick={go} disabled={!canSend} busy={busy}
        label={busy ? 'Confirm in your wallet' : insufficient ? `Not enough ${token.label}` : micro && micro !== '0' && kind && !self ? `Send ${amt(micro, token.decimals, 6)} ${token.label}` : 'Send'} />
    </div>
  )
}

/** Price alerts and starred tokens, both kept in this browser only (lib/alerts). */
function Alerts() {
  const { alerts, favorites } = usePrefs()
  const push = usePush(alerts)
  const [pushNote, setPushNote] = useState<string | null>(null)
  const togglePush = async (on: boolean) => {
    setPushNote(null)
    if (!on) { await disablePush(); return }
    const r = await enablePush()
    if (!r.ok) setPushNote(r.why)
  }
  const [allowed, setAllowed] = useState(false)
  useEffect(() => { setAllowed(notificationsAllowed()) }, [alerts])
  const waiting = alerts.filter(a => !a.firedAt)
  const starred = favorites.map(id => KNOWN_TOKENS.find(t => assetId(t.info) === id)).filter((t): t is KnownToken => !!t)
  return (
    <div className='sw-card sw-stack'>
      <div>
        <h2 className='sw-card-title'>Price alerts</h2>
        <p className='sw-card-sub'>Kept in this browser. Set one on a token&apos;s page, for example <Link href='/token/LUNA'>LUNA</Link>.</p>
      </div>
      {alerts.length > 0 && (
        <dl className='sw-rows'>
          {alerts.map(a => (
            <div key={a.id} className='sw-row sw-alert-row'>
              <dt><Link href={`/token/${encodeURIComponent(a.key)}`}>{a.label} {a.dir} ${fmtUsdPrice(a.usd)}</Link></dt>
              <dd>
                <span className={a.firedAt ? 'sw-pos' : 'sw-warn'}>{a.firedAt ? `went off at $${fmtUsdPrice(a.firedUsd ?? 0)}` : 'waiting'}</span>
                <IconButton icon='close' label={`Remove the alert on ${a.label}`} onClick={() => removeAlert(a.id)} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {waiting.length > 0 && !allowed && typeof Notification !== 'undefined' && (
        <div><Button size='sm' onClick={async () => setAllowed(await askNotifications())}>Allow browser notifications</Button></div>
      )}
      {push.supported && (
        <div>
          <label className='sw-check'><input type='checkbox' checked={push.on} onChange={e => void togglePush(e.target.checked)} />Also when no page of this site is open</label>
          <p className='sw-fine'>This keeps this browser&apos;s notification address and its alert levels on the site&apos;s server, and nothing else: no wallet, no name. Checked every ten minutes. Turn it off to delete them.</p>
          {pushNote && <p className='sw-hint is-warn'>{pushNote}</p>}
        </div>
      )}
      {starred.length > 0 && (
        <div className='sw-chip-row'>
          <span>Starred</span>
          {starred.map(t => <Link key={t.key} href={`/token/${encodeURIComponent(t.key)}`} className='of-chip'><TokenIcon label={t.label} size={20} />{t.label}</Link>)}
        </div>
      )}
    </div>
  )
}

// ── History: what a wallet did, read back from the chain ─────────────

const KIND_TEXT: Record<HistoryRow['kind'], string> = {
  swap: 'Swap', zap: 'Zap', 'add liquidity': 'Added liquidity', 'remove liquidity': 'Removed liquidity',
  stake: 'Staked LP', unstake: 'Unstaked LP', claim: 'Claimed rewards', 'transfer out': 'Sent over IBC',
  'transfer in': 'Arrived over IBC', 'arrived swapped': 'Arrived swapped', 'create pool': 'Opened a pool',
  'liquid staking': 'Liquid staking', other: 'Other',
}

/**
 * The connected wallet's recent transactions on Terra, read back from the
 * chain (lib/history): what left, what arrived and the network fee, and for a
 * swap signed here, what it was quoted beside what actually arrived.
 */
function History({ pools, again }: { pools: PoolView[]; again: number }) {
  const me = useMyAddress()
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [year, setYear] = useState(() => new Date().getUTCFullYear())
  const [exporting, setExporting] = useState<{ busy: boolean; text: string } | null>(null)
  useEffect(() => { if (again) setReload(again) }, [again])
  useEffect(() => {
    if (!me) { setData(null); return }
    let alive = true
    setLoading(true); setFailed(false)
    fetch(`/api/history?address=${me}${reload ? `&_=${reload}` : ''}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((j: HistoryResponse | null) => { if (!alive) return; if (j?.rows) setData(j); else setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [me, reload])
  const lpNames = useMemo(() => new Map(pools.map(p => [p.liquidity_token, `${p.label} LP`])), [pools])
  const tokenOf = useCallback((id: string) => {
    const lp = lpNames.get(id)
    if (lp) return { label: lp, decimals: 6 }
    const t = tokenFor(id.startsWith('terra1') ? { token: { contract_addr: id } } : { native_token: { denom: id } })
    return { label: t.label, decimals: t.decimals }
  }, [lpNames])
  const show = (m: Moved) => { const t = tokenOf(m.id); return `${amt(m.amount, t.decimals, 6)} ${t.label}` }

  /** Every transaction of a calendar year as a CSV file (lib/csv), with each token's real decimals read from the chain. */
  const exportCsv = async () => {
    if (!me) return
    setExporting({ busy: true, text: `Reading every transaction of ${year}…` })
    try {
      const r = await fetch(`/api/history?address=${me}&year=${year}`, { cache: 'no-store' })
      const j = r.ok ? ((await r.json()) as HistoryResponse) : null
      if (!j) { setExporting({ busy: false, text: 'The chain did not answer. Try again in a moment.' }); return }
      const ids = Array.from(new Set(j.rows.flatMap(row => [...row.in, ...row.out].map(m => m.id))))
      const named = new Map<string, { symbol: string; decimals: number }>()
      await Promise.all(ids.map(async id => {
        const lp = lpNames.get(id)
        if (lp) { named.set(id, { symbol: lp, decimals: 6 }); return }
        const tk = await resolveToken(id.startsWith('terra1') ? { token: { contract_addr: id } } : { native_token: { denom: id } }).catch(() => null)
        const listed = !!tk && KNOWN_TOKENS.some(k => k.key === tk.key)
        named.set(id, { symbol: listed ? tk!.label : tk && tk.label !== tk.key ? `${tk.label} (${id})` : id, decimals: tk?.decimals ?? 6 })
      }))
      const csv = historyCsv(j.rows, id => named.get(id) ?? { symbol: id, decimals: 6 })
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `terra-${me.slice(-6)}-${year}.csv`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      const n = j.rows.length
      setExporting({ busy: false, text: `${n} transaction${n === 1 ? '' : 's'} in ${year}, saved as ${a.download}.${j.complete ? '' : ' The chain stopped answering before the start of the year, so the oldest may be missing. Try again later for the whole year.'}` })
    } catch {
      setExporting({ busy: false, text: 'The chain did not answer. Try again in a moment.' })
    }
  }

  const rows = data?.rows ?? []
  return (
    <div className='sw-stack'>
      {loading && !data && <p className='sw-status'><span className='of-spin' aria-hidden /> Reading the chain…</p>}
      {failed && !data && <Empty title='The history did not load'><Button onClick={() => setReload(Date.now())}>Try again</Button></Empty>}
      {data && rows.length === 0 && <Empty title='No transactions yet'><Link href='/' className='of-btn of-btn--secondary'>Swap</Link></Empty>}
      {rows.length > 0 && (
        <div className='sw-list'>
          {rows.map(row => {
            const q = row.quote
            const got = q ? row.in.find(m => tokenOf(m.id).label === q.label) : undefined
            const gotNum = got ? Number(got.amount) / 10 ** tokenOf(got.id).decimals : null
            const vsQuote = q && gotNum != null && q.amount > 0 ? (gotNum / q.amount - 1) * 100 : null
            return (
              <div key={row.hash} className='sw-item-body sw-position'>
                <div className='sw-item'>
                  <span className='sw-item-main'>
                    <span className='sw-item-title'><span>{KIND_TEXT[row.kind]}</span>{row.chain && <span className='sw-tag'>{row.kind === 'transfer out' ? `to ${row.chain}` : `from ${row.chain}`}</span>}{!row.ok && <span className='sw-tag is-warn'>failed</span>}</span>
                    <span className='sw-item-sub'>{new Date(row.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </span>
                  <Link href={`/tx/${row.hash}`} className='of-btn of-btn--quiet of-btn--sm'>Receipt</Link>
                </div>
                <dl className='sw-rows'>
                  {!row.ok && <Row k='Failed on chain' v='Nothing moved but the network fee.' tone='bad' />}
                  {row.out.length > 0 && <Row k='Left' v={row.out.map(show).join(' + ')} />}
                  {row.in.length > 0 && <Row k='Arrived' v={row.in.map(show).join(' + ')} />}
                  {q && <Row k='Quoted' v={<>{fmtAmount(q.amount)} {q.label}{vsQuote != null && <> · arrived <span className={vsQuote >= -0.05 ? 'sw-pos' : 'sw-warn'}>{vsQuote >= 0 ? '+' : ''}{vsQuote.toFixed(2)}%</span></>}</>} />}
                  {q?.gainPct != null && q.gainPct >= 0.005 && <Row k='Routing added' v={`+${q.gainPct.toFixed(2)}% over the best path through up to two pools`} tone='good' />}
                  {row.minimum && <Row k='Least it allowed' v={show(row.minimum)} tone='muted' />}
                  <Row k='Network fee' v={row.feeUluna !== '0' ? `${amt(row.feeUluna, 6, 4)} LUNA` : 'paid by the relayer'} tone='muted' />
                </dl>
              </div>
            )
          })}
        </div>
      )}
      <div className='sw-card'>
        <div className='sw-card-head'>
          <h2 className='sw-card-title'>Download a year</h2>
          <label className='sw-select'>
            <span className='of-sr'>Year</span>
            <select value={year} onChange={e => setYear(Number(e.target.value))}>
              {Array.from({ length: new Date().getUTCFullYear() - 2021 }, (_, i) => new Date().getUTCFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <Icon name='chevronDown' size={14} />
          </label>
        </div>
        <p className='sw-card-sub'>Every transaction of the year as a CSV, in the columns tax software such as Koinly imports. Dollar values only where one side of a swap is USDC from Noble.</p>
        <div className='sw-act'>
          {exporting && !exporting.busy && <p className='sw-status'>{exporting.text}</p>}
          <Button block onClick={exportCsv} busy={exporting?.busy}>{exporting?.busy ? exporting.text : 'Download CSV'}</Button>
        </div>
      </div>
    </div>
  )
}

// ── The place ────────────────────────────────────────────────────────

export default function Portfolio({ view, onView, pools, routePools, flows, onDone }: {
  view: PortfolioView; onView: (v: PortfolioView) => void; pools: PoolView[]; routePools: PoolView[]; flows?: Record<string, LpFlow>; onDone: () => void
}) {
  const me = useMyAddress()
  const { t } = useLang()
  /** Read again, past the short caches, when asked. */
  const [again, setAgain] = useState(0)
  return (
    <section className='sw-page' aria-labelledby='sw-portfolio-title'>
      <div className='sw-head'>
        <h1 id='sw-portfolio-title' className='sw-title'>{t('Portfolio')}</h1>
        {me && <IconButton icon='retry' label={t('Read again')} onClick={() => setAgain(Date.now())} />}
      </div>
      {!me ? (
        <Empty title={t('Connect a wallet to see what it holds')}>
          <Button variant='primary' onClick={askToConnect}>{t('Connect wallet')}</Button>
        </Empty>
      ) : (
        <>
          <div className='of-seg sw-gap sw-tabs' role='tablist' aria-label={t('Portfolio')}>
            {([['positions', 'Positions'], ['wallet', 'Wallet'], ['history', 'History']] as const).map(([k, text]) => (
              <button key={k} type='button' role='tab' aria-selected={view === k} onClick={() => onView(k)}>{t(text)}</button>
            ))}
          </div>
          <div className='sw-gap'>
            {view === 'positions' && <Positions onDone={onDone} flows={flows} again={again} />}
            {view === 'wallet' && (
              <div className='sw-stack'>
                <Holdings pools={routePools} onDone={onDone} again={again} />
                <Send pools={routePools} onDone={onDone} />
                <Alerts />
              </div>
            )}
            {view === 'history' && <History pools={pools} again={again} />}
          </div>
        </>
      )}
    </section>
  )
}
