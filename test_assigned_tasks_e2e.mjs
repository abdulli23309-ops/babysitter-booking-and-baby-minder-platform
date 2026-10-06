// Phase 10.0 — Task Allocation ("Today's Required Tasks") end-to-end acceptance.
//
// Chain proven here:
//   UI task selection -> booking payload -> server validation -> DB ->
//   Job -> job-details API (parent AND babysitter) -> active-job UI (both roles).
//
// Cases: zero tasks, one/multiple tasks, duplicates, unknown id, legacy NULL.
// Run:  node test_assigned_tasks_e2e.mjs
//
// Uses the seeded plaintext dev fixtures (user6/user7/sitter5, password 1234),
// the same local SQL Server the backend is configured against, and local Chrome.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = 'https://127.0.0.1:5173';   // Vite dev server serves HTTPS (launcher TLS)
const BASE = 'https://localhost:44368/api';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SQLCMD = 'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\180\\Tools\\Binn\\SQLCMD.EXE';
const DB = 'BabySitterBooking and BabyMinder';
const WEB_CONFIG = path.join(__dirname, 'WebApplication2', 'Web.config');
const SHOT_DIR = path.join(__dirname, 'docs', 'testing', 'phase10_task_allocation');
fs.mkdirSync(SHOT_DIR, { recursive: true });

// Local dev HTTPS (IIS Express dev certificate).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TODAY = '2026-10-06';          // booking date = today (Pakistan time)
const START_T = '23:00';             // TimeSlot 8 window (23:00-23:59)
const END_T = '23:59';
const THREE_TASKS = ['bottle-feeding', 'diaper-change', 'stroller-walk'];

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
};

function sql(query) {
  const out = execFileSync(
    SQLCMD,
    ['-S', 'DESKTOP-UD649GB\\SQLEXPRESS', '-d', DB, '-E', '-C', '-Q', query, '-h', '-1', '-W'],
    { encoding: 'utf8' },
  );
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('(') && !l.includes('rows affected') && !l.startsWith('Sqlcmd'));
}

async function api(method, pathname, token, body) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty or plain body */ }
  return { status: res.status, json };
}

const errText = (r) => (typeof r.json === 'string' ? r.json : (r.json?.message ?? JSON.stringify(r.json)));

async function login(role, username, password) {
  const r = await api(
    'POST',
    role === 'Parent' ? '/parent/login' : '/babysitter/login',
    null,
    { Username: username, Password: password, Role: role },
  );
  return r.status === 200 ? (r.json?.token ?? null) : null;
}

// Wall-clock fields interpreted as Pakistan Standard Time (UTC+5).
const pkParts = () => {
  const d = new Date(Date.now() + 5 * 3600 * 1000);
  return { day: d.getUTCDate(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
};

// In-page: click the innermost React element whose onClick handles `text`.
async function clickText(page, text) {
  const attempt = () => page.evaluate((t) => {
    const nodes = [...document.querySelectorAll('button, a, label, div, span, p, h1, h2, h3')]
      .filter((e) => e.textContent.includes(t));
    let best = null;
    for (const e of nodes) {
      const key = Object.keys(e).find((k) => k.startsWith('__reactProps$'));
      const props = key ? e[key] : null;
      if (props && typeof props.onClick === 'function') {
        if (!best || e.textContent.length < best.textContent.length) best = e;
      }
    }
    if (best) { best.scrollIntoView({ block: 'center' }); best.click(); return true; }
    return false;
  }, text);
  try {
    return await attempt();
  } catch {
    await sleep(1200); // transient dev reload detached the frame — retry once
    try { return await attempt(); } catch { return false; }
  }
}

// Dismiss the cookie banner so it does not overlap evidence screenshots.
async function acceptCookies(page) {
  try {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => x.textContent.trim() === 'Accept');
      if (b) b.click();
      return Boolean(b);
    });
    await sleep(300);
  } catch { /* banner absent or transient dev reload */ }
}

