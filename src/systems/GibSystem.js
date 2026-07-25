// 断肢/尸体系统:角色死亡时把部件快照转成 Matter 刚体+关节(ragdoll);
// 概率断开关节=断肢,断口电火花+零件飞溅;尸体留场,可被继续射击("鞭尸")。
// 机器类可断肢,生物类与玩家只 ragdoll 不断肢。
import Phaser from 'phaser'
import { Sfx } from '../core/Sfx.js'
import gibsCfg from '../../config/gibs.json'

const M = Phaser.Physics.Matter.Matter
// 位移窗口烘焙的两级窗口(2026-07-24 定版,见 _bakeIfPinned):
// ①1s / 2.5px:原地高频振动(部件被结构卡住,求解器每帧注能)②3s / 12px:最后兜底,原地耗着就别耗了
// tol 是"窗口内相对参考位形的最大偏移";角度按 26px/rad 折算。实测被卡住的肩甲振幅≈0.096rad(≈2.5px当量),
// 容差取 4 才罩得住(取 2.5 会卡在边界,拖到第二级窗口才烤=用户仍能看见几秒抽搐)
const BAKE_WINDOWS = [
  { ref: '_r1', cnt: '_c1', tol: 4, frames: 54 },
  { ref: '_r2', cnt: '_c2', tol: 12, frames: 150 },
]
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
    const corpse = { parts: new Map(), dismemberable: !!opts.dismemberable,
      bornAt: this.scene.time.now, _activeSince: this.scene.time.now }
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

  // 子弹打中尸体部件:冲量 + 概率补断(冻结的尸体先解冻恢复物理)
  hitGibBody(body, point, dir, weapon) {
    const meta = body.gibMeta
    if (!meta) return
    if (meta.corpse.frozen) this.unfreeze(meta.corpse)
    meta.corpse._activeSince = this.scene.time.now // 打没冻结的尸体也要续命,别被兜底当场烤住
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
    if (corpse.frozen) this.unfreeze(corpse) // 断肢部件要飞出去,先恢复动力学
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

  // 每帧安定检查(修"倒地后肢体抽搐",终极方案=原设计的"静止后烘焙"):
  // 堆叠尸体的 resting-contact 振荡+碰撞级联唤醒靠入睡机制压不干净——
  // 整具尸体全部件低速持续 ~40 帧后直接转 isStatic(物理上不可能再动);
  // 鞭尸/补断时瞬间解冻恢复动力学,受力飞溅后再次自动冻结,招牌爽点不受影响
  update() {
    // 冻结尸支撑复核(每 30 帧,用户点名"电梯里的尸体浮在半空"):冻结时脚下的支撑
    // (电梯踏板/可推箱/气瓶/别的尸体)事后移走了,静态尸会悬空定格——失去支撑即解冻,
    // 自然坠落再重新冻结。支撑=任一部件正下方 12px 内有实体面,或压着别的尸块。
    // 【间隔必须大于重冻延迟(40帧)】否则一次误判就是永久自激:解冻→还没攒够40帧静止→又被复核解冻。
    this._suppTick = (this._suppTick ?? 0) + 1
    if (this._suppTick >= 45) {
      this._suppTick = 0
      const all = this.getBodies()
      for (const corpse of this.corpses) {
        // _supportSettled=探针闭环已确认它确实有支撑(见 _freeze),不再重复复核
        if (!corpse.frozen || corpse._supportSettled) continue
        let supported = false
        for (const [, part] of corpse.parts) {
          const b = part.spr.active && part.spr.body
          if (!b) continue
          const px = b.position.x, py = b.position.y + 12
          if (this.scene.solids.some((o) => px > o.x - 4 && px < o.x + o.w + 4 && py > o.y && py < o.y + o.h + 6)) { supported = true; break }
          if (all.some((ob) => ob.gibMeta?.corpse !== corpse &&
              Math.abs(ob.position.x - px) < 14 && ob.position.y - b.position.y > 2 && ob.position.y - b.position.y < 20)) { supported = true; break }
        }
        // 探针查不到支撑就解冻验证一次,并记下解冻前的高度——落不下去就说明探针几何够不着、
        // 它其实是有支撑的(卡在结构上/靠着墙),由 _freeze 闭环打上 latch,杜绝"复核↔重冻"自激
        if (!supported) {
          corpse._probeY = this._avgY(corpse)
          this.unfreeze(corpse)
        }
      }
    }
    for (const corpse of this.corpses) {
      if (corpse.frozen) continue
      let maxS = 0, maxA = 0, any = false
      for (const [, part] of corpse.parts) {
        const b = part.spr.active && part.spr.body
        if (!b) continue
        any = true
        // 每帧安定守卫(嵌地根治第二道闸,用户点名"尸体深深嵌进地下"):体心一旦陷进实体
        // (高速穿隧/被载具挤入/爆炸打入),立即抬到该实体顶面并泄掉纵向速度——不等冻结才修
        if (!b.isStatic) {
          const bp = b.position
          const inSolid = this.scene.solids.find((o) =>
            bp.x > o.x && bp.x < o.x + o.w && bp.y > o.y && bp.y < o.y + o.h)
          if (inSolid) {
            M.Body.setPosition(b, { x: bp.x, y: inSolid.y - 5 })
            M.Body.setVelocity(b, { x: b.velocity.x * 0.4, y: Math.min(b.velocity.y, 0) })
          }
        }
        if (b.isSleeping) continue
        // 低速段主动阻尼:门限必须**宽于**冻结门槛,否则存在"够不着阻尼、又永远达不到冻结"的死区——
        // 实测尸体挂在电梯厢顶沿上时,肩甲角速度被求解器持续注能钉在 0.19(旧门限 0.1 够不着,冻结要 <0.12),
        // 整具尸体永不烘焙 = 用户反复点名的抽搐(2026-07-24 实测根因)
        if (b.speed < 1.2 && b.angularSpeed < 0.45) {
          M.Body.setVelocity(b, { x: b.velocity.x * 0.5, y: b.velocity.y * 0.5 })
          M.Body.setAngularVelocity(b, b.angularVelocity * 0.5)
        }
        if (b.speed > maxS) maxS = b.speed
        if (b.angularSpeed > maxA) maxA = b.angularSpeed
      }
      if (!any) continue
      // 判据⓪绝对兜底:动力学状态持续 5s 还没安定 = 它卡在某处出不来了(实测:部件深嵌静态体 16px,
      // 求解器暴力弹射、角速度 6.4rad/step 永不收敛,位移窗口也抓不住因为它真的在乱动)。
      // 无条件烘焙——"留场尸体绝不允许永久抽搐"排在物理纯洁性之前。
      // 计时从"最近一次进入动力学"起算(出生/解冻/中弹都重置),所以鞭尸爽点不受影响
      if (this.scene.time.now - (corpse._activeSince ?? corpse.bornAt) > 5000) { this._freeze(corpse); continue }
      // 判据①速度快路(干净落地的常规尸体走这条,~0.7s 烘焙,行为不变)
      if (maxS < 0.6 && maxA < 0.12) {
        corpse._stillFrames = (corpse._stillFrames ?? 0) + 1
        if (corpse._stillFrames > 40) { this._freeze(corpse); continue }
      } else {
        corpse._stillFrames = 0
      }
      // 判据②位移窗口(被卡住而速度账面永远不达标的走这条)
      this._bakeIfPinned(corpse)
    }
  }

  _avgY(corpse) {
    let y = 0, n = 0
    for (const [, part] of corpse.parts) {
      const b = part.spr.active && part.spr.body
      if (b) { y += b.position.y; n++ }
    }
    return n ? y / n : null
  }

  // 位移窗口烘焙(2026-07-24,"个别肢体永久抽搐"的根治):
  // 速度判据有结构性盲区——部件一旦被静态结构卡住(实测:尸体挂在电梯厢顶沿,肩甲嵌入 9.9px,
  // 关节往下拽、板子往上顶),求解器每帧注能,速度账面永远降不到门槛,整具尸体永不烘焙。
  // 位移判据换个问法:**它到底走没走**。原地高频抖动的净位移≈0 → 照样烘焙(玩家眼里它本来就没动);
  // 真在滑/落/被载运的位移大 → 参考位形跟进,不会误冻。
  _bakeIfPinned(corpse) {
    for (const w of BAKE_WINDOWS) {
      let dev = 0
      for (const [, part] of corpse.parts) {
        const b = part.spr.active && part.spr.body
        if (!b) continue
        const r = part[w.ref]
        if (!r) { dev = Infinity; break }
        // 转角按 26px/rad(部件尺度)折成像素当量,与平移同尺度比较——原地打转也算"在动"
        const d = Math.max(Math.abs(b.position.x - r.x), Math.abs(b.position.y - r.y),
          Math.abs(b.angle - r.a) * 26)
        if (d > dev) dev = d
      }
      if (dev > w.tol) { // 确实在移动:参考位形跟进,窗口重新计时
        for (const [, part] of corpse.parts) {
          const b = part.spr.active && part.spr.body
          if (b) part[w.ref] = { x: b.position.x, y: b.position.y, a: b.angle }
        }
        corpse[w.cnt] = 0
      } else if ((corpse[w.cnt] = (corpse[w.cnt] ?? 0) + 1) > w.frames) {
        this._freeze(corpse)
        return
      }
    }
  }

  _freeze(corpse) {
    corpse.frozen = true
    // 支撑探针闭环:上一轮因"查不到支撑"被解冻,若解冻后几乎没往下掉(<4px),
    // 说明它确实有支撑(靠着结构/卡在边沿),只是探针几何够不着——打 latch 不再复核,断掉自激循环
    if (corpse._probeY != null) {
      const y = this._avgY(corpse)
      if (y != null && Math.abs(y - corpse._probeY) < 4) corpse._supportSettled = true
      corpse._probeY = null
    }
    for (const [, part] of corpse.parts) {
      if (!(part.spr.active && part.spr.body)) continue
      const b = part.spr.body
      // 表面弹出守卫:体心若已被挤进实体(死在楼梯上/被压死时打进地里),逐级抬到实体顶面再定格,
      // 级联最多 4 跳(抬出地面可能正落进叠在地面上的箱子里)——根治"尸体嵌在楼梯/地面里"(用户点名)
      for (let hop = 0; hop < 4; hop++) {
        const p = b.position
        const inSolid = this.scene.solids.find((s) =>
          p.x > s.x && p.x < s.x + s.w && p.y > s.y && p.y < s.y + s.h)
        if (!inSolid) break
        M.Body.setPosition(b, { x: p.x, y: inSolid.y - 4 })
      }
      M.Body.setStatic(b, true)
    }
  }

  unfreeze(corpse) {
    if (!corpse.frozen) return
    corpse.frozen = false
    corpse._stillFrames = 0
    corpse._activeSince = this.scene.time.now // 兜底计时重置:解冻后重新给它 5s 自然安定的机会
    // 位移窗口全部重新计时(鞭尸/爆炸/载运解冻后要重新观察它到底走不走)
    for (const w of BAKE_WINDOWS) corpse[w.cnt] = 0
    for (const [, part] of corpse.parts) {
      const b = part.spr.active && part.spr.body
      for (const w of BAKE_WINDOWS) part[w.ref] = null
      if (b) { M.Body.setStatic(b, false); M.Sleeping.set(b, false) }
    }
  }

  // 移动平台载具唤醒入口:搭在梯台上的尸块(冻结或入睡)恢复动力学以跟随/坠落
  wakeRider(body) {
    const c = body.gibMeta?.corpse
    if (c?.frozen) this.unfreeze(c)
    else M.Sleeping.set(body, false)
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
