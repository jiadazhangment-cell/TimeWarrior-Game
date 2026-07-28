# 《入侵者2》GrabberBoss / ACEBoss 补遗 —— 集装箱空投出怪攻击线全拆

> 调研日期 **2026-07-28**。**性质=补遗**:上一轮 `In2入场演出与环境setpiece普查.md`(GrabberBoss VTOL 空投节拍/SpecialPlatform 货柜配方/相机/震屏)与 `In2近战生物AI配方.md §7`(ACEBoss ProbabityChoose 权重表)已覆盖的内容本文**不重复**,只补两处缺口。
> 来源:`tmp-cuts/pb2/scripts/` 反编译(ACEBoss.as 4803 行 / ACEArm.as 2921 / GrabberBoss.as 2783 / GrabberBossArm.as 1150 / SpecialPlatform.as)。数值单位:px(PHYS_SCALE=30,30px=1m)、帧(30FPS,1帧≈33.3ms)。
> 用途:基地章终局大混战 setpiece(运输机空投集装箱→箱里出大型机器怪)。

---

## 一、ACEBoss 集装箱攻击线(需求的直系原型,整条链最值钱)

**一句话**:BOSS 不是"投放集装箱",而是**从场外抓一个货柜进来 → 悬在半空当筛子摇 → 摇开箱门把里面的怪抖出来 → 把空壳甩出场**。全程集装箱是 BOSS 的手持道具,不是独立掉落物。

### 1.1 触发:它是招式表里的两个条目,不是脚本演出

| | attack1(前期 sequence 10) | attack2(后期 sequence 30) |
|---|---|---|
| 权重表 | `[1,1,0.1,1.5,1.5,1,**0.5**,**0.5**]` `ACEBoss.as:385` | `[1,1,0.1,1.5,1.5,1,**0.4**,**0.4**,1.3,1]` `:386` |
| index **6** = 杂兵箱 | 30%·damage_state>0 → `crate1_stuff3_flameturret1_propane2`,否则 `crate1_stuff4_spherobots_propane2`;等待 **100f** `:463-473` | 30% → 双火焰炮塔版;否则 spherobots 版;**100f** `:523-533` |
| index **7** = 机甲箱 | `crate1_stuff3_exo1_foam2`,等待 **240f** `:475-478` | 30%(高难额外 +20%) → `exo2`(鱼叉机甲),否则 `exo1`;**240f** `:535-545` |
| 一次性插播 | — | `damage_state>=4` 首次跨过时强制来一发 `crate1_propane1_propane2_exomount`(**箱里是玩家可上的空机甲**),wait 50f,**同时把 [6][7] 权重 ×0.1 永久压制** `:2194-2201` |

**读法**:出怪箱只占全招式权重约 **12%**(0.5+0.5 / 总 7.1),是"换口味"招而非主菜;`ProbabityChoose` 的近期重复惩罚保证它不会连出。**开局第一招被强制排除**(`n_attacks==0 ? [0,1,2,3]` 白名单)——**BOSS 战第一招绝不放小兵**。

### 1.2 七拍节拍表(`ACEArm.as` action 机)

