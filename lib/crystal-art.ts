/** Crystal Studio · deterministic faceted sculpture. Identity = token id + live tier. */
export type CrystalTier = 'raw' | 'charged' | 'radiant' | 'prismatic' | 'cosmic'
type V = [number, number, number]
const COLORS: Record<CrystalTier, string[]> = {
  raw: ['#dce7ed', '#8eabbf', '#f6ead7'],
  charged: ['#8de8d2', '#387e9b', '#c7fff3'],
  radiant: ['#bd9ae7', '#654d9d', '#e8c8ec'],
  prismatic: ['#9ce5ce', '#b497ec', '#f2bdcf'],
  cosmic: ['#ead1a0', '#9c7440', '#fff0ce'],
}
export function crystalSeed(id: number): number {
  let h = 0
  for (const c of `${id}--crystal`) h = ((h << 5) - h + c.charCodeAt(0)) | 0
  return Math.abs(h)
}
const random = (seed: number, n: number) => { const x = Math.sin(seed * 9301 + n * 49297) * 49979; return x - Math.floor(x) }
export function crystalCut(id: number): number { return Math.floor(random(crystalSeed(id), 1) * 10) }
const cross = (a: V, b: V): V => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
const sub = (a: V, b: V): V => [a[0]-b[0], a[1]-b[1], a[2]-b[2]]
const dot = (a: V, b: V) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const norm = (a: V): V => { const l = Math.hypot(...a) || 1; return a.map(x=>x/l) as V }
const rgb = (s: string) => [1,3,5].map(i=>parseInt(s.slice(i,i+2),16))
const mix = (a: number[], b: number[], t: number) => a.map((v,i)=>Math.round(v*(1-t)+b[i]*t))
const color = (a: number[]) => `rgb(${a.map(x=>Math.max(0,Math.min(255,Math.round(x)))).join(',')})`
const f = (n: number) => n.toFixed(2)

