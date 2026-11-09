import { describe, expect, it, vi, afterEach } from 'vitest'
import { connectChainWallet, wakeWalletConnect, walletReason, type LiveChainWallet } from 'components/wallet/kitWallet'

const NOBLE = 'noble1qqzkw2ac7zt9twpq5yguunwdklerwsryq2e2q4'

/** A chain wallet the way the kit keeps one: connect() never throws, it records an address or a reason. */
function chainWallet(outcome: { address?: string; message?: string; never?: boolean }): LiveChainWallet {
  const cw = { address: undefined as string | undefined, message: undefined as string | undefined, connect: async () => {} }
  cw.connect = () => (outcome.never ? new Promise<void>(() => {}) : Promise.resolve().then(() => { cw.address = outcome.address; cw.message = outcome.message }))
  return cw
}

describe('connecting another chain through the wallet kit', () => {
  afterEach(() => vi.useRealTimers())

  it('reads the address the chain wallet has after connecting', async () => {
    await expect(connectChainWallet(chainWallet({ address: NOBLE }), 1000, 'Noble')).resolves.toBe(NOBLE)
  })
  it('passes on the reason the wallet gave', async () => {
    await expect(connectChainWallet(chainWallet({ message: 'Request rejected' }), 1000, 'Noble')).rejects.toThrow('Request rejected')
    await expect(connectChainWallet(chainWallet({ message: 'InitClient' }), 1000, 'Noble')).rejects.toThrow('The wallet did not connect Noble.')
    await expect(connectChainWallet(undefined, 1000, 'Noble')).rejects.toThrow('The wallet did not connect Noble.')
  })
  it('stops waiting for the phone, and says what to do', async () => {
    vi.useFakeTimers()
    const p = connectChainWallet(chainWallet({ never: true }), 120_000, 'Injective')
    const check = expect(p).rejects.toThrow(/Open Keplr, approve Injective/)
    await vi.advanceTimersByTimeAsync(120_000)
    await check
  })
  it('never shows the kit word for starting as a reason', () => {
    expect(walletReason('InitClient', 'fallback')).toBe('fallback')
    expect(walletReason(undefined, 'fallback')).toBe('fallback')
    expect(walletReason('Request rejected', 'fallback')).toBe('Request rejected')
  })
})

describe('a WalletConnect session put back after a reload', () => {
  const restored = (keplr: unknown, mode = 'wallet-connect') => {
    const cw = { walletInfo: { mode }, client: { keplr } as { keplr?: unknown }, address: 'terra1x' as string | undefined, message: undefined as string | undefined, connect: vi.fn(async () => { cw.client.keplr = {} }) }
    return cw
  }
  it('is connected again before signing, once', async () => {
    const cw = restored(undefined)
    await wakeWalletConnect(cw)
    await wakeWalletConnect(cw)
    expect(cw.connect).toHaveBeenCalledTimes(1)
  })
  it('is left alone when it is ready, or not WalletConnect at all', async () => {
    const ready = restored({})
    const extension = restored(undefined, 'extension')
    await wakeWalletConnect(ready)
    await wakeWalletConnect(extension)
    await wakeWalletConnect(undefined)
    expect(ready.connect).not.toHaveBeenCalled()
    expect(extension.connect).not.toHaveBeenCalled()
  })
  it('says so when the session is gone', async () => {
    const cw = restored(undefined)
    cw.connect.mockImplementation(async () => { cw.address = undefined; cw.message = 'Request Rejected' })
    await expect(wakeWalletConnect(cw)).rejects.toThrow('Request Rejected')
  })
})
