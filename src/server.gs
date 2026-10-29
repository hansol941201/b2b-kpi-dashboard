// B2B 통합 KPI 대시보드 — 읽기 전용 웹앱 서버(별도 Apps Script 프로젝트, 통합시트에 바인딩하지 않음)
// 배포: 웹앱 / 실행 = 웹앱에 액세스하는 사용자 / 액세스 = Google 계정이 있는 모든 사용자
// 보안: 보는 사람 본인 권한으로 통합시트를 읽을 수 있을 때만 데이터를 내려준다(시트 공유 권한 = 열람 권한).
//       시트는 Sheets API 값 읽기(spreadsheets.readonly)로만 읽어 이 코드는 시트를 수정할 수 없다. 사업자번호·원장 행은 결과에 넣지 않는다.
var SHEET_ID = '__SHEET_ID__'; // 빌드할 때 config.local.json 의 sheetId 로 바뀜(저장소에는 넣지 않음)
var CACHE_PREFIX = 'b2bdash.v6.'; // 결과 구조가 바뀌면 이름을 올려 운영·시험 배포의 캐시가 섞이지 않게 한다
var CHUNK = 25000;          // 캐시 1칸 글자 수(한글 3바이트 × 25,000 < 100KB 제한)
var CACHE_SEC = 21600;      // 6시간(캐시 최대)
var FORCE_MIN_GAP_MS = 120000;
var READ_OPT = { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' };

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('B2B 통합 KPI 대시보드')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function kst_(d, f) { return Utilities.formatDate(d || new Date(), 'Asia/Seoul', f || 'yyyy-MM-dd HH:mm:ss'); }
function email_() { try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; } }
function q_(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
// 시트 날짜 일련번호(시트 시간대 기준) → 'yyyy-MM-dd HH:mm:ss'
function serialTime_(v) { if (typeof v !== 'number') return String(v === null || v === undefined ? '' : v).trim(); var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000)); return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd HH:mm:ss'); }
function readValues_(name) { var r = Sheets.Spreadsheets.Values.get(SHEET_ID, q_(name), READ_OPT); return r.values || []; }
function canRead_() { Sheets.Spreadsheets.get(SHEET_ID, { fields: 'spreadsheetId' }); }

// 동기화_상태를 읽어 마지막 성공·마지막 데이터 변경 시각을 구한다(빠른 신선도 확인용)
function readSyncState_() {
  var v = readValues_('동기화_상태'); if (v.length < 2) return { lastSuccess: '', lastRun: '', lastChange: '', failed: [] };
  var h = v[0].map(String); var c = function (k) { return h.indexOf(k); };
  var it = c('일시'), im = c('모드'), ir = c('결과'), src = c('원천'), tab = c('탭');
  var chg = ['신규', '수정', '복구', '원천삭제'].map(c);
  var lastSuccess = '', lastRun = '', lastChange = '';
  v.slice(1).forEach(function (r) { if (String(r[im]) !== 'live') return; var t = serialTime_(r[it]); if (t > lastRun) lastRun = t; if (String(r[ir]) === '성공' && t > lastSuccess) lastSuccess = t; var s = 0; chg.forEach(function (i) { s += Number(r[i]) || 0; }); if (s > 0 && t > lastChange) lastChange = t; });
  var failed = v.slice(1).filter(function (r) { return String(r[im]) === 'live' && serialTime_(r[it]) === lastRun && String(r[ir]) !== '성공'; }).map(function (r) { return String(r[src]) + ' ' + String(r[tab]) + ': ' + String(r[ir]); });
  return { lastSuccess: lastSuccess, lastRun: lastRun, lastChange: lastChange, failed: failed };
}

function readCache_() {
  var cache = CacheService.getScriptCache();
  var meta = cache.get(CACHE_PREFIX + 'meta'); if (!meta) return null;
  meta = JSON.parse(meta);
  var ks = []; for (var i = 0; i < meta.n; i++) ks.push(CACHE_PREFIX + i);
  var got = cache.getAll(ks); var parts = [];
  for (var j = 0; j < ks.length; j++) { if (got[ks[j]] === undefined || got[ks[j]] === null) return null; parts.push(got[ks[j]]); }
  return { meta: meta, json: parts.join('') };
}

function writeCache_(meta, json) {
  var cache = CacheService.getScriptCache(); var o = {}; var n = Math.ceil(json.length / CHUNK);
  for (var i = 0; i < n; i++) o[CACHE_PREFIX + i] = json.slice(i * CHUNK, (i + 1) * CHUNK);
  meta.n = n; cache.putAll(o, CACHE_SEC); cache.put(CACHE_PREFIX + 'meta', JSON.stringify(meta), CACHE_SEC);
}

