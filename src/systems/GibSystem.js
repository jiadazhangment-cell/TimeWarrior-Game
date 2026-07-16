// 断肢/尸体系统:角色死亡时把部件快照转成 Matter 刚体+关节(ragdoll);
// 概率断开关节=断肢,断口电火花+零件飞溅;尸体留场,可被继续射击("鞭尸")。
// 机器类可断肢,生物类与玩家只 ragdoll 不断肢。
import Phaser from 'phaser'
import { Sfx } from '../core/Sfx.js'
import gibsCfg from '../../config/gibs.json'

const M = Phaser.Physics.Matter.Matter
const LIMB_WEIGHTS = [
  ['head', 3], ['armgun', 3], ['arm_upper', 3], ['arm_aim', 3], ['arm_back', 3],
  ['shin_f', 2], ['shin_b', 2], ['thigh_f', 1], ['thigh_b', 1],
]

export class GibSystem {
  constructor(scene, fx) {
    this.scene = scene
    this.fx = fx // { sparks(x,y,n), debris(x,y,n), flash(x,y) }
    this.corpses = [] // { parts: Map<name,{spr,joint}>, dismemberable }
  }

  // 快照 → ragdoll。opts: { impulse:{x,y}, dismemberable, killWeapon, hitPoint }
  spawnRagdoll(snapshot, opts) {
    const cfg = gibsCfg
    const corpse = { parts: new Map(), dismemberable: !!opts.dismemberable, bornAt: this.scene.time.now }
    const group = M.Body.nextGroup(true) // 每具尸体独立负组:自身部件互不碰撞,不同尸体之间正常碰撞

    for (const p of snapshot) {
      // 部件中心的世界坐标(快照给的是枢轴点)
      let cx = p.w / 2 - p.pivot[0]
      let cy = p.h / 2 - p.pivot[1]
      if (p.flipX) cx = -cx
      if (p.flipY) cy = -cy
      const cos = Math.cos(p.angle), sin = Math.sin(p.angle)
      const wx = p.x + cx * cos - cy * sin
      const wy = p.y + cx * sin + cy * cos

      // 金属零件落地配方(修"断肢零件抽搐",2026-07-14):低弹(0.03,金属闷落不弹跳)+高摩擦(0.85/静1.2)
      // +稍高空气阻尼——能量尽快耗散;sleepThreshold 32=安静半秒即入睡
      const spr = this.scene.matter.add.sprite(wx, wy, p.tex, null, {
        shape: { type: 'rectangle', width: Math.max(8, p.w * 0.82), height: Math.max(8, p.h * 0.82) },
        restitution: 0.03, friction: 0.85, frictionStatic: 1.2, frictionAir: 0.02,
        collisionFilter: { group },
        sleepThreshold: 32,
      })
      spr.setScale(0.5)
      spr.setRotation(p.angle)
      spr.setFlipX(p.flipX); spr.setFlipY(p.flipY)
      spr.setDepth(14 + (p.z ?? 0) * 0.1)
      spr.body.gibMeta = { corpse, name: p.name }
      corpse.parts.set(p.name, { spr, joint: null, def: p })
    }

    // 按父子关系建关节(锚点=子部件的枢轴世界点)
    for (const p of snapshot) {
      if (!p.parent) continue
      const child = corpse.parts.get(p.name)
      const parent = corpse.parts.get(p.parent)
      if (!child || !parent) continue
      const pointA = this._worldToBodyLocal(parent.spr.body, p.x, p.y)
      const pointB = this._worldToBodyLocal(child.spr.body, p.x, p.y)
      // 关节软化+重阻尼(0.7/0.08→0.42/0.28):stiff 约束链躺地时被求解器反复修正=尸块抽搐的主因,
      // 阻尼把振荡能量吃掉,链条落地即瘫软停住;飞行中 0.42 仍足以让尸体保持连体
      child.joint = this.scene.matter.add.constraint(parent.spr.body, child.spr.body, 1, 0.42, {
        pointA, pointB, damping: 0.28,
      })
    }

    // 死亡冲量(带一点随机旋转)
    for (const [, part] of corpse.parts) {
      const imp = cfg.ragdollImpulseOnDeath
      part.spr.setVelocity((opts.impulse?.x ?? 0) * imp + Phaser.Math.FloatBetween(-0.6, 0.6),
        (opts.impulse?.y ?? 0) * imp - Phaser.Math.FloatBetween(0.8, 2.2))
      part.spr.setAngularVelocity(Phaser.Math.FloatBetween(-0.12, 0.12))
    }

    this.corpses.push(corpse)

    // 击杀时的概率断肢(机器类专属)
    if (corpse.dismemberable && opts.killWeapon) {
      if (Math.random() < opts.killWeapon.dismemberChanceOnKill) {
        this._dismemberRandom(corpse, opts.impulse, opts.killWeapon)
      }
    }

    this._enforceCaps()
    return corpse
  }

