// 巨型风扇(基地章 R-B 动力区主机关)+ 蒸汽泄压喷口(配角机关)。
// 设计依据:docs/新内容调研/巨物机关与震撼感语法.md §1 六硬规则——
//   三档转速(全速必死→慢转挣扎掐隙→总闸停死);断电走"打爆分散配电柜"(外围供能打得动,风扇本体打不动);
//   叶片不做旋转刚体(Turbine Ruins 的 physbox 教训):转动=纯 graphics 绘制+投影判定,
//   吸力=Alien³ 手法(全速靠近被拽向叶片);巨物"可以急停不能急启"(CEDEC):降档刹车快、启动慢(接口留存)。
//
// —— 侧视重构(2026-07-28,用户点名"风扇应该侧放,不是正对屏幕")——
// 病根:玩家是沿 X 轴穿过风道的,叶盘物理上立在 YZ 平面里,侧视相机(沿 Z 看)本来就只看得到它的
// 侧剖面;画成正对屏幕的圆盘+同心圆护罩,等于让"所见"和"所碰"活在两个世界。现在整台机器改用
// 剖切语言重画(与暗门的地下结构剖面件同一套语法:先当真机械设计,再从结构派生视觉与判定):
//   ⓪ 风道墙:洞口上下两段实体(碰撞条目 fanwall 在 level 里,几何契约=洞口 cy±r → 170..630)。
//   ① 洞口 = 水平圆筒被剖切面(z=0)切开后的那个矩形;里面看到的是筒子远半侧的内壁,按圆周等分
//      取样(y = cy − R·cosθ)画横带 —— 屏幕上自然"两端密、中间疏",这就是筒壁绕过去的透视压缩,
//      比同心环诚实(同心环是正对屏幕才有的语言)。
//   ② 电机舱 = 顺 X 轴的水平胶囊(鼻锥迎着来风朝西),靠远侧两根定子支撑杆挂在筒壁上——真机三根
//      120° 分布,第三根正指相机,恰好落在剖切面里被切掉了。轴沿 X:这才是轴流风机侧看的样子。
//   ③ 叶片 = 扫过洞口的板条:绕 X 轴转,投影只剩 −cos(φ) 的 Y 分量,于是 |cosφ| 决定板条长短、
//      sin(φ) 的正负决定它在剖切面的哪一侧。近侧(sinφ>0)画亮、参与判定、并画在玩家之前;
//      远侧画暗、纯背景、不判定(偏袒玩家红线:看不清的不打你)。指向相机时投影缩成一条板厚的缝——
//      那是薄板的正确投影,不是 bug。
//   ④ 判定同步改成投影重叠(近侧叶片的 Y 段 ∩ 玩家胶囊 Y 段):看到哪一条打你,就是哪一条。
//   ⑤ 停位从"45° X 形"改"120° Y 形":一片朝正上,另两片梢端都停在 cy+r/2=515,洞底 630 往上
//      让出 115px 净空——"停机后走得过"从视觉上就成立(叶片数因此固定 3,见构造函数)。
// 灰盒阶段渲染=graphics;美术批次换切件时逻辑零改(看与碰分家)。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'

// 暖工业配色:这台机器立在 R-B 动力区的金褐大厅里(REGIONS.power tint 0xd6cdb4 / lampColor 0xffc447),
// 原来那套冷蓝灰(0x10141a/0x39424f)在暖场里是异物——同一间屋子的金属必须咬合同一个光源色温。
const C = {
  wall: 0x181410, panel: 0x221b13, seam: 0x0d0a07,          // 墙板基 / 面板 / 板缝(近黑暖)
  metal: 0x4f463a, metalLit: 0x5c5244, metalHi: 0x6f6350,   // 结构金属三档
  lumenDeep: 0x050403,                                       // 筒腔深处(看不到底的风道)
  blade: 0x6b5f4e, bladeHi: 0x8a7c66, bladeDark: 0x3a3226,  // 近侧叶片:叶面 / 前缘受光棱 / 后缘暗面
  bladeFar: 0x1c160e, bladeBlur: 0x2c2419,                   // 远侧叶片(压到洞腔色)+ 残影
  spill: 0x8a6a3a, air: 0xcaa877,                            // 大厅漏进洞口的暖金环境光 / 气流线
  hazard: 0xd8b13a, hazardDark: 0x1a1510,                    // 黄黑警示带(0xd8b13a 本来就是暖黄,留用)
  lampOn: 0xff3524, lampOff: 0x2f6b4a,
}
// 近/远两侧叶片在剖切沿(sinφ→0)那一刻共用的底色:两边必须在这里接得上,
// 否则叶片每次扫过洞口顶沿/底沿都会"啪"地一亮一暗。
const BLADE_BASE = 0x2e2618

