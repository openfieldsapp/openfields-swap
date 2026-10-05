/**
 * /token/[symbol]: a page per listed token. What it is and where it comes
 * from, its price over time as this site has written it down, how much of it
 * trades before the price moves, who controls it, every pool on Openfields Swap and
 * Astroport that holds it, and a swap one click away. For people who arrive
 * from a search or a shared link wanting to know where a token trades on
 * Terra, and what stands behind it. The title and summary are rendered on the
 * server, so search engines and chat previews get them; the numbers are read
 * in the browser, like /stats.
 */

import Link from 'next/link'
import type { GetStaticPaths, GetStaticProps } from 'next'
import { useEffect, useMemo, useState } from 'react'
import AppShell from 'components/shell/AppShell'
import { Button, Disclosure, Icon, IconButton } from 'components/ui'
import { PairIcons, TokenIcon } from 'components/TokenIcon'
import { Figures, Row, fmtPrice } from 'components/swap/common'
import PriceHistoryChart from 'components/PriceHistoryChart'
import DepthCurve, { markLine } from 'components/DepthCurve'
import { IS_ASTRO, KNOWN_TOKENS, VENUE_NAME, annotateMarket, annotateValues, assetId, sameAsset, type KnownToken } from 'lib/dex'
import { fmtUsd } from 'lib/arb'
import { TOKEN_META } from 'lib/tokenMeta'
import { addAlert, askNotifications, fmtUsdPrice, removeAlert, toggleFavorite, useAlertWatcher, usePrefs } from 'lib/alerts'
import { disablePush, enablePush, usePush } from 'lib/push'
import type { TokenCheck } from 'lib/tokenCheck'
import type { DexResponse } from 'lib/api/dex'
import type { VenueResponse } from 'lib/api/dex-venue'
import type { DepthResponse } from 'lib/api/depth'
import { pageActive } from 'lib/pageActive'
import { SITE_URL } from 'lib/siteUrl'
import { SCAN_ADDRESS, STAKE_URL } from 'lib/products'

/** Bought with and sold for USDC from Noble; USDC itself, and USDC.inj, which never meets it, trade against LUNA. */
const counterpart = (key: string) => (key === 'USDC' || key === 'USDC.inj' ? 'LUNA' : 'USDC')
/** Tokens the Bridge tab brings in, and from where. */
const BRIDGE: Record<string, { name: string; net: string }> = {
  USDC: { name: 'Noble', net: 'noble' }, ATOM: { name: 'the Cosmos Hub', net: 'cosmoshub' }, 'USDC.inj': { name: 'Injective', net: 'injective' },
  ASTRO: { name: 'Neutron', net: 'neutron-astro' }, dATOM: { name: 'Neutron', net: 'neutron-datom' }, FUEL: { name: 'Neutron', net: 'neutron-fuel' },
  stLUNA: { name: 'Stride', net: 'stride-stluna' }, stATOM: { name: 'Stride', net: 'stride-statom' },
}
/** Liquid staking tokens whose hub rate the stats page sets against the pools. */
const HUB_RATE = new Set(['ampLUNA', 'bLUNA'])
/** Big numbers whole, small ones at their first significant digits. */
const fmtNum = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString('en-US') : fmtPrice(n))
const short = (a: string) => `${a.slice(0, 10)}…${a.slice(-6)}`
const json = <T,>(u: string) => fetch(u).then(r => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)

function kindOf(t: KnownToken): string {
  if ('token' in t.info) return 'cw20 token on Terra'
  const d = t.info.native_token.denom
  if (d === 'uluna') return "Terra's native token"
  if (d.startsWith('ibc/')) return 'IBC token'
  if (d.startsWith('factory/')) return 'TokenFactory token on Terra'
  return 'native token'
}

/**
 * Every listed token's page is built with the site, and served from the CDN:
 * the page is client-rendered, and the server only writes its social card.
 * Rendered per request before 2026-09-27 (Vercel's Hobby plan). Another
 * spelling of a symbol is answered once, then kept.
 */
export const getStaticPaths: GetStaticPaths = async () => ({
  paths: KNOWN_TOKENS.map(t => ({ params: { symbol: t.key } })),
  fallback: 'blocking',
})

