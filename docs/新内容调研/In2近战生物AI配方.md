# 入侵者2 近战/生物敌人 AI 与动作配方

> 调研日期 2026-07-27 | 素材来源:`tmp-cuts/pb2/scripts/`(Intrusion 2 反编译 ActionScript,990 个 .as)+ `tmp-cuts/pb2/ffdec-test/`(2629 张位图)| 用途:**生物敌人A(两足前倾、近战冲脸、高速低血)的设计对标** + **后续 BOSS 基建(加权攻击选择器 / 双目标变焦相机)配方**
>
> 全部数值以代码为准并标注文件名与行号。In2 是 Box2D 全物理驱动,我们是运动学控制器 + AABB —— 每节末尾的"落地建议"是翻译后的结论,不是照抄物理参数。

---

## 0. 前置换算基准(所有数值的读法)

| 项 | In2 事实 | 出处 |
|---|---|---|
| 帧率 | **30 FPS**,1 帧 = **33.3ms**(从 SWF 头解出 frameRate=30) | `commando3.swf` header |
| 物理尺度 | `PHYS_SCALE = 30`(30px = 1 物理米);重力 20.4 → **612 px/s²** | `World.as:484, 1984` |
| 玩家血量 | `max_hero_life = 100`(难度变体 130/100/90) | `World.as:2364, 5157-5177` |
| 玩家跑速 | `max_horizontal_speed = 12` = **360 px/s** | `Hero.as:3731` |
| 标准杂兵血 | 30(我方巡逻机兵 70,已定换算系数 ×2.33) | `Enemy.as:102` + `docs/入侵者2武器体系设计表.md:23` |
| 伤害类型常量 | `DMG_PHYSICAL=1` / `DMG_BEAM=4` / `DMG_EXPLOSION=8` / `DMG_FLAME=32` / **`DMG_BYTE=64`** | `World.as:262, 542, 116, 388, 340` |

> **关键背景**:`Enemy.as`(标准人形杂兵基类)**完全没有近战代码** —— grep `melee/punch/kick/Explosion(` 零命中。In2 的近战基本是**生物专属语言**,这本身就是设计信号:近战 = "非人类"的标记。唯一的人形近战特例是滑雪板忍者(见 §1.3-A)。

---

## 1. 近战生物敌人全清单 + 狼的完整状态机

### 1.1 全清单(经 `Movieclips/*Spawner.as` 全量核对 + 关键词普查)

| 类(文件) | 行数 | 继承 | HP | 伤害方式 | 是否纯近战 |
|---|---|---|---|---|---|
| **狼(骑狼兵)** | `Wolfrider.as` 3062 | `Obj` | 狼 **2000** / 骑手 **120** | **一帧咬击攻击盒** | ✅ **主对标样本** |
| **滑雪板忍者** | `SnowboardNinja.as` 656 | `SpawnController` | **140** | 挥砍攻击盒(动画驱动尺寸) | ✅(人形特例) |
| **杀人鱼** | `KillerFish.as` 1044 | `MultiBodyObj` | 未见字面量 | 撞击/撕咬,伤 **50** | ✅ |
| **雪蛇** | `SnowSnake.as` 791 | `SpawnController` | **300** | 纯接触伤害 **20** | ✅ |
| Stalker | `Stalker.as` 3665 | `MultiBodyObj` | `max_life = 1100`(尾 600) | 爪抓 + 拳 + 尾扫,抓取伤 20 | ✅(BOSS 级) |
| GrabberBoss | `GrabberBoss.as` 2783 | `SpawnController` | — | 抓取(处决伤 1000)+ 拳击 | ✅ |
| FloatBot | `FloatBot.as` 1796 | `Obj` | 340(单触手 180) | 触手抓取 + 电击 20 `DMG_BEAM` | ✅(机械) |
| Spherobot | `Spherobot.as` 1637 | `Obj` | 100 | 滚撞 10 `DMG_PHYSICAL` + 炮塔 | 混合 |
| ACEBoss | `ACEBoss.as` 4803 | `SpawnController` | 分阶段 | 咬 20(击退 2000)+ 导弹/光束 | 混合 |
| Danmaku | `Danmaku.as` 4279 | `SpawnController` | 10000 | 撞击 10-20 + 弹幕/光束 | 混合 |
| Exoarmor | `Exoarmor_2.as` 6979 | `Obj` | `max_life = 400` | 抓投 20(击退 2000/-400)+ 踩踏 + 挥砍 | 混合(玩家亦可驾驶) |