| 拍 | action | 时长 | 内容 | 行号 |
|---|---|---|---|---|
| ① 伸手出场外 | 1100 | **30f** 样条 | 手飞向 `container_<arm>_point1`(场外锚点),`pulling_container` 0→1 插值(驱动躯干配重倾斜) | `:768-781, 1601-1613` |
| ② 变出货柜 | — | 0f | `CreateContainer()`:50/50 随机 `cargo_container`/`cargo_container2`,`scaleY=0.9`,name=**`mass_500_inertia_500`**,初始 `rotation=rnd(-45,45)`,爪子 `gotoAndPlay("grab_platform")` | `:993-1021` |
| ③ 搬进场 | 1500 | 到 dist<70 | `MoveContainer(己方平台锚点.x+200, y-250, 0.2, 50, ...)`(每帧向目标插 20%,单帧上限 **50px**) | `:1695-1708` |
| ④ 举到玩家头顶 | 1501 | **50f** | 目标 x = `limit(interpolate(玩家x, 己方锚点x-200·side, **0.5**), 台左+200, 台右-200)`,y=台面-300;**只追玩家一半距离**=永远留生路 | `:1710-1720` |
| ⑤ **摇箱(前摇/预警)** | 1502 | **20f** | `y = smash_pos.y - 70·sin(phase)`,`phase += 0.628/帧`(**周期 10f**)→ 肉眼看到"上下颠两下";结束瞬间 `SwapContainerWithHollow()` **开箱吐兵** | `:1722-1733` |
| ⑥ 抖两下收尾 | 1503→1504 | 30f+20f | shake_phase 插值到 +100 再到 -100(抬起再压下),`SetBullet(false)` 关高速 CCD | `:1735-1753` |
| ⑦ 甩出场 | 1401→1402 | `15+min(dist/500,1)·15` f + 15f | `ThrowContainer()` 样条把空壳甩到平台边缘外(±500px,钳在台宽±100),旋转样条到 **150·side°**;释放时保留速度,手抬高 200px 后回抓平台 | `:638-662, 1660-1693` |

**手一直粘在箱上**:任何持箱帧都执行 `MoveHandInstant(箱局部(-20,-40))`,并且每帧 `root.hero.LimitSpeed(-100,100,-20,100)` —— **玩家被 500 质量刚体蹭到时速度被强制钳死**,防物理弹飞(`ACEArm.as:2362-2370`)。这条是巨物+物理共存的关键保险。

### 1.3 开箱="换体术"(SwapContainerWithHollow,最漂亮的一招)

不是"播开门动画",而是**整体换刚体**(`ACEArm.as:330-392`):记下实心箱位置/角度/线速度/角速度 → 生成 `container_hollow_special` MC(name=`<id>_closed_frontexplosion_revealdelay_100000_noopenfront_noplatforms`,`cargo_container2` 再 `+"_gray"`)→ `new SpecialPlatform(...).Init()` **继承旧速度**(线速度 SetV + 角速度直拷)+ `fast_disappear=true` + `Open()` + 摩擦置 0 → Kill 实心箱与旧 Collider、重建 Collider → 立刻按 `container_pattern` 在**箱体局部坐标**生怪。

`Open()` 只做一件事:`root.keys[id]=true`(`SpecialPlatform.as:642`)。下一帧箱子自己的 action 1 看到 key → **开门演出**(`:848-913`):
- 两扇门变 `MetalGib` 飞出:`InitBox2(rot, vx=rnd(-20,-15), vy=rnd(-8,6), …, 生命 **150f**(fast_disappear), …)` + `RandomizeSpin(-30,30)`;
- `frontexplosion` → `ExplosionParticles(x,y,5,10,30,0,30,4,10)` + `snd_boom` + **`Shake(10,0.9,90)`**;
- `snd_metal_break2`(0.75);**`foreground_depth=18` 整箱提到前景层**(与 Stalker 货柜同一套压迫感语法)。

### 1.4 `container_pattern` 字符串配方(直接可抄的数据格式)

下划线分词,每个 token 生一件东西;**投放点只有 4 个**,由箱体局部坐标换算(`ACEArm.as:388-391`):
`A=(-110,0)` `B=(+64,0)`(side 翻转互换)、`C=(-50,0)`、`D=(+50,0)`。所有掉落物 `velocity.y = 12`(向下抛出而非自由落体)。

