import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ownedArrivalCrystal, type ArrivalCrystal } from 'lib/crystal-arrival'
import CrystalArt from 'components/CrystalArt'

const seen = new Set<string>()
export function CrystalArrivalScene({ crystal, onClose }: { crystal: ArrivalCrystal; onClose: () => void }) {
  const skip = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    skip.current?.focus({preventScroll:true})
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(onClose,reduced ? 1300 : 3400)
    const key = (e: KeyboardEvent) => {
      if(e.key === 'Escape') onClose()
      if(e.key === 'Tab'){e.preventDefault();skip.current?.focus()}
    }
    window.addEventListener('keydown',key)
    return () => {clearTimeout(timer);window.removeEventListener('keydown',key);document.body.style.overflow=overflow;previous?.focus({preventScroll:true})}
  },[onClose])
  return createPortal(<div className='cc-arrival' role='dialog' aria-modal='true' aria-label={`Crystal holder recognised. Crystal ${crystal.tokenId}, ${crystal.tier}.`}>
    <div className='cc-horizon' aria-hidden />
    <div className='cc-signature'>CRYSTALS<span>WALLET VERIFIED</span></div>
    <button ref={skip} type='button' className='cc-skip' onClick={onClose}>Skip intro <span aria-hidden>↗</span></button>
    <div className='cc-reveal' aria-hidden>
      <div className='cc-light'/><div className='cc-art'><CrystalArt tokenId={crystal.tokenId} tier={crystal.tier} /></div>
      <div className='cc-scan'/>
    </div>
    <div className='cc-words'><span className='cc-level'>{crystal.tier} · #{String(crystal.tokenId).padStart(4,'0')}</span><h2>Recognised.</h2><p>Your Crystal is with you.</p></div>
    <style jsx>{`
      .cc-arrival{position:fixed;inset:0;z-index:2147483000;background:#100f0e;color:#f1e7d7;overflow:hidden;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;animation:cc-envelope 3.4s both;isolation:isolate}
      .cc-arrival:before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 42%,transparent 15%,#100f0e 75%);z-index:2}
      .cc-signature{position:absolute;top:max(34px,env(safe-area-inset-top));left:42px;font-size:11px;letter-spacing:.3em;color:#e5ccaa;z-index:5;animation:cc-type 1s .3s both}.cc-signature span{display:block;font-size:8px;letter-spacing:.23em;color:#8f8273;margin-top:10px}
      .cc-skip{position:absolute;top:max(30px,env(safe-area-inset-top));right:38px;z-index:6;background:transparent;border:1px solid #dfc39e35;color:#bdb0a0;font:inherit;font-size:11px;border-radius:2px;padding:11px 14px;cursor:pointer}.cc-skip span{margin-left:18px}.cc-skip:focus-visible{outline:2px solid #ead4b2;outline-offset:4px}
      .cc-reveal{position:absolute;left:50%;top:43%;width:min(620px,82vw);aspect-ratio:1;transform:translate(-50%,-50%);z-index:1}
      .cc-art{width:100%;height:100%;animation:cc-gem 2.9s .1s cubic-bezier(.12,.8,.2,1) both}.cc-art :global(canvas){width:100%;height:100%;display:block}
      .cc-light{position:absolute;left:50%;top:18%;width:1px;height:66%;background:linear-gradient(transparent,#fff0ce,transparent);box-shadow:0 0 38px 6px #e7ca9830;transform:rotate(24deg);animation:cc-ray 1.7s .1s both;z-index:3;pointer-events:none}
      .cc-scan{position:absolute;left:15%;right:15%;height:1px;top:45%;background:linear-gradient(90deg,transparent,#fff5d5,transparent);box-shadow:0 0 35px #e5c28c;animation:cc-sweep 1.8s .2s both;z-index:3;pointer-events:none}
      .cc-horizon{position:absolute;left:18%;right:18%;top:72%;height:1px;background:linear-gradient(90deg,transparent,#dec19745,transparent);animation:cc-horizon 2s .3s both}
      .cc-words{position:absolute;bottom:12%;left:20px;right:20px;text-align:center;z-index:4;animation:cc-type 1.2s 1s both}.cc-level{font-size:10px;color:#cbb28c;letter-spacing:.23em;text-transform:uppercase}.cc-words h2{font:400 clamp(42px,6vw,72px)/1.1 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.055em;margin:18px 0 12px;color:#f2e8d8}.cc-words p{font-size:12px;letter-spacing:.015em;color:#9f9282;margin:0}
      @keyframes cc-envelope{0%{opacity:0}8%,83%{opacity:1}100%{opacity:0;visibility:hidden}}
      @keyframes cc-gem{0%{opacity:0;transform:scale(.72) translateY(70px) rotate(-7deg);filter:blur(15px) brightness(.05)}25%{opacity:1;filter:blur(0) brightness(.35)}58%{filter:blur(0) brightness(1.5)}100%{opacity:1;transform:scale(1) translateY(0) rotate(0);filter:blur(0) brightness(1)}}
      @keyframes cc-ray{0%{opacity:0;transform:translateX(-120px) rotate(24deg) scaleY(.15)}35%{opacity:.7}100%{opacity:0;transform:translateX(150px) rotate(24deg) scaleY(1.3)}}
      @keyframes cc-sweep{0%{opacity:0;transform:scaleX(0) translateY(-80px)}35%{opacity:.8;transform:scaleX(1) translateY(0)}100%{opacity:0;transform:scaleX(1.8) translateY(120px)}}
      @keyframes cc-type{from{opacity:0;transform:translateY(14px);filter:blur(5px)}to{opacity:1;transform:translateY(0);filter:blur(0)}}
      @keyframes cc-horizon{from{opacity:0;transform:scaleX(.05)}to{opacity:1;transform:scaleX(1)}}
      @media(max-width:650px){.cc-signature{left:22px;top:max(28px,env(safe-area-inset-top));font-size:9px}.cc-skip{right:20px;top:max(24px,env(safe-area-inset-top));font-size:10px}.cc-reveal{width:105vw;top:44%}.cc-words{bottom:16%}.cc-horizon{top:70%}}
      @media(prefers-reduced-motion:reduce){.cc-arrival{animation:none}.cc-art,.cc-light,.cc-scan,.cc-signature,.cc-words,.cc-horizon{animation:none!important}.cc-light,.cc-scan{display:none}.cc-art{filter:none;transform:none}.cc-reveal{width:min(420px,80vw)}}
    `}</style>
  </div>,document.body)
}
export default function CrystalArrival({ address }: { address?: string | null }) {
  const [crystal,setCrystal] = useState<ArrivalCrystal | null>(null)
  // Stable closure keeps the scene's focus/timer effect from restarting on unrelated renders.
  const close = useRef(() => setCrystal(null)).current
  useEffect(() => {
    setCrystal(null)
    if(!address) return
    const key=`crystal-arrival:studio-01:${address}`
    if(seen.has(key)) return
    try {if(sessionStorage.getItem(key)) return} catch { /* private browsing still uses memory */ }
    const stop=new AbortController()
    const deadline=setTimeout(()=>stop.abort(),8000)
    ownedArrivalCrystal(address,stop.signal).then(found=>{
      if(!found || stop.signal.aborted || document.querySelector('[role="dialog"][aria-modal="true"]')) return
      seen.add(key)
      try {sessionStorage.setItem(key,'1')} catch { /* memory is enough */ }
      setCrystal(found)
    }).catch(()=>{}).finally(()=>clearTimeout(deadline))
    return ()=>{clearTimeout(deadline);stop.abort()}
  },[address])
  return crystal ? <CrystalArrivalScene crystal={crystal} onClose={close} /> : null
}
