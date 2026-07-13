// 资产管线:assets/svg/*.svg → public/assets/img/*.png(2x 分辨率)
// 用法: node tools/build-assets.mjs
import { Resvg } from '@resvg/resvg-js'
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'

const SRC = 'assets/svg'
const OUT = 'public/assets/img'
const SCALE = 2 // 2x 出图,游戏内 0.5 缩放显示,保证高分屏清晰

mkdirSync(OUT, { recursive: true })
let n = 0
for (const f of readdirSync(SRC)) {
  if (!f.endsWith('.svg')) continue
  const svg = readFileSync(join(SRC, f), 'utf8')
  const png = new Resvg(svg, { fitTo: { mode: 'zoom', value: SCALE } }).render().asPng()
  const name = basename(f, '.svg') + '.png'
  writeFileSync(join(OUT, name), png)
  n++
  console.log('✓', name, png.length, 'bytes')
}
console.log(`完成:${n} 个 SVG → ${OUT}(${SCALE}x)`)