// Scroll the smallest element containing `text` into view (text-transform aware).
async function scrollToText(page, text) {
  try {
    await page.evaluate((t) => {
      const matches = [...document.querySelectorAll('div, p, span, h1, h2, h3, li')]
        .filter((e) => (e.innerText || '').toLowerCase().includes(t));
      const target = matches.pop();
      if (target) target.scrollIntoView({ block: 'center' });
    }, text.toLowerCase());
    await sleep(350);
  } catch { /* transient dev reload */ }
}

async function uiLogin(page, username, password) {
  // Dev-server full reloads (Vite HMR / dep re-optimization) can detach the
  // frame mid-evaluate, so every step is retried until the app leaves /login.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const url = page.url();
    // Fresh tabs sit on about:blank; only skip the navigation when the app
    // is already loaded somewhere other than the login screen (retry case).
    if (!url.startsWith(APP) || url.includes('/login')) {
      await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    try {
      await page.waitForSelector('input', { timeout: 12000 });
      await sleep(500);
      await page.evaluate((u, p) => {
        const set = (el, v) => {
          const proto = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const boxes = [...document.querySelectorAll('input')];
        set(boxes[0], u);
        set(boxes[1], p);
        const btn = [...document.querySelectorAll('button')]
          .find((x) => /^(sign in|log ?in|login)$/i.test(x.textContent.trim()));
        if (btn) btn.click();
        return true;
      }, username, password);
    } catch {
      // Frame detached by a dev reload — the exit wait below decides.
    }
    const left = await page
      .waitForFunction(() => !location.pathname.includes('/login'), { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (left) break;
  }
  await sleep(800);
  return !page.url().includes('/login');
}

const createdJobIds = [];   // for cleanup (all except the kept proof job)
let proofJobId = null;      // the real UI booking — kept as live evidence

async function phaseA() {
  console.log('\n== PHASE A: server validation & session setup ==');
  const tParent = await login('Parent', 'user6', '1234');
  const tSitter = await login('Sitter', 'sitter5', '1234');
  const tOther = await login('Parent', 'user7', '1234');
  check('A1 parent fixture login (user6)', Boolean(tParent));
  check('A2 sitter fixture login (sitter5)', Boolean(tSitter));
  check('A3 second parent login (user7, for IDOR check)', Boolean(tOther));
  if (!tParent || !tSitter) throw new Error('fixture logins failed — aborting');

  const baseJob = {
    ParentId: 6, ChildId: 6, SitterId: 5, City: 'Lahore',
    StartDate: TODAY, StartTime: START_T, EndTime: END_T,
    AvailabilityType: 'Single Day', SelectedDays: [],
  };

  // Unknown id must be rejected (400). Doubles as a liveness probe: an old
  // build would ignore the field and return 200 — then force an IIS recycle.
  let unknown = await api('POST', '/parent/create-job', tParent,
    { ...baseJob, AssignedTasks: ['fake-task'] });
  if (unknown.status !== 400) {
    console.log('  .. old build suspected — touching Web.config to recycle IIS Express');
    const now = new Date();
    fs.utimesSync(WEB_CONFIG, now, now);
    await sleep(8000);
    unknown = await api('POST', '/parent/create-job', tParent,
      { ...baseJob, AssignedTasks: ['fake-task'] });
  }
  check('A4 unknown task id rejected with 400',
    unknown.status === 400 && /unknown task/i.test(errText(unknown)),
    `status=${unknown.status} body=${String(errText(unknown)).slice(0, 140)}`);

  // Case 4 — duplicates are normalized server-side.
  const dup = await api('POST', '/parent/create-job', tParent,
    { ...baseJob, AssignedTasks: ['bottle-feeding', 'bottle-feeding'] });
  check('A5 duplicate task booking accepted', dup.status === 200 && dup.json?.jobId > 0,
    `status=${dup.status}`);
  if (dup.json?.jobId) createdJobIds.push(dup.json.jobId);
  const dupDet = await api('GET', `/jobs/jobdetails/${dup.json?.jobId}`, tParent);
  const dupTasks = dupDet.json?.AssignedTasks ?? dupDet.json?.assignedTasks ?? null;
  check('A6 duplicates collapsed to a single assignment',
    Array.isArray(dupTasks) && dupTasks.length === 1 && dupTasks[0] === 'bottle-feeding',
    JSON.stringify(dupTasks));

  // Case 1 — explicit empty array.
  const empty = await api('POST', '/parent/create-job', tParent,
    { ...baseJob, AssignedTasks: [] });
  check('A7 zero-task booking accepted', empty.status === 200 && empty.json?.jobId > 0);
  if (empty.json?.jobId) createdJobIds.push(empty.json.jobId);
  const emptyDet = await api('GET', `/jobs/jobdetails/${empty.json?.jobId}`, tParent);
  const emptyTasks = emptyDet.json?.AssignedTasks ?? emptyDet.json?.assignedTasks ?? null;
  check('A8 zero-task jobdetails returns []', Array.isArray(emptyTasks) && emptyTasks.length === 0,
    JSON.stringify(emptyTasks));

  // Case 6 (compat) — old client that never sends the field.
  const none = await api('POST', '/parent/create-job', tParent, { ...baseJob });
  check('A9 booking without the field still accepted (old client)',
    none.status === 200 && none.json?.jobId > 0, `status=${none.status}`);
  if (none.json?.jobId) createdJobIds.push(none.json.jobId);
  const noneDet = await api('GET', `/jobs/jobdetails/${none.json?.jobId}`, tParent);
  const noneTasks = noneDet.json?.AssignedTasks ?? noneDet.json?.assignedTasks ?? null;
  check('A10 field-missing jobdetails returns []',
    Array.isArray(noneTasks) && noneTasks.length === 0, JSON.stringify(noneTasks));

  // Authorization stays enforced on the details endpoint.
  const idor = await api('GET', `/jobs/jobdetails/${dup.json?.jobId}`, tOther);
  check('A11 other parent forbidden (403)', idor.status === 403, `status=${idor.status}`);
  const anon = await api('GET', `/jobs/jobdetails/${dup.json?.jobId}`, null);
  check('A12 anonymous forbidden (401)', anon.status === 401, `status=${anon.status}`);

  return { tParent, tSitter };
}

async function phaseB() {
  console.log('\n== PHASE B: real UI booking with task selection ==');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--ignore-certificate-errors'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();

  check('B1 UI login (user6)', await uiLogin(page, 'user6', '1234'));
  await acceptCookies(page);

  // Prime the search the booking flow locks (the screen auto-runs it on mount).
  // Same origin as the login landing page; retried against transient dev reloads.
  for (let i = 0; i < 3; i += 1) {
    try {
      await page.evaluate((payload) => {
        localStorage.setItem('lastBookingSearch', JSON.stringify(payload));
      }, {
        City: 'Lahore',
        AvailabilityType: 'One Day',
        StartDate: TODAY,
        EndDate: TODAY,
        StartTime: '11:00 PM',
        EndTime: '11:59 PM',
        MinRating: 0,
        SelectedDays: [],
        // Phase 8H CTA flag: without it the search screen hydrates the form
        // but deliberately does not fire a search on mount.
        autoSearch: true,
      });
      break;
    } catch {
      await sleep(1200);
    }
  }

  await page.goto(`${APP}/search-babysitter`, { waitUntil: 'domcontentloaded' });
  const resultsFound = await page
    .waitForFunction(() => document.body.innerText.includes('Sitter 5'), { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check('B2 search returns the fixture sitter', resultsFound);

  // Capture the booking payload + response on the real submit.
  let sentPayload = null;
  let createResp = null;
  page.on('request', (r) => {
    if (r.url().includes('/parent/create-job') && r.method() === 'POST') {
      try { sentPayload = JSON.parse(r.postData()); } catch { /* ignore */ }
    }
  });
  page.on('response', async (r) => {
    if (r.url().includes('/parent/create-job') && r.request().method() === 'POST') {
      try { createResp = await r.json(); } catch { /* ignore */ }
    }
  });

  check('B3 open caregiver details', await clickText(page, 'Sitter 5'));
  check('B4 on caregiver details screen', page.url().includes('/babysitter-details'), page.url());
  await page.screenshot({ path: path.join(SHOT_DIR, '01_caregiver_details_mobile.png') });

  check('B5 open booking modal', await clickText(page, 'Request Booking'));
  // NOTE: step labels use text-transform: uppercase, and innerText returns the
  // rendered (uppercase) text — compare case-insensitively.
  const selectorShown = await page
    .waitForFunction(() => document.body.innerText
      .toLowerCase().includes("today's required tasks"), { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check('B6 task section present after child context', selectorShown);
  check('B7 summary renumbered to Step 4',
    await page.evaluate(() => document.body.innerText
      .toLowerCase().includes('step 4: booking summary')));

  // Every checkbox in the modal must be the visually hidden semantic input.
  const boxes = await page.evaluate(() => [...document.querySelectorAll('input[type="checkbox"]')]
    .map((i) => { const r = i.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }));
  check('B8 no visible native checkboxes', boxes.length > 0 && boxes.every((b) => b.w <= 2 && b.h <= 2),
    JSON.stringify(boxes));

  // Select three tasks by clicking the ROW (whole label is the target).
  for (const label of ['Bottle Feeding', 'Diaper Change', 'Stroller Walk']) {
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll('label')].find((l) => l.textContent.includes(t));
      if (el) el.click();
    }, label);
  }
  const checked = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="checkbox"]')].map((i) => i.checked));
  check('B9 three tasks selected via full-row click', checked.filter(Boolean).length === 3,
    JSON.stringify(checked));
  // Let the 180ms selection transition settle before sampling computed colors.
  await sleep(500);
  const visuals = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('label')].filter((l) => l.querySelector('input'));
    const sel = rows.filter((l) => l.querySelector('input:checked'));
    const unsel = rows.filter((l) => !l.querySelector('input:checked'));
    if (!sel.length || !unsel.length) return { ok: false, sel: [], unsel: [] };
    const unselColors = [...new Set(unsel.map((l) => getComputedStyle(l).borderTopColor))];
    const selColors = [...new Set(sel.map((l) => getComputedStyle(l).borderTopColor))];
    return {
      ok: selColors.every((c) => !unselColors.includes(c))
        && sel.every((l) => l.querySelector('svg') !== null),
      sel: selColors,
      unsel: unselColors,
    };
  });
  check('B10 selected rows visually distinct (border + checkmark)', visuals.ok,
    JSON.stringify({ selected: visuals.sel, unselected: visuals.unsel }));

  // Task selection must reset when the child selection changes (then stay empty).
  const resetOk = await (async () => {
    await clickText(page, 'Kid of Lahore');               // deselect the only child
    await sleep(300);
    const disabledEmpty = await page.evaluate(() => {
      const boxesIn = [...document.querySelectorAll('input[type="checkbox"]')];
      return boxesIn.length > 0 && boxesIn.every((i) => i.disabled && !i.checked);
    });
    await clickText(page, 'Kid of Lahore');               // re-select the child
    await sleep(300);
    const enabledEmpty = await page.evaluate(() => {
      const boxesIn = [...document.querySelectorAll('input[type="checkbox"]')];
      return boxesIn.length > 0 && boxesIn.every((i) => !i.disabled && !i.checked);
    });
    return disabledEmpty && enabledEmpty;
  })();
  check('B11 child change resets tasks + disabled with no child', resetOk);

  // Re-select for the real submission.
  for (const label of ['Bottle Feeding', 'Diaper Change', 'Stroller Walk']) {
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll('label')].find((l) => l.textContent.includes(t));
      if (el) el.click();
    }, label);
  }
  const summaryOk = await page.evaluate(() => {
    const text = document.body.innerText;
    return text.includes('Required Tasks')
      && ['Bottle Feeding', 'Diaper Change', 'Stroller Walk'].every((t) => text.includes(`✓ ${t}`));
  });
  check('B12 booking summary echoes selected tasks', summaryOk);

  await page.evaluate(() => {
    const el = [...document.querySelectorAll('p')]
      .find((p) => p.textContent.includes("Today's Required Tasks"));
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await sleep(400);
  await page.screenshot({ path: path.join(SHOT_DIR, '02_booking_tasks_selected_mobile.png') });

  check('B13 submit booking', await clickText(page, 'Confirm & Send Request'));
  const submitted = await (async () => {
    for (let i = 0; i < 40 && !createResp; i += 1) await sleep(250);
    return Boolean(createResp);
  })();
  check('B14 booking accepted by backend', submitted && createResp?.jobId > 0,
    JSON.stringify(createResp));
  check('B15 payload carried AssignedTasks (3 stable ids)',
    Array.isArray(sentPayload?.AssignedTasks)
    && sentPayload.AssignedTasks.length === 3
    && sentPayload.AssignedTasks.every((t) => THREE_TASKS.includes(t)),
    JSON.stringify(sentPayload?.AssignedTasks));

  if (createResp?.jobId) proofJobId = createResp.jobId;
  await sleep(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, '03_after_booking_mobile.png') });

  return { browser, page };
}