// 颜色插值:自己按通道算,省掉 Phaser.Display.Color.Interpolate 每帧 new 出来的十几个 Color 对象。
// 位运算自带取整,不用再 Math.round。
const mix = (a, b, t) => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * k)
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * k)
  const bl = (a & 255) + (((b & 255) - (a & 255)) * k)
  return ((r << 16) | (g << 8) | bl) & 0xffffff
}
// 按时间片取的伪随机(不是按帧 random):165Hz 屏上每帧摇一次会抖成蜂鸣,和 60fps 是两个手感——
// 项目铁律"每帧量必须时间归一化"在视觉抖动上同样成立。
const hash01 = (n) => { const v = Math.sin(n * 12.9898) * 43758.5453; return Math.abs(v - Math.floor(v)) }

export class BigFan {
  constructor(scene, def) {
    this.scene = scene
    this.def = def
    this.angle = Math.random() * Math.PI
    this.speed = def.speeds.full
    this.targetSpeed = def.speeds.full
    this.mode = 'full'          // full → mid → slow → stopped
    this.deadCabs = 0
    this._pulseAt = 0           // slow 档挣扎脉冲计时
    this._pulseUntil = 0
    // 叶片数固定 3:大直径工业轴流机本来就是 3~4 叶,更关键的是"停机后能过人"的几何前提——
    // 3 叶停在 Y 形位时最低那两片梢端只到 cy+r/2,底下留得出 115px 净空;6 叶怎么停都会有一片
    // 正对下方把洞口封死。config 里的 def.blades(6)是正视时代的遗留,这里不再读它。
    this.blades = 3
    this.g = scene.add.graphics().setDepth(6.2)      // 风道本体:墙/洞腔/远侧件——都在玩家身后
    // 近侧叶片单开一层画在玩家之前(玩家 rig 是 depth 20):近侧=剖切面这一侧,叶片扫过来时本就
    // 该从人前面划过去;画在人身后就又回到"打你的东西你看不见"。被盖到的只有洞心 ±21px 这一条竖带。
    this.gNear = scene.add.graphics().setDepth(21)
    this._onBreak = (id) => {
      if (!def.cabinets.includes(id)) return
      this.deadCabs++
      // 停机是终态:总闸切断后再打爆配电柜,只记账不改档——否则风扇"复活"而总控台是
      // 一次性的(used 后永不再交互),玩家将永远无法二次停机(审查判真 high)。
      if (this.mode === 'stopped') return
      this._setMode(this.deadCabs >= 2 ? 'slow' : 'mid')
      EventBus.emit('camera:shake', 0.012)
    }
    this._onEvent = (name) => { if (name === def.shutdownEvent) this._shutdown() }
    EventBus.on('breakable:destroyed', this._onBreak)
    EventBus.on('devices:event', this._onEvent)
    scene.events.once('shutdown', () => {
      EventBus.off('breakable:destroyed', this._onBreak)
      EventBus.off('devices:event', this._onEvent)
    })
  }

  _setMode(m) {
    this.mode = m
    this.targetSpeed = this.def.speeds[m] ?? 0
  }

  _shutdown() {
    if (this.mode === 'stopped') return
    this.mode = 'stopped'
    this.targetSpeed = 0
    // 停位对齐:惯性滑到最近的 k·120°(blade0 指正上)= 侧视下的"Y 形位"。
    // 这个停位是设计出来的通道,不是随便找个角度:一片全长朝上(梢端 y=cy−r=170),另两片相位
    // ±120°,梢端都落在 cy+r·cos60°=515,洞底 630 往上让出 115px 净空——站立胶囊 88 高、头顶 542,
    // 还剩 27px 余量,"停机后走得过"于是从视觉上就成立(判定层 running=false 本来就免伤)。
    const step = (Math.PI * 2) / this.blades
    this._alignTarget = (Math.floor(this.angle / step) + 1) * step
    this.scene.addTrauma?.(0.55) // 巨物停机=大事件
  }

