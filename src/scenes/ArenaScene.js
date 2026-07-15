// 竖切片主场景:把 输入/玩家/敌人/弹道/断肢/特效/HUD 全部接线。
import Phaser from 'phaser'
import { InputState } from '../core/InputState.js'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import { Player } from '../entities/Player.js'
import { Enemy } from '../entities/Enemy.js'
import { Ballistics, segVsRect } from '../systems/Ballistics.js'
import { GibSystem } from '../systems/GibSystem.js'
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

    // —— 背景:基地走廊概念图(地板线对齐地面顶),压暗让前景角色读得清 + 上下暗角 ——
    const bgTex = this.textures.get('bg_corridor').getSourceImage()
    const bgScale = 470 / 655 // 概念图内走道面在 y≈655,对齐游戏地面 470
    const bgW = bgTex.width * bgScale
    for (let bx = 0; bx < L.width; bx += bgW) {
      this.add.image(bx, 0, 'bg_corridor').setOrigin(0).setScale(bgScale).setDepth(0).setTint(0x9096a0)
      this._decorateBackdrop(bx, bgScale)
    }
    const vg = this.add.graphics().setDepth(1)
    vg.fillGradientStyle(0x05070a, 0x05070a, 0x05070a, 0x05070a, 0.75, 0.75, 0, 0)
    vg.fillRect(0, 0, L.width, 130)
    vg.fillGradientStyle(0x05070a, 0x05070a, 0x05070a, 0x05070a, 0, 0, 0.45, 0.45)
    vg.fillRect(0, L.height - 80, L.width, 80)

    // —— 平台绘制 + Matter 静态体(给尸体/断肢用) ——
    const pg = this.add.graphics().setDepth(5)
    for (const p of this.solids) {
      let spr = null
      if (p.prop) {
        // 战场道具:切件贴图,碰撞盒=显示盒(母本已裁到内容紧贴)
        spr = this.add.image(p.x + p.w / 2, p.y + p.h / 2, p.prop).setDisplaySize(p.w, p.h).setDepth(5)
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
        // 地面:不画盖板,露出概念图自带的"走道下机械带";只描一条走道沿口亮线
        pg.fillStyle(0x3b4048).fillRect(p.x, p.y, p.w, 3)
      } else {
        pg.fillStyle(0x22262c).fillRect(p.x, p.y, p.w, p.h)
        pg.fillStyle(0x3b4048).fillRect(p.x, p.y, p.w, 4)
        pg.fillStyle(0x14171b)
        for (let bx = p.x + 20; bx < p.x + p.w - 8; bx += 52) pg.fillCircle(bx, p.y + 10, 2)
      }
      const mbody = this.matter.add.rectangle(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, { isStatic: true, friction: 0.8 })
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

    // —— 系统与实体 ——
    this.input2 = new InputState(this)
    this.player = new Player(this, L.playerSpawn.x, L.playerSpawn.y)
    this.enemies = L.enemies.map((e) => new Enemy(this, e))
    this.ballistics = new Ballistics(this)
    this.gibs = new GibSystem(this, fx)
    this.hud = new Hud(this, gameCfg.showDebugHud)
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
        this.player.respawn(L.playerSpawn.x, L.playerSpawn.y)
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
      }
    }
  }

  // 背景动效层(用户拍板"能动的都做成动态"):坐标为概念图源图像素,按 bgScale 换算到世界。
  // 全部挂在 depth 0.4~0.6(背景之上、暗角与玩法层之下),ADD 混合的辉光贴在原图元素上。
  _decorateBackdrop(bx, S) {
    const X = (sx) => bx + sx * S, Y = (sy) => sy * S
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

  // 运动学移动平台:先带乘客、再挪平台,最后由玩家自身碰撞解算把脚收在新台面上
  _updatePlatforms(dt, now) {
    const M = Phaser.Physics.Matter.Matter
    for (const p of this._movers) {
      if (now < p._pauseUntil) continue
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
        // Matter 静态体位移不会唤醒接触物:唤醒平台邻域内入睡的尸块,免得尸体悬空
        for (const b of this.gibs.getBodies()) {
          if (b.isSleeping && Math.abs(b.position.x - (p.x + p.w / 2)) < p.w / 2 + 40 &&
              Math.abs(b.position.y - p.y) < 90) M.Sleeping.set(b, false)
        }
      }
    }
  }

  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05)
    const now = this.time.now
    this._updatePlatforms(dt, now)
    this.input2.update()
    this.player.update(dt, this.input2, this.solids)
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

    // 弹道
    this.ballistics.update(dt, {
      solids: this.solids,
      enemies: this.enemies,
      player: this.player,
      gibBodies: () => this.gibs.getBodies(),
      onHitWall: (p) => { this.fx.sparks(p.x, p.y, 3); Sfx.hitWall() },
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

    this.hud.update(this.game.loop.actualFps, this.gibs.getBodies().length, this.ballistics.bullets.length)
  }
}
