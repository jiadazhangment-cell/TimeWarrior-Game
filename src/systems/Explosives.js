// 可爆炸物系统(R2 物理世界层,入侵者2 对标"道具即弹药"):
// 气瓶=可推动态刚体;被打漏(hp 耗尽)进入泄漏阶段——阀口喷焰产生**偏心推力**(施力点偏离
// 质心=自带扭矩),瓶体喷着火乱窜翻滚(此阶段从 solids 摘除=飞行物,撞到人/敌人是撞击伤,
// 玩家不会被高速 AABB"铲上去");1.6~2.3s 后爆炸:范围伤害+尸块冲击波+其他气瓶连锁引爆。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import { segVsRect } from './Ballistics.js'

const M = Phaser.Physics.Matter.Matter
const BOOM_R = 130

export class Explosives {
  constructor(scene) {
    this.scene = scene
    this.tanks = scene._pushables.filter((p) => p.tank)
    for (const t of this.tanks) {
      t._hp = t.hp ?? 26
      t._state = 'idle' // idle(完好可推) | leak(喷射乱窜) | dead
    }
  }

  // 子弹命中气瓶(Ballistics 墙命中分派;敌我子弹都有效=炮塔乱枪也会引爆,系统涌现)
  hit(solid, dmg, point) {
    const t = this.tanks.find((x) => x === solid)
    if (!t || t._state === 'dead') return
    this.scene.fx.sparks(point.x, point.y, 3)
    M.Sleeping.set(t._body, false)
    t._hp -= dmg
    if (t._hp <= 0 && t._state === 'idle') this._startLeak(t)
    // 命中飞行中的泄漏瓶=加速殉爆(打得中它是 minor 语义给的;打中就该马上炸)
    else if (t._state === 'leak') t._boomAt = Math.min(t._boomAt, this.scene.time.now + 120)
  }

  _startLeak(t) {
    t._state = 'leak'
    t._boomAt = this.scene.time.now + 1600 + Math.random() * 700
    t._nozzleSign = Math.random() < 0.5 ? 1 : -1
    t._noz = 0
    t._hitCd = 0
    // 飞行物阶段:不再摘除 solids,改打 minor 标(入侵者2 junk 语义)——玩家/敌人可穿行、
    // 不挡视线,但子弹仍可命中(旧版整条摘除=飞瓶对子弹隐形穿模,审计实锤);
    // AABB 由 _updatePushables 继续逐帧随刚体同步
    t.minor = true
    Sfx.laserSnap()
  }