  // 停位定格后,把停驻在近侧的那片斜停板条(φ=+120°,梢端 515)推成一条静态实体:
  // 它是停机后画面里最醒目的静物,跳进洞口够得着它(起跳后身体 383..471 与它 423..518 相交),
  // 能看见就必须能撞上(所见即所碰);子弹打上去也该有钢板的回应。远侧那片(φ=+240°)画在筒子
  // 背面=背景,不给实体;正上那片(φ=0)底缘 354,满跳头顶 383 都够不着,给了也是死数据。
  // 巨物机关语法 §1.2⑦ 的"停机=叶片变静态结构"落在这里。
  _parkSolid() {
    if (this._parked) return
    this._parked = true
    const q = this._bladeQuad(this.angle + (Math.PI * 2) / 3, this.def.cx, this.def.cy)
    const x0 = Math.min(q.ax, q.dx), x1 = Math.max(q.bx, q.cx2)
    const y0 = Math.min(q.ay, q.cy2), y1 = Math.max(q.ay, q.cy2)
    this.scene.solids.push({ x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), fanBlade: true })
  }

  update(dt) {
    const d = this.def
    const now = this.scene.time.now
    // 转速:降档=急刹(大质量可以突然停);slow 档叠挣扎脉冲(轴承卡滞感,穿越张力的来源)
    let target = this.targetSpeed
    if (this.mode === 'slow') {
      if (now > this._pulseAt) {
        this._pulseAt = now + Phaser.Math.Between(1400, 2300)
        this._pulseUntil = now + 300
      }
      if (now < this._pulseUntil) target += 1.3
    }
    if (this.mode === 'stopped' && this._alignTarget != null) {
      // 缓滑进停位角,到位定格并清残速(否则对齐后 else 分支的残余 speed 又把角度推歪——实测偏 0.27rad)。
      // 滑停期间 speed 同步到真实滑行角速度:此前它冻结在停机前的值(如 full 的 3.0),
      // 而叶片实际只以 0.9 rad/s 扫——命中前瞻/残影数量/气流强度全按假转速算(审查判真 med)。
      this.speed = Math.min(this.speed, 0.9)
      this.angle += Math.min((this._alignTarget - this.angle), 0.9 * dt)
      if (this._alignTarget - this.angle < 0.005) { this.angle = this._alignTarget; this._alignTarget = null; this.speed = 0; this._parkSolid() }
    } else {
      this.speed += (target - this.speed) * Math.min(1, dt * (target < this.speed ? 2.2 : 0.6))
      this.angle += this.speed * dt
    }

    this._applyPlayer(dt)
    this._draw(now)
  }

  // 玩家:吸力/排风 + 叶片命中(投影重叠判定,不做旋转刚体)
  _applyPlayer(dt) {
    const d = this.def
    const p = this.scene.player
    if (!p?.alive) return
    const running = this.speed > 0.05
    const k = this.speed / d.speeds.full // 气流强度随转速
    const inHallY = p.y > d.suction.yTop && p.y < 790
    if (running && inHallY) {
      // 位移注入(平台带人同款语义):玩家 vx 每帧被运动学控制器重写,改 vx 会被吃掉 90%(实测 0.8s 仅漂 35px)。
      // 直接挪 x=恒速拖拽场,玩家满速 360 逆走可挣脱(净 ~100px/s)=费劲但能逃的正确手感;
      // 本系统在 player.update 之前执行,重叠由玩家自身 X 段碰撞解算兜底
      const drag = d.suction.maxAccel * 0.55 * k * dt
      if (p.x > d.suction.x1 && p.x < d.wallX) p.x += drag           // 吸向叶片(危险拉力)
      else if (p.x > d.wallX + d.wallW && p.x < d.blowX2) p.x += drag * 0.45 // 排风侧吹离
    }
    // 叶片命中:侧视下"被叶片扫到" = 近侧叶片的投影段与玩家胶囊的 Y 区间相交。
    // (旧的径向扇区判定是"正对屏幕的圆盘"的数学,和现在画出来的东西不是一回事,整段换掉。)
    if (!running) return
    // 无敌帧窗口内整段跳过:hurt 会自己拒伤,但后面的击退/vy/trauma 是无条件执行的——
    // 不加这道门,站在叶片路径里会被每帧 340 速度反复弹墙+震屏连响(审查判真 med)。
    if (this.scene.time.now < (p.invulnUntil ?? 0)) return
    const cxm = d.wallX + d.wallW / 2
    if (Math.abs(p.x - cxm) > d.wallW / 2 + 24) return // 只在墙厚平面附近:叶片就转在这一片里
    const pc = p.capsule
    // 站在大厅地面(700)贴着墙根的人,人在风道底板(cy+r=630)以下=在筒子外面,不该被扫到。
    // 墙的视觉宽 180 而碰撞只有中间 45,不加这道门就会出现"站在墙根被隔着墙打"(偏袒玩家红线)。
    if (pc.y + pc.h > d.cy + d.r + 10) return
    const pTop = pc.y, pBot = pc.y + pc.h
    // 速度前瞻:快转时一帧里叶片扫过的距离远大于板厚,把判定段沿 Y 撑开(沿用旧的 speed*0.03 换算)
    const lead = d.r * this.speed * 0.03
    for (let i = 0; i < this.blades; i++) {
      const ph = this.angle + (i * Math.PI * 2) / this.blades
      if (Math.sin(ph) <= 0.15) continue // 远侧 + 几乎正对相机(投影缩没了)的一律不判定
      const yTip = d.cy - d.r * Math.cos(ph)
      const y0 = Math.min(d.cy, yTip) - lead, y1 = Math.max(d.cy, yTip) + lead
      if (pBot > y0 && pTop < y1) {
        p.hurt(d.touchDamage, d.cx, pc.y + pc.h * 0.5)
        p.vx = Math.sign(p.x - d.cx || -1) * 340 // 甩回来侧(强击退,离开叶面)
        p.vy = Math.min(p.vy, -170)
        this.scene.addTrauma?.(0.35)
        return
      }
    }
  }

  // 绘制:整台机器一帧画完(墙面→洞腔→远侧件→电机舱→剖切沿→警示/灯→气流→近侧叶片)。
  // 巨物感三招(docs 巨物机关语法 §3)在侧视里的对应物:①剖切沿有厚度=筒子是被切开的真管子
  // ②筒壁横带的疏密=尺度参照(玩家肩宽 30,洞口 460 高=约 15 个肩宽)③近侧板条+竖向拖影=转速可读。
  _draw(now) {
    const d = this.def
    const g = this.g, gn = this.gNear
    g.clear(); gn.clear()
    const cx = d.cx, cy = d.cy, R = d.r
    const wall = d.wall ?? { x: d.wallX - 60, w: d.wallW + 120, top: 60, bottom: 700 }
    const yTop = cy - R, yBot = cy + R          // 洞口竖直范围:与 level fanwall 的几何契约(170..630)
    const running = this.speed > 0.05
    const k = this.speed / d.speeds.full
    // 慢转挣扎脉冲 = 转子在轴承里顿一下:抖动只加给转子(叶片+轮毂环),风道是死结构不跟着晃——
    // 原来整台一起抖是"贴图思维"的残留(一张图整体位移),真机械只有转动件会跳。
    const pulsing = this.mode === 'slow' && now < this._pulseUntil
    const jp = Math.floor(now / 45)
    const jx = pulsing ? hash01(jp) * 4 - 2 : 0
    const jy = pulsing ? hash01(jp + 7) * 3 - 1.5 : 0
    const bx = cx + jx, by = cy + jy

    this._drawWallFace(g, wall, yTop, yBot)
    this._drawDuctLumen(g, wall.x, wall.w, cy, R)
    // 远侧叶片:转在筒子背面,压暗到洞腔色 + 一层错位残影当模糊。放在支撑杆/电机舱之前=更深的一层
    for (let i = 0; i < this.blades; i++) {
      const ph = this.angle + (i * Math.PI * 2) / this.blades
      if (Math.sin(ph) > 0) continue
      this._drawBlade(g, ph, bx, by, false)
    }
    this._drawStruts(g, cx, cy)
    this._drawNacelle(g, cx, cy, jx, jy)
    this._drawRim(g, wall.x, wall.w, yTop, yBot)
    this._drawLamps(g, wall, now, yTop, yBot)
    if (running && k > 0.3) this._drawAirflow(g, now, k) // 吸力是位移注入(看不见的手),得把气流画出来
    // 近侧叶片 + 速度残影:单独一层画在玩家之前(见构造函数)。
    // 残影 = 同一片叶片更早相位上的投影(沿 Y 拖影),数量随转速;相位倒推可能退回远半侧
    // (刚从洞口顶沿进来的那片),那一刻它还没到近侧,不该留影。
    const ghosts = running ? Math.min(6, Math.round(this.speed * 2)) : 0
    for (let i = 0; i < this.blades; i++) {
      const ph = this.angle + (i * Math.PI * 2) / this.blades
      if (Math.sin(ph) <= 0) continue
      for (let t = ghosts; t >= 1; t--) {
        const gp = ph - t * 0.13
        if (Math.sin(gp) <= 0) continue
        gn.fillStyle(C.blade, 0.15 - t * 0.017)
        this._bladePath(gn, this._bladeQuad(gp, bx, by))
        gn.fillPath()
      }
      this._drawBlade(gn, ph, bx, by, true)
    }
  }

  // ⓪ 风道墙:洞口上下两段实体(碰撞条目在 level 的 fanwall,视觉全在这里)。
  // 墙板语言=分段钢板+板缝+螺栓+踢脚+黄黑斜纹;明度压到与周围工业背景同档
  // (灰亮的板会读作"没贴图的白模")。洞底以下那块原来是一整片黑矩形——正视时代没人看它,
  // 侧视里它就在玩家脚边,必须补足结构。
  _drawWallFace(g, wall, yTop, yBot) {
    const wx = wall.x, ww = wall.w
    for (const [by, bh] of [[wall.top, yTop - wall.top], [yBot, wall.bottom - yBot]]) {
      if (bh <= 0) continue
      g.fillStyle(C.wall, 1).fillRect(wx, by, ww, bh)
      g.fillStyle(C.panel, 1).fillRect(wx + 6, by, ww - 12, bh)
      g.lineStyle(2.5, C.seam, 1).strokeRect(wx, by, ww, bh)
      for (let py = by + 22; py < by + bh - 10; py += 44) {      // 分段板缝+螺栓(尺度参照)
        g.lineStyle(2, C.seam, 0.9).lineBetween(wx + 4, py, wx + ww - 4, py)
        for (const bxo of [12, ww - 12]) {
          g.fillStyle(C.metal, 1).fillCircle(wx + bxo, py - 6, 3)
          g.fillStyle(C.metalHi, 0.5).fillCircle(wx + bxo - 1, py - 7, 1.2) // 受光点:纯圆片读作贴纸
        }
      }
    }
    // 墙基踢脚:玩家脚边这一条,真机是防撞的加厚板 + 一道窄警示纹(比洞口那道淡,主次要分明)
    const kb = wall.bottom - 12
    g.fillStyle(C.metalLit, 1).fillRect(wx, kb, ww, 12)
    g.fillStyle(C.seam, 0.6).fillRect(wx, kb, ww, 2)
    this._hazardBand(g, wx, kb + 3, ww, 7, 0.5)
    // 洞口上下沿的黄黑警示带:进出口的危险语言(整套配色迁暖时它不用改,本来就是暖黄)
    this._hazardBand(g, wx, yTop - 16, ww, 12, 0.9)
    this._hazardBand(g, wx, yBot + 4, ww, 12, 0.9)
  }

  // 黄黑警示带:真警示带是 45° 斜纹(竖条读作色卡),两端按带宽裁齐——裁出来的三角本来就是撕口的样子
  _hazardBand(g, bx, by, bw, bh, alpha) {
    g.fillStyle(C.hazard, alpha).fillRect(bx, by, bw, bh)
    g.fillStyle(C.hazardDark, alpha)
    const cl = (v) => (v < bx ? bx : v > bx + bw ? bx + bw : v)
    for (let sx = bx - bh; sx < bx + bw; sx += 22) {
      const x0 = cl(sx), x1 = cl(sx + 11), x2 = cl(sx + bh + 11), x3 = cl(sx + bh)
      if (x1 - x0 < 0.2 && x2 - x3 < 0.2) continue
      g.beginPath()
      g.moveTo(x0, by + bh); g.lineTo(x1, by + bh); g.lineTo(x2, by); g.lineTo(x3, by)
      g.closePath()
      g.fillPath()
    }
  }

  // ① 洞腔:剖开的水平圆筒,看到的是远半侧内壁。按圆周等分取样(y = cy − R·cosθ)——屏幕上
  // 自然"两端密中间疏",这就是筒壁绕过去的透视压缩;板缝沿筒长方向=横线,一层层往深处收暗到近黑。
  // 西侧(朝大厅那一侧)留一道暖金环境反光:光是从大厅漏进洞口的,只可能落在近沿。
  _drawDuctLumen(g, ox, ow, cy, R) {
    const N = 13
    g.fillStyle(C.lumenDeep, 1).fillRect(ox, cy - R, ow, R * 2)
    let py = cy - R
    for (let n = 1; n <= N; n++) {
      const y = cy - R * Math.cos((n / N) * Math.PI)
      const dep = Math.sin(((n - 0.5) / N) * Math.PI)          // 这一带离剖切面有多深(0=切沿,1=最深)
      const h = y - py + 0.6                                   // +0.6:相邻带咬住,免得亚像素处露黑缝
      // 下半侧的切沿更亮:光从大厅落在筒底,上下一样亮会读成镜像贴图
      const edge = mix(0x241c14, 0x342a1e, (py - cy + R) / (R * 2))
      g.fillStyle(mix(edge, C.lumenDeep, Math.pow(dep, 0.85)), 1).fillRect(ox, py, ow, h)
      if (h > 7) g.lineStyle(1.4, C.seam, 0.7).lineBetween(ox + 4, y, ox + ow - 4, y) // 两端太密的板缝省掉
      g.fillStyle(C.spill, 0.25 * (1 - dep)).fillRect(ox, py, 11, h)
      py = y
    }
  }

  // ② 定子支撑杆:电机舱靠它挂在筒壁上。真机三根 120° 分布,这里那根正指相机的恰好落在剖切面里
  // (被切掉了),剩下两根都在远半侧——所以一律画暗、且都在玩家身后:人是贴着剖面这一侧走过去的,
  // 不会出现"看得见的杆子撞不到"。放在叶片平面下游(+46)免得和叶片挤在同一条竖线上。
  _drawStruts(g, cx, cy) {
    const d = this.def
    const sx = cx + 46
    for (const a of [(Math.PI * 7) / 6, (Math.PI * 11) / 6]) { // 210° / 330°(90° 那根已被剖掉)
      const c = Math.cos(a)
      const y0 = cy - d.hub * c, y1 = cy - d.r * c
      g.fillStyle(mix(BLADE_BASE, C.metal, 0.3), 1)
      g.beginPath()
      g.moveTo(sx - 7, y0); g.lineTo(sx + 7, y0); g.lineTo(sx + 5, y1); g.lineTo(sx - 5, y1)
      g.closePath()
      g.fillPath()
      g.lineStyle(1.4, C.seam, 0.7).strokePath()
      g.lineStyle(1.2, C.metalLit, 0.3).lineBetween(sx - 6, y0, sx - 4.5, y1) // 远处的件只留一丝掠光
    }
  }

  // ② 电机舱:顺 X 轴的水平胶囊——鼻锥朝西(吸力来向=迎风面),尾锥朝东排风,散热片在电机段。
  // 半高取 d.hub:正视时代那个"轮毂半径"和侧视这个"舱体半高"本来就是同一个零件的两种看法。
  _drawNacelle(g, cx, cy, jx, jy) {
    const h = this.def.hub
    const x0 = cx - 34, x1 = cx + 30, nose = cx - 78, tail = cx + 60
    g.fillStyle(C.metal, 1)
    g.beginPath()
    g.moveTo(nose, cy)
    g.lineTo(x0, cy - h); g.lineTo(x1, cy - h)
    g.lineTo(tail, cy - h * 0.34); g.lineTo(tail, cy + h * 0.34)
    g.lineTo(x1, cy + h); g.lineTo(x0, cy + h)
    g.closePath()
    g.fillPath()
    g.lineStyle(2.5, 0x14100a, 1).strokePath()
    g.lineStyle(3, C.metalHi, 0.5).lineBetween(x0 + 3, cy - h + 1.5, x1 - 3, cy - h + 1.5) // 顶面受光
    g.lineStyle(2.4, C.metalHi, 0.4).lineBetween(nose + 5, cy - 2, x0 + 3, cy - h + 3)     // 鼻锥迎光棱
    for (const rx of [cx + 4, cx + 15, cx + 26]) {                                          // 电机段散热片
      g.lineStyle(2.6, 0x2f2920, 0.9).lineBetween(rx, cy - h + 6, rx, cy + h - 6)
      g.lineStyle(1.2, C.metalLit, 0.5).lineBetween(rx + 2, cy - h + 7, rx + 2, cy + h - 7)
    }
    // 轮毂环:叶片就是从这一圈上长出来的,所以它跟着转子一起顿(jx/jy)。三颗定位螺栓按相位上下走——
    // 全速时叶片糊成一片,这三颗是唯一还数得清的东西,"转子在转"靠它读。
    g.fillStyle(mix(C.metal, 0x000000, 0.28), 1).fillRect(cx - 18 + jx, cy - h + jy, 36, h * 2)
    g.lineStyle(1.6, 0x14100a, 0.85).strokeRect(cx - 18 + jx, cy - h + jy, 36, h * 2)
    for (let i = 0; i < this.blades; i++) {
      const ph = this.angle + (i * Math.PI * 2) / this.blades
      g.fillStyle(Math.sin(ph) > 0 ? C.metalHi : 0x352e24, 1)
      g.fillCircle(cx + jx, cy + jy - (h - 13) * Math.cos(ph), 3.4)
    }
  }

  // ③ 叶片投影几何:叶片绕 X 轴转,跨度方向在屏幕上只剩 −cos(φ) 的 Y 分量(φ=0 正上、π 正下、
  // ±π/2 指向相机/背面);屏幕内宽度取弦在 X 上的投影——真机叶片有扭角(根部桨距大、梢部小),
  // 所以侧视是"根宽梢窄",正好和正视的根窄梢宽相反,这一条是侧看像真机的关键。
  _bladeQuad(phi, cx, cy) {
    const d = this.def
    const c = Math.cos(phi), s = Math.abs(Math.sin(phi))
    const y0 = cy - d.hub * c                 // 叶根:贴着电机舱外缘长出来
    let y1 = cy - d.r * c                     // 叶梢
    y1 += (y1 >= y0 ? 1 : -1) * 3.4 * s       // 板厚:越接近正对相机,看到的越是这块板的侧棱
    const xr = cx - 4, xt = cx + 5            // 微后掠:梢部略偏下游,免得读成一根笔直的板条
    return { ax: xr - 17, ay: y0, bx: xr + 17, by: y0, cx2: xt + 13, cy2: y1, dx: xt - 13, dy: y1 }
  }

  _bladePath(g, q) {
    g.beginPath()
    g.moveTo(q.ax, q.ay); g.lineTo(q.bx, q.by); g.lineTo(q.cx2, q.cy2); g.lineTo(q.dx, q.dy)
    g.closePath()
    return q
  }

  // 叶片本体。近/远两侧的亮度都跟着 |sinφ| 连续过渡到同一个 BLADE_BASE:叶片扫过洞口顶沿/底沿
  // 时是"绕过去"的,不能在那一帧"啪"地从暗跳到亮。
  _drawBlade(g, phi, cx, cy, near) {
    const s = Math.abs(Math.sin(phi))
    if (!near) { // 远侧:先叠一层错位残影(轻模糊感=它在筒子背面飞快掠过),再画本体
      g.fillStyle(C.bladeBlur, 0.45)
      this._bladePath(g, this._bladeQuad(phi - 0.09, cx, cy))
      g.fillPath()
    }
    const q = this._bladeQuad(phi, cx, cy)
    g.fillStyle(near ? mix(BLADE_BASE, C.blade, Math.min(1, 0.15 + 1.15 * s))
      : mix(BLADE_BASE, C.bladeFar, s), 1)
    this._bladePath(g, q)
    g.fillPath()
    g.lineStyle(near ? 2.4 : 1.6, near ? 0x171208 : 0x14100b, near ? 1 : 0.85)
    g.strokePath()
    if (!near) return
    const hi = Math.min(1, 0.2 + 1.2 * s)
    g.lineStyle(3.2, C.bladeHi, 0.95 * hi).lineBetween(q.ax, q.ay, q.dx, q.dy)     // 前缘受光棱(迎风朝西)
    g.lineStyle(2.2, C.bladeDark, 0.9 * hi).lineBetween(q.bx, q.by, q.cx2, q.cy2)  // 后缘暗面=板有厚度
    g.lineStyle(1.3, C.blade, 0.5 * hi)                                            // 叶背加强筋
    g.lineBetween((q.ax + q.bx) / 2, q.ay, (q.cx2 + q.dx) / 2, q.cy2)
  }

  // ④ 剖切沿:筒壁被切开的断面(有厚度的一圈钢板)。这道亮边是"这台机器被切开了"的核心语法,
  // 也是玩家脚下那条通行带的边界——洞底 630 就是他踩着走过去的那条沿。
  _drawRim(g, ox, ow, yTop, yBot) {
    for (const [y, dir] of [[yTop, 1], [yBot, -1]]) {
      g.fillStyle(C.metalLit, 1).fillRect(ox, dir > 0 ? y : y - 7, ow, 7)
      g.lineStyle(1.6, C.metalHi, 0.75).lineBetween(ox, y + dir * 0.8, ox + ow, y + dir * 0.8)
      g.lineStyle(2, 0x0a0805, 0.8).lineBetween(ox, y + dir * 8, ox + ow, y + dir * 8) // 断面内侧的暗影
    }
  }

  // ⑤ 状态灯:运转=警戒红(慢转闪烁提示"随时会挣脱"),停死=熄灭的暗绿。语义勿改,只是从圆盘边
  // 挪到墙面的灯箱里——单个圆片读作贴纸,壳体+软光晕+亮核才读作灯(项目光效三要素)。
  _drawLamps(g, wall, now, yTop, yBot) {
    const on = this.mode !== 'stopped'
    const blink = this.mode === 'slow' ? (Math.sin(now / 140) > 0 ? 1 : 0.25) : 1
    const col = on ? C.lampOn : C.lampOff
    const a = on ? blink : 0.7
    for (const [lx, ly] of [[wall.x + 26, yTop - 30], [wall.x + wall.w - 26, yBot + 30]]) {
      g.fillStyle(C.metal, 1).fillRect(lx - 9, ly - 7, 18, 14)
      g.lineStyle(1.6, C.seam, 0.9).strokeRect(lx - 9, ly - 7, 18, 14)
      g.fillStyle(col, a * 0.22).fillCircle(lx, ly, 11)
      g.fillStyle(col, a).fillCircle(lx, ly, 4.2)
      g.fillStyle(0xffffff, a * 0.5).fillCircle(lx - 1.2, ly - 1.2, 1.6)
    }
  }

  // ⑥ 气流可视化:吸力走的是位移注入(一只看不见的手在拖人),不画出来玩家只会觉得"我怎么被拽着走"。
  // 吸入侧(西)几条向洞口收拢的细线,排风侧(东)反向发散且更淡;相位按时间滚动=流动感,不是贴纸。
  // 相位取自 now(毫秒),不做每帧累加——刷新率变了气流速度不会跟着变。
  _drawAirflow(g, now, k) {
    const d = this.def
    const cy = d.cy, R = d.r
    for (let side = 0; side < 2; side++) {
      const suck = side === 0
      const x0 = suck ? d.suction.x1 : d.wallX + d.wallW
      const x1 = suck ? d.wallX : d.blowX2
      const amp = suck ? 0.34 : 0.19
      const len = 60 + 60 * k
      for (let i = 0; i < 5; i++) {
        const u = i / 2 - 1                                    // −1..1:五条泳道
        const ph = ((now * (0.0003 + 0.00055 * k)) + i * 0.37) % 1
        const xa = x0 + (x1 - x0) * ph
        const xe = Math.min(xa + len, x1)
        // 收拢/发散:吸入侧越靠近洞口越向轴心收(风被漏斗吸进去),排风侧反过来铺开
        const sp = (t) => R * (suck ? 1.15 - 0.3 * t : 0.85 + 0.3 * t)
        const al = amp * k * Math.sin(Math.PI * ph)            // 生命周期:两端淡入淡出
        g.lineStyle(1.6 + 1.4 * k, C.air, al)
        g.lineBetween(xa, cy + u * sp(ph), xe, cy + u * sp((xe - x0) / (x1 - x0)))
        g.lineStyle(1, C.spill, al * 0.8)                      // 线头亮一点=流向可读
        g.lineBetween(xe - 12, cy + u * sp((xe - x0) / (x1 - x0)), xe, cy + u * sp((xe - x0) / (x1 - x0)))
      }
    }
  }
}

