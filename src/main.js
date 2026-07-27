import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene.js'
import { ArenaScene } from './scenes/ArenaScene.js'
import gameCfg from '../config/game.json'

// —— WebGL2 上下文注入(流体爆炸需要可渲染的半浮点纹理 = WebGL2 的 EXT_color_buffer_float)——
// Phaser 4 自建上下文永远是 WebGL1,但官方支持经 config.canvas+config.context 塞入 WebGL2
// (WebGLRenderer.js:703 逃生口;:896 的 WebGL1 扩展 shim 段包在 instanceof WebGLRenderingContext
// 判断里,WebGL2 上下文整段跳过=原生支持。调研档 docs/流体爆炸调研/集成路径.md)。
// 要求 type 必须显式 Phaser.WEBGL(AUTO 在自定环境会 throw)。失败=回落 AUTO(WebGL1),
// 流体爆炸检测到非 WebGL2 时自动改用序列帧,游戏其余一切照旧
let glConfig = {}
try {
  const canvas = document.createElement('canvas')
  const gl2 = canvas.getContext('webgl2', { antialias: true, alpha: false,
    powerPreference: 'high-performance', premultipliedAlpha: true })
  if (gl2 && gl2.getExtension('EXT_color_buffer_float')) {
    glConfig = { type: Phaser.WEBGL, canvas, context: gl2 }
  }
} catch (e) { /* 回落 AUTO */ }

// 暴露给自动化验收脚本(chrome-devtools MCP)用;发布构建时无副作用
window.__game = new Phaser.Game({
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
  ...glConfig,
})
