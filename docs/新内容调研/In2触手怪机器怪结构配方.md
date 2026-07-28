# 入侵者2 触手怪 / 机器怪：结构与物理系统配方

> 调研日期 2026-07-27 | 来源 `tmp-cuts/pb2/scripts/`(Intrusion 2 反编译 ActionScript,990 个 .as)| 前置 `In2近战生物AI配方.md`(狼/忍者/杀人鱼/雪蛇的 **AI 与节拍**已挖完,本文不重复,只挖**结构与物理**)
> 用途:**生化怪物方向重定** —— 用户否决"运动学人形骨架复用"版生物敌人A(太小、行动机械),点名对标 In2 的**触手怪(FloatBot)与机器怪(Spherobot / Stalker)**,要求"结构和物理系统做得和入侵者二一样"。全部数值以代码为准并标注 `文件名:行号`;Box2D 米已按 `PHYS_SCALE=30` 换算成像素。

---

## 0. 换算基准 + 一句话总纲

| 项 | In2 事实 | 出处 |
|---|---|---|
| 物理尺度 | `PHYS_SCALE = 30`(30px = 1m),`ANTI_PHYS_SCALE = 1/30` | `World.as:484, 574` |
| 重力 | `b2Vec2(0, 27)` = **810 px/s²**(我们运动学层是 1900 px/s²,**In2 比我们轻 2.35 倍**——它的"飘"有一半是重力低) | `World.as:1982` |
| 反重力常量 | `anti_gravity = (0, -gravity.y * timeStep)`,`ApplyGravity(v)` = **直接 `m_linearVelocity += v`**(是速度增量不是力) | `World.as:1988`;`Box2D/Dynamics/b2Body.as:302-308` |
| 玩家碰撞盒 | **28 × 72 px**(骑乘时 30×110) | `Hero.as:350, 1059-1060` |
| 我们的玩家 | **30 × 88 px** → 移植体型时乘 **×1.22** | `config/player.json:4` |
| 刚体/形状工厂 | `AddBody(x_px, y_px, deg, owner, linearDamping)`;`CircleDef(半径px, density, friction=0.2, offX, offY, filter, restitution=0, isSensor)`;`BoxDef(半宽px, 半高px, density, friction, offX, offY, deg, filter, restitution, isSensor)` | `World.as:5357, 4689, 2990` |
| 铰链 | `AddRevoluteJoint(bodyA, bodyB, anchorX_px, anchorY_px, 下限°, 上限°, maxMotorTorque, motorSpeed, collideConnected=false)` —— **maxMotorTorque≠0 才开马达;上下限都是 0 才关限位** | `World.as:4875-4905` |

### 总纲：In2 的怪物一律是**三层结构**,不要只看到"全物理"三个字

1. **物理骨干层(极少刚体)**:躯干 1~2 个刚体 + 端点刚体(脚 / 触手末节)。**能不建刚体就不建**。
2. **视觉层(零物理)**:腿、触手皮、尾巴的**外观**全是 `Joint`(Verlet 质点)链或 Catmull-Rom 样条,**在两个物理锚点之间求解**,不参与碰撞。
3. **目标驱动层**:AI 从不 SetPosition,只每帧挪一个"目标点",刚体用 PD 带着惯性和滞后去追。**"活"感全部来自这一层的滞后与超调。**

`Part.as` 就是第 3 层的全部工具箱,六个原语(**这张表是本文最该抄的东西**):

| 原语 | 作用 | 质量归一? | 出处 |
|---|---|---|---|
| `MaintainAngle(目标°, k, 前瞻, 翻转保护)` | `误差 = 目标 - (角度 + 角速度*前瞻/30)` → `ApplyTorque(误差*k)` | ❌ | `Part.as:187-206` |
| `MaintainPosition(x, y, kx, ky, dampX, dampY)` | `误差 = 目标 - 位置; 误差 -= 速度*damp; ApplyForce(误差*k)` | ❌ | `Part.as:208-218` |
| `MoveTo(x, y, °, k=0.75)` | 位置力 **+** 角度扭矩,双双乘 mass / 惯量 | ✅ | `Part.as:88-111` |
| `AccelerateTo(x, y, k, 速度阻尼)` | 同上但只管位置 | ✅ | `Part.as:113-127` |
| `ShiftTo2(x, y, k, 前瞻, 最大长度)` | 带**误差长度钳位**的位置弹簧(防远距离暴力拉扯) | ✅ | `Part.as:136-152` |
| `ShiftTo(x, y, k)` | 直接 **设** 速度(准运动学) | — | `Part.as:154-164` |

> **`MaintainAngle` 里的"角速度前瞻"就是 D 项**:`(角度 + 角速度*前瞻/30)` 等于预测 `前瞻` 帧后的角度再算误差。这是一个写得很省的 PD 控制器,系数是 `(k, 前瞻)` 两个数。全库所有怪的"朝向锁定"都走它。

---

## 1. FloatBot(触手怪,`FloatBot.as` 1796 行 + `SplineTentacle.as` 1186 行)

### 1.1 本体:一个圆 + 一个正弦呼吸

| 项 | 值 | 出处 |
|---|---|---|
| 本体刚体 | **圆 r=30px**(直径 60px = 0.83 倍玩家身高),density **7**,friction **0.05**,linearDamping **0.05** | `FloatBot.as:307-308` |
| 质量 | 7 × π × 1m² ≈ **22 kg**(同尺寸玩家胶囊量级的十几倍 → 打不动,只能靠触手拉扯) | 推算 |
| HP | 本体 **340**,每条触手 **180** | `FloatBot.as:355, 320` |
| 触手数 | **3**(同时最多 `max_tentacles_active = 2` 参战) | `:311, 357` |
| 出场协议 | 关卡里按 sprite 名传参:`{id}_background` / `_gate_{门id}` / `_off` / `_script_{脚本}` / `_spawnif_{key}` / `_negativeshift`;1-2 关放了 4 只 | `:369-397`;`level_1_2.as` |

**悬浮 = 反重力 × 正弦**(全部四个状态函数里逐字重复同一行):

