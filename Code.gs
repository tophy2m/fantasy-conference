/**
 * Fantasy General Conference · Sand Hollow 4th
 * Google Apps Script backend (bound to the "General Conference Fantasy App" sheet).
 *
 * The page (fantasy-conference.vercel.app) talks to this script:
 *   GET  ?action=config           -> game options, lock time, whether scores are showing
 *   GET  ?action=signups          -> who has signed up and how many picks they've filled in
 *   POST {action:'login', ...}    -> check roster + PIN, create player on first sign-in
 *   POST {action:'save', ...}     -> save picks (refused after the lock time)
 *   POST {action:'leaderboard'}   -> standings (only when Settings > show_scores is ticked)
 *
 * After pasting a new version of this file: run setup once, then
 * Deploy > Manage deployments > pencil > Version: New version > Deploy.
 * (Never "New deployment" - that changes the /exec URL and breaks the page.)
 */

// ---------------------------------------------------------------- game definition
const FP = [
  { key: 'oaks', name: 'President Oaks' },
  { key: 'eyring', name: 'President Eyring' },
  { key: 'christofferson', name: 'President Christofferson' }
];
const SESSIONS = [
  { key: 'sat_am', label: 'Saturday morning', short: 'Sat AM' },
  { key: 'sat_pm', label: 'Saturday afternoon', short: 'Sat PM' },
  { key: 'sun_am', label: 'Sunday morning', short: 'Sun AM' },
  { key: 'sun_pm', label: 'Sunday afternoon', short: 'Sun PM' }
];
const DAYS = [{ key: 'sat', label: 'Saturday' }, { key: 'sun', label: 'Sunday' }];
const NONE_PRES = 'No one from this presidency';
const EVERYONE = 'Everyone will speak';

const GAME = {
  lockAtDefault: '2026-10-03T09:00:00-06:00',
  maxPoints: 350,
  totalPicks: 50,
  groups: ['Deacons', 'Teachers', 'Priests', 'Young Women'],
  fp: FP,
  sessions: SESSIONS,
  days: DAYS,
  weather: ['Sunny', 'Partly cloudy', 'Cloudy', 'Rain', 'Snow'],
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
  topics: ['Jesus Christ', 'Temples', 'Covenants', 'Prayer', 'Repentance', 'Book of Mormon', 'Missionary Work',
    'Holy Ghost', 'Priesthood', 'Youth', 'Family', 'Sabbath', 'Ministering', 'Agency', 'Second Coming'],
  tricks: [
    { key: 'sports', label: 'Football or sports', short: 'Sports' },
    { key: 'ai', label: 'Artificial intelligence (AI)', short: 'AI' },
    { key: 'phones', label: 'Phones or social media', short: 'Phones' },
    { key: 'aaronic', label: 'The Aaronic Priesthood', short: 'Aaronic Priesthood' },
    { key: 'airplane', label: 'An airplane or flying story', short: 'Airplane' }
  ],
  redZoneSessions: [
    { key: 'sat_am', field: 'fp_sat_am', label: 'Saturday morning', half: '1st half' },
    { key: 'sun_am', field: 'fp_sun_am', label: 'Sunday morning', half: '2nd half' }
  ],
  apostles: ['President Dieter F. Uchtdorf', 'Elder David A. Bednar', 'Elder Quentin L. Cook', 'Elder Neil L. Andersen',
    'Elder Ronald A. Rasband', 'Elder Gary E. Stevenson', 'Elder Dale G. Renlund', 'Elder Gerrit W. Gong',
    'Elder Ulisses Soares', 'Elder Patrick Kearon', 'Elder Gérald Caussé', 'Elder Clark G. Gilbert'],
  apostleFields: {
    sat: ['apostle_sat_1', 'apostle_sat_2', 'apostle_sat_3'],
    sun: ['apostle_sun_1', 'apostle_sun_2', 'apostle_sun_3']
  },
  meetTheTwelveUrl: 'https://www.churchofjesuschrist.org/learn/quorum-of-the-twelve-apostles',
  presidencies: [
    { key: 'primary', label: 'Primary', lead: 'President', url: 'https://www.churchofjesuschrist.org/learn/primary-general-presidency',
      members: ['Rosemary K. Chibota', 'Nina M. Garfield', 'Theresa A. Collins'] },
    { key: 'yw', label: 'Young Women', lead: 'President', url: 'https://www.churchofjesuschrist.org/learn/young-women-general-presidency',
      members: ['Emily Belle Freeman', 'Tamara W. Runia', 'Andrea Muñoz Spannaus'] },
    { key: 'ym', label: 'Young Men', lead: 'President', url: 'https://www.churchofjesuschrist.org/learn/young-men-general-presidency',
      members: ['Timothy L. Farnes', 'David J. Wunderli', 'Sean R. Dixon'] },
    { key: 'rs', label: 'Relief Society', lead: 'President', url: 'https://www.churchofjesuschrist.org/learn/relief-society-general-presidency',
      members: ['Camille N. Johnson', 'J. Anette Dennis', 'Kristin M. Yee'] },
    { key: 'ss', label: 'Sunday School', lead: 'President', url: 'https://www.churchofjesuschrist.org/learn/sunday-school-general-presidency',
      members: ['Paul V. Johnson', 'Chad H Webb', 'Gabriel W. Reid'] },
    { key: 'pb', label: 'Presiding Bishopric', lead: 'Presiding Bishop', url: 'https://www.churchofjesuschrist.org/learn/presiding-bishopric',
      members: ['W. Christopher Waddell', 'L. Todd Budge', 'Sean Douglas'] }
  ],
  nonePres: NONE_PRES,
  everyone: EVERYONE,
  hymnStopWords: ['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are', 'be',
    'it', 'its', 'my', 'our', 'we', 'us', 'me', 'i', 'you', 'your', 'ye', 'o', 'oh', 'that', 'this', 'all', 'so', 'his', 'her', 'he',
    'she', 'him', 'they', 'them', 'their', 'thy', 'thine'],
  quorumTwelveNote: '',
  points: {
    weather: 5, tie: 10, conduct: 5, apostle: 5, trick: 5, redZone: 10, pres: 5,
    choir: 5, youthChoir: 5, hymnWord: 5, hymnTitle: 15, topic: 5, topicPicks: 5, bench: 10,
    templeExact: 25, templeNear: 10, templeNearWindow: 2, locCountry: 5, locState: 10, locCity: 25, hail: 10
  }
};

