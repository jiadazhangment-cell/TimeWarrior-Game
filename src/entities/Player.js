// 玩家:运动学控制器(不挂物理刚体)。惯性手感的来源:
// 加速度 < 无穷(推键渐加速)、松键用较小的减速度滑行、
// 上身用弹簧-阻尼系统跟随速度/减速度产生前倾。
import Phaser from 'phaser'
import { CharacterRig } from './CharacterRig.js'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import playerCfg from '../../config/player.json'
import rigsCfg from '../../config/rigs.json'

const DEG = Math.PI / 180

export class Player {
  constructor(scene, x, y) {
    this.scene = scene
    this.cfg = playerCfg
    this.rig = new CharacterRig(scene, rigsCfg.player)
    this.rig.setDepth(20)
    this.x = x; this.y = y      // 脚底中心
    this.vx = 0; this.vy = 0
    this.grounded = false
    this.facing = 1
    this.coyoteUntil = 0
    this.hp = this.cfg.hp
    this.alive = true
    this.invulnUntil = 0
    this.lean = 0; this.leanVel = 0
    this.prevVx = 0
    this.distance = 0
  }

  get capsule() {
    const c = this.cfg.capsule
    return { x: this.x - c.w / 2, y: this.y - c.h, w: c.w, h: c.h }
  }

  update(dt, input, solids) {
    if (!this.alive) return
    const cfg = this.cfg
    const now = this.scene.time.now

    // —— 水平:加速/滑行减速(惯性核心) ——
    const accel = this.grounded ? cfg.moveAccel : cfg.airAccel
    const decel = this.grounded ? cfg.groundDecel : cfg.airDecel
    if (input.moveX !== 0) {
      this.vx += input.moveX * accel * dt
      this.vx = Phaser.Math.Clamp(this.vx, -cfg.maxSpeed, cfg.maxSpeed)
    } else if (this.vx !== 0) {
      const drop = decel * dt
      this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop
    }

    // —— 跳跃:土狼时间 + 输入缓冲 + 松键截断 ——
    const canJump = this.grounded || now < this.coyoteUntil
    if (canJump && input.consumeJump(cfg.jumpBufferMs, now)) {
      this.vy = -cfg.jumpVel
      this.grounded = false
      this.coyoteUntil = 0
      Sfx.jump()
    }
    if (!this.grounded && this.vy < 0 && !input.jumpHeld) {
      this.vy *= 1 - (1 - cfg.jumpCutFactor) * Math.min(1, dt * 22)
    }

    // —— 重力 ——
    this.vy = Math.min(this.vy + this.scene.gravityY * dt, cfg.maxFallSpeed)

    // —— 积分 + 碰撞解算(先 X 后 Y) ——
    const cap = this.cfg.capsule
    this.x += this.vx * dt
    for (const s of solids) {
      if (s.oneWay) continue // 单向平台不做水平阻挡
      if (!this._overlap(s)) continue
      if (this.vx > 0) this.x = s.x - cap.w / 2
      else if (this.vx < 0) this.x = s.x + s.w + cap.w / 2
      this.vx = 0
    }
    const wasGrounded = this.grounded
    this.grounded = false
    const prevY = this.y
    this.y += this.vy * dt
    for (const s of solids) {
      if (!this._overlap(s)) continue
      if (this.vy > 0) {
        // 单向平台:只接"本帧从上方落下"的,从中间/下方穿过时不拦
        if (s.oneWay && prevY > s.y + 1) continue
        this.y = s.y
        if (this.vy > 620) { Sfx.thud(); EventBus.emit('camera:shake', 0.004) }
        this.vy = 0
        this.grounded = true
      } else if (this.vy < 0) {
        if (s.oneWay) continue // 上升时可穿过单向平台
        this.y = s.y + s.h + cap.h
        this.vy = 0
      }
    }
    if (wasGrounded && !this.grounded) this.coyoteUntil = now + this.cfg.coyoteMs

    // —— 上身前倾:速度项 + 减速度项,弹簧-阻尼跟随 ——
    const ax = (this.vx - this.prevVx) / Math.max(dt, 1e-4)
    let target = this.vx * cfg.leanVelFactor * DEG - ax * cfg.leanAccelFactor * DEG * 0.06
    target = Phaser.Math.Clamp(target, -cfg.leanMaxDeg * DEG, cfg.leanMaxDeg * DEG)
    // 转到朝向空间(前倾=朝面对方向倾);12px 死区迟滞,防止近垂直瞄准时朝向逐帧抖动
    const dxAim = input.aimX - this.x
    const facing = Math.abs(dxAim) < 12 ? this.facing : (dxAim >= 0 ? 1 : -1)
    this.facing = facing
    const targetLocal = target * facing
    this.leanVel += (targetLocal - this.lean) * cfg.leanSpring * dt
    this.leanVel *= Math.exp(-cfg.leanDamp * dt)
    this.lean += this.leanVel * dt
    this.prevVx = this.vx

    // —— 步态与姿态 ——
    this.distance += Math.abs(this.vx) * dt
    const running = this.grounded && Math.abs(this.vx) > 24
    this.rig.gaitIntensity = Phaser.Math.Linear(this.rig.gaitIntensity, running ? 1 : 0, Math.min(1, dt * 12))
    this.rig.gaitPhase = (this.distance / cfg.runCycleLen) * Math.PI * 2
    this.rig.hipBob = running ? Math.abs(Math.sin(this.rig.gaitPhase)) * -cfg.runBobAmp : 0
    this.rig.facing = facing
    this.rig.aimAngle = Math.atan2(input.aimY - (this.y - 62), input.aimX - this.x)
    this.rig.lean = this.lean
    this.rig.setPosition(this.x, this.y)
    this.rig.updatePose()
  }

  _overlap(s) {
    const c = this.capsule
    return c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y
  }

  hurt(dmg, fromX) {
    const now = this.scene.time.now
    if (!this.alive || now < this.invulnUntil) return
    this.hp -= dmg
    this.invulnUntil = now + this.cfg.hurtInvulnMs
    this.vx += Math.sign(this.x - fromX) * 130
    this.rig.flash()
    Sfx.hurt()
    EventBus.emit('player:hurt', this.hp)
    EventBus.emit('camera:shake', 0.006)
    if (this.hp <= 0) this.die()
  }

  die() {
    if (!this.alive) return
    this.alive = false
    EventBus.emit('player:died', { snapshot: this.rig.snapshotForGibs() })
    this.rig.setVisible(false)
  }

  respawn(x, y) {
    this.x = x; this.y = y
    this.vx = 0; this.vy = 0
    this.hp = this.cfg.hp
    this.alive = true
    this.invulnUntil = this.scene.time.now + 1000
    this.rig.setVisible(true)
    EventBus.emit('player:hurt', this.hp)
  }
}
