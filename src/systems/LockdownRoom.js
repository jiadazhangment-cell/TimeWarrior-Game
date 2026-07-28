// 封锁房间战控制器(数据驱动,level json 的 lockdown 配置)。
// 敌人预置化定版(用户点名"敌人不要凭空出现"):蜂巢守军=level enemies 里 hive:true 的常驻
// 巡逻机器人,从进关那一刻就都在各自楼层里——本控制器不再刷兵,只管事件:
// 玩家越过触发线 → 双门锁死+红光警报 → 全歼蜂巢守军=解锁操作台 → 按 E 开双门+警报解除
// +存活炮塔断电。炮塔是常驻哨戒(Turret 自带红光视线,进关即工作,与封锁状态无关)。
// 封锁中死亡=开门重挂(守军是常驻单位,已击杀的保持死亡,不重置)。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import { Turret } from '../entities/Turret.js'

export class LockdownRoom {
  constructor(scene, cfg) {
    this.scene = scene
    this.cfg = cfg
    this.state = 'armed' // armed → active → cleared → done
    this._lastStatus = null
    // 蜂巢守军=预置的 hive 标记敌人(在 ArenaScene 创建 enemies 之后构造本控制器)
    this.garrison = scene.enemies.filter((e) => e.spec.hive)
    this.turrets = (cfg.turrets ?? []).map((t) => new Turret(scene, t))
    // 警报覆层:屏幕空间红光脉动(封锁氛围三件套之一:红光/警报音/HUD状态)
    // 尺寸放大到 1200×700:动态变焦(R3)拉远到 0.97 时 960×540 会四边露黑缝,
    // 全屏色罩超采无副作用,不参与 HUD 的逆变焦补偿
    this.alarm = scene.add.rectangle(480, 270, 1200, 700, 0xff2018, 0)
      .setScrollFactor(0).setDepth(80).setBlendMode(Phaser.BlendModes.ADD)
    this._alarmTween = null
    this._siren = null
    // cleared 阶段死亡同样要开门重挂:此时 doorIn 仍关、炮塔仍上电,重生点全在门外——
    // 只处理 active 会造成"清完守军被炮塔打死→永锁门外"的软锁(godMode 关闭后必现)
    this._onPlayerDied = () => { if (this.state === 'active' || this.state === 'cleared') this._reset() }
    this._onEvent = (name) => { if (name === 'lockdown:' + cfg.id && this.state === 'cleared') this._finish() }
    EventBus.on('player:died', this._onPlayerDied)
    EventBus.on('devices:event', this._onEvent)
    scene.events.once('shutdown', () => {
      EventBus.off('player:died', this._onPlayerDied)
      EventBus.off('devices:event', this._onEvent)
    })
  }

  update(dt, player) {
    // 触发:triggerY=下潜越深线即封锁(垂直蜂巢用,门在头顶关闭=承诺感);否则按 triggerX 越线窗。
    // triggerY 必须叠 x 界(默认=井体范围):基地章扩图后 R-B 下沉大厅 y700>600,
    // 无 x 界会在千里之外误触发蜂巢封锁(2026-07-28 灰盒实测踩中)
    const xr = this.cfg.triggerXRange ?? [2600, 4460]
    const tripped = this.cfg.triggerY != null
      ? (player.y > this.cfg.triggerY && player.x > xr[0] && player.x < xr[1])
      : (player.x > this.cfg.triggerX && player.x < this.cfg.triggerX + 420)
    if (this.state === 'armed' && player.alive && tripped) {
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
      const remaining = this.garrison.reduce((n, e) => n + (e.alive ? 1 : 0), 0)
      this._status(`⚠ 封锁中 · 残敌 ${remaining}`)
      if (remaining === 0) this._cleared()
    }
  }

  _status(text) {
    if (text === this._lastStatus) return
    this._lastStatus = text
    EventBus.emit('lockdown:status', text)
  }

  _engage() {
    this.state = 'active'
    this.scene.devices.closeDoor(this.cfg.doorIn)
    // 警报:红光脉动 + 双音循环
    this._alarmTween = this.scene.tweens.add({
      targets: this.alarm, alpha: { from: 0.03, to: 0.085 },
      duration: 620, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    })
    Sfx.siren()
    this._siren = this.scene.time.addEvent({ delay: 1700, loop: true, callback: () => Sfx.siren() })
  }

  _cleared() {
    this.state = 'cleared'
    this._status(this.cfg.clearedHint ?? '✓ 威胁清除 · 到操作台解除封锁')
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
    // 封锁中死亡:开门+重新挂起(防重生被锁死)。守军是常驻单位:已击杀的保持死亡,
    // 存活的原地继续巡逻——重进房间从上次战果接着打
    this.state = 'armed'
    this._stopAlarm()
    this.scene.devices.openDoor(this.cfg.doorIn)
    this._status(null)
  }

  _stopAlarm() {
    if (this._alarmTween) { this._alarmTween.stop(); this._alarmTween = null }
    this.alarm.setAlpha(0)
    if (this._siren) { this._siren.remove(); this._siren = null }
  }
}
