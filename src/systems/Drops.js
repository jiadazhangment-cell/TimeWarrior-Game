// 掉落经济(2026-07-27 用户定版):击杀必掉 1 种弹药 + 34% 概率另掉血包(补 28% 最大生命)。
// 弹药类型按 weapons.json ammoDropWeight 加权(步枪最高→反射→霰弹→RPG→大炮最低,用户原文阶梯),
// 每个弹药包补对应武器 30% 备弹上限(ammoPickup,已在配置折好数)。
// 拾取物=真实落地小物件:出生小抛物线→落地一弹→静置漂浮;玩家靠近磁吸,碰到即拾取。
// 手写小物理(不进 Matter:拾取物不需要与尸体/家具互撞,segVsRect 查地即可,与抛壳件同款)。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import weaponsCfg from '../../config/weapons.json'
import dropsCfg from '../../config/drops.json'

export class Drops {
  constructor(scene) {
    this.scene = scene
    this.items = [] // { kind:'health'|'ammo', key?, spr, glow, x, y, vx, vy, rest, bobT }
    // 弹药加权表(只取玩家槽位枪)
    this._ammoPool = Object.keys(weaponsCfg)
      .filter((k) => weaponsCfg[k].slot && weaponsCfg[k].ammoDropWeight)
      .map((k) => ({ k, w: weaponsCfg[k].ammoDropWeight }))
    this._onEnemyDied = ({ snapshot }) => {
      const p = snapshot?.find?.((q) => q.name === 'torso') ?? snapshot?.[0]
      if (p) this.spawnFor(p.x, p.y - 8)
    }
    this._onTurretDown = (spec) => { if (spec?.x != null) this.spawnFor(spec.x, spec.y ?? 0) }
    EventBus.on('enemy:died', this._onEnemyDied)
    EventBus.on('turret:destroyed', this._onTurretDown)
    scene.events.once('shutdown', () => {
      EventBus.off('enemy:died', this._onEnemyDied)
      EventBus.off('turret:destroyed', this._onTurretDown)
    })
  }

  // 一敌至多一弹药一血包(用户定版)
  spawnFor(x, y) {
    let r = Math.random() * this._ammoPool.reduce((s, e) => s + e.w, 0)
    let key = this._ammoPool[0].k
    for (const e of this._ammoPool) { r -= e.w; if (r <= 0) { key = e.k; break } }
    this._spawn('ammo', x, y, key)
    if (Math.random() < dropsCfg.healthDropChance) this._spawn('health', x, y)
  }

  // 关卡预置补给(level json 的 pickups):不走击杀抛物线,原地下落到脚下实体上待取。
  // fixed 标记=不参与 FIFO 淘汰——预置补给是关卡内容,不能被一场混战掉的弹药挤没
  place(kind, x, y, key) {
    const it = this._spawn(kind, x, y, key)
    if (!it) return null
    it.vx = 0; it.vy = 0; it.bounced = true; it.fixed = true
    return it
  }

  _spawn(kind, x, y, key) {
    const s = this.scene
    const tex = kind === 'health' ? 'pk_health' : `pk_ammo_${key}`
    if (!s.textures.exists(tex)) return null // 美术批次未到位时静默跳过,防 404 贴图上屏
    const tint = kind === 'health' ? 0x7dff9a
      : parseInt(weaponsCfg[key].tracerTint ?? '0xffffff')
    const glow = s.add.image(x, y, 'px_glow').setTint(tint).setScale(0.32).setAlpha(0.4)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(12.9)
    const spr = s.add.image(x, y, tex).setScale(0.5).setDepth(13) // 切件 2x 贴图,世界显示 0.5(全库约定)
    const it = {
      kind, key, spr, glow, x, y,
      vx: Phaser.Math.FloatBetween(-dropsCfg.popVx, dropsCfg.popVx),
      vy: dropsCfg.popVy + Phaser.Math.FloatBetween(-40, 40),
      rest: false, bounced: false, bobT: Math.random() * 6,
    }
    this.items.push(it)
    while (this.items.length > dropsCfg.maxDrops) { // FIFO 防堆积(预置补给 fixed 不淘汰)
      const i = this.items.findIndex((q) => !q.fixed)
      if (i < 0) break
      const old = this.items.splice(i, 1)[0]
      old.spr.destroy(); old.glow.destroy()
    }
    return it
  }

