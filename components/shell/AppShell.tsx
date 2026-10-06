/**
 * The frame every Openfields app shares, as in Openfields Ask: the mark and the
 * app's name, the menu of every app, a few quiet links, the wallet, and a quiet
 * footer. The swap's own places (Pools, Portfolio, Bridge) are the links; on
 * the swap page they switch without a reload (./nav).
 */

import { ReactNode, useEffect, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { Icon } from 'components/ui'
import RegionBanner from 'components/RegionBanner'
import { IS_ASTRO } from 'lib/dex'
import { HOME_URL } from 'lib/products'
import { LANGS, setLang, useLang, type Lang } from 'lib/i18n'
import AppSwitcher from './AppSwitcher'
import { SECTION_HREF, useSectionNav, type Section } from './nav'
import WalletPill from './WalletPill'

const APP_WORD = IS_ASTRO ? 'Pools' : 'Swap'
const SOURCE_URL = 'https://github.com/openfieldsapp/openfields-swap'

type Page = Section | 'how' | 'stats' | 'verify' | 'developers' | 'predict' | 'other'

/** The header gets a hairline once the page moves under it. */
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const read = () => setScrolled(window.scrollY > 4)
    read()
    window.addEventListener('scroll', read, { passive: true })
    return () => window.removeEventListener('scroll', read)
  }, [])
  return scrolled
}

/** A link to one of the swap's places: switches in place on the swap page, an ordinary link elsewhere. */
function SectionLink({ to, className, children, current }: { to: Section; className?: string; children: ReactNode; current?: boolean }) {
  const nav = useSectionNav()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!nav || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    nav.go(to)
  }
  return <Link href={SECTION_HREF[to]} prefetch={false} className={className} aria-current={current ? 'page' : undefined} onClick={onClick}>{children}</Link>
}

export default function AppShell({ children, page = 'other', wide = false }: { children: ReactNode; page?: Page; wide?: boolean }) {
  const scrolled = useScrolled()
  const nav = useSectionNav()
  const { lang, t } = useLang()
  const here = (p: Page) => (page === p ? 'page' as const : undefined)

  return (
    <div className='of-app'>
      <header className='of-top' data-scrolled={scrolled}>
        <div className='of-top-in'>
          <SectionLink to='swap' className='of-brand'>
            {/* eslint-disable-next-line @next/next/no-img-element -- a 24px mark; next/image in this Next passes a prop React 18.2 rejects */}
            <img src='/img/openfields-x-180.png?v=20260923' alt='' width={24} height={24} />
            <span className='of-brand-word'><b>Openfields</b> {APP_WORD}<span className='of-sr'>, home</span></span>
          </SectionLink>
          {!IS_ASTRO && <AppSwitcher />}
          <div className='of-top-end'>
            <SectionLink to='pools' className='of-top-link' current={page === 'pools'}>{t('Pools')}</SectionLink>
            <SectionLink to='portfolio' className='of-top-link' current={page === 'portfolio'}>{t('Portfolio')}</SectionLink>
            <SectionLink to='bridge' className='of-top-link' current={page === 'bridge'}>{t('Bridge')}</SectionLink>
            {nav
              ? <button type='button' className='of-icon-btn' aria-label={t('Search')} title={`${t('Search')} (⌘K)`} onClick={nav.search}><Icon name='search' size={18} /></button>
              : <Link href='/?search=1' prefetch={false} className='of-icon-btn' aria-label={t('Search')} title={t('Search')}><Icon name='search' size={18} /></Link>}
            <WalletPill />
          </div>
        </div>
      </header>

      <RegionBanner />
      <main className={wide ? 'of-main sw-wide' : 'of-main'}>{children}</main>

      <footer className='of-foot'>
        <div className='of-foot-in'>
          <nav className='of-foot-links' aria-label={`About Openfields ${APP_WORD}`}>
            <SectionLink to='pools' current={page === 'pools'}>{t('Pools')}</SectionLink>
            <SectionLink to='portfolio' current={page === 'portfolio'}>{t('Portfolio')}</SectionLink>
            <SectionLink to='bridge' current={page === 'bridge'}>{t('Bridge')}</SectionLink>
            {!IS_ASTRO && <SectionLink to='board' current={page === 'board'}>{t('Board')}</SectionLink>}
            <Link href='/how' prefetch={false} aria-current={here('how')}>How it works</Link>
            <Link href='/stats' prefetch={false} aria-current={here('stats')}>Stats</Link>
            <Link href='/verify' prefetch={false} aria-current={here('verify')}>Verify</Link>
            <Link href='/developers' prefetch={false} aria-current={here('developers')}>Developers</Link>
            <a href={SOURCE_URL} target='_blank' rel='noopener noreferrer'>Source code</a>
            <a href={HOME_URL}>All Openfields apps</a>
          </nav>
          <div className='sw-foot-row'>
            <p className='of-foot-note'>
              An independent project, not an official Terra product. Not affiliated with, endorsed by or connected to
              Terraform Labs, Phoenix Foundation, Astroport, Skeleton Swap or White Whale. Experimental and not financial advice.
            </p>
            <label className='sw-lang'>
              <span className='of-sr'>Language</span>
              <select value={lang} onChange={e => setLang(e.target.value as Lang)}>
                {LANGS.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
              <Icon name='chevronDown' size={14} />
            </label>
          </div>
        </div>
      </footer>
    </div>
  )
}
