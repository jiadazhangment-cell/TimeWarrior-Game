# 爆炸/火焰 2D VFX 时序规范 —— 调研结论 + 本项目现状实测

## 0. 结论先行

1. **调研结论非常一致**:专业 FX 动画教学(传统手绘特效、像素游戏特效、实时游戏 VFX 三个不同来源)在"火怎么灭"这一点上**完全统一**——火焰消失 = **轮廓/体积主动收缩 + 碎裂成小舌头各自缩没**,颜色变化只是伴随的次要信号。"只改透明度/颜色、不改形状"被明确当作反面教材(专业术语 **alpha fade** vs **alpha erosion/shape dissolve**)。用户的常识判断和整个行业的调研结论**完全对得上**。
2. **我直接打开了本项目现役的爆炸素材实测**(`public/assets/img/fx_blast.png` 与 `fx_blast_ground.png`,即今天刚上线的 v8"序列帧整段播放"方案),发现**病根还在,而且证据非常直接**:16 帧序列里,火球从第 2 帧冲到接近最大直径后,后面 14 帧(约 87%~94% 的时长)轮廓大小几乎不变,只是颜色从白→黄→橙→红→灰黑烟在原地推进;第 16 帧(最后一帧)仍是一大团不透明的灰烟球,不是"变小到没有"。这**正是**用户描述的"体积不变、颜色渐变淡出"。也就是说,v8 把"程序化拼接多个火球贴图"的旧病根治好了,但换上的新素材本身就带着"只变色不缩小"的老毛病——问题从代码层转移到了素材层,用户看到的结果不会变。
3. 好消息:**颜色脚本的节奏本身是对的**(白→黄→橙→红→烟灰的推进时机和调研得出的比例吻合得相当好),不需要重做;需要动的**只有形状/体积通道**,以及序列播放完毕时"animationcomplete 后直接 destroy、无收尾"这个二级问题(见第9节)。

---

## 1. 调研依据与可信度说明

调研覆盖了用户点名的全部方向,附可信度标注(A=直接抓取到原文技术细节;B=确认资料范围/结论但原文受付费墙限制,采用二手一致性交叉验证;C=综合多篇检索结果归纳,非单一信源逐字引用):

- **VFX Apprentice**(《2D FX Explosion Masterclass》《FX Timing Principles》《Booms & Blasts》课程 + 官方 blog "The Soul of Effects: What is Timing in VFX")—— B/A 混合,课程内容受付费墙限制,但 blog 原文抓取到了完整的三段式时序模型。
- **GDC Vault**《Visual Effects Bootcamp: Artistic Principles of VFX》(Blizzard×Riot 案例)——B,摘要确认范围,正文付费墙。
- **《Juice it or Lose it》**(Nordic Game Jam 2012 / 亦有 GDC Vault 收录)——C,该演讲主体是"给 Breakout 加 juice"的方法论(震屏/粒子/音效/缩放反馈),不是火焰形状专项教程,本报告只借用其"前重后轻打击反馈"的通用哲学,不引用不存在的细节。
- **《The Art of Screenshake》**(Jan Willem Nijman/Vlambeer)——**需纠正**:检索确认这是 **2013 年 INDIGO Classes** 的演讲,并非 GDC 官方场次(和"Juice it or Lose it"经常被一起提及,但不在 GDC Vault 编号里)。内容同样是震屏/打击感通用方法论,和爆炸形状专项无直接关系,本报告不强行嫁接。
- **Joseph Gilland《Elemental Magic Vol.I/II》**——B,多个出版社/书商页面确认书中确有独立的 "Fire, Smoke, and Explosions" 章节,但正文在付费墙/实体书内,未能逐字抓取具体帧数。本报告采用与其教学脉络一致、且**独立验证到原文**的 Toon Boom 官方手绘火焰教程(同一套传统手绘 FX 动画教学谱系)作为可核实的替代信源。
- **Toon Boom Learn Portal**《Hand-Drawn Fire Animation》——**A**,抓到完整正文。
- **VFXDoc(读书笔记网站,业界通用参考)**——**A**,"Alpha Erosion" 与 "Particle Systems" 两篇都抓到完整技术细节,是本报告"形状消散 vs 透明度消散"论证的核心依据。
- **80.lv 《VFX Staples: Shape, Color, and Motion》**(Stefan Jevremović)——**A**,抓到完整的三段式时序框架原文。
- **Vlambeer / Nuclear Throne 爆炸设计**(ctrl500.com 及多篇二次报道)——**A/C**,9 帧爆炸、仅第 2 帧生效碰撞等数据交叉验证一致。
- **像素游戏爆炸素材惯例**(OpenGameArt "Pixel Explosion 12 Frames"、多篇像素 FX 教程聚合)——**C**,用于给出一个可核实量级的"前重后轻"具体帧时长范例。
- **Real Time VFX 论坛**(业界从业者聚集地)——**A/C**,用于常见错误清单的一手佐证。

