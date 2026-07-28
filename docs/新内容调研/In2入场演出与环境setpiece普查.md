# 《入侵者2》大型敌人入场 + 环境 setpiece 驱动结构普查

> 调研日期 2026-07-27 深夜(从 workflow 子调查通知救档 2026-07-28)。素材:tmp-cuts/pb2/scripts 反编译。用途:**空投混战 setpiece、波次系统、演出相机/震屏的工程配方**。同场救档的姊妹篇:In2重装机甲Exoarmor全拆解.md、In2Danmaku 要点并入本文附录。

## A. 敌人生成与入场的通用骨架

**关键认知:PB2 没有"运行时敌人生成器"。** 敌人在关卡加载时全部实例化并冻结,"生成"=解冻+置位 key。

### A1. SpawnController 波次状态机(575 行,整份最值钱的可移植结构)

```
events[]            一条 FIFO 事件带(波次脚本)
event_reloading     当前事件冷却帧
wait_until_die      开关:阻塞直到 spawned_objects 清空
delayed_functions[] 并行定时回调队列
```
核心闸门一行(`SpawnController.as:195`):
```as3
if (events.length && event_reloading <= 0 && (!wait_until_die || spawned_objects.length == 0))
    { events[0].Trigger(this); events.splice(0,1); }
```

| API | 语义 |
|---|---|
| `AddSpawn(obj, delay)` | 生成+等 delay 帧看下一条 |
| `AddSpawnDontWait` | 同上但不计入全灭判定 |
| `AddFunc(f)` / `AddDelay(n)` | 立即执行 / 纯延时 |
| `AddWait()` | 后续事件卡住直到全灭 |
| `DelayFunction(f, delay, ...)` | 并行定时回调 |
| **`PauseDelayedFunctionsUntilDefeated()`** | **波次同步核心**:在已排定的最后一个回调之后插"冻结整条队列直到全灭"的桩——线性写下来的时间轴自动获得"打完才继续"语义,最优雅的一点 |
| `PushObject(obj)` | 登记全灭判定+自动进相机自动缩放 |
| `PassObjectsToRoot()` | 波次结束幸存者交还全局 |

死亡回收用 `Defeated()` 不是 `Alive()`——尸体还在场但不再阻塞波次。
`LevelController extends SpawnController` 再加:`Script(name)` 字符串反射派发 / `ExecutedOnce(key)` 幂等守卫 / `StartUpdate(f)` 每帧协程 / `AddHeroBound(x,y,rot)` 无形墙战斗封锁。

### A2. 触发器家族

`Trigger` 基类=矩形 AABB(尺寸=MC scale×100),玩家碰撞即 `TriggerFunc()`,**一次性触发即销毁**;`ReusableScriptTrigger` 离开区域重置=可反复;`ScriptTrigger` 名字第二段当函数名反射派发;`KeyTrigger` 只置 `root.keys[key]=true`(全局 gate 字典,102 处引用)——敌人自己轮询 keys 决定启动,**触发与入场解耦**。

### A3. 波次脚本三个范式

1. **纯 events 带**(Level1 Trap1):出球1→60f→出球2→**等全灭**→30f→球3→60f→球4→**等全灭**→收尾;每波换一组相机。
2. **纯 DelayFunction 时间轴**(滑雪关 StartSnakes):线性排回调+若干 `PauseDelayedFunctionsUntilDefeated()` 桩;导弹雨分组落点(left+40/center/right-40),组间+50f 组内+5~10f。
3. **帧号 switch 时间轴**(Avalanche1Update):`t<50` 震幅线性起→`t==50` AnimatedBodySet.Activate() 塌方→`t<90 且 t%5==0` 唤醒区域刚体→`t==300` 自杀。

## B. 大型敌人入场演出总览

| 单位 | 入场方式 | 节拍(帧@30fps) | 引用 |
|---|---|---|---|
| **GrabberBoss** | **VTOL 飞艇悬停+开舱空投**(投放点 `grabber_desant*`,俄语"空降") | 开舱 30f→37/47f 投两兵→100f 关舱→**全灭**→130f 再开舱→135/147f 投→200f 关→**全灭**→下一段;相机 `StartAutoscale("boss",0.1,0.5,1,0.1,0)` FadeIn(60,100) | GrabberBoss.as:2726-2740, Level1_Boss1_Controller.as:44-120 |
| **Stalker** | **吊运货柜空投**:`SpecialPlatform.DoubleRopeDrop()` 切断一根绳→货柜甩落开门 | 切绳 0f→17f 置 keys 蜘蛛出柜;相机先跟货柜 `StartFollow("container_cam",0.3,0.7,0.1,0)` SetFade(30,10,40,80) 再切 Autoscale 收玩家+怪 FadeIn(100,1000) | LevelFinal_Controller.as:205-222, SpecialPlatform.as:618-633 |
| **Exoarmor** | 走进来(四种 *start 路点模式)/机库开出 | 见 Exoarmor 拆解 §6 | Exo:2896-2950 |
| **Danmaku** | 已在场原地起身(`anim.gotoAndPlay("start")`)+关门封场 | action0 50f;37f 落地震;相机 `(0.25,0.8,1,0.05,0)` FadeIn(30,1000) | Danmaku.as:1146-1158 |
| **ACEBoss** | **破走廊入场**:双臂抓走廊两端→拉扯变形(DeformSpot/DeformSection)→头探进来 80 帧横扫(玩家绕到头后可提前打断) | 7 段 action 各 5-100f;`ShakeFade(4,0.95,90,45,5,30)` 咆哮 | ACEBoss.as:690-790 |
| **Spherobot** | 雪面掩体/雪下埋伏弹出(43f/25f 出生,type2 带 -10 上抛)/滚球滚进来(action15 滚动逼近,距离<300 落地→展开四足) | 触发三选:靠近(180×300 框)/被打(冲量>15)/脚本 keys | SpherobotSnowSpawn.as 全文 |

