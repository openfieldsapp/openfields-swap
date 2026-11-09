/**
 * Token marks, shared by the swap page and the token and pool pages.
 *
 * Self-hosted so the CSP never has to trust a third-party image host, and so a
 * visitor's browser never asks one. LUNA is terra-money/assets; USDC, wBTC,
 * PAXG, ROAR, ampLUNA, arbLUNA, EURe, USDT, ATOM and both ASTROs come from the
 * Cosmos chain registry; SOLID and CAPA are our own marks, cropped square.
 */

export const TOKEN_ICONS: Record<string, string> = {
  LUNA: '/img/tokens/luna.svg', USDC: '/img/tokens/usdc.svg', SOLID: '/img/tokens/solid.svg', CAPA: '/img/tokens/capa.svg',
  ROAR: '/img/tokens/roar.png', 'wBTC.atom': '/img/tokens/wbtc.svg', PAXG: '/img/tokens/paxg.svg',
  // Same issuer, same mark. The label is what tells it apart from Noble USDC.
  'USDC.inj': '/img/tokens/usdc.svg',
  ampLUNA: '/img/tokens/ampluna.svg', arbLUNA: '/img/tokens/arbluna.svg', EURe: '/img/tokens/eure.svg',
  USDT: '/img/tokens/usdt.svg', ATOM: '/img/tokens/atom.svg',
  // Two ASTROs on Terra: the original cw20 and the IBC one from Neutron that Astroport pays in now.
  'ASTRO.cw20': '/img/tokens/astro-cw20.svg', ASTRO: '/img/tokens/astro.png',
  bLUNA: '/img/tokens/bluna.png', ampROAR: '/img/tokens/amproar.png', stLUNA: '/img/tokens/stluna.svg',
  stATOM: '/img/tokens/statom.svg', dATOM: '/img/tokens/datom.svg', INJ: '/img/tokens/inj.svg', FUEL: '/img/tokens/fuel.png',
  'USDT.axl': '/img/tokens/usdt.svg',
  // LunaX and VKR have no mark in the chain registry; they get the lettered coin.
}

export type MarkSize = 16 | 20 | 24 | 32

/** A token's mark, or its first letter on a plain coin when there is none, never a broken image. */
export function TokenIcon({ label, size = 24 }: { label: string; size?: MarkSize }) {
  const src = TOKEN_ICONS[label]
  return (
    <span className={`sw-mark sw-mark--${size}`} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small self-hosted mark */}
      {src ? <img src={src} alt='' width={size} height={size} draggable={false} /> : label.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Two coins, the second tucked behind the first: the pair at a glance. */
export function PairIcons({ a, b, size = 24 }: { a: string; b: string; size?: MarkSize }) {
  return <span className='sw-marks'><TokenIcon label={a} size={size} /><TokenIcon label={b} size={size} /></span>
}
