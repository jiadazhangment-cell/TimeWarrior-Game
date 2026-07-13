// 程序化音效合成器:零素材、零版权,全部 WebAudio 现场合成。
// 必须在用户首次点击后 unlock()(移动端浏览器强制要求)。
class SfxEngine {
  constructor() {
    this.ctx = null
    this.master = null
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
  get _ready() { return this.ctx && this.ctx.state === 'running' }

  _noise({ dur = 0.1, from = 2200, to = 400, gain = 0.5, type = 'lowpass' }) {
    if (!this._ready) return
    const t = this.ctx.currentTime
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

  _tone({ dur = 0.12, from = 600, to = 120, gain = 0.3, type = 'square' }) {
    if (!this._ready) return
    const t = this.ctx.currentTime
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
  jump() { this._tone({ dur: 0.09, from: 300, to: 520, gain: 0.12, type: 'sine' }) }
  hurt() { this._tone({ dur: 0.18, from: 400, to: 90, gain: 0.3, type: 'triangle' }) }
}

export const Sfx = new SfxEngine()
