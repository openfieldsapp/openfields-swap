/**
 * Keeps a wallet connected across the Openfields apps. Each app is its own
 * subdomain, so the wallet kit's saved session (local storage) stays behind
 * when someone moves from one app to another. A cookie on openfields.app
 * carries only which wallet they connected with, never the address, or that
 * they disconnected. An app that opens without a session of its own connects
 * the same wallet again when it is the browser extension (Keplr asks once per
 * app, the first time); a disconnect in one app disconnects the next one
 * opened. A WalletConnect session belongs to the site that made it, so a phone
 * connected that way connects again in each app. When Keplr's window is closed
 * or declined in an app, that app stops opening it by itself (until the person
 * connects there), so it does not pop up again on every visit.
 *
 * Rendered inside the wallet kit's provider; it draws nothing.
 */

import { useEffect, useRef } from 'react'
import { useChain, useChainWallet } from '@cosmos-kit/react'

const COOKIE = 'of_wallet'
const EXTENSION = 'keplr-extension'
const OFF = 'none'
/** How long after the kit starts to wait for it to restore this app's own session. */
const SETTLE_MS = 700
/** Where the wallet kit keeps this app's own session (cosmos-kit 2). */
const SAVED = 'cosmos-kit@2:core//current-wallet'
/** Set in this app when Keplr's window was closed or declined: it is not opened by itself again. */
const DECLINED = 'openfields:carry-declined:v1'

const declinedHere = (): boolean => { try { return localStorage.getItem(DECLINED) === '1' } catch { return false } }
const setDeclined = (on: boolean) => { try { if (on) localStorage.setItem(DECLINED, '1'); else localStorage.removeItem(DECLINED) } catch { /* asked again next time */ } }

export function readCarried(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)of_wallet=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : null
}

function carry(value: string) {
  const h = window.location.hostname
  const domain = h === 'openfields.app' || h.endsWith('.openfields.app') ? '; domain=.openfields.app' : ''
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax${secure}${domain}`
}

export default function WalletCarry({ chain = 'terra2' }: { chain?: string }) {
  const { status, wallet, disconnect } = useChain(chain)
  const extension = useChainWallet(chain, EXTENSION)
  const now = useRef({ status, wallet, disconnect, connect: extension.connect, connected: () => !!extension.chainWallet?.address })
  now.current = { status, wallet, disconnect, connect: extension.connect, connected: () => !!extension.chainWallet?.address }
  const was = useRef(status)
  const waited = useRef(false)
  const decided = useRef(false)

  // Once the kit has restored whatever this app had: follow what was chosen in the others. Until then
  // nothing is written, so this app's own old session cannot overwrite a disconnect made elsewhere.
  const decide = () => {
    const { status: s, wallet: w, disconnect: off, connect } = now.current
    // The kit has a session of its own saved here that it has not restored yet: wait for it
    if (s !== 'Connected' && s !== 'Error' && localStorage.getItem(SAVED)) return
    decided.current = true
    const wanted = readCarried()
    if (s === 'Connected') {
      if (wanted === OFF) off()
      else if (w?.name) { carry(w.name); setDeclined(false) }
      return
    }
    const keplr = (window as unknown as { keplr?: unknown }).keplr
    if (wanted === EXTENSION && keplr && !declinedHere()) {
      // The kit records a refusal instead of throwing it, so the outcome is read from the wallet afterwards.
      connect().then(() => { if (!now.current.connected()) setDeclined(true) }, () => setDeclined(true))
    }
  }

  useEffect(() => {
    if (!decided.current) {
      if (waited.current && status !== 'Connecting') decide()
    } else if (status === 'Connected' && wallet?.name) { carry(wallet.name); setDeclined(false) }
    else if (was.current === 'Connected' && status === 'Disconnected') carry(OFF)
    was.current = status
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decide reads the latest state through a ref
  }, [status, wallet?.name])

  useEffect(() => {
    const t = setTimeout(() => {
      waited.current = true
      if (now.current.status !== 'Connecting') decide()
    }, SETTLE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at the start
  }, [])

  return null
}
