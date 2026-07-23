// 爆炸序列帧切帧 —— 母本:docs/风格参考/参考30-爆炸序列帧v1.png(1:1 画布,4×4 网格 16 帧,纯黑底)
// AI 网格会有几像素漂移:逐格算亮度质心,把内容重定心到干净的 256 格,输出归一化 spritesheet
// (纯黑底保留不抠——游戏内 ADD 混合下黑=透明)。用法: node tools/cut-boom.mjs
import sharp from 'sharp'

const SRC = 'docs/风格参考/参考30-爆炸序列帧v1.png'
const OUT = 'public/assets/img/fx_boom.png'
const CELL = 256

const meta = await sharp(SRC).metadata()
const gw = Math.floor(meta.width / 4), gh = Math.floor(meta.height / 4)
const cells = []
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 4; c++) {
    const raw = await sharp(SRC).extract({ left: c * gw, top: r * gh, width: gw, height: gh })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const { data, info } = raw
    // 亮度质心(黑底上只有火像素贡献权重)
    let sx = 0, sy = 0, sw = 0
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
        if (lum > 16) { sx += x * lum; sy += y * lum; sw += lum }
      }
    }
    const cx = sw ? sx / sw : info.width / 2
    const cy = sw ? sy / sw : info.height / 2
    // 以质心为中心裁一块正方形(不足处补黑),再缩到 CELL
    const half = Math.min(gw, gh) / 2
    const px = Math.round(Math.max(0, Math.min(gw - half * 2, cx - half)))
    const py = Math.round(Math.max(0, Math.min(gh - half * 2, cy - half)))
    const buf = await sharp(SRC)
      .extract({ left: c * gw + px, top: r * gh + py, width: Math.round(half * 2), height: Math.round(half * 2) })
      .resize(CELL, CELL, { fit: 'fill' })
      .png().toBuffer()
    cells.push(buf)
    console.log(`frame ${r * 4 + c}: 质心 (${Math.round(cx)},${Math.round(cy)}) 权重 ${Math.round(sw / 1000)}k`)
  }
}
await sharp({ create: { width: CELL * 4, height: CELL * 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
  .composite(cells.map((input, i) => ({ input, left: (i % 4) * CELL, top: Math.floor(i / 4) * CELL })))
  .png().toFile(OUT)
console.log(`→ ${OUT} (${CELL * 4}×${CELL * 4}, 16 帧 ${CELL}×${CELL})`)
