/**
 * Station, the browser extension that was Terra Station, as a wallet in the kit. The same file in every
 * Openfields app with a wallet.
 *
 * Adapted from @cosmos-kit/station-extension 2.16.1 instead of installed: that package depends on
 * feather.js, with native builds, for its types alone. Its notice: The Clear BSD License, Copyright (c)
 * 2024 Cosmos Kit Contributors, Copyright (c) 2025 Constructive. Redistribution with or without
 * modification is permitted provided the copyright notice is kept.
 *
 * What reading the extension (8.0.9, unchanged since April 2024) and its connector showed, 2026-10-09:
 *  - It always injects window.station. Set as "default browser wallet", it also puts a window.keplr of its
 *    own there, which cannot sign in direct mode and has no sendTx: isStationKeplr tells it from Keplr.
 *  - It signs in amino mode only, after rebuilding each message with feather.js, and the bytes it signs
 *    leave out every null field and do not escape <, > and &. The chain checks the signature against the
 *    transaction as sent, with its nulls and with those characters escaped. So for Station a contract call
 *    goes without its null fields (to a contract a missing optional field means the same), the memo goes
 *    without those characters, and anything else holding one is refused before Station is asked. This is done
 *    in the signer the kit gets (stationSignDoc): cosmjs builds the transaction from the document the signer
 *    hands back, so what is sent is exactly what Station signed, in every app, with no change to how it signs.
 *  - It reads the account from its own Terra endpoint (lcd-terra.tfl.foundation), which answered 520 on
 *    2026-10-09. Until that is back, Station signs on Terra only with an endpoint set in it (STATION_LCD_HINT).
 *
 * station.money is now another wallet, an agent wallet on phones built on Vultisig, which took over the old
 * Station app; it does not connect to websites here.
 */

import { ChainWalletBase, ClientNotExistError, MainWalletBase, type ChainRecord, type Wallet, type WalletClient } from '@cosmos-kit/core'
import type { OfflineAminoSigner, StdSignature, StdSignDoc, AminoSignResponse } from '@cosmjs/amino'

export const STATION = 'station-extension'

/** What the extension puts at window.station (@terra-money/station-connector). */
interface StationApi {
  connect: () => Promise<{ name: string; addresses: Record<string, string>; pubkey?: Record<string, string> }>
  info: () => Promise<Record<string, { coinType: string }>>
  getPublicKey: () => Promise<{ pubkey?: Record<string, string> }>
  getOfflineSigner: (chainId: string) => OfflineAminoSigner
  keplr: {
    signAmino: (chainId: string, signer: string, doc: StdSignDoc) => Promise<AminoSignResponse>
    signArbitrary: (chainId: string, signer: string, data: string | Uint8Array) => Promise<StdSignature>
  }
}

const stationHere = (): StationApi | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { station?: StationApi }).station

/** True when the Station extension is in this browser. */
export const hasStation = (): boolean => !!stationHere()

/** Station's own window.keplr, there when Station is set as the default wallet: no sendTx, no direct signing. */
export function isStationKeplr(k: unknown): boolean {
  return hasStation() && !!k && typeof (k as { sendTx?: unknown }).sendTx !== 'function'
}

/** Waits for the page to finish loading when the extension has not injected yet, as the kit's own adapter does. */
async function stationFromExtension(): Promise<StationApi | undefined> {
  if (typeof window === 'undefined') return undefined
  const now = stationHere()
  if (now) return now
  if (document.readyState === 'complete') throw ClientNotExistError
  return new Promise((resolve, reject) => {
    const changed = () => {
      if (document.readyState !== 'complete') return
      document.removeEventListener('readystatechange', changed)
      const s = stationHere()
      if (s) resolve(s)
      else reject(ClientNotExistError)
    }
    document.addEventListener('readystatechange', changed)
  })
}

class StationClient implements WalletClient {
  constructor(readonly client: StationApi) {}

  async disconnect() { /* the extension keeps no session for a site */ }

  async getSimpleAccount(chainId: string) {
    const { name, addresses } = await this.client.connect()
    const address = addresses[chainId]
    if (!address) throw new Error(`Station has no account on ${chainId}. Switch to mainnet in Station.`)
    return { namespace: 'cosmos', chainId, address, username: name }
  }

