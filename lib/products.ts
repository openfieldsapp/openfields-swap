/**
 * The Openfields products, for the app switcher and cross-product links.
 *
 * Only products that exist are listed. A product earns a place here when
 * people come to it for its own reason (trade tokens, own collectibles, follow
 * and vote on governance, see whether the chain is running), not because a
 * feature has its own API.
 */

export type ProductKey = 'swap' | 'nft' | 'gov' | 'status' | 'stake' | 'data' | 'scan' | 'daily' | 'ask' | 'home'

export interface Product {
  key: ProductKey
  /** "Openfields Status": the wordmark, bold first word, light second */
  word: string
  /** what someone goes there to do, in a few words */
  description: string
  url: string
  glyph: string
}

const trim = (u: string) => u.replace(/\/+$/, '')

export const SWAP_URL = trim(process.env.NEXT_PUBLIC_SWAP_URL || 'https://swap.openfields.app')
export const NFT_URL = trim(process.env.NEXT_PUBLIC_NFT_URL || 'https://nft.openfields.app')
export const GOV_URL = trim(process.env.NEXT_PUBLIC_GOV_URL || 'https://gov.openfields.app')
export const STATUS_URL = trim(process.env.NEXT_PUBLIC_STATUS_URL || 'https://status.openfields.app')
export const STAKE_URL = trim(process.env.NEXT_PUBLIC_STAKE_URL || 'https://stake.openfields.app')
export const DATA_URL = trim(process.env.NEXT_PUBLIC_DATA_URL || 'https://data.openfields.app')
export const SCAN_URL = trim(process.env.NEXT_PUBLIC_SCAN_URL || 'https://scan.openfields.app')
export const DAILY_URL = trim(process.env.NEXT_PUBLIC_DAILY_URL || 'https://daily.openfields.app')
export const ASK_URL = trim(process.env.NEXT_PUBLIC_ASK_URL || 'https://ask.openfields.app')
/** Openfields Home: one wallet on one page (not the openfields.app hub, which is HOME_URL) */
export const TERRA_HOME_URL = trim(process.env.NEXT_PUBLIC_TERRA_HOME_URL || 'https://home.openfields.app')
/** A transaction and an address on Openfields Scan. */
export const SCAN_TX = (hash: string) => `${SCAN_URL}/tx/${hash}`
export const SCAN_ADDRESS = (address: string) => `${SCAN_URL}/address/${address}`
/** openfields.app: every Openfields app on one page */
export const HOME_URL = trim(process.env.NEXT_PUBLIC_HOME_URL || 'https://openfields.app')

export const PRODUCTS: Product[] = [
  { key: 'home', word: 'Home', description: 'Everything your wallet holds, stakes, owes and votes on', url: TERRA_HOME_URL, glyph: '⌂' },
  { key: 'ask', word: 'Ask', description: 'Say what you want to do on Terra or Injective, approve it in your wallet', url: ASK_URL, glyph: '✦' },
  { key: 'swap', word: 'Swap', description: 'Swap tokens, pools, liquidity, transfers', url: SWAP_URL, glyph: '⇅' },
  { key: 'stake', word: 'Stake', description: 'Stake LUNA, move it, collect rewards', url: STAKE_URL, glyph: '⬢' },
  { key: 'nft', word: 'NFT', description: 'Collections, items, listings and offers', url: NFT_URL, glyph: '◆' },
  { key: 'gov', word: 'Gov', description: 'Proposals, votes and the community pool', url: GOV_URL, glyph: '§' },
  { key: 'daily', word: 'Daily', description: 'A daily move, a calm minute and five Terra questions', url: DAILY_URL, glyph: '◷' },
  { key: 'scan', word: 'Scan', description: 'Transactions, addresses and blocks', url: SCAN_URL, glyph: '⌕' },
  { key: 'data', word: 'Data', description: 'How the apps on Terra are used', url: DATA_URL, glyph: '▦' },
  { key: 'status', word: 'Status', description: 'Blocks, validators, bridges and endpoints, live', url: STATUS_URL, glyph: '●' },
]

/** The apps in the order people use them: where to start (Ask, Home), doing things, taking part, looking things up. */
export const GROUPS: { label: string; keys: ProductKey[] }[] = [
  { label: 'Start', keys: ['ask', 'home'] },
  { label: 'Do', keys: ['swap', 'stake', 'nft'] },
  { label: 'Take part', keys: ['gov', 'daily'] },
  { label: 'Look up', keys: ['scan', 'data', 'status'] },
]

export const CURRENT_PRODUCT: ProductKey = 'swap'
