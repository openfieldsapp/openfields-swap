/**
 * The list of wallets, as in Openfields Ask: browser extensions on a computer,
 * the in-app browser's own wallet inside Keplr Mobile, WalletConnect wallets on
 * other phones (when a project id is configured). A refusal in the wallet is
 * shown on its row in the wallet's own words; the kit records it rather than
 * throwing it, so it is read from the chain wallet after connecting.
 */

import { useEffect, useState } from 'react'
import { useChainWallet } from '@cosmos-kit/react'
import { wallets as keplrWallets } from '@cosmos-kit/keplr-extension'
import { customWallets, mobileWallets } from 'constants/wallet'
import { defaultChain } from 'constants/chain'
import { ExternalLink, Icon, Modal } from 'components/ui'
import { useLang } from 'lib/i18n'

type WalletList = typeof customWallets

function listForThisDevice(): WalletList {
  if (typeof window === 'undefined') return customWallets
  const ua = window.navigator.userAgent.toLowerCase()
  if (ua.includes('keplrwalletmobile')) return keplrWallets as WalletList
  if (/android|iphone|ipad|ipod|mobile/.test(ua)) return (mobileWallets.length ? mobileWallets : []) as WalletList
  return customWallets
}

function WalletRow({ wallet, onDone }: { wallet: WalletList[number]; onDone: () => void }) {
  const w = useChainWallet(defaultChain, wallet.walletName)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const logo = wallet.walletInfo.logo
  const src = typeof logo === 'string' ? logo : logo && 'major' in logo ? logo.major : undefined
  return (
    <div>
      <button
        type='button'
        className='of-wallet-opt'
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={async () => {
          setErr(null)
          setBusy(true)
          const say = (m: string) => setErr(/reject|denied|cancel/i.test(m) ? 'You declined in the wallet.' : /not exist|not installed/i.test(m) ? `${wallet.walletPrettyName} is not in this browser.` : m && m !== 'InitClient' ? m.slice(0, 120) : 'The wallet did not connect. Try again.')
          try {
            await w.connect()
            // The kit records a refusal on the chain wallet instead of throwing it.
            const cw = w.chainWallet
            if (cw && !cw.address) { say(cw.message ?? ''); return }
            onDone()
          } catch (e) {
            say(e instanceof Error ? e.message : '')
          } finally { setBusy(false) }
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the wallet's own logo, embedded in the kit as a data URI */}
        {src ? <img src={src} alt='' width={28} height={28} /> : <span className='of-wallet-opt-logo' aria-hidden />}
        <span>{wallet.walletPrettyName}</span>
        {busy ? <span className='of-spin' aria-hidden /> : <Icon name='chevronRight' size={16} />}
      </button>
      {err && <p className='of-error of-wallet-opt-err' role='alert'>{err}</p>}
    </div>
  )
}

export default function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLang()
  const [wallets, setWallets] = useState<WalletList>(customWallets)
  useEffect(() => { setWallets(listForThisDevice()) }, [])
  return (
    <Modal open={open} onClose={onClose} title={t('Connect a wallet')} subtitle={t('Your wallet shows every message before you sign.')}>
      <div className='of-wallet-opts'>
        {wallets.length === 0 && (
          <>
            <p className='of-note'>{t('No wallet in this browser. Open this page in the Keplr app, or use Keplr in a desktop browser.')}</p>
            {/* Keplr's deep link opens a page in the app's own browser, which has the wallet built in. */}
            <a className='of-btn of-btn--primary of-btn--lg of-btn--block' href={`keplrwallet://web-browser?url=${encodeURIComponent(`${window.location.origin}/`)}`}>{t('Open in the Keplr app')}</a>
            <ExternalLink href='https://www.keplr.app/download' className='of-btn of-btn--quiet of-btn--block'>{t('Get Keplr')}</ExternalLink>
          </>
        )}
        {wallets.map(w => <WalletRow key={w.walletName} wallet={w} onDone={onClose} />)}
      </div>
    </Modal>
  )
}
