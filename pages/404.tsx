/**
 * Not found. /tx/[hash] and /pool/[addr] answer 404 for a hash or address the
 * chain does not know, so that made-up ones never become stored pages. A
 * transaction that just landed can take a few seconds to be indexed, so for
 * those this says so and where else to look. The page is built once; the
 * address is read in the browser.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import AppShell from 'components/shell/AppShell'
import { Icon } from 'components/ui'
import { SCAN_ADDRESS, SCAN_TX } from 'lib/products'

const TX = /^\/tx\/([0-9A-Fa-f]{64})\/?$/
const POOL = /^\/pool\/(terra1[02-9ac-hj-np-z]{38,58})\/?$/

export default function NotFound() {
  const [path, setPath] = useState('')
  useEffect(() => { setPath(window.location.pathname) }, [])
  const tx = TX.exec(path)?.[1]?.toUpperCase()
  const pool = POOL.exec(path)?.[1]
  return (
    <AppShell>
      <section className='sw-page sw-narrow sw-empty'>
        <h1 className='sw-title'>{tx ? 'Transaction not found yet' : pool ? 'Pool not found' : 'Nothing here'}</h1>
        <p className='sw-lede'>
          {tx ? 'One that just landed can take a few seconds to be indexed. Refresh in a moment.'
            : pool ? 'No pool answered at this address, or the chain did not answer just now.'
            : 'There is no page at this address.'}
        </p>
        {tx ? <a className='of-btn of-btn--secondary' href={SCAN_TX(tx)} target='_blank' rel='noopener noreferrer'>Look it up on Openfields Scan<Icon name='external' size={14} /></a>
          : pool ? <a className='of-btn of-btn--secondary' href={SCAN_ADDRESS(pool)} target='_blank' rel='noopener noreferrer'>See it on Openfields Scan<Icon name='external' size={14} /></a>
          : <Link className='of-btn of-btn--primary' href='/'>Go to the swap</Link>}
      </section>
    </AppShell>
  )
}