  // 子弹打中尸体部件:冲量 + 概率补断
  hitGibBody(body, point, dir, weapon) {
    const meta = body.gibMeta
    if (!meta) return
    M.Sleeping.set(body, false)
    M.Body.applyForce(body, point, { x: dir.x * weapon.corpseImpulse, y: dir.y * weapon.corpseImpulse - 0.004 })
    this.fx.sparks(point.x, point.y, gibsCfg.sparkBurst.countOnCorpseHit)
    Sfx.hitMetal()
    const corpse = meta.corpse
    if (corpse.dismemberable && Math.random() < weapon.dismemberChanceCorpse) {
      const part = corpse.parts.get(meta.name)
      if (part && part.joint) this.dismember(corpse, meta.name, dir, weapon)
      else this._dismemberRandom(corpse, dir, weapon) // 该部件已断,随机再断别处
    }
  }

  dismember(corpse, partName, dir, weapon) {
    const part = corpse.parts.get(partName)
    if (!part || !part.joint) return false
    // 断口位置=关节当前世界坐标
    const j = part.joint
    const a = M.Constraint.pointAWorld(j)
    this.scene.matter.world.removeConstraint(j)
    part.joint = null

    // 电火花:瞬间爆一波 + 断口残留几串
    this.fx.sparks(a.x, a.y, gibsCfg.sparkBurst.countOnDismember)
    this.fx.debris(a.x, a.y, Phaser.Math.Between(...gibsCfg.debrisCount))
    this.fx.flash(a.x, a.y)
    const spr = part.spr
    for (let i = 1; i <= 3; i++) {
      this.scene.time.delayedCall(i * (gibsCfg.stumpSparkMs / 3), () => {
        if (spr.active) this.fx.sparks(spr.x, spr.y, 3)
      })
    }
    Sfx.zap()

    // 断掉的部件飞出去
    const g = weapon?.gibImpulse ?? 6
    part.spr.setVelocity((dir?.x ?? 0) * g + Phaser.Math.FloatBetween(-1.5, 1.5), -Math.abs(g) * 0.7)
    part.spr.setAngularVelocity(Phaser.Math.FloatBetween(-0.3, 0.3))
    return true
  }

  _dismemberRandom(corpse, dir, weapon) {
    const candidates = LIMB_WEIGHTS.filter(([n]) => {
      const p = corpse.parts.get(n)
      return p && p.joint
    })
    if (!candidates.length) return
    const total = candidates.reduce((s, [, w]) => s + w, 0)
    let r = Math.random() * total
    for (const [name, w] of candidates) {
      r -= w
      if (r <= 0) { this.dismember(corpse, name, dir, weapon); return }
    }
  }

  // Matter 的 Constraint 在创建时记录 body 当前角度(angleA/angleB),
  // 求解时只按"角度增量"旋转锚点——所以这里必须传创建时刻的原始世界偏移量,
  // 预先反旋转到零角局部系反而会把锚点放错,导致 ragdoll 创建瞬间被求解器甩飞
  _worldToBodyLocal(body, wx, wy) {
    return { x: wx - body.position.x, y: wy - body.position.y }
  }

  getBodies() {
    const arr = []
    for (const corpse of this.corpses) {
      for (const [, part] of corpse.parts) if (part.spr.active && part.spr.body) arr.push(part.spr.body)
    }
    return arr
  }

  // 每帧安定检查(修"倒地后肢体抽搐"):堆叠尸体的 resting-contact 会让速度在 0.01↔0.4 间
  // 往复振荡(求解器不断注入能量),单靠阈值计数永远等不到入睡窗口——
  // 解法=低速段主动阻尼(每帧吃掉 30% 速度,掐断振荡回授),短暂稳定即强制入睡
  update() {
    for (const b of this.getBodies()) {
      if (b.isSleeping) { b._stillFrames = 0; continue }
      if (b.speed < 0.45 && b.angularSpeed < 0.09) {
        M.Body.setVelocity(b, { x: b.velocity.x * 0.5, y: b.velocity.y * 0.5 })
        M.Body.setAngularVelocity(b, b.angularVelocity * 0.5)
        b._stillFrames = (b._stillFrames ?? 0) + 1
        if (b._stillFrames > 12) {
          // 入睡前清零速度:即使被邻居碰撞级联吵醒,也是零能量醒来,立刻再次入睡
          M.Body.setVelocity(b, { x: 0, y: 0 })
          M.Body.setAngularVelocity(b, 0)
          M.Sleeping.set(b, true)
        }
      } else {
        b._stillFrames = 0
      }
    }
  }

  _enforceCaps() {
    while (this.corpses.length > gibsCfg.maxRagdolls) this._fadeCorpse(this.corpses.shift())
    let total = 0
    for (const c of this.corpses) total += c.parts.size
    while (total > gibsCfg.maxTotalBodies && this.corpses.length > 1) {
      const c = this.corpses.shift()
      total -= c.parts.size
      this._fadeCorpse(c)
    }
  }

  _fadeCorpse(corpse) {
    for (const [, part] of corpse.parts) {
      if (part.joint) { this.scene.matter.world.removeConstraint(part.joint); part.joint = null }
      const spr = part.spr
      this.scene.tweens.add({
        targets: spr, alpha: 0, duration: 600,
        onComplete: () => spr.destroy(),
      })
    }
  }

  clearAll() {
    for (const c of this.corpses.splice(0)) this._fadeCorpse(c)
  }

  removeCorpse(corpse) {
    const i = this.corpses.indexOf(corpse)
    if (i >= 0) this.corpses.splice(i, 1)
    this._fadeCorpse(corpse)
  }
}