  async getAccount(chainId: string) {
    const info = (await this.client.info())[chainId]
    if (!info) throw new Error(`Station has no ${chainId}. Switch to mainnet in Station.`)
    const connected = await this.client.connect()
    const pubkeys = connected.pubkey ?? (await this.client.getPublicKey()).pubkey
    const pubkey = pubkeys?.[info.coinType]
    const address = connected.addresses[chainId]
    if (!address || !pubkey) throw new Error('Station did not give this account. Choose another wallet in Station, or import it again.')
    // Amino only: the kit then never asks Station for a direct signature.
    return { address, pubkey: Uint8Array.from(atob(pubkey), c => c.charCodeAt(0)), username: connected.name, isNanoLedger: true, algo: 'secp256k1' as const }
  }

  async signAmino(chainId: string, signer: string, doc: StdSignDoc) {
    return this.client.keplr.signAmino(chainId, signer, doc)
  }

  getOfflineSigner(chainId: string): OfflineAminoSigner {
    const signer = this.client.getOfflineSigner(chainId)
    return {
      getAccounts: () => signer.getAccounts(),
      signAmino: (address: string, doc: StdSignDoc) => signer.signAmino(address, stationSignDoc(doc)).catch(e => { throw stationError(e, chainId) }),
    }
  }

  async signArbitrary(chainId: string, signer: string, data: string | Uint8Array) {
    return this.client.keplr.signArbitrary(chainId, signer, data)
  }
}

class ChainStationExtension extends ChainWalletBase {
  constructor(info: Wallet, chain: ChainRecord) { super(info, chain) }
}

class StationExtensionWallet extends MainWalletBase {
  constructor(info: Wallet) { super(info, ChainStationExtension) }

  async initClient() {
    this.initingClient()
    try {
      const s = await stationFromExtension()
      this.initClientDone(s ? new StationClient(s) : undefined)
    } catch (e) {
      this.initClientError(e as Error)
    }
  }
}

