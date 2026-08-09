import { connect, activate, settleFrames, rafPerSec, ensureStarted, consoleSummary } from './rt-lib.mjs';

let c = await connect();
await c.ev('setTimeout(() => location.reload(), 50); 1');
c.ws.close();
await new Promise(r => setTimeout(r, 7000));

c = await connect();
await settleFrames(c, 8);
if (!await ensureStarted(c)) { console.log('ABORT gate'); process.exit(2); }
console.log('rAF:', await rafPerSec(c, 600));

await c.ev(`(async () => {
  const s = window.__tw.scene;
  const { EventBus } = await import('/src/core/EventBus.js');
  window.__EB = EventBus;
  window.__h = {
    tp(x, y) { window.__tw.teleport(x, y); s.player.vx = 0; s.player.vy = 0; return 1; },
    pin(f) { const i2 = s.input2; if (!i2.__w) { i2.__u = i2.update.bind(i2); i2.__w = true; } i2.update = function () { i2.__u(); Object.assign(i2, i2.__p || {}); }; i2.__p = f; },
    unpin() { const i2 = s.input2; i2.__p = {}; if (i2.__u) i2.update = i2.__u; i2.__w = false; },
    god() { s.player.invulnUntil = s.time.now + 9e9; }
  };
  window.__h.god();
  window.__twFalls = [];
  return 'ok';
})()`, { aw: true });

const R = {};

// #3 蹲姿口袋:预先置蹲 + 直接落位(复刻 E1 仿真的 15 组命中条件姿势)
try {
  R.crouch_pocket = await c.ev(`(() => {
    const s = window.__tw.scene, p = s.player;
    __h.pin({ crouchHeld: true, moveX: 0 });
    p.crouching = true;
    __h.tp(3650, 1630);
    const lp = s.game.loop; let t = lp.now;
    for (let i = 0; i < 20; i++) { t += 16.7; lp.step(t) }
    const settled = { x: Math.round(p.x), y: Math.round(p.y), crouching: p.crouching };
    const ys = [];
    for (let k = 0; k < 3; k++) {
      p.vy = -40;
      for (let i = 0; i < 60; i++) { t += 16.7; lp.step(t) }
      ys.push(Math.round(p.y * 10) / 10);
    }
    __h.unpin();
    return { settled, ys, falls: window.__twFalls.length };
  })()`);
} catch (e) { R.crouch_pocket = 'ERR ' + e.message; }
console.log('crouch_pocket:', JSON.stringify(R.crouch_pocket));

// 风扇终态锁(字符串载荷)
try {
  R.fan_lock = await c.ev(`(() => {
    const s = window.__tw.scene, f = s.bigFans[0];
    if (!f) return 'no fan';
    const lp = s.game.loop; let t = lp.now;
    __EB.emit('devices:event', 'fan:shutdown');
    for (let i = 0; i < 900; i++) { t += 16.7; lp.step(t) }
    const st1 = f.mode || f.state, sp1 = f.speed;
    __EB.emit('breakable:destroyed', 'cab_fan1');
    __EB.emit('breakable:destroyed', 'cab_fan2');
    for (let i = 0; i < 300; i++) { t += 16.7; lp.step(t) }
    return { afterShutdown: { state: st1, speed: Math.round(sp1 * 100) / 100 }, afterBreak: { state: f.mode || f.state, speed: Math.round(f.speed * 100) / 100 } };
  })()`);
} catch (e) { R.fan_lock = 'ERR ' + e.message; }
console.log('fan_lock:', JSON.stringify(R.fan_lock));

console.log('console:', JSON.stringify(consoleSummary(c)));
console.log('RESULT', JSON.stringify(R));
c.ws.close();
process.exit(0);
