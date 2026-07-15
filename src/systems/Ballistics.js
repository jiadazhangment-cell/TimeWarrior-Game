// 弹道系统:高速弹丸用"扫掠线段"逐帧检测(防止高速穿透)。
// 每帧把子弹从 p1 推进到 p2,对沿途的 墙体/角色/尸体刚体 求最近命中。
import Phaser from 'phaser'

const M = Phaser.Physics.Matter.Matter

// 线段 vs AABB(slab 法),返回命中参数 t(0..1)或 null
function segVsRect(x1, y1, x2, y2, r) {
  const dx = x2 - x1, dy = y2 - y1
  let tmin = 0, tmax = 1
  for (const [p, d, lo, hi] of [[x1, dx, r.x, r.x + r.w], [y1, dy, r.y, r.y + r.h]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return null; continue }
    let t1 = (lo - p) / d, t2 = (hi - p) / d
    if (t1 > t2) [t1, t2] = [t2, t1]
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }
  return tmin
}

export class Ballistics {
  constructor(scene) {
    this.scene = scene
    this.bullets = []
    this.gfx = scene.add.graphics().setDepth(30)
  }

  fire({ x, y, angle, weapon, owner, tint }) {
    const spread = Phaser.Math.DegToRad(weapon.spreadDeg) * (Math.random() - 0.5) * 2
    const a = angle + spread
    this.bullets.push({
      x, y, dx: Math.cos(a), dy: Math.sin(a),
      speed: weapon.bulletSpeed, traveled: 0,
      weapon, owner, tint: tint ?? 0xfff2b0,
    })
  }

  // handlers: { solids, enemies, player, gibBodies, onHitEnemy, onHitPlayer, onHitWall, onHitGib }
  update(dt, h) {
    this.gfx.clear()
    const gibBodies = h.gibBodies() // 帧内尸体列表稳定,只取一次,避免逐子弹重建数组
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]
      const step = b.speed * dt
      const x2 = b.x + b.dx * step
      const y2 = b.y + b.dy * step

      let best = null // { t, kind, target, point }
      for (const s of h.solids) {
        const t = segVsRect(b.x, b.y, x2, y2, s)
        if (t !== null && (!best || t < best.t)) best = { t, kind: 'wall', target: s } // 带上被击中的实体(可击破物路由用)
      }
      if (b.owner === 'player') {
        for (const e of h.enemies) {
          if (!e.alive) continue
          const t = segVsRect(b.x, b.y, x2, y2, e.capsule)
          if (t !== null && (!best || t < best.t)) best = { t, kind: 'enemy', target: e }
        }
      } else if (h.player.alive) {
        const t = segVsRect(b.x, b.y, x2, y2, h.player.capsule)
        if (t !== null && (!best || t < best.t)) best = { t, kind: 'player' }
      }
      // 尸体/断肢刚体(鞭尸):Matter 射线查询
      if (gibBodies.length) {
        const hits = M.Query.ray(gibBodies, { x: b.x, y: b.y }, { x: x2, y: y2 })
        for (const hit of hits) {
          // Query.ray 的碰撞对里可能包含射线自身的临时刚体,取带 gibMeta 的那个
          const bd = [hit.bodyA, hit.bodyB].find((bb) => bb && bb.gibMeta) ?? hit.parentA
          if (!bd || !bd.gibMeta) continue
          const px = bd.position.x, py = bd.position.y
          const t = Phaser.Math.Clamp(((px - b.x) * b.dx + (py - b.y) * b.dy) / step, 0, 1)
          if (!best || t < best.t) best = { t, kind: 'gib', target: bd }
        }
      }

      if (best) {
        const hx = b.x + b.dx * step * best.t
        const hy = b.y + b.dy * step * best.t
        const point = { x: hx, y: hy }
        if (best.kind === 'wall') h.onHitWall(point, b, best.target)
        else if (best.kind === 'enemy') h.onHitEnemy(best.target, point, { x: b.dx, y: b.dy }, b.weapon)
        else if (best.kind === 'player') h.onHitPlayer(point, b)
        else h.onHitGib(best.target, point, { x: b.dx, y: b.dy }, b.weapon)
        this.bullets.splice(i, 1)
        continue
      }

      b.x = x2; b.y = y2
      b.traveled += step
      if (b.traveled > b.weapon.range) { this.bullets.splice(i, 1); continue }

      // 曳光
      const len = b.weapon.tracerLen
      this.gfx.lineStyle(2.5, b.tint, 0.9)
      this.gfx.lineBetween(b.x - b.dx * len, b.y - b.dy * len, b.x, b.y)
    }
  }

  clear() { this.bullets.length = 0; this.gfx.clear() }
}

export { segVsRect }