const STATION_LOGO = 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+Cjxzdmcgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgdmlld0JveD0iMCAwIDMyIDMyIiB2ZXJzaW9uPSIxLjEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHhtbDpzcGFjZT0icHJlc2VydmUiIHhtbG5zOnNlcmlmPSJodHRwOi8vd3d3LnNlcmlmLmNvbS8iIHN0eWxlPSJmaWxsLXJ1bGU6ZXZlbm9kZDtjbGlwLXJ1bGU6ZXZlbm9kZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLW1pdGVybGltaXQ6MjsiPgogICAgPGcgdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsMSwtMC4wMjE3NzI5LDAuMDc4NjA4NikiPgogICAgICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDAuMzA5MjI4LDAsMCwwLjMwOTIyOCwwLjM0NzQzNCwxLjc0NTQ3KSI+CiAgICAgICAgICAgIDxwYXRoIGQ9Ik04LjQ5NCwyMS43NTRDMTEuODg0LDE1LjEwNCAxOC45OCwxMS44MTIgMjQuNDg0LDE0LjM1N0wyNC43NjcsMTQuNDk0TDM3LjI1NCwyMC44OTRDNDAuMDE2LDIwLjEwMyA0Mi45NjksMjAuMzA1IDQ1LjU5OCwyMS40NjRMNDUuOTg5LDIxLjY0NEw1NC41MDcsMjUuOTI4TDc5LjYyNSwzOC42NTZDODQuMTEzLDQwLjk0NyA4Ni41MDMsNDUuODU2IDg2LjQ2OCw1MS4zMzNMODYuNDYyLDUxLjY1NUw5MC45NSw1My44MTZMODMuMjA2LDY5LjA5N0w3OC42Nyw2Ni44Qzc0LjM5Nyw3MC4yMSA2OS4wMTgsNzEuMjg1IDY0LjQ5LDY5LjE1NUw2NC4xNTEsNjguOTg5TDMwLjY2LDUyLjA1QzMwLjYxNCw1Mi4wNyAzMC41Niw1Mi4wNyAzMC41MTQsNTIuMDVDMjcuOTU0LDUwLjc1MiAyNS45NDcsNDguNTc0IDI0Ljg2MSw0NS45MTdMMjQuNzE5LDQ1LjU1MkwxMi40MzksMzkuMjczQzEyLjM5OSwzOS4yMjUgMTIuMzQ1LDM5LjE4OSAxMi4yODUsMzkuMTcxTDEyLjI0NSwzOS4xNjRDNi43MDMsMzYuMzY5IDUuMDQ1LDI4LjUxNyA4LjQ5NSwyMS43NTRMOC40OTQsMjEuNzU0WiIgc3R5bGU9ImZpbGw6cmdiKDQwLDY5LDE3NCk7ZmlsbC1ydWxlOm5vbnplcm87Ii8+CiAgICAgICAgPC9nPgogICAgICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDAuMzA5MjI4LDAsMCwwLjMwOTIyOCwwLjM0NzQzNCwxLjc0NTQ3KSI+CiAgICAgICAgICAgIDxwYXRoIGQ9Ik0xNC41NDQsNjUuNDU2TDM1Ljk0Nyw3Ni44ODlMMjIuMzIzLDkwLjgxNUMyMi4xNDYsOTEuMDMzIDIxLjg0Myw5MS4xMDggMjEuNTg1LDkwLjk5N0wyMS41MjUsOTAuOTk3TDEuMDY1LDgwLjUzQzAuODM0LDgwLjQwNiAwLjY4OSw4MC4xNjQgMC42ODksNzkuOTAxQzAuNjg5LDc5Ljc0NSAwLjc0LDc5LjU5MiAwLjgzNSw3OS40NjhMMTQuNTQ0LDY1LjQ1NUwxNC41NDQsNjUuNDU2Wk0zMi40OTcsNDcuNTc2TDMyLjU5Niw0Ny42MDlMNTMuMDksNTguMDc1QzUzLjQwNiw1OC4yMjIgNTMuNTU2LDU4LjU5MyA1My40Myw1OC45MThMNTMuMzgsNTkuMDE4QzUzLjM2MSw1OS4wNjggNTMuMzMyLDU5LjExMyA1My4yOTYsNTkuMTUyTDUzLjI5Niw1OS4yMjVMMzcuNDQ2LDc1LjQzN0wxNS45ODIsNjMuOTkyTDMxLjg1Nyw0Ny43OUMzMi4wMSw0Ny42MDEgMzIuMjYsNDcuNTE3IDMyLjQ5Nyw0Ny41NzVMMzIuNDk3LDQ3LjU3NlpNOTEuMDQ3LDUzLjk4NkM5My43ODEsNTUuMzY1IDk0LjIwNCw1OS44OSA5Mi4wNjMsNjQuMTI1Qzg5LjkyMSw2OC4zNTkgODYuMDEzLDcwLjY3IDgzLjI3OSw2OS4yOTFDODAuNTQ0LDY3LjkxMSA4MC4xMjEsNjMuMzg3IDgyLjI2Miw1OS4xNTFDODQuNDA0LDU0LjkyOSA4OC4zMTIsNTIuNjA2IDkxLjA0Niw1My45ODZMOTEuMDQ3LDUzLjk4NlpNMzMuNTUsMjAuMDg0QzM0Ljc5NSwyMC4wNzEgMzYuMDMsMjAuMzA5IDM3LjE4LDIwLjc4NkMzNi4xOCwyMS4wNjYgMzUuMjEyLDIxLjQ0NyAzNC4yODgsMjEuOTIzTDMzLjk3NCwyMi4wOEwzMy41MjYsMjIuMDhDMjkuNTgyLDIyLjA4IDI1LjQ5MiwyNS4wMzIgMjMuMzAyLDI5LjI2N0MyMC45NTUsMzMuOTEzIDIxLjI0NiwzOS4wNTUgMjMuNzk4LDQyLjEwNEMyMy45ODIsNDMuMjYxIDI0LjI4Miw0NC4zOTYgMjQuNjk0LDQ1LjQ5MkMxOS42NzMsNDIuNDQzIDE4LjI4MSwzNC45NTQgMjEuNjMzLDI4LjM3MkMyNC4xNzMsMjMuMjMgMjguOTY1LDIwLjA4NCAzMy41NSwyMC4wODRaTTYzLjIwNSwxNi45ODZMODQuNjIyLDI4LjQyTDc2LjI4NSwzNi45NjJMNTQuNTA3LDI1LjkyOEw2My4yMDcsMTYuOTg2TDYzLjIwNSwxNi45ODZaTTc5LjU3NCwwLjY1Nkw3OS42NzQsMC42ODlMMTAwLjI3OCwxMS4xNTVDMTAwLjYyOCwxMS4zMjIgMTAwLjc4NCwxMS43NDMgMTAwLjYyOCwxMi4wOThDMTAwLjYxLDEyLjE0MSAxMDAuNTg1LDEyLjE4MSAxMDAuNTU2LDEyLjIxN0w4Ni4xMSwyNi45Mkw2NC42NTgsMTUuNDk4TDc4LjkzNSwwLjg3Qzc5LjA2NiwwLjcwOSA3OS4yNjgsMC42MjMgNzkuNDc0LDAuNjRMNzkuNTc0LDAuNjU2WiIgc3R5bGU9ImZpbGw6cmdiKDg0LDE0NywyNDcpO2ZpbGwtcnVsZTpub256ZXJvOyIvPgogICAgICAgIDwvZz4KICAgIDwvZz4KPC9zdmc+Cg=='

