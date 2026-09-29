// PHASE 11 - CONCURRENCY VERIFICATION
//
// WHY THIS IS NOT "SEQUENTIAL CALLS IN A LOOP"
// Every group below is dispatched with Promise.all(), so all requests are in
// flight on separate sockets at the same instant. Issuing the same calls one
// after another would prove nothing about races (duplicate sessions, double
// escalation, lost authorisation) and is explicitly NOT what is claimed here.
//
// WHAT IS PROVEN
//   A) several participants calling session/start simultaneously still yield
//      exactly ONE active MonitorSession, and the unauthorised caller is refused
//   B) a detector firing repeatedly cannot create a burst of incidents
//   C) heartbeats from both participants converge without corrupting state
//   D) the media role is always derived server-side, never from the request
//   E) an unauthorised parent never learns the monitoring scope
//
// WHAT IS NOT PROVEN
// Multi-instance (web-farm) contention. There is a single IIS Express instance
// here. The atomic claim in CryIncidentService targets that case, but this
// script does NOT verify it.

const BASE = `${process.env.LITTLECARE_TEST_API_BASE_URL || 'https://localhost:44368'}/api`;
const JOB = 9001;
const CHILD = 1;
const testPassword = process.env.LITTLECARE_TEST_PASSWORD;
if (!testPassword) {
  console.error('Set LITTLECARE_TEST_PASSWORD to the development fixture account password before running this harness.');
  process.exit(2);
}

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  (cond ? pass++ : fail++);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
};

async function call(token, method, path, body) {
  const opts = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON is acceptable here */ }
  return { status: r.status, json, text };
}

async function login(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return (await r.json()).token;
}

const scope = { jobId: JOB, childId: CHILD };

console.log('=== PHASE 11 CONCURRENCY ===');
const tOwner = await login('/parent/login', { username: 'usmantariq', password: testPassword, role: 'Parent' });
const tCo = await login('/parent/login', { username: 'hina', password: testPassword, role: 'Parent' });
const tBad = await login('/parent/login', { username: 'user5', password: testPassword, role: 'Parent' });
const tSit = await login('/babysitter/login', { username: 'sitter4', password: testPassword, role: 'Sitter' });
console.log('logged in: owner, co-parent, unauthorised, sitter');

console.log('\n--- A) 6 CONCURRENT session/start (owner x3, co-parent, sitter, unauthorised) ---');
const starts = await Promise.all([
  call(tOwner, 'POST', '/monitoring/session/start', scope),
  call(tOwner, 'POST', '/monitoring/session/start', scope),
  call(tOwner, 'POST', '/monitoring/session/start', scope),
  call(tCo, 'POST', '/monitoring/session/start', scope),
  call(tSit, 'POST', '/monitoring/session/start', scope),
  call(tBad, 'POST', '/monitoring/session/start', scope),
]);
console.log('  statuses:', starts.map((s) => s.status).join(', '));
const sessionIds = new Set(starts.filter((s) => s.status === 200).map((s) => (s.json.MonitorSessionId ?? s.json.MonitorSession_ID)));
check('A1 all five authorised concurrent starts succeeded', starts.slice(0, 5).every((s) => s.status === 200), starts.map((s) => s.status).join(','));
check('A2 unauthorised concurrent start refused (403)', starts[5].status === 403, `status=${starts[5].status}`);
check('A3 all authorised starts returned the SAME session id', sessionIds.size === 1, `ids=${[...sessionIds].join('|')}`);

