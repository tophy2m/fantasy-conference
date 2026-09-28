/**
 * Fantasy General Conference · Sand Hollow 4th
 * Google Apps Script backend (bound to the "General Conference Fantasy App" sheet).
 *
 * The page (fantasy-conference.vercel.app) talks to this script:
 *   GET  ?action=config           -> game options, lock time, whether scores are showing
 *   POST {action:'login', ...}    -> check roster + PIN, create player on first sign-in
 *   POST {action:'save', ...}     -> save picks (refused after the lock time)
 *   POST {action:'leaderboard'}   -> standings (only when Settings > show_scores is ticked)
 *
 * After pasting a new version of this file: Deploy > Manage deployments > pencil > Version: New version > Deploy.
 * (Never "New deployment" - that changes the /exec URL and breaks the page.)
 */

// ---------------------------------------------------------------- game definition
const GAME = {
  lockAtDefault: '2026-10-03T09:00:00-06:00',
  totalPicks: 27,
  apostleFields: {
    sat: ['apostle_sat_1', 'apostle_sat_2', 'apostle_sat_3'],
    sun: ['apostle_sun_1', 'apostle_sun_2', 'apostle_sun_3']
  },
  maxPoints: 200,
  redZoneSessions: [
    { key: 'sat_am', field: 'fp_sat_am', label: 'Saturday morning', half: '1st half' },
    { key: 'sun_am', field: 'fp_sun_am', label: 'Sunday morning', half: '2nd half' }
  ],
  fp: [
    { key: 'oaks', name: 'President Oaks' },
    { key: 'eyring', name: 'President Eyring' },
    { key: 'christofferson', name: 'President Christofferson' }
  ],
  tieColors: [
    { label: 'Red', hex: '#B8322A' },
    { label: 'Maroon', hex: '#6E1F2A' },
    { label: 'Blue', hex: '#2F5FA8' },
    { label: 'Navy', hex: '#1D2B4F' },
    { label: 'Grey', hex: '#8A8F93' },
    { label: 'Purple', hex: '#6B4C9A' },
    { label: 'Teal', hex: '#1F8A7A' }
  ],
  choirColors: ['Red', 'Maroon', 'Blue', 'Navy', 'Pink', 'White', 'Aqua', 'Purple', 'Orange', 'Multi-colored'],
  sessions: [
    { key: 'sat_am', label: 'Saturday morning' },
    { key: 'sat_pm', label: 'Saturday afternoon' },
    { key: 'sun_am', label: 'Sunday morning' },
    { key: 'sun_pm', label: 'Sunday afternoon' }
  ],
  topics: ['Jesus Christ', 'Temples', 'Covenants', 'Prayer', 'Repentance', 'Book of Mormon', 'Missionary Work',
    'Holy Ghost', 'Priesthood', 'Youth', 'Family', 'Sabbath', 'Ministering', 'Agency', 'Second Coming'],
  tricks: [
    { key: 'sports', label: 'Football or sports', short: 'Sports' },
    { key: 'ai', label: 'Artificial intelligence (AI)', short: 'AI' },
    { key: 'phones', label: 'Phones or social media', short: 'Phones' },
    { key: 'aaronic', label: 'The Aaronic Priesthood', short: 'Aaronic Priesthood' },
    { key: 'airplane', label: 'An airplane or flying story', short: 'Airplane' }
  ],
  apostles: ['President Dieter F. Uchtdorf', 'Elder David A. Bednar', 'Elder Quentin L. Cook', 'Elder Neil L. Andersen',
    'Elder Ronald A. Rasband', 'Elder Gary E. Stevenson', 'Elder Dale G. Renlund', 'Elder Gerrit W. Gong',
    'Elder Ulisses Soares', 'Elder Patrick Kearon', 'Elder Gérald Caussé', 'Elder Clark G. Gilbert'],
  meetTheTwelveUrl: 'https://www.churchofjesuschrist.org/learn/quorum-of-the-twelve-apostles',
  quorums: ['Deacons', 'Teachers', 'Priests'],
  points: {
    tie: 10, choir: 5, templeExact: 25, templeNear: 10, templeNearWindow: 2,
    locCountry: 5, locState: 10, locCity: 25, topic: 5, topicPicks: 5, trick: 5, redZone: 10, apostle: 5
  }
};

