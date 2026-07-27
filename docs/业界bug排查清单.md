# 业界常见 bug 排查清单(47 条)+ 本项目实锤案例索引

> 来源:2026-07-24 用户授权的 4 路联网调研(资源泄漏/状态机与事件/数值公式/物理碰撞),当时用于 38 代理审计(15 候选→确认 6 全修)。**2026-07-27 洁癖收尾时从 workflow 存档抢救归档**——此前清单只活在会话记录里。
> 用法:自审/审查 workflow 时逐条对照扫码;每条候选必须过 opus 对抗复核("尽力反驳,反驳失败才判真"),防"听着吓人但追不出触发路径"的假阳性(当年 15 候选驳了 9)。
> 项目纪律补充:物理时序验收必须真实 rAF(泵帧推不动 Matter);测试前先量 rAF;场地先扫遮挡。

## 〇. 本项目实锤案例索引(每类都真踩过,防线所在)

| 实锤类型 | 案例 | 防线/教训在哪 |
|---|---|---|
| 高速穿隧(D 域) | 尸块/可推物/半壳穿楼板 | 引擎步级扫掠 CCD 模板=level-devices K 节"弹着冲量三件套"+I0"移动实体三防" |
| 帧率依赖(C/D 域) | 气瓶推力 165Hz=2.75 倍;阻尼/计数窗口 | 铁律:施力×(dt*60)、窗口用毫秒=level-devices I 节 |
| NaN 灌注(C 域) | 缺 corpseImpulse→尸块坐标 NaN 污染 Query.ray;深叠刚体解算 NaN | 配置不信任+每帧自愈+segVsRect 退化盒守卫=GibSystem/Ballistics 注释 |
| 状态残留(B 域) | 重生自动跳(jumpWindupUntil)/受击 flinch 残留/换弹态跨死亡 | "复现即复位"清单=character-anim B 节;死亡打断换弹=_onPlayerDied |
| latch 不清(B 域) | 尸体支撑 latch 终身不清=悬空尸复发 | unfreeze 清 latch=GibSystem;级联守卫四道闸=level-devices G 节 |
| 叠加超车(C 域) | 霰弹 7 弹丸击退/鞭尸冲量逐弹叠加破武器阶梯 | 40ms 窗口钳制=character-anim D 节"多弹丸逐弹结算叠加超车要当一类 bug 搜" |
| 双系统抢状态(B 域) | 受击白闪 clearTint 顶掉反射枪换弹熄光 | tintMode 仲裁+声明式每帧重申=WeaponSystem/character-anim B2 节 |
| 事件收尾缺失(B 域) | 霰弹弹尽终止进度条永久卡住 | 一切结束路径统一发收尾事件(t:1)=WeaponSystem |
| 支撑失效悬空(D 域) | 冻尸支撑被移走/拾取物垫脚被炸 | 支撑复核闭环(尸体)/支撑锚(掉落物)=level-devices G 节+Drops.js |
| 初醒失效(D 域) | setVelocity 对久睡刚体只改账面 | 冲量类一律 applyForce=level-devices G 节 Matter 大坑 |
| 测量假象(工具域) | 遮挡节流 1-4Hz 给相反结论/泵帧推不动物理/净位移对原地抖是瞎的 | 先量 rAF/真实秒数/累计路程=level-devices I 节 |
| 镜像坐标系(美术域) | flip 不镜像 origin"朝左变样"/rigs 2x1x 枪口飞一倍远 | 骨架铁律+验收公式贴图宽÷size≈2=character-anim B 节 |

## A. 资源与生命周期泄漏(11 条)

### A1. 对象池「只借不还」——回收路径缺失
为什么:对象池本意是复用避免频繁 new/GC，但如果死亡/离场时忘了调用 release()/recycle() 把对象还回池子，池子本身或者外部存活列表会无限增长；池子越用越大，等于把泄漏又包了一层，比不用池子还隐蔽。是 Group/pool 类代码里最常见的坑。
怎么查:找 spawn/get/acquire 一类创建或取用函数，确认每个调用点在对象销毁/死亡分支里都有配对的 release/recycle/despawn 调用；重点看 kill()、die()、onDeath() 等函数体内是否真的把对象交还给池（而不是只是 setActive(false) 或者干脆什么也没做）。Phaser 下具体看 group.killAndHide() 之后有没有遗留在别的数组里继续被引用。

