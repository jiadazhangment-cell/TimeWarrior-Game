// 载人电梯系统(真实电梯语义,用户定版):厢体停靠楼层待命;各层"呼叫终端"召唤;
// 厢内按 E 循环选层、短暂停顿后发车直达;两侧开放进出(侧视游戏,无厢门)。
// 平台=solids 条目(oneWay),运动学移动+先带乘客后挪厢(与移动平台同一碰撞原则)。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'

const COMMIT_MS = 900 // 最后一次按键后这么久发车(现实电梯的"关门等待")
const SPEED = 150

export class Elevator {
  constructor(scene, cfg) {
    this.scene = scene
    this.cfg = cfg
    this.floorIdx = cfg.start
    this.state = 'idle' // idle(停靠) | moving(运行)
    this.target = cfg.start
    this.sel = null // 厢内已选未发车的目标层
    this._commitAt = 0
    this.enabled = !cfg.afterDoor // 挂在井口暗门后的梯:暗门未开不运行
    this.solid = { x: cfg.x, y: cfg.floors[cfg.start], w: cfg.w, h: 16, oneWay: true, elevator: cfg.id }
    scene.solids.push(this.solid)
    this._buildCab()
    this._buildCalls()
    // 厢顶提示标签(选层/运行状态)
    this.label = scene.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#bfe9ff',
      backgroundColor: '#0c141a', padding: { x: 5, y: 3 },
    }).setOrigin(0.5, 1).setDepth(45).setAlpha(0)
    if (cfg.afterDoor) {
      this._onDoor = (id) => {
        if (id !== cfg.afterDoor || this.enabled) return
        this.enabled = true
        this._go(0) // 井盖开启即召厢上来=开盖见梯的仪式感
      }
      EventBus.on('door:opened', this._onDoor)
      scene.events.once('shutdown', () => EventBus.off('door:opened', this._onDoor))
    }
  }

  // —— 厢体visual:切件贴图(参考21 电梯厢),踏板面对齐停靠面;楼层灯叠在画中灯列上 ——
  _buildCab() {
    const s = this.scene
    const w = this.cfg.w, hw = w / 2
    // 井道齿轨:沿井道竖向平铺,画在厢体之后
    if (s.textures.exists('dev_rail')) {
      const topY = this.cfg.floors[0] + 16
      const botY = this.cfg.floors[this.cfg.floors.length - 1] + 26
      const railTex = s.textures.get('dev_rail').getSourceImage()
      s.add.tileSprite(this.solid.x + hw, (topY + botY) / 2, 30 / 0.333, botY - topY, 'dev_rail')
        .setTileScale(0.333, 0.333).setScale(0.333, 1).setDepth(0.35).setAlpha(0.95)
    }
    this.cab = s.add.container(this.solid.x + hw, this.solid.y).setDepth(6.2)
    let dispW = w + 30, dispH = 130
    if (s.textures.exists('dev_cab')) {
      const tex = s.textures.get('dev_cab').getSourceImage()
      const scale = dispW / tex.width
      dispH = tex.height * scale
      // 踏板走行面在图高约 13%(自图底):贴图下沉让踏板面=停靠面,前裙沿灯带垂在平台下
      const img = s.add.image(0, dispH * 0.13, 'dev_cab').setOrigin(0.5, 1).setScale(scale)
      this.cab.add(img)
    } else {
      const gb = s.add.graphics()
      gb.fillStyle(0x151a22, 0.92).fillRect(-hw + 2, -110, w - 4, 110)
      gb.fillStyle(0x232a34, 1).fillRect(-hw - 8, -120, w + 16, 10)
      this.cab.add(gb)
    }
    // 楼层灯列:叠在画中按钮面板灯位上——当前层绿、目标层琥珀闪、其余暗
    this.lamps = []
    const n = this.cfg.floors.length
    const lampX = -dispW * 0.145
    const lampY0 = -dispH * 0.36, step = dispH * 0.055
    for (let i = 0; i < n; i++) {
      const lamp = s.add.image(lampX, lampY0 + (n - 1 - i) * step, 'px_glow').setScale(0.07).setAlpha(0.25)
        .setTint(0x8fa3b8).setBlendMode(Phaser.BlendModes.ADD)
      this.cab.add(lamp)
      this.lamps.push(lamp)
    }
    this._lampTick = 0
  }

  _buildCalls() {
    const s = this.scene
    this.calls = []
    for (const c of this.cfg.calls ?? []) {
      const fy = this.cfg.floors[c.floor] + 16 // 停靠面(floor-16)对应的楼层地面
      // 呼叫面板(参考21 切件):壁挂在齐胸高,不落地
      const hasPanel = s.textures.exists('dev_callpanel')
      const spr = s.add.image(c.x, hasPanel ? fy - 26 : fy, hasPanel ? 'dev_callpanel' : 'dev_console')
        .setOrigin(0.5, 1).setDepth(4.8)
      if (!hasPanel) spr.setScale(0.62)
      const glow = s.add.image(c.x, fy - (hasPanel ? 43 : 34), 'px_glow').setTint(0x7fd4ff)
        .setScale(0.26).setAlpha(0.28).setBlendMode(Phaser.BlendModes.ADD).setDepth(4.9)
      s.tweens.add({ targets: glow, alpha: { from: 0.18, to: 0.38 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
      const label = s.add.text(c.x, fy - 58, '', {
        fontFamily: 'sans-serif', fontSize: '12px', color: '#bfe9ff',
        backgroundColor: '#0c141a', padding: { x: 5, y: 3 },
      }).setOrigin(0.5, 1).setDepth(45).setAlpha(0)
      this.calls.push({ def: c, spr, label })
    }
  }

  _name(i) { return this.cfg.names?.[i] ?? `${i}` }

  _go(idx) {
    if (idx === this.floorIdx && this.state === 'idle') return
    this.target = idx
    this.sel = null
    if (this.state !== 'moving') { this.state = 'moving'; Sfx.door() }
  }

  playerInside(player) {
    return player.alive && player.grounded &&
      Math.abs(player.y - this.solid.y) <= 2 &&
      player.x > this.solid.x + 6 && player.x < this.solid.x + this.solid.w - 6
  }

  // 返回是否消费了本帧的 E(与操作台共享按键,场景层做优先级)
  update(dt, player, pressed) {
    const s = this.scene
    const p = this.solid
    let used = false
    // —— 运动:向目标层匀速,精确停层 ——
    if (this.state === 'moving' && this.enabled) {
      const gy = this.cfg.floors[this.target]
      const dy = gy - p.y
      const step = SPEED * dt
      let ndy = Math.abs(dy) <= step ? dy : Math.sign(dy) * step
      // 先带乘客后挪厢(乘客判定与移动平台一致)
      if (player.alive && player.grounded && Math.abs(player.y - p.y) <= 2 &&
          player.x + 15 > p.x && player.x - 15 < p.x + p.w) player.y += ndy
      p.y += ndy
      if (Math.abs(gy - p.y) < 0.001) {
        p.y = gy
        this.state = 'idle'
        this.floorIdx = this.target
        Sfx.checkpoint() // 到站"叮"
      }
      // 唤醒厢内搭乘的尸块
      for (const b of s.gibs.getBodies()) {
        if ((b.isSleeping || b.isStatic) && Math.abs(b.position.x - (p.x + p.w / 2)) < p.w / 2 + 12 &&
            b.position.y > p.y - 55 && b.position.y < p.y + 2) s.gibs.wakeRider(b)
      }
    }
    this.cab.setPosition(p.x + p.w / 2, p.y)

    // —— 厢内选层 ——
    const inside = this.playerInside(player)
    if (inside && this.enabled && this.state === 'idle') {
      if (pressed) {
        used = true
        let nxt = (this.sel ?? this.floorIdx) + 1
        if (nxt >= this.cfg.floors.length) nxt = 0
        if (nxt === this.floorIdx) { nxt++; if (nxt >= this.cfg.floors.length) nxt = 0 }
        this.sel = nxt
        this._commitAt = s.time.now + COMMIT_MS
        Sfx.console()
      }
      if (this.sel != null && s.time.now >= this._commitAt) this._go(this.sel)
    } else if (this.sel != null && !inside) {
      this.sel = null // 人出厢,取消未发车的选层
    }

    // —— 楼层呼叫 ——
    for (const c of this.calls) {
      const fy = this.cfg.floors[c.def.floor] + 16
      const near = player.alive && Math.abs(player.x - c.def.x) < 46 && Math.abs(player.y - fy) < 90
      let txt = '[E] 呼叫电梯'
      if (!this.enabled) txt = '⚠ 井口未开启'
      else if (this.state === 'moving') txt = '电梯运行中…'
      else if (this.floorIdx === c.def.floor) txt = '电梯已在本层'
      c.label.setText(txt)
      c.label.setAlpha(Phaser.Math.Linear(c.label.alpha, near ? 1 : 0, Math.min(1, dt * 14)))
      if (near && pressed && !used) {
        used = true
        if (!this.enabled || this.state === 'moving' || this.floorIdx === c.def.floor) Sfx.deny()
        else this._go(c.def.floor)
      }
    }

    // —— 厢顶标签与楼层灯 ——
    let lt = ''
    if (this.state === 'moving') lt = `运行中 → ${this._name(this.target)}`
    else if (inside) lt = this.sel != null ? `→ ${this._name(this.sel)} · 再按E换层` : `[E] 选层 · 当前 ${this._name(this.floorIdx)}`
    this.label.setText(lt)
    this.label.setPosition(p.x + p.w / 2, p.y - 128)
    this.label.setAlpha(Phaser.Math.Linear(this.label.alpha, lt ? 1 : 0, Math.min(1, dt * 12)))
    this._lampTick += dt
    const blink = Math.sin(this._lampTick * 9) > 0
    for (let i = 0; i < this.lamps.length; i++) {
      const l = this.lamps[i]
      if (i === this.floorIdx && this.state === 'idle') l.setTint(0x2aff62).setAlpha(0.8).setScale(0.11)
      else if (this.sel === i || (this.state === 'moving' && this.target === i)) l.setTint(0xffc36b).setAlpha(blink ? 0.9 : 0.3).setScale(0.11)
      else l.setTint(0x8fa3b8).setAlpha(0.18).setScale(0.09)
    }
    return used
  }
}