**已排除的假阳性**(避免后续重复劳动):`LightSlug`(弹道视觉,life=1)、`ScootShip`(载具,全文无战斗代码)、`SentryGun`/`ShieldTurret`/`GuardTower`(炮塔持枪)、`Spherocontainer`(发射装置)、`EscapePilot`(投掷手雷的远程 NPC)、`Mine`(触雷 HP20)、`Snowball`(环境障碍)、`wolf.as`/`wolf_officer_saddle.as`(纯视觉资源包装)、`MountedEnemyProxy`(119 行纯转发代理)。

### 1.2 狼的状态机(`Wolfrider.LostRiderUpdate()`,`Wolfrider.as:291-507`)

三个 AI 状态(`action` 整数)+ 七个动作状态(`anim_action`)**两层独立**。

**AI 层 `action`:**

| action | 名 | 移动 | 转出条件 |
|---|---|---|---|
| **0** | 蛰伏/凝视 | `move_x = 0` 原地不动;仅当 `\|dx\| > 350px` 才靠近 | `anger > 3` → action 2 |
| **2** | 交战/压迫 | 逼近到 `dx*side > 100px` 就停,原地咬 | `action_reload < 0` → 回 0;若 HP<25% → 1 |
| **1** | 暴走 | 永久追击,`move_x = side` 恒真 | 不可逆(HP<25% 触发) |

**`anger` 累积器**(`Wolfrider.as:427-453, 643, 2785`):
- 玩家在 **200px** 内:`anger += 0.03/帧` → 阈值 3 = **100 帧 = 3.33 秒**凝视才发动
- 玩家在 200px 外:`anger -= 0.03/帧`(会冷却回去)
- **每挨一枪 `++anger`**(`:2785`)、**每咬一口 `++anger`**(`:643`)→ 打它会提前发动

**`fear` 是死代码**:会累积(HP<60% 时 `+0.05/帧`;单发伤害 ≥40 时 `+1`,`:437, 2788`),但全文件**没有任何读取点**,只有 3 处重置(`:395, 481, 2277`)。**In2 的狼不会逃跑,低血反而暴走。**

**交战窗口**(`:450, 473-487`):`action_reload = irnd(300,400)` 帧 = **10~13.3 秒**;每次起咬(`bite_time == 16`)扣 60 帧 = **-2 秒**。结合咬击 CD 44-57 帧,一次交战约 **3~4 次咬击(6~8s)→ 退回凝视态重新蓄 anger(≥3.3s)→ 再来**。这就是它的战斗节拍。

**其它状态字段**:`keep_dist = rnd(200,300)`(骑手的远程站位带,`:2268`);`obstacle_reverse_time = 140` 帧 = 4.67s 的避障倒车流程(前 40 帧倒退 → 转身 → 前进,`:396-411, 1729`);`mount_delay` 50/80/100 帧(`:2279, 851, 2614`)。

### 1.3 另外三个样本的核心数值(已亲自复核)

**A. 滑雪板忍者 `SnowboardNinja.as` —— 手感上最接近我们要做的敌人**

| 项 | 数值 | 出处 |
|---|---|---|
| HP | `max_life = life = 140`(≈4.7 个标准杂兵) | `:118` |
| **近战触发** | `attack_lock <= 0 && 距离 < 130px` | `:332` |
| **攻击 CD** | `attack_lock = 60` 帧 = **2.0 秒**(初始 100 帧 = 3.3s 入场缓冲) | `:128, 334, 358` |
| 判定盒 | `new Explosion(x, y, **abs(sprite.body.hit.scaleX) * 50**, 800, 10, 10, filter, root)` | `:378` |
| 伤害 / 击退力 | 10 / 800 | `:378` |
| 远程共用锁 | 开枪也要 `reloading < 0 && attack_lock <= 0`,开完枪 `attack_lock = 60` | `:347-358` |
| 动作 | `slash_right` / `slash_left` 二选一 | `:337-341` |

**最有价值的一条**:判定盒半径 = `sprite.body.hit.scaleX * 50` —— **攻击盒大小是美术在动画时间轴上 K 出来的**。代码每帧读取名为 `hit` 的标记 MovieClip 的 scaleX 乘 50 得半径。

**B. 杀人鱼 `KillerFish.as` —— 纯生物咬击,整数状态机**
- 伤害 `Damage(side * 100, 0, **50**, contact, DMG_PHYSICAL)`(`:266`)—— 伤 50 = 玩家半条命,击退**纯水平无上抛**(水下环境)
- 整数状态机 `action`(1/2/5/9/12/14)+ `action_reload`:起咬 35 帧、脱离 30 帧、转向 16/20 帧(`:363, 378, 380, 406`)
- **复合起咬门禁**(`:356`):`无目标 && 存活 && (action==1 \|\| action==12) && action_reload<0 && !do_jump && y > 水面高度+50 && reloading<=0` —— 七个条件与门,集中写成一个谓词
- 背后迟滞 `(target.x - x) * side < -30` → 转向态(`:238, 252`),与狼的 `-20` 同款惯用法
- **目标失效检查**(`:441`):`!Alive() \|\| Defeated() \|\| Get("frozen")` —— 跨系统标签查询,目标被冻结就松口
- 巡游重定位节奏 `pos_change_reload = irnd(17,30)` 帧(`:147`)
- 变量名 `byte_obj` / `do_fly_byte` / `byte_coll` —— In2 作者把 bite 拼成 byte,与 `DMG_BYTE` 同源

