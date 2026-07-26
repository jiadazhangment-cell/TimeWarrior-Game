// 玩家多武器系统(阵容=2026-07-13 拍板:步枪→霰弹枪→火箭筒→手持超级大炮,伤害递增):
// 槽位与切枪(1-4 直选 / Q与滚轮循环)、开火按武器类型分派(hitscan/shotgun/rocket/cannon)、
// RPG 抛射体全生命周期。参数全在 weapons.json;armgun 贴图变体在 rigs.json player.armguns
// (换枪=换整图,见 CharacterRig.swapWeapon;新枪切件未到位时回落基础贴图=弹道先行,美术批次跟上)。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import weaponsCfg from '../../config/weapons.json'
import rigsCfg from '../../config/rigs.json'
import gameCfg from '../../config/game.json'
import { segVsRect } from './Ballistics.js'

export class WeaponSystem {
  constructor(scene) {
    this.scene = scene
    // 槽位=weapons.json 里带 slot 字段的条目(敌方武器无 slot 不入列)
    this.slots = Object.keys(weaponsCfg).filter((k) => weaponsCfg[k].slot)
      .sort((a, b) => weaponsCfg[a].slot - weaponsCfg[b].slot)
    // 试玩态全解锁(game.json allWeapons);正式流程=步枪起手,其余拾取/节点解锁(归内容线)
    this.owned = new Set(gameCfg.allWeapons ? this.slots : ['rifle'])
    this.index = 0
    this.nextShotAt = 0
    this.rockets = []
  }

  get key() { return this.slots[this.index] }
  get current() { return weaponsCfg[this.key] }

  // HUD 初始播报(Hud 构造晚于本系统,create 末尾调一次)
  announce() {
    EventBus.emit('weapon:changed', { key: this.key, name: this.current.name, slots: this.ownedList() })
  }

  ownedList() {
    return this.slots.map((k) => ({ key: k, slot: weaponsCfg[k].slot, name: weaponsCfg[k].name, owned: this.owned.has(k) }))
  }

  // sel: 1..4=直选槽位;-1=下一把;-2=上一把(滚轮双向,Q=下一把)
  handleSelect(sel) {
    if (!sel) return
    let idx = this.index
    if (sel > 0) {
      const k = this.slots[sel - 1]
      if (!k || !this.owned.has(k) || sel - 1 === this.index) return
      idx = sel - 1
    } else {
      const dir = sel === -1 ? 1 : -1
      for (let i = 1; i < this.slots.length; i++) {
        const j = (this.index + dir * i + this.slots.length * i) % this.slots.length
        if (this.owned.has(this.slots[j])) { idx = j; break }
      }
      if (idx === this.index) return
    }
    this.index = idx
    this.scene.player.rig.swapWeapon(rigsCfg.player.armguns?.[this.key])
    Sfx.weaponSwitch()
    this.announce()
  }

  unlock(key) { // 拾取/剧情解锁入口(内容线用)
    if (!this.slots.includes(key) || this.owned.has(key)) return
    this.owned.add(key)
    this.announce()
  }

  tryFire(now) {
    if (now < this.nextShotAt) return
    const s = this.scene
    const w = this.current
    this.nextShotAt = now + w.fireIntervalMs
    const m = s.player.rig.getMuzzle()
    // 后座(In2 手感语法):重武器把人往后推一把;竖直分量减弱防"朝地开枪当火箭跳"失控
    if (w.recoil) {
      s.player.vx -= Math.cos(m.angle) * w.recoil
      s.player.vy -= Math.sin(m.angle) * w.recoil * 0.3
    }
    if (w.type === 'shotgun') {
      // 霰弹=同帧 N 发独立弹丸,各自在 ±spreadDeg 内随机(Ballistics.fire 内置散布)
      for (let i = 0; i < (w.pellets ?? 6); i++) {
        s.ballistics.fire({ x: m.x, y: m.y, angle: m.angle, weapon: w, owner: 'player' })
      }
      Sfx.shotgunShot()
    } else if (w.type === 'rocket') {
      this._spawnRocket(m, w)
      Sfx.rocketLaunch()
    } else if (w.type === 'cannon') {
      s.ballistics.fire({ x: m.x, y: m.y, angle: m.angle, weapon: w, owner: 'player', tint: 0xbfe9ff })
      Sfx.cannonShot()
      EventBus.emit('camera:shake', 0.006)
    } else {
      s.ballistics.fire({ x: m.x, y: m.y, angle: m.angle, weapon: w, owner: 'player' })
      Sfx.shot()
    }
    s.fx.muzzle(m.x, m.y, m.angle, 0xffffff, w.muzzleScale ?? 1)
  }

