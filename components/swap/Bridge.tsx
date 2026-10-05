/**
 * Bridge: a token between another chain and Terra without leaving the page,
 * in one signature, swapped into another token on the way if you like.
 *
 * Into Terra: a plain IBC transfer, or, when it should arrive as another token,
 * the same transfer carrying a call to Openfields Swap's router that Terra's IBC
 * hooks run as it lands (lib/msgs arrivalSwapMsg). If the swap cannot deliver
 * its minimum, the transfer fails and the source chain returns the tokens. Out
 * of Terra: any listed token is swapped to the chain's token by this site's own
 * routing and sent in the same transaction. See lib/noble, lib/cosmoshub,
 * lib/neutron, lib/stride and lib/injective.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useChain } from '@cosmos-kit/react'
import { fromBech32 } from '@cosmjs/encoding'
import type { EncodeObject } from '@cosmjs/proto-signing'
import { Button, Icon } from 'components/ui'
import { TokenIcon } from 'components/TokenIcon'
import useMyAddress from 'components/hooks/useMyAddress'
import { connectChainWallet, type LiveChainWallet } from 'components/wallet/kitWallet'
import { useWallet } from 'components/providers/WalletProvider'
import { askToConnect } from 'components/wallet/connect'
import { useCosmosMsgs, useInjectiveMsgs, useTerraMsgs } from 'components/transactions/useDex'
import {
  NOBLE_USDC, USDC_INJ_DENOM, ATOM_DENOM, ASTRO_IBC_DENOM, DATOM_DENOM, FUEL_DENOM, STLUNA_DENOM, STATOM_DENOM, TERRA_SWAP_ROUTER, HOME_VENUE,
  assetId, fromMicro, isListed, queryBalance, sameAsset, toMicro, tokenFor, type KnownToken, type PoolView,
} from 'lib/dex'
import { quoteBest, planTrade, routeText, tradeText, reachable, routerPlan, type RoutePlan, type TradePlan } from 'lib/route'
import { arrivalSwapMsg, ibcTransferMsg, tradeMsgs } from 'lib/msgs'
import { NOBLE_CHAIN_ID, NOBLE_TO_TERRA_CHANNEL, NOBLE_USDC_DENOM, TERRA_CHAIN_ID, TERRA_TO_NOBLE_CHANNEL, nobleUsdcBalance } from 'lib/noble'
import { HUB_ATOM_DENOM, HUB_CHAIN_ID, HUB_TO_TERRA_CHANNEL, TERRA_TO_HUB_CHANNEL, hubAtomBalance } from 'lib/cosmoshub'
import { NEUTRON_ASTRO, NEUTRON_CHAIN_ID, NEUTRON_DATOM, NEUTRON_FEE_DENOM, NEUTRON_FUEL, NEUTRON_TO_TERRA_CHANNEL, TERRA_TO_NEUTRON_CHANNEL, neutronBalance } from 'lib/neutron'
import { STRIDE_CHAIN_ID, STRIDE_FEE_DENOM, STRIDE_TO_TERRA_CHANNEL, TERRA_TO_STRIDE_CHANNEL, strideBalance } from 'lib/stride'
import { INJECTIVE_CHAIN_ID, INJECTIVE_TO_TERRA_CHANNEL, TERRA_TO_INJECTIVE_CHANNEL, USDC_INJ_ON_INJECTIVE, injectiveBalance, toInjectiveAddress } from 'lib/injective'
import { GAS_DROP_BELOW_MICRO, LUNA, gasDropMicro, planGasDrop } from 'lib/gasDrop'
import { SCAN_TX } from 'lib/products'
import { amt, ErrorNote, failureOf, Row, TokenFixed, TokenSelect, useDebounced, useTokenData, type Failure } from './common'

/** A chain the wallet kit signs for directly, and the one token this panel moves between it and Terra. */
interface SourceChain {
  chainName: 'noble' | 'cosmoshub' | 'neutron' | 'stride'
  /** what the source chain charges its network fee in, and a way to read that balance */
  feeDenom: string
  feeLabel: string
  feeBalance: (address: string) => Promise<string>
  chainId: string
  name: string
  /** bech32 prefix of its addresses */
  prefix: string
  /** the token as it is on Terra, and as the source chain names it */
  terraDenom: string
  sourceDenom: string
  label: string
  toTerra: string
  fromTerra: string
  balance: (address: string) => Promise<string>
  /** what max leaves behind on the source chain, which takes its network fee in this same token */
  feeReserve: bigint
  txUrl: (hash: string) => string
  /** Terra tokens this token never turns into here, nor comes from, and whose pools a route avoids */
  never: string[]
  footnote: string
}

type SourceKey = 'noble' | 'cosmoshub' | 'neutron-astro' | 'neutron-datom' | 'neutron-fuel' | 'stride-stluna' | 'stride-statom'
/** Every way into Terra the Bridge offers: the chains above, and Injective, which signs differently (InjectiveTransfer). */
export type NetKey = SourceKey | 'injective'

/** A token from Neutron: its fee is NTRN, so a transfer can move all of the token. Checked on both chains 2026-09-15 (lib/neutron). */
const neutronToken = (label: string, sourceDenom: string, terraDenom: string): SourceChain => ({
  chainName: 'neutron', chainId: NEUTRON_CHAIN_ID, name: 'Neutron', prefix: 'neutron', terraDenom, sourceDenom, label,
  toTerra: NEUTRON_TO_TERRA_CHANNEL, fromTerra: TERRA_TO_NEUTRON_CHANNEL, balance: a => neutronBalance(a, sourceDenom), feeReserve: BigInt(0),
  feeDenom: NEUTRON_FEE_DENOM, feeLabel: 'NTRN', feeBalance: a => neutronBalance(a, NEUTRON_FEE_DENOM),
  txUrl: h => `https://www.mintscan.io/neutron/tx/${h}`, never: [],
  footnote: 'The Neutron wallet needs a little NTRN for the network fee.',
})
/** A token from Stride: its fee is STRD. Checked on both chains 2026-09-15 (lib/stride). */
const strideToken = (label: string, sourceDenom: string, terraDenom: string): SourceChain => ({
  chainName: 'stride', chainId: STRIDE_CHAIN_ID, name: 'Stride', prefix: 'stride', terraDenom, sourceDenom, label,
  toTerra: STRIDE_TO_TERRA_CHANNEL, fromTerra: TERRA_TO_STRIDE_CHANNEL, balance: a => strideBalance(a, sourceDenom), feeReserve: BigInt(0),
  feeDenom: STRIDE_FEE_DENOM, feeLabel: 'STRD', feeBalance: a => strideBalance(a, STRIDE_FEE_DENOM),
  txUrl: h => `https://www.mintscan.io/stride/tx/${h}`, never: [],
  footnote: 'The Stride wallet needs a little STRD for the network fee.',
})

