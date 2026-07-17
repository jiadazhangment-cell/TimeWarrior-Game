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
    this.breakables = []
    this.lasers = []
    for (const d of levelCfg.doors ?? []) this._buildDoor(d)
    for (const c of levelCfg.interactables ?? []) this._buildConsole(c)
    for (const cp of levelCfg.checkpoints ?? []) this._buildCheckpoint(cp)
    for (const b of levelCfg.breakables ?? []) this._buildBreakable(b)
    for (const l of levelCfg.lasers ?? []) this._buildLaser(l)
    // 激光束绘制层(发光叠加,每帧重画)
    this.beamGfx = scene.add.graphics().setDepth(28).setBlendMode(Phaser.BlendModes.ADD)
  }

  // —— 可击破物(配电柜等):有 hp 的实体道具,打爆后瘫痪联动装置;残骸留场仍作掩体 ——
  _buildBreakable(b) {
    const s = this.scene
    const solid = { x: b.x, y: b.y, w: b.w, h: b.h, breakable: b.id }
    s.solids.push(solid)
    const body = s.matter.add.rectangle(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, { isStatic: true, friction: 0.8 })
    const spr = s.add.image(b.x + b.w / 2, b.y + b.h / 2, b.prop).setDisplaySize(b.w, b.h).setDepth(5)
    this.breakables.push({ def: b, solid, body, spr, hp: b.hp ?? 60, dead: false })
  }

  hitBreakable(id, dmg, point) {
    const B = this.breakables.find((x) => x.def.id === id)
    if (!B || B.dead) return
    B.hp -= dmg
    if (B.hp > 0) return
    B.dead = true
    const cx = B.def.x + B.def.w / 2, cy = B.def.y + B.def.h / 2
    B.spr.setTint(0x4a4a4a) // 烧毁熏黑;残骸保留碰撞(仍是掩体)
    this.scene.fx.sparks(cx, cy, 18)
    this.scene.fx.debris(cx, cy, 6)
    this.scene.fx.flash(cx, cy)
    Sfx.zap()
    Sfx.thud()
    for (const L of this.lasers) if (L.def.cabinet === id) this._disableLaser(L) // 瘫痪联动栅栏
    EventBus.emit('breakable:destroyed', id)
  }

  // 落地装置的接地阴影:立于走道"后带"的家具(不挡路=不加碰撞)靠 底座上移+椭圆影 读出纵深,
  // 不再骑在碰撞地板线上被人穿模(所见即所碰巡检定版:挡路的才立在走道中,家具立于后沿)
  _groundShadow(x, baseY, w) {
    this.scene.add.ellipse(x, baseY, w, 6, 0x04060a, 0.34).setDepth(4.2)
  }

  // —— 激光栅栏:上下发射柱之间的竖直光束,周期开合;亮束触碰=掉血击退(仅玩家,机器人有敌我识别) ——
  _buildLaser(l) {
    const s = this.scene
    const BAND = 10 // 立地发射柱退到走道后带(底座上移),光束/伤害窗同步=所见即所碰
    const topPost = s.add.image(l.x, l.y1, 'dev_laser_down').setOrigin(0.5, 0).setDisplaySize(14, 34).setDepth(6)
    const botPost = s.add.image(l.x, l.y0 - BAND, 'dev_laser_up').setOrigin(0.5, 1).setDisplaySize(14, 34).setDepth(6)
    this._groundShadow(l.x, l.y0 - BAND + 2, 24)
    // 镜头供电红点(断电即灭)
    const mkLens = (y) => s.add.image(l.x, y, 'px_glow').setTint(0xff3020).setScale(0.15).setAlpha(0.65)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(6.1)
    const L = {
      def: l, yTop: l.y1 + 34, yBot: l.y0 - 34 - BAND,
      topPost, botPost, lensTop: mkLens(l.y1 + 34), lensBot: mkLens(l.y0 - 34 - BAND),
      disabled: false, wasOn: false,
    }
    this.lasers.push(L)
  }

  _disableLaser(L) {
    L.disabled = true
    L.lensTop.destroy()
    L.lensBot.destroy()
    L.topPost.setTint(0x777777)
    L.botPost.setTint(0x777777)
    this.scene.fx.sparks(L.def.x, L.yTop, 6)
    this.scene.fx.sparks(L.def.x, L.yBot, 6)
  }

  // —— 地板暗门(R1 结构真实性定版,参考22 专属套图):真机械三层总成 ——
  // 井坑(dev_hatch_pit,滑板之下):加固框环(顶带=井口凸沿≤4px)+井内壁(远壁暗板/近唇亮带);
  // 滑轨槽床(dev_hatch_bed)×2:框环两侧的露天导轨位(双滚轮座+警示轨),关门时空床=开启方式的预告;
  // 厚滑板(dev_hatch_plate)×2:防滑顶面+前立面侧棱,开启=沿轨平移滑出停驻床上(非缩放消失)。
  // 碰撞不变:实体条目盖井口,开门=移除;所见(板在哪)=所碰(洞在哪)。
  _buildHatch(d) {
    const s = this.scene
    const solid = { x: d.x, y: d.y, w: d.w, h: d.h, door: d.id }
    s.solids.push(solid)
    const body = s.matter.add.rectangle(d.x + d.w / 2, d.y + d.h / 2, d.w, d.h, { isStatic: true, friction: 0.8 })
    const PT = 454, PH = 46 // 盖板带=走道带(顶面+前立面读法),既有定版
    const cx = d.x + d.w / 2
    const leafW = d.w / 2 + 2 // 每叶盖半口,向框下各掖 1px 防露缝
    const travel = d.w / 2 + 6 // 开启行程:滑出井口、停驻槽床,床端留残留板缘
    const hasArt = s.textures.exists('dev_hatch_pit')
    let leaves, lampX
    if (hasArt) {
      // 井坑构造性对齐(dev_hatch_pit 切件实测):井洞内沿 frac 0.074..0.942(宽 0.868,中心 0.508),
      // 井口沿顶 frac 0.083——把洞口精确铺满碰撞缺口 [d.x, d.x+d.w],口沿顶带凸出走道带 ≤4px
      const HOLE_FRAC = 0.868, CENTER_FRAC = 0.508, MOUTH_TOP_FRAC = 0.083
      const pitW = d.w / HOLE_FRAC
      const pitX = cx - (CENTER_FRAC - 0.5) * pitW
      s.add.image(pitX, PT - MOUTH_TOP_FRAC * PH, 'dev_hatch_pit')
        .setOrigin(0.5, 0).setDisplaySize(pitW, PH).setDepth(5.42)
      const ringL = pitX - pitW / 2, ringR = pitX + pitW / 2 // 框环外沿
      const bedW = leafW
      s.add.image(ringL - bedW / 2, PT + 16, 'dev_hatch_bed').setDisplaySize(bedW, 16).setDepth(5.44)
      s.add.image(ringR + bedW / 2, PT + 16, 'dev_hatch_bed').setDisplaySize(bedW, 16).setFlipX(true).setDepth(5.44)
      const mkLeaf = (leafCx, flip) => s.add.image(leafCx, PT + PH, 'dev_hatch_plate')
        .setOrigin(0.5, 1).setDisplaySize(leafW, PH).setFlipX(flip).setDepth(5.5)
      leaves = [mkLeaf(d.x + d.w / 4, false), mkLeaf(d.x + 3 * d.w / 4, true)]
      lampX = ringL - bedW - 12
    } else {
      // 兜底(切件缺失):素色双板,仍走平移开合
      const mkLeaf = (leafCx) => {
        const g = s.add.graphics().setDepth(5.5)
        g.fillStyle(0x262c35).fillRect(-leafW / 2, 0, leafW, PH)
        g.lineStyle(1.5, 0x0e1116, 0.9).strokeRect(-leafW / 2 + 0.5, 0.5, leafW - 1, PH - 1)
        g.setPosition(leafCx, PT)
        return g
      }
      leaves = [mkLeaf(d.x + d.w / 4), mkLeaf(d.x + 3 * d.w / 4)]
      lampX = d.x - 10
    }
    // 状态灯:左槽床外端,关=红/开=绿
    const halo = s.add.image(lampX, PT + 8, 'px_glow').setTint(0xff2a1c).setScale(0.3).setAlpha(0.24)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(6.1)
    const core = s.add.image(lampX, PT + 8, 'px_glow').setTint(0xff7a60).setScale(0.13).setAlpha(0.6)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(6.1)
    s.tweens.add({ targets: halo, alpha: { from: 0.14, to: 0.34 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    const D = {
      def: d, solid, body, hatch: true, leaves,
      leafClosedX: [d.x + d.w / 4, d.x + 3 * d.w / 4],
      leafOpenX: [d.x + d.w / 4 - travel, d.x + 3 * d.w / 4 + travel],
      lampHalos: [halo], lampCores: [core], open: false,
    }
    this.doors.set(d.id, D)
    if (d.open) this.openDoor(d.id, true)
  }

  _buildDoor(d) {
    if (d.hatch) return this._buildHatch(d)
    const s = this.scene
    const solid = { x: d.x, y: d.y, w: d.w, h: d.h, door: d.id }
    s.solids.push(solid)
    const body = s.matter.add.rectangle(d.x + d.w / 2, d.y + d.h / 2, d.w, d.h, { isStatic: true, friction: 0.8 })
    const cx = d.x + d.w / 2
    // 侧视闸门(用户点名:门是挡左右通行的,应看到门的侧棱而非正脸)——三件套:
    // 门棱柱(碰撞体=显示体,分节厚门边缘)+门楣机构盒(墙装,滑门收纳处)+地面门槛座(导槽)
    const slab = s.add.image(d.x, d.y, 'dev_gate_edge').setOrigin(0, 0).setDepth(5.5)
    slab.setDisplaySize(d.w, d.h) // 开门=绕顶 scaleY 收缩进门楣(Phaser 4 WebGL 无遮罩,用变换)
    const hw = 64, hh = 24
    const housing = s.add.image(cx, d.y - 9, 'dev_gate_housing').setDisplaySize(hw, hh).setDepth(5.6)
    // 门楣机构盒=实体(所见即所碰):跳过门洞时头顶会磕到门楣,与真实门框一致;
    // 常驻不随门开合(机构盒不会消失),门棱柱收纳进它里面
    s.solids.push({ x: cx - hw / 2, y: d.y - 9 - hh / 2, w: hw, h: hh, housing: d.id })
    s.matter.add.rectangle(cx, d.y - 9, hw, hh, { isStatic: true, friction: 0.8 })
    s.add.image(cx, d.y + d.h + 3, 'dev_gate_sill').setOrigin(0.5, 1).setDisplaySize(58, 12).setDepth(5.65)
    // 状态灯:软光叠在机构盒画中圆灯位(左侧,横向占比~0.17),关=红呼吸,开=绿
    const lx = cx - hw / 2 + hw * 0.17, ly = housing.y
    const lampHalos = [], lampCores = []
    const halo = s.add.image(lx, ly, 'px_glow').setTint(0xff2a1c).setScale(0.36).setAlpha(0.26)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(6.1)
    const core = s.add.image(lx, ly, 'px_glow').setTint(0xff7a60).setScale(0.15).setAlpha(0.65)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(6.1)
    s.tweens.add({ targets: halo, alpha: { from: 0.16, to: 0.38 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    lampHalos.push(halo); lampCores.push(core)
    const D = { def: d, solid, body, slab, lampHalos, lampCores, open: false, closedScaleY: slab.scaleY }
    this.doors.set(d.id, D)
    if (d.open) this.openDoor(d.id, true) // 初始即开(如封锁房间入口)
  }

  openDoor(id, instant = false) {
    const D = this.doors.get(id)
    if (!D || D.open) return
    D.open = true
    const s = this.scene
    const i = s.solids.indexOf(D.solid)
    if (i >= 0) s.solids.splice(i, 1)
    if (D.body) { s.matter.world.remove(D.body); D.body = null }
    if (D.hatch) { // 暗门:双滑板沿槽床导轨向两侧平移滑出(真机械,非缩放消失)
      if (instant) D.leaves.forEach((l, i) => l.setX(D.leafOpenX[i]))
      else D.leaves.forEach((l, i) => s.tweens.add({ targets: l, x: D.leafOpenX[i], duration: 650, ease: 'Cubic.InOut' }))
    } else if (instant) D.slab.scaleY = D.closedScaleY * 0.03
    else s.tweens.add({ targets: D.slab, scaleY: D.closedScaleY * 0.03, duration: 700, ease: 'Cubic.InOut' })
    for (const l of D.lampHalos) l.setTint(0x2aff62)
    for (const l of D.lampCores) l.setTint(0x8dffb0)
    if (!instant) Sfx.door()
    EventBus.emit('door:opened', id)
  }

  closeDoor(id) {
    const D = this.doors.get(id)
    if (!D || !D.open) return
    const s = this.scene
    const d = D.def
    // 玩家占着门洞时不落闸(防夹死),稍后重试
    const c = s.player?.capsule
    if (c && c.x < d.x + d.w + 6 && c.x + c.w > d.x - 6 && c.y < d.y + d.h && c.y + c.h > d.y) {
      s.time.delayedCall(160, () => this.closeDoor(id))
      return
    }
    D.open = false
    s.solids.push(D.solid)
    D.body = s.matter.add.rectangle(d.x + d.w / 2, d.y + d.h / 2, d.w, d.h, { isStatic: true, friction: 0.8 })
    if (D.hatch) D.leaves.forEach((l, i) => s.tweens.add({ targets: l, x: D.leafClosedX[i], duration: 450, ease: 'Cubic.In' }))
    else s.tweens.add({ targets: D.slab, scaleY: D.closedScaleY, duration: 450, ease: 'Cubic.In' })
    for (const l of D.lampHalos) l.setTint(0xff2a1c)
    for (const l of D.lampCores) l.setTint(0xff7a60)
    Sfx.door()
    EventBus.emit('door:closed', id)
  }

  _buildConsole(c) {
    const s = this.scene
    const by = c.y - 10 // 立于走道后带(不挡路的家具,底座上移+接地阴影)
    // 操作台(机关件套图切件):斜面蓝屏终端;屏位叠青光呼吸
    s.add.image(c.x, by, 'dev_console').setOrigin(0.5, 1).setDepth(5)
    this._groundShadow(c.x, by + 2, 48)
    const glow = s.add.image(c.x - 1, by - 46, 'px_glow').setTint(0x7fd4ff)
      .setScale(0.5).setAlpha(0.32).setBlendMode(Phaser.BlendModes.ADD).setDepth(5.1)
    s.tweens.add({ targets: glow, alpha: { from: 0.22, to: 0.44 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    // 远距可见的信标(未使用时常亮):下指小箭头+软光,缓慢上下浮动——不然操作台在长走廊里根本注意不到
    const beacon = s.add.container(c.x, c.y - 74).setDepth(45)
    beacon.add(s.add.image(0, -4, 'px_glow').setTint(0x7fd4ff).setScale(0.55).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD))
    beacon.add(s.add.triangle(0, 0, -5.5, -9, 5.5, -9, 0, 0, 0xbfe9ff, 0.95))
    s.tweens.add({ targets: beacon, y: c.y - 82, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    const label = s.add.text(c.x, c.y - 90, c.locked ? `⚠ ${c.lockedPrompt ?? '封锁中:肃清残敌'}` : `[E] ${c.prompt}`, {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#bfe9ff',
      backgroundColor: '#0c141a', padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 1).setDepth(45).setAlpha(0)
    beacon.setVisible(!c.locked) // 锁定中不给信标,解锁时亮起=引导
    this.consoles.push({ def: c, label, glow, beacon, locked: !!c.locked, used: false })
  }

  unlockConsole(id) {
    const c = this.consoles.find((x) => x.def.id === id)
    if (!c) return
    c.locked = false
    c.label.setText(`[E] ${c.def.prompt}`)
    c.beacon.setVisible(true)
  }

  _buildCheckpoint(cp) {
    const s = this.scene
    const by = cp.y - 10 // 立于走道后带(同操作台)
    // 检查点信标柱(机关件套图切件):顶部球形灯罩(未激活=暗红,激活=绿)——过点即记录重生点并落盘
    s.add.image(cp.x, by, 'dev_pylon').setOrigin(0.5, 1).setDepth(4.5)
    this._groundShadow(cp.x, by + 2, 30)
    const halo = s.add.image(cp.x, by - 53, 'px_glow').setTint(0xff2a1c)
      .setScale(0.32).setAlpha(0.18).setBlendMode(Phaser.BlendModes.ADD).setDepth(4.6)
    const core = s.add.image(cp.x, by - 53, 'px_glow').setTint(0xff7a60)
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

  // 每帧:接近的操作台浮现提示;按 E 执行动作。pressed 由场景层统一消费后传入
  // (与电梯系统共享同一个按下沿,操作台优先);返回本帧是否用掉了 E。
  update(dt, player, pressed) {
    // 检查点:玩家经过即激活(一次性)
    for (const cp of this.checkpoints) {
      if (!cp.reached && player.alive &&
          Math.abs(player.x - cp.def.x) < 24 && Math.abs(player.y - cp.def.y) < 95) {
        this._activateCheckpoint(cp)
      }
    }
    // 激光栅栏:周期开合(亮起前 280ms 预热微光=公平预告);光束=核心亮线+软辉光,轻微闪烁
    const now = this.scene.time.now
    this.beamGfx.clear()
    for (const L of this.lasers) {
      if (L.disabled) continue
      const l = L.def
      const cycle = (now + (l.phase ?? 0)) % (l.onMs + l.offMs)
      const on = cycle < l.onMs
      if (on && !L.wasOn && Math.abs(player.x - l.x) < 700) Sfx.laserSnap()
      L.wasOn = on
      if (on) {
        const fl = 0.82 + Math.random() * 0.18
        this.beamGfx.lineStyle(5, 0xff3020, 0.16 * fl).lineBetween(l.x, L.yTop, l.x, L.yBot)
        this.beamGfx.lineStyle(2, 0xff4838, 0.8 * fl).lineBetween(l.x, L.yTop, l.x, L.yBot)
        this.beamGfx.lineStyle(1, 0xffd0c8, 0.9 * fl).lineBetween(l.x, L.yTop, l.x, L.yBot)
        const c = player.capsule
        if (player.alive && Math.abs(player.x - l.x) < c.w / 2 + 2 &&
            c.y < L.yBot && c.y + c.h > L.yTop) {
          // 击退方向=行进反向(正好站在束心时 sign(x-lx)=0 会不弹,故以速度/朝向定向)
          const from = player.x + (Math.sign(player.vx) || player.facing || 1)
          player.hurt(l.damage ?? 10, from) // hurt 自带 700ms 无敌
        }
      } else if (cycle > l.onMs + l.offMs - 280) {
        this.beamGfx.lineStyle(1, 0xff4838, 0.16).lineBetween(l.x, L.yTop, l.x, L.yBot)
      }
    }
    let near = null
    for (const c of this.consoles) {
      const close = !c.used && player.alive &&
        Math.abs(player.x - c.def.x) < 70 && Math.abs(player.y - c.def.y) < 90
      c.label.setAlpha(Phaser.Math.Linear(c.label.alpha, close ? 1 : 0, Math.min(1, dt * 14)))
      if (close && !near) near = c
    }
    if (near && pressed) {
      if (near.locked) { Sfx.deny(); return true } // 锁定中:拒绝音,不执行
      near.used = true
      near.label.setText('✓ 已执行')
      near.glow.setTint(0x2aff62)
      near.beacon.destroy() // 用过即收信标
      this.scene.tweens.add({ targets: near.label, alpha: 0, delay: 900, duration: 400 })
      Sfx.console()
      const a = near.def.action
      if (a?.type === 'openDoor') this.openDoor(a.door)
      else if (a?.type === 'event') EventBus.emit('devices:event', a.name)
      EventBus.emit('interact:used', near.def.id)
      return true
    }
    return false
  }
}
