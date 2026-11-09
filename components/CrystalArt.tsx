import { useEffect, useRef, useState } from 'react'
import type { CrystalTier } from 'lib/crystal-art'
type Runtime={mountCrystal(canvas:HTMLCanvasElement,id:number,tier:CrystalTier,options?:{animated?:boolean;interactive?:boolean}):()=>void}
let runtime:Promise<Runtime>|undefined
export default function CrystalArt({tokenId,tier,animated=true,interactive=true}:{tokenId:number;tier:CrystalTier;animated?:boolean;interactive?:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null)
 const [error,setError]=useState(false)
 useEffect(()=>{
  let active=true,dispose:(()=>void)|undefined
  setError(false)
  const node=canvas.current;if(!node)return
  const observer=new IntersectionObserver(entries=>{
   if(!entries.some(e=>e.isIntersecting))return
   observer.disconnect()
   const url='/vendor/crystals/studio-v4.js'
   ;(runtime??=import(/* webpackIgnore:true */url) as Promise<Runtime>).then(engine=>{
    if(active)dispose=engine.mountCrystal(node,tokenId,tier,{animated,interactive})
   }).catch(()=>{if(active)setError(true)})
  },{rootMargin:'180px'})
  observer.observe(node)
  return ()=>{active=false;observer.disconnect();dispose?.()}
 },[tokenId,tier,animated,interactive])
 if(error)return <div role='img' aria-label={`Crystal ${tokenId}`} style={{display:'grid',placeItems:'center',width:'100%',height:'100%',color:'#9f9282',fontSize:11}}>3D preview unavailable</div>
 return <canvas ref={canvas} data-crystal-id={tokenId} data-crystal-tier={tier} role='img' aria-label={`${tier} Crystal ${tokenId}, animated glass sculpture`} style={{display:'block',width:'100%',height:'100%',objectFit:'contain',background:'#100f0e'}} />
}