| token | 产出 | 点 | 关键参数 | 行号 |
|---|---|---|---|---|
| `crate1` / `crate2` | 补给箱 | A / B | name=`crt1_smg2_300_smg_200_blaster_25_heal_30`(**弹药+血包写在名字里**) | `:406-425` |
| `spherobots` | **球形机器人 ×2** | C+D | `TransformBall(true)` + `action=15`(球态滚动逼近)+`fast_disappear` | `:435-446` |
| `exo1` / `exo2` | **重装机甲(敌)** | 箱心 y+50 | `enemy_exoac_riflemissile` / `enemy_exoac_harpoon`;`SetVelocity(0,10)`;`disappear=250` | `:468-479` |
| `exorifle` | 机甲(带跳跃延迟) | 箱心 | `enemy_exocontainer_riflemissile_jumpdelay_50` | `:400-405` |
| `exomount` | **空机甲(玩家可上)** | 箱心 | `mount_mountc_riflemissile`,不登记进波次(走 `root.objects` 不走 `parent_ace.Spawn`)→ **不阻塞全灭判定** | `:461-467` |
| `flameturret1/2` | 火焰炮塔 | C / D | name=`ft1_delay_30` / `ft2_delay_35`(错开 5f 启动) | `:447-460` |
| `foam1/2`,`propane1/2`,`stuff1-4` | 泡沫罐/丙烷罐/杂物箱 | A/B | 全是可爆/可推的物理杂物,**给玩家当武器用** | `:480-530` |

**设计读法**:每个箱**必带杂物 + 必带补给 + 才是敌人**(`crate1_stuff3_flameturret1_propane2` = 补给箱+杂物+炮塔+丙烷罐)。开箱既是威胁也是补给站——玩家有动力靠近而不是躲远。

### 1.5 波次门控 + 防堆积(两条工程保险)

- **门控**(`ACEBoss.as:1406-1453`):1030/1040 → 1031/1041 等手臂 `busy` → 若 `!AllObjectsDefeated()` 则进 **1050 挂起**,`action_reload = container_spawn_wait`(杂兵 100f / 机甲 240f)→ 全灭 **或** 超时任一满足即 1051(50f)恢复常规招式。**"打完才继续"与"超时兜底"并存**,不会卡关。
- **防堆积**(`ACEBoss.as:2149/2190` + `:4429-4432`):`TooMuchStuff()` = 平台矩形内物件 >8 → 强制 `action=1020` **双臂依次抹平台**(`StartClearPlatform`,45f 伸手 + 55f 横扫 + 25f 收手,`claw` 播 `wipe` 动画,配 `snd_metal_scrape`)。**BOSS 亲手清理自己制造的垃圾**,同时是一次不打人的呼吸招。
- **残骸处理**:空壳被甩出后,若玩家不在其下方(`hero.y < arm.y+100 || 玩家在手同侧>100px`),把 `container_collider` 过滤器改成只与 `COLLIDE_STUFF` 碰 → **直接穿过世界掉出场自然消失**(`ACEArm.as:1672-1680`)。门碎片 150f 后自毁。**场上不留长期残骸。**

### 1.6 这条攻击在整场的位置

反应堆平台终局阶段(`sequence 10` 与 `30`)的常驻可选招,**不是阶段专属演出**;`damage_state>=4` 时插播一次"送空机甲"然后自我压制。前面的走廊段/大楼段完全没有这条线。

---

## 二、GrabberBoss 完整战斗拆解

### 2.1 多部位血量结构(`GrabberBoss.as`)

| 部位 | 血量 | 说明 |
|---|---|---|
| 本体 `max_life` | **2900** × `boss_hp_k` | `:97`;打任何部位都同时扣本体 |
| 机炮 `gun` | **10000** × k | `:1364`;碰撞体=`CircleDef(30)`+`BoxDef(60×14)`,只吃玩家子弹 |
| 引擎 `engine1/2` | 各 **1000** × k | `:2028/2036/1525` |
| 驾驶舱 ×2 `cockpit_maxlife` | 各 **950** × k | `:133`;**只在最终"狂暴"阶段生成**,`Damage()` 靠 `contact.shape1==cockpit_shape` 判定命中哪一侧 `:2171-2185` |
| 驾驶舱分级损坏 | 每掉 1/5 触发一次 pain,最多 4 级 `:457/487` | 每级让 `hit_time -= 3f`(拳更快)`:343` |
| 死亡条件 | 不是血归零——**两名驾驶员弹射(`pilots_ejected==2`)才 StartBlast** `:394-397` | |

`Alive()` 永远 `return true`(`:927`),生死完全由脚本推进。

