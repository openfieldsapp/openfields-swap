/**
 * The way back into the app from its pages (/stats, /verify, a token, a pool,
 * a receipt): every section by name, each opening that tab, so a page that
 * answers a question is never a dead end. Same names as the tabs on the front
 * page, and the same row under the header as the other Openfields apps' tabs.
 */

import Link from 'next/link'

const LINKS = [
  { key: 'swap', href: '/', label: 'Swap' },
  { key: 'pools', href: '/?tab=pools', label: 'Pools' },
  { key: 'bridge', href: '/?tab=bridge', label: 'Bridge' },
  { key: 'portfolio', href: '/?tab=portfolio', label: 'Portfolio' },
  { key: 'stats', href: '/stats', label: 'Stats' },
  { key: 'verify', href: '/verify', label: 'Verify' },
] as const

export default function SiteNav({ here }: { here?: 'stats' | 'verify' }) {
  return (
    <nav className='tl-tabs' aria-label='Terra Swap'>
      {LINKS.map(l => {
        const on = l.key === here
        return (
          <Link key={l.key} href={l.href} prefetch={false} className={`tl-btn${on ? ' is-active' : ''}`} aria-current={on ? 'page' : undefined}>{l.label}</Link>
        )
      })}
    </nav>
  )
}