const TABS = {
  settings: 'Settings', roster: 'Roster', players: 'Players', picks: 'Picks',
  answers: 'Answers', temples: 'AnnouncedTemples', scores: 'Scores'
};

const PICK_FIELDS = (function () {
  const f = [];
  GAME.fp.forEach(function (p) { f.push('tie_' + p.key); });
  GAME.sessions.forEach(function (s) { f.push('choir_' + s.key); });
  f.push('temple_count', 'temple_country', 'temple_state', 'temple_city', 'topics');
  GAME.tricks.forEach(function (t) { f.push('trick_' + t.key); });
  f.push('fp_sat_am', 'fp_sun_am', 'apostle_sat_1', 'apostle_sat_2', 'apostle_sat_3', 'apostle_sun_1', 'apostle_sun_2', 'apostle_sun_3');
  return f;
})();
const PICK_HEADERS = ['Name', 'Quorum', 'Updated'].concat(PICK_FIELDS);
const PLAYER_HEADERS = ['Name', 'Quorum', 'PIN', 'Created', 'Last sign-in', 'Temple location override pts'];

// ---------------------------------------------------------------- web endpoints
function doGet(e) {
  return respond_(function () {
    const action = (e && e.parameter && e.parameter.action) || 'config';
    if (action === 'config') return config_();
    if (action === 'signups') return signups_();
    return { ok: false, error: 'unknown_action' };
  });
}

function doPost(e) {
  return respond_(function () {
    let b = {};
    try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return { ok: false, error: 'bad_request' }; }
    switch (b.action) {
      case 'login': return login_(b);
      case 'save': return save_(b);
      case 'leaderboard': return leaderboard_(b);
      case 'signups': return signups_();
      default: return { ok: false, error: 'unknown_action' };
    }
  });
}

function respond_(fn) {
  let out;
  try { out = fn(); } catch (err) {
    console.error(err);
    out = { ok: false, error: 'server', message: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function config_() {
  const s = settings_();
  const lockAt = lockAt_(s);
  return {
    ok: true,
    serverTime: new Date().toISOString(),
    lockAt: lockAt.toISOString(),
    locked: Date.now() >= lockAt.getTime(),
    showScores: truthy_(s.show_scores),
    pools: pools_(),
    game: GAME
  };
}

function login_(b) {
  const pin = String(b.pin || '').trim();
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'pin_format' };
  const r = findRoster_(b.name);
  if (!r) return { ok: false, error: 'not_on_roster' };

  const cache = CacheService.getScriptCache();
  const ck = 'fail_' + norm_(r.name);
  const fails = Number(cache.get(ck) || 0);
  if (fails >= 5) return { ok: false, error: 'too_many' };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_(TABS.players);
    const p = findPlayer_(sh, r.name);
    let isNew = false;
    if (p) {
      if (pad4_(p.pin) !== pin) {
        cache.put(ck, String(fails + 1), 600);
        return { ok: false, error: 'bad_pin' };
      }
      sh.getRange(p.row, 5).setValue(new Date());
    } else {
      if (isLocked_()) return { ok: false, error: 'locked_new' };
      const row = sh.getLastRow() + 1;
      sh.getRange(row, 3).setNumberFormat('@');
      sh.getRange(row, 1, 1, 5).setValues([[r.name, r.quorum, pin, new Date(), new Date()]]);
      isNew = true;
    }
    cache.remove(ck);
    const lockAt = lockAt_(settings_());
    return {
      ok: true, name: r.name, quorum: r.quorum, isNew: isNew,
      picks: getPicks_(r.name), locked: Date.now() >= lockAt.getTime(), lockAt: lockAt.toISOString()
    };
  } finally {
    lock.releaseLock();
  }
}

// Checks name + PIN without creating anything.
function auth_(b) {
  const pin = String(b.pin || '').trim();
  const r = findRoster_(b.name);
  if (!r || !/^\d{4}$/.test(pin)) return { ok: false, error: 'auth' };
  const cache = CacheService.getScriptCache();
  const ck = 'fail_' + norm_(r.name);
  if (Number(cache.get(ck) || 0) >= 5) return { ok: false, error: 'too_many' };
  const p = findPlayer_(sheet_(TABS.players), r.name);
  if (!p || pad4_(p.pin) !== pin) {
    cache.put(ck, String(Number(cache.get(ck) || 0) + 1), 600);
    return { ok: false, error: 'auth' };
  }
  return { ok: true, roster: r };
}

function save_(b) {
  const a = auth_(b);
  if (!a.ok) return a;
  if (isLocked_()) return { ok: false, error: 'locked' };
  const picks = sanitize_(b.picks || {});
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    upsertPicks_(a.roster.name, a.roster.quorum, picks);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, picks: picks, savedAt: new Date().toISOString() };
}

