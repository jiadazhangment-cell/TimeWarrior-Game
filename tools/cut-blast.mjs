// 球形爆炸序列帧切帧 —— 母本:docs/风格参考/参考36-爆炸序列帧球形无蘑菇.png
// (写实流体模拟渲染,4×4 网格 16 帧,纯黑底,爆心固定在每格正中、无位移)
//
// 为什么是这套素材:程序化合成(同一张火球贴图复制 N 份 + tween)做了六版全被点名,病根是
// **每张贴图自带完整火球轮廓,叠几张就读作几个火球**,而真实爆炸的一切细节发生在同一团轮廓内部,
// 静态贴图 + tween 原理上做不出"形状本身在演变"。序列帧天生解决:逐帧形状演变、火连续转烟、全程一团。
// 与参考31(蘑菇云版,已退役)的区别:球形无茎、爆心不位移 → 游戏内**居中播放**而不是底边锚定。
//
// 黑底保留不抠(ADD 混合下黑=透明)。用法: node tools/cut-blast.mjs
import sharp from 'sharp'

const SRC = 'docs/风格参考/参考36-爆炸序列帧球形无蘑菇.png'
const OUT = 'public/assets/img/fx_blast.png'
const CELL = 256

const meta = await sharp(SRC).metadata()
const gw = Math.floor(meta.width / 4), gh = Math.floor(meta.height / 4)
const cells = []
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 4; c++) {
    const buf = await sharp(SRC)
      .extract({ left: c * gw, top: r * gh, width: gw, height: gh })
      .resize(CELL, CELL, { fit: 'fill' })
      .png().toBuffer()
    cells.push(buf)
  }
}
await sharp({ create: { width: CELL * 4, height: CELL * 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
  .composite(cells.map((input, i) => ({ input, left: (i % 4) * CELL, top: Math.floor(i / 4) * CELL })))
  .png().toFile(OUT)
console.log(`→ ${OUT} (${CELL * 4}×${CELL * 4}, 16 帧 ${CELL}×${CELL}, 网格原样切/爆心居中)`)