```as3
v = anti_gravity.Copy();
v.y *= 0.9 + Math.sin(time * 0.2) * 0.3;   // 系数在 0.6 ~ 1.2 之间摆
body.ApplyGravity(v);                       // 本体
for (t of active_tentacles) t.ApplyGravity(v); // 每一节触手也吃同一个数
```
`FloatBot.as:198-205, 897-906, 1073-1082, 1432-1441`

- 净竖直加速度 = `g × (1 - 系数)` ∈ **[-0.2g, +0.4g]** = **[-162, +324] px/s²**,周期 `2π/0.2 = 31.4 帧 = 1.047 s`。
- **关键**:同一个数也喂给每一节触手 → 触手跟着本体一起"吸气呼气",但因为各节质量/阻尼不同,**相位天然错开** = 免费的软体感。

**移动 = 目标点 + 弹簧 + 逐帧速度衰减**(`FloatBot.as:1472-1512`):

| 项 | 值 |
|---|---|
| 站位目标 | `destx = lerp(destx, hero.x + hero_shift_x, 0.3)`;`desty` 同理 |
| 站位偏移 | `hero_shift_x = -sgn(旧) × rnd(190,280)`(**每次换边**),`hero_shift_y = rnd(-140,-200)`;每 `irnd(60,150)` 帧重掷 (`:575-580`) |
| 高度硬约束 | `desty ≥ ground_y-450`、`≤ ceiling_y+100`;玩家在上方时 `desty = max(ground_y-750, hero.y-200)`;有水的关卡 `≤ 水面-300` (`:1488-1497`) |
| 推力 | `F = (dest - pos) × 8`,**y 分量再 × `gravity_ratio_sqr`**(重力变化时自动配平) (`:1502-1504`) |
| 追赶加成 | `|hero.x - x| > 500` 时 `F.x += sgn × 100`(**掉队才加速**,不是恒定速度) (`:1505-1508`) |
| 阻尼 | 每帧 `vx *= 0.8`、`vy *= 0.9`(x 更黏 = 横向更稳、竖向更飘) (`:1510-1511`) |
| 限速 | `vx ∈ [-32, 32]` = **960 px/s** (`:1512`) |
| 姿态 | `MaintainAngle(朝玩家角 + 180 + 30, k=8, 前瞻 0.95)` —— **恒定偏 30° 的歪头**,是它"活物"剪影的全部 (`:1474`) |
| 地面/天花板探测 | 向下射线每 **16 帧**一次(角度 `90 - 30*move_side`,长 1000px);向上射线 `-90 + 45*move_side` (`:1314-1344`) |

### 1.2 触手结构:**4 个刚体 → 12 段样条**

`fbt_tentacle` 符号里声明 `bod1..bod4` + `joint1..joint4` + `s1..s12`(`fbt_tentacle.as`)。构造器按名字数出来(`SplineTentacle.as:129-133`)——**节数是美术在时间轴上加一个 `bodN` 就能改的,代码不用动**。

| 项 | 值 | 出处 |
|---|---|---|
| 物理节数 | **4** | `fbt_tentacle.as` |
| 每节刚体 | **盒**,半宽/半高 = `bodN.scaleX × 50` / `bodN.scaleY × 50` px(**尺寸由美术缩放标记 MC 决定**) | `SplineTentacle.as:146` |
| density / friction / linearDamping | **0.85 / 0.1 / 0.5**(默认参数,FloatBot 用默认) | `SplineTentacle.as:113, 145-146` |
| 根关节 | `Revolute(本体, bod1, 根点, **-30°..+30°**, 马达扭矩 **25**, 马达速度 **0**)` | `SplineTentacle.as:153` |
| 节间关节 | `Revolute(bod[i-1], bod[i], jointN 位置, **-80°..+80°**, 马达扭矩 **25**, 马达速度 **0**)` | `SplineTentacle.as:159` |
| 渲染 | `SplineConstruction`:5 个控制点(4 节 + 根锚) → **Catmull-Rom(张力 0.7)重采样成 13 个输出点 → 12 个 `s1..s12` 段精灵** | `SplineConstruction.as:132-180`;`SplineTentacle.as:137, 1032-1040` |
| 枪口位置 | `gun_sprite.matrix.transformPoint(barrel)` —— **从渲染出来的样条读**,不是从刚体读 → 视觉与判定永不脱节 | `SplineTentacle.as:1056-1060` |
| 抓取判定盒 | **静态共享 AABB 25×25 px**,摆在枪口,与玩家 28×72 AABB 重叠即可抓 | `SplineTentacle.as:13, 575-584` |
| 触手受伤倍率 | `dmg_mult = 2`(受击**击退力**双倍,不是伤害);`DMG_BEAM` 伤害 ×0.7 | `SplineTentacle.as:186, 693-695` |

> **"马达速度 0 + 扭矩 25"是关键手法**:这不是驱动,是**旋转阻尼器**——关节最多用 25 的扭矩抵抗任何转动。空闲时触手就是被动垂挂+轻阻尼摆动,**"活"完全免费**。

**触手垂直够得着多远**:抓住玩家时本体维持 `ground_y - 340`、被抓的玩家被压到 `≤ ground_y - 120`(`FloatBot.as:464, 473`)→ **有效伸展 ≈ 220 px ≈ 3 倍玩家身高**,4 节 → 每节约 **55 px 长**(半长 27.5 → `bod.scaleX ≈ 0.55`)。

### 1.3 触手怎么"动":三种模式,全是马达 + 反作用力

| 模式 | 实现 | 出处 |
|---|---|---|
| **空闲垂挂** | 所有关节马达 `速度 0 / 扭矩 25` = 纯阻尼,被动摆 | `SplineTentacle.as:152-159, 502-513` |
| **蜷曲 `StartBend(扭矩, 速度)`** | 所有关节**同一个**马达速度 → 整条整齐卷起。实参:攻击预备 `(150, ±10)`、抓取预备 `(100, ±3)`、抓住后拉扯 `(100, -joint_speed)` | `:820-834`;`FloatBot.as:1547, 1666, 489` |
| **回直 `StartStraighten(扭矩, k)`** | 每帧 `SetMotorSpeed(-k × 该关节当前角)` = **每个关节一个比例回正弹簧**(Stalker 扫尾用 `(400, 10)`) | `:1062-1072` |
| **末端追点 `MoveTentacle2(t, x, y)`** | `t.end.MaintainPosition(x, y, 1, 1, 0.8, 0.8)`,末端速度钳 `±7`(210 px/s);**返回的力取反施加到本体上** —— 手工牛顿第三定律:**触手够远,本体被拽过去** | `FloatBot.as:1409-1416` |