function compute_() {
  var memo = {};
  var props = Sheets.Spreadsheets.get(SHEET_ID, { fields: 'sheets(properties(title,gridProperties))' }).sheets.map(function (s) { return s.properties; });
  var names = props.map(function (p) { return p.title; });
  // 탭별 행 수(머리글 포함) = A열 마지막 값 위치, 열 수 = 1행 머리글 수 — 한 번에 읽음
  var colA = Sheets.Spreadsheets.Values.batchGet(SHEET_ID, { ranges: names.map(function (n) { return q_(n) + '!A:A'; }), valueRenderOption: 'UNFORMATTED_VALUE' }).valueRanges;
  var head = Sheets.Spreadsheets.Values.batchGet(SHEET_ID, { ranges: names.map(function (n) { return q_(n) + '!1:1'; }), valueRenderOption: 'UNFORMATTED_VALUE' }).valueRanges;
  var tabList = names.map(function (n, i) { return { name: n, rows: (colA[i].values || []).length, cols: ((head[i].values || [])[0] || []).length }; });
  var getTab = function (name) { if (memo[name] !== undefined) return memo[name]; memo[name] = names.indexOf(name) >= 0 ? readValues_(name) : null; return memo[name]; };
  var out = analyzeB2B(getTab, { source: 'sheet', asOf: kst_(new Date(), 'yyyy-MM-dd'), tabList: tabList, now: new Date().toISOString(), fix2024: typeof FIX_2024 !== 'undefined' ? FIX_2024 : null });
  out.tabs.forEach(function (t) { if (memo[t.name]) t.rows = memo[t.name].length; }); // 실제로 읽은 탭은 정확한 행 수로
  var ex = ext_(); out.site = ex.site; out.extTables = Object.keys(ex.tables).map(function (k) { var t = ex.tables[k]; return { name: k, group: t.group, note: t.note, rows: t.rows.length, cols: t.header.length }; }); out.extBuiltAt = ex.builtAt || '';
  return out;
}

// 화면에서 호출: 권한 확인 → (필요하면) 다시 계산 → 결과 JSON 문자열
function getDashboard(force) {
  var user = email_();
  try { canRead_(); }
  catch (e) { return { ok: false, code: 'NO_ACCESS', user: user, message: '이 Google 계정은 B2B 통합시트 열람 권한이 없습니다.' }; }
  var sync = readSyncState_();
  var basis = (sync.lastChange || '') + '|' + kst_(new Date(), 'yyyy-MM-dd');
  var cached = readCache_();
  var recent = cached && (Date.now() - cached.meta.at) < FORCE_MIN_GAP_MS;
  if (cached && cached.meta.basis === basis && (!force || recent)) return pack_(cached, 'fresh', sync, user, force && recent ? '방금 계산한 결과입니다(2분 안에는 다시 계산하지 않습니다).' : '');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(170000)) { if (cached) return pack_(cached, 'stale', sync, user, '다른 사용자가 계산하는 중이라 이전 계산값을 표시합니다.'); return { ok: false, code: 'BUSY', user: user, message: '다른 사용자가 계산하는 중입니다. 1~2분 뒤 다시 시도하세요.' }; }
  try {
    var again = readCache_();
    if (again && again.meta.basis === basis && !force) return pack_(again, 'fresh', sync, user, '');
    var t0 = Date.now();
    var data = compute_();
    var json = JSON.stringify(data);
    if (/\d{3}-\d{2}-\d{5}/.test(json)) throw new Error('결과에 사업자번호 형식 문자열이 있어 표시를 중단했습니다.');
    var meta = { at: Date.now(), computedAt: kst_(), basis: basis, ms: Date.now() - t0, bytes: json.length };
    writeCache_(meta, json);
    return pack_({ meta: meta, json: json }, 'fresh', sync, user, '');
  } catch (err) {
    if (cached) return pack_(cached, 'stale', sync, user, '최신 계산에 실패해 이전 계산값을 표시합니다: ' + String(err && err.message || err));
    return { ok: false, code: 'COMPUTE_FAIL', user: user, message: '계산에 실패했습니다: ' + String(err && err.message || err) };
  } finally { lock.releaseLock(); }
}

function pack_(c, status, sync, user, warning) {
  return { ok: true, status: status, meta: { computedAt: c.meta.computedAt, basis: c.meta.basis, ms: c.meta.ms, bytes: c.meta.bytes }, sync: sync, user: user, warning: warning || '', json: c.json };
}

