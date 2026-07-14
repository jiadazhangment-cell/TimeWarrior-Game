// AI 立绘切件管线 v2:多边形蒙版精确抠件
// preview 模式:输出裁块+红色多边形轮廓叠加,供人眼校版
// final 模式:多边形外透明+白底转透明+缩放输出
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'docs/风格参考/ai候选/pose1.jpg'
const RIFLE_SRC = 'docs/风格参考/ai候选/c4_rifle.jpg'
const mode = process.argv[2] ?? 'preview'

// poly: 源图坐标系的多边形(留白区域外的相邻部件会被剔除); rect 由 poly 包围盒自动生成
const PARTS = [
  { name: 'player_head', src: SRC,
    poly: [[252,10],[418,14],[425,90],[405,150],[330,165],[268,150],[248,90]] },
  { name: 'player_torso', src: SRC, // 含背包+下垂的近侧手臂(当后臂用)
    poly: [[170,148],[300,138],[430,182],[458,300],[448,472],[300,480],[240,432],[166,345]] },
  { name: 'player_thigh', src: SRC, // 近侧大腿:髋(~355,455)→膝(~350,645)
    poly: [[318,450],[410,455],[420,555],[400,650],[330,650],[310,545]] },
  { name: 'player_shin', src: SRC, // 近侧小腿+靴(右界收在双靴接缝~x400)
    poly: [[310,632],[390,648],[382,730],[400,788],[404,830],[400,858],[272,856],[284,758],[300,698]] },
  { name: 'player_arm_aim', src: SRC, rotate: -90, // 下垂近臂→旋转为水平朝右
    poly: [[352,198],[422,224],[444,320],[438,425],[410,508],[362,504],[352,400],[346,293]] },
]
// c4 原图:枪口在左、握把在右 → flop 翻转成朝右(实测贴图定案,勿再改)
const RIFLE = { name: 'rifle', src: RIFLE_SRC, poly: [[55,85],[985,85],[985,415],[55,415]], scale2x: 0.202, flop: true }

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
    if (light > 0.82 && sat < 0.16) {
      const t = Math.min(1, (light - 0.82) / 0.15)
      data[i + 3] = Math.min(data[i + 3], Math.round(255 * (1 - t)))
    }
  }
  return sharp(data, { raw: info }).png().toBuffer()
}

mkdirSync('tmp-cuts', { recursive: true })

for (const p of [...PARTS, RIFLE]) {
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
    // 缩放到 2x 游戏贴图(角色源高 848px → 1x 高 110px;步枪单独比例)
    const s2x = (p.scale2x ?? 0.2594)
    const meta0 = await img.metadata()
    const w = Math.max(2, Math.round(meta0.width * s2x))
    const h = Math.max(2, Math.round(meta0.height * s2x))
    await sharp(await img.png().toBuffer()).resize(w, h, { fit: 'fill' }).png().toFile(`public/assets/img/${p.name}.png`)
    console.log('final', p.name, `${w}x${h} (1x=${Math.round(w / 2)}x${Math.round(h / 2)})`)
  }
}
console.log('done:', mode)
