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
    this.crouching = false
    this.crouchT = 0
    this.gaitPhase = 0
    this.jumpPendingUntil = 0
    this.coyoteUntil = 0
    this.hp = this.cfg.hp
    this.alive = true
    this.invulnUntil = 0
    this.lean = 0; this.leanVel = 0
    this.prevVx = 0
  }

  get capsule() {
    const c = this.cfg.capsule
    const h = this.crouching ? this.cfg.crouch.h : c.h
    return { x: this.x - c.w / 2, y: this.y - h, w: c.w, h }
  }

  // 站起前检查头顶净空(只考虑实体,单向平台可穿)
  _canStand(solids) {
    const c = this.cfg.capsule
    const cap = { x: this.x - c.w / 2, y: this.y - c.h, w: c.w, h: c.h }
    return !solids.some((s) => !s.oneWay &&
      cap.x < s.x + s.w && cap.x + cap.w > s.x && cap.y < s.y + s.h && cap.y + cap.h > s.y)
  }

  update(dt, input, solids) {
    if (!this.alive) return
    const cfg = this.cfg
    const now = this.scene.time.now

    // —— 下蹲(切换式):按 S 蹲下,再按 S 站起(头顶要有净空);空中不可进入 ——
    if (input.consumeCrouchToggle()) {
      if (this.crouching) { if (this._canStand(solids)) this.crouching = false }
      else if (this.grounded) this.crouching = true
    }

    // —— 水平:加速/滑行减速(惯性核心);下蹲时限速 ——
    const accel = this.grounded ? cfg.moveAccel : cfg.airAccel
    const decel = this.grounded ? cfg.groundDecel : cfg.airDecel
    const maxSp = cfg.maxSpeed * (this.crouching ? cfg.crouch.speedFactor : 1)
    if (input.moveX !== 0) {
      this.vx += input.moveX * accel * dt
      this.vx = Phaser.Math.Clamp(this.vx, -maxSp, maxSp)
    } else if (this.vx !== 0) {
      const drop = decel * dt
      this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop
    }

    // —— 跳跃:土狼时间 + 输入缓冲 + 松键截断 ——
    // 蹲姿按跳:先快速起身(视觉过渡),起身过半后自动起跳,不做瞬移式机械跳
    const canJump = this.grounded || now < this.coyoteUntil
    if (canJump && input.consumeJump(cfg.jumpBufferMs, now)) {
      if (this.crouching) {
        if (this._canStand(solids)) { this.crouching = false; this.jumpPendingUntil = now + 240 }
      } else {
        this._doJump(cfg)
      }
    }
    if (this.jumpPendingUntil > now && !this.crouching && this.crouchT < 0.45 && (this.grounded || now < this.coyoteUntil)) {
      this.jumpPendingUntil = 0
      this._doJump(cfg)
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

    // —— 步态与姿态:相位由带符号位移增量驱动(倒退自然反放);
    //    步频与地速换算对齐(腿摆幅≈每步 26px 触地行程),消除脚底打滑的机械感 ——
    const vLocal = this.vx * facing // 朝向空间速度:>0 前进,<0 倒退
    const cycleLen = Phaser.Math.Linear(cfg.runCycleLen, cfg.crouchCycleLen, this.crouchT)
    this.gaitPhase += (vLocal * dt / cycleLen) * Math.PI * 2
    const running = this.grounded && Math.abs(this.vx) > 24
    this.rig.gaitIntensity = Phaser.Math.Linear(this.rig.gaitIntensity, running ? 1 : 0, Math.min(1, dt * 12))
    this.rig.gaitPhase = this.gaitPhase
    this.rig.moveSign = vLocal >= 0 ? 1 : -1
    const bob = running ? Math.abs(Math.sin(this.gaitPhase)) : 0
    this.rig.hipBob = -bob * Phaser.Math.Linear(cfg.runBobAmp, 1.3, this.crouchT)
    this.crouchT = Phaser.Math.Linear(this.crouchT, this.crouching ? 1 : 0,
      Math.min(1, dt * (this.jumpPendingUntil > now ? 26 : 14)))
    this.rig.crouch = this.crouchT
    this.rig.facing = facing
    this.rig.aimAngle = Math.atan2(input.aimY - (this.y - 62 + this.crouchT * 24), input.aimX - this.x)
    this.rig.lean = this.lean
    this.rig.setPosition(this.x, this.y)
    this.rig.updatePose()
  }

  _doJump(cfg) {
    this.vy = -cfg.jumpVel
    this.grounded = false
    this.coyoteUntil = 0
    Sfx.jump()
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
