import { EventBus } from '../core/EventBus.js'
import playerCfg from '../../config/player.json'

export class Hud {
  constructor(scene, showDebug) {
    this.scene = scene
    this.kills = 0

    // 动态变焦(R3)后 HUD 逆补偿:scrollFactor(0) 只免滚动不免变焦——镜头 zoom 会把
    // 屏幕件从画面中心向外推(HP 条被推出屏)。全部 HUD 挂进 root 容器,每帧按 1/zoom
    // 反向缩放+回位,HUD 恒定钉在屏幕坐标;子元素加入顺序即层序(容器内 depth 无效):
    // 先受击红闪(垫底)→条/文字→toast(顶层)
    this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(90)
    const mk = (obj) => { this.root.add(obj); return obj }
    // 方向性受击红闪(R3 打击感):火从哪边来,哪边屏缘泛红——横向渐变贴片,平时全透明
    if (!scene.textures.exists('hud_hurt_edge')) {
      const ct = scene.textures.createCanvas('hud_hurt_edge', 64, 8)
      const cx = ct.getContext()
      const gr = cx.createLinearGradient(0, 0, 64, 0)
      gr.addColorStop(0, 'rgba(255,42,28,0.9)')
      gr.addColorStop(1, 'rgba(255,42,28,0)')
      cx.fillStyle = gr
      cx.fillRect(0, 0, 64, 8)
      ct.refresh()
    }
    this.hurtEdgeL = mk(scene.add.image(0, 270, 'hud_hurt_edge').setOrigin(0, 0.5)
      .setDisplaySize(170, 540).setAlpha(0))
    this.hurtEdgeR = mk(scene.add.image(960, 270, 'hud_hurt_edge').setOrigin(1, 0.5)
      .setDisplaySize(170, 540).setFlipX(true).setAlpha(0))
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
    this._onHurt = (hp) => {
      const w = Math.max(0, this.hpMax * hp / playerCfg.hp)
      // 伤害残影:掉血段先留一截白条再收走(读得出"这一下掉了多少")
      if (w < this.hpBar.width) {
        const ghost = this.root.add(scene.add.rectangle(26 + w, 22, this.hpBar.width - w, 12, 0xffffff, 0.9)
          .setOrigin(0, 0.5)).last
        scene.tweens.add({ targets: ghost, width: 0, alpha: 0, duration: 380, ease: 'Cubic.In', onComplete: () => ghost.destroy() })
      }
      this.hpBar.width = w
    }
    this._onHitFx = ({ side }) => { // side: -1=左缘 / 1=右缘
      const img = side < 0 ? this.hurtEdgeL : this.hurtEdgeR
      scene.tweens.killTweensOf(img)
      img.setAlpha(0.6)
      scene.tweens.add({ targets: img, alpha: 0, duration: 340, ease: 'Quad.Out' })
    }
    this._onKill = () => this.killText.setText(`击毁: ${++this.kills}`)
    EventBus.on('player:hurt', this._onHurt)
    EventBus.on('player:hitfx', this._onHitFx)
    EventBus.on('enemy:died', this._onKill)
    EventBus.on('checkpoint:reached', this._onCheckpoint)
    EventBus.on('lockdown:status', this._onStatus)
    EventBus.on('lockdown:done', this._onLockdownDone)
    scene.events.once('shutdown', () => {
      EventBus.off('player:hurt', this._onHurt)
      EventBus.off('player:hitfx', this._onHitFx)
      EventBus.off('enemy:died', this._onKill)
      EventBus.off('checkpoint:reached', this._onCheckpoint)
      EventBus.off('lockdown:status', this._onStatus)
      EventBus.off('lockdown:done', this._onLockdownDone)
    })
  }

  update(fps, bodies, bullets) {
    this.fpsText.setText(`FPS ${Math.round(fps)}`)
    if (this.debugText) this.debugText.setText(`bodies ${bodies} bullets ${bullets}`)
    // 逆变焦补偿:HUD 恒钉屏幕(变焦缩放以屏心为原点,反缩放后把原点偏移补回来)
    const z = this.scene.cameras.main.zoom
    if (Math.abs(z - (this._lastZ ?? 0)) > 1e-4) {
      this._lastZ = z
      this.root.setScale(1 / z).setPosition(480 * (1 - 1 / z), 270 * (1 - 1 / z))
    }
  }
}
