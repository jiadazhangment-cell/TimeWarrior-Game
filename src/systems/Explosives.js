// 可爆炸物系统(R2 物理世界层,入侵者2 对标"道具即弹药"):
// 气瓶=可推动态刚体;被打漏(hp 耗尽)进入泄漏阶段——阀口喷焰产生**偏心推力**(施力点偏离
// 质心=自带扭矩),瓶体喷着火乱窜翻滚(此阶段从 solids 摘除=飞行物,撞到人/敌人是撞击伤,
// 玩家不会被高速 AABB"铲上去");1.6~2.3s 后爆炸:范围伤害+尸块冲击波+其他气瓶连锁引爆。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'

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
  }

  _startLeak(t) {
    t._state = 'leak'
    t._boomAt = this.scene.time.now + 1600 + Math.random() * 700
    t._nozzleSign = Math.random() < 0.5 ? 1 : -1
    t._noz = 0
    t._hitCd = 0
    // 飞行物阶段:从 solids 摘除(不再是可站/挡路实体)
    const i = this.scene.solids.indexOf(t)
    if (i >= 0) this.scene.solids.splice(i, 1)
    Sfx.laserSnap()
  }

  _explode(t) {
    if (t._state === 'dead') return
    t._state = 'dead'
    const s = this.scene
    const x = t._body.position.x, y = t._body.position.y
    // 视觉:白热闪+膨胀火球光+火星雨+碎片+震屏
    s.fx.flash(x, y)
    s.fx.sparks(x, y, 26)
    s.fx.debris(x, y, 10)
    const halo = s.add.image(x, y, 'px_glow').setTint(0xffa050).setScale(0.6).setAlpha(0.9)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(41)
    s.tweens.add({ targets: halo, scale: 3.4, alpha: 0, duration: 320, ease: 'Cubic.Out', onComplete: () => halo.destroy() })
    EventBus.emit('camera:shake', 0.02)
    Sfx.thud(); Sfx.zap()
    // 伤害:敌人/炮塔(鸭子类型)/玩家;尸块冲击波;邻近气瓶连锁(随机延迟=连环爆的节奏感)
    const targets = s.lockdown ? s.enemies.concat(s.lockdown.turrets) : s.enemies
    for (const e of targets) {
      if (!e.alive) continue
      // 敌人 y=脚底,压到躯干量距;炮塔 pivotY 本身就是中心,不再上抬(否则等效炸塔半径偏小)
      const ex = e.x ?? e.pivotX, ey = e.y != null ? e.y - 40 : e.pivotY
      const d = Math.hypot(ex - x, ey - y)
      if (d < BOOM_R) e.takeHit(85, { x: (ex - x) / (d || 1), y: -0.4 }, { x: ex, y: ey }, s.turretWeapon)
    }
    if (s.player.alive && Math.hypot(s.player.x - x, s.player.y - 44 - y) < BOOM_R) s.player.hurt(28, x)
    for (const b of s.gibs.getBodies()) {
      const d = Math.hypot(b.position.x - x, b.position.y - y)
      if (d < BOOM_R + 40) {
        s.gibs.wakeRider(b)
        const k = 1 - d / (BOOM_R + 40)
        // 冲击波用力(setVelocity 对初醒刚体无效的坑,见 ArenaScene 可推注释)
        M.Body.applyForce(b, b.position, {
          x: (b.position.x - x) / (d || 1) * b.mass * 0.032 * k,
          y: -b.mass * 0.018 * k,
        })
      }
    }
    for (const o of this.tanks) {
      if (o !== t && o._state !== 'dead') {
        const d = Math.hypot(o._body.position.x - x, o._body.position.y - y)
        if (d < BOOM_R) s.time.delayedCall(140 + Math.random() * 220, () => this._explode(o))
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
