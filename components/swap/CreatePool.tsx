/**
 * Opening a pool, on Openfields Swap's factories or on Astroport's: two tokens,
 * a kind, one signature. The pool opens empty; the first deposit fills it.
 */

import { useEffect, useState } from 'react'
import { Icon } from 'components/ui'
import useMyAddress from 'components/hooks/useMyAddress'
import { useCreatePair } from 'components/transactions/useDex'
import {
  KNOWN_TOKENS, COIN_REGISTRY, HOME_VENUE, TERRA_SWAP_FACTORY_V2, VENUE_FACTORY, VENUE_NAME, assetId, factoryOf, sameAsset, smart,
  type AssetInfo, type PoolView, type Venue,
} from 'lib/dex'
import { ActionButton, ErrorNote, failureOf, TokenSelect, type Failure } from './common'

/**
 * Tokens a new pool can hold. Astroport's factory rejects a TokenFactory denom
 * with capitals in it ("Non-IBC token denom should be lowercase"), so ampROAR
 * trades in its existing pools but cannot open new ones.
 */
const CREATABLE_TOKENS = KNOWN_TOKENS.filter(t => !('native_token' in t.info && t.info.native_token.denom.startsWith('factory/') && /[A-Z]/.test(t.info.native_token.denom)))

/**
 * Astroport's own settings for a concentrated pool, read from its LUNA/USDC and
 * CAPA/LUNA pools on 2026-09-13; the two were identical. Only the starting
 * price differs from pool to pool.
 */
const PCL_DEFAULTS = {
  amp: '10', gamma: '0.000145', mid_fee: '0.0026', out_fee: '0.0045', fee_gamma: '0.00023',
  repeg_profit_threshold: '0.000002', min_price_scale_delta: '0.000146', ma_half_time: 600,
}
/**
 * LUNA against a liquid staking token, whose price creeps up as staking
 * rewards accrue: the settings of Astroport's own LUNA/ampLUNA pool, read
 * 2026-09-16. A high amp keeps liquidity tight around the price, and the pool
 * re-pegs on small profits so it follows the token's rising rate.
 */
const PCL_LST = {
  amp: '500', gamma: '0.01', mid_fee: '0.0003', out_fee: '0.0045', fee_gamma: '0.3',
  repeg_profit_threshold: '0.00000001', min_price_scale_delta: '0.0000055', ma_half_time: 600, track_asset_balances: false,
}
/** Astroport's stable pools on Terra use amp 10 (its LUNA/bLUNA pool, read 2026-09-16). */
const STABLE_DEFAULTS = { amp: 10 }
const LST_KEYS = new Set(['ampLUNA', 'bLUNA', 'arbLUNA', 'stLUNA', 'LunaX'])
type PoolKind = 'xyk' | 'concentrated' | 'stable'
const KIND_WORD: Record<PoolKind, string> = { xyk: 'Standard', concentrated: 'Concentrated', stable: 'Stable' }