> `MoveTentacle2` 的反作用力那一行是整个 FloatBot 最值钱的两行代码。它让"伸手够玩家"这个动作**自动带出本体的前倾与位移**,不需要任何额外动画。

### 1.4 攻击链与抓取链(`Balance1()` 的 `action` 状态机,`FloatBot.as:1523-1787`)

**射击线 0→1→2→3→4→5**:0 待机 → 1 选 1~2 条触手(**首发只用 1 条**)+`StartBend(150, ±10)`+偏移 `(±120+rnd(-30,30), rnd(10,40))`,`irnd(14,17)` 帧 → 2 `SegmentsPlay(50-i*10)` 段动画错峰 + `open_gun`,14 帧 → 3 瞄准(末端目标 `lerp(偏移点, hero, 0.2/0.1)`,`attack_angle` 以 `0.3×enemy_target_k` 追玩家,`end.MaintainAngle(角, 12, 0.8)`),`41+(n-1)*10` 帧 → 4 每 **20 帧**一发 `EnemyPlasmaBolt(速16/伤10/寿命100)`,**后坐力 `ApplyForce(-弹速×10)` 打在触手末端** → 每发都把触手震歪 → 5 收枪 + 重掷站位,`irnd(20,30)` 帧;**50% 概率 + `hero.can_be_grabbed`** → 转抓取线。

**抓取线 50→51→52→53**:50 全部触手参战 + `StartBend(100, ±3)` 轻卷,站位 `(±rnd(240,290), rnd(-150,-200))`,`irnd(60,80)` 帧 → 51 倒数到 20 时 `open_claw`(**张爪预告**),结束后 `threat` 姿态、站位改成 `(±1, -100)` = **直接压到玩家头顶 100px**、`dest_interpolation_coeff` 降到 0.1(逼近变慢=压迫感),`irnd(120,200)` 帧 → 52 猎捕:末端直接 `MoveTentacle2(hero.x, hero.y)`,`attack_angle` 先以 0.25 追玩家、**再以 0.25 拉向水平** = 爪子始终横着张开,每帧 `CanCatchHero()` → 53 抓住。

### 1.5 抓取协议(`AskCatch`)—— 敌人不碰玩家状态,只发请求

`Hero.AskCatch(x, y, 隐藏精灵, 抓取者, 移除玩家刚体=true, 相机缩放=1.25, 脱身动作="fall", 脱身帧="duck_fall") : Boolean`(`Hero.as:539`)

Hero 侧自检 `controls_locked || !can_be_grabbed || catched || weapon_locked_time>0` 就拒绝(`:541-544`);同意则**删掉玩家自己的刚体**(`:565-566`)、隐藏精灵只留围巾、`StartFollow("catcher", 抓取者, 0.85, 1.25, 0.1, 0).FadeIn(30,100)`、`click_rate = 0` 起挣扎计量。

FloatBot 侧(`:1721-1757`):新建**玩家代理刚体** `CircleDef(28, 0.07, 0.1)` + damping 0.5(**r=28px、密度极轻**),`AddRevoluteJoint(触手末节, 代理体, 枪口, -10°, +10°)`(吊着只能晃 ±10°),立刻 `end.ApplyForce(1200 沿末端朝向)` = **抓住瞬间的"拽回来"冲量**;`catched_shot_delay = 110` 帧 = **3.67 秒处决倒计时**;玩家狂点的 `click_rate` 映射成爪子动画帧 `limit(click_rate*40/100 + 80 + irnd(-3,3), 80, 120)`(**挣扎强度可视化,还带 ±3 帧抖动**);每 `rnd(50,100)` 帧 `StartBend(100, -joint_speed)` 反卷一下 = **甩动被抓的玩家**。
结局二选一:**挣脱** `BreakOut()`(`:146-190`,该触手报废 + 掉 3 块 gib + 200 分)/ **处决** `BreakFail()`(`:817-854`,`Damage(0,0,**20**, DMG_BEAM)` + 沿末端角以速度 20 抛出)。

### 1.6 断触手与死亡

**打断在你打中的那一节**(`SplineTentacle.FBT_CheckBroken`,`:388-451`):`life ≤ 0` 时查 `last_damaged_body` 是第几节,从那里 `Break()` 切开 → 新建 `SplineTentacle` 承接后半段(`:586-659`),后半段接手原刚体但**所有关节 `EnableMotor(false)`、`linearDamping = 0`**、类别改 `COLLIDE_STUFF` → 变成一根真死物理棍;断口两侧各 `ApplyForce(±500)`;断面精灵切 `damaged4/2/1` 三级(**离断口越远越轻**)+ 4~8 次错时电火花。

**本体死亡**(`:1201-1300`):`exploding = 40` 帧倒计时脚本 —— 帧 32/28/24 让三条触手各 **50% 整条脱落成自由体 / 50% 烧焦留在身上**;帧 30 掉主残骸;每 10 帧一团烟、每 8 帧一次爆炸贴图;死亡初速 = `limit(致命伤方向 × 0.2, ±10)`。
**触手全断但本体还活着**:42 帧后 50% 直接死,50% 播 `die1` 并把 `linearDamping` 归零 → **失去动力笔直坠落**(`:1345-1379`)。

### 1.7 落地要点(完整方案见 §6)

本体走**运动学锚**,触手走**真 Matter 刚体链(4 节)+ 12 段 Catmull-Rom 渲染**。三件必抄:**呼吸式反重力**(周期 1.05s、系数 0.6~1.2,连触手一起吃)、**`MoveTentacle2` 的反作用力**(伸手把自己拽过去)、**枪口/爪锚点从渲染样条读**。抓取一律走 `AskCatch` 协议;断触手断在"最后被打中那一节",后半段交 `GibSystem`(机器类可断肢符合红线)。