**C. 雪蛇 `SnowSnake.as` —— 最小接触伤害样本**
- `spline_body.life = 300`(`:107`)
- `root.hero.Damage(vel.x, **-abs(vel.y)**, 20, null, DMG_PHYSICAL)`(`:260`)—— **击退方向 = 自身速度矢量,但 Y 分量强制取负(向上)**
- `byte_reload = 30` 帧 = **1.0 秒**,同一目标的重复接触伤害间隔(`:263`)

### 1.4 落地建议

- 直接照抄狼的三态 + anger 蓄力。`anger` 用**秒**而非帧:`anger += dt` when `|dx| < 200`,阈值 **3.0s**;命中 +1.0s,自身出手 +1.0s。
- 交战预算 `engageBudget = rand(10, 13.3)s`,每次出手 `-2.0s`,归零回蛰伏。**这是让高速近战怪不至于无限贴脸的核心阀门,必抄。**
- HP<25% 转"暴走永久追击"是免费的高潮设计;**不要**做逃跑(In2 自己写了 `fear` 又弃用,说明试过不好玩)。
- "能不能出手"集中写成一个 `canAttack()` 谓词函数(学杀人鱼),而不是散落在状态机各分支里。
- 所有阈值进 `config/enemies.json`。

---

## 2. 近战攻击判定

### 2.1 狼的咬击(`Wolfrider.BiteUpdate()`,`Wolfrider.as:509-650`)

**不是接触伤害,是一帧攻击盒。** `Explosion` 在创建后的下一帧解算一次碰撞就 `life = -100` 自杀(`Explosion.as:330-348`),等于一次性重叠查询。

| 项 | 数值 | 出处 |
|---|---|---|
| 可发起区间 | 前方 `-10 ~ +130px`、上方 150px 内、下方 120px 内(**长方形前置窗口,不是圆**) | `:524` |
| 起手 CD | `bite_reload = rnd(44,57)` 帧 = **1467~1900ms**(随机!;玩家骑乘时固定 38) | `:530-533` |
| **前摇 → 判定** | `bite_time == 15` = **500ms** | `:620-638` |
| 中断点 | `bite_time == 7`(233ms):若目标已跑到身后(`dx*side < -10`)→ **主动取消攻击** | `:546-555` |
| 颈部瞄准锥 | 角度钳制在 `neck_dir-5 ~ neck_dir+45`(50° 锥),颈长钳制 20~55px | `:557-579` |
| 判定盒 | 半径 **16px 圆**,生成在头部 rig 锚点 `sprite.head.bite_point` 偏移 `+4*side` | `:637-638` |
| 伤害 | **10**(= 玩家 100 血的 **10%**);玩家骑乘版为半径 50 / 伤害 60 | `:627-638` |
| 击退 | `SetBite(800*side, -600)` → ApplyForce,**水平:向上 = 4:3**,把玩家从地上掀起来 | `:639` |
| 后摇 | `bite_time == 40` = **1333ms** 动作全长 | `:581-584` |
| 伤害类型 | `DMG_BYTE`(=64),**不是** `DMG_PHYSICAL` | `Explosion.as:205` |
| 转身期禁咬 | `turning < 0` 是发起条件之一 | `:528` |

`Explosion` 构造签名:`Explosion(x, y, radius, force, damage, damage_hero, filter, world)`(`Explosion.as:45`)。

### 2.2 三种近战判定方式的横向总结(**选型依据**)

| 方式 | 代表 | 伤害类型 | 吃玩家无敌帧 | 击退限速 | 适用 |
|---|---|---|---|---|---|
| **一帧攻击盒 + 前摇** | 狼 `bite_point` r=16 | `DMG_BYTE` | ❌ 不吃 | ❌ 不限 | **生物敌人A 主攻击** |
| **动画驱动尺寸的攻击盒** | 忍者 `hit.scaleX * 50` | 默认 | — | — | **推荐的工程实现** |
| **纯接触伤害 + per-target CD** | 雪蛇 / 杀人鱼 / 滚球 | `DMG_PHYSICAL` | ✅ 吃 | ✅ 限速 | 冲撞碾压的次级伤害 |

