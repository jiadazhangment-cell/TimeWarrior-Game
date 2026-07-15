import Phaser from 'phaser'

const IMAGES = [
  'player_head', 'player_torso', 'player_arm_upper', 'player_armgun', 'player_pauldron',
  'player_thigh_f', 'player_shin_f', 'player_foot_f', 'player_thigh_b', 'player_shin_b', 'player_foot_b',
  'robot_head', 'robot_torso', 'robot_arm_upper', 'robot_armgun', 'robot_pauldron',
  'robot_thigh_f', 'robot_shin_f', 'robot_foot_f', 'robot_thigh_b', 'robot_shin_b', 'robot_foot_b',
  'wall_tile',
  'prop_cover', 'prop_container', 'prop_ammo2', 'prop_ammo3', 'prop_barrier', 'prop_platform', 'prop_cabinet',
]

export class BootScene extends Phaser.Scene {
  constructor() { super('boot') }

  preload() {
    for (const key of IMAGES) this.load.image(key, `assets/img/${key}.png`)
    this.load.image('bg_corridor', 'assets/img/bg_corridor.jpg') // 第一章基地走廊背景(概念图直用,jpg 控包体)
  }

  create() {
    // 程序化生成粒子/光效贴图
    const g = this.make.graphics({ add: false })
    g.fillStyle(0xffffff); g.fillCircle(3, 3, 3)
    g.generateTexture('px_spark', 6, 6)
    g.clear(); g.fillStyle(0xffffff); g.fillRect(0, 0, 5, 4)
    g.generateTexture('px_debris', 5, 4)
    g.clear(); g.fillStyle(0xffffff, 1); g.fillCircle(12, 12, 12)
    g.generateTexture('px_flash', 24, 24)
    // 气泡=亮环+高光点+极淡内膜(实心光点不像气泡,用户点名)
    g.clear()
    g.lineStyle(1.6, 0xffffff, 0.9); g.strokeCircle(8, 8, 5.6)
    g.fillStyle(0xffffff, 0.12); g.fillCircle(8, 8, 5)
    g.fillStyle(0xffffff, 0.85); g.fillCircle(5.8, 5.4, 1.5)
    g.generateTexture('px_bubble', 16, 16)
    // 枪口星芒:横向长芒+纵向短芒+核心(圆片充数太糙,用户点名)
    g.clear(); g.fillStyle(0xffffff, 1)
    g.fillTriangle(1, 16, 16, 12.5, 16, 19.5)
    g.fillTriangle(31, 16, 16, 12.5, 16, 19.5)
    g.fillTriangle(16, 5, 13, 16, 19, 16)
    g.fillTriangle(16, 27, 13, 16, 19, 16)
    g.fillCircle(16, 16, 4.5)
    g.generateTexture('px_muzzle', 32, 32)
    // 扫描线(4px 周期 1px 亮线,平铺用)
    g.clear(); g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 4, 1)
    g.generateTexture('px_scanline', 4, 4)
    g.destroy()
    // 径向渐变软光晕(灯光通用,canvas 画渐变)
    const glow = this.textures.createCanvas('px_glow', 64, 64)
    const gc = glow.context
    const grd = gc.createRadialGradient(32, 32, 2, 32, 32, 31)
    grd.addColorStop(0, 'rgba(255,255,255,1)')
    grd.addColorStop(0.3, 'rgba(255,255,255,0.5)')
    grd.addColorStop(0.65, 'rgba(255,255,255,0.14)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    gc.fillStyle = grd
    gc.fillRect(0, 0, 64, 64)
    glow.refresh()
    this.scene.start('arena')
  }
}
