// 可爆炸物系统(R2 物理世界层,入侵者2 对标"道具即弹药"):
// 气瓶=可推动态刚体;被打漏(hp 耗尽)进入泄漏阶段——阀口喷焰产生**偏心推力**(施力点偏离
// 质心=自带扭矩),瓶体喷着火乱窜翻滚(此阶段 minor junk 语义,撞到人/敌人是撞击伤)。
// fuel 机制(In2 PropaneTank 移植,用户拍板):燃烧的罐**不会自己爆**——烧完燃料自行熄火
// 变成惰性废罐(变数!);爆炸只来自:燃烧中再次中弹(120ms 殉爆引信)或被别的爆炸波及(连锁)。
import Phaser from 'phaser'
import { EventBus } from '../core/EventBus.js'
import { Sfx } from '../core/Sfx.js'
import { segVsRect } from './Ballistics.js'

const M = Phaser.Physics.Matter.Matter
const BOOM_R = 130
// 泄漏飞行的速度上限(px/step;×60=px/s)。实测旧版恒定 3×重力推 5 秒 → 峰值 1176px/s、
// 1 秒飞出 960 宽的视口、1.3 秒冲出关卡顶卡在世界边界上飘 2.7 秒(用户点名"一下就消失")。
// 7px/step≈420px/s:窜得依然凶,但全程留在画面里看得见
const LEAK_MAX_SPD = 7

export class Explosives {
  constructor(scene) {
    this.scene = scene
    this.tanks = scene._pushables.filter((p) => p.tank)
    for (const t of this.tanks) {
      t._hp = t.hp ?? 26
      t._state = 'idle' // idle(完好可推) | leak(喷射乱窜) | dead
    }
    this._shells = [] // 爆后罐体半壳(物理残骸留场,In2 SpecialGib.InitGasTank 对标)
    this._flames = [] // 爆炸火舌球(扇形飞散+落地反弹,In2 FlameBall 对标;纯视觉,伤害归径向场)
    // 关卡矩形(飞出即引爆的判据)必须**延迟读取**:本系统在 ArenaScene.create 里
    // 早于 cameras.main.setBounds() 构造,构造期读到的是 0×0 空矩形 → 判据当场成立 → 一点燃就炸
    this._level = null
  }

  // 子弹命中气瓶(Ballistics 墙命中分派;敌我子弹都有效=炮塔乱枪也会引爆,系统涌现)
  hit(solid, dmg, point) {
    const t = this.tanks.find((x) => x === solid)
    if (!t || t._state === 'dead') return
    this.scene.fx.sparks(point.x, point.y, 3)
    if (t._state === 'spent') { Sfx.hitWall(); return } // 烧尽废罐=惰性金属junk,打不炸(In2:fuel<=0 不再响应)
    M.Sleeping.set(t._body, false)
    t._hp -= dmg
    if (t._hp <= 0 && t._state === 'idle') this._startLeak(t)
    // 命中燃烧中的瓶=殉爆引信(In2:do_jet 中再受伤→life 扣穿即爆;打中就该马上炸)
    else if (t._state === 'leak') t._boomAt = Math.min(t._boomAt, this.scene.time.now + 120)
  }

