/**
 * GET /api/quote?from=LUNA&to=USDC&amount=100 — what a swap would deliver
 * right now through the best route over Terra Swap's, Astroport's and Skeleton Swap's pools,
 * the same routing the swap page signs (lib/route): paths through up to three
 * pools, and a split over two paths when that delivers more.
 *
 * GET /api/quote?from=LUNA&to=USDC&receive=5 — the other way round: what to pay
 * so that at least 5 USDC arrives even when the price moves as far as the
 * slippage allows (lib/route quoteExactOut).
 *
 * GET /api/quote?from=LUNA&to=USDC&amount=100&tx=1&sender=terra1…&slippage=0.5
 * adds `tx`: the exact messages the swap page would ask that wallet to sign
 * for this quote (lib/msgs tradeMsgs), with the minimum set by `slippage`
 * (percent, 0.1 to 5, default 1) and the memo the page writes. For apps that
 * build on this route instead of copying it. The numbers above are rounded for
 * reading; sign the messages, not the numbers.
 *
 * Open to any site (CORS), for the embed (/embed) and for anyone building on
 * Terra. It reads public chain data and signs nothing. A quote is not an
 * offer: prices move with every trade, and the swap itself happens in the
 * wallet of whoever signs it. USDC from Noble and USDC.inj are never quoted
 * against each other. Tokens are the ones this site lists, by ticker or id.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { fromUtf8 } from '@cosmjs/encoding'
import { KNOWN_TOKENS, assetId, fromMicro, toMicro, type KnownToken } from 'lib/dex'
import { tradeMsgs } from 'lib/msgs'
import { planTrade, quoteBest, quoteExactOut, tradeMemo, tradeText, type TradePlan } from 'lib/route'
import { routingPools } from 'lib/routingPools'

/** A cold instance reads both factories' pools first. */
export const config = { maxDuration: 60 }

export interface QuoteHop { pool: string; venue: string; offer: string; ask: string; returns: string }
export interface QuoteResponse {
  from: string
  to: string
  /** whole tokens paid: as asked, or with ?receive= what it takes */
  amount: string
  /** with ?receive=: the amount asked to arrive */
  receive?: string
  exactOut?: boolean
  /** what arrives when every pool trades at its quote, display units */
  expectedOut: string
  /** the least a swap signed with slippagePct lets arrive */
  minimumOut: string
  slippagePct: number
  impactPct: number
  path: string
  parts: { sharePct: number; hops: QuoteHop[] }[]
  /** the swap page with this pair and amount filled in */
  swapUrl: string
  at: number
  /** with ?tx=1&sender=: what to sign */
  tx?: QuoteTx
}

export interface QuoteTx {
  sender: string
  /** MsgExecuteContract each, msg as JSON; funds sorted as the chain wants them */
  msgs: { contract: string; msg: Record<string, unknown>; funds: { denom: string; amount: string }[] }[]
  memo: string
  /** smallest units: what is paid in, what arrives at the quote, and the least the messages let arrive */
  offerMicro: string
  expectedOutMicro: string
  minimumOutMicro: string
  /** intermediate tokens a route of separate swaps leaves in the wallet at its quote, smallest units */
  leftover: { token: string; micro: string }[]
}

const SLIPPAGE = 0.01
const FRESH_MS = 55_000
/** Messages to sign are built from a route no older than this. */
const FRESH_TX_MS = 15_000
const SENDER = /^terra1[02-9ac-hj-np-z]{38}([02-9ac-hj-np-z]{20})?$/
// Outside callers asked ~60 fresh quotes a minute on 2026-09-23; each is a full route search. Cached answers do not count.
const PER_MINUTE = 20
const AMOUNT = /^\d{1,15}(\.\d{1,18})?$/
const cache = new Map<string, { body: QuoteResponse; trade: TradePlan; pay: string }>()
let windowAt = 0
let windowReads = 0

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * A caller on this machine (Terra Ask runs next to the swap on the Openfields server). The app listens on
 * the loopback address only, so visitors reach it through the server's proxy, which marks every request
 * (X-Of-Proxy) whatever headers the visitor sends; a caller on the machine has no mark, and Next's own server
 * fills in its loopback address as x-forwarded-for. Its quotes are left out of the window outside callers
 * share, which since the move to one server is one counter for the whole site; Ask limits its own users.
 */
const sameMachine = (req: NextApiRequest): boolean => {
  if (req.headers['x-of-proxy'] || req.headers['x-real-ip']) return false
  const from = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',').map(s => s.trim())
  return from.length === 1 && LOOPBACK.has(from[0])
}

const find = (v: unknown): KnownToken | undefined =>
  typeof v === 'string' ? KNOWN_TOKENS.find(t => t.key.toLowerCase() === v.toLowerCase() || assetId(t.info) === v) : undefined
const plain = (micro: string, decimals: number) => fromMicro(micro, decimals, Math.min(decimals, 8)).replace(/,/g, '')
const enc = encodeURIComponent

