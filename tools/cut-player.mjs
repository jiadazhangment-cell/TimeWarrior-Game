// AI 立绘切件管线 v2:多边形蒙版精确抠件
// preview 模式:输出裁块+红色多边形轮廓叠加,供人眼校版
// final 模式:多边形外透明+白底转透明+缩放输出
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'docs/风格参考/参考8-切件母本.png' // 用户提供的AI生成图(1122x1402,角色高≈498px)
const mode = process.argv[2] ?? 'preview'
const S = 0.4016 // 2x 基准:角色 1x 高 100px

// poly: 源图坐标系的多边形(留白区域外的相邻部件会被剔除); rect 由 poly 包围盒自动生成
// 五单元切件:头 / 躯干+背包 / 双臂持枪整体(aim部件,持枪姿势原样保真) / 前腿大腿 / 前腿小腿+靴
const PARTS = [
  { name: 'player_head', src: SRC, scale2x: S,
    poly: [[414,398],[516,404],[552,432],[566,470],[545,514],[470,526],[424,508],[404,455]] },
  { name: 'player_torso', src: SRC, scale2x: S,
    poly: [[290,466],[408,460],[468,500],[468,638],[432,668],[362,670],[302,638],[286,540]] },
  { name: 'player_armgun', src: SRC, scale2x: S, // 含双臂+步枪;贴轮廓收紧防瓷砖漏入
    poly: [[417,482],[468,506],[520,542],[558,540],[576,506],[700,487],[891,519],[891,545],[790,548],[700,586],[662,618],[600,622],[560,601],[468,597],[418,556]] },
  { name: 'player_thigh', src: SRC, scale2x: S, rotate: -24.6, // 前腿大腿,转正为竖直
    poly: [[428,642],[497,655],[508,720],[470,742],[428,700]] },
  { name: 'player_shin', src: SRC, scale2x: S, // 前腿小腿+大靴(鞋底贴住 y≈900)
    poly: [[447,724],[512,731],[504,796],[556,856],[554,898],[440,900],[446,826]] },
]
const RIFLE = null

function bbox(poly) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function polySvg(poly, box, fill, stroke) {
  const pts = poly.map(([x, y]) => `${x - box.x},${y - box.y}`).join(' ')
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}">` +
    `<polygon points="${pts}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="3" fill-opacity="0"` : ''}/></svg>`
  )
}

async function whiteToAlpha(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const light = mx / 255
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    // 瓷砖背景(亮灰低饱和)转透明;装甲亮板≤0.7 亮度不受影响
    if (light > 0.52 && sat < 0.2) {
      const t = Math.min(1, (light - 0.52) / 0.1)
      data[i + 3] = Math.min(data[i + 3], Math.round(255 * (1 - t)))
    }
    // 红色激光线擦除(高R低GB)
    if (r > 150 && r - g > 75 && r - b > 75) data[i + 3] = 0
  }
  return sharp(data, { raw: info }).png().toBuffer()
}

mkdirSync('tmp-cuts', { recursive: true })

for (const p of RIFLE ? [...PARTS, RIFLE] : PARTS) {
  const box = bbox(p.poly)
  const base = sharp(p.src).extract({ left: box.x, top: box.y, width: box.w, height: box.h })

  if (mode === 'preview') {
    // 裁块+红色轮廓线,便于校版
    const outlined = await base.composite([{ input: polySvg(p.poly, box, 'none', '#ff2b2b') }]).jpeg({ quality: 92 }).toBuffer()
    await sharp(outlined).toFile(`tmp-cuts/${p.name}.jpg`)
    console.log('preview', p.name, JSON.stringify(box))
  } else {
    // 多边形外挖空:mask=多边形白色填充作为 alpha;不 trim(保住坐标系,枢轴按 bbox 原点计算)
    const cutBuf = await base.png().toBuffer()
    const masked = await sharp(cutBuf)
      .composite([{ input: polySvg(p.poly, box, '#ffffff'), blend: 'dest-in' }])
      .png().toBuffer()
    const alphaed = await whiteToAlpha(masked)
    let img = sharp(alphaed)
    if (p.rotate) img = sharp(await img.rotate(p.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
    if (p.flop) img = sharp(await img.flop().png().toBuffer())
    // 缩放到 2x 游戏贴图 + stocky 各向异性配比
    const s2x = (p.scale2x ?? 0.2594)
    const [kx, ky] = p.stocky ?? [1, 1]
    const meta0 = await img.metadata()
    const w = Math.max(2, Math.round(meta0.width * s2x * kx))
    const h = Math.max(2, Math.round(meta0.height * s2x * ky))
    await sharp(await img.png().toBuffer()).resize(w, h, { fit: 'fill' }).png().toFile(`public/assets/img/${p.name}.png`)
    console.log('final', p.name, `${w}x${h} (1x=${Math.round(w / 2)}x${Math.round(h / 2)})`)
  }
}
console.log('done:', mode)