---

## 2. 宏观时序结构:三段式节拍分配

跨信源(80.lv 三段模型、SunStrike 的 wind-up/climax/fall-off、Toon Boom 的"起势-外扩-耗散"循环)高度一致地把一次爆炸切成三段,**时间分配严重不对称**:

| 阶段 | 别名 | 时间占比(参考区间) | 视觉要求 |
|---|---|---|---|
| **① 引爆/前摇** | Ignition / Anticipation / Fade-in | **总时长的 5%~20%**,越短越"炸" | 点火花→瞬间膨胀到(接近)最大尺寸;必须用强 ease-out(Expo/Quart.Out),1~3 帧内冲到位,不能匀速长大 |
| **② 高潮/燃烧** | Climax / Combustion | **总时长的 10%~25%** | 元素最多、对比度最高、饱和度最高(80.lv 原话);此刻轮廓已经开始不规则(碎裂边缘/翻滚),不是光滑圆球 |
| **③ 衰变/消散** | Dissipation / Decay / Fall-off | **总时长的 60%~85%**,是全片最长的一段,但**低对比度、低不透明度、持续缩小**,"不该停留太久"(80.lv 原文) | 主体不断碎裂→收缩→熄灭;这一段恰恰是本项目当前素材完全没做对的部分 |

**具体量级参照(可核实的真实案例)**:
- Vlambeer《Nuclear Throne》的标准爆炸只有 **9 帧**,且碰撞判定只在**第 2 帧**生效——极端"前重后轻",几乎所有帧都在收尾,配合震屏与冻帧几毫秒把力道感做满,视觉本体反而短促(ctrl500.com 报道)。
- 像素游戏爆炸教程里一个具体的 **12 帧计时表**(常见惯例,非单一书页逐字引用,综合多篇像素 FX 教程归纳):帧 1-4 每帧 45ms(共 180ms,占比约 20%,负责起爆到冲至最大)→ 帧 5-10 每帧 90ms(共 540ms)→ 帧 11、12(空白帧)各 100ms。总时长约 920ms,**前 20% 的时间完成膨胀,后 80% 全部用来收缩消失**。
- "打击停顿(hit-pause)"惯例是 **2~6 帧**,配合"单帧 VFX 闪光,命中瞬间峰值、随即衰减"(SunStrike Studios 原文)——这解释了"前重"的具体操作手法:不是慢慢淡入,而是有一帧专门的过曝闪光信息量爆炸,紧接着立刻回落。
- 游戏 VFX 领域的通用惯例:**明亮的火焰发射器只播 4~8 帧,随后立刻交给烟雾发射器接管**(多篇教程聚合结论)——"火"必须短,"烟"负责撑时长。

**回答"火焰生命周期多短才读作火"**:结合以上,**火焰(明亮、高饱和度、能被叫作"火"的部分)在一次爆炸里只应该占总时长的 25%~35%**,超过这个比例观众会觉得"火在傻站着",低于 15% 又会读不出"炸"感只剩"闪"。本项目 v8 的 615ms(16 帧 @26fps)总时长量级完全合理,不需要改;需要改的是这 615ms 内部"体积"这根曲线。

---

## 3. 火焰消失的正确画法(形状机制)——这是本次调研的核心

