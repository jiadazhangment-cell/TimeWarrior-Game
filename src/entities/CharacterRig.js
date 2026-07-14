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
    this.moveSign = 1        // +1 前进 / -1 倒退(相对朝向):倒退步幅更小
    this.crouch = 0          // 0..1 下蹲程度

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

  // 每帧调用:根据步态/倾斜/瞄准/下蹲重算所有部件位置
  updatePose() {
    const P = this.parts
    const f = this.facing
    const cr = this.crouch
    const gait = this.gaitIntensity
    const ph = this.gaitPhase
    const L = Phaser.Math.Linear

    // —— 站立跑步步态 ——
    // 二次谐波打破正弦钟摆感:摆动腿快速前收、支撑腿慢速后蹬;倒退(moveSign<0)步幅收小
    const swing = 30 * DEG * gait * (this.moveSign < 0 ? 0.8 : 1) * (1 - cr)
    const snapF = Math.sin(ph) * 0.82 + Math.sin(2 * ph) * 0.18
    const snapB = Math.sin(ph + Math.PI) * 0.82 + Math.sin(2 * ph + Math.PI * 2) * -0.18
    let thighF = snapF * swing
    let thighB = snapB * swing
    // 膝盖只在摆动相折叠(幂次让折叠更"弹")
    const lift = 62 * DEG * gait * (1 - cr)
    let shinF = Math.pow(Math.max(0, Math.sin(ph - 0.9)), 1.4) * lift + 4 * DEG
    let shinB = Math.pow(Math.max(0, Math.sin(ph + Math.PI - 0.9)), 1.4) * lift + 4 * DEG

    // —— 下蹲基准姿态 + 蹲行小碎步 ——
    if (cr > 0) {
      const shuffle = gait * cr
      const cThighF = -62 * DEG + Math.sin(ph) * 11 * DEG * shuffle
      const cShinF = 96 * DEG - Math.max(0, Math.sin(ph - 0.9)) * 20 * DEG * shuffle
      const cThighB = 38 * DEG + Math.sin(ph + Math.PI) * 11 * DEG * shuffle
      const cShinB = 52 * DEG + Math.max(0, Math.sin(ph + Math.PI - 0.9)) * 14 * DEG * shuffle
      thighF = L(thighF, cThighF, cr)
      thighB = L(thighB, cThighB, cr)
      shinF = L(shinF, cShinF, cr)
      shinB = L(shinB, cShinB, cr)
    }
    P.thigh_f.localAngle = thighF
    P.thigh_b.localAngle = thighB
    P.shin_f.localAngle = shinF
    P.shin_b.localAngle = shinB
    if (P.arm_back && !P.arm_back.def.aim) {
      P.arm_back.localAngle = 55 * DEG + snapB * 16 * DEG * gait * (1 - cr * 0.7)
    }
    P.torso.localAngle = this.lean + cr * 9 * DEG
    const pitch = this.aimLocal
    P.head.localAngle = Phaser.Math.Clamp(pitch * 0.22, -18 * DEG, 22 * DEG)

    // FK 求解
    for (const name of this.order) {
      const part = P[name]
      const d = part.def
      if (!d.parent) { // 根(躯干):挂在髋部,下蹲时髋部下沉
        part.px = 0
        part.py = -this.def.heightToHip + this.hipBob + cr * 24
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
