import Link from 'next/link'
import { Icon } from 'components/ui'
import { CURRENT_PRODUCT, GROUPS, HOME_URL, PRODUCTS } from 'lib/products'
import { useLang } from 'lib/i18n'
import { usePopover } from './usePopover'

/**
 * Every app in the family, one menu away from the name: in the order people
 * use them (where to start, doing things, taking part, looking things up).
 * The links are in the page even while the menu is closed, so the family
 * stays linked for anyone reading the HTML. The same menu as in Openfields Ask.
 */
export default function AppSwitcher() {
  const { t } = useLang()
  const { open, setOpen, root } = usePopover()
  const byKey = new Map(PRODUCTS.map(p => [p.key, p]))
  const apps = GROUPS.flatMap(g => g.keys).map(k => byKey.get(k)).filter(p => p !== undefined)

  return (
    <div ref={root} className='of-menu'>
      <button type='button' className='of-icon-btn' aria-label={t('Openfields apps')} title={t('Openfields apps')} aria-expanded={open} aria-controls='of-apps' onClick={() => setOpen(o => !o)}>
        <Icon name='chevronDown' size={16} />
      </button>
      <nav id='of-apps' className='of-pop of-apps' aria-label={t('Openfields apps')} hidden={!open}>
        <div className='of-apps-grid'>
          {apps.map(p => p.key === CURRENT_PRODUCT ? (
            <Link key={p.key} href='/' className='of-app-item' aria-current='page' onClick={() => setOpen(false)}>
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