export const getStaticProps: GetStaticProps = async ctx => {
  const raw = String(ctx.params?.symbol ?? '')
  const t = KNOWN_TOKENS.find(x => x.key.toLowerCase() === raw.toLowerCase())
  if (!t) return { notFound: true, revalidate: 86_400 }
  if (t.key !== raw) return { redirect: { destination: `/token/${encodeURIComponent(t.key)}`, permanent: false }, revalidate: 86_400 }
  const base = SITE_URL
  const meta = TOKEN_META[t.key]
  return {
    props: {
      symbol: t.key,
      og: {
        title: `${t.label} on Terra: price, pools and a swap`,
        description: `${meta ? `${meta.name}, from ${meta.origin}. ` : ''}Price history, who controls it and its pools on Terra, with a swap one click away.`,
        image: `${base}/api/og/swap?from=${encodeURIComponent(counterpart(t.key))}&to=${encodeURIComponent(t.key)}`,
        url: `${base}/token/${encodeURIComponent(t.key)}`,
        type: 'website',
      },
    },
  }
}

/** How much trades before the price moves, selling the token and buying it, through the best route. */
function Sizes({ token, other }: { token: KnownToken; other: string }) {
  const [sell, setSell] = useState<DepthResponse | null | 'failed'>(null)
  const [buy, setBuy] = useState<DepthResponse | null | 'failed'>(null)
  useEffect(() => {
    let alive = true
    setSell(null); setBuy(null)
    json<DepthResponse>(`/api/depth?from=${encodeURIComponent(token.key)}&to=${encodeURIComponent(other)}`).then(d => { if (alive) setSell(d ?? 'failed') })
    json<DepthResponse>(`/api/depth?from=${encodeURIComponent(other)}&to=${encodeURIComponent(token.key)}`).then(d => { if (alive) setBuy(d ?? 'failed') })
    return () => { alive = false }
  }, [token.key, other])
  const side = (title: string, d: DepthResponse | null | 'failed') => (
    <div className='sw-card'>
      <p className='sw-card-title'>{title}</p>
      {d === null && <p className='sw-card-sub'>Pricing a dozen sizes…</p>}
      {d === 'failed' && <p className='sw-card-sub'>No route or no market price for this right now.</p>}
      {d && d !== 'failed' && d.kind === 'route' && <><p className='sw-card-sub'>Price impact {markLine(d)}</p><DepthCurve depth={d} /></>}
    </div>
  )
  return (
    <div className='sw-sides sw-gap'>
      {side(`Selling ${token.label} for ${other}`, sell)}
      {side(`Buying ${token.label} with ${other}`, buy)}
    </div>
  )
}