const TABS = {
  settings: 'Settings', roster: 'Roster', players: 'Players', picks: 'Picks',
  answers: 'Answers', temples: 'AnnouncedTemples', hymns: 'Hymns', scores: 'Scores'
};

function apostleFieldList_() { return GAME.apostleFields.sat.concat(GAME.apostleFields.sun); }
function benchOptions_() { return [EVERYONE].concat(FP.map(function (f) { return f.name; }), GAME.apostles); }

const PICK_FIELDS = (function () {
  const f = [];
  DAYS.forEach(function (d) { f.push('weather_' + d.key); });
  DAYS.forEach(function (d) { FP.forEach(function (p) { f.push('tie_' + d.key + '_' + p.key); }); });
  SESSIONS.forEach(function (s) { f.push('conduct_' + s.key); });
  f.push.apply(f, GAME.apostleFields.sat.concat(GAME.apostleFields.sun));
  GAME.tricks.forEach(function (t) { f.push('trick_' + t.key); });
  f.push('fp_sat_am', 'fp_sun_am');
  GAME.presidencies.forEach(function (o) { f.push('pres_' + o.key); });
  SESSIONS.forEach(function (s) { f.push('choir_' + s.key); });
  f.push('youth_choir');
  SESSIONS.forEach(function (s) { f.push('hymn_kw_' + s.key); });
  f.push('hymn_title', 'topics', 'bench', 'temple_count', 'temple_country', 'temple_state', 'temple_city', 'hail_talks');
  return f;
})();
const PICK_HEADERS = ['Name', 'Group', 'Updated'].concat(PICK_FIELDS);
const PLAYER_HEADERS = ['Name', 'Group', 'PIN', 'Created', 'Last sign-in', 'Temple location override pts', 'Hymn title override pts'];

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
      sh.getRange(row, 1, 1, 5).setValues([[r.name, r.group, pin, new Date(), new Date()]]);
      isNew = true;
    }
    cache.remove(ck);
    const lockAt = lockAt_(settings_());
    return {
      ok: true, name: r.name, group: r.group, isNew: isNew,
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
    upsertPicks_(a.roster.name, a.roster.group, picks);
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
    .map(function (r) { return { name: r.name, group: r.group, total: r.total, tb: r.tb }; });
  return { ok: true, hidden: false, rows: pub, me: me, pools: pools_() };
}

