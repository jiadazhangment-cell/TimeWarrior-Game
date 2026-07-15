// 关卡装置系统:闸门(可开合实体墙段)+操作台(E键交互)——后续激光栅栏/配电柜联动也挂这里。
// 数据驱动(level json 的 doors/interactables),状态变化经 EventBus 通报('door:opened'/'interact:used')。
// 碰撞原则与移动平台相同:门=solids 里的普通实体条目,开门=从 solids 移除+删 Matter 体,
// 玩家/敌人/子弹/激光/敌人视线零改动自动跟随。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import { SaveStore } from '../core/SaveStore.js'

export class Devices {
  constructor(scene, levelCfg) {
    this.scene = scene
    this.levelName = levelCfg.name
    this.doors = new Map()
    this.consoles = []
    this.checkpoints = []
    for (const d of levelCfg.doors ?? []) this._buildDoor(d)
    for (const c of levelCfg.interactables ?? []) this._buildConsole(c)
    for (const cp of levelCfg.checkpoints ?? []) this._buildCheckpoint(cp)
  }

  _buildDoor(d) {
    const s = this.scene
    const solid = { x: d.x, y: d.y, w: d.w, h: d.h, door: d.id }
    s.solids.push(solid)
    const body = s.matter.add.rectangle(d.x + d.w / 2, d.y + d.h / 2, d.w, d.h, { isStatic: true, friction: 0.8 })
    const cx = d.x + d.w / 2
    // 门体滑板(碰撞体=显示体,机关件套图切件):分节装甲板,开门=绕顶收缩(节段收进门楣的伸缩门读法;
    // Phaser 4 WebGL 无 GeometryMask,收纳动画只能用变换,不能用遮罩)
    const slab = s.add.image(d.x, d.y, 'dev_gate_slab').setOrigin(0, 0).setDepth(5.5)
    slab.setDisplaySize(d.w, d.h)
    // 门框(静止:双轨道+顶部灯位):比门体宽 1.5 倍,画在滑板之上压住其两缘,升降永不露缝
    const fw = d.w * 1.5, fh = d.h * 1.08
    const frame = s.add.image(cx, d.y - 11 + fh / 2, 'dev_gate_frame').setDisplaySize(fw, fh).setDepth(5.6)
    // 状态灯×2:叠在框顶两角灯位(关=红呼吸,开=绿),双层软光
    const lampHalos = [], lampCores = []
    for (const sx of [-1, 1]) {
      const lx = cx + sx * fw * 0.40, ly = frame.y - fh / 2 + fh * 0.075
      const halo = s.add.image(lx, ly, 'px_glow').setTint(0xff2a1c).setScale(0.34).setAlpha(0.22)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(6.1)
      const core = s.add.image(lx, ly, 'px_glow').setTint(0xff7a60).setScale(0.14).setAlpha(0.6)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(6.1)
      s.tweens.add({ targets: halo, alpha: { from: 0.14, to: 0.34 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
      lampHalos.push(halo); lampCores.push(core)
    }
    this.doors.set(d.id, { def: d, solid, body, slab, lampHalos, lampCores, open: false })
  }

  openDoor(id) {
    const D = this.doors.get(id)
    if (!D || D.open) return
    D.open = true
    const s = this.scene
    const i = s.solids.indexOf(D.solid)
    if (i >= 0) s.solids.splice(i, 1)
    s.matter.world.remove(D.body)
    s.tweens.add({ targets: D.slab, scaleY: D.slab.scaleY * 0.03, duration: 700, ease: 'Cubic.InOut' })
    for (const l of D.lampHalos) l.setTint(0x2aff62)
    for (const l of D.lampCores) l.setTint(0x8dffb0)
    Sfx.door()
    EventBus.emit('door:opened', id)
  }

  _buildConsole(c) {
    const s = this.scene
    // 操作台(机关件套图切件):斜面蓝屏终端;屏位叠青光呼吸
    s.add.image(c.x, c.y, 'dev_console').setOrigin(0.5, 1).setDepth(5)
    const glow = s.add.image(c.x - 1, c.y - 46, 'px_glow').setTint(0x7fd4ff)
      .setScale(0.5).setAlpha(0.32).setBlendMode(Phaser.BlendModes.ADD).setDepth(5.1)
    s.tweens.add({ targets: glow, alpha: { from: 0.22, to: 0.44 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    // 远距可见的信标(未使用时常亮):下指小箭头+软光,缓慢上下浮动——不然操作台在长走廊里根本注意不到
    const beacon = s.add.container(c.x, c.y - 74).setDepth(45)
    beacon.add(s.add.image(0, -4, 'px_glow').setTint(0x7fd4ff).setScale(0.55).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD))
    beacon.add(s.add.triangle(0, 0, -5.5, -9, 5.5, -9, 0, 0, 0xbfe9ff, 0.95))
    s.tweens.add({ targets: beacon, y: c.y - 82, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    const label = s.add.text(c.x, c.y - 90, `[E] ${c.prompt}`, {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#bfe9ff',
      backgroundColor: '#0c141a', padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 1).setDepth(45).setAlpha(0)
    this.consoles.push({ def: c, label, glow, beacon, used: false })
  }

  _buildCheckpoint(cp) {
    const s = this.scene
    // 检查点信标柱(机关件套图切件):顶部球形灯罩(未激活=暗红,激活=绿)——过点即记录重生点并落盘
    s.add.image(cp.x, cp.y, 'dev_pylon').setOrigin(0.5, 1).setDepth(4.5)
    const halo = s.add.image(cp.x, cp.y - 53, 'px_glow').setTint(0xff2a1c)
      .setScale(0.32).setAlpha(0.18).setBlendMode(Phaser.BlendModes.ADD).setDepth(4.6)
    const core = s.add.image(cp.x, cp.y - 53, 'px_glow').setTint(0xff7a60)
      .setScale(0.13).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(4.6)
    this.checkpoints.push({ def: cp, halo, core, reached: false })
  }

  _activateCheckpoint(cp) {
    cp.reached = true
    const s = this.scene
    s.respawnPoint = { x: cp.def.x, y: cp.def.y }
    // 落盘(关卡切换点/检查点强制存档——风险清单#4 策略)
    SaveStore.set('progress', { level: this.levelName, checkpoint: cp.def.id, savedAt: Date.now() })
    cp.halo.setTint(0x2aff62).setAlpha(0.3)
    cp.core.setTint(0x8dffb0).setAlpha(0.8)
    s.tweens.add({ targets: cp.halo, scale: { from: 0.32, to: 0.6 }, alpha: { from: 0.5, to: 0.22 }, duration: 500, ease: 'Cubic.Out' })
    Sfx.checkpoint()
    EventBus.emit('checkpoint:reached', cp.def.id)
  }

  // 每帧:接近的操作台浮现提示;按 E 执行动作。E 的按下沿无论是否命中都消费,防陈旧按键残留误触发
  update(dt, player, input) {
    // 检查点:玩家经过即激活(一次性)
    for (const cp of this.checkpoints) {
      if (!cp.reached && player.alive &&
          Math.abs(player.x - cp.def.x) < 24 && Math.abs(player.y - cp.def.y) < 95) {
        this._activateCheckpoint(cp)
      }
    }
    let near = null
    for (const c of this.consoles) {
      const close = !c.used && player.alive &&
        Math.abs(player.x - c.def.x) < 70 && Math.abs(player.y - c.def.y) < 90
      c.label.setAlpha(Phaser.Math.Linear(c.label.alpha, close ? 1 : 0, Math.min(1, dt * 14)))
      if (close && !near) near = c
    }
    const pressed = input.consumeInteract()
    if (near && pressed) {
      near.used = true
      near.label.setText('✓ 已执行')
      near.glow.setTint(0x2aff62)
      near.beacon.destroy() // 用过即收信标
      this.scene.tweens.add({ targets: near.label, alpha: 0, delay: 900, duration: 400 })
      Sfx.console()
      const a = near.def.action
      if (a?.type === 'openDoor') this.openDoor(a.door)
      EventBus.emit('interact:used', near.def.id)
    }
  }
}