---

## 2. 腿式机器怪:**In2 的腿根本不是关节链**

这是本次调研最反直觉、也最该抄的一条。

### 2.1 三件套:躯干刚体 + 脚点刚体 + 两根弹簧;腿是纯视觉 IK

`Wolfrider.AddFoot()`(`:895-937`)与 `Exoarmor_2.AddFoot()`(`:1115-1134`)是同一个模板:

```as3
foot = new Foot(null, 腿精灵, root);                    // 脚 = 一个圆刚体,fixedRotation
foot.body = AddBody(x, y, 0, foot, damping);            // 狼 0.8 / 机甲 0.2
foot.body.CreateShape(CircleDef(r, density, friction, 0,0, foot_filter));
//   狼 r=8 / density 3×0.7 / friction 1.0 (Wolfrider.as:904);机甲 r=10 / 10 / 0.1 (Exoarmor_2.as:1122)
foot.min_step_time = 4(狼) / 3(机甲);  foot.linked_body = 躯干刚体;

// 悬挂 = 两根软弹簧,分别接前后躯干(主承重那根 r*=0.9,另一根 k 降到 0.1、锚点 y+1)
new AnchorLinkBodDampfer(body1|body2, foot.body, k=0.4, k2=0.4, 锚1, 锚2, damping=0.5); // :911-929

// 腿的"骨头"——只是画出来的
new IKArmBodies(髋, 腿精灵, 躯干刚体, foot.body, 髋偏移, 脚偏移).TripleSegment(0.5, 1);
//   狼=三段;机甲/忍者/持枪手臂 = .DoubleSegment(0.5, 1) 解析二骨
```

**`IKArmBodies.Update()` 全文只有 4 行**(`IKArmBodies.as:45-53`):读躯干上的髋世界点、读脚刚体的世界点、`Align(髋, 脚)`、跑 IK。
`Align()` 会把脚目标**钳制在腿总长 `r` 之内**(`IKArm.as:270-286`)——腿伸直就锁住,永远不会拉长。

**`TripleSegment(d, frames)`**(`IKArm.as:153-177`):建 4 个 `Joint`(Verlet 质点),两端 **mass = 100000**(=钉死),中间两个 **mass = 1**(自由),3 根 `LinkSprite` 距离约束,链节长度 `r` 从美术摆的 `s1..s4` 间距自动读出。求解 = **4 次松弛迭代**,横向张开量 `spread` 钳在 **[4, 1000] px**、轴向钳在 `[2, ik_length-2]`(`IKArm.as:325-402`)。
- **`d` = 膝盖凸出的"极向量权重"**,把横向偏移按 `d : 1-d` 分给两个中间关节;`d=0.5` = 对称。**不是**长度(`IKArm.as:371-379`)
- **`frames` = 腿部件 MC 的帧数**,只用来按 `side` 做左右侧的深浅换帧;全库所有调用都传 `1` = 关掉
- **全库只有狼一处用 `TripleSegment(0.5, 1)`**;机甲/忍者/持枪手臂全用 `DoubleSegment(0.5, 1)`(**解析二骨 IK**,`IKArm.as:60-131`)。`Danmaku` 用 `DoubleSegment2(arm11, arm12, 13.4, 13.4, 0.5)` 显式给链长

**`Joint` = 标准 Verlet 质点,默认阻尼 0.85**(`Joint.as:46-56`)。全库 **32 个文件** `new Joint(`、15 个用 `LinkSprite` —— 围巾、绳索、桥、布料、IK 腿、相机变焦锚点,**全部同一个质点原语**。

> **结论:一只四足机器怪的物理只有 5 个刚体(1 躯干 + 4 只脚圆),外加 8 根弹簧。腿是零成本的 Verlet 视觉。** 我们的混合控制范式和它天然同构。

**两套"IK"必须分清**(agent 交叉复核结论):`IKArm` = 像素空间 Verlet,**纯化妆**,零 `SetXForm`/零马达;`Foot`/`Limb` = 真 Box2D 刚体,**承重**。两者一辈子只在一行相遇:
```as3
iks[i].Align(髋x, 髋y, 时间轴脚标记.x, Math.min(时间轴脚标记.y, 物理脚.y));  // Wolfrider.as:2956
```
那个 `Math.min` 就是**"画出来的腿永远不许伸到物理脚下面"** —— 全部"视觉服从物理"的契约就这一个字。**必抄。**

### 2.2 步态:摆动脚**绕对侧脚画椭圆弧**(不是时间轴关键帧)

`Foot.StartStep(对侧脚, 步速°/帧, 步半径px, 悬挂, 弧度)`(`Foot.as:198-224`)+ `Foot.Update()` mode 2(`Foot.as:384-427`):

```
step_angle 起始 = atan2(自己 - 对侧脚)          // 从当前相对位置起摆
每帧: current_step_speed = lerp(current, step_speed, 0.8)   // 步速自身有个 0.8 的软起步
      step_angle += current_step_speed
      integral_step_angle += |current_step_speed|
      current_step_r = lerp(current_step_r, step_r, 0.2)     // 半径慢慢张开
      目标 = 对侧脚位置 + current_step_r * (cos θ, sin θ * step_arc)
      本帧速度 += (lerp(位置, 目标, 0.5) - 位置) * 30
      速度.y -= gravity_y                                     // 摆动中的脚【免重力】
      damp_speed = -0.95 * 本次施加                            // 下一帧撤销 95% → 位置控制而非动量累积
结束: 落地 && step_time > min_step_time → Fix()(速度归零=踩实)
      或 integral_step_angle > 4.7 rad(269°)→ 放弃,转 mode 0 找地
```

