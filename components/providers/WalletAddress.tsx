/**
 * Tells the rest of the page which Terra address is connected (lib/wallet/address), for the ✦ in the corner.
 * Rendered inside the wallet kit's provider, next to WalletCarry; it draws nothing.
 */

import { useEffect } from 'react'
import { useChain } from '@cosmos-kit/react'
import { setWalletAddress } from 'lib/wallet/address'

export default function WalletAddress({ chain = 'terra2' }: { chain?: string }) {
  const { address, status } = useChain(chain)
  useEffect(() => { setWalletAddress(status === 'Connected' && address ? address : '') }, [address, status])
  useEffect(() => () => setWalletAddress(''), [])
  return null
}
