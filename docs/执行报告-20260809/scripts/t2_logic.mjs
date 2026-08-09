import { connect, activate, settleFrames, rafPerSec, ensureStarted, pumpFrames, snapPumped, consoleSummary } from './rt-lib.mjs';

const OUT = 'C:/Users/surpr/AppData/Local/Temp/claude/C--Users-surpr/2743c226-92eb-4124-91ba-2cb7b77bd3a5/scratchpad/rt-shots';
const c = await connect();
await activate(c);
await settleFrames(c, 6);
if (!await ensureStarted(c)) { console.log('ABORT gate'); process.exit(2); }

const raf = await rafPerSec(c, 800);
console.log('rAF/s:', raf);

// 注入 __h(skill 定式:tp 嵌固断言 + 输入钉住 + EventBus 计数器)
await c.ev(`(async () => {
  const s = window.__tw.scene;
  const { EventBus } = await import('/src/core/EventBus.js');
  window.__EB = EventBus;
  window.__cnt = { hurt: 0 };
  EventBus.on('player:hurt', () => window.__cnt.hurt++);
  window.__h = {
    tp(x, y) {
      window.__tw.teleport(x, y); s.player.vx = 0; s.player.vy = 0;
      const cp = s.player.capsule;
      const hit = s.solids.find(o => !o.oneWay && cp.x < o.x + o.w && cp.x + cp.w > o.x && cp.y < o.y + o.h && cp.y + cp.h > o.y);
      if (hit) throw new Error('tp嵌固:' + JSON.stringify({ x, y, hit: { x: hit.x, y: hit.y, w: hit.w, h: hit.h } }));
      return 1;
    },
    pin(fields) {
      const i2 = s.input2;
      if (!i2.__wrapped) { i2.__origUpdate = i2.update.bind(i2); i2.__wrapped = true; }
      i2.update = function () { i2.__origUpdate(); Object.assign(i2, i2.__pinned || {}); };
      i2.__pinned = fields;
    },
    unpin() { const i2 = s.input2; i2.__pinned = {}; if (i2.__origUpdate) i2.update = i2.__origUpdate; i2.__wrapped = false; },
    god() { s.player.invulnUntil = s.time.now + 9e9; }
  };
  window.__h.god();
  return 'harness ok';
})()`, { aw: true });
console.log('harness injected');

const pump = (n) => c.ev(`(() => { const lp = window.__tw.scene.game.loop; let t = lp.now; for (let i = 0; i < ${n}; i++) { t += 16.7; lp.step(t) } return 1 })()`);
const R = {};

// T1 #3 蹲姿口袋(楼梯下 0px 净空)
try {
  R.crouch_pocket = await c.ev(`(() => {
    const s = window.__tw.scene, p = s.player;
    window.__twFalls = [];
    __h.tp(3666, 1630);
    __h.pin({ crouchHeld: true, moveX: 0 });
    const lp = s.game.loop; let t = lp.now;
    for (let i = 0; i < 30; i++) { t += 16.7; lp.step(t) }
    const crouched = p.crouching;
    const ys = [];
    for (let k = 0; k < 3; k++) {
      p.vy = -40; // 霰弹后座竖直分量
      for (let i = 0; i < 60; i++) { t += 16.7; lp.step(t); }
      ys.push(Math.round(p.y * 10) / 10);
    }
    __h.unpin();
    return { crouched, ys, falls: window.__twFalls.length, finalY: p.y };
  })()`);
} catch (e) { R.crouch_pocket = 'ERR ' + e.message; }
console.log('crouch_pocket:', JSON.stringify(R.crouch_pocket));

// T2 #0/#1 击退不穿柜不嵌固(e6 站 1700 一带,向西 -520)
try {
  R.knockback = await c.ev(`(() => {
    const s = window.__tw.scene;
    const e = s.enemies.find(e => e.alive && Math.abs(e.x - 1650) < 200);
    if (!e) return 'no enemy near 1650';
    const lp = s.game.loop; let t = lp.now;
    let minX = e.x, embeds = 0, trace0 = e.x;
    if ('_knockVx' in e) e._knockVx = -520; else e.vx = -520;
    for (let i = 0; i < 240; i++) {
      t += 16.7; lp.step(t);
      minX = Math.min(minX, e.x);
      const half = 18, top = e.y - 118, cx = e.x;
      const hit = s.solids.find(o => !o.oneWay && !o.minor && cx - half < o.x + o.w && cx + half > o.x && top < o.y + o.h && e.y > o.y);
      if (hit && !(hit.pushable)) embeds++;
    }
    return { startX: Math.round(trace0), minX: Math.round(minX), endX: Math.round(e.x), embedFrames: embeds, cab1West: 1502 };
  })()`);
} catch (e) { R.knockback = 'ERR ' + e.message; }
console.log('knockback:', JSON.stringify(R.knockback));