三种 mode:**0 = 悬空找地 / 1 = 踩实(Fix,速度清零) / 2 = 摆动**。
狼的实参(`Wolfrider.as:2922-2939`):步长 `17° × dir × rnd(0.95,1.05)`(**每步随机 ±5% = 步态噪声**)、步半径 **40px**、悬挂 5、弧度 **0.4**(压扁的椭圆)、`min_step_time = 4` 帧;**对角配对 foot1↔foot3、foot2↔foot4** = 小跑步态。默认值 `step_r = 100, step_arc = 1, min_step_time = 10`(`Foot.as:97-105`)。

> **修订前一份调研的一条**:狼的步态**不是**从不可见时间轴读脚标记点,而是这个"绕对侧脚画弧"的程序化算法;时间轴 MC 只提供初始锚点和腿的贴图分段。

### 2.3 Spherobot(球形机器怪,`Spherobot.as` 1637 行)

**先确认身份**:`level_1_1.as` 里有 **8 个 `spherobot_snow_spawner`**、`level_1_2.as` 里还有 4 个(而 `float_bot_spawner` 4 个、`enemy1_spawner` 12 个)—— **用户记忆里"第一关围攻玩家的蜘蛛形机器人"就是 Spherobot**:从雪里弹出的球,开壳变四足。
`spherobot_2.as` 符号声明 `leg11 / leg21 / leg31 / leg41` + `body` + `explosion` = **4 条腿**;`Spherobot.as:1224` 有 `new Foot(...)` → **走 §2.1/§2.2 同一套脚点+IK 步态**。

**三个必须纠正的先入观**(实读源码后):①**没有喷焰飞行形态**,只有 `FORM_QUADROPOD=1` / `FORM_BALL=2` 两个形态常量(`Spherobot.as:33, 75`),全文件无推进器/重力补偿代码;②**腿没有 IK**,视觉靠 `AlignFoots()` 的"像素差当角度"土法对齐(`:1557-1573`);③**没有蜂拥系统**,同屏硬上限 2 只。

| 项 | 值 | 出处 |
|---|---|---|
| 主球刚体 | 圆 **r=25px**,density 4,linearDamping 0.5,**angularDamping 0**;friction **四足 0.2 ↔ 球态 1.9**、restitution 0→0.5 | `Spherobot.as:751-756, 691-692` |
| 脚 ×4 | 圆 **r=8px**,density **10**(比球重!),friction **2.0**,linearDamping 0.9,`fixedRotation`;mask **只含 WORLD+STUFF**(打不到也挡不住玩家) | `:752, 1225-1228` |
| 腿约束 | `AnchorLinkPullBod(球, 脚, k=**0**, k2=**50**, 锚 (±30,31)px, r=**20px**)` = **只拉不推的软绳** + `LinkPushBod(对角脚对, k=**80**, r=**50px**)` = **只推不拉的撑杆**;每帧迭代 2 次 | `:1234-1236, 772-777` |
| 姿态 `Balance()` | `MaintainAngle(落地脚连线角, 16, 0.9)` + `MaintainPosition(脚均位, 脚均高 **-40px**, 10, 10, 0.75, 0.75)`;**反作用力 -0.8/踩实脚数 打回每只脚** | `:1346-1406` |
| 步态 | 步速 `20°/帧 × rnd(0.95,1.05)`、步半径 **30px**、**`step_arc = 1`(正圆)**、`min_step_time` 3;对角小跑 | `:285-292, 1230` |
| HP / 碾撞 | 100 / 速度 >10m/s 时伤 **10** `DMG_PHYSICAL`,撞完自身 `v*=0.2, ω*=0.2` | `:120, 892-900` |
| 炮塔 | **纯 sprite 无刚体**;瞄准 `interpolate_angle(0.07)`、俯仰限 **-80°~+30°**;每轮 3 发间隔 5 帧,轮间 `rnd(90,120)×难度`;`EnemyBullet(速12, 伤10, 力40)`;后坐 `ApplyGravity(-弹速×0.25)` | `:447-486` |
| 滚动 | **靠力矩**:巡航 `ApplyTorque(sgn(ω)×50)`、加速 ±400,**ω 上限 15 rad/s**;真正定速的是**切向牵引修正**(目标 10m/s=300px/s,平地增益 0.125、斜坡 0.5) | `:168-224, 226-236` |

**形态切换 = 换属性,不 destroy/create 刚体**(最值钱的一条):折叠 23 帧、展开 30 帧,全程只有那一个圆刚体。折叠期每帧 `ω*=0.85, v*=0.85` 刹车、**四只脚被 `SetXForm` 传送到球心并清零速度**(腿在物理上"被删除"),phase=1 时 friction 0.2→1.9、`store_contacts` 打开;展开反之,第 4 帧 friction 还原、第 **14 帧 `bulletproof=false`**(破绽窗口)、phase≥1 时腿约束与 `Balance()` 才恢复(`:614-718, 1408-1505`)。
**无敌窗口是变形动画的一部分**:折叠 ≥17 帧、展开 <14 帧、转身 18~24 帧(`:652, 1473-1475, 397-403`)。**失衡即缩球**:任一对角脚对同时离地 → `do_transform_ball`(`:309-312`)—— **用步态状态而非血量/距离驱动形态切换**。
**"围攻"的真相**(`Level1Controller.as:238-253, 358-400`):唯一的波次脚本 `Trap1` = **2 + 2 共两波,波内间隔 60 帧,且必须等前波全灭**。"群"的观感来自**两只同时从两侧滚来 + 变形展开 + 步态噪音**,不是数量。
死亡:`Die()` 每条腿 25% 概率炸成 `SpherobotLegGib`(两段刚体 + ±20° 膝关节,抛射 300~600px/s,寿命 8~12s),其余转 `RagdollLeg()`(髋刚体 mass 0.1 + 髋 0~36° / 膝 ±45° 两个 revolute);主球 mask 归 0 换成 36×36 盒;前 20 帧**每帧翻转 `ω = rnd(7,16)×±1` 抽搐**(`:926-1015, 813-884, 1516-1555`)。
(顺带:`SentryGun` 是固定三脚炮台,`leg1/leg2` 只是 ±5° 限位支腿,不是行走单位;`junk_sentry_leg` 是场景垃圾道具。)

---

