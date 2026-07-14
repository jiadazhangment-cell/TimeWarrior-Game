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

    // —— 移动步态(经典正弦摆,用户拍板定版,勿再改动数学形态) + 静止站姿混合 ——
    // 站姿角度按 rig 配置(母本v2的战斗站姿,静止时=原画同款);未配置的骨架(机器人)保持垂直
    const st = this.def.stance
    const stance = st ? (1 - gait) * (1 - cr) : 0
    const swing = 34 * DEG * gait * (this.moveSign < 0 ? 0.78 : 1) * (1 - cr)
    let thighF = Math.sin(ph) * swing + (st ? st.thighF * DEG * stance : 0)
    let thighB = Math.sin(ph + Math.PI) * swing + (st ? st.thighB * DEG * stance : 0)
    const lift = 55 * DEG * gait * (1 - cr)
    let shinF = Math.max(0, Math.sin(ph - 1.1)) * lift + 4 * DEG + (st ? (st.shinF - 4) * DEG * stance : 0)
    let shinB = Math.max(0, Math.sin(ph + Math.PI - 1.1)) * lift + 4 * DEG + (st ? (st.shinB - 4) * DEG * stance : 0)

    // —— 下蹲(双姿态,对标《战火英雄》):静止=单膝跪;移动=保持低位的前后跨步;按移动强度 mb 混合 ——
    // 跪姿(几何按髋高20px解出):后腿大腿近垂直→膝盖触地,小腿(+90°)平贴地面朝后;
    //   前腿大腿近水平→膝盖近髋高,小腿前斜(总角-46°)踩地,脚植于身前。
    // 低姿行走:髋保持低位,大腿绕竖直方向±22°前后摆,小腿"同相伸缩"(66+37sin)让脚全程贴地、
    //   走出±28px 的水平跨步——腿始终是弯的下蹲形态,但脚是前后迈而非上下抖。
    if (cr > 0) {
      const mb = Math.min(1, gait * 1.3)
      this._crouchDrop = 22 // 跪蹲低度(髋高47-22=25;前膝不过肩、后膝近地)
      this._crouchPitch = L(10, 16, mb)
      // 跪姿(静止):真军姿单膝跪=前膝抬高(高于髋,大腿-108°)、小腿完全垂直(sF=108→总角0°)、脚掌平踩,
      // 后膝触地小腿后折——素体腿长(21.5/28.5)下几何恰好闭合
      let tF = -90, sF = 130, tB = 15, sB = 90
      if (mb > 0.01) {
        // 低位潜行(双骨 IK):双脚钉住地面沿水平 ±24px 往返(迈步腿微抬 5px),
        // 由 IK 反解大小腿角——前伸腿伸展、收回腿深折于臀下,腿形反差即"蹲着走"
        const hipY = -this.def.heightToHip + this.hipBob + cr * this._crouchDrop
        const A = 24 // 步幅(用户定版:±24 形态最好看,勿加大)
        // 两脚踩同一条 ±A 居中轨道(对称交替);IK 起点用各自真实胯点(前+4/后-5),
        // 不要给脚的轨道加错位偏置——那会造成"一腿前迈大后迈小、另一腿相反"的不对称
        const ikF = this._legIK(2, hipY, A * Math.sin(ph), -4 * Math.max(0, Math.cos(ph)), 19.5, 31)
        const ikB = this._legIK(-2, hipY, A * Math.sin(ph + Math.PI), -4 * Math.max(0, Math.cos(ph + Math.PI)), 19.5, 31)
        tF = L(tF, ikF.thigh / DEG, mb); sF = L(sF, ikF.shinLocal / DEG, mb)
        tB = L(tB, ikB.thigh / DEG, mb); sB = L(sB, ikB.shinLocal / DEG, mb)
      }
      thighF = L(thighF, tF * DEG, cr)
      shinF = L(shinF, sF * DEG, cr)
      thighB = L(thighB, tB * DEG, cr)
      shinB = L(shinB, sB * DEG, cr)
    }
    P.thigh_f.localAngle = thighF
    P.thigh_b.localAngle = thighB
    P.shin_f.localAngle = shinF
    P.shin_b.localAngle = shinB
    if (P.foot_f) {
      // 脚掌压平系数:站立0.9(原图靴子平踩)/走路随摆一半/蹲姿前脚全平、后脚随小腿折起
      const torsoPitch = this.lean + cr * (this._crouchPitch ?? 10) * DEG
      const flatWalk = 0.9 - gait * 0.45
      const fF = L(flatWalk, 1, cr)
      const fB = L(flatWalk, 0.15, cr)
      P.foot_f.localAngle = -(torsoPitch + thighF + shinF) * fF
      P.foot_b.localAngle = -(torsoPitch + thighB + shinB) * fB
    }
    if (P.arm_back && !P.arm_back.def.aim) {
      P.arm_back.localAngle = 55 * DEG + Math.sin(ph + Math.PI) * 14 * DEG * gait * (1 - cr * 0.7)
    }
    P.torso.localAngle = this.lean + cr * (this._crouchDrop !== undefined ? this._crouchPitch : 10) * DEG
    // 头部随瞄:0.55 跟随度,并减去躯干自身俯仰(世界空间跟踪)——
    // 否则跪姿躯干前倾 16° 会带着头一起低下去,枪平指前方而视线偏下(用户实测抓到的缺陷)
    const pitch = this.aimLocal
    P.head.localAngle = Phaser.Math.Clamp(pitch * 0.55, -32 * DEG, 36 * DEG) - P.torso.localAngle

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
      // 挂点偏移的镜像轴取决于父件的翻转方式:普通件 flipX(镜像 x),瞄准件 flipY(镜像 y)
      const offX = par.def.aim ? (d.attach[0] - par.def.pivot[0]) : (d.attach[0] - par.def.pivot[0]) * f
      const offY = par.def.aim ? (d.attach[1] - par.def.pivot[1]) * f : (d.attach[1] - par.def.pivot[1])
      const c = Math.cos(par.ang), s = Math.sin(par.ang)
      part.px = par.px + offX * c - offY * s
      part.py = par.py + offX * s + offY * c
      if (d.aim) {
        // 瞄准件:aimFactor<1 的部件(大臂)只部分跟随瞄角,肘部随之真实位移;
        // 世界角由"朝向空间角"换算(朝左=π-L),兼容 flipY 镜像
        const local = this.aimLocal * (d.aimFactor ?? 1) + (d.aimOffset ?? 0) * DEG
        part.ang = f > 0 ? local : Math.PI - local
      } else {
        part.ang = par.ang + part.localAngle * f
      }
    }

    // 应用到精灵
    for (const name of this.order) {
      const part = P[name]
      const d = part.def
      part.spr.setPosition(part.px, part.py)
      part.spr.setRotation(part.ang)
      // 翻转时枢轴原点必须沿翻转轴一起镜像:Phaser 的 flip 是绕帧中线翻贴图内容,
      // 非对称贴图若原点不镜像,关节特征点会偏到 (1-2u)·尺寸 之外——"朝左完全变样"的根因
      const ox = d.pivot[0] / d.size[0], oy = d.pivot[1] / d.size[1]
      if (d.aim) {
        part.spr.setFlipX(false); part.spr.setFlipY(f < 0)
        part.spr.setOrigin(ox, f < 0 ? 1 - oy : oy)
      } else {
        part.spr.setFlipX(f < 0); part.spr.setFlipY(false)
        part.spr.setOrigin(f < 0 ? 1 - ox : ox, oy)
      }
    }
  }

  // 双骨骼 IK:给定髋与脚的位置(朝右空间,y 向下,原点=脚底中心),反解大小腿角度。
  // 角度约定与 FK 一致:0=竖直向下,正=向后;膝盖恒朝前弯。
  _legIK(hipX, hipY, footX, footY, L1, L2) {
    let dx = footX - hipX
    let dy = footY - hipY
    let d = Math.hypot(dx, dy)
    const maxD = L1 + L2 - 0.5
    if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD }
    const a = Math.atan2(-dx, dy)
    const cosB = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)
    const b = Math.acos(Phaser.Math.Clamp(cosB, -1, 1))
    const thigh = a - b // 减号=膝盖朝前
    const kx = hipX - Math.sin(thigh) * L1
    const ky = hipY + Math.cos(thigh) * L1
    const shinAbs = Math.atan2(-(hipX + dx - kx), (hipY + dy - ky))
    return { thigh, shinLocal: shinAbs - thigh }
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
