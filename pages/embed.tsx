/**
 * /embed: a swap quote any site can frame (see /developers). It prices a pair
 * through the best route over Openfields Swap's and Astroport's pools with
 * /api/quote, and its button opens the swap on Openfields Swap in a new tab, where
 * the person signs in their own wallet. The frame itself holds no wallet,
 * signs nothing, stores nothing and takes no fee. Rendered without the wallet
 * stack (App.bare), so it loads fast inside someone else's page.
 */

import Head from 'next/head'
import { useEffect, useState } from 'react'
import { KNOWN_TOKENS } from 'lib/dex'
import { TokenIcon } from 'components/TokenIcon'
import { Icon } from 'components/ui'
import type { QuoteResponse } from 'lib/api/quote'

/** The tokens with markets worth quoting; the old cw20 ASTRO and the thinnest listings stay out of a stranger's widget. */
const TOKENS = KNOWN_TOKENS.filter(t => !['ASTRO.cw20', 'VKR', 'USDT.axl'].includes(t.key))
const enc = encodeURIComponent

function Embed() {
  const [from, setFrom] = useState('LUNA')
  const [to, setTo] = useState('USDC')
  const [amount, setAmount] = useState('100')
  const [quote, setQuote] = useState<QuoteResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [origin, setOrigin] = useState('https://swap.openfields.app')

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const known = (v: string | null) => (v ? TOKENS.find(t => t.key.toLowerCase() === v.toLowerCase())?.key : undefined)
    const f = known(p.get('from')), t = known(p.get('to')), a = p.get('amount')
    if (f) setFrom(f)
    if (t && t !== f) setTo(t)
    if (a && /^\d{1,12}(\.\d{1,8})?$/.test(a)) setAmount(a)
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    setErr(null)
    if (!/^\d{1,12}(\.\d{1,8})?$/.test(amount.trim()) || !(Number(amount) > 0) || from === to) { setQuote(null); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/quote?from=${enc(from)}&to=${enc(to)}&amount=${enc(amount.trim())}`)
        .then(async r => {
          const j = await r.json().catch(() => null)
          if (!alive) return
          if (r.ok && j) { setQuote(j as QuoteResponse); setErr(null) } else { setQuote(null); setErr((j as { error?: string } | null)?.error ?? 'Could not price that right now.') }
        })
        .catch(() => { if (alive) { setQuote(null); setErr('Could not price that right now.') } })
        .finally(() => { if (alive) setLoading(false) })
    }, 450)
    return () => { alive = false; clearTimeout(t) }
  }, [from, to, amount])

  const swapUrl = `${origin}/?from=${enc(from)}&to=${enc(to)}${amount.trim() ? `&amount=${enc(amount.trim())}` : ''}`
  const pools = quote ? quote.parts.reduce((n, p) => n + p.hops.length, 0) : 0
  const tokenSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <label className='sw-token sw-embed-token'>
      <TokenIcon label={value} size={24} />
      <span className='of-sr'>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {TOKENS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <Icon name='chevronDown' size={16} />
    </label>
  )

  return (
    <>
      <Head>
        <title>Openfields Swap quote</title>
        <meta name='robots' content='noindex' />
      </Head>
      <main className='sw-embed-page'>
        <div className='sw-box sw-embed-box'>
          <p className='sw-embed-brand'>
            {/* eslint-disable-next-line @next/next/no-img-element -- a 20px mark */}
            <img src='/img/openfields-x-180.png?v=20260923' alt='' width={20} height={20} />
            <span><b>Openfields</b> Swap</span>
          </p>
          <div className='sw-field'>
            <div className='sw-field-head'><label htmlFor='em-amount'>You pay</label></div>
            <div className='sw-field-main'>
              <input id='em-amount' className='sw-amount' inputMode='decimal' value={amount} onChange={e => setAmount(e.target.value.replace(',', '.'))} />
              {tokenSelect(from, v => { if (v === to) setTo(from); setFrom(v) }, 'Pay with')}
            </div>
          </div>
          <div className='sw-flip-row'>
            <button type='button' className='sw-flip' aria-label='Flip the pair' onClick={() => { setFrom(to); setTo(from) }}><Icon name='flip' size={18} /></button>
          </div>
          <div className='sw-field'>
            <div className='sw-field-head'><span>You receive</span></div>
            <div className='sw-field-main'>
              <span className='sw-amount is-quoted of-num'>{loading && !quote ? '…' : quote ? Number(quote.expectedOut).toLocaleString('en-US', { maximumFractionDigits: 6 }) : '0'}</span>
              {tokenSelect(to, v => { if (v === from) setFrom(to); setTo(v) }, 'Receive')}
            </div>
          </div>
          <div className='sw-box-rows'>
            {err ? <p className='sw-error'>{err}</p> : quote ? (
              <dl className='sw-rows'>
                <div className='sw-row'><dt>Minimum received</dt><dd>{Number(quote.minimumOut).toLocaleString('en-US', { maximumFractionDigits: 6 })} {to}</dd></div>
                <div className='sw-row'><dt>Price impact</dt><dd>{quote.impactPct.toFixed(2)}%</dd></div>
                <div className='sw-row is-muted'><dt>Route</dt><dd>{pools} pool{pools === 1 ? '' : 's'}{quote.parts.length > 1 ? ', split over two paths' : ''}</dd></div>
              </dl>
            ) : <p className='sw-fine'>Enter an amount to see the best route right now.</p>}
          </div>
          <a className='of-btn of-btn--primary of-btn--lg of-btn--block' href={swapUrl} target='_blank' rel='noopener noreferrer'>Open in Openfields Swap<Icon name='external' size={16} /></a>
          <p className='sw-fine sw-embed-fine'>A quote, not an offer: prices move with every trade.</p>
        </div>
      </main>
    </>
  )
}

/** Rendered without the wallet stack: see pages/_app. */
Embed.bare = true

export default Embed