## 3. Stalker(BOSS 级爪怪,`Stalker.as` 3665 行)—— **最像"活物"的那个,而且没有 IK**

作者自己在代码里留言(`Stalker.as:290-302`):"灵感来自《BLAME!》的爬行仿人机械体……**那种抽搐感其实完全是意外**……我自己都惊讶算法这么短"。**这就是本次调研的核心答案:In2 的"活"不是做出来的,是"永远追不上被钳位的目标"涌现出来的。**

### 3.1 刚体清单(总共 **3 躯干 + 4×2 肢 = 11 个刚体**,外加 4 节尾)

| 部件 | 形状 | 尺寸 px | density | friction | 质量 | 出处 |
|---|---|---|---|---|---|---|
| `butt` 后段 | 盒 | **64 × 34** | 2.25 | 0.2 | 5.44 kg | `Stalker.as:2178-2181` |
| `torso` 前段 | 盒 | **80 × 38** | 3.0 | 0.2 | 10.13 kg | `:2183-2186` |
| `head` | 圆 | **Ø48** | 1.05 | **0** | 2.11 kg | `:2188-2191` |
| 肢上节(股/肱) | 盒 | 90 × 24,局部偏移 (+32,0) | 0.5 | 0.5 | 1.2 kg | `Limb.as:1097-1099` |
| 肢下节(胫) | 盒 | 60 × 24,偏移 (−47,0) | 0.5 | 0.5 | 0.8 kg | `Limb.as:1104` |
| **爪 `palm_shape`** | 圆 | **r=15** 挂在下节原点 | 1.0 | 0.5 | 0.79 kg | `Limb.as:1102-1103` |
| 尾 ×4 | 盒 | `scaleX*50 × scaleY*50` | **0.5** | **0.9** | — | `Stalker.as:2229` |

全部 `linearDamping = 0.015`;整只怪共用一个**负 groupIndex** → **自己所有部件互不碰撞**(`:2177`)。尾巴的 mask 特意去掉 PLATFORMS → **尾巴穿平台**(`:2227`)。**全身没有一个 sensor**,伤害区全靠碰撞回调 + filter。

### 3.2 关节图:**姿态不是马达做的**

| 关节 | 连接 | 限位 | 马达 |
|---|---|---|---|
| J0 | butt ↔ torso | ±90° | 开,扭矩 **10**,速度 0 = **纯关节摩擦** |
| J1 | torso ↔ head | ±80° | 开,扭矩 **20**,速度 0 |
| 膝 ×4 | 上节 ↔ 下节 | **无限位** | **关**(靠直接写 `m_torque`) |
| 挂点 ×4 | torso/butt ↔ 上节 | 无 | 关 |
| 尾根/尾节 | ±30° / ±80° | 扭矩 25,速度 0 | 同 SplineTentacle 默认 |
`Stalker.as:2193-2196`;`Limb.as:1107-1114`

姿态全部由 `Part.MaintainAngle(世界目标角, 增益, 前瞻)` 每帧施加**绝对世界角扭矩**:躯干目标 = `地面角 + (90 ± 30)·side`(butt −30 / torso +30 → **前后段天生反向拧,这就是它那个佝偻姿态**),增益 **落地 40 / 腾空 10**、前瞻 1.8;头 `MaintainAngle(瞄准角, 12, 0.5)`、转头限速 **7.5°/帧**(`:2265, 2277, 2728, 3437-3439`)。

四肢分挂两段:leg1/leg3 挂 torso,leg2/leg4 挂 butt,`bend_side` 交替 ∓1,渲染深度 12/11/1/2(**两条在前景两条在背景**)(`:2200-2215`)。

### 3.3 腿:**没有 IK,靠"动态焊接"走路**

- **驱动** `Limb.MoveTo(x, y, 增益, 前瞻)`:力 = `(lerp(v, 目标−(位置+v·前瞻), 增益) − v)·mass/timeStep`,**并把这股力取反施加到 `attach_body`**(踩在静止地面时 ×0.5)—— 腿蹬躯干、躯干反推腿(`Limb.as:302-326`)。
- **落地 = 现场造一个 revolute joint 把爪子焊到刚踩到的任何东西上**(`Limb.as:1011-1062`),**关节反力 > 4000 就自己断开**(`:990`)。**这一个技巧换来了零特判的爬墙 / 走天花板 / 踩移动平台。**
- 膝盖 `Bend(deg)` 增益 30 / `Straighten()` 增益 100,直接写 `m_torque`(`Limb.as:1211-1217, 1290-1296`)。
- **步态**:同时最多 **2 条**腿摆动;锚定脚 = 最靠前那条踩实的;迈步脚 = 与锚定脚距离最接近 **80px** 的那条;步半径 **85px**;摆动轨迹是一条 **7 控制点 Catmull-Rom(ease 0.7)**、20 帧 ≈ **0.67s**;重选冷却 10 帧(`Stalker.as:2839-2936`;`Limb.as:260-295`)。
- **躯干高度不是弹簧关节,是一个被钳位的 PD 力**(`Stalker.as:2631-2734`):
  `目标 = 本段各腿平均位置 + 地面法线·(dh·height_coeff·duck_coeff) + 地面法线·(60·抓人量 + **6·sin(t·0.5)**)`,
  `力 = ShiftTo2(目标, k, 前瞻 2 帧, **误差长度钳位 10px**)`;`dh` = **butt 80 / torso 115 px**;`k` = 有腿踩实 0.5 否则 0.25;`height_coeff` 走 1 / 蹲 0.5 / 起跳 0 / 转身抓人 1.5。**那个 ±6px、0.42s 的正弦就是它的"呼吸"。**
  这股力的反作用**按踩实腿数均分打回地面刚体**(`:2701-2727`)。

### 3.4 尾巴:**扫尾里没有一丝尾巴扭矩**

