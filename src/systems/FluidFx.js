// GPU 实时流体爆炸(2D stable fluids + 燃料/温度/烟三场燃烧模型)。
// 观感规格 = tools/fluid-lab.html v9(用户逐轮拍板定版:产生/形态/消失速度);
// 事实基准 = docs/流体爆炸调研/(真实爆炸拆解/游戏爆炸拆解/VFX原则,含德雷伯点与 Metal Slug 实测);
// 集成路线 = docs/流体爆炸调研/集成路径.md 路径①′:
//   模拟 pass 全走 Phaser wrapper API(glWrapper/glTextureUnits/createProgram/createTexture2D/
//   createFramebuffer)=GL 状态零污染+上下文丢失自动恢复;顶点用 gl_VertexID 生成全屏三角形
//   (零 VBO/VAO);唯一 hack=实例覆盖 _processTexture 拿半浮点纹理(Phaser 全部纹理写死 RGBA8)。
// 需要 WebGL2+EXT_color_buffer_float(main.js 注入);不可用时 this.ok=false,调用方回退序列帧。
import Phaser from 'phaser'

const SIM = 128            // 模拟网格(方形;调研推荐 96-128)
const DOMAIN = 640         // 模拟域的世界尺寸(px):火球直径 ~256 + 烟升腾余量
const ORIGIN_V = 0.30      // 爆点在域内高度(v,y向上):下 1/3 处,上方留给烟
const POOL = 4             // 并发爆炸域(气瓶连锁最多 3)

const VS = `#version 300 es
out vec2 uv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0, 1);
}`
const HEAD = `#version 300 es
precision highp float; in vec2 uv; out vec4 O;
uniform vec2 texel; uniform sampler2D obs;
float solid(vec2 p){ return texture(obs, p).r; }`

