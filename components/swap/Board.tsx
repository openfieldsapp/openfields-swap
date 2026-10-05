/**
 * The board: who did what on Openfields Swap's pools, read off the chain and
 * ranked by points. Points are a game and buy nothing.
 */

import { useEffect } from 'react'
import { Button, cx, Disclosure } from 'components/ui'
import { shortAddress } from 'components/wallet/connect'
import type { BoardResponse } from 'lib/api/dex-leaderboard'
import { useLang } from 'lib/i18n'
import { Empty, Row } from './common'

const usd = (n: number) => `$${n >= 10 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)}`

export default function Board({ board, me, spotlight, onGoSwap }: { board: BoardResponse | null; me: string; spotlight: string; onGoSwap: () => void }) {
  const { t } = useLang()
  // A shared link (?who=terra1…) opens the board on that row.
  useEffect(() => {
    if (!spotlight || !board) return
    document.getElementById(`row-${spotlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [spotlight, board])

  const mine = board?.rows.find(r => r.address === me)
  const rules = board?.rules
  return (
    <section className='sw-page' aria-labelledby='sw-board-title'>
      <h1 id='sw-board-title' className='sw-title'>{t('Board')}</h1>
      <p className='sw-lede'>Who moved first on Openfields Swap&apos;s pools. Points buy nothing.</p>

      {!board && <p className='sw-status sw-gap'><span className='of-spin' aria-hidden /> Reading the board…</p>}

      {board && me && (
        <div className='sw-card sw-gap'>
          {mine ? (
            <>
              <div className='sw-card-head'>
                <h2 className='sw-card-title'>You are #{mine.rank}</h2>
                <span className='of-num'>{mine.points.toLocaleString('en-US')} points</span>
              </div>
              <p className='sw-card-sub'>
                {mine.rank === 1 ? 'Top of the board.' : board.rows[0] ? `${(board.rows[0].points - mine.points).toLocaleString('en-US')} points behind #1.` : ''}
              </p>
              {mine.badges.length > 0 && <div className='sw-badges'>{mine.badges.map(b => <span key={b.name} className='sw-tag' title={b.hint}>{b.name}</span>)}</div>}
              <div className='of-next sw-gap'>
                <a className='of-btn of-btn--quiet of-btn--sm' href={`/api/og/swap?who=${me}`} target='_blank' rel='noopener noreferrer'>Your card</a>
                <a className='of-btn of-btn--quiet of-btn--sm' target='_blank' rel='noopener noreferrer'
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`#${mine.rank} on the Openfields Swap board, ${mine.points.toLocaleString('en-US')} points.\n${typeof location !== 'undefined' ? location.origin : ''}/?who=${me}`)}`}>
                  Share on X
                </a>
              </div>
            </>
          ) : (
            <div className='sw-card-head'>
              <div>
                <h2 className='sw-card-title'>You are not on the board yet</h2>
                <p className='sw-card-sub'>One swap puts you on it.</p>
              </div>
              <Button size='sm' onClick={onGoSwap}>{t('Swap')}</Button>
            </div>
          )}
        </div>
      )}

      {board && (board.rows.length === 0
        ? <Empty title='Nobody yet'><Button variant='primary' onClick={onGoSwap}>{t('Swap')}</Button></Empty>
        : (
          <ol className='sw-list sw-gap sw-board'>
            {board.rows.slice(0, 50).map(r => (
              <li key={r.address} id={`row-${r.address}`} className={cx('sw-item', r.address === me && 'is-me', r.address === spotlight && 'is-spot')}>
                <span className='sw-rank'>{r.rank}</span>
                <span className='sw-item-main'>
                  <span className='sw-item-title'><span className='of-num'>{shortAddress(r.address)}</span>{r.address === me && <span className='sw-tag'>you</span>}</span>
                  <span className='sw-item-sub'>
                    {[r.swaps && `${r.swaps} swap${r.swaps === 1 ? '' : 's'}`, r.provides && `${r.provides} add${r.provides === 1 ? '' : 's'}`, r.creates && `${r.creates} pool${r.creates === 1 ? '' : 's'} opened`, r.firstHands && `first into ${r.firstHands}`].filter(Boolean).join(' · ') || 'no moves'}
                    {/* Standing, not history: liquidity still in the pools right now. */}
                    {r.liquidityUsd != null && r.liquidityUsd > 0 && ` · ${usd(r.liquidityUsd)} still in`}
                  </span>
                </span>
                <span className='sw-item-end'>{r.points.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ol>
        ))}

      {rules && (
        <Disclosure summary='How points work' className='sw-gap'>
          <dl className='sw-rows sw-gap'>
            <Row k='Open a pool' v={`${rules.points.create_pair} points`} />
            <Row k='First liquidity into a pool' v={`+${rules.firstHand} points`} />
            <Row k='Add liquidity' v={`${rules.points.provide_liquidity} points`} />
            <Row k='Swap' v={`${rules.points.swap} points`} />
            <Row k='Hold a Crystal' v={`everything × ${rules.crystalMultiplier}`} />
          </dl>
          <div className='sw-badges'>{Object.values(rules.badges).map(b => <span key={b.name} className='sw-tag' title={b.hint}>{b.name}</span>)}</div>
          <p className='sw-fine sw-gap'>Points are read off the chain and cannot be edited. They are a game and buy nothing.</p>
        </Disclosure>
      )}
    </section>
  )
}
