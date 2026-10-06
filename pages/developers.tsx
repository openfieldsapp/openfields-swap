/**
 * /developers: how to put an Openfields Swap quote on another site, and the open
 * APIs behind the site: quotes either way, how much trades before a price
 * moves, the site's own price record, who controls a token, and market data in
 * the shapes listing sites read. All of it reads public chain data and signs
 * nothing; a swap always happens on Openfields Swap itself, in the wallet of whoever
 * signs it.
 */

import { Fragment } from 'react'
import Link from 'next/link'
import type { GetStaticProps } from 'next'
import AppShell from 'components/shell/AppShell'
import { KNOWN_TOKENS } from 'lib/dex'
import { SITE_URL } from 'lib/siteUrl'

const REPO = 'https://github.com/openfieldsapp/openfields-swap'

function Code({ children }: { children: string }) {
  return <pre className='of-code sw-pre'><code>{children}</code></pre>
}

function Params({ items }: { items: [string, React.ReactNode][] }) {
  return <dl className='sw-params'>{items.map(([k, v]) => <Fragment key={k}><dt><code>{k}</code></dt><dd>{v}</dd></Fragment>)}</dl>
}

/** Built with the site: nothing here changes between requests (per request before 2026-09-27, Vercel's Hobby plan). */
export const getStaticProps: GetStaticProps = async () => {
  const base = SITE_URL
  return {
    props: {
      base,
      og: {
        title: 'Build with Openfields Swap: embed a quote, or call the open APIs',
        description: 'Embed a live Openfields Swap quote, or call open APIs for routes, depth, price history, token control and market data. No key, no fee.',
        image: `${base}/api/og/swap`, url: `${base}/developers`, type: 'website',
      },
    },
  }
}

