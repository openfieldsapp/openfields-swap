/**
 * The public board: the factory and every pool scanned for fresh tx events,
 * merged into the durable ledger (idempotent), then ranked. Served by
 * /api/dex-leaderboard from the last snapshot. The pool-scan workflow builds
 * it every five minutes when it can write the store (scripts/pool-scans.ts);
 * the route builds it itself only when the snapshot is three times that old.
 */

import { kv as vercelKv } from '@vercel/kv'
import { queryPairs, DEX_FACTORY } from 'lib/dex'
import { readLiquidity, liquidityByAddress } from 'lib/liquidity'
import { scanContract, mergeLedger, computeLeaderboard, computeFlows, type BADGES, type POINTS, type LeaderRow, type DexEvent, type LpFlow } from 'lib/dex-ledger'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
export const BOARD_KEY = `atrium:dex:board:v2:${DEX_FACTORY}`
/** How often the board is scanned (every minute until 2026-09-25, when Openfields moved to Vercel's Hobby plan). */
export const BOARD_EVERY_MS = 300_000
/** Safety cap so a factory with many pools cannot fan out unboundedly. */
const MAX_POOLS_SCANNED = 40

export interface PoolActivity { last: number; count: number }

export interface BoardResponse {
  live: boolean
  rows: LeaderRow[]
  totalEvents: number
  scannedAt: number
  /** newest moves across every pool, for the wire */
  recent: DexEvent[]
  /** per contract: latest height + total moves, for the pool vibe tags */
  poolActivity: Record<string, PoolActivity>
  rules: { points: typeof POINTS; firstHand: number; crystalMultiplier: number; badges: typeof BADGES; cutoffHeight: number; liquidityCoeff: number }
  /** who seeded each pool first — the promise, made visible per pool */
  firstHands: Record<string, { address: string; height: number; txhash: string }>
  /** most moves in the last ~24h of blocks */
  lotd: { address: string; moves: number } | null
  /** net liquidity per wallet per pool, keyed `${address}|${contract}` */
  flows: Record<string, LpFlow>
}

export type BoardSnap = { at: number; rows: LeaderRow[]; total: number; recent: DexEvent[]; poolActivity: Record<string, PoolActivity>; firstHands: Record<string, { address: string; height: number; txhash: string }>; lotd: { address: string; moves: number } | null; flows: Record<string, LpFlow> }
let memCache: BoardSnap | null = null

/** The last snapshot, however old. */
export async function readBoard(): Promise<BoardSnap | null> {
  return HAS_KV ? await vercelKv.get<BoardSnap>(BOARD_KEY).catch(() => null) : memCache
}

/** Scan, merge and rank, and keep the snapshot. Null when the factory did not answer (an empty allowlist would delete the ledger). */
export async function buildBoard(): Promise<BoardSnap | null> {
  const pairs = await queryPairs()
  // No pools means the query failed, not that the factory is empty. Serving a
  // stale board is fine; merging an empty allowlist would delete the ledger.
  if (pairs.length === 0) return null

  // Scanning is capped because every pool costs a query. The allowlist is not:
  // it decides which events are allowed to keep existing, so a pool that did
  // not fit this round's scan budget still owns its history. Until 2026-09-10
  // these were the same truncated list, which deleted the ledger of every pool
  // past the twelfth — points on the board fell as new pools were opened.
  const toScan = pairs.slice(0, MAX_POOLS_SCANNED)
  const scans = await Promise.all([
    scanContract(DEX_FACTORY),
    ...toScan.map(p => scanContract(p.contract_addr)),
  ])
  const allowed = new Set<string>([DEX_FACTORY, ...pairs.map(p => p.contract_addr)])
  const { ledger } = await mergeLedger(scans.flat(), allowed)
  // Live LP balances, so points follow liquidity that is still there.
  const standing = liquidityByAddress(await readLiquidity())
  const rows = await computeLeaderboard(ledger, standing)
  const events = Object.values(ledger.events)
  const total = events.length
  const recent = [...events].sort((a, b) => b.height - a.height).slice(0, 14)
  const poolActivity: Record<string, PoolActivity> = {}
  for (const e of events) {
    const a = poolActivity[e.contract] ?? { last: 0, count: 0 }
    a.count += 1; if (e.height > a.last) a.last = e.height
    poolActivity[e.contract] = a
  }
  const firstHands: Record<string, { address: string; height: number; txhash: string }> = {}
  for (const e of events) {
    if (e.action !== 'provide_liquidity') continue
    const cur = firstHands[e.contract]
    if (!cur || e.height < cur.height) firstHands[e.contract] = { address: e.address, height: e.height, txhash: e.txhash }
  }
  // Lunatic of the day: most moves in the last ~24h (14,400 blocks at 6s).
  const top = events.reduce((m, e) => Math.max(m, e.height), 0)
  const per = new Map<string, number>()
  for (const e of events) if (e.height >= top - 14_400) per.set(e.address, (per.get(e.address) ?? 0) + 1)
  const lotdEntry = Array.from(per.entries()).sort((a, b) => b[1] - a[1])[0]
  const lotd = lotdEntry ? { address: lotdEntry[0], moves: lotdEntry[1] } : null
  const flows = computeFlows(ledger)
  const snap: BoardSnap = { at: Date.now(), rows, total, recent, poolActivity, firstHands, lotd, flows }
  // Kept an hour, so the route can still serve it when a build fails.
  if (HAS_KV) await vercelKv.set(BOARD_KEY, snap, { ex: 3600 }); else memCache = snap

  return snap
}