证据链:玩家 `Hero.as:3538` `if(pain > 0 && (dmgType & DMG_PHYSICAL) != 0) return false` —— **`DMG_PHYSICAL` 被 10 帧(333ms)无敌帧吃掉**;`Hero.as:3576` `LimitSpeed(-20,20,-16,10)` —— 且击退被限速。`DMG_BYTE` 两者都不触发。**In2 全库一致的隐性契约:高伤/接触型走 PHYSICAL(有保护),低伤/带前摇的精准攻击走 BYTE(无保护)。**

### 2.3 落地建议

- **必抄**:近战 = 在动作某一帧生成**一次性 AABB**(挂在骨架的 `bitePoint` 锚点上,不是挂在角色中心)。走我们已有的 `Explosives.applyBlast()` 同款结算路径,但半径给 16-20px、只结算一帧、`damagedSet` 去重。
- **必抄**:两套伤害类型。接触/碾压伤害吃玩家无敌帧且限速击退;**有前摇的攻击不吃无敌帧、不限速** —— 这是"看到前摇没躲=活该"的公平性契约。
- **强烈推荐**:给 `CharacterRig` 加一个 `hitScale` 通道 —— 攻击盒的**位置和半径都由骨架关键帧驱动**(学忍者),而不是写死在代码常量里。调"这一刀打多大范围"变成美术/策划改动画曲线,不用改代码、不用重编译,与我们既有的"参数进 JSON"原则同向。**这是本次调研里第二值得抄的工程手法(仅次于变焦相机)。**
- 数值直接用:前摇 **500ms**、CD **1500-1900ms 随机**(随机化是关键,否则玩家能数拍子)、伤害 **10% 玩家上限血**、击退 **(back, up) = (4, 3)** 方向。
- **必抄中断点**:前摇 233ms 处做一次"目标是否已脱离"检查,脱离就取消动作 → 玩家的翻滚/后跳有真正的收益,而不是被无脑追踪判定。
- **接触伤害必须自带 per-target 冷却(1s)**,否则重叠时每帧掉血。击退方向用"攻击者速度 + Y 强制向上"(学雪蛇)比固定方向自然、比完整物理简单。
- **生物敌人A 的最终配方**:主攻击走**狼的配方**(500ms 前摇 + 一帧攻击盒 + 不吃无敌帧),扑击途中的身体碰撞走**接触伤害配方**(低伤 + 1s per-target CD + 吃无敌帧)。两套并存、伤害类型区分开,玩家就能学会"躲咬,但被撞到不致命"。
- 近战与远程**共用一个 `attackLock` 冷却**(学忍者)——后续若加远程变体,能天然避免"边开枪边挥刀"的破绽。

---

## 3. 扑击 / 冲锋 / 跳跃

### 3.1 狼的跳跃(`Wolfrider.as:1812-1855`)
- 触发:`move_y < 0 && anim_action == STATE_GALLOP && back_landed_time < 5`(**只能从疾驰态起跳,且后腿刚落地 5 帧内**)
- 冲量分三帧给:`jumping == 3` 时 `vy = -12*jump_mult`(**设值**),`jumping == 4,5` 时再各 `+= -12`(**叠加**);水平 `vx += 2.5*side` ×3 帧
- 空中钳制 `min_vertical_speed - 2 = -22`(=660 px/s),`max_horizontal_speed + 2 = 18`;常态钳制 `max_horizontal_speed = 16`(=480 px/s)、`max_vertical_speed = 36`、`min_vertical_speed = -20`(`:59, 199, 221, 1863-1873`)
- 结束:`jumping > 19`(633ms)或 `jumping > 10 && vy > 1` → `STATE_FALL`
- **落地零恢复**:`STATE_FALL` 见地即 `gotoAndPlay("front_land")` 并立刻回 `STATE_GALLOP`(`:1806-1811`)—— 落地不硬直,连贯性优先
- `jump_mult` 在特定路径点降到 0.4(`:2499`)= 短跳
- 起跳时躯干 `surface_angle` 向 `-30*side` 插值(系数 0.1) —— **空中前倾 30°,这就是扑击剪影**
- 起跳触发的另一条件(骑手 AI):目标在自己上方 **160px** 以上(`:2400-2403`,该分支有反编译痕迹,取其设计意图)

### 3.2 Stalker 的扑击(`Stalker.as:798+`)
- `jump_speed = limit(16 + dist*0.015 - dy*(dy<50 ? 0.02 : 0.05), 16, 30)` —— **扑击速度随目标距离线性增长并钳位**
- 触发距离 `> 400px`(仅剩 1 条腿时降到 250);抓取后 `catch_reload = 100` 帧(3.3s)
- 接近减速:`Move(..., limit(0.5 + |dx-40|/50, 0.5, 1), ...)` —— **距离理想交战位 40px 时速度降到 50%**,天然的 arrive 缓动
- 尾扫:`dx*side > 0 && tail_spin_reload < 0 && dist < 500 && !low_ceiling && !tail.broken && !attacking` → `tail_spin_reload = 130` 帧(4.3s)CD
- 抓取:`CatchHero(limb)`(`:2528`)调用玩家侧通用 API `root.hero.AskCatch(x, y, true, this, true, 2, "fall", "jump_run_back")` —— **敌人不需要了解 Hero 内部状态,只发起请求由 Hero 自行判定**

