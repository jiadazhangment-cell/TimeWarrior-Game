// 壁挂机枪炮塔:常驻哨戒装置(用户定版:不再是封锁战才上电的道具)。
// 红光视线设定(用户点名,参考《生化危机4》类哨戒视线):扫描态=一束红色视线沿扇区
// 往复扫掠,束被墙/层板截断=可视化的探测范围;玩家碰到红束=锁定(警报+短前摇)后点射;
// 丢失目标(掩体后/出程)保留短记忆,然后回到扫描。不碰红光=不会被发现。
// 与 Enemy 鸭子类型兼容(alive/capsule/takeHit);死亡=爆花+熏黑+垂枪残骸,不走 ragdoll。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import { segVsRect } from '../systems/Ballistics.js'

const DEG = Math.PI / 180
const SWEEP_SPEED = 32 * DEG // 扫描角速度(慢=可预判可穿越)
const TRACK_SPEED = 150 * DEG
const LOCK_DELAY_MS = 350 // 锁定到首发的前摇(公平预告:束变亮+警报)
const MEMORY_MS = 1200

export class Turret {
  constructor(scene, spec) { // spec: { x, y, dir(1朝右/-1朝左), sweepDeg?, pitchDeg?, range?, hp? }
    this.scene = scene
    this.spec = spec
    this.dir = spec.dir ?? 1
    this.hp = spec.hp ?? 40
    this.alive = true
    this.active = true // 常时上电(封锁解除时 powerDown 作奖励;被击毁永久失效)
    this.nextFireAt = 0
    this.burstLeft = 0
    this.nextBurstShotAt = 0
    // pitchDeg=扇区中心俯角(>0 朝下):挂得比守卫面高的炮塔必须把扇区压向脚下的走道
    const pitch = (spec.pitchDeg ?? 0) * DEG
    this.home = this.dir > 0 ? pitch : Math.PI - pitch
    this.sweep = (spec.sweepDeg ?? 75) * DEG
    this.aim = this.home
    this.state = 'sweep' // sweep(扫掠) | locked(锁定)
    this._sweepDir = 1
    this._lockAt = 0
    this._lastSeenAt = -1e9
    const f = this.dir
    // 挂板贴墙:朝右=板在左缘(origin 0),朝左镜像
    this.base = scene.add.image(spec.x, spec.y, 'dev_turret_base').setDepth(17)
    this.base.setFlipX(f < 0).setOrigin(f > 0 ? 0 : 1, 0.5)
    // 转轴=铰接臂末端转环(切件实测占比 x0.83 / y0.54)
    this.pivotX = spec.x + f * 35 * 0.83
    this.pivotY = spec.y + (0.54 - 0.5) * 46
    // 枪体:绕尾部转轴环旋转;朝左=真角度+flipY+原点 y 镜像(与骨架瞄准件同约定)
    this.gun = scene.add.image(this.pivotX, this.pivotY, 'dev_turret_gun').setDepth(18)
    this.gun.setFlipY(f < 0).setOrigin(0.08, f > 0 ? 0.42 : 0.58)
    this.gun.setRotation(this.aim)
    this.lamp = scene.add.image(this.pivotX, this.pivotY, 'px_glow').setTint(0xff3020)
      .setScale(0.14).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD).setDepth(18.1)
    // 视线束绘制层(每帧重画;ADD 发光)
    this.beamGfx = scene.add.graphics().setDepth(27).setBlendMode(Phaser.BlendModes.ADD)
  }

  get capsule() { return { x: this.pivotX - 16, y: this.pivotY - 14, w: 32, h: 28 } }

  // 视线束终点:沿 aim 方向被最近实体截断(与弹道同口径:层板 oneWay 也挡)
  _beamEnd(solids) {
    const range = this.spec.range ?? 640
    const dx = Math.cos(this.aim), dy = Math.sin(this.aim)
    const x1 = this.pivotX + dx * 40, y1 = this.pivotY + dy * 40
    const x2 = this.pivotX + dx * range, y2 = this.pivotY + dy * range
    let end = 1
    for (const s of solids) {
      const t = segVsRect(x1, y1, x2, y2, s)
      if (t !== null && t < end) end = t
    }
    return { x1, y1, x2: x1 + (x2 - x1) * end, y2: y1 + (y2 - y1) * end }
  }

  update(dt, player, solids, fireFn) {
    this.beamGfx.clear()
    if (!this.alive || !this.active) return
    const now = this.scene.time.now
    const beam = this._beamEnd(solids)
    // 红束触到玩家胶囊=发现(束已被墙截断,所以"墙后不可见"天然成立)
    const c = player.alive ? player.capsule : null
    const touching = c ? segVsRect(beam.x1, beam.y1, beam.x2, beam.y2, c) !== null : false
    if (touching) this._lastSeenAt = now

    if (this.state === 'sweep') {
      // 扇区往复扫掠
      const rel = Phaser.Math.Angle.Wrap(this.aim - this.home)
      this.aim = this.home + Phaser.Math.Clamp(rel + this._sweepDir * SWEEP_SPEED * dt, -this.sweep, this.sweep)
      if (Math.abs(Phaser.Math.Angle.Wrap(this.aim - this.home)) >= this.sweep - 0.01) this._sweepDir *= -1
      if (touching) { // 发现:锁定+警报+前摇
        this.state = 'locked'
        this._lockAt = now
        this.burstLeft = 0
        Sfx.laserSnap()
        this.scene.tweens.add({ targets: this.lamp, scale: { from: 0.3, to: 0.14 }, duration: 260, ease: 'Cubic.Out' })
      }
    } else {
      // 锁定:限速追瞄;丢失(束触不到人)超过记忆窗=回到扫描
      if (now - this._lastSeenAt > MEMORY_MS) {
        this.state = 'sweep'
        this.burstLeft = 0
      } else if (player.alive) {
        const want = Math.atan2((player.y - 44) - this.pivotY, player.x - this.pivotX)
        const relW = Phaser.Math.Angle.Wrap(want - this.home)
        const target = this.home + Phaser.Math.Clamp(relW, -this.sweep, this.sweep)
        this.aim = Phaser.Math.Angle.RotateTo(this.aim, target, TRACK_SPEED * dt)
        const aimErr = Math.abs(Phaser.Math.Angle.Wrap(this.aim - want))
        // 前摇结束+对准+束真的照在人身上才开火(束口径=弹道口径)
        if (touching && now >= this._lockAt + LOCK_DELAY_MS && aimErr < 8 * DEG &&
            now >= this.nextFireAt && this.burstLeft === 0) {
          this.burstLeft = 5
          this.nextBurstShotAt = now
          this.nextFireAt = now + 1700
        }
        if (this.burstLeft > 0 && now >= this.nextBurstShotAt) {
          if (touching) fireFn(beam.x1, beam.y1, this.aim)
          this.burstLeft--
          this.nextBurstShotAt = now + 110
        }
      }
    }
    this.gun.setRotation(this.aim)

    // —— 红光视线束(光效三要素:宽晕+亮核+端点,锁定态更亮更红) ——
    const locked = this.state === 'locked'
    const fl = 0.85 + Math.random() * 0.15
    this.beamGfx.lineStyle(locked ? 6 : 4, 0xff2412, (locked ? 0.2 : 0.1) * fl)
      .lineBetween(beam.x1, beam.y1, beam.x2, beam.y2)
    this.beamGfx.lineStyle(locked ? 2 : 1.2, 0xff4838, (locked ? 0.85 : 0.42) * fl)
      .lineBetween(beam.x1, beam.y1, beam.x2, beam.y2)
    if (locked) this.beamGfx.lineStyle(1, 0xffd0c8, 0.8 * fl).lineBetween(beam.x1, beam.y1, beam.x2, beam.y2)
    this.beamGfx.fillStyle(locked ? 0xffd0c8 : 0xff4838, 0.9).fillCircle(beam.x2, beam.y2, locked ? 2.4 : 1.6)
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
    this.scene.tweens.add({ targets: this.gun, rotation: this.aim + (this.dir > 0 ? 0.6 : -0.6), duration: 500, ease: 'Bounce.Out' })
    Sfx.zap()
    Sfx.thud()
    EventBus.emit('turret:destroyed', this.spec)
  }

  setActive(v) { if (this.alive) this.active = v }

  powerDown() { // 封锁解除:存活炮塔断电垂头(视线束熄灭=奖励感)
    if (!this.alive) return
    this.active = false
    this.beamGfx.clear()
    this.lamp.destroy()
    this.base.setTint(0x8a8a8a)
    this.gun.setTint(0x8a8a8a)
    this.scene.tweens.add({ targets: this.gun, rotation: this.aim + (this.dir > 0 ? 0.5 : -0.5), duration: 700, ease: 'Cubic.Out' })
  }
}
