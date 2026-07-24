// 屏外威胁▼标记(R3 威胁语言,对标入侵者2"屏外威胁红▼标记"):
// 已经盯上玩家的威胁(交战中的机器人/锁定中的炮塔)跑到屏幕外时,在屏幕边缘
// 显示红色指向三角——玩家能感知"火从哪边来";巡逻中的敌人不标(不泄露位置,
// 侦察压力保留给扫描锥与脚步声)。垂直方向同样生效(蜂巢下层威胁=底边▼)。
import Phaser from 'phaser'

const MARGIN = 26        // 标记中心到屏幕边缘的留边(px,屏幕空间)
const OFF_PAD = 26       // 世界视口外扩:威胁越出屏边这么多才开始标(半露头的敌人不标)
const MAX_DIST = 1700    // 超过此距离的威胁不标(半张图外没有即时压力)
const POOL = 8           // 同屏最多标记数(超出时取离玩家最近的)

export class ThreatMarkers {
  constructor(scene) {
    this.scene = scene
    // root 挂全部标记,逆变焦补偿与 HUD 同款(scrollFactor 0 不免变焦)
    this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(88)
    this.pool = []
    for (let i = 0; i < POOL; i++) {
      const c = scene.add.container(0, 0).setVisible(false)
      // 软光晕垫底(不随三角旋转)+指向三角:红=警报语言(与炮塔扫描锥/封锁红光同族)
      const glow = scene.add.image(0, 0, 'px_glow').setTint(0xff2a1c)
        .setScale(0.3).setAlpha(0.4).setBlendMode(Phaser.BlendModes.ADD)
      // 顶点朝 +x(指向角=rotation,不用再偏 90°):等腰三角 14×10
      const tri = scene.add.triangle(0, 0, 10, 0, -6, -6, -6, 6, 0xff3524)
        .setStrokeStyle(1.2, 0x7a120c, 0.9)
      c.add([glow, tri])
      this.root.add(c)
      this.pool.push({ c, tri, glow })
    }
  }

  // threats: [{x, y}](世界坐标);每帧调用,内部按视口/距离筛选
  update(threats, player) {
    const cam = this.scene.cameras.main
    const wv = cam.worldView
    const W = cam.width, H = cam.height
    const now = this.scene.time.now
    const z = cam.zoom // 逆变焦补偿:标记钉在屏幕坐标
    this.root.setScale(1 / z).setPosition((W / 2) * (1 - 1 / z), (H / 2) * (1 - 1 / z))
    const list = []
    if (player.alive) {
      for (const t of threats) {
        // 视口内(含外扩带)不标;太远不标
        if (t.x > wv.x - OFF_PAD && t.x < wv.right + OFF_PAD &&
            t.y > wv.y - OFF_PAD && t.y < wv.bottom + OFF_PAD) continue
        const dist = Phaser.Math.Distance.Between(t.x, t.y, player.x, player.y - 50)
        if (dist > MAX_DIST) continue
        list.push({ t, dist })
      }
      list.sort((a, b) => a.dist - b.dist)
    }
    const pulse = 0.8 + 0.2 * Math.sin(now / 130) // 共相位脉动(警报感)
    for (let i = 0; i < POOL; i++) {
      const m = this.pool[i]
      const it = list[i]
      if (!it) { m.c.setVisible(false); continue }
      // 世界→屏幕(随变焦):从屏心指向威胁,夹到边缘留边框上
      const zoom = cam.zoom
      const sx = (it.t.x - wv.x) * zoom, sy = (it.t.y - wv.y) * zoom
      const cx = W / 2, cy = H / 2
      const dx = sx - cx, dy = sy - cy
      const kx = dx > 0 ? (W - MARGIN - cx) / dx : dx < 0 ? (MARGIN - cx) / dx : 1e9
      const ky = dy > 0 ? (H - MARGIN - cy) / dy : dy < 0 ? (MARGIN - cy) / dy : 1e9
      const k = Math.min(kx, ky)
      m.c.setPosition(cx + dx * k, cy + dy * k).setVisible(true)
      m.tri.setRotation(Math.atan2(dy, dx))
      // 越近越醒目
      const near = Phaser.Math.Clamp(1.25 - it.dist / MAX_DIST, 0.4, 1)
      m.c.setAlpha(near * pulse)
      m.c.setScale(0.8 + 0.35 * near)
    }
  }
}