const stationInfo: Wallet = {
  name: STATION,
  prettyName: 'Station',
  logo: STATION_LOGO,
  mode: 'extension',
  mobileDisabled: true,
  connectEventNamesOnWindow: ['station_wallet_change', 'station_network_change'],
  rejectMessage: { source: 'Request rejected' },
  downloads: [
    { device: 'desktop', browser: 'chrome', link: 'https://chrome.google.com/webstore/detail/station-wallet/aiifbnbfobpmeekipheeijimdpnlpgpp' },
    { device: 'desktop', browser: 'firefox', link: 'https://addons.mozilla.org/en-US/firefox/addon/terra-station-wallet/' },
    { device: 'desktop', browser: 'edge', link: 'https://microsoftedge.microsoft.com/addons/detail/station-wallet/ajkhoeiiokighlmdnlakpjfoobnjinie' },
  ],
}

export const stationWallets = [new StationExtensionWallet(stationInfo)]

/** As Station signs: every null field left out, at any depth. A null in a list stays, as there. */
export function withoutNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutNulls)
  if (v === null || typeof v !== 'object') return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) out[k] = withoutNulls(x)
  return out
}

/** Characters the chain escapes in what is signed and Station does not. */
const UNESCAPED = /[<>&]/

/**
 * The document as Station signs it, so the chain reads the same thing: contract calls without their null
 * fields, the memo without <, > and &. A message holding one of those is refused before Station is asked.
 */
export function stationSignDoc(doc: StdSignDoc): StdSignDoc {
  const msgs = doc.msgs.map(m => (m.type === 'wasm/MsgExecuteContract' ? { ...m, value: { ...m.value, msg: withoutNulls(m.value?.msg) } } : m))
  if (UNESCAPED.test(JSON.stringify(msgs))) {
    throw new Error('Station signs <, > and & differently from how the chain reads them, and this transaction holds one. Sign it with Keplr instead.')
  }
  return { ...doc, msgs, memo: doc.memo.replace(/&/g, 'and').replace(/[<>]/g, '') }
}

/** Chains Station signs for here, by name; its endpoints for all of them are on the same host as Terra's. */
const CHAIN_NAMES: Record<string, string> = { 'phoenix-1': 'Terra', 'noble-1': 'Noble', 'cosmoshub-4': 'Cosmos Hub', 'neutron-1': 'Neutron', 'stride-1': 'Stride' }

/** What to do when Station's own endpoint for a chain does not answer. */
export function stationLcdHint(chainId = 'phoenix-1'): string {
  const name = CHAIN_NAMES[chainId] ?? chainId
  const add = chainId === 'phoenix-1' ? 'choose Terra and add https://terra-lcd.publicnode.com' : `choose ${name} and add a public endpoint for it`
  return `Station could not reach ${name} through its own endpoint, which no longer answers. In Station open Settings, Network, Add LCD Endpoint, ${add}, then try again.`
}
export const STATION_LCD_HINT = stationLcdHint()

/** A failure from Station, with the way out when it is its endpoint. */
export function stationError(e: unknown, chainId?: string): Error {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e ?? '')
  if (/reject|denied|cancel/i.test(m)) return e instanceof Error ? e : new Error(m)
  if (/\b5\d\d\b|status code|network error|account info|fetch|timeout|ECONN|ENOTFOUND/i.test(m)) return new Error(stationLcdHint(chainId))
  return e instanceof Error ? e : new Error(m)
}
