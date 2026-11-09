/**
 * /tx/[hash]: a receipt for one transaction on Terra, read from the chain.
 * What left and what arrived, and for a swap signed on Openfields Swap what it was
 * quoted, how that compares with what arrived and with the best path through
 * up to two pools, the least it allowed, and the pools it went through. The
 * link can be shared: its card (/api/og/tx) reads the same transaction, so
 * nothing a link carries is shown as fact.
 */

import Link from 'next/link'
import type { GetStaticPaths, GetStaticProps } from 'next'
import { useState } from 'react'
import AppShell from 'components/shell/AppShell'
import { TokenIcon } from 'components/TokenIcon'
import { Icon } from 'components/ui'
import { Row, amt } from 'components/swap/common'
import { shortAddress } from 'components/wallet/connect'
import { IS_ASTRO, KNOWN_TOKENS, tokenFor, type KnownToken } from 'lib/dex'
import { SCAN_ADDRESS, SCAN_TX, TERRA_HOME_URL } from 'lib/products'
import { fmtAmount } from 'lib/arb'
import { TX_HASH, readReceipt, type Receipt } from 'lib/txReceipt'
import { SITE_URL } from 'lib/siteUrl'
import { POOLS_MEMO_PREFIXES, SITE_MEMO_PREFIXES } from 'lib/route'

const KIND: Record<string, string> = {
  swap: 'Swap', zap: 'Zap', 'add liquidity': 'Added liquidity', 'remove liquidity': 'Removed liquidity', stake: 'Staked LP', unstake: 'Unstaked LP',
  claim: 'Claimed rewards', 'transfer out': 'Sent over IBC', 'transfer in': 'Arrived over IBC', 'arrived swapped': 'Arrived swapped',
  'create pool': 'Opened a pool', 'liquid staking': 'Liquid staking', other: 'Transaction',
}

const tokenOf = (id: string): KnownToken => tokenFor(id.startsWith('terra1') ? { token: { contract_addr: id } } : { native_token: { denom: id } })
const amountOf = (m: { id: string; amount: string }) => { const t = tokenOf(m.id); return { t, n: Number(m.amount) / 10 ** t.decimals } }
const show = (m: { id: string; amount: string }) => { const { t, n } = amountOf(m); return `${fmtAmount(n)} ${t.label}` }

function titleFor(r: Receipt): string {
  if (!r.ok) return 'A failed transaction on Terra'
  if (r.kind === 'swap' && r.out.length === 1 && r.in.length >= 1) return `Swapped ${show(r.out[0])} for ${show(r.in[0])} on Terra`
  if (r.kind === 'arrived swapped' && r.in.length) return `${show(r.in[0])} arrived on Terra, swapped on arrival`
  if (r.kind === 'transfer in' && r.in.length) return `${show(r.in[0])} arrived on Terra${r.chain ? ` from ${r.chain}` : ''}`
  if (r.kind === 'transfer out' && r.out.length) return `${show(r.out[0])} sent from Terra${r.chain ? ` to ${r.chain}` : ''}`
  return `${KIND[r.kind] ?? 'Transaction'} on Terra`
}

/** What arrived against what a swap signed here was quoted, in %. */
function vsQuote(r: Receipt): number | null {
  const q = r.quote
  if (!q || !(q.amount > 0)) return null
  const got = r.in.find(m => tokenOf(m.id).label === q.label)
  return got ? (amountOf(got).n / q.amount - 1) * 100 : null
}

/**
 * Built on the first visit and kept (incremental static regeneration). A
 * transaction never changes once it is in a block, so a found receipt is kept
 * for good. One the endpoints do not know (yet) is a 404 (pages/404 says it
 * may still be indexing), which Next holds in memory for a few seconds and
 * never writes to disk, so made-up hashes cannot fill it with pages.
 * Rendered per request before 2026-09-27 (Vercel's Hobby plan).
 */
export const getStaticPaths: GetStaticPaths = async () => ({ paths: [], fallback: 'blocking' })

export const getStaticProps: GetStaticProps = async ctx => {
  const raw = String(ctx.params?.hash ?? '')
  if (!TX_HASH.test(raw)) return { notFound: true, revalidate: 86_400 }
  const hash = raw.toUpperCase()
  if (raw !== hash) return { redirect: { destination: `/tx/${hash}`, permanent: true } }
  const receipt = await readReceipt(hash)
  // Not known to the endpoints: asked again after a few seconds (a swap that just landed may still be indexing).
  if (!receipt) return { notFound: true, revalidate: 10 }
  const base = SITE_URL
  const vs = vsQuote(receipt)
  const facts = receipt.quote
    ? [
        `Quoted ${fmtAmount(receipt.quote.amount)} ${receipt.quote.label}`,
        vs != null ? `arrived ${vs >= 0 ? '+' : ''}${vs.toFixed(2)}% against the quote` : '',
        receipt.quote.gainPct != null && receipt.quote.gainPct >= 0.005 ? `routing added ${receipt.quote.gainPct.toFixed(2)}% over two pools` : '',
      ].filter(Boolean).join(', ') + '. '
    : ''
  return {
    revalidate: false,
    props: {
      hash,
      receipt,
      og: {
        title: titleFor(receipt),
        description: `${facts}Block ${receipt.height.toLocaleString('en-US')}, read from the chain.`,
        image: `${base}/api/og/tx?hash=${hash}`,
        url: `${base}/tx/${hash}`,
        type: 'article',
      },
    },
  }
}

