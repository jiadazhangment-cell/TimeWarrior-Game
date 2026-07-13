// 输入统一抽象层:玩法代码只读这个对象,禁止直接读键盘/触屏。
// PC 由键鼠填充;未来移动端由虚拟摇杆填充同样的字段。
export class InputState {
  constructor(scene) {
    this.scene = scene
    this.moveX = 0            // -1..1 水平移动
    this.jumpHeld = false
    this.jumpQueuedAt = -1e9  // 最近一次按下跳跃的时间戳(供跳跃缓冲)
    this.firing = false
    this.aimX = 0             // 世界坐标准星
    this.aimY = 0
    this.enabled = false

    const kb = scene.input.keyboard
    this.keys = kb.addKeys({
      left: 'A', right: 'D', left2: 'LEFT', right2: 'RIGHT',
      up: 'W', up2: 'UP', space: 'SPACE',
    })
    const queueJump = () => { if (this.enabled) this.jumpQueuedAt = scene.time.now }
    this.keys.up.on('down', queueJump)
    this.keys.up2.on('down', queueJump)
    this.keys.space.on('down', queueJump)
  }

  update() {
    if (!this.enabled) { this.moveX = 0; this.firing = false; return }
    const k = this.keys
    const l = k.left.isDown || k.left2.isDown
    const r = k.right.isDown || k.right2.isDown
    this.moveX = (r ? 1 : 0) - (l ? 1 : 0)
    this.jumpHeld = k.up.isDown || k.up2.isDown || k.space.isDown

    const p = this.scene.input.activePointer
    const world = p.positionToCamera(this.scene.cameras.main)
    this.aimX = world.x
    this.aimY = world.y
    this.firing = p.isDown
  }

  consumeJump(bufferMs, now) {
    if (now - this.jumpQueuedAt <= bufferMs) { this.jumpQueuedAt = -1e9; return true }
    return false
  }
}
