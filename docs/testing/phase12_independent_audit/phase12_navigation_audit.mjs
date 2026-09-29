// PHASE 12 - independent audit verification of CO-PARENT and SITTER navigation
// through the REAL UI (real login form, real routing, real backend).
//
// This closes the gap the Phase 10 audit recorded as D4/G5: the API could see a
// co-parent's scope, but the screen derived its scope from "jobs I own", so the
// co-parent landed on an empty monitoring screen.
import { Browser } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const TEST_PASSWORD = process.env.LITTLECARE_TEST_PASSWORD;
if (!TEST_PASSWORD) throw new Error('Set LITTLECARE_TEST_PASSWORD for the authorized UI fixture accounts.');

const APP = 'http://127.0.0.1:5173';
const BASE = 'https://localhost:44368/api';
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' :: ' + d : ''}`); };

async function login(username, password) {
  const b = await Browser.attach();
  await b.goto(APP + '/login');
  await sleep(1200);
  const inputs = await b.eval("[...document.querySelectorAll('input')].map(i=>i.type+':'+(i.name||i.id||i.placeholder||''))");
  await b.eval(`(() => {
    const set = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const boxes = [...document.querySelectorAll('input')];
    set(boxes[0], '${username}');
    set(boxes[1], '${password}');
    const btn = [...document.querySelectorAll('button')].find(x => /sign in|log ?in/i.test(x.textContent));
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(2500);
  return b;
}

console.log('=== PHASE 12 CO-PARENT + SITTER NAVIGATION ===');

// ---- Co-parent -------------------------------------------------------------
const co = await login('hina', TEST_PASSWORD);
await co.goto(APP + '/baby-monitoring');
await co.waitFor("document.body.innerText.includes('Monitoring scope')", 25000).catch(() => {});
await co.waitFor("!/Connecting to the baby monitor/.test(document.body.innerText)", 15000).catch(() => {});
const coText = await co.text();
const coScope = coText.match(/Monitoring scope: job (\d+), child ([^.]+)\./);
console.log(`  co-parent scope: ${coScope ? coScope[0] : 'NONE'}`);
check('co-parent reaches an authorized monitoring scope (was empty before Phase 12)',
  !!coScope && coScope[1] === '9001', coScope ? coScope[0] : 'no scope rendered');
check('co-parent sees an honest media state, never a LIVE/HD claim',
  /(not configured|Child Mode|not authorised|Connecting)/i.test(coText) && !/HD 1080p|\bLIVE\b/.test(coText),
  coText.split('\n').filter(l => /video|LIVE|HD 1080p|authorised/i.test(l)).join(' ~ '));
await co.screenshot('e:\\Fyp Fazooliyaaat\\shots\\p12_coparent_monitoring.png');

// ---- Sitter: "View Child" must actually navigate ---------------------------
const sit = await login('sitter4', TEST_PASSWORD);
const dash = await sit.text();
console.log(`  sitter dashboard: ${dash.split('\n').filter(Boolean).slice(0, 4).join(' ~ ')}`);
// Go to the active job screen (the same route the Phase 9 sitter harness uses)
// and press "View Child". The panel only renders while a monitoring session is
// Active, so the fixture must have one.
// The sitter response buttons (Going to Child / View Child / With Child) are
// cry-RESPONSE affordances, so they only render while an incident is active.
// Open one so the button under test actually exists.
const tS = await (await fetch(BASE + '/babysitter/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'sitter4', password: TEST_PASSWORD, role: 'Sitter' }) })).json();
await fetch(BASE + '/monitoring/cry', { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tS.token },
  body: JSON.stringify({ jobId: 9001, childId: 1 }) });
await sit.goto(APP + '/babysitter-my-jobs');
await sleep(2000);
const gotDetails = await sit.clickByText('button', 'View Details');
await sleep(3000);
console.log(`  sitter: ViewDetails=${gotDetails} url=${await sit.eval('location.pathname')}`);
console.log('  sitter page text: ' + (await sit.text()).split('\n').filter(Boolean).slice(0,18).join(' ~ '));
const found = await sit.eval(`[...document.querySelectorAll('button')].some(b => /view child/i.test(b.textContent))`);
check('sitter "View Child" control is present', found === true, `found=${found}`);
if (found) {
  await sit.clickByText('button', 'View Child');
  await sleep(2500);
  const url = await sit.eval('location.pathname');
  const sitText = await sit.text();
  check('"View Child" really navigates to monitoring (was a dead toast)', url === '/baby-monitoring', `url=${url}`);
  check('sitter sees the receive-only / honest media state',
    /Live video is not configured/i.test(sitText), sitText.split('\n').filter(l => /video|authorised/i.test(l)).join(' ~ '));
  check('sitter is NOT offered a pause decision control',
    !/approve pause|deny pause/i.test(sitText), 'no pause controls');
  await sit.screenshot('e:\\Fyp Fazooliyaaat\\shots\\p12_sitter_monitoring.png');
}

console.log(`\nNAV RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