// Everyone who has created a login (leaders included and tagged), with how many picks they've filled in.
// Shows counts only, never the picks themselves.
function signups_() {
  const players = playersMap_();
  const picks = allPicks_();
  const rows = [];
  roster_().forEach(function (r) {
    if (!players[norm_(r.name)]) return;
    rows.push({ name: r.name, group: r.group, leader: r.leader, done: countPicks_(picks[norm_(r.name)] || {}) });
  });
  rows.sort(function (a, b) {
    if (a.leader !== b.leader) return a.leader ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return { ok: true, total: GAME.totalPicks, pools: pools_(), rows: rows };
}

// ---------------------------------------------------------------- picks
function countPicks_(p) {
  let n = 0;
  const has = function (v) { return v !== '' && v !== null && v !== undefined; };
  PICK_FIELDS.forEach(function (k) {
    if (k === 'topics' || k.indexOf('temple_') === 0) return;
    if (has(p[k])) n++;
  });
  n += Math.min(GAME.points.topicPicks, (p.topics || []).length);
  if (has(p.temple_count)) {
    n++;
    if (Number(p.temple_count) === 0 || p.temple_country || p.temple_state || p.temple_city) n++;
  }
  return n;
}

function hymnWord_(v) {
  const w = String(v || '').trim();
  if (!/^[A-Za-zÀ-ÿ']{2,24}$/.test(w)) return '';
  if (GAME.hymnStopWords.indexOf(norm_(w).replace(/ /g, '')) > -1) return '';
  return w;
}

function sanitize_(p) {
  const out = {};
  const fpNames = FP.map(function (f) { return f.name; });
  const tieLabels = GAME.tieColors.map(function (c) { return c.label; });
  DAYS.forEach(function (d) {
    out['weather_' + d.key] = oneOf_(p['weather_' + d.key], GAME.weather);
    FP.forEach(function (f) { out['tie_' + d.key + '_' + f.key] = oneOf_(p['tie_' + d.key + '_' + f.key], tieLabels); });
  });
  SESSIONS.forEach(function (s) {
    out['conduct_' + s.key] = oneOf_(p['conduct_' + s.key], fpNames);
    out['choir_' + s.key] = oneOf_(p['choir_' + s.key], GAME.choirColors);
    out['hymn_kw_' + s.key] = hymnWord_(p['hymn_kw_' + s.key]);
  });
  // Six apostle picks (3 Saturday, 3 Sunday), no apostle picked twice across all six.
  const usedAp = {};
  apostleFieldList_().forEach(function (k) {
    const v = oneOf_(p[k], GAME.apostles);
    out[k] = (v && !usedAp[v]) ? v : '';
    if (out[k]) usedAp[v] = true;
  });
  GAME.tricks.forEach(function (t) { out['trick_' + t.key] = oneOf_(p['trick_' + t.key], ['Yes', 'No']); });
  GAME.redZoneSessions.forEach(function (z) { out[z.field] = oneOf_(p[z.field], fpNames); });
  GAME.presidencies.forEach(function (o) { out['pres_' + o.key] = oneOf_(p['pres_' + o.key], o.members.concat([NONE_PRES])); });
  out.youth_choir = oneOf_(p.youth_choir, ['Yes', 'No']);
  out.hymn_title = clip_(p.hymn_title).slice(0, 80);
  const topics = Array.isArray(p.topics) ? p.topics : [];
  const seen = {};
  out.topics = topics.filter(function (t) {
    if (GAME.topics.indexOf(t) === -1 || seen[t]) return false;
    seen[t] = true; return true;
  }).slice(0, GAME.points.topicPicks);
  out.bench = oneOf_(p.bench, benchOptions_());

  let n = p.temple_count;
  n = (n === '' || n === null || n === undefined || isNaN(Number(n))) ? '' : Math.max(0, Math.min(99, Math.round(Number(n))));
  out.temple_count = n;
  const noLoc = (n === '' || n === 0);
  out.temple_country = noLoc ? '' : clip_(p.temple_country);
  out.temple_state = noLoc ? '' : clip_(p.temple_state);
  out.temple_city = noLoc ? '' : clip_(p.temple_city);

  let h = p.hail_talks;
  h = (h === '' || h === null || h === undefined || isNaN(Number(h))) ? '' : Math.round(Number(h));
  out.hail_talks = (h === '' || h < 1 || h > 99) ? '' : h;
  return out;
}

function upsertPicks_(name, group, picks) {
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
    if (h === 'Group' || h === 'Quorum') return group;
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
    else if (h === 'temple_count' || h === 'hail_talks') v = (v === '' || v === null) ? '' : Number(v);
    else v = (v === null || v === undefined) ? '' : String(v);
    p[h] = v;
  });
  return p;
}

function getPicks_(name) { return allPicks_()[norm_(name)] || null; }

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
  const ctx = { A: answers_(), temples: announced_(), hymns: hymnsSung_() };
  const picks = allPicks_();
  const players = playersMap_();
  const rows = [];
  roster_().forEach(function (r) {
    const p = picks[norm_(r.name)];
    if (!p) return;
    const pl = players[norm_(r.name)] || {};
    const sc = score_(p, ctx, pl);
    rows.push({ name: r.name, group: r.group, leader: r.leader, total: sc.total, tb: sc.tb, breakdown: sc.breakdown });
  });
  rows.sort(function (a, b) {
    if (b.total !== a.total) return b.total - a.total;
    const ta = a.tb === null ? 999 : a.tb, tb = b.tb === null ? 999 : b.tb;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

function score_(p, ctx, pl) {
  const A = ctx.A, P = GAME.points;
  const b = { weather: 0, ties: 0, conduct: 0, apostles: 0, tricks: 0, redZone: 0, depth: 0,
    choir: 0, hymns: 0, topics: 0, bench: 0, temples: 0, hail: 0 };
  let tb = null;

  DAYS.forEach(function (d) {
    const w = p['weather_' + d.key];
    if (w && eq_(w, A['weather_' + d.key])) b.weather += P.weather;
    FP.forEach(function (f) {
      const pick = p['tie_' + d.key + '_' + f.key];
      const k = 'tie_' + d.key + '_' + f.key;
      if (pick && (eq_(pick, A[k + '_1']) || eq_(pick, A[k + '_2']))) b.ties += P.tie;
    });
  });

  SESSIONS.forEach(function (s) {
    if (p['conduct_' + s.key] && eq_(p['conduct_' + s.key], A['conduct_' + s.key])) b.conduct += P.conduct;
    if (p['choir_' + s.key] && eq_(p['choir_' + s.key], A['choir_' + s.key])) b.choir += P.choir;
    const kw = p['hymn_kw_' + s.key];
    if (kw && keywordInTitles_(kw, ctx.hymns[s.key] || [])) b.hymns += P.hymnWord;
  });
  if (p.youth_choir && eq_(p.youth_choir, A.youth_choir)) b.choir += P.youthChoir;

  if (p.hymn_title) {
    const ov = pl.hymnOverride;
    if (ov !== null && ov !== undefined && ov !== '' && !isNaN(Number(ov))) b.hymns += Number(ov);
    else if (ctx.hymns.all.some(function (t) { return titleMatch_(p.hymn_title, t); })) b.hymns += P.hymnTitle;
  }

  GAME.apostleFields.sat.forEach(function (k) { if (p[k] && truthy_(A['apsat_' + slug_(p[k])])) b.apostles += P.apostle; });
  GAME.apostleFields.sun.forEach(function (k) { if (p[k] && truthy_(A['apsun_' + slug_(p[k])])) b.apostles += P.apostle; });

  GAME.tricks.forEach(function (t) {
    const pick = p['trick_' + t.key];
    if (pick && eq_(pick, A['trick_' + t.key])) b.tricks += P.trick;
  });

  GAME.redZoneSessions.forEach(function (z) {
    FP.forEach(function (f) {
      if (p[z.field] === f.name && truthy_(A['fp' + z.key.replace('_', '') + '_' + f.key])) b.redZone += P.redZone;
    });
  });

  GAME.presidencies.forEach(function (o) {
    const pick = p['pres_' + o.key];
    if (!pick) return;
    const spoke = o.members.filter(function (m) { return truthy_(A['pres_' + o.key + '_' + slug_(m)]); });
    if (pick === NONE_PRES) { if (truthy_(A.conference_over) && spoke.length === 0) b.depth += P.pres; }
    else if (spoke.indexOf(pick) > -1) b.depth += P.pres;
  });

  (p.topics || []).forEach(function (t) { if (truthy_(A['topic_' + slug_(t)])) b.topics += P.topic; });

  if (p.bench && truthy_(A.conference_over)) {
    const benched = benchedList_(A);
    if (p.bench === EVERYONE ? benched.length === 0 : benched.indexOf(p.bench) > -1) b.bench += P.bench;
  }

  const actual = A.temple_count;
  if (!blank_(actual) && !isNaN(Number(actual)) && p.temple_count !== '' && p.temple_count !== null && p.temple_count !== undefined) {
    const c = Number(actual), g = Number(p.temple_count);
    const d = Math.abs(g - c);
    tb = d;
    if (d === 0) b.temples += P.templeExact;
    else if (d <= P.templeNearWindow) b.temples += P.templeNear;
    if (g > 0 && c > 0) {
      const ov = pl.override;
      b.temples += (ov !== null && ov !== undefined && ov !== '' && !isNaN(Number(ov))) ? Number(ov) : locationPoints_(p, ctx.temples);
    }
  }

  if (p.hail_talks !== '' && p.hail_talks !== undefined && !blank_(A.total_talks) && Number(p.hail_talks) === Number(A.total_talks)) b.hail += P.hail;

  let total = 0;
  Object.keys(b).forEach(function (k) { total += b[k]; });
  return { total: total, tb: tb, breakdown: b };
}

// Who didn't give a talk: First Presidency via "gave a talk" checkboxes; apostles via the Sat/Sun checkboxes.
function benchedList_(A) {
  const out = [];
  FP.forEach(function (f) { if (!truthy_(A['fpspoke_' + f.key])) out.push(f.name); });
  GAME.apostles.forEach(function (a) {
    if (!truthy_(A['apsat_' + slug_(a)]) && !truthy_(A['apsun_' + slug_(a)])) out.push(a);
  });
  return out;
}

function hymnWords_(s) {
  return norm_(s).split(' ').filter(function (w) { return w && GAME.hymnStopWords.indexOf(w) === -1 && w !== 's'; });
}
function wordEq_(a, b) {
  if (a === b) return true;
  const strip = function (w) { return w.replace(/(es|s)$/, ''); };
  return strip(a) === strip(b) && strip(a).length >= 3;
}
function keywordInTitles_(kw, titles) {
  const k = norm_(kw).replace(/ /g, '');
  if (!k) return false;
  return titles.some(function (t) { return hymnWords_(t).some(function (w) { return wordEq_(k, w); }); });
}
// A hymn-title guess counts if it matches the title, or contains most of its key words in order.
function titleMatch_(guess, title) {
  if (norm_(guess) === norm_(title)) return true;
  const g = hymnWords_(guess), t = hymnWords_(title);
  if (!g.length || !t.length) return false;
  let j = 0;
  for (let i = 0; i < t.length && j < g.length; i++) { if (wordEq_(g[j], t[i])) j++; }
  return j === g.length && g.length >= Math.max(2, Math.ceil(t.length * 0.6));
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
    out.push({ name: name, group: String(v[i][1] || '').trim(), leader: truthy_(v[i][2]) });
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
  roster_().forEach(function (r) { if (r.group) present[r.group] = true; });
  const ordered = GAME.groups.filter(function (q) { return present[q]; });
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
  const head = v[0].map(String);
  const iT = head.indexOf('Temple location override pts'), iH = head.indexOf('Hymn title override pts');
  const out = {};
  for (let i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    out[norm_(v[i][0])] = {
      override: iT > -1 && v[i][iT] !== '' ? v[i][iT] : null,
      hymnOverride: iH > -1 && v[i][iH] !== '' ? v[i][iH] : null
    };
  }
  return out;
}

function answers_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TABS.answers);
  const a = {};
  if (!sh) return a;
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) { if (v[i][0] && String(v[i][0]).charAt(0) !== '#') a[String(v[i][0]).trim()] = v[i][2]; }
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

// Hymns tab: Session | Hymn title  ->  { sat_am: [titles], ..., all: [titles] }
function hymnsSung_() {
  const out = { all: [] };
  SESSIONS.forEach(function (s) { out[s.key] = []; });
  const sh = SpreadsheetApp.getActive().getSheetByName(TABS.hymns);
  if (!sh) return out;
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    const title = String(v[i][1] || '').trim();
    if (!title) continue;
    const s = SESSIONS.filter(function (x) { return norm_(x.label) === norm_(v[i][0]) || norm_(x.short) === norm_(v[i][0]); })[0];
    if (s) out[s.key].push(title);
    out.all.push(title);
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
  const keys = ['weather', 'ties', 'conduct', 'apostles', 'tricks', 'redZone', 'depth', 'choir', 'hymns', 'topics', 'bench', 'temples', 'hail'];
  const head = ['Rank', 'Name', 'Group', 'Leader', 'Total', 'Weather', 'Ties', 'Play caller', 'Apostles', 'Trick plays', 'Red Zone',
    'Depth chart', 'Choir', 'Hymns', 'Topics', 'Bench', 'Temples', 'Hail Mary', 'Temple count off by'];
  const out = [head].concat(rows.map(function (r, i) {
    return [i + 1, r.name, r.group, r.leader ? 'Y' : '', r.total]
      .concat(keys.map(function (k) { return r.breakdown[k]; }))
      .concat([r.tb === null ? '' : r.tb]);
  }));
  sh.getRange(1, 1, out.length, head.length).setValues(out);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  ss.toast('Scores recalculated for ' + rows.length + ' players.');
}

function setup() {
  const ss = SpreadsheetApp.getActive();

  // Settings (keeps the existing lock_at row)
  const st = ensureSheet_(TABS.settings, null).sheet;
  ensureSetting_(st, 'lock_at', GAME.lockAtDefault, 'text', 'Text, ISO format with offset (MDT is -06:00). Set to a past time to test the lock.');
  ensureSetting_(st, 'show_scores', false, 'checkbox', 'Tick to show the leaderboard to players.');
  ensureSetting_(st, 'show_leaders_on_leaderboard', false, 'checkbox', 'Tick to include leaders (Roster > Leader) on the leaderboard.');

  // Roster: "Quorum" column becomes "Group"; the dropdown is refreshed every run (values are kept)
  const ro = ensureSheet_(TABS.roster, ['First name', 'Group', 'Leader']);
  if (String(ro.sheet.getRange('B1').getValue()) === 'Quorum') ro.sheet.getRange('B1').setValue('Group');
  ro.sheet.getRange('B2:B300').setDataValidation(listRule_(GAME.groups));
  if (ro.created) ro.sheet.getRange('C2:C300').insertCheckboxes();

  // Players + Picks (renames Quorum -> Group, adds any missing columns at the end)
  const pl = ensureSheet_(TABS.players, PLAYER_HEADERS).sheet;
  ensureHeaders_(pl, PLAYER_HEADERS);
  pl.getRange('C:C').setNumberFormat('@');
  ensureHeaders_(ensureSheet_(TABS.picks, PICK_HEADERS).sheet, PICK_HEADERS);

  // Answers
  const an = ensureSheet_(TABS.answers, ['Key', 'Question', 'Answer']).sheet;
  const existing = {};
  an.getDataRange().getValues().forEach(function (r) { if (r[0]) existing[String(r[0])] = true; });
  answerRows_().forEach(function (row) {
    if (existing[row[0]]) return;
    const r = an.getLastRow() + 1;
    an.getRange(r, 1, 1, 2).setValues([[row[0], row[1]]]);
    if (row[2] === 'header') { an.getRange(r, 1, 1, 3).setFontWeight('bold').setBackground('#E8EFE6'); return; }
    const cell = an.getRange(r, 3);
    if (row[2] === 'list') cell.setDataValidation(listRule_(row[3]));
    if (row[2] === 'check') cell.insertCheckboxes();
  });
  an.setColumnWidth(1, 170); an.setColumnWidth(2, 460); an.setColumnWidth(3, 170);
  an.getRange('A:A').setFontColor('#999999');

  // Announced temples + hymns sung
  ensureSheet_(TABS.temples, ['City', 'State / Province', 'Country']);
  const hy = ensureSheet_(TABS.hymns, ['Session', 'Hymn title']).sheet;
  hy.getRange('A2:A200').setDataValidation(listRule_(SESSIONS.map(function (s) { return s.label; })));
  hy.setColumnWidth(1, 170); hy.setColumnWidth(2, 360);

  ss.toast('Setup complete.');
}

function answerRows_() {
  const R = [];
  const H = function (key, text) { R.push(['#' + key, text, 'header']); };
  const tie = GAME.tieColors.map(function (c) { return c.label; });
  const fpNames = FP.map(function (f) { return f.name; });

  H('pregame', 'PREGAME');
  DAYS.forEach(function (d) { R.push(['weather_' + d.key, 'Weather in Salt Lake City around noon · ' + d.label, 'list', GAME.weather]); });
  DAYS.forEach(function (d) {
    FP.forEach(function (f) {
      R.push(['tie_' + d.key + '_' + f.key + '_1', d.label + ' tie · ' + f.name + ' · main color', 'list', tie]);
      R.push(['tie_' + d.key + '_' + f.key + '_2', d.label + ' tie · ' + f.name + ' · 2nd stripe color (optional)', 'list', tie]);
    });
  });
  SESSIONS.forEach(function (s) { R.push(['conduct_' + s.key, 'Conducted · ' + s.label, 'list', fpNames]); });

  H('half1', '1ST HALF');
  GAME.apostles.forEach(function (a) { R.push(['apsat_' + slug_(a), 'Spoke Saturday (AM or PM) · ' + a, 'check']); });
  GAME.apostles.forEach(function (a) { R.push(['apsun_' + slug_(a), 'Spoke Sunday (AM or PM) · ' + a, 'check']); });
  GAME.tricks.forEach(function (t) { R.push(['trick_' + t.key, 'Mentioned by a speaker · ' + t.label, 'list', ['Yes', 'No']]); });
  GAME.redZoneSessions.forEach(function (z) {
    FP.forEach(function (f) { R.push(['fp' + z.key.replace('_', '') + '_' + f.key, 'Gave a full talk ' + z.label + ' · ' + f.name, 'check']); });
  });
  GAME.presidencies.forEach(function (o) {
    o.members.forEach(function (m) { R.push(['pres_' + o.key + '_' + slug_(m), 'Gave a talk · ' + o.label + ' · ' + m, 'check']); });
  });

  H('halftime', 'HALFTIME');
  SESSIONS.forEach(function (s) { R.push(['choir_' + s.key, "Choir women's dress color · " + s.label, 'list', GAME.choirColors]); });
  R.push(['youth_choir', "A youth or Primary children's choir sang in any session", 'list', ['Yes', 'No']]);
  R.push(['#hymns_note', 'Hymn keywords and the hymn bonus are scored from the Hymns tab (Session + Hymn title).', 'header']);

  H('half2', '2ND HALF');
  GAME.topics.forEach(function (t) { R.push(['topic_' + slug_(t), 'Topic was the main theme of a talk · ' + t, 'check']); });
  FP.forEach(function (f) { R.push(['fpspoke_' + f.key, 'Gave a talk in any session (for On the Bench) · ' + f.name, 'check']); });
  R.push(['temple_count', 'New temples announced during conference weekend, pulpit or Church News (type 0 if none). List them on AnnouncedTemples.', 'number']);

  H('hail', 'HAIL MARY');
  R.push(['total_talks', 'Total talks across all four sessions (not prayers or the sustaining)', 'number']);

  H('final', 'FINAL WHISTLE');
  R.push(['conference_over', 'Tick when conference is over and every speaker above is ticked. Until then, "No one" presidency picks and On the Bench stay unscored.', 'check']);
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

function ensureHeaders_(sh, headers) {
  const n = Math.max(1, sh.getLastColumn());
  const have = sh.getRange(1, 1, 1, n).getValues()[0].map(String);
  const qi = have.indexOf('Quorum');
  if (qi > -1 && have.indexOf('Group') === -1) { sh.getRange(1, qi + 1).setValue('Group'); have[qi] = 'Group'; }
  headers.forEach(function (h) {
    if (have.indexOf(h) === -1) { sh.getRange(1, sh.getLastColumn() + 1).setValue(h).setFontWeight('bold'); have.push(h); }
  });
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
