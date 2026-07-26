// 贴地爆炸序列帧切帧 —— 母本:docs/风格参考/参考37-爆炸序列帧贴地穹顶.png
// (写实流体模拟渲染,4×4 网格 16 帧,纯黑底;底平顶隆的穹顶+贴地火焰裙)
//
// 为什么单独一套:用户 2026-07-26 指出"平地上爆炸看上去不应该是圆形,空中爆炸才是圆形"——
// 冲击波被地面反射,火球底部被截断、向上隆起、沿地面向两侧铺开。半空爆走球形的 cut-blast.mjs。
//
// **不能按 4×4 均分切**:实测四行的地面线是 376/616/869/1138,与均分网格线(313.5/627/940.5/1254)
// 差 -116~+63px,均分会把上一行的火焰底部切进下一行的帧里。改为**按实测地面线底边对齐**裁切,
// 帧高取 236(受行间距约束:行2 上界必须高于行1 底部 376 → h < 240;火焰最高 194,容得下)。
// 输出保持源宽高比(313.5:236)→ 256×193,游戏内 origin(0.5,1) 坐在地面线上。
// 黑底保留不抠(ADD 混合下黑=透明)。用法: node tools/cut-blast-ground.mjs
import sharp from 'sharp'

const SRC = 'docs/风格参考/参考37-爆炸序列帧贴地穹顶.png'
const OUT = 'public/assets/img/fx_blast_ground.png'
const GROUND_Y = [376, 616, 869, 1138] // 逐行实测(亮度扫描,见文件头)
const SRC_H = 236                       // 帧高(源图像素)
const OUT_W = 256, OUT_H = 193          // 256 × round(236/313.5*256)

const meta = await sharp(SRC).metadata()
const gw = meta.width / 4
const cells = []
for (let r = 0; r < 4; r++) {
  const top = Math.round(GROUND_Y[r] - SRC_H)
  for (let c = 0; c < 4; c++) {
    const left = Math.round(c * gw)
    const width = Math.round((c + 1) * gw) - left
    const buf = await sharp(SRC)
      .extract({ left, top, width, height: SRC_H })
      .resize(OUT_W, OUT_H, { fit: 'fill' })
      .png().toBuffer()
    cells.push(buf)
  }
}
await sharp({ create: { width: OUT_W * 4, height: OUT_H * 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
  .composite(cells.map((input, i) => ({ input, left: (i % 4) * OUT_W, top: Math.floor(i / 4) * OUT_H })))
  .png().toFile(OUT)
console.log(`→ ${OUT} (${OUT_W * 4}×${OUT_H * 4}, 16 帧 ${OUT_W}×${OUT_H}, 底边=实测地面线)`)
