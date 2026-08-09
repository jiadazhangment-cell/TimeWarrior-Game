// Phaser 与项目模块的最小桩,只为在 Node 里跑 ArenaScene 的绘制方法
import { readFileSync } from 'node:fs'
const R = 'C:/Users/surpr/Desktop/TimeWarrior-Game/'
const json = (p) => JSON.parse(readFileSync(R + p, 'utf8'))

export const HARNESS_DEV = true

class Sc { constructor() {} }
const Phaser = {
  Scene: Sc,
  WEBGL: 2, CANVAS: 1, AUTO: 0,
  BlendModes: { ADD: 1, NORMAL: 0, MULTIPLY: 2, ERASE: 3 },
  TintModes: { MULTIPLY: 0, FILL: 1 },
  Math: {
    Clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    Between: (a, b) => Math.round((a + b) / 2),
    FloatBetween: (a, b) => (a + b) / 2,
  },
  Geom: { Rectangle: class { constructor(x, y, w, h) { Object.assign(this, { x, y, width: w, height: h, centerX: x + w / 2, centerY: y + h / 2 }) } } },
  Physics: { Matter: { Matter: { Body: { setPosition() {}, setVelocity() {}, setAngle() {} } } } },
}

export const STUBS = {
  Phaser,
  InputState: class {}, EventBus: { on() {}, off() {}, emit() {} },
  Sfx: { unlock() {}, console() {} },
  Player: class {}, Enemy: class {}, BioEnemy: class {}, Turret: class {},
  Ballistics: class {}, segVsRect: () => null, GibSystem: class {},
  Devices: class {}, Elevator: class {}, Explosives: class {}, LockdownRoom: class {},
  WeaponSystem: class {}, Drops: class {}, BigFan: class {}, SteamVent: class {},
  FluidFx: class {}, Hud: class {}, ThreatMarkers: class {},
  gameCfg: json('config/game.json'),
  levelCfg: json('config/level_slice.json'),
  weaponsCfg: json('config/weapons.json'),
  enemiesCfg: json('config/enemies.json'),
}
