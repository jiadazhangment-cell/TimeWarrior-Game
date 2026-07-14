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

    // —— 站立跑步步态(经典正弦摆,用户拍板定版,勿再改动数学形态) ——
    const swing = 34 * DEG * gait * (this.moveSign < 0 ? 0.78 : 1) * (1 - cr)
    let thighF = Math.sin(ph) * swing
    let thighB = Math.sin(ph + Math.PI) * swing
    const lift = 55 * DEG * gait * (1 - cr)
    let shinF = Math.max(0, Math.sin(ph - 1.1)) * lift + 4 * DEG
    let shinB = Math.max(0, Math.sin(ph + Math.PI - 1.1)) * lift + 4 * DEG

    // —— 下蹲(双姿态,对标《战火英雄》):静止=单膝跪;移动=保持低位的前后跨步;按移动强度 mb 混合 ——
    // 跪姿(几何按髋高20px解出):后腿大腿近垂直→膝盖触地,小腿(+90°)平贴地面朝后;
    //   前腿大腿近水平→膝盖近髋高,小腿前斜(总角-46°)踩地,脚植于身前。
    // 低姿行走:髋保持低位,大腿绕竖直方向±22°前后摆,小腿"同相伸缩"(66+37sin)让脚全程贴地、
    //   走出±28px 的水平跨步——腿始终是弯的下蹲形态,但脚是前后迈而非上下抖。
    if (cr > 0) {
      const mb = Math.min(1, gait * 1.3)
      const wThigh = (p0) => -50 + 22 * Math.sin(p0)
      const wShin = (p0) => 66 + 37 * Math.sin(p0)
      // 跪姿前腿:本 rig 小腿(27)比大腿(20)长,小腿要竖直踩地就必须让膝盖略高于髋——
      // 大腿-95°(过水平3°)、小腿总角-10°,脚收在膝盖正下方,不前伸(正常人跪蹲形态)
      const cThighF = L(-95, wThigh(ph), mb) * DEG
      const cShinF = L(85, wShin(ph), mb) * DEG
      const cThighB = L(10, wThigh(ph + Math.PI), mb) * DEG
      const cShinB = L(80, wShin(ph + Math.PI), mb) * DEG
      thighF = L(thighF, cThighF, cr)
      thighB = L(thighB, cThighB, cr)
      shinF = L(shinF, cShinF, cr)
      shinB = L(shinB, cShinB, cr)
      this._crouchDrop = L(26, 24, mb)
      this._crouchPitch = L(10, 14, mb)
    }
    P.thigh_f.localAngle = thighF
    P.thigh_b.localAngle = thighB
    P.shin_f.localAngle = shinF
    P.shin_b.localAngle = shinB
    if (P.arm_back && !P.arm_back.def.aim) {
      P.arm_back.localAngle = 55 * DEG + Math.sin(ph + Math.PI) * 14 * DEG * gait * (1 - cr * 0.7)
    }
    P.torso.localAngle = this.lean + cr * (this._crouchDrop !== undefined ? this._crouchPitch : 10) * DEG
    const pitch = this.aimLocal
    P.head.localAngle = Phaser.Math.Clamp(pitch * 0.22, -18 * DEG, 22 * DEG)

    // FK 求解
    for (const name of this.order) {
      const part = P[name]
      const d = part.def
      if (!d.parent) { // 根(躯干):挂在髋部,下蹲时髋部下沉
        part.px = 0
        part.py = -this.def.heightToHip + this.hipBob + cr * (this._crouchDrop ?? 22)
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