const SOURCE_CHAINS: Record<SourceKey, SourceChain> = {
  noble: {
    feeDenom: NOBLE_USDC_DENOM, feeLabel: 'USDC', feeBalance: nobleUsdcBalance,
    chainName: 'noble', chainId: NOBLE_CHAIN_ID, name: 'Noble', prefix: 'noble', terraDenom: NOBLE_USDC, sourceDenom: NOBLE_USDC_DENOM, label: 'USDC',
    toTerra: NOBLE_TO_TERRA_CHANNEL, fromTerra: TERRA_TO_NOBLE_CHANNEL, balance: nobleUsdcBalance, feeReserve: BigInt(50_000),
    txUrl: h => `https://www.mintscan.io/noble/tx/${h}`,
    // USDC.inj is a different dollar with its own switch, so USDC never turns into it here, or comes from it.
    never: [USDC_INJ_DENOM],
    footnote: 'USDC issued on Noble. Noble charges its network fee in USDC.',
  },
  cosmoshub: {
    feeDenom: HUB_ATOM_DENOM, feeLabel: 'ATOM', feeBalance: hubAtomBalance,
    chainName: 'cosmoshub', chainId: HUB_CHAIN_ID, name: 'Cosmos Hub', prefix: 'cosmos', terraDenom: ATOM_DENOM, sourceDenom: HUB_ATOM_DENOM, label: 'ATOM',
    toTerra: HUB_TO_TERRA_CHANNEL, fromTerra: TERRA_TO_HUB_CHANNEL, balance: hubAtomBalance, feeReserve: BigInt(20_000),
    txUrl: h => `https://www.mintscan.io/cosmos/tx/${h}`,
    never: [],
    footnote: 'The Cosmos Hub charges its network fee in ATOM.',
  },
  'neutron-astro': neutronToken('ASTRO', NEUTRON_ASTRO, ASTRO_IBC_DENOM),
  'neutron-datom': neutronToken('dATOM', NEUTRON_DATOM, DATOM_DENOM),
  'neutron-fuel': neutronToken('FUEL', NEUTRON_FUEL, FUEL_DENOM),
  'stride-stluna': strideToken('stLUNA', 'stuluna', STLUNA_DENOM),
  'stride-statom': strideToken('stATOM', 'stuatom', STATOM_DENOM),
}

/** The chains, and the tokens each one moves. */
const BRIDGE_CHAINS: { name: string; tokens: [NetKey, string][] }[] = [
  { name: 'Noble', tokens: [['noble', 'USDC']] },
  { name: 'Cosmos Hub', tokens: [['cosmoshub', 'ATOM']] },
  { name: 'Injective', tokens: [['injective', 'USDC.inj']] },
  { name: 'Neutron', tokens: [['neutron-astro', 'ASTRO'], ['neutron-datom', 'dATOM'], ['neutron-fuel', 'FUEL']] },
  { name: 'Stride', tokens: [['stride-stluna', 'stLUNA'], ['stride-statom', 'stATOM']] },
]
export const isNetKey = (v: string | null): v is NetKey => !!v && BRIDGE_CHAINS.some(c => c.tokens.some(([k]) => k === v))

type TransferStatus = { tx: string; chain: string; text: string; done?: boolean; failed?: boolean }
/** How long to wait for a phone wallet to answer before saying so. */
const CONNECT_WAIT_MS = 120_000

/**
 * About one LUNA for network fees, set aside from a transfer in while the
 * Terra wallet holds almost none (lib/gasDrop). Gives the part to set aside,
 * its router plan once priced, and what the main transfer carries.
 */
function useGasDrop(a: { me: string; incoming: boolean; from: KnownToken; target: KnownToken; amountMicro: string | null; pools: PoolView[]; refresh?: unknown }) {
  const { px } = useTokenData()
  const [terraLuna, setTerraLuna] = useState<string | null>(null)
  const [on, setOn] = useState(true)
  const [priced, setPriced] = useState<{ micro: string; plan: RoutePlan } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (!a.me) { setTerraLuna(null); return }
    queryBalance(a.me, LUNA.info).then(setTerraLuna).catch(() => {})
  }, [a.me, a.refresh])
  const wanted = a.incoming && terraLuna != null && BigInt(terraLuna || '0') < GAS_DROP_BELOW_MICRO && !sameAsset(a.target.info, LUNA.info)
  const micro = wanted ? gasDropMicro({ from: a.from, amountMicro: a.amountMicro, fromUsd: px?.[assetId(a.from.info)], lunaUsd: px?.uluna }) : null
  const { pools, from } = a
  useEffect(() => {
    if (!micro) return
    let alive = true
    planGasDrop(pools, from, micro, 0.03)
      .then(plan => { if (!alive) return; if (plan) setPriced({ micro, plan }); else setFailed(micro) })
      .catch(() => { if (alive) setFailed(micro) })
    return () => { alive = false }
  }, [micro, pools, from])
  const active = on && !!micro && failed !== micro
  const ready = active && priced?.micro === micro
  return {
    micro, on, setOn, active, ready,
    failed: !!micro && failed === micro,
    plan: ready && priced ? priced.plan : null,
    /** what the main transfer carries out of `amount` */
    main: (amount: string | null) => (active && micro && amount && BigInt(amount) > BigInt(micro) ? (BigInt(amount) - BigInt(micro)).toString() : amount),
  }
}

