/**
 * How Openfields Swap works, and what can go wrong: the one place for the
 * explanations the screens leave out. Kept in step with lib/route (routing),
 * lib/msgs (what is signed), the contracts in this repository, and /verify.
 */

import type { GetStaticProps } from 'next'
import Link from 'next/link'
import AppShell from 'components/shell/AppShell'
import { IS_ASTRO } from 'lib/dex'
import { SITE_URL } from 'lib/siteUrl'

const REPO = 'https://github.com/openfieldsapp/openfields-swap'

export default function How() {
  return (
    <AppShell page='how'>
      <article className='of-prose'>
        <h1>How it works</h1>
        <p className='of-prose-lede'>You pick what to pay and what to receive. The page finds the best route, the chain checks it, and you sign in your own wallet.</p>

        <h2>A swap</h2>
        <ol>
          <li><strong>The route.</strong> Every path through up to three pools on Openfields Swap, Astroport and Skeleton Swap is priced by the pools&apos; own simulations, and a split over two paths that share no pool is tried when it delivers more.</li>
          <li><strong>The least you receive.</strong> Each swap carries a minimum. If the price moves further than the slippage allows before it lands, it reverts and only the network fee is spent. Auto slippage follows how the route&apos;s pools have been moving and how deep they are.</li>
          <li><strong>A last check.</strong> Before your wallet opens, the trade is priced again. If it now gives noticeably less, the new number is shown first and the next press signs that.</li>
          <li><strong>One signature.</strong> Your wallet shows the exact messages. Nothing is held by this site at any point.</li>
        </ol>
        <p>Typing in the receive field asks for an exact amount to arrive instead: the page works out what to pay, with room for the price to move.</p>

        <h2>Fees</h2>
        <ul>
          <li>No interface fee. The page adds nothing to any swap, deposit or transfer.</li>
          <li>Openfields Swap&apos;s pools charge 0.3% per swap, all of it to their liquidity providers.</li>
          <li>Astroport&apos;s pools set their own fee and send part of it to Astroport. Skeleton Swap&apos;s pools set their own fee, and part of it goes to White Whale.</li>
          <li>Every transaction pays a small network fee in LUNA, shown before you sign. Transfers from another chain pay that chain&apos;s fee in its own token.</li>
        </ul>

        <h2>The contracts</h2>
        <p>
          Openfields Swap&apos;s pools run Astroport&apos;s audited pair code, created through an instance of Astroport&apos;s own factory.
          The factory&apos;s ownership was handed to a contract that can never use it, and nobody can migrate the factory or the pools.
          Nobody can change fees, upgrade code or stop pool creation. <Link href='/verify'>Verify</Link> checks all of it from your browser.
        </p>
        <p>Openfields Swap&apos;s router sends one transaction through pools on both factories, and runs the swap on arrival over IBC. It has no owner, no admin and no fee.</p>
        <p>
          Astroport&apos;s and Skeleton Swap&apos;s pools are their own contracts, reached directly. Astroport can upgrade its contracts; Skeleton Swap&apos;s
          factory owner can change its pools&apos; fees and pause swaps, deposits or withdrawals. Openfields Swap is not affiliated with Astroport,
          Skeleton Swap, White Whale or Terraswap.
        </p>

        <h2>Pools and liquidity</h2>
        <ul>
          <li>Adding liquidity puts both tokens in at the pool&apos;s ratio, or one token in a single signature: part of it is swapped for the other side first.</li>
          <li>A pool position is a share of the pool. When the two prices move apart, the share holds more of the cheaper token: that is impermanent loss. The portfolio shows what you put in beside what you hold now.</li>
          <li>Anyone can open a pool. A new pool is empty, and the first deposit sets its price.</li>
          <li>A pool that drifts from the market can be closed back toward it with a round trip in one transaction, offered only when even the worst case ends ahead.</li>
        </ul>

        <h2>The bridge</h2>
        <p>
          USDC from Noble, ATOM from the Cosmos Hub, USDC.inj from Injective, ASTRO, dATOM and FUEL from Neutron, and stLUNA and stATOM from Stride
          move to and from Terra over IBC. Arriving, they can be swapped into another token in the same transfer. If that swap cannot deliver its
          minimum, the transfer fails and the other chain returns the tokens. USDC from Noble and USDC.inj are separate tokens and are never swapped for each other here.
        </p>

        <h2>What can go wrong</h2>
        <ul>
          <li>A thin pool moves a lot for a small trade. The price impact is shown before you sign; above 5% the button says so.</li>
          <li>Anyone can make a token and open a pool for it. Only listed tokens are offered; one asked for by address is marked and waits for you to confirm it.</li>
          <li>A send to the wrong address cannot be undone. Addresses are checked before you sign, but not what the receiver does with them.</li>
          <li>This is experimental software. Trade amounts you are comfortable with.</li>
        </ul>

        <h2>What this site keeps</h2>
        <ul>
          <li>Nothing about you on its server, unless you turn on price alerts with the page closed: then this browser&apos;s notification address and its alert levels, and nothing else.</li>
          <li>Starred tokens, alerts, recent tokens, saved addresses and the language stay in this browser.</li>
          <li>With a wallet connected, the ✦ in the corner asks Openfields Home’s server what waits for that address and opens each line there. That server keeps the answer for up to a minute and logs no address.</li>
          <li>In some countries wallet actions are not offered; pages and data stay open everywhere.</li>
        </ul>

        <h2>Open source</h2>
        <p>The code is MIT licensed and <a href={REPO} target='_blank' rel='noopener noreferrer'>on GitHub</a>. Anyone can run their own copy{IS_ASTRO ? '' : ', and the pools and the router on chain belong to no one'}. For other sites, there is a <Link href='/developers'>quote API and an embeddable quote</Link>.</p>
      </article>
    </AppShell>
  )
}

export const getStaticProps: GetStaticProps = async () => ({
  props: {
    og: {
      title: 'How Openfields Swap works',
      description: 'Routing, fees, the contracts and what can go wrong, in one page.',
      url: `${SITE_URL}/how`,
      type: 'website',
    },
  },
})