**没有的**:库里无 Tank/Walker/Giant/Heavy 类;无火车(仅弃用音效);无 VTOL/Copter 独立类(GrabberBoss 本体=飞艇)。

### ★ 货柜空投配方(SpecialPlatform.as——"运输机空投集装箱"最近亲)

- `UpdateContainerHang()`:两根绳(`Rope.as`/`AutoLinkRope.as` Box2D 绳)吊着晃
- `DropContainer()`:解开两绳+钩子质量 ×0.1+开 StoreContacts→自由落体
- `DoubleRopeDrop()`:**只解第 2 根绳**→货柜单边甩落,action_reload=30;同时背景/前景/钩绳全部重排 `foreground_depth=19`——**甩落瞬间整体提到前景层**(压迫感)
- `Open()` 置 `root.keys[id]=true` 让里面的敌人知道门开了→敌人自己的 update 轮询 keys 出柜
- 演出链全靠 `die_script`/`afterstart_script` 字符串回调串起("一个死了自动起下一个")

## C. 环境 setpiece 驱动

### C1. 追击雪崩(kill wall 的取巧实现)

核心=**1 个标量** `avalanche_dist`,`interpolate_limit(dist, target, 0.1, 3)`(每帧向目标插 10%,单帧上限 3px):
- `SetAvalanche(0)`=贴脸压迫;`SetAvalanche(-500)`=退场;**位置完全由脚本时间轴驱动,不追玩家**
- 视觉 3 层视差(scale 1.3/1.0/0.7,x 偏移 -90/-20/+50,最远层压暗偏蓝)
- 伤害盒 AABB 100×300 只在 `dist>-100` 激活;撞到时血>10 → `Damage(4000,-2000,10)` 并**强制 `velocity.x=max(vx,15)` 把玩家往前弹**(给逃生机会),血≤10 才致死;冷却 30 帧
- 音量=距离驱动连续值 `limit((dist+300)/600, 0, 0.4)`
- **只在高难度存在**(`difficulty<DIFF_HIGH return`)
- **教训:用脚本时间轴假装追逐,比真做追逐 AI 稳定得多。**

### C2. 玩家站移动物体(直接可移植 Matter)

`Hero.as:942-975`:法线 `y<-0.4`(约 24° 内上表面)才算落地;`COLLIDE_NO_LAND` 掩码=永远站不住的表面;**移动平台=static body+手动 SetXForm,靠 `IsMoving()` 临时降级为非静态**让玩家速度参考系跟着走;`platform_friction<0.01` 走冰面分支;单向平台=临时改 groupIndex 让玩家穿过+倒计时恢复。

### C3. AI_wall(隐形导航层)

22 行:碰撞类别和掩码都是 `COLLIDE_AIWALL`(只跟同类碰)→玩家/子弹/杂物全穿;敌人射线探它知道"这里不能走/悬崖边"。**Matter 用 collisionFilter category/mask 做一层只有 AI 射线看得见的导航几何,比手写 waypoint 便宜。**

### C4. 演出工具组合(无独立 Cutscene 类)

`Script()` 反射派发+`DelayFunction` 定时+`events[]` 带+`StartUpdate` 协程+`ExecutedOnce` 幂等+对象上的 `die_script/afterstart_script/low_life_script` 字符串钩子+`Hero.LockControls`(强制夺玩家控制走位)+`AddHeroBound` 无形墙+全屏后期(`StartBlurFade/StartOverblast`)+HUD 收起。
**细节可抄**:降落伞开场里"闪光 120 帧后才听到爆炸声"(光速差)。

## D. 相机演出 API(加权混合模型)

**没有"切换镜头",只有权重此消彼长**:每帧所有活跃镜头按 weight 加权平均位置/速度/缩放。玩家常规镜头 weight 100,演出镜头 100-1000,强制运镜 100000 压死一切。