### 2.2 "飞行平台"运动模型(`Balance()` `:978-1020`)——直接可移植

```
加速度 ax = limit(destX - (x + vx·20), -200, 200) / 100
        ay = limit(destY + d_height + sin(t·0.1)·30 - (y + vy·20), -250, 50) / 100
v += anti_gravity; v += a               // 反重力抵消 + PD 控制
body_dir = interp(body_dir, ax·20, 0.75) - d_height·0.1   // 加速度→机身倾角
角速度 = angle_difference(deg, body_dir) · 0.14 · DEG2RAD / timeStep
```
- **速度前馈 20 帧**(`x + vx·20`)= 天然刹车,不会冲过头;上升限幅(-250)远大于下降限幅(+50)=**掉高快、爬升慢**,像重型机;
- `sin(t·0.1)·30` 常驻 30px 悬停呼吸;
- 三个引擎火焰长度 = 加速度分量映射 `jet_force = limit(interp(…, -ay·1.6 + 0.25 ± Δ角·0.25, 0.2), 0.5, 0.75)`,横推喷口 `jet3 = limit(|ax|+0.1, 0.2, 0.7)`——**推进器视觉自动由物理量驱动,不用手 K**;
- 目标点自身也是插值:`interpolate_vec_limits(dest_pos, 目标, 0.05, 100, 50)`(每帧 5%,水平上限 100px、垂直 50px)→ **两级插值 = 极其厚重的惯性感**;
- 悬停基准位:`(玩家x + 400, 玩家y - 250)`,右侧封顶 `gun_limit_right` `:2248-2250`。

### 2.3 五阶段流程(`skipscene` 即检查点编号)

| 阶段 | 入口 | 内容 | 转阶段条件 |
|---|---|---|---|
| 0 桥段登场 | `UpdateBridgeAppearance` | 开舱空投(节拍见普查 §B) | 脚本 |
| 1 机炮追击 | `StartMachinegunChase` `:1349` | 生成 gun 部位;`UpdateMachinegun` 7 段扫射机(`:2228-2415`):**burst 5 发 / 50f 冷却**,炮口角度 `gun_dest_dir` 以 **±1~2°/帧** 匀速摇(不是瞄准,是刷扇面),子弹 `EnemyBullet(dir, 速12.5, 10伤, 寿80f)` `:2403` | `life<26%` → `StartJetExplode` |
| 2 平台空投 | `StartPlatformDesant` `:2573` | 见 §2.4 | 同上,`damage==2` 且血尽 |
| 3 坠落+爬行 | `StartFall` `:1086` | 起火(两条 `LinkSpriteStretch` 拉伸火焰)、`FallImpact` 33f 后落地:`Shake(20,0.8,90)` + 平台 `Activate("hit1")` + **玩家若在 x+260 内吃 1000 伤**;之后**双臂交替扒地爬行**(`Crawl()`,每 80f 一次,n_crawl 1/3 时压塌平台) | `n_crawl>7` |
| 4 近身肉搏 | `StartHandFight` `:1030` | 三拍循环:`arm2.StartHit`(砸)→ `arm1.StartGrabHero`(抓)→ 回到砸;`hit_time = 92 - (双舱损伤等级和)·3` **打得越狠它出手越快** | 两驾驶员弹射 |
| (狂暴变体)| `StartMad` `:2199` | 生成驾驶舱、切 `track6`、存检查点;交替砸**平台 hit0/1/2 三个点**,每砸 3 下 `n_platform++`(**平台被逐段砸塌 = 战场推进**);`hit_time` 按玩家距离动态 40/50/60/75f,高难 ×0.87;`n_hits>=30` → StartFall | |

### 2.4 空投配方(`LounchPlatformDesant` `:512-556`)

5 套预设轮转(`desant_type` 1→4 循环),统一结构 `OpenBay(1f) → Desant(延迟,朝向,皮肤,武器,血,喷气背包) ×N → CloseBay`:

| 型 | 投放时刻(帧) | 单位 | action_reload |
|---|---|---|---|
| 0 | 20,50 | smg(30血) / blaster(30血),左右各一 | 110 |
| 1 | 20,50,80 | smg,smg,smg2(40血) | 150 |
| 2 | 20,50,80,95 | smg,smg,pistol×2(20血) | 170 |
| 3 | 20,50,80 | **blaster+喷气背包**(40血),smg,smg2 | 150 |
| 4 | 20,50,80 | smg,smg2,smg 全 40 血 | 150 |

`Desant()` 只是登记一个对象 + `DelayFunction(StartDesantAnimation, 延迟)`;动画播 28f 后 `SpawnDesant` 才真正 `new Enemy("man_<武器>_positional_positional")` 并 `JumpAfterInit(10·side, -10)` **跳出舱门**,再 `PushObject` 登记进全灭判定(`:2561-2571, 2691-2712`)。
波次门控在 `UpdatePlatformDesant` action 3:回到 `desant1` 点 + `AllObjectsDefeated()` 才开下一波,配相机 `StartAutoscale("boss",0.25,0.25,1,0.1,0)` + `border_expand_speed=5`,投放时 FadeIn(60,100)、投完 FadeOut(0,25)——**只有投放瞬间镜头拉远**。

### 2.5 抓取处决与挣脱 QTE(完整判定)

- **抓判定**:仅在抓取样条 `Phase()∈(0.40, 0.57]` 的窗口内,用 **AABB 80×90 @ 爪心+(73,21)** 与玩家 aabb 相交 → `Grab()`(`GrabberBossArm.as:1007-1018`)。窗口外无敌 = **纯动画时序判定,不是持续碰撞**。
- **拒绝条件**:`Hero.AskCatch` 在 `controls_locked / !can_be_grabbed / 已被抓 / weapon_locked_time>0` 时返回 false;抓中会强制下机甲、解挂点、收起重武器(`Hero.as:539-568`)。
- **抓住表现**:玩家 sprite 被 `addChild` 进爪子 MC 并套 `claw.grab_mask` 遮罩(**手指遮住身体=真握住**),播 `grabbed` 动画,物理 body 直接删除。
- **挣脱 QTE**(`Hero.as:3296-3344`,通用实现):
  ```
  每次按 attack1 :  click_rate += 21 / dt帧数
  每帧          :  click_rate -= 3.5 / dt帧数 ,钳在 [0, 1000]
  click_rate >= 100 → catcher.BreakOut() + UnCatch(0,-5)
  ```
  即**≈5 次快速点击**(21×5=105>100),停手约 30 帧归零。按真实毫秒归一化(`getTimer()` 差分),**帧率无关**——这条我们必须照抄。
- **处决**:抓住后另一只手来砸 → `arm1.UnGrabHit` 在 `hit_time·0.35` 处松手,玩家吃 `Damage(100, -100, 30)` 并被 `LimitSpeed(9,9,-3,-3)` 定速抛出(`GrabberBossArm.as:533-549`);同时 `action_reload += 20` 给玩家喘息。**被抓不等于死,是重伤+位移。**
- 拳头直接命中:`ContactFist` → 玩家先 `Teleport(拳心 ± 70px)` 推开再 `Damage(1000·方向, 500, 20伤)`;狂暴版 `ContactFistMad` 同伤但不传送;非玩家物体统一 `Damage(3000,500,200)`。`hit_objects[]` 去重保证一拳只打一次(`:660-684, 802-835`)。

### 2.6 死亡演出(`StartBlast`/`UpdateBlast` `:1064-918`)