**结论:不是缩小,是"碎裂成舌头,每片舌头各自缩小、脱离主体、消失"**,而不是整体像气球放气一样均匀变小,更不是原地褪色。三个独立信源的表述高度一致:

- **Toon Boom 官方教程原文**:动画师要主动选定"断裂点(breakaway points)",让火焰的碎块从主体上**分离、收缩、消解(dissolve)**,并以稳定速率一边上升一边完成这个过程;"稳定燃烧的火"里 80% 的体积集中在几乎不动的火焰根部核心,新燃料从根部持续"倒出来"补充,而不是整团一起呼吸缩放。
- **VFXDoc「Alpha Erosion」原文的核心论证**(这是解释"为什么"的最关键一段):
  - **Fade(错误做法)**= 均匀降低所有像素的不透明度,整块形状原地"变淡直到看不见"。
  - **Erosion(正确做法)**= 按一个不断推进的阈值,让形状从局部开始被"腐蚀"成透明,**形状本身在瓦解**,轮廓边界持续变化,而不是整体一起变淡。文档原话:"erosion creates more convincing disappearance by maintaining shape definition throughout the dissolution process"(形状瓦解全程都保持着"这是个会变化的形状"的信息,而不是所有像素同步失效)。
- **VFXDoc「Particle Systems」原文**:年龄驱动的属性曲线里,"Size progression is typically expanding then shrinking"(尺寸曲线的标准形态就是先膨胀后收缩)——收缩是**默认应该存在的独立曲线**,不能被颜色/透明度曲线取代。

**最后一帧应该是什么**:三个信源共同指向同一个答案——**要么(a)视觉上已经没有实体,只剩几粒独立的余烬火星/一缕即将消失的稀薄烟丝(体积≤峰值的 15~25%),要么(b)彻底清空**。绝对不允许最后一帧还是一个"完整、大尺寸、还算不透明"的团块——哪怕它已经是纯灰色的烟,只要它还保持着峰值时期的体积和轮廓完整度,观众读到的就是"它还在",不是"它没了"。

**具体操作手法(可执行)**:
1. 峰值之后,主体轮廓**边缘先开始不规则地掉块**(不是整体等比缩放的光滑球,是啃掉一角、掉一块的感觉)。
2. 掉落的碎块各自拥有**自己独立的缩放曲线和寿命**,一般比主体短、比主体先消失。
3. 主体本身的直径曲线应持续下降,下降速率**后段应该加速**(ease-in 收尾,比如 Quad.In/Cubic.In),让"最后一口"是突然没掉的,而不是长时间悬在"若隐若现"的状态(那本身也是 alpha-fade 病的一种变体:只是把"淡出"拖得很长)。
4. 颜色暗化和体积缩小同步推进,但**体积缩小必须存在**,不能只有颜色在变。

---

## 4. 颜色脚本(色彩推进节奏)

综合黑体辐射冷却的物理直觉(专业 FX 教学普遍默认的底层逻辑)、Toon Boom("黄色内芯、橙色外壳"的静态火配色)以及本项目自身 fx_blast.png 素材里**本来就还算合理**的配色时间线,给出以总时长百分比表示的推进表:

| 时间占比 | 颜色 | 说明 |
|---|---|---|
| 0~5% | 近白色点光源 | 引爆火花,不是火球,是"光"(本项目已有:核闪 90ms) |
| 5~20% | 白 → 极浅黄 | 温度峰值,整个爆炸里最亮、最高饱和度的瞬间 |
| 20~45% | 黄 → 橙 | "火"这个身份被识别出来的主要区间,轮廓应已开始不规则 |
| 45~65% | 橙 → 红橙,边缘出现暗色/烟灰斑块 | 体积应该已经明显小于峰值,碎块开始脱离 |
| 65~85% | 红 → 暗红棕色余烬,包裹在转灰的烟里 | 体积应≤峰值的 40% |
| 85~100% | 灰烟,饱和度归零,余烬熄灭 | 体积应≤峰值的 15~25%,或已清空 |