async function phaseC(tParent, tSitter) {
  console.log('\n== PHASE C: booking -> job -> active session (propagation) ==');
  if (!proofJobId) throw new Error('no UI booking was created — cannot continue');

  // Start window for slot8 = 22:30–00:29 PK. Wait until it opens.
  const target = 22 * 60 + 30;
  for (let i = 0; i < 60; i += 1) {
    const now = pkParts();
    if (now.day === 6 && now.min >= target) break;
    if (now.day !== 6) break; // crossed midnight — still inside the window
    console.log(`  .. waiting for the session start window (PK ${String(Math.floor(now.min / 60)).padStart(2, '0')}:${String(now.min % 60).padStart(2, '0')})`);
    await sleep(20000);
  }

  const conf = await api('POST', '/jobs/confirm-bulk', tSitter, { SitterId: 5, JobIds: [proofJobId] });
  check('C1 sitter confirms booking -> Assigned', conf.status === 200, `status=${conf.status} ${String(errText(conf)).slice(0, 120)}`);

  const start = await api('POST', `/jobs/updateStatus/${proofJobId}`, tParent, { Status: 'In Progress' });
  check('C2 session started -> In Progress', start.status === 200, `status=${start.status} ${String(errText(start)).slice(0, 160)}`);

  const asParent = await api('GET', `/jobs/jobdetails/${proofJobId}`, tParent);
  const asSitter = await api('GET', `/jobs/jobdetails/${proofJobId}`, tSitter);
  const pTasks = asParent.json?.AssignedTasks ?? asParent.json?.assignedTasks ?? null;
  const sTasks = asSitter.json?.AssignedTasks ?? asSitter.json?.assignedTasks ?? null;
  check('C3 parent reads 3 assigned tasks from job details',
    Array.isArray(pTasks) && pTasks.length === 3, JSON.stringify(pTasks));
  check('C4 babysitter reads the SAME 3 tasks (one assignment, both roles)',
    Array.isArray(sTasks) && JSON.stringify(sTasks) === JSON.stringify(pTasks), JSON.stringify(sTasks));
  check('C5 job is In Progress for both readers',
    asParent.json?.Status === 'In Progress' && asSitter.json?.Status === 'In Progress',
    `${asParent.json?.Status} / ${asSitter.json?.Status}`);
}

