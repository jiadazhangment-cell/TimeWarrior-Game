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
    // 程序化生成粒子贴图(火花/碎片/闪光)
    const g = this.make.graphics({ add: false })
    g.fillStyle(0xffffff); g.fillCircle(3, 3, 3)
    g.generateTexture('px_spark', 6, 6)
    g.clear(); g.fillStyle(0xffffff); g.fillRect(0, 0, 5, 4)
    g.generateTexture('px_debris', 5, 4)
    g.clear(); g.fillStyle(0xffffff, 1); g.fillCircle(12, 12, 12)
    g.generateTexture('px_flash', 24, 24)
    g.destroy()
    this.scene.start('arena')
  }
}
