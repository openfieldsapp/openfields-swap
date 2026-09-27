/**
 * GET /api/dex-leaderboard — the public board for Atrium Swap (lib/board).
 *
 * Served from the last snapshot. The pool-scan workflow scans the chain into
 * it every five minutes when it can write the store; this route scans itself
 * only when the snapshot is three times that old (the workflow has stopped,
 * or this host runs without it). Each scan reads every pool's recent
 * transactions, which is most of what the board costs.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { isDexLive, IS_ASTRO } from 'lib/dex'
import { BADGES, POINTS, FIRST_HAND_POINTS, CRYSTAL_MULTIPLIER, EARLY_CUTOFF_HEIGHT, LIQUIDITY_POINTS_COEFF } from 'lib/dex-ledger'
import { BOARD_EVERY_MS, buildBoard, readBoard, type BoardResponse, type BoardSnap } from 'lib/board'

export type { BoardResponse, PoolActivity } from 'lib/board'

let building: Promise<BoardSnap | null> | null = null

export default async function handler(_req: NextApiRequest, res: NextApiResponse<BoardResponse>) {
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600')
  const rules = { points: POINTS, firstHand: FIRST_HAND_POINTS, crystalMultiplier: CRYSTAL_MULTIPLIER, badges: BADGES, cutoffHeight: EARLY_CUTOFF_HEIGHT, liquidityCoeff: LIQUIDITY_POINTS_COEFF }
  // Astroport mode has no board: their history is not ours to score, and the scan would fan out over ~850 pools.
  if (!isDexLive() || IS_ASTRO) return res.status(200).json({ live: false, rows: [], totalEvents: 0, scannedAt: 0, rules, recent: [], poolActivity: {}, firstHands: {}, lotd: null, flows: {} })

  let snap = await readBoard()
  if (!snap || Date.now() - snap.at >= 3 * BOARD_EVERY_MS) {
    building ??= buildBoard().finally(() => { building = null })
    snap = (await building) ?? snap
  }
  if (!snap) return res.status(200).json({ live: true, rows: [], totalEvents: 0, scannedAt: 0, rules, recent: [], poolActivity: {}, firstHands: {}, lotd: null, flows: {} })
  return res.status(200).json({ live: true, rows: snap.rows, totalEvents: snap.total, scannedAt: snap.at, rules, recent: snap.recent ?? [], poolActivity: snap.poolActivity ?? {}, firstHands: snap.firstHands ?? {}, lotd: snap.lotd ?? null, flows: snap.flows ?? {} })
}