// —— 着色器源(与 fluid-lab v9 逐参数一致;uv v=0=域底,y 向上)——
const FS = {
  advectVel: HEAD + `
uniform sampler2D velT; uniform float dt; uniform float diss;
void main(){
  if (solid(uv) > 0.5) { O = vec4(0); return; }
  vec2 back = uv - dt * texture(velT, uv).xy;
  O = vec4(texture(velT, back).xy * diss, 0, 1);
}`,
  advectMat: HEAD + `
uniform sampler2D velT; uniform sampler2D matT; uniform float dt;
uniform float kFuel; uniform float cooling;
void main(){
  if (solid(uv) > 0.5) { O = vec4(0); return; }
  vec2 back = uv - dt * texture(velT, uv).xy;
  if (solid(back) > 0.5) back = uv;
  vec4 m = texture(matT, back);
  float fuel = m.r, temp = m.g, smoke = m.b;
  float fuel2 = fuel * exp(-kFuel * dt);
  smoke += (fuel - fuel2) * 1.1;
  temp = max(temp - dt * cooling * pow(max(temp, 0.0), 4.0), fuel2);
  smoke *= exp(-2.6 * dt);
  O = vec4(fuel2, temp, smoke, 1);
}`,
  curl: HEAD + `
uniform sampler2D velT;
void main(){
  float L = texture(velT, uv - vec2(texel.x, 0)).y, R = texture(velT, uv + vec2(texel.x, 0)).y;
  float B = texture(velT, uv - vec2(0, texel.y)).x, T = texture(velT, uv + vec2(0, texel.y)).x;
  O = vec4(0.5 * ((R - L) - (T - B)), 0, 0, 1);
}`,
  forces: HEAD + `
uniform sampler2D velT; uniform sampler2D matT; uniform sampler2D crlT; uniform float dt; uniform float vort; uniform float time;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + time) * 43758.5453); }
void main(){
  if (solid(uv) > 0.5) { O = vec4(0); return; }
  vec2 v = texture(velT, uv).xy;
  vec4 m = texture(matT, uv);
  v.y += dt * (m.g * 0.6 - m.b * 0.05 + m.b * 0.14);
  float L = texture(crlT, uv - vec2(texel.x, 0)).r, R = texture(crlT, uv + vec2(texel.x, 0)).r;
  float B = texture(crlT, uv - vec2(0, texel.y)).r, T = texture(crlT, uv + vec2(0, texel.y)).r;
  float c = texture(crlT, uv).r * (0.8 + 0.5 * hash(uv * 37.0));
  vec2 grad = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  grad = grad / (length(grad) + 1e-5);
  v += dt * vort * vec2(grad.x, -grad.y) * c;
  O = vec4(v, 0, 1);
}`,
  divergence: HEAD + `
uniform sampler2D velT;
vec2 vAt(vec2 p){ return solid(p) > 0.5 ? vec2(0) : texture(velT, p).xy; }
void main(){
  vec2 L = vAt(uv - vec2(texel.x, 0)), R = vAt(uv + vec2(texel.x, 0));
  vec2 B = vAt(uv - vec2(0, texel.y)), T = vAt(uv + vec2(0, texel.y));
  O = vec4(0.5 * (R.x - L.x + T.y - B.y), 0, 0, 1);
}`,
  decay: HEAD + `
uniform sampler2D srcT; uniform float k;
void main(){ O = texture(srcT, uv) * k; }`,
  jacobi: HEAD + `
uniform sampler2D prsT; uniform sampler2D divT;
float pAt(vec2 p, float c){ return solid(p) > 0.5 ? c : texture(prsT, p).r; }
void main(){
  float c = texture(prsT, uv).r;
  float L = pAt(uv - vec2(texel.x, 0), c), R = pAt(uv + vec2(texel.x, 0), c);
  float B = pAt(uv - vec2(0, texel.y), c), T = pAt(uv + vec2(0, texel.y), c);
  O = vec4((L + R + B + T - texture(divT, uv).r) * 0.25, 0, 0, 1);
}`,
  project: HEAD + `
uniform sampler2D velT; uniform sampler2D prsT;
float pAt(vec2 p, float c){ return solid(p) > 0.5 ? c : texture(prsT, p).r; }
void main(){
  if (solid(uv) > 0.5) { O = vec4(0); return; }
  float c = texture(prsT, uv).r;
  float L = pAt(uv - vec2(texel.x, 0), c), R = pAt(uv + vec2(texel.x, 0), c);
  float B = pAt(uv - vec2(0, texel.y), c), T = pAt(uv + vec2(0, texel.y), c);
  O = vec4(texture(velT, uv).xy - 0.5 * vec2(R - L, T - B), 0, 1);
}`,
  splat: HEAD + `
uniform sampler2D srcT; uniform vec2 pt; uniform vec3 amount; uniform float radius; uniform float velAdd; uniform float seed;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + seed) * 43758.5453); }
void main(){
  vec4 c = texture(srcT, uv);
  vec2 d = uv - pt;
  float n = 0.55 + 0.9 * hash(uv * 53.0);
  float g = exp(-dot(d, d) / (radius * radius)) * n;
  if (solid(uv) > 0.5) { O = c; return; }
  // 遮挡注入:爆点到目标点之间有固体=不注入(高斯尾巴会穿过地面板在地下空腔点火,踩过——
  // 走道下机械带冒出一条杂火);8 步线采样在 128 网格上步距 ~几格,足够密
  float occ = 0.0;
  for (int i = 1; i <= 8; i++) occ = max(occ, solid(mix(pt, uv, float(i) / 8.0)));
  if (occ > 0.5) { O = c; return; }
  if (velAdd > 0.0) {
    vec2 dir = length(d) > 1e-5 ? normalize(d) : vec2(0, 1);
    O = vec4(c.xy + dir * velAdd * g, 0, 1);
  } else {
    O = vec4(max(c.r, amount.x * g), max(c.g, amount.y * g), c.b + amount.z * g, 1);
  }
}`,
  // present:黑底合成 → premultiplied alpha(Phaser 混合 (ONE, ONE_MINUS_SRC_ALPHA)):
  // 火=纯加光(alpha≈0),烟=半透明遮挡(alpha=烟浓度)
  present: HEAD + `
uniform sampler2D matT; uniform float time;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
vec3 blackbody(float t){
  vec3 c = vec3(0);
  c.r = smoothstep(0.0, 0.15, t) * 1.12;
  c.g = smoothstep(0.20, 0.66, t) * 0.98;
  c.b = smoothstep(0.62, 1.08, t) * 0.92;
  return c;
}
void main(){
  // 不做任何翻转:实证(两轮对照)整条链 FBO→addGLTexture→Image 的隐式翻转正好抵消,
  // 场 v=0(域底)最终就画在 Image 底;加 setFlipY 或 shader 翻 v 都会把火倒挂到域顶(都踩过)
  vec4 m = texture(matT, uv);
  float t = m.g;
  float n = vnoise(uv * vec2(46.0, 26.0) + vec2(0.0, -time * 0.35)) * 0.55
          + vnoise(uv * vec2(115.0, 65.0) + vec2(time * 0.2, -time * 0.7)) * 0.3;
  float tt = t * (0.72 + 0.62 * n);
  float vis = smoothstep(0.40, 0.56, tt);
  float ttq = floor(tt * 5.0 + 0.5) / 5.0;
  vec3 fire = blackbody(ttq) * (0.9 + 0.5 * ttq) * vis;
  float smoke = clamp(m.b * 0.34 * (0.75 + 0.5 * n), 0.0, 0.8);
  fire *= exp(-smoke * 0.4);
  float smokeA = smoke * (1.0 - vis * 0.85);
  vec3 col = vec3(0.215, 0.21, 0.205) * smokeA + fire;
  O = vec4(col, smokeA);
}`,
}

