/**
 * Region posture: pages and read APIs are open to everyone; wallet actions
 * are gated in the countries listed in BLOCKED_COUNTRIES (default US, CA, GB).
 *
 * The gate is a cookie the client reads (`region_tx_allowed`), backed by
 * /api/geo for a fresh check. The contracts on chain are permissionless
 * regardless; this is interface posture, and each host decides their own.
 *
 * Operator bypass for testing: `?bypass=<GEOBLOCK_BYPASS_SECRET>` sets a
 * cookie that reports the region as allowed.
 *
 * Link previews: the swap page is built ahead of time (pages/index.tsx), so
 * its own card is the generic one. A chat app or social site that previews a
 * shared swap (?from=&to=&amount=) or a board entry (?who=) gets a small page
 * with that link's card from here instead. People are never matched.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SITE_URL } from 'lib/siteUrl'

export const BLOCKED = new Set(
  (process.env.BLOCKED_COUNTRIES ?? 'US,CA,GB').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
)
const BYPASS_COOKIE = 'geo_bypass'
const BYPASS_SECRET = process.env.GEOBLOCK_BYPASS_SECRET || ''

function withRegion(res: NextResponse, allowed: boolean, country: string): NextResponse {
  const opts = { maxAge: 86_400, path: '/', sameSite: 'lax' as const, httpOnly: false, secure: true }
  res.cookies.set('region_tx_allowed', allowed ? 'true' : 'false', opts)
  if (!allowed) res.cookies.set('region_tx_country', country, opts)
  return res
}

/** The bots that fetch a link to show its preview; search engines are not among them. */
const PREVIEW_BOTS = /facebookexternalhit|facebot|twitterbot|slackbot|slack-imgproxy|discordbot|telegrambot|whatsapp|linkedinbot|skypeuripreview|pinterest|redditbot|embedly|iframely|mastodon|bluesky|cardyb|vkshare|signal|preview/i
const TOKEN = /^[A-Za-z0-9.\-]{1,20}$/
const AMOUNT = /^\d{1,12}(\.\d{1,8})?$/
const ADDRESS = /^terra1[0-9a-z]{38,58}$/
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The card a shared swap or board entry unfurls as, or null for any other link. /api/og/swap draws it, checking the tokens itself. */
function previewCard(request: NextRequest): Response | null {
  if (request.nextUrl.pathname !== '/' || !PREVIEW_BOTS.test(request.headers.get('user-agent') ?? '')) return null
  const q = request.nextUrl.searchParams
  // The site's own address, never a request header: a forwarded host is whatever the caller sent, and a card
  // built from it would point people at someone else's domain.
  const origin = SITE_URL
  const who = q.get('who') ?? ''
  const from = q.get('from') ?? '', to = q.get('to') ?? ''
  const amount = AMOUNT.test(q.get('amount') ?? '') && Number(q.get('amount')) > 0 ? q.get('amount')! : ''
  let title = '', description = '', query = ''
  if (ADDRESS.test(who)) {
    const short = `${who.slice(0, 9)}…${who.slice(-4)}`
    title = `${short} on Openfields Swap`
    description = `${short}'s points, badges and moves on the Openfields Swap board.`
    query = `?who=${who}`
  } else if (TOKEN.test(from) && TOKEN.test(to) && from.toLowerCase() !== to.toLowerCase()) {
    title = `Swap ${amount ? `${amount} ` : ''}${from} for ${to} on Openfields Swap`
    description = 'Opens this swap on Openfields Swap, priced across Openfields Swap and Astroport pools, with no interface fee.'
    query = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${amount ? `&amount=${amount}` : ''}`
  } else return null
  const url = `${origin}/${query}`, image = `${origin}/api/og/swap${query}`
  const meta = [
    ['og:title', title], ['og:description', description], ['og:image', image], ['og:url', url], ['og:type', 'website'], ['og:site_name', 'Openfields'],
  ].map(([k, v]) => `<meta property="${k}" content="${esc(v)}">`).join('')
    + `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}">`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="description" content="${esc(description)}">${meta}<link rel="canonical" href="${esc(url)}"></head><body><a href="${esc(url)}">${esc(title)}</a></body></html>`
  // Never cached: the card answers a preview bot at the same address people open, so a cached copy would be
  // served to people too, as a page with one link instead of the swap.
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } })
}

export function middleware(request: NextRequest) {
  const card = previewCard(request)
  if (card) return card
  if (BYPASS_SECRET) {
    const bypass = request.nextUrl.searchParams.get('bypass')
    if (bypass && bypass === BYPASS_SECRET) {
      const clean = request.nextUrl.clone()
      clean.searchParams.delete('bypass')
      const res = NextResponse.redirect(clean)
      res.cookies.set(BYPASS_COOKIE, BYPASS_SECRET, { maxAge: 30 * 86_400, path: '/', sameSite: 'lax' })
      return res
    }
    if (request.cookies.get(BYPASS_COOKIE)?.value === BYPASS_SECRET) return withRegion(NextResponse.next(), true, 'XX')
  }
  // Unknown when the app runs on our own server behind the host proxy: no cookie then, so the page
  // asks /api/geo, which the host answers with the visitor's country.
  const country = request.geo?.country
  if (!country) return NextResponse.next()
  return withRegion(NextResponse.next(), !BLOCKED.has(country), country)
}

/**
 * The two pages that sign, and nothing else. It used to run on every /api
 * request too, and Vercel bills each middleware run as compute before the CDN
 * answers, cached or not (Hobby plan, 2026-09-24). The gate does not need it
 * elsewhere: a page without the cookie asks /api/geo (components/RegionGate),
 * and every signing asks /api/geo afresh (components/transactions/useDex).
 *
 * Every page it matches also costs a request for each link to it that Next
 * prefetches (a data request that runs only this middleware), so links to
 * these pages carry prefetch={false}. Adding the pool pages here made each
 * pool card in the list prefetch one.
 */
export const config = {
  matcher: ['/', '/predict'],
}