export function studioCrystalSVG(id: number, tier: CrystalTier): string {
  if (!Number.isSafeInteger(id) || id < 1 || id > 1000 || !(tier in COLORS)) throw new Error('Invalid Crystal identity')
  const seed = crystalSeed(id), rng = (n: number) => random(seed,n), cut = crystalCut(id)
  const palette = COLORS[tier].map(rgb)
  const angle = .52 + rng(2)*.65, tilt = -.10 + rng(4)*.20
  const transform = ([x,y,z]: V, scale=1, ox=0, oy=0): V => {
    const a=x*Math.cos(angle)+z*Math.sin(angle), b=-x*Math.sin(angle)+z*Math.cos(angle)
    return [(a*Math.cos(tilt)-y*Math.sin(tilt))*scale+ox, (a*Math.sin(tilt)+y*Math.cos(tilt))*scale+oy, b*scale]
  }
  const tris: {v: V[]; n: V; z: number; i: number}[]=[]
  const gem = (scale: number, ox: number, oy: number, variant: number) => {
    const sides = cut===1 ? 4 : cut===2 ? 6 : cut===7 ? 7 : 8
    const slender = cut===3 ? .62 : cut===4 ? 1.14 : cut===8 ? .86 : .92
    const height = cut===3 ? 1.2 : cut===9 ? .88 : 1
    const levels = [{y:1.62*height,r:0},{y:.79*height,r:.48},{y:.32*height,r:1},{y:-.43*height,r:.78},{y:-1.45*height,r:0}]
    const rings = levels.map((l,j)=>Array.from({length:sides},(_,i):V=>{
      const a=2*Math.PI*i/sides+(j===1?.09:0)+variant*.16
      const irregular = 1 + (rng(50+variant*20+i)-.5)*.14
      return transform([Math.cos(a)*l.r*slender*irregular,l.y,Math.sin(a)*l.r*.69],scale,ox,oy)
    }))
    const add = (v: V[]) => {
      let n=norm(cross(sub(v[1],v[0]),sub(v[2],v[0])))
      // Outward normals, independent of the cap's winding.
      const center=v.reduce((a,b)=>a.map((x,k)=>x+b[k]/3) as V,[0,0,0] as V)
      if (dot(n,[center[0]-ox,center[1]-oy,center[2]])<0) n=n.map(x=>-x) as V
      if(n[2] < -.06) return
      tris.push({v,n,z:center[2],i:tris.length})
    }
    for(let j=0;j<rings.length-1;j++)for(let i=0;i<sides;i++){
      const k=(i+1)%sides
      if(j===0)add([rings[j][i],rings[j+1][i],rings[j+1][k]])
      else if(j===rings.length-2)add([rings[j][i],rings[j+1][i],rings[j][k]])
      else {add([rings[j][i],rings[j+1][i],rings[j][k]]);add([rings[j][k],rings[j+1][i],rings[j+1][k]])}
    }
  }
  if(cut===5 || cut===6){gem(.65,-.52,-.20,1);gem(.58,.57,-.32,2);gem(.88,0,.26,0)}
  else gem(1,0,0,0)
  tris.sort((a,b)=>a.z-b.z)
  const points=tris.flatMap(t=>t.v), minX=Math.min(...points.map(v=>v[0])),maxX=Math.max(...points.map(v=>v[0])),minY=Math.min(...points.map(v=>v[1])),maxY=Math.max(...points.map(v=>v[1]))
  const scale=Math.min(470/(maxX-minX),610/(maxY-minY)),midX=(minX+maxX)/2,midY=(minY+maxY)/2
  const project=(v:V)=>`${f(500+(v[0]-midX)*scale)},${f(455-(v[1]-midY)*scale)}`
  const light=norm([-1,1.5,1.8]), rim=norm([1,.3,.4])
  let defs='', faces=''
  for(const t of tris){
    const p=tier==='prismatic'?palette[t.i%3]:palette[0]
    const lit=Math.max(0,dot(t.n,light)), edge=Math.pow(Math.max(0,dot(t.n,rim)),9), spec=Math.pow(Math.max(0,dot(t.n,norm([-.3,.5,1]))),28)
    const dark=mix(p,palette[1],.48).map(x=>x*(.19+lit*.55))
    const bright=mix(p,[255,251,243],Math.min(.88,.16+lit*.32+spec*.5+edge*.25))
    const grad=`facet-${id}-${t.i}`
    defs+=`<linearGradient id="${grad}" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="${color(bright)}"/><stop offset=".48" stop-color="${color(mix(bright,dark,.39))}"/><stop offset="1" stop-color="${color(dark)}"/></linearGradient>`
    faces+=`<polygon points="${t.v.map(project).join(' ')}" fill="url(#${grad})" stroke="${color(mix(p,[255,255,255],.65))}" stroke-opacity="${f(.10+lit*.16)}" stroke-width=".85" stroke-linejoin="round"/>`
    if(spec>.3 || edge>.72)faces+=`<path d="M${project(t.v[0])} L${project(t.v[1])}" fill="none" stroke="#fff9e9" stroke-opacity="${f(.25+spec*.5)}" stroke-width="1.4"/>`
  }
  const accent=COLORS[tier][0]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="${tier} Crystal ${id}"><defs>${defs}<radialGradient id="a-${id}"><stop stop-color="${accent}" stop-opacity=".11"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient><radialGradient id="floor-${id}"><stop stop-color="${accent}" stop-opacity=".16"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient><filter id="blur-${id}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="13"/></filter></defs><rect width="1000" height="1000" fill="#100f0e"/><ellipse cx="500" cy="430" rx="380" ry="410" fill="url(#a-${id})"/><ellipse cx="500" cy="838" rx="170" ry="28" fill="#000" opacity=".65" filter="url(#blur-${id})"/><ellipse cx="500" cy="828" rx="155" ry="18" fill="url(#floor-${id})"/>${faces}<path d="M448 902H552" stroke="${accent}" stroke-opacity=".23" stroke-width="1"/><text x="500" y="941" font-family="monospace" font-size="13" letter-spacing="4" text-anchor="middle" fill="#a99f92">${String(id).padStart(4,'0')} / ${tier.toUpperCase()}</text></svg>`
}
