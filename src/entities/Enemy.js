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
    this.pauseUntil = 0   // 巡逻驻足到期时刻
    this.pauseLen = 0
    this.pendingTurn = 0  // 驻足结束后要转向的方向(0=不转)
    // 各机器人的途中驻足节拍随机错开,避免同场敌人动作同步
    this.nextIdleAt = scene.time.now + Phaser.Math.Between(2000, 6000)
  }

  // 巡逻驻足:停 range=[min,max] 毫秒;turnDir≠0 则驻足结束后转向该方向
  _hold(now, range, turnDir) {
    this.pauseLen = Phaser.Math.Between(range[0], range[1])
    this.pauseUntil = now + this.pauseLen
    this.pendingTurn = turnDir
    this.nextIdleAt = this.pauseUntil + Phaser.Math.Between(this.cfg.patrolIdleEveryMs[0], this.cfg.patrolIdleEveryMs[1])
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
      if (s.minor) continue // junk 小件不接机器人落地
      const c = this.capsule
      if (c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y) {
        // liftRoof 豁免与玩家同款:机器人(胶囊118)比厢顶下沿高,停靠厢的顶棚带扫过头顶
        // 不得把它吸附上厢顶;水平段自然把它当墙挡回(撞上电梯折返=真实行为)
        // 落地吸附 prevY 守卫(I0 三防①,2026-07-28 补全):普通实体同样只接"脚本来就在该面之上"——
        // 否则胶囊顶(高 118)捅进低矮天花板时会被吸到顶面上站着(管廊灰盒实测)
        if (this.vy > 0 && !(s.oneWay && prevY > s.y + 1) && !(s.liftRoof && prevY > s.y + 12) &&
            !(prevY > s.y + 12)) { this.y = s.y; this.vy = 0 }
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
    let faceDir = this.dir
    if (this.state === 'patrol') {
      // 巡逻=慢速踱步(patrolSpeed):端点驻足片刻再折返、途中偶尔停下——
      // 发现目标进 combat 才提速到 chaseSpeed(用户拍板:巡查要慢、可站着不动,发现才快)
      if (now < this.pauseUntil) {
        // 折返驻足过半时先转身面向即将巡逻的方向(哨兵张望感)
        if (this.pendingTurn && this.pauseUntil - now < this.pauseLen * 0.45) faceDir = this.pendingTurn
      } else {
        if (this.pendingTurn) { this.dir = this.pendingTurn; this.pendingTurn = 0; faceDir = this.dir }
        moveDir = this.dir
        const atEnd = (this.dir > 0 && this.x >= this.spec.patrolMaxX) || (this.dir < 0 && this.x <= this.spec.patrolMinX)
        if (atEnd) {
          this._hold(now, cfg.patrolEndPauseMs, -this.dir)
          moveDir = 0
        } else if (now >= this.nextIdleAt) {
          this._hold(now, cfg.patrolIdleMs, 0)
          moveDir = 0
        }
      }
      targetAim = faceDir > 0 ? 0 : Math.PI
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
    // 受击击退(weapons.json hitKnockback,2026-07-25 接通):瞬时速度叠加+指数衰减——
    // 霰弹把人打得踉跄、大炮直接掀飞的差异全靠它;AI 速度每帧重写,击退必须独立通道
    if (this._knockVx) {
      this.x += this._knockVx * dt
      this._knockVx *= Math.exp(-dt * 7)
      if (Math.abs(this._knockVx) < 4) this._knockVx = 0
    }
    this.x += this.vx * dt
    // 水平碰撞:实体(掩体箱/墙)不可穿过;巡逻中被挡则折返
    for (const s of solids) {
      if (s.oneWay || s.minor) continue // junk 小件不挡机器人走位
      const c = this.capsule
      if (c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y) {
        if (this.vx > 0) this.x = s.x - c.w / 2
        else if (this.vx < 0) this.x = s.x + s.w + c.w / 2
        this.vx = 0
        // 巡逻中被道具/墙挡住:同端点待遇——驻足片刻再折返
        if (this.state === 'patrol' && now >= this.pauseUntil) this._hold(now, cfg.patrolEndPauseMs, -this.dir)
      }
    }
    this.x = Phaser.Math.Clamp(this.x, this.spec.patrolMinX, this.spec.patrolMaxX)

    // 姿态:朝向先定,相位由带符号位移增量驱动(战斗后撤=倒退步)
    this.rig.facing = this.state === 'combat'
      ? (Math.cos(this.currentAim) >= 0 ? 1 : -1)
      : faceDir
    const vLocal = this.vx * this.rig.facing
    // 巡逻慢速(60)必须配短周期(104):占空比 D=2A/cycleLen 自动解出≈0.58=双支撑"行走";
    // 沿用跑步周期 208 会得到 D≈0.29 的飞行相,慢速下读作漂浮慢动作
    const cyc = vLocal < 0 ? 165 : (this.state === 'patrol' ? (cfg.patrolCycleLen ?? 208) : 208)
    this.rig.cycleLenNow = cyc
    this.gaitPhase += (vLocal * dt / cyc) * Math.PI * 2
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
    if (weapon?.hitKnockback) {
      // **同发击退合帐**(2026-07-26 审计确认的高危缺陷):霰弹 7 弹丸同帧各自 takeHit,
      // 旧版无上限累加=3 颗命中(390/585)就超过大炮单发(320/480),武器阶梯"大炮击退最强"被打破。
      // 40ms 窗口内累计击退 clamp 到该武器 hitKnockback×1.6:霰弹满中=208 仍强于步枪、弱于大炮 ✓;
      // 单发武器(窗口内只加一次)完全不受影响
      const now = this.scene.time.now
      if (now - (this._knockWinAt ?? -1e9) > 40) { this._knockWinAt = now; this._knockAcc = 0 }
      const add = Math.min(weapon.hitKnockback, weapon.hitKnockback * 1.6 - this._knockAcc)
      if (add > 0) {
        this._knockAcc += add
        this._knockVx = (this._knockVx ?? 0) + Math.sign(dir?.x ?? 1) * add
        // In2 反编译语法:子弹类命中竖直冲量 ×1.5="往上弹的打飞感"(PlayerBullet.as:156)。
        // 设计表复核后按 1.5 全额移植:步枪 105=微顿,霰弹 195=可见蹦起,大炮 480=整个掀飞
        this.vy -= add * 1.5
      }
    }
    // 敌人受击不做白闪(用户拍板 2026-07-14):命中反馈交给硬直+击退+火花;白闪仅保留给玩家自己(掉血警示)
    // R3 打击感:接触点施力的受击形体(In2 移植)——头部命中甩头、躯干命中晃身,随硬直一起读作"真挨了一下"
    if (this.hp > 0) {
      this.rig.hitJolt(Math.sign(dir?.x ?? 1) || 1,
        hitPoint && hitPoint.y < this.y - 88 ? 'head' : 'torso')
    }
    if (this.hp <= 0) {
      this.alive = false
      EventBus.emit('enemy:died', {
        snapshot: this.rig.snapshotForGibs(),
        dir, hitPoint, weapon,
        x: this.x, y: this.y,
        bio: !!this.cfg.bio, // 生物类(红线):不断肢,尸体消散为能量光点
      })
      this.rig.destroy()
    }
  }
}
