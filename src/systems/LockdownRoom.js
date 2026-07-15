// 封锁房间战控制器(数据驱动,level json 的 lockdown 配置):
// 玩家越过触发线 → 双门锁死+红光警报+炮塔上电 → 波次刷兵(刷入点闪光预告,清完隔 1.3s 下一波)
// → 全部肃清=解锁顶层操作台 → 按 E 开双门+警报解除+存活炮塔断电。
// 封锁中死亡=房间整体重置(刷出敌人清除/门重开/波次归零),防止检查点复活后被锁死在门外。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import { Enemy } from '../entities/Enemy.js'
import { Turret } from '../entities/Turret.js'

export class LockdownRoom {
  constructor(scene, cfg) {
    this.scene = scene
    this.cfg = cfg
    this.state = 'armed' // armed → active → cleared → done
    this.waveIdx = -1
    this.spawned = []
    this._pending = 0 // 已预告未落地的刷入数(260ms 预告窗内 spawned 为空,不加这个会误判清场)
    this._nextWaveQueued = false
    this._lastStatus = null
    this.turrets = (cfg.turrets ?? []).map((t) => new Turret(scene, t))
    // 警报覆层:屏幕空间红光脉动(封锁氛围三件套之一:红光/警报音/HUD状态)
    this.alarm = scene.add.rectangle(480, 270, 960, 540, 0xff2018, 0)
      .setScrollFactor(0).setDepth(80).setBlendMode(Phaser.BlendModes.ADD)
    this._alarmTween = null
    this._siren = null
    this._onPlayerDied = () => { if (this.state === 'active') this._reset() }
    this._onEvent = (name) => { if (name === 'lockdown:' + cfg.id && this.state === 'cleared') this._finish() }
    EventBus.on('player:died', this._onPlayerDied)
    EventBus.on('devices:event', this._onEvent)
    scene.events.once('shutdown', () => {
      EventBus.off('player:died', this._onPlayerDied)
      EventBus.off('devices:event', this._onEvent)
    })
  }

  update(dt, player) {
    if (this.state === 'armed' && player.alive &&
        player.x > this.cfg.triggerX && player.x < this.cfg.triggerX + 420) {
      this._engage()
    }
    for (const t of this.turrets) {
      t.update(dt, player, this.scene.solids, (x, y, a) => {
        this.scene.ballistics.fire({ x, y, angle: a, weapon: this.scene.turretWeapon, owner: 'enemy', tint: 0xffa64d })
        this.scene.fx.muzzle(x, y, a, 0xffa64d)
        Sfx.robotShot()
      })
    }
    if (this.state === 'active') {
      const remaining = this.spawned.reduce((n, e) => n + (e.alive ? 1 : 0), 0) + this._pending
      this._status(`⚠ 封锁中 · 第 ${this.waveIdx + 1}/${this.cfg.waves.length} 波 · 残敌 ${remaining}`)
      if (remaining === 0 && !this._nextWaveQueued) {
        if (this.waveIdx + 1 < this.cfg.waves.length) {
          this._nextWaveQueued = true
          this.scene.time.delayedCall(1300, () => {
            this._nextWaveQueued = false
            if (this.state === 'active') this._spawnWave(this.waveIdx + 1)
          })
        } else {
          this._cleared()
        }
      }
    }
  }

  _status(text) {
    if (text === this._lastStatus) return
    this._lastStatus = text
    EventBus.emit('lockdown:status', text)
  }

  _engage() {
    this.state = 'active'
    const dv = this.scene.devices
    dv.closeDoor(this.cfg.doorIn)
    // 警报:红光脉动 + 双音循环
    this._alarmTween = this.scene.tweens.add({
      targets: this.alarm, alpha: { from: 0.03, to: 0.085 },
      duration: 620, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    })
    Sfx.siren()
    this._siren = this.scene.time.addEvent({ delay: 1700, loop: true, callback: () => Sfx.siren() })
    for (const t of this.turrets) t.setActive(true)
    this._spawnWave(0)
  }

  _spawnWave(i) {
    this.waveIdx = i
    for (const spec of this.cfg.waves[i].spawns) {
      // 刷入预告:落点闪光+电火花,260ms 后实体出现(公平性:波次必须预告)
      this._pending++
      this.scene.fx.flash(spec.x, spec.y - 44)
      this.scene.fx.sparks(spec.x, spec.y - 44, 6)
      this.scene.time.delayedCall(260, () => {
        this._pending--
        if (this.state !== 'active') return
        const e = new Enemy(this.scene, spec)
        this.scene.enemies.push(e)
        this.spawned.push(e)
      })
    }
    Sfx.warp()
  }

  _cleared() {
    this.state = 'cleared'
    this._status('✓ 威胁清除 · 到顶层操作台解除封锁')
    this.scene.devices.unlockConsole(this.cfg.console)
    Sfx.checkpoint()
  }

  _finish() {
    this.state = 'done'
    this._stopAlarm()
    const dv = this.scene.devices
    dv.openDoor(this.cfg.doorIn)
    dv.openDoor(this.cfg.doorOut)
    for (const t of this.turrets) t.powerDown()
    this._status(null)
    EventBus.emit('lockdown:done')
  }

  _reset() {
    // 清除本房间刷出的敌人(存活的静默移除,不走死亡管线);门重开、警报停、波次归零、触发重新武装
    for (const e of this.spawned) {
      if (e.alive) { e.alive = false; e.rig.destroy() }
    }
    this.scene.enemies = this.scene.enemies.filter((e) => !this.spawned.includes(e))
    this.spawned = []
    this.waveIdx = -1
    this._nextWaveQueued = false
    this.state = 'armed'
    this._stopAlarm()
    this.scene.devices.openDoor(this.cfg.doorIn)
    for (const t of this.turrets) t.setActive(false)
    this._status(null)
  }

  _stopAlarm() {
    if (this._alarmTween) { this._alarmTween.stop(); this._alarmTween = null }
    this.alarm.setAlpha(0)
    if (this._siren) { this._siren.remove(); this._siren = null }
  }
}