function GasDrop({ gas, from, sourceName }: { gas: ReturnType<typeof useGasDrop>; from: KnownToken; sourceName: string }) {
  if (!gas.micro) return null
  return (
    <div className='sw-gap'>
      <label className='sw-check'>
        <input type='checkbox' checked={gas.on} onChange={e => gas.setOn(e.target.checked)} />
        Also about 1 LUNA for network fees
        <span className='sw-gas-value'>{!gas.on ? '' : gas.failed ? 'no route right now' : gas.plan ? `≈ ${fromMicro(gas.plan.expectedOut, 6, 2)} LUNA for ${amt(gas.micro, from.decimals, 4)} ${from.label}` : 'pricing…'}</span>
      </label>
      {gas.on && !gas.failed && <p className='sw-fine'>Your Terra wallet has almost no LUNA. This part is swapped into LUNA on arrival; if that falls short, {sourceName} returns this part and the rest still arrives.</p>}
    </div>
  )
}

/**
 * Whether an IBC transfer came back, read from the balance it left: once the send shows there, a rise by the
 * whole amount is the chain returning it (a swap on arrival that could not meet its minimum, or a packet nobody
 * relayed in time).
 */
function cameBack(read: () => Promise<string>, before: string, amount: string): () => Promise<boolean> {
  let low: bigint | null = null
  return async () => {
    const now = BigInt((await read()) || '0')
    if (now + BigInt(amount) <= BigInt(before || '0')) { if (low === null || now < low) low = now; return false }
    return low !== null && now >= low + BigInt(amount)
  }
}

/** Follow an IBC transfer until the balance it should arrive in rises, or `returned` sees it come back. */
function followIbc(before: string, readDest: () => Promise<string>, setStatus: (f: (s: TransferStatus | null) => TransferStatus | null) => void, returned?: { check: () => Promise<boolean>; text: string }) {
  let n = 0
  const tick = async () => {
    n++
    const [now, back] = await Promise.all([readDest().catch(() => before), returned ? returned.check().catch(() => false) : Promise.resolve(false)])
    if (BigInt(now || '0') > BigInt(before || '0')) { setStatus(s => s && { ...s, text: 'Arrived.', done: true }); return }
    if (back && returned) { setStatus(s => s && { ...s, text: returned.text, failed: true }); return }
    if (n < 40) setTimeout(tick, 7000)
    else setStatus(s => s && { ...s, text: 'Still on its way. IBC transfers usually land within a few minutes; one that is not delivered goes back.' })
  }
  setTimeout(tick, 6000)
}

const injectiveTxUrl = (hash: string) => `https://www.mintscan.io/injective/tx/${hash}`

/**
 * Connects the wallet on another chain the way the kit does, and gives the wallet's own reason when it says no:
 * the kit records a refusal on the chain wallet instead of throwing it, so the outcome is read from the chain
 * wallet of the wallet Terra is connected with, live, after connecting (components/wallet/kitWallet).
 */
function useConnectOn(chainName: string, name: string) {
  const source = useChain(chainName)
  const { chainWallet: terra } = useWallet()
  const now = useRef({ source, terra })
  now.current = { source, terra }
  return () => {
    const cw = () => now.current.terra?.mainWallet?.getChainWallet(chainName)
    const live: LiveChainWallet = {
      connect: () => now.current.source.connect(),
      get address() { return cw()?.address ?? now.current.source.address },
      get message() { return cw()?.message },
    }
    return connectChainWallet(live, CONNECT_WAIT_MS, name)
  }
}

/** The direction: into Terra, or out of it. */
function Direction({ dir, other, onTurn }: { dir: 'in' | 'out'; other: string; onTurn: (d: 'in' | 'out') => void }) {
  return (
    <div className='of-seg' role='radiogroup' aria-label='Direction'>
      <button type='button' role='radio' aria-checked={dir === 'in'} onClick={() => onTurn('in')}>{other} to Terra</button>
      <button type='button' role='radio' aria-checked={dir === 'out'} onClick={() => onTurn('out')}>Terra to {other}</button>
    </div>
  )
}

function StatusLine({ status, url }: { status: TransferStatus | null; url: (s: TransferStatus) => string }) {
  if (!status) return null
  return (
    <p className={status.failed ? 'sw-error' : status.done ? 'sw-ok' : 'sw-status'} role='status'>
      {status.done && <Icon name='check' size={16} />}{status.text}{' '}
      {status.tx && <a href={url(status)} target='_blank' rel='noopener noreferrer'>View transaction</a>}
    </p>
  )
}

