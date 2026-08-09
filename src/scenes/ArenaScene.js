// 竖切片主场景:把 输入/玩家/敌人/弹道/断肢/特效/HUD 全部接线。
import Phaser from 'phaser'
import { InputState } from '../core/InputState.js'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import { Player } from '../entities/Player.js'
import { Enemy } from '../entities/Enemy.js'
import { BioEnemy } from '../entities/BioEnemy.js'
import { Turret } from '../entities/Turret.js'
import { Ballistics, segVsRect } from '../systems/Ballistics.js'
import { GibSystem } from '../systems/GibSystem.js'
import { Devices } from '../systems/Devices.js'
import { Elevator } from '../systems/Elevator.js'
import { Explosives } from '../systems/Explosives.js'
import { LockdownRoom } from '../systems/LockdownRoom.js'
import { WeaponSystem } from '../systems/WeaponSystem.js'
import { Drops } from '../systems/Drops.js'
import { BigFan, SteamVent } from '../systems/BigFan.js'
import { FluidFx } from '../systems/FluidFx.js'
import { Hud } from '../ui/Hud.js'
import { ThreatMarkers } from '../ui/ThreatMarkers.js'
import gameCfg from '../../config/game.json'
import levelCfg from '../../config/level_slice.json'
import weaponsCfg from '../../config/weapons.json'
import enemiesCfg from '../../config/enemies.json'

// —— 区域档案表(Region Profile,基地章;提案 §二.2)——
// 一行一区:tex/walkR(构造性对齐,实测勿手调)/tint(明度纪律:各区 V 拉开)/雾/灯光色。
// 新区 = 加一行 + 一张概念图。REGION_X0 以西=地表走廊与蜂巢(沿用旧背景管线)。
const REGION_X0 = 4600
const REGIONS = [
  // 参考48 格栅走道顶面 598-635,取中 615/887=0.693(probe-band 实测)
  { id: 'duct', name: 'R-A 管廊夹层', x: 4600, w: 1300, top: 280, walkY: 470,
    tex: 'bg_duct', walkR: 0.693, tint: 0xb9c2cc, fogAlpha: 0.035, fogTint: 0x6f8f7a,
    fgSpots: [0.10, 0.86] }, // 前景管避开两处地沟坑口(5080/5330)与甲板检修口(5545-5705)
  // walkR 实测(tools/probe-walkline + probe-band):参考47 甲板顶面 608-628,取中 618/887=0.697
  { id: 'power', name: 'R-B 动力涡轮区', x: 5900, w: 1860, top: 60, walkY: 700, thresholdWalkY: 470,
    tex: 'bg_power', walkR: 0.697, tint: 0xd6cdb4, fogAlpha: 0.045, fogTint: 0xffd98a, lampColor: 0xffc447,
    fgSpots: [0.29, 0.4] }, // 前景管避开风扇(0.52 起)/总控台/补给间门(6125);门框立在走道尽头(470)非大厅底
]

// 桁架切件 prop_platform(279×44)的三段切分点:两端是成品端盖(斜切端盖+蓝端灯+下弦杆内收),
// 中段 [37,243) 可无缝平铺 —— 数值为逐列 RGBA 差全搜索实测(见 _trussMid 注释),勿手调
const TRUSS = { full: 279, capL: 37, capR: 36, mid: 206, h: 44 }

export class ArenaScene extends Phaser.Scene {
  constructor() { super('arena') }

  create() {
    this.gravityY = gameCfg.gravityY
    const L = levelCfg
    this.solids = L.platforms
    // 楼梯展开(真实钢梯定版,用户点名"现实楼梯台阶下面没东西"):每级=一块薄踏板(h8),
    // 踏板之间/楼梯底下全是空的——楼下可以钻(高段下方立走、低段下方蹲爬),子弹能从梯下穿过;
    // 顶面坐标与旧实心柱完全一致(台阶助步/穿洞几何零回归),视觉由 _buildStairs 按双斜梁钢梯拼装
    for (const st of L.stairs ?? []) {
      for (let k = 1; k <= st.steps; k++) {
        const sx = st.dir > 0 ? st.x + st.stepW * (k - 1) : st.x - st.stepW * k
        this.solids.push({ x: sx, y: st.y - st.stepH * k, w: st.stepW, h: 8, stair: true })
      }
    }

    // —— 背景:基地走廊概念图(地板线对齐地面顶),压暗让前景角色读得清 + 上下暗角 ——
    const bgTex = this.textures.get('bg_corridor').getSourceImage()
    const bgScale = 470 / 655 // 概念图内走道面上沿在 y≈655
    // 走道面是微俯视(能看到顶面):整图上移 16px,让碰撞地板线(470)落在走道带中部——
    // 人物"走在走道面中间"而不是踩着走道带最上沿(用户点名)
    const bgOffY = -16
    const bgW = bgTex.width * bgScale
    // 供装置层做"原位裁切"用(暗门收纳槽盖板=脚下这块地板自身的像素,画在滑板之上=滑入地下的遮挡)
    this.bgMeta = { scale: bgScale, offY: bgOffY, w: bgW, hDisp: bgTex.height * bgScale,
      roomTintFrom: 2450, roomTintTo: REGION_X0 }
    // 地表段(蜂巢入口以西)沿用走廊概念图;基地章新区各自走 REGIONS 档案表(见 _drawRegions)。
    // 最后一片图裁切到 REGION_X0(否则延伸进新区被新图盖住,而挂在它上面的动效照常播放=
    // "容器不在了泡泡还在冒"的穿帮,2026-07-28 用户实见);动效层同样传 maxX 逐元素守卫。
    //
    // 【镜像交替平铺(2026-08-09 判真 #16 的本批缓解)】整图原样铺 4 次 → 周期 1199.76 <
    // 一屏,X形防爆门/三联培养舱/雷达屏各出现 4 次且每次都在屏幕同一相对位置(01 与 05 两帧
    // 逐像素相同)。奇数片改**水平镜像**:①相邻两片在接缝处像素连续(镜像轴),平铺硬缝一并
    // 消失;②地标序列变成 A A' A A',同一批主角级元素不再同姿态复现。**竖向不偏移**——
    // 走道面必须恒对齐地面 470(A2 构造性对齐铁律),±20px 竖偏会直接毁掉地板线。
    // 完整解(旧区拆 2-3 张不同概念图轮换)属美术批次,见交付报告。
    //
    // 【房间色温改独立冷色罩(判真 #19)】整图 setTint 的粒度是"一片瓦",所以房间冷色只能落在
    // 瓦片边界 2399.5(比设计线 2450 早 50px),形成一条贯穿全屏高的硬色阶。改法:底片一律
    // 中性 tint,冷色由**同一张图的第二份拷贝 + 四角 alpha 横向渐变**叠加(全 alpha 处与旧版
    // 逐像素同色),色温边界与瓦片边界彻底解耦;东界对齐 REGION_X0(那里本就换区换图)。
    const ROOM_X = 2450, ROOM_R = 110, COOL = 0x7e8dad, NEUTRAL = 0x9096a0
    const coolAt = (wx) => Phaser.Math.Clamp((wx - (ROOM_X - ROOM_R)) / (ROOM_R * 2), 0, 1)
    let bgTile = 0
    for (let bx = 0; bx < REGION_X0; bx += bgW, bgTile++) {
      const flip = bgTile % 2 === 1
      // 镜像用**负 scaleX**(不是 setFlipX):Phaser 的 flipX+crop 会把裁切窗与纹理列一起镜像,
      // 取到的是"另一端"的列;负 scaleX 走普通裁切分支,末片才能正确裁到 REGION_X0
      const mk = (tint) => {
        const im = this.add.image(flip ? bx + bgW : bx, bgOffY, 'bg_corridor')
          .setOrigin(0, 0).setScale(flip ? -bgScale : bgScale, bgScale).setDepth(0).setTint(tint)
        if (bx + bgW > REGION_X0) {
          const cw = (REGION_X0 - bx) / bgScale
          im.setCrop(flip ? bgTex.width - cw : 0, 0, cw, bgTex.height)
        }
        return im
      }
      const aL = coolAt(bx), aR = coolAt(bx + bgW)
      if (aL >= 1 && aR >= 1) {
        mk(COOL) // 整片在房间内:一份就够(与旧版同色)
      } else {
        mk(NEUTRAL)
        if (aR > 0) { // 局部冷色罩:四角 alpha 的 TL/BL 对应**局部左**,镜像片的局部左落在世界右
          const a0 = flip ? aR : aL, a1 = flip ? aL : aR
          mk(COOL).setDepth(0.02).setAlpha(a0, a1, a0, a1)
        }
      }
      this._decorateBackdrop(bx, bgScale, bgOffY, REGION_X0, flip)
    }
    this._drawRegions(L)
    this._drawUnderdeck()   // R-A 甲板下结构(电缆地沟支线/检修储藏舱)+ 管廊节奏装饰
    this._drawPowerDetail() // R-B 二层回廊托架扶手 + 补给间标识 + R-C 伏笔封盖
    this._drawHiveBackdrop(L) // 地下蜂巢段背景(临时程序化占位,结构拍板后按元素库出分层概念图替换)
    for (const st of L.stairs ?? []) this._buildStairs(st) // 双斜梁开放式钢梯(参考23 套件拼装)
    // 房间装饰件(玻璃隔间墙/储物柜/机柜等"立于后带或贴后墙"的家具,不碰撞):
    // depth<敌人(18)与人物(20),底部接地阴影读出纵深
    this._decorSprites = [] // 爆炸波及时抖一下(Explosives 用)
    // 【非等比守卫(2026-08-09 判真 #17)】decor 旧版一律 setDisplaySize(d.w,d.h),而墙板类长条
    // 切件被单方面压宽:office_glass 1031×320→270×160(0.52×)与 170×160(0.33×)、cryo_wall
    // 0.39×、gunrack 0.44×、monitor_wall 0.57×(CCTV 横屏被压成方块)、cable_tray 1.78× 反向拉伸
    // ——正是 scene-fx SKILL:37"整图硬拉伸=细节全糊"与 dev_wall_col 变形灰模的同族前科。
    // 双层修:①开发期断言(今后任何 decor 条目不能再静默变形);②畸变 >15% 的一律改
    // "高度定比例 + 横向 2x 平铺填满槽宽"(切忌按 w 或 h 单边反推:office_glass 按 h 会撑到
    // 515px 越过 x3095 隔断,按 w 会矮到 84px)。相位按"同图相邻装饰接着上一片"续排,
    // 消掉两片玻璃里同一盆栽/同一门板各重复一次的穿帮。
    const decorRun = new Map()
    for (const d of L.decor ?? []) {
      const src = this.textures.get(d.img).getSourceImage()
      const kxD = d.w / src.width, kyD = d.h / src.height, skew = kxD / kyD
      if (import.meta.env.DEV && Math.abs(skew - 1) > 0.1) {
        console.warn(`[decor] ${d.img}@${d.x} 非等比 kx=${kxD.toFixed(3)} ky=${kyD.toFixed(3)} 系数=${skew.toFixed(2)}`)
      }
      let spr
      if (Math.abs(skew - 1) > 0.15) {
        const left = d.x - d.w / 2
        const prev = decorRun.get(d.img)
        const phase = (prev && Math.abs(prev.right - left) <= 2) ? prev.next : 0
        spr = this.add.tileSprite(d.x, d.y, d.w, d.h, d.img).setOrigin(0.5, 1)
          .setTileScale(kyD, kyD).setDepth(d.depth ?? 4.35)
        spr.tilePositionX = phase
        decorRun.set(d.img, { right: left + d.w, next: phase + d.w / kyD })
      } else {
        spr = this.add.image(d.x, d.y, d.img).setOrigin(0.5, 1).setDisplaySize(d.w, d.h).setDepth(d.depth ?? 4.35)
      }
      this._decorSprites.push({ spr, x: d.x, y: d.y })
      if (d.shadow !== false) this.add.ellipse(d.x, d.y - 2, d.w * 0.7, 6, 0x04060a, 0.32).setDepth(4.2)
    }
    const vg = this.add.graphics().setDepth(1)
    vg.fillGradientStyle(0x05070a, 0x05070a, 0x05070a, 0x05070a, 0.75, 0.75, 0, 0)
    vg.fillRect(0, 0, L.width, 130)
    vg.fillGradientStyle(0x05070a, 0x05070a, 0x05070a, 0x05070a, 0, 0, 0.45, 0.45)
    vg.fillRect(0, L.height - 80, L.width, 80)

    // —— 平台绘制 + Matter 静态体(给尸体/断肢用) ——
    this._pushables = []
    const pg = this.add.graphics().setDepth(5)
    for (const p of this.solids) {
      let spr = null
      if (p.prop === 'prop_platform' && (p.dispH ?? p.h) > TRUSS.h * 0.6) {
        // R-B 高台:桁架件被当普通 prop 用在 140×90 上 = 22px 高的平台贴图被纵向拉 4 倍
        // (#18 附带项)。真机械读法 = 桁架台面 + 有壁厚的台身,不是"一张平台贴图放大四倍";
        // 台身画满整个碰撞盒(所见即所碰:这一整块都能站能挡)
        this._drawTruss({ x: p.x, y: p.y, w: p.w, h: 22 }, 5.02)
        this._drawRiserBody(p)
      } else if (p.prop) {
        // 战场道具:切件贴图,碰撞盒=显示盒;dispH>h 时贴图底对齐、上部纯视觉溢出
        // (如办公桌:碰撞=桌体,桌面显示器是视觉件——站上桌站的是桌面,不是屏幕顶)
        const dh = p.dispH ?? p.h
        spr = this.add.image(p.x + p.w / 2, p.y + p.h - dh / 2, p.prop).setDisplaySize(p.w, dh).setDepth(5)
        p._sprOffY = p.h / 2 - dh / 2
      } else if (p.oneWay) {
        // 单向平台:桁架三段拼装(左端盖 + 可无缝中段 + 右端盖),见 _drawTruss
        this._drawTruss(p)
      } else if (p.wall) {
        // 世界边界墙:旧版**没有 wall 分支**,直接掉进兜底 else 画成 40×1780 的纯色平板 +
        // 顶部一颗铆钉 = 全场唯一彻底无贴图的可见灰盒(判真 #11)。它历来落在相机 bounds 之外,
        // 07-28 世界东扩到 7800、墙放在 7760 后才首次探进镜头。按 2x 平铺铁律用承重墙侧棱切件
        // 竖向平铺 + 取所在区 tint;先垫不透明暗底,免切件半透明边露出画布底色
        pg.fillStyle(0x0a0e14, 1).fillRect(p.x, p.y, p.w, p.h)
        const t = this.textures.get('dev_hivewall').getSourceImage()
        const kw = (p.w * 2) / t.width // 宽度贴合墙厚、纵向同比不变形(与 hivewall 同构)
        spr = this.add.tileSprite(p.x + p.w / 2, p.y + p.h / 2, p.w * 2, p.h * 2, 'dev_hivewall')
          .setScale(0.5).setTileScale(kw, kw).setTint(this._regionTintAt(p.x + p.w / 2)).setDepth(5)
        const wg = this.add.graphics().setDepth(5.05) // 朝内受光棱 + 棱下暗过渡(读作端柱,不是一刀切)
        wg.fillStyle(0x39424f, 1).fillRect(p.x, p.y, 3, p.h)
        wg.fillGradientStyle(0x03050a, 0x03050a, 0x03050a, 0x03050a, 0.5, 0, 0.5, 0)
        wg.fillRect(p.x + 3, p.y, 12, p.h)
      } else if (p.hivewall) {
        // 蜂巢边界承重墙侧棱(R4 批次二收尾,参考43):竖条上下平铺,宽度贴合墙厚、纵向同比不变形
        const t = this.textures.get('dev_hivewall').getSourceImage()
        const k = (p.w * 2) / t.width
        spr = this.add.tileSprite(p.x + p.w / 2, p.y + p.h / 2, p.w * 2, p.h * 2, 'dev_hivewall')
          .setScale(0.5).setTileScale(k, k).setDepth(5)
      } else if (p.slab) {
        // 蜂巢楼层楼板横截面(R4 批次二,参考42):可平铺条带,26px 世界高与贴图 1:1,横向原生密度平铺
        const th = this.textures.get('dev_slab').getSourceImage().height
        spr = this.add.tileSprite(p.x + p.w / 2, p.y + p.h / 2, p.w * 2, p.h * 2, 'dev_slab')
          .setScale(0.5).setTileScale(1, (p.h * 2) / th).setDepth(5)
      } else if (p.crate) {
        // 掩体箱:金属箱+警示条纹顶边+X 型加强筋
        pg.fillStyle(0x2b3036).fillRect(p.x, p.y, p.w, p.h)
        pg.lineStyle(2.5, 0x14171b).strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2)
        for (let sx = p.x + 2; sx < p.x + p.w - 8; sx += 16) {
          pg.fillStyle(0xd8b13a).fillRect(sx, p.y + 2, 8, 5)
        }
        pg.lineStyle(2, 0x454d57)
        pg.lineBetween(p.x + 5, p.y + 10, p.x + p.w - 5, p.y + p.h - 5)
        pg.lineBetween(p.x + p.w - 5, p.y + 10, p.x + 5, p.y + p.h - 5)
      } else if (p.ground) {
        // 地面:什么都不画,完全露出概念图走道带(旧"沿口亮线"被用户点名怪异,已移除);
        // 地下 B4 甲板面由 _drawHiveBackdrop 补画
      } else if (p.ceiling) {
        // 走廊天花板:视觉=概念图顶棚带(下沿≈世界y48,灯带挂其下),实体只补碰撞——
        // 玩家满跳(最高平台 y300 起跳,头顶到 y53)刚好够不到,气瓶/抛射体不再飞出关卡顶
      } else if (p.partition) {
        // 舱段隔墙(门上方的墙体截面):切件贴图(参考19,分段装甲板+竖向导管+承重基座)。
        // 【0.5 原生密度平铺,禁 setDisplaySize】旧版把 99×540 的截面柱压成 44×310 / 15×120,
        // 正是 2026-07-28 已记档的"变形灰模"失效模式(门框上楣第一版踩过一次);窗口相位居中
        // 在柱心,避免只显示切件的半透明边缘区(=墙发虚,同一批踩过)
        const t = this.textures.get('dev_wall_col').getSourceImage()
        pg.fillStyle(0x101620, 1).fillRect(p.x, p.y, p.w, p.h)
        spr = this.add.tileSprite(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, 'dev_wall_col')
          .setTileScale(0.5, 0.5).setDepth(5.4)
        spr.tilePositionX = Math.max(0, (t.width - p.w * 2) / 2)
      } else if (p.fanwall) {
        // 风道墙(圆洞上下的墙体):视觉由 BigFan 整体绘制(墙+洞口+叶轮同一套构图),这里只留碰撞
      } else if (p.stair) {
        // 楼梯视觉由 _buildStairs 整段拼装(踏步切件/斜梁/扶手);此处只保留 Matter 体生成
      } else {
        pg.fillStyle(0x22262c).fillRect(p.x, p.y, p.w, p.h)
        pg.fillStyle(0x3b4048).fillRect(p.x, p.y, p.w, 4)
        pg.fillStyle(0x14171b)
        for (let bx = p.x + 20; bx < p.x + p.w - 8; bx += 52) pg.fillCircle(bx, p.y + 10, 2)
      }
      // 可推物件(R2 物理世界层):动态 Matter 刚体,轻家具手感(用户点名"可以做得很轻"),
      // 不锁转动——推过棱沿/压上尸体会真实倾翻(入侵者2 语法);其余一律静态体(尸体碰撞用)
      // 轻家具=低滑动摩擦(地擦几乎不吃推力,"推着走减速很少");动态减速交给碰撞质量/翻倒几何,
      // 静止靠 frictionAir+睡眠(实测:摩擦 0.5 时连硬设 48px/s 都被地擦吃剩 8px/s)
      const mbody = this.matter.add.rectangle(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, p.pushable
        ? { friction: 0.03, frictionStatic: 0.15, frictionAir: 0.03, density: 0.0022, restitution: 0.04 }
        : { isStatic: true, friction: 0.8 })
      if (p.pushable) {
        p._spr = spr; p._body = mbody; this._pushables.push(p)
        // NaN 自愈防线用:原始尺寸与最近健康位形(深叠解算/爆炸冲量偶发 NaN 时原地重建刚体)
        p._w0 = p.w; p._h0 = p.h
        p._lastGood = { x: p.x + p.w / 2, y: p.y + p.h / 2, a: 0 }
      }
      if (p.move) { p._spr = spr; p._body = mbody } // 移动平台需逐帧同步贴图与物理体(必须用贴图类平台,graphics 画的动不了)
    }
    this.matter.world.setBounds(0, -200, L.width, L.height + 200)
    // 可推物扫掠 CCD:挂引擎步级(每物理步一查,与帧率/标签页状态无关)。
    // 大炮冲量把箱子送到 ~200px/step,单步跨过 16-45px 薄墙=穿墙飞出世界(用户点名"一打就没了");
    // 体心轨迹 vs 按半尺寸外扩的实体矩形(Minkowski)求首个命中,钉在墙前+按浅轴反射。
    // 起点已贴在外扩盒上(容差3)跳过=贴地箱不被脚下地面钉死(实测踩过:位移从 281px 掉到 2px)
    this._pushablesCcdStep = () => {
      const MM = Phaser.Physics.Matter.Matter
      for (const p of this._pushables) {
        const b = p._body
        if (!p._prev) { p._prev = { x: b.position.x, y: b.position.y }; continue }
        const dx = b.position.x - p._prev.x, dy = b.position.y - p._prev.y
        if (dx * dx + dy * dy > 100) {
          const hw = p._w0 / 2, hh = p._h0 / 2
          let bestT = null, bestS = null
          for (const o of this.solids) {
            if (o === p || o.pushable || o.minor || o.oneWay) continue
            const ex = { x: o.x - hw, y: o.y - hh, w: o.w + hw * 2, h: o.h + hh * 2 }
            if (p._prev.x > ex.x - 3 && p._prev.x < ex.x + ex.w + 3 &&
                p._prev.y > ex.y - 3 && p._prev.y < ex.y + ex.h + 3) continue
            const t = segVsRect(p._prev.x, p._prev.y, b.position.x, b.position.y, ex)
            if (t !== null && (bestT === null || t < bestT)) { bestT = t; bestS = o }
          }
          if (bestT !== null) {
            const hx = p._prev.x + dx * bestT, hy = p._prev.y + dy * bestT
            MM.Body.setPosition(b, { x: hx, y: hy })
            const ox = (hx - (bestS.x + bestS.w / 2)) / (bestS.w / 2 + hw)
            const oy = (hy - (bestS.y + bestS.h / 2)) / (bestS.h / 2 + hh)
            const v = b.velocity
            if (Math.abs(ox) > Math.abs(oy)) MM.Body.setVelocity(b, { x: -v.x * 0.3, y: v.y * 0.7 })
            else MM.Body.setVelocity(b, { x: v.x * 0.7, y: -v.y * 0.3 })
          }
        }
        p._prev.x = b.position.x; p._prev.y = b.position.y
      }
    }
    this.matter.world.on('afterupdate', this._pushablesCcdStep)
    this.events.once('shutdown', () => this.matter.world.off('afterupdate', this._pushablesCcdStep))