`pilots_ejected==2` → 松开玩家 → **双臂 Ragdollize** → 机身 `gotoAndStop("die")` → `Shake(1,0.99,90)`(极长衰减低频嗡鸣)+ `snd_blast_charge` + **+50000 分** + 停 BGM。随后按 `blast_sequence` 帧号硬编码时间轴:**每 5 帧(<128)** 随机爆点 `ExplosionSprite(±200,±100)`+`snd_boom`;**>40 帧**每帧生 `6·limit(seq/70,0.25,1)` 个三角能量粒子**向充能点内吸**(半径 200-400 随机角);**全程** `shake_amplitude = limit(seq/30, 1, 20)` 线性爬升持续震;**100** HUD 收起;**120** `StartOverblast(16,1000,0)` 全屏过曝;**124** `snd_boss_boom`(**光比声早 4 帧**);**140** 切转场 `level_1_slide`。
驾驶员弹射本身也是演出:`InitGrabberPilot` 近景 + `InitGrabberPilotDistant(rnd(550,580))` 远景两个粒子 + `snd_short_jet`+`snd_bottlerocket`(`:838-850`)。

---

## 三、ACEBoss 战斗骨架速写(ProbabityChoose 之外)

### 3.1 `skipscene` 全表(=检查点=战斗大段)

| # | 段落 | 入口 action | 关键 |
|---|---|---|---|
| 0 | 走廊初遇 | -2 | 存 checkpoint1 |
| **1** | 走廊咬击 | 破廊 4 段后 → **100**,`chomp_x = interp(arm1.x, arm2.x, 0.4)` `:745-749` | `ChompExplosion`:头前 2 发 `CreateExplosion(r=70, 力800, 100伤)`,玩家在头左 200px 内额外 `Damage(-2000, 0, **100伤**)` `:3602-3615` |
| **2** | 走廊指枪 | → **300** `:750` | 手掌变机枪阵 |
| **3** | 走廊坠落段 | → **400** `:754`;`arm1.finger_guns_destroyed=true` | 指枪已被打掉的续战 |
| 4 | 大楼跳帮 | 500 | `finger_guns_life = FINGER_GUNS_LIFE3` |
| 5/6 | 大楼被砸/抓楼 | 700/705 | 楼 InstantDrop |
| **7/8** | **反应堆平台终局** | -1,`sequence=1` | `on_reactor_platform=true`,开集装箱线 |

### 3.2 终局 `sequence` 状态机(`ACEBoss.as:2127-2243`)

```
1 →(action 1000 落地)→ 10 ─┬ damage_state>=3 → 20(超光束链)
                            ├ TooMuchStuff && n_attacks>2 → 1020(抹台)
                            └ ChooseSequence1()             ← 集装箱在这里
20→2100(超光束)→21→2200(导弹)→22→2100→23→2010→ 30 ─┬ n_attacks>7 → 40
                                                      ├ TooMuchStuff → 1020
                                                      ├ damage_state 首破4 → 送空机甲箱
                                                      └ ChooseSequence2()
40→2100+前景导弹雨(DelayNextSequence 790/740f)→41→2100→42→回 30
```
**招式池随伤害解锁、超光束段作为阶段间的固定"章节分隔符"**——比"血量百分比切阶段"更有节奏。

### 3.3 血量分段与部位

- 头部 `phase_hp_values = [1600, 1200, 800, 2000, 3500, 3700]` × `boss_hp_k`,**合计 12800**(`:2436`)。分段不等长:**第 3 段只有 800(最短,给一次快速正反馈),后两段 3500/3700(最长,压轴)**。
- 跨段即触发 `damage_state++` + 一串 `HeadExplosion`(2/3/7/4/4/7 发,间隔 4-7f)+ 计分 5000→30000 递增(`:2466-2568`)。
- 受损表现分级:state1 偶发抖头 → state2 随机周期抖(15-30f)→ state3 幅度加大(3,4.5,3.5)→ state4 常驻抖(5,5,4)→ state5 头+躯干同抖 → state6 最强。**血条之外的第二套可读性通道。**
- 部位血:指枪总成 `FINGER_GUNS_LIFE1=2000 / LIFE2=2800 / LIFE3=2900`,单枪 `FINGER_GUNS_MAX_LIFE=400`,拇指 `THUMB_LIFE=700`(`:371-384`)。**双臂 `ACEArm` 本身没有独立血条**——可破坏的是"手上的武器",不是手臂。

### 3.4 招式清单(终局平台段 action 号)

