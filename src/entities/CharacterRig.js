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
    // 两腿真实胯点的水平偏移(玩家±5.5/机器人+4,-5):步态 IK 必须按各自胯点解,
    // 两腿的膝盖/脚才走同一条世界轨迹——否则侧视下两腿提膝高度不一致(用户2026-07-14点名)
    const tp = rigDef.parts
    this._hipDxF = tp.thigh_f?.attach && tp.torso ? tp.thigh_f.attach[0] - tp.torso.pivot[0] : 0
    this._hipDxB = tp.thigh_b?.attach && tp.torso ? tp.thigh_b.attach[0] - tp.torso.pivot[0] : 0
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
    const smooth = (t) => t * t * (3 - 2 * t)

    // —— 站立步态 v4:分段 IK 足迹环 × 人类步态相位学(2026-07-14 按真实跑步研究重做) ——
    // 真实跑步的腿只在【摆动中段】折叠;两个"直腿时刻"必须存在,否则读作"全程屈腿"的怪跑:
    //   ①蹬离端:腿在体后近全伸——滚动弧蹬离侧收小(10→5)+尖朝下24°,IK 距离逼近腿全长自然蹬直;
    //   ②终末摆动:提膝曲线在末段约12%归零(min 截断),膝盖伸直、小腿前探"够"落点(跟先着尖抬12°)。
    // 触地段:脚相对髋匀速后送=严格零滑步;占空比 D=2A/cycleLen 由约束自动反解——
    //   前进(周期208):D≈0.29 ⇒ 换步双脚离地(飞行相);后退(周期115):D≈0.42 ⇒ 近双支撑仅微飞。
    // 后退=专门动作(用户两轮拍板):与前进同为"步子略大步频低"的跑法(步幅24/≈3.8步秒),
    //   低提膝(8)、无后拖、微后仰(-2°),另限速 0.6x——不是高频碎步,也不是倒放的前进。
    // 静止=stance 待机站姿(比母本战斗姿略收拢,后膝带 9° 微弯);未配置 stance 的骨架(机器人)基准=近垂直。
    const st = this.def.stance
    const [L1, L2] = this.def.ikLegs ?? [20, 28]
    let thighF = (st?.thighF ?? 0) * DEG
    let thighB = (st?.thighB ?? 0) * DEG
    let shinF = (st?.shinF ?? 4) * DEG
    let shinB = (st?.shinB ?? 4) * DEG
    let liftF = 0, liftB = 0, tiltF = 0, tiltB = 0
    if (gait > 0.001) {
      const hipY = -this.def.heightToHip + this.hipBob
      const back = this.moveSign < 0
      // 后退v4(用户拍板):速度=前进85%(306),步幅22/周期165≈3.7步/秒;真人倒退是"贴地滑步"——
      // 脚全程擦地(轨迹最高≈5px)、无提膝、脚尖先落轻滚,绝不抬腿
      const H = back ? 2.5 : 14
      const TRAIL = back ? 0 : 7
      const rollLand = back ? 4 : 10
      const rollPush = back ? 3 : 5
      const tipPush = back ? 10 : 38 // 蹬离脚尖下压角(入侵者2实测≈40°;此前24°太浅=脚踝像不会转)
      // 步幅按腿长夹紧:落点相脚在 (±A, -rollLand),不能超出腿可达范围(机器人腿短自动收步幅)
      const Amax = Math.sqrt(Math.max(1, (L1 + L2 - 0.5) ** 2 - (Math.abs(hipY) - rollLand) ** 2))
      const A = Math.min(back ? 22 : 30, Amax)
      const D = Phaser.Math.Clamp(2 * A / (this.cycleLenNow ?? 208), 0.26, 0.62)
      const TAU = Math.PI * 2
      // 躯干节律摆动(修"上半身像固定玩偶"):每步一次俯仰微摆,蹬离段前倾、落地段回正,
      // 胸甲/背包/弹挂随之被带动;头部世界空间稳定(真人跑步视线盯目标)、枪口保持瞄准不受影响
      this._runRock = Math.sin(2 * ph) * 2.2 * DEG * gait * (1 - cr) * (back ? 0.5 : 1)
      const solve = (phase, hipDx) => {
        const m = ((phase % TAU) + TAU) % TAU          // 触地窗以 m=π 为中心,宽 2πD
        let x, y, tilt, lift
        if (Math.abs(m - Math.PI) <= Math.PI * D) {
          const u = (m - Math.PI * (1 - D)) / (TAU * D)          // 0=落地,1=蹬离
          x = A * (1 - 2 * u)                                     // 匀速后送=零滑步
          const roll = rollLand + (rollPush - rollLand) * u
          y = -roll * (2 * u - 1) ** 2                            // 落地端跟先着;蹬离端弧小⇒IK逼近全长=腿蹬直
          // 脚踝全程转动(人类步态+入侵者2实测):跟落勾脚-16°→快速拍平(u=0.3)→中段贴地→
          // 脚跟先离地、踝下压蹬出(u>0.5 渐增至 tipPush)
          if (u < 0.3) tilt = -16 * (1 - u / 0.3)
          else if (u < 0.5) tilt = 0
          else tilt = tipPush * smooth((u - 0.5) / 0.5)
          lift = 0
        } else {
          const s = (m > Math.PI * (1 + D) ? m - Math.PI * (1 + D) : m + Math.PI * (1 - D)) / (TAU * (1 - D))
          lift = Math.sin(Math.PI * Math.min(1, Math.pow(s, 1.25) / 0.88)) // 末段~12%归零=终末摆动伸膝前探
          x = A * (2 * smooth(s) - 1) - TRAIL * lift
          y = -(rollPush + (rollLand - rollPush) * smooth(s)) - H * lift
          // 摆动前 15% 脚保持蹬离时的下垂拖尾(入侵者2同款),之后经下垂→勾脚 -16° 准备跟落
          tilt = tipPush + (-16 - tipPush) * smooth(Math.max(0, (s - 0.15) / 0.85))
        }
        const ik = this._legIK(hipDx, hipY, x, y, L1, L2)
        return { ik, lift, tilt: tilt * DEG }
      }
      const F = solve(ph, this._hipDxF), B = solve(ph + Math.PI, this._hipDxB)
      liftF = F.lift * gait; liftB = B.lift * gait
      tiltF = F.tilt * gait; tiltB = B.tilt * gait
      thighF = L(thighF, F.ik.thigh, gait)
      shinF = L(shinF, F.ik.shinLocal, gait)
      thighB = L(thighB, B.ik.thigh, gait)
      shinB = L(shinB, B.ik.shinLocal, gait)
    }

    // —— 下蹲(双姿态,对标《战火英雄》):静止=单膝跪;移动=保持低位的前后跨步;按移动强度 mb 混合 ——
    // 跪姿(几何按髋高20px解出):后腿大腿近垂直→膝盖触地,小腿(+90°)平贴地面朝后;
    //   前腿大腿近水平→膝盖近髋高,小腿前斜(总角-46°)踩地,脚植于身前。
    // 低姿行走:髋保持低位,大腿绕竖直方向±22°前后摆,小腿"同相伸缩"(66+37sin)让脚全程贴地、
    //   走出±28px 的水平跨步——腿始终是弯的下蹲形态,但脚是前后迈而非上下抖。
    if (cr > 0) {
      const mb = Math.min(1, gait * 1.3)
      this._crouchDrop = 25 // 跪蹲低度(髋高47-25=22;前膝高于髋、后膝近地——军姿跪的髋要足够低)
      this._crouchPitch = L(10, 16, mb)
      // 跪姿(静止):真军姿单膝跪=前膝抬高(高于髋,大腿-108°)、小腿完全垂直(sF=108→总角0°)、脚掌平踩,
      // 后膝触地小腿后折——素体腿长(21.5/28.5)下几何恰好闭合
      // 军姿单膝跪(2026-07-14 按真实军人跪姿+战火英雄立绘重解,修"前腿太紧"):
      // 前腿:大腿从髋上斜 23°(-113)到膝(膝高30>髋22),小腿世界角-4°微前倾(sF 109),
      //   脚掌平踩在膝下——踝关节张开 94°(此前小腿后斜40°把踝压到50°,是"太紧"的病根);
      // 后腿:膝近地(tB 25),小腿后放靴尖点地(sB 71)
      let tF = -113, sF = 109, tB = 25, sB = 71
      this._crouchFlatF = 1
      this._crouchFlatB = 0.3
      if (mb > 0.01) {
        // 低位潜行(双骨 IK):双脚钉住地面沿水平 ±24px 往返(迈步腿微抬 5px),
        // 由 IK 反解大小腿角——前伸腿伸展、收回腿深折于臀下,腿形反差即"蹲着走"
        const hipY = -this.def.heightToHip + this.hipBob + cr * this._crouchDrop
        const A = 24 // 步幅(用户定版:±24 形态最好看,勿加大)
        // 两脚踩同一条 ±A 居中轨道(对称交替);IK 起点用各自真实胯点(前+4/后-5),
        // 不要给脚的轨道加错位偏置——那会造成"一腿前迈大后迈小、另一腿相反"的不对称
        const sinF = Math.sin(ph), sinB = Math.sin(ph + Math.PI)
        // 折叠腿的脚踝抬 3px:配合脚尖点地的旋转,靴尖不插进地面
        const ikF = this._legIK(2, hipY, A * sinF, -4 * Math.max(0, Math.cos(ph)) - 3 * Math.max(0, -sinF), L1, L2)
        const ikB = this._legIK(-2, hipY, A * sinB, -4 * Math.max(0, Math.cos(ph + Math.PI)) - 3 * Math.max(0, -sinB), L1, L2)
        tF = L(tF, ikF.thigh / DEG, mb); sF = L(sF, ikF.shinLocal / DEG, mb)
        tB = L(tB, ikB.thigh / DEG, mb); sB = L(sB, ikB.shinLocal / DEG, mb)
        // 蹲行的脚(2026-07-14 研究+《入侵者2》逐帧):脚的角色随相位轮换——
        // 前伸承重脚=平踩(压平1);折叠到臀下的脚=脚跟抬起、脚尖点地(压平→0.24,基本顺着横置的小腿)。
        // 之前"脚掌永远水平"会嵌进折叠的小腿里(用户点名的穿模)
        this._crouchFlatF = L(1, 0.62 + 0.38 * sinF, mb)
        this._crouchFlatB = L(0.3, 0.62 + 0.38 * sinB, mb)
      }
      thighF = L(thighF, tF * DEG, cr)
      shinF = L(shinF, sF * DEG, cr)
      thighB = L(thighB, tB * DEG, cr)
      shinB = L(shinB, sB * DEG, cr)
    }
    // —— 跳跃姿态层(2026-07-14 按人类跳跃相位+入侵者2,修"起跳僵硬=空中定格站姿"):
    // 姿态由竖直速度驱动:蹬伸离地(腿全伸展脚尖绷直)→上升收腿(膝收向前)→下落前伸探地(脚备落) ——
    const airT = this.airT ?? 0
    if (airT > 0.001) {
      const vn = this.vyNorm ?? 0 // -1=离地瞬间 0=顶点 +1=落速
      let aThF, aShF, aThB, aShB, aTilt
      if (vn < 0) { // 上升:蹬伸→收腿
        const u = smooth(1 + vn)
        aThF = L(-6, -55, u); aShF = L(6, 78, u)
        aThB = L(14, -18, u); aShB = L(8, 55, u)
        aTilt = L(22, 8, u)
      } else {      // 下落:收腿→前伸探地(前腿下探,后腿微拖)
        const u = smooth(Math.min(1, vn * 1.4))
        aThF = L(-55, -22, u); aShF = L(78, 18, u)
        aThB = L(-18, 6, u); aShB = L(55, 26, u)
        aTilt = L(8, -8, u)
      }
      thighF = L(thighF, aThF * DEG, airT); shinF = L(shinF, aShF * DEG, airT)
      thighB = L(thighB, aThB * DEG, airT); shinB = L(shinB, aShB * DEG, airT)
      tiltF = L(tiltF, aTilt * DEG, airT); tiltB = L(tiltB, aTilt * DEG, airT)
      liftF = L(liftF, 0.55, airT); liftB = L(liftB, 0.55, airT)
    }
    // 落地压缩:IK 把双脚钉在地面、髋随冲击下沉(脉冲由 Player 按落速给出,弹性恢复)
    const landT = this.landT ?? 0
    this._landDrop = 0
    if (landT > 0.001) {
      const k = smooth(landT)
      this._landDrop = 6 * k
      const hipL = -this.def.heightToHip + this.hipBob + this._landDrop
      const ikLF = this._legIK(this._hipDxF, hipL, 7, 0, L1, L2)
      const ikLB = this._legIK(this._hipDxB, hipL, -7, 0, L1, L2)
      thighF = L(thighF, ikLF.thigh, k); shinF = L(shinF, ikLF.shinLocal, k)
      thighB = L(thighB, ikLB.thigh, k); shinB = L(shinB, ikLB.shinLocal, k)
      tiltF = L(tiltF, 0, k); tiltB = L(tiltB, 0, k)
    }
    P.thigh_f.localAngle = thighF
    P.thigh_b.localAngle = thighB
    P.shin_f.localAngle = shinF
    P.shin_b.localAngle = shinB
    if (P.foot_f) {
      // 脚掌:站立0.9压平贴地;跑步触地脚贴地、摆动脚随提膝收一半,再叠加蹬离/落地滚动角;
      // 蹲姿前脚全平、后脚随小腿折起
      const torsoPitch = this.lean + cr * (this._crouchPitch ?? 10) * DEG
      const fF = L(0.95 - 0.35 * liftF, this._crouchFlatF ?? 1, cr)
      const fB = L(0.95 - 0.35 * liftB, this._crouchFlatB ?? 0.3, cr)
      P.foot_f.localAngle = -(torsoPitch + thighF + shinF) * fF + tiltF * (1 - cr)
      P.foot_b.localAngle = -(torsoPitch + thighB + shinB) * fB + tiltB * (1 - cr)
    }
    if (P.arm_back && !P.arm_back.def.aim) {
      P.arm_back.localAngle = 55 * DEG + Math.sin(ph + Math.PI) * 14 * DEG * gait * (1 - cr * 0.7)
    }
    // 跑步追加前倾(参考作:奔跑躯干前倾明显);后退=微后仰(真实人后退时重心靠后)——与速度前倾(lean)叠加;
    // 再叠加每步一次的躯干节律摆动(_runRock,gait≈0 时自然归零)
    const runLean = gait * (1 - cr) * (this.moveSign > 0 ? 4.5 : -2) * DEG
    const landPitch = landT > 0.001 ? smooth(landT) * 6 * DEG : 0 // 落地缓冲前倾
    P.torso.localAngle = this.lean + runLean + (this._runRock ?? 0) + landPitch + cr * (this._crouchDrop !== undefined ? this._crouchPitch : 10) * DEG
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
        part.py = -this.def.heightToHip + this.hipBob + cr * (this._crouchDrop ?? 22) + (this._landDrop ?? 0)
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

  // 受击白闪(Phaser 4:setTintFill 已移除 → setTint+FILL 模式,恢复时还原默认 MULTIPLY)
  flash() {
    for (const n of this.order) this.parts[n].spr.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)
    this.scene.time.delayedCall(60, () => {
      for (const n of this.order) this.parts[n].spr.clearTint().setTintMode(Phaser.TintModes.MULTIPLY)
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