// 蒸汽泄压喷口:双层周期(预热 300ms 小气丝=公平预告——激光栅栏同款纪律)
export class SteamVent {
  constructor(scene, def) {
    this.scene = scene
    this.def = def
    this.g = scene.add.graphics().setDepth(6.1)
  }

  update() {
    const d = this.def
    const now = this.scene.time.now
    const cyc = d.onMs + d.offMs
    const t = (now + (d.phase ?? 0)) % cyc
    const preMs = 300
    const active = t < d.onMs
    const preheat = !active && t > cyc - preMs
    const g = this.g
    g.clear()
    // 喷口基座:法兰盘+阀体+两颗地脚螺栓的小结构件(原来是一根 32×8 灰条,和风扇同处一厅,
    // 金属色一并迁到暖工业调)。总高压在 12px 内=齐地件——它没有碰撞,画高了就成了
    // "看得见踩不到"的东西,踩到项目"所见即所碰"的红线上。
    g.fillStyle(0x3b342a, 1).fillRect(d.x - 20, d.y - 7, 40, 7)
    g.fillStyle(0x4f463a, 1).fillRect(d.x - 20, d.y - 7, 40, 2.5)
    g.lineStyle(1.4, 0x14100a, 0.9).strokeRect(d.x - 20, d.y - 7, 40, 7)
    g.fillStyle(0x5c5244, 1).fillRect(d.x - 10, d.y - 12, 20, 5)          // 阀体
    g.lineStyle(1.4, 0x14100a, 0.9).strokeRect(d.x - 10, d.y - 12, 20, 5)
    g.fillStyle(0x6f6350, 1).fillRect(d.x - 7, d.y - 12, 14, 1.6)         // 喷口唇沿受光
    for (const ox of [-15, 15]) {
      g.fillStyle(0x6f6350, 1).fillCircle(d.x + ox, d.y - 3.5, 2.4)
      g.fillStyle(0x14100a, 0.7).fillCircle(d.x + ox, d.y - 3.5, 1)
    }
    if (preheat) {
      // 预告:阀口渗出的一缕细气(公平预警,与激光栅栏 280ms 预热同款语言)
      g.fillStyle(0xd8dde2, 0.18).fillCircle(d.x, d.y - 18, 4)
      g.fillStyle(0xd8dde2, 0.1).fillCircle(d.x + 2, d.y - 30, 6)
    } else if (active) {
      const h = d.len * Math.min(1, t / 140)
      // 蒸汽柱=沿高度堆叠的柔性气团(越高越大越淡),不是白方条;近根部带一点过热黄
      const seed = Math.floor(now / 90)
      for (let i = 0; i < 9; i++) {
        const u = i / 8
        const rr = 7 + u * 22
        // 横向风摆:这条走廊尽头就是巨型风扇,厅里本来就有风——慢相位的正弦=整柱的摆,
        // 快相位的噪声=湍流碎动,越高被吹得越偏;单靠原来的噪声只是原地抖,读作一根立着的白棍。
        const sway = Math.sin(now / 620 + i * 0.85) * (2 + u * 12) + Math.sin(seed * 0.7 + i * 1.7) * (2 + u * 6)
        const py = d.y - h * (0.08 + u * 0.95)
        g.fillStyle(0xe8edf2, (0.26 - u * 0.2) * (0.75 + Math.sin(seed + i) * 0.25))
        g.fillCircle(d.x + sway, py, rr)
      }
      g.fillStyle(0xffd9a0, 0.16).fillCircle(d.x, d.y - 14, 9) // 阀口过热辉
      // 伤害:喷汽区与玩家胶囊相交(玩家 hurtInvuln 自带防连击)
      const p = this.scene.player
      if (p?.alive) {
        const pc = p.capsule
        if (pc.x < d.x + 14 && pc.x + pc.w > d.x - 14 && pc.y + pc.h > d.y - h && pc.y < d.y) {
          p.hurt(d.dmg, d.x + (p.x < d.x ? 60 : -60), pc.y + pc.h * 0.5)
        }
      }
    }
  }
}
