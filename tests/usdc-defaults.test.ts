import {keepMarket} from 'lib/sharedCache'
import {SCAN_PLAN} from 'lib/scanPlan'
import {expect,it} from 'vitest'
import {usdPrices,USDC_INJ_DENOM,NOBLE_USDC,KNOWN_TOKENS} from 'lib/dex'
it('anchors dollar prices to USDC.inj without silently valuing Noble at one dollar',()=>{
 const prices=usdPrices([])
 expect(prices[USDC_INJ_DENOM]).toBe(1)
 expect(prices[NOBLE_USDC]).toBeUndefined()
 expect(KNOWN_TOKENS.find(t=>t.key==='USDC')?.label).toBe('USDC.n')
 expect(KNOWN_TOKENS.find(t=>t.key==='USDC.inj')?.info).toEqual({native_token:{denom:USDC_INJ_DENOM}})
})

it('rejects older Noble-anchored scan snapshots and uses a separate current cache namespace',()=>{
 expect(keepMarket({at:1,px:{[NOBLE_USDC]:1,[USDC_INJ_DENOM]:1.007}})).toBe(false)
 expect(keepMarket({at:1,px:{[USDC_INJ_DENOM]:1,[NOBLE_USDC]:.993}})).toBe(true)
 expect(Object.values(SCAN_PLAN).every(p=>p.key.includes('usdc-inj'))).toBe(true)
})