对照本项目 `fx_blast.png` 实测(见第 9 节),这条颜色时间线和素材实际表现**基本吻合**——即调研确认了本项目"配色节奏"这一半是做对的,不需要重新出图配色,问题完全出在"体积"这一列始终没跟着变。

---

## 5. "变暗"与"缩小",谁是主导?

**结论:缩小(形状/体积)是主导信号,变暗(颜色/亮度)是次要的确认信号。** 论证链:

1. VFXDoc 明确把"仅降低透明度"划为反面案例,把"形状主动瓦解"划为正确案例——这本身就是在说:**观众读取"消失"这件事,靠的是形状/轮廓变化,不是亮度/透明度变化**。只变暗、不缩小,视觉上读出来的是"这里的灯光在被调暗"(像调光器),而不是"这团实体在燃尽"——因为现实里"灯光变暗"和"物体变小"是两种完全不同的物理事件,人眼对这两者的默认解读是分开且固定的。
2. Toon Boom 教程把"收缩、脱离、消解"列为动画师**主动要做的动作**,颜色只在旁白里带一句"黄色内芯橙色外壳"——即专业教学资料本身分配给"形状"的篇幅和主动性远高于"颜色"。
3 本项目自己的素材恰好是一个反面对照实验:`fx_blast.png` 把"变暗"这一条做得相当到位(白→黄→橙→红→灰的推进很顺),但因为完全没有"缩小",结果依然是用户点名的"体积不变、颜色渐变淡出"。**这证明了单靠变暗做不出"消失"的读感,缩小才是那个不能省略的必要条件**,变暗更像是锦上添花、验证"温度确实在下降"的辅助信息。

**结论落地**:如果只能改一件事,优先**做出体积收缩**;颜色脚本已经合格,不必大改。

---

## 6. 烟在动作游戏爆炸里的取舍

综合 80.lv("衰变阶段不该停留太久、低对比度低不透明度")、游戏 VFX 惯例("亮焰只播 4-8 帧就交给烟")、以及**丙烷罐 vs 燃油类火焰的物理惯例**(检索到的行业共识:丙烷这类挥发性燃气"烧得快、亮、猛烈",油类/燃料"产生深色、翻滚、持续很久的烟"——这条对本项目意义特殊,因为本项目本来就有丙烷罐这个具体道具),给出对**快节奏 2D 横版射击动作游戏**的取舍建议:

- **要不要烟:要**,但定位是"爆炸的收尾陈述句",不是主角。它的作用是让"火already 熄灭"这件事有台阶下,不是自己成为长期视觉负担。
- **多淡**:整个衰变阶段不透明度上限建议 ≤0.3~0.4(本项目战斗节奏快、屏幕上同时有子弹/敌人/命中框,浓烟会遮挡判定,和项目"命中框原则/视觉可读性"的既有工程约束冲突)。
- **多久**:烟本身的收缩/消散节奏应该**比火慢、但比整段爆炸的"总放送时长"短**——即烟不应该无限拖尾。对丙烷罐这种"快爆炸"场景,烟的完整消散建议控制在爆炸总时长的 1.5~2.5 倍以内(比如主爆炸 600ms,烟尾巴收干净不超过 1~1.5s),不要做成能飘满几秒钟的黑烟柱——那是"燃油大火"的语言,不是"丙烷瞬爆"的语言,本项目 Explosives.js 里已经明确区分了"丙烷=快而猛、烧尽自灭"和"未来的燃料管=喷射火舌"这两种不同道具的火焰身份,烟的时长设计应该跟着这个既有的"不同东西爆炸不同"美术方向走,不能所有爆炸共用一套烟。
- 烟本身也要遵守第 3 节的"形状消散"规则:烟团不能是一个固定大小只改灰度的球,它应该一边上升飘散一边**自己的轮廓也在扩散变薄变碎**,只是节奏比火慢。

---

## 7. 新手常见错误清单(重点标出本项目已经踩过/正在踩的)

