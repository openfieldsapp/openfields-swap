/**
 * Under the header, only where wallet actions are withheld (see middleware.ts
 * and /api/geo): what is not available, in one line. Everything else stays
 * open. Renders nothing elsewhere, or while the region is still being read.
 */

import { useState } from 'react'
import { IconButton } from 'components/ui'
import { useTxRegionGate } from './RegionGate'

export default function RegionBanner() {
  const { txAllowed, country, reason } = useTxRegionGate()
  const [closed, setClosed] = useState(false)
  if (txAllowed !== false || closed) return null
  return (
    <div className='sw-region' role='status'>
      <p><b>Browse only{country ? ` in ${country}` : ''}.</b> {reason ?? 'Wallet actions are not available in your region. Everything else stays open.'}</p>
      <IconButton icon='close' label='Dismiss' onClick={() => setClosed(true)} />
    </div>
  )
}