  update(dt) {
    const s = this.scene
    const pl = s.player
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      const dx = pl.x - it.x, dy = (pl.y - 44) - it.y
      const dist = Math.hypot(dx, dy)
      // 磁吸:玩家进入半径即向人加速飞(静置或空中都吸)
      if (pl.alive && dist < dropsCfg.magnetRadius) {
        it.rest = false
        it.vx += (dx / (dist || 1)) * dropsCfg.magnetAccel * dt
        it.vy += (dy / (dist || 1)) * dropsCfg.magnetAccel * dt
        // 磁吸限速,防越飞越快绕圈打转
        const sp = Math.hypot(it.vx, it.vy)
        if (sp > 520) { it.vx *= 520 / sp; it.vy *= 520 / sp }
      } else if (it.rest) {
        // 支撑复核(重审确认):静置在可推物/电梯顶/门上时支撑会移动或消失——
        // 支撑还在=跟随其位移(搭电梯/箱子被推着走),支撑没了(炸掉/开门/摘除)=恢复落体
        const o = it.support
        if (!o || !s.solids.includes(o)) { it.rest = false; it.bounced = true; it.support = null }
        else {
          it.x = o.x + it.supportDx
          it.y = o.y - 7
          it.bobT += dt
          it.spr.setPosition(it.x, it.y + Math.sin(it.bobT * 3) * 1.6)
          it.glow.setPosition(it.x, it.y + Math.sin(it.bobT * 3) * 1.6)
            .setAlpha(0.3 + 0.14 * Math.sin(it.bobT * 4))
          if (this._tryPickup(it, dist)) { this.items.splice(i, 1) }
          continue
        }
      }
      it.vy += dropsCfg.gravity * dt
      const py = it.y
      it.x += it.vx * dt; it.y += it.vy * dt
      if (it.vy > 0) { // 从上方落到实体顶面
        for (const o of s.solids) {
          if (o.minor || it.x < o.x || it.x > o.x + o.w || py > o.y || it.y < o.y) continue
          it.y = o.y - 7
          if (!it.bounced) { it.bounced = true; it.vy *= -dropsCfg.bounce; it.vx *= 0.6 }
          else { it.rest = true; it.vx = 0; it.vy = 0; it.support = o; it.supportDx = it.x - o.x } // 记支撑锚
          break
        }
      }
      it.spr.setPosition(it.x, it.y)
      it.glow.setPosition(it.x, it.y)
      if (this._tryPickup(it, dist)) { this.items.splice(i, 1); continue }
      if (it.y > s.cameras.main.getBounds().bottom + 200) { // 掉出世界兜底
        it.spr.destroy(); it.glow.destroy(); this.items.splice(i, 1)
      }
    }
  }

  _tryPickup(it, dist) {
    if (!this.scene.player.alive || dist > 26) return false
    const s = this.scene
    if (it.kind === 'health') {
      const heal = Math.round(s.player.cfg.hp * dropsCfg.healPercent)
      s.player.hp = Math.min(s.player.cfg.hp, s.player.hp + heal)
      EventBus.emit('player:hurt', s.player.hp) // HP 条复用受击事件刷新
      this._toast(it.x, it.y, `+${heal}`, 0x7dff9a)
      Sfx.heal()
    } else {
      const w = weaponsCfg[it.key]
      const a = s.weapons.ammo[it.key]
      a.reserve = Math.min(w.reserveMax, a.reserve + w.ammoPickup)
      s.weapons._emitAmmo()
      this._toast(it.x, it.y, `${w.name} +${w.ammoPickup}`, parseInt(w.tracerTint ?? '0xffffff'))
      Sfx.pickup()
    }
    it.spr.destroy(); it.glow.destroy()
    return true
  }

  _toast(x, y, text, tint) {
    const t = this.scene.add.text(x, y - 14, text, {
      fontFamily: 'monospace', fontSize: '11px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(60).setTint(tint)
    this.scene.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 700, ease: 'Sine.Out', onComplete: () => t.destroy() })
  }
}