  _startLeak(t) {
    t._state = 'leak'
    // In2 fuel 机制:不设自爆钟——燃料烧完自行熄火(3.2~5s,时间尺度按我们的节奏压缩);
    // _boomAt 只留给"燃烧中再次中弹"的殉爆引信
    t._boomAt = Infinity
    t._fuelUntil = this.scene.time.now + 3200 + Math.random() * 1800
    t._nozzleSign = Math.random() < 0.5 ? 1 : -1
    t._noz = 0
    t._hitCd = 0
    t._gustOn = true // 破口第一下就是一记猛喷
    t._gustUntil = this.scene.time.now + 150
    // 飞行物阶段:不再摘除 solids,改打 minor 标(入侵者2 junk 语义)——玩家/敌人可穿行、
    // 不挡视线,但子弹仍可命中(旧版整条摘除=飞瓶对子弹隐形穿模,审计实锤);
    // AABB 由 _updatePushables 继续逐帧随刚体同步
    t.minor = true
    // 喷口火焰(持久件,每帧重摆):真实燃气喷射=**定向火舌+暖光**。
    // 旧版拿 sparkEmitter(子弹打金属的蓝青白火花 0xbfe9ff/0x7fd4ff)+ fx.flash(冷蓝辉光)充数
    // = 用户点名"爆炸物为什么发白光"——项目早有铁律"火星必须暖色专属,勿借用蓝青 sparkEmitter",
    // 爆炸那层照做了、喷焰这层漏了(2026-07-24 修)
    const s = this.scene
    // 双层火焰:外焰(橙,大而散)+内焰核(暖黄,细而亮=火最热处)——单层只是一团色块
    t._jet = s.add.image(0, 0, 'px_plume0').setOrigin(0.06, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(41).setTint(0xff9a3c)
    t._jetCore = s.add.image(0, 0, 'px_plume1').setOrigin(0.04, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(41.1).setTint(0xffd98a)
    t._jetGlow = s.add.image(0, 0, 'px_glow').setTint(0xff8c3a)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(40.9)
    Sfx.gasIgnite()
  }

  _killJet(t) {
    t._jet?.destroy(); t._jetCore?.destroy(); t._jetGlow?.destroy()
    t._jet = null; t._jetCore = null; t._jetGlow = null
  }

  _explode(t) {
    if (t._state === 'dead') return
    t._state = 'dead'
    this._killJet(t)
    const s = this.scene
    const x = t._body.position.x, y = t._body.position.y
    // 视觉:爆炸复合体(核闪/火球羽流/冲击波环/烟团/暖火星/熏黑,见 fx.explosion——
    // 旧版借用枪械冷色资源+圆片充数,用户点名"不真实,参考入侵者2"后重做)
    // 找爆点正下方最近的地面线(火球锚地/熏黑贴地/冲击波变地表尘环用;200px 内无地=半空爆)
    let groundY = null
    for (const o of s.solids) {
      if (o.minor || x < o.x || x > o.x + o.w) continue
      if (o.y >= y - 6 && o.y < y + 200 && (groundY == null || o.y < groundY)) groundY = o.y
    }
    s.fx.explosion(x, y, 1, groundY)
    s.fx.debris(x, y, 16)
    // 罐体裂成两半壳(In2 反编译实证:InitGasTank ±rnd(75,105)° 双向飞出,物理残骸留场)——
    // 爆炸的后半段故事由碎片讲,不靠火;半壳沿垂直罐轴方向甩出,带自旋,静止后冻结
    const axis = t._body.angle - Math.PI / 2 // 罐嘴方向(竖放罐口朝上)
    this._spawnShell(t, x, y, axis + Phaser.Math.DegToRad(75 + Math.random() * 30), 'top')
    this._spawnShell(t, x, y, axis - Phaser.Math.DegToRad(75 + Math.random() * 30), 'bottom')
    // 火舌球×3 扇形沿罐嘴方向(In2:3 发 ±20° 扇),落地弹一下再熄——火有方向性,不是全向大球
    for (const k of [-1, 0, 1]) this._spawnFlame(x, y - 4, axis + k * (0.3 + Math.random() * 0.15))
    // 震屏随玩家距离衰减(900px 外不震——隔半张图的爆炸不该同级摇镜头)
    const fall = Math.max(0, 1 - Math.hypot(s.player.x - x, s.player.y - y) / 900)
    if (fall > 0.05) EventBus.emit('camera:shake', 0.045 * (0.85 + Math.random() * 0.3) * fall, 170)
    Sfx.explosion()
    // 爆炸遮挡:实心墙/闸门挡住的目标不吃伤害(审计实锤"隔墙炸人";pushable/oneWay/minor
    // 不挡冲击波——家具与格栅挡不住爆压,厚实结构才挡)
    const blocked = (tx, ty) => s.solids.some((o) =>
      o !== t && !o.oneWay && !o.pushable && !o.minor &&
      ((tt) => tt !== null && tt > 0.001 && tt < 0.999)(segVsRect(x, y, tx, ty, o)))
    // 伤害:敌人/炮塔(鸭子类型)/玩家;尸块冲击波;邻近气瓶连锁(随机延迟=连环爆的节奏感)
    const targets = s.lockdown ? s.enemies.concat(s.lockdown.turrets) : s.enemies
    for (const e of targets) {
      if (!e.alive) continue
      // 敌人 y=脚底,压到躯干量距;炮塔 pivotY 本身就是中心,不再上抬(否则等效炸塔半径偏小)
      const ex = e.x ?? e.pivotX, ey = e.y != null ? e.y - 40 : e.pivotY
      const d = Math.hypot(ex - x, ey - y)
      if (d < BOOM_R && !blocked(ex, ey)) e.takeHit(85, { x: (ex - x) / (d || 1), y: -0.4 }, { x: ex, y: ey }, s.turretWeapon)
    }
    if (s.player.alive && Math.hypot(s.player.x - x, s.player.y - 44 - y) < BOOM_R &&
        !blocked(s.player.x, s.player.y - 44)) s.player.hurt(28, x)
    for (const b of s.gibs.getBodies()) {
      const d = Math.hypot(b.position.x - x, b.position.y - y)
      if (d < BOOM_R + 40 && !blocked(b.position.x, b.position.y)) {
        s.gibs.wakeRider(b)
        const k = 1 - d / (BOOM_R + 40)
        // 冲击波用力(setVelocity 对初醒刚体无效的坑,见 ArenaScene 可推注释)
        M.Body.applyForce(b, b.position, {
          x: (b.position.x - x) / (d || 1) * b.mass * 0.032 * k,
          y: -b.mass * 0.018 * k,
        })
      }
    }
    // 场景反馈(审计实锤"爆炸对场景零反应"):可推家具吃冲击波;可击破物按距离折伤;后带 decor 抖一下
    for (const p of s._pushables) {
      // 只跳过燃烧中的罐(喷口力独占);完好罐与烧尽废罐都吃冲击波(废罐=普通junk金属)
      if (p === t || !p._body || (p.tank && p._state === 'leak')) continue
      const d = Math.hypot(p._body.position.x - x, p._body.position.y - y)
      if (d < BOOM_R + 40 && !blocked(p._body.position.x, p._body.position.y)) {
        const k = 1 - d / (BOOM_R + 40)
        M.Sleeping.set(p._body, false)
        M.Body.applyForce(p._body, p._body.position, {
          x: (p._body.position.x - x) / (d || 1) * p._body.mass * 0.024 * k,
          y: -p._body.mass * 0.012 * k,
        })
      }
    }
    for (const o of s.solids) {
      if (!o.breakable) continue
      const bx = o.x + o.w / 2, by = o.y + o.h / 2
      const d = Math.hypot(bx - x, by - y)
      if (d < BOOM_R && !blocked(bx, by)) s.devices.hitBreakable(o.breakable, Math.round(45 * (1 - d / BOOM_R)), { x: bx, y: by })
    }
    for (const dec of s._decorSprites ?? []) {
      if (Math.hypot(dec.x - x, dec.y - y) < BOOM_R + 130) {
        s.tweens.add({ targets: dec.spr, angle: { from: -1.2, to: 1.2 }, duration: 45,
          yoyo: true, repeat: 3, onComplete: () => dec.spr.setAngle(0) })
      }
    }
    for (const o of this.tanks) {
      if (o !== t && o._state !== 'dead' && o._state !== 'spent') {
        const d = Math.hypot(o._body.position.x - x, o._body.position.y - y)
        if (d < BOOM_R && !blocked(o._body.position.x, o._body.position.y)) {
          s.time.delayedCall(140 + Math.random() * 220, () => this._explode(o))
        }
      }
    }
    // 罐体炸没:摘贴图/刚体/solid(idle 直接被连锁引爆时 solid 还在)
    if (t._spr) t._spr.destroy()
    s.matter.world.remove(t._body)
    const i = s.solids.indexOf(t)
    if (i >= 0) s.solids.splice(i, 1)
    const j = s._pushables.indexOf(t)
    if (j >= 0) s._pushables.splice(j, 1)
  }

  // 罐体半壳:同一张罐贴图 crop 上/下半(origin 对到半壳几何中心),Matter 刚体甩出带自旋;
  // 静止 40 帧转 static(尸体"静止即烘焙"同款);FIFO 上限 8(4 罐)防残骸堆积
  _spawnShell(t, x, y, ang, half) {
    const s = this.scene
    const w = t._w0, dh = t.dispH ?? t._h0
    const tex = s.textures.get(t.prop).getSourceImage()
    const spr = s.add.image(x, y, t.prop).setDisplaySize(w, dh).setDepth(6).setTint(0x9a9188)
    if (half === 'top') { spr.setCrop(0, 0, tex.width, tex.height / 2); spr.setOrigin(0.5, 0.25) }
    else { spr.setCrop(0, tex.height / 2, tex.width, tex.height / 2); spr.setOrigin(0.5, 0.75) }
    const body = s.matter.add.rectangle(x, y, w * 0.8, t._h0 * 0.42,
      { density: 0.0018, friction: 0.5, frictionAir: 0.012, restitution: 0.18 })
    M.Body.setVelocity(body, { x: Math.cos(ang) * 7.4, y: Math.sin(ang) * 7.4 - 1.4 })
    M.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.5)
    this._shells.push({ spr, body, calm: 0, frozen: false })
    if (this._shells.length > 8) {
      const old = this._shells.shift()
      old.spr.destroy(); s.matter.world.remove(old.body)
    }
  }

  // 熄火(In2 cool_down 移植):燃料烧尽=不炸——最后几口喷溅打个嗝,罐体熏黑躺平,
  // 从此是惰性废罐(保持 minor junk 语义:可穿行、可中弹被打飞,但打不炸也点不着)
  _coolDown(t) {
    const s = this.scene
    t._state = 'spent'
    this._killJet(t)
    t._spr?.setTint(0x8f8a84) // 烧尽熏色
    for (let i = 0; i < 3; i++) {
      s.time.delayedCall(i * 110 + Math.random() * 70, () => {
        if (t._state !== 'spent' || !t._body) return
        // 最后几口喷嗝=暖色余烬(不是蓝青电火花)
        s.emberEmitter.explode(3, t._body.position.x, t._body.position.y - 8)
        const sm = s.add.image(t._body.position.x, t._body.position.y - 12, 'px_smoke' + Phaser.Math.Between(0, 1))
          .setDepth(39).setAlpha(0.4).setScale(0.3).setTint(0x9a9084)
        s.tweens.add({ targets: sm, y: sm.y - 26, scale: 0.75, alpha: 0, duration: 700, ease: 'Sine.Out', onComplete: () => sm.destroy() })
      })
    }
    Sfx.hitWall()
  }

  // 火团(爆炸的火舌球 / 喷口甩出的湍流火);o 可调速度、寿命、大小、重力
  _spawnFlame(x, y, ang, o = {}) {
    const s = this.scene
    const v = (o.speed ?? 360) + Math.random() * (o.speedVar ?? 130)
    const sc = o.scale ?? 0.4
    this._flames.push({
      x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, sc, grav: o.grav ?? 900,
      age: 0, life: o.life ?? (0.55 + Math.random() * 0.2), bounces: 0,
      plume: s.add.image(x, y, 'px_plume' + Phaser.Math.Between(0, 2)).setOrigin(0.12, 0.5)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(41).setScale(sc, sc * 1.1 * (Math.random() < 0.5 ? 1 : -1)),
      glow: s.add.image(x, y, 'px_glow').setTint(0xffc060)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(40.9).setScale(sc).setAlpha(0.7),
    })
  }

  // 燃气喷射火焰(2026-07-24 重做):三件套缺一不可——
  // ①贴在喷口的定向火舌(每帧换变体+抖幅+翻转=湍流,不是一张贴纸)②甩出去的短命火团(湍流尾)
  // ③烟迹(飞行轨迹读得出来,真实泄漏罐拖烟)。旧版只有"每帧一颗白点"=用户点名"像天上的星星一闪一闪"
  _drawJet(t, a, fuelK) {
    const s = this.scene
    const b = t._body
    const jet = a + Math.PI // 气从喷口朝推力反方向喷出
    const nx = b.position.x - Math.cos(a) * 16, ny = b.position.y - Math.sin(a) * 16
    if (t._jet) {
      const flip = Math.random() < 0.5 ? 1 : -1
      const len = (0.34 + Math.random() * 0.18) * fuelK
      t._jet.setTexture('px_plume' + Phaser.Math.Between(0, 2))
        .setPosition(nx, ny).setRotation(jet + Phaser.Math.FloatBetween(-0.12, 0.12))
        .setScale(len, (0.3 + Math.random() * 0.12) * fuelK * flip)
        .setAlpha(0.72 + Math.random() * 0.28)
      // 内焰核:更短更细更亮,与外焰同轴但独立抖动=火焰有层次不是一团色块
      t._jetCore.setTexture('px_plume' + Phaser.Math.Between(0, 2))
        .setPosition(nx, ny).setRotation(jet + Phaser.Math.FloatBetween(-0.06, 0.06))
        .setScale(len * (0.5 + Math.random() * 0.12), (0.14 + Math.random() * 0.06) * fuelK * flip)
        .setAlpha(0.8 + Math.random() * 0.2)
      t._jetGlow.setPosition(nx, ny).setScale((0.5 + Math.random() * 0.14) * fuelK)
        .setAlpha((0.34 + Math.random() * 0.16) * fuelK)
    }
    if (Math.random() < 0.5 * fuelK) { // 湍流尾:甩出去的小火团
      this._spawnFlame(nx, ny, jet + Phaser.Math.FloatBetween(-0.38, 0.38),
        { speed: 110, speedVar: 120, life: 0.16 + Math.random() * 0.12,
          scale: 0.15 + Math.random() * 0.1, grav: 260 })
    }
    if (Math.random() < 0.16) { // 烟迹
      const sm = s.add.image(nx, ny, 'px_smoke' + Phaser.Math.Between(0, 1)).setDepth(38)
        .setAlpha(0).setScale(0.16).setTint(0x8a8078).setAngle(Phaser.Math.Between(0, 360))
      s.tweens.add({ targets: sm, alpha: 0.32, duration: 90 })
      s.tweens.add({ targets: sm, y: sm.y - Phaser.Math.Between(14, 30), scale: 0.55,
        angle: sm.angle + Phaser.Math.Between(-24, 24), duration: 700, ease: 'Sine.Out' })
      s.tweens.add({ targets: sm, alpha: 0, delay: 260, duration: 460, onComplete: () => sm.destroy() })
    }
  }

  _stepShells() {
    for (const sh of this._shells) {
      if (sh.frozen) continue
      sh.spr.setPosition(sh.body.position.x, sh.body.position.y)
      sh.spr.setRotation(sh.body.angle)
      if (sh.body.speed < 0.5 && Math.abs(sh.body.angularVelocity) < 0.05) {
        if (++sh.calm > 40) { M.Body.setStatic(sh.body, true); sh.frozen = true }
      } else sh.calm = 0
    }
  }

  _stepFlames(dt) {
    const s = this.scene
    for (let i = this._flames.length - 1; i >= 0; i--) {
      const f = this._flames[i]
      f.age += dt
      f.vy += f.grav * dt
      const px = f.x, py = f.y
      f.x += f.vx * dt; f.y += f.vy * dt
      // 落面反弹一次(第二次接触即熄):只查"从上方压进顶面"的实体/层板
      if (f.vy > 0) {
        for (const o of s.solids) {
          if (o.minor) continue
          if (f.x > o.x && f.x < o.x + o.w && py <= o.y && f.y >= o.y) {
            f.y = o.y; f.vy *= -0.42; f.vx *= 0.78
            if (++f.bounces > 1) f.age = f.life
            break
          }
        }
      }
      const u = f.age / f.life
      if (u >= 1) {
        f.plume.destroy(); f.glow.destroy()
        this._flames.splice(i, 1)
        continue
      }
      const rot = Math.atan2(f.vy, f.vx) + Math.PI // 火舌拖在飞行方向后面
      const fade = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1
      f.plume.setPosition(f.x, f.y).setRotation(rot).setAlpha(fade)
      f.plume.setScale(f.sc * (1 + u * 0.7), (f.plume.scaleY < 0 ? -1 : 1) * f.sc * 1.1 * (1 + u * 0.5))
      f.glow.setPosition(f.x, f.y).setAlpha(fade * 0.7)
    }
  }

  update(dt = 0.0167) {
    const s = this.scene
    const now = s.time.now
    this._stepShells()
    this._stepFlames(dt)
    for (const t of this.tanks) {
      if (t._state !== 'leak') continue
      if (now >= t._boomAt) { this._explode(t); continue } // 燃烧中被打的殉爆引信
      if (now >= t._fuelUntil) { this._coolDown(t); continue } // 烧完不炸(In2 fuel 移植):熄火成废罐
      const b = t._body
      // 冲出关卡矩形=当场引爆:否则它贴着世界边界在屏幕外飘几秒再掉回来(实测冲到 y=-175 飘了 2.7s)
      if (!this._level || this._level.width < 1) this._level = s.cameras.main.getBounds()
      const L = this._level
      if (L.width > 1 && (b.position.y < L.y + 24 || b.position.x < L.x + 16 || b.position.x > L.right - 16)) {
        this._explode(t); continue
      }
      // 燃料将尽:喷口连续衰弱——火变小、推力变弱(In2 flame 尺寸随 fuel/25 收缩)
      const fuelK = Phaser.Math.Clamp((t._fuelUntil - now) / 800, 0.25, 1)
      // 喷口推力:沿瓶轴向+随机游走,施力点偏离质心=乱窜带翻滚(入侵者2 煤气罐火箭)。
      // **脉冲化**:真实泄漏罐是"噗噗"地窜、走走停停——旧版恒定 3×重力推满 5 秒 = 单向加速到
      // 1176px/s 一秒飞出视口(用户点名"一下就消失")
      t._noz += (Math.random() - 0.5) * 0.35
      const a = b.angle - Math.PI / 2 + t._nozzleSign * 0.25 + t._noz * 0.3
      // 阵发脉冲:开=峰值仍是老的 3×重力(窜得凶),关=只剩喷气;占空比 ~30%。
      // **平均推力必须小于重力(0.001)**——走廊没有天花板实体,平均一旦超过重力它就持续上升、
      // 飞出关卡顶(实测冲到 y=27 触发自爆)。现在平均≈0.93×重力:落得回地面,贴地乱窜+偶尔窜跳
      if (now >= (t._gustUntil ?? 0)) {
        t._gustOn = !t._gustOn
        t._gustUntil = now + (t._gustOn ? 80 + Math.random() * 120 : 260 + Math.random() * 160)
      }
      const gust = t._gustOn ? 0.7 + Math.random() * 0.4 : 0.1
      // **必须按时间积分**:Matter 的 runner 锁真实时间(accumulator+固定 16.667ms 步长),每步结束清空 force,
      // 而 applyForce 是每渲染帧调一次——165Hz 屏幕上两个物理步之间攒 2.75 帧的力 = 2.75 倍推力,
      // 60fps 调好的"平均推力<重力"配平在高刷屏上直接失效(罐子照飞)。×(dt*60) 归一化到"每 1/60 秒一份力"
      const f = b.mass * 0.0028 * fuelK * gust * (dt * 60)
      M.Body.applyForce(b, { x: b.position.x - Math.cos(a) * 8, y: b.position.y - Math.sin(a) * 8 },
        { x: Math.cos(a) * f, y: Math.sin(a) * f })
      // 速度上限:按比例回拉(保方向,不破坏翻滚手感)
      if (b.speed > LEAK_MAX_SPD) {
        const k = LEAK_MAX_SPD / b.speed
        M.Body.setVelocity(b, { x: b.velocity.x * k, y: b.velocity.y * k })
      }
      this._drawJet(t, a, fuelK)
      // 飞行撞击伤(有冷却,防逐帧融化目标)
      if (b.speed > 4 && now > t._hitCd) {
        const pl = s.player
        if (pl.alive && Math.abs(pl.x - b.position.x) < 26 && Math.abs(pl.y - 44 - b.position.y) < 54) {
          pl.hurt(8, b.position.x)
          t._hitCd = now + 260
        }
        for (const e of s.enemies) {
          if (!e.alive) continue
          if (Math.abs(e.x - b.position.x) < 28 && Math.abs(e.y - 55 - b.position.y) < 60) {
            e.takeHit(20, { x: Math.sign(b.velocity.x) || 1, y: -0.2 }, { x: e.x, y: e.y - 55 }, s.turretWeapon)
            t._hitCd = now + 260
            break
          }
        }
      }
    }
  }
}