// T3 风扇吸力(回廊东端 6600,无输入净位移)
try {
  R.suction = await c.ev(`(() => {
    const s = window.__tw.scene, p = s.player;
    __h.tp(6600, 380);
    __h.pin({ moveX: 0, crouchHeld: false });
    const lp = s.game.loop; let t = lp.now;
    const x0 = p.x;
    for (let i = 0; i < 180; i++) { t += 16.7; lp.step(t) }
    __h.unpin();
    return { x0: Math.round(x0), x1: Math.round(p.x), dx3s: Math.round(p.x - x0), fanSpeedMode: s.bigFans[0] && (s.bigFans[0].mode || s.bigFans[0].state || 'n/a') };
  })()`);
} catch (e) { R.suction = 'ERR ' + e.message; }
console.log('suction:', JSON.stringify(R.suction));

// T4 风扇终态锁:shutdown 后打爆配电柜不得复活
try {
  R.fan_lock = await c.ev(`(() => {
    const s = window.__tw.scene, f = s.bigFans[0];
    if (!f) return 'no fan';
    const lp = s.game.loop; let t = lp.now;
    __EB.emit('fan:shutdown');
    for (let i = 0; i < 600; i++) { t += 16.7; lp.step(t) }
    const stateAfterShutdown = f.mode || f.state, speedAfter = f.speed;
    __EB.emit('breakable:destroyed', { id: 'cab_fan1' });
    __EB.emit('breakable:destroyed', { id: 'cab_fan2' });
    for (let i = 0; i < 300; i++) { t += 16.7; lp.step(t) }
    return { stateAfterShutdown, speedAfter: Math.round(speedAfter * 100) / 100, stateAfterBreak: f.mode || f.state, speedAfterBreak: Math.round(f.speed * 100) / 100 };
  })()`);
} catch (e) { R.fan_lock = 'ERR ' + e.message; }
console.log('fan_lock:', JSON.stringify(R.fan_lock));

// T5 #22 HUD 空仓变红(rpg/supercannon reserve→0,截 HUD 角)
try {
  R.hud = await c.ev(`(() => {
    const s = window.__tw.scene, w = s.weapons;
    const keys = Object.keys(w.ammo);
    for (const k of keys) if (k === 'rpg' || k === 'supercannon') { w.ammo[k].reserve = 0; }
    __EB.emit('ammo:changed', { key: w.key, mag: w.ammo[w.key].mag, reserve: w.ammo[w.key].reserve, all: w.ammo });
    return { keys, rpg: w.ammo.rpg, supercannon: w.ammo.supercannon };
  })()`);
  await pump(6);
  await snapPumped(c, OUT + '/t2_hud_empty.png');
} catch (e) { R.hud = 'ERR ' + e.message; }
console.log('hud:', JSON.stringify(R.hud));

// T6 预置补给 FIFO 保护(fixed 不被挤掉)
try {
  R.drops = await c.ev(`(() => {
    const s = window.__tw.scene, d = s.drops;
    const arr = d.items || d._items || d.list;
    if (!arr) return 'no items array; keys=' + Object.keys(d).join(',');
    const fixedBefore = arr.filter(i => i.fixed).length, totalBefore = arr.length;
    for (let i = 0; i < 50; i++) d._spawn && d._spawn('ammo', 1000 + i * 5, 400, 'rifle');
    const fixedAfter = arr.filter(i => i.fixed).length;
    return { fixedBefore, totalBefore, fixedAfter, totalAfter: arr.length };
  })()`);
} catch (e) { R.drops = 'ERR ' + e.message; }
console.log('drops:', JSON.stringify(R.drops));

// T7 封锁战炮塔(最后跑,污染大):触发 lockdown → 4413 扇区朝下 + B2 面板 12s 零命中
try {
  R.turret = await c.ev(`(() => {
    const s = window.__tw.scene;
    __h.tp(3150, 758);
    const lp = s.game.loop; let t = lp.now;
    for (let i = 0; i < 120; i++) { t += 16.7; lp.step(t) }
    const ld = s.lockdown;
    const active = ld && (ld.state || ld.active);
    const turr = (ld && ld.turretObjs) || (ld && ld._turrets) || s.turrets;
    __h.tp(4225, 1048);
    __h.god();
    window.__cnt.hurt = 0;
    for (let i = 0; i < 720; i++) { t += 16.7; lp.step(t) }
    return { lockdownState: String(active), hurtIn12s: window.__cnt.hurt, note: 'godMode on, hurt 事件仍会计数' };
  })()`);
  await snapPumped(c, OUT + '/t2_turret_4413.png');
} catch (e) { R.turret = 'ERR ' + e.message; }
console.log('turret:', JSON.stringify(R.turret));

console.log('console:', JSON.stringify(consoleSummary(c)));
console.log('RESULT', JSON.stringify(R));
c.ws.close();
process.exit(0);