  // —— RPG 抛射体:慢速+轻微下坠+尾焰,命中(实体/敌人/玩家外一切可撞物)即爆 ——
  _spawnRocket(m, w) {
    const s = this.scene
    const spread = Phaser.Math.DegToRad(w.spreadDeg) * (Math.random() - 0.5) * 2
    const a = m.angle + spread
    const body = s.add.container(m.x, m.y).setDepth(31)
    // 弹体=细长深色壳+头锥暖光+尾喷口(程序件,R4 美术批次换切件)
    const g = s.add.graphics()
    g.fillStyle(0x2a2e34, 1).fillRoundedRect(-9, -2.5, 18, 5, 2)
    g.fillStyle(0x14171b, 1).fillRect(-9, -1, 4, 2)
    body.add(g)
    const tip = s.add.image(8, 0, 'px_glow').setTint(0xffb060).setScale(0.16)
      .setBlendMode(Phaser.BlendModes.ADD)
    body.add(tip)
    this.rockets.push({
      x: m.x, y: m.y,
      vx: Math.cos(a) * w.projectileSpeed, vy: Math.sin(a) * w.projectileSpeed,
      w, body, traveled: 0, smokeAcc: 0,
    })
  }

  update(dt) {
    const s = this.scene
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]
      r.vy += r.w.projectileGravity * dt // 轻微下坠=中远距要抬枪,火箭筒的操作纵深
      const step = Math.hypot(r.vx, r.vy) * dt
      const x2 = r.x + r.vx * dt, y2 = r.y + r.vy * dt
      // 命中检测:扫掠线段 vs 实体(oneWay 与弹道同口径=挡;minor junk 不挡)/敌人/炮塔
      let hit = null, bestT = 1
      for (const o of s.solids) {
        if (o.minor) continue
        const t = segVsRect(r.x, r.y, x2, y2, o)
        if (t !== null && t < bestT) { bestT = t; hit = { kind: 'wall', target: o } }
      }
      const targets = s.lockdown ? s.enemies.concat(s.lockdown.turrets) : s.enemies
      for (const e of targets) {
        if (!e.alive) continue
        const t = segVsRect(r.x, r.y, x2, y2, e.capsule)
        if (t !== null && t < bestT) { bestT = t; hit = { kind: 'enemy', target: e } }
      }
      if (hit) {
        const hx = r.x + (x2 - r.x) * bestT, hy = r.y + (y2 - r.y) * bestT
        if (hit.kind === 'enemy') { // 直击伤害(爆炸伤害另算)
          hit.target.takeHit(r.w.damage, { x: r.vx / (Math.hypot(r.vx, r.vy) || 1), y: -0.3 }, { x: hx, y: hy }, r.w)
        } else if (hit.target.tank) {
          s.explosives.hit(hit.target, 99, { x: hx, y: hy }) // 直击气瓶=引爆链
        }
        this._detonate(r, hx, hy)
        this.rockets.splice(i, 1)
        continue
      }
      r.x = x2; r.y = y2
      r.traveled += step
      r.body.setPosition(r.x, r.y).setRotation(Math.atan2(r.vy, r.vx))
      // 尾焰+烟迹
      if (Math.random() < 0.9) {
        const back = Math.atan2(r.vy, r.vx) + Math.PI
        s.emberEmitter.explode(1, r.x + Math.cos(back) * 10, r.y + Math.sin(back) * 10)
      }
      r.smokeAcc += dt
      if (r.smokeAcc > 0.05) {
        r.smokeAcc = 0
        const sm = s.add.image(r.x, r.y, 'px_smoke' + Phaser.Math.Between(0, 1)).setDepth(30)
          .setAlpha(0.3).setScale(0.12).setTint(0xa39a8e)
        s.tweens.add({ targets: sm, alpha: 0, scale: 0.42, duration: 460, ease: 'Sine.Out', onComplete: () => sm.destroy() })
      }
      if (r.traveled > r.w.range) { this._detonate(r, r.x, r.y); this.rockets.splice(i, 1) }
    }
  }

  _detonate(r, x, y) {
    const s = this.scene
    r.body.destroy()
    // 贴地判定与气瓶爆同口径(火不入地);爆炸档案=通用径向场(遮挡/连锁/场景反馈全复用)
    let groundY = null
    for (const o of s.solids) {
      if (o.minor || x < o.x || x > o.x + o.w) continue
      if (o.y >= y - 6 && o.y < y + 200 && (groundY == null || o.y < groundY)) groundY = o.y
    }
    s.fx.explosion(x, y, 0.9, groundY)
    s.fx.debris(x, y, 10)
    s.explosives.applyBlast(x, y, {
      r: r.w.blastRadius, dmgEnemy: r.w.blastDamageEnemy, dmgPlayer: r.w.blastDamagePlayer, weapon: r.w,
    })
  }
}