/** Who can make more of it, change it, and what stands behind it (lib/tokenCheck). */
function Controls({ token }: { token: KnownToken }) {
  const [c, setC] = useState<TokenCheck | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setC(null); setFailed(false)
    json<TokenCheck>(`/api/token-check?token=${encodeURIComponent(token.key)}`).then(j => { if (!alive) return; if (j) setC(j); else setFailed(true) })
    return () => { alive = false }
  }, [token.key])
  if (failed) return <p className='sw-status'>The chain did not answer. Try again in a moment.</p>
  if (!c) return <p className='sw-status'><span className='of-spin' aria-hidden /> Reading the contracts, and the chain it comes from…</p>

  const terra = (a: string) => <a className='sw-mono' href={SCAN_ADDRESS(a)} target='_blank' rel='noopener noreferrer'>{short(a)}</a>
  type Tone = 'good' | 'warn' | undefined
  const line = (k: string, v: React.ReactNode, tone?: Tone) => <Row k={k} v={v} tone={tone} />
  const good: Tone = 'good', care: Tone = 'warn'
  const cap = (n: number | null) => (n != null ? `, up to ${fmtNum(n)} in all` : ', with no cap')

  let mint: React.ReactNode = null
  const m = c.mint
  if (m.by === 'chain') mint = line('Can more be made?', `Only by the chain's own rules. No address can mint ${token.label}.`, good)
  else if (m.by === 'nobody') mint = line('Can more be made?', c.kind === 'cw20' ? 'No. The contract has no minter, so the supply can only fall, by burning.' : 'No. The denom has no admin.', good)
  else if (m.by === 'address' && m.contract) mint = (
    <>
      {line('Can more be made?', <>Yes, by a contract{cap(m.cap)}: {terra(m.address)}</>)}
      {'minterAdmin' in m && line('Can the minting contract change?', m.minterAdmin ? <>Yes. {terra(m.minterAdmin)} can replace its code.</> : 'No. It has no admin.', m.minterAdmin ? care : good)}
    </>
  )
  else if (m.by === 'address') mint = line('Can more be made?', <>Yes, by one wallet{cap(m.cap)}: {terra(m.address)}</>, care)
  else if (m.by === 'origin') mint = line('Can more be made?', <>On {m.chain}, where it comes from, not on Terra.{c.origin?.issuer ? ` ${c.origin.issuer}` : ''}</>)
  else mint = line('Can more be made?', 'Could not be read just now.')

  const b = c.backing
  const ratio = b && b.onTerra > 0 ? b.locked / b.onTerra : null
  const h = c.holders
  return (
    <div className='sw-card'>
      <dl className='sw-rows'>
        {mint}
        {c.admin && line('Can the token contract change?', c.admin.admin ? <>Yes. {terra(c.admin.admin)} can replace its code.</> : 'No. It has no admin.', c.admin.admin ? care : good)}
        {c.factoryAdmin && c.kind === 'ibc' && line(`Admin on ${c.factoryAdmin.chain}`, c.factoryAdmin.admin ? <span className='sw-mono'>{short(c.factoryAdmin.admin)}</span> : 'none')}
        {line('On Terra', c.supply != null ? `${fmtNum(c.supply)} ${token.label}` : '–')}
        {b && ratio != null && line(`Locked on ${b.chain}`, <>{fmtNum(b.locked)} against {fmtNum(b.onTerra)} here, {ratio >= 0.999 ? 'fully backed' : `${(ratio * 100).toFixed(1)}% of what exists here`}</>, ratio >= 0.999 ? good : care)}
        {h && line('Holders', `${h.accounts.toLocaleString('en-US')}${h.complete ? '' : ' read so far'}`)}
        {h && line('The largest ten hold', `${h.top10Pct.toFixed(1)}% of the supply; pools and other contracts among them ${h.top10InContractsPct.toFixed(1)}%`)}
      </dl>
      {h && (
        <dl className='sw-rows sw-divide'>
          {h.top.slice(0, 5).map(x => <Row key={x.address} k={<>{x.label ?? (x.contract ? 'A contract' : 'A wallet')} {terra(x.address)}</>} v={`${x.pct.toFixed(2)}%`} tone='muted' />)}
        </dl>
      )}
      <p className='sw-fine sw-gap'>
        Read from the chain {new Date(c.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.{b ? ' Locked is the IBC escrow for this channel on the chain it comes from; a transfer in flight can make the two differ for a moment.' : ''} Not an audit: it shows who can do what, not what they will do.
      </p>
    </div>
  )
}

export default function TokenPage({ symbol }: { symbol: string }) {
  const token = KNOWN_TOKENS.find(t => t.key === symbol) ?? KNOWN_TOKENS[0]
  const id = assetId(token.info)
  const meta = TOKEN_META[token.key]
  const other = counterpart(token.key)
  const [dex, setDex] = useState<DexResponse | null>(null)
  const [venue, setVenue] = useState<VenueResponse | null>(null)
  const [px, setPx] = useState<Record<string, number> | null>(null)
  const [done, setDone] = useState(false)
  useEffect(() => {
    let alive = true
    Promise.all([json<DexResponse>('/api/dex'), json<VenueResponse>('/api/dex-venue'), json<{ px?: Record<string, number> }>('/api/dex-market')])
      .then(([d, v, m]) => { if (!alive) return; setDex(d); setVenue(v); setPx(m?.px ?? null); setDone(true) })
    return () => { alive = false }
  }, [symbol])

  const pools = useMemo(() => {
    const own = (dex?.pools ?? []).filter(p => !p.empty).map(p => ({ ...p }))
    if (px) { annotateMarket(own, px); annotateValues(own, px) }
    return [...own, ...(venue?.pools ?? []).filter(p => !p.empty)]
      .filter(p => p.tokens.some(t => sameAsset(t.info, token.info)) && (p.tvlUsd ?? 0) >= 1)
      .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
  }, [dex, venue, px, token])
  const price = px?.[id]
  const liquidity = pools.reduce((s, p) => s + (p.tvlUsd ?? 0), 0)
  const cw20 = 'token' in token.info
  const bridge = BRIDGE[token.key]

  // Starring and price alerts, kept in this browser (lib/alerts), and on the server only if someone turns on alerts with the page closed (lib/push).
  const { favorites, alerts } = usePrefs()
  const push = usePush(alerts)
  const starred = favorites.includes(id)
  const mine = alerts.filter(a => a.tokenId === id)
  const armed = mine.some(a => !a.firedAt)
  const [dir, setDir] = useState<'above' | 'below'>('above')
  const [level, setLevel] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [pushNote, setPushNote] = useState<string | null>(null)
  useEffect(() => {
    if (!armed) return
    let alive = true
    // The market reference changes every five minutes (lib/scanPlan); read it that often while someone is looking.
    const t = setInterval(() => {
      if (!pageActive()) return
      fetch('/api/dex-market').then(r => (r.ok ? r.json() : null)).then((j: { px?: Record<string, number> } | null) => { if (alive && j?.px) setPx(j.px) }).catch(() => {})
    }, 300_000)
    return () => { alive = false; clearInterval(t) }
  }, [armed])
  useAlertWatcher(px, fired => setNote(fired.map(f => `${f.label} is ${f.dir} $${fmtUsdPrice(f.usd)}: $${fmtUsdPrice(f.firedUsd ?? 0)} now.`).join(' ')))
  const setAlert = async () => {
    const usd = Number(level)
    if (!(usd > 0)) return
    addAlert({ tokenId: id, key: token.key, label: token.label, dir, usd })
    setLevel('')
    if (!push.on) await askNotifications()
  }
  const togglePush = async (on: boolean) => {
    setPushNote(null)
    if (!on) { await disablePush(); return }
    const r = await enablePush()
    if (!r.ok) setPushNote(r.why)
  }
  const enc = encodeURIComponent

  return (
    <AppShell>
      <article className='sw-page'>
        <div className='sw-head'>
          <div className='sw-title-row'>
            <TokenIcon label={token.label} size={32} />
            <h1 className='sw-title'>{token.label}</h1>
          </div>
          <IconButton icon={starred ? 'starFilled' : 'star'} label={starred ? `Unstar ${token.label}` : `Star ${token.label}`} aria-pressed={starred} className='sw-star' onClick={() => toggleFavorite(id)} />
        </div>
        {meta && <p className='sw-lede'>{meta.name}, from {meta.origin}.</p>}

        <div className='sw-card sw-gap'>
          <Figures items={[
            { label: 'Price', value: price ? `$${fmtNum(price)}` : done ? '–' : '…' },
            { label: 'In pools holding it', value: done ? fmtUsd(liquidity) : '…', sub: done ? `${pools.length} pool${pools.length === 1 ? '' : 's'}` : undefined },
          ]} />
          <div className='sw-gap'><PriceHistoryChart query={`token=${enc(token.key)}`} unit='$' /></div>
          <p className='sw-fine sw-gap'>Astroport&apos;s deepest markets on Terra, recorded every ten minutes. Past prices, not a forecast.</p>
        </div>

        <div className='sw-act'>
          <Link prefetch={false} href={`/?from=${enc(other)}&to=${enc(token.key)}`} className='of-btn of-btn--primary of-btn--lg of-btn--block'>Buy {token.label}</Link>
          <div className='of-next'>
            <Link prefetch={false} href={`/?from=${enc(token.key)}&to=${enc(other)}`} className='of-btn of-btn--quiet of-btn--sm'>Sell {token.label}</Link>
            {bridge && <Link prefetch={false} href={`/?tab=bridge&net=${bridge.net}`} className='of-btn of-btn--quiet of-btn--sm'>Bring it in from {bridge.name}</Link>}
            {HUB_RATE.has(token.key) && <Link href='/stats' className='of-btn of-btn--quiet of-btn--sm'>Hub rate against the pools</Link>}
            {!IS_ASTRO && token.key === 'LUNA' && <a href={`${STAKE_URL}/#stake`} className='of-btn of-btn--quiet of-btn--sm'>Stake LUNA<Icon name='external' size={14} /></a>}
          </div>
        </div>

        <h2 className='sw-h2 sw-section'>Pools with {token.label}</h2>
        {!done && <p className='sw-status'>Reading the pools…</p>}
        {done && pools.length === 0 && <p className='sw-status'>No pool with liquidity holds {token.label} right now.</p>}
        {pools.length > 0 && (
          <div className='sw-list'>
            {pools.map(p => {
              const first = sameAsset(p.tokens[0].info, token.info)
              const o = first ? p.tokens[1] : p.tokens[0]
              const rate = first ? p.price : p.price > 0 ? 1 / p.price : 0
              return (
                <Link key={p.contract_addr} href={`/pool/${p.contract_addr}`} prefetch={false} className='sw-item'>
                  <PairIcons a={p.tokens[0].label} b={p.tokens[1].label} size={24} />
                  <span className='sw-item-main'>
                    <span className='sw-item-title'><span>{p.label}</span></span>
                    <span className='sw-item-sub'>{VENUE_NAME[p.venue]}{p.pairType !== 'xyk' ? `, ${p.pairType}` : ''}{rate > 0 ? ` · 1 ${token.label} = ${fmtNum(rate)} ${o.label}` : ''}</span>
                  </span>
                  <span className='sw-item-end'>{p.tvlUsd != null ? fmtUsd(p.tvlUsd) : '–'}</span>
                </Link>
              )
            })}
          </div>
        )}

        <h2 className='sw-h2 sw-section'>Who controls {token.label}</h2>
        <Controls token={token} />

        <h2 className='sw-h2 sw-section'>Price alert</h2>
        <div className='sw-card sw-stack'>
          <div className='sw-alert-form'>
            <label className='sw-select'>
              <span className='of-sr'>Direction</span>
              <select value={dir} onChange={e => setDir(e.target.value as 'above' | 'below')}>
                <option value='above'>Above</option>
                <option value='below'>Below</option>
              </select>
              <Icon name='chevronDown' size={14} />
            </label>
            <input className='sw-input sw-input--sm' aria-label='Price in dollars' inputMode='decimal' value={level} onChange={e => setLevel(e.target.value.replace(',', '.'))} placeholder={price ? `$${fmtUsdPrice(price)}` : '$0.00'} />
            <Button variant='primary' onClick={setAlert} disabled={!(Number(level) > 0)}>Set alert</Button>
          </div>
          <p className='sw-fine'>Goes off once, when the market crosses the level. Kept in this browser.</p>
          {note && <p className='sw-ok'><Icon name='check' size={16} />{note}</p>}
          {mine.length > 0 && (
            <dl className='sw-rows'>
              {mine.map(a => (
                <div key={a.id} className='sw-row sw-alert-row'>
                  <dt>{a.dir === 'above' ? 'Above' : 'Below'} ${fmtUsdPrice(a.usd)}</dt>
                  <dd>
                    <span className={a.firedAt ? 'sw-pos' : 'sw-warn'}>{a.firedAt ? `went off at $${fmtUsdPrice(a.firedUsd ?? 0)}` : 'waiting'}</span>
                    <IconButton icon='close' label='Remove this alert' onClick={() => removeAlert(a.id)} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {push.supported && (
            <div>
              <label className='sw-check'><input type='checkbox' checked={push.on} onChange={e => void togglePush(e.target.checked)} />Also when no page of this site is open</label>
              <p className='sw-fine'>This keeps this browser&apos;s notification address and its alert levels on the site&apos;s server, and nothing else: no wallet, no name. Checked every ten minutes. Turn it off to delete them.</p>
              {pushNote && <p className='sw-hint is-warn'>{pushNote}</p>}
            </div>
          )}
        </div>

        <Disclosure summary='How much trades before the price moves' className='sw-section'>
          <p className='sw-hint'>Price impact by size through the best route, as the swap signs it. The next trade changes it.</p>
          <Sizes token={token} other={other} />
        </Disclosure>

        <Disclosure summary='About the token' className='sw-gap'>
          <dl className='sw-rows sw-gap'>
            <Row k='What it is' v={kindOf(token)} />
            {meta && <Row k='Comes from' v={meta.origin} />}
            <Row k={cw20 ? 'Contract' : 'Denom'} v={cw20 ? <a className='sw-mono' href={SCAN_ADDRESS(id)} target='_blank' rel='noopener noreferrer'>{id}</a> : <span className='sw-mono'>{id}</span>} />
            <Row k='Decimals' v={String(token.decimals)} />
          </dl>
          {token.key === 'USDC.inj' && <p className='sw-fine'>USDC.inj is Circle&apos;s USDC as issued on Injective, a token of its own on Terra. This site never swaps it for USDC from Noble, in either direction.</p>}
        </Disclosure>
      </article>
    </AppShell>
  )
}
