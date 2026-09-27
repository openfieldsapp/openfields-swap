/**
 * Every one-segment API route of this site, in one function.
 *
 * Why (2026-09-25): Vercel runs each file under pages/api as its own function.
 * With this site's traffic most of them went cold between requests, and a cold
 * start cost 300 to 600 ms of CPU before any work, several times the work
 * itself. Openfields is on Vercel's Hobby plan, which allows 4 CPU-hours a
 * month for every site together. In one function, the pool-scan handover
 * (about once a minute) keeps it warm for everyone.
 *
 * The handlers live in lib/api, one file each, and are written as ordinary
 * Next API routes. Each is loaded the first time it is asked for, so a cold
 * start loads only the route it serves: with every handler loaded up front a
 * start took 0.7 to 0.85 s of CPU (2026-09-27). Their own `config` exports no
 * longer apply: this function reads bodies itself (the handover is gzipped)
 * and allows 60 seconds. Routes under a folder (cmc, coingecko, og) are still
 * their own files.
 */

import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'
import { BadBody, readJsonBody } from 'lib/jsonBody'
import { withCpu } from 'lib/cpuLog'

export const config = { api: { bodyParser: false }, maxDuration: 60 }

/** `json`: the route reads req.body, which Next's body parser used to fill (it is off here). */
const ROUTES: Record<string, { load: () => Promise<{ default: NextApiHandler }>; json?: boolean }> = {
  depth: { load: () => import('lib/api/depth') },
  'dex-arcade': { load: () => import('lib/api/dex-arcade'), json: true },
  'dex-candles': { load: () => import('lib/api/dex-candles') },
  'dex-holders': { load: () => import('lib/api/dex-holders') },
  'dex-leaderboard': { load: () => import('lib/api/dex-leaderboard') },
  'dex-market': { load: () => import('lib/api/dex-market') },
  'dex-prices': { load: () => import('lib/api/dex-prices') },
  'dex-skeleton': { load: () => import('lib/api/dex-skeleton') },
  'dex-trades': { load: () => import('lib/api/dex-trades') },
  'dex-venue': { load: () => import('lib/api/dex-venue') },
  dex: { load: () => import('lib/api/dex') },
  geo: { load: () => import('lib/api/geo') },
  history: { load: () => import('lib/api/history') },
  lst: { load: () => import('lib/api/lst') },
  'pool-fees': { load: () => import('lib/api/pool-fees') },
  // Reads its own body after checking the token, gzipped or not.
  'pool-scans': { load: () => import('lib/api/pool-scans') },
  positions: { load: () => import('lib/api/positions') },
  predict: { load: () => import('lib/api/predict') },
  'price-history': { load: () => import('lib/api/price-history') },
  'price-record': { load: () => import('lib/api/price-record') },
  'push-check': { load: () => import('lib/api/push-check') },
  push: { load: () => import('lib/api/push'), json: true },
  quote: { load: () => import('lib/api/quote') },
  stats: { load: () => import('lib/api/stats') },
  'token-check': { load: () => import('lib/api/token-check') },
  volume: { load: () => import('lib/api/volume') },
}

/** What Next's body parser allowed by default. */
const JSON_LIMIT = 1_000_000

async function api(req: NextApiRequest, res: NextApiResponse) {
  const name = String(req.query.route ?? '')
  const route = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : undefined
  if (!route) return res.status(404).json({ error: 'no such endpoint' })
  // The handlers see their own query, as they did as separate files.
  delete req.query.route
  if (route.json && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    try {
      req.body = await readJsonBody(req, JSON_LIMIT)
    } catch (e) {
      return res.status(400).json({ error: e instanceof BadBody ? `the body is ${e.message}` : 'the body could not be read' })
    }
  }
  const { default: handler } = await route.load()
  return handler(req, res)
}

// TEMPORARY: CPU per route (lib/cpuLog).
export default async function logged(req: NextApiRequest, res: NextApiResponse) {
  return withCpu(`api/${String(req.query.route ?? '')}`, api)(req, res)
}
