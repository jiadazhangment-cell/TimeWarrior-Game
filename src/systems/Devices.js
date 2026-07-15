// 关卡装置系统:闸门(可开合实体墙段)+操作台(E键交互)——后续激光栅栏/配电柜联动也挂这里。
// 数据驱动(level json 的 doors/interactables),状态变化经 EventBus 通报('door:opened'/'interact:used')。
// 碰撞原则与移动平台相同:门=solids 里的普通实体条目,开门=从 solids 移除+删 Matter 体,
// 玩家/敌人/子弹/激光/敌人视线零改动自动跟随。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'

export class Devices {
  constructor(scene, levelCfg) {
    this.scene = scene
    this.doors = new Map()
    this.consoles = []
    for (const d of levelCfg.doors ?? []) this._buildDoor(d)
    for (const c of levelCfg.interactables ?? []) this._buildConsole(c)
  }

  _buildDoor(d) {
    const s = this.scene
    const solid = { x: d.x, y: d.y, w: d.w, h: d.h, door: d.id }
    s.solids.push(solid)
    const body = s.matter.add.rectangle(d.x + d.w / 2, d.y + d.h / 2, d.w, d.h, { isStatic: true, friction: 0.8 })
    // 门套(不动):顶部门楣盒(滑板升入其后)+两侧滑轨
    const frame = s.add.graphics().setDepth(6)
    frame.fillStyle(0x171a1f).fillRect(d.x - 7, d.y - 26, d.w + 14, 26)
    frame.lineStyle(2, 0x3a424d).strokeRect(d.x - 7, d.y - 26, d.w + 14, 26)
    frame.fillStyle(0x11141a).fillRect(d.x - 5, d.y, 5, d.h).fillRect(d.x + d.w, d.y, 5, d.h)
    // 门体滑板:开门=绕门顶 scaleY 收缩(变换原点=Graphics position=门顶),几何上真正缩回门楣——
    // 不用遮罩:Phaser 4 WebGL 已移除 GeometryMask(setMask 是 no-op 并告警)
    const slab = s.add.graphics().setDepth(5.5)
    slab.fillStyle(0x232830).fillRect(0, 0, d.w, d.h)
    slab.fillStyle(0x2c333d)
    for (let y = 14; y < d.h - 34; y += 34) slab.fillRect(2, y, d.w - 4, 5)
    slab.fillStyle(0xd8b13a)
    for (let y = d.h - 26; y < d.h - 6; y += 10) slab.fillRect(3, y, d.w - 6, 4)
    slab.setPosition(d.x, d.y)
    // 状态灯:双层软光(关=红,开=绿),挂在门楣上
    const lampHalo = s.add.image(d.x + d.w / 2, d.y - 13, 'px_glow').setTint(0xff2a1c)
      .setScale(0.5).setAlpha(0.3).setBlendMode(Phaser.BlendModes.ADD).setDepth(6.1)
    const lampCore = s.add.image(d.x + d.w / 2, d.y - 13, 'px_glow').setTint(0xff7a60)
      .setScale(0.2).setAlpha(0.7).setBlendMode(Phaser.BlendModes.ADD).setDepth(6.1)
    s.tweens.add({ targets: lampHalo, alpha: { from: 0.18, to: 0.4 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    this.doors.set(d.id, { def: d, solid, body, slab, lampHalo, lampCore, open: false })
  }

  openDoor(id) {
    const D = this.doors.get(id)
    if (!D || D.open) return
    D.open = true
    const s = this.scene
    const i = s.solids.indexOf(D.solid)
    if (i >= 0) s.solids.splice(i, 1)
    s.matter.world.remove(D.body)
    s.tweens.add({ targets: D.slab, scaleY: 0.04, duration: 700, ease: 'Cubic.InOut' })
    D.lampHalo.setTint(0x2aff62)
    D.lampCore.setTint(0x8dffb0)
    Sfx.door()
    EventBus.emit('door:opened', id)
  }

  _buildConsole(c) {
    const s = this.scene
    // 操作台造型(程序化 v1,后续机关件套图替换):立柱+斜面屏+青光呼吸
    const g = s.add.graphics().setDepth(5)
    g.fillStyle(0x1c2027).fillRect(c.x - 9, c.y - 30, 18, 30)
    g.lineStyle(1.5, 0x39424e).strokeRect(c.x - 9, c.y - 30, 18, 30)
    g.fillStyle(0x141920).fillRect(c.x - 14, c.y - 44, 28, 16)
    g.fillStyle(0x2e5f6e).fillRect(c.x - 11, c.y - 41, 22, 10)
    const glow = s.add.image(c.x, c.y - 36, 'px_glow').setTint(0x7fd4ff)
      .setScale(0.45).setAlpha(0.3).setBlendMode(Phaser.BlendModes.ADD).setDepth(5.1)
    s.tweens.add({ targets: glow, alpha: { from: 0.2, to: 0.42 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    const label = s.add.text(c.x, c.y - 58, `[E] ${c.prompt}`, {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#bfe9ff',
      backgroundColor: '#0c141a', padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 1).setDepth(45).setAlpha(0)
    this.consoles.push({ def: c, label, glow, used: false })
  }

  // 每帧:接近的操作台浮现提示;按 E 执行动作。E 的按下沿无论是否命中都消费,防陈旧按键残留误触发
  update(dt, player, input) {
    let near = null
    for (const c of this.consoles) {
      const close = !c.used && player.alive &&
        Math.abs(player.x - c.def.x) < 46 && Math.abs(player.y - c.def.y) < 80
      c.label.setAlpha(Phaser.Math.Linear(c.label.alpha, close ? 1 : 0, Math.min(1, dt * 14)))
      if (close && !near) near = c
    }
    const pressed = input.consumeInteract()
    if (near && pressed) {
      near.used = true
      near.label.setText('✓ 已执行')
      near.glow.setTint(0x2aff62)
      this.scene.tweens.add({ targets: near.label, alpha: 0, delay: 900, duration: 400 })
      Sfx.console()
      const a = near.def.action
      if (a?.type === 'openDoor') this.openDoor(a.door)
      EventBus.emit('interact:used', near.def.id)
    }
  }
}