尾巴就是一条 `SplineTentacle`(`Stalker.as:2229`,HP **600**、接触伤 20、`damage_force` 1500)。
- **致命判定纯速度门控**:每帧 `SetEndDangerous(末两节平均速度 > damaging_velocity=10)`;致命时末两节开 `SetBullet(true)`(CCD),只有**最后三节**的碰撞算伤害;命中玩家 `damage_reload = 40` 帧,击退 = `冲量长度·200 + 100`(`SplineTentacle.as:742-761, 905-912, 1086-1091`)。
- **360° 扫尾 = 整只怪翻跟头**:`d_surface_angle` 每帧 **−9°** 连续 **40 帧 = 360°**,躯干姿态伺服追这个旋转目标,**尾巴纯靠惯性被甩出去**;唯一的主动输入是第 20 帧 `tail.StartStraighten(400, 10)` —— 每个尾关节 `SetMotorSpeed(−10 × 当前关节角)` 逐帧重算,**把尾巴瞬间绷直读作刀刃**(`Stalker.as:740-763`;`SplineTentacle.as:1062-1072`)。CD 130 帧,触发距离 < 500px。
- **断尾**(HP≤0,`FBT_CheckBroken(2, 500)`):从**最后被打中那一节**断,断掉 1~2 节;断下来的那段所有关节 `EnableMotor(false)`、`linearDamping=0`、类别改 `COLLIDE_STUFF`、`life=100` → **变成一根玩家还能继续打的自由物理棍**;断口两侧各 500N 弹开;残端 `life` 重置 200 且 `SetEndDangerous(false)`(**断了就不再扫伤**)(`SplineTentacle.as:419-449, 1135-1183, 586-659`)。

### 3.5 抓取与断肢

- **抓取不焊玩家**:`AskCatch` 通过后 `root.hero = null`,新建 **r=28px / density 1 / damping 0.5** 代理圆体 + `AddRevoluteJoint(下节爪体, 代理体, 爪位, ±90°)`;爪被力驱到 `catch_hold_pos`(增益 0.25、前瞻 5),该点在躯干局部 `(130,20)` 且沿法线 ≤ **230px**;挣扎失败(`catched_sequence ≥ 89`)= **20 伤 + (2000,−200) 抛出 + 半径 90 爆炸**(`:2528-2578, 2952-2979, 1421-1471`)。
- **断肢** `Limb.life = 300` → `TornOff()`:**销毁挂点关节**、膝限位放开到 ±2 rad、两节按 `damage_force×0.5`(钳 10~20)获初速、上节 `ω = rnd(−20,20)`、`life=50` 自消;离父体 **>200px 且 30 帧后**降级成普通残骸(`Limb.as:1621-1686, 586-602`)。**本体死亡反而不拆关节** —— `Ragdollize()` 只是 `do_stick=false` + 膝限位放开 + 随机 100~250 帧后松爪(`:2501-2526`)。
- ⚠️ **反例(别抄)**:`Limb.SetJointFriction()` 写的是 `m_motorForce`,但两个关节都 `EnableMotor(false)`,Box2D 每帧清零 → **全部调用点是死代码**;`Stalker.Straighten()` 定义了从未被调用。

---

## 4. In2 怪物体量谱(基准:In2 玩家 **28 × 72 px**;我们的玩家 30 × 88 px → **换算 ×1.22**)

| 怪 | 关键尺寸(px) | ÷ 玩家身高 | 质量 | 我们该做多大(×1.22) |
|---|---|---|---|---|
| 玩家 | 28 × **72** | 1.0 | ≈ 3.6~4.2 kg | 30 × 88 |
| **Spherobot 球态** | Ø**50** | **0.69** | 17.7 kg(≈4×玩家) | Ø61 |
| **Spherobot 四足** | 顶高 **65** / 展开宽 **~100** | **0.90 高 / 3.7 倍宽** | 同上 | 高 79 / 宽 122 |
| **FloatBot 本体** | Ø**60** + 3 条触手伸展 **~220** | **0.83 本体 / 3.0 触手** | ≈ 22 kg | Ø73 / 触手 268 |
| **Stalker** | 躯干 144(+头 190~210)/ 站高 **170~190**(1.5 档 200+)/ 足印 **250~330**(全伸展 450) | **2.5~2.8 高 / 5~6 长** | 28.8 kg(≈8×玩家) | 站高 **~230** / 足印 **305~400** |
| 狼(前次已挖) | 躯干圆 r=23、脚 r=8、腿挂点在体下 60 | ≈ 1.3 长 | — | — |

**结论:In2 没有"跟玩家一样高的机器怪"。** 杂兵级机器怪(Spherobot)是**矮而宽**(高 0.9、宽 3.7),BOSS 级(Stalker)是**高 2.5 倍、长 6 倍**。用户批"太小"是对的 —— 我们上一版生物敌人 A 的 46×96 只有玩家的 1.09 倍高。**生化怪物的最小可信体量:高 ≥ 玩家 1.5 倍 或 宽 ≥ 玩家 2.5 倍,二选一。**

---

## 5. "为什么它们看起来活":机制清单(按移植性价比排序)

