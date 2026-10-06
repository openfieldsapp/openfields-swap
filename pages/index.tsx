/**
 * Openfields Swap. Served at /.
 *
 * The swap box first; pools, the portfolio, the bridge and the board are
 * places of their own (?tab=pools…), reached from the header. This page reads
 * the pools and the market and hands them to each screen.
 *
 * Pools are Astroport's audited xyk pair code, created through a factory
 * whose ownership and admin keys have been renounced. This interface takes
 * no fee; the pool fee goes to liquidity providers. Renders "not live yet"
 * until NEXT_PUBLIC_DEX_FACTORY is set.
 */

import Head from 'next/head'
import type { GetStaticProps } from 'next'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useMyAddress from 'components/hooks/useMyAddress'
import AppShell from 'components/shell/AppShell'
import { SectionNav, type Section, type SectionNavValue } from 'components/shell/nav'
import { Icon } from 'components/ui'
import CommandPalette, { type PaletteItem } from 'components/CommandPalette'
import { PairIcons, TokenIcon } from 'components/TokenIcon'
import SwapBox, { type SwapPreset } from 'components/swap/SwapBox'
import Pools, { type PoolsFocus } from 'components/swap/Pools'
import CreatePool from 'components/swap/CreatePool'
import Portfolio, { type PortfolioView } from 'components/swap/Portfolio'
import Bridge, { isNetKey, type NetKey } from 'components/swap/Bridge'
import Board from 'components/swap/Board'
import LoopCard from 'components/swap/LoopCard'
import { Toast, liquidityByToken, publishTokenData } from 'components/swap/common'
import { isCrystalHolder } from 'lib/holders'
import {
  KNOWN_TOKENS, NOBLE_USDC, USDC_INJ_DENOM, assetId, fromMicro, annotateMarket, annotateValues, IS_ASTRO, VENUE_NAME,
  type PoolView, type KnownToken,
} from 'lib/dex'
import { arbPlans, type ArbPlan } from 'lib/arb'
import type { DexResponse } from 'lib/api/dex'
import type { BoardResponse } from 'lib/api/dex-leaderboard'
import type { VenueResponse } from 'lib/api/dex-venue'
import type { SkeletonResponse } from 'lib/api/dex-skeleton'
import type { HoldersResponse, PoolHolders } from 'lib/api/dex-holders'
import { TOKEN_META } from 'lib/tokenMeta'
import { fmtUsdPrice, useAlertWatcher, usePrefs } from 'lib/alerts'
import { LANGS, setLang, useLang } from 'lib/i18n'
import { poll } from 'lib/pageActive'
import { SITE_URL } from 'lib/siteUrl'
import { GOV_URL, HOME_URL, NFT_URL } from 'lib/products'

/**
 * How often an open page reads each of the site's lists, and only while someone
 * is looking (lib/pageActive). No faster than the lists change: the pool-scan
 * workflow rebuilds this site's pools every minute, the other venues' every
 * 2.5 minutes and the market reference every five (lib/scanPlan), and the LP
 * holders are cached ten minutes. Every read is a request Vercel counts.
 */
const POLL_MS = { pools: 60_000, venues: 180_000, market: 300_000, holders: 600_000 } as const

type Tab = 'swap' | 'pools' | 'positions' | 'wallet' | 'history' | 'transfer' | 'create' | 'board'

/**
 * Each place has an address (?tab=bridge, ?tab=portfolio…), so any of them can be linked to and survives
 * a reload. Named for what people call them; the keys inside stay as they were. Swap is the page itself.
 */
const TAB_PARAM: Record<Tab, string> = { swap: '', pools: 'pools', positions: 'portfolio', wallet: 'wallet', history: 'history', transfer: 'bridge', create: 'open-pool', board: 'board' }
const PARAM_TAB: Record<string, Tab> = { pools: 'pools', portfolio: 'positions', positions: 'positions', wallet: 'wallet', history: 'history', bridge: 'transfer', transfer: 'transfer', 'open-pool': 'create', create: 'create', board: 'board' }
const SECTION_TAB: Record<Section, Tab> = { swap: 'swap', pools: 'pools', portfolio: 'positions', bridge: 'transfer', board: 'board' }
const sectionOf = (tab: Tab): Section => tab === 'create' ? 'pools' : tab === 'positions' || tab === 'wallet' || tab === 'history' ? 'portfolio' : tab === 'transfer' ? 'bridge' : tab

