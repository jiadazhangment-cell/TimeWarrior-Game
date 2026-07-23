// 壁挂机枪炮塔:常驻哨戒装置。
// 扫描锥视野(用户定版,参考 RE 类哨戒:"扫描红光应该是范围性的,一条红线扫不到人"):
// 探测域=以枪口朝向为中心的红色扇形锥(±9°),由 13 条射线被墙/层板截断后围成的多边形
// ——看得见的"它能看到哪";玩家进入扇面=锁定(警报+0.35s 前摇)后点射;丢失回到扫掠。
// 机械限位:枪管相对"外向水平"永不超过 ±80°(用户点名转动幅度过大+内部穿模的根治:
// 扇区配置再宽也翻不进挂墙/不倒转)。角度全程用连续数值(不 Wrap),朝左炮塔跨 π 不跳变。
// 与 Enemy 鸭子类型兼容(alive/capsule/takeHit);死亡=爆花+熏黑+垂枪残骸,不走 ragdoll。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import { segVsRect } from '../systems/Ballistics.js'

const DEG = Math.PI / 180
const SWEEP_SPEED = 26 * DEG // 扫掠角速度(慢=可预判可穿越)
const TRACK_SPEED = 150 * DEG
const LOCK_DELAY_MS = 350 // 锁定到首发的前摇(公平预告:扇面变亮+警报)
const MEMORY_MS = 1200
const CONE_HALF = 9 * DEG // 扫描锥半角
const CONE_RAYS = 13
const MOUNT_LIMIT = 80 * DEG // 机械限位:相对外向水平的最大偏转

