/**
 * The connected Terra address, for parts of the page outside the wallet kit (the ✦ in the corner). The kit
 * publishes it (components/providers/WalletAddress); nothing here is stored, and it is empty until a wallet
 * connects. The same file in Stake and Swap.
 */

import { useSyncExternalStore } from 'react'

let current = ''
const listeners = new Set<() => void>()

export function setWalletAddress(address: string) {
  if (address === current) return
  current = address
  listeners.forEach(fn => fn())
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

export function useWalletAddress(): string {
  return useSyncExternalStore(subscribe, () => current, () => '')
}