/** A token between Noble, the Cosmos Hub, Neutron or Stride and Terra. */
function CosmosTransfer({ net, routePools, onDone }: { net: SourceChain; routePools: PoolView[]; onDone: () => void }) {
  const me = useMyAddress()
  const source = useChain(net.chainName)
  const sourceMsgs = useCosmosMsgs(net.chainName, net.name)
  const terraMsgs = useTerraMsgs()
  const [dir, setDir] = useState<'in' | 'out'>('in')
  const [amount, setAmount] = useState('')
  const [tokenId, setTokenId] = useState(net.terraDenom)
  const [sendTo, setSendTo] = useState('')
  const [srcBal, setSrcBal] = useState('0')
  const [terraBal, setTerraBal] = useState('0')
  const [quote, setQuote] = useState<{ out: string; secs: number; path: string; note?: string; plan?: RoutePlan; trade?: TradePlan } | null>(null)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [err, setErr] = useState<Failure | null>(null)
  const [status, setStatus] = useState<TransferStatus | null>(null)
  const SLIP = 0.01

  const base = useMemo(() => tokenFor({ native_token: { denom: net.terraDenom } }), [net])
  /** Routes avoid pools holding a token this one is never exchanged for. */
  const pools = useMemo(() => routePools.filter(p => !p.tokens.some(t => net.never.includes(assetId(t.info)))), [routePools, net])
  /** The tokens this site lists: the picker offers no others. */
  const allTokens = useMemo(() => {
    const m = new Map<string, KnownToken>()
    for (const p of pools) for (const t of p.tokens) if (isListed(t.info)) m.set(assetId(t.info), t)
    return Array.from(m.values())
  }, [pools])
  const routable = useMemo(() => reachable(pools, base, allTokens), [pools, base, allTokens])
  /** A deposit can arrive as the token itself, or swapped on arrival by Openfields Swap's router into anything routable. */
  const inOptions = useMemo(() => (TERRA_SWAP_ROUTER ? [base, ...routable] : [base]), [base, routable])
  /** Anything this site can route to the token can leave for its chain. */
  const outOptions = useMemo(() => [base, ...routable], [base, routable])
  const options = dir === 'in' ? inOptions : outOptions
  useEffect(() => { if (!options.some(t => assetId(t.info) === tokenId)) setTokenId(net.terraDenom) }, [options, tokenId, net])
  const token = options.find(t => assetId(t.info) === tokenId) ?? base
  const plain = tokenId === net.terraDenom
  const micro = toMicro(amount, dir === 'in' ? base.decimals : token.decimals)
  const debounced = useDebounced(micro, 400)
  const gas = useGasDrop({ me, incoming: dir === 'in', from: base, target: token, amountMicro: debounced, pools, refresh: status?.done })
  /** What the main transfer carries once about one LUNA's worth is set aside for fees. */
  const mainDebounced = gas.main(debounced)
  const srcAddr = source.address ?? ''
  const isSourceAddress = (a: string) => { try { const { prefix, data } = fromBech32(a); return prefix === net.prefix && data.length === 20 } catch { return false } }
  const destination = dir === 'out' ? (sendTo.trim() || srcAddr) : ''

  useEffect(() => {
    if (!srcAddr) { setSrcBal('0'); return }
    net.balance(srcAddr).then(setSrcBal).catch(() => {})
  }, [srcAddr, net, status?.done])
  // Neutron and Stride take their fee in their own token, not the one being moved: a wallet without any cannot send.
  const [feeBal, setFeeBal] = useState<string | null>(null)
  useEffect(() => {
    if (!srcAddr || net.feeDenom === net.sourceDenom) { setFeeBal(null); return }
    net.feeBalance(srcAddr).then(setFeeBal).catch(() => {})
  }, [srcAddr, net, status?.done])
  useEffect(() => {
    if (!me) { setTerraBal('0'); return }
    queryBalance(me, dir === 'in' ? base.info : token.info).then(setTerraBal).catch(() => {})
  }, [me, dir, token, base, status?.done])

  useEffect(() => {
    let alive = true
    setQuote(null); setQuoteErr(null)
    if (!mainDebounced || mainDebounced === '0') return
    if (plain) {
      setQuote({ out: mainDebounced, secs: 30, path: dir === 'in' ? `IBC transfer from ${net.name} to Terra` : `IBC transfer from Terra to ${net.name}` })
      return
    }
    if (dir === 'in') {
      // One path and no split: the swap on arrival is a single call to the router, run inside the relayer's
      // transaction. Kept to two pools: on 2026-09-14 a two-pool call simulated at 1.02 to 1.10M gas, and the
      // relayer delivering Skip's hooked packets from Noble spent 1.09M of 2.18M the same day.
      quoteBest(pools, base, token, mainDebounced, HOME_VENUE, { slip: SLIP, threeHop: false }).then(q => {
        if (!alive) return
        const plan = q.best ? routerPlan(q.best, SLIP) : null
        if (!q.best || !plan) { setQuoteErr(`No route from ${net.label} to ${token.label} through up to two pools right now. Bring ${net.label} to Terra and swap it here.`); return }
        setQuote({
          out: plan.expectedOut, secs: 45, plan,
          path: `IBC transfer to Terra, swapped on arrival by Openfields Swap's router: ${routeText(q.best)}`,
          note: `At least ${amt(plan.minOut, token.decimals, 6)} ${token.label} arrives, or the swap does not happen and ${net.name} returns the ${net.label} to you.`,
        })
      }).catch(() => { if (alive) setQuoteErr('Could not price that right now.') })
    } else {
      quoteBest(pools, token, base, mainDebounced, HOME_VENUE, { slip: SLIP, split: true }).then(q => {
        if (!alive) return
        if (!q.best) { setQuoteErr(`No route from ${token.label} to ${net.label} right now.`); return }
        const trade = planTrade(q.split ?? [{ quote: q.best, share: 1 }], SLIP)
        setQuote({
          out: trade.minOut, secs: 60, trade, path: `${tradeText(trade.parts)}, then IBC transfer to ${net.name}`,
          note: `About ${amt(trade.expectedOut, base.decimals)} ${net.label} from the swap. At least ${amt(trade.minOut, base.decimals)} is sent to ${net.name}; anything above that stays in your Terra wallet.`,
        })
      }).catch(() => { if (alive) setQuoteErr('Could not price that right now.') })
    }
    return () => { alive = false }
  }, [dir, tokenId, token, plain, mainDebounced, pools, base, net])

  const connectOn = useConnectOn(net.chainName, net.name)
  const connectSource = async () => {
    setErr(null); setConnecting(true)
    try { await connectOn() } catch (e) { setErr(failureOf(e)) } finally { setConnecting(false) }
  }
  const go = async () => {
    setErr(null); setStatus(null)
    if (!micro || micro === '0' || !quote) return
    setBusy(true)
    try {
      if (dir === 'in') {
        if (!me) throw new Error('Connect your wallet first')
        if (!srcAddr) throw new Error(`Connect your wallet on ${net.name} first`)
        // With the fee drop, the main transfer carries the rest and the drop goes as its own transfer, swapped into LUNA on arrival.
        const send = gas.ready ? gas.main(micro) ?? micro : micro
        const drop = gas.ready && gas.plan && gas.micro
          ? [arrivalSwapMsg({ sender: srcAddr, terraAddress: me, channel: net.toTerra, sourceDenom: net.sourceDenom, terraDenom: net.terraDenom, amount: gas.micro, plan: gas.plan })]
          : []
        const msgs: EncodeObject[] = [
          plain
            ? ibcTransferMsg({ sender: srcAddr, receiver: me, channel: net.toTerra, denom: net.sourceDenom, amount: send })
            : arrivalSwapMsg({ sender: srcAddr, terraAddress: me, channel: net.toTerra, sourceDenom: net.sourceDenom, terraDenom: net.terraDenom, amount: send, plan: quote.plan! }),
          ...drop,
        ]
        const [before, srcBefore] = await Promise.all([queryBalance(me, token.info), net.balance(srcAddr)])
        const res = await sourceMsgs.mutateAsync({ msgs, memo: `${plain ? `${net.label} to Terra` : `${net.label} to Terra as ${token.label}`}${drop.length ? ', and LUNA for fees' : ''}` }) as { transactionHash?: string }
        const hash = res?.transactionHash ?? ''
        setStatus({ tx: hash, chain: net.chainId, text: `Sent on ${net.name}. Arriving on Terra as ${token.label}…` })
        if (hash) followIbc(before, () => queryBalance(me, token.info), setStatus, {
          check: cameBack(() => net.balance(srcAddr), srcBefore, send),
          text: plain
            ? `It was not delivered, and the ${net.label} is back on ${net.name}.`
            : `The swap into ${token.label} could not deliver its minimum, so the transfer failed and the ${net.label} is back on ${net.name}. Nothing was swapped.`,
        })
      } else {
        if (!me) throw new Error('Connect your wallet first')
        if (!destination || !isSourceAddress(destination)) throw new Error(`Enter a ${net.name} address, or connect your wallet on ${net.name}`)
        const send = plain ? micro : quote.trade!.minOut
        const msgs = [
          ...(plain ? [] : tradeMsgs(me, quote.trade!, SLIP)),
          ibcTransferMsg({ sender: me, receiver: destination, channel: net.fromTerra, denom: net.terraDenom, amount: send }),
        ]
        const [before, terraBefore] = await Promise.all([net.balance(destination), queryBalance(me, base.info)])
        const res = await terraMsgs.mutateAsync({ msgs, memo: plain ? `${net.label} to ${net.name}` : `${token.label} to ${net.name} as ${net.label}` }) as { transactionHash?: string }
        const hash = res?.transactionHash ?? ''
        setStatus({ tx: hash, chain: TERRA_CHAIN_ID, text: `Sent on Terra. Arriving on ${net.name}…` })
        // Only a plain send can be recognised coming back: after a swap the Terra balance moves for other reasons too.
        if (hash) followIbc(before, () => net.balance(destination), setStatus, plain
          ? { check: cameBack(() => queryBalance(me, base.info), terraBefore, send), text: `It was not delivered, and the ${net.label} is back in your Terra wallet.` }
          : undefined)
      }
      setAmount('')
      onDone()
    } catch (e) {
      const text = String((e as Error)?.message ?? e)
      setErr(dir === 'in' && /retrieve account|account .*not found|does not exist/i.test(text) ? { text: `This wallet has no account on ${net.name} yet. It needs some ${net.label} there first.`, detail: text } : failureOf(e))
    } finally { setBusy(false) }
  }

  const noGas = dir === 'in' && !!srcAddr && feeBal === '0'
  const needSource = dir === 'in' || !sendTo.trim()
  const fromBal = dir === 'in' ? srcBal : terraBal
  const fromDecimals = dir === 'in' ? base.decimals : token.decimals
  const insufficient = !!micro && BigInt(micro) > BigInt(fromBal || '0')
  const canGo = !!me && !!quote && !!micro && micro !== '0' && !insufficient && !busy && (dir === 'in' ? !!srcAddr && !noGas && (!gas.active || gas.ready) : !!destination && isSourceAddress(destination))
  const turn = (d: 'in' | 'out') => { setDir(d); setAmount(''); setStatus(null); setErr(null) }
  const showBal = dir === 'out' || !!srcAddr

  return (
    <div className='sw-stack'>
      <Direction dir={dir} other={net.name} onTurn={turn} />
      <div className='sw-box'>
        <div className='sw-field'>
          <div className='sw-field-head'>
            <label htmlFor='sw-bridge-amount'>From {dir === 'in' ? net.name : 'Terra'}</label>
            {showBal
              ? <span className='sw-field-bal'>{amt(fromBal, fromDecimals)} {dir === 'in' ? net.label : token.label}
                  {Number(fromBal) > 0 && (
                    <button type='button' className='sw-max' onClick={() => {
                      // The source chain takes its network fee in the same token, so leave a little behind when moving all of it.
                      const keep = dir === 'in' ? net.feeReserve : BigInt(0)
                      const max = BigInt(fromBal) > keep ? BigInt(fromBal) - keep : BigInt(0)
                      setAmount(fromMicro(max.toString(), fromDecimals, 6).replace(/,/g, ''))
                    }}>Max</button>
                  )}
                </span>
              : <span className='sw-field-bal'>{net.name} not connected</span>}
          </div>
          <div className='sw-field-main'>
            <input id='sw-bridge-amount' className='sw-amount' type='number' inputMode='decimal' min='0' step='any' placeholder='0' value={amount} onChange={e => setAmount(e.target.value)} />
            {dir === 'in' ? <TokenFixed label={net.label} /> : <TokenSelect value={tokenId} onChange={setTokenId} options={outOptions} label='Token to send' />}
          </div>
        </div>
        <div className='sw-flip-row'>
          <button type='button' className='sw-flip' onClick={() => turn(dir === 'in' ? 'out' : 'in')} aria-label='Turn the direction around'><Icon name='flip' size={18} /></button>
        </div>
        <div className='sw-field'>
          <div className='sw-field-head'><label htmlFor={dir === 'out' ? 'sw-bridge-to' : undefined}>To {dir === 'in' ? 'Terra, as' : `${net.name}`}</label></div>
          {dir === 'in'
            ? <div className='sw-field-main'>
                <span className='sw-amount is-quoted of-num'>{quote && quote.out ? amt(quote.out, token.decimals, 6) : '0'}</span>
                <TokenSelect value={tokenId} onChange={setTokenId} options={inOptions} label='Arrive as' />
              </div>
            : <>
                <input id='sw-bridge-to' className='sw-input sw-input--sm sw-input--mono' placeholder={srcAddr || `${net.prefix}1…`} value={sendTo} onChange={e => setSendTo(e.target.value)} spellCheck={false} autoComplete='off' aria-invalid={!!sendTo.trim() && !isSourceAddress(sendTo.trim())} />
                {sendTo.trim() && !isSourceAddress(sendTo.trim()) && <p className='sw-hint is-bad'>That is not a {net.name} address.</p>}
                {sendTo.trim() && isSourceAddress(sendTo.trim()) && sendTo.trim() !== srcAddr && <p className='sw-hint'>Someone else&apos;s address, or an exchange? Check that it accepts {net.label} on {net.name}.</p>}
                {!sendTo.trim() && srcAddr && <p className='sw-hint'>Your wallet&apos;s {net.name} address.</p>}
              </>}
        </div>
        {(quote || quoteErr) && (
          <div className='sw-box-rows'>
            {quoteErr ? <p className='sw-status'>{quoteErr}</p> : quote && (
              <dl className='sw-rows'>
                <Row k={dir === 'in' ? 'You receive on Terra' : plain ? `You receive on ${net.name}` : `At least, on ${net.name}`} v={`${amt(quote.out, dir === 'in' ? token.decimals : base.decimals, 6)} ${dir === 'in' ? token.label : net.label}`} tone='strong' />
                <Row k='Time' v={`about ${quote.secs < 90 ? `${quote.secs} seconds` : `${Math.round(quote.secs / 60)} minutes`}`} />
                <Row k='How' v={quote.path} tone='muted' />
                {quote.note && <p className='sw-fine'>{quote.note}</p>}
                {dir === 'in' && <GasDrop gas={gas} from={base} sourceName={net.name} />}
              </dl>
            )}
          </div>
        )}
      </div>
      {noGas && <ul className='sw-notes'><li className='is-bad'>This {net.name} wallet has no {net.feeLabel} for the network fee. Add a little first.</li></ul>}
      <div className='sw-act sw-act--dock'>
        <ErrorNote error={err} />
        <StatusLine status={status} url={s => (s.chain === net.chainId ? net.txUrl(s.tx) : SCAN_TX(s.tx))} />
        {!me
          ? <Button variant='primary' size='lg' block onClick={askToConnect}>Connect wallet</Button>
          : needSource && !srcAddr
            ? <Button variant='primary' size='lg' block busy={connecting} onClick={connectSource}>{connecting ? `Approve ${net.name} in your wallet` : `Connect ${net.name}`}</Button>
            : <Button variant='primary' size='lg' block disabled={!canGo} busy={busy} onClick={go}>
                {busy ? 'Confirm in your wallet' : insufficient ? `Not enough ${dir === 'in' ? `${net.label} on ${net.name}` : token.label}` : !micro || micro === '0' ? 'Enter an amount' : dir === 'in' ? 'Move to Terra' : `Move to ${net.name}`}
              </Button>}
      </div>
      <p className='sw-fine'>{net.footnote} A swap on arrival runs in the same transfer, through Openfields Swap&apos;s router. No fee is added here.</p>
    </div>
  )
}

