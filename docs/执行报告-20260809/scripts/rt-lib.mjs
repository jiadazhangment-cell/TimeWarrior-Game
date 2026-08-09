import { writeFileSync } from 'node:fs';

export async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const t = list.find(x => x.url.startsWith('http://localhost:5173'));
  if (!t) throw new Error('no game tab');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const ev = async (expr, opts = {}) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!opts.aw, timeout: opts.timeout ?? 60000 });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) throw new Error('page exception: ' + (ex.exception && ex.exception.description || ex.text));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  return { ws, send, ev, events, targetId: t.id };
}

export async function activate(c) {
  await fetch('http://127.0.0.1:9222/json/activate/' + c.targetId);
}

export async function click(c, x = 200, y = 300) {
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

export async function ensureStarted(c) {
  for (let i = 0; i < 30; i++) {
    const st = await c.ev(`window.__tw ? (window.__tw.scene.input2.enabled ? 'on' : 'gate') : 'boot'`);
    if (st === 'on') return true;
    if (st === 'gate') await click(c, 200, 300);
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

export async function snap(c, file) {
  let dataUrl = await c.ev(`new Promise(r => { try { window.__tw.scene.game.renderer.snapshot(img => r(img.src)) } catch (e) { r('ERR:' + e.message) } })`, { aw: true });
  if (!dataUrl || dataUrl.startsWith('ERR:') || dataUrl.length < 1000) {
    dataUrl = await c.ev(`new Promise(r => { const g = window.__tw.scene.game; g.events.once('postrender', () => r(g.canvas.toDataURL('image/png'))); })`, { aw: true });
  }
  if (!dataUrl || dataUrl.length < 1000) throw new Error('snapshot failed for ' + file);
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
}

export async function settleFrames(c, n = 8) {
  await c.ev(`new Promise(r => { let n = 0; const f = () => { ++n >= ${n} ? r(1) : requestAnimationFrame(f) }; requestAnimationFrame(f) })`, { aw: true });
}

export async function pumpFrames(c, n = 4) {
  await c.ev(`(() => { const lp = window.__tw.scene.game.loop; let t = lp.now; for (let i = 0; i < ${n}; i++) { t += 16.7; lp.step(t) } return 1 })()`);
}

export async function snapPumped(c, file) {
  const dataUrl = await c.ev(`new Promise(r => {
    const g = window.__tw.scene.game;
    g.renderer.snapshot(img => r(img.src));
    const lp = g.loop; let t = lp.now;
    for (let i = 0; i < 3; i++) { t += 16.7; lp.step(t) }
  })`, { aw: true, timeout: 20000 });
  if (!dataUrl || dataUrl.length < 1000) throw new Error('pumped snapshot failed for ' + file);
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
}

export async function rafPerSec(c, ms = 1000) {
  return await c.ev(`(async () => { const t0 = performance.now(); let k = 0; await new Promise(r => { const f = () => { k++; performance.now() - t0 < ${ms} ? requestAnimationFrame(f) : r() }; requestAnimationFrame(f) }); return Math.round(k * 1000 / ${ms}) })()`, { aw: true });
}

export function consoleSummary(c) {
  const errs = c.events.filter(m => m.method === 'Runtime.exceptionThrown');
  const capi = c.events.filter(m => m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type));
  return {
    exceptions: errs.length,
    consoleErrWarn: capi.length,
    samples: capi.slice(0, 5).map(m => m.params.type + ': ' + (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 160))
  };
}