export default function CreatePool({ pools, marketPx, onDone, onCreated, onBack }: {
  pools: PoolView[]; marketPx?: Record<string, number> | null; onDone: () => void; onCreated: () => void; onBack: () => void
}) {
  const me = useMyAddress()
  const create = useCreatePair()
  // Both factories from one page.
  const [venue, setVenue] = useState<Venue>(HOME_VENUE)
  const [a, setA] = useState(assetId(KNOWN_TOKENS[0].info))
  const [b, setB] = useState(assetId(KNOWN_TOKENS[1].info))
  const [kind, setKind] = useState<PoolKind>('xyk')
  const [startPrice, setStartPrice] = useState('')
  const [registered, setRegistered] = useState<boolean | null>(true)
  const [err, setErr] = useState<Failure | null>(null)
  const [ok, setOk] = useState(false)
  const ta = KNOWN_TOKENS.find(t => assetId(t.info) === a)!
  const tb = KNOWN_TOKENS.find(t => assetId(t.info) === b)!
  const ia = ta.info, ib = tb.info
  // Openfields Swap has two factories: standard pools on the first, concentrated and stable pools on factory v2 (contracts/factory-v2).
  const v2 = venue === 'terraswap' && !!TERRA_SWAP_FACTORY_V2
  const kinds: PoolKind[] = v2 ? ['xyk', 'concentrated', 'stable'] : ['xyk', 'concentrated']
  const factory = venue === 'terraswap' && kind !== 'xyk' ? TERRA_SWAP_FACTORY_V2 : VENUE_FACTORY[venue]
  const exists = pools.some(p => factoryOf(p) === factory && p.tokens.some(t => sameAsset(t.info, ia)) && p.tokens.some(t => sameAsset(t.info, ib)))
  // A pool type the chosen factory does not open falls back to standard.
  useEffect(() => {
    if ((venue === 'astroport' && kind === 'stable') || (venue === 'terraswap' && !TERRA_SWAP_FACTORY_V2 && kind !== 'xyk')) setKind('xyk')
  }, [venue, kind])

  // Astroport's factory refuses a native token its coin registry does not know. Say so before asking for a signature.
  useEffect(() => {
    let alive = true
    const natives = [ia, ib].filter(i => 'native_token' in i).map(i => assetId(i))
    if ((venue !== 'astroport' && kind === 'xyk') || natives.length === 0) { setRegistered(true); return }
    setRegistered(null)
    Promise.all(natives.map(d => smart<number>(COIN_REGISTRY, { native_token: { denom: d } })))
      .then(r => { if (alive) setRegistered(r.every(x => typeof x === 'number')) })
    return () => { alive = false }
  }, [ia, ib, venue, kind])

  // A concentrated pool starts at a price: how much of the first token one of the second is worth.
  useEffect(() => {
    const pa = marketPx?.[a], pb = marketPx?.[b]
    setStartPrice(pa && pb && pa > 0 && pb > 0 ? String(Number((pb / pa).toPrecision(8))) : '')
  }, [a, b, marketPx])
  const priceScale = (() => {
    const n = Number(startPrice)
    if (!(n > 0) || !Number.isFinite(n)) return null
    const s = n.toFixed(18).replace(/\.?0+$/, '')
    return Number(s) > 0 ? s : null
  })()
  const pcl = kind === 'concentrated' && (venue === 'astroport' || v2)
  const stable = kind === 'stable' && v2
  const lstPair = [ta, tb].some(t => LST_KEYS.has(t.key)) && [ta, tb].some(t => 'native_token' in t.info && t.info.native_token.denom === 'uluna')
  const can = !!me && !!factory && a !== b && !exists && registered === true && (!pcl || !!priceScale) && !create.isLoading
  const go = async () => {
    if (!can) return
    setErr(null); setOk(false)
    try {
      await create.mutateAsync({
        assetInfos: [ia, ib] as [AssetInfo, AssetInfo], sender: me,
        pairType: pcl ? 'concentrated' : stable ? 'stable' : 'xyk',
        initParams: pcl && priceScale ? { ...(lstPair ? PCL_LST : PCL_DEFAULTS), price_scale: priceScale } : stable ? STABLE_DEFAULTS : undefined,
        factory,
      })
      setOk(true); onDone()
      // The pool exists now but is empty; Pools is where anyone can be the first to add to it.
      setTimeout(onCreated, 3400)
    } catch (e) { setErr(failureOf(e)) }
  }

  const problem = a === b ? 'Pick two different tokens.'
    : exists ? 'That pool already exists. Add liquidity to it instead.'
    : registered === false ? "Astroport's coin registry does not know one of these tokens, so its factory would refuse the pool."
    : null

  return (
    <section className='sw-page sw-narrow' aria-labelledby='sw-create-title'>
      <button type='button' className='sw-back' onClick={onBack}><Icon name='chevronLeft' size={16} />Pools</button>
      <h1 id='sw-create-title' className='sw-title'>Open a pool</h1>
      <p className='sw-lede'>It opens empty and costs only the network fee.</p>

      <div className='sw-card sw-gap sw-stack'>
        <div>
          <p className='sw-label' id='sw-venue-label'>Where</p>
          <div className='of-seg' role='radiogroup' aria-labelledby='sw-venue-label'>
            {(['terraswap', 'astroport'] as const).map(v => (
              <button key={v} type='button' role='radio' aria-checked={venue === v} onClick={() => setVenue(v)}>{VENUE_NAME[v]}</button>
            ))}
          </div>
        </div>
        {(venue === 'astroport' || v2) && (
          <div>
            <p className='sw-label' id='sw-kind-label'>Kind</p>
            <div className='of-seg' role='radiogroup' aria-labelledby='sw-kind-label'>
              {kinds.map(k => <button key={k} type='button' role='radio' aria-checked={kind === k} onClick={() => setKind(k)}>{KIND_WORD[k]}</button>)}
            </div>
            <p className='sw-hint'>
              {kind === 'xyk' ? 'Liquidity spread over every price.' : kind === 'concentrated' ? 'Liquidity kept near a price you set, for example LUNA against ampLUNA.' : 'For two tokens that should trade one for one.'}
            </p>
          </div>
        )}
        <div>
          <p className='sw-label'>Tokens</p>
          <div className='sw-pair'>
            <TokenSelect value={a} onChange={setA} options={CREATABLE_TOKENS} block label='First token' />
            <span className='sw-pair-sep' aria-hidden>/</span>
            <TokenSelect value={b} onChange={setB} options={CREATABLE_TOKENS} block label='Second token' />
          </div>
        </div>
        {pcl && (
          <div>
            <label className='sw-label' htmlFor='sw-start'>Starting price, {ta.label} for 1 {tb.label}</label>
            <input id='sw-start' className='sw-input' type='number' inputMode='decimal' min='0' step='any' placeholder='0' value={startPrice} onChange={e => setStartPrice(e.target.value)} />
            <p className='sw-hint'>Filled from the market where both tokens have a price. Check it: the pool trades around it until liquidity moves it.{lstPair ? " Uses the settings of Astroport's LUNA/ampLUNA pool." : ''}</p>
          </div>
        )}
        {problem && <p className={`sw-hint ${a === b || registered === false ? 'is-bad' : ''}`}>{problem}</p>}
        <ErrorNote error={err} />
        {ok && <p className='sw-ok'><Icon name='check' size={16} />Pool opened. It shows in Pools once the block lands.</p>}
        <ActionButton me={me} label={create.isLoading ? 'Confirm in your wallet' : 'Open the pool'} onClick={go} disabled={!can} busy={create.isLoading} />
      </div>
    </section>
  )
}
