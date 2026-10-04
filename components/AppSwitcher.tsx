/**
 * Every app in the family, on one line at the top of the page.
 *
 * This used to be an "Openfields ▾" dropdown, which put four of the five apps
 * behind a click and a guess about what the menu held. Showing them costs one
 * line and removes both. Each app is its symbol and its word; the app you are
 * in is marked and is not a link, so the row never navigates to where you
 * already are.
 *
 * Kept deliberately lighter than the page's own tabs: two navigations
 * competing at the same weight are two navigations nobody reads.
 */

import { Fragment } from 'react'
import { useLang } from 'lib/i18n'

const trim = (u: string) => u.replace(/\/+$/, '')
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
export const HOME_URL = trim(process.env.NEXT_PUBLIC_HOME_URL || 'https://openfields.app')

export type ProductKey = 'home' | 'ask' | 'swap' | 'stake' | 'nft' | 'gov' | 'daily' | 'scan' | 'data' | 'status'
export const CURRENT_PRODUCT: ProductKey = 'swap'

/** Every app in the family. The description is the English key; the switcher translates it. */
export const PRODUCTS: { key: ProductKey; word: string; glyph: string; description: string; url: string }[] = [
  { key: 'home', word: 'Home', glyph: '⌂', description: 'Everything your wallet holds, stakes, owes and votes on', url: TERRA_HOME_URL },
  { key: 'ask', word: 'Ask', glyph: '✦', description: 'Say what you want to do on Terra or Injective, approve it in your wallet', url: ASK_URL },
  { key: 'swap', word: 'Swap', glyph: '⇅', description: 'Swap tokens, pools, liquidity, transfers', url: '/' },
  { key: 'stake', word: 'Stake', glyph: '⬢', description: 'Stake LUNA, move it, collect rewards', url: STAKE_URL },
  { key: 'nft', word: 'NFT', glyph: '◆', description: 'Collections, items, listings and offers', url: NFT_URL },
  { key: 'gov', word: 'Gov', glyph: '§', description: 'Proposals, votes and the community pool', url: GOV_URL },
  { key: 'daily', word: 'Daily', glyph: '◷', description: 'A daily move, a calm minute and five Terra questions', url: DAILY_URL },
  { key: 'scan', word: 'Scan', glyph: '⌕', description: 'Transactions, addresses and blocks', url: SCAN_URL },
  { key: 'data', word: 'Data', glyph: '▦', description: 'How the apps on Terra are used', url: DATA_URL },
  { key: 'status', word: 'Status', glyph: '●', description: 'Blocks, validators, bridges and endpoints, live', url: STATUS_URL },
]

/** The apps in the order people use them: where to start (Ask, Home), doing things, taking part, looking things up. */
export const GROUPS: { label: string; keys: ProductKey[] }[] = [
  { label: 'Start', keys: ['ask', 'home'] },
  { label: 'Do', keys: ['swap', 'stake', 'nft'] },
  { label: 'Take part', keys: ['gov', 'daily'] },
  { label: 'Look up', keys: ['scan', 'data', 'status'] },
]

/** Where most people start: Ask does what you say, Home shows what you have. Marked in the switcher. */
export const PRIMARY: ProductKey[] = ['ask', 'home']

const byKey = new Map(PRODUCTS.map(p => [p.key, p]))

/**
 * Every app in the family on one line at the top of the page, in the order people use them (where to start:
 * Ask and Home, then doing things, taking part, looking things up), with a hairline between the groups. The app you are in is
 * marked and is not a link, so the row never moves under you.
 */
export default function AppSwitcher() {
  const { t } = useLang()
  return (
    <nav className='tl-eco' aria-label={t('Openfields apps')}>
      {GROUPS.map((g, gi) => (
        <Fragment key={g.label}>
          {gi > 0 && <span className='tl-eco-sep' aria-hidden />}
          {g.keys.map(k => {
            const p = byKey.get(k)
            if (!p) return null
            const inner = <><span className='tl-eco-glyph' aria-hidden>{p.glyph}</span>{p.word}</>
            const cls = `tl-eco-item${PRIMARY.includes(k) ? ' is-primary' : ''}`
            return k === CURRENT_PRODUCT
              ? <span key={k} className={`${cls} is-here`} aria-current='page'>{inner}</span>
              : <a key={k} className={cls} href={p.url} title={t(p.description)}>{inner}</a>
          })}
        </Fragment>
      ))}
      <a className='tl-eco-home' href={HOME_URL}>{t('All apps')}</a>
    </nav>
  )
}

/** The same apps, grouped, at the foot of the page. */
export function FooterApps() {
  const { t } = useLang()
  return (
    <nav className='tl-footer-apps' aria-label={t('Openfields apps')}>
      {GROUPS.map(g => (
        <div key={g.label} className='tl-footer-group'>
          <span className='tl-footer-label'>{t(g.label)}</span>
          {g.keys.map(k => {
            const p = byKey.get(k)
            if (!p) return null
            return k === CURRENT_PRODUCT
              ? <span key={k} className='tl-footer-here'>Openfields {p.word}</span>
              : <a key={k} href={p.url}>Openfields {p.word}</a>
          })}
        </div>
      ))}
    </nav>
  )
}
