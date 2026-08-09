// 载人电梯系统(真实电梯语义,用户定版):厢体停靠楼层待命;各层"呼叫终端"召唤;
// 厢内按 E 循环选层、短暂停顿后发车直达;两侧开放进出(侧视游戏,无厢门)。
// 平台=solids 条目(oneWay),运动学移动+先带乘客后挪厢(与移动平台同一碰撞原则)。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'

const COMMIT_MS = 900 // 最后一次按键后这么久发车(现实电梯的"关门等待")
const SPEED = 150
// 厢体贴图结构实测(dev_cab 331×276,sharp 逐行扫不透明带):顶棚带 row 5~70(吊索卷筒+前脸光带),
// row 71 起只剩角柱与背板,row 240(=87% 高)=踏板走行面。微俯视读法:顶棚带=顶面+前立面两个面,
// row 10=顶面站立线(厢顶站人的脚线),row 48=顶面/前立面分界(=厢内真实天花板平面)。
const TEX_ROOF_STAND_ROW = 10
const TEX_CEIL_ROW = 48
// 厢内净高下限(胶囊 88 + 起跳即碰顶的余量):主梯(w140)等比即 98,副梯(w120)等比只有 87<88,
// 纵向微拉伸(scaleY 提到 0.5,约 +10%)补足。勿随手加大:副梯顶停 B1(760) 厢顶站人头顶距
// 地表楼板底(540)只剩 760-roofTopOff-88-540 = 17px,MIN_CLEAR 再涨会把载运的人顶进楼板。
// 【R1 定版】电梯停层=与楼层行走面齐平(floors 直接填走道面 y):厢体有顶后,"+16 高台+小跳登厢"
// 的旧升降台规则不再成立(跳跃弧线撞顶棚侧面,侧向根本进不了厢)——真电梯就是平层进出。
const MIN_CLEAR = 96

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
    // —— 结构几何先行:碰撞从贴图结构派生(所见即所碰),再交给 _buildCab 画同一套数 ——
    const texOK = scene.textures.exists('dev_cab')
    const tex = texOK ? scene.textures.get('dev_cab').getSourceImage() : { width: 331, height: 276 }
    const dispW = cfg.w + 30
    const scaleX = dispW / tex.width
    const deckRow = tex.height * 0.87 // 踏板走行面(自图底 13%)对齐停靠面——既有定版
    const scaleY = Math.max(scaleX, MIN_CLEAR / (deckRow - TEX_CEIL_ROW))
    this._disp = { W: dispW, H: tex.height * scaleY, scaleX, scaleY }
    this._roofTopOff = (deckRow - TEX_ROOF_STAND_ROW) * scaleY // 停靠面→厢顶站立线
    this._ceilOff = (deckRow - TEX_CEIL_ROW) * scaleY // 停靠面→厢内天花板
    const y0 = cfg.floors[cfg.start]
    this.solid = { x: cfg.x, y: y0, w: cfg.w, h: 16, oneWay: true, elevator: cfg.id }
    // 厢顶=随厢移动的实体:厢内跳跃被顶挡(真轿厢感)、从上方落下可站、随厢载运。
    // liftRoof 标记供玩家/敌人 Y 段豁免"下行顶棚从头顶掠过时被吸附上顶"的边缘情况
    this.roofSolid = {
      x: cfg.x, y: y0 - this._roofTopOff, w: cfg.w,
      h: this._roofTopOff - this._ceilOff, liftRoof: true, elevator: cfg.id,
    }
    scene.solids.push(this.solid, this.roofSolid)
    // Matter 静态体(尸体专用):尸体同样不穿厢底/厢顶,运行时随厢同步
    this._bodyFloor = scene.matter.add.rectangle(cfg.x + cfg.w / 2, y0 + 4, cfg.w, 8, { isStatic: true, friction: 0.8 })
    this._bodyRoof = scene.matter.add.rectangle(cfg.x + cfg.w / 2, this.roofSolid.y + this.roofSolid.h / 2, cfg.w, this.roofSolid.h, { isStatic: true, friction: 0.8 })
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
      const topY = this.cfg.floors[0]
      const botY = this.cfg.floors[this.cfg.floors.length - 1] + 20
      const railTex = s.textures.get('dev_rail').getSourceImage()
      s.add.tileSprite(this.solid.x + hw, (topY + botY) / 2, 30 / 0.333, botY - topY, 'dev_rail')
        .setTileScale(0.333, 0.333).setScale(0.333, 1).setDepth(0.35).setAlpha(0.95)
    }
    this.cab = s.add.container(this.solid.x + hw, this.solid.y).setDepth(6.2)
    const { W: dispW, H: dispH, scaleX, scaleY } = this._disp
    if (s.textures.exists('dev_cab')) {
      // 踏板走行面在图高约 13%(自图底):贴图下沉让踏板面=停靠面,前裙沿灯带垂在平台下;
      // scaleY 可能略大于 scaleX(副梯净高补足),结构几何(厢顶 solid)与之同源
      const img = s.add.image(0, dispH * 0.13, 'dev_cab').setOrigin(0.5, 1).setScale(scaleX, scaleY)
      this.cab.add(img)
    } else {
      const gb = s.add.graphics()
      gb.fillStyle(0x151a22, 0.92).fillRect(-hw + 2, -this._ceilOff, w - 4, this._ceilOff)
      gb.fillStyle(0x232a34, 1).fillRect(-hw - 8, -this._roofTopOff, w + 16, this._roofTopOff - this._ceilOff)
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
      const fy = this.cfg.floors[c.floor] // 平层停靠:停靠面=楼层行走面
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

  _crushFx(x, y) {
    this.scene.fx.sparks(x, y, 10)
    this.scene.fx.debris(x, y, 4)
    Sfx.thud()
    EventBus.emit('camera:shake', 0.008)
  }

  // 压死敌人:大伤害向下砸(机器类照常走 ragdoll/断肢管线,被电梯压扁的零件飞溅=真实反馈)
  _crush(e) {
    this._crushFx(e.x, e.y - e.cfg.capsule.h + 6)
    e.takeHit(9999, { x: e.x < this.solid.x + this.solid.w / 2 ? -0.5 : 0.5, y: 0.5 },
      { x: e.x, y: e.y - e.cfg.capsule.h + 10 }, this.scene.turretWeapon)
  }

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
      // 先带乘客后挪厢(乘客判定与移动平台一致);厢底、厢顶都是可载运面
      const cx = p.x + p.w / 2
      const riding = (sy) => player.alive && player.grounded && Math.abs(player.y - sy) <= 2 &&
        player.x + 15 > p.x && player.x - 15 < p.x + p.w
      const onRoofRide = riding(this.roofSolid.y)
      const onFloorRide = riding(p.y)
      if (onFloorRide || onRoofRide) player.y += ndy
      // —— 尸体载运(入侵者2 对标定版:平台带载物=刚体随平台平移,不是"各自物理碰运气") ——
      // 厢底/厢顶载运窗内有任一部件的整具尸体,全部件随厢刚性平移:冻结尸保持冻结原样搬运
      // (零物理噪声,根治"电梯一走尸体掉埋进地里");醒着的部件同时对齐纵向速度防穿透累积。
      const M = Phaser.Physics.Matter.Matter
      // 捕获门槛:以躯干为锚点(根部件,断肢永不脱落),躯干在厢体足印+载运窗内才整具收编——
      // 旧版"任一部件在窗内就整具带走"会把半搭在井槽沿上的尸体拖着穿楼(用户实见
      // "肢体随电梯下行穿过多层");部件均值做锚会被飞远的断肢拉偏,躯干锚免疫
      const riderCorpses = new Set()
      for (const c of s.gibs.corpses) {
        const anchor = c.parts.get('torso')
        const b = anchor && anchor.spr.active && anchor.spr.body
        if (!b) continue
        if (Math.abs(b.position.x - cx) >= p.w / 2 - 4) continue
        const onFloor = b.position.y > p.y - 46 && b.position.y < p.y + 4
        const onRoof = b.position.y > this.roofSolid.y - 34 && b.position.y < this.roofSolid.y + 4
        if (onFloor || onRoof) riderCorpses.add(c)
      }
      for (const c of riderCorpses) {
        // 刮离检测:任一部件按本帧位移会进入非电梯实体(楼板/井槽沿)=整具释放,
        // 唤醒后由物理落在该层——与"搭沿尸块被楼板刮下留层"同一语义,冻结尸也适用
        let scraped = false
        for (const [, part] of c.parts) {
          const pb = part.spr.active && part.spr.body
          if (!pb) continue
          const nx = pb.position.x, ny = pb.position.y + ndy
          for (const o of s.solids) {
            if (o.oneWay || o.elevator) continue
            if (nx > o.x && nx < o.x + o.w && ny > o.y && ny < o.y + o.h) { scraped = true; break }
          }
          if (scraped) break
        }
        if (scraped) {
          for (const [, part] of c.parts) {
            const pb = part.spr.active && part.spr.body
            if (pb) s.gibs.wakeRider(pb)
          }
          continue
        }
        for (const [, part] of c.parts) {
          const pb = part.spr.active && part.spr.body
          if (!pb) continue
          M.Body.setPosition(pb, { x: pb.position.x, y: pb.position.y + ndy })
          if (!pb.isStatic) M.Body.setVelocity(pb, { x: pb.velocity.x, y: ndy })
        }
      }
      // —— 可推物随厢载运(用户实见"厢顶箱子上行时穿模"):厢底面/厢顶面上的可推刚体随厢
      // 平移,与载尸同法——厢体是 setPosition 驱动的静态体,无碰撞响应,不带=顶穿/掉埋。
      // 载运中将顶进非电梯实体=压毁(箱→碎屑消亡;完好气瓶→当场引爆,现实电梯的下场) ——
      for (const pp of s._pushables) {
        const pb2 = pp._body
        if (!pb2 || pp === p || (pp.tank && pp._state && pp._state !== 'idle')) continue
        if (Math.abs(pb2.position.x - cx) >= p.w / 2 + 6) continue
        const bot = pp.y + pp.h
        const onCabFloor = bot > p.y - 8 && bot < p.y + 10
        const onCabRoof = bot > this.roofSolid.y - 8 && bot < this.roofSolid.y + 10
        if (!onCabFloor && !onCabRoof) continue
        let crushed = false
        if (ndy < 0) {
          const nx = pb2.position.x, ny2 = pb2.position.y + ndy
          for (const o of s.solids) {
            if (o.oneWay || o.elevator || o.minor || o === pp) continue
            if (nx > o.x && nx < o.x + o.w && ny2 - pp.h / 2 < o.y + o.h && ny2 + pp.h / 2 > o.y) { crushed = true; break }
          }
        }
        if (crushed) {
          this._crushFx(pb2.position.x, pb2.position.y)
          if (pp.tank && s.explosives) { s.explosives._explode(pp); continue }
          if (pp._spr) pp._spr.destroy()
          s.matter.world.remove(pb2)
          const si = s.solids.indexOf(pp); if (si >= 0) s.solids.splice(si, 1)
          const pi = s._pushables.indexOf(pp); if (pi >= 0) s._pushables.splice(pi, 1)
          continue
        }
        M.Sleeping.set(pb2, false)
        // 绝对落座(底边贴面)而非增量平移——增量会累出 5-7px 嵌顶漂移(实测)
        const seatTop = (onCabFloor ? p.y : this.roofSolid.y) + ndy
        M.Body.setPosition(pb2, { x: pb2.position.x, y: seatTop - pp.h / 2 })
        if (!pb2.isStatic) M.Body.setVelocity(pb2, { x: pb2.velocity.x, y: ndy })
      }
      // 下行厢底"贴到"正下方的尸块时把它挤出去(窗口只有一个厢底厚度——
      // 开大到 70 会在整个下行途中把足印下方全部尸块提前扫飞,载运就没得载了,实测踩过)
      if (ndy > 0) {
        for (const b of s.gibs.getBodies()) {
          if (Math.abs(b.position.x - cx) >= p.w / 2 + 8) continue
          if (b.position.y > p.y + ndy + 2 && b.position.y < p.y + 22) {
            s.gibs.wakeRider(b)
            // 【帧率归一化铁律,SKILL I 节】applyForce 是**每渲染帧**调一次而引擎步锁 60Hz+每步末清空力:
            // 165Hz 实机每物理步攒 2.75 帧的力 = 2.75 倍推力(30Hz 屏则不足 1 倍)。凡"每帧施力/衰减/计数"
            // 一律 ×(dt*60)。本处是全库最后一处漏网(对照 Explosives.js:412 / ArenaScene.js 的爆炸阵风都已归一化);
            // y 分量尤其要命:mass*0.005 对重力 mass*0.0016 在 60fps 是 3.1 倍、166Hz 是 8.6 倍,
            // 会把尸块顶进正下压的静态厢底体 = SKILL G"深嵌静态体→求解器注能→抽搐"那一族的诱因。
            // 随机项保留:归一化后高刷只是把方差抹平,均值对齐(bug-confirmed #7)
            const k = dt * 60
            M.Body.applyForce(b, b.position, {
              x: (b.position.x < cx ? -1 : 1) * b.mass * (0.009 + Math.random() * 0.006) * k,
              y: -b.mass * 0.005 * k,
            })
          }
        }
        // 下行厢底扫过站在井道里的玩家=砸一下(闷响+击退+掉血;非致命——落定平层后人站在厢内,
        // 致命的挤压归厢顶 crush 管)。每次下行只砸一次。
        // 乘客豁免:rider 先随厢位移后,旧厢底 y 对新玩家 y 的几何恒判"被扫过"——
        // 下行第一帧必误砸乘客一次(用户实见"下行莫名受击"),站厢内的人不该被自己脚下的厢底砸
        if (!this._deckHit && !onFloorRide && player.alive && s.time.now >= player.invulnUntil &&
            player.x + 15 > p.x && player.x - 15 < p.x + p.w &&
            p.y + ndy > player.y - player.capsule.h && p.y < player.y) {
          this._deckHit = true
          this._crushFx(player.x, p.y)
          player.hurt(12, cx)
        }
      }
      // —— 压死判定(用户定版"物理要考虑现实情况"):电梯是真机器,压到人就是压死 ——
      if (ndy > 0) {
        // 下行:顶棚下沿越过"站在厢体足印里、身位在顶棚之下"的实体头部=压死
        const newBot = this.roofSolid.y + this.roofSolid.h + ndy
        const inFoot = (x, hw) => x + hw > p.x && x - hw < p.x + p.w
        for (const e of s.enemies) {
          if (!e.alive || !inFoot(e.x, e.cfg.capsule.w / 2)) continue
          if (e.y > newBot && e.y - e.cfg.capsule.h < newBot - 6) this._crush(e)
        }
        // 乘客豁免同砸判:厢内净高对站姿只留 ~4.7px 裕量,一帧吸附抖动就够触发 9999——
        // 站在自家厢底上的人不可能被自家顶棚压死
        if (player.alive && !onFloorRide && s.time.now >= player.invulnUntil && inFoot(player.x, 15) &&
            player.y > newBot && player.y - player.capsule.h < newBot - 6) {
          this._crushFx(player.x, newBot)
          player.hurt(9999, player.x - 1)
        }
      } else if (ndy < 0 && onRoofRide) {
        // 上行载运:厢顶乘客的头顶被推进上方实体=顶死(现实电梯的经典事故)
        const head = player.y - player.capsule.h
        for (const o of s.solids) {
          if (o.oneWay || o.elevator) continue
          if (player.x + 15 > o.x && player.x - 15 < o.x + o.w &&
              head < o.y + o.h - 6 && player.y > o.y + o.h) {
            this._crushFx(player.x, o.y + o.h)
            player.hurt(9999, player.x - 1)
            break
          }
        }
      }
      p.y += ndy
      if (Math.abs(gy - p.y) < 0.001) {
        p.y = gy
        this.state = 'idle'
        this.floorIdx = this.target
        this._deckHit = false // 下次下行可再砸
        Sfx.checkpoint() // 到站"叮"
      }
      this.roofSolid.y = p.y - this._roofTopOff
      // Matter 静态体随厢同步(尸体不穿厢底/厢顶);尸块载运已由上面的刚体平移负责,
      // 旧"大邻域唤醒"退役(唤醒冻尸再靠物理推=掉埋事故的元凶)
      M.Body.setPosition(this._bodyFloor, { x: p.x + p.w / 2, y: p.y + 4 })
      M.Body.setPosition(this._bodyRoof, { x: p.x + p.w / 2, y: this.roofSolid.y + this.roofSolid.h / 2 })
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
      const fy = this.cfg.floors[c.def.floor]
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
    this.label.setPosition(p.x + p.w / 2, this.roofSolid.y - 8)
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
