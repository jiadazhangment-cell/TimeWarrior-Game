// 玩家:运动学控制器(不挂物理刚体)。惯性手感的来源:
// 加速度 < 无穷(推键渐加速)、松键用较小的减速度滑行、
// 上身用弹簧-阻尼系统跟随速度/减速度产生前倾。
import Phaser from 'phaser'
import { CharacterRig } from './CharacterRig.js'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import playerCfg from '../../config/player.json'
import rigsCfg from '../../config/rigs.json'
import gameCfg from '../../config/game.json'

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
    // 后退限速(0.5x):面朝方向与移动方向相反=专门的后退碎步动作(真实人后退远慢于前跑)
    const movingBack = input.moveX !== 0 && Math.sign(input.moveX) !== this.facing
    const maxSp = cfg.maxSpeed * (this.crouching ? cfg.crouch.speedFactor : (movingBack ? cfg.backSpeedFactor : 1))
    if (input.moveX !== 0) {
      this.vx += input.moveX * accel * dt
      this.vx = Phaser.Math.Clamp(this.vx, -maxSp, maxSp)
    } else if (this.vx !== 0) {
      const drop = decel * dt
      this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop
    }

    // —— 跳跃:土狼时间 + 输入缓冲 + 松键截断 ——
    // 用户定版规则:蹲姿+仍按住 S+脚下是层板 → 按 W = 穿层下落(蹲下再落下,落地站立);
    // 蹲姿+已松开 S(或平地) → 按 W = 起身跳(原逻辑)。
    const canJump = this.grounded || now < this.coyoteUntil
    if (canJump && input.consumeJump(cfg.jumpBufferMs, now)) {
      if (this.crouching && input.crouchHeld && this.groundSolid?.oneWay) {
        this.crouching = false
        this.dropThroughUntil = now + 280
        this.grounded = false
      } else if (this.crouching) {
        if (this._canStand(solids)) { this.crouching = false; this.jumpPendingUntil = now + 240 }
      } else if (this.grounded) {
        // 先屈腿再跳(用户拍板,人类/入侵者的蓄力相):85ms 预备下蹲后才蹬地起飞;土狼跳(已离地)不蓄力
        if (!this.jumpWindupUntil) this.jumpWindupUntil = now + cfg.jumpWindupMs
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
    const vyPreCollide = this.vy // 触地前落速=落地冲击强度

    // —— 积分 + 碰撞解算(先 X 后 Y) ——
    const cap = this.cfg.capsule
    this.x += this.vx * dt
    for (const s of solids) {
      if (s.oneWay) continue // 单向平台不做水平阻挡
      if (!this._overlap(s)) continue
      // 台阶助步:着地状态迈上 ≤17px 的矮落差(楼梯=一串矮实体),头顶有净空才上
      if (this.grounded && this.vy >= 0 && this.y - s.y > 0 && this.y - s.y <= 17) {
        const h = this.crouching ? this.cfg.crouch.h : cap.h
        const test = { x: this.x - cap.w / 2, y: s.y - h, w: cap.w, h }
        const blocked = solids.some((o) => o !== s && !o.oneWay &&
          test.x < o.x + o.w && test.x + test.w > o.x && test.y < o.y + o.h && test.y + test.h > o.y)
        if (!blocked) { this.y = s.y; continue }
      }
      if (this.vx > 0) this.x = s.x - cap.w / 2
      else if (this.vx < 0) this.x = s.x + s.w + cap.w / 2
      this.vx = 0
    }
    const wasGrounded = this.grounded
    this.grounded = false
    this.groundSolid = null
    const prevY = this.y
    this.y += this.vy * dt
    for (const s of solids) {
      if (!this._overlap(s)) continue
      if (this.vy > 0) {
        // 单向平台:只接"本帧从上方落下"的;穿层下落窗口内(dropThroughUntil)全部放行
        if (s.oneWay && (prevY > s.y + 1 || now < (this.dropThroughUntil ?? 0))) continue
        // 电梯厢顶:只接"从上方落下/厢顶上行到脚底整体接住"(prevY 贴近顶面);
        // 下行顶棚从站定者头顶掠过时不做落地吸附(否则=从下方被瞬移铲上厢顶)
        if (s.liftRoof && prevY > s.y + 12) continue
        this.y = s.y
        // 落地不震屏(用户拍板:玩家质量感不需要;震屏留给未来大体积BOSS落地),仅保留闷响
        if (this.vy > 620) Sfx.thud()
        this.vy = 0
        this.grounded = true
        this.groundSolid = s
      } else if (this.vy < 0) {
        if (s.oneWay) continue // 上升时可穿过单向平台
        this.y = s.y + s.h + cap.h
        this.vy = 0
      }
    }
    if (wasGrounded && !this.grounded) this.coyoteUntil = now + this.cfg.coyoteMs

    // —— 跳跃姿态层:腾空混合 + 落地压缩脉冲(冲击越大压得越深,约180ms弹性恢复) ——
    this.airT = Phaser.Math.Linear(this.airT ?? 0, this.grounded ? 0 : 1, Math.min(1, dt * 14))
    if (!wasGrounded && this.grounded) {
      const impact = Phaser.Math.Clamp((vyPreCollide - 250) / 700, 0, 1)
      if (impact > 0) this.landT = 0.45 + 0.55 * impact
    }
    this.landT = Math.max(0, (this.landT ?? 0) - dt * 5.5)
    // 起跳蓄力:窗口内把身体快速压进"蹲弹"深度(复用落地压缩的 IK 通道),到点瞬间蹬直起飞
    if (this.jumpWindupUntil) {
      if (now >= this.jumpWindupUntil) {
        this.jumpWindupUntil = 0
        this._doJump(cfg)
      } else {
        const wp = 1 - (this.jumpWindupUntil - now) / cfg.jumpWindupMs
        this.landT = Math.max(this.landT, 0.85 * Math.min(1, wp * 1.6))
      }
    }

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
    // 周期按方向取:前进大步(208)/后退碎步(70)——与骨架的占空比约束 D=2A/cycleLen 配套保证零滑步
    const standCycle = vLocal < 0 ? cfg.backCycleLen : cfg.runCycleLen
    const cycleLen = Phaser.Math.Linear(standCycle, cfg.crouchCycleLen, this.crouchT)
    this.gaitPhase += (vLocal * dt / cycleLen) * Math.PI * 2
    const running = this.grounded && Math.abs(this.vx) > 24
    // 混合减半(12→6):起步从站姿柔和过渡进跑姿,不再"瞬间进入全幅摆腿"的机器人式启动
    // 进入跑姿慢(dt·6 起步柔),退出快(dt·14 迅速落定)——停步时腿不再慢悠悠"融化"回站姿(用户点名别扭)
    this.rig.gaitIntensity = Phaser.Math.Linear(this.rig.gaitIntensity, running ? 1 : 0, Math.min(1, dt * (running ? 6 : 14)))
    this.rig.cycleLenNow = cycleLen
    this.rig.gaitPhase = this.gaitPhase
    this.rig.moveSign = vLocal >= 0 ? 1 : -1
    // 髋部起伏(cos2θ=每步一次):触地中段微压、飞行相最高——步频放慢后即"现实人跑步的轻微上下颠簸";蹲行保留原节律
    const bobRun = Math.cos(2 * this.gaitPhase) * cfg.runBobAmp * (vLocal < 0 ? 0.5 : 1)
    const bobCrouch = -Math.abs(Math.sin(this.gaitPhase)) * 1.3
    this.rig.hipBob = Phaser.Math.Linear(bobRun, bobCrouch, this.crouchT) * this.rig.gaitIntensity
    this.crouchT = Phaser.Math.Linear(this.crouchT, this.crouching ? 1 : 0,
      Math.min(1, dt * (this.jumpPendingUntil > now ? 26 : 14)))
    this.rig.crouch = this.crouchT
    this.rig.facing = facing
    this.rig.airT = this.airT
    this.rig.vyNorm = Phaser.Math.Clamp(this.vy / cfg.jumpVel, -1, 1)
    this.rig.landT = this.landT
    // 肩点=瞄准原点(母本v3实测:站立肩高68,下蹲随髋下沉25)
    this.rig.aimAngle = Math.atan2(input.aimY - (this.y - 68 + this.crouchT * 25), input.aimX - this.x)
    this.rig.lean = this.lean
    this.rig.setPosition(this.x, this.y)
    this.rig.updatePose()
  }

  _doJump(cfg) {
    this.vy = -cfg.jumpVel
    this.grounded = false
    this.coyoteUntil = 0
    this.landT = 0 // 蓄力压缩瞬间释放=蹬直(squash→stretch)
    Sfx.jump()
  }

  _overlap(s) {
    const c = this.capsule
    return c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y
  }

  hurt(dmg, fromX) {
    const now = this.scene.time.now
    if (!this.alive || now < this.invulnUntil) return
    // 无敌版(game.json godMode):保留受击反馈(击退/白闪/音效),血量不掉
    if (!gameCfg.godMode) this.hp -= dmg
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