1. **【本项目正在踩】用颜色/透明度渐变代替形状收缩** —— 头号错误,即 VFXDoc 定义的 "fade" 而非 "erosion"。本项目 `fx_blast.png`/`fx_blast_ground.png` 16 帧序列里,第 2~16 帧轮廓直径基本不变,只有色相在推进,是这条错误的教科书级实例。
2. **【本项目正在踩,二级问题】播放结束时硬切消失,没有收尾**——`ArenaScene.js` 里 `blast.once('animationcomplete', () => blast.destroy())`,序列播完直接摧毁,而第 16 帧本身还是一团相当不透明的灰烟,等于在"体积还没缩小到位"的基础上又叠加了一次"啪一下消失"的硬切。两个问题叠在一起,观感是"一大团东西凭空消失"而不是"燃尽了"。
3. **全程体积/尺寸恒定,只做 Size over Lifetime 的常数值**——VFXDoc 与多篇论坛帖子明确点名,标准做法是"expanding then shrinking"这条曲线本身要存在,不能留空或恒定。
4. **对称配时(膨胀和衰减各占一半时间)**——正确比例是前 5%~20% 膨胀、后 60%~85% 衰减,新手常见错误是把这个比例做反或做平均。
5. **全程线性插值(无缓动曲线)**——读起来"机械、发飘",专业资料反复强调膨胀要 ease-out(快出),消散尾段要 ease-in(收得干脆),不能一路匀速。
6. **同一张"完整火球"贴图复制多份摆在爆心周围充当"碎裂感"**——这条不是外部资料讲的,是**本项目自己血泪踩过五次的教训**(scene-fx-pipeline skill 原文:"一次爆炸只允许存在一个火球位置……无论让它们从哪来往哪去、个头多小,读出来永远是'几个小火球'")。这里专门列出来提醒:v8 换素材路线后,`Explosives.js` 里被点名过的"三个火舌球"代码已经标注退役,**但只要以后任何人往爆心以外新增第二个"看起来完整的火球"贴图,哪怕目的是做碎裂效果,都是在重犯第六次同一个错误**。
7. **烟雾停留过久、不透明度过高,遮挡玩法可读性**——尤其在有命中框/威胁读取需求的动作游戏里,浓烟是双重负面(视觉拖沓 + 遮挡判定)。
8. **没有做"剪影测试"**——把特效整体填充为纯黑色单色轮廓,检验形状本身是否依然读得出"在变化、在消失";只靠颜色撑场面的特效,剪影测试会立刻现出原形(一动不动的黑团)。这是低成本、可以现在就对本项目素材做的验收方法(见第 10 节)。
9. **烟和火共用同一条生命曲线/同一套参数**——烟需要更长寿命、更随机(1~3 秒量级、随机化避免同步感),火需要短促、收得紧,两者混用会导致烟"跟火一起过早消失"或火"被烟的慢节奏拖着不肯灭"。
10. **把"爆炸"当"火焰循环"来做(整段可循环播放)**——爆炸是一次性瞬态事件(one-shot),不应该 loop;持续燃烧的火焰(比如泄漏气瓶喷口的定向火舌)才是应该 loop 的对象。两者用途不同,处理方式不能互换。
11. **每次爆炸长得一模一样,没有随机性**——真实感的重要来源之一是"这次爆炸和上次不一样"(旋转/翻转/碎裂方向/时间错峰),本项目在枪口焰上已经贯彻这条("每发混沌不同=真实感核心"),但序列帧整段播放的新方案要注意:如果 16 帧是完全固定不变的一份素材,每次爆炸看起来会比程序化时代更容易"identical",需要靠翻转/旋转/多套素材来找补随机感(v8 代码里已经有 setFlipX/setAngle 随机,这条目前处理得不错,列出来是为了在后续调参时不要退化掉)。
12. **认为"物理引擎/序列帧已经算好了,不需要再叠加任何东西"**——v8 的代码注释("帧内演变已由渲染器算好,勿再叠 tween 缩放")本身隐含了一个假设:源头素材已经把形状收缩这件事做对了。**这次实测证明这个假设对当前这两张图不成立**。这不是说"不能用整段播放序列帧"这个技术路线错了,而是说"用了整段播放"不代表"体积收缩问题自动解决"——素材本身有没有做对,必须专门验证,不能因为换了技术路线就免检。
13. **颜色借用了错误场景的调色板**——本项目自己也踩过(蓝青色 sparkEmitter 被错误借用到暖色火焰场景),这是一条通用告诫:任何"火/爆炸"元素如果视觉上出现冷色调(蓝/青/白冷光)且不是刻意设计的"能量武器"身份,基本可以断定是从别的效果里复制粘贴代码时带过来的错误资源。