// ── 편집기에서 직접 실행하는 점검용(트리거 없음) ──
// 원장·메인자재 합계를 분석 코드와 별개로 다시 더해 로그에 남긴다(시험 1·2·3).
function verifyTotals() {
  var L = readValues_('01_ERP최신원장'); var h = L[0];
  var ia = h.indexOf('공급가액'), id = h.indexOf('抽出ID'), im = h.indexOf('메인여부');
  var sum = 0, main = 0, seen = {}, dup = 0;
  for (var i = 1; i < L.length; i++) { var a = Number(L[i][ia]) || 0; sum += a; if (L[i][im] === true || String(L[i][im]).toUpperCase() === 'TRUE') main += a; var k = String(L[i][id]); if (seen[k]) dup++; seen[k] = 1; }
  var M = readValues_('02_메인자재최신상세'); var hm = M[0]; var ma = hm.indexOf('공급가액'); var msum = 0; for (var j = 1; j < M.length; j++) msum += Number(M[j][ma]) || 0;
  var out = { ledgerRows: L.length - 1, ledgerSum: sum, ledgerDupIds: dup, mainFlagSum: main, mainTabRows: M.length - 1, mainTabSum: msum };
  Logger.log('VERIFY|' + JSON.stringify(out));
  return out;
}
// 권한 없는 시트를 열 때 숫자 없이 NO_ACCESS 로 끝나는지 확인(시험 9) — 존재하지 않는 시트 ID 사용
function testNoAccess() {
  var saved = SHEET_ID; SHEET_ID = '1NoAccessTest0000000000000000000000000000000';
  try { var r = getDashboard(false); Logger.log('NOACCESS|' + JSON.stringify({ ok: r.ok, code: r.code, hasJson: !!r.json })); return r; } finally { SHEET_ID = saved; }
}
// 보고서·대조용: 캐시된 결과의 구역별 MD5와 요약 구역 JSON을 로그로 남긴다(시험 1~6, 보고서 수치)
function reportDump() {
  var r = getDashboard(false); if (!r.ok) { Logger.log('DUMP|FAIL|' + r.message); return; }
  var d = JSON.parse(r.json);
  var md5 = function (s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8).map(function (b) { return ((b + 256) % 256).toString(16); }).join(''); };
  var h = {}; Object.keys(d).forEach(function (k) { if (k !== 'generatedAt' && k !== 'source') h[k] = md5(JSON.stringify(d[k])).slice(0, 10); });
  Logger.log('HASH|' + JSON.stringify(h));
  var keep = ['asOf', 'ledger', 'ytdCut', 'noticeCut', 'salesYear', 'noticeYear', 'market', 'kpi4', 'trackerKpi', 'stages', 'mou', 'repeat', 'concentration', 'serviceYear', 'serviceLiveAdded', 'tabClassCount', 'live2026', 'vendorYear', 'mainBuyerYear', 'firmCount', 'awardFirmCount', 'futureNoticesExcluded'];
  var sub = {}; keep.forEach(function (k) { sub[k] = d[k]; }); sub.verify = { unlinked: d.verify.unlinked, amountCheck: d.verify.amountCheck, checks: d.verify.checks, dedupe: d.verify.dedupe, counts: { codeMismatch: d.verify.bizConflicts.codeMismatch.length, masterShared: d.verify.bizConflicts.masterShared.length, invalid: d.verify.awardIssues.invalid.length, regroup: d.verify.awardIssues.regroupGroups, kapt: d.verify.awardIssues.kaptMismatch.length } };
  sub.sync = { lastSuccess: d.sync.lastSuccess, lastRun: d.sync.lastRun, lastChange: d.sync.lastChange, failedLatest: d.sync.failedLatest, tabs: d.sync.tabs, changes7: d.sync.changes7 }; sub.meta = r.meta;
  var j = JSON.stringify(sub); var n = Math.ceil(j.length / 1500);
  for (var i = 0; i < n; i++) Logger.log('J|' + i + '|' + j.slice(i * 1500, (i + 1) * 1500));
  Logger.log('JEND|' + n + '|' + j.length);
}
// 계산을 한 번 돌려 핵심값·소요시간을 로그에 남긴다(캐시도 채움).
function warmUp() {
  var r = getDashboard(true); if (!r.ok) { Logger.log('WARM|FAIL|' + r.message); return; }
  var d = JSON.parse(r.json);
  Logger.log('WARM|' + JSON.stringify({ status: r.status, warn: r.warning, ms: r.meta.ms, bytes: r.meta.bytes, total: d.ledger.total, rows: d.ledger.rows, y2026: d.salesYear[4].net, main2026: d.salesYear[4].main, pour2026: d.noticeYear[4].pour, lastSync: r.sync.lastSuccess, firms: d.firms.length }));
}

