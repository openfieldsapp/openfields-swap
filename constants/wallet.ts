import { wallets as keplrWallets } from '@cosmos-kit/keplr-extension'
import { wallets as keplrMobileWallets } from '@cosmos-kit/keplr-mobile'
import { wallets as vultisigWallets } from '@cosmos-kit/vultisig-extension'
import { hasStation, isStationKeplr, stationWallets } from 'lib/wallet/station'

/** WalletConnect Cloud project id. Only needed for mobile wallets (Keplr Mobile). */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ''

/** Leap was removed on 2026-09-14: the wallet has been shut down. */
/**
 * Vultisig, on a computer, when its extension is in this browser (it has no phone connection). It signs
 * Swap's contract calls, sends and IBC transfers on Terra (not every source chain of the bridge). Left out when it is not installed, so the kit does not log a missing wallet for every visitor.
 */
const HAS_VULTISIG = typeof window !== 'undefined' && !!(window as unknown as { vultisig?: { keplr?: unknown } }).vultisig?.keplr
/**
 * Station (lib/wallet/station), on a computer, when its extension is in this browser: it signs in amino mode.
 * When it has taken window.keplr as the default wallet, the Keplr row would reach Station under Keplr's name, so
 * it is left out and Station is offered as itself.
 */
const HAS_STATION = hasStation()
const KEPLR_IS_STATION = typeof window !== 'undefined' && isStationKeplr((window as unknown as { keplr?: unknown }).keplr)
export const customWallets = [...(KEPLR_IS_STATION ? [] : keplrWallets), ...(HAS_VULTISIG ? vultisigWallets : []), ...(HAS_STATION ? stationWallets : [])]

/** Mobile wallets connect over WalletConnect and need a project id; without one the list is empty. */
export const mobileWallets = WALLETCONNECT_PROJECT_ID ? [...keplrMobileWallets] : []
