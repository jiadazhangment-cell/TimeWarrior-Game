// 程序化音效合成器:零素材、零版权,全部 WebAudio 现场合成。
// 必须在用户首次点击后 unlock()(移动端浏览器强制要求)。
import gameCfg from '../../config/game.json'

class SfxEngine {
  constructor() {
    this.ctx = null
    this.master = null
    this.muted = !!gameCfg.muted // 静音开关(game.json,用户点名"先关掉声音")
  }

  unlock() {
    if (this.ctx) { this.ctx.resume(); return }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.35
    this.master.connect(this.ctx.destination)
    // 预生成 0.5s 白噪声 buffer,所有"噪声类"音效共用
    const len = Math.floor(this.ctx.sampleRate * 0.5)
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  }

  // 关键防御:ctx 未在运行(如自动化环境/被浏览器拦截)时绝不调度节点——
  // suspended 状态下时钟不走,节点永不结束,会无限累积拖垮主线程
  get _ready() { return !this.muted && this.ctx && this.ctx.state === 'running' }

  _noise({ dur = 0.1, from = 2200, to = 400, gain = 0.5, type = 'lowpass', at = 0 }) {
    if (!this._ready) return
    const t = this.ctx.currentTime + at
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(from, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  _tone({ dur = 0.12, from = 600, to = 120, gain = 0.3, type = 'square', at = 0 }) {
    if (!this._ready) return
    const t = this.ctx.currentTime + at
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(from, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  shot() { this._noise({ dur: 0.09, from: 3200, to: 500, gain: 0.55 }); this._tone({ dur: 0.05, from: 520, to: 160, gain: 0.22 }) }
  robotShot() { this._tone({ dur: 0.14, from: 900, to: 220, gain: 0.25, type: 'sawtooth' }) }
  hitMetal() { this._noise({ dur: 0.07, from: 5200, to: 1400, gain: 0.3, type: 'bandpass' }) }
  hitWall() { this._noise({ dur: 0.05, from: 1600, to: 300, gain: 0.2 }) }
  zap() { // 断肢电火花
    this._tone({ dur: 0.16, from: 1800, to: 90, gain: 0.35, type: 'sawtooth' })
    this._noise({ dur: 0.12, from: 6000, to: 2000, gain: 0.3, type: 'highpass' })
  }
  thud() { this._noise({ dur: 0.1, from: 500, to: 90, gain: 0.4 }) }
  explosion() { // 煤气罐爆炸:低频闷炸+次低音拳头感+起爆尖峰+延后余韵噼啪(替换 thud+zap 的电感基调)
    this._noise({ dur: 0.4, from: 900, to: 55, gain: 0.55, type: 'lowpass' })
    this._tone({ dur: 0.22, from: 160, to: 35, gain: 0.32, type: 'sine' })
    this._noise({ dur: 0.05, from: 5200, to: 1600, gain: 0.4, type: 'highpass' })
    this._noise({ dur: 0.7, from: 700, to: 140, gain: 0.18, type: 'bandpass', at: 0.08 })
  }
  door() { // 液压滑门:气动嘶声+低频到位闷响
    this._noise({ dur: 0.4, from: 1200, to: 200, gain: 0.28 })
    this._tone({ dur: 0.2, from: 140, to: 60, gain: 0.3, type: 'square' })
  }
  console() { // 操作台确认哔(双音上行)
    this._tone({ dur: 0.07, from: 880, to: 1320, gain: 0.18, type: 'sine' })
    this._tone({ dur: 0.12, from: 440, to: 660, gain: 0.12, type: 'sine' })
  }
  checkpoint() { // 检查点轻柔双音铃
    this._tone({ dur: 0.1, from: 660, to: 660, gain: 0.14, type: 'sine' })
    this._tone({ dur: 0.22, from: 990, to: 990, gain: 0.1, type: 'sine' })
  }
  laserSnap() { this._tone({ dur: 0.05, from: 2400, to: 1200, gain: 0.08, type: 'square' }) } // 激光束亮起的电噼声
  gasIgnite() { // 燃气被打漏点燃:噗一声闷响+持续嘶嘶(旧版借用 laserSnap 的电噼声=拿错调色板)
    this._noise({ dur: 0.22, from: 1400, to: 260, gain: 0.34 })
    this._noise({ dur: 0.9, from: 5200, to: 2600, gain: 0.1, type: 'highpass', at: 0.05 })
  }
  siren() { // 封锁警报:双音往返扫频
    this._tone({ dur: 0.55, from: 640, to: 900, gain: 0.055, type: 'triangle' })
    this._tone({ dur: 0.55, from: 900, to: 640, gain: 0.05, type: 'triangle', at: 0.6 })
  }
  warp() { // 敌人刷入的能量闪
    this._tone({ dur: 0.14, from: 1500, to: 320, gain: 0.11, type: 'sine' })
    this._noise({ dur: 0.1, from: 3000, to: 800, gain: 0.09 })
  }
  deny() { // 交互被拒(锁定中)
    this._tone({ dur: 0.07, from: 230, to: 210, gain: 0.16, type: 'square' })
    this._tone({ dur: 0.07, from: 190, to: 170, gain: 0.16, type: 'square', at: 0.09 })
  }
  jump() { this._tone({ dur: 0.09, from: 300, to: 520, gain: 0.12, type: 'sine' }) }
  hurt() { this._tone({ dur: 0.18, from: 400, to: 90, gain: 0.3, type: 'triangle' }) }
  // —— 武器音(基础差异化;R5 按 In2 档案化精做) ——
  weaponSwitch() { // 换枪:机械咔哒两段
    this._noise({ dur: 0.04, from: 3200, to: 1400, gain: 0.18, type: 'bandpass' })
    this._noise({ dur: 0.05, from: 2200, to: 900, gain: 0.22, type: 'bandpass', at: 0.06 })
  }
  shotgunShot() { // 霰弹:宽频重击+低频拳头+泵动咔嚓(延后)
    this._noise({ dur: 0.16, from: 2400, to: 300, gain: 0.6 })
    this._tone({ dur: 0.12, from: 180, to: 60, gain: 0.35, type: 'sine' })
    this._noise({ dur: 0.06, from: 2800, to: 1200, gain: 0.16, type: 'bandpass', at: 0.32 })
  }
  rocketLaunch() { // 火箭:发射噗+持续推进嘶
    this._noise({ dur: 0.12, from: 900, to: 200, gain: 0.4 })
    this._noise({ dur: 0.5, from: 3000, to: 1400, gain: 0.12, type: 'highpass', at: 0.05 })
  }
  cannonShot() { // 超级大炮:次低音炮口暴压+电磁尖啸
    this._noise({ dur: 0.3, from: 1200, to: 80, gain: 0.65 })
    this._tone({ dur: 0.2, from: 120, to: 40, gain: 0.4, type: 'sine' })
    this._tone({ dur: 0.16, from: 2600, to: 700, gain: 0.12, type: 'sawtooth' })
  }
}

export const Sfx = new SfxEngine()
