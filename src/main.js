import Phaser from 'phaser'

// 管线冒烟测试场景:验证 Phaser 4 + Matter 物理 + 构建链路全通。
// 之后会被正式的 Boot/Preload/Game 场景替换。
class SmokeScene extends Phaser.Scene {
  create() {
    const { width, height } = this.scale
    this.add.text(20, 16, '时空战士 · 管线冒烟测试', { fontFamily: 'sans-serif', fontSize: '20px', color: '#9adcff' })
    this.fpsText = this.add.text(20, 46, '', { fontFamily: 'monospace', fontSize: '14px', color: '#7fff9e' })

    this.matter.world.setBounds(0, 0, width, height)
    this.matter.add.rectangle(width / 2, height - 10, width, 20, { isStatic: true })

    // 一堆下落的方块 + 一个用约束拼起来的"三节棍",冒烟验证刚体与关节
    for (let i = 0; i < 8; i++) {
      const r = this.add.rectangle(180 + i * 80, 60 + (i % 3) * 40, 36, 36, 0x8fb4ff)
      this.matter.add.gameObject(r, { restitution: 0.55, friction: 0.05 })
    }
    const a = this.matter.add.rectangle(480, 120, 60, 14, { chamfer: { radius: 6 } })
    const b = this.matter.add.rectangle(540, 120, 60, 14, { chamfer: { radius: 6 } })
    const c = this.matter.add.rectangle(600, 120, 60, 14, { chamfer: { radius: 6 } })
    this.matter.add.constraint(a, b, 4, 0.9, { pointA: { x: 30, y: 0 }, pointB: { x: -30, y: 0 } })
    this.matter.add.constraint(b, c, 4, 0.9, { pointA: { x: 30, y: 0 }, pointB: { x: -30, y: 0 } })
  }

  update() {
    this.fpsText.setText('FPS: ' + Math.round(this.game.loop.actualFps))
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 540,
  backgroundColor: '#1a1d24',
  physics: {
    default: 'matter',
    matter: { gravity: { x: 0, y: 1 }, debug: true },
  },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [SmokeScene],
})
