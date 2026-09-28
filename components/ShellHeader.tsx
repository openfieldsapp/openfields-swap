/**
 * The header every Openfields app shares, in the same place and at the same
 * width in each: the apps on their own full-width row, then the kicker, the
 * wordmark and the address, with the wallet on the right of the wordmark's line. It sits in its own full-width
 * container above the page, so the swap's narrower column below it keeps its
 * width. The page's own tabs, if it has any, go in as children.
 */

import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { MouseEvent, ReactNode } from 'react'
import AppSwitcher from 'components/AppSwitcher'
import { IS_ASTRO } from 'lib/dex'
import { useLang } from 'lib/i18n'

// The wallet kit is loaded on its own, so a token, pool or receipt page does not carry it in its first load.
const WalletButton = dynamic(() => import('components/WalletButton'), { ssr: false, loading: () => <span className='tl-btn tl-btn--pill'>Connect</span> })

export default function ShellHeader({ children, onWordmarkClick }: { children?: ReactNode; onWordmarkClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  const { t } = useLang()
  const word = IS_ASTRO ? 'Pools' : 'Swap'
  return (
    <div className='tl-container tl-shell-head'>
      {/* The apps on the full width, above the wordmark's row, so the wordmark sits at the same height in every app. */}
      {!IS_ASTRO && <AppSwitcher />}
      <header className='tl-hero'>
        <div className='tl-hero-main'>
          <div className='tl-kicker'>{IS_ASTRO ? 'Unofficial · Astroport pools' : t('Experimental')}</div>
          <h1 className='tl-wordmark'>
            <Link href='/' prefetch={false} aria-label={`Terra ${word}, home`} title='Home' onClick={onWordmarkClick}>
              <span><span className='tl-word-strong'>Terra</span> <span className='tl-word-light'>{word}</span></span>
            </Link>
          </h1>
          <div className='tl-domain'>openfields.app</div>
        </div>
        <div className='tl-hero-actions'>
          <WalletButton className='tl-btn tl-btn--pill' />
        </div>
      </header>
      {children}
    </div>
  )
}
