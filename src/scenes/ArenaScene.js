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
    }
    const vg = this.add.graphics().setDepth(1)
    vg.fillGradientStyle(0x05070a, 0x05070a, 0x05070a, 0x05070a, 0.75, 0.75, 0, 0)
    vg.fillRect(0, 0, L.width, 130)
    vg.fillGradientStyle(0x05070a, 0x05070a, 0x05070a, 0x05070a, 0, 0, 0.45, 0.45)
    vg.fillRect(0, L.height - 80, L.width, 80)

    // —— 平台绘制 + Matter 静态体(给尸体/断肢用) ——
    const pg = this.add.graphics().setDepth(5)
    for (const p of this.solids) {
      if (p.prop) {
        // 战场道具:切件贴图,碰撞盒=显示盒(母本已裁到内容紧贴)
        this.add.image(p.x + p.w / 2, p.y + p.h / 2, p.prop).setDisplaySize(p.w, p.h).setDepth(5)
      } else if (p.oneWay) {
        // 单向平台:桁架贴图只横向平铺,纵向按纹理实高一次铺满
        const th = this.textures.get('prop_platform').getSourceImage().height
        this.add.tileSprite(p.x + p.w / 2, p.y + p.h / 2, p.w * 2, p.h * 2, 'prop_platform')
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
      this.matter.add.rectangle(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, { isStatic: true, friction: 0.8 })
    }
    this.matter.world.setBounds(0, -200, L.width, L.height + 200)

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
    this.flashEmitter = this.add.particles(0, 0, 'px_flash', {
      speed: 0, lifespan: 90, scale: { start: 1.3, end: 0.2 }, alpha: { start: 0.9, end: 0 },
      blendMode: 'ADD', tint: 0xbfe9ff, emitting: false,
    }).setDepth(41)
    const fx = {
      sparks: (x, y, n) => this.sparkEmitter.explode(n, x, y),
      debris: (x, y, n) => this.debrisEmitter.explode(n, x, y),
      flash: (x, y) => this.flashEmitter.explode(1, x, y),
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

  _hasLOS(e) {
    const x1 = e.x, y1 = e.y - 62
    const x2 = this.player.x, y2 = this.player.y - 62
    for (const s of this.solids) {
      const t = segVsRect(x1, y1, x2, y2, s)
      if (t !== null && t > 0.001 && t < 0.999) return false
    }
    return true
  }

  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05)
    const now = this.time.now
    this.input2.update()
    this.player.update(dt, this.input2, this.solids)
    this.camTarget.setPosition(this.player.x, this.player.y - 50)

    // 玩家开火
    const rifle = weaponsCfg.rifle
    if (this.input2.enabled && this.input2.firing && this.player.alive && now >= this.nextShotAt) {
      this.nextShotAt = now + rifle.fireIntervalMs
      const m = this.player.rig.getMuzzle()
      this.ballistics.fire({ x: m.x, y: m.y, angle: m.angle, weapon: rifle, owner: 'player' })
      this.fx.flash(m.x, m.y)
      Sfx.shot()
    }

    // 敌人
    const robotWeapon = weaponsCfg.robot_blaster
    for (const e of this.enemies) {
      if (!e.alive) continue
      e.update(dt, this.player, this.solids, this._hasLOS(e), (en) => {
        const m = en.rig.getMuzzle()
        this.ballistics.fire({ x: m.x, y: m.y, angle: m.angle, weapon: robotWeapon, owner: 'enemy', tint: 0xffa64d })
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
