// 生物类近战敌人(生物A·无头胸眼,标准型):蛰伏巡逻 → 凝视蓄怒 → 压迫交战 → 低血暴走。
// AI 配方对标《入侵者2》狼/忍者/杀人鱼(docs/新内容调研/In2近战生物AI配方.md):
//   anger 蓄力发动 / 交战预算阀门(高速近战不无限贴脸的核心) / 500ms 前摇+一帧攻击盒(233ms 目标脱离即取消,
//   绕后有真实收益) / 受击无硬直+攻击霸体(靠不可打断制造压力、靠低血保证公平) / 转身=带迟滞死区的大动作。
// 与 In2 的两处刻意不同(见调研 §8):命中框≥视觉(我们偏袒玩家红线);咬走 player.hurt=吃无敌帧(4399 受众,不做无保护伤害)。
// 运动学驱动;死亡=ragdoll 不断肢+消散能量光点(内容红线,GibSystem dissolve)。
import Phaser from 'phaser'
import { CharacterRig } from './CharacterRig.js'
import { EventBus } from '../core/EventBus.js'
import { resolveXSweep } from '../systems/collide.js'
import enemiesCfg from '../../config/enemies.json'
import rigsCfg from '../../config/rigs.json'

export class BioEnemy {
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
    this.state = 'patrol'   // 对外语义(ThreatMarkers/封锁战读这个):patrol | combat
    this.mode = 'patrol'    // 内部:patrol | stalk(凝视蓄怒) | engage(交战)
    this.dir = 1
    this.gaitPhase = 0
    this.lastSeenAt = -1e9
    this.lastSeenX = spec.x
    this.anger = 0          // 蓄怒(秒):近距凝视累积、挨打/出手 +1,到阈值才发动
    this.engageBudget = 0   // 交战预算(秒):耗尽退回凝视重新蓄怒(In2 狼的战斗节拍)
    this.rage = false       // 低血暴走:永久交战不回退(不可逆)
    this.biteAt = -1e9      // 咬击前摇起始时刻(<now-很多 = 未在咬)
    this.biting = false
    this.biteHitDone = false
    this.biteCanceled = false
    this.nextBiteAt = scene.time.now + 800
    this.turnT = -1         // 转身大动作进度(<0 未在转)
    this._turnFlipped = false
    this._lungeVx = 0       // 咬瞬间的前扑速度脉冲(扑咬观感)
    this.pauseUntil = 0; this.pauseLen = 0; this.pendingTurn = 0
    this.nextIdleAt = scene.time.now + Phaser.Math.Between(2000, 6000)
    // 姿态平滑通道
    this._lean = 0.3; this._arm = 0.1
  }

  get capsule() {
    const c = this.cfg.capsule
    return { x: this.x - c.w / 2, y: this.y - c.h, w: c.w, h: c.h }
  }

  _hold(now, range, turnDir) {
    this.pauseLen = Phaser.Math.Between(range[0], range[1])
    this.pauseUntil = now + this.pauseLen
    this.pendingTurn = turnDir
    this.nextIdleAt = this.pauseUntil + Phaser.Math.Between(this.cfg.patrolIdleEveryMs[0], this.cfg.patrolIdleEveryMs[1])
  }

  // "能不能出手"集中成一个谓词(In2 杀人鱼手法),不散落在状态机分支里
  _canBite(now, player) {
    const cfg = this.cfg
    if (this.biting || this.turnT >= 0) return false
    if (now < this.nextBiteAt || !player.alive) return false
    const pc = player.capsule, c = this.capsule
    const dx = (pc.x + pc.w / 2) - this.x
    if (dx * this.dir < -10) return false                       // 目标在身后(转身大动作去处理)
    if (Math.abs(dx) > cfg.biteRange + 24) return false
    if (pc.y + pc.h < c.y - cfg.biteWindowUp) return false      // 太高够不着
    if (pc.y > c.y + c.h + cfg.biteWindowDown) return false     // 太低(掉层)
    return true
  }

  update(dt, player, solids, hasLOS) {
    if (!this.alive) return
    const now = this.scene.time.now
    const cfg = this.cfg

    // —— 重力+落地(与 Enemy 同款;liftRoof/oneWay 语义一致) ——
    this.vy = Math.min(this.vy + this.scene.gravityY * dt, 1100)
    const prevY = this.y
    this.y += this.vy * dt
    for (const s of solids) {
      if (s.minor) continue
      const c = this.capsule
      if (c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y) {
        // 落地吸附 prevY 守卫(I0 三防①,与 Enemy/Player 同口径)
        if (this.vy > 0 && !(s.oneWay && prevY > s.y + 1) && !(s.liftRoof && prevY > s.y + 12) &&
            !(prevY > s.y + 12)) { this.y = s.y; this.vy = 0 }
      }
    }

    // —— 索敌与三态(In2 狼:蛰伏凝视→交战→暴走;挨打强制索敌在 takeHit) ——
    const seen = hasLOS && player.alive
    if (seen) { this.lastSeenAt = now; this.lastSeenX = player.x }
    const remembered = now - this.lastSeenAt < cfg.aggroMemoryMs
    const dist = Math.abs(player.x - this.x)
    if (this.mode === 'patrol') {
      if (seen && dist < cfg.aggroRange) { this.mode = 'stalk'; this.anger = 0 }
    } else if (this.mode === 'stalk') {
      if (!remembered || dist > cfg.loseAggroRange) { this.mode = 'patrol' }
      else {
        // 近距凝视蓄怒,拉开距离会冷却;打它/它出手各 +1(takeHit / 咬结算处)
        if (dist < cfg.angerNear) this.anger += dt
        else this.anger = Math.max(0, this.anger - dt)
        if (this.anger >= cfg.angerThresholdS) {
          this.mode = 'engage'
          this.engageBudget = Phaser.Math.FloatBetween(cfg.engageBudgetS[0], cfg.engageBudgetS[1])
        }
      }
    } else {
      this.engageBudget -= dt
      if (!this.rage && (this.engageBudget <= 0 || !remembered || dist > cfg.loseAggroRange)) {
        this.mode = remembered ? 'stalk' : 'patrol'
        this.anger = 0
      }
    }
    this.state = this.mode === 'patrol' ? 'patrol' : 'combat'

    // —— 期望朝向与移动 ——
    let moveDir = 0
    let wantDir = this.dir
    if (this.mode === 'patrol') {
      if (now < this.pauseUntil) {
        if (this.pendingTurn && this.pauseUntil - now < this.pauseLen * 0.45) wantDir = this.pendingTurn
      } else {
        if (this.pendingTurn) { this.dir = this.pendingTurn; this.pendingTurn = 0; wantDir = this.dir }
        moveDir = this.dir
        const atEnd = (this.dir > 0 && this.x >= this.spec.patrolMaxX) || (this.dir < 0 && this.x <= this.spec.patrolMinX)
        if (atEnd) { this._hold(now, cfg.patrolEndPauseMs, -this.dir); moveDir = 0 }
        else if (now >= this.nextIdleAt) { this._hold(now, cfg.patrolIdleMs, 0); moveDir = 0 }
      }
    } else {
      // 朝目标(丢视线朝最后已知位置);20px 迟滞死区防贴脸抖动(In2 转身死区同款)
      const tx = seen ? player.x : this.lastSeenX
      const dxT = tx - this.x
      if (dxT * this.dir < -cfg.turnDeadzone) wantDir = -this.dir
      if (this.mode === 'stalk') {
        // 凝视:远了缓慢压近,近了站定盯着(压迫前奏,给玩家读)
        moveDir = Math.abs(dxT) > cfg.stalkStandoff ? Math.sign(dxT) : 0
      } else {
        moveDir = Math.abs(dxT) > cfg.meleeStandoff ? Math.sign(dxT) : 0
      }
    }

    // —— 转身=大动作(In2 必抄):中点翻面,转身期禁咬禁移动 ——
    if (wantDir !== this.dir && this.turnT < 0 && !this.biting) { this.turnT = 0; this._turnFlipped = false }
    if (this.turnT >= 0) {
      this.turnT += dt * 1000 / cfg.turnMs
      moveDir = 0
      if (this.turnT >= 0.5 && !this._turnFlipped) { this.dir = -this.dir; this._turnFlipped = true }
      if (this.turnT >= 1) this.turnT = -1
    }

    // —— 咬击(狼配方:前摇→一帧攻击盒;233ms 目标脱离即取消) ——
    if (!this.biting && this.mode === 'engage' && this._canBite(now, player)) {
      this.biting = true
      this.biteAt = now
      this.biteHitDone = false
      this.biteCanceled = false
    }
    if (this.biting) {
      moveDir = 0
      const el = now - this.biteAt
      if (!this.biteCanceled && el >= cfg.biteCancelMs && el < cfg.biteWindupMs &&
          (player.x - this.x) * this.dir < -10) {
        // 目标已绕到身后:取消攻击(玩家绕后/位移有真实收益)
        this.biting = false
        this.nextBiteAt = now + 600
      } else if (el >= cfg.biteWindupMs) {
        if (!this.biteHitDone) {
          this.biteHitDone = true
          this._lungeVx = this.dir * cfg.lungeSpeed // 前扑脉冲(扑咬观感)
          this.anger += 1
          this.engageBudget -= cfg.biteCostS
          // 一帧攻击盒:自前缘伸出 biteRange 的矩形 vs 玩家胶囊
          const c = this.capsule, pc = player.capsule
          const bx = this.dir > 0 ? c.x + c.w - 10 : c.x - cfg.biteRange
          const box = { x: bx, y: c.y - 30, w: cfg.biteRange + 10, h: c.h + 30 + 20 }
          if (pc.x < box.x + box.w && pc.x + pc.w > box.x && pc.y < box.y + box.h && pc.y + pc.h > box.y) {
            player.hurt(cfg.biteDamage, this.x, pc.y + pc.h * 0.4)
          }
        }
        if (el >= cfg.biteWindupMs + 260) { // 收招
          this.biting = false
          this.nextBiteAt = now + Phaser.Math.Between(cfg.biteCdMs[0], cfg.biteCdMs[1])
        }
      }
    }

    // —— 水平移动+碰撞(交战不受巡逻区 clamp:能追出巡逻带,由墙/门洞自然限制) ——
    const speed = this.mode === 'engage' ? cfg.chaseSpeed : (this.mode === 'stalk' ? cfg.stalkSpeed : cfg.patrolSpeed)
    this.vx = moveDir * speed
    // preX = 本帧一切横向位移之前(击退/前扑/vx 三条通道都在其后)——三判据靠它定进入侧,
    // 不看速度符号:旧代码 `vx>0 || _lungeVx>0` 那套在深重叠时会把它弹到实体另一侧(bug-confirmed #0)
    const preX = this.x
    if (this._knockVx) {
      this.x += this._knockVx * dt
      this._knockVx *= Math.exp(-dt * 7)
      if (Math.abs(this._knockVx) < 4) this._knockVx = 0
    }
    if (this._lungeVx) {
      this.x += this._lungeVx * dt
      this._lungeVx *= Math.exp(-dt * 6)
      if (Math.abs(this._lungeVx) < 6) this._lungeVx = 0
    }
    this.x += this.vx * dt
    // 巡逻带钳位跑在碰撞解算【之前】(bug-confirmed #1;交战态本就不钳=能追出巡逻带)
    if (this.mode === 'patrol') this.x = Phaser.Math.Clamp(this.x, this.spec.patrolMinX, this.spec.patrolMaxX)
    resolveXSweep(this, solids, preX, {
      capW: cfg.capsule.w,
      onBlocked: () => {
        this._lungeVx = 0 // 撞墙即掐断前扑脉冲(扑咬撞上掩体不该继续蹭)
        if (this.mode === 'patrol' && now >= this.pauseUntil) this._hold(now, cfg.patrolEndPauseMs, -this.dir)
      },
    })

    // —— 姿态:三剪影(蛰伏=深前倾拖臂 / 凝视=立起张臂 / 交战=压低疾冲)+咬=后坐蓄力→前扑挥爪 ——
    let leanT = 0.32, armT = 0.12
    if (this.mode === 'stalk') { leanT = 0.18; armT = -0.3 }
    else if (this.mode === 'engage') { leanT = 0.46; armT = 0.26 }
    if (this.biting) {
      const t = Math.min(1, (now - this.biteAt) / (cfg.biteWindupMs + 260))
      const wEnd = cfg.biteWindupMs / (cfg.biteWindupMs + 260)
      if (t < wEnd) { const u = t / wEnd; leanT = 0.3 - 0.24 * u; armT = 0.1 - 0.9 * u }  // 后坐蓄力,臂后摆过肩
      else { const u = (t - wEnd) / (1 - wEnd); leanT = 0.06 + 0.6 * u; armT = -0.8 + 2.2 * u } // 前扑挥爪
    }
    const k = Math.min(1, dt * (this.biting ? 22 : 9)) // 咬的姿态切换要脆
    this._lean += (leanT - this._lean) * k
    this._arm += (armT - this._arm) * k

    this.rig.facing = this.dir
    const vLocal = this.vx * this.dir
    const cyc = this.mode === 'patrol' ? (cfg.patrolCycleLen ?? 104) : (cfg.chaseCycleLen ?? 185)
    this.rig.cycleLenNow = cyc
    this.gaitPhase += (Math.abs(vLocal) * dt / cyc) * Math.PI * 2 * Math.sign(vLocal || 1)
    const moving = Math.abs(this.vx) > 5
    this.rig.gaitIntensity = Phaser.Math.Linear(this.rig.gaitIntensity, moving ? 0.85 : 0, Math.min(1, dt * 10))
    this.rig.gaitPhase = this.gaitPhase
    this.rig.moveSign = 1 // 生物永远面朝移动方向(不后撤步)
    this.rig.aimAngle = this.dir > 0 ? 0 : Math.PI
    this.rig.lean = this._lean

    // 转身动作:压低+短促(中点翻面前后各一半)
    if (this.turnT >= 0) this.rig.lean = this._lean + Math.sin(this.turnT * Math.PI) * 0.18

    // 臂(非瞄准摆动件,updatePose 不管,这里直接驱动 localAngle;朝向翻转由 FK 的 *f 处理):
    // 基角抵消躯干前倾=爪臂重力下垂,叠步态小摆;arm_b 跟随略滞后、幅度略小(纵深感)
    const P = this.rig.parts
    const armBase = -this.rig.lean + this._arm
    const armSwing = Math.sin(this.gaitPhase + Math.PI) * 0.1 * this.rig.gaitIntensity
    if (P.arm_upper) P.arm_upper.localAngle = armBase + armSwing
    if (P.arm_claw) P.arm_claw.localAngle = this._arm * 0.4 + armSwing * 0.5
    if (P.arm_b) P.arm_b.localAngle = (armBase + armSwing * 0.7) * 0.85
    // 尾:常态慢摆+移动拖尾;凝视时竖起(威胁信号)。
    // 基角完全抵消躯干前倾(-lean)再微翘 0.08:尾保持"向后拖"的世界角,不随躯干扎向地面
    if (P.tail) {
      const stalkLift = this.mode === 'stalk' ? -0.22 : 0
      P.tail.localAngle = Math.sin(now / 240) * 0.06 + stalkLift - vLocal * 0.00035 - this.rig.lean - 0.08
    }

    this.rig.setPosition(this.x, this.y)
    this.rig.updatePose()
  }

  takeHit(dmg, dir, hitPoint, weapon) {
    if (!this.alive) return
    this.hp -= dmg
    // 无硬直+攻击霸体(In2 狼配方):不打断咬击/移动;反馈=形体冲击+击退通道。
    // 高速低血怪靠不可打断制造压力,靠低血保证公平——给了硬直它就是"贴脸即被打回去的免费经验"
    if (weapon?.hitKnockback) {
      const now = this.scene.time.now
      if (now - (this._knockWinAt ?? -1e9) > 40) { this._knockWinAt = now; this._knockAcc = 0 }
      const add = Math.min(weapon.hitKnockback, weapon.hitKnockback * 1.6 - this._knockAcc)
      if (add > 0) {
        this._knockAcc += add
        this._knockVx = (this._knockVx ?? 0) + Math.sign(dir?.x ?? 1) * add
        this.vy -= add * 1.5
      }
    }
    // 挨打=强制索敌+蓄怒(背后开黑枪照样拉仇恨)
    this.anger += 1
    this.lastSeenAt = this.scene.time.now
    this.lastSeenX = this.scene.player?.x ?? this.x
    if (this.mode === 'patrol') this.mode = 'stalk'
    // 低血暴走(不可逆;In2:低血不逃跑反而更凶——fear 是它试过又弃用的死代码)
    if (!this.rage && this.hp > 0 && this.hp <= this.cfg.hp * this.cfg.rageHpFrac) {
      this.rage = true
      this.mode = 'engage'
      this.engageBudget = 1e9
    }
    if (this.hp > 0) {
      this.rig.hitJolt(Math.sign(dir?.x ?? 1) || 1,
        hitPoint && hitPoint.y < this.y - this.cfg.capsule.h * 0.72 ? 'head' : 'torso')
    }
    if (this.hp <= 0) {
      this.alive = false
      EventBus.emit('enemy:died', {
        snapshot: this.rig.snapshotForGibs(),
        dir, hitPoint, weapon,
        x: this.x, y: this.y,
        bio: true, // 红线:不断肢,尸体消散为能量光点
      })
      this.rig.destroy()
    }
  }
}
