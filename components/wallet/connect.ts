/**
 * Asks the header's wallet button to open the list of wallets, from anywhere on the page
 * (a "Connect wallet" button in a panel), by event, as in Openfields Ask.
 */
export const CONNECT_EVENT = 'openfields-swap:connect'
export const askToConnect = (): void => { window.dispatchEvent(new Event(CONNECT_EVENT)) }

/** "terra1qx…c8f2", or with `tight` "terra1…c8f2": the prefix names the network, the end tells wallets apart. */
export const shortAddress = (a: string, tight = false) => `${tight ? a.slice(0, a.indexOf('1') + 1) : a.slice(0, a.indexOf('1') + 3)}…${a.slice(-4)}`
