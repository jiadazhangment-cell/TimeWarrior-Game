// 竖切片主场景:把 输入/玩家/敌人/弹道/断肢/特效/HUD 全部接线。
import Phaser from 'phaser'
import { InputState } from '../core/InputState.js'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import { Player } from '../entities/Player.js'
import { Enemy } from '../entities/Enemy.js'
import { Ballistics, segVsRect } from '../systems/Ballistics.js'
import { GibSystem } from '../systems/GibSystem.js'
import { Devices } from '../systems/Devices.js'
import { Elevator } from '../systems/Elevator.js'
import { LockdownRoom } from '../systems/LockdownRoom.js'
import { Hud } from '../ui/Hud.js'
import gameCfg from '../../config/game.json'
import levelCfg from '../../config/level_slice.json'
import weaponsCfg from '../../config/weapons.json'

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
    this.bgMeta = { scale: bgScale, offY: bgOffY, w: bgW, roomTintFrom: 2450, roomTintTo: 4505 }
    for (let bx = 0; bx < L.width; bx += bgW) {
      // 封锁房间段先用冷蓝色调区分区域感(专属实验室背景图待出,调研进行中)
      const inRoom = bx + bgW / 2 > 2450 && bx < 4505
      this.add.image(bx, bgOffY, 'bg_corridor').setOrigin(0).setScale(bgScale).setDepth(0)
        .setTint(inRoom ? 0x7e8dad : 0x9096a0)
      this._decorateBackdrop(bx, bgScale, bgOffY)
    }
    this._drawHiveBackdrop(L) // 地下蜂巢段背景(临时程序化占位,结构拍板后按元素库出分层概念图替换)
    for (const st of L.stairs ?? []) this._buildStairs(st) // 双斜梁开放式钢梯(参考23 套件拼装)
    // 房间装饰件(玻璃隔间墙/储物柜/机柜等"立于后带或贴后墙"的家具,不碰撞):
    // depth<敌人(18)与人物(20),底部接地阴影读出纵深
    for (const d of L.decor ?? []) {
      this.add.image(d.x, d.y, d.img).setOrigin(0.5, 1).setDisplaySize(d.w, d.h).setDepth(d.depth ?? 4.35)
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
      if (p.prop) {
        // 战场道具:切件贴图,碰撞盒=显示盒;dispH>h 时贴图底对齐、上部纯视觉溢出
        // (如办公桌:碰撞=桌体,桌面显示器是视觉件——站上桌站的是桌面,不是屏幕顶)
        const dh = p.dispH ?? p.h
        spr = this.add.image(p.x + p.w / 2, p.y + p.h - dh / 2, p.prop).setDisplaySize(p.w, dh).setDepth(5)
        p._sprOffY = p.h / 2 - dh / 2
      } else if (p.oneWay) {
        // 单向平台:桁架贴图只横向平铺,纵向按纹理实高一次铺满
        const th = this.textures.get('prop_platform').getSourceImage().height
        spr = this.add.tileSprite(p.x + p.w / 2, p.y + p.h / 2, p.w * 2, p.h * 2, 'prop_platform')
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
      } else if (p.partition) {
        // 舱段隔墙(门上方的墙体截面):切件贴图(参考19,分段装甲板+竖向导管+承重基座)
        spr = this.add.image(p.x + p.w / 2, p.y + p.h / 2, 'dev_wall_col').setDisplaySize(p.w, p.h).setDepth(5.4)
      } else if (p.stair) {
        // 楼梯视觉由 _buildStairs 整段拼装(踏步切件/斜梁/扶手);此处只保留 Matter 体生成
      } else {
        pg.fillStyle(0x22262c).fillRect(p.x, p.y, p.w, p.h)
        pg.fillStyle(0x3b4048).fillRect(p.x, p.y, p.w, 4)
        pg.fillStyle(0x14171b)
        for (let bx = p.x + 20; bx < p.x + p.w - 8; bx += 52) pg.fillCircle(bx, p.y + 10, 2)
      }
      // 可推物件(R2 物理世界层):动态 Matter 刚体(高摩擦/锁转动=滑不翻),solid 逐帧随体;
      // 其余一律静态体(尸体碰撞用)
      const mbody = this.matter.add.rectangle(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, p.pushable
        ? { friction: 0.9, frictionStatic: 1.1, frictionAir: 0.1, density: 0.004, inertia: Infinity }
        : { isStatic: true, friction: 0.8 })
      if (p.pushable) { p._spr = spr; p._body = mbody; this._pushables.push(p) }
      if (p.move) { p._spr = spr; p._body = mbody } // 移动平台需逐帧同步贴图与物理体(必须用贴图类平台,graphics 画的动不了)
    }
    this.matter.world.setBounds(0, -200, L.width, L.height + 200)

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
    const fx = {
      sparks: (x, y, n) => this.sparkEmitter.explode(n, x, y),
      debris: (x, y, n) => this.debrisEmitter.explode(n, x, y),
      flash: (x, y) => this.flashEmitter.explode(1, x, y),
      // 枪口焰 v2(拟真复合体,用户点名"星状太单调"):白黄亮核+多瓣火舌羽流(3变体随机选形/翻转/抖动,
      // 每发都不同=真实枪焰的混沌)+制退器十字侧刺(低透明度)+锥形飞溅火星+橙色环境光晕
      muzzle: (x, y, angle, tint = 0xffffff) => {
        const big = Math.random() < 0.18 ? 1.4 : 1 // 偶发一记大焰
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
        const halo = this.add.image(x, y, 'px_glow').setScale(0.85 * big).setTint(0xffb060)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(40).setAlpha(0.38)
        this.tweens.add({ targets: plume, alpha: 0, scaleX: plume.scaleX * 1.22, duration: 70, ease: 'Cubic.Out', onComplete: () => plume.destroy() })
        this.tweens.add({ targets: star, alpha: 0, duration: 45, onComplete: () => star.destroy() })
        this.tweens.add({ targets: core, alpha: 0, scale: 0.16, duration: 65, onComplete: () => core.destroy() })
        this.tweens.add({ targets: halo, alpha: 0, scale: 1.25 * big, duration: 100, onComplete: () => halo.destroy() })
        for (let i = 0; i < Phaser.Math.Between(3, 4); i++) { // 火星锥
          const a = angle + Phaser.Math.FloatBetween(-0.24, 0.24)
          const d = Phaser.Math.FloatBetween(34, 62)
          const s = this.add.image(x, y, 'px_spark').setScale(Phaser.Math.FloatBetween(0.4, 0.75))
            .setTint(0xffd27a).setBlendMode(Phaser.BlendModes.ADD).setDepth(41)
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
    this.enemies = L.enemies.map((e) => new Enemy(this, e))
    this.ballistics = new Ballistics(this)
    this.gibs = new GibSystem(this, fx)
    this.elevators = (L.elevators ?? []).map((e) => new Elevator(this, e)) // 载人电梯(呼叫+选层)
    this.hud = new Hud(this, gameCfg.showDebugHud)
    this.turretWeapon = weaponsCfg.wall_turret
    this.lockdown = L.lockdown ? new LockdownRoom(this, L.lockdown) : null
    this.laserGfx = this.add.graphics().setDepth(29)
    this.nextShotAt = 0
    this.playerCorpse = null

    // —— 摄像机 ——
    this.camTarget = this.add.rectangle(this.player.x, this.player.y, 2, 2, 0, 0)
    this.cameras.main.setBounds(0, 0, L.width, L.height)
    this.cameras.main.startFollow(this.camTarget, true, 0.12, 0.12)

    // —— 事件接线 ——
    this._onEnemyDied = ({ snapshot, dir, weapon }) => {
      this.gibs.spawnRagdoll(snapshot, {
        impulse: dir, dismemberable: true, killWeapon: weapon,
      })
      EventBus.emit('camera:shake', 0.005)
    }
    this._onPlayerDied = ({ snapshot }) => {
      this.playerCorpse = this.gibs.spawnRagdoll(snapshot, { dismemberable: false, impulse: { x: 0, y: -0.5 } })
      this.time.delayedCall(1400, () => {
        if (this.playerCorpse) { this.gibs.removeCorpse(this.playerCorpse); this.playerCorpse = null }
        this.player.respawn(this.respawnPoint.x, this.respawnPoint.y) // 重生于最近检查点
      })
    }
    this._onShake = (v) => this.cameras.main.shake(90, v)
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

  // 地下蜂巢段背景 —— 临时程序化占位(仅撑结构试玩;专属分层概念图待结构拍板后出图切换)。
  // 视觉语言:地表以下整幅暗填充(越深越暗=危险梯度)、井体内部设施底色+面板分缝、
  // 每层一条功能识别色条(元素库#46 中性基底+色条)、升降井/楼梯井竖向暗带、核心舱红光脉动。
  _drawHiveBackdrop(L) {
    const H = L.hive
    if (!H) return
    const g = this.add.graphics().setDepth(0.2)
    // 地表以下整幅岩土暗填充(盖住走廊概念图残余),向深处渐暗
    g.fillGradientStyle(0x0b0f15, 0x0b0f15, 0x04060a, 0x04060a, 1, 1, 1, 1)
    g.fillRect(0, 540, L.width, L.height - 540)
    // 蜂巢井体内部:略亮的设施底色
    g.fillStyle(0x121822, 1).fillRect(H.x, H.y, H.w, H.h)
    // 大幅墙面板分缝
    g.lineStyle(1, 0x1c2430, 0.75)
    for (let x = H.x + 88; x < H.x + H.w; x += 176) g.lineBetween(x, H.y, x, H.y + H.h)
    // 电梯井:竖向暗带(读作贯层竖井);井口在走道带上开出可见的洞(暗门 hatch_qz 盖其上)
    g.fillStyle(0x070a10, 0.55).fillRect(3120, H.y, 160, 1090)
    g.fillStyle(0x070a10, 0.4).fillRect(4270, 744, 145, 886) // 副电梯井(B1↔B4)
    // 井口:口沿带(454~约496)由暗门井坑切件负责;剖面带(486~544)的收纳舱/支撑结构由
    // dev_hatch_xsec/sub 切件负责——这里只垫井道断面的暗底(两侧棱线由切件边缘接手)
    g.fillStyle(0x04060a, 1).fillRect(3120, 490, 160, 50)
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
  _decorateBackdrop(bx, S, offY = 0) {
    const X = (sx) => bx + sx * S, Y = (sy) => sy * S + offY
    // 1) 培养舱 ×3:气泡从舱底上浮 + 舱内光呼吸。
    //    玻璃内壁为源图实测(逐行亮度跃变扫描),液体区 y 356..562;
    //    气泡=环形贴图+普通混合(折射不发光),横向只留极小漂移(旧版 accelerationX±9 累积漂移可达
    //    ~80px,直接从侧壁穿出玻璃——用户点名过),再用 deathZone 兜底:出玻璃即消亡
    for (const [x0, x1] of [[966, 1058], [1101, 1200], [1246, 1344]]) {
      const glass = new Phaser.Geom.Rectangle(X(x0 - 3), Y(356), (x1 - x0 + 6) * S, (562 - 356) * S)
      this.add.particles(0, 0, 'px_bubble', {
        x: { min: X(x0 + 16), max: X(x1 - 16) }, y: Y(552),
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
      const w = (inX1 - inX0) * S, h = (inY1 - inY0) * S
      const cx = X(inX0) + w / 2, cy = Y(inY0) + h / 2
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
      const lw = (x1 - x0) * S
      const strip = this.add.rectangle(X(x0) + lw / 2, Y(93), lw, 7, 0xdfeeff, 0.1)
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
      const t = segVsRect(x1, y1, x2, y2, s)
      if (t !== null && t > 0.001 && t < 0.999) return false
    }
    return true
  }

  // 可推物件(R2 首件,用户点名"有些物件可以推动"):solid 逐帧随动态刚体;
  // 玩家侧面贴身且朝它走=给刚体一个慢速推移(重物手感),撞墙/撞别的箱子由 Matter 自然挡住。
  // 敌人只会被它挡(折返),不会推;子弹/视线把它当掩体;尸体与它 Matter 互撞。
  _updatePushables() {
    const M = Phaser.Physics.Matter.Matter
    const pl = this.player
    for (const p of this._pushables) {
      const b = p._body
      p.x = b.position.x - p.w / 2
      p.y = b.position.y - p.h / 2
      if (p._spr) p._spr.setPosition(b.position.x, b.position.y + (p._sprOffY ?? 0))
      if (!pl.alive || !this.input2.moveX) continue
      const c = pl.capsule
      if (!(c.y < p.y + p.h && c.y + c.h > p.y)) continue
      const pushR = this.input2.moveX > 0 && Math.abs(c.x + c.w - p.x) < 3
      const pushL = this.input2.moveX < 0 && Math.abs(c.x - (p.x + p.w)) < 3
      if (pushR || pushL) {
        M.Sleeping.set(b, false)
        M.Body.setVelocity(b, { x: this.input2.moveX * 0.8, y: b.velocity.y }) // ≈48px/s 推重物
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
    const dt = Math.min(delta / 1000, 0.05)
    const now = this.time.now
    this._updatePlatforms(dt, now)
    this._updatePushables()
    this.input2.update()
    this.player.update(dt, this.input2, this.solids)
    // E 按下沿全场唯一消费,操作台优先、电梯其次(防同帧双触发)
    const pressedE = this.input2.consumeInteract()
    let usedE = this.devices.update(dt, this.player, pressedE)
    for (const el of this.elevators) usedE = el.update(dt, this.player, pressedE && !usedE) || usedE
    this.lockdown?.update(dt, this.player)
    this.camTarget.setPosition(this.player.x, this.player.y - 50)

    // 玩家开火
    const rifle = weaponsCfg.rifle
    if (this.input2.enabled && this.input2.firing && this.player.alive && now >= this.nextShotAt) {
      this.nextShotAt = now + rifle.fireIntervalMs
      const m = this.player.rig.getMuzzle()
      this.ballistics.fire({ x: m.x, y: m.y, angle: m.angle, weapon: rifle, owner: 'player' })
      this.fx.muzzle(m.x, m.y, m.angle)
      Sfx.shot()
    }

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
      enemies: this.lockdown ? this.enemies.concat(this.lockdown.turrets) : this.enemies,
      player: this.player,
      gibBodies: () => this.gibs.getBodies(),
      onHitWall: (p, b, solid) => {
        // 可击破物(配电柜等):只吃玩家子弹的伤害(机器人有敌我识别,不误伤自家设施)
        if (solid?.breakable && b.owner === 'player') {
          this.devices.hitBreakable(solid.breakable, b.weapon.damage, p)
          this.fx.sparks(p.x, p.y, 4)
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
      onHitPlayer: (p, b) => { this.fx.sparks(p.x, p.y, 4); this.player.hurt(b.weapon.damage, b.x) },
      onHitGib: (body, p, dir, weapon) => this.gibs.hitGibBody(body, p, dir, weapon),
    })

    // 激光瞄准线(只被墙挡)
    this.laserGfx.clear()
    if (this.input2.enabled && this.player.alive && rifle.laserSight) {
      const m = this.player.rig.getMuzzle()
      const dx = Math.cos(m.angle), dy = Math.sin(m.angle)
      let end = 1
      const ex = m.x + dx * rifle.range, ey = m.y + dy * rifle.range
      for (const s of this.solids) {
        const t = segVsRect(m.x, m.y, ex, ey, s)
        if (t !== null && t < end) end = t
      }
      const lx = m.x + dx * rifle.range * end, ly = m.y + dy * rifle.range * end
      this.laserGfx.lineStyle(1, 0xff4444, 0.32).lineBetween(m.x, m.y, lx, ly)
      this.laserGfx.fillStyle(0xff4444, 0.85).fillCircle(lx, ly, 2.2)
    }

    this.gibs.update() // 尸块安定检查(静止即强制入睡,防落地抽搐)
    this.hud.update(this.game.loop.actualFps, this.gibs.getBodies().length, this.ballistics.bullets.length)
  }
}