/**
 * USDC.inj between Injective and Terra: ordinary IBC both ways. It leaves
 * Injective as Circle's USDC and arrives on Terra as USDC.inj, a token of its
 * own that this site never exchanges for, or counts as, USDC from Noble.
 * Arriving, it can also be swapped into another token by Openfields Swap's
 * router through Terra's IBC hooks, never into USDC from Noble and never
 * through a pool holding both.
 */
function InjectiveTransfer({ routePools, onDone }: { routePools: PoolView[]; onDone: () => void }) {
  const me = useMyAddress()
  const injective = useChain('injective')
  const injectiveMsgs = useInjectiveMsgs()
  const terraMsgs = useTerraMsgs()
  const [dir, setDir] = useState<'in' | 'out'>('in')
  const [amount, setAmount] = useState('')
  const [injTo, setInjTo] = useState('')
  const [injBal, setInjBal] = useState('0')
  const [injGas, setInjGas] = useState<string | null>(null)
  const [terraBal, setTerraBal] = useState('0')
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [err, setErr] = useState<Failure | null>(null)
  const [status, setStatus] = useState<TransferStatus | null>(null)
  const token = useMemo(() => tokenFor({ native_token: { denom: USDC_INJ_DENOM } }), [])
  const micro = toMicro(amount, 6)
  const injAddr = injective.address ?? ''
  const typed = injTo.trim()
  const typedAddr = typed ? toInjectiveAddress(typed) : null
  const destination = typed ? typedAddr ?? '' : injAddr

  // Swap on arrival: through any pool that does not hold USDC from Noble, into anything but USDC from Noble.
  const SLIP = 0.01
  const [targetId, setTargetId] = useState(USDC_INJ_DENOM)
  const [quote, setQuote] = useState<{ plan: RoutePlan; path: string } | null>(null)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const pools = useMemo(() => routePools.filter(p => !p.tokens.some(t => assetId(t.info) === NOBLE_USDC)), [routePools])
  const arriveOptions = useMemo(() => {
    const m = new Map<string, KnownToken>()
    // Listed tokens only, as in every picker.
    for (const p of pools) for (const t of p.tokens) if (isListed(t.info)) m.set(assetId(t.info), t)
    return TERRA_SWAP_ROUTER ? [token, ...reachable(pools, token, Array.from(m.values()))] : [token]
  }, [pools, token])
  useEffect(() => { if (!arriveOptions.some(t => assetId(t.info) === targetId)) setTargetId(USDC_INJ_DENOM) }, [arriveOptions, targetId])
  const target = arriveOptions.find(t => assetId(t.info) === targetId) ?? token
  const plain = dir === 'out' || targetId === USDC_INJ_DENOM
  const debounced = useDebounced(micro, 400)
  const gas = useGasDrop({ me, incoming: dir === 'in', from: token, target, amountMicro: debounced, pools, refresh: status?.done })
  const mainDebounced = gas.main(debounced)
  useEffect(() => {
    let alive = true
    setQuote(null); setQuoteErr(null)
    if (plain || !mainDebounced || mainDebounced === '0') return
    // One path through up to two pools, for the same reason as from Noble: it runs inside the relayer's transaction.
    quoteBest(pools, token, target, mainDebounced, HOME_VENUE, { slip: SLIP, threeHop: false }).then(q => {
      if (!alive) return
      const plan = q.best ? routerPlan(q.best, SLIP) : null
      if (!q.best || !plan) { setQuoteErr(`No route from USDC.inj to ${target.label} through up to two pools right now. Bring USDC.inj to Terra and swap it here.`); return }
      setQuote({ plan, path: `IBC transfer to Terra, swapped on arrival by Openfields Swap's router: ${routeText(q.best)}` })
    }).catch(() => { if (alive) setQuoteErr('Could not price that right now.') })
    return () => { alive = false }
  }, [plain, mainDebounced, pools, token, target])

  useEffect(() => {
    if (!injAddr) { setInjBal('0'); setInjGas(null); return }
    injectiveBalance(injAddr, USDC_INJ_ON_INJECTIVE).then(setInjBal).catch(() => {})
    injectiveBalance(injAddr, 'inj').then(setInjGas).catch(() => {})
  }, [injAddr, status?.done])
  useEffect(() => {
    if (!me) { setTerraBal('0'); return }
    queryBalance(me, token.info).then(setTerraBal).catch(() => {})
  }, [me, token, status?.done])

  const turn = (d: 'in' | 'out') => { setDir(d); setAmount(''); setStatus(null); setErr(null) }
  const connectOn = useConnectOn('injective', 'Injective')
  const connectInjective = async () => {
    setErr(null); setConnecting(true)
    try { await connectOn() } catch (e) { setErr(failureOf(e)) } finally { setConnecting(false) }
  }

  const go = async () => {
    setErr(null); setStatus(null)
    if (!micro || micro === '0') return
    setBusy(true)
    try {
      if (!me) throw new Error('Connect your wallet first')
      if (dir === 'in') {
        if (!injAddr) throw new Error('Connect your wallet on Injective first')
        if (!plain && !quote) throw new Error('Wait for the price, then try again')
        const [before, injBefore] = await Promise.all([queryBalance(me, target.info), injectiveBalance(injAddr, USDC_INJ_ON_INJECTIVE)])
        const send = gas.ready ? gas.main(micro) ?? micro : micro
        const drop = gas.ready && gas.plan && gas.micro
          ? [arrivalSwapMsg({ sender: injAddr, terraAddress: me, channel: INJECTIVE_TO_TERRA_CHANNEL, sourceDenom: USDC_INJ_ON_INJECTIVE, terraDenom: USDC_INJ_DENOM, amount: gas.micro, plan: gas.plan })]
          : []
        const hash = await injectiveMsgs.mutateAsync({
          msgs: [
            plain
              ? ibcTransferMsg({ sender: injAddr, receiver: me, channel: INJECTIVE_TO_TERRA_CHANNEL, denom: USDC_INJ_ON_INJECTIVE, amount: send })
              : arrivalSwapMsg({ sender: injAddr, terraAddress: me, channel: INJECTIVE_TO_TERRA_CHANNEL, sourceDenom: USDC_INJ_ON_INJECTIVE, terraDenom: USDC_INJ_DENOM, amount: send, plan: quote!.plan }),
            ...drop,
          ],
          memo: `${plain ? 'USDC.inj to Terra' : `USDC.inj to Terra as ${target.label}`}${drop.length ? ', and LUNA for fees' : ''}`,
        })
        setStatus({ tx: hash, chain: INJECTIVE_CHAIN_ID, text: `Sent on Injective. Arriving on Terra as ${target.label}…` })
        if (hash) followIbc(before, () => queryBalance(me, target.info), setStatus, plain ? undefined : {
          check: cameBack(() => injectiveBalance(injAddr, USDC_INJ_ON_INJECTIVE), injBefore, send),
          text: `The swap into ${target.label} could not deliver its minimum, so the transfer failed and the USDC.inj is back on Injective. Nothing was swapped.`,
        })
      } else {
        if (!destination) throw new Error('Enter an Injective address (inj1… or 0x…), or connect your wallet on Injective')
        const before = await injectiveBalance(destination, USDC_INJ_ON_INJECTIVE).catch(() => '0')
        const res = await terraMsgs.mutateAsync({
          msgs: [ibcTransferMsg({ sender: me, receiver: destination, channel: TERRA_TO_INJECTIVE_CHANNEL, denom: USDC_INJ_DENOM, amount: micro })],
          memo: 'USDC.inj to Injective',
        }) as { transactionHash?: string }
        const hash = res?.transactionHash ?? ''
        setStatus({ tx: hash, chain: TERRA_CHAIN_ID, text: 'Sent on Terra. Arriving on Injective…' })
        if (hash) followIbc(before, () => injectiveBalance(destination, USDC_INJ_ON_INJECTIVE), setStatus)
      }
      setAmount('')
      onDone()
    } catch (e) {
      setErr(failureOf(e))
    } finally { setBusy(false) }
  }

  const fromBal = dir === 'in' ? injBal : terraBal
  const insufficient = !!micro && BigInt(micro) > BigInt(fromBal || '0')
  const noGas = dir === 'in' && !!injAddr && injGas === '0'
  const needInjective = dir === 'in' || !typed
  const canGo = !!me && !!micro && micro !== '0' && !insufficient && !busy && (dir === 'in' ? !!injAddr && !noGas && (!gas.active || gas.ready) && (plain || (!!quote && quote.plan.legs[0]?.offerAmount === (gas.ready ? gas.main(micro) : micro))) : !!destination)
  const showBal = dir === 'out' || !!injAddr

  return (
    <div className='sw-stack'>
      <Direction dir={dir} other='Injective' onTurn={turn} />
      <div className='sw-box'>
        <div className='sw-field'>
          <div className='sw-field-head'>
            <label htmlFor='sw-inj-amount'>From {dir === 'in' ? 'Injective' : 'Terra'}</label>
            {showBal
              ? <span className='sw-field-bal'>{amt(fromBal, 6)} USDC.inj
                  {/* Injective takes its fee in INJ, so all of the USDC.inj can go. */}
                  {Number(fromBal) > 0 && <button type='button' className='sw-max' onClick={() => setAmount(fromMicro(fromBal, 6, 6).replace(/,/g, ''))}>Max</button>}
                </span>
              : <span className='sw-field-bal'>Injective not connected</span>}
          </div>
          <div className='sw-field-main'>
            <input id='sw-inj-amount' className='sw-amount' type='number' inputMode='decimal' min='0' step='any' placeholder='0' value={amount} onChange={e => setAmount(e.target.value)} />
            <TokenFixed label='USDC.inj' />
          </div>
        </div>
        <div className='sw-flip-row'>
          <button type='button' className='sw-flip' onClick={() => turn(dir === 'in' ? 'out' : 'in')} aria-label='Turn the direction around'><Icon name='flip' size={18} /></button>
        </div>
        <div className='sw-field'>
          <div className='sw-field-head'><label htmlFor={dir === 'out' ? 'sw-inj-to' : undefined}>To {dir === 'in' ? 'Terra, as' : 'Injective'}</label></div>
          {dir === 'in'
            ? <div className='sw-field-main'>
                <span className='sw-amount is-quoted of-num'>{!micro || micro === '0' ? '0' : plain ? amt(gas.ready ? gas.main(micro) ?? micro : micro, 6, 6) : quote ? amt(quote.plan.expectedOut, target.decimals, 6) : '…'}</span>
                <TokenSelect value={targetId} onChange={setTargetId} options={arriveOptions} label='Arrive as' />
              </div>
            : <>
                <input id='sw-inj-to' className='sw-input sw-input--sm sw-input--mono' placeholder={injAddr || 'inj1… or 0x…'} value={injTo} onChange={e => setInjTo(e.target.value)} spellCheck={false} autoComplete='off' aria-invalid={!!typed && !typedAddr} />
                {typed && !typedAddr && <p className='sw-hint is-bad'>That is not an Injective address.</p>}
                {typedAddr && /^0x/i.test(typed) && <p className='sw-hint'>Goes to {typedAddr}, the same Injective account as that 0x address.</p>}
                {typedAddr && typedAddr !== injAddr && <p className='sw-hint'>Someone else&apos;s address, or an exchange? Check that it accepts USDC on Injective arriving over IBC.</p>}
                {!typed && injAddr && <p className='sw-hint'>Your wallet&apos;s Injective address.</p>}
              </>}
        </div>
        {!!micro && micro !== '0' && (
          <div className='sw-box-rows'>
            <dl className='sw-rows'>
              {plain
                ? <Row k={dir === 'in' ? 'You receive on Terra' : 'You receive on Injective'} v={`${amt(dir === 'in' && gas.ready ? gas.main(micro) ?? micro : micro, 6, 6)} USDC.inj`} tone='strong' />
                : quoteErr
                  ? <p className='sw-status'>{quoteErr}</p>
                  : quote
                    ? <>
                        <Row k='You receive on Terra' v={`${amt(quote.plan.expectedOut, target.decimals, 6)} ${target.label}`} tone='strong' />
                        <Row k='At least' v={`${amt(quote.plan.minOut, target.decimals, 6)} ${target.label}`} />
                        <Row k='How' v={quote.path} tone='muted' />
                      </>
                    : <p className='sw-status'>Pricing the swap on arrival…</p>}
              <Row k='Time' v={plain ? 'about 30 seconds' : 'about 45 seconds'} />
              <Row k='Network fee' v={dir === 'in' ? 'a little INJ, on Injective' : 'a little LUNA, on Terra'} tone='muted' />
              {!plain && quote && <p className='sw-fine'>Or the swap does not happen and Injective returns the USDC.inj to you.</p>}
              {dir === 'in' && <GasDrop gas={gas} from={token} sourceName='Injective' />}
            </dl>
          </div>
        )}
      </div>
      {noGas && <ul className='sw-notes'><li className='is-bad'>This Injective wallet has no INJ for the network fee. Add a little first.</li></ul>}
      <div className='sw-act sw-act--dock'>
        <ErrorNote error={err} />
        <StatusLine status={status} url={s => (s.chain === INJECTIVE_CHAIN_ID ? injectiveTxUrl(s.tx) : SCAN_TX(s.tx))} />
        {!me
          ? <Button variant='primary' size='lg' block onClick={askToConnect}>Connect wallet</Button>
          : needInjective && !injAddr
            ? <Button variant='primary' size='lg' block busy={connecting} onClick={connectInjective}>{connecting ? 'Approve Injective in your wallet' : 'Connect Injective'}</Button>
            : <Button variant='primary' size='lg' block disabled={!canGo} busy={busy} onClick={go}>
                {busy ? 'Confirm in your wallet' : insufficient ? `Not enough USDC.inj${dir === 'in' ? ' on Injective' : ''}` : !micro || micro === '0' ? 'Enter an amount' : dir === 'in' ? 'Move to Terra' : 'Move to Injective'}
              </Button>}
      </div>
      <p className='sw-fine'>USDC.inj is Circle&apos;s USDC issued on Injective; on Terra it is its own token, never swapped for USDC from Noble. Injective charges its network fee in INJ. No fee is added here.</p>
    </div>
  )
}