---

## 8. 可执行数值规范表(建议写入本项目的爆炸标准)

以下是针对本项目(2D 横版、深色科幻、Phaser 4 + tween,主爆炸对象=丙烷罐/RPG/未来弹药箱)按调研结论整理出的具体数值建议,ease 名称按 Phaser tween 惯例书写,方便直接对照实现:

| 参数 | 建议值 | 依据 |
|---|---|---|
| 总时长(中小型爆炸,如丙烷罐/RPG) | 500~700ms(当前 615ms **不用改**) | 与 Vlambeer/像素惯例量级一致 |
| 膨胀阶段占比 | 总时长的 8%~15%,ease: `Expo.Out`/`Quart.Out` | 三方一致的"前重" |
| 峰值停留 | 1~2 帧(不缓动,近似瞬时) | 打击停顿惯例(2-6帧)的克制版本 |
| **体积(直径)曲线** | 峰值 100% → 衰变阶段结束时 ≤20%,曲线本身要在代码/素材里**可测量地存在**,不能是常数 | VFXDoc "expanding then shrinking" 是硬性要求项 |
| 衰变阶段收尾 ease | `Quad.In` 或 `Cubic.In`(越到后面缩得越快,不拖后腿) | 避免"长时间若隐若现"的二级 fade 病 |
| 亮焰(读作"火")时长占比 | 总时长的 25%~35% | 游戏 VFX 惯例"亮焰 4-8 帧后交给烟" |
| 碎裂子块数量 | 3~6 个,各自独立缩放曲线,比主体早消失 | Toon Boom "breakaway 分离/缩小/消解" |
| 烟不透明度上限 | ≤0.3~0.4 | 项目自身的命中框可读性约束 |
| 烟总消散时长 | 爆炸总时长的 1.5~2.5 倍,不做成秒级黑烟柱(丙烷) | "丙烷快而猛" vs "燃油慢而闷"的道具身份区分 |
| 结尾硬切保护线 | 只有当剩余可见体积 ≤ 峰值 10% 且 alpha ≤0.15 时,才允许直接 destroy;否则必须先补一段 ≤120ms 的 alpha 收尾 tween | 修当前"animationcomplete 直接 destroy"的二级问题 |
| 随机化 | 水平翻转 + 微旋转(已实现)+ 建议补充:2 套以上素材/或碎块方向随机,防止"每次都认得出是同一张图" | 项目自有"每发混沌不同"铁律 |

---

## 9. 现状审计:本项目 fx_blast 素材实测(证据)

- **文件**:`C:\Users\surpr\Desktop\TimeWarrior-Game\public\assets\img\fx_blast.png`(半空爆,1024×1024,4×4=16 帧,单帧 256×256)、`fx_blast_ground.png`(贴地爆,单帧 256×193)。
- **动画定义**:`src\scenes\BootScene.js` 第 140-144 行,`frameRate: 26`,16 帧(0-15),总时长约 615ms,不循环。
- **调用点**:`src\scenes\ArenaScene.js` 第 219-256 行 `fx.explosion()`;`src\systems\Explosives.js` 第 81-118 行 `_explode()` 调用 `s.fx.explosion(x, y, 1, groundY)`——即丙烷罐(以及未来任何调用同一个 fx.explosion 的爆炸物,比如 RPG)全部共用这一份序列帧。
- **我直接读取了两张图并逐帧目视核对**,结论:
  - 半空版:帧1 是一个很小的白点(引爆火花,正确);**帧2 就已经膨胀到接近全片最大直径**(符合"前重"原则,这一步是对的);但从**帧2一路到帧16**,球体的外轮廓直径几乎没有变化,变化的只是颜色——白热→奶油黄→橙→暗红→带火星的深灰→纯灰烟,**没有任何一帧显示出这团东西的边界在往里收**。第16帧(最后一帧)依然是一个完整、边界清晰、相当不透明的灰色烟球。
  - 贴地版:结构相同(拱顶状火团→逐渐变成拱顶状烟团),同样是"整个拱顶轮廓大小基本不变,只变色",第16帧依然是一整朵撑满画面的灰烟云。
  - 两张图的**颜色推进节奏**和第 4 节整理的调研时间线对得上(白→黄→橙→红→灰,发生的时间点大致落在对应区间),说明素材在配色这条轨道上是合格的。
  - 唯一缺失、且是用户投诉核心的一条:**体积/轮廓收缩曲线完全没有**。这不是代码 bug,是源头美术序列帧本身的问题——大概率是因为这批参考图(skill 文档里的"参考36/37")来自那种"固定渲染体积、只让内部温度场冷却变色"的爆炸素材(常见于用 3D 流体模拟渲染、且渲染包围盒不随时间收缩的通用爆炸素材包/AI 生成序列),这类素材天生就是"一个不缩小的球在变色",这也正是本次调研里被反复点名的反面案例本身。