### 3.3 落地建议
- 扑击起跳速度 **随缺口距离线性插值并钳位**(`v = clamp(base + k*gap, vMin, vMax)`),别写死一个值 —— 这一条让同一个动作在近距和远距都合理。
- 起跳只允许从"跑动态 + 刚落地窗口内"进入 —— 天然限制扑击频率,不需要额外 CD。
- **落地不加恢复硬直**(In2 明确选择);要惩罚玩家就靠攻击本身,不靠"怪落地卡住给你打"。
- 空中前倾 30° 是扑击剪影的全部秘密,运动学控制器直接 `sprite.rotation` 插值即可。
- 可打断性:In2 的跳跃**不可被伤害打断**(见 §5),只能被地形打断。
- 抓取类交互一律走"敌人发起请求 → 玩家自行判定"的 `AskCatch` 协议,不要让敌人直接改玩家状态。

---

## 4. 索敌与放弃

### 4.1 In2 通用视野(`World.SeeHero()`,`World.as:6323-6350`)
- **距离 800px 的圆 + 一条 raycast(只与砖墙/杂物求交)。没有视野锥,360° 全向。**
- 检测节流:`check_see_hero_reload = irnd(10, 20)` 帧 = **333-667ms 才查一次**,且**随机化以错开同屏多个敌人的检测帧**(`Enemy.as:334-337, 105`)
- `see_hero` 是**"距上次看见过了几帧"的计数器**,不是布尔:看见 = 归 0,否则每帧 +1。`see_hero > 60`(2s)= 判定失去目标(`Enemy.as:683`);`see_hero > 10`(0.33s)= "刚才还看得见",用于跳跃等次级决策(`Enemy.as:457, 1432`)
- **挨打即索敌**:`if(pain > 0 || SeeHero(...))`(`Enemy.as:1998`)—— 背后开黑枪照样拉仇恨
- Stalker 更灵敏:`see_hero_reload = irnd(5,10)`(167-333ms),脱战 600px(停攻击)/ 1000px(停跳跃)(`Stalker.as:1100, 1111, 1832-1837`)

### 4.2 狼的例外
**狼完全不调 `SeeHero`。** 它只用水平距离阈值(200 蓄怒 / 350 靠近 / 400 脱离)+ 朝向符号判定,**没有 LOS 遮挡检查** —— 一旦这只狼被 unfreeze,它永远知道你在哪。这是刻意的:狼是竞技场遭遇战的角色,不是巡逻兵。

### 4.3 落地建议
- **不要做视野锥**。In2 全程没用,加了只会让玩家困惑"我明明在它侧面"。用**圆形距离 + LOS 射线**。
- **必抄节流**:LOS 射线 **每 333-667ms 查一次 + 随机相位**。同屏 10 个敌人时这是 10-20× 的省钱,而且"敌人反应有 0.3-0.6s 延迟"恰好是好手感。
- **必抄计数器语义**:`framesSinceSeen`(或秒)代替布尔,**失去目标 = 2 秒**,期间继续朝最后已知位置行动。
- **挨打 = 强制索敌**,无视 LOS。
- 生物敌人A 若是"竞技场遭遇战"定位,可照狼一样**免除 LOS**;若是关卡常驻怪,加 LOS。

---

## 5. 受击反馈(狼)

| 项 | In2 事实 | 出处 |
|---|---|---|
| 硬直 | **没有硬直**。`pain = 2` 帧 = 67ms,**只驱动红色 colorTransform 闪光**,不影响移动、不打断攻击 | `:2770, 1551-1557` |
| 受击动画 | `pain1`/`pain2` 随机二选一,但**仅在 `!biting && turning < 0` 时播** = **攻击中与转身中霸体** | `:2772-2782` |
| 物理击退 | 子弹力 `ApplyForce(damagex, damagey)` **真实作用在刚体上**(`Man.as:1161`)—— 狼会被打得后仰/滑动,但状态机不变 | `Man.as:1149+` |
| 仇恨 | 每次受击 `++anger`;`damage >= 40` 时 `++fear`(fear 死代码) | `:2785-2789` |
| 音效节流 | `growl_reload = irnd(15,25)` 帧(500-833ms)才允许再吼一次 | `:2791-2794` |
| 死亡 | `Ragdollize()`:拆关节 → 全身刚体获得 `normalize(damagex,damagey) * 10` 速度 → 头变 r=16 圆体;尸体寿命 `rnd(30000,45000)` 帧 ≈ **1000-1500 秒(等于永久)** | `:2128-2186` |
| 玩家侧对照 | `Man.Damage()`:`pain = 10` 帧 = **333ms**(玩家的硬直/无敌帧) | `Man.as:590, 1190` |