/** Which chain, then which of its tokens. */
export default function Bridge({ routePools, onDone, initialNet = 'noble' }: { routePools: PoolView[]; onDone: () => void; initialNet?: NetKey }) {
  const [net, setNet] = useState<NetKey>(initialNet)
  const chain = BRIDGE_CHAINS.find(c => c.tokens.some(([k]) => k === net)) ?? BRIDGE_CHAINS[0]
  return (
    <section className='sw-page sw-narrow' aria-labelledby='sw-bridge-title'>
      <h1 id='sw-bridge-title' className='sw-title'>Bridge</h1>
      <p className='sw-lede'>Move tokens between Terra and other chains, in one signature.</p>
      <div className='sw-bridge-chains' role='group' aria-label='Chain'>
        {BRIDGE_CHAINS.map(c => (
          <button key={c.name} type='button' className='of-chip' aria-pressed={c === chain} onClick={() => setNet(c.tokens[0][0])}
            title={`${c.tokens.map(([, label]) => label).join(', ')} on ${c.name}`}>
            <TokenIcon label={c.tokens[0][1]} size={20} />{c.name}
          </button>
        ))}
      </div>
      {chain.tokens.length > 1 && (
        <div className='sw-chip-row sw-gap' role='group' aria-label='Token'>
          {chain.tokens.map(([k, label]) => (
            <button key={k} type='button' className='of-chip' aria-pressed={net === k} onClick={() => setNet(k)}><TokenIcon label={label} size={20} />{label}</button>
          ))}
        </div>
      )}
      <div className='sw-gap'>
        {net === 'injective'
          ? <InjectiveTransfer routePools={routePools} onDone={onDone} />
          : <CosmosTransfer key={net} net={SOURCE_CHAINS[net]} routePools={routePools} onDone={onDone} />}
      </div>
    </section>
  )
}