// ── 전체 데이터 조회: 원본 행을 그대로 페이지 단위로 내려준다(접속자 본인 권한으로 읽음, KPI 합산과 별개) ──
// 내장 자료(EXT_DATA_B64): 로컬 엑셀(잔디 L2 영업활동·PT 신청·진행, 126곳 매칭)을 build-ext.cjs 로 묶은 것. 시트 권한이 있어야만 열람.
var EXT_ = null;
function ext_() {
  if (EXT_) return EXT_;
  if (typeof EXT_DATA_B64 === 'undefined' || !EXT_DATA_B64) { EXT_ = { site: null, tables: {} }; return EXT_; }
  var blob = Utilities.newBlob(Utilities.base64Decode(EXT_DATA_B64), 'application/x-gzip');
  EXT_ = JSON.parse(Utilities.ungzip(blob).getDataAsString('UTF-8')); return EXT_;
}
function getBrowse(name, opt) {
  var user = email_();
  try { canRead_(); } catch (e) { return { ok: false, code: 'NO_ACCESS', user: user, message: '이 Google 계정은 B2B 통합시트 열람 권한이 없습니다.' }; }
  try {
    var ex = ext_().tables[name], header, body;
    if (ex) { header = ex.header; body = ex.rows; } else { var v = readValues_(name); header = (v[0] || []).map(String); body = v.slice(1); }
    var r = browseRows(header, body, opt || {}); r.ok = true; r.name = name; r.src = ex ? '내장 자료(로컬 엑셀)' : '통합시트 탭'; r.note = ex ? ex.note : ''; return r;
  } catch (err) { return { ok: false, code: 'READ_FAIL', message: '읽기에 실패했습니다: ' + String(err && err.message || err) }; }
}
// 전체 탭 행 수 점검: 시트 A열 기준 행 수와 실제로 읽은 행 수(빈 행 포함)를 탭마다 비교. 6시간 캐시.
function getInventory(force) {
  var user = email_();
  try { canRead_(); } catch (e) { return { ok: false, code: 'NO_ACCESS', user: user, message: '이 Google 계정은 B2B 통합시트 열람 권한이 없습니다.' }; }
  var cache = CacheService.getScriptCache(), ck = CACHE_PREFIX + 'inv';
  if (!force) { var c = cache.get(ck); if (c) return JSON.parse(c); }
  var t0 = Date.now();
  var names = Sheets.Spreadsheets.get(SHEET_ID, { fields: 'sheets(properties(title))' }).sheets.map(function (s) { return s.properties.title; });
  var colA = Sheets.Spreadsheets.Values.batchGet(SHEET_ID, { ranges: names.map(function (n) { return q_(n) + '!A:A'; }) }).valueRanges;
  // 읽기 요청 한도(분당 60회)를 넘지 않도록 탭 8개씩 한 번에 읽는다
  var vals = []; for (var g = 0; g < names.length; g += 8) { var part = names.slice(g, g + 8); var got = null; for (var tr = 0; tr < 4 && !got; tr++) { try { got = Sheets.Spreadsheets.Values.batchGet(SHEET_ID, { ranges: part.map(q_), valueRenderOption: READ_OPT.valueRenderOption, dateTimeRenderOption: READ_OPT.dateTimeRenderOption }).valueRanges; } catch (e) { if (!/Quota|429/.test(String(e))) throw e; Utilities.sleep(20000); } } if (!got) throw new Error('읽기 한도 초과로 점검을 끝내지 못했습니다. 잠시 뒤 다시 시도하세요.'); got.forEach(function (x) { vals.push(x.values || []); }); }
  var tabs = names.map(function (n, i) { var v = vals[i]; var body = v.slice(1), empty = 0; body.forEach(function (r) { if (!r.some(function (x) { return x !== '' && x !== null; })) empty++; }); var b = browseRows((v[0] || []).map(String), body, { size: 200 });
    return { name: n, colARows: Math.max(0, (colA[i].values || []).length - 1), readRows: body.length, empty: empty, browseTotal: b.total, pages200: b.pages, ok: b.total === body.length }; });
  var ex = ext_(); Object.keys(ex.tables).forEach(function (k) { var t = ex.tables[k]; tabs.push({ name: k, ext: true, colARows: t.rows.length, readRows: t.rows.length, empty: 0, browseTotal: browseRows(t.header, t.rows, {}).total, ok: true }); });
  var out = { ok: true, at: kst_(), ms: Date.now() - t0, tabs: tabs };
  try { cache.put(ck, JSON.stringify(out), CACHE_SEC); } catch (e) { }
  return out;
}