console.log('\n--- B) 4 CONCURRENT cry reports (dedupe) ---');
const cries = await Promise.all([
  call(tSit, 'POST', '/monitoring/cry', scope),
  call(tSit, 'POST', '/monitoring/cry', scope),
  call(tSit, 'POST', '/monitoring/cry', scope),
  call(tSit, 'POST', '/monitoring/cry', scope),
]);
console.log('  statuses:', cries.map((c) => c.status).join(', '));
const incIds = new Set(cries.filter((c) => c.status === 200).map((c) => c.json.Id));
const reused = cries.filter((c) => c.json && c.json.Reused === true).length;
check('B1 concurrent cry reports all accepted', cries.every((c) => c.status === 200), cries.map((c) => c.status).join(','));
check('B2 concurrent cry reports produced exactly ONE incident id', incIds.size === 1, `ids=${[...incIds].join('|')}`);
check('B3 later concurrent reports flagged Reused (server-side dedupe)', reused >= 1, `reused=${reused}`);

console.log('\n--- C) 3 CONCURRENT heartbeats (owner, sitter, unauthorised) ---');
const beats = await Promise.all([
  call(tOwner, 'POST', '/monitoring/session/heartbeat', scope),
  call(tSit, 'POST', '/monitoring/session/heartbeat', scope),
  call(tBad, 'POST', '/monitoring/session/heartbeat', scope),
]);
console.log('  statuses:', beats.map((b) => b.status).join(', '));
check('C1 both authorised heartbeats accepted', beats[0].status === 200 && beats[1].status === 200, `${beats[0].status}/${beats[1].status}`);
check('C2 unauthorised heartbeat refused (403)', beats[2].status === 403, `status=${beats[2].status}`);

const after = await call(tOwner, 'GET', `/monitoring/session?jobId=${JOB}&childId=${CHILD}`);
check('C3 session still Active after concurrent beats', after.json?.Status === 'Active', `status=${after.json?.Status}`);
check('C4 both connections reported Connected', after.json?.ParentConnection === 'Connected' && after.json?.SitterConnection === 'Connected',
  `parent=${after.json?.ParentConnection} sitter=${after.json?.SitterConnection}`);

console.log('\n--- D) 4 CONCURRENT media requests (role is server-derived) ---');
const mq = `/monitoring/media?jobId=${JOB}&childId=${CHILD}`;
const medias = await Promise.all([
  call(tOwner, 'GET', mq),
  call(tCo, 'GET', mq),
  call(tSit, 'GET', mq),
  call(tBad, 'GET', mq),
]);
console.log('  statuses:', medias.map((m) => m.status).join(', '));
check('D1 sitter is receive-only (viewer, CanPublish false)',
  medias[2].json?.Role === 'viewer' && medias[2].json?.CanPublish === false, `role=${medias[2].json?.Role}`);
check('D2 parents receive the publisher role',
  medias[0].json?.Role === 'publisher' && medias[1].json?.Role === 'publisher', `${medias[0].json?.Role}/${medias[1].json?.Role}`);
check('D3 unauthorised media request refused (403)', medias[3].status === 403, `status=${medias[3].status}`);
check('D4 no token or room leaked while unconfigured', medias.every((m) => !m.json?.Token && !m.json?.RoomName), 'all null');

console.log('\n--- E) 4 CONCURRENT accessible-scopes reads ---');
const scopes = await Promise.all([
  call(tOwner, 'GET', '/monitoring/accessible-scopes'),
  call(tCo, 'GET', '/monitoring/accessible-scopes'),
  call(tSit, 'GET', '/monitoring/accessible-scopes'),
  call(tBad, 'GET', '/monitoring/accessible-scopes'),
]);
const n = (s) => (Array.isArray(s.json) ? s.json.length : 0);
check('E1 owner AND co-parent both discover the scope', n(scopes[0]) > 0 && n(scopes[1]) > 0, `${n(scopes[0])}/${n(scopes[1])}`);
check('E2 sitter discovers the assigned scope', n(scopes[2]) > 0, `${n(scopes[2])}`);
check('E3 unauthorised parent discovers NOTHING', n(scopes[3]) === 0, `${n(scopes[3])}`);

console.log(`\nCONCURRENCY RESULT: ${pass} passed, ${fail} failed`);
console.log('NOTE: single IIS Express instance only. Multi-instance/web-farm contention is NOT verified here.');
process.exit(fail === 0 ? 0 : 1);