- **二级问题**:`ArenaScene.js` 第 238 行 `blast.once('animationcomplete', () => blast.destroy())`——序列播完立即摧毁,没有任何收尾淡出。由于第16帧本身体积/不透明度都还很"满",这一下硬切会让"消失"这件事显得更突兀。
- **对现有"勿再叠加缩放 tween"规则的提醒**:BootScene.js 第 142 行注释写"帧内演变已由渲染器算好,勿再叠 tween 缩放",这条规则的前提假设是"序列帧内已经包含了体积收缩"。**本次实测直接证伪了这个前提**——对当前这两份素材,前提不成立。这不代表"整段播放序列帧"这个技术方向本身错了(它解决了 v2-v7 反复出现的"多个火球贴图拼贴=好几个小火球"的根本问题,这个收益是真实的),而是说**素材本身还需要单独过一次"体积是否真的在缩小"的验收**,不能因为换了技术路线就默认这一条自动满足。
- **给后续决策的建议(不越权替用户拍板,仅列出方向)**:按本项目"同一处被点名两次=方向级错误,停下对齐"的既定哲学,爆炸这处已经是第六次被点名,建议下一步不要再自行选一个方案改了就交付,而是把这份实测结果(两张图对比截图 + 本报告)拿给用户看,让用户在"重新出图/选料换成真正会收缩的参考素材"和"在现有序列帧后半段叠加一个针对性的收尾缩放+alpha tween 做补偿"这两个方向之间选一个,再动手——因为这两条路线的美术工作量和"够不够地道"的取舍,是审美判断,不是纯技术判断。

---

## 10. 验收方法(可复用本项目既有的 rAF 截图验收习惯)

按 CLAUDE.md 已确立的"改完非琐碎逻辑必须 chrome-devtools 截图验证"惯例,建议爆炸效果专门验收如下:
1. **真实 rAF 定时连拍**(项目在 07-25 已用过的方法):在 16ms、70ms、200ms、400ms、600ms 五个时间点用 `renderer.snapshot` 连拍,肉眼核对每一张里火球/烟团的**像素直径**是否在持续变小,而不是只看颜色。
2. **剪影测试**:把截图丢进任意工具二值化/纯黑填充,检查形状在各时间点是否依然"读得出正在变化、正在缩小"——如果剪影从某一帧起变成一动不动的黑团,说明形状通道又失效了。
3. **最后一帧单独检查**:确认动画/序列结束前最后可见的一帧,体积是否已经收到峰值的 20% 以下、alpha 是否已经足够低,再决定是否可以直接 destroy(否则按第 8 节表格补一段收尾 fade)。

---

## Sources

