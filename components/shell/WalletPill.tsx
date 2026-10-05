/**
 * The wallet in the header, on every page: "Connect", or the connected address
 * with a small panel, like being signed in. The same pill as in Openfields Ask.
 * In a region where wallet actions are withheld it says so instead (the banner
 * under the header explains); pages and data stay open.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Icon } from 'components/ui'
import useMyAddress from 'components/hooks/useMyAddress'
import { useWallet } from 'components/providers/WalletProvider'
import { useTxRegionGate } from 'components/RegionGate'
import ConnectModal from 'components/wallet/ConnectModal'
import { CONNECT_EVENT, shortAddress } from 'components/wallet/connect'
import { SCAN_ADDRESS } from 'lib/products'
import { useLang } from 'lib/i18n'
import { SECTION_HREF, useSectionNav } from './nav'
import { usePopover } from './usePopover'

export default function WalletPill() {
  const me = useMyAddress()
  const { disconnect } = useWallet()
  const { txAllowed, country } = useTxRegionGate()
  const nav = useSectionNav()
  const { t } = useLang()
  const [connecting, setConnecting] = useState(false)
  const [copied, setCopied] = useState(false)
  const { open, setOpen, root } = usePopover()

  // Anything on the page can ask for the list of wallets (components/wallet/connect).
  useEffect(() => {
    const on = () => { if (txAllowed !== false) setConnecting(true) }
    window.addEventListener(CONNECT_EVENT, on)
    return () => window.removeEventListener(CONNECT_EVENT, on)
  }, [txAllowed])
  useEffect(() => { if (!me) setOpen(false); else setConnecting(false) }, [me, setOpen])

  if (!me) {
    if (txAllowed === false) {
      return <span className='of-wallet-btn of-wallet-btn--connect sw-browse' title={`Wallet actions are not available in ${country ?? 'your region'}.`}>{t('Browse only')}</span>
    }
    return (
      <>
        <button type='button' className='of-wallet-btn of-wallet-btn--connect' onClick={() => setConnecting(true)}>{t('Connect')}</button>
        <ConnectModal open={connecting} onClose={() => setConnecting(false)} />
      </>
    )
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(me); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ }
  }
  return (
    <div ref={root} className='of-menu'>
      <button type='button' className='of-wallet-btn' aria-expanded={open} aria-controls='of-wallet' onClick={() => setOpen(o => !o)}>
        <i className='of-wallet-dot' aria-hidden />
        <span className='of-num of-addr-long'>{shortAddress(me)}</span>
        <span className='of-num of-addr-short'>{shortAddress(me, true)}</span>
        <span className='of-sr'>, wallet</span>
        <Icon name='chevronDown' size={14} />
      </button>
      <div id='of-wallet' className='of-pop of-pop--end of-wallet-pop' hidden={!open}>
        <div className='of-pop-label'>{t('Terra address')}</div>
        <div className='of-wallet-addr'>{me}</div>
        <button type='button' className='of-pop-item' onClick={copy}>
          {t(copied ? 'Copied' : 'Copy address')}
          <Icon name={copied ? 'check' : 'copy'} size={16} />
        </button>
        <Link className='of-pop-item' href={SECTION_HREF.portfolio} onClick={e => { setOpen(false); if (nav) { e.preventDefault(); nav.go('portfolio') } }}>
          {t('Portfolio')}
          <Icon name='chevronRight' size={16} />
        </Link>
        <a className='of-pop-item' href={SCAN_ADDRESS(me)} target='_blank' rel='noopener noreferrer'>
          {t('View on Openfields Scan')}
          <Icon name='external' size={16} />
        </a>
        <div className='of-pop-sep' />
        <button type='button' className='of-pop-item of-wallet-off' onClick={() => { setOpen(false); disconnect() }}>{t('Disconnect')}</button>
      </div>
    </div>
  )
}
