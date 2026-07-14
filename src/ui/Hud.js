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
    mk(scene.add.text(24, 516, 'A/D 移动 · W/空格 跳跃 · S 下蹲 · 鼠标瞄准 · 左键射击', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#93a1b3',
    }).setOrigin(0, 0.5))

    this._onHurt = (hp) => this.hpBar.width = Math.max(0, this.hpMax * hp / playerCfg.hp)
    this._onKill = () => this.killText.setText(`击毁: ${++this.kills}`)
    EventBus.on('player:hurt', this._onHurt)
    EventBus.on('enemy:died', this._onKill)
    scene.events.once('shutdown', () => {
      EventBus.off('player:hurt', this._onHurt)
      EventBus.off('enemy:died', this._onKill)
    })
  }

  update(fps, bodies, bullets) {
    this.fpsText.setText(`FPS ${Math.round(fps)}`)
    if (this.debugText) this.debugText.setText(`bodies ${bodies} bullets ${bullets}`)
  }
}
