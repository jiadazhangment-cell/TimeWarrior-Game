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
    this.gaitPhase = 0
    this.lastSeenAt = -1e9
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
    const prevY = this.y
    this.y += this.vy * dt
    for (const s of solids) {
      const c = this.capsule
      if (c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y) {
        if (this.vy > 0 && !(s.oneWay && prevY > s.y + 1)) { this.y = s.y; this.vy = 0 }
      }
    }

    // 状态:玩家进入警戒距离且有视线 → 战斗;失去视线后保留短暂记忆(掩体后不立即脱战)
    const dx = player.x - this.x
    const dist = Math.abs(dx)
    if (hasLOS && player.alive) this.lastSeenAt = now
    const remembered = now - this.lastSeenAt < cfg.aggroMemoryMs
    const engaged = player.alive && dist < (this.state === 'combat' ? cfg.loseAggroRange : cfg.aggroRange) && (hasLOS || (this.state === 'combat' && remembered))
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
      // 瞄准玩家当前命中框中心(下蹲时会跟着压低)
      const pc = player.capsule
      targetAim = Math.atan2((pc.y + pc.h * 0.45) - (this.y - 62), player.x - this.x)

      // 点射(只在有视线时开火,掩体后不透墙打)
      if (now >= this.nextFireAt && this.burstLeft === 0 && hasLOS) {
        this.burstLeft = cfg.burst
        this.nextBurstShotAt = now
        this.nextFireAt = now + cfg.fireIntervalMs
      }
      if (this.burstLeft > 0 && now >= this.nextBurstShotAt && !staggered) {
        if (hasLOS) fireFn(this)
        this.burstLeft--
        this.nextBurstShotAt = now + cfg.burstGapMs
      }
    }
    if (staggered) moveDir = 0

    // 瞄准角以有限角速度趋近
    const turn = Phaser.Math.DegToRad(cfg.aimTurnDegPerSec) * dt
    this.currentAim = Phaser.Math.Angle.RotateTo(this.currentAim, targetAim, turn)

    this.vx = moveDir * (this.state === 'combat' ? cfg.chaseSpeed : cfg.patrolSpeed)
    this.x += this.vx * dt
    // 水平碰撞:实体(掩体箱/墙)不可穿过;巡逻中被挡则折返
    for (const s of solids) {
      if (s.oneWay) continue
      const c = this.capsule
      if (c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y) {
        if (this.vx > 0) this.x = s.x - c.w / 2
        else if (this.vx < 0) this.x = s.x + s.w + c.w / 2
        this.vx = 0
        if (this.state === 'patrol') this.dir = -this.dir
      }
    }
    this.x = Phaser.Math.Clamp(this.x, this.spec.patrolMinX, this.spec.patrolMaxX)

    // 姿态:朝向先定,相位由带符号位移增量驱动(战斗后撤=倒退步)
    this.rig.facing = this.state === 'combat'
      ? (Math.cos(this.currentAim) >= 0 ? 1 : -1)
      : this.dir
    const vLocal = this.vx * this.rig.facing
    this.rig.runCycleLen = 192
    this.gaitPhase += (vLocal * dt / 192) * Math.PI * 2
    const moving = Math.abs(this.vx) > 5
    this.rig.gaitIntensity = Phaser.Math.Linear(this.rig.gaitIntensity, moving ? 0.8 : 0, Math.min(1, dt * 10))
    this.rig.gaitPhase = this.gaitPhase
    this.rig.moveSign = vLocal >= 0 ? 1 : -1
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