function leaderboard_(b) {
  const s = settings_();
  if (!truthy_(s.show_scores)) return { ok: true, hidden: true };
  const rows = computeAll_();
  let me = null;
  if (b && b.name && b.pin) {
    const a = auth_(b);
    if (a.ok) {
      const m = rows.filter(function (x) { return norm_(x.name) === norm_(a.roster.name); })[0];
      if (m) me = { name: m.name, total: m.total, breakdown: m.breakdown };
    }
  }
  const showLeaders = truthy_(s.show_leaders_on_leaderboard);
  const pub = rows
    .filter(function (r) { return showLeaders || !r.leader; })
    .map(function (r) { return { name: r.name, quorum: r.quorum, total: r.total, tb: r.tb }; });
  return { ok: true, hidden: false, rows: pub, me: me, pools: pools_() };
}

// Everyone who has created a login (leaders left off), with how many of their picks are filled in.
// Shows counts only, never the picks themselves.
function signups_() {
  const players = playersMap_();
  const picks = allPicks_();
  const rows = [];
  roster_().forEach(function (r) {
    if (r.leader || !players[norm_(r.name)]) return;
    rows.push({ name: r.name, quorum: r.quorum, done: countPicks_(picks[norm_(r.name)] || {}) });
  });
  rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { ok: true, total: GAME.totalPicks, pools: pools_(), rows: rows };
}

function countPicks_(p) {
  let n = 0;
  const has = function (v) { return v !== '' && v !== null && v !== undefined; };
  GAME.fp.forEach(function (f) { if (p['tie_' + f.key]) n++; });
  GAME.sessions.forEach(function (s) { if (p['choir_' + s.key]) n++; });
  if (has(p.temple_count)) {
    n++;
    if (Number(p.temple_count) === 0 || p.temple_country || p.temple_state || p.temple_city) n++;
  }
  n += Math.min(GAME.points.topicPicks, (p.topics || []).length);
  GAME.tricks.forEach(function (t) { if (p['trick_' + t.key]) n++; });
  GAME.redZoneSessions.forEach(function (z) { if (p[z.field]) n++; });
  apostleFieldList_().forEach(function (k) { if (p[k]) n++; });
  return n;
}

function apostleFieldList_() { return GAME.apostleFields.sat.concat(GAME.apostleFields.sun); }

// ---------------------------------------------------------------- picks
function sanitize_(p) {
  const out = {};
  const tieLabels = GAME.tieColors.map(function (c) { return c.label; });
  GAME.fp.forEach(function (f) { out['tie_' + f.key] = oneOf_(p['tie_' + f.key], tieLabels); });
  GAME.sessions.forEach(function (s) { out['choir_' + s.key] = oneOf_(p['choir_' + s.key], GAME.choirColors); });

  let n = p.temple_count;
  n = (n === '' || n === null || n === undefined || isNaN(Number(n))) ? '' : Math.max(0, Math.min(99, Math.round(Number(n))));
  out.temple_count = n;
  const noLoc = (n === '' || n === 0);
  out.temple_country = noLoc ? '' : clip_(p.temple_country);
  out.temple_state = noLoc ? '' : clip_(p.temple_state);
  out.temple_city = noLoc ? '' : clip_(p.temple_city);

  const topics = Array.isArray(p.topics) ? p.topics : [];
  const seen = {};
  out.topics = topics.filter(function (t) {
    if (GAME.topics.indexOf(t) === -1 || seen[t]) return false;
    seen[t] = true; return true;
  }).slice(0, GAME.points.topicPicks);

  GAME.tricks.forEach(function (t) { out['trick_' + t.key] = oneOf_(p['trick_' + t.key], ['Yes', 'No']); });
  GAME.redZoneSessions.forEach(function (z) { out[z.field] = oneOf_(p[z.field], GAME.fp.map(function (f) { return f.name; })); });
  // Six apostle picks (3 Saturday, 3 Sunday), no apostle picked twice across all six.
  const usedAp = {};
  apostleFieldList_().forEach(function (k) {
    const v = oneOf_(p[k], GAME.apostles);
    out[k] = (v && !usedAp[v]) ? v : '';
    if (out[k]) usedAp[v] = true;
  });
  return out;
}

