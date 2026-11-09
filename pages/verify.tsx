/**
 * /verify: Openfields Swap's contracts, checked from this browser against a public
 * endpoint every time the page opens.
 *
 * For each contract: the code it runs and that code's checksum, whether anyone
 * can migrate it, and the settings that matter (who owns the factory, what the
 * pools charge, which factories the router trusts). The contracts written for
 * Openfields Swap are expected to match the reproducible builds in this repository
 * (contracts/owner-sink, contracts/router). The factory and the pools run
 * Astroport's own code, so they are checked against the code Astroport's
 * factory on Terra runs and uses for its xyk pools. The same checks run from a
 * terminal with contracts/owner-sink/verify.sh and contracts/router/verify.sh.
 * Astroport's contracts and Skeleton Swap's factory, which swaps also go
 * through, are listed as notes: they are not Openfields Swap's to verify.
 */

import Head from 'next/head'
import { useCallback, useEffect, useRef, useState } from 'react'
import AppShell from 'components/shell/AppShell'
import { Button, cx, Icon } from 'components/ui'
import { ASTRO_FACTORY, ASTRO_ROUTER, ROUTER_FACTORIES, SKELETON_FACTORY, TERRA_SWAP_FACTORY, TERRA_SWAP_FACTORY_V2, TERRA_SWAP_ROUTER, VENUE_INCENTIVES, smart } from 'lib/dex'
import { lcdFetch } from 'lib/lcd'
import { SCAN_ADDRESS } from 'lib/products'

const REPO = 'https://github.com/openfieldsapp/openfields-swap'
const OWNER_SINK = 'terra1ylr5lqj9e4ehjpxc4944rhjcmq7zdaju50r3tn60vn7rsqym50gq5w27l3'
/** Codes and checksums as expected. Openfields Swap's own builds: contracts/*\/artifacts/checksums.txt. */
const EXPECT = {
  factory: { code: '3108', checksum: '363b4859ac08d9acbf2387b864cf74d3f7954ac34b52acae9d9d71c6fdde1dd1' },
  pair: { code: '392', checksum: 'a5155c856cebff4519a63a3acb4985971f3ed98289519cf588a92425464476e1' },
  sink: { code: '4025', checksum: 'b62e749bd03846cf6abf48ebc7bd33413a0647e5ee557a65de9abef2661a6ab1' },
  router: { code: '4028', checksum: 'd4f36193c98a92dd455fda0e3b2a899071edda1c638d3dbc8149e0e9caf31ff3' },
  pcl: { code: '2569', checksum: '998aa47044ac5b7279bdbf5d1ab68876b7cf5cc7022a6f4844812dc3cafc1e6d' },
  stable: { code: '428', checksum: 'f6acaf41d2730d709d1c57562b754553a67a632f13d94875b71d5633de038a13' },
}

type State = 'checking' | 'ok' | 'bad' | 'note'
interface Check { group: string; what: string; expected: string; found: string; state: State; href?: string }
interface PairConfig { code_id: number; pair_type: Record<string, unknown>; total_fee_bps: number; maker_fee_bps: number; is_disabled: boolean }

const addressUrl = SCAN_ADDRESS
const shortHash = (h: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : 'no answer')

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const r = await lcdFetch(path, { timeoutMs: 12_000 })
    return r.ok ? ((await r.json()) as T) : null
  } catch { return null }
}
const contractInfo = (a: string) => readJson<{ contract_info?: { code_id: string; admin: string } }>(`/cosmwasm/wasm/v1/contract/${a}`).then(j => j?.contract_info ?? null)
const codeChecksum = (id: string) => readJson<{ checksum?: string }>(`/cosmwasm/wasm/v1/code-info/${id}`).then(j => (j?.checksum ?? '').toLowerCase())

