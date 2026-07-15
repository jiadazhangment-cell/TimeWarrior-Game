import { EventBus } from '../core/EventBus.js'
import playerCfg from '../../config/player.json'

export class Hud {
  constructor(scene, showDebug) {
    this.scene = scene
    this.kills = 0

    const mk = (obj) => obj.setScrollFactor(0).setDepth(90)
    mk(scene.add.rectangle(24, 22, 184, 16, 0x0c0e12, 0.8).setOrigin(0, 0.5))
    this.hpBar = mk(scene.add.rectangle(26, 22, 180, 12, 0x35b5ff).setOrigin(0, 0.5))
    this.hpMax = 180
    mk(scene.add.text(214, 22, 'HP', { fontFamily: 'sans-serif', fontSize: '12px', color: '#8fa3b8' }).setOrigin(0, 0.5))

    this.killText = mk(scene.add.text(24, 44, '击毁: 0', { fontFamily: 'sans-serif', fontSize: '14px', color: '#cfd8e3' }))
    this.fpsText = mk(scene.add.text(936, 14, '', { fontFamily: 'monospace', fontSize: '13px', color: '#7fff9e' }).setOrigin(1, 0))
    this.debugText = showDebug
      ? mk(scene.add.text(936, 32, '', { fontFamily: 'monospace', fontSize: '11px', color: '#68788c' }).setOrigin(1, 0))
      : null
    mk(scene.add.text(24, 516, 'A/D 移动 · W/空格 跳跃 · S 下蹲/起立 · E 交互 · 鼠标瞄准 · 左键射击', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#93a1b3',
    }).setOrigin(0, 0.5))

    // 居中 toast(检查点等一次性提示):淡入停留淡出
    this.toast = mk(scene.add.text(480, 96, '', { fontFamily: 'sans-serif', fontSize: '16px', color: '#9fffc0' }).setOrigin(0.5).setAlpha(0))
    // 封锁状态条(常驻直到清除)
    this.statusText = mk(scene.add.text(480, 66, '', { fontFamily: 'sans-serif', fontSize: '15px', color: '#ffb3a6', backgroundColor: '#160b0b', padding: { x: 8, y: 4 } }).setOrigin(0.5).setVisible(false))
    this._onStatus = (text) => {
      if (text) this.statusText.setText(text).setVisible(true)
      else this.statusText.setVisible(false)
    }
    this._onLockdownDone = () => {
      this.toast.setText('✓ 封锁解除').setAlpha(0)
      scene.tweens.add({ targets: this.toast, alpha: 1, duration: 200, yoyo: true, hold: 1300 })
    }
    this._onCheckpoint = () => {
      this.toast.setText('✓ 检查点已记录').setAlpha(0)
      scene.tweens.add({ targets: this.toast, alpha: 1, duration: 200, yoyo: true, hold: 1300 })
    }
    this._onHurt = (hp) => this.hpBar.width = Math.max(0, this.hpMax * hp / playerCfg.hp)
    this._onKill = () => this.killText.setText(`击毁: ${++this.kills}`)
    EventBus.on('player:hurt', this._onHurt)
    EventBus.on('enemy:died', this._onKill)
    EventBus.on('checkpoint:reached', this._onCheckpoint)
    EventBus.on('lockdown:status', this._onStatus)
    EventBus.on('lockdown:done', this._onLockdownDone)
    scene.events.once('shutdown', () => {
      EventBus.off('player:hurt', this._onHurt)
      EventBus.off('enemy:died', this._onKill)
      EventBus.off('checkpoint:reached', this._onCheckpoint)
      EventBus.off('lockdown:status', this._onStatus)
      EventBus.off('lockdown:done', this._onLockdownDone)
    })
  }

  update(fps, bodies, bullets) {
    this.fpsText.setText(`FPS ${Math.round(fps)}`)
    if (this.debugText) this.debugText.setText(`bodies ${bodies} bullets ${bullets}`)
  }
}