- [VFX Staples: Shape, Color, and Motion (80.lv)](https://80.lv/articles/vfx-staples-shape-color-and-motion)
- [Alpha Erosion — VFXDoc](https://vfxdoc.readthedocs.io/en/latest/shaders/alpha-erosion/)
- [Particle Systems — VFXDoc](https://vfxdoc.readthedocs.io/en/latest/vfx/particlesystems/)
- [Hand-Drawn Fire Animation, Activity 1 — Toon Boom Learn Portal](https://learn.toonboom.com/modules/hand-drawn-fire-animation/topic/activity-1-animating-a-small-fire)
- [Timing in Animation: A Practical, Game-Ready Guide — SunStrike Studios](https://sunstrikestudios.com/en/blog/timing_in_animation/)
- [How to master good timing in VFX and animation? — VFX Apprentice blog](https://www.vfxapprentice.com/blog/the-soul-of-effects-what-is-timing-in-vfx)
- [2D FX Explosion Masterclass — VFX Apprentice](https://www.vfxapprentice.com/courses/2d-fx-explosion-masterclass)
- [FX Timing Principles — VFX Apprentice](https://www.vfxapprentice.com/courses/fx-timing-principles)
- [Booms & Blasts: Real-time Stylized VFX for Games — VFX Apprentice](https://www.vfxapprentice.com/courses/booms-and-blasts)
- [GDC Vault - Visual Effects Bootcamp: Artistic Principles of VFX](https://www.gdcvault.com/play/1023943/Visual-Effects-Bootcamp-Artistic-Principles)
- [GDC Vault - Juice It or Lose It](https://www.gdcvault.com/play/1016487/Juice-it-or-Lose)
- [Juice It or Lose It — GameJuice](https://gamejuice.co.uk/resources/juice-it-or-lose-it)
- ["The Art Of Screenshake" — Jan Willem Nijman (Internet Archive)](https://archive.org/details/the-art-of-screenshake)
- [Elemental Magic, Volume II: The Technique of Special Effects Animation — Joseph Gilland (Amazon listing)](https://www.amazon.com/Elemental-Magic-II-Technique-Animation/dp/0240814797)
- [Elemental magic: the art of special effects animation — Internet Archive](https://archive.org/details/elementalmagicar0000gill)
- [Explosions in Vlambeer's Nuclear Throne — CONTROL500](https://ctrl500.com/game-design/explosions-in-vlambeers-nuclear-throne/)
- [Pixel Explosion (12 Frames) — OpenGameArt.org](https://opengameart.org/content/pixel-explosion-12-frames)
- [2D Explosion Animations Frame by Frame — OpenGameArt.org](https://opengameart.org/content/2d-explosion-animations-frame-by-frame)
- [Stylized Explosion — Real Time VFX forum](https://realtimevfx.com/t/stylized-explosion/11742)
- [Learning Particle Effects - All Critique/Advice Welcome — Real Time VFX forum](https://realtimevfx.com/t/learning-particle-effects-all-critique-advice-welcome/2104)

---

## 相关文件路径(供后续复核)

- `C:\Users\surpr\Desktop\TimeWarrior-Game\public\assets\img\fx_blast.png`(半空爆 16 帧序列,实测无体积收缩)
- `C:\Users\surpr\Desktop\TimeWarrior-Game\public\assets\img\fx_blast_ground.png`(贴地爆 16 帧序列,同上)
- `C:\Users\surpr\Desktop\TimeWarrior-Game\src\scenes\BootScene.js`(第 36-41、140-144 行:序列帧加载与动画定义,26fps/615ms)
- `C:\Users\surpr\Desktop\TimeWarrior-Game\src\scenes\ArenaScene.js`(第 206-256 行:`fx.explosion` 实现,含核闪/序列帧播放/贴地尘环熏黑/余烬;第 238 行:animationcomplete 直接 destroy 无收尾)
- `C:\Users\surpr\Desktop\TimeWarrior-Game\src\systems\Explosives.js`(丙烷罐燃烧/泄漏/爆炸/连锁全流程,第 81-118 行 `_explode()` 调用 fx.explosion)
- `C:\Users\surpr\Desktop\TimeWarrior-Game\.claude\skills\scene-fx-pipeline\SKILL.md`(第 48-51 行:项目自有"爆炸铁律"与 v2-v8 全部返工历史,含"一次爆炸只允许一个火球位置"等已定版规则)