    // —— 移动平台(升降梯等):运动学载具,原点↔目标往返、端点驻留 ——
    // 碰撞不需要额外代码:玩家/敌人/子弹/激光/视线全部实时读 solids,原位改 p.x/p.y 即全系统跟随
    this._movers = this.solids.filter((p) => p.move)
    for (const p of this._movers) {
      p._ox = p.x; p._oy = p.y
      p._tx = p.move.toX ?? p.x; p._ty = p.move.toY ?? p.y
      p._dir = 1
      p._pauseUntil = 0
      p._enabled = !p.move.afterDoor // 挂在门后的载具:门开启前不运行
    }
    const gated = this._movers.filter((p) => p.move.afterDoor)
    if (gated.length) {
      const onDoorOpened = (id) => { for (const p of gated) if (p.move.afterDoor === id) p._enabled = true }
      EventBus.on('door:opened', onDoorOpened)
      this.events.once('shutdown', () => EventBus.off('door:opened', onDoorOpened))
    }

    // —— 特效 ——
    this.sparkEmitter = this.add.particles(0, 0, 'px_spark', {
      speed: { min: 120, max: 360 }, lifespan: { min: 120, max: 340 },
      scale: { start: 0.9, end: 0 }, gravityY: 900, blendMode: 'ADD',
      tint: [0xbfe9ff, 0x7fd4ff, 0xffffff, 0xffe9a3], emitting: false,
    }).setDepth(40)
    this.debrisEmitter = this.add.particles(0, 0, 'px_debris', {
      speed: { min: 80, max: 260 }, lifespan: 3200, rotate: { min: 0, max: 360 },
      scale: { start: 1, end: 0.6 }, alpha: { start: 1, end: 0 }, gravityY: 1200,
      tint: [0x6b6252, 0x4c463a, 0x857b68, 0x8f959d], emitting: false,
    }).setDepth(13)
    this.flashEmitter = this.add.particles(0, 0, 'px_glow', {
      speed: 0, lifespan: 110, scale: { start: 1.5, end: 0.4 }, alpha: { start: 0.85, end: 0 },
      blendMode: 'ADD', tint: 0xbfe9ff, emitting: false,
    }).setDepth(41)
    // 爆炸火星:暖色专属(不再借用金属弹击的蓝青 sparkEmitter),更沉的重力=液态火滴落感
    this.emberEmitter = this.add.particles(0, 0, 'px_spark', {
      speed: { min: 140, max: 420 }, lifespan: { min: 260, max: 620 },
      scale: { start: 1.1, end: 0.15 }, alpha: { start: 1, end: 0 },
      gravityY: 1400, blendMode: 'ADD', maxAliveParticles: 240,
      tint: [0xfff3c0, 0xffb347, 0xff7b3f, 0xff4d2e], emitting: false,
    }).setDepth(41)
    this._scorches = []
    // GPU 流体爆炸(WebGL2 才激活;fx.explosion 内自动选流体/序列帧)
    this.fluidFx = new FluidFx(this)
    const fx = {
      sparks: (x, y, n) => this.sparkEmitter.explode(n, x, y),
      debris: (x, y, n) => this.debrisEmitter.explode(n, x, y),
      flash: (x, y) => this.flashEmitter.explode(1, x, y),
      // 爆炸 v8 = **写实球形序列帧整段播放**(2026-07-26,第六次点名后与用户对齐方向再动手)。
      // 六版程序化合成全部失败的病根:用"同一张完整火球贴图 × N 份 + tween"合成——每张贴图自带
      // 完整火球轮廓,画面上叠几张就读作几个火球;而真实爆炸的一切细节都发生在**同一团轮廓内部**
      // (表面湍流翻滚、由白热连续转橙转暗、外缘连续"变成"烟),静态贴图 + tween 原理上做不出
      // "形状本身在演变"。序列帧天生解决全部三点,所以这次是换路线不是换参数。
      // 素材=参考36(球形无蘑菇茎,爆心居中不位移),逐帧物理:白热点 → 2-3 帧内胀到接近最终大小
      // → 尺寸基本不再变、只在球内翻滚变色 → 外缘连续转烟 → 纯烟消散。
      // **勿再叠加任何"第二团火"**:帧内已含全部演变;程序化层只负责序列帧给不了的东西——
      // 爆心瞬时白光(帧1太小罩不住近处)、地表尘环与熏黑(素材不含地面交互)、火星与碎屑。
      explosion: (x, y, power = 1, groundY = null) => {
        const grounded = groundY != null && groundY - y < 120 * power
        // ① 爆心瞬时白光:起爆照明感,90ms 即灭(不是火球,是光)
        const core = this.add.image(x, y, 'px_glow').setTint(0xfff6e0).setScale(0.30 * power)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(42)
        this.tweens.add({ targets: core, scale: 1.05 * power, alpha: 0, duration: 90, ease: 'Expo.Out', onComplete: () => core.destroy() })
        // ② 火球主体 = **GPU 实时流体模拟**(v9 观感定版:产生/形态/消失速度全部用户拍板;
        // 关卡实体自动光栅化成流体障碍物=火焰被墙/楼板/箱子真实挡住;WebGL2 不可用时回退序列帧)
        if (!(this.fluidFx?.ok && this.fluidFx.boom(x, y, power, groundY))) {
          // 回退:序列帧 v8(贴地=穹顶底边锚地面线;半空=球形居中;绝不做缩放动画)
          const blast = grounded
            ? this.add.sprite(x, groundY + 2, 'fx_blast_ground', 0).setOrigin(0.5, 1)
            : this.add.sprite(x, y, 'fx_blast', 0)
          blast.setBlendMode(Phaser.BlendModes.ADD).setDepth(41)
            .setScale(1.35 * power).setFlipX(Math.random() < 0.5)
            .setAngle(grounded ? 0 : Phaser.Math.Between(-6, 6))
          blast.play(grounded ? 'blast_ground' : 'blast')
          blast.once('animationcomplete', () => blast.destroy())
        }
        // ③ 地表尘环(单层白,贴地爆专属;素材是半空球形爆,地面交互由程序层补)+熏黑;半空爆皆无
        if (grounded) {
          const rg = this.add.image(x, groundY - 5, 'px_shockring').setTint(0xffffff)
            .setScale(0.15 * power, 0.05 * power).setBlendMode(Phaser.BlendModes.ADD).setDepth(40).setAlpha(0.5)
          this.tweens.add({ targets: rg, scaleX: 2.3 * power, scaleY: 0.68 * power * 0.3,
            alpha: 0, duration: 260, ease: 'Quad.Out', onComplete: () => rg.destroy() })
          const scorch = this.add.container(x, groundY - 2).setDepth(2).setScale(0.3)
          for (let i = 0; i < 3; i++) {
            scorch.add(this.add.image(Phaser.Math.Between(-10, 10), Phaser.Math.Between(-6, 6), 'px_glow')
              .setTint(0x0d0b09).setAlpha([0.55, 0.4, 0.3][i])
              .setScale((0.7 + Math.random() * 0.6) * (1 - i * 0.15)).setRotation(Math.random() * Math.PI * 2))
          }
          this.tweens.add({ targets: scorch, scale: 1, duration: 260, ease: 'Cubic.Out' })
          this._scorches.push(scorch)
          if (this._scorches.length > 24) this._scorches.shift().destroy()
        }
        this.emberEmitter.explode(Phaser.Math.Between(16, 24), x, y)
      },
      // 枪口焰 v2(拟真复合体,用户点名"星状太单调"):白黄亮核+多瓣火舌羽流(3变体随机选形/翻转/抖动,
      // 每发都不同=真实枪焰的混沌)+制退器十字侧刺(低透明度)+锥形飞溅火星+橙色环境光晕
      muzzle: (x, y, angle, tint = 0xffffff, scale = 1) => {
        const big = (Math.random() < 0.18 ? 1.4 : 1) * scale // 偶发一记大焰;scale=武器口径差异(霰弹/大炮更猛)
        const plume = this.add.image(x, y, 'px_plume' + Phaser.Math.Between(0, 2))
          .setOrigin(0.06, 0.5)
          .setRotation(angle + Phaser.Math.FloatBetween(-0.07, 0.07))
          .setScale(Phaser.Math.FloatBetween(0.42, 0.62) * big,
            Phaser.Math.FloatBetween(0.5, 0.75) * big * (Math.random() < 0.5 ? -1 : 1))
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(41).setAlpha(0.98)
        if (tint !== 0xffffff) plume.setTint(tint)
        const star = this.add.image(x, y, 'px_muzzle').setRotation(angle)
          .setScale(0.5 * big, 0.36 * big).setBlendMode(Phaser.BlendModes.ADD).setDepth(41).setAlpha(0.55)
        const core = this.add.image(x, y, 'px_glow').setScale(0.4 * big)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(41).setAlpha(0.95)
        // 光晕/火星随武器焰色(冷蓝能量枪的焰不能带橙圈——In2"暖橙=火药/冷蓝=能量"色语)
        const halo = this.add.image(x, y, 'px_glow').setScale(0.85 * big)
          .setTint(tint !== 0xffffff ? tint : 0xffb060)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(40).setAlpha(0.38)
        this.tweens.add({ targets: plume, alpha: 0, scaleX: plume.scaleX * 1.22, duration: 70, ease: 'Cubic.Out', onComplete: () => plume.destroy() })
        this.tweens.add({ targets: star, alpha: 0, duration: 45, onComplete: () => star.destroy() })
        this.tweens.add({ targets: core, alpha: 0, scale: 0.16, duration: 65, onComplete: () => core.destroy() })
        this.tweens.add({ targets: halo, alpha: 0, scale: 1.25 * big, duration: 100, onComplete: () => halo.destroy() })
        for (let i = 0; i < Phaser.Math.Between(3, 4); i++) { // 火星锥
          const a = angle + Phaser.Math.FloatBetween(-0.24, 0.24)
          const d = Phaser.Math.FloatBetween(34, 62)
          const s = this.add.image(x, y, 'px_spark').setScale(Phaser.Math.FloatBetween(0.4, 0.75))
            .setTint(tint !== 0xffffff ? tint : 0xffd27a).setBlendMode(Phaser.BlendModes.ADD).setDepth(41)
          this.tweens.add({
            targets: s, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d + 5,
            alpha: 0, scale: 0.1, duration: Phaser.Math.FloatBetween(90, 150), ease: 'Cubic.Out',
            onComplete: () => s.destroy(),
          })
        }
      },
    }
    this.fx = fx

    // —— 重生点:默认出生点;若存档记录了本关检查点则从检查点续 ——
    this.respawnPoint = { ...L.playerSpawn }
    const save = this.registry.get('save')
    if (save?.level === L.name && save.checkpoint) {
      const cp = (L.checkpoints ?? []).find((c) => c.id === save.checkpoint)
      if (cp) this.respawnPoint = { x: cp.x, y: cp.y }
    }

    // —— 系统与实体 ——
    this.devices = new Devices(this, L) // 闸门/操作台/检查点(在 solids 建好之后、实体之前)
    this.input2 = new InputState(this)
    this.player = new Player(this, this.respawnPoint.x, this.respawnPoint.y)
    // melee 生物走 BioEnemy(近战状态机),其余=持枪 Enemy
    this.enemies = L.enemies.map((e) => enemiesCfg[e.type]?.melee ? new BioEnemy(this, e) : new Enemy(this, e))
    this.ballistics = new Ballistics(this)
    this.gibs = new GibSystem(this, fx)
    this.elevators = (L.elevators ?? []).map((e) => new Elevator(this, e)) // 载人电梯(呼叫+选层)
    this.explosives = new Explosives(this) // 可爆气瓶(打漏喷焰乱窜→爆炸→连锁)
    this.hud = new Hud(this, gameCfg.showDebugHud)
    this.threatMarkers = new ThreatMarkers(this) // 屏外威胁▼(R3)
    this.weapons = new WeaponSystem(this) // 多武器(切枪/分类型弹道/RPG抛射体/弹药与换弹)
    this.drops = new Drops(this) // 掉落经济(击杀必掉弹药+34%血包,2026-07-27 定版)
    for (const pk of L.pickups ?? []) this.drops.place(pk.kind, pk.x, pk.y, pk.key) // 关卡预置补给(支线/储藏间)
    this.weapons.announce() // HUD 武器条初始播报(Hud 已就位)
    this.turretWeapon = weaponsCfg.wall_turret
    this.lockdown = L.lockdown ? new LockdownRoom(this, L.lockdown) : null
    // 关卡常驻炮塔(不属于任何封锁房间:R-A 甲板下储藏舱那台)——与封锁炮塔同一个 Turret 类,
    // 只是生命周期挂在场景上(封锁解除的 powerDown 奖励不波及它)
    this.turrets = (L.turrets ?? []).map((t) => new Turret(this, t))
    this.bigFans = (L.fans ?? []).map((f) => new BigFan(this, f))   // 基地章巨物机关(R-B 动力区)
    this.vents = (L.vents ?? []).map((v) => new SteamVent(this, v))
    this.laserGfx = this.add.graphics().setDepth(29)
    this.nextShotAt = 0
    this.playerCorpse = null

    // —— 摄像机 ——
    this.camTarget = this.add.rectangle(this.player.x, this.player.y, 2, 2, 0, 0)
    this.cameras.main.setBounds(0, 0, L.width, L.height)
    this.cameras.main.startFollow(this.camTarget, true, 0.12, 0.12)

