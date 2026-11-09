/**
 * What Openfields Swap reads from a cosmos-kit chain wallet, read live from the chain wallet itself (as in
 * Openfields Ask). The kit never throws when a wallet says no: it records the reason on the chain wallet, so
 * that is read after connecting.
 */

export interface LiveChainWallet {
  connect: () => Promise<void>
  readonly address?: string
  readonly message?: string
}

/** The wallet's own words for a refusal, or ours when it gave none ('InitClient' is the kit's word for "starting"). */
export const walletReason = (message: string | undefined, fallback: string): string =>
  message && message !== 'InitClient' ? message : fallback

/**
 * Connects a chain wallet and gives its address, or throws with the wallet's own reason. Over WalletConnect
 * the phone waits for the person to approve in Keplr, so this waits at most `ms`.
 */
export async function connectChainWallet(cw: LiveChainWallet | undefined, ms: number, chainName = 'this chain'): Promise<string> {
  const fallback = `The wallet did not connect ${chainName}.`
  if (!cw) throw new Error(fallback)
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Keplr did not answer. Open Keplr, approve ${chainName} there, then try again.`)), ms)
  })
  try {
    await Promise.race([cw.connect(), late])
  } finally {
    clearTimeout(timer)
  }
  if (cw.address) return cw.address
  throw new Error(walletReason(cw.message, fallback))
}

/** A chain wallet with what wakeWalletConnect looks at. */
export interface KitChainWallet extends LiveChainWallet {
  walletInfo: { mode: string }
  client?: unknown
}

/**
 * After a reload, the kit puts a WalletConnect session back (the address shows) without connecting it again,
 * and Keplr Mobile's client cannot sign until it is: "Keplr Wallet is not initialized". Connecting a session
 * that still exists asks nothing of the phone, so it is done right before signing, once per page.
 */
export async function wakeWalletConnect(cw: KitChainWallet | undefined): Promise<void> {
  if (!cw || cw.walletInfo.mode !== 'wallet-connect') return
  if ((cw.client as { keplr?: unknown } | undefined)?.keplr) return
  await cw.connect()
  if (!cw.address) throw new Error(walletReason(cw.message, 'The wallet did not reconnect. Connect it again from the wallet menu.'))
}
