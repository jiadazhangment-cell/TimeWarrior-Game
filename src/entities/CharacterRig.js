// 部件化角色骨架:按 config/rigs.json 用 FK(正向运动学)拼装部件,
// 程序化驱动走路/瞄准/前倾。所有数学在"朝右空间"计算,朝左时镜像。
// 部件贴图为 2x 分辨率,显示 setScale(0.5)。
import Phaser from 'phaser'

const DEG = Math.PI / 180

export class CharacterRig {
  constructor(scene, rigDef) {
    this.scene = scene
    this.def = rigDef
    this.container = scene.add.container(0, 0)
    this.facing = 1
    this.aimAngle = 0        // 真实世界角度(弧度)
    this.lean = 0            // 躯干前倾(弧度,朝右空间)
    this.hipBob = 0
    this.gaitPhase = 0
    this.gaitIntensity = 0

    // 解析部件,按父子关系排序(父先算)
    this.parts = {}
    this.order = []
    const names = Object.keys(rigDef.parts)
    const resolved = new Set()
    while (this.order.length < names.length) {
      for (const n of names) {
        if (resolved.has(n)) continue
        const p = rigDef.parts[n].parent
        if (!p || resolved.has(p)) { this.order.push(n); resolved.add(n) }
      }
    }
    for (const name of this.order) {
      const d = rigDef.parts[name]
      const spr = scene.add.sprite(0, 0, d.tex)
      spr.setOrigin(d.pivot[0] / d.size[0], d.pivot[1] / d.size[1])
      spr.setScale(0.5)
      spr.setDepth(d.z)
      this.container.add(spr)
      this.parts[name] = { name, def: d, spr, localAngle: 0, px: 0, py: 0, ang: 0 }
    }
    this.container.sort('depth')
  }

  setPosition(x, y) { this.container.setPosition(x, y) }
  setDepth(d) { this.container.setDepth(d) }

  // 朝向空间的瞄准角(朝左时把角度镜像回"向前")
  get aimLocal() {
    return Math.atan2(Math.sin(this.aimAngle), Math.cos(this.aimAngle) * this.facing)
  }

  // 每帧调用:根据步态/倾斜/瞄准重算所有部件位置
  updatePose() {
    const P = this.parts
    const f = this.facing
    const gait = this.gaitIntensity
    const ph = this.gaitPhase
    const swing = 34 * DEG * gait

    // 局部角度(朝右空间)
    P.thigh_f.localAngle = Math.sin(ph) * swing
    P.thigh_b.localAngle = Math.sin(ph + Math.PI) * swing
    P.shin_f.localAngle = Math.max(0, Math.sin(ph - 1.1)) * 55 * DEG * gait + 4 * DEG
    P.shin_b.localAngle = Math.max(0, Math.sin(ph + Math.PI - 1.1)) * 55 * DEG * gait + 4 * DEG
    if (P.arm_back && !P.arm_back.def.aim) {
      P.arm_back.localAngle = 55 * DEG + Math.sin(ph + Math.PI) * 14 * DEG * gait
    }
    P.torso.localAngle = this.lean
    const pitch = this.aimLocal
    P.head.localAngle = Phaser.Math.Clamp(pitch * 0.22, -18 * DEG, 22 * DEG)

    // FK 求解
    for (const name of this.order) {
      const part = P[name]
      const d = part.def
      if (!d.parent) { // 根(躯干):挂在髋部
        part.px = 0
        part.py = -this.def.heightToHip + this.hipBob
        part.ang = part.localAngle * f
        continue
      }
      const par = P[d.parent]
      const offX = (d.attach[0] - par.def.pivot[0]) * f
      const offY = d.attach[1] - par.def.pivot[1]
      const c = Math.cos(par.ang), s = Math.sin(par.ang)
      part.px = par.px + offX * c - offY * s
      part.py = par.py + offX * s + offY * c
      part.ang = d.aim ? this.aimAngle : par.ang + part.localAngle * f
    }

    // 应用到精灵
    for (const name of this.order) {
      const part = P[name]
      part.spr.setPosition(part.px, part.py)
      part.spr.setRotation(part.ang)
      if (part.def.aim) { part.spr.setFlipX(false); part.spr.setFlipY(f < 0) }
      else { part.spr.setFlipX(f < 0); part.spr.setFlipY(false) }
    }
  }

  // 枪口世界坐标(带 muzzle 定义的部件)
  getMuzzle() {
    for (const name of this.order) {
      const part = this.parts[name]
      const d = part.def
      if (!d.muzzle) continue
      let ox = d.muzzle[0] - d.pivot[0]
      let oy = d.muzzle[1] - d.pivot[1]
      if (this.facing < 0) oy = -oy // 瞄准件用 flipY 镜像
      const c = Math.cos(part.ang), s = Math.sin(part.ang)
      return {
        x: this.container.x + part.px + ox * c - oy * s,
        y: this.container.y + part.py + ox * s + oy * c,
        angle: this.aimAngle,
      }
    }
    return { x: this.container.x, y: this.container.y - 50, angle: this.aimAngle }
  }

  // 受击白闪
  flash() {
    for (const n of this.order) this.parts[n].spr.setTintFill(0xffffff)
    this.scene.time.delayedCall(60, () => {
      for (const n of this.order) this.parts[n].spr.clearTint()
    })
  }

  // 给 Gib 系统的快照:每个部件的世界变换+关节锚点
  snapshotForGibs() {
    const cx = this.container.x, cy = this.container.y
    return this.order.map((name) => {
      const part = this.parts[name]
      const d = part.def
      return {
        name,
        tex: d.tex,
        w: d.size[0], h: d.size[1],
        pivot: d.pivot,
        x: cx + part.px, y: cy + part.py,     // 部件枢轴的世界坐标
        angle: part.ang,
        flipX: !d.aim && this.facing < 0,
        flipY: !!d.aim && this.facing < 0,
        parent: d.parent || null,
        z: d.z,
      }
    })
  }

  setVisible(v) { this.container.setVisible(v) }
  destroy() { this.container.destroy(true) }
}
