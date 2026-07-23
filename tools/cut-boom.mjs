// 爆炸序列帧切帧 —— 现役母本:docs/风格参考/参考31-爆炸序列帧写实v1.png
// (流体模拟渲染质感,4×4 网格 16 帧,纯黑底;帧内自带"贴地升腾"基线)
// 与参考30(手绘版,已存档)不同:**不做逐格重定心**——重定心会抹掉帧序列内建的蘑菇上升运动,
// 这套帧共享同一地面基线,按网格原样切,游戏内用底边锚定(origin 0.5,0.92)贴地播放。
// 黑底保留不抠(ADD 混合下黑=透明)。用法: node tools/cut-boom.mjs
import sharp from 'sharp'

const SRC = 'docs/风格参考/参考31-爆炸序列帧写实v1.png'
const OUT = 'public/assets/img/fx_boom.png'
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
console.log(`→ ${OUT} (${CELL * 4}×${CELL * 4}, 16 帧 ${CELL}×${CELL}, 网格原样切/未重定心)`)