export class Turret {
  constructor(scene, spec) { // spec: { x, y, dir(1朝右/-1朝左), sweepDeg?, pitchDeg?, range?, hp? }
    this.scene = scene
    this.spec = spec
    this.dir = spec.dir ?? 1
    this.hp = spec.hp ?? 40
    this.alive = true
    this.active = true // 常时上电(封锁解除 powerDown=奖励;被击毁永久失效)
    this.nextFireAt = 0
    this.burstLeft = 0
    this.nextBurstShotAt = 0
    // 角度约定:一律用"相对外向水平"的连续角(朝右外向=0,朝左外向=π;下为正),避免 Wrap 跳变
    this.outward = this.dir > 0 ? 0 : Math.PI
    const pitch = (spec.pitchDeg ?? 0) * DEG
    // 扇区中心俯角(挂高的炮塔必须往下压才罩得到走道);扫掠界=扇区∩机械限位
    this.homeRel = this.dir > 0 ? pitch : -pitch // rel 空间:>0=顺时针(朝右时向下)
    const sweep = (spec.sweepDeg ?? 40) * DEG
    this.relLo = Math.max(this.homeRel - sweep, -MOUNT_LIMIT)
    this.relHi = Math.min(this.homeRel + sweep, MOUNT_LIMIT)
    this.rel = this.homeRel // 当前枪管角(rel 空间)
    this.state = 'sweep' // sweep(扫掠) | locked(锁定)
    this._sweepDir = 1
    this._lockAt = 0
    this._lastSeenAt = -1e9
    const f = this.dir
    // 挂板贴墙:朝右=板在左缘(origin 0),朝左镜像
    this.base = scene.add.image(spec.x, spec.y, 'dev_turret_base').setDepth(17)
    this.base.setFlipX(f < 0).setOrigin(f > 0 ? 0 : 1, 0.5)
    // 转轴=基座铰接臂末端转环(切件实测占比 x0.83 / y0.54)
    this.pivotX = spec.x + f * 35 * 0.83
    this.pivotY = spec.y + (0.54 - 0.5) * 46
    // 枪体:绕尾部转轴环旋转;朝左=真角度+flipY+原点 y 镜像(与骨架瞄准件同约定)
    this.gun = scene.add.image(this.pivotX, this.pivotY, 'dev_turret_gun').setDepth(18)
    this.gun.setFlipY(f < 0).setOrigin(0.08, f > 0 ? 0.42 : 0.58)
    this.gun.setRotation(this._aimAngle())
    this.lamp = scene.add.image(this.pivotX, this.pivotY, 'px_glow').setTint(0xff3020)
      .setScale(0.14).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD).setDepth(18.1)
    // 扫描锥绘制层(每帧重画;ADD 发光)
    this.beamGfx = scene.add.graphics().setDepth(27).setBlendMode(Phaser.BlendModes.ADD)
  }

  // 命中框原则(敌人命中框≥视觉轮廓):直接取 基座∪枪管 的实时渲染包围盒——
  // 旧版 32×28 只罩转轴,挂板半边+整根枪管都打不中("子弹穿机枪"用户实案);
  // 手写盒又低估了贴图实际渲染尺寸,取真实 bounds=枪转到哪判定到哪,换美术零维护
  get capsule() {
    const bb = this.base.getBounds(), gb = this.gun.getBounds()
    const x0 = Math.min(bb.left, gb.left), y0 = Math.min(bb.top, gb.top)
    return { x: x0, y: y0, w: Math.max(bb.right, gb.right) - x0, h: Math.max(bb.bottom, gb.bottom) - y0 }
  }

  // rel(相对外向水平的偏转,朝右时下为正)→ 世界角
  _aimAngle(rel = this.rel) { return this.dir > 0 ? rel : Math.PI - rel }

  _castRay(ang, solids) {
    const range = this.spec.range ?? 640
    const dx = Math.cos(ang), dy = Math.sin(ang)
    const x1 = this.pivotX + dx * 40, y1 = this.pivotY + dy * 40
    const x2 = this.pivotX + dx * range, y2 = this.pivotY + dy * range
    let end = 1
    for (const s of solids) {
      if (s.minor) continue // junk 小件不截扫描锥(桌面电脑挡不住探测光)
      const t = segVsRect(x1, y1, x2, y2, s)
      if (t !== null && t < end) end = t
    }
    return { x1, y1, x2: x1 + (x2 - x1) * end, y2: y1 + (y2 - y1) * end }
  }

  update(dt, player, solids, fireFn) {
    this.beamGfx.clear()
    if (!this.alive || !this.active) return
    const now = this.scene.time.now
    // —— 扫描锥:±CONE_HALF 内 13 条射线,逐条被实体截断 → 扇形多边形 ——
    const aimW = this._aimAngle()
    const rays = []
    for (let i = 0; i < CONE_RAYS; i++) {
      const a = aimW - CONE_HALF + (2 * CONE_HALF * i) / (CONE_RAYS - 1)
      rays.push(this._castRay(a, solids))
    }
    // 探测:任一锥内射线段扫过玩家胶囊(锥被墙截断,墙后天然安全)
    const cap = player.alive ? player.capsule : null
    const touching = !!cap && rays.some((r) => segVsRect(r.x1, r.y1, r.x2, r.y2, cap) !== null)
    if (touching) this._lastSeenAt = now

    if (this.state === 'sweep') {
      this.rel += this._sweepDir * SWEEP_SPEED * dt
      if (this.rel >= this.relHi) { this.rel = this.relHi; this._sweepDir = -1 }
      else if (this.rel <= this.relLo) { this.rel = this.relLo; this._sweepDir = 1 }
      if (touching) {
        this.state = 'locked'
        this._lockAt = now
        this.burstLeft = 0
        Sfx.laserSnap()
        this.scene.tweens.add({ targets: this.lamp, scale: { from: 0.3, to: 0.14 }, duration: 260, ease: 'Cubic.Out' })
      }
    } else {
      if (now - this._lastSeenAt > MEMORY_MS) {
        this.state = 'sweep'
        this.burstLeft = 0
      } else if (player.alive) {
        // 追瞄(rel 空间连续逼近,扇区∩限位内截止)
        const wantW = Math.atan2((player.y - 44) - this.pivotY, player.x - this.pivotX)
        const wantRel = this.dir > 0
          ? Phaser.Math.Angle.Wrap(wantW)
          : Phaser.Math.Angle.Wrap(Math.PI - wantW)
        const target = Phaser.Math.Clamp(wantRel, this.relLo, this.relHi)
        const d = Phaser.Math.Clamp(target - this.rel, -TRACK_SPEED * dt, TRACK_SPEED * dt)
        this.rel += d
        const aimErr = Math.abs(Phaser.Math.Angle.Wrap(this._aimAngle() - wantW))
        // 前摇结束+对准+扇面真的罩着人才开火
        if (touching && now >= this._lockAt + LOCK_DELAY_MS && aimErr < 8 * DEG &&
            now >= this.nextFireAt && this.burstLeft === 0) {
          this.burstLeft = 5
          this.nextBurstShotAt = now
          this.nextFireAt = now + 1700
        }
        if (this.burstLeft > 0 && now >= this.nextBurstShotAt) {
          if (touching) {
            const a = this._aimAngle()
            fireFn(this.pivotX + Math.cos(a) * 42, this.pivotY + Math.sin(a) * 42, a)
          }
          this.burstLeft--
          this.nextBurstShotAt = now + 110
        }
      }
    }
    this.gun.setRotation(this._aimAngle())

    // —— 扇形扫描域渲染:半透明红色扇面(受墙截断的多边形)+两条边缘线+中轴亮线(锁定) ——
    const locked = this.state === 'locked'
    const fl = 0.9 + Math.random() * 0.1
    this.beamGfx.fillStyle(0xff2412, (locked ? 0.15 : 0.065) * fl)
    this.beamGfx.beginPath()
    this.beamGfx.moveTo(rays[0].x1, rays[0].y1)
    for (const r of rays) this.beamGfx.lineTo(r.x2, r.y2)
    this.beamGfx.closePath()
    this.beamGfx.fillPath()
    const e0 = rays[0], e1 = rays[rays.length - 1]
    this.beamGfx.lineStyle(1, 0xff4838, (locked ? 0.5 : 0.28) * fl)
    this.beamGfx.lineBetween(e0.x1, e0.y1, e0.x2, e0.y2)
    this.beamGfx.lineBetween(e1.x1, e1.y1, e1.x2, e1.y2)
    if (locked) {
      const mid = rays[(rays.length - 1) / 2]
      this.beamGfx.lineStyle(1.5, 0xffd0c8, 0.85 * fl).lineBetween(mid.x1, mid.y1, mid.x2, mid.y2)
    }
  }

  takeHit(dmg, dir, hitPoint, weapon) {
    if (!this.alive) return
    this.hp -= dmg
    if (this.hp > 0) return
    this.alive = false
    this.beamGfx.clear()
    this.base.setTint(0x555555)
    this.gun.setTint(0x555555)
    this.lamp.destroy()
    this.scene.fx.sparks(this.pivotX, this.pivotY, 16)
    this.scene.fx.debris(this.pivotX, this.pivotY, 5)
    this.scene.fx.flash(this.pivotX, this.pivotY)
    this.scene.tweens.add({ targets: this.gun, rotation: this._aimAngle() + (this.dir > 0 ? 0.6 : -0.6), duration: 500, ease: 'Bounce.Out' })
    Sfx.zap()
    Sfx.thud()
    EventBus.emit('turret:destroyed', this.spec)
  }

  setActive(v) { if (this.alive) this.active = v }

  powerDown() { // 封锁解除:存活炮塔断电垂头(扫描锥熄灭=奖励感)
    if (!this.alive) return
    this.active = false
    this.beamGfx.clear()
    this.lamp.destroy()
    this.base.setTint(0x8a8a8a)
    this.gun.setTint(0x8a8a8a)
    this.scene.tweens.add({ targets: this.gun, rotation: this._aimAngle() + (this.dir > 0 ? 0.5 : -0.5), duration: 700, ease: 'Cubic.Out' })
  }
}