### 落地建议
- **抄"无硬直 + 攻击霸体"**。这正是我们要的"高速低血冲脸怪":它靠**不会被打断**制造压力,靠**低血**保证公平。反过来,给了硬直,高速怪就变成"贴脸就被打回去"的免费经验。
- 受击反馈全靠 **67ms 红闪 + 物理位移(小幅度速度冲量)+ 节流的吼叫音效**。运动学控制器:受击加一个 `hitImpulse` 到速度上并在 100-150ms 内衰减,**永不改状态**。
- **音效节流器必抄**:同一个 SFX 至少 500ms 间隔,否则连射时怪叫会糊成一片噪音。
- 死亡按我们红线走"瘫倒 ragdoll → 消散能量光点",但**致命一击的 `damagex/damagey` 要喂给 ragdoll 初速度**(这是 In2 让死亡姿态跟着子弹方向变化的唯一手段,零成本高回报)。

---

## 6. 动作剪影 / 形体状态 —— 对应"蛰伏 / 警觉 / 扑击 三剪影"

### 6.1 In2 的做法:**没有位图**

`ffdec-test/` 2629 张图里 wolf / snake / worm / creature / beast / spider 六词命中 **0 张**;扩展到全部已确认类名后仅命中 2 张:`962_killerfish_tex_killerfish_tex.png`、`5580_stalker_aguide_tex_stalker_aguide_tex.png`。**In2 角色是纯矢量 MovieClip,形体状态只能从时间轴标签名反推。**

狼由 `wolf.as`(symbol2181)声明 10 个部件:`head / neck / tors / back / tail / leg1-4 / anim / body_joint`。

**结构性发现**(`Wolfrider.as:2204` `sprite.anim.visible = false`):有一个**不可见的主时间轴 `anim`**,上面只放 `foot1-4`、`head` 等标记点;可见的腿/头/躯干**全靠三段 IK(`IKArmBodies.TripleSegment(0.5,1)`)去追这些标记点**。即:**关键帧动画只提供"目标点轨迹",实际渲染是程序化 IK。** 这是我们 `CharacterRig` 管线可直接借鉴的分工。

### 6.2 状态 ↔ 时间轴标签对照表(全部 `gotoAndPlay` 调用点)

| 设计意图 | `anim_action` | `sprite.anim` 标签 | `sprite.head` / `neck` | 出处 |
|---|---|---|---|---|
| **蛰伏**(无目标游荡) | `STATE_IDLE` + `do_walk=true` | `"walk_start"` → 步态 | head `"idle"` | `:1477, 503` |
| **警觉/凝视**(action 0) | `STATE_IDLE` | `"idle"` | head `"side"` | `:1490, 1997` |
| **冲锋**(action 1/2) | `STATE_GALLOP` + `do_walk=false` | `"gallop_start"` | head `"side"` | `:1481, 452` |
| **扑击/咬** | 叠加(不换 `anim_action`) | `"bite"` + `bite_lean=true` | head `"bite"` | `:540-542` |
| 起跳/滞空/落地 | `JUMP`/`FALL`/`JUMP_IDLE`/`FALL_IDLE` | `"jump_gallop"` `"jump_start"` `"fly_down"` `"front_land"` `"land_idle"` `"turn_fall_down"` | — | `:1808-1815, 1350-1369` |
| **转身**(独立大动作) | — | `"turn"` / 帧 105-130 | 4 帧 head→`front`、6 帧 neck→`front`、12 帧翻面、16/20 帧回 `side` | `:2962-3051, 1976-2007` |
| 受击 | — | 不变(霸体) | head `"pain1"`/`"pain2"` 随机 | `:2776-2780` |
| 死亡 | — | `stop()` | head `"die"` | `:2181-2182` |

状态常量:`STATE_IDLE=0 / GALLOP=1 / JUMP=2 / FALL=3 / WALK=4 / FALL_IDLE=5 / JUMP_IDLE=6`(`:63-197`)。

`do_walk = true` 只在**玩家已死**时出现(`:503`)→ 走路 = 无目标游荡;进入攻击态立刻 `do_walk = false`(`:452`)→ 疾驰 = 已索敌。**两种步态即两种警戒级别。**

### 6.3 转身是一个独立大动作
`turning` 计数 0→25 帧 = **833ms**,第 12 帧真正翻面;带 **20px 迟滞死区**(`dx*side < -20` 才触发,`:439, 464`)和"咬击中不转身"(`bite_time > 25 / 35`);转身期间不能咬(`turning < 0` 门禁)。骑手在转身后 `reloading = 50`(`:3049`)。