function upsertPicks_(name, quorum, picks) {
  const sh = sheet_(TABS.picks);
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(String);
  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (norm_(data[i][0]) === norm_(name)) { rowIdx = i; break; }
  }
  const existing = rowIdx > 0 ? data[rowIdx] : [];
  const values = headers.map(function (h, c) {
    if (h === 'Name') return name;
    if (h === 'Quorum') return quorum;
    if (h === 'Updated') return new Date();
    if (h === 'topics') return (picks.topics || []).join(', ');
    if (Object.prototype.hasOwnProperty.call(picks, h)) return picks[h];
    return existing[c] === undefined ? '' : existing[c];
  });
  const row = rowIdx > 0 ? rowIdx + 1 : sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, values.length).setValues([values]);
}

function rowToPicks_(headers, row) {
  const p = {};
  headers.forEach(function (h, i) {
    if (PICK_FIELDS.indexOf(h) === -1) return;
    let v = row[i];
    if (h === 'topics') v = String(v || '').split(',').map(function (s) { return s.trim(); }).filter(String);
    else if (h === 'temple_count') v = (v === '' || v === null) ? '' : Number(v);
    else v = (v === null || v === undefined) ? '' : String(v);
    p[h] = v;
  });
  return p;
}

function getPicks_(name) {
  const all = allPicks_();
  return all[norm_(name)] || null;
}

function allPicks_() {
  const sh = sheet_(TABS.picks);
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(String);
  const out = {};
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    out[norm_(data[i][0])] = rowToPicks_(headers, data[i]);
  }
  return out;
}

