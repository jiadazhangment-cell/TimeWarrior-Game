import { connect, activate, snap, settleFrames, rafPerSec, consoleSummary, ensureStarted, pumpFrames, snapPumped } from './rt-lib.mjs';
import { mkdirSync } from 'node:fs';

const OUT = 'C:/Users/surpr/AppData/Local/Temp/claude/C--Users-surpr/2743c226-92eb-4124-91ba-2cb7b77bd3a5/scratchpad/rt-shots';
mkdirSync(OUT, { recursive: true });

const c = await connect();
await activate(c);
await settleFrames(c, 10);
const started = await ensureStarted(c);
console.log('start gate cleared:', started);
if (!started) { console.log('ABORT: could not clear start overlay'); process.exit(2); }
await settleFrames(c, 20);

const raf = await rafPerSec(c);
const realtime = raf > 50;
console.log('rAF/s:', raf, realtime ? '(realtime)' : '(throttled -> pump-driven rendering)');

await c.ev(`(() => { const s = window.__tw.scene, cam = s.cameras.main; window.__rtFollow = cam._follow || null; cam.stopFollow(); return 1 })()`);

const POS = [
  ['v06_ra_corridor', 5150, 400],
  ['v07_threshold_ab', 5880, 470],
  ['v08_rb_platforms', 6350, 480],
  ['v09_rb_fan', 6880, 430],
  ['v10_east_console', 7500, 560],
  ['v11_east_wall', 7700, 420],
  ['v12_old_colorstep', 2400, 350],
  ['v13_old_tiles_mid', 1600, 350],
  ['v14_old_west', 700, 350],
  ['v15_threshold_old_ra', 4620, 380],
  ['v16_hive_b1', 3150, 660],
  ['v17_hive_b2', 3450, 950],
  ['v18_hive_b3', 3050, 1240],
  ['v19_hive_shaft_top', 3200, 470],
  ['v20_ra_ditch', 5230, 520],
  ['v21_supply_room', 6060, 600],
];

for (const [name, x, y] of POS) {
  await c.ev(`window.__tw.scene.cameras.main.setScroll(${x - 480}, ${y - 270})`);
  await pumpFrames(c, 6);
  await snapPumped(c, OUT + '/' + name + '.png');
  console.log('shot', name);
}

if (realtime) {
  for (const [name, x] of [['threshold_band', 5850], ['rb_hall', 6500], ['old_zone', 1600]]) {
    await c.ev(`window.__tw.scene.cameras.main.setScroll(${x - 480}, 200)`);
    await settleFrames(c, 10);
    const f = await rafPerSec(c, 2000);
    console.log('FPS @' + name + ':', f);
  }
} else {
  console.log('FPS measurement skipped (window throttled); rerun t1 when game window is foreground');
}

console.log('console:', JSON.stringify(consoleSummary(c)));
c.ws.close();
process.exit(0);