export default function Developers({ base }: { base: string }) {
  const embedSnippet = `<iframe src="${base}/embed?from=LUNA&to=USDC&amount=100"
  width="420" height="340" style="border:0;border-radius:16px"
  title="Openfields Swap quote" loading="lazy"></iframe>`
  const sample = `{
  "from": "LUNA",
  "to": "USDC",
  "amount": "100",
  "expectedOut": "4.553",          // what arrives if every pool trades at its quote
  "minimumOut": "4.507",           // the least a swap signed at slippagePct allows
  "slippagePct": 1,
  "impactPct": 0.02,
  "path": "LUNA → USDC (Astroport)",
  "parts": [{ "sharePct": 100, "hops": [{ "pool": "terra1…", "venue": "astroport", "offer": "LUNA", "ask": "USDC", "returns": "4.553" }] }],
  "swapUrl": "${base}/?from=LUNA&to=USDC&amount=100",
  "at": 1789999999999
}`

  return (
    <AppShell page='developers'>
        <article className='of-prose'>
          <h1>Build with Openfields Swap</h1>
          <p className='of-prose-lede'>Put a live quote on your site, or call the open APIs. No key and no fee, open to any origin.</p>
          <p>Quotes use the routing the swap page signs: every pool on Openfields Swap&apos;s and Astroport&apos;s factories, paths through up to three pools, and a split over two paths when that delivers more.</p>

          <h2>Embed a quote</h2>
          <p>Prices a pair as people type. Its button opens the swap on Openfields Swap in a new tab, where people sign in their own wallet. The card signs nothing. Parameters: from, to (tickers below) and amount, all optional.</p>
          <Code>{embedSnippet}</Code>
          <iframe className='sw-embed' src='/embed?from=LUNA&to=USDC&amount=100' title='Openfields Swap quote' loading='lazy' />

          <h2>Quote</h2>
          <p>What a swap delivers right now, or what to pay for an amount to arrive. Amounts are in whole tokens.</p>
          <Code>{`curl "${base}/api/quote?from=LUNA&to=USDC&amount=100"
curl "${base}/api/quote?from=LUNA&to=USDC&receive=5"
curl "${base}/api/quote?from=LUNA&to=USDC&amount=100&tx=1&sender=terra1…&slippage=0.5"`}</Code>
          <Params items={[
            ['from, to', "a ticker or the token's denom or contract"],
            ['amount', 'what to pay, a positive number of whole tokens'],
            ['receive', 'instead of amount: what should arrive. The answer says what to pay so that at least this arrives at 1% slippage, and carries exactOut: true'],
            ['slippage', 'how far the price may move before the swap fails instead, in percent from 0.1 to 5; default 1'],
            ['tx=1, sender', "adds tx: the exact messages this page would ask that wallet to sign for the quote (msgs, with each message's JSON and funds), the memo, and the amounts in smallest units. Never cached. Sign the messages, not the rounded numbers; a route is fresh for about a minute"],
            ['400 · 404 · 422 · 429 · 503', 'bad input · no route right now · too small to route · busy · the chain did not answer'],
          ]} />
          <Code>{sample}</Code>

          <h2>Size before the price moves</h2>
          <p>Price impact at a ladder of sizes from $50 to $250,000, and the sizes where it crosses 0.5%, 1% and 2%. Kept five minutes per pair.</p>
          <Code>{`curl "${base}/api/depth?from=LUNA&to=USDC"
curl "${base}/api/depth?pool=terra1…"`}</Code>
          <Params items={[
            ['from, to', 'through the best route, the way the swap signs it'],
            ['pool', 'one pool, selling each of its tokens into it (sell0, sell1)'],
            ['points[]', '{ usd, impactPct }, sizes in dollars of the token paid'],
            ['marks[]', '{ pct, usd }: usd is null when the ladder ended first; below is true when it crossed under $50'],
          ]} />

          <h2>Price history</h2>
          <p>Every listed token&apos;s market reference each ten minutes, and every pool with liquidity each hour, since recording began.</p>
          <Code>{`curl "${base}/api/price-history?token=LUNA&range=7d"
curl "${base}/api/price-history?pool=terra1…&base=LUNA&quote=USDC&range=30d"`}</Code>
          <Params items={[
            ['range', '1d, 7d, 30d or 90d'],
            ['points', '[unix ms, value], oldest first: dollars for a token, quote per base for a pool'],
            ['market', "for a pool: the same pair from the two tokens' reference prices"],
            ['since', 'the first day anything was written down'],
          ]} />

          <h2>Who controls a token</h2>
          <p>Whether more can be minted and by whom, whether its contract can be replaced, the supply on Terra, what is locked on the chain an IBC token comes from, and a cw20&apos;s largest holders. Kept six hours per token.</p>
          <Code>{`curl "${base}/api/token-check?token=ampLUNA"`}</Code>

          <h2>Market data for listing sites</h2>
          <p>Openfields Swap&apos;s own pools only, in CoinGecko&apos;s and CoinMarketCap&apos;s integration formats. Pools are constant-product, so the order book is the curve itself. Swaps routed through Astroport&apos;s pools are not counted.</p>
          <Code>{`${base}/api/coingecko/pairs
${base}/api/coingecko/tickers
${base}/api/coingecko/orderbook?ticker_id=<base>_<target>&depth=100
${base}/api/coingecko/historical_trades?ticker_id=<base>_<target>&type=buy

${base}/api/cmc/summary
${base}/api/cmc/assets
${base}/api/cmc/ticker
${base}/api/cmc/orderbook/<base>_<quote>
${base}/api/cmc/trades/<base>_<quote>

${base}/api/volume?date=2026-09-20`}</Code>
          <p>Base and target are denoms and contract addresses. Volume values each swap at its day&apos;s average recorded price. DefiLlama adapters for the pools&apos; liquidity and volume are in the repository under <a href={`${REPO}/tree/main/integrations/defillama`} target='_blank' rel='noopener noreferrer'>integrations/defillama</a>.</p>

          <h2>Tokens</h2>
          <p><code>{KNOWN_TOKENS.map(t => t.key).join(' · ')}</code></p>
          <p>Each has its own page, for example <Link href='/token/LUNA'>/token/LUNA</Link>.</p>

          <h2>Counting Openfields transactions</h2>
          <p>Every transaction signed in an Openfields app says which app built it, at the start of its memo. A memo a person types for the receiver (an exchange&apos;s deposit memo) is sent exactly as typed instead.</p>
          <ul>
            {['Openfields Swap: …', 'Openfields Ask', 'Openfields Home', 'Openfields NFT: …', 'Openfields Gov: …', 'Openfields Stake: …', 'Openfields Daily'].map(m => <li key={m}><code>{m}</code></li>)}
          </ul>
          <p>
            Match <code>^(Openfields|Terra) (Swap|Ask|Home|NFT|Gov|Stake|Daily)\b</code>: before 29 September 2026 the apps were called Terra Swap, Terra Ask and so on, and those memos stay on chain.
            A swap through Ask or Home also carries the swap&apos;s quote (&ldquo;Openfields Ask · routed swap (quote …)&rdquo;).
          </p>

          <h2>Notes</h2>
          <ul>
            <li>A quote is what the pools would deliver when it is read. It is not an offer and not advice, and it moves with every trade. The same goes for sizes, prices and market data.</li>
            <li>Nothing is signed, held or charged here. A swap opens Openfields Swap, where the person signs in their own wallet and the site&apos;s regional restrictions apply.</li>
            <li>USDC from Noble and USDC.inj are separate tokens and are never quoted against each other.</li>
            <li>Please cache on your side: quotes are kept about 20 seconds here, and each server answers about 120 fresh quotes a minute.</li>
            <li>The code is open source under MIT. <a href={REPO} target='_blank' rel='noopener noreferrer'>Run your own copy</a>; the pools and the router on chain have no owner and no admin.</li>
          </ul>
        </article>
    </AppShell>
  )
}
