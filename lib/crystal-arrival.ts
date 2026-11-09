/** Read-only eligibility for the Crystal arrival. Never asks the wallet to sign. */
export interface ArrivalCrystal { tokenId: number; tier: 'raw' | 'charged' | 'radiant' | 'prismatic' | 'cosmic' }
const COLLECTION = 'terra1htnzmetd2xlkgrqqdf3whu8wzwhtjlx7ahrk6qsxxneaktl63r9sx5v2uk'
const CONTRACTS = ['terra1hpjtm8q5r245a797zg0rq42wl4uk0wlvs9a6xet04jka2yj5486sjr96s4','terra1hqhhw5ndpdty4yzteud20a073q93cyupv8rp3wufrv5f7d7xrc8qsuf6kg','terra1jez9g0kqq7lze8ncqunvxzs9d2tu4m9p5vep3d2dgs4dxh5nfj9sm9vgl4']
const ENDPOINTS = ['https://terra-lcd.publicnode.com','https://rest.cosmos.directory/terra2','https://terra-rest.publicnode.com']
const TIERS = new Set(['raw','charged','radiant','prismatic','cosmic'])
export async function ownedArrivalCrystal(address: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<ArrivalCrystal | null> {
  if (!/^terra1[02-9ac-hj-np-z]{38}([02-9ac-hj-np-z]{20})?$/.test(address) || signal.aborted) return null
  const query = async (contract: string, msg: object): Promise<Record<string, unknown> | null> => {
    const path = `/cosmwasm/wasm/v1/contract/${contract}/smart/${encodeURIComponent(btoa(JSON.stringify(msg)))}`
    for (const endpoint of ENDPOINTS) {
      if (signal.aborted) return null
      const stop = new AbortController()
      const abort = () => stop.abort()
      signal.addEventListener('abort',abort,{once:true})
      const timer = setTimeout(abort,5000)
      try {
        const response = await request(endpoint+path,{signal:stop.signal})
        const body = await response.json()
        if(response.ok && body?.data && typeof body.data === 'object') return body.data
        // Missing token/tier record is an answer from the contract, not an outage.
        if(/not found|unknown variant/i.test(String(body?.message))) return null
      } catch { /* try another public endpoint */ }
      finally {clearTimeout(timer);signal.removeEventListener('abort',abort)}
    }
    return null
  }
  const held = await query(COLLECTION,{tokens:{owner:address,limit:1}})
  const token = Array.isArray(held?.tokens) ? held.tokens[0] : null
  if(typeof token !== 'string' || !/^[1-9]\d{0,3}$/.test(token) || Number(token)>1000) return null
  for(const contract of CONTRACTS){
    const info = await query(contract,{crystal_info:{token_id:token}})
    if(signal.aborted) return null
    if(typeof info?.tier === 'string' && TIERS.has(info.tier)) return {tokenId:Number(token),tier:info.tier as ArrivalCrystal['tier']}
  }
  return null
}