const GROUPS: { key: string; title: string; address?: string; blurb: string }[] = [
  { key: 'factory', title: "Openfields Swap's factory", address: TERRA_SWAP_FACTORY, blurb: "Creates the pools. It runs Astroport's factory code, its ownership was handed to a contract that can never use it, and nobody can migrate it." },
  { key: 'sink', title: 'The owner sink', address: OWNER_SINK, blurb: "The 60-line contract that holds the factory's ownership (contracts/owner-sink). All it can do is accept it." },
  ...(TERRA_SWAP_FACTORY_V2 ? [{ key: 'factory2', title: "Openfields Swap's factory v2", address: TERRA_SWAP_FACTORY_V2, blurb: 'Opens concentrated and stable pools (contracts/factory-v2). The same factory code with no fee address, its ownership in its own owner sink, and nobody can migrate it.' }] : []),
  { key: 'pools', title: 'Every pool', blurb: "Astroport's xyk pair code. 0.3% per swap, all of it to liquidity providers. No pool can be migrated: the pools that existed at the renounce had their admin cleared, and pools opened since carry the owner sink as admin, which has no way to migrate anything." },
  { key: 'router', title: "Openfields Swap's router", address: TERRA_SWAP_ROUTER, blurb: 'One transaction through pools on both factories, and the swap on arrival over IBC (contracts/router). No owner, no admin, no fee.' },
  { key: 'astroport', title: "Astroport's contracts this page also uses", blurb: "Not Openfields Swap's. Swaps and positions can go through them, and Astroport can upgrade them." },
  { key: 'skeleton', title: "Skeleton Swap's pools this page also routes through", blurb: "Not Openfields Swap's. Swaps can go through Skeleton Swap's pools, which run on White Whale's pool contracts. Their factory's owner can change the pools' fees and pause swaps." },
]

