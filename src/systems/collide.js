// 横向(X 段)碰撞排出的**唯一真源**——Player / Enemy / BioEnemy 三方共用。
//
// 【三判据(2026-07-24 定版,level-devices-pipeline SKILL G 节)】撞到静态实体时:
//   ① 从哪边来退回哪边:用**积分前的 preX** 定进入侧,绝不看速度方向;
//   ② 落点不能嵌进别的实体(freeAt);
//   ③ 落点脚下 600px 内必须有地(supportedAt)。
//   ①②③ 都不满足 → 退回 preX,绝不越界。
// 旧写法"按速度方向硬弹到实体另一侧"在两块实体相邻时会**接力弹穿**(井道右墙外侧就是无底
// 空腔,弹过去=掉出世界→世界底安全网→重生到地表检查点),而且 **vx===0 时两个分支都不进
// = 原地嵌着完全不解算**。
//
// 【为什么抽成公共模块(2026-08-09,bug-confirmed #0/#1)】三判据 2026-07-24 只修了 Player,
// Enemy/BioEnemy 一直停在旧代码:独立仿真里"站定敌人挨一发击退"即可让 40 次试验中 23 台
// 永久困死在路障/配电柜里(硬直期 moveDir=0 → vx=0 → 完全不解算,而击退是独立通道继续把它
// 推进实体;下一步再被弹到实体另一侧)。防线级修法=把判据从各家复制品变成一份共用实现。
//
// 【调用方纪律】
//   · preX 必须记在**本帧一切横向位移之前**(含击退 _knockVx / 前扑 _lungeVx / vx 积分),
//     否则"进入侧"判错;
//   · 巡逻带 Clamp 一律跑在 resolveXSweep **之前**(跑在之后 = 把刚排出的敌人重新按回实体内);
//   · 不要再用 `vx = 0` 当"本帧已处理"的开关——每个实体独立解算。

// 轴对齐矩形重叠(半开区间,贴面不算碰)
export function rectsOverlap(a, s) {
  return a.x < s.x + s.w && a.x + a.w > s.x && a.y < s.y + s.h && a.y + a.h > s.y
}

// 落点核验②:把胶囊挪到 nx 后,是否还嵌在别的静态实体里
// (层板 oneWay / junk 小件 minor / 可推物 pushable 都不算阻挡;skip=当前正在解算的那块)
export function freeAt(nx, capW, capY, capH, solids, skip) {
  const x0 = nx - capW / 2, x1 = nx + capW / 2
  return !solids.some((o) => o !== skip && !o.oneWay && !o.minor && !o.pushable &&
    x0 < o.x + o.w && x1 > o.x && capY < o.y + o.h && capY + capH > o.y)
}

// 落点核验③:脚下 600px 内有没有可站实体——绝不把单位排进无底空腔
// (本关 x2300..2600 与 x4460..4600 就是这种空腔,推过去=掉出世界靠安全网兜底)
export function supportedAt(nx, footY, solids) {
  return solids.some((o) => !o.minor && nx > o.x && nx < o.x + o.w &&
    o.y >= footY - 2 && o.y < footY + 600)
}

// 单块实体的排出落点(纯函数,不改任何状态)
// x=本帧积分后的位置,preX=本帧一切位移之前的位置,footY=脚底 y
export function resolveXAt(x, preX, s, capW, capY, capH, footY, solids) {
  if (s.pushable) {
    // 可推物挤过来/翻倒盖过来:朝渗透浅的一侧温和排出(vx=0 也解算=被桌子推着走)。
    // 禁止按速度方向深弹——在墙角会把人从家具另一侧瞬移穿墙掉进墙缝(用户实际踩中)
    const penL = x + capW / 2 - s.x
    const penR = s.x + s.w - (x - capW / 2)
    return penL < penR ? s.x - capW / 2 : s.x + s.w + capW / 2
  }
  const outL = s.x - capW / 2, outR = s.x + s.w + capW / 2
  const cand = preX <= s.x + s.w / 2 ? [outL, outR] : [outR, outL] // ① 优先退回来的那边
  return cand.find((c) => freeAt(c, capW, capY, capH, solids, s) && supportedAt(c, footY, solids))
    ?? cand.find((c) => freeAt(c, capW, capY, capH, solids, s))
    ?? preX
}

// 整段 X 碰撞解算。ent 需提供 x / y(脚底) / vx / capsule(实时 getter)。
// opts:
//   capW       胶囊宽(玩家蹲姿宽度不变,取 cfg.capsule.w)
//   stepAssist (s) => bool —— 玩家专属台阶助步;返回 true 表示该实体已被"迈上去"处理掉
//   onBlocked  (s) => void —— 真的被挡住之后的回调(敌人在这里做"驻足折返")
export function resolveXSweep(ent, solids, preX, opts) {
  const capW = opts.capW
  for (const s of solids) {
    if (s.oneWay) continue // 单向平台不做水平阻挡
    if (s.minor) continue  // junk 小件(桌面电脑/泄漏飞瓶):人可穿行,子弹/爆炸仍碰
    const c = ent.capsule
    if (!rectsOverlap(c, s)) continue
    if (opts.stepAssist && opts.stepAssist(s)) continue
    ent.x = resolveXAt(ent.x, preX, s, capW, c.y, c.h, ent.y, solids)
    ent.vx = 0
    if (opts.onBlocked) opts.onBlocked(s)
  }
}
