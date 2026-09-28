/**
 * Keeps a wallet connected across the Openfields apps. Each app is its own
 * subdomain, so the wallet kit's saved session (local storage) stays behind
 * when someone moves from one app to another. A cookie on openfields.app
 * carries only which wallet they connected with, never the address, or that
 * they disconnected. An app that opens without a session of its own connects
 * the same wallet again when it is the browser extension (Keplr asks once per
 * app, the first time); a disconnect in one app disconnects the next one
 * opened. A WalletConnect session belongs to the site that made it, so a phone
 * connected that way connects again in each app.
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
  const now = useRef({ status, disconnect, connect: extension.connect })
  now.current = { status, disconnect, connect: extension.connect }
  const was = useRef(status)
  const settled = useRef(false)

  // Remember the wallet on every connect, and a disconnect the person chose (after the start, not the kit's own first state)
  useEffect(() => {
    if (status === 'Connected' && wallet?.name) carry(wallet.name)
    else if (settled.current && was.current === 'Connected' && status === 'Disconnected') carry(OFF)
    was.current = status
  }, [status, wallet?.name])

  // Once, after the kit has restored whatever this app had: follow what was chosen in the others
  useEffect(() => {
    const t = setTimeout(() => {
      settled.current = true
      const wanted = readCarried()
      const { status: s, disconnect: off, connect } = now.current
      if (wanted === OFF && s === 'Connected') { off(); return }
      const keplr = (window as unknown as { keplr?: unknown }).keplr
      if (wanted === EXTENSION && s !== 'Connected' && s !== 'Connecting' && keplr) connect().catch(() => { /* declined in Keplr: stays disconnected */ })
    }, SETTLE_MS)
    return () => clearTimeout(t)
  }, [])

  return null
}
