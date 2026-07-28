// 背景概念图的"走道面上沿"实测探针(构造性对齐,禁止目测):
// 逐行求平均亮度,找下半张里最大的亮度跃变 = 走道面顶沿;打印 walkR = y/H。
// 用法: node tools/probe-walkline.mjs <图片路径> [搜索起始比例] [结束比例]
import sharp from 'sharp'

const [file, r0 = '0.5', r1 = '0.9'] = process.argv.slice(2)
const meta = await sharp(file).metadata()
const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true })
const W = info.width, H = info.height
const rows = []
let prev = null
for (let y = Math.floor(H * +r0); y < Math.floor(H * +r1); y++) {
  let s = 0
  for (let x = 0; x < W; x += 4) s += data[y * W + x]
  const avg = s / Math.ceil(W / 4)
  if (prev !== null) rows.push({ y, avg, d: avg - prev })
  prev = avg
}
console.log(`size ${meta.width}x${meta.height}`)
console.log('最大亮度跃变(候选走道面上沿):')
rows.slice().sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 8)
  .forEach((r) => console.log(`  y=${r.y}  walkR=${(r.y / H).toFixed(3)}  avg=${r.avg.toFixed(1)}  Δ=${r.d.toFixed(1)}`))