### A2. 精灵/游戏对象从场景摘除但没 destroy()
为什么:把对象从数组/Group 里移除、隐藏、setVisible(false) 并不等于销毁——只要还有任何一处引用（另一个数组、闭包、事件监听器）存在，垃圾回收器就回收不了它，材质/纹理也留在 GPU 显存里不释放。这是长时间游玩后 FPS 缓慢下滑、显存持续上涨的典型元凶。
怎么查:搜索所有 splice/remove/filter 类「从数组/Group 摘除」的地方，确认摘除的同一行或同一函数附近是否调用了 .destroy()；再反向搜 .destroy( 的调用点是否覆盖了所有死亡/关卡切换路径（尤其是 boss 死亡、房间清场、场景 shutdown 这类批量清理点，常常漏掉）。

### A3. 粒子发射器只是「不再新增粒子」，从没 stop()/destroy()
为什么:很多实现里角色死亡后只把发射逻辑关掉（emitting=false 或干脆不再调用 emit），但发射器对象本体、以及已发出的粒子仍挂在 ParticleManager 里继续更新，长期堆积后粒子系统本身会拖垮帧率甚至内存无限增长直到崩溃。
怎么查:搜代码里所有 addParticles/createEmitter 之类创建发射器的地方，确认对应的死亡/结束逻辑里有 emitter.stop() 且随后有 emitter.remove() 或 emitter.destroy()（不能只有 stop 没有 remove/destroy，也不能只把标志位设 false）；查是否有「爆炸/枪口焰」这类一次性特效的发射器创建后完全没有清理代码，只靠自动过期。

### A4. 纹理/图集重复加载或卸载不彻底
为什么:用同一个 key 反复 load.image/load.atlas 而不检查缓存是否已存在，或者场景切换/角色替换时没有调用 textures.remove() 卸载不再用的纹理，纹理数据会持续占用显存直到浏览器/引擎重启，这是移动端和长会话网页游戏 OOM 崩溃的常见原因。
怎么查:搜所有 this.load.image/atlas/spritesheet 调用，检查加载前是否有 this.textures.exists(key) 判重；再搜场景/角色卸载路径里有没有对应的 textures.remove(key)（尤其是动态生成的角色皮肤、AI 出图这类运行时加载的资源，最容易漏卸载）。

### A5. 存活数组无上限增长（push 多、splice/filter 少）
为什么:子弹、敌人、伤害飘字、日志这类频繁产生的对象如果只 push 进数组而清理逻辑写漏或条件写错（比如用 === 判断浮点存活状态导致永远不命中），数组会随时间线性变长，每帧遍历/碰撞检测的开销也跟着线性变慢，最终不是内存爆就是帧率崩。
怎么查:对每个高频 push(...) 的数组，反向确认 update() 循环里有对应的「倒序遍历 + splice」或 filter 重建逻辑，且判死条件（如 hp<=0、alive===false、生命周期计时器到期）确实会被触发到；特别警惕遍历用正序 for 循环里做 splice（会跳过下一个元素，导致部分死亡对象漏删）。

### A6. 事件监听器/回调只加不删（on 多 off 少）
为什么:给场景全局事件总线、EventEmitter 或 DOM 元素挂监听器，若在对象销毁时没有对称调用 removeListener/off/removeEventListener，监听器闭包会一直持有对该对象（及其整条引用链）的强引用，是 JS 里最经典也最隐蔽的泄漏来源，且每次重复触发（比如反复进出同一房间）都会再叠加一份。
怎么查:搜所有 .on(' 或 addEventListener( 调用，逐一确认同一个类/模块的 destroy()/shutdown() 里有对应的 .off(' 或 removeEventListener(；重点排查 bind(this) 或箭头函数创建的匿名回调——因为没保存函数引用就无法 removeListener，这类写法几乎必然漏删。

### A7. update()/每帧回调里 new 出临时对象
为什么:在 60fps 的主循环里每帧 new 出 Vector2、数组、对象字面量、闭包函数等临时对象，会产生大量短生命周期垃圾，触发频繁的小型 GC（或偶发的 Stop-The-World 大 GC），表现为固定周期性的卡顿/掉帧，即使总内存并不持续增长也是性能问题。
怎么查:在 update/postUpdate/tick 一类每帧调用的函数体内搜 new 、字面量数组 [、对象字面量 {、以及会隐式分配的写法（比如每帧内联定义箭头函数当回调传参、字符串拼接生成 key）；对比是否可以把这些对象提到类字段上复用（每帧只改属性值而不重新分配）。

### A8. 定时器/延时任务持有对已销毁对象的引用
为什么:setInterval/setTimeout/scene.time.delayedCall 等定时任务如果在目标对象销毁时没有被 clearInterval/clearTimeout 或 timerEvent.remove()，定时器会继续持有闭包里捕获的对象引用（阻止 GC），到点触发时还可能因为访问已销毁对象的属性而报错或产生僵尸逻辑。
怎么查:搜 setInterval/setTimeout/delayedCall/addEvent 的调用点，检查返回的定时器句柄有没有被存起来，并在对应对象的 destroy()/die() 分支里调用清除；重点看那些绑定在角色/UI 元素身上的循环计时器（buff 跳字、持续伤害、UI 倒计时）。

### A9. 补间动画（tween）目标销毁后未被 kill
为什么:对象死亡/移除时如果没有停止正在运行它身上的 tween，TweenManager 会继续持有并更新一个指向已销毁对象的 tween，既浪费每帧开销，也让本该被回收的对象因为被 tween 引用而无法真正释放（Phaser 生态里因 AnimationManager 残留 remove 事件监听器导致泄漏是已知案例）。
怎么查:搜所有 this.tweens.add(/scene.add.tween( 调用，确认对应对象销毁路径里有 this.tweens.killTweensOf(obj) 或等价调用；也检查动画播放（play animation）绑定的 once/on 事件监听是否在动画结束或对象销毁时被移除。

### A10. 循环/背景音效实例反复叠加、从不 stop
为什么:背景音乐、脚步声等循环音效如果在场景重进/状态切换时不判重直接再 play 一份，旧实例既没 stop() 也没 destroy()，会出现多个音轨叠加播放（听感上杂音变大）且每个 Sound 实例继续占内存、继续被 SoundManager 更新。
怎么查:搜所有 loop: true 的 sound.play 调用，确认播放前有没有先 stop 已有实例的判断（比如维护一个 currentBgm 引用并在切换时调用 currentBgm.stop()）；同时看场景 shutdown 里是否遍历 sound.getAll() 或对应管理器做统一 stop+destroy。

### A11. 静态/全局缓存 Map 按对象 id 无上限增长
为什么:用一个模块级/单例的 Map 或对象字面量做缓存（比如按实体 id 缓存计算结果、按路径缓存资源），如果只有写入没有淘汰机制（LRU/TTL/显式 delete），缓存会随游戏运行时间和对象总量线性增长，是那种「玩得越久越卡」但很难用常规内存快照定位的泄漏，因为它看起来是「正常」的缓存代码。
怎么查:搜文件顶层或类外声明的 new Map()/{} 且没有 clear()/delete() 配对调用的地方；重点看以「实体 id」「路径字符串」为 key 的缓存——判断这些 key 的取值范围是否会随游戏进行持续新增（而不是固定有限的枚举集合）。


## B. 状态机与事件(12 条)

### B1. 监听器只订阅不反订阅（Lapsed Listener Problem）：状态/场景 enter 时 .on()/addEventListener 订阅事件，但 exit/shutdown/destroy 时没有对称的 .off()/removeEventListener。
为什么:维基百科'Lapsed listener problem'条目指出这是OOP中内存泄漏的经典成因；对游戏而言更严重的是逻辑污染——旧场景/旧状态的回调仍挂在事件总线上，会在新状态下被意外触发（比如已经切到菜单场景，战斗场景的伤害监听器还在响应全局事件），造成状态残留和莫名其妙的副作用。Phaser官方issue(#1174、#4028)也专门讨论过'必须为所有attach的事件提供removeEventListener指引'的缺失。
怎么查:在每个状态类/场景类里数 .on(/addEventListener( 的调用次数和 .off(/removeEventListener( 的调用次数是否一一对应；重点看构造函数/init()/enter()里订阅、但 destroy()/shutdown()/exit() 里没有同名事件的注销；Phaser 项目里专门搜 this.events.on( 和 this.scene.events.on( 是否配对 this.events.off(

### B2. 定时器/延迟调用在游戏暂停时仍在跑（setTimeout/setInterval/time.delayedCall 不受暂停开关约束）。
为什么:setTimeout/setInterval 是挂在浏览器事件循环上的墙钟计时器，与游戏内部update循环/暂停标志毫无关系；搜索确认这是JS游戏开发的常见坑——很多人以为setTimeout会'冻结'，实际它照常触发，导致暂停菜单打开时后台伤害结算、AI决策、冷却计时依然推进。
怎么查:全局搜 setTimeout(/setInterval(/time.delayedCall(/time.addEvent( 的调用点，检查其回调函数体内第一行是否有 if (this.paused || scene.isPaused()) return; 这类守卫，以及暂停函数(pause()/onPause())里是否对应调用了 clearTimeout/timerEvent.paused=true/this.time.paused=true

### B3. 对象/场景已销毁后，其残留的定时器、协程或异步回调仍在最后触发一次，访问已失效的引用。
为什么:Unity论坛与GitHub issue多次报告：GameObject被Destroy后，尚未执行完的协程/try-finally块不会被正确清理，导致MissingReferenceException或者'幽灵复活'（角色明明死了，延迟回调又把它的HP改活）；JS世界同理，Promise.then/tween onComplete/animationcomplete事件在场景destroy后仍会异步落地。
怎么查:找每个 delayedCall/StartCoroutine/setTimeout/.then( 的回调体，检查开头是否有 if (!this.active || this.scene==null || this.destroyed) return; 这类存活性检查；再检查 destroy()/shutdown() 方法里是否显式 clearTimeout/StopCoroutine/removeEvent 把它们提前掐掉，而不是指望回调自己判空

### B4. 场景/关卡重启(restart)时只重置了部分变量，遗漏的标志位、计数器、静态/模块级字段带着上一局的值进入下一局。
为什么:多篇资料（包括itch.io开发日志）明确指出'重启后进入不可恢复状态'的根因就是重启逻辑里变量重置不全，尤其是声明在模块顶层或类静态字段上的状态——它们的生命周期比场景实例长，restart()重新走一遍create()也救不了它们。
怎么查:在 restart()/init()/create() 里列出所有被重置的字段，反向对照类里全部可变字段（尤其是 static 字段、闭包捕获的模块级 let/var、单例上挂的属性），凡是没出现在重置列表里的都是嫌疑对象；重点排查 score、flags、inventory、cooldown、hasTriggered 这类布尔/计数器

### B5. 对象池复用(getFirstDead/pool.get/group.get)时只 setActive(true).setVisible(true)，没有真正重置速度/血量/tint/动画帧/挂载的定时器和监听器。
为什么:搜索结果里对象池最常见的坑就是'状态残留'：被复用的子弹/敌人带着上一次使用时的速度、血量、动画相位甚至事件订阅，这类bug往往要玩几分钟、池子循环几轮之后才会暴露，非常难复现和定位。
怎么查:找到项目里 pool.get(/group.get(/getFirstDead( 的调用点，跟进它后面紧跟的 reset()/spawn() 函数体，检查是否显式清零 velocity、重设 health、stop 掉粒子/tween/timer、清掉上次绑定的事件监听，而不是只调用 setActive/setVisible/setPosition

### B6. 碰撞/触发/交互事件同一帧内被处理两次（double trigger），造成双倍伤害/双倍加分/双倍拾取。
为什么:Unity论坛(OnTriggerEnter2D/OnTriggerEnter系列)大量重复报告这个问题，常见诱因是同一对物体同时注册了collide和overlap两套回调、或者碰撞体本身由多个子碰撞形状构成导致同一帧多次进入判定区；社区给出的标准解法是加一次性防抖标志位。
怎么查:检查每个 onCollide/onOverlap/onTrigger 回调，是否在函数体最前面有 if (this.hasHit) return; this.hasHit = true; 这类一次性锁；重点排查同一对game object是否被同时注册进了两套碰撞判定(collider+trigger各一份)，以及回调体内是否直接改状态而不查重

### B7. 状态切换函数(changeState/setState)没有'切换中(transitioning)'锁，允许输入/网络事件在一次状态切换尚未完成时再次触发切换，形成竞态或状态机被并发改写。
为什么:多个状态机教程强调'guard condition'是transition四要素之一，但实践中最容易被省略的正是这条：切换往往涉及异步(播动画、加载资源)，若期间再收到一次触发事件，两次切换的顺序不确定，会出现状态机停在意料之外的组合态（即Godot论坛描述的'卡在attack状态'）。
怎么查:在 changeState()/setState() 实现开头找是否有 if (this.isTransitioning) return; 或等价的锁；再看输入处理函数/网络消息处理函数是否直接调用changeState而不经过这层锁，尤其是异步(await/Promise/协程)切换逻辑中间还能被外部再次调用的路径

### B8. 状态相同时重复调用changeState仍会重新执行一遍进入逻辑（缺少'已在该状态'短路判断），导致UI重复弹出、定时器被二次启动、监听器被二次订阅。
为什么:这是1号(监听器泄漏)和6号(定时器不受控)两个问题的放大器：如果changeState对相同目标态不做no-op处理，那么只要调用点有多条路径（输入+碰撞+网络三处都可能触发同一次切换），实际进入次数就会超预期，泄漏和重复触发会在这里叠加爆发。
怎么查:检查 changeState(newState) 函数体最前面是否有 if (newState === this.currentState) return; 这类等值短路；如果没有，进一步确认该函数是否被多个独立触发源（键盘输入回调、AI决策、网络同步）分别调用

### B9. 暂停(pause)只停渲染/停tween，没有在update()最上方和输入回调里统一挡掉逻辑更新，导致'暂停'状态下角色仍可移动或物理仍在演算。
为什么:搜索中的通用建议反复强调：background task应该检查running/paused变量才决定要不要执行；如果只是隐藏UI或停掉TweenManager而漏了update()和输入监听器，就会出现'暂停菜单开着，角色在背后继续被打'这种典型体验级bug，也会造成暂停期间产生的状态变化在恢复后突然生效的错觉。
怎么查:看每个Scene/Entity的 update(time, delta) 函数第一行是否有 if (this.isPaused) return; 或者物理世界层面调用了 this.physics.world.pause()；再检查输入处理器(onKeyDown/onPointerDown)内部是否也复用了同一个paused判断，而不是只在UI层拦截

### B10. 全局/中断类转移（死亡、强制过场、被打断的技能）绕过状态机正常的exit()流程，直接赋值当前状态或跳转，跳过了该状态本该做的清理（取消订阅、停定时器、还原碰撞体）。
为什么:状态机教程建议'在enter()订阅信号，在exit()反订阅'，但死亡/受击/强制切场这类'any state可打断'的转移最容易被实现成直接set一个新状态跳过exit()，因为写代码的人觉得'反正都要死了不用清理'——但正是这条路径把前面几条问题(监听器、定时器)全部放大成'角色死后还在触发攻击判定/掉血'这种诡异表现。
怎么查:在状态机里搜索所有能改变 this.currentState/this.state 字段的赋值点，确认除了主 changeState() 之外有没有旁路的直接赋值（常见于onDeath/onHit/onInterrupt这类回调里）；凡是旁路赋值，检查它有没有手动补一份等价于exit()该做的清理

### B11. 检查点/存档读取只恢复了位置与血量等'显性'字段，没有恢复或清空关卡内瞬态状态（已激活的定时开关、已生成的敌人列表、已开的门标志、正在计时的buff），造成读档后软锁或逻辑与画面不一致。
为什么:软锁的经典定义是'某个推进所需的前置条件被永久破坏而无路可走'；存档/检查点系统如果只对齐可见的血量/位置而漏掉了驱动关卡进程的隐藏flag（比如'门已开但存档没记录，读档后门又关了但触发钥匙的机关已经被消耗'），就是软锁最常见的制造者之一。
怎么查:对比关卡 create()/初始化时设置的全部状态字段清单，与存档读取函数(loadCheckpoint/restoreState)实际写回的字段清单，找出'只在初始化出现、不在读档函数出现'的字段；重点看那些一次性(one-shot)标志——一旦执行就不会再被自然触发第二次的机关

### B12. 在遍历实体集合(for/forEach over group.children或enemies数组)的过程中，回调内部对同一集合执行destroy()/splice()/remove()，导致遍历过程中元素被跳过或同一元素被处理两次。
为什么:这是'sometimes fires twice / sometimes skipped'类诡异bug的经典成因之一：JS数组或Phaser Group在被迭代时如果同步做删除操作，索引会错位，紧跟在被删元素之后的下一个元素要么被跳过(数组前移导致漏判)、要么在下一帧又被判定命中，行为看起来像是竞态但实际是纯粹的迭代期变更(mutate-during-iterate)。
怎么查:搜索对 this.enemies.forEach/for (let i of group.children)/group.children.each( 这类循环，检查回调体内是否调用了同一集合上的 destroy()/remove()/splice()；若有，确认是否已改为先拷贝快照([...array]/array.slice())再遍历，或者是否已改成倒序for循环删除


## C. 数值与公式(12 条)

### C1. 数值累积无上限/无夹取（伤害、金币、经验、连击倍率一路叠加不封顶）
为什么:整数溢出是游戏史上最经典的漏洞类别：TES: Arena 法术消耗到 65536 溢出变成近乎免费；FF7 单击伤害到 262144 触发严重故障；Diablo III 曾因整数溢出被刷崩经济。JS Number 超过 2^53 (Number.MAX_SAFE_INTEGER) 会静默丢精度，若中途转成 Int32/位运算还会直接变负数。
怎么查:grep 找持续做 `+=`/`*=` 的伤害、金币、连击计数变量，看有没有紧邻的 Math.min/clamp；重点看是否用了位运算 (`|0`、`>>>0`、`& 0xFFFFFFFF`) 或 Int32Array/Uint16Array 存放会不断增长的数值；检查伤害公式里 buff 是否以 `dmg *= (1+buffA)*(1+buffB)*...` 连乘而没有总倍率上限。

### C2. 除法公式的分母可能为零或负（护甲减伤率、速度=距离/deltaTime、百分比公式）
为什么:0/0 或 x/0 在 JS 里产生 NaN 或 Infinity，NaN 会静默传播且 `NaN < x`/`NaN > x` 恒为 false，常导致角色对任何伤害比较都判负 → 变相无敌，或者护甲值到 100%+ 时减伤公式除以 (100-resist) 分母归零。
怎么查:grep 分母含 `resist`、`armor`、`deltaTime`、`(100 - x)` 的除法表达式；检查第一帧或标签页失焦恢复后 deltaTime 是否可能为 0；对护甲/抗性变量搜是否有上限夹取（是否可能达到或超过分母归零的那个值）。

### C3. 位置/计时器/触发条件用浮点数做精确相等比较（`=== `/`==`）而非阈值/区间判断
为什么:物理引擎和 tween 累积的浮点数几乎不会精确命中目标值，用 `x === targetX` 或 `timer === 0` 做通关/触发条件，要么条件永远不触发（软锁/卡关），要么因为累积误差意外提前/滞后触发（可被利用来 sequence break）。
怎么查:grep `=== 0`、`=== target`、`.x ===`、`timer === 0` 等出现在位置、计时器、tween 进度上的严格相等判断；检查触发区/胜利条件是否应改为 `Math.abs(a-b) < eps` 或 `<=`/`>=` 区间判断。

### C4. 无敌帧(i-frame)标志位在同一帧内被多次碰撞回调绕过或计时错序
为什么:Arcade/Matter 物理一帧内可能对同一对多次触发 overlap/collide 回调（多体重叠、子弹密集），如果无敌标志是在回调内部才置真，或计时器在碰撞检测之后才递减，会出现一帧内多次结算伤害（无敌帧被绕过），或者相反：标志忘记复位导致永久无敌。
怎么查:看 `invincible = true` 是赋值在触发它的同一个碰撞回调里还是在 update() 顶部统一处理；确认 i-frame 剩余时间的递减发生在碰撞检测之前还是之后；搜索 setTimeout 实现的无敌窗口，检查暂停/切场景时是否会被清空导致漏判或卡死。

### C5. 冷却/技能计时被无关事件（换装、动画打断、场景切换、buff 刷新）直接清零而非只影响剩余时间
为什么:很多“取消后摇/换技能/切场景”实现会把 `lastCast = null` 或 `cooldownEnd = 0` 当副作用一并重置，导致同一技能可以靠反复触发这些无关操作无限连发（如 Otherworld Legends 的技能互换叠加无敌 buff 案例）。
怎么查:grep 所有把 `cooldown`/`lastUsed`/`cooldownEnd` 赋值为 0/null 的地方，确认触发来源是自然冷却完成还是装备/闪避/切场景等旁路事件；检查技能释放判定是在应用换装/取消动作之前还是之后读取冷却值。

### C6. 高速移动体（子弹、冲刺、电梯）只做离散逐帧位置更新，没有扫掠/连续碰撞检测(CCD)
为什么:当物体一帧内移动距离大于最薄碰撞体厚度时，两个采样帧都不落在重叠区间内，物体就会隧穿（tunneling）——典型表现是玩家冲刺/子弹直接穿墙、穿地板卡出地图，或子弹穿过敌人零伤害。
怎么查:查冲刺/子弹/高速平台的移动代码是否只是 `body.x += vx*dt` 直接位移，没有 raycast/shapecast 扫掠；核对最大速度 × 帧间隔是否可能大于场景里最薄的墙/闸门厚度；检查这些高速对象的物理体是否显式启用了 CCD/连续碰撞选项。

### C7. 存档/物品转移不是原子操作，中途退出或重载可以复制或丢失道具
为什么:经典刷物品漏洞家族（No Man's Sky 冻结库存刷货、Minecraft 各类 dupe）：转移/拆分操作被拆成“先加后减”两步非原子写入，如果在两步之间触发存档、退出或崩溃，重新加载会恢复到事务未完成前的状态，而事务已产生的另一份效果却保留了下来。
怎么查:找物品在两个容器间移动/拆分堆叠的函数，检查是先 add 后 remove（或反之）两次独立赋值，还是一次原子 swap；检查自动存档/checkpoint 调用是否可能夹在这类转移函数的中间（比如动画回调、Promise 链里）触发。

### C8. 生命值/资源扣减后未夹取到 0，或存放在会下溢环绕的数值类型里
为什么:`hp -= dmg` 若不跟 `Math.max(0, ...)`，hp 可以变成负数；如果死亡判定写的是 `hp === 0` 而不是 `hp <= 0`，负数 hp 永远不会触发死亡（打不死的秒杀漏洞）；若 hp/弹药存在 Uint8/Uint16 等无符号定长类型里，减到负数会直接环绕成接近最大值（相当于瞬间满血/满弹）。
怎么查:grep `hp -=`、`health -=` 附近有没有 clamp；搜死亡/耗尽判定用的是 `=== 0` 还是 `<= 0`；检查任何用 TypedArray（Uint8Array/Uint16Array 等）存放会被减法操作的生命/弹药/耐久字段。

### C9. 关卡网格/路点/瓦片数组的边界访问缺少检查，越界读取被当成“可通行”默认值
为什么:循环用 `<=` 而非 `<` 判断数组长度，或者在地图边缘查询 `tileAt(x+1, y)` 拿到 undefined，很多碰撞解析器会把 undefined/falsy 当成“非实体、可通过”，玩家因此能从地图边缘走出关卡边界（越界卡出地图），或者直接抛异常把游戏卡死。
怎么查:搜索瓦片/网格查询函数（`getTileAt`、`mapData[y][x]`）有没有显式的越界检查；检查循环条件里是否出现 `i <= arr.length`/`i <= width` 这类差一错误；确认碰撞判定对 undefined 瓦片的默认处理是“视为实心/阻挡”还是“视为可通过”。

### C10. 冷却/解锁/存档时间戳只信任客户端本地时钟或未持久化的运行时计时器
为什么:如果限时机制只靠 `Date.now()`/内存里的 timer 判断而不在存档里持久化并在读档时重新校验，改系统时间、读档回溯、或利用场景切换让计时器归零，都能绕过原本应该等待的冷却/解锁（存档回溯刷资源）。
怎么查:检查冷却/解锁判定是否直接用 `Date.now()`/`this.time.now` 做权威依据；确认存档结构里是否保存了这些计时器的绝对完成时间戳，读档时是否用它重新计算剩余时间，而不是让计时器从 0 重新开始跑。

### C11. 光环/持续效果的百分比 buff 在 onOverlap 等每帧回调里重复叠加，而非进入时结算一次
为什么:如果 buff 是挂在 `overlap` 回调里每帧都执行一次 `applyBuff()`，只要角色停留在触发区一帧就会被反复叠加多次，几帧内倍率指数级增长，造成伤害/减伤瞬间爆表（对应 FF8 Drain 数值回绕、TES Arena 溢出法术这类真实案例背后的机制）。
怎么查:搜索 buff/光环应用逻辑是挂在 `onOverlap`/`update` 每帧触发的回调里，还是有“已应用”标志防止重复叠加；检查 buff 累加用的共享变量有没有在离开触发区/结算后被清空或有独立上限 `Math.min(cap, total)`。

### C12. 关卡进度门控只检查一次性设置的标志位，不重新校验前置世界状态
为什么:经典 sequence break 手法：如果推进逻辑写成 `if (this.hasKeyFlag) proceed()`，而不持续校验“门是否真的还锁着”“前置对象是否真的存在”，玩家用跳跃/传送等手段绕开正常路径直接触发后续标志位，就能跳过内容，或者因为跳过了本该创建某个引用对象的步骤而访问到 undefined 引用崩溃/卡关。
怎么查:搜索关卡/触发脚本里 `if (this.flagX) {...}` 这类只读一次性布尔标志的门控代码；检查触发体是否设了 `once: true` 但其回调假定了“更早的、可被跳过的步骤”已经创建好了某些对象/状态引用。


## D. 物理与碰撞(12 条)

### D1. 离散检测漏判高速穿透 (tunneling / bullet-through-paper)
为什么:离散碰撞检测每帧只判断“当前位置”是否重叠，高速物体在一帧内的位移可能大于自身/墙体厚度，直接跳过重叠区间——子弹时速经典案例：1000ft/s @60fps 每帧移动16.7ft，薄墙直接穿过而不触发碰撞。
怎么查:找到世界步进/碰撞判定函数（如 `this.physics.world.step`、`Matter.Engine.update`、自写的 `checkCollision`），看它是否只对“当前帧终点位置”做 AABB/SAT 重叠测试，没有沿运动路径的扫掠测试(swept shape)或射线预测；grep `velocity.x * delta` 之类的位移计算，若旁边找不到对应的 raycast/shapecast 或 CCD 开关(如 Unity `collisionDetectionMode` 停在 Discrete)，且该物体速度可能超过自身尺寸/最薄障碍物厚度，即命中此模式。

### D2. 休眠体未被外部变化唤醒 (sleep/wake 漏唤醒 → 掉落穿地)
为什么:物理引擎对休眠(sleeping)物体完全跳过求解器计算以省性能；如果地形/平台在它下面被移动、销毁或替换而没有显式唤醒调用，休眠体永远不会重新检测接触，直接穿模掉落。
怎么查:grep `isSleeping`/`sleepThreshold`/`setAwake`/Matter 的 `Sleeping.set`；核查每一处“移动平台、销毁地形、在静止物体下方生成新物体”的代码路径是否配套调用了唤醒函数(`Body.set(body,'isSleeping',false)` / `wakeUp()`)。只要有平台变更逻辑但找不到对应唤醒调用，就是漏点。

### D3. 初始深度重叠导致爆炸式修正力 (spawn/teleport 时体已重叠)
为什么:求解器的位置修正项(Baumgarte 稳定化/slop)按穿透深度成比例施力；如果两体一开始就重叠很深(常见于直接 setPosition 生成/传送)，修正冲量在一两帧内被放大到极端值，物体被“弹射”出去或数值溢出。
怎么查:grep 生成/传送代码里直接写坐标的调用(`setPosition`、`body.position =`)，看生成前是否先做过与实体的重叠检测；再看约束求解代码里的 `penetration`/`separation`/`beta`(baumgarte系数)常量，若穿透深度没有被 clamp(如 `Math.min(penetration, maxCorrection)`)就直接乘系数出力，即是隐患点。

### D4. NaN/Infinity 无护栏扩散 (刚体“爆炸”成 NaN)
为什么:对零长度向量做 `.normalize()` 或除以零距离(两体质心完全重合、法线退化)会产生 NaN；NaN 一旦进入速度/位置就永久污染(NaN !== NaN，任何边界/休眠比较都不会触发)，物体先是不可见地飘走，几帧后才在屏幕上表现为剧烈乱抖或飞出地图。
怎么查:grep `.normalize()`、`1 / distance`、`Math.sqrt` 用在法线/穿透向量计算处，看有没有零长度保护；再看整个更新循环里是否存在任何 `Number.isFinite(velocity.x)` 之类的兜底断言——如果全项目都没有一处，就是典型的“没有 NaN 护栏”代码气味。

### D5. 可变步长(dt)直接喂进积分 → 不确定性/不可复现
为什么:物理积分若直接用每帧真实的 `delta`(而非固定步长)算速度/位置，浮点结果依赖 dt 精确值；同样输入在不同帧率/硬件上跑出不同轨迹，回放、ghost 数据、联机同步、以及“同一个 bug 复现不出来”都源于此。
怎么查:在场景 `update(time, delta)` 里搜索 `delta` 是否被直接代入速度/位置公式或引擎 step 调用(如 `Engine.update(engine, delta)`)，而不是量化成固定的 `1/60` 常量步长；若没有累加器(accumulator)把可变 delta 转成固定子步，即命中。

### D6. 固定步长追赶循环无上限 (spiral of death)
为什么:典型写法 `while (accumulator >= step) { simulate(); accumulator -= step }`；一旦某帧物理计算耗时超过 step 本身，accumulator 只增不减，下一帧要模拟更多子步、耗时更久，形成正反馈直到游戏卡死/冻结。
怎么查:找到固定步长累加器循环，检查是否存在子步数上限或 accumulator 硬性 clamp(如 `if (accumulator > maxAccum) accumulator = maxAccum`)；`while` 循环旁边没有任何最大迭代次数保护，就是隐患。

### D7. 远离原点的浮点精度衰减 (大世界坐标抖动/散架)
为什么:float 尾数精度随数值增大而下降，坐标增量若小于该量级下可表示的最小间隔就会被舍入丢失，表现为远处物体位置“量子化跳跃”抖动；在有约束装配的场景(飞船/关卡拼接物)还会因部件相对位移误差累积而互相挤入、连锁爆炸(KSP“Kraken”即此机制，靠重定义参考系解决)。
怎么查:查关卡/瓦片地图 JSON 里坐标最大值量级，若远离(0,0)达到数千至上万单位且物理仍用单精度 float，同时代码里找不到“浮动原点”重定心逻辑(`floatingOrigin`/`originOffset`之类)或双精度权威坐标，即命中。

### D8. 拼接地形内部接缝幽灵碰撞 (internal edge / ghost collision)
为什么:平坦地面若由多个独立矩形/瓦片碰撞体拼成而非合并成一条链形状(chain shape)，物体沿接缝滑动时会撞上共享边缘上退化出的错误法线，即使视觉上是平的，也会被卡顿/弹跳一下。
怎么查:看瓦片碰撞体生成方式——若每个瓦片各自独立建 body/collider(grep `setCollisionByProperty`、`createFromTiles`、逐瓦片 `Matter.Bodies.rectangle`)且没有边缘合并/内部边消除步骤(chain shape、`internal edge`抑制)，即为此模式。

### D9. 宽相位(broadphase)配对缓存过期 (瞬移/极速物体幻影碰撞)
为什么:宽相位(AABB sweep-and-prune/空间哈希)只在物体 AABB 超出上次缓存的“肥AABB”边界时才刷新配对；瞬移(重生/传送门/直接改坐标)或单帧极大加速度的物体，可能留下与旧位置的幻影碰撞配对，或来不及生成与新位置邻居的配对而漏检。
怎么查:grep 直接改坐标的调用(`setPosition`、`body.position.x = `)，确认是否走了引擎自带的位置设置 API(如 Matter 的 `Body.setPosition` 会自动刷新宽相位)而不是绕过它手写赋值；再看引擎的宽相位边距(fatAABB/margin)常量是否针对游戏典型单帧速度调过。

### D10. 热启动(warm-start)冲量与接触ID错配 → 突然弹跳/抖动
为什么:序列冲量求解器按接触特征ID缓存上一帧的累积冲量以加速收敛(warm starting)；若碰撞体在运行时被缩放/换形状导致特征ID排序改变而缓存未清空，下一帧会把不相关接触的旧冲量错误地套用到新接触上，表现为突然的能量注入(弹一下)或局部抖动。
怎么查:看接触流形(manifold)生成代码里用于缓存的 `id`/`key` 字段是怎么算的(通常来自形状特征索引)；检查运行时改变碰撞体大小/形状的代码(如 `Body.setVertices` 或直接改 `scale`)是否清空/重建了该缓存——没清空即为此坑。

### D11. 弹性/摩擦合并规则导致能量净增 (物体永不“睡着”)
为什么:两种材质弹性(restitution)都接近1.0，或合并函数取 `max` 而非 `min`/平均，加上求解器没有“静止速度阈值”强制归零，会让物体每次反弹都比物理上应有的多一点能量，看起来像“抖个不停/怎么都不睡”。
怎么查:grep 材质弹性数值(`restitution:`、`bounce:`)是否普遍接近1；查碰撞响应代码里的合并函数是 `Math.max(a.restitution,b.restitution)` 还是 `Math.min`/平均——前者是红旗；再看有没有一个“低于此速度就强制弹性=0”的阈值判断，没有即命中。

### D12. 更新顺序错位导致的二次积分/滞后帧 (手动逻辑与引擎积分打架)
为什么:若游戏代码在物理引擎已经把该帧速度积分进位置之后才设置/修改速度，或者在引擎 step 之前读取 `body.position`(读到上一帧值)，再手动叠加一遍 `position += velocity * delta`，就会跟引擎内部积分重复计算，表现为多走一段距离/能量凭空增加，或碰撞响应“慢半拍”。
怎么查:在场景 `update(time, delta)` 里核对：设置输入速度的代码是在 `this.physics.world.step()`/`Matter.Engine.update()` 之前还是之后；再 grep 是否存在手写的 `position.x += velocity.x * delta` 与引擎自带积分(Arcade/Matter 都会自己积分速度)并存——两者同时存在即为二次积分坑。