| action | 招 | 要点 |
|---|---|---|
| 1100 | 散射弹幕 | `spreadshot_pattern` 数组逐帧读:1/2=左右口、3=齐射、8/10/15=模式切换;后期图案更密(`:373-378, 490-506`) |
| 1200 | **双眼激光扫台** | `BossBeam(dir=90, depth=15)`,`eye_beam_timings=[60,180,220,228,236]`;起手镜头 `StartFollow("ace_head",0.2,0.8,0.1,0)` FadeIn(60,100) |
| 1300/1400 | **手臂当炮台** | 一只手抓住另一只手当支架(`StartArmGunGrab`),`ArmgunShot` 发 `BossBullet(速8, 10伤, 寿300f, 半径40)` |
| 1500 | 双臂光束 | `StartBeamAttack`,200f |
| 1600/1700 | 单臂砸台 | 砸击 + `PlatformSpreadshot` 同时弹幕 |
| **1800** | **雷击(三点)** | `smash_pattern` 按玩家在台上 1/3、2/3 分区选点;**24f 处 `DangerMarker` ×3 预警**(`root.DangerMarker(x,y,9)` = `danger_marker_raster2` 精灵,25f 寿命,`blendMode="add"`);50f 后 `StartThunder`,电弧命中 `Damage(0,-1000,10)`+`LimitSpeed(-20,20,-15,10)`,20f 内不重复;**安全区 = 两手外侧 80px**(`hero_in_safe_area`) `:1608-1652, 4445-4448` |
| 2100/2200/2300 | 超光束 / 导弹雨 / 追踪弹 | 背景层演出,配 `ShakeHead` |
| 2399→2408 | 死亡九段 | `KillAllEnemies()` 起手 |
| 1030/1040 | **集装箱**(见 §一) | |
| 头部咬 | — | `Damage(sgn·2000, 0, **20伤**)` `:2287` |

### 3.5 `BossBeam` 参数(`BossBeam.as`)

构造 `(x, y, dir, depth)`;`length` 初始 30,`start_speed=30`(**每帧伸长 30px**),`tex_speed=30` 贴图流动,`oscillate_amp=10` 正弦抖动,`phase = dir·DEG2RAD·3`。宽度:眼激光 `start_width=40`,`end_width = limit(40 + (末端y - 起点y)·0.1, 20, 80)`(**越远越粗,给透视感**);超光束 `start 40 → end 300`,起手 30/40 插值到 60/200(`:165-166, 462-463, 579-604`)。
伤害档:普通束 `Damage(side·700, -500, **10**)`;超光束核心 `Damage(side·2000, -500, **20**)`;末端衰减区 `Damage(0, -200, 10)`;命中带 `DMG_NOHITSOUND` 免音效轰炸(`:345-355, 720-747`)。

---

## 四、翻译层:对齐我们的混战 setpiece

### 4.1 集装箱空投 → 七拍模板映射

| 我们的拍 | 抄谁 | 具体建议 |
|---|---|---|
| 1 预警 | ACE ⑤摇箱 + `DangerMarker` | 运输机进场后**先在落点投影一个 `danger_marker` 光斑(25 帧、add 混合)**,再落箱。ACE 的"摇两下"(20f、周期 10f)是最省成本的前摇——**落地前先让箱子在半空颠一下**。 |
| 2 落 | GrabberBoss `FallImpact` | 落地帧:`Shake(20,0.8,90)` + 半径 300px 冲量场(`SetAreaImpulse(300,30,0,-1000)` = **向上掀**,`ACEArm.as:2869-2875`)+ 玩家在 260px 内吃重伤但**不致死**(把玩家掀开而不是杀掉,同雪崩容错哲学)。 |
| 3 开箱 | `SwapContainerWithHollow` | **换体术照抄**:实心箱(可打、挡子弹)→ 落地瞬间换成空心箱(内部可站、门板变 MetalGib 飞出)。继承速度/角速度,视觉零跳变。门板 150 帧自毁。 |
| 4 出怪 | `container_pattern` | **配方写成 level JSON 字符串/数组**,4 个固定投放点(箱心、箱左、箱右、箱顶),全部带 `vy=+12` 初速(主动抛出,不是掉出来)。**每箱必配 1 补给 + 1 可爆物**。 |
| 5 交战 | 1050 门控 | 全灭 **或** 超时(杂兵 100f≈3.3s / 精英 240f≈8s)任一满足推进——**永不卡关**。 |
| 6 清场 | `TooMuchStuff` | 场上物件 >8 时,由环境(传送带/机械臂/气流)**把杂物扫走**,顺带做一次无伤呼吸拍。 |
| 7 收束 | `ThrowContainer` + 过滤器改写 | 空壳被推出场边后**改碰撞过滤只与杂物碰** → 自然掉出场景消失,不留长期残骸也不用手动 destroy 判断。 |

