import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene.js'
import { ArenaScene } from './scenes/ArenaScene.js'
import gameCfg from '../config/game.json'

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: gameCfg.width,
  height: gameCfg.height,
  backgroundColor: gameCfg.backgroundColor,
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: 1.6 },   // 只作用于尸体/断肢刚体;存活角色是运动学驱动
      enableSleeping: true,
      debug: gameCfg.matterDebug,
    },
  },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, roundPixels: false },
  scene: [BootScene, ArenaScene],
})