  _explode(t) {
    if (t._state === 'dead') return
    t._state = 'dead'
    const s = this.scene
    const x = t._body.position.x, y = t._body.position.y
    // 视觉:爆炸复合体(核闪/火球羽流/冲击波环/烟团/暖火星/熏黑,见 fx.explosion——
    // 旧版借用枪械冷色资源+圆片充数,用户点名"不真实,参考入侵者2"后重做)
    s.fx.explosion(x, y, 1)
    s.fx.debris(x, y, 16)
    // 震屏随玩家距离衰减(900px 外不震——隔半张图的爆炸不该同级摇镜头)
    const fall = Math.max(0, 1 - Math.hypot(s.player.x - x, s.player.y - y) / 900)
    if (fall > 0.05) EventBus.emit('camera:shake', 0.045 * (0.85 + Math.random() * 0.3) * fall, 170)
    Sfx.explosion()
    // 爆炸遮挡:实心墙/闸门挡住的目标不吃伤害(审计实锤"隔墙炸人";pushable/oneWay/minor
    // 不挡冲击波——家具与格栅挡不住爆压,厚实结构才挡)
    const blocked = (tx, ty) => s.solids.some((o) =>
      o !== t && !o.oneWay && !o.pushable && !o.minor &&
      ((tt) => tt !== null && tt > 0.001 && tt < 0.999)(segVsRect(x, y, tx, ty, o)))
    // 伤害:敌人/炮塔(鸭子类型)/玩家;尸块冲击波;邻近气瓶连锁(随机延迟=连环爆的节奏感)
    const targets = s.lockdown ? s.enemies.concat(s.lockdown.turrets) : s.enemies
    for (const e of targets) {
      if (!e.alive) continue
      // 敌人 y=脚底,压到躯干量距;炮塔 pivotY 本身就是中心,不再上抬(否则等效炸塔半径偏小)
      const ex = e.x ?? e.pivotX, ey = e.y != null ? e.y - 40 : e.pivotY
      const d = Math.hypot(ex - x, ey - y)
      if (d < BOOM_R && !blocked(ex, ey)) e.takeHit(85, { x: (ex - x) / (d || 1), y: -0.4 }, { x: ex, y: ey }, s.turretWeapon)
    }
    if (s.player.alive && Math.hypot(s.player.x - x, s.player.y - 44 - y) < BOOM_R &&
        !blocked(s.player.x, s.player.y - 44)) s.player.hurt(28, x)
    for (const b of s.gibs.getBodies()) {
      const d = Math.hypot(b.position.x - x, b.position.y - y)
      if (d < BOOM_R + 40 && !blocked(b.position.x, b.position.y)) {
        s.gibs.wakeRider(b)
        const k = 1 - d / (BOOM_R + 40)
        // 冲击波用力(setVelocity 对初醒刚体无效的坑,见 ArenaScene 可推注释)
        M.Body.applyForce(b, b.position, {
          x: (b.position.x - x) / (d || 1) * b.mass * 0.032 * k,
          y: -b.mass * 0.018 * k,
        })
      }
    }
    // 场景反馈(审计实锤"爆炸对场景零反应"):可推家具吃冲击波;可击破物按距离折伤;后带 decor 抖一下
    for (const p of s._pushables) {
      if (p === t || !p._body || (p.tank && p._state !== 'idle')) continue
      const d = Math.hypot(p._body.position.x - x, p._body.position.y - y)
      if (d < BOOM_R + 40 && !blocked(p._body.position.x, p._body.position.y)) {
        const k = 1 - d / (BOOM_R + 40)
        M.Sleeping.set(p._body, false)
        M.Body.applyForce(p._body, p._body.position, {
          x: (p._body.position.x - x) / (d || 1) * p._body.mass * 0.024 * k,
          y: -p._body.mass * 0.012 * k,
        })
      }
    }
    for (const o of s.solids) {
      if (!o.breakable) continue
      const bx = o.x + o.w / 2, by = o.y + o.h / 2
      const d = Math.hypot(bx - x, by - y)
      if (d < BOOM_R && !blocked(bx, by)) s.devices.hitBreakable(o.breakable, Math.round(45 * (1 - d / BOOM_R)), { x: bx, y: by })
    }
    for (const dec of s._decorSprites ?? []) {
      if (Math.hypot(dec.x - x, dec.y - y) < BOOM_R + 130) {
        s.tweens.add({ targets: dec.spr, angle: { from: -1.2, to: 1.2 }, duration: 45,
          yoyo: true, repeat: 3, onComplete: () => dec.spr.setAngle(0) })
      }
    }
    for (const o of this.tanks) {
      if (o !== t && o._state !== 'dead') {
        const d = Math.hypot(o._body.position.x - x, o._body.position.y - y)
        if (d < BOOM_R && !blocked(o._body.position.x, o._body.position.y)) {
          s.time.delayedCall(140 + Math.random() * 220, () => this._explode(o))
        }
      }
    }
    // 罐体炸没:摘贴图/刚体/solid(idle 直接被连锁引爆时 solid 还在)
    if (t._spr) t._spr.destroy()
    s.matter.world.remove(t._body)
    const i = s.solids.indexOf(t)
    if (i >= 0) s.solids.splice(i, 1)
    const j = s._pushables.indexOf(t)
    if (j >= 0) s._pushables.splice(j, 1)
  }

  update() {
    const s = this.scene
    const now = s.time.now
    for (const t of this.tanks) {
      if (t._state !== 'leak') continue
      if (now >= t._boomAt) { this._explode(t); continue }
      const b = t._body
      // 喷口推力:沿瓶轴向+随机游走,施力点偏离质心=乱窜带翻滚(入侵者2 煤气罐火箭)
      t._noz += (Math.random() - 0.5) * 0.35
      const a = b.angle - Math.PI / 2 + t._nozzleSign * 0.25 + t._noz * 0.3
      const f = b.mass * 0.0028 // ≈3×重力:能真的窜起来(0.0009 时刚好抵消重力=原地悬浮)
      M.Body.applyForce(b, { x: b.position.x - Math.cos(a) * 8, y: b.position.y - Math.sin(a) * 8 },
        { x: Math.cos(a) * f, y: Math.sin(a) * f })
      // 喷焰(火星连流+口部光点)
      const nx = b.position.x - Math.cos(a) * 16, ny = b.position.y - Math.sin(a) * 16
      if (Math.random() < 0.85) s.sparkEmitter.explode(1, nx, ny)
      if (Math.random() < 0.3) s.fx.flash(nx, ny)
      // 飞行撞击伤(有冷却,防逐帧融化目标)
      if (b.speed > 4 && now > t._hitCd) {
        const pl = s.player
        if (pl.alive && Math.abs(pl.x - b.position.x) < 26 && Math.abs(pl.y - 44 - b.position.y) < 54) {
          pl.hurt(8, b.position.x)
          t._hitCd = now + 260
        }
        for (const e of s.enemies) {
          if (!e.alive) continue
          if (Math.abs(e.x - b.position.x) < 28 && Math.abs(e.y - 55 - b.position.y) < 60) {
            e.takeHit(20, { x: Math.sign(b.velocity.x) || 1, y: -0.2 }, { x: e.x, y: e.y - 55 }, s.turretWeapon)
            t._hitCd = now + 260
            break
          }
        }
      }
    }
  }
}
