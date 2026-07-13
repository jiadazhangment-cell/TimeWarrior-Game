// 机器类人形敌人:巡逻 → 索敌 → 点射。运动学驱动(存活时无物理刚体)。
import Phaser from 'phaser'
import { CharacterRig } from './CharacterRig.js'
import { EventBus } from '../core/EventBus.js'
import enemiesCfg from '../../config/enemies.json'
import rigsCfg from '../../config/rigs.json'

export class Enemy {
  constructor(scene, spec) {
    this.scene = scene
    this.cfg = enemiesCfg[spec.type]
    this.spec = spec
    this.rig = new CharacterRig(scene, rigsCfg[this.cfg.rig])
    this.rig.setDepth(18)
    this.x = spec.x; this.y = spec.y
    this.vx = 0; this.vy = 0
    this.hp = this.cfg.hp
    this.alive = true
    this.state = 'patrol'
    this.dir = 1
    this.staggerUntil = 0
    this.nextFireAt = 0
    this.burstLeft = 0
    this.nextBurstShotAt = 0
    this.currentAim = 0
    this.distance = 0
  }

  get capsule() {
    const c = this.cfg.capsule
    return { x: this.x - c.w / 2, y: this.y - c.h, w: c.w, h: c.h }
  }

  update(dt, player, solids, hasLOS, fireFn) {
    if (!this.alive) return
    const now = this.scene.time.now
    const cfg = this.cfg
    const staggered = now < this.staggerUntil

    // 简易重力+落地(敌人只在地面/平台走)
    this.vy = Math.min(this.vy + this.scene.gravityY * dt, 1100)
    this.y += this.vy * dt
    for (const s of solids) {
      const c = this.capsule
      if (c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y) {
        if (this.vy > 0) { this.y = s.y; this.vy = 0 }
      }
    }

    // 状态:玩家进入警戒距离且有视线 → 战斗
    const dx = player.x - this.x
    const dist = Math.abs(dx)
    const engaged = player.alive && dist < (this.state === 'combat' ? cfg.loseAggroRange : cfg.aggroRange) && hasLOS
    this.state = engaged ? 'combat' : 'patrol'

    let moveDir = 0
    let targetAim
    if (this.state === 'patrol') {
      moveDir = this.dir
      if (this.x <= this.spec.patrolMinX) { this.dir = 1; moveDir = 1 }
      if (this.x >= this.spec.patrolMaxX) { this.dir = -1; moveDir = -1 }
      targetAim = this.dir > 0 ? 0 : Math.PI
    } else {
      // 保持距离
      if (dist > cfg.preferredDist + 40) moveDir = Math.sign(dx)
      else if (dist < cfg.preferredDist - 60) moveDir = -Math.sign(dx)
      moveDir = Phaser.Math.Clamp(this.x + moveDir * 10, this.spec.patrolMinX, this.spec.patrolMaxX) === this.x ? 0 : moveDir
      targetAim = Math.atan2((player.y - 60) - (this.y - 62), player.x - this.x)

      // 点射
      if (now >= this.nextFireAt && this.burstLeft === 0) {
        this.burstLeft = cfg.burst
        this.nextBurstShotAt = now
        this.nextFireAt = now + cfg.fireIntervalMs
      }
      if (this.burstLeft > 0 && now >= this.nextBurstShotAt && !staggered) {
        this.burstLeft--
        this.nextBurstShotAt = now + cfg.burstGapMs
        fireFn(this)
      }
    }
    if (staggered) moveDir = 0

    // 瞄准角以有限角速度趋近
    const turn = Phaser.Math.DegToRad(cfg.aimTurnDegPerSec) * dt
    this.currentAim = Phaser.Math.Angle.RotateTo(this.currentAim, targetAim, turn)

    this.vx = moveDir * cfg.moveSpeed
    this.x += this.vx * dt
    this.x = Phaser.Math.Clamp(this.x, this.spec.patrolMinX, this.spec.patrolMaxX)

    // 姿态
    this.distance += Math.abs(this.vx) * dt
    const moving = Math.abs(this.vx) > 5
    this.rig.gaitIntensity = Phaser.Math.Linear(this.rig.gaitIntensity, moving ? 0.8 : 0, Math.min(1, dt * 10))
    this.rig.gaitPhase = (this.distance / 150) * Math.PI * 2
    this.rig.facing = Math.cos(this.currentAim) >= 0 ? 1 : -1
    this.rig.aimAngle = this.currentAim
    this.rig.lean = 0
    this.rig.setPosition(this.x, this.y)
    this.rig.updatePose()
  }

  takeHit(dmg, dir, hitPoint, weapon) {
    if (!this.alive) return
    this.hp -= dmg
    this.staggerUntil = this.scene.time.now + this.cfg.hitStaggerMs
    this.rig.flash()
    if (this.hp <= 0) {
      this.alive = false
      EventBus.emit('enemy:died', {
        snapshot: this.rig.snapshotForGibs(),
        dir, hitPoint, weapon,
        x: this.x, y: this.y,
      })
      this.rig.destroy()
    }
  }
}