    // —— 事件接线 ——
    this._onEnemyDied = ({ snapshot, dir, weapon, bio }) => {
      this.gibs.spawnRagdoll(snapshot, {
        // 生物类红线:不断肢无体液,瘫倒后消散为能量光点(dissolve 走 gibs.json bioDissolve)
        impulse: dir, dismemberable: !bio, killWeapon: weapon,
        dissolve: bio ? true : null,
      })
      EventBus.emit('camera:shake', 0.005)
      this.hitstop(gameCfg.hitFeel.killHitstopMs) // 击杀微顿(R3 打击感)
    }
    this._onPlayerDied = ({ snapshot }) => {
      this.weapons._cancelReload() // 死亡打断换弹(防重生后残留压枪倾角/换弹态,"复现即复位"纪律)
      this.playerCorpse = this.gibs.spawnRagdoll(snapshot, { dismemberable: false, impulse: { x: 0, y: -0.5 } })
      this.time.delayedCall(1400, () => {
        if (this.playerCorpse) { this.gibs.removeCorpse(this.playerCorpse); this.playerCorpse = null }
        this.player.respawn(this.respawnPoint.x, this.respawnPoint.y) // 重生于最近检查点
      })
    }
    // trauma 震屏(基地章地基,2026-07-28;GDC Eiserloh 模型):trauma∈[0,1] 累加钳1,
    // 实际震幅 = trauma² × 满幅——指数曲线才分得出"大事"和"小事"(0.33/0.99 trauma → 5%/98% 震幅);
    // 高 trauma 衰减耗时自然更长 = 爆炸/巨物事件"更沉"免专门传时长;弱不压强被"累加+钳1"取代。
    // 旧事件口径兼容:v 仍是 Phaser shake intensity(0.005 击杀轻抖~0.045 近爆),映射 trauma=√(v/0.046)。
    // 执行器沿用 Phaser shakeEffect(每帧 force 重启,强度随 trauma 平滑衰减)——质感不变,只换调度。
    this._trauma = 0
    this.addTrauma = (t) => { this._trauma = Math.min(1, this._trauma + t) } // 巨物/演出事件直接调(0.6-0.9 级)
    this._onShake = (v) => this.addTrauma(Math.sqrt(Math.min(1, v / 0.046)))
    EventBus.on('enemy:died', this._onEnemyDied)
    EventBus.on('player:died', this._onPlayerDied)
    EventBus.on('camera:shake', this._onShake)
    this.events.once('shutdown', () => {
      EventBus.off('enemy:died', this._onEnemyDied)
      EventBus.off('player:died', this._onPlayerDied)
      EventBus.off('camera:shake', this._onShake)
    })

    // —— 开始遮罩(解锁音频) ——
    const ov = this.add.container(0, 0).setDepth(100).setScrollFactor(0)
    ov.add(this.add.rectangle(480, 270, 960, 540, 0x05070a, 0.72))
    ov.add(this.add.text(480, 210, '时空战士', { fontFamily: 'sans-serif', fontSize: '46px', color: '#e9edf1', fontStyle: 'bold' }).setOrigin(0.5))
    ov.add(this.add.text(480, 262, '竖切片原型 · M1', { fontFamily: 'sans-serif', fontSize: '16px', color: '#8fa3b8' }).setOrigin(0.5))
    const hint = this.add.text(480, 330, '— 点击开始 —', { fontFamily: 'sans-serif', fontSize: '20px', color: '#35b5ff' }).setOrigin(0.5)
    ov.add(hint)
    this.tweens.add({ targets: hint, alpha: 0.35, duration: 600, yoyo: true, repeat: -1 })
    this.input.once('pointerdown', () => {
      Sfx.unlock()
      ov.destroy()
      this.input2.enabled = true
    })

