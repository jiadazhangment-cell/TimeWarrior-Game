import { connect, settleFrames, rafPerSec, ensureStarted, consoleSummary } from './rt-lib.mjs';

// game.json 已改 godMode:false,vite 会自动整页刷新;等它就绪
await new Promise(r => setTimeout(r, 6000));
const c = await connect();
await settleFrames(c, 8);
if (!await ensureStarted(c)) { console.log('ABORT gate'); process.exit(2); }
console.log('rAF:', await rafPerSec(c, 600));

await c.ev(`(async () => {
  const s = window.__tw.scene;
  const { EventBus } = await import('/src/core/EventBus.js');
  const { SaveStore } = await import('/src/core/SaveStore.js');
  window.__EB = EventBus; window.__SS = SaveStore;
  window.__cnt = { hurt: 0 };
  EventBus.on('player:hurt', () => window.__cnt.hurt++);
  window.__h = {
    tp(x, y) { window.__tw.teleport(x, y); s.player.vx = 0; s.player.vy = 0; return 1; },
    pin(f) { const i2 = s.input2; if (!i2.__w) { i2.__u = i2.update.bind(i2); i2.__w = true; } i2.update = function () { i2.__u(); Object.assign(i2, i2.__p || {}); }; i2.__p = f; },
    unpin() { const i2 = s.input2; i2.__p = {}; if (i2.__u) i2.update = i2.__u; i2.__w = false; }
  };
  return 'ok (godMode=' + (s.player.godMode ?? 'n/a') + ')';
})()`, { aw: true });

const R = {};

// A. 过线封门 + 隐藏检查点落盘
try {
  R.seal = await c.ev(`(() => {
    const s = window.__tw.scene, p = s.player;
    __h.tp(4700, 470);
    __h.pin({ moveX: 1, crouchHeld: false });
    const lp = s.game.loop; let t = lp.now;
    for (let i = 0; i < 150 && p.x < 4790; i++) { t += 16.7; lp.step(t) }
    __h.pin({ moveX: 0 });
    for (let i = 0; i < 30; i++) { t += 16.7; lp.step(t) }
    return { x: Math.round(p.x), sealedA: s._sealedA ?? 'n/a', respawnPoint: s.respawnPoint || 'n/a', hp: p.hp };
  })()`);
} catch (e) { R.seal = 'ERR ' + e.message; }
console.log('seal:', JSON.stringify(R.seal));

// B. 在 R-A 死一次 → 应重生在 4760(门东),而不是 4430(门西)
try {
  R.death_respawn = await c.ev(`(() => {
    const s = window.__tw.scene, p = s.player;
    __h.tp(5000, 470);
    const lp = s.game.loop; let t = lp.now;
    p.hurt(9999);
    for (let i = 0; i < 300; i++) { t += 16.7; lp.step(t) }
    return { respawnX: Math.round(p.x), respawnY: Math.round(p.y), hp: p.hp };
  })()`);
} catch (e) { R.death_respawn = 'ERR ' + e.message; }
console.log('death_respawn:', JSON.stringify(R.death_respawn));

// C. 存档持久化:SaveStore 里应是 cp_seal
try {
  R.save = await c.ev(`(async () => { const v = await __SS.get('progress'); return v })()`, { aw: true });
} catch (e) { R.save = 'ERR ' + e.message; }
console.log('save:', JSON.stringify(R.save));

// D. 检修口口沿站 12s(炮塔不应锁定命中)
try {
  R.turret_lip = await c.ev(`(() => {
    const s = window.__tw.scene, p = s.player;
    __h.tp(5540, 470);
    p.hp = 100;
    window.__cnt.hurt = 0;
    const lp = s.game.loop; let t = lp.now;
    for (let i = 0; i < 720; i++) { t += 16.7; lp.step(t) }
    return { hurtIn12s: window.__cnt.hurt, hp: p.hp };
  })()`);
} catch (e) { R.turret_lip = 'ERR ' + e.message; }
console.log('turret_lip:', JSON.stringify(R.turret_lip));

// E. 蹲行地沟 5 趟,蒸汽命中计数(期望平均 0-1/趟)
try {
  R.steam = await c.ev(`(() => {
    const s = window.__tw.scene, p = s.player;
    const lp = s.game.loop; let t = lp.now;
    const perPass = [];
    for (let pass = 0; pass < 5; pass++) {
      p.hp = 100; p.crouching = true;
      __h.tp(pass % 2 === 0 ? 5110 : 5370, 616);
      __h.pin({ crouchHeld: true, moveX: pass % 2 === 0 ? 1 : -1 });
      window.__cnt.hurt = 0;
      for (let i = 0; i < 240; i++) {
        t += 16.7; lp.step(t);
        if (pass % 2 === 0 ? p.x > 5370 : p.x < 5110) break;
      }
      perPass.push(window.__cnt.hurt);
    }
    __h.unpin();
    return { perPass, total: perPass.reduce((a, b) => a + b, 0) };
  })()`);
} catch (e) { R.steam = 'ERR ' + e.message; }
console.log('steam:', JSON.stringify(R.steam));

// F. 刷新页面 → 应从 cp_seal(4760)复活
try {
  await c.ev('setTimeout(() => location.reload(), 50); 1');
  c.ws.close();
} catch (e) { }
await new Promise(r => setTimeout(r, 8000));
const c2 = await connect();
await settleFrames(c2, 8);
if (!await ensureStarted(c2)) { console.log('reload gate FAIL'); process.exit(2); }
try {
  R.reload_spawn = await c2.ev(`({ x: Math.round(window.__tw.scene.player.x), y: Math.round(window.__tw.scene.player.y) })`);
} catch (e) { R.reload_spawn = 'ERR ' + e.message; }
console.log('reload_spawn:', JSON.stringify(R.reload_spawn));

console.log('RESULT', JSON.stringify(R));
c2.ws.close();
process.exit(0);
