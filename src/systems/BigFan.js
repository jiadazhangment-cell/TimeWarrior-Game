// 巨型风扇(基地章 R-B 动力区主机关)+ 蒸汽泄压喷口(配角机关)。
// 设计依据:docs/新内容调研/巨物机关与震撼感语法.md §1 六硬规则——
//   三档转速(全速必死→慢转挣扎掐隙→总闸停死);断电走"打爆分散配电柜"(外围供能打得动,风扇本体打不动);
//   叶片不做旋转刚体(Turbine Ruins 的 physbox 教训):转动=纯贴图/graphics 旋转+角度扇区判定,
//   吸力=Alien³ 手法(全速靠近被拽向叶片);巨物"可以急停不能急启"(CEDEC):降档刹车快、启动慢(接口留存)。
// 灰盒阶段渲染=graphics;美术批次换切件时逻辑零改(看与碰分家)。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'

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
    this.g = scene.add.graphics().setDepth(6.2)
    this._onBreak = (id) => {
      if (!def.cabinets.includes(id)) return
      this.deadCabs++
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
    // 停位对齐:惯性滑到最近的 45° X 形(圆洞四角遮挡最小=通道全开的视觉确认)
    this._alignTarget = (Math.floor(this.angle / (Math.PI / 2)) + 0.5) * (Math.PI / 2)
    if (this._alignTarget < this.angle) this._alignTarget += Math.PI / 2
    this.scene.addTrauma?.(0.55) // 巨物停机=大事件
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
      // 缓滑进停位角,到位定格并清残速(否则对齐后 else 分支的残余 speed 又把角度推歪——实测偏 0.27rad)
      this.angle += Math.min((this._alignTarget - this.angle), 0.9 * dt)
      if (this._alignTarget - this.angle < 0.005) { this.angle = this._alignTarget; this._alignTarget = null; this.speed = 0 }
    } else {
      this.speed += (target - this.speed) * Math.min(1, dt * (target < this.speed ? 2.2 : 0.6))
      this.angle += this.speed * dt
    }

    this._applyPlayer(dt)
    this._draw(now)
  }

  // 玩家:吸力/排风 + 叶片命中(角度扇区判定,不做旋转刚体)
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
    // 叶片命中:玩家胶囊中心在墙厚平面附近 + 半径环带内 + 角度落在任一叶片扇区
    if (!running) return
    const cxm = d.wallX + d.wallW / 2
    if (Math.abs(p.x - cxm) > d.wallW / 2 + 24) return
    const pc = p.capsule
    const py = pc.y + pc.h / 2
    const dist = Math.hypot(p.x - d.cx, py - d.cy)
    if (dist < d.hub + 8 || dist > d.r + 6) return
    const ang = Math.atan2(py - d.cy, p.x - d.cx)
    const half = Math.atan2(25, dist) + this.speed * 0.03 // 叶宽半角+速度前瞻(快转=实际扫过更宽)
    for (let i = 0; i < d.blades; i++) {
      const ba = this.angle + (i * Math.PI * 2) / d.blades
      let diff = Phaser.Math.Angle.Wrap(ang - ba)
      if (Math.abs(diff) < half) {
        p.hurt(d.touchDamage, d.cx, py)
        p.vx = Math.sign(p.x - d.cx || -1) * 340 // 甩回来侧(强击退,离开叶面)
        p.vy = Math.min(p.vy, -170)
        this.scene.addTrauma?.(0.35)
        return
      }
    }
  }

  // 绘制:风道井口(嵌进墙里的深井)+ 护网 + 叶轮 + 运动模糊。
  // 巨物感三招(docs 巨物机关语法 §3):①井口有厚度=不是贴在墙上的圆片 ②护网规则网格=尺度参照
  // ③高速时叠半透明扇形残影=转速可读(而不是靠叶片本身糊成一团)
  _draw(now) {
    const d = this.def
    const g = this.g
    g.clear()
    const jx = this.mode === 'slow' && now < this._pulseUntil ? Phaser.Math.Between(-2, 2) : 0
    const cx = d.cx + jx, cy = d.cy
    const R = d.r
    // ⓪ 风道墙本体:从天花板到地面的整面墙,中间被圆洞挖开(墙+洞同一套构图=风扇"嵌在墙里"
    //    而不是悬空的大圆盘;墙的碰撞条目在 level 的 fanwall,视觉全在这里)
    const wall = d.wall ?? { x: d.wallX - 60, w: d.wallW + 120, top: 60, bottom: 700 }
    const wx = wall.x, ww = wall.w
    for (const [by, bh] of [[wall.top, cy - R - wall.top], [cy + R, wall.bottom - (cy + R)]]) {
      if (bh <= 0) continue
      // 墙板:压到与周围工业背景同明度(灰亮的板会读作"没贴图的白模")
      g.fillStyle(0x10141a, 1).fillRect(wx, by, ww, bh)
      g.fillStyle(0x171d24, 1).fillRect(wx + 6, by, ww - 12, bh)
      g.lineStyle(2.5, 0x11151a, 1).strokeRect(wx, by, ww, bh)
      for (let py = by + 22; py < by + bh - 10; py += 44) {      // 分段板缝+螺栓(尺度参照)
        g.lineStyle(2, 0x11151a, 0.9).lineBetween(wx + 4, py, wx + ww - 4, py)
        g.fillStyle(0x4a5058, 1).fillCircle(wx + 12, py - 6, 3)
        g.fillStyle(0x4a5058, 1).fillCircle(wx + ww - 12, py - 6, 3)
      }
    }
    // 黄黑警示带(洞口上下沿):进出口的危险语言
    for (const wy of [cy - R - 16, cy + R + 4]) {
      if (wy < wall.top || wy > wall.bottom - 12) continue
      g.fillStyle(0xd8b13a, 0.9).fillRect(wx, wy, ww, 12)
      g.fillStyle(0x14171b, 0.9)
      for (let sx = wx; sx < wx + ww; sx += 22) g.fillRect(sx, wy, 11, 12)
    }
    // ① 洞口:风道往里凹——内壁由外向内逐层压暗(同心环模拟纵深),中心近全黑=看不到底的风道
    g.fillStyle(0x14181f, 1).fillCircle(cx, cy, R + 26)
    for (let k = 0; k < 6; k++) {
      const t = k / 5
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        new Phaser.Display.Color(0x1b, 0x21, 0x2a), new Phaser.Display.Color(0x02, 0x03, 0x05), 5, k)
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1)
      g.fillCircle(cx, cy, (R + 18) * (1 - t * 0.62))
    }
    g.lineStyle(6, 0x39424f, 1).strokeCircle(cx, cy, R + 21)
    g.lineStyle(2, 0x0a0d12, 0.8).strokeCircle(cx, cy, R + 12)
    // 井口螺栓一圈(尺度参照:玩家肩宽≈30,螺栓间距 ~46)
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) {
      g.fillStyle(0x4a5058, 1).fillCircle(cx + Math.cos(a) * (R + 21), cy + Math.sin(a) * (R + 21), 3.6)
    }
    // ② 叶轮:真实轴流风机的宽叶片(根窄梢宽的扭曲叶面),必须比内壁亮出一大截才读得出体积
    const running = this.speed > 0.05
    const bw0 = R * 0.16, bw1 = R * 0.30 // 叶根/叶梢半宽:宽叶片才像工业风机,细条读作电扇
    for (let i = 0; i < d.blades; i++) {
      const a = this.angle + (i * Math.PI * 2) / d.blades
      const c = Math.cos(a), s = Math.sin(a)
      const nx = -s, ny = c
      const x1 = cx + c * (d.hub - 4), y1 = cy + s * (d.hub - 4)
      const x2 = cx + c * (R - 6), y2 = cy + s * (R - 6)
      // 叶面:前缘(迎风侧)比后缘宽 = 扭角;整体比内壁亮 3 档
      g.fillStyle(0x49515b, 1)
      g.beginPath()
      g.moveTo(x1 + nx * bw0, y1 + ny * bw0)
      g.lineTo(x2 + nx * bw1, y2 + ny * bw1)
      g.lineTo(x2 - nx * bw1 * 0.45, y2 - ny * bw1 * 0.45)
      g.lineTo(x1 - nx * bw0 * 0.5, y1 - ny * bw0 * 0.5)
      g.closePath().fillPath()
      g.lineStyle(2.5, 0x0d1015, 1).strokePath()
      // 前缘高光(受光棱)+ 后缘暗面 = 叶片有厚度
      g.lineStyle(4, 0x77828d, 0.95)
      g.lineBetween(x1 + nx * bw0 * 0.92, y1 + ny * bw0 * 0.92, x2 + nx * bw1 * 0.92, y2 + ny * bw1 * 0.92)
      g.lineStyle(3, 0x272d35, 0.9)
      g.lineBetween(x1 - nx * bw0 * 0.4, y1 - ny * bw0 * 0.4, x2 - nx * bw1 * 0.38, y2 - ny * bw1 * 0.38)
      // 叶背加强筋(两道)
      g.lineStyle(1.6, 0x333a43, 0.9)
      for (const t of [0.25, -0.15]) {
        g.lineBetween(x1 + nx * bw0 * t, y1 + ny * bw0 * t, x2 + nx * bw1 * t, y2 + ny * bw1 * t)
      }
    }
    // ③ 运动模糊:转速越高,越多半透明残影扇形(全速=糊成盘,慢转=看得清叶片)
    if (running) {
      const ghosts = Math.min(7, Math.round(this.speed * 2.4))
      for (let k = 1; k <= ghosts; k++) {
        const a0 = this.angle - k * 0.13
        g.fillStyle(0x2a3038, 0.16 - k * 0.014)
        for (let i = 0; i < d.blades; i++) {
          const a = a0 + (i * Math.PI * 2) / d.blades
          g.slice(cx, cy, R, a - 0.1, a + 0.1, false)
          g.fillPath()
        }
      }
    }
    // 轮毂:锥形帽+散热筋
    g.fillStyle(0x39424f, 1).fillCircle(cx, cy, d.hub)
    g.lineStyle(3, 0x14171b, 1).strokeCircle(cx, cy, d.hub)
    g.fillStyle(0x4a5058, 1).fillCircle(cx - d.hub * 0.18, cy - d.hub * 0.18, d.hub * 0.52)
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      g.lineStyle(2, 0x1b2027, 0.9)
      g.lineBetween(cx + Math.cos(a + this.angle) * d.hub * 0.55, cy + Math.sin(a + this.angle) * d.hub * 0.55,
        cx + Math.cos(a + this.angle) * (d.hub - 3), cy + Math.sin(a + this.angle) * (d.hub - 3))
    }
    // ④ 护罩:真实风机护网=同心圆+辐条(方格网读作坐标纸);圈距 42px≈玩家肩宽=尺度参照
    g.lineStyle(2.2, 0x0a0d12, 0.62)
    for (let rr = 42; rr < R; rr += 42) g.strokeCircle(cx, cy, rr)
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI * 2) / 12 + 0.13
      g.lineBetween(cx + Math.cos(a) * d.hub, cy + Math.sin(a) * d.hub, cx + Math.cos(a) * R, cy + Math.sin(a) * R)
    }
    // ⑤ 状态灯环:运转=警戒红(慢转时闪烁提示"随时会挣脱"),停死=熄灭的暗绿
    const lampOn = this.mode !== 'stopped'
    const blink = this.mode === 'slow' ? (Math.sin(now / 140) > 0 ? 1 : 0.25) : 1
    for (const la of [-Math.PI / 2, Math.PI / 2]) {
      const lx = cx + Math.cos(la) * (R + 21), ly = cy + Math.sin(la) * (R + 21)
      g.fillStyle(lampOn ? 0xff3524 : 0x2f6b4a, lampOn ? blink : 0.7).fillCircle(lx, ly, 6)
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
    // 喷口基座
    g.fillStyle(0x2a2f36, 1).fillRect(d.x - 16, d.y - 8, 32, 8)
    if (preheat) {
      // 预告:阀口渗出的一缕细气(公平预警,与激光栅栏 280ms 预热同款语言)
      g.fillStyle(0xd8dde2, 0.18).fillCircle(d.x, d.y - 14, 4)
      g.fillStyle(0xd8dde2, 0.1).fillCircle(d.x + 2, d.y - 26, 6)
    } else if (active) {
      const h = d.len * Math.min(1, t / 140)
      // 蒸汽柱=沿高度堆叠的柔性气团(越高越大越淡),不是白方条;近根部带一点过热黄
      const seed = Math.floor(now / 90)
      for (let i = 0; i < 9; i++) {
        const u = i / 8
        const rr = 7 + u * 22
        const px = d.x + Math.sin(seed * 0.7 + i * 1.7) * (3 + u * 13)
        const py = d.y - h * (0.08 + u * 0.95)
        g.fillStyle(0xe8edf2, (0.26 - u * 0.2) * (0.75 + Math.sin(seed + i) * 0.25))
        g.fillCircle(px, py, rr)
      }
      g.fillStyle(0xffd9a0, 0.16).fillCircle(d.x, d.y - 10, 9) // 阀口过热辉
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