### 6.4 碰撞体与步态
- 躯干圆 **r=23**、后半身盒 **20×14**、四只脚圆 **r=8**(脚**不与玩家碰撞**,`foot_filter.maskBits` 只含 `WORLD+STUFF`)(`:2213-2231`)
- `density_modifier = 0.7`,腿挂点在体下 60px,三段 IK
- 步态:步长 `17*dir*rnd(0.95,1.05)` 度、抬脚半径 **40px**、悬空 5、弧度 0.4、最短步 **4 帧**;对角腿配对(foot1+foot4 / foot2+foot3)= 小跑步态(`:2892-2942, 907`)

### 6.5 落地建议
- **三剪影 ↔ 三姿态直接落地**:蛰伏 = 低姿慢走(head idle,重心低)、警觉 = 站定头部转向玩家(head `"side"` 朝向锁定)、扑击 = 躯干前倾 30° + 颈部前伸。**头/颈是独立于身体的第二层时间轴** —— 我们的 rig 已是分件的,让头部姿态独立于步态切换,是最便宜的"形体状态"表达。
- **必抄"转身是一个大动作"**:833ms + 20px 迟滞死区 + 转身期禁攻击。这让高速怪不会在玩家左右横跳时贴脸抽搐,并给玩家"绕后"这个真实的战术选项。
- **⚠️ 命中框反例**:In2 的狼碰撞体(r=23 圆)**远小于视觉轮廓**,与我们 CLAUDE.md "敌人命中框 ≥ 视觉轮廓" 的偏袒玩家原则**相反**。**按我们自己的规则来,不要抄这一条。**
- 腿不参与与玩家的碰撞 —— 这个要抄,否则玩家会被腿卡住。

---

## 7. BOSS 基建配方(后续 BOSS 要直接抄的两件)

### 7.1 `ProbabityChoose` 加权攻击选择器

**不是独立类,是 `ACEBoss.as` 的私有方法**(`ACEBoss.as:4288-4345`),全库**仅此一处定义、仅此一处使用**。其他 BOSS(GrabberBoss / Danmaku / Exoarmor)都只用 `root.choose()` / `root.chance()` 等简单概率。

**签名**
```
ProbabityChoose(weights:Array, restore:Number, decay:Number, forceSet:Array = null) : int
```

**算法**
1. 首次调用**懒初始化**:向 `weights` 尾部 push 两项 —— `-1`(上次选中 index 的占位)和**原始权重快照**
2. 累加权重轮盘赌:`r = rnd(0, sum)`,累加到 `r < acc` 命中
3. `forceSet` 非空时**直接从白名单均匀随机**,覆盖轮盘结果(用于"开场第一击"限定招式)
4. 命中项立刻 `weights[i] *= decay`(实参 **0.2**,用完降到 20% → 防连续重复)
5. 其余项每次调用 `interpolate(w, 原始值, restore)`(实参 **0.2**,约 3-4 回合"回暖"到满)
6. **残留 bug**:"上次选中 index" 从初始化的 `-1` 起从未被写回,所以排除条件恒成立、形同虚设。**没有硬性冷却名单**

**ACEBoss 的权重表**(`ACEBoss.as:385-386, 431, 484`)
```as3
attack1_probabilities = [1, 1, 0.1, 1.5, 1.5, 1, 0.5, 0.5]           // 8 招
attack2_probabilities = [1, 1, 0.1, 1.5, 1.5, 1, 0.4, 0.4, 1.3, 1]   // 10 招

ProbabityChoose(attack1_probabilities, 0.2, 0.2, n_attacks == 0 ? [0,1,2,3] : null)
ProbabityChoose(attack2_probabilities, 0.2, 0.2, n_attacks == 0 ? [8,9]     : null)
```
选出的整数喂给 `ChooseSequence1/2`(`:429-563`)再进 `Update1` 的巨型 switch。

**血量联动仅一处**(`ACEBoss.as:2194-2201`):`damage_state` 跨过 4 时,`attack2_probabilities[6] *= 0.1; [7] *= 0.1` —— **一次性永久压制"召唤援军"两招**。**没有按距离的动态权重。**

**落地建议**
- 直接实现成 `WeightedPicker` 工具类进 `src/systems/`。三个参数进 JSON:`weights[]`、`decay=0.2`、`restore=0.2`。
- 修掉那个残留 bug(把命中 index 记下来),或干脆删掉那条分支。
- **开场白名单(`forceSet`)是廉价好用的"BOSS 登场固定招式"手法,值得留。**
- 阶段推进只做"一次性永久压制某几招"的粗粒度调整即可,不必做连续的动态权重 —— In2 用最简单的方式达到了效果。