// ---------------------------------------------------------------- scoring
function computeAll_() {
  const A = answers_();
  const temples = announced_();
  const picks = allPicks_();
  const players = playersMap_();
  const rows = [];
  roster_().forEach(function (r) {
    const p = picks[norm_(r.name)];
    if (!p) return;
    const pl = players[norm_(r.name)];
    const sc = score_(p, A, temples, pl ? pl.override : null);
    rows.push({ name: r.name, quorum: r.quorum, leader: r.leader, total: sc.total, tb: sc.tb, breakdown: sc.breakdown });
  });
  rows.sort(function (a, b) {
    if (b.total !== a.total) return b.total - a.total;
    const ta = a.tb === null ? 999 : a.tb, tb = b.tb === null ? 999 : b.tb;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

function score_(p, A, temples, override) {
  const P = GAME.points;
  const b = { ties: 0, choir: 0, temples: 0, topics: 0, tricks: 0, redZone: 0, apostles: 0 };
  let tb = null;

  GAME.fp.forEach(function (f) {
    const pick = p['tie_' + f.key];
    if (pick && (eq_(pick, A['tie_' + f.key + '_1']) || eq_(pick, A['tie_' + f.key + '_2']))) b.ties += P.tie;
  });

  GAME.sessions.forEach(function (s) {
    const pick = p['choir_' + s.key];
    if (pick && eq_(pick, A['choir_' + s.key])) b.choir += P.choir;
  });

  const actual = A.temple_count;
  if (!blank_(actual) && !isNaN(Number(actual)) && p.temple_count !== '' && p.temple_count !== null && p.temple_count !== undefined) {
    const c = Number(actual), g = Number(p.temple_count);
    const d = Math.abs(g - c);
    tb = d;
    if (d === 0) b.temples += P.templeExact;
    else if (d <= P.templeNearWindow) b.temples += P.templeNear;
    if (g > 0 && c > 0) {
      b.temples += (override !== null && override !== undefined && override !== '' && !isNaN(Number(override)))
        ? Number(override) : locationPoints_(p, temples);
    }
  }

  (p.topics || []).forEach(function (t) { if (truthy_(A['topic_' + slug_(t)])) b.topics += P.topic; });

  GAME.tricks.forEach(function (t) {
    const pick = p['trick_' + t.key];
    if (pick && eq_(pick, A['trick_' + t.key])) b.tricks += P.trick;
  });

  GAME.redZoneSessions.forEach(function (z) {
    GAME.fp.forEach(function (f) {
      if (p[z.field] === f.name && truthy_(A['fp' + z.key.replace('_', '') + '_' + f.key])) b.redZone += P.redZone;
    });
  });

  GAME.apostleFields.sat.forEach(function (k) { if (p[k] && truthy_(A['apsat_' + slug_(p[k])])) b.apostles += P.apostle; });
  GAME.apostleFields.sun.forEach(function (k) { if (p[k] && truthy_(A['apsun_' + slug_(p[k])])) b.apostles += P.apostle; });

  let total = 0;
  Object.keys(b).forEach(function (k) { total += b[k]; });
  return { total: total, tb: tb, breakdown: b };
}

function locationPoints_(p, temples) {
  const P = GAME.points;
  const city = norm_(p.temple_city), state = normState_(p.temple_state), country = normCountry_(p.temple_country);
  let best = 0;
  temples.forEach(function (t) {
    if (city && city === norm_(t.city)) best = Math.max(best, P.locCity);
    else if (state && state === normState_(t.state)) best = Math.max(best, P.locState);
    else if (country && country === normCountry_(t.country)) best = Math.max(best, P.locCountry);
  });
  return best;
}

const COUNTRY_ALIASES = {
  'usa': 'united states', 'us': 'united states', 'u s': 'united states', 'u s a': 'united states',
  'united states of america': 'united states', 'america': 'united states',
  'uk': 'united kingdom', 'england': 'united kingdom', 'great britain': 'united kingdom', 'scotland': 'united kingdom', 'wales': 'united kingdom',
  'drc': 'democratic republic of the congo', 'dr congo': 'democratic republic of the congo',
  'the philippines': 'philippines', 'mexico city': 'mexico'
};
const US_STATES = 'al alabama|ak alaska|az arizona|ar arkansas|ca california|co colorado|ct connecticut|de delaware|fl florida|ga georgia|hi hawaii|id idaho|il illinois|in indiana|ia iowa|ks kansas|ky kentucky|la louisiana|me maine|md maryland|ma massachusetts|mi michigan|mn minnesota|ms mississippi|mo missouri|mt montana|ne nebraska|nv nevada|nh new hampshire|nj new jersey|nm new mexico|ny new york|nc north carolina|nd north dakota|oh ohio|ok oklahoma|or oregon|pa pennsylvania|ri rhode island|sc south carolina|sd south dakota|tn tennessee|tx texas|ut utah|vt vermont|va virginia|wa washington|wv west virginia|wi wisconsin|wy wyoming'
  .split('|').reduce(function (m, pair) { const i = pair.indexOf(' '); m[pair.slice(0, i)] = pair.slice(i + 1); return m; }, {});

function normCountry_(s) { const n = norm_(s); return COUNTRY_ALIASES[n] || n; }
function normState_(s) { const n = norm_(s); return US_STATES[n] || n; }

// ---------------------------------------------------------------- sheet readers
function settings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TABS.settings);
  const o = {};
  if (!sh) return o;
  sh.getDataRange().getValues().forEach(function (r) { if (r[0]) o[String(r[0]).trim()] = r[1]; });
  return o;
}

function lockAt_(s) {
  const raw = s.lock_at;
  const d = raw instanceof Date ? raw : new Date(String(raw || ''));
  return isNaN(d.getTime()) ? new Date(GAME.lockAtDefault) : d;
}

function isLocked_() { return Date.now() >= lockAt_(settings_()).getTime(); }

function roster_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TABS.roster);
  if (!sh) return [];
  const v = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const name = String(v[i][0] || '').trim();
    if (!name) continue;
    out.push({ name: name, quorum: String(v[i][1] || '').trim(), leader: truthy_(v[i][2]) });
  }
  return out;
}

