# 执行报告 · E1 实体碰撞组(2026-08-09)

战场:bug-confirmed **#0 / #1 / #3 / #7 / #22** + 主控裁决 **②(Turret 俯角符号)** **③(seal1 软锁·方案1)**。
产物:①代码改动留在 working tree(未提交、未动 git);②`e1-level-slice-additions.json`(level 改动清单,E1 一个 json 字都没改);③本报告。

## 0. 落盘清单(以磁盘为准)

| 文件 | 动作 | 关键行 |
|---|---|---|
| `src/systems/collide.js` | **新增**(77 行,零依赖纯函数) | 导出 `rectsOverlap` / `freeAt` / `supportedAt` / `resolveXAt` / `resolveXSweep` |
| `src/entities/Player.js` | 改 | 8(import)、108–127(X 段改调公共模块 + 助步降为 `stepAssist` 钩子)、**158(#3 蹲姿撞顶)**、237(`_overlap` 转调 `rectsOverlap`;`_freeAt`/`_supportedAt` 删除,已并入模块) |
| `src/entities/Enemy.js` | 改 | 5(import)、**130–156(#0/#1:preX 前置 / Clamp 移到解算前 / 三判据排出)** |
| `src/entities/BioEnemy.js` | 改 | 10(import)、**194–216(同上,含 `_lungeVx` 并入同一次积分)** |
| `src/systems/Elevator.js` | 改 | **265–275(#7:挤尸 applyForce ×(dt\*60))** |
| `src/ui/Hud.js` | 改 | 61、**178–196(#22:新增 `_isEmpty` 唯一真源谓词,`low` 让位给空仓)** |
| `src/entities/Turret.js` | 改 | **35–43(裁决②:`homeRel = pitch`,去掉 dir 分支)** |
| `src/systems/Devices.js` | 改 | **280–286(`_buildCheckpoint` 加 `hidden` 早返回)、304(`_activateCheckpoint` 落盘后早返回)** |

全部文件过 `node --check`(ESM 模式,项目 package.json 是 commonjs,检查器把 .js 复制成 .mjs 再验)。
**`npm run build` 通过**(vite 8.1.4,39 modules transformed,883ms)——模块图与新 import 全部解析正常。
`config/` 与 `src/scenes/ArenaScene.js` **零改动**(已核对)。

---

## A. #0 碰撞/横向排出(high)—— 三判据抽成公共模块

### 改了什么
新建 `src/systems/collide.js`,把 Player 2026-07-24 已修好的 X 段整套变成三方共用的唯一真源:

- `resolveXSweep(ent, solids, preX, opts)` —— 遍历 solids,跳过 `oneWay`/`minor`,重叠即解算;
- 可推物分支 = **朝渗透浅侧温和排出**(`vx=0` 也解算);
- 静态实体分支 = **三判据**:① `preX` 定进入侧、优先退回来的那边;② 落点 `freeAt`(不嵌进别的实体,`skip` 当前块,pushable/oneWay/minor 不算阻挡);③ 落点 `supportedAt`(脚下 600px 内有可站实体);都不满足 → 退回 `preX`;
- `opts.stepAssist` = 玩家专属台阶助步钩子(**机器人不传**,楼梯仍是玩家专属路线);
- `opts.onBlocked` = 敌人"驻足折返"钩子。

Player/Enemy/BioEnemy 三方改调它。**判据不再看 `this.vx`**,顺带消灭了"`vx===0` 两个分支都不进 = 原地嵌着完全不解算"和"第一块实体解算后 `vx=0` 熄火导致同帧后续实体失去解算"。

### 判据与验证

**A-1 权威 harness 复跑(主控通报的 `docs/交接存档-20260728/sim3.mjs`)**
原脚本 X 段是硬编码旧代码;我用 `scratchpad/patch_sim3.mjs` 生成 `sim3_fixed.mjs`,**只替换 X 段**为磁盘上现役的 `collide.js`(preX 前置 + Clamp 前移 + `resolveXSweep`),solids 构建/Y 段/AI/试验协议/无种子 `Math.random`/困死判据一字不动:

| 运行 | 原始 sim3.mjs(旧代码) | sim3_fixed.mjs(现役 collide.js) |
|---|---|---|
| #1 | 23 / 40 | **0 / 40** |
| #2 | 26 / 40 | **0 / 40** |
| #3 | 18 / 40 | **0 / 40** |
| #4 | 20 / 40 | **0 / 40** |

旧代码 18–26/40 与交接存档记录的 23/40 同分布;修完 **4 次运行全 0**。

**A-2 自建仿真(`scratchpad/sim_enemy.mjs`,solids 复刻更全:platforms+stairs+doors+门楣+breakables+电梯厢底/厢顶)**

- 基线纯巡逻 60s:新旧**完全一致**(enemies[6] 活动区间 1579..1712,零重叠、零穿越)——证明修复没动正常路径。
- 40 次随机试验(随机武器/方向/命中时刻 @165Hz,跑 180s):旧 **7 困死 + 16 次发生单帧穿越**;新 **0 + 0**。
- 40 次西向击退+15s 交战(复刻 verdict 协议):旧 **8 + 8**;新 **0 + 0**。
- 全罗盘扫描(22 台 × 3 武器 × 2 方向 = 132 例,跑 125s):旧 **单帧穿越 11 / 困死 18**(涉及 e6/e8/e9/e12/e14/e15/e17/e19);新 **单帧穿越 0 / 困死 1**。

**新代码残留的那 1 例** = e8 被大炮的竖直击退(vy−480)掀到 `prop_desk` 顶上,再被 `patrolMinX=2850` 钉在桌面下不来。**新旧代码同样发生**(不是回归),病根在关卡数据不在 X 解算 → 已写进清单 **A-3**;套上清单里提议的巡逻带改动后重跑:**132 例 0 穿越 0 困死**。

**A-3 玩家侧零回归的硬证据(`scratchpad/diff_player_x.mjs`)**
把 2026-07-28 落盘的旧内联实现逐字搬成对照组,用真实 level solids 撒 **200000 组随机玩家状态**(位置绕每块实体、随机 vx/vy/蹲姿/着地/preX),两套实现各跑一次比对 `(x, y, vx)`:
**真正发生解算 109826 例,不一致 0 例 → 重构逐例等价。**

### 判定
#0 **已根治**。剩余的"击退把敌人掀上矮家具"属竖直击退 + 布置问题,已转清单。

---

## B. #1 深重叠 + 配置(high)

同一处改动的另一半,逐条对应 fix_note:

1. **击退并入同一次积分**:`preX` 记在 `_knockVx`(以及 Bio 的 `_lungeVx`)位移**之前**,判据看本帧净位移的"进入侧",不看 `this.vx`。→ `Enemy.js:133` / `BioEnemy.js:196`。Bio 的 `onBlocked` 里保留了原有的 `this._lungeVx = 0`(撞墙即掐断前扑脉冲)。
2. **`vx=0` 也解算**:模块不再有 `if (vx>0)/else if (vx<0)` 分支。硬直期(`hitStaggerMs=120` 内 `moveDir=0`)照常排出。
3. **每块实体独立解算**:`vx=0` 不再是"已处理"开关。
4. **Clamp 移到碰撞解算之前** → `Enemy.js:145`(无条件)/ `BioEnemy.js:209`(仅 patrol,与原语义一致:交战态本就不钳)。
5. **关卡侧校正**:`patrolMinX/MaxX 不得落在任何非 oneWay solid 内` 已做成脚本 `scratchpad/audit_patrol.mjs`,扫出 8 台违规 → 全部进清单(A-1..A-9),其中 e6/e8 标 must。哨兵型窄带(e11 8px、e19 20px)按 SKILL K 属正确写法,脚本不误报。

**闭环验证**:sim3 原始协议 23→0;`prop_barrier` 陷阱链(硬直不解算 → 弹到实体另一侧 1367 → Clamp 拉回 1450(barrier 肚子里)→ atEnd 禁左移 → 死循环)在新代码下第一步就断掉:preX 恒在 cab1 右面 1579,`freeAt(1579)&&supportedAt(1579)` 成立 → 每帧原地顶回 1579,从未进入 1450 附近。

---

## C. #3 玩家蹲姿撞顶用站姿胶囊(high)

**改动**:`Player.js:158`
`this.y = s.y + s.h + cap.h` → `this.y = s.y + s.h + (this.crouching ? this.cfg.crouch.h : cap.h)`(与同函数 119 行助步测试、`get capsule()`、`hurt()` 头区、Elevator 顶死判定同口径)。

**验证**(`scratchpad/verify_misc.mjs`,真实 solids + 真实解算,新旧对跑):

- 几何确认:`stairs{3560,y1630,stepH15,stepW26}` 展开后第 4 级踏板 = x3638..3664 / y1570..**1578**,而蹲姿胶囊顶 = 1630−52 = **1578** → **净空恰好 0px** 的战术口袋(SKILL H 白纸黑字鼓励玩家钻进去蹲爬)。
- 触发源:`WeaponSystem` 的后座 `player.vy -= sin(angle)*recoil*0.3` **不受 crouching 门控**。实测 recoil:rifle **0**(不触发)、rpg 110、ricochet 120、shotgun 150、supercannon 260。
- 结果矩阵(shotgun/rpg/supercannon × 30°/60°/85° × 60Hz/165Hz,共 15 组命中条件):
  - **旧**:全部 `y → 1944.7(60Hz)/1945.5(165Hz)` > 世界底阈值 `L.height+160 = 1940` → **触发世界底安全网 → die() → 重生**(正是用户报过的"莫名重生到检查点");
  - **新**:全部 `y ≡ 1630`,`fell:false`,零位移。
- rifle(recoil 0)与 rpg@30°/60Hz 等未越过阈值的组合,新旧同为不掉出——修复不制造新差异。

---

## D. #7 Elevator 每帧施力未归一化(med)

**改动**:`Elevator.js:265–275`,下行厢底挤尸块的 `applyForce` 两个分量各乘 `k = dt * 60`(`dt` 是 `update(dt, player, pressed)` 现成的形参),随机项 `0.009+Math.random()*0.006` 保留。

**判据**:引擎步锁 16.667ms 且每步末清空 force,而 `applyForce` 每渲染帧调一次 → 单物理步吃到的力 = 该步内的渲染帧数 × 单帧力。

| | 60Hz | 165Hz |
|---|---|---|
| 每物理步攒帧数 | 1.00 | 2.75 |
| 旧:单步 y 力 | mass×0.00500(**3.1× 重力**) | mass×0.01375(**8.6× 重力**) |
| 新:单步 y 力 | mass×0.00500(3.1×) | mass×0.00500(**3.1×,与帧率无关**) |

y 分量跨质变门槛这条(把尸块顶进正下压的静态厢底体 = SKILL G"深嵌静态体→求解器注能→抽搐"那一族的诱因)因此被消掉。这是全库最后一处漏网(对照 `Explosives.js:412`、`ArenaScene` 的爆炸阵风都早已 `×(dt*60)`)。
**注**:此项的最终确认必须走真实 rAF(SKILL I 铁律:Matter 锁真实时间,泵帧推不动物理)—— 见 §回归要点。

---

## E. #22 HUD 弹药警示(low)

**改动**:`Hud.js` 新增唯一真源谓词 `_isEmpty(key, a)`(`noReload ? reserve<=0 : (mag<=0 && reserve<=0)`),`:61` 槽位小字与 `:196` 大字号同时改调它;并把 `low` 改成 `!empty && …`,防止 `reserve<=1` 把空仓抢成黄色。

**验证**(`verify_misc.mjs`,按 weapons.json 逐枪推真·打空态):

| 枪 | noReload | 打空态 | 旧:槽位/大字 | 新:槽位/大字 |
|---|---|---|---|---|
| rifle / shotgun / ricochet | false | mag0 res0 | 红 / 红 | 红 / 红(**不变**) |
| **rpg** | true | mag**1** res0 | **灰 / 黄** | **红 / 红** |
| **supercannon** | true | mag**1** res0 | **灰 / 黄** | **红 / 红** |

即:`a.mag` 对 noReload 武器永远停在 `magSize=1`(WeaponSystem 无任何写路径),旧判据对 5 把枪中的 2 把是字面死代码;修复后 5 把枪的"打空"配色统一。可换弹武器行为逐位不变。

---

## F. 主控裁决② — Turret dir=−1 俯角符号(已判真,照执行)

**改动**:`Turret.js:43` `this.homeRel = this.dir > 0 ? pitch : -pitch` → **`this.homeRel = pitch`**。

**为什么是对的**:`_aimAngle(rel)` 对两个朝向都把 **rel>0 定义为向下**(朝右 world=rel;朝左 world=π−rel,rel=+25° → world=155° → cos<0/sin>0 = 左下),追瞄侧的 `wantRel` 也是这个口径;旧写法让 dir=−1 的炮塔 pitchDeg 越大越**往上抬**,与本文件注释和 SKILL H 的 `home = dir>0 ? pitch : π−pitch`(世界角)相反。

**扇区落点数值复核**(`scratchpad/audit_turret.mjs`,复用 audit-map.mjs 的 solids 约定与 `segVsRect`;13 射线锥半角 ±9°、机械限位 ±80°、追瞄 Clamp 全部按 Turret.js 实现复算):

| 炮塔 | dir | 旧 homeRel | 新 homeRel | 受影响? |
|---|---|---|---|---|
| 5500,586(R-A 储藏舱,`turrets[0]`) | +1 | 18° | 18° | **无**(落点包络与 8 个探针结果逐字相同) |
| 2612,230 | +1 | 40° | 40° | **无**(同上,6 探针相同) |
| **4413,640(蜂巢)** | **−1** | **−25°** | **+25°** | **有** |
| 2647,930 / 1180 / 1490 | +1 | 25° | 25° | **无**(各 5 探针相同) |

→ **§6.2/D7 的追问答复:地图批为绕开此 bug 新加的炮塔一律 dir=+1,而 `homeRel` 两式在 dir=+1 时同值,所以符号修复对新增炮塔(以及除 4413 外的全部现役炮塔)完全无影响**——这是逐探针复算出来的,不是推断。

**4413 那台的前后对比**(pivot 4383.95, 641.84;range 640;sweep 40°):

| | 扫掠界 rel | 世界角 | 落点包络 | B1 走道(y760)可击 x | B2(y1050)跨层可击 x |
|---|---|---|---|---|---|
| 旧 | [−65°, +15°] | [245°, 165°] | x3744..4355, y540..**760** | 4100,4160,4200,4260,4270 | 无 |
| 新 | [−15°, +65°] | [195°, 115°] | x3744..4270, y540..**1050** | 4100,4160,4200,4260,4270,**4300,4360** | **4100,4150,4200,4240** |

- **本意达成**:扇区从"抬 25°"翻正为"压 25°",B1 走道覆盖向东延伸到 x4360(顶到井道口),正是 §6.2 说的"本意压下去罩住 B1 走道"。
- **新暴露的一条,必须请主控拍板**:最陡的几条射线会穿过井道缺口(B1 楼板止于 **x4270**、蜂巢东墙自 **x4415** 起)打到 **B2 楼面 x4100..4240**,其中 **x4225 正是副梯 B2 层呼叫面板的站位**(`elevators[1].calls[1].x = 4225`)。这落在 SKILL F 点名过的"扇区扫到必经点"那一类(2612 那台踩过)。
  `sweepDeg` 扫描(新公式下):**≤26° 时 B1 六个探针覆盖不变、跨层可击点归零**;28/34/38/40 依次把 4100→4150→4200→4225→4240 纳入。
  → 清单 **F-1**:建议 `sweepDeg 40 → 26`(标 optional,附三个替代方案,E1 不替主控做设计取舍)。
- 不动 `pitchDeg`:25° 是既有定版数值,本次只修符号。

---

## G. 主控裁决③ — seal1 软锁(方案 1,照执行)

**E1 不改 config**,拆成两半:

1. **代码侧(已落盘)**:`Devices.js` 支持 `checkpoints[].hidden = true` —— 不画信标柱/接地影/灯,过点不播 toast 与音效,**只推进 `scene.respawnPoint` 并 `SaveStore` 落盘**。`_buildCheckpoint:286` 早返回、`_activateCheckpoint:304` 落盘后早返回。
2. **数据侧(进清单 G-1)**:`{ "id": "cp_seal", "x": 4760, "y": 470, "hidden": true }`。

**为什么是 4760 而不是原议的 4790**:检查点激活窗是 `|x−cp.x| < 24`。
- 4760 → 窗 (4736, 4784),**跨过封门触发线 4750**,于是"先记检查点、后封门"在任何帧率下都成立;
- 4790 → 窗 (4766, 4814) 整段在触发线以东 → 4750~4766 这 16px 是无保护区,而 `enemies[1]` 巡逻带 [4700,5040] 恰好覆盖这里。

**几何与采样复核**(`verify_misc.mjs`):
- seal1 x4640..4685 → 本点在门东侧 **75px**;
- 重生点嵌固检查:玩家胶囊(30×88)在 (4760,470) 与任何非 oneWay 实体 **零重叠**;脚下 `ground regionA`(x4600..5080,y470)承托 ✓;
- 满速 360px/s 的窗内采样帧数 / 其中封门前帧数:165Hz **22 / ≥7**,60Hz **8 / ≥3**,30Hz **4 / ≥2**,20Hz **3 / ≥1** → **任何帧率都不可能漏过**。
- 刷新页面路径也被覆盖:存档记 `checkpoint:"cp_seal"`,`ArenaScene:339` 按 id 取回 → 重进即在 4760(门东),不再落到 cp3(4430)被 d_out 挡住重打整段蜂巢。

**已知副作用(小)**:玩家走到 4736~4750 记下检查点后再折返向西(seal1 尚未关),此时死亡会重生到 4760——只是位置略前移,门还开着,不产生任何锁死。14px 的窗口,实战几乎不会出现。

---

## 给主控的实机回归要点(真实 rAF,禁泵帧)

按优先级,前 4 条是本批必跑:

1. **#7 电梯挤尸(必须真实 rAF 跑真实秒数)**:主梯/副梯下行,厢底扫过正下方尸块。判据不是"看着对",而是 **60fps 与 165Hz 两档下尸块被踢出的初速/落点分布一致**(旧版 165Hz 是 60fps 的 2.75 倍单步力)。若窗口被遮挡导致 rAF 掉速,先 `SetForegroundWindow` 再整轮重测(SKILL I)。顺带看尸块有没有被顶进厢底静态体后抽搐。
2. **#3 蹲姿撞顶**:传送到 **x3666 / y1630**(楼梯下 0px 净空口袋),蹲下,朝脚边地面开一枪(**用霰弹/大炮,rifle recoil=0 不触发**)。期望:人**原地不动**、`window.__twFalls` 为空。改前该操作 100% 掉出世界并重生。
3. **#0/#1 敌人排出**:①走到 x≈1700 的巡逻机兵前,用大炮朝西打它一发(把它往 cab1/路障方向轰),观察它**不再一帧跨过配电柜**、也不会埋进路障里抽动;②蜂巢里挑一台站在家具旁的守军同样轰一发;③把可推路障推到某台站定守军身上,确认它被"温和挤出"而不是原地嵌着不动。
4. **裁决③ seal1 软锁(必须先把 `game.json` 的 `godMode` 改 false)**:合并 G-1 后,越过 x4750 让门关死 → 在 R-A 段(炮塔/蒸汽/地沟)故意死一次 → 期望**重生在 x4760(门东)**,可继续东进;改前会重生到 4430 被封死的门挡住 = 存档级软锁。同时跑一次"过线后立刻刷新页面"确认存档取回 `cp_seal`。
5. **裁决② 炮塔**:蜂巢封锁战里看 4413 那台的红色扇面**朝下扫**(改前朝上)。若主控采纳 F-1(sweep→26),再跑一次"站 B2 副梯呼叫面板 x4225 12 秒不被锁定";若不采纳,请明确这是有意的跨层压制。
6. **#22 HUD**:切到 RPG/超级大炮,把备弹打到 0 → 槽位小字与左下大字号**都应变红**(改前小字灰、大字黄)。顺带确认步枪/霰弹/弹跳枪配色没变。
7. **回归护栏(不必单跑但请留意)**:玩家台阶助步(楼梯/17px 矮台)、可推物推人、电梯厢顶 `liftRoof` 豁免、蜂巢窄门洞守军巡逻——这些都走同一段 X 解算,`diff_player_x.mjs` 已证明玩家侧逐例等价,敌人侧属**有意改变**,试玩时请留意"守军撞掩体折返"的手感是否还对。

## 留档:本批脚本(全在 E1 scratchpad,可复跑)

`C:\Users\surpr\AppData\Local\Temp\claude\C--Users-surpr\2743c226-92eb-4124-91ba-2cb7b77bd3a5\scratchpad\`

| 脚本 | 用途 |
|---|---|
| `patch_sim3.mjs` → `sim3_fixed.mjs` | 从交接存档原始 `sim3.mjs` 生成"只换 X 段"的对照版(23/40 → 0/40) |
| `sim_enemy.mjs` | 自建仿真:`baseline`/`stuck`/`west`/`roster`/`fixdata`/`dbg` 六个模式 |
| `audit_patrol.mjs` | 巡逻带与出生位几何审计(产出清单 A-1..A-9) |
| `audit_turret.mjs` | 炮塔扇区落点新旧对比 + `sweepDeg` 扫描(产出 F-1) |
| `verify_misc.mjs` | #3 蹲姿撞顶 / G 检查点采样窗 / #7 归一化量级 / #22 配色表 |
| `diff_player_x.mjs` | Player X 段新旧实现 20 万例差分(0 不一致) |
| `check.sh` | ESM 语法检查器(项目是 commonjs,`node --check` 需要 .mjs) |

**建议**:`audit_patrol.mjs` 值得并进 SKILL K 铁律④的出生位审计脚本族(和 `audit-map.mjs`/`audit-reach.mjs` 放一起),它是"patrolMinX/MaxX 不得落在实体内 + 有效巡逻净宽"这两条的可执行版本。