### 7.2 BOSS 双目标变焦相机 `CameraMotionAutoscale`

`CameraMotionAutoscale.as`(228 行)。链路:`CameraController`(按 weight 混合多个 motion type)→ `CameraMotionType`(位置 + scale + weight + FadeIn/Out)→ `CameraMotionAutoscale`。

**算法**
- 每个目标配一个**预测性弹簧锚点**(`Joint`,mass=10),向 `object.pos - velocity*3`(**超前 3 帧预测**,抑制高速目标追踪抖动)缓动;`joints_move_coeff = 0.3`,单帧最大步进 `border_expand_speed = 20`(`:131-192`)
- 包围盒各方向外扩 `border_w = 150` / `border_h = 100`;**相机中心 = 包围盒中点**(非质心)
- `scale = min(屏宽/盒宽, 屏高/盒高)`,再 `clamp(min_scale, max_scale)`(`:193-194`)
- **三重平滑**(`:195-209`):
  1. `interpolate_limit(cur, target, 0.25, 0.1)`(每帧 lerp 0.25、单帧变化上限 0.1)
  2. Verlet 弹簧 `Update2(0.8)`
  3. **4 帧环形缓冲、5-tap 核 `[0.1, 0.2, 0.4, 0.2, 0.1]`** 的时域加权滑动平均
- 源码里作者留了大段吐槽注释:试了 10 种变体才解决"缩放响应二阶不连续导致镜头跳变"

**各遭遇的实参** `StartAutoscale(name, speed, min_scale, max_scale, scale_speed, mouse_coeff)`

| 场合 | speed | min_scale | max_scale | scale_speed | 淡入 |
|---|---|---|---|---|---|
| ACEBoss 兜底 `ace_focus` | 0.3 | **0.25** | 1 | 0.1 | 无(常驻) |
| ACEBoss `ace_autoscale` | 0.5 | 0.85 | 1 | 0.05 | FadeIn(200, 100) |
| GrabberBoss chase2 | 0.25 | 0.25 | 1 | 0.1 | FadeIn(60, 100) |
| GrabberBoss 狂暴 | 0.25 | 0.8 | 1 | 0.1 | 旧镜头 FadeOut(0,40) 交叉 |
| Danmaku | 0.25 | 0.8 | 1 | 0.05 | — |
| **狼遭遇战 `wolf1`** | **0.2** | **0.7** | **1** | **0.1** | FadeIn(50, 200) |

**规律:`max_scale` 恒为 1 —— 双目标相机只会拉远,从不放大。** `min_scale` 按 BOSS 体型给:普通激战 0.7-0.85,巨兽 0.25。

**没有独立的"BOSS 出场停顿"类** —— 拉远揭幕全靠拉长 `FadeIn` 时长(200 帧淡入 + 100 帧停留);阶段切换用旧镜头 `FadeOut(40)` × 新镜头 `FadeIn(60)` 交叉淡化,**全程无硬切**。

**顺带的遭遇战设计事实**(`Level1_2Controller.as:176-198`):狼是**冻结待机**的,触发时同时干三件事 —— 开双目标相机、`camera_bounds.StartRightBound()` **锁住场地右边界**、`UnfreezeObj` 解冻狼。等于一个迷你封锁房间战,与我们已有的 `LockdownRoom` 装置完全同构,**生物敌人A 的首次登场可以直接复用**。

**落地建议**
- 这套相机是本次调研里**性价比最高、风险最低**的移植项(纯客户端、无物理耦合)。Phaser 用 `camera.setZoom` + 手写包围盒即可。
- 三重平滑里**至少要抄"lerp + 单帧变化上限"这两层**,系数 `0.25 / 0.1` 直接用。
- 首次亮相配 `min_scale 0.7` + 锁边界 + 长 FadeIn。

---

## 8. 一句话总结

In2 的近战生物只有狼一个完整样本,但配方非常干净:

> **AI 三态(蛰伏凝视 → 压迫交战 → 低血暴走)+ anger 蓄力 3.3s 发动 + 交战预算 10-13s 每次出手扣 2s + 500ms 前摇的一帧攻击盒(r=16px,10% 玩家血,4:3 后上击退)+ 攻击/转身霸体、受击只有 67ms 红闪 + 833ms 带迟滞的转身大动作。**

全部数值可直接换算落地。**唯二不要抄的**:①它的碰撞体小于视觉轮廓(违反我们偏袒玩家的红线);②它写了又弃用的 `fear` 逃跑逻辑(作者试过并放弃)。

**工程手法上最值得抄的三件**(按优先级):①双目标变焦相机(§7.2);②攻击盒尺寸由骨架关键帧驱动(§2.3);③LOS 射线随机相位节流(§4.3)。