| # | 机制 | 证据 | 成本 | 收益 |
|---|---|---|---|---|
| **1** | **PD 追一个被钳位的目标,永远追不上** —— `ShiftTo2(目标, k, 前瞻 2 帧, **误差钳位 10px**)`。误差被钳死 → 姿态永远在修正、永远不静止。作者亲口说那种抽搐"完全是意外" | `Stalker.as:2701`;`Part.as:136-152`;`Stalker.as:290-302` | 极低 | **极高** |
| **2** | **呼吸式正弦**:FloatBot 反重力系数 `0.9+0.3sin(t·0.2)`(1.05s);Stalker 站高 `±6px @ 0.42s` | `FloatBot.as:199`;`Stalker.as:2698` | 极低 | 极高 |
| **3** | **姿态服务器带"角速度前瞻"**(= D 项):`err = 目标 - (角 + ω·前瞻/30)`,`torque = err·k`。一个函数解决全部朝向锁定,自带超调与回摆 | `Part.as:187-206` | 极低 | 极高 |
| **4** | **步态噪声**:每一步 `× rnd(0.95, 1.05)`;摆动脚绕**对侧脚**画椭圆弧(弧度 **动物 0.4 / 机器 1.0** —— 这一个数就区分了兽感与机器感) | `Wolfrider.as:2892-2899`;`Spherobot.as:285-292` | 低 | 高 |
| **5** | **约束链被动摆动**:触手关节马达"速度 0 / 扭矩 25" = 纯阻尼器,不驱动。空闲时完全被动 | `SplineTentacle.as:152-159` | 低 | 高 |
| **6** | **手工反作用力**:肢体追点的力**取反打回躯干**(`MoveTentacle2` / `Limb.MoveTo` / `Balance()` 的 -0.8) → "伸手"自动带出重心位移 | `FloatBot.as:1413`;`Limb.as:302-326`;`Spherobot.as:1395-1404` | 低 | 高 |
| **7** | **少刚体多渲染段**:4 个刚体 → 12 段 Catmull-Rom(张力 0.7);腿 = 2 个刚体 → 3 段 Verlet IK | `SplineConstruction.as:132`;`IKArm.as:153-177` | 中 | 高(性能) |
| **8** | **速度注入 + 下帧回滚**(`damp_speed = -0.95×本帧施加`):看着是物理,其实是位置控制,不累积动量。外加**视觉服从物理的一行契约** `Align(髋, 标记.x, min(标记.y, 物理脚.y))` | `Foot.as:424-425`;`Wolfrider.as:2956` | 中 | 中高 |
| **9** | **形态切换 = 改属性不改刚体**(friction 0.2↔1.9 + 把腿传送到球心);**无敌窗口是变形动画的一部分** | `Spherobot.as:614-718, 1408-1505` | 低 | 中 |
| **10** | **动态焊接**:爪子落地现造 revolute joint,反力 >4000 自断 → 零特判爬墙/走天花板 | `Limb.as:1011-1062, 990` | 高 | 中(BOSS 才值) |

**反过来说,In2 完全没做的:** 没有动画混合树、没有布娃娃物理驱动存活角色、没有真正的多骨骼 IK(只有 2/3 节)、没有视野锥。**"活"的全部预算花在第 1~3 条上。**

---

## 6. 生化怪物混合结构模板(与我们现有系统的接线图)

**三层分工(与 CLAUDE.md 的混合控制范式相容,不是推翻它):**

| 层 | 谁负责 | 用什么 | 为什么不违反"存活角色不挂物理" |
|---|---|---|---|
| **A 运动学锚** | 躯干中心 `{x, y, vx, vy, rot}` | 手写积分 + PD(照抄 `MaintainAngle`/`MaintainPosition` 公式) | 躯干仍然**不是** Matter 刚体,不会被物理引擎失控 |
| **B 物理附肢** | 触手 / 尾 / 爪 / 断肢 | 真 Matter 刚体 + constraint,**根节每帧被 A 层拖住** | 附肢失控最多是"甩得难看",不会让怪穿墙或飞出关卡 |
| **C IK 视觉层** | 腿、皮、样条 | Verlet(`Joint` 阻尼 0.85)+ 距离约束,零物理 | 纯渲染 |

**按怪型选配:** **触手型(FloatBot)** = A 本体 + B 触手 3×4 节 + C 12 段样条;**多足型(Spherobot/狼)** = A 躯干 + B 脚点 ×4(不需被爆炸掀翻时可退化成纯数据点)+ C 三节 Verlet 腿,腿约束照抄二元组 **只拉不推软绳(k=0/k2=50, r=20px)+ 只推不拉撑杆(k=80, r=50px)**;**BOSS 型(Stalker)** = A 双段躯干(前后反向拧 ∓30°)+ B 4 肢×2 节 + 尾 4 节 + C 样条尾皮 + 动态焊接落脚。

**与现有代码的接线点:**

| 现有件 | 怎么接 |
|---|---|
| `CharacterRig.js` | 部件 FK 链保留;**新增 `attachChain(name, anchorPart, nodes, opts)`**,把 `_updatePendant()` 的 Verlet 求解器泛化成"可挂多条链、尾端可钉死"。C 层(腿/触手皮)全部走它。膝盖弯向 = In2 的 `d=0.5` 极向量权重 |
| `_updatePendant()` 参数 | 已有 `segLen/segments/damping/gravity/stiffness` + **根硬梢软的 `1-(i/(n+1))*0.6` 衰减**;把 `damping` 默认对齐 In2 的 **0.85**,再加一个 `pinTail` 开关 |
| `GibSystem.js` | 断触手/断肢直接复用:现有 `matter.add.constraint(a, b, 1, **0.42**, {damping: **0.28**})` 就是 In2 那条链的 Matter 版。断肢后**关节 stiffness 保持、马达等价物关掉**(In2:`EnableMotor(false)` + `linearDamping=0`)= 变成真自由棍 |
| `Explosives.applyBlast()` | B 层附肢天然吃爆炸力;A 层躯干只吃一个**限幅**的速度冲量(抄 Stalker 的 `damage_x/y` 钳位) |
| `config/enemies.json` | 新增 `chains: [{segments, segLen, density, jointLimitDeg, idleTorque}]`、`gait: {stepR, stepArc, stepSpeedDeg, jitter, minStepFrames, pairing}`、`hover: {ampG, periodS}`、`invulnFrames: [[from,to]]` |

**必须按我们红线改的三处(不要照抄 In2):**
1. **命中框 ≥ 视觉轮廓**(In2 的狼/Stalker 都相反);**附肢刚体不参与与玩家的碰撞**(抄 In2 的 `foot_filter`),命中判定单独走一个覆盖视觉的 AABB。
2. **生物类不断肢、无体液** —— 触手/尾这类"可断"结构只给**机器类**;生物类的对应表现是**触手瘫软**(关节马达关掉、阻尼加大)而不是断开。
3. **一切"每帧衰减/施力"按 dt 归一化**(`v *= Math.pow(0.8, dt*30)`),In2 是锁 30Hz 的,我们在 165Hz 实机上直接抄帧系数会得到完全不同的手感(细则见 level-devices skill I 节)。

**下一步动手顺序建议**:先做 §5 的第 1~3 条(纯 A 层,一天内可见"活"),再上 B 层触手(FloatBot 配方最完整、风险最低),多足与 BOSS 放后面。
