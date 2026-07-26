// 输入统一抽象层:玩法代码只读这个对象,禁止直接读键盘/触屏。
// PC 由键鼠填充;未来移动端由虚拟摇杆填充同样的字段。
export class InputState {
  constructor(scene) {
    this.scene = scene
    this.moveX = 0            // -1..1 水平移动
    this.jumpHeld = false
    this.jumpQueuedAt = -1e9  // 最近一次按下跳跃的时间戳(供跳跃缓冲)
    this.crouchPressed = false // 下蹲键边沿(切换式,由 Player 消费)
    this.crouchHeld = false    // S 持续按住(穿层下落判定用)
    this.interactPressed = false // 交互键边沿(E,由 Devices 消费;触屏未来填同一字段)
    this.firing = false
    this.aimX = 0             // 世界坐标准星
    this.aimY = 0
    this.weaponSelect = 0     // 切枪请求:1-4=直选槽位,-1/-2=滚轮/Q循环(边沿,场景层消费)
    this.enabled = false

    const kb = scene.input.keyboard
    this.keys = kb.addKeys({
      left: 'A', right: 'D', left2: 'LEFT', right2: 'RIGHT',
      up: 'W', up2: 'UP', space: 'SPACE',
      down: 'S', down2: 'DOWN', interact: 'E',
      w1: 'ONE', w2: 'TWO', w3: 'THREE', w4: 'FOUR', cycle: 'Q',
    })
    // 切枪:数字键直选 + Q/滚轮循环(触屏未来=HUD 武器条点选,填同一字段)
    this.keys.w1.on('down', () => { if (this.enabled) this.weaponSelect = 1 })
    this.keys.w2.on('down', () => { if (this.enabled) this.weaponSelect = 2 })
    this.keys.w3.on('down', () => { if (this.enabled) this.weaponSelect = 3 })
    this.keys.w4.on('down', () => { if (this.enabled) this.weaponSelect = 4 })
    this.keys.cycle.on('down', () => { if (this.enabled) this.weaponSelect = -1 })
    scene.input.on('wheel', (_p, _o, _dx, dy) => {
      if (this.enabled && dy !== 0) this.weaponSelect = dy > 0 ? -1 : -2
    })
    const queueJump = () => { if (this.enabled) this.jumpQueuedAt = scene.time.now }
    this.keys.up.on('down', queueJump)
    this.keys.up2.on('down', queueJump)
    this.keys.space.on('down', queueJump)
    const queueCrouch = () => { if (this.enabled) this.crouchPressed = true }
    this.keys.down.on('down', queueCrouch)
    this.keys.down2.on('down', queueCrouch)
    this.keys.interact.on('down', () => { if (this.enabled) this.interactPressed = true })
  }

  update() {
    if (!this.enabled) { this.moveX = 0; this.firing = false; this.crouchHeld = false; return }
    const k = this.keys
    const l = k.left.isDown || k.left2.isDown
    const r = k.right.isDown || k.right2.isDown
    this.moveX = (r ? 1 : 0) - (l ? 1 : 0)
    this.jumpHeld = k.up.isDown || k.up2.isDown || k.space.isDown
    this.crouchHeld = k.down.isDown || k.down2.isDown

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

  consumeCrouchToggle() {
    const v = this.crouchPressed
    this.crouchPressed = false
    return v
  }

  consumeInteract() {
    const v = this.interactPressed
    this.interactPressed = false
    return v
  }

  consumeWeaponSelect() {
    const v = this.weaponSelect
    this.weaponSelect = 0
    return v
  }
}
