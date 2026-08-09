import fs from 'fs'
const { BigFan } = await import('./BigFan.old.mjs')
const DRAW = ['fillRect','fillCircle','fillPath','strokeRect','strokeCircle','lineBetween','strokePath','slice']
const STATE = ['fillStyle','lineStyle','beginPath','moveTo','lineTo','closePath','clear','setDepth','fillPoints']
function mkGfx(){ const g={_draws:0,_all:0}; for(const m of DRAW.concat(STATE)){ g[m]=()=>{g._all++; if(DRAW.includes(m))g._draws++; return g} } return g }
const gfx=[]; let TNOW=0
const scene={ add:{graphics:()=>{const g=mkGfx();gfx.push(g);return g}}, time:{get now(){return TNOW}}, events:{once:()=>{}}, player:null, addTrauma:()=>{} }
const def = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/level_slice.json','utf8')).fans[0]
const fan = new BigFan(scene, def)
const g0 = gfx[0]
const rows=[]
for (const mode of ['full','mid','slow','stopped']) {
  fan.mode = mode; fan.speed = mode==='stopped'?0:def.speeds[mode]
  let mx=0,sum=0,n=0,mxAll=0
  for (let s=0;s<240;s++){ fan.angle=(s/240)*Math.PI*2; TNOW=1000+s*16; g0._draws=0; g0._all=0; fan._draw(TNOW); mx=Math.max(mx,g0._draws); mxAll=Math.max(mxAll,g0._all); sum+=g0._draws; n++ }
  rows.push({mode,maxDraw:mx,avgDraw:+(sum/n).toFixed(1),maxAllCalls:mxAll})
}
console.log('=== 旧版(正视圆盘)graphics 调用统计 ===')
console.table(rows)