/** Astroport mode: this page as a plain interface to Astroport's pools. See DEX_MODE in lib/dex. */
const LITE = IS_ASTRO
const APP_NAME = LITE ? 'Openfields Pools' : 'Openfields Swap'
/** Pools under this much liquidity are folded away until asked for. */
const DUST_USD = 10

export default function SwapPage() {
  const me = useMyAddress()
  const { lang, t } = useLang()
  const [data, setData] = useState<DexResponse | null>(null)
  const [board, setBoard] = useState<BoardResponse | null>(null)
  const [tab, setTabState] = useState<Tab>('swap')
  const [crystal, setCrystal] = useState(false)
  const [toast, setToast] = useState<{ msg: string; href?: string } | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const [spotlight, setSpotlight] = useState('')
  const [bridgeNet, setBridgeNet] = useState<NetKey>('noble')
  const [palette, setPalette] = useState(false)

  /** A new place starts at the top. */
  const setTab = useCallback((next: Tab) => { setTabState(next); window.scrollTo({ top: 0 }) }, [])

  // A shared link lands where it points: ?tab=bridge opens that place, ?who=terra1… opens the board on their row.
  const tabFromUrl = useRef(false)
  /** A pool a link asked for (?pool=terra1…, from a pool's own page), opened once the pools are in. */
  const wantPool = useRef('')
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const linked = PARAM_TAB[params.get('tab') ?? '']
      if (linked && !(LITE && linked === 'board')) setTabState(linked)
      const net = params.get('net')
      if (isNetKey(net)) setBridgeNet(net)
      const pool = params.get('pool') || ''
      if (/^terra1[0-9a-z]{38,}$/.test(pool)) wantPool.current = pool
      const who = params.get('who') || ''
      if (!LITE && /^terra1[0-9a-z]{38,}$/.test(who)) { setSpotlight(who); setTabState('board') }
      if (params.get('search') === '1') setPalette(true)
    } catch { /* ssr */ }
    tabFromUrl.current = true
  }, [])
  // …and the address follows the place, once the one it asked for has been opened.
  useEffect(() => {
    if (!tabFromUrl.current) return
    try {
      const u = new URL(window.location.href)
      const want = TAB_PARAM[tab]
      u.searchParams.delete('search')
      if ((u.searchParams.get('tab') ?? '') === want && u.toString() === window.location.href) return
      if (want) u.searchParams.set('tab', want); else u.searchParams.delete('tab')
      window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`)
    } catch { /* sandboxed */ }
  }, [tab])

  // Market reference arrives on the side; the page never waits for it.
  const marketRef = useRef<Record<string, number> | null>(null)
  const [marketPx, setMarketPx] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    let alive = true
    const pull = () => fetch('/api/dex-market').then(r => r.ok ? r.json() : null).then((j: { px?: Record<string, number> } | null) => {
      if (!alive || !j?.px || Object.keys(j.px).length < 2) return
      marketRef.current = j.px
      setMarketPx(j.px)
      setData(d => d ? { ...d, pools: annotateValues(annotateMarket(d.pools.map(p => ({ ...p })), j.px!), j.px!) } : d)
    }).catch(() => {})
    const stop = poll(pull, POLL_MS.market)
    return () => { alive = false; stop() }
  }, [])

  /* Pools that have drifted off the reference, sized and priced. Bots skip these: the gaps are worth a few
     dollars, under the cost of running a bot and in reach of a person who is already looking.
     Not in Astroport mode: the sizing maths is constant-product, and most of their depth is concentrated. */
  const arbs = useMemo(() => (data?.live && !LITE ? arbPlans(data.pools, marketPx) : []), [data, marketPx])

  /** The other site's pools: routed through, and listed in Pools. Arrives on the side; swaps work without it. */
  const [venuePools, setVenuePools] = useState<PoolView[]>([])
  useEffect(() => {
    let alive = true
    const pull = () => fetch('/api/dex-venue').then(r => (r.ok ? r.json() : null)).then((j: VenueResponse | null) => {
      if (alive && j?.pools) setVenuePools(j.pools)
    }).catch(() => {})
    const stop = poll(pull, POLL_MS.venues)
    return () => { alive = false; stop() }
  }, [])
  /**
   * Skeleton Swap's pools (lib/skeleton): listed in Pools, and routed through by the swap when their swaps are on.
   * Not used by zaps or swaps on arrival, which need a router that cannot reach them.
   */
  const [skeletonPools, setSkeletonPools] = useState<PoolView[]>([])
  useEffect(() => {
    if (LITE) return
    let alive = true
    const pull = () => fetch('/api/dex-skeleton').then(r => (r.ok ? r.json() : null)).then((j: SkeletonResponse | null) => {
      if (alive && j?.pools) setSkeletonPools(j.pools)
    }).catch(() => {})
    const stop = poll(pull, POLL_MS.venues)
    return () => { alive = false; stop() }
  }, [])
  const swapVenuePools = useMemo(() => [...venuePools, ...skeletonPools.filter(p => p.swapsEnabled === true)], [venuePools, skeletonPools])
  /** Every venue's pools in one list: both sites', and Skeleton Swap's. */
  const allPools = useMemo(() => {
    const own = data?.pools ?? []
    const seen = new Set(own.map(p => p.contract_addr))
    const away = venuePools.filter(p => !seen.has(p.contract_addr))
    away.forEach(p => seen.add(p.contract_addr))
    return [...own, ...away, ...skeletonPools.filter(p => !seen.has(p.contract_addr))]
  }, [data, venuePools, skeletonPools])

  /** Who holds each pool's LP. Arrives on the side; the page never waits for it. */
  const [holders, setHolders] = useState<Record<string, PoolHolders>>({})
  useEffect(() => {
    if (LITE) return
    let alive = true
    const pull = () => fetch('/api/dex-holders').then(r => (r.ok ? r.json() : null)).then((j: HoldersResponse | null) => {
      if (alive && j?.pools) setHolders(j.pools)
    }).catch(() => {})
    const stop = poll(pull, POLL_MS.holders)
    return () => { alive = false; stop() }
  }, [])
  const routePoolsAll = useMemo(() => [...(data?.pools ?? []).filter(p => !p.empty), ...venuePools], [data, venuePools])
  // Every token picker ranks by these.
  useEffect(() => { publishTokenData({ px: marketPx, liquidity: liquidityByToken(routePoolsAll) }) }, [marketPx, routePoolsAll])

  // Price alerts (lib/alerts): read the market reference as often as it changes while any alert is waiting, and say so when one goes off.
  const { alerts: priceAlerts } = usePrefs()
  const alertsArmed = priceAlerts.some(a => !a.firedAt)
  const [alertPx, setAlertPx] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    if (!alertsArmed) return
    let alive = true
    const read = () => fetch('/api/dex-market').then(r => (r.ok ? r.json() : null)).then((j: { px?: Record<string, number> } | null) => { if (alive && j?.px) setAlertPx(j.px) }).catch(() => {})
    const stop = poll(read, POLL_MS.market)
    return () => { alive = false; stop() }
  }, [alertsArmed])
  useAlertWatcher(alertPx ?? marketPx, fired => setToast({ msg: fired.map(f => `${f.label} is ${f.dir} $${fmtUsdPrice(f.usd)}: $${fmtUsdPrice(f.firedUsd ?? 0)} now.`).join(' ') }))

  /** "Close the gap" opens the round trip in one transaction. The one-sided trade stays as the fallback. */
  const [loopFor, setLoopFor] = useState<ArbPlan | null>(null)
  const [preset, setPreset] = useState<SwapPreset | null>(null)
  const oneSided = useCallback((plan: ArbPlan) => {
    setLoopFor(null)
    setPreset({ fromId: assetId(plan.inToken.info), toId: assetId(plan.outToken.info), amount: fromMicro(plan.inMicro, plan.inToken.decimals, 6).replace(/,/g, ''), n: Date.now() })
    setTab('swap')
  }, [setTab])
  const takeArb = useCallback((plan: ArbPlan) => { setLoopFor(plan); setTab('swap') }, [setTab])

  // ── Finding things: search, and the ways into each place ──
  // Installing as an app: browsers that offer it hand over the prompt, which search then offers.
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => Promise<void> } | null>(null)
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setInstallPrompt(e as unknown as { prompt: () => Promise<void> }) }
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  const openBridge = useCallback((net: NetKey) => { setBridgeNet(net); setTab('transfer') }, [setTab])
  /** Open Pools on something in it, clearing whatever would hide it. */
  const [poolsFocus, setPoolsFocus] = useState<PoolsFocus | null>(null)
  const openInPools = useCallback((elementId: string, dust = false, query = '') => {
    setPoolsFocus({ elementId, dust, query, n: Date.now() })
    setTab('pools')
  }, [setTab])
  useEffect(() => {
    const addr = wantPool.current
    const p = addr ? allPools.find(x => x.contract_addr === addr) : undefined
    if (!p) return
    wantPool.current = ''
    openInPools(`pool-${addr}`, (p.tvlUsd ?? 0) < DUST_USD)
  }, [allPools, openInPools])
  /** A swap with the pair filled in and the amount left to the person. */
  const openSwap = useCallback((fromId: string, toId: string) => {
    setLoopFor(null)
    setPreset({ fromId, toId, amount: '', n: Date.now() })
    setTab('swap')
  }, [setTab])

  const nav = useMemo<SectionNavValue>(() => ({
    here: sectionOf(tab),
    go: s => { if (s === 'swap') { setLoopFor(null); setSpotlight('') } setTab(SECTION_TAB[s]) },
    search: () => setPalette(true),
  }), [tab, setTab])

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const go = (s: Tab) => () => setTab(s)
    const page = (href: string) => () => { window.location.href = href }
    const items: PaletteItem[] = [
      { id: 'go-swap', group: 'Go to', label: 'Swap', hint: "the best route through Openfields Swap's, Astroport's and Skeleton Swap's pools", keywords: 'trade exchange buy sell convert skeleton white whale', run: go('swap') },
      { id: 'go-pools', group: 'Go to', label: 'Pools', hint: `${allPools.length} pools: add, zap in, remove`, keywords: 'liquidity lp provide add remove zap fees skeleton white whale', run: go('pools') },
      { id: 'go-bridge', group: 'Go to', label: 'Bridge', hint: 'Noble, the Cosmos Hub, Injective, Neutron and Stride, both ways', keywords: 'transfer ibc deposit withdraw move chains', run: go('transfer') },
      { id: 'go-positions', group: 'Go to', label: 'Portfolio', hint: 'positions on every site, staked LP included', keywords: 'positions lp exit withdraw staked rewards claim holdings', run: go('positions') },
      { id: 'go-history', group: 'Go to', label: 'History', hint: 'your swaps, liquidity and transfers', keywords: 'transactions receipts activity past', run: go('history') },
      ...(!LITE ? [{ id: 'go-board', group: 'Go to', label: 'Board', hint: 'who was here first, and what they did', keywords: 'leaderboard points badges ranks', run: go('board') }] : []),
      { id: 'do-bridge-noble', group: 'Do', label: 'Bring USDC in from Noble', hint: 'arrives as USDC, or swapped on arrival', keywords: 'bridge deposit transfer ibc noble usdc move in', run: () => openBridge('noble') },
      { id: 'do-bridge-hub', group: 'Do', label: 'Bring ATOM in from the Cosmos Hub', hint: 'arrives as ATOM, or swapped on arrival', keywords: 'bridge deposit transfer ibc cosmos hub atom move in', run: () => openBridge('cosmoshub') },
      { id: 'do-bridge-inj', group: 'Do', label: 'Bring USDC.inj in from Injective', hint: 'arrives as USDC.inj, or swapped on arrival', keywords: 'bridge deposit transfer ibc injective usdc.inj move in', run: () => openBridge('injective') },
      { id: 'do-bridge-neutron', group: 'Do', label: 'Bring ASTRO, dATOM or FUEL in from Neutron', hint: 'arrives as itself, or swapped on arrival', keywords: 'bridge deposit transfer ibc neutron astro datom drop fuel move in', run: () => openBridge('neutron-astro') },
      { id: 'do-bridge-stride', group: 'Do', label: 'Bring stLUNA or stATOM in from Stride', hint: 'arrives as itself, or swapped on arrival', keywords: 'bridge deposit transfer ibc stride stluna statom staked move in', run: () => openBridge('stride-stluna') },
      { id: 'do-lst', group: 'Do', label: 'Liquid staking against the hubs', hint: 'when redeeming ampLUNA or bLUNA at its hub beats selling in the pool', keywords: 'lst stake unstake redeem mint ampluna bluna eris backbone hub', run: () => openInPools('lst') },
      ...(arbs[0] ? [{ id: 'do-gap', group: 'Do', label: 'Close the biggest gap', hint: `${arbs[0].pool.label} is ${arbs[0].off.toFixed(1)}× off the market`, keywords: 'arbitrage arb drift gap off market', run: () => takeArb(arbs[0]) }] : []),
      { id: 'do-open-pool', group: 'Do', label: 'Open a pool', hint: "on Openfields Swap's or Astroport's factory, one signature", keywords: 'create new pair pool list token factory', run: go('create') },
      { id: 'do-sweep', group: 'Do', label: 'Sell small balances in one go', hint: 'leftover tokens into USDC or LUNA, one signature', keywords: 'sweep dust leftovers clean wallet balances sell all convert', run: go('wallet') },
      { id: 'do-receive', group: 'Do', label: 'Receive an exact amount', hint: 'type what should arrive, and the swap works out what to pay', keywords: 'exact output receive exactly pay request invoice amount out', run: () => { setTab('swap'); setTimeout(() => document.querySelector<HTMLInputElement>('input[data-receive]')?.focus(), 200) } },
      { id: 'do-export', group: 'Do', label: 'Export your history as CSV', hint: 'every transaction of a year, in the columns tax software imports', keywords: 'csv export download tax koinly report history transactions year', run: go('history') },
      { id: 'do-contacts', group: 'Do', label: 'Send to a saved address', hint: 'an address book with memos, kept in this browser', keywords: 'send transfer address book contacts saved recipient memo exchange', run: go('wallet') },
      { id: 'do-alerts', group: 'Do', label: 'Price alerts and favourites', hint: 'kept in this browser; set an alert on any token page', keywords: 'alert notify notification price watch favourite favorite star push closed', run: go('wallet') },
      {
        id: 'do-install', group: 'Do', label: `Install ${APP_NAME} as an app`, hint: installPrompt ? 'on this device, with its own icon' : 'on a phone: Share, then Add to Home Screen',
        keywords: 'install app pwa home screen phone mobile desktop',
        run: () => { if (installPrompt) installPrompt.prompt().catch(() => {}); else setToast({ msg: 'On a phone: open the browser menu or Share, then Add to Home Screen.' }) },
      },
      ...LANGS.map(l => ({
        id: `lang-${l.code}`, group: 'Do', label: `Language: ${l.name}`, hint: l.code === lang ? 'in use' : 'the swap, the token picker and the wallet',
        keywords: `language lang translate ${l.code} ${l.name} english korean spanish vietnamese 한국어 español tiếng việt`, run: () => setLang(l.code),
      })),
      { id: 'page-how', group: 'Pages', label: 'How it works', hint: 'routing, fees, the contracts and what can go wrong', keywords: 'about help faq fees risks', run: page('/how') },
      { id: 'page-stats', group: 'Pages', label: 'Stats', hint: 'liquidity, fees paid to providers, liquid staking, routing and uptime', keywords: 'analytics numbers volume tvl uptime data', run: page('/stats') },
      { id: 'page-verify', group: 'Pages', label: 'Verify the contracts', hint: 'no owner and no admin, checked from your browser', keywords: 'security audit renounced keys checksum trust safe', run: page('/verify') },
      { id: 'page-developers', group: 'Pages', label: `Build with ${APP_NAME}`, hint: 'embed a live quote on your site, or call the quote API', keywords: 'developers api embed widget iframe quote integrate', run: page('/developers') },
      { id: 'page-source', group: 'Pages', label: 'Source code', hint: 'MIT licensed; anyone can run their own copy', keywords: 'github open source code repository', run: () => { window.open('https://github.com/openfieldsapp/openfields-swap', '_blank', 'noopener') } },
      ...(!LITE ? [
        { id: 'app-nft', group: 'Pages', label: 'Openfields NFT', hint: 'collections, listings and offers', keywords: 'collectibles marketplace listings offers buy sell apps', run: page(NFT_URL) },
        { id: 'app-gov', group: 'Pages', label: 'Openfields Gov', hint: 'proposals, votes and the community pool', keywords: 'governance proposals vote validators community pool treasury apps', run: page(GOV_URL) },
        { id: 'app-home', group: 'Pages', label: 'All Openfields apps', hint: 'openfields.app', keywords: 'apps home other products switcher', run: page(HOME_URL) },
      ] : []),
    ]
    const tokens = new Map<string, KnownToken>()
    for (const p of routePoolsAll) for (const tk of p.tokens) tokens.set(assetId(tk.info), tk)
    const lunaId = 'uluna'
    for (const tk of Array.from(tokens.values())) {
      const id = assetId(tk.info)
      const meta = TOKEN_META[tk.key]
      const words = `${tk.key} ${meta?.name ?? ''} ${meta?.origin ?? ''} ${(meta?.tags ?? []).join(' ')}`
      const icon = <TokenIcon label={tk.label} size={24} />
      items.push({ id: `buy-${id}`, group: 'Tokens', label: `Buy ${tk.label}`, hint: meta?.name ?? tk.label, keywords: `${words} get swap into`, icon, run: () => openSwap(id === lunaId ? NOBLE_USDC : lunaId, id) })
      items.push({ id: `sell-${id}`, group: 'Tokens', label: `Sell ${tk.label}`, hint: meta?.name ?? tk.label, keywords: `${words} swap out of`, icon, run: () => openSwap(id, id === NOBLE_USDC || id === USDC_INJ_DENOM ? lunaId : NOBLE_USDC) })
      if (KNOWN_TOKENS.some(k => k.key === tk.key)) {
        items.push({ id: `page-${id}`, group: 'Tokens', label: `${tk.label}: price and pools`, hint: `${meta?.name ?? tk.label}: price over time, who controls it, its pools`, keywords: `${words} page price info about chart history pools who controls mint admin backing holders safety size depth`, icon, run: page(`/token/${encodeURIComponent(tk.key)}`) })
      }
    }
    // Deepest first, so a tie on the name goes to the pool worth trading in.
    for (const p of allPools.filter(p => !p.empty && (p.tvlUsd ?? 0) >= 1).sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))) {
      items.push({
        id: `pool-${p.contract_addr}`, group: 'Pools', label: `${p.label} pool`,
        hint: `${VENUE_NAME[p.venue]}${p.tvlUsd != null ? ` · $${Math.round(p.tvlUsd).toLocaleString('en-US')} liquidity` : ''}`,
        keywords: `${p.tokens.map(tk => `${tk.key} ${TOKEN_META[tk.key]?.name ?? ''}`).join(' ')} liquidity add remove`,
        icon: <PairIcons a={p.tokens[0].label} b={p.tokens[1].label} size={16} />,
        run: () => openInPools(`pool-${p.contract_addr}`, (p.tvlUsd ?? 0) < DUST_USD),
      })
    }
    return items
  }, [allPools, routePoolsAll, arbs, openBridge, openInPools, openSwap, setTab, takeArb, installPrompt, lang])

  const load = useCallback(async () => {
    const [d, b] = await Promise.all([
      fetch('/api/dex', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      LITE ? Promise.resolve(null) : fetch('/api/dex-leaderboard', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
    if (d) { if (marketRef.current) { annotateMarket(d.pools, marketRef.current); annotateValues(d.pools, marketRef.current) } setData(d) }
    if (b) setBoard(b)
  }, [])
  // First load and a gentle background poll, so another trader's swap or a new pool shows up on its own.
  // Paused while nobody is looking (lib/pageActive); caught up on return.
  useEffect(() => poll(() => { load() }, POLL_MS.pools), [load])

  useEffect(() => { if (me) isCrystalHolder(me).then(setCrystal); else setCrystal(false) }, [me])

  // After a transaction the block needs about 6 s to land and the endpoint a moment more to index it.
  // A single poll usually fires too early, so a short burst; the pools, board and balances follow on their own.
  const refresh = useCallback(() => {
    [1500, 4000, 7000, 12000].forEach(ms => setTimeout(load, ms))
  }, [load])

  const section = sectionOf(tab)
  const board_ = !LITE ? board : null
  return (
    <SectionNav.Provider value={nav}>
      <Head>
        <title>{APP_NAME}</title>
      </Head>
      <AppShell page={section}>
        {!data && (
          <div className='sw-page sw-narrow' aria-busy='true'>
            <p className='sw-status'><span className='of-spin' aria-hidden /> {t('Reading the pools…')}</p>
          </div>
        )}
        {data && !data.live && (
          <div className='sw-page sw-narrow'>
            <h1 className='sw-title'>Not live yet</h1>
            <p className='sw-lede'>The factory is being set up. Check back shortly.</p>
          </div>
        )}
        {data?.live && (
          <>
            {tab === 'swap' && (
              <>
                {loopFor && <LoopCard plan={loopFor} pools={routePoolsAll} onClose={() => setLoopFor(null)} onOneSided={oneSided} onDone={refresh} />}
                <SwapBox pools={data.pools} venuePools={swapVenuePools} crystal={crystal} feeBps={data.feeBps} onDone={refresh} preset={preset}
                  onNext={(k, key) => { if (k === 'pools') openInPools('', false, key ?? ''); else setTab(k) }} />
                <nav className={`sw-more sw-narrow${arbs[0] ? '' : ' sw-phone-only'}`} aria-label={t('More')}>
                  <div className='sw-list'>
                    <button type='button' className='sw-item sw-phone' onClick={() => setTab('pools')}>
                      <span className='sw-item-main'><span className='sw-item-title'>{t('Pools')}</span><span className='sw-item-sub'>{t('Add or remove liquidity')}</span></span>
                      <Icon name='chevronRight' size={16} />
                    </button>
                    <button type='button' className='sw-item sw-phone' onClick={() => setTab('positions')}>
                      <span className='sw-item-main'><span className='sw-item-title'>{t('Portfolio')}</span><span className='sw-item-sub'>{t('Positions, balances and history')}</span></span>
                      <Icon name='chevronRight' size={16} />
                    </button>
                    <button type='button' className='sw-item sw-phone' onClick={() => setTab('transfer')}>
                      <span className='sw-item-main'><span className='sw-item-title'>{t('Bridge')}</span><span className='sw-item-sub'>{t('Move tokens to and from other chains')}</span></span>
                      <Icon name='chevronRight' size={16} />
                    </button>
                    {arbs[0] && (
                      <button type='button' className='sw-item' onClick={() => takeArb(arbs[0])}>
                        <span className='sw-item-main'>
                          <span className='sw-item-title'>{arbs.length === 1 ? 'A pool is off the market' : `${arbs.length} pools are off the market`}</span>
                          <span className='sw-item-sub'>{arbs[0].pool.label} is {arbs[0].off.toFixed(1)}× off. Close the gap in one transaction.</span>
                        </span>
                        <Icon name='chevronRight' size={16} />
                      </button>
                    )}
                  </div>
                </nav>
              </>
            )}
            {tab === 'pools' && (
              <Pools pools={allPools} ownPools={data.pools} routePools={routePoolsAll} board={board_} holders={holders} arbs={arbs} focus={poolsFocus}
                onDone={refresh} onTake={takeArb} onCreate={() => setTab('create')}
                onTrade={(fromId, toId, amount) => { setPreset({ fromId, toId, amount, n: Date.now() }); setTab('swap') }} />
            )}
            {tab === 'create' && <CreatePool pools={allPools} marketPx={marketPx} onDone={refresh} onCreated={() => setTab('pools')} onBack={() => setTab('pools')} />}
            {(tab === 'positions' || tab === 'wallet' || tab === 'history') && (
              <Portfolio view={tab as PortfolioView} onView={v => setTabState(v)} pools={allPools} routePools={routePoolsAll} flows={me ? board_?.flows : undefined} onDone={refresh} />
            )}
            {tab === 'transfer' && <Bridge key={bridgeNet} initialNet={bridgeNet} routePools={routePoolsAll} onDone={refresh} />}
            {tab === 'board' && !LITE && <Board board={board} me={me} spotlight={spotlight} onGoSwap={() => setTab('swap')} />}
          </>
        )}
      </AppShell>
      {toast && <Toast msg={toast.msg} href={toast.href} onDone={clearToast} />}
      {palette && <CommandPalette items={paletteItems} onClose={() => setPalette(false)} />}
    </SectionNav.Provider>
  )
}

/**
 * Social card. The page itself is client-rendered, so it is built once ahead
 * of time and served from the CDN whatever the query string says: rendering
 * it on each request was most of what this site's server did (Vercel's Hobby
 * plan, 2026-09-27). A shared swap (?from=&to=) and a board entry (?who=)
 * still unfurl as themselves: link previews get their card from the
 * middleware (middleware.ts), which only answers those.
 */
export const getStaticProps: GetStaticProps = async () => ({
  props: {
    og: {
      title: LITE ? 'Openfields Pools' : 'Openfields Swap',
      image: LITE ? `${SITE_URL}/img/openfields-x.png` : `${SITE_URL}/api/og/swap`,
      contract: '', token: '',
      description: LITE
        ? `An unofficial, open-source interface to Astroport's pools on Terra, with no fee. Not affiliated with Astroport.`
        : 'The best route over Openfields Swap and Astroport pools on Terra, with no interface fee. Not affiliated with Terraswap.',
      url: `${SITE_URL}/`,
      type: 'website',
    },
  },
})