### 4.2 装配线原型机 BOSS(300-440px)数值映射表

尺度换算:我方玩家 capsule **88px**(`config/player.json`),PB2 玩家 ≈55px → **系数 ×1.6**;帧换算 30FPS→ms **×33.3**;我方玩家 HP 100(与 PB2 同量级,伤害值可 1:1 迁);我方武器 12-110 伤/发。

| 项 | PB2 原值 | 建议移植值 | 依据 |
|---|---|---|---|
| BOSS 总血 | ACE 12800 / Grabber 2900 | **2200**,分 4 段 `[500, 350, 550, 800]` | 保留"第 2 段最短给快感、末段最长"的不等长节奏;按我方主武器 18-36 伤估 TTK ≈ 90-120s |
| 可破坏部位 | 指枪 2000+400/枪、拇指 700 | 双臂末端武器各 **450**,断后换招 | 部位血 ≈ 总血 20%;**破的是"手上的武器"不是肢体**(合内容红线) |
| 抓取处决 | 伤 100 + 位移 | 伤 **25** + 强制位移,**不致死** | PB2 抓取从不直接杀;伤害占 HP 1/4 |
| 挣脱 QTE | +21/次、-3.5/帧、阈值 100 | **原样照抄**(按 ms 归一化) | ≈5 次快速点击;帧率无关是硬要求 |
| 拳/砸命中 | 伤 20 + 冲量 1000/500 + 先传送推开 | 伤 **18**,先把玩家推出 70px 再结算 | "先推开再打"避免卡在拳里连续判定 |
| 落地/砸地震屏 | `Shake(20,0.8,90)`;开箱 `Shake(10,0.9,90)` | 同档 | 已在普查 §E 建档 |
| 出手间隔 | `hit_time` 40/50/60/75f,按玩家距离 | **1.3/1.7/2.0/2.5s**,近身最慢远处最快 | **越远出手越快**(逼近身)是反直觉但正确的设计 |
| 难度缩放 | `hit_time ×0.87`(高难) | 同 | 只调节奏不调数值,最省事 |
| 前摇预警 | DangerMarker 24f 前置,25f 寿命 | **0.8s 前置光斑** | 大招必须有落点预告 |
| 波次超时 | 100f / 240f | **3.5s / 8s** | |
| 分数 | 阶段 5000→30000 递增,击杀 50000 | 按比例 | |

### 4.3 直接可抄的五条工程做法(与已建档内容不重复)

1. **巨物持物 = 手粘在物体上,不是物体粘在手上**:每帧 `MoveHandInstant(物体局部锚点)` 反推手的位置,物体走运动学插值。避免关节链抖动。
2. **持巨物时钳玩家速度**:`LimitSpeed(-100,100,-20,100)` —— 我们的 Matter 世界同理,大质量刚体接触玩家必须钳速,否则弹飞。
3. **开箱=换刚体不是播动画**:实心→空心两个物体、继承线速度+角速度,视觉无缝而碰撞语义彻底改变。
4. **半追踪落点**:`interpolate(玩家x, 默认位x, 0.5)` —— 只追一半,永远留生路。比"完全瞄准 + 加个躲避窗口"更好调。
5. **清场招**:场上物件数超阈值时 BOSS 自己抹一遍平台——既解决性能与可读性,又是免费的呼吸节拍。