/** Only ever rendered with a receipt: a transaction the endpoints do not know is a 404 (getStaticProps, pages/404). */
export default function TxPage({ hash, receipt }: { hash: string; receipt: Receipt }) {
  const [copied, setCopied] = useState(false)
  const share = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }

  const r = receipt
  const vs = vsQuote(r)
  const pairLink = (() => {
    if (r.kind !== 'swap' || r.out.length !== 1 || r.in.length < 1) return null
    const a = tokenOf(r.out[0].id), b = tokenOf(r.in[0].id)
    return KNOWN_TOKENS.some(k => k.key === a.key) && KNOWN_TOKENS.some(k => k.key === b.key) ? `/?from=${encodeURIComponent(a.key)}&to=${encodeURIComponent(b.key)}` : null
  })()
  const moved = (list: { id: string; amount: string }[]) => (
    <span className='sw-moved'>
      {list.map((m, i) => <span key={i}><TokenIcon label={tokenOf(m.id).label} size={16} />{show(m)}</span>)}
    </span>
  )
  const when = new Date(r.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  const ourMemo = [...SITE_MEMO_PREFIXES, ...POOLS_MEMO_PREFIXES].some(p => r.memo.startsWith(`${p}:`))

  return (
    <AppShell>
      <article className='sw-page sw-narrow'>
        <p className={`sw-receipt-state ${r.ok ? 'sw-pos' : 'sw-neg'}`}>
          <span className={`sw-verify-mark ${r.ok ? 'is-ok' : 'is-bad'}`} aria-hidden><Icon name={r.ok ? 'check' : 'close'} size={14} /></span>
          {r.ok ? 'Landed' : 'Failed on chain'}
        </p>
        <h1 className='sw-title sw-gap'>{titleFor(r)}</h1>
        <p className='sw-lede'>Block {r.height.toLocaleString('en-US')}, {when} UTC.</p>

        <div className='sw-card sw-gap'>
          <dl className='sw-rows'>
            {r.out.length > 0 && <Row k='Left' v={moved(r.out)} />}
            {r.in.length > 0 && <Row k='Arrived' v={moved(r.in)} />}
            {!r.ok && <Row k='Moved' v='Nothing but the network fee.' tone='bad' />}
            <Row k='Network fee' v={r.feeUluna !== '0' ? `${amt(r.feeUluna, 6, 4)} LUNA` : 'paid by the relayer'} tone='muted' />
            {r.account && <Row k='Wallet' v={<a href={SCAN_ADDRESS(r.account)} target='_blank' rel='noopener noreferrer'>{shortAddress(r.account)}</a>} tone='muted' />}
          </dl>
          {r.quote && (
            <dl className='sw-rows sw-divide'>
              <Row k='Quoted' v={`${fmtAmount(r.quote.amount)} ${r.quote.label}`} />
              {vs != null && <Row k='Against the quote' v={`${vs >= 0 ? '+' : ''}${vs.toFixed(2)}%`} tone={vs >= -0.05 ? 'good' : 'warn'} />}
              {r.quote.gainPct != null && <Row k='Routing added' v={`${r.quote.gainPct >= 0 ? '+' : ''}${r.quote.gainPct.toFixed(2)}% over the best path through up to two pools`} tone={r.quote.gainPct >= 0.005 ? 'good' : 'muted'} />}
              {r.minimum && <Row k='Least it allowed' v={show(r.minimum)} tone='muted' />}
            </dl>
          )}
          {r.hops.length > 0 && (
            <dl className='sw-rows sw-divide'>
              {r.hops.map((h, i) => (
                <Row key={i} k={i === 0 ? 'Route' : ''} v={h.pool
                  ? <Link href={`/pool/${h.pool}`}>{show(h.offer)} to {show(h.ask)}</Link>
                  : `${show(h.offer)} to ${show(h.ask)}`} />
              ))}
            </dl>
          )}
          {ourMemo && <p className='sw-fine sw-mono sw-gap'>{r.memo}</p>}
        </div>

        <div className='sw-act'>
          {pairLink && <Link href={pairLink} className='of-btn of-btn--primary of-btn--lg of-btn--block'>Swap the same pair</Link>}
          <div className='of-next'>
            <a href={SCAN_TX(hash)} target='_blank' rel='noopener noreferrer' className='of-btn of-btn--quiet of-btn--sm'>Openfields Scan<Icon name='external' size={14} /></a>
            {!IS_ASTRO && <a href={`${TERRA_HOME_URL}/`} className='of-btn of-btn--quiet of-btn--sm'>Openfields Home<Icon name='external' size={14} /></a>}
            <button type='button' onClick={share} className='of-btn of-btn--quiet of-btn--sm'>{copied ? 'Link copied' : 'Copy link'}<Icon name={copied ? 'check' : 'copy'} size={14} /></button>
          </div>
        </div>
      </article>
    </AppShell>
  )
}
