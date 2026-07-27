import { EventBus } from '../core/EventBus.js'
import playerCfg from '../../config/player.json'
import rigsCfg from '../../config/rigs.json'
import weaponsCfg from '../../config/weapons.json'

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
    // 武器条(多武器系统):槽位纵列图标——armgun 贴图直用(与游戏内美术同源,文字条已退役);
    // 当前枪=亮底+金框,未解锁=暗色剪影;槽右=备弹计数(2026-07-27 弹药经济定版,推翻同日"无限")
    this.weaponSlots = []
    for (let i = 0; i < 5; i++) {
      const y = 74 + i * 30
      const bg = mk(scene.add.rectangle(24, y, 130, 27, 0x0c0e12, 0.62).setOrigin(0, 0.5))
      const num = mk(scene.add.text(31, y, String(i + 1), { fontFamily: 'monospace', fontSize: '12px', color: '#5a6470' }).setOrigin(0.5))
      const icon = mk(scene.add.image(70, y, '__DEFAULT').setVisible(false))
      const ammo = mk(scene.add.text(148, y, '', { fontFamily: 'monospace', fontSize: '10px', color: '#8fa3b8' }).setOrigin(1, 0.5))
      this.weaponSlots.push({ bg, num, icon, ammo })
    }
    // 当前枪大弹药计数(左下,帮助行上方)+ 换弹进度条
    this.ammoBig = mk(scene.add.text(24, 490, '', { fontFamily: 'monospace', fontSize: '22px', color: '#e8eef4' }).setOrigin(0, 0.5))
    this.reloadBarBg = mk(scene.add.rectangle(24, 474, 120, 4, 0x0c0e12, 0.8).setOrigin(0, 0.5).setVisible(false))
    this.reloadBar = mk(scene.add.rectangle(24, 474, 0, 4, 0xffd27a).setOrigin(0, 0.5).setVisible(false))
    this._slotKeys = []
    this._onAmmo = ({ key, all }) => {
      this._ammoAll = all
      this._slotKeys.forEach((k, i) => {
        const ws = this.weaponSlots[i]
        const w2 = k && all[k]
        if (!ws || !w2) return
        ws.ammo.setText(this._fmtAmmo(k, w2))
        ws.ammo.setColor(w2.mag <= 0 && w2.reserve <= 0 ? '#ff6a5a' : '#8fa3b8')
      })
      if (key === this._curKey) this._refreshBig()
    }
    this._onReload = ({ key, t }) => {
      const going = t < 1 && key === this._curKey
      this.reloadBarBg.setVisible(going)
      this.reloadBar.setVisible(going).width = 120 * t
      if (t >= 1) this._refreshBig()
    }
    this._onAmmoEmpty = () => { // 空仓:大计数抖一下变红
      this.ammoBig.setColor('#ff6a5a')
      this.scene.tweens.add({ targets: this.ammoBig, x: { from: 28, to: 24 }, duration: 60, yoyo: true, repeat: 1 })
    }
    EventBus.on('ammo:changed', this._onAmmo)
    EventBus.on('weapon:reload', this._onReload)
    EventBus.on('ammo:empty', this._onAmmoEmpty)
    this._onWeapon = ({ key, slots }) => {
      this._curKey = key
      this._slotKeys = slots.map((s2) => s2.key)
      this.reloadBarBg.setVisible(false); this.reloadBar.setVisible(false) // 切枪打断换弹
      if (this._ammoAll) this._onAmmo({ key, all: this._ammoAll })
      slots.forEach((s2, i) => {
        const ws = this.weaponSlots[i]
        if (!ws) return
        const tex = rigsCfg.player.armguns?.[s2.key]?.tex
        const cur = s2.key === key
        // 无切件贴图的新枪(美术批次未到)只缺图标,槽框高亮/槽号照常——否则选中第5槽零反馈
        if (tex) {
          if (ws.icon.texture.key !== tex) {
            ws.icon.setTexture(tex)
            // 等比缩进槽内(枪长短悬殊:步枪 67×35 ~ 大炮 113×62)
            ws.icon.setScale(Math.min(60 / ws.icon.width, 21 / ws.icon.height))
          }
          ws.icon.setVisible(true)
        }
        if (cur) {
          ws.bg.setFillStyle(0x1a212c, 0.85).setStrokeStyle(1.5, 0xffd27a, 0.9)
          ws.num.setColor('#ffd27a')
          ws.icon.clearTint().setAlpha(1)
        } else if (s2.owned) {
          ws.bg.setFillStyle(0x0c0e12, 0.62).setStrokeStyle(1, 0x2a323e, 0.8)
          ws.num.setColor('#8fa3b8')
          ws.icon.clearTint().setAlpha(0.88)
        } else {
          ws.bg.setFillStyle(0x0c0e12, 0.5).setStrokeStyle(1, 0x1a1f27, 0.6)
          ws.num.setColor('#3c4450')
          ws.icon.setTintFill(0x232a34).setAlpha(0.65)
        }
      })
    }
    EventBus.on('weapon:changed', this._onWeapon)
    this.fpsText = mk(scene.add.text(936, 14, '', { fontFamily: 'monospace', fontSize: '13px', color: '#7fff9e' }).setOrigin(1, 0))
    this.debugText = showDebug
      ? mk(scene.add.text(936, 32, '', { fontFamily: 'monospace', fontSize: '11px', color: '#68788c' }).setOrigin(1, 0))
      : null
    mk(scene.add.text(24, 516, 'A/D 移动 · W/空格 跳跃 · S 下蹲/起立 · E 交互 · 鼠标瞄准 · 左键射击 · R 换弹 · 1-5/Q/滚轮 切枪', {
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
      EventBus.off('weapon:changed', this._onWeapon)
      EventBus.off('enemy:died', this._onKill)
      EventBus.off('checkpoint:reached', this._onCheckpoint)
      EventBus.off('lockdown:status', this._onStatus)
      EventBus.off('lockdown:done', this._onLockdownDone)
      EventBus.off('ammo:changed', this._onAmmo)
      EventBus.off('weapon:reload', this._onReload)
      EventBus.off('ammo:empty', this._onAmmoEmpty)
    })
  }

  _fmtAmmo(key, a) {
    return weaponsCfg[key]?.noReload ? `${a.reserve}` : `${a.mag}/${a.reserve}`
  }

  _refreshBig() {
    const a = this._ammoAll?.[this._curKey]
    const w = weaponsCfg[this._curKey]
    if (!a || !w) return
    this.ammoBig.setText(w.noReload ? `弹药 ${a.reserve}` : `${a.mag} / ${a.reserve}`)
    const low = w.noReload ? a.reserve <= 1 : (a.mag + a.reserve) <= (w.magSize + w.reserveMax) * 0.15
    this.ammoBig.setColor(a.mag <= 0 && a.reserve <= 0 ? '#ff6a5a' : low ? '#ffd27a' : '#e8eef4')
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