function findRoster_(name) {
  const n = norm_(name);
  if (!n) return null;
  return roster_().filter(function (r) { return norm_(r.name) === n; })[0] || null;
}

function pools_() {
  const present = {};
  roster_().forEach(function (r) { if (r.quorum) present[r.quorum] = true; });
  const ordered = GAME.quorums.filter(function (q) { return present[q]; });
  Object.keys(present).forEach(function (q) { if (ordered.indexOf(q) === -1) ordered.push(q); });
  return ordered;
}

function findPlayer_(sh, name) {
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (norm_(v[i][0]) === norm_(name)) return { row: i + 1, pin: v[i][2] };
  }
  return null;
}

function playersMap_() {
  const sh = sheet_(TABS.players);
  const v = sh.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    out[norm_(v[i][0])] = { override: v[i][5] === '' ? null : v[i][5] };
  }
  return out;
}

function answers_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TABS.answers);
  const a = {};
  if (!sh) return a;
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) { if (v[i][0]) a[String(v[i][0]).trim()] = v[i][2]; }
  return a;
}

function announced_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TABS.temples);
  if (!sh) return [];
  const v = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    if (!v[i][0] && !v[i][1] && !v[i][2]) continue;
    out.push({ city: v[i][0], state: v[i][1], country: v[i][2] });
  }
  return out;
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '". Run setup from the Fantasy GC menu.');
  return sh;
}

// ---------------------------------------------------------------- helpers
function norm_(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function slug_(s) { return norm_(s).replace(/ /g, '_'); }
function blank_(v) { return v === '' || v === null || v === undefined; }
function eq_(a, b) { return !blank_(b) && norm_(a) === norm_(b); }
function truthy_(v) { return v === true || /^(true|yes|y|x|1)$/i.test(String(v === null || v === undefined ? '' : v).trim()); }
function oneOf_(v, list) { return list.indexOf(v) === -1 ? '' : v; }
function clip_(v) { return String(v || '').trim().slice(0, 60); }
function pad4_(v) { return String(v === null || v === undefined ? '' : v).trim().padStart(4, '0'); }

// ---------------------------------------------------------------- setup + menu
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Fantasy GC')
    .addItem('Recalculate scores (Scores tab)', 'recalculateScores')
    .addItem('Run setup (safe to re-run)', 'setup')
    .addToUi();
}

function recalculateScores() {
  const rows = computeAll_();
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(TABS.scores) || ss.insertSheet(TABS.scores);
  sh.clearContents();
  const head = ['Rank', 'Name', 'Quorum', 'Leader', 'Total', 'Ties', 'Choir', 'Temples', 'Topics', 'Trick plays', 'Red Zone', 'Apostles', 'Temple count off by'];
  const out = [head].concat(rows.map(function (r, i) {
    const b = r.breakdown;
    return [i + 1, r.name, r.quorum, r.leader ? 'Y' : '', r.total, b.ties, b.choir, b.temples, b.topics, b.tricks, b.redZone, b.apostles, r.tb === null ? '' : r.tb];
  }));
  sh.getRange(1, 1, out.length, head.length).setValues(out);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  ss.toast('Scores recalculated for ' + rows.length + ' players.');
}

