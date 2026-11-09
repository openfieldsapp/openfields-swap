/**
 * GET /api/dex-holders — who actually holds each pool's LP tokens.
 *
 * A pool's depth tells you what a trade costs today. It says nothing about
 * how long that depth will be there. If one wallet holds all of it, the pool
 * can go to zero in a single transaction, and anyone about to trade or deposit
 * deserves to know that before they do.
 *
 * LP tokens are cw20s, so the holder list is public: `all_accounts` on the
 * token, then a balance each. Pools here have a handful of holders, which
 * keeps this cheap; the cap and the cache keep it cheap if that changes.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { isDexLive, IS_ASTRO } from 'lib/dex'
import { HOLDERS_EVERY_MS, buildHolders, readHolders, type HoldersResponse } from 'lib/lpHolders'

export type { Holder, HoldersResponse, PoolHolders } from 'lib/lpHolders'

let building: Promise<HoldersResponse | null> | null = null

export default async function handler(_req: NextApiRequest, res: NextApiResponse<HoldersResponse>) {
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600')
  const now = Date.now()
  // Astroport mode: LP there sits mostly in their incentives contract, so a holder list misleads, and reading ~850 pools' holders is not a request.
  if (!isDexLive() || IS_ASTRO) return res.status(200).json({ live: false, at: now, pools: {} })
  let list = await readHolders()
  if (!list || now - list.at >= 3 * HOLDERS_EVERY_MS) {
    building ??= buildHolders().finally(() => { building = null })
    list = (await building) ?? list
  }
  return res.status(200).json(list ?? { live: true, at: now, pools: {} })
}