export class FluidFx {
  constructor(scene) {
    this.scene = scene
    const renderer = scene.game.renderer
    this.renderer = renderer
    const gl = renderer.gl
    this.ok = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext &&
      !!gl.getExtension('EXT_color_buffer_float')
    if (!this.ok) return
    this.gl = gl
    this.canLinear = !!gl.getExtension('OES_texture_float_linear')

    // 编译全部 program(walker API,入 glProgramWrappers=上下文丢失自动重建)
    this.progs = {}
    for (const [k, fs] of Object.entries(FS)) this.progs[k] = renderer.createProgram(VS, fs)

    // 域池
    this.domains = []
    for (let i = 0; i < POOL; i++) this.domains.push(this._makeDomain(i))
    this._seed = 1
  }

  // —— 半浮点渲染目标(唯一 hack 点:覆盖实例 _processTexture)——
  _makeFloatTarget() {
    const { renderer, gl } = this
    const filter = this.canLinear ? gl.LINEAR : gl.NEAREST
    const tex = renderer.createTexture2D(0, filter, filter, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE,
      gl.RGBA, null, SIM, SIM, true, true, false)
    tex._processTexture = function () {
      const g = this.renderer.gl
      // 绑定走 units wrapper(缓存真实),再发原生 texImage2D——唯一必须的裸上传
      this.renderer.glTextureUnits.bind(this, 0)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, filter)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, filter)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA16F, SIM, SIM, 0, g.RGBA, g.HALF_FLOAT, null)
    }
    tex._processTexture()
    const fb = renderer.createFramebuffer(tex, false, false)
    return { tex, fb }
  }
  _makeDisplayTarget(size) {
    const { renderer, gl } = this
    const tex = renderer.createTexture2D(0, gl.LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE,
      gl.RGBA, null, size, size, true, true, false)
    const fb = renderer.createFramebuffer(tex, false, false)
    return { tex, fb }
  }

  _makeDomain(i) {
    const mk = () => this._makeFloatTarget()
    const d = {
      vel: { a: mk(), b: mk() }, mat: { a: mk(), b: mk() }, prs: { a: mk(), b: mk() },
      div: mk(), crl: mk(),
      out: this._makeDisplayTarget(256),
      obsCv: document.createElement('canvas'), obsTex: null,
      active: false, age: 0, cx: 0, cy: 0,
      img: null, key: 'fluidfx' + i,
    }
    d.obsCv.width = SIM; d.obsCv.height = SIM
    // 显示纹理注册为 Phaser 纹理(一次性;present 每帧渲进同一张 out.tex,Image 引用恒定)
    this.scene.textures.addGLTexture(d.key, d.out.tex)
    d.img = this.scene.add.image(0, 0, d.key).setDepth(41)
      .setDisplaySize(DOMAIN, DOMAIN).setVisible(false) // 上下翻转在 present shader 内处理
    return d
  }

  // —— pass 执行:全走 wrapper 缓存;唯一裸调用 drawArrays(无状态副作用)——
  // program 绑定必须交给 prog.bind()(内部 updateBindingsProgram(this.glState) 用正确的内部状态对象;
  // 往 glWrapper.update 的 bindings.program 塞 wrapper 类型不符=useProgram 从未执行,所有 pass 零输出——踩过)
  _run(progKey, target, setup, texturesByUnit) {
    const { renderer, gl } = this
    const prog = this.progs[progKey]
    // 状态形状陷阱(全部踩过,均为静默失败):
    // ① viewport 是数组 [x,y,w,h] 不是对象(传对象=gl.viewport 全 undefined=光栅化零像素);
    // ② **绝不能 blend:{enabled:false}**——Phaser 批渲染设置混合时只传 func/equation 从不写 enabled,
    //    关掉后永远没人再打开:场景里的半透明暗角在无混合下变成不透明黑板盖死全世界(HUD 在其后画
    //    所以幸存)。等效替代=保持 enabled:true 但 func 设 (ONE,ZERO)=覆写语义,batch 每次重设 func
    //    会自愈;③ blend.func 是四元数组 [srcRGB,dstRGB,srcA,dstA],scissor 的开关又叫 enable(不统一)
    renderer.glWrapper.update({
      bindings: { framebuffer: target.fb },
      viewport: [0, 0, target.tex.width, target.tex.height],
      blend: { enabled: true, func: [gl.ONE, gl.ZERO, gl.ONE, gl.ZERO] },
      scissor: { enable: false },
      vao: null,
    })
    prog.setUniform('texel', [1 / SIM, 1 / SIM])
    setup(prog)
    prog.bind() // 绑 program + 应用排队的 uniform
    for (const [unit, texWrapper] of texturesByUnit) renderer.glTextureUnits.bind(texWrapper, unit)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  _splat(d, pt, amount, radius, velKick) {
    const seed = (this._seed = (this._seed * 16807) % 2147483647) / 2147483647 * 100
    this._run('splat', d.mat.b, (p) => {
      p.setUniform('srcT', 0); p.setUniform('obs', 7)
      p.setUniform('pt', [pt.x, pt.y]); p.setUniform('amount', [amount[0], amount[1], amount[2]])
      p.setUniform('radius', radius); p.setUniform('velAdd', 0); p.setUniform('seed', seed)
    }, [[0, d.mat.a.tex], [7, d.obsTex]])
    ;[d.mat.a, d.mat.b] = [d.mat.b, d.mat.a]
    if (velKick) {
      this._run('splat', d.vel.b, (p) => {
        p.setUniform('srcT', 0); p.setUniform('obs', 7)
        p.setUniform('pt', [pt.x, pt.y]); p.setUniform('amount', [0, 0, 0])
        p.setUniform('radius', radius * 1.5); p.setUniform('velAdd', velKick); p.setUniform('seed', seed + 7)
      }, [[0, d.vel.a.tex], [7, d.obsTex]])
      ;[d.vel.a, d.vel.b] = [d.vel.b, d.vel.a]
    }
  }

  // 爆炸入口。(x,y)=爆点世界坐标;power 缩放半径;groundY=贴地爆的地面线(null=半空)
  boom(x, y, power = 1, groundY = null) {
    if (!this.ok) return false
    if (groundY != null && groundY - y < 120 * power) y = groundY - 8 // 贴地爆:爆点贴在地面上方
    // 取一个空闲域(全忙=复用最老的)
    let d = this.domains.find((q) => !q.active)
    if (!d) d = this.domains.reduce((a, b) => (a.age > b.age ? a : b))
    d.active = true; d.age = 0; d.cx = x; d.cy = y
    // 清场
    for (const t of [d.vel.a, d.vel.b, d.mat.a, d.mat.b, d.prs.a, d.prs.b]) this._clear(t)
    // 障碍物:域内实体(非 oneWay/pushable/minor)光栅化——爆炸火焰会被墙/楼板/箱子真实挡住
    const left = x - DOMAIN / 2, top = y - (1 - ORIGIN_V) * DOMAIN
    const c = d.obsCv.getContext('2d')
    c.clearRect(0, 0, SIM, SIM)
    c.fillStyle = '#fff'
    for (const o of this.scene.solids) {
      if (o.oneWay || o.pushable || o.minor) continue
      if (o.x > left + DOMAIN || o.x + o.w < left || o.y > top + DOMAIN || o.y + o.h < top) continue
      c.fillRect((o.x - left) / DOMAIN * SIM, (o.y - top) / DOMAIN * SIM,
        Math.max(1, o.w / DOMAIN * SIM), Math.max(1, o.h / DOMAIN * SIM))
    }
    if (d.obsTex) this.renderer.deleteTexture(d.obsTex)
    // flipY=true:canvas 行0=域顶 → 纹理 v=0=域底(与模拟场 y-up 一致)
    d.obsTex = this.renderer.createTexture2D(0, this.gl.NEAREST, this.gl.NEAREST,
      this.gl.CLAMP_TO_EDGE, this.gl.CLAMP_TO_EDGE, this.gl.RGBA, d.obsCv, SIM, SIM, true, false, true)
    // 注入(v9 定版):燃料直接铺到最终半径+全域白闪+椰菜花 5 簇;冲量只用于撕形。
    // R=0.13:高斯 σ 的视觉火球≈2.5R,0.13×640≈直径 210 世界px ≈ BOOM_R130 的爆压圈(0.20 时
    // 火撑满整条走廊断面读作矩形块,踩过)
    const R = 0.13 * Math.sqrt(power)
    const pt = { x: 0.5, y: ORIGIN_V }
    this._splat(d, pt, [1.0, 0, 0.06 * power], R, 1.1 * power)
    this._splat(d, pt, [0, 2.6, 0], R * 0.95, 0)
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, dist = R * (0.55 + Math.random() * 0.5)
      this._splat(d, { x: pt.x + Math.cos(a) * dist * 0.62, y: pt.y + Math.sin(a) * dist },
        [0.85, 0, 0], R * 0.42, 0)
    }
    // 显示件就位
    d.img.setPosition(x, top + DOMAIN / 2).setVisible(true)
    return true
  }

  _clear(t) {
    const { renderer, gl } = this
    renderer.glWrapper.update({
      bindings: { framebuffer: t.fb },
      colorClearValue: [0, 0, 0, 1],
      scissor: { enable: false },
    })
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  update(dt) {
    if (!this.ok) return
    const now = this.scene.time.now
    for (const d of this.domains) {
      if (!d.active) continue
      d.age += dt
      if (d.age > 1.6) { d.active = false; d.img.setVisible(false); continue } // v9:火0.64s+烟~1.2s
      const clampDt = Math.min(dt, 1 / 30)
      const obs = [7, d.obsTex]
      // 平流速度(急刹车 9/s=v9 节奏定版)
      this._run('advectVel', d.vel.b, (p) => {
        p.setUniform('velT', 0); p.setUniform('obs', 7)
        p.setUniform('dt', clampDt); p.setUniform('diss', Math.exp(-9.0 * clampDt))
      }, [[0, d.vel.a.tex], obs]); [d.vel.a, d.vel.b] = [d.vel.b, d.vel.a]
      // 平流物质+燃烧(kFuel 4.2/cooling 6=v9 消失提速定版)
      this._run('advectMat', d.mat.b, (p) => {
        p.setUniform('velT', 0); p.setUniform('matT', 1); p.setUniform('obs', 7)
        p.setUniform('dt', clampDt); p.setUniform('kFuel', 4.2); p.setUniform('cooling', 6.0)
      }, [[0, d.vel.a.tex], [1, d.mat.a.tex], obs]); [d.mat.a, d.mat.b] = [d.mat.b, d.mat.a]
      // 涡度
      this._run('curl', d.crl, (p) => { p.setUniform('velT', 0); p.setUniform('obs', 7) },
        [[0, d.vel.a.tex], obs])
      // 浮力+涡度力
      this._run('forces', d.vel.b, (p) => {
        p.setUniform('velT', 0); p.setUniform('matT', 1); p.setUniform('crlT', 2); p.setUniform('obs', 7)
        p.setUniform('dt', clampDt); p.setUniform('vort', 15.0); p.setUniform('time', now * 0.001)
      }, [[0, d.vel.a.tex], [1, d.mat.a.tex], [2, d.crl.tex], obs]); [d.vel.a, d.vel.b] = [d.vel.b, d.vel.a]
      // 散度
      this._run('divergence', d.div, (p) => { p.setUniform('velT', 0); p.setUniform('obs', 7) },
        [[0, d.vel.a.tex], obs])
      // 压力(热启动 ×0.8=调研两个参考项目的共识值)
      this._run('decay', d.prs.b, (p) => { p.setUniform('srcT', 0); p.setUniform('obs', 7); p.setUniform('k', 0.8) },
        [[0, d.prs.a.tex], obs]); [d.prs.a, d.prs.b] = [d.prs.b, d.prs.a]
      for (let i = 0; i < 22; i++) {
        this._run('jacobi', d.prs.b, (p) => { p.setUniform('prsT', 0); p.setUniform('divT', 1); p.setUniform('obs', 7) },
          [[0, d.prs.a.tex], [1, d.div.tex], obs]); [d.prs.a, d.prs.b] = [d.prs.b, d.prs.a]
      }
      this._run('project', d.vel.b, (p) => { p.setUniform('velT', 0); p.setUniform('prsT', 1); p.setUniform('obs', 7) },
        [[0, d.vel.a.tex], [1, d.prs.a.tex], obs]); [d.vel.a, d.vel.b] = [d.vel.b, d.vel.a]
      // present → 固定显示纹理(Image 引用恒定)
      this._run('present', d.out, (p) => {
        p.setUniform('matT', 0); p.setUniform('obs', 7); p.setUniform('time', now * 0.001)
      }, [[0, d.mat.a.tex], obs])
    }
    // 收尾复位(官方 RebindContext 同款):全量强制重发缓存状态+清空纹理单元——
    // 把"wrapper 缓存 vs 真实 GL"的任何脱钩抹平,主渲染以干净状态接手(~30 个 GL 调用,可忽略)
    if (this.domains.some((d) => d.active)) {
      this.renderer.glWrapper.update(undefined, true)
      this.renderer.glTextureUnits.unbindAllUnits()
    }
  }
}