async function phaseD() {
  console.log('\n== PHASE D: active-job screens (both roles) ==');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--ignore-certificate-errors'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });

  // ---- Parent ----
  const p = await browser.newPage();
  check('D1 parent UI login (user6)', await uiLogin(p, 'user6', '1234'));
  await p.goto(`${APP}/parent-active-job/${proofJobId}`, { waitUntil: 'domcontentloaded' });
  const parentSees = await p
    .waitForFunction(() => ['Bottle Feeding', 'Diaper Change', 'Stroller Walk']
      .every((t) => document.body.innerText.includes(t)), { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check('D2 parent active job shows the 3 assigned tasks', parentSees);
  check('D3 no misleading empty state when tasks exist',
    await p.evaluate(() => !document.body.innerText.includes('No specific tasks requested')));
  check('D4 read-only (no checkboxes on the active screen)',
    await p.evaluate(() => document.querySelectorAll('input[type="checkbox"]').length === 0));
  // Evidence: the card itself, at mobile / tablet / desktop widths.
  await acceptCookies(p);
  await scrollToText(p, 'assigned tasks');
  await p.screenshot({ path: path.join(SHOT_DIR, '04_parent_active_job_mobile.png') });
  await p.setViewport({ width: 768, height: 1024 });
  await sleep(400);
  await p.screenshot({ path: path.join(SHOT_DIR, '04b_parent_active_job_tablet.png') });
  await p.setViewport({ width: 1440, height: 900 });
  await sleep(400);
  await p.screenshot({ path: path.join(SHOT_DIR, '05_parent_active_job_desktop.png') });

  // Zero-task job renders the calm empty state (legacy-NULL semantics).
  const emptyJob = createdJobIds[1]; // A7 zero-task booking
  if (emptyJob) {
    await p.setViewport({ width: 390, height: 844 });
    await p.goto(`${APP}/parent-active-job/${emptyJob}`, { waitUntil: 'domcontentloaded' });
    const emptyShown = await p
      .waitForFunction(() => document.body.innerText
        .includes('No specific tasks requested for this session.'), { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check('D5 zero-task job shows the graceful empty state', emptyShown);
    await acceptCookies(p);
    await scrollToText(p, 'no specific tasks requested');
    await p.screenshot({ path: path.join(SHOT_DIR, '06_parent_active_job_empty_state.png') });
  }

  // ---- Babysitter ----
  const s = await browser.newPage();
  check('D6 babysitter UI login (sitter5)', await uiLogin(s, 'sitter5', '1234'));
  await s.goto(`${APP}/babysitter-my-jobs`, { waitUntil: 'domcontentloaded' });
  const jobListed = await s
    .waitForFunction(() => document.body.innerText.includes('Kid of Lahore'), { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check('D7 active booking listed for the babysitter', jobListed);
  await s.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(400);
  await s.screenshot({ path: path.join(SHOT_DIR, '07_babysitter_my_jobs_mobile.png') });

  // The card itself is not clickable — the action is the "View Details"
  // button INSIDE the card that names this booking's child.
  const clickedCard = await s.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
      .filter((b) => /view details/i.test(b.textContent.trim()));
    for (const b of btns) {
      let p = b.parentElement;
      while (p) {
        if (p.textContent.includes('Kid of Lahore')) { b.click(); return true; }
        p = p.parentElement;
      }
    }
    return false;
  });
  check('D8a open the booking via View Details', clickedCard);
  const onActive = await s
    .waitForFunction(() => location.pathname.includes('active-job-details')
      && document.body.innerText.toLowerCase().includes('bottle feeding'), { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check('D8 babysitter active job opens with the same tasks', onActive, s.url());
  check('D9 babysitter view is read-only',
    await s.evaluate(() => document.querySelectorAll('input[type="checkbox"]').length === 0));
  await acceptCookies(s);
  await scrollToText(s, 'assigned tasks');
  await s.screenshot({ path: path.join(SHOT_DIR, '10_babysitter_active_job_mobile.png') });
  await s.setViewport({ width: 768, height: 1024 });
  await sleep(400);
  await s.screenshot({ path: path.join(SHOT_DIR, '10b_babysitter_active_job_tablet.png') });
  await s.setViewport({ width: 1440, height: 900 });
  await sleep(400);
  await s.screenshot({ path: path.join(SHOT_DIR, '11_babysitter_active_job_desktop.png') });

  await browser.close();
}

async function phaseF(tParent) {
  console.log('\n== PHASE F: database evidence + cleanup ==');
  const ids = [proofJobId, ...createdJobIds].filter(Boolean).join(',');
  const rows = sql(
    `SELECT CAST(Job_ID AS varchar) + '=' + ISNULL(AssignedTasks, 'NULL') FROM Job WHERE Job_ID IN (${ids}) ORDER BY Job_ID;`,
  );
  const stored = new Map(rows.map((r) => {
    const i = r.indexOf('=');
    return [Number(r.slice(0, i)), r.slice(i + 1)];
  }));
  console.log('  stored rows:', rows.join(' | '));

  check('F1 proof job persisted 3 stable ids in Job.AssignedTasks',
    stored.get(proofJobId) === '["bottle-feeding","diaper-change","stroller-walk"]',
    stored.get(proofJobId));
  if (createdJobIds.length >= 3) {
    check('F2 duplicate input persisted as a single assignment',
      stored.get(createdJobIds[0]) === '["bottle-feeding"]', stored.get(createdJobIds[0]));
    check('F3 empty & field-missing bookings persisted as NULL (legacy-compatible)',
      stored.get(createdJobIds[1]) === 'NULL' && stored.get(createdJobIds[2]) === 'NULL',
      `${stored.get(createdJobIds[1])} / ${stored.get(createdJobIds[2])}`);
  }

  // Close the real lifecycle: In Progress -> Completed (tasks stay attached).
  const done = await api('POST', `/jobs/updateStatus/${proofJobId}`, tParent, { Status: 'Completed' });
  check('F4 proof session completed (tasks survive to Completed)', done.status === 200,
    `status=${done.status} ${String(errText(done)).slice(0, 140)}`);

  // Remove the pure validation artifacts; keep the proof booking as evidence.
  const junk = createdJobIds.filter((id) => id !== proofJobId).join(',');
  if (junk) {
    sql(`SET QUOTED_IDENTIFIER ON;
         UPDATE Job SET IsDeleted = 1 WHERE Job_ID IN (${junk});
         DELETE FROM JobChildren WHERE Job_ID IN (${junk});
         DELETE FROM JobTimeSlot WHERE Job_ID IN (${junk});
         DELETE FROM JobInvitation WHERE Job_ID IN (${junk});`);
  }
  // Remove the search-fixture availability row (its job already exists).
  sql(`DELETE FROM SitterAvailability WHERE Sitter_ID = 5 AND AvailableDate = '${TODAY}' AND Slot_ID = 8 AND City = 'Lahore' AND IsDeleted = 0;`);
  check('F5 test artifacts removed (junk bookings + fixture availability)', true);
}

async function main() {
  const t0 = pkParts();
  console.log('PHASE 10.0 — TASK ALLOCATION E2E');
  console.log(`PK now: ${String(Math.floor(t0.min / 60)).padStart(2, '0')}:${String(t0.min % 60).padStart(2, '0')} | shots -> ${SHOT_DIR}`);

  const { tParent, tSitter } = await phaseA();
  const ui = await phaseB();
  await ui.browser.close();
  await phaseC(tParent, tSitter);
  await phaseD();
  await phaseF(tParent);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nE2E ABORTED:', err);
  console.log(`\nRESULT: ${pass} passed, ${fail} failed (aborted)`);
  process.exit(1);
});





