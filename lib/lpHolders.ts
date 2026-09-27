/**
 * Who holds each pool's LP tokens, served by /api/dex-holders. The pool-scan
 * workflow rebuilds it every ten minutes when it can write the store
 * (scripts/pool-scans.ts); the route rebuilds it only when it is three times
 * that old.
 *
 * LP tokens are cw20s, so the holder list is public: `all_accounts` on the
 * token, then a balance each.
 */

import { kv as vercelKv } from '@vercel/kv'
import { DEX_FACTORY, queryPairs, smart } from 'lib/dex'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
export const HOLDERS_KEY = `atrium:dex:holders:v1:${DEX_FACTORY}`
/** Who holds a pool's LP tokens changes rarely, and each rebuild reads every holder's balance (about half a second of CPU). */
export const HOLDERS_EVERY_MS = 600_000
/** Holders read per pool. Beyond this the tail is dust and does not change the picture. */
const MAX_HOLDERS = 40

export interface Holder { address: string; amount: string }
export interface PoolHolders {
  /** LP total supply, smallest units */
  total: string
  /** Descending by size, capped at MAX_HOLDERS */
  holders: Holder[]
}
export interface HoldersResponse {
  live: boolean
  at: number
  /** keyed by pair contract address */
  pools: Record<string, PoolHolders>
}

let mem: HoldersResponse | null = null

async function readPool(lpToken: string): Promise<PoolHolders | null> {
  const info = await smart<{ total_supply: string }>(lpToken, { token_info: {} })
  if (!info?.total_supply) return null
  const accs = await smart<{ accounts: string[] }>(lpToken, { all_accounts: { limit: MAX_HOLDERS } })
  const addrs = accs?.accounts ?? []
  const balances = await Promise.all(addrs.map(async address => {
    const b = await smart<{ balance: string }>(lpToken, { balance: { address } })
    return { address, amount: b?.balance ?? '0' }
  }))
  const holders = balances
    .filter(h => Number(h.amount) > 0)
    .sort((a, b) => (Number(b.amount) - Number(a.amount)))
  return { total: info.total_supply, holders }
}

/** The last list, however old. */
export async function readHolders(): Promise<HoldersResponse | null> {
  return HAS_KV ? await vercelKv.get<HoldersResponse>(HOLDERS_KEY).catch(() => null) : mem
}

/** Read every pool's holders and keep the list; null when the factory or every pool failed to answer. */
export async function buildHolders(): Promise<HoldersResponse | null> {
  const pairs = await queryPairs()
  if (pairs.length === 0) return null
  const entries = await Promise.all(pairs.map(async p => [p.contract_addr, await readPool(p.liquidity_token)] as const))
  const pools: Record<string, PoolHolders> = {}
  for (const [addr, ph] of entries) if (ph) pools[addr] = ph
  if (Object.keys(pools).length === 0) return null
  const body: HoldersResponse = { live: true, at: Date.now(), pools }
  // Kept a few hours, so the route can still serve it when a rebuild fails.
  if (HAS_KV) await vercelKv.set(HOLDERS_KEY, body, { ex: 4 * 3600 }); else mem = body
  return body
}
