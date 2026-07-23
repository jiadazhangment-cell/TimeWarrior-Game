import Phaser from 'phaser'
import { SaveStore } from '../core/SaveStore.js'

const IMAGES = [
  'player_head', 'player_torso', 'player_arm_upper', 'player_armgun', 'player_pauldron',
  'player_thigh_f', 'player_shin_f', 'player_foot_f', 'player_thigh_b', 'player_shin_b', 'player_foot_b',
  'robot_head', 'robot_torso', 'robot_arm_upper', 'robot_armgun', 'robot_pauldron',
  'robot_thigh_f', 'robot_shin_f', 'robot_foot_f', 'robot_thigh_b', 'robot_shin_b', 'robot_foot_b',
  'wall_tile',
  'prop_cover', 'prop_container', 'prop_ammo2', 'prop_ammo3', 'prop_barrier', 'prop_platform', 'prop_cabinet',
  'dev_gate_edge', 'dev_gate_housing', 'dev_gate_sill',
  'dev_laser_down', 'dev_laser_up', 'dev_console', 'dev_pylon',
  'dev_turret_base', 'dev_turret_gun', 'dev_wall_col',
  'dev_cab', 'dev_rail', 'dev_callpanel',
  'dev_hatch_pit', 'dev_hatch_plate',
  'dev_hatch_lid', 'dev_hatch_xsec', 'dev_hatch_sub', 'dev_hatch_slab',
  'dev_stair_tread', 'dev_stair_beam', 'dev_stair_post', 'dev_stair_anchor',
  'bg_office_glass', 'prop_desk', 'prop_filecab', 'prop_chair_fallen',
  'prop_counter', 'prop_gate_turn', 'prop_lockers', 'prop_bench',
  'prop_rack', 'prop_rack_open', 'bg_cable_tray', 'prop_workbench', 'prop_shelf', 'bg_hoist',
  'prop_tank_a', 'prop_tank_b', 'prop_tank_s',
  'bg_lab_window', 'bg_cryo_wall', 'prop_wetbench', 'prop_cryocab', 'prop_labcart', 'prop_shower', 'prop_biobin',
  'bg_monitor_wall', 'prop_secdesk', 'bg_gunrack', 'prop_armorycab', 'prop_ammochest', 'bg_alarm',
  'prop_monitor', 'prop_screen_a', 'prop_screen_b', 'prop_scope',
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
    // 枪口火舌羽流 ×3 变体(白核→黄→橙渐变的多瓣泪滴,origin 左端=枪口;每发随机选形=真实枪焰的混沌感)
    const mkPlume = (key, lobes) => {
      const t = this.textures.createCanvas(key, 96, 48)
      const c = t.context
      for (const [cx, cy, rx, ry, a0] of lobes) {
        const gr = c.createRadialGradient(cx - rx * 0.55, cy, 1, cx, cy, rx)
        gr.addColorStop(0, `rgba(255,255,255,${a0})`)
        gr.addColorStop(0.35, `rgba(255,225,140,${a0 * 0.8})`)
        gr.addColorStop(0.7, `rgba(255,150,50,${a0 * 0.38})`)
        gr.addColorStop(1, 'rgba(255,90,10,0)')
        c.fillStyle = gr
        c.beginPath()
        c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
        c.fill()
      }
      t.refresh()
    }
    mkPlume('px_plume0', [[26, 24, 24, 12, 1], [52, 21, 26, 8, 0.85], [58, 28, 22, 6, 0.7], [80, 24, 14, 3.5, 0.6]])
    mkPlume('px_plume1', [[24, 24, 22, 13, 1], [48, 26, 24, 9, 0.85], [55, 19, 20, 6, 0.7], [76, 25, 15, 4, 0.55]])
    mkPlume('px_plume2', [[28, 24, 26, 11, 1], [56, 24, 30, 7, 0.9], [78, 22, 14, 4, 0.6], [50, 30, 16, 5, 0.6]])
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

    // —— 爆炸专属贴图(反馈批定版:煤气罐爆炸对标入侵者2,不再借用枪械/断肢的冷色资源)——
    // 火球:环形辐射多瓣渐变(白→黄→橙→红透明)+白热核压顶,3 变体不同锯齿轮廓
    const mkFireball = (key, seed) => {
      const t = this.textures.createCanvas(key, 128, 128)
      const c = t.context
      const rnd = (i) => { const v = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453; return v - Math.floor(v) }
      // 中央火体打底:瓣与瓣被它熔在一起,否则离散瓣读作"花朵"不是火球(实测踩过)
      const body = c.createRadialGradient(64, 64, 4, 64, 64, 44)
      body.addColorStop(0, 'rgba(255,245,200,0.95)')
      body.addColorStop(0.55, 'rgba(255,170,60,0.7)')
      body.addColorStop(1, 'rgba(210,60,15,0)')
      c.fillStyle = body; c.beginPath(); c.arc(64, 64, 44, 0, Math.PI * 2); c.fill()
      const n = 10 + Math.floor(rnd(0) * 2)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(i) * 0.6
        const len = 30 + rnd(i + 10) * 26, wid = 16 + rnd(i + 20) * 10
        const cx = 64 + Math.cos(a) * len * 0.3, cy = 64 + Math.sin(a) * len * 0.3
        // 渐变锚点与椭圆同用绝对坐标+ellipse 自带旋转参数——translate 后渐变会锚偏,瓣体全透明(实测踩过)
        const gr = c.createRadialGradient(cx, cy, 1, cx, cy, len * 0.6)
        gr.addColorStop(0, 'rgba(255,255,255,0.95)')
        gr.addColorStop(0.3, 'rgba(255,230,140,0.85)')
        gr.addColorStop(0.62, 'rgba(255,140,40,0.55)')
        gr.addColorStop(1, 'rgba(200,40,10,0)')
        c.fillStyle = gr
        c.beginPath(); c.ellipse(cx, cy, len * 0.55, wid, a, 0, Math.PI * 2); c.fill()
      }
      const core = c.createRadialGradient(64, 64, 1, 64, 64, 26)
      core.addColorStop(0, 'rgba(255,255,255,1)')
      core.addColorStop(0.5, 'rgba(255,240,180,0.8)')
      core.addColorStop(1, 'rgba(255,180,80,0)')
      c.fillStyle = core; c.beginPath(); c.arc(64, 64, 26, 0, Math.PI * 2); c.fill()
      t.refresh()
    }
    mkFireball('px_fireball0', 3); mkFireball('px_fireball1', 17); mkFireball('px_fireball2', 42)
    // 烟团:灰褐多圆叠加,NORMAL 混合专用(烟不发光)
    const mkSmoke = (key, lobes) => {
      const t = this.textures.createCanvas(key, 96, 96)
      const c = t.context
      for (const [cx, cy, r, a0] of lobes) {
        // 基色提到中灰(120/95/80)——深灰烟在近黑走廊上等于隐形(实测);在场景里用 tint 压色温
        const gr = c.createRadialGradient(cx, cy, 1, cx, cy, r)
        gr.addColorStop(0, `rgba(120,112,102,${a0})`)
        gr.addColorStop(0.6, `rgba(95,89,80,${a0 * 0.6})`)
        gr.addColorStop(1, 'rgba(80,74,66,0)')
        c.fillStyle = gr; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill()
      }
      t.refresh()
    }
    mkSmoke('px_smoke0', [[40, 50, 30, 0.5], [58, 42, 26, 0.45], [48, 60, 22, 0.4]])
    mkSmoke('px_smoke1', [[46, 46, 32, 0.5], [64, 54, 24, 0.42], [34, 58, 20, 0.4]])
    // 冲击波环:柔和圆环+destination-out 楔形缺口=撕裂感(对标 pb2 shockwave_tex 的锯齿质感)
    const ring = this.textures.createCanvas('px_shockring', 128, 128)
    const rc = ring.context
    const rg2 = rc.createRadialGradient(64, 64, 40, 64, 64, 62)
    rg2.addColorStop(0, 'rgba(255,255,255,0)')
    rg2.addColorStop(0.55, 'rgba(255,255,255,0.15)')
    rg2.addColorStop(0.72, 'rgba(255,255,255,0.95)')
    rg2.addColorStop(0.86, 'rgba(255,255,255,0.4)')
    rg2.addColorStop(1, 'rgba(255,255,255,0)')
    rc.fillStyle = rg2; rc.beginPath(); rc.arc(64, 64, 62, 0, Math.PI * 2); rc.fill()
    rc.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + Math.random() * 0.2
      const w = 0.05 + Math.random() * 0.1
      rc.beginPath(); rc.moveTo(64, 64); rc.arc(64, 64, 74 + Math.random() * 10, a, a + w); rc.closePath()
      rc.fillStyle = `rgba(0,0,0,${0.4 + Math.random() * 0.5})`; rc.fill()
    }
    ring.refresh()
    // 存档层就绪并读入进度(检查点)后再进主场景——ArenaScene.create 是同步的,经 registry 传递
    SaveStore.init()
      .then(() => SaveStore.get('progress'))
      .then((save) => {
        this.registry.set('save', save)
        this.scene.start('arena')
      })
  }
}
