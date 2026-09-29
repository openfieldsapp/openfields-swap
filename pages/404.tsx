/**
 * Not found. /tx/[hash] and /pool/[addr] answer 404 for a hash or address the
 * chain does not know, so that made-up ones never become stored pages. A
 * transaction that just landed can take a few seconds to be indexed, so for
 * those this says so and where else to look. The page is built once; the
 * address is read in the browser.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { TEXT } from 'components/tokens'
import { C, Page, Panel } from 'components/PageShell'

const TX = /^\/tx\/([0-9A-Fa-f]{64})\/?$/
const POOL = /^\/pool\/(terra1[02-9ac-hj-np-z]{38,58})\/?$/

export default function NotFound() {
  const [path, setPath] = useState('')
  useEffect(() => { setPath(window.location.pathname) }, [])
  const tx = TX.exec(path)?.[1]?.toUpperCase()
  const pool = POOL.exec(path)?.[1]
  const text = { fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: 0 }
  return (
    <Page width={760}>
      <h1 style={{ fontSize: 'clamp(1.6rem, 5vw, 2.2rem)', margin: 0 }}>
        <span style={{ fontWeight: 700, color: C.goldLit }}>{tx ? 'A transaction' : pool ? 'A pool' : 'Nothing'}</span>{' '}
        <span style={{ fontWeight: 300 }}>{tx || pool ? 'on Terra' : 'here'}</span>
      </h1>
      <Panel title={tx ? 'Not found yet' : 'Not found'}>
        <p style={text}>
          {tx
            ? <>The chain&apos;s public endpoints did not return this transaction. One that just landed can take a few seconds to be indexed; refresh in a moment.{' '}
                <a href={`https://scan.openfields.app/tx/${tx}`} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>Look it up on Openfields Scan ↗</a></>
            : pool
              ? <>No pool answered at this address, or the chain did not answer just now.{' '}
                  <a href={`https://scan.openfields.app/address/${pool}`} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>See it on Openfields Scan ↗</a></>
              : <>There is no page at this address. <Link href='/' style={{ color: C.goldLit }}>Go to the swap</Link></>}
        </p>
      </Panel>
    </Page>
  )
}