| API | 说明 |
|---|---|
| `StartFollow(name, obj, speed, scale, scale_speed, mouse_coeff)` | 跟随;演出全传 mouse=0 |
| `StartAutoscale(...)` | 自动取景框住一组对象(预测式:减速度×3 超前;边框扩张限速 20/帧;5-tap 模糊核平滑) |
| `StartScale(name, scale, speed)` | 只改缩放不改位置 |
| `FadeIn(in,weight,smooth)/FadeOut(stable,out)/SetFade(in,stable,out,weight,smooth)` | 梯形权重包络;smooth=分段二次缓动 |
| `CameraBounds.StartLeftBound/RightBound(x, time=30)` | 战斗封锁标准写法:开战锁边,die_script 里解锁 |

**实测参数档位**:小怪 `(0.1,0.5,1,0.05,0)` FadeIn(50-100,400);中型 `(0.25,0.6,0.9,0.1,0)` SetFade(50,100,50,100);BOSS `(0.25,0.8,1,0.05,0)` FadeIn(30,1000);大场景物 `(0.1,0.75,1,0.1,0)` expand 50、关速度预测。

## E. 震屏语法(World.as)

实现:**沿单一角度的正弦振荡**(非随机抖动),相位步进 1.5/帧(周期 4.2 帧),幅度指数衰减,**位移取整**避免亚像素抖;`Shake(amp,damp,angle)` 弱不压强+叠加钳 30;`ShakeFade(amp,damp,ang,in,stable,out)` 梯形包络持续震;**`ShakePointShockWave(x,y,...)` 按爆点 atan2 自动算方向**;`shake_d` 还被拿去按 0.4/0.18 系数驱动远景视差——**震屏顺带让背景层错动**。

档位:子弹命中 `6,0.85,90`;中型爆炸/落地 `10-12,0.9,90`;大撞击带方向 `15,0.9,120`;BOSS/破墙 `20,0.95-0.98`;持续震最强 `17,0.9,90,100,30,30`。

**没有时间缩放/慢动作**(全库零命中)——"慢"全靠动画帧数手工拉长。

## F. 移植建议摘要

1. **SpawnController events 带+PauseDelayedFunctionsUntilDefeated 整体照搬**(Phaser delayedCall 替 DelayFunction,帧数换算 ms,时间归一化红线)。
2. 入场参数从"实例名编码"改成 level JSON 字段(`{"entrance":"groundstart","pathPoints":4}`)。
3. `die_script/afterstart_script` 字符串反射 → EventBus 事件名(与现架构天然吻合)。
4. **相机权重混合模型自建一层**(比 Phaser startFollow 单目标强得多),梯形包络直接抄。
5. **震屏改"固定角度正弦+指数衰减+取整"**,方向性震屏(爆点方向)表现力高一档;ShakePointShockWave 一行 atan2。
6. 追击段取巧:脚本时间轴驱动位置+伤害把玩家往前弹的容错。
7. AI_wall 隐形导航层早点加进关卡流程。

## 附录:Danmaku BOSS 要点(人形 BOSS+巨枪,非大型机械——前提纠正)

- 体量:本体约 100×100px+114×34 巨枪,靠"巨枪+满屏特效"制造压迫,非体积。总血 6400(3 阶段 400/1700/4300 前缀和判定,难度高 ×1.3)。
- **弹幕图案不在代码在时间轴**:每帧遍历枪 MC 子元件按名字前缀生成弹(purplebullet/spinbullet/grenade*),方向=占位符局部 +10px 方向——**弹幕生成权交给美术动画,代码只提供弹种模板+命名协议**(对我们=动画帧事件表)。
- 光束:宽 72+sin 抖动、每帧 +70 伸长、命中 20 伤+玩家 30 帧无敌;**扫描=36 个预烘焙姿势帧每帧只挪 ±1**(≈75°/秒硬锁)。
- **护盾只能被它自己的弹药破**(打回它的榴弹 >5 次/困难 >7 次)——玩家被迫改变行为而非无脑输出。
- 招式选择 100% 确定性 action 链(唯一 chance 是 50% 二选一),阶段解锁递进:教学段(2招)→+4 招→+3 招且旧招降强度。
- 防"踩头白嫖":贴背/踩头/踩枪各有专门反制(PunchUp 向上 1000 冲量),30 帧 CD。
- **动态难度补给**:`AddBonusHealRock(hp阈值)` 只在玩家血低于阈值才掉血包。
- 死亡 5 段演出:鱼叉吊天→红橙闪+锁屏"fffuuuuu"→Ragdollize+枪脱手独立成对象+15 万分→落地选收尸姿势→静尸冒火花+烧毁效果。
- 玩家死亡时的**胜利舞**(win 动画+踏地震屏)。
- BOSS 巨型部件(炮/臂)=**动画驱动的运动学刚体**(每帧 SetTransformBodySaveVelocity 贴到动画变换,速度差分反推)——撞击力度自然正确又不会物理失控。