function setup() {
  const ss = SpreadsheetApp.getActive();

  // Settings (keeps the existing lock_at row from the smoke test)
  const st = ensureSheet_(TABS.settings, null).sheet;
  ensureSetting_(st, 'lock_at', GAME.lockAtDefault, 'text', 'Text, ISO format with offset (MDT is -06:00). Set to a past time to test the lock.');
  ensureSetting_(st, 'show_scores', false, 'checkbox', 'Tick to show the leaderboard to players.');
  ensureSetting_(st, 'show_leaders_on_leaderboard', false, 'checkbox', 'Tick to include leaders (Roster > Leader) on the leaderboard.');

  // Roster
  const ro = ensureSheet_(TABS.roster, ['First name', 'Quorum', 'Leader']);
  if (ro.created) {
    ro.sheet.getRange('B2:B200').setDataValidation(listRule_(GAME.quorums));
    ro.sheet.getRange('C2:C200').insertCheckboxes();
  }

  // Players
  const pl = ensureSheet_(TABS.players, PLAYER_HEADERS);
  pl.sheet.getRange('C:C').setNumberFormat('@');

  // Picks (adds any missing columns at the end)
  const pk = ensureSheet_(TABS.picks, PICK_HEADERS).sheet;
  const have = pk.getRange(1, 1, 1, Math.max(1, pk.getLastColumn())).getValues()[0].map(String);
  PICK_HEADERS.forEach(function (h) {
    if (have.indexOf(h) === -1) { pk.getRange(1, pk.getLastColumn() + 1).setValue(h).setFontWeight('bold'); have.push(h); }
  });

  // Answers
  const an = ensureSheet_(TABS.answers, ['Key', 'Question', 'Answer']).sheet;
  const existing = {};
  an.getDataRange().getValues().forEach(function (r) { if (r[0]) existing[String(r[0])] = true; });
  answerRows_().forEach(function (row) {
    if (existing[row[0]]) return;
    const r = an.getLastRow() + 1;
    an.getRange(r, 1, 1, 2).setValues([[row[0], row[1]]]);
    const cell = an.getRange(r, 3);
    if (row[2] === 'list') cell.setDataValidation(listRule_(row[3]));
    if (row[2] === 'check') cell.insertCheckboxes();
  });
  an.setColumnWidth(1, 150); an.setColumnWidth(2, 420); an.setColumnWidth(3, 140);
  an.getRange('A:A').setFontColor('#999999');

  // Announced temples
  ensureSheet_(TABS.temples, ['City', 'State / Province', 'Country']);

  ss.toast('Setup complete. Fill in the Roster tab next.');
}

function answerRows_() {
  const R = [];
  const tie = GAME.tieColors.map(function (c) { return c.label; });
  GAME.fp.forEach(function (f) {
    R.push(['tie_' + f.key + '_1', 'Sun AM tie · ' + f.name + ' · main color', 'list', tie]);
    R.push(['tie_' + f.key + '_2', 'Sun AM tie · ' + f.name + ' · 2nd stripe color (optional)', 'list', tie]);
  });
  GAME.sessions.forEach(function (s) { R.push(['choir_' + s.key, 'Choir color · ' + s.label, 'list', GAME.choirColors]); });
  R.push(['temple_count', 'Temples announced from the pulpit (type 0 if none). List each one on the AnnouncedTemples tab.', 'number']);
  GAME.topics.forEach(function (t) { R.push(['topic_' + slug_(t), 'Topic was the main theme of a talk · ' + t, 'check']); });
  GAME.tricks.forEach(function (t) { R.push(['trick_' + t.key, 'Mentioned by a speaker · ' + t.label, 'list', ['Yes', 'No']]); });
  GAME.redZoneSessions.forEach(function (z) {
    GAME.fp.forEach(function (f) { R.push(['fp' + z.key.replace('_', '') + '_' + f.key, 'Gave a full talk ' + z.label + ' · ' + f.name, 'check']); });
  });
  GAME.apostles.forEach(function (a) { R.push(['apsat_' + slug_(a), 'Spoke Saturday (AM or PM) · ' + a, 'check']); });
  GAME.apostles.forEach(function (a) { R.push(['apsun_' + slug_(a), 'Spoke Sunday (AM or PM) · ' + a, 'check']); });
  return R;
}

function ensureSheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  let created = false;
  if (!sh) { sh = ss.insertSheet(name); created = true; }
  if (headers && sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return { sheet: sh, created: created };
}

function ensureSetting_(sh, key, def, kind, note) {
  const v = sh.getDataRange().getValues();
  for (let i = 0; i < v.length; i++) { if (String(v[i][0]).trim() === key) return; }
  const r = (sh.getLastRow() === 1 && !v[0][0]) ? 1 : sh.getLastRow() + 1;
  sh.getRange(r, 1).setValue(key);
  const cell = sh.getRange(r, 2);
  if (kind === 'text') { cell.setNumberFormat('@').setValue(def); }
  if (kind === 'checkbox') { cell.insertCheckboxes(); cell.setValue(def); }
  sh.getRange(r, 3).setValue(note);
}

function listRule_(list) {
  return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
}
