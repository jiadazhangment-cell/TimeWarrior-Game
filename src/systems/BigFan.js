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

  _draw(now) {
    const d = this.def
    const g = this.g
    g.clear()
    // 护圈(圆洞边缘)+轴毂+叶片;slow 档整体微抖(挣扎)
    const jx = this.mode === 'slow' && now < this._pulseUntil ? Phaser.Math.Between(-2, 2) : 0
    const cx = d.cx + jx, cy = d.cy
    g.lineStyle(10, 0x2a2f36, 1).strokeCircle(cx, cy, d.r + 14)
    g.lineStyle(3, 0x4a5058, 1).strokeCircle(cx, cy, d.r + 7)
    for (let i = 0; i < d.blades; i++) {
      const a = this.angle + (i * Math.PI * 2) / d.blades
      const c = Math.cos(a), s = Math.sin(a)
      // 叶片=从 hub 到 r 的长条(略带梯形:根宽 34 梢宽 20)
      const nx = -s, ny = c
      const x1 = cx + c * d.hub, y1 = cy + s * d.hub
      const x2 = cx + c * d.r, y2 = cy + s * d.r
      g.fillStyle(0x343a42, 1)
      g.beginPath()
      g.moveTo(x1 + nx * 17, y1 + ny * 17)
      g.lineTo(x2 + nx * 10, y2 + ny * 10)
      g.lineTo(x2 - nx * 10, y2 - ny * 10)
      g.lineTo(x1 - nx * 17, y1 - ny * 17)
      g.closePath().fillPath()
      g.lineStyle(2, 0x14171b, 1).strokePath()
    }
    g.fillStyle(0x3b4048, 1).fillCircle(cx, cy, d.hub)
    g.lineStyle(3, 0x14171b, 1).strokeCircle(cx, cy, d.hub)
    // 状态灯:运转=警戒红点;停死=熄灭
    g.fillStyle(this.mode === 'stopped' ? 0x2a2f36 : 0xff3524, 1).fillCircle(cx, cy, 7)
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
      g.fillStyle(0xd8dde2, 0.25).fillRect(d.x - 4, d.y - 26, 8, 20) // 预告气丝
    } else if (active) {
      const h = d.len * Math.min(1, t / 140)
      for (let i = 0; i < 5; i++) { // 灰盒蒸汽柱:噪声白条
        const w = 10 + i * 5 + Phaser.Math.Between(-3, 3)
        g.fillStyle(0xe8edf2, 0.3 - i * 0.045)
          .fillRect(d.x - w / 2 + Phaser.Math.Between(-2, 2), d.y - h * (0.25 + i * 0.19), w, h * 0.2)
      }
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
