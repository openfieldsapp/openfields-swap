import { wallets as keplrWallets } from '@cosmos-kit/keplr-extension'
import { wallets as keplrMobileWallets } from '@cosmos-kit/keplr-mobile'
import { wallets as vultisigWallets } from '@cosmos-kit/vultisig-extension'

/** WalletConnect Cloud project id. Only needed for mobile wallets (Keplr Mobile). */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ''

/** Leap was removed on 2026-09-14: the wallet has been shut down. */
/**
 * Vultisig, on a computer, when its extension is in this browser (it has no phone connection). It signs
 * Swap's contract calls, sends and IBC transfers on Terra (not every source chain of the bridge). Left out when it is not installed, so the kit does not log a missing wallet for every visitor.
 */
const HAS_VULTISIG = typeof window !== 'undefined' && !!(window as unknown as { vultisig?: { keplr?: unknown } }).vultisig?.keplr
export const customWallets = [...keplrWallets, ...(HAS_VULTISIG ? vultisigWallets : [])]

/** Mobile wallets connect over WalletConnect and need a project id; without one the list is empty. */
export const mobileWallets = WALLETCONNECT_PROJECT_ID ? [...keplrMobileWallets] : []