export default async function handler(req: NextApiRequest, res: NextApiResponse<QuoteResponse | { error: string }>) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

  const from = find(req.query.from), to = find(req.query.to)
  const amount = typeof req.query.amount === 'string' ? req.query.amount.trim() : ''
  const receive = typeof req.query.receive === 'string' ? req.query.receive.trim() : ''
  if (!from || !to) return res.status(400).json({ error: 'from and to must be tokens this site lists, by ticker (LUNA) or id' })
  if (from.key === to.key) return res.status(400).json({ error: 'from and to are the same token' })
  if (amount && receive) return res.status(400).json({ error: 'give amount (what to pay) or receive (what should arrive), not both' })
  const exactOut = !!receive
  const given = exactOut ? receive : amount
  if (!AMOUNT.test(given) || !(Number(given) > 0)) return res.status(400).json({ error: `${exactOut ? 'receive' : 'amount'} must be a positive number in whole tokens` })
  const micro = toMicro(given, exactOut ? to.decimals : from.decimals)
  if (!micro || micro === '0') return res.status(400).json({ error: `${exactOut ? 'receive' : 'amount'} is below the smallest unit` })
  const wantTx = req.query.tx === '1'
  const sender = typeof req.query.sender === 'string' ? req.query.sender.trim() : ''
  if (wantTx && !SENDER.test(sender)) return res.status(400).json({ error: 'tx=1 needs sender, a terra1 address' })
  const slipPct = req.query.slippage == null ? SLIPPAGE * 100 : Number(req.query.slippage)
  if (!(slipPct >= 0.1 && slipPct <= 5)) return res.status(400).json({ error: 'slippage is a percent from 0.1 to 5' })
  const slip = Math.round(slipPct * 10) / 1000

  const key = `${from.key}|${to.key}|${exactOut ? 'out' : 'in'}|${micro}|${slip}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.body.at < (wantTx ? FRESH_TX_MS : FRESH_MS)) {
    if (wantTx) {
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({ ...hit.body, tx: txFor(sender, hit.trade, slip, to, hit.pay) })
    }
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
    return res.status(200).json(hit.body)
  }
  if (!sameMachine(req)) {
    const now = Date.now()
    if (now - windowAt > 60_000) { windowAt = now; windowReads = 0 }
    if (windowReads >= PER_MINUTE) return res.status(429).json({ error: 'busy, try again in a moment' })
    windowReads += exactOut ? 4 : 1
  }

  try {
    const pools = await routingPools()
    let trade: TradePlan
    let pay: string
    let payMicro: string
    if (exactOut) {
      const x = await quoteExactOut(pools, from, to, micro, undefined, { slip })
      if (!x) return res.status(404).json({ error: `no amount found that delivers ${receive} ${to.key} right now` })
      trade = x.trade
      pay = plain(x.amountMicro, from.decimals)
      payMicro = x.amountMicro
    } else {
      const q = await quoteBest(pools, from, to, micro, undefined, { slip, split: true })
      if (!q.best) return res.status(404).json({ error: `no route from ${from.key} to ${to.key} right now` })
      trade = planTrade(q.split ?? [{ quote: q.best, share: 1 }], slip)
      pay = amount
      payMicro = micro
    }
    const host = req.headers.host ?? 'swap.openfields.app'
    const body: QuoteResponse = {
      from: from.key,
      to: to.key,
      amount: pay,
      ...(exactOut ? { receive, exactOut: true } : {}),
      expectedOut: plain(trade.expectedOut, to.decimals),
      minimumOut: plain(trade.minOut, to.decimals),
      slippagePct: slip * 100,
      impactPct: Math.round(trade.impactPct * 1000) / 1000,
      path: tradeText(trade.parts),
      parts: trade.parts.map(p => ({
        sharePct: Math.round(p.share * 1000) / 10,
        hops: p.quote.legs.map(l => ({ pool: l.pool.contract_addr, venue: l.pool.venue, offer: l.offer.key, ask: l.ask.key, returns: plain(l.returnMicro, l.ask.decimals) })),
      })),
      swapUrl: `https://${host}/?from=${enc(from.key)}&to=${enc(to.key)}&${exactOut ? `receive=${enc(receive)}` : `amount=${enc(amount)}`}`,
      at: Date.now(),
    }
    cache.set(key, { body, trade, pay: payMicro })
    if (cache.size > 500) cache.delete(cache.keys().next().value as string)
    if (wantTx) {
      let tx: QuoteTx
      try { tx = txFor(sender, trade, slip, to, payMicro) } catch (e) { return res.status(422).json({ error: e instanceof Error ? e.message : 'this amount cannot be routed' }) }
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({ ...body, tx })
    }
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
    return res.status(200).json(body)
  } catch {
    return res.status(503).json({ error: 'the chain did not answer, try again in a moment' })
  }
}

/** The swap page's own messages for this trade, as JSON: every one is a MsgExecuteContract (lib/msgs tradeMsgs). */
function txFor(sender: string, trade: TradePlan, slip: number, to: KnownToken, offerMicro: string): QuoteTx {
  const msgs = tradeMsgs(sender, trade, slip).map(m => {
    const v = m.value as { contract: string; msg: Uint8Array; funds: { denom: string; amount: string }[] }
    return { contract: v.contract, msg: JSON.parse(fromUtf8(v.msg)) as Record<string, unknown>, funds: v.funds.map(f => ({ denom: f.denom, amount: f.amount })) }
  })
  return {
    sender,
    msgs,
    memo: tradeMemo(trade, null, slip, to),
    offerMicro,
    expectedOutMicro: trade.expectedOut,
    minimumOutMicro: trade.minOut,
    leftover: trade.leftover.map(l => ({ token: l.token.key, micro: l.micro })),
  }
}
