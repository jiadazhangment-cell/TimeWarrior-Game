// 壁挂机枪炮塔:基座(挂板+铰接臂)固定,枪体绕转轴跟瞄玩家(限速+扇区限制),LOS 内点射。
// 与 Enemy 鸭子类型兼容(alive/capsule/takeHit)以复用弹道命中;不产生 ragdoll——
// 死亡=爆花+熏黑+枪体垂头(留场残骸);封锁解除时未被击毁的炮塔断电垂头(奖励感)。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import { segVsRect } from '../systems/Ballistics.js'

const DEG = Math.PI / 180

export class Turret {
  constructor(scene, spec) { // spec: { x, y, dir(1朝右/-1朝左), sweepDeg?, range?, hp? }
    this.scene = scene
    this.spec = spec
    this.dir = spec.dir ?? 1
    this.hp = spec.hp ?? 40
    this.alive = true
    this.active = false // 封锁激活才工作
    this.aim = this.dir > 0 ? 0 : Math.PI
    this.nextFireAt = 0
    this.burstLeft = 0
    this.nextBurstShotAt = 0
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
  }

  get capsule() { return { x: this.pivotX - 16, y: this.pivotY - 14, w: 32, h: 28 } }

  _hasLOS(player, solids) {
    const x2 = player.x, y2 = player.y - 44
    for (const s of solids) {
      if (s.oneWay) continue // 镂空桁架层板不挡视线
      const t = segVsRect(this.pivotX, this.pivotY, x2, y2, s)
      if (t !== null && t > 0.001 && t < 0.999) return false
    }
    return true
  }

  update(dt, player, solids, fireFn) {
    if (!this.alive || !this.active || !player.alive) return
    const dx = player.x - this.pivotX
    const dy = (player.y - 44) - this.pivotY
    const want = Math.atan2(dy, dx)
    // 扇区限制:绕初始朝向 ±sweepDeg
    const home = this.dir > 0 ? 0 : Math.PI
    const sweep = (this.spec.sweepDeg ?? 80) * DEG
    const rel = Phaser.Math.Angle.Wrap(want - home)
    const target = home + Phaser.Math.Clamp(rel, -sweep, sweep)
    this.aim = Phaser.Math.Angle.RotateTo(this.aim, target, 150 * DEG * dt)
    this.gun.setRotation(this.aim)

    const now = this.scene.time.now
    const dist = Math.hypot(dx, dy)
    const los = dist < (this.spec.range ?? 640) && this._hasLOS(player, solids)
    const aimErr = Math.abs(Phaser.Math.Angle.Wrap(this.aim - want))
    if (los && aimErr < 8 * DEG && now >= this.nextFireAt && this.burstLeft === 0) {
      this.burstLeft = 5
      this.nextBurstShotAt = now
      this.nextFireAt = now + 1700
    }
    if (this.burstLeft > 0 && now >= this.nextBurstShotAt) {
      if (los) {
        const mx = this.pivotX + Math.cos(this.aim) * 42
        const my = this.pivotY + Math.sin(this.aim) * 42
        fireFn(mx, my, this.aim)
      }
      this.burstLeft--
      this.nextBurstShotAt = now + 110
    }
  }

  takeHit(dmg, dir, hitPoint, weapon) {
    if (!this.alive) return
    this.hp -= dmg
    if (this.hp > 0) return
    this.alive = false
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

  powerDown() { // 封锁解除:存活炮塔断电垂头
    if (!this.alive) return
    this.active = false
    this.lamp.destroy()
    this.base.setTint(0x8a8a8a)
    this.gun.setTint(0x8a8a8a)
    this.scene.tweens.add({ targets: this.gun, rotation: this.aim + (this.dir > 0 ? 0.5 : -0.5), duration: 700, ease: 'Cubic.Out' })
  }
}