    // —— 开发调试钩子 ——
    if (import.meta.env.DEV) {
      window.__tw = {
        scene: this,
        player: this.player,
        gibs: this.gibs,
        killAll: () => this.enemies.forEach((e) => e.alive &&
          e.takeHit(999, { x: 0.9, y: -0.35 }, { x: e.x, y: e.y - 60 }, weaponsCfg.rifle)),
        teleport: (x, y) => { this.player.x = x; this.player.y = y },
        clearSave: () => import('../core/SaveStore.js').then(({ SaveStore }) => SaveStore.remove('progress')),
      }
    }
  }

  // 双斜梁开放式钢梯(用户定版"参考现实楼梯":两根槽钢斜梁承托格栅踏步,踏步间镂空无立板,
  // 外侧管式扶手)——参考23 套件拼装:斜梁=转平切件按坡度旋转平铺(画在踏步后),踏步=逐级切件
  // (顶面格栅+前立面鼻沿,与碰撞薄踏板逐级对齐),扶手=立柱切件+双横管(走道后带,不碰撞,
  // 画在人物之后),底部锚固板。碰撞=薄踏板(楼梯底下真是空的,可钻行/子弹可穿)。
  _buildStairs(st) {
    const topAt = (k) => st.y - st.stepH * k
    const leftAt = (k) => st.dir > 0 ? st.x + st.stepW * (k - 1) : st.x - st.stepW * k
    if (!this.textures.exists('dev_stair_tread')) { // 兜底:素色薄踏板
      const g = this.add.graphics().setDepth(5.35)
      for (let k = 1; k <= st.steps; k++) {
        g.fillStyle(0x1b2027).fillRect(leftAt(k), topAt(k), st.stepW, 8)
        g.fillStyle(0x3b4048).fillRect(leftAt(k), topAt(k), st.stepW, 3)
      }
      return
    }
    // 斜梁:沿"各级踏板鼻下缘"的直线平铺(远侧那根,踏步之间的镂空里看到它=开放钢梯的结构读法)
    const noseX = (k) => st.dir > 0 ? leftAt(k) + st.stepW : leftAt(k)
    const p0 = { x: noseX(1) - st.dir * st.stepW * 0.7, y: topAt(1) + 12 }
    const p1 = { x: noseX(st.steps) - st.dir * st.stepW * 0.25, y: topAt(st.steps) + 12 }
    const beamLen = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    const beamTexH = this.textures.get('dev_stair_beam').getSourceImage().height
    this.add.tileSprite((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, beamLen, 13, 'dev_stair_beam')
      .setTileScale(13 / beamTexH).setRotation(Math.atan2(p1.y - p0.y, p1.x - p0.x)).setDepth(5.26)
    // 扶手(后带):立柱每 4 级一根,双横管沿坡度贯通,两端小落端
    const posts = []
    for (let k = 2; k <= st.steps; k += 4) posts.push(k)
    if (posts[posts.length - 1] < st.steps - 1) posts.push(st.steps)
    const rg = this.add.graphics().setDepth(5.18)
    const railAt = (k, drop) => ({ x: leftAt(k) + st.stepW / 2, y: topAt(k) - drop })
    for (const drop of [44, 27]) {
      const a = railAt(posts[0], drop), b = railAt(posts[posts.length - 1], drop)
      rg.lineStyle(3, 0x2f353d, 1).lineBetween(a.x, a.y, b.x, b.y)
      rg.lineStyle(1, 0x565f6a, 0.8).lineBetween(a.x, a.y - 1, b.x, b.y - 1)
      rg.lineStyle(3, 0x2f353d, 1).lineBetween(a.x, a.y, a.x - st.dir * 6, a.y + 8)
      rg.lineStyle(3, 0x2f353d, 1).lineBetween(b.x, b.y, b.x + st.dir * 6, b.y + 8)
    }
    for (const k of posts) {
      this.add.image(leftAt(k) + st.stepW / 2, topAt(k) + 2, 'dev_stair_post')
        .setOrigin(0.5, 1).setDisplaySize(9, 48).setDepth(5.2)
    }
    // 踏步:逐级对齐碰撞薄踏板(顶面即踏面);底部锚固板压住第一级根部
    for (let k = 1; k <= st.steps; k++) {
      this.add.image(leftAt(k) - 1, topAt(k), 'dev_stair_tread')
        .setOrigin(0, 0).setDisplaySize(st.stepW + 2, 11).setDepth(5.35)
    }
    this.add.image(leftAt(1) + st.stepW / 2, st.y, 'dev_stair_anchor')
      .setOrigin(0.5, 1).setDisplaySize(24, 9).setDepth(5.16)
  }

  // 某个世界 x 归属区的 tint(区外回落最近的一区)——给 wall 这类"骑在区界上"的结构件上色
  _regionTintAt(x) {
    let best = REGIONS[0], bd = Infinity
    for (const R of REGIONS) {
      if (x >= R.x && x <= R.x + R.w) return R.tint
      const d = Math.min(Math.abs(x - R.x), Math.abs(x - (R.x + R.w)))
      if (d < bd) { bd = d; best = R }
    }
    return best.tint
  }

  // 桁架中段的可无缝平铺纹理(#18):从 prop_platform 里烘出"去掉两端端盖"的中段。
  // 切分点 37/243 是**实测**(逐列 RGBA 平均差扫描 26-42 × 238-252 全搜索):首尾相接的
  // 列差 3.21,低于图内相邻列平均差 7.62 = 平铺处比图里任何一处相邻列都更连续。
  // 能力检测语义同 FluidFx.ok:烘不出来就返回 null,调用方退化为整件按显示盒绘制。
  _trussMid() {
    if (this._trussMidKey !== undefined) return this._trussMidKey
    this._trussMidKey = null
    try {
      const rt = this.game.renderer?.type
      if (rt !== Phaser.WEBGL && rt !== Phaser.CANVAS) return null
      const key = 'prop_platform_mid'
      if (this.textures.exists(key)) this.textures.remove(key)
      const dt = this.textures.addDynamicTexture(key, TRUSS.mid, TRUSS.h)
      if (!dt) return null
      dt.repeat('prop_platform', null, 0, 0, TRUSS.mid, TRUSS.h, { tilePositionX: TRUSS.capL })
      dt.render()
      this._trussMidKey = key
    } catch (e) {
      if (import.meta.env.DEV) console.info('[truss] 中段烘焙不可用,退化整件:', e?.message)
    }
    return this._trussMidKey
  }

  // 按 (w,h) 烘一整条桁架(左盖 + 中段平铺 + 右盖)。同尺寸只烘一次并缓存,
  // 场上每条平台只剩 **1 个 image**——比"三件拼装"少两个对象,也比旧版的逐帧 tileSprite 便宜。
  // 纹理按 2x 密度建(纹理px = 0.5 世界px,与 2x 铁律一致),显示时 setDisplaySize(w,h) 还原。
  _trussTex(w, h) {
    const key = `truss_${Math.round(w * 2)}x${Math.round(h * 2)}`
    if (this._trussTexs?.has(key)) return this._trussTexs.get(key)
    ;(this._trussTexs ??= new Map()).set(key, null)
    const mid = this._trussMid()
    if (!mid) return null
    try {
      const W = Math.round(w * 2), H = Math.round(h * 2)
      if (this.textures.exists(key)) this.textures.remove(key)
      const dt = this.textures.addDynamicTexture(key, W, H)
      if (!dt) return null
      const ky = H / TRUSS.h // 纵向把 44 拉满平台高(与旧版 tileScaleY 同口径)
      dt.repeat('prop_platform', null, 0, 0, TRUSS.capL, H, { tileScaleY: ky })
      dt.repeat(mid, null, TRUSS.capL, 0, W - TRUSS.capL - TRUSS.capR, H, { tileScaleY: ky })
      dt.repeat('prop_platform', null, W - TRUSS.capR, 0, TRUSS.capR, H,
        { tilePositionX: TRUSS.full - TRUSS.capR, tileScaleY: ky })
      dt.render()
      this._trussTexs.set(key, key)
      return key
    } catch (e) {
      if (import.meta.env.DEV) console.info('[truss] 整条烘焙不可用,退化整件:', e?.message)
      return null
    }
  }

  // 单向平台/桁架台面(#18):prop_platform 是**一件成品桁架**(279×44,两端各有斜切端盖 +
  // 蓝色端灯 + 下弦杆内收),旧版把整件当可平铺纹理横铺 → 每 139.5 世界px 出现一次"两个端盖
  // 背靠背 + 甲板缺口 + 下弦杆先内收再外扩"的假接缝,一条走道读作几块短板对接(实测三处);
  // 反过来 w<139.5 的短台则是纹理被从中截断、右端盖整块丢失。
  // 改"端盖 + 可无缝中段 + 端盖"整条烘焙:任意长度都两端齐整、中间不再冒端盖。
  // 密度与旧版完全一致(横向 0.5 世界px/纹理px,纵向按平台高铺满),碰撞盒不变。
  _drawTruss(p, depth = 5) {
    const key = (p.w >= (TRUSS.capL + TRUSS.capR) * 0.5 + 8) ? this._trussTex(p.w, p.h) : null
    // 退化(烘焙不可用或平台短到放不下两个端盖):整件按显示盒铺满——
    // 宁可整件微缩,也不要"右端盖被整块切掉"的半截平台
    this.add.image(p.x + p.w / 2, p.y + p.h / 2, key ?? 'prop_platform')
      .setDisplaySize(p.w, p.h).setDepth(depth)
  }

  // 悬空平台"做进结构里"(spec ①;开发日志 2026-07-28 观感余项"踏台/高台无支撑托架")。
  // 三件套:①下弦梁(桁架压在梁上,不是漂在空中的一块板)②斜撑托架组=角钢斜杆 + 三角节点板 +
  // 墙面锚板 + 两端螺栓,**朝向要对:撑在平台下方受压**,撑脚落在最近的墙面/立柱上
  // ③台面边缘黄黑窄条 + 台底短垂影。全部是**不碰撞的背景装饰**(平台碰撞=显示盒,已成立)。
  // anchorX 给了就撑到那面墙(如 R-B 回程踏台撑在门框墙墩上);没给就按 ~120px 一组落在后墙锚板。
  _drawPlatformRig(p, anchorX = null, gfx = null) {
    // 三层共用一组 graphics(逐台新建 = 白送 draw call,与本批性能账相抵)
    const G = gfx ?? (this._rigG ??= {
      sh: this.add.graphics().setDepth(4.9),    // 台底垂影(落在后墙上)
      g: this.add.graphics().setDepth(4.98),    // 梁与托架(在桁架台面之后)
      band: this.add.graphics().setDepth(5.45), // 台面边缘警示带(压在台面上)
    })
    const { sh, g, band } = G
    const chordY = p.y + p.h, by = chordY + 7
    sh.fillGradientStyle(0x03050a, 0x03050a, 0x03050a, 0x03050a, 0.42, 0.42, 0, 0)
    sh.fillRect(p.x - 6, by, p.w + 12, 30)
    g.fillStyle(0x141a22, 1).fillRect(p.x, chordY, p.w, 7)
    g.fillStyle(0x272f3a, 1).fillRect(p.x, chordY, p.w, 2.5)
    g.lineStyle(1.5, 0x0a0e13, 1).strokeRect(p.x, chordY, p.w, 7)
    if (anchorX !== null) {
      const dir = Math.sign(anchorX - (p.x + p.w / 2)) || -1
      const tipX = dir > 0 ? p.x + 5 : p.x + p.w - 5
      const footX = anchorX - dir * 3
      this._gusset(g, tipX, by, footX, by + Phaser.Math.Clamp(Math.abs(tipX - footX) * 0.62, 30, 58), dir)
    } else {
      const n = Math.max(1, Math.round(p.w / 120))
      for (let i = 0; i < n; i++) {
        const tipX = p.x + p.w * ((i + 0.86) / n)
        this._gusset(g, tipX, by, tipX - 46, by + 46, -1)
      }
    }
    band.fillStyle(0x14171b, 0.92).fillRect(p.x, p.y - 2, p.w, 5)
    band.fillStyle(0xd8b13a, 0.9)
    for (let sx = p.x + 2; sx < p.x + p.w - 4; sx += 14) band.fillRect(sx, p.y - 2, 7, 5)
  }

  // 角钢斜撑一组:三角节点板 + 贴在板外侧的角钢杆 + 墙面锚板 + 两端螺栓
  _gusset(g, tipX, tipY, footX, footY, dir) {
    g.fillStyle(0x161c25, 1)
    g.beginPath()
    g.moveTo(tipX, tipY); g.lineTo(footX, tipY); g.lineTo(footX, footY)
    g.closePath(); g.fillPath()
    g.lineStyle(2, 0x0a0e13, 1).strokePath()
    g.lineStyle(5, 0x1d2530, 1).lineBetween(tipX - dir * 4, tipY + 4, footX + dir * 6, footY - 5)
    g.lineStyle(1.5, 0x475161, 0.7).lineBetween(tipX - dir * 5, tipY + 2, footX + dir * 5, footY - 8)
    const px = dir > 0 ? footX : footX - 22
    g.fillStyle(0x1b2231, 1).fillRect(px, footY - 15, 22, 15)
    g.fillStyle(0x39424f, 1).fillRect(px, footY - 15, 22, 2)
    g.lineStyle(1.5, 0x080b0f, 1).strokeRect(px, footY - 15, 22, 15)
    for (const sx of [px + 6, px + 16]) {
      g.fillStyle(0x080b10, 1).fillCircle(sx, footY - 7, 2.2)
      g.fillStyle(0x5b6774, 0.7).fillCircle(sx - 0.5, footY - 7.7, 1)
    }
    g.fillStyle(0x080b10, 1).fillCircle(tipX - dir * 8, tipY + 3.5, 2.2)
  }

  // R-B 高台的台身(spec ①"高台"件):有壁厚的封闭台座——腹板 + 板缝 + 两侧角柱 + 底裙基座板 +
  // 地脚螺栓 + 接地投影。画满整个碰撞盒(所见即所碰:这一整块都能站能挡,不是开放支腿)
  _drawRiserBody(p) {
    const G = (this._rigG ??= {
      sh: this.add.graphics().setDepth(4.9),
      g: this.add.graphics().setDepth(4.98),
      band: this.add.graphics().setDepth(5.45),
    })
    const g = G.g
    const top = p.y + 22, bot = p.y + p.h, h = bot - top
    g.fillStyle(0x0b0f15, 1).fillRect(p.x, top, p.w, h)
    g.fillGradientStyle(0x1e2733, 0x1a222c, 0x121922, 0x0e141c, 1, 1, 1, 1)
    g.fillRect(p.x + 5, top, p.w - 10, h - 8)
    for (let sx = p.x + 29; sx < p.x + p.w - 12; sx += 24) {
      g.fillStyle(0x080b10, 1).fillRect(sx, top, 1.6, h - 8)
      g.fillStyle(0x3b4553, 0.28).fillRect(sx + 1.6, top, 1, h - 8)
    }
    for (const [cx, lightIn] of [[p.x, 1], [p.x + p.w - 5, 0]]) {
      g.fillStyle(0x161d27, 1).fillRect(cx, top, 5, h)
      g.fillStyle(0x39424f, 0.75).fillRect(cx + (lightIn ? 0 : 3.5), top, 1.5, h)
    }
    g.fillStyle(0x11161d, 1).fillRect(p.x - 4, bot - 9, p.w + 8, 9)
    g.fillStyle(0x39424f, 1).fillRect(p.x - 4, bot - 9, p.w + 8, 2)
    for (let sx = p.x + 12; sx < p.x + p.w - 6; sx += 30) {
      g.fillStyle(0x080b10, 1).fillCircle(sx, bot - 4.5, 2.4)
      g.fillStyle(0x5b6774, 0.7).fillCircle(sx - 0.6, bot - 5.2, 1.1)
    }
    this.add.ellipse(p.x + p.w / 2, bot + 1, p.w + 26, 11, 0x03050a, 0.45).setDepth(4.92)
    G.band.fillStyle(0x14171b, 0.92).fillRect(p.x, p.y - 2, p.w, 5) // 台面边缘黄黑窄条
    G.band.fillStyle(0xd8b13a, 0.9)
    for (let sx = p.x + 2; sx < p.x + p.w - 4; sx += 14) G.band.fillRect(sx, p.y - 2, 7, 5)
  }

  // —— 区域档案表驱动的新区背景(基地章 R-A 起,2026-07-28)——
  // 提案 §二.2 定版:新区 = REGIONS 加一行 + 一张概念图,不加散落 if。
  // 构造性对齐同蜂巢层:图内走道面在图高的 walkR 处 → 显示高 = (走道面 y - 区顶 y) / walkR,
  // 图的下半(机械夹层带)自然溢出到行走面之下 = 走道下纵深。
  // 明度纪律(提案 §二.3):蜂巢四层 tint 明度全挤在 65-68% 导致换区感被吃掉——
  // 新区必须拉开 V 跨度(动力区提亮到 ~82%,后续仓储区压暗到 ~52%)。
  _drawRegions(L) {
    // 区域暗底:概念图带只覆盖"顶→图底"那一段,上下会露硬切边;先垫一层近黑,
    // 切边落在暗底上读作阴影而不是切口。【暗底严禁提前到 fade 区】——第一版把交叉淡化区的
    // 旧图先盖黑了,过渡带变成"黑底+若隐若现的新图窄条"=用户看到的"下面没贴图"(2026-07-28)
    const base = this.add.graphics().setDepth(0.05)
    for (const R of REGIONS) {
      base.fillStyle(0x05070a, 1).fillRect(R.x, 0, R.w, L.height)
    }
    // 上一区"墙带"的纵向范围:交叉淡化带只能画在**两区墙带的纵向交集**里(见下方 #13),
    // 最西区的上一区 = 旧走廊概念图整幅
    let prevTop = this.bgMeta.offY
    let prevBot = this.bgMeta.offY + this.bgMeta.hDisp
    for (const R of REGIONS) {
      const tex = this.textures.exists(R.tex) ? R.tex : 'bg_corridor' // 缺图回落走廊图(美术批次跟上前不露黑)
      const img = this.textures.get(tex).getSourceImage()
      const wall = R.walkY - R.top
      const dispH = wall / (this.textures.exists(R.tex) ? R.walkR : 0.72)
      const dispW = dispH / img.height * img.width
      const ky = dispH / img.height
      let kx = dispW / img.width
      // 【平铺换行缝的收边(2026-08-09 判真 #10)】区宽不是整幅显示宽的整数倍 → 整幅墙在
      // R.x + k·dispW 处硬换行(R-B 实测缝在 world 7736.5:⚡高压牌被竖切、栏杆断成两段错位)。
      // ①余量 ≤6%:把 kx 微调成 R.w/(n·图宽),换行线正好落在区界=缝消失(R-B 仅 1.28% 横向
      //   微拉;**只动 kx 不动 ky**,walkR 构造性对齐与人体尺度不受影响)。
      // ②余量过大(R-A n=2 需拉 18.6%,会毁掉尺度):改走项目既有 idiom "接缝藏进结构里",
      //   见下方 seam 立管。切忌直接改 REGIONS.w —— 区暗底/雾/门框全用 R.w,改宽会露黑条。
      const nTile = Math.max(1, Math.round(R.w / dispW))
      const fitK = R.w / (nTile * dispW)
      const absorbed = Math.abs(fitK - 1) <= 0.06
      if (absorbed) kx = R.w / (nTile * img.width)
      this.add.tileSprite(R.x, R.top, R.w, dispH, tex)
        .setOrigin(0, 0).setTileScale(kx, ky)
        .setTint(R.tint).setDepth(0.15)
      if (!absorbed && this.textures.exists('dev_wall_col')) {
        const cw = 46 // dev_wall_col @0.5 原生密度 = 一根截面柱正好 49.5,取 46 露一线柱侧暗边
        const cg = this.add.graphics().setDepth(0.182)
        const fl = this.add.graphics().setDepth(0.19)
        for (let sx = R.x + kx * img.width; sx < R.x + R.w - 8; sx += kx * img.width) {
          const cTop = R.top, cBot = R.walkY - 2
          cg.fillStyle(0x090d13, 1).fillRect(sx - cw / 2 - 3, cTop, cw + 6, cBot - cTop) // 暗底:切件半透明边不露黑
          const cts = this.add.tileSprite(sx, cTop, cw, cBot - cTop, 'dev_wall_col')
            .setOrigin(0.5, 0).setTileScale(0.5, 0.5).setTint(R.tint).setDepth(0.186)
          cts.tilePositionX = Math.max(0, (this.textures.get('dev_wall_col').getSourceImage().width - cw * 2) / 2)
          for (const [fy, fh] of [[cTop, 9], [cBot - 11, 11]]) { // 上下法兰:柱子插进顶棚/走道面,不是贴纸
            fl.fillStyle(0x151b23, 1).fillRect(sx - cw / 2 - 6, fy, cw + 12, fh)
            fl.fillStyle(0x39424f, 1).fillRect(sx - cw / 2 - 6, fy, cw + 12, 2.5)
            fl.lineStyle(1.5, 0x080b0f, 1).strokeRect(sx - cw / 2 - 6, fy, cw + 12, fh)
          }
          fl.fillStyle(0x03050a, 0.35).fillRect(sx + cw / 2 + 3, cTop + 9, 10, cBot - cTop - 20) // 柱侧投影
        }
      }
      // —— 阈限①:交叉淡化带(区界前 fade px 内新区图逐条淡入,盖在上一区图上)——
      // 调研反面清单#3:换区没有阈限段 = 玩家读作 bug 或美术接缝。Phaser4 已移除 GeometryMask,
      // 用窄条阶梯 alpha 近似渐变;tilePositionX 与主体同相位保证图案连续。
      // 【纵向必须裁到两区墙带的交集(2026-08-09 判真 #13)】旧版用**新区自己的** R.top/dispH,
      // 于是 R-B 整幅 918px 高的墙被铺到只有 274px 墙带的 R-A 头上:R-A 天花板以上(y<280)
      // 那片纯黑空区里浮出半透明的涡轮区灯罩/弯头管 = "天花板上面透出另一个房间"(实测两帧坐实)。
      // 取交集后,交集之外由上一区自己的暗底承接,任何一条竖条都不再是"半透明贴图压纯黑"。
      const fade = R.fade ?? 190
      const strip = 22
      const nStrip = Math.round(fade / strip)
      const fy0 = Math.max(R.top, prevTop)
      const fy1 = Math.min(R.top + dispH, prevBot)
      if (fy1 - fy0 > 1) {
        const fh = fy1 - fy0
        const fx0 = R.x - fade
        const alphaAt = (i) => Math.pow((i + 1) / (nStrip + 1), 1.6)
        // —— 性能账(spec ④):9 条逐帧 tileSprite × 2 区 = 18 个动态对象/draw call,
        // 预烘焙成每区界一张 DynamicTexture(1:1 分辨率、同 kx/ky、同相位、同阶梯 alpha)后
        // 只剩 2 个静态 image。DynamicTexture.repeat() 内部用的就是一只 TileSprite(与线上
        // 同一渲染节点),条间 1px 重叠的 alpha 合成在纹理里与在屏上等价 ⇒ 像素级等价。
        // 能力检测语义看齐 FluidFx.ok:烘焙不可用即整体回落原窄条路径,不崩不黑。
        const key = `fadebake_${R.id}`
        const dt = this._bakeFade(key, R, tex, kx, ky, fx0, fy0, fade, fh, strip, nStrip, alphaAt)
        if (dt) {
          this.add.image(fx0, fy0, key).setOrigin(0, 0).setDepth(0.16)
        } else {
          for (let i = 0; i < nStrip; i++) {
            const sx = fx0 + i * strip
            const ts = this.add.tileSprite(sx, fy0, strip + 1, fh, tex)
              .setOrigin(0, 0).setTileScale(kx, ky).setTint(R.tint).setDepth(0.16)
              .setAlpha(alphaAt(i))
            ts.tilePositionX = (sx - R.x) / kx
            ts.tilePositionY = (fy0 - R.top) / ky
          }
        }
      }
      // 图底渐隐:概念图下缘(机械带底)到暗底的渐变,消掉横向硬切线
      const fadeG = this.add.graphics().setDepth(0.17)
      fadeG.fillGradientStyle(0x05070a, 0x05070a, 0x05070a, 0x05070a, 0, 0, 1, 1)
      fadeG.fillRect(R.x, R.top + dispH - 40, R.w, 40)
      fadeG.fillStyle(0x05070a, 1).fillRect(R.x, R.top + dispH, R.w, 60)
      // 雾/尘密度(区域档案字段):整区淡色洗+缓慢漂移的尘埃点
      if (R.fogAlpha) {
        this.add.rectangle(R.x, R.top, R.w, R.walkY - R.top + 120, R.fogTint ?? 0x9fb4c8, R.fogAlpha)
          .setOrigin(0, 0).setDepth(0.9).setBlendMode(Phaser.BlendModes.ADD)
      }
      if (R.lampColor) { // 顶部光锥(光源类型:钠灯/弧光,区域识别的第一眼)
        for (let lx = R.x + 180; lx < R.x + R.w; lx += 420) {
          const cone = this.add.triangle(lx, R.top + 30, 0, 0, -110, R.walkY - R.top - 30, 110, R.walkY - R.top - 30,
            R.lampColor, 0.055).setDepth(0.92).setBlendMode(Phaser.BlendModes.ADD)
          this.tweens.add({ targets: cone, alpha: { from: 0.035, to: 0.075 }, duration: 2600 + (lx % 700),
            yoyo: true, repeat: -1, ease: 'Sine.InOut' })
          this.add.image(lx, R.top + 26, 'px_glow').setTint(R.lampColor).setScale(0.9).setAlpha(0.5)
            .setBlendMode(Phaser.BlendModes.ADD).setDepth(0.93)
        }
      }
      this._drawThreshold(R, L)   // 阈限②③:舱壁门框 + 交界暗角
      this._drawRegionFg(R)       // 前景遮挡层(纵深)
      prevTop = R.top; prevBot = R.top + dispH // 交给下一区做淡化带纵向交集
    }
  }

  // 交叉淡化带预烘焙(spec ④ 性能账):把"新区图 × 阶梯 alpha"的 9 条窄条烙进一张
  // DynamicTexture,场上只留一张静态 image。**能力检测语义看齐 FluidFx.ok**:任何一步
  // 不成立(渲染器不支持 DT / 建纹理失败 / 抛异常)就返回 null,调用方原样回落窄条路径。
  // 分辨率严格 1:1(DT 宽=fade、高=交集带高),不做任何压缩。
  _bakeFade(key, R, tex, kx, ky, x0, y0, w, h, strip, n, alphaAt) {
    if (this._dtOk === false) return null
    try {
      const rt = this.game.renderer?.type
      if (rt !== Phaser.WEBGL && rt !== Phaser.CANVAS) { this._dtOk = false; return null }
      if (this.textures.exists(key)) this.textures.remove(key) // 场景重启时重烘焙,不复用旧纹理
      const dt = this.textures.addDynamicTexture(key, Math.ceil(w), Math.ceil(h))
      if (!dt) return null
      for (let i = 0; i < n; i++) {
        dt.repeat(tex, null, i * strip, 0, strip + 1, h, {
          alpha: alphaAt(i), tint: R.tint,
          tileScaleX: kx, tileScaleY: ky,
          tilePositionX: (x0 + i * strip - R.x) / kx, // 相位与主体 tileSprite 同源
          tilePositionY: (y0 - R.top) / ky,
        })
      }
      dt.render()
      this._dtOk = true
      return dt
    } catch (e) {
      this._dtOk = false
      if (import.meta.env.DEV) console.info('[fade] 预烘焙不可用,回落窄条:', e?.message)
      return null
    }
  }

  // 阈限的实体化(v2,重做):区界=一整面**贯顶舱壁**(与蜂巢地表 partition+门同构:
  // 上段隔墙从世界顶压到门楣,门洞开在行走面上),两侧图的上下断差全部消失在墙后。
  // 切件 dev_wall_col 一律**原比例竖向平铺**(第一版 setDisplaySize 把上楣竖向拉成巨长条=
  // 用户看到的"没贴图的变形灰模",2026-07-28)。纯视觉不碰撞,门洞高 230 不挡路。
  _drawThreshold(R, L) {
    if (R.noThreshold) return
    const x = R.x
    const walkY = R.thresholdWalkY ?? R.walkY   // 门框立在"进入侧"的行走面上(R-B 走道尽头=470,不是大厅 700)
    const doorTop = walkY - 230
    const wallW = 92
    // ① 上段隔墙:世界顶 → 门楣。实体底色+切件按 0.5 原生密度平铺(2x 贴图铁律)——
    // 第一版按"宽度贴合"把 tileScale 放大 2 倍,窗口里只显示切件的半透明边缘区=墙发虚的真凶;
    // 0.5 密度下 92 宽正好并排两根截面柱(与蜂巢隔墙同构的"双柱墙")
    const upH = doorTop - 0
    const wb = this.add.graphics().setDepth(0.955)
    wb.fillStyle(0x151a21, 1).fillRect(x - wallW / 2, 0, wallW, upH)
    wb.lineStyle(2.5, 0x0c0f14, 1).strokeRect(x - wallW / 2, 0, wallW, upH)
    this.add.tileSprite(x, 0, wallW, upH, 'dev_wall_col')
      .setOrigin(0.5, 0).setTileScale(0.5, 0.5).setTint(0x9aa3ad).setDepth(0.96)
    // ② 门楣横梁(门洞上沿的过梁)+ 楣下阴影
    const g = this.add.graphics().setDepth(0.965)
    g.fillStyle(0x1b2027, 1).fillRect(x - wallW / 2 - 8, doorTop, wallW + 16, 20)
    g.fillStyle(0x39424f, 1).fillRect(x - wallW / 2 - 8, doorTop, wallW + 16, 5)
    g.fillStyle(0xd8b13a, 0.85)
    for (let sx = x - wallW / 2 - 4; sx < x + wallW / 2; sx += 24) g.fillRect(sx, doorTop + 13, 12, 7)
    // ③ 门洞:先给洞内"背光暗化+内壁包边"——不做这两样,洞后透出的下一区图又亮又齐,
    // 读作"门洞里塞了个灰块"而不是洞(实测踩中)。楣下投影改**两段梯度**(近楣一段浓而短、
    // 远楣一段淡而长),单段线性渐变在楣正下方读作一层灰纱而不是过梁压出来的影
    const hole = this.add.graphics().setDepth(0.958)
    hole.fillStyle(0x020407, 0.42).fillRect(x - wallW / 2 + 6, doorTop + 20, wallW - 12, walkY - doorTop - 20)
    hole.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.68, 0.68, 0.26, 0.26)
    hole.fillRect(x - wallW / 2 + 6, doorTop + 20, wallW - 12, 26)
    hole.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.26, 0.26, 0, 0)
    hole.fillRect(x - wallW / 2 + 6, doorTop + 46, wallW - 12, 74)
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.5, 0.5, 0, 0)
    g.fillRect(x - wallW / 2, doorTop + 20, wallW, 46)
    // 门洞两侧立柱(spec ③ 精细化,2026-08-09):旧版=三条平涂竖条 + 一列居中铆钉,
    // 在两侧 1:1 出图墙面之间是"最糙的那个"。升级成**分段装甲柱**:
    // ①柱身横向渐变(受光面朝亮区一侧;两侧区的 tint 明度实算,不靠目测)
    // ②两条纵向板缝把柱面分成三块盖板 ③铆钉**沿板缝**成对排,间距 44 = 与墙板同一模数
    // ④柱脚基座板 + 地脚螺栓(柱子是被螺栓锚在甲板上的,不是插进去的一根棍)
    const lum = (c) => ((c >> 16 & 255) * 0.3 + (c >> 8 & 255) * 0.6 + (c & 255) * 0.1)
    const ri = REGIONS.indexOf(R)
    const prevTint = ri > 0 ? REGIONS[ri - 1].tint : 0x9096a0
    const lit = lum(R.tint) >= lum(prevTint) ? 1 : -1 // +1 = 受光面朝东(新区更亮)
    const jambTop = doorTop + 20, jambH = walkY - doorTop - 20
    for (const side of [-1, 1]) {
      const px = x + side * (wallW / 2 - 12)
      g.fillStyle(0x0a0d12, 1).fillRect(px - 13, jambTop, 26, jambH)          // 暗边框
      const cA = lit > 0 ? 0x161c25 : 0x333d4a, cB = lit > 0 ? 0x333d4a : 0x161c25
      g.fillGradientStyle(cA, cB, cA, cB, 1, 1, 1, 1)
      g.fillRect(px - 10, jambTop, 20, jambH)                                  // 柱身(横向明暗)
      g.fillStyle(0x5b6774, 0.9).fillRect(px + lit * 8 - 1.5, jambTop, 3, jambH) // 受光棱
      for (const sx of [px - 4.5, px + 4.5]) {                                 // 纵向板缝
        g.fillStyle(0x070a0e, 1).fillRect(sx, jambTop, 1.6, jambH)
        g.fillStyle(0x46505c, 0.35).fillRect(sx + 1.6, jambTop, 1, jambH)      // 缝右侧起翘高光
      }
      for (let py = jambTop + 22; py < walkY - 14; py += 44) {                 // 沿缝铆钉(模数 44)
        for (const sx of [px - 7.5, px + 7.5]) {
          g.fillStyle(0x090c11, 1).fillCircle(sx, py, 2.4)
          g.fillStyle(0x5b6774, 0.7).fillCircle(sx - 0.6, py - 0.7, 1.1)
        }
      }
      // 柱脚基座板 + 地脚螺栓
      g.fillStyle(0x121821, 1).fillRect(px - 16, walkY - 16, 32, 12)
      g.fillStyle(0x3d4753, 1).fillRect(px - 16, walkY - 16, 32, 2.5)
      g.lineStyle(1.5, 0x070a0e, 1).strokeRect(px - 16, walkY - 16, 32, 12)
      for (const sx of [px - 10, px + 10]) {
        g.fillStyle(0x080b10, 1).fillCircle(sx, walkY - 8, 2.6)
        g.fillStyle(0x606c79, 0.75).fillCircle(sx - 0.6, walkY - 8.8, 1.2)
      }
    }
    // ④ 门槛(黄黑过门条,嵌在行走面)
    g.fillStyle(0x14171b, 1).fillRect(x - wallW / 2 - 12, walkY - 6, wallW + 24, 8)
    g.fillStyle(0xd8b13a, 0.85)
    for (let sx = x - wallW / 2 - 8; sx < x + wallW / 2 + 4; sx += 20) g.fillRect(sx, walkY - 6, 10, 8)
    // ⑤ 墙下:平地区=短基座;**落差区=把 R-A 走道端头当悬挑平台做出结构**(判真 #15)。
    // 旧版对两种情形一律画 92×60 的暗平板:在 R-B 侧它悬在离大厅地面(700)170px 的半空,
    // 左右刀切竖边、下面只有一层渐隐 = 正是注释自己想消灭的"悬挂的没贴图灰板",缩到 60px 仍在。
    // 结构读法:走道 = 有厚度的钢甲板(顶 470/底 540,与 _drawUnderdeck 同一套断面语言),
    // 端头被切开 → 画出甲板断面;甲板之下由西侧墙墩(level partition 5856..5900)承重,
    // 东侧悬挑段配斜撑牛腿咬回墙墩;墙墩落到大厅地面处出柱脚基座板 + 接地投影。
    this._drawThresholdFooting(g, x, wallW, walkY, R.walkY)
    // ⑥ 楣上警示灯:先有**灯具**(支架双腿 + 灯罩壳 + 罩下灯管),再叠呼吸软光——
    // 悬浮的一团光=贴上去的(结构真实性:光必须有发出它的东西)
    for (const lx2 of [x - 11, x + 8]) { // 支架双腿(从楣顶伸到罩底)
      g.fillStyle(0x141a22, 1).fillRect(lx2, doorTop - 12, 3, 12)
      g.fillStyle(0x39424f, 0.8).fillRect(lx2, doorTop - 12, 1, 12)
    }
    g.fillStyle(0x1b2027, 1).fillRect(x - 16, doorTop - 24, 32, 12)     // 灯罩壳体
    g.fillStyle(0x39424f, 1).fillRect(x - 16, doorTop - 24, 32, 3)      // 罩顶受光棱
    g.lineStyle(1.5, 0x080b0f, 1).strokeRect(x - 16, doorTop - 24, 32, 12)
    g.fillStyle(0x0a0d12, 1).fillRect(x - 13, doorTop - 13, 26, 3)      // 罩沿(灯管缩在罩下)
    const tube = this.add.rectangle(x, doorTop - 12.5, 22, 3.4, R.lampColor ?? 0x7fd4b0, 0.95)
      .setDepth(0.975)
    const lamp = this.add.image(x, doorTop - 9, 'px_glow').setTint(R.lampColor ?? 0x7fd4b0)
      .setScale(0.62).setAlpha(0.45).setBlendMode(Phaser.BlendModes.ADD).setDepth(0.98)
    this.tweens.add({ targets: lamp, alpha: { from: 0.22, to: 0.55 }, duration: 1800, yoyo: true, repeat: -1 })
    this.tweens.add({ targets: tube, alpha: { from: 0.6, to: 0.98 }, duration: 1800, yoyo: true, repeat: -1 })
    // ⑦ 交界暗角(墙两侧的明暗渐变,吃掉残缝;0.7 实测在暗图一侧读作黑缝,压到 0.38)。
    // 行走面以下加深且**通到世界底**:旧图的"走道下机械带"在区界截止,左有图右是黑的
    // 不对称断差正在门框下方——地下段用更浓的渐变把两边一起沉进暗部(实测踩中)
    g.fillGradientStyle(0x03050a, 0x03050a, 0x03050a, 0x03050a, 0.38, 0, 0.38, 0)
    g.fillRect(x + wallW / 2, 0, 90, walkY)
    g.fillGradientStyle(0x03050a, 0x03050a, 0x03050a, 0x03050a, 0, 0.38, 0, 0.38)
    g.fillRect(x - wallW / 2 - 90, 0, 90, walkY)
    g.fillGradientStyle(0x03050a, 0x03050a, 0x03050a, 0x03050a, 0.78, 0, 0.78, 0)
    g.fillRect(x + wallW / 2, walkY, 150, L.height - walkY)
    g.fillGradientStyle(0x03050a, 0x03050a, 0x03050a, 0x03050a, 0, 0.78, 0, 0.78)
    g.fillRect(x - wallW / 2 - 150, walkY, 150, L.height - walkY)
  }

  // 门框墙下的承接结构(#15 + spec ①③ 的托架语言)。平地区仍是短基座;落差区(thresholdWalkY
  // ≠ 本区行走面)必须做成"悬挑甲板端头 + 承重墙墩 + 斜撑牛腿",不能再给一块 92×60 的暗平板
  // 悬在离大厅地面 170px 的半空。高度由落差推导,不写死——将来任何落差区自动成立。
  _drawThresholdFooting(g, x, wallW, walkY, regionWalkY) {
    const hw = wallW / 2
    if (!(regionWalkY > walkY + 8)) {
      // 平地区:短基座(60px)+ 底部渐隐,只暗示"墙插进地里",不需要一堵地下墙
      g.fillStyle(0x0d1117, 1).fillRect(x - hw, walkY, wallW, 60)
      g.fillStyle(0x141a21, 1).fillRect(x - hw + 6, walkY, wallW - 12, 44)
      g.fillStyle(0x2c3542, 0.75).fillRect(x - hw + 6, walkY, 3, 44) // 墩身受光棱(与柱脚同一光向)
      g.fillGradientStyle(0x05070a, 0x05070a, 0x05070a, 0x05070a, 0, 0, 1, 1)
      g.fillRect(x - hw, walkY + 36, wallW, 26)
      return
    }
    const DB = walkY + 70        // 甲板底面(厚度 70,与 _drawUnderdeck 的 470/540 同一断面语言)
    const floor = regionWalkY    // 落差侧行走面(R-B 大厅地面 700)
    const ax = x - hw - 6, bx = x + hw + 6
    // ① 甲板端头断面:顶板 + 腹板加强肋 + 下翼缘(走道是有厚度的钢甲板,不是一条线)
    g.fillStyle(0x151b24, 1).fillRect(ax, walkY, bx - ax, DB - walkY)
    g.fillStyle(0x39424f, 1).fillRect(ax, walkY, bx - ax, 7)
    g.fillStyle(0x252d38, 1).fillRect(ax, DB - 9, bx - ax, 9)
    g.lineStyle(2, 0x0b0e13, 0.9)
    for (let sx = ax + 11; sx < bx - 6; sx += 19) g.lineBetween(sx, walkY + 9, sx, DB - 11)
    g.lineStyle(1.5, 0x0b0e13, 1).strokeRect(ax, walkY, bx - ax, DB - walkY)
    // ② 承重墙墩:甲板底 → 大厅地面(西半正对 level 的 partition 实体,两者读作同一根墩)
    g.fillStyle(0x0c1018, 1).fillRect(x - hw, DB, hw + 4, floor - DB)
    g.fillGradientStyle(0x1c2430, 0x10161e, 0x1c2430, 0x10161e, 1, 1, 1, 1)
    g.fillRect(x - hw + 5, DB, hw - 1, floor - DB)
    g.fillStyle(0x2c3542, 0.85).fillRect(x - hw + 5, DB, 3, floor - DB)
    for (let sy = DB + 26; sy < floor - 20; sy += 44) { // 墩身分段横缝 + 螺栓,模数 44 与墙板一致
      g.fillStyle(0x070a0e, 1).fillRect(x - hw + 5, sy, hw - 1, 1.6)
      for (const sx of [x - hw + 14, x - 8]) {
        g.fillStyle(0x080b10, 1).fillCircle(sx, sy + 9, 2.2)
        g.fillStyle(0x515c69, 0.6).fillCircle(sx - 0.5, sy + 8.4, 1)
      }
    }
    // ③ 悬挑端斜撑牛腿:甲板伸出墩外那一段靠"节点板 + 角钢斜杆 + 两端螺栓"压回墩身(下方受压)
    const tipX = x + hw + 4, footY = DB + 66
    g.fillStyle(0x141a23, 1)
    g.beginPath(); g.moveTo(tipX, DB); g.lineTo(x + 3, DB); g.lineTo(x + 3, footY); g.closePath(); g.fillPath()
    g.lineStyle(2, 0x0a0e13, 1).strokePath()
    g.lineStyle(6, 0x1d2530, 1).lineBetween(tipX - 6, DB + 5, x + 9, footY - 7)
    g.lineStyle(1.6, 0x475161, 0.75).lineBetween(tipX - 7, DB + 3, x + 8, footY - 9)
    for (const [sx, sy] of [[tipX - 10, DB + 8], [x + 10, footY - 10]]) {
      g.fillStyle(0x080b10, 1).fillCircle(sx, sy, 2.4)
      g.fillStyle(0x5b6774, 0.7).fillCircle(sx - 0.6, sy - 0.7, 1.1)
    }
    // ④ 墩脚基座板 + 地脚螺栓(墩子是被螺栓锚在大厅地面上的)+ 接地投影
    g.fillStyle(0x171e28, 1).fillRect(x - hw - 8, floor - 15, hw + 20, 15)
    g.fillStyle(0x3d4753, 1).fillRect(x - hw - 8, floor - 15, hw + 20, 2.5)
    g.lineStyle(1.5, 0x070a0e, 1).strokeRect(x - hw - 8, floor - 15, hw + 20, 15)
    for (const sx of [x - hw + 2, x - 2]) {
      g.fillStyle(0x080b10, 1).fillCircle(sx, floor - 7, 2.6)
      g.fillStyle(0x606c79, 0.75).fillCircle(sx - 0.6, floor - 7.8, 1.2)
    }
    this.add.ellipse(x - hw + 12, floor + 1, 108, 11, 0x03050a, 0.5).setDepth(0.966)
  }

  // 前景遮挡层(调研 §3.3:成本最低、纵深收益最大的一条)——近处管束/立柱剪影,
  // scrollFactor>1 产生视差,画在人物之前:角色从管道后面走过 = 立刻有前后层次
  _drawRegionFg(R) {
    // 【视差基准锚补偿(2026-08-09 判真 #12)】scrollFactor 只定"跟随速度",不定基准点:
    // 屏幕位置 = worldX − scrollX·f,整层恒定西移 (f−1)·scrollX(本章 scrollX 4300-6840
    // = 西移 387~616 世界px ≈ 半屏)——实测 R-B 大厅一根前景柱都不剩,而 R-B 的两组管子
    // 跑进 R-A 走廊里显示;注释里"1.09 不至于漂出位"这句是文档背了 bug(skill A2/开发日志同误)。
    // 解:把绘制坐标反解成"相机正对 px 时管子正好落在 px" → px + (f−1)·(px − 相机半宽)。
    // 该式与 zoom 无关(Phaser 先按 scrollFactor 折世界坐标,再过相机矩阵),整组只挪不缩,
    // 组内几何(两根管间距 40)不受 f 放大。**将来加 1.2-1.5 的更近前景层直接复用 fgAnchor。**
    const f = 1.09
    const camMid = this.cameras.main.width / 2
    const fgAnchor = (px) => px + (f - 1) * (px - camMid)
    // 【只给 X 视差】单参 setScrollFactor(f) 会把 Y 一起设:R-B 走道 scrollY≈453 时底部渐隐
    // 上移 ~41px(管子在半空就淡没了)——纵向无视差意图,Y 固定 1
    const g = this.add.graphics().setDepth(25).setScrollFactor(f, 1)
    const yTop = -60, yBot = R.walkY + 120
    const h = yBot - yTop
    // 圆柱着色:暗边→管身→高光核→管身→暗边,**横向渐变**(三段平涂读作"三条色带"不是圆柱)。
    // 【暗边必须明显亮于空区底色】旧值 0x05070B 与新区暗底 0x05070A 只差 1/255 = 描边在黑空区
    // 里等于不存在,圆柱三段塌成两段,最靠前的一层读作"贴在镜头上的灰条"(2026-08-09 判真 #23)。
    // 【不得加端帽】通顶+底部渐隐是踩坑后的定版(半空断头=悬空模型),端帽等于把已修的 bug 改回去
    const CYL = [
      [0.00, 0.16, 0x11161d, 0x1b232e], // 左暗边 → 管身暗侧
      [0.16, 0.38, 0x1b232e, 0x3d4a5a], // 管身 → 高光核
      [0.38, 0.54, 0x3d4a5a, 0x232c38], // 高光核 → 管身
      [0.54, 1.00, 0x232c38, 0x0e131a], // 管身 → 右暗边
    ]
    const pipe = (px, w) => {
      for (const [a, b, c0, c1] of CYL) {
        g.fillGradientStyle(c0, c1, c0, c1, 1, 1, 1, 1)
        g.fillRect(px + w * a, yTop, w * (b - a) + 0.6, h) // +0.6 消段间发丝缝
      }
      // 卡箍=法兰接头(外框/双向渐变箍身/上受光棱+下沿投影/一圈螺栓),不是一条平涂横杠
      for (let cy = yTop + 90; cy < yBot; cy += 210) {
        g.fillStyle(0x090d13, 1).fillRect(px - 6, cy - 2, w + 12, 22)
        g.fillGradientStyle(0x1a212b, 0x46535f, 0x1a212b, 0x46535f, 1, 1, 1, 1)
        g.fillRect(px - 4, cy + 1, (w + 8) * 0.46 + 0.6, 16)
        g.fillGradientStyle(0x46535f, 0x161d26, 0x46535f, 0x161d26, 1, 1, 1, 1)
        g.fillRect(px - 4 + (w + 8) * 0.46, cy + 1, (w + 8) * 0.54, 16)
        g.fillStyle(0x53606d, 0.8).fillRect(px - 4, cy + 1, w + 8, 2)
        g.fillStyle(0x070a0f, 0.9).fillRect(px - 4, cy + 15, w + 8, 2)
        for (let rx = px + 2.5; rx < px + w - 1; rx += 9) {
          g.fillStyle(0x0a0e14, 1).fillCircle(rx, cy + 9, 1.8)
          g.fillStyle(0x4d5966, 0.75).fillCircle(rx - 0.5, cy + 8.2, 0.9)
        }
      }
    }
    // 每区只放两组(多了挡视野);位置避开区界门框与风扇正前方
    const spots = R.fgSpots ?? [0.34, 0.72]
    for (const t of spots) {
      const px = fgAnchor(R.x + R.w * t)
      pipe(px, 30)
      pipe(px + 40, 19)
      // 底部渐隐(管消失在走道下方的暗部,不是断头)
      g.fillGradientStyle(0x05070a, 0x05070a, 0x05070a, 0x05070a, 0, 0, 1, 1)
      g.fillRect(px - 8, yBot - 90, 78, 90)
    }
  }

  // —— R-A 管廊:甲板下结构(电缆地沟支线 + 检修储藏舱)与节奏装饰 ——
  // 结构读法(五行说明书见交付报告):走道 = 有厚度的钢甲板(顶 470/底 540);地沟与储藏舱把甲板切开,
  // **断面必须画出来**(暗门 v4 定论:"藏在地下"要是可见事实,不是遮挡把戏)——坑口两侧画甲板断面
  // (顶板/腹板加强肋/下翼缘),坑内画井壁,甲板之下是设备夹层(内壁板缝 + 悬垂电缆束 + 滴水积水)。
  // 碰撞由 level solids 负责(所见即所碰:画出来的坑沿=碰撞缺口边,画出来的踏台=可站实体)。
  // 【A2 越界守卫】每个元素按世界 x 逐个判定是否落在 R-A 区内,越界即跳过(不整片跳过)。
  _drawUnderdeck() {
    const R = REGIONS.find((r) => r.id === 'duct')
    if (!R) return
    const inR = (a, b = a) => a >= R.x && b <= R.x + R.w
    const DT = 470, DB = 540 // 甲板顶面 / 甲板底面
    const bg = this.add.graphics().setDepth(0.6)  // 夹层内壁与电缆(背景之上、结构实体之下)
    const st = this.add.graphics().setDepth(5.3)  // 甲板断面 / 井壁(与暗门剖面件同层)
    const fg = this.add.graphics().setDepth(5.45) // 坑沿黄黑警示带(压在走道面上)

    // ① 甲板下夹层内壁:地沟段(5050-5470)与储藏舱段(5470-5790)
    for (const [ax, bx, yb, floorTop] of [[5050, 5470, 680, 620], [5470, 5790, 700, 664]]) {
      if (!inR(ax, bx)) continue
      bg.fillStyle(0x080c12, 1).fillRect(ax, DB, bx - ax, yb - DB)
      bg.fillStyle(0x121924, 1).fillRect(ax + 5, DB + 5, bx - ax - 10, yb - DB - 10)
      bg.fillStyle(0x1b2431, 1).fillRect(ax + 5, DB + 5, bx - ax - 10, 6) // 顶梁受光棱
      bg.lineStyle(1.5, 0x070a0f, 0.9)
      for (let sx = ax + 44; sx < bx - 12; sx += 62) bg.lineBetween(sx, DB + 12, sx, yb - 8) // 板缝
      // 悬垂电缆束:三根不同垂度/色温——"这是电缆沟"要一眼读得出来
      const cols = [0x2b2118, 0x222933, 0x33291c]
      for (let k = 0; k < 3; k++) {
        bg.lineStyle(3 - k * 0.6, cols[k], 0.9)
        const y0 = DB + 18 + k * 8
        bg.beginPath()
        for (let sx = ax + 8; sx <= bx - 8; sx += 16) {
          const t = (sx - ax - 8) / (bx - ax - 16)
          const y = y0 + Math.sin(t * Math.PI) * (9 + k * 5) + Math.sin(t * Math.PI * 3.5 + k) * (3 + k)
          if (sx === ax + 8) bg.moveTo(sx, y); else bg.lineTo(sx, y)
        }
        bg.strokePath()
      }
      // 沟底积水反光:画在**沟底板顶面**上(depth 5.3 > 板体 5),不是画在板下被自己盖住
      st.fillStyle(0x2b3a44, 0.3).fillRect(ax + 14, floorTop - 4, bx - ax - 28, 4)
      st.fillStyle(0x3d5461, 0.22).fillRect(ax + 40, floorTop - 6, 46, 6)
    }
    // 储藏舱内的货架剪影(舱是"一进"的房间,不是空盒子)
    if (inR(5496, 5756)) {
      for (const [rx, rw, rh] of [[5506, 46, 96], [5700, 52, 84]]) {
        bg.fillStyle(0x0c1119, 1).fillRect(rx, 664 - rh, rw, rh)
        bg.fillStyle(0x18202b, 1).fillRect(rx + 3, 664 - rh + 3, rw - 6, rh - 6)
        for (let sy = 664 - rh + 16; sy < 660; sy += 26) bg.fillStyle(0x0a0e14, 1).fillRect(rx + 3, sy, rw - 6, 4)
      }
      const lamp = this.add.image(5640, 556, 'px_glow').setTint(0xffd08a).setScale(0.55).setAlpha(0.22)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(0.62)
      this.tweens.add({ targets: lamp, alpha: { from: 0.14, to: 0.3 }, duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    }

    // ② 坑口:井壁(甲板厚度里看到的沟壁)+ 两侧甲板断面 + 坑沿黄黑警示
    const deckXsec = (ax, bx) => { // 被切开的甲板断面:顶板 + 腹板加强肋 + 下翼缘
      if (!inR(ax, bx)) return
      st.fillStyle(0x151b24, 1).fillRect(ax, DT, bx - ax, DB - DT)
      st.fillStyle(0x39424f, 1).fillRect(ax, DT, bx - ax, 7)
      st.fillStyle(0x252d38, 1).fillRect(ax, DB - 9, bx - ax, 9)
      st.lineStyle(2, 0x0b0e13, 0.9)
      for (let sx = ax + 11; sx < bx - 6; sx += 19) st.lineBetween(sx, DT + 9, sx, DB - 11)
      st.lineStyle(1.5, 0x0b0e13, 1).strokeRect(ax, DT, bx - ax, DB - DT)
    }
    const pitWell = (ax, bx) => { // 坑内:甲板厚度段的井壁(下面接夹层内壁)
      if (!inR(ax, bx)) return
      st.fillStyle(0x04070b, 1).fillRect(ax, DT, bx - ax, DB - DT)
      st.fillStyle(0x121821, 1).fillRect(ax, DT, 9, DB - DT)
      st.fillStyle(0x121821, 1).fillRect(bx - 9, DT, 9, DB - DT)
      st.lineStyle(1.5, 0x2b333d, 0.75)
      st.lineBetween(ax + 9, DT + 3, ax + 9, DB)
      st.lineBetween(bx - 9, DT + 3, bx - 9, DB)
    }
    const lipStripe = (lx, dir) => { // 坑沿黄黑警示带(40px,朝走道一侧)
      const ax = dir > 0 ? lx : lx - 40
      if (!inR(ax, ax + 40)) return
      fg.fillStyle(0xd8b13a, 0.9).fillRect(ax, DT - 4, 40, 8)
      fg.fillStyle(0x14171b, 0.9)
      for (let sx = ax + 3; sx < ax + 38; sx += 12) fg.fillRect(sx, DT - 4, 6, 8)
    }
    for (const [ax, bx] of [[5080, 5170], [5330, 5420]]) {
      pitWell(ax, bx)
      lipStripe(ax, -1)
      lipStripe(bx, 1)
    }
    deckXsec(5038, 5080); deckXsec(5170, 5212) // 西坑两侧
    deckXsec(5288, 5330); deckXsec(5420, 5444) // 东坑两侧(东侧收窄:5445 起是检修口自带的剖面切件)
    // 断栅栏残段(西坑沿:检修栏杆被拆了一截="这里能下去"的视觉预告)
    if (inR(5000, 5080)) {
      st.lineStyle(3, 0x39424f, 1)
      st.lineBetween(5006, DT, 5006, DT - 44)
      st.lineBetween(5048, DT, 5048, DT - 44)
      st.lineBetween(5004, DT - 42, 5062, DT - 42)
      st.lineBetween(5004, DT - 26, 5054, DT - 24)
      st.lineStyle(3, 0x2a313a, 1).lineBetween(5062, DT - 42, 5074, DT - 30) // 被掰弯的断头
      st.fillStyle(0x1b2027, 1).fillRect(5001, DT - 4, 12, 6)
      st.fillStyle(0x1b2027, 1).fillRect(5043, DT - 4, 12, 6)
    }

    // ③ 节奏装饰:应急灯条(接近地沟入口的一段从绿转红)+ 顶部滴凝水管与地面水渍
    for (let lx = 4680; lx < 5880; lx += 160) {
      if (!inR(lx - 12, lx + 12)) continue
      const warn = lx > 4980 && lx < 5070 // 地沟入口预告段
      st.fillStyle(0x1b2027, 1).fillRect(lx - 13, 322, 26, 7)
      st.fillStyle(0x0e1116, 1).fillRect(lx - 10, 329, 20, 3)
      const tint = warn ? 0xff3b28 : 0x6ef0a0
      const halo = this.add.image(lx, 332, 'px_glow').setTint(tint).setScale(warn ? 0.42 : 0.3)
        .setAlpha(warn ? 0.34 : 0.2).setBlendMode(Phaser.BlendModes.ADD).setDepth(5.06)
      this.tweens.add({ targets: halo, alpha: { from: halo.alpha * 0.6, to: halo.alpha * 1.25 },
        duration: warn ? 780 : 2400 + (lx % 700), yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    }
    if (inR(4846, 4896)) {
      st.fillStyle(0x232a34, 1).fillRect(4856, 320, 30, 9)   // 冷凝水管接头
      st.fillStyle(0x39424f, 1).fillRect(4858, 320, 26, 3)
      st.fillStyle(0x161c25, 1).fillRect(4866, 329, 10, 7)   // 滴嘴
      this.add.ellipse(4872, DT - 1, 44, 8, 0x24333d, 0.5).setDepth(5.44) // 地面水渍
      this.add.ellipse(4872, DT - 1, 20, 5, 0x38505c, 0.35).setDepth(5.44)
      const drip = () => { // 一滴一滴地掉(周期随机,不做粒子=零开销)
        const d = this.add.ellipse(4871, 338, 3, 6, 0x9fd8e8, 0.55).setDepth(5.43)
        this.tweens.add({ targets: d, y: DT - 4, scaleY: 1.6, duration: 620, ease: 'Quad.In',
          onComplete: () => { d.destroy() } })
        this.time.delayedCall(1800 + Math.random() * 2600, drip)
      }
      this.time.delayedCall(900 + Math.random() * 1800, drip)
    }
  }

  // —— R-B 动力大厅:二层检修回廊的托架/扶手(平台要"做进结构里"不是悬浮)、补给间标识、R-C 伏笔封盖 ——
  // 回廊本体碰撞=level 的 oneWay 桁架条目;这里画的全是**不碰撞的结构装饰**(托架在走道后,扶手是后带件),
  // 与"挡路的才立在走道中"一致。【A2 越界守卫】逐元素判定 x 是否在 R-B 区内。
  _drawPowerDetail() {
    const R = REGIONS.find((r) => r.id === 'power')
    if (!R) return
    const inR = (a, b = a) => a >= R.x && b <= R.x + R.w
    const CX0 = 6310, CX1 = 6620, CY = 380, CH = 22 // 二层检修回廊(与 level oneWay 条目同几何)
    const g = this.add.graphics().setDepth(4.95)   // 托架/主梁(桁架贴图之后=看得见平台压在梁上)
    const rail = this.add.graphics().setDepth(5.18) // 扶手(走道后带,画在人物之后)
    if (inR(CX0 - 60, CX1)) {
      // 主梁:回廊全长的下弦梁(桁架不是漂在空中的板子)
      g.fillStyle(0x141a22, 1).fillRect(CX0, CY + CH, CX1 - CX0, 9)
      g.fillStyle(0x272f3a, 1).fillRect(CX0, CY + CH, CX1 - CX0, 3)
      g.lineStyle(1.5, 0x0a0e13, 1).strokeRect(CX0, CY + CH, CX1 - CX0, 9)
      // 角钢斜撑:每 120px 一组(撑脚落在后墙锚板上=撑到墙里,不是悬浮的装饰线)
      for (let bx = CX0 + 30; bx < CX1; bx += 120) {
        g.fillStyle(0x161c25, 1)
        g.beginPath()
        g.moveTo(bx, CY + CH + 9); g.lineTo(bx + 6, CY + CH + 9)
        g.lineTo(bx - 38, CY + CH + 58); g.lineTo(bx - 48, CY + CH + 56)
        g.closePath(); g.fillPath()
        g.lineStyle(2, 0x0a0e13, 1).strokePath()
        g.lineStyle(1.5, 0x39424f, 0.8).lineBetween(bx + 3, CY + CH + 11, bx - 40, CY + CH + 55)
        g.fillStyle(0x1b2231, 1).fillRect(bx - 56, CY + CH + 48, 24, 15) // 墙面锚板
        g.fillStyle(0x4a5058, 1).fillCircle(bx - 50, CY + CH + 55, 2.4)
        g.fillStyle(0x4a5058, 1).fillCircle(bx - 38, CY + CH + 55, 2.4)
      }
      // 扶手:立柱每 78px + 双横管 + 踢脚板(格栅回廊的完整读法)
      rail.fillStyle(0x1b2027, 1).fillRect(CX0, CY - 9, CX1 - CX0, 9) // 踢脚板
      for (const drop of [52, 32]) {
        rail.lineStyle(3, 0x2f353d, 1).lineBetween(CX0 + 8, CY - drop, CX1 - 8, CY - drop)
        rail.lineStyle(1, 0x565f6a, 0.8).lineBetween(CX0 + 8, CY - drop - 1, CX1 - 8, CY - drop - 1)
      }
      for (let px = CX0 + 8; px <= CX1 - 8; px += 78) {
        rail.lineStyle(3, 0x2f353d, 1).lineBetween(px, CY, px, CY - 54)
      }
    }
    // 补给间:舱盖顶沿黄黑带 + 门侧编号牌(锁着的那间要一眼认出是"物资间")
    if (inR(5975, 6155)) {
      const s = this.add.graphics().setDepth(5.46)
      s.fillStyle(0xd8b13a, 0.85)
      for (let sx = 5979; sx < 6151; sx += 22) s.fillRect(sx, 552, 11, 6)
      s.fillStyle(0x14171b, 1).fillRect(6096, 590, 22, 14)
      s.fillStyle(0x7fd4ff, 0.55).fillRect(6099, 593, 16, 8)
    }
    // R-C 伏笔:东端"电缆隧道检修口"封闭舱盖(纯视觉结构件,不可交互——下一区在门后)
    if (inR(7596, 7748)) {
      const h = this.add.graphics().setDepth(4.4)
      h.fillStyle(0x11161d, 1).fillRect(7596, 692, 152, 30)      // 法兰框
      h.fillStyle(0x1e2530, 1).fillRect(7604, 696, 136, 22)      // 盖板本体
      h.lineStyle(2, 0x0a0e13, 1).strokeRect(7596, 692, 152, 30)
      h.fillStyle(0x39424f, 1).fillRect(7604, 696, 136, 3)       // 受光棱
      for (let bx = 7606; bx < 7744; bx += 17) h.fillStyle(0x4a5058, 1).fillCircle(bx, 718, 2.6) // 法兰螺栓
      h.fillStyle(0xd8b13a, 0.85)                                 // 黄黑封条
      for (let sx = 7612; sx < 7736; sx += 20) h.fillRect(sx, 704, 10, 6)
      h.lineStyle(4, 0x2f353d, 1)                                 // 折叠把手
      h.lineBetween(7660, 700, 7660, 693)
      h.lineBetween(7660, 693, 7684, 693)
      h.lineBetween(7684, 693, 7684, 700)
      h.fillStyle(0x141a22, 1).fillRect(7748, 660, 12, 62)        // 穿墙线管两根(通往下一区)
      h.fillStyle(0x141a22, 1).fillRect(7740, 636, 20, 12)
      h.fillStyle(0x272f3a, 1).fillRect(7740, 636, 20, 3)
    }
    // —— spec ①:回程踏台×2 与高台"做进结构里"(2026-07-28 观感余项"踏台/高台无支撑托架")——
    // 回程踏台(5905/560、5905/630)紧贴 R-A/R-B 门框墙墩,托架直接撑在墙墩东面(anchorX=5900);
    // 上行阶梯 E2(6200/442)、E1(6330/526)在大厅中段,按后墙锚板语言各一组托架。
    // 高台(6480,610,140×90)的台面+台身在 solids 绘制处走 _drawTruss + _drawRiserBody。
    // 【回廊(6310-6620)自带主梁与三组斜撑,不重复】
    for (const q of this.solids) {
      if (!q.oneWay || !inR(q.x, q.x + q.w)) continue
      if (q.x >= CX0 && q.x + q.w <= CX1 && q.y === CY) continue // 二层回廊已有托架
      this._drawPlatformRig(q, q.x < 5990 ? 5900 : null)
    }
    // —— spec ②:走道(700)以下的机械带延伸 ——
    // 现状:R-B 概念图下半虽溢出到走道面之下,但内容稀疏,大厅"脚底下什么都没有"。
    // 补:电缆桥架横走(带吊架)+ 管束下行 + 检修格栅暗门×1(纯视觉)+ 由上向下 0.5→0.85 渐暗
    // (与 A2 交界暗角同语言)。**只做相机可见范围**:走道下 ~240px 内精细,再往下交给渐暗。
    // 【逐元素越界守卫】每件按世界 x 判 inR,越界即跳过——不整片跳过(会误杀界内合法元素);
    // 【禁止按整幅世界宽/高 fillRect】渐暗只铺 R.x..R.x+R.w,扩图后不会变成越界遮罩
    const GY = 740, mb = this.add.graphics().setDepth(0.6)
    for (let sx = R.x + 40; sx < R.x + R.w - 40; sx += 320) { // 电缆桥架:分段梯形托盘 + 吊架
      if (!inR(sx, sx + 260)) continue
      mb.fillStyle(0x0a0e14, 1).fillRect(sx, GY, 260, 15)
      mb.fillStyle(0x1a222c, 1).fillRect(sx + 2, GY + 2, 256, 11)
      mb.fillStyle(0x2e3846, 0.9).fillRect(sx + 2, GY + 2, 256, 2)     // 托盘上翻边受光
      for (let rx = sx + 8; rx < sx + 252; rx += 13) mb.fillStyle(0x090d12, 1).fillRect(rx, GY + 4, 4, 9) // 横档
      for (const hx of [sx + 26, sx + 130, sx + 234]) {                // 吊架(吊在甲板下,不是浮着)
        mb.fillStyle(0x161d27, 1).fillRect(hx - 2, 700, 4, GY - 700)
        mb.fillStyle(0x39424f, 0.7).fillRect(hx - 2, 700, 1.2, GY - 700)
        mb.fillStyle(0x1b2231, 1).fillRect(hx - 7, 702, 14, 6)
      }
      mb.fillStyle(0x33291c, 0.95).fillRect(sx + 4, GY + 4, 252, 3)    // 盘内电缆两束
      mb.fillStyle(0x222933, 0.95).fillRect(sx + 4, GY + 8, 252, 3)
    }
    for (const bx of [6040, 6420, 6760, 7120, 7460]) {                 // 管束下行(圆柱明暗+卡箍)
      if (!inR(bx - 16, bx + 34)) continue
      for (const [ox, w] of [[0, 17], [24, 11]]) {
        mb.fillGradientStyle(0x0d1117, 0x272f3c, 0x0d1117, 0x272f3c, 1, 1, 1, 1)
        mb.fillRect(bx + ox, 700, w * 0.62, 250)
        mb.fillGradientStyle(0x272f3c, 0x0b0f15, 0x272f3c, 0x0b0f15, 1, 1, 1, 1)
        mb.fillRect(bx + ox + w * 0.62, 700, w * 0.38, 250)
      }
      for (const cy of [788, 892]) {
        mb.fillStyle(0x090d12, 1).fillRect(bx - 4, cy, 43, 11)
        mb.fillStyle(0x2b3441, 1).fillRect(bx - 2, cy + 2, 39, 6)
      }
    }
    if (inR(7130, 7290)) { // 检修格栅暗门×1(纯视觉:甲板下检修口,封着)
      const dx = 7130
      mb.fillStyle(0x0a0e14, 1).fillRect(dx, 792, 160, 96)
      mb.fillStyle(0x161d27, 1).fillRect(dx + 6, 798, 148, 84)
      mb.fillStyle(0x39424f, 0.8).fillRect(dx + 6, 798, 148, 2.5)
      for (let ly = 806; ly < 878; ly += 11) mb.fillStyle(0x0b1017, 1).fillRect(dx + 12, ly, 136, 5) // 百叶格栅
      mb.lineStyle(2, 0x080b0f, 1).strokeRect(dx, 792, 160, 96)
      for (const [bx2, by2] of [[dx + 12, 804], [dx + 148, 804], [dx + 12, 876], [dx + 148, 876]]) {
        mb.fillStyle(0x090d12, 1).fillCircle(bx2, by2, 2.6)
        mb.fillStyle(0x515c69, 0.6).fillCircle(bx2 - 0.6, by2 - 0.7, 1.1)
      }
      mb.fillStyle(0xd8b13a, 0.75)
      for (let sx = dx + 20; sx < dx + 142; sx += 18) mb.fillRect(sx, 884, 9, 4) // 黄黑封条
    }
    // 由上向下渐暗(A2 交界暗角同语言)。分两层:**背景**按规格 0.5→0.85 沉下去(画在机械带
    // 之下),**新加的机械件**只吃一层更轻的 0.12→0.6(否则刚补的桥架/管束当场被自己的暗角糊掉)
    const dgBack = this.add.graphics().setDepth(0.58)
    dgBack.fillGradientStyle(0x03050a, 0x03050a, 0x03050a, 0x03050a, 0.5, 0.5, 0.85, 0.85)
    dgBack.fillRect(R.x, 716, R.w, 244)
    const dg = this.add.graphics().setDepth(0.63)
    dg.fillGradientStyle(0x03050a, 0x03050a, 0x03050a, 0x03050a, 0.12, 0.12, 0.6, 0.6)
    dg.fillRect(R.x, 760, R.w, 200)
  }

  // 地下蜂巢段背景 —— 临时程序化占位(仅撑结构试玩;专属分层概念图待结构拍板后出图切换)。
  // 视觉语言:地表以下整幅暗填充(越深越暗=危险梯度)、井体内部设施底色+面板分缝、
  // 每层一条功能识别色条(元素库#46 中性基底+色条)、升降井/楼梯井竖向暗带、核心舱红光脉动。
  _drawHiveBackdrop(L) {
    const H = L.hive
    if (!H) return
    const g = this.add.graphics().setDepth(0.2)
    // 地表以下整幅岩土暗填充(盖住走廊概念图残余),向深处渐暗。
    // 【x 必须收窄到蜂巢段】它原本按整幅世界宽画,基地章向东扩图后会盖掉新区 y540 以下的全部背景
    // (实测:动力大厅只剩上半张图,走道与地面变纯黑硬切边)——2026-07-28 修
    // 【上边界必须落在概念图内容真正结束的那一行(2026-08-09 判真 #20)】旧值 540 是"地面线"取整,
    // 而 bg_corridor 在源图 y775→880(= world 540→615)仍有实打实的百叶格栅/控制箱/管束/红指示灯,
    // 被这块不透明填充整条盖掉 —— 直接违反 scene-fx SKILL:12「地面不画盖板:露出概念图自带的
    // 走道下机械带」。实测 world≥622 才真正纯黑,取 618 = 零损失地把 75 世界px 的机械带还回来。
    g.fillGradientStyle(0x0b0f15, 0x0b0f15, 0x04060a, 0x04060a, 1, 1, 1, 1)
    g.fillRect(0, 618, REGION_X0, L.height - 618)
    // 填充本身别留"一个值不变"的死色块(实机取景下它占屏幕底部近三成):叠一层极低 alpha 的
    // 竖向岩层纹理(复用井壁切件,0.5 原生密度),只在蜂巢概念图之下的深度,不盖分层美术
    if (this.textures.exists('dev_shaftwall')) {
      this.add.tileSprite(0, 618, REGION_X0, 620, 'dev_shaftwall')
        .setOrigin(0, 0).setTileScale(0.5, 0.5).setAlpha(0.16).setTint(0x5a6472).setDepth(0.21)
    }
    // 蜂巢井体内部:略亮的设施底色(概念图之下的兜底,防平铺缝隙露黑)
    g.fillStyle(0x121822, 1).fillRect(H.x, H.y, H.w, H.h)
    // —— 每层墙面 = 概念图横向平铺(R4 批次,参考35"低温实验层")——
    // 构造性对齐:图内走道面在图高的 WALK_R 处,所以"图顶→走道面"这段就是墙面。
    // 令这段等于本层真实墙面高度(上层楼板底 → 本层行走面),显示高度即 wall/WALK_R;
    // 图的下半(机械夹层带)自然溢出到本层行走面之下,被楼板与下一层的图盖住 = 走道下机械带的纵深。
    // 每层专属墙面(R4 批次二,参考39/35/40/41):B1行政(琥珀黄)/B2低温实验(幽绿)/B3安防(警戒红)/B4机房。
    // walkR=各图实测"走道面上沿在图高的比例"(构造性对齐,勿手调);tint 保留纵深梯度(越深越暗)
    const ceilOf = [540, 786, 1076, 1366] // 各层顶(地表地面底 / 上层楼板底)
    const LAYERS = [
      { tex: 'bg_hive_admin', walkR: 0.692, tint: 0x9aa2ae }, // B1 行政接待层(参考39,实测 614/887)
      { tex: 'bg_hive_lab', walkR: 0.699, tint: 0x8aa0a8 },   // B2 低温实验层(参考35,实测 620/887)
      { tex: 'bg_hive_sec', walkR: 0.685, tint: 0x9a94a6 },   // B3 安防警备层(参考40,实测 608/887)
      { tex: 'bg_hive_server', walkR: 0.604, tint: 0xa89390 },// B4 机房核心层(参考41,实测 536/887)
    ]
    H.floors.forEach((fy, i) => {
      const Ld = LAYERS[i]
      const tex = this.textures.exists(Ld.tex) ? Ld.tex : 'bg_hive_lab' // 缺图回落 B2 图(美术批次跟上前不露黑)
      const img = this.textures.get(tex).getSourceImage()
      const wall = fy - ceilOf[i]
      const dispH = wall / Ld.walkR
      const dispW = dispH / img.height * img.width
      this.add.tileSprite(H.x, ceilOf[i], H.w, dispH, tex)
        .setOrigin(0, 0).setTileScale(dispW / img.width, dispH / img.height)
        .setTint(Ld.tint).setDepth(0.22 + i * 0.01)
    })
    // 电梯井:井道内壁贴图(R4 批次二,参考42 竖条,可上下平铺;导轨槽/检修梯/分段面板)+暗带垫底。
    // 【主井道起点由 H.y(540)上提到 490(判真 #21)】井口切在 y470、剖面带 486-544,而井壁件
    // 从 540 才开始 → **甲板厚度段 y≈506-540 没有任何井壁件承接**,只剩一块纯色 fillRect 兜底:
    // 关井盖时井口正下方是两块零变化黑矩形(实测 63 行像素一个值不变)夹着梯柱,左右却是有百叶、
    // 有红灯的甲板剖面 —— level-devices SKILL:89 暗门 v4 定版要求剖面带[486..544]必须被承接。
    // dev_shaftwall(depth 0.3)远低于暗门件(5.28-5.62),上提不会盖住井盖/井坑/断面条。
    g.fillStyle(0x070a10, 0.55).fillRect(3120, 490, 160, 1140)
    g.fillStyle(0x070a10, 0.4).fillRect(4270, 744, 145, 886) // 副电梯井(B1↔B4)
    const swTex = this.textures.get('dev_shaftwall').getSourceImage()
    for (const [sx, sy, sw2, sh2] of [[3120, 490, 160, 1140], [4270, 744, 145, 886]]) {
      const k = (sw2 * 2) / swTex.width // 宽度贴合井道,纵向同比=不变形,上下自动重复
      this.add.tileSprite(sx + sw2 / 2, sy + sh2 / 2, sw2 * 2, sh2 * 2, 'dev_shaftwall')
        .setScale(0.5).setTileScale(k, k).setAlpha(0.85).setTint(0x8a94a2).setDepth(0.3)
    }
    // 副井口沿框(主井口由暗门井坑件负责):B1 行走面上的井口包边
    this.add.image(4270 + 145 / 2, 744, 'dev_shaft_rim').setDisplaySize(170, 29)
      .setOrigin(0.5, 0.62).setDepth(5.2)
    // 井口:口沿带(454~约496)由暗门井坑切件负责;剖面带(486~544)的收纳舱/支撑结构由
    // dev_hatch_xsec/sub 切件负责(它们落在井口 [3120,3280] **之外**,是两侧收纳舱剖面,
    // 按 v4 结构模型本就不该盖井口)——这里只垫井道断面的暗底,井壁由上面上提的 dev_shaftwall 承接
    g.fillStyle(0x04060a, 1).fillRect(3120, 490, 160, 50)
    // 井壁棱(照 _drawUnderdeck 的 pitWell):两侧各一条亮条 + 上下棱线,消掉甲板厚度段的直角硬切
    const wg2 = this.add.graphics().setDepth(0.32)
    wg2.fillStyle(0x121821, 1).fillRect(3120, 490, 9, 54)
    wg2.fillStyle(0x121821, 1).fillRect(3271, 490, 9, 54)
    wg2.lineStyle(1.5, 0x2b333d, 0.75)
    wg2.lineBetween(3129, 493, 3129, 546)
    wg2.lineBetween(3271, 493, 3271, 546)
    wg2.fillStyle(0x39424f, 0.55).fillRect(3120, 490, 160, 2)
    wg2.fillGradientStyle(0x03050a, 0x03050a, 0x03050a, 0x03050a, 0.55, 0.55, 0, 0)
    wg2.fillRect(3129, 492, 142, 22) // 井口下的背光暗化(洞就要有洞的暗)
    // B4 核心舱甲板面(ground 件不再画线,这里补内部甲板)
    g.fillStyle(0x1b2027, 1).fillRect(H.x, 1630, H.w, 10)
    g.fillStyle(0x39424f, 1).fillRect(H.x, 1630, H.w, 2.5)
    // 每层:极淡的整层色调洗(区域感)。旧"楼板下沿识别色条"被用户点名看不懂(黄绿紫红平行线),
    // 已撤;正式的楼层识别语言(标识牌/灯带/涂装)归 R4 蜂巢美术批次按元素库做进概念图
    const storeyTint = [0xd8a13a, 0x3fae9f, 0x8a7bd8, 0xff4a38]
    const tops = [H.y, 786, 1076, 1366]
    H.floors.forEach((fy, i) => {
      g.fillStyle(storeyTint[i], 0.028).fillRect(H.x, tops[i], H.w, fy - tops[i])
    })
    // 核心舱(B4):警戒红光脉动 —— 越深越危险的收束点
    const coreGlow = this.add.image(3350, 1560, 'px_glow').setTint(0xff2a1c)
      .setScale(2.6).setAlpha(0.1).setBlendMode(Phaser.BlendModes.ADD).setDepth(0.3)
    this.tweens.add({
      targets: coreGlow, alpha: { from: 0.06, to: 0.16 }, scale: { from: 2.3, to: 2.9 },
      duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    })
  }

  // 背景动效层(用户拍板"能动的都做成动态"):坐标为概念图源图像素,按 bgScale 换算到世界。
  // 全部挂在 depth 0.4~0.6(背景之上、暗角与玩法层之下),ADD 混合的辉光贴在原图元素上。
  _decorateBackdrop(bx, S, offY = 0, maxX = Infinity, flip = false) {
    // 【镜像片的坐标换算(#16 缓解的配套)】奇数片水平镜像后,源图列 sx 落在片的右半:
    // world = bx + (图宽 − sx)·S。动效层是按**源图像素坐标**定位的,不跟着换算 = 气泡浮到玻璃
    // 外面、扫描线跑到墙上 —— 与 07-28"容器不在了泡泡还在冒"同族的坐标脱钩事故
    const IW = this.textures.get('bg_corridor').getSourceImage().width
    const X = (sx) => bx + (flip ? IW - sx : sx) * S
    const Y = (sy) => sy * S + offY
    const XL = (a, b) => Math.min(X(a), X(b)) // 一对源图列对应的**世界左缘**(镜像后左右会互换)
    // 【越界守卫,2026-07-28 用户实见穿帮】最后一片平铺图延伸进新区被新图盖住,但挂在图上的
    // 动效(培养舱气泡/屏幕扫描线/灯)不知道图已被盖——"容器不在了泡泡还在冒"。
    // 任何动效元素:其右缘世界坐标超出本片图的有效区(maxX)即整个不生成
    const inside = (a, b = a) => Math.max(X(a), X(b)) <= maxX
    // 1) 培养舱 ×3:气泡从舱底上浮 + 舱内光呼吸。
    //    玻璃内壁为源图实测(逐行亮度跃变扫描),液体区 y 356..562;
    //    气泡=环形贴图+普通混合(折射不发光),横向只留极小漂移(旧版 accelerationX±9 累积漂移可达
    //    ~80px,直接从侧壁穿出玻璃——用户点名过),再用 deathZone 兜底:出玻璃即消亡
    for (const [x0, x1] of [[966, 1058], [1101, 1200], [1246, 1344]]) {
      if (!inside(x0, x1)) continue
      const glass = new Phaser.Geom.Rectangle(XL(x0 - 3, x1 + 3), Y(356), (x1 - x0 + 6) * S, (562 - 356) * S)
      this.add.particles(0, 0, 'px_bubble', {
        x: { min: XL(x0 + 16, x1 - 16), max: XL(x0 + 16, x1 - 16) + (x1 - x0 - 32) * S }, y: Y(552),
        speedY: { min: -24, max: -10 }, speedX: { min: -1.2, max: 1.2 },
        accelerationX: { min: -1.8, max: 1.8 },
        lifespan: { min: 2400, max: 4200 }, frequency: 260, quantity: 1,
        scale: { start: 0.26, end: 0.55 },
        alpha: { values: [0, 0.55, 0.45, 0] },
        deathZone: { type: 'onLeave', source: glass },
        tint: 0xd8fff0, emitting: true,
      }).setDepth(0.5)
      const glow = this.add.rectangle(glass.centerX, glass.centerY, glass.width, glass.height, 0x9fd8c8, 0.05)
        .setDepth(0.4).setBlendMode(Phaser.BlendModes.ADD)
      this.tweens.add({ targets: glow, alpha: { from: 0.03, to: 0.09 }, duration: Phaser.Math.Between(2200, 3400), yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: Math.random() * 1500 })
    }
    // 2) 全息屏:屏幕"内容"本身动起来(全部元素严格限制在屏内区,不再越界扫描)——
    //    CRT 扫描线缓慢爬行 + 数据柱状图实时跳动 + 雷达扫掠线旋转(大屏) + 亮度呼吸 + 受损瞬闪
    const screenFx = (inX0, inY0, inX1, inY1, opts = {}) => {
      if (!inside(inX0, inX1)) return
      const w = (inX1 - inX0) * S, h = (inY1 - inY0) * S
      const cx = XL(inX0, inX1) + w / 2, cy = Y(inY0) + h / 2
      const lines = this.add.tileSprite(cx, cy, w, h, 'px_scanline')
        .setAlpha(0.05).setDepth(0.5).setBlendMode(Phaser.BlendModes.ADD).setTint(0x9fe8ff)
      this.tweens.add({ targets: lines, tilePositionY: 8, duration: 1100, repeat: -1 })
      const glow = this.add.rectangle(cx, cy, w, h, 0x7fd4ff, 0.04)
        .setDepth(0.45).setBlendMode(Phaser.BlendModes.ADD)
      this.tweens.add({ targets: glow, alpha: { from: 0.02, to: 0.06 }, duration: Phaser.Math.Between(1500, 2300), yoyo: true, repeat: -1, ease: 'Sine.InOut' })
      if (opts.radar) { // 雷达扫掠线:绕画中雷达圆心转,长度略短于画中圆环半径,永不出圆
        const [rcx, rcy, rr] = opts.radar
        const sweep = this.add.rectangle(X(rcx), Y(rcy), rr * S, 1.6, 0x9fe8ff, 0.45)
          .setOrigin(0, 0.5).setDepth(0.5).setBlendMode(Phaser.BlendModes.ADD)
        this.tweens.add({ targets: sweep, angle: 360, duration: 4200, repeat: -1 })
      }
      if (opts.bars) { // 数据柱:逐根精确叠在概念图已画好的细柱上(xs=实测柱心),动画读作"柱子在涨落"
        // 旧版按区间均分 5 根宽柱,与画中柱错位叠影=用户点名的"动的很奇怪",坐标必须实测对位
        const { xs, base, maxH, w } = opts.bars
        for (const bcx of xs) {
          const b = this.add.rectangle(X(bcx), Y(base), w * S, maxH * S, 0x9adfff, 0.5)
            .setOrigin(0.5, 1).setScale(1, 0.4).setDepth(0.5).setBlendMode(Phaser.BlendModes.ADD)
          this.tweens.add({
            targets: b, scaleY: { from: 0.2 + Math.random() * 0.25, to: 0.55 + Math.random() * 0.45 },
            duration: 420 + Math.random() * 700, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: Math.random() * 500,
          })
        }
      }
      if (opts.core) { // 能量核呼吸光(右屏八角反应核):软光晕同位叠加,缓慢明暗+微缩放
        const g = this.add.image(X(opts.core[0]), Y(opts.core[1]), 'px_glow').setTint(0x8fdcff)
          .setDepth(0.5).setBlendMode(Phaser.BlendModes.ADD)
        this.tweens.add({
          targets: g, alpha: { from: 0.14, to: 0.38 }, scale: { from: 0.5, to: 0.68 },
          duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.InOut',
        })
      }
      const glitch = this.add.rectangle(cx, cy, w, h, 0xcfefff, 0)
        .setDepth(0.5).setBlendMode(Phaser.BlendModes.ADD)
      const flick = () => {
        glitch.setAlpha(0.12)
        this.time.delayedCall(50 + Math.random() * 90, () => glitch.setAlpha(0))
        this.time.delayedCall(2200 + Math.random() * 5600, flick)
      }
      this.time.delayedCall(1000 + Math.random() * 3200, flick)
    }
    // 屏区/雷达圆心/柱心均为源图实测+游戏内十字线校准的坐标(玻璃内框,特效严禁盖到边框与墙上)
    screenFx(536, 352, 747, 499, { radar: [593, 411, 30], bars: { xs: [706.5, 712.5, 718, 724.5, 729.5, 736.5], base: 491, maxH: 38, w: 4 } })
    screenFx(1452, 343, 1640, 478, { core: [1528, 425] })
    // 3) 警示红灯:双层软光(径向渐变光晕大而虚 + 小亮核),同相呼吸——不再是实心圆片
    for (const [sx, sy, r, period] of [[298, 312, 10, 1500], [117, 292, 7, 2100], [118, 430, 7, 1900], [117, 565, 7, 2300], [997, 172, 6, 1700], [1508, 172, 6, 2000]]) {
      if (!inside(sx - r, sx + r)) continue
      const d = Math.random() * period
      const halo = this.add.image(X(sx), Y(sy), 'px_glow').setTint(0xff2a1c)
        .setScale(r / 10).setAlpha(0.15).setDepth(0.5).setBlendMode(Phaser.BlendModes.ADD)
      const core = this.add.image(X(sx), Y(sy), 'px_glow').setTint(0xff7a60)
        .setScale(r / 28).setAlpha(0.4).setDepth(0.5).setBlendMode(Phaser.BlendModes.ADD)
      this.tweens.add({
        targets: halo, alpha: { from: 0.07, to: 0.3 },
        scale: { from: (r / 10) * 0.85, to: (r / 10) * 1.15 },
        duration: period, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: d,
      })
      this.tweens.add({
        targets: core, alpha: { from: 0.22, to: 0.7 },
        duration: period, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: d,
      })
    }
    // 4) 顶灯带:轻微亮度浮动;中段那根偶发"日光灯失稳"骤灭闪
    const strips = [[75, 355], [520, 800], [1360, 1640]]
    strips.forEach(([x0, x1], i) => {
      if (!inside(x0, x1)) return
      const lw = (x1 - x0) * S
      const strip = this.add.rectangle(XL(x0, x1) + lw / 2, Y(93), lw, 7, 0xdfeeff, 0.1)
        .setDepth(0.5).setBlendMode(Phaser.BlendModes.ADD)
      this.tweens.add({ targets: strip, alpha: { from: 0.06, to: 0.13 }, duration: 2600 + Math.random() * 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
      if (i === 1) {
        const stutter = () => {
          strip.setAlpha(0.0)
          this.time.delayedCall(45, () => strip.setAlpha(0.16))
          this.time.delayedCall(95, () => strip.setAlpha(0.02))
          this.time.delayedCall(160, () => strip.setAlpha(0.1))
          this.time.delayedCall(6000 + Math.random() * 9000, stutter)
        }
        this.time.delayedCall(3000 + Math.random() * 6000, stutter)
      }
    })
  }

  _hasLOS(e) {
    const x1 = e.x, y1 = e.y - 62
    const x2 = this.player.x, y2 = this.player.y - 62
    for (const s of this.solids) {
      if (s.minor) continue // junk 小件不挡视线
      const t = segVsRect(x1, y1, x2, y2, s)
      if (t !== null && t > 0.001 && t < 0.999) return false
    }
    return true
  }

  // 可推物件(R2,用户定版"轻,推着走减速很少;按物理状态动态减速"):
  // solid=刚体实时 AABB(倾翻中也所见≈所碰);贴身推=每帧给刚体增量速度(力式推动)——
  // 空地上很快到 pushSpeed 上限,一旦翻倒/压到尸体/顶到墙,接触阻力自然吃掉增量=动态减速,
  // 不需要任何专门判断。敌人只被挡不推;子弹/视线当掩体;尸体与它 Matter 互撞。
  _updatePushables(dt) {
    const M = Phaser.Physics.Matter.Matter
    const pl = this.player
    const now = this.time.now
    const LW = levelCfg.width, LH = levelCfg.height
    for (const p of this._pushables) {
      const b = p._body
      // 弹着窗口内临时加大空气阻尼:冲出去的爆发力全保留,但很快停下=看得清"被轰了一下"。
      // 玩家推动不打 _hitDrag 标记,"推着走减速很少"的定版手感不受影响
      b.frictionAir = (p._hitDrag ?? 0) > now ? 0.14 : 0.03
      // 扫掠 CCD 已搬到 _pushablesCcdStep(引擎步级,create 里挂 matter afterupdate)——
      // 渲染帧级 CCD 在掉帧/后台节流时两次检查之间物理走几十步,防不住穿隧(1fps 实测漏穿)
      // 越界兜底:万一还是被弹出关卡(极端穿隧/深叠解算),拉回最近健康位形并卸掉速度,
      // 而不是任它飞到世界外"消失"——可推物是关卡陈设,丢一件玩家就少一个掩体/道具
      if (b.position.x < -80 || b.position.x > LW + 80 || b.position.y > LH + 80 || b.position.y < -280) {
        M.Body.setPosition(b, { x: p._lastGood.x, y: p._lastGood.y })
        M.Body.setVelocity(b, { x: 0, y: 0 })
        M.Body.setAngularVelocity(b, 0)
      }
      // NaN 自愈:刚体位形一旦非有限(深叠解算/爆炸冲量的偶发产物),顶点全 NaN→AABB 退化成
      // 巨型垃圾盒→segVsRect 对全场任意弹道恒命中 t=0=敌我子弹全灭(2026-07-22 实案)。
      // 原地按最近健康位形重建刚体,下一帧恢复同步
      if (!Number.isFinite(b.position.x + b.position.y + b.angle)) {
        this.matter.world.remove(b)
        p._body = this.matter.add.rectangle(p._lastGood.x, p._lastGood.y, p._w0, p._h0,
          { friction: 0.03, frictionStatic: 0.15, frictionAir: 0.03, density: 0.0022, restitution: 0.04 })
        M.Body.setAngle(p._body, p._lastGood.a)
        continue
      }
      p._lastGood.x = b.position.x; p._lastGood.y = b.position.y; p._lastGood.a = b.angle
      // AABB 从顶点算(body.bounds 含速度扩张,推挤/抖动时盒子会凭空胀大把贴身玩家"吞"进去)
      let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9
      for (const v of b.vertices) {
        if (v.x < mnx) mnx = v.x; if (v.x > mxx) mxx = v.x
        if (v.y < mny) mny = v.y; if (v.y > mxy) mxy = v.y
      }
      p.x = mnx; p.y = mny
      p.w = mxx - mnx; p.h = mxy - mny
      if (p._spr) {
        const off = p._sprOffY ?? 0
        p._spr.setPosition(b.position.x - Math.sin(b.angle) * off, b.position.y + Math.cos(b.angle) * off)
        p._spr.setRotation(b.angle)
      }
      // junk 小件(桌面电脑等)与泄漏飞瓶不吃"贴身走位推"(人可穿行/飞瓶由喷口力独占);
      // AABB/贴图同步在上面照常跑
      if (p.minor) continue
      if (!pl.alive || !this.input2.moveX) continue
      const c = pl.capsule
      if (!(c.y < p.y + p.h && c.y + c.h > p.y)) continue
      const pushR = this.input2.moveX > 0 && Math.abs(c.x + c.w - p.x) < 5
      const pushL = this.input2.moveX < 0 && Math.abs(c.x - (p.x + p.w)) < 5
      if (pushR || pushL) {
        M.Sleeping.set(b, false)
        // 力式推动(setVelocity 在久睡初醒的刚体上 positionPrev 不按正确 delta 回写=速度只在账面,
        // 位置不走——Matter 0.19 语义坑,实测;applyForce 走引擎积分永远有效)
        const cap = p.pushSpeed ?? 4 // ≈240px/s(轻家具);json 可按件调
        if (Math.abs(b.velocity.x) < cap) {
          // ×(dt*60):Matter 每物理步清空 force 而本函数每渲染帧调一次——不归一化的话
          // 165Hz 屏上推力是 60fps 的 2.75 倍(推箱手感随显示器漂移)
          M.Body.applyForce(b, b.position, { x: this.input2.moveX * b.mass * 0.004 * (dt * 60), y: 0 })
        }
      }
    }
  }

  // 运动学移动平台:先带乘客、再挪平台,最后由玩家自身碰撞解算把脚收在新台面上
  _updatePlatforms(dt, now) {
    const M = Phaser.Physics.Matter.Matter
    for (const p of this._movers) {
      if (!p._enabled || now < p._pauseUntil) continue
      const gx = p._dir > 0 ? p._tx : p._ox
      const gy = p._dir > 0 ? p._ty : p._oy
      const dx = gx - p.x, dy = gy - p.y
      const dist = Math.hypot(dx, dy)
      const step = p.move.speed * dt
      let ndx = dx, ndy = dy // 距离不足一步=贴到端点,折返并驻留
      if (dist > step) { ndx = dx / dist * step; ndy = dy / dist * step }
      else { p._dir *= -1; p._pauseUntil = now + (p.move.pauseMs ?? 1000) }
      if (!ndx && !ndy) continue
      // 乘客判定:玩家脚底贴台顶(±2px)且横向重叠 → 跟随位移(不做水平推挤,升降梯以竖直为主)
      const pl = this.player
      if (pl.alive && pl.grounded && Math.abs(pl.y - p.y) <= 2 &&
          pl.x + 15 > p.x && pl.x - 15 < p.x + p.w) { pl.x += ndx; pl.y += ndy }
      p.x += ndx; p.y += ndy
      if (p._spr) p._spr.setPosition(p.x + p.w / 2, p.y + p.h / 2)
      if (p._body) {
        M.Body.setPosition(p._body, { x: p.x + p.w / 2, y: p.y + p.h / 2 })
        // 只唤醒"体心在台面之上"真正搭乘的尸块(入睡的或已冻结的)——梯台经过井道底部时
        // 不得吵醒躺在地面上的尸体(旧版大邻域唤醒=抽搐回归的元凶)
        for (const b of this.gibs.getBodies()) {
          if ((b.isSleeping || b.isStatic) && Math.abs(b.position.x - (p.x + p.w / 2)) < p.w / 2 + 12 &&
              b.position.y > p.y - 55 && b.position.y < p.y + 2) this.gibs.wakeRider(b)
        }
      }
    }
  }

  update(time, delta) {
    let dt = Math.min(delta / 1000, 0.05)
    const now = this.time.now
    // 微 hitstop(R3 打击感):受击/击杀瞬间极短慢放,只压玩法 dt(运动学实体+弹道),
    // Matter 尸体照常——60ms 量级,计时器(time.now)不受影响
    if (now < (this._hitstopUntil ?? 0)) dt *= gameCfg.hitFeel.hitstopScale
    // trauma 衰减与震屏驱动(衰减按真实时间,不吃 hitstop 慢放)
    if (this._trauma > 0) {
      this._trauma = Math.max(0, this._trauma - Math.min(delta / 1000, 0.05) * 1.4)
      const amp = this._trauma * this._trauma * 0.045
      if (amp > 0.0006) this.cameras.main.shake(90, amp, true)
    }
    this._updatePlatforms(dt, now)
    this._updatePushables(dt)
    for (const f of this.bigFans) f.update(dt)
    for (const v of this.vents) v.update()
    // 蜂巢封卷(拍板 D):踏入 R-A 管廊即关死回程门,基地章单向推进
    if (!this._sealedA && this.player.x > 4750) { this._sealedA = true; this.devices.closeDoor('seal1') }
    this.fluidFx.update(dt)
    this.explosives.update(dt)
    this.input2.update()
    this.player.update(dt, this.input2, this.solids)
    // E 按下沿全场唯一消费,操作台优先、电梯其次(防同帧双触发)
    const pressedE = this.input2.consumeInteract()
    let usedE = this.devices.update(dt, this.player, pressedE)
    for (const el of this.elevators) usedE = el.update(dt, this.player, pressedE && !usedE) || usedE
    this.lockdown?.update(dt, this.player)
    for (const t of this.turrets) {
      t.update(dt, this.player, this.solids, (x, y, a) => {
        this.ballistics.fire({ x, y, angle: a, weapon: this.turretWeapon, owner: 'enemy', tint: 0xffa64d })
        this.fx.muzzle(x, y, a, 0xffa64d)
        Sfx.robotShot()
      })
    }
    // 世界底安全网:任何异常把人送出世界(墙缝/井外坠落)都触发死亡重生,防"人卡没了"
    // (die 直接走重生流程,不吃血量=godMode 下同样生效)
    if (this.player.alive && this.player.y > levelCfg.height + 160) {
      // 现场取证:安全网本该永不触发(触发=有几何/解算漏洞把人送出了世界)。
      // 记下位置与最近一次落脚点,下次再出现就能直接定位,不用靠猜(2026-07-24 用户报"莫名穿到地表检查点")
      const rec = { t: Math.round(now), x: Math.round(this.player.x), y: Math.round(this.player.y),
        vx: Math.round(this.player.vx), vy: Math.round(this.player.vy),
        lastGround: this._lastGroundAt ?? null }
      ;(window.__twFalls = window.__twFalls ?? []).push(rec)
      console.warn('[世界底安全网] 玩家掉出世界并被重生', rec)
      this.player.die()
    }
    if (this.player.grounded) {
      this._lastGroundAt = { x: Math.round(this.player.x), y: Math.round(this.player.y),
        on: this.player.groundSolid ? { x: Math.round(this.player.groundSolid.x), y: Math.round(this.player.groundSolid.y),
          w: Math.round(this.player.groundSolid.w), prop: this.player.groundSolid.prop } : null }
    }
    this.camTarget.setPosition(this.player.x, this.player.y - 50)

    // 玩家武器:切枪(1-4/Q/滚轮)+按当前武器类型开火(WeaponSystem 分派)+RPG 抛射体步进
    const wsel = this.input2.consumeWeaponSelect()
    if (wsel && this.player.alive) this.weapons.handleSelect(wsel)
    if (this.input2.consumeReload() && this.player.alive) this.weapons.tryReload() // R 手动换弹
    if (this.input2.enabled && this.input2.firing && this.player.alive) this.weapons.tryFire(now)
    this.weapons.update(dt)
    this.drops.update(dt)

    // 敌人
    const robotWeapon = weaponsCfg.robot_blaster
    for (const e of this.enemies) {
      if (!e.alive) continue
      e.update(dt, this.player, this.solids, this._hasLOS(e), (en) => {
        const m = en.rig.getMuzzle()
        this.ballistics.fire({ x: m.x, y: m.y, angle: m.angle, weapon: robotWeapon, owner: 'enemy', tint: 0xffa64d })
        this.fx.muzzle(m.x, m.y, m.angle, 0xffa64d)
        Sfx.robotShot()
      })
    }

    // 弹道(炮塔与敌人同为可命中目标,鸭子类型兼容)
    this.ballistics.update(dt, {
      solids: this.solids,
      enemies: this.enemies.concat(this.turrets, this.lockdown ? this.lockdown.turrets : []),
      player: this.player,
      gibBodies: () => this.gibs.getBodies(),
      onHitWall: (p, b, solid) => {
        // 可动物体吃弹会动(用户点名):沿弹道方向施力,命中点偏离质心自然带扭矩(打得挪/打得转)。
        // **单发推力按武器分档**(weapons.json impactForce,2026-07-25 用户点名"大炮单发推力跟步枪一样"):
        // 旧版全武器共用常数 0.007=大炮与步枪字面等力,且只推得动 4px 根本看不出来。
        // 实测标定(38×34 弹药箱单发位移):0.02→11px 步枪轻推 / 0.045×7弹丸→170px 霰弹轰飞 /
        // 0.75→400px 大炮掀飞翻滚。RPG 弹体不走这里(命中即爆,推力由分层爆炸的 pushRadius 负责)
        if (solid?.pushable && solid._body) {
          const M = Phaser.Physics.Matter.Matter
          const k = b.weapon.impactForce ?? 0.007
          M.Sleeping.set(solid._body, false)
          // 一次性冲量(命中点偏心=扭矩)。**穿墙不能靠"把冲量摊到多帧"解决**——总冲量守恒,
          // 摊布只让物体慢一点到达同样的速度,峰值分毫不减(2026-07-25 实测走过的弯路);
          // 真正管用的是下面 _updatePushables 里的扫掠碰撞(CCD),它让高速物体停在墙前
          M.Body.applyForce(solid._body, { x: p.x, y: p.y }, {
            x: b.dx * solid._body.mass * k,
            y: (b.dy * 0.6 - 0.25) * solid._body.mass * k,
          })
          // 弹着后的短时高阻尼(见 _updatePushables):轻家具的低摩擦是给"玩家推着走"定版的,
          // 拿它当被打飞的模型就错了——一次大炮冲击会滑行 500px 直接滑出视野,玩家读作"打没了"
          solid._hitDrag = this.time.now + 700
        }
        // 可击破物(配电柜等):只吃玩家子弹的伤害(机器人有敌我识别,不误伤自家设施)
        if (solid?.breakable && b.owner === 'player') {
          this.devices.hitBreakable(solid.breakable, b.weapon.damage, p)
          this.fx.sparks(p.x, p.y, 4)
          Sfx.hitMetal()
        } else if (solid?.tank) {
          // 气瓶敌我子弹都引爆(炮塔乱枪打漏自家气瓶=涌现)
          this.explosives.hit(solid, b.weapon.damage, p)
          Sfx.hitMetal()
        } else {
          this.fx.sparks(p.x, p.y, 3)
          Sfx.hitWall()
        }
      },
      onHitEnemy: (enemy, p, dir, weapon) => {
        this.fx.sparks(p.x, p.y, 5)
        Sfx.hitMetal()
        enemy.takeHit(weapon.damage, dir, p, weapon)
      },
      onHitPlayer: (p, b) => { this.fx.sparks(p.x, p.y, 4); this.player.hurt(b.weapon.damage, b.x, p.y) },
      onHitGib: (body, p, dir, weapon) => this.gibs.hitGibBody(body, p, dir, weapon),
    })

    // 激光瞄准线(只被墙挡;是否配激光=当前武器说了算,RPG 无瞄准线=抛物线自己练)
    this.laserGfx.clear()
    const curW = this.weapons.current
    // 换弹中熄掉激光:枪管被压下而激光沿瞄准角画,继续亮着=光束与枪管脱节穿帮,
    // 熄灭本身也是"此刻不能开火"的清晰信号(2026-07-27 换弹动作验收发现)
    if (this.input2.enabled && this.player.alive && curW.laserSight && !this.weapons.reload) {
      const m = this.player.rig.getMuzzle()
      const dx = Math.cos(m.angle), dy = Math.sin(m.angle)
      let end = 1
      const ex = m.x + dx * curW.range, ey = m.y + dy * curW.range
      for (const s of this.solids) {
        const t = segVsRect(m.x, m.y, ex, ey, s)
        if (t !== null && t < end) end = t
      }
      const lx = m.x + dx * curW.range * end, ly = m.y + dy * curW.range * end
      this.laserGfx.lineStyle(1, 0xff4444, 0.32).lineBetween(m.x, m.y, lx, ly)
      this.laserGfx.fillStyle(0xff4444, 0.85).fillCircle(lx, ly, 2.2)
    }

    // —— R3 威胁语言:交战威胁列表 → 屏外▼标记 + 战斗烈度动态变焦 ——
    // 只算"已盯上玩家"的:交战机器人+锁定炮塔;巡逻/扫掠不算(不泄露、不拉镜头)
    const threats = []
    for (const e of this.enemies) if (e.alive && e.state === 'combat') threats.push({ x: e.x, y: e.y - 59 })
    for (const t of this.turrets.concat(this.lockdown ? this.lockdown.turrets : [])) {
      if (t.alive && t.active && t.state === 'locked') threats.push({ x: t.pivotX, y: t.pivotY })
    }
    // 动态变焦(对标入侵者2):交战=镜头拉开看清全场,平静=收近走廊沉浸;
    // 进战斗快、出战斗慢(战斗结束镜头缓缓收回=松弛感);参数在 game.json camera
    // 开始遮罩点掉后才启动(遮罩是屏幕件,开场就变焦会看着它缩放)
    if (this.input2.enabled) {
      const cc = gameCfg.camera
      const inCombat = threats.length > 0 || this.lockdown?.state === 'active'
      const cam = this.cameras.main
      cam.setZoom(Phaser.Math.Linear(cam.zoom, inCombat ? cc.combatZoom : cc.calmZoom,
        Math.min(1, (delta / 1000) * (inCombat ? cc.toCombatLerp : cc.toCalmLerp))))
    }
    // 标记在变焦之后更新:与 HUD 读同一帧的 zoom 做逆补偿(先标记后变焦=过渡帧错位一帧,审查提示)
    this.threatMarkers.update(threats, this.player)

    this.gibs.update(dt) // 尸块安定检查(静止即烘焙,防落地抽搐)
    this.hud.update(this.game.loop.actualFps, this.gibs.getBodies().length, this.ballistics.bullets.length)
  }

  // 微 hitstop:叠加取最长(击杀+受击同帧时不缩短)
  hitstop(ms) { this._hitstopUntil = Math.max(this._hitstopUntil ?? 0, this.time.now + ms) }
}
