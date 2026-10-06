import Link from 'next/link'
import { Icon } from 'components/ui'
import { CURRENT_PRODUCT, GROUPS, HOME_URL, PRODUCTS } from 'lib/products'
import { useLang } from 'lib/i18n'
import { useSectionNav } from './nav'
import { usePopover } from './usePopover'

/**
 * The name in the header, and every app in the family behind it: the whole
 * name opens the menu, in the order people use the apps (where to start,
 * doing things, taking part, looking things up). This app's own row, checked,
 * goes back to its start. The links are in the page even while the menu is
 * closed, so the family stays linked for anyone reading the HTML. The same
 * menu as in Openfields Ask.
 */
export default function AppSwitcher({ name }: { name: string }) {
  const { t } = useLang()
  const { open, setOpen, root } = usePopover()
  const nav = useSectionNav()
  const byKey = new Map(PRODUCTS.map(p => [p.key, p]))
  const apps = GROUPS.flatMap(g => g.keys).map(k => byKey.get(k)).filter(p => p !== undefined)

  return (
    <div ref={root} className='of-menu'>
      <button type='button' className='of-brand' title={t('Openfields apps')} aria-expanded={open} aria-controls='of-apps' onClick={() => setOpen(o => !o)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a 24px mark; next/image in this Next passes a prop React 18.2 rejects */}
        <img src='/img/openfields-x-180.png?v=20260923' alt='' width={24} height={24} />
        <span className='of-brand-word'><b>Openfields</b> {name}</span>
        <span className='of-brand-chev'><Icon name='chevronDown' size={16} /></span>
      </button>
      <nav id='of-apps' className='of-pop of-apps' aria-label={t('Openfields apps')} hidden={!open}>
        <div className='of-apps-grid'>
          {apps.map(p => p.key === CURRENT_PRODUCT ? (
            <Link key={p.key} href='/' className='of-app-item' aria-current='page' onClick={e => {
              setOpen(false)
              // On the swap page the start is a tab, switched in place like the other places (./nav).
              if (nav && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) { e.preventDefault(); nav.go('swap') }
            }}>
              <b>Openfields {p.word}<Icon name='check' size={14} /></b>
              <span>{t(p.description)}</span>
            </Link>
          ) : (
            <a key={p.key} href={p.url} className='of-app-item'>
              <b>Openfields {p.word}</b>
              <span>{t(p.description)}</span>
            </a>
          ))}
        </div>
        <div className='of-apps-foot'>
          <Link href='/how' onClick={() => setOpen(false)}>How it works</Link>
          <a href={HOME_URL}>openfields.app</a>
        </div>
      </nav>
    </div>
  )
}