async function run(push: (c: Check) => void): Promise<void> {
  const [fInfo, fSum, astroInfo, config] = await Promise.all([
    contractInfo(TERRA_SWAP_FACTORY), codeChecksum(EXPECT.factory.code), contractInfo(ASTRO_FACTORY),
    smart<{ owner: string; pair_configs: PairConfig[] }>(TERRA_SWAP_FACTORY, { config: {} }),
  ])
  push({ group: 'factory', what: 'Code', expected: `${EXPECT.factory.code} · ${shortHash(EXPECT.factory.checksum)}`, found: `${fInfo?.code_id ?? 'no answer'} · ${shortHash(fSum)}`, state: fInfo?.code_id === EXPECT.factory.code && fSum === EXPECT.factory.checksum ? 'ok' : 'bad', href: addressUrl(TERRA_SWAP_FACTORY) })
  push({ group: 'factory', what: "Same code as Astroport's factory", expected: EXPECT.factory.code, found: astroInfo?.code_id ?? 'no answer', state: !!astroInfo && astroInfo.code_id === fInfo?.code_id ? 'ok' : 'bad', href: addressUrl(ASTRO_FACTORY) })
  push({ group: 'factory', what: 'Migrate admin', expected: 'none', found: fInfo ? fInfo.admin || 'none' : 'no answer', state: fInfo && !fInfo.admin ? 'ok' : 'bad' })
  push({ group: 'factory', what: 'Owner', expected: 'the owner sink', found: config?.owner ?? 'no answer', state: config?.owner === OWNER_SINK ? 'ok' : 'bad', href: config?.owner ? addressUrl(config.owner) : undefined })
  const xyk = config?.pair_configs?.find(c => 'xyk' in (c.pair_type ?? {}))
  const others = (config?.pair_configs ?? []).filter(c => c !== xyk && !c.is_disabled)
  push({
    group: 'factory', what: 'Pools it can create', expected: 'xyk only · code 392 · fee 30 bps · maker fee 0',
    found: xyk ? `xyk · code ${xyk.code_id} · fee ${xyk.total_fee_bps} bps · maker fee ${xyk.maker_fee_bps}${others.length ? ` · and ${others.length} other type${others.length === 1 ? '' : 's'}` : ' only'}` : 'no answer',
    state: xyk && String(xyk.code_id) === EXPECT.pair.code && xyk.total_fee_bps === 30 && xyk.maker_fee_bps === 0 && !xyk.is_disabled && others.length === 0 ? 'ok' : 'bad',
  })

  const [sInfo, sSum, target] = await Promise.all([contractInfo(OWNER_SINK), codeChecksum(EXPECT.sink.code), smart<string>(OWNER_SINK, { target: {} })])
  push({ group: 'sink', what: 'Code', expected: `${EXPECT.sink.code} · ${shortHash(EXPECT.sink.checksum)} (this repository's build)`, found: `${sInfo?.code_id ?? 'no answer'} · ${shortHash(sSum)}`, state: sInfo?.code_id === EXPECT.sink.code && sSum === EXPECT.sink.checksum ? 'ok' : 'bad', href: `${REPO}/tree/main/contracts/owner-sink` })
  push({ group: 'sink', what: 'Migrate admin', expected: 'none', found: sInfo ? sInfo.admin || 'none' : 'no answer', state: sInfo && !sInfo.admin ? 'ok' : 'bad' })
  push({ group: 'sink', what: 'Holds ownership of', expected: "Openfields Swap's factory", found: target ?? 'no answer', state: target === TERRA_SWAP_FACTORY ? 'ok' : 'bad' })

  if (TERRA_SWAP_FACTORY_V2) {
    const [f2Info, f2Config] = await Promise.all([
      contractInfo(TERRA_SWAP_FACTORY_V2),
      smart<{ owner: string; fee_address: string | null; pair_configs: PairConfig[] }>(TERRA_SWAP_FACTORY_V2, { config: {} }),
    ])
    push({ group: 'factory2', what: 'Code', expected: `${EXPECT.factory.code} · ${shortHash(EXPECT.factory.checksum)}`, found: `${f2Info?.code_id ?? 'no answer'} · ${shortHash(fSum)}`, state: f2Info?.code_id === EXPECT.factory.code && fSum === EXPECT.factory.checksum ? 'ok' : 'bad', href: addressUrl(TERRA_SWAP_FACTORY_V2) })
    push({ group: 'factory2', what: 'Migrate admin', expected: 'none', found: f2Info ? f2Info.admin || 'none' : 'no answer', state: f2Info && !f2Info.admin ? 'ok' : 'bad' })
    push({ group: 'factory2', what: 'Fee address', expected: 'none, so no maker fee is taken', found: f2Config ? f2Config.fee_address ?? 'none' : 'no answer', state: f2Config && !f2Config.fee_address ? 'ok' : 'bad' })
    const typeName = (c: PairConfig) => { const [k, v] = Object.entries(c.pair_type ?? {})[0] ?? ['?', null]; return k === 'custom' && typeof v === 'string' ? v : k }
    const [pclSum, stableSum] = await Promise.all([codeChecksum(EXPECT.pcl.code), codeChecksum(EXPECT.stable.code)])
    const types = (f2Config?.pair_configs ?? []).filter(c => !c.is_disabled)
    const has = (name: string, code: string) => types.some(c => typeName(c) === name && String(c.code_id) === code && c.maker_fee_bps === 0)
    push({
      group: 'factory2', what: 'Pools it can create', expected: 'concentrated · code 2569 and stable · code 428, maker fee 0, nothing else',
      found: types.length ? types.map(c => `${typeName(c)} · code ${c.code_id} · maker fee ${c.maker_fee_bps}`).join(' + ') : 'no answer',
      state: types.length === 2 && has('concentrated', EXPECT.pcl.code) && has('stable', EXPECT.stable.code) && pclSum === EXPECT.pcl.checksum && stableSum === EXPECT.stable.checksum ? 'ok' : 'bad',
    })
    const sink2 = f2Config?.owner ?? ''
    const s2Info = sink2 ? await contractInfo(sink2) : null
    const s2Target = sink2 ? await smart<string>(sink2, { target: {} }) : null
    push({
      group: 'factory2', what: 'Owner', expected: 'an owner sink holding this factory, with no admin',
      found: sink2 ? `${sink2.slice(0, 14)}… · code ${s2Info?.code_id ?? '?'} · ${s2Info?.admin ? 'has an admin' : 'no admin'} · holds ${s2Target === TERRA_SWAP_FACTORY_V2 ? 'this factory' : s2Target ?? '?'}` : 'no answer',
      state: !!s2Info && s2Info.code_id === EXPECT.sink.code && sSum === EXPECT.sink.checksum && !s2Info.admin && s2Target === TERRA_SWAP_FACTORY_V2 ? 'ok' : 'bad',
      href: sink2 ? addressUrl(sink2) : undefined,
    })
  }

  const pairs: string[] = []
  let startAfter: unknown
  for (let i = 0; i < 20; i++) {
    const page = await smart<{ pairs: { contract_addr: string; asset_infos: unknown }[] }>(TERRA_SWAP_FACTORY, { pairs: { limit: 30, ...(startAfter ? { start_after: startAfter } : {}) } })
    const got = page?.pairs ?? []
    pairs.push(...got.map(p => p.contract_addr))
    if (got.length < 30) break
    startAfter = got[got.length - 1].asset_infos
  }
  const pSum = await codeChecksum(EXPECT.pair.code)
  const infos: ({ code_id: string; admin: string } | null)[] = []
  for (let i = 0; i < pairs.length; i += 6) infos.push(...(await Promise.all(pairs.slice(i, i + 6).map(contractInfo))))
  const wrongCode = infos.filter(x => !x || x.code_id !== EXPECT.pair.code).length
  // Pools opened after the renounce were given the factory's owner as their admin, and that owner is the sink. The
  // sink's code sends one message, the ownership claim; it has no way to migrate a contract or change an admin.
  const none = infos.filter(x => x && !x.admin).length
  const bySink = infos.filter(x => x && x.admin === OWNER_SINK).length
  const other = pairs.length - none - bySink
  push({ group: 'pools', what: 'Pair code', expected: `${EXPECT.pair.code} · ${shortHash(EXPECT.pair.checksum)}`, found: `${shortHash(pSum)} · ${pairs.length - wrongCode} of ${pairs.length} pools run it`, state: pairs.length > 0 && wrongCode === 0 && pSum === EXPECT.pair.checksum ? 'ok' : 'bad' })
  push({ group: 'pools', what: 'Migrate admin', expected: 'none, or the owner sink, which cannot migrate', found: pairs.length ? `${none} have none · ${bySink} have the owner sink${other ? ` · ${other} someone else` : ''}` : 'no answer', state: pairs.length > 0 && other === 0 ? 'ok' : 'bad' })

  if (TERRA_SWAP_ROUTER) {
    const [rInfo, rSum, rConfig] = await Promise.all([contractInfo(TERRA_SWAP_ROUTER), codeChecksum(EXPECT.router.code), smart<{ factories: string[] }>(TERRA_SWAP_ROUTER, { config: {} })])
    push({ group: 'router', what: 'Code', expected: `${EXPECT.router.code} · ${shortHash(EXPECT.router.checksum)} (this repository's build)`, found: `${rInfo?.code_id ?? 'no answer'} · ${shortHash(rSum)}`, state: rInfo?.code_id === EXPECT.router.code && rSum === EXPECT.router.checksum ? 'ok' : 'bad', href: `${REPO}/tree/main/contracts/router` })
    push({ group: 'router', what: 'Migrate admin', expected: 'none', found: rInfo ? rInfo.admin || 'none' : 'no answer', state: rInfo && !rInfo.admin ? 'ok' : 'bad' })
    const f = rConfig?.factories ?? []
    const nameOf = (x: string) => (x === TERRA_SWAP_FACTORY ? 'Openfields Swap' : x === TERRA_SWAP_FACTORY_V2 ? 'Openfields Swap v2' : x === ASTRO_FACTORY ? 'Astroport' : x)
    push({ group: 'router', what: 'Factories it trusts', expected: `${ROUTER_FACTORIES.map(nameOf).join(' + ')}, nothing else`, found: f.length ? f.map(nameOf).join(' + ') : 'no answer', state: f.length === ROUTER_FACTORIES.length && f.every((x, i) => x === ROUTER_FACTORIES[i]) ? 'ok' : 'bad' })
  }

  const external: [string, string][] = [["Astroport's factory", ASTRO_FACTORY], ["Astroport's router", ASTRO_ROUTER], ["Astroport's incentives", VENUE_INCENTIVES.astroport ?? '']]
  const exInfos = await Promise.all(external.map(([, a]) => (a ? contractInfo(a) : Promise.resolve(null))))
  external.forEach(([name, a], i) => {
    const x = exInfos[i]
    push({ group: 'astroport', what: name, expected: 'Astroport can migrate it', found: x ? (x.admin ? `code ${x.code_id} · admin ${x.admin.slice(0, 12)}…` : `code ${x.code_id} · no admin`) : 'no answer', state: 'note', href: a ? addressUrl(a) : undefined })
  })

  const [skInfo, skConfig] = await Promise.all([contractInfo(SKELETON_FACTORY), smart<{ owner?: string }>(SKELETON_FACTORY, { config: {} })])
  push({
    group: 'skeleton', what: "White Whale's pool factory (Skeleton Swap)", expected: 'its owner can change pool fees and pause swaps',
    found: skInfo ? `code ${skInfo.code_id}${skInfo.admin ? ` · admin ${skInfo.admin.slice(0, 12)}…` : ' · no admin'}${skConfig?.owner ? ` · owner ${skConfig.owner.slice(0, 12)}…` : ''}` : 'no answer',
    state: 'note', href: addressUrl(SKELETON_FACTORY),
  })
}

export default function VerifyPage() {
  const [checks, setChecks] = useState<Check[]>([])
  const [running, setRunning] = useState(false)
  const [at, setAt] = useState<Date | null>(null)
  // Only the latest run writes: "check again" mid-run, or React running the effect twice in development, must not interleave rows.
  const runId = useRef(0)
  const start = useCallback(() => {
    const id = ++runId.current
    setChecks([]); setRunning(true)
    run(c => { if (runId.current === id) setChecks(cs => [...cs, c]) })
      .finally(() => { if (runId.current === id) { setRunning(false); setAt(new Date()) } })
  }, [])
  useEffect(() => { start() }, [start])
  const bad = checks.filter(c => c.state === 'bad').length
  const passed = checks.filter(c => c.state === 'ok').length

  return (
    <>
      <Head>
        <title>Verify · Openfields Swap</title>
      </Head>
      <AppShell page='verify'>
        <article className='sw-page'>
          <h1 className='sw-title'>Verify the contracts</h1>
          <p className='sw-lede'>Read by your browser from a public Terra endpoint, not from this site&apos;s server.</p>
          <div className='sw-card sw-gap sw-verify-head' role='status'>
            <span className={cx('sw-verify-mark', !running && (bad ? 'is-bad' : 'is-ok'))} aria-hidden>
              {running ? <span className='of-spin' /> : <Icon name={bad ? 'close' : 'check'} size={16} />}
            </span>
            <span className='sw-item-main'>
              <span className='sw-item-title'>{running ? `Checking, ${passed} passed so far` : bad ? `${bad} check${bad === 1 ? '' : 's'} did not pass` : `All ${passed} checks passed`}</span>
              {at && !running && <span className='sw-item-sub'>at {at.toLocaleTimeString('en-GB')}</span>}
            </span>
            <Button size='sm' onClick={start} disabled={running}>Check again</Button>
          </div>
          {GROUPS.map(g => {
            const rows = checks.filter(c => c.group === g.key)
            if (g.key === 'router' && !TERRA_SWAP_ROUTER) return null
            return (
              <section key={g.key} aria-labelledby={`sw-v-${g.key}`}>
                <h2 id={`sw-v-${g.key}`} className='sw-h2 sw-section'>{g.title}</h2>
                <p className='sw-hint'>{g.blurb}</p>
                {g.address && <p className='sw-fine sw-mono'><a href={addressUrl(g.address)} target='_blank' rel='noopener noreferrer'>{g.address}</a></p>}
                <ul className='sw-list sw-gap sw-checks'>
                  {rows.length === 0 && <li className='sw-item sw-fine'>{running ? 'Reading…' : 'No answer from the chain'}</li>}
                  {rows.map(c => (
                    <li key={c.what} className='sw-item'>
                      <span className={cx('sw-verify-mark', c.state === 'ok' && 'is-ok', c.state === 'bad' && 'is-bad')} aria-label={c.state === 'ok' ? 'passed' : c.state === 'bad' ? 'did not pass' : 'note'}>
                        <Icon name={c.state === 'ok' ? 'check' : c.state === 'bad' ? 'close' : 'chevronRight'} size={14} />
                      </span>
                      <span className='sw-item-main'>
                        <span className='sw-item-title'>{c.href ? <a href={c.href} target='_blank' rel='noopener noreferrer'>{c.what}</a> : <span>{c.what}</span>}</span>
                        <span className='sw-item-sub sw-mono'>{c.found}</span>
                        {c.state !== 'ok' && <span className='sw-fine'>Expected: {c.expected}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          <p className='sw-fine sw-section'>Openfields Swap&apos;s own contracts are compared with the reproducible builds in <a className='sw-link' href={REPO} target='_blank' rel='noopener noreferrer'>the repository</a>; the factory and the pools run Astroport&apos;s code. From a terminal, <code>contracts/owner-sink/verify.sh</code> and <code>contracts/router/verify.sh</code> check the same things.</p>
        </article>
      </AppShell>
    </>
  )
}
