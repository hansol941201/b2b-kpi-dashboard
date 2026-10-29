// analyze.js v2 — B2B 통합시트 분석(대시보드용). Node(로컬 이관본)와 Apps Script(웹앱 서버)에서 같은 코드로 실행한다.
// 입력: getTab(name) → 2차원 배열(첫 행 머리글) 또는 null. 출력: 대시보드 JSON(집계값·업체명만, 원장 행·사업자번호·연락처 없음).
// 원칙: 금액은 01_ERP최신원장만 합산. 보존_06(옛 원장)·원본6_*·요약 탭은 합산하지 않는다(대조용으로만 읽음).
//       업체 연결은 사업자번호·업체코드 근거와 이름 추정을 섞지 않는다. 증빙 없는 값은 null(산출 불가)로 둔다.
function analyzeB2B(getTab, opt) {
  opt = opt || {};
  var OUT = { version: 'analyze v2 2026-10-28', source: opt.source || '', generatedAt: opt.now || '' };
  function T(name) { var a = getTab(name); if (!a || !a.length) return { h: [], rows: [], n: 0, c: function () { return -1; } }; var h = a[0].map(function (x) { return String(x); }); var rows = a.slice(1).filter(function (r) { return r.some(function (c) { return c !== '' && c !== null && c !== undefined; }); }); return { h: h, rows: rows, n: rows.length, c: function (k) { return h.indexOf(k); } }; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymdUTC(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function ds(v) { if (v === null || v === undefined || v === '') return ''; if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate()); if (typeof v === 'number') { if (v > 20000 && v < 80000) return ymdUTC(new Date(Date.UTC(1899, 11, 30) + Math.floor(v + 1e-9) * 86400000)); return ''; } var s = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s)) { var t = new Date(s); return isNaN(t.getTime()) ? '' : ymdUTC(new Date(t.getTime() + 9 * 3600000)); } var m = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/); return m ? m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]) : ''; }
  function dts(v) { if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate()) + ' ' + pad(v.getHours()) + ':' + pad(v.getMinutes()) + ':' + pad(v.getSeconds()); if (typeof v === 'number' && v > 20000 && v < 80000) { var t = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000)); return ymdUTC(t) + ' ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) + ':' + pad(t.getUTCSeconds()); } return str(v); }
  function num(v) { if (typeof v === 'number') return v; var s = String(v === null || v === undefined ? '' : v).replace(/[,\s원]/g, ''); var n = Number(s); return isFinite(n) && s !== '' ? n : 0; }
  function bool(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
  function str(v) { return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim(); }
  function digits(v) { return str(v).replace(/\D/g, ''); }
  function inc(o, k, v) { o[k] = (o[k] || 0) + (v === undefined ? 1 : v); }
  function r0(x) { return Math.round(x); }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : null; }
  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); var m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function dayDiff(a, b) { return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000); }
  function addDays(a, n) { return ymdUTC(new Date(Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) + n * 86400000)); }
  function keys(o) { return Object.keys(o); }
  function maxS(a, b) { return (a || '') > (b || '') ? a : b; }
  function jsonArr(v) { try { var x = JSON.parse(String(v)); return Array.isArray(x) ? x : []; } catch (e) { return []; } }
  var YEARS = ['2022', '2023', '2024', '2025', '2026'];
  var ASOF = opt.asOf || '9999-12-31'; OUT.asOf = opt.asOf || '';
  var CUT_NOTICE = ASOF.slice(5);
  var INTERNAL = /넷폼|포어솔루션|테스트|미기재/;

  // ── 0. 탭 목록·분류 ──
  var CLASS = [
    [/^01_ERP최신원장$/, '확정', '공식 매출 합계의 유일한 원장(행·금액 확정, 법인·현장 연결은 별도)'],
    [/^02_메인자재최신상세$/, '확정', '01 원장 중 메인자재 확정 분류 행(01의 부분집합 — 합산 금지)'],
    [/^보존_07_품목분류$/, '확정', '품목 분류 기준표(2024~ 확정 범위)'],
    [/^동기화_[②③]_/, '참고', '원천 시트 실시간 거울(30분 자동 동기화) — 원천 표기 그대로'],
    [/^동기화_(상태|변경이력|중복위험|요약)$/, '운영 기록', '자동 동기화 실행·이력 로그'],
    [/^보존_(02_업체마스터|03_현장마스터|18_MOU협약근거)$/, '참고', '업체·현장·협약 기준표(코드·사업자번호 일부, 이름 연결은 추정)'],
    [/^보존_(08_공고|09_낙찰상태|12_L3서비스|14_L1관심|04_메인구매업체|05_메인구매상세)$/, '참고', '2022~2026 통합 관측(내부 ID, 업체 연결은 정규화명 추정)'],
    [/^(03_ERP59계정_표본검증|04_낙찰188명칭검증|05_Kapt원문관측|08_11건추가대조|보존_1[0167]_|보존_2[1589]_|보존_22_|보존_26_)/, '검증 중', '연결·원문 대조 진행 자료(공식 분자 미포함)'],
    [/^(09_34명칭추가후보|10_KPI4개|11_트래커KPI3개|보존_15_L2확정)$/, '미확정', '증빙 부족으로 확정 불가 항목 기록'],
    [/^(12_연도별매출|13_월별매출|14_공고연도_참고집계|보존_19_|보존_20_|보존_24_|보존_30_|98_|99_|00_이용안내|보존_00_|보존_01_)/, '요약·검산', '집계 결과·검산·안내(원장과 합산 금지)'],
    [/^(원본6_|06_신규연도별原本|07_新旧공고연결|15_신규6파일검증|16_과거특허명부_참고|보존_06_매출정합원장|보존_13_서비스원본연결|보존_23_공고현재관측|보존_27_)/, '원본 사본·중복', '원천 사본·옛 원장·원문 연결(합산 금지)'],
    [/^시트1$/, '빈 탭', '기본 빈 탭']
  ];
  var tabs = (opt.tabList || []).map(function (t) { var cls = '미분류', why = ''; for (var i = 0; i < CLASS.length; i++) if (CLASS[i][0].test(t.name)) { cls = CLASS[i][1]; why = CLASS[i][2]; break; } return { name: t.name, rows: t.rows, cols: t.cols, cls: cls, why: why }; });
  OUT.tabs = tabs; var cs = {}; tabs.forEach(function (t) { inc(cs, t.cls); }); OUT.tabClassCount = cs;

  // ── 1. 매출(01_ERP최신원장) ──
  var IC = T('보존_07_품목분류'); var NONMAT = {}; IC.rows.forEach(function (r) { if (str(r[IC.c('메인보조구분')]) === '비자재') NONMAT[str(r[IC.c('품목키')])] = 1; });
  OUT.nonMaterialItems = keys(NONMAT);
  var L = T('01_ERP최신원장'); var c = { d: L.c('거래일'), v: L.c('거래처원문'), code: L.c('등록코드후보'), item: L.c('품목명'), amt: L.c('공급가액'), grp: L.c('자재군'), main: L.c('메인여부'), st: L.c('분류상태'), slip: L.c('전표번호'), id: L.c('抽出ID') };
  var MAINK = { 우레탄: 'u', 재도장: 'p', 에폭시: 'e' };
  function catOf(item, g, st, isMain) { if (NONMAT[item]) return 'nonmat'; if (isMain) return 'main'; if (st === '미분류') return 'unc'; if (st === '분류 확인 필요') return 'review'; return 'other'; }
  function zc() { return { main: 0, u: 0, p: 0, e: 0, other: 0, review: 0, unc: 0, nonmat: 0 }; }
  var maxD = '', minD = '9999', ids = {}, slips = {}, vendSet = {}, total = 0, dupIds = 0;
  var Y = {}, MON = {}, ITEM = {}, V = {};
  YEARS.forEach(function (y) { Y[y] = { rows: 0, net: 0, pos: 0, neg: 0, negRows: 0, vendors: {}, mainVendors: {}, cat: zc() }; });
  L.rows.forEach(function (r) {
    var d = ds(r[c.d]); if (!d) return; var y = d.slice(0, 4), m = d.slice(0, 7), a = num(r[c.amt]), g = str(r[c.grp]) || '미분류', st = str(r[c.st]), isMain = bool(r[c.main]), vn = str(r[c.v]), item = str(r[c.item]);
    var ct = catOf(item, g, st, isMain), mk = isMain ? MAINK[g] : '';
    if (d > maxD) maxD = d; if (d < minD) minD = d; total += a; var rid = str(r[c.id]); if (ids[rid]) dupIds++; ids[rid] = 1; slips[str(r[c.slip])] = 1; vendSet[vn] = 1;
    var YY = Y[y]; if (YY) { YY.rows++; YY.net += a; if (a >= 0) YY.pos += a; else { YY.neg += a; YY.negRows++; } YY.vendors[vn] = 1; YY.cat[ct] += a; if (mk) YY.cat[mk] += a; if (isMain) YY.mainVendors[vn] = 1; }
    var MM = MON[m] = MON[m] || { net: 0, rows: 0, cat: zc() }; MM.net += a; MM.rows++; MM.cat[ct] += a; if (mk) MM.cat[mk] += a;
    var it = ITEM[item] = ITEM[item] || { cat: ct, g: g, st: st, y: {} }; inc(it.y, y, a);
    var vv = V[vn] = V[vn] || { net: 0, main: 0, byY: {}, mainY: {}, dates: {}, slips: {}, first: '9999', last: '', mainLast: '', mainFirst: '', code: '', mg: { u: 0, p: 0, e: 0 }, mgY: {} };
    vv.net += a; inc(vv.byY, y, a); if (isMain) { vv.main += a; inc(vv.mainY, y, a); if (d > vv.mainLast) vv.mainLast = d; if (a > 0 && (!vv.mainFirst || d < vv.mainFirst)) vv.mainFirst = d; } if (mk) { vv.mg[mk] += a; if (a > 0) vv.mgY[mk + y] = 1; }
    if (a > 0) { vv.dates[d] = 1; vv.slips[str(r[c.slip])] = 1; if (d < vv.first) vv.first = d; if (d > vv.last) vv.last = d; }
    var cd = digits(r[c.code]); if (cd.length === 10) vv.code = cd;
  });
  OUT.ledger = { rows: L.n, uniqueIds: keys(ids).length, duplicateIds: dupIds, uniqueSlips: keys(slips).length, uniqueVendors: keys(vendSet).length, total: r0(total), minDate: minD, maxDate: maxD };
  var cut = maxD.slice(5); OUT.ytdCut = cut; // 동일기간 = 각 연도 01-01 ~ 원장 마지막 거래일의 월-일
  var ytd = {}; L.rows.forEach(function (r) { var d = ds(r[c.d]); if (d && d.slice(5) <= cut) { var y = d.slice(0, 4); var a = num(r[c.amt]); ytd[y] = ytd[y] || { net: 0, main: 0, mat: 0 }; ytd[y].net += a; if (bool(r[c.main])) ytd[y].main += a; if (!NONMAT[str(r[c.item])]) ytd[y].mat += a; } });
  function rc(o) { var x = {}; for (var k in o) x[k] = r0(o[k]); return x; }
  OUT.salesYear = YEARS.map(function (y, i) { var a = Y[y], p = Y[YEARS[i - 1]]; var t = ytd[y] || { net: 0, main: 0, mat: 0 }, tp = ytd[YEARS[i - 1]]; var inRange = y >= '2024'; var mat = a.net - a.cat.nonmat;
    return { year: y, rows: a.rows, net: r0(a.net), mat: r0(mat), gross: r0(a.pos), returns: r0(a.neg), returnRows: a.negRows, vendors: keys(a.vendors).length, yoy: p ? pct(a.net - p.net, p.net) : null, cat: rc(a.cat),
      main: inRange ? r0(a.cat.main) : null, mainG: inRange ? { 우레탄: r0(a.cat.u), 재도장: r0(a.cat.p), 에폭시: r0(a.cat.e) } : null, mainShare: inRange ? pct(a.cat.main, a.net) : null, mainShareMat: inRange ? pct(a.cat.main, mat) : null, mainVendors: inRange ? keys(a.mainVendors).length : null,
      mainYoy: (y >= '2025' && p) ? pct(a.cat.main - p.cat.main, p.cat.main) : null,
      ytdNet: r0(t.net), ytdMat: r0(t.mat), ytdYoy: tp ? pct(t.net - tp.net, tp.net) : null, ytdMain: inRange ? r0(t.main) : null, ytdMainYoy: (y < '2025' || !tp) ? null : pct(t.main - tp.main, tp.main) }; });
  OUT.salesMonth = keys(MON).sort().map(function (m) { var o = MON[m]; return { m: m, net: r0(o.net), rows: o.rows, cat: rc(o.cat), inRange: m >= '2024' }; });
  OUT.items = keys(ITEM).map(function (k) { var it = ITEM[k]; return [k, it.cat, it.g, it.st, YEARS.map(function (y) { return r0(it.y[y] || 0); })]; }).filter(function (x) { return x[4].some(function (v) { return v !== 0; }); }).sort(function (a, b) { return b[4].reduce(function (s, v) { return s + v; }, 0) - a[4].reduce(function (s, v) { return s + v; }, 0); });

  // 업체(ERP 거래처) 분석 — 거래처원문 단위(표기 다르면 별도), 법인 합치기는 하지 않음
  var vend = keys(V).map(function (k) { var v = V[k]; var dl = keys(v.dates).sort(); var gaps = []; for (var i = 1; i < dl.length; i++) gaps.push(dayDiff(dl[i - 1], dl[i]));
    return { name: k, net: v.net, main: v.main, byY: v.byY, mainY: v.mainY, mg: v.mg, mgY: v.mgY, mainFirst: v.mainFirst, first: v.first === '9999' ? '' : v.first, last: v.last, mainLast: v.mainLast, buyDays: dl.length, dateList: dl, slips: keys(v.slips).length, gapMed: median(gaps), code: v.code }; });
  OUT.vendorYear = YEARS.map(function (y) { var act = vend.filter(function (v) { return v.dateList.some(function (d) { return d.slice(0, 4) === y; }); }); var nw = act.filter(function (v) { return v.first.slice(0, 4) === y; }).length; return { year: y, active: act.length, newV: nw, existing: act.length - nw }; });
  var REC = [['90일 이내', 0, 90], ['91~180일', 91, 180], ['181~365일', 181, 365], ['1년 초과', 366, 99999]];
  OUT.recency = REC.map(function (b) { var list = vend.filter(function (v) { if (!v.last) return false; var g = dayDiff(v.last, maxD); return g >= b[1] && g <= b[2]; }); return { bucket: b[0], vendors: list.length, net: r0(list.reduce(function (s, v) { return s + v.net; }, 0)) }; });
  var buyerCount = vend.filter(function (v) { return v.buyDays > 0; }).length;
  var repeat = vend.filter(function (v) { return v.buyDays >= 2; });
  OUT.repeat = { buyers: buyerCount, repeatBuyers: repeat.length, repeatRate: pct(repeat.length, buyerCount), medianGapDays: median(repeat.map(function (v) { return v.gapMed; })), medianBuyDays: median(vend.filter(function (v) { return v.buyDays; }).map(function (v) { return v.buyDays; })) };
  var FREQ = [['1회', 1, 1], ['2~5회', 2, 5], ['6~20회', 6, 20], ['21회 이상', 21, 1e9]];
  OUT.freq = FREQ.map(function (b) { var l = vend.filter(function (v) { return v.buyDays >= b[1] && v.buyDays <= b[2]; }); return { bucket: b[0], vendors: l.length, net: r0(l.reduce(function (s, v) { return s + v.net; }, 0)) }; });
  vend.sort(function (a, b) { return b.net - a.net; });
  OUT.concentration = { top10: pct(vend.slice(0, 10).reduce(function (s, v) { return s + v.net; }, 0), total), top20: pct(vend.slice(0, 20).reduce(function (s, v) { return s + v.net; }, 0), total) };
  var NONFIRM = /스토어판매|^하자$|개인구매|넷폼|포어솔루션/;
  OUT.vendors = vend.filter(function (v) { return v.net !== 0 || v.main !== 0; }).slice(0, 120).map(function (v) { return { name: v.name, nonFirm: NONFIRM.test(v.name), net: r0(v.net), main: r0(v.main), y: YEARS.map(function (y) { return r0(v.byY[y] || 0); }), my: YEARS.map(function (y) { return r0(v.mainY[y] || 0); }), first: v.first, last: v.last, buyDays: v.buyDays, gapMed: v.gapMed, idle: v.last ? dayDiff(v.last, maxD) : null }; });
  OUT.lapsed = vend.filter(function (v) { return v.last && dayDiff(v.last, maxD) > 180 && !NONFIRM.test(v.name); }).slice(0, 30).map(function (v) { return { name: v.name, net: r0(v.net), last: v.last, idle: dayDiff(v.last, maxD), buyDays: v.buyDays }; });
  var erpCodes = {}, erpMainCodes = {}, codeVendors = {}; vend.forEach(function (v) { if (v.code) { erpCodes[v.code] = (erpCodes[v.code] || 0) + v.net; if (v.main > 0) erpMainCodes[v.code] = 1; (codeVendors[v.code] = codeVendors[v.code] || []).push(v); } });
  OUT.mainBuyerCount = vend.filter(function (v) { return v.main > 0; }).length;
  OUT.mainBuyerYear = YEARS.map(function (y) { return y < '2024' ? null : vend.filter(function (v) { return (v.mainY[y] || 0) > 0; }).length; });
  OUT.vendorNoCode = { vendors: vend.filter(function (v) { return !v.code; }).length, net: r0(vend.filter(function (v) { return !v.code; }).reduce(function (s, v) { return s + v.net; }, 0)) };

  // ── 2. 업체 마스터(협약) ──
  var MS = T('보존_02_업체마스터'); var mc = { id: MS.c('통합업체ID'), b2b: MS.c('B2B고유코드'), biz: MS.c('사업자번호'), mou: MS.c('협약일'), nw: MS.c('신규기존구분'), st: MS.c('코드상태'), nm: MS.c('표준업체명'), raw: MS.c('원본업체명'), al1: MS.c('이카운트거래처표기'), al2: MS.c('낙찰업체표기'), al3: MS.c('플랫폼업체표기') };
  var bizToId = {}, bizIds = {}, idInfo = {};
  MS.rows.forEach(function (r) { var id = str(r[mc.id]); var b = digits(r[mc.biz]); if (b.length === 10) { bizToId[b] = bizToId[b] || id; (bizIds[b] = bizIds[b] || []).push(id); }
    var al = {}; [mc.raw, mc.al1, mc.al2, mc.al3].forEach(function (ci) { str(r[ci]).split(' | ').forEach(function (x) { x = str(x); if (x) al[x] = 1; }); });
    idInfo[id] = { b2b: /^B2B/.test(str(r[mc.b2b])), mou: ds(r[mc.mou]), nw: str(r[mc.nw]), biz: b, name: str(r[mc.nm]), al: keys(al), st: str(r[mc.st]) }; });
  var bizConflicts = keys(bizIds).filter(function (b) { return bizIds[b].length > 1; }).map(function (b) { return bizIds[b].map(function (id) { return idInfo[id].name + '(' + id + ')'; }).join(' / '); });

  // ── 3. 공고·낙찰 — 2022~2025: 보존_08(공고ID 중복 제거), 2026: 동기화_③ POUR 실시간(원천삭제·공식집계 N 제외) ──
  function normSt(s) { return str(s).replace(/\s+/g, ''); }
  function stCat(s) { s = normSt(s); if (s === '낙찰') return 'award'; if (/타공법/.test(s)) return 'other'; if (/무효/.test(s)) return 'invalid'; if (/유찰/.test(s)) return 'fail'; if (/취소|해지/.test(s)) return 'cancel'; if (/확인중/.test(s)) return 'checking'; return 'open'; }
  var GROUPS = [['재도장·균열', /재도장|도장|균열|페인트|외벽/], ['옥상방수(우레탄·시트)', /방수|우레탄|시트|슬라브|슬래브|PVC|복합|배면|차수/], ['지붕(슁글·금속기와)', /싱글|슁글|기와|지붕/], ['주차장·에폭시', /에폭시|주차장|바닥/], ['도로·포장', /아스콘|도로|포장|보도/], ['기타', /./]];
  function kindOf(s, s2) { s = str(s) + ' ' + str(s2); for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][1].test(s)) return GROUPS[i][0]; return '기타'; }
  OUT.kindGroups = GROUPS.map(function (g) { return g[0]; });
  var NOTICES = []; // {y, d, g, pour, st, firm, fid, amt, regroup, site, src}
  var N = T('보존_08_공고'); var nc = { id: N.c('공고ID'), d: N.c('공고일'), st: N.c('공고상태'), pour: N.c('POUR판정'), w: N.c('낙찰업체원문'), wid: N.c('시공사키'), amt: N.c('낙찰금액'), kind: N.c('공종'), job: N.c('공사명'), rg: N.c('재공고그룹'), site: N.c('현장명') };
  var A09 = T('보존_09_낙찰상태'); var id09 = {}, codeMis = {}; A09.rows.forEach(function (r) { var nid = str(r[A09.c('공고ID')]), tid = str(r[A09.c('통합업체ID')]), sk = str(r[A09.c('시공사키')]); if (tid) id09[nid] = tid; if (/^B2B/.test(tid) && /^B2B/.test(sk) && tid !== sk) { var mm = str(r[A09.c('낙찰업체원문')]) + ' — 원천 업체코드 ' + sk + ' → 이름 기준 ' + tid; codeMis[mm] = (codeMis[mm] || 0) + 1; } });
  var FIX = opt.fix2024 || {};
  function fixId(nid, id) { var fx = FIX[nid]; if (!fx) return { id: id, g: '' }; if (fx[0] === 'A1' || fx[0] === 'A2' || fx[0] === 'D') return { id: fx[1], g: fx[0] }; return { id: '', g: fx[0] }; }
  var seenN = {}, dupNotice = 0; OUT.futureNoticesExcluded = 0;
  // POUR 특허번호 기재 판정 — 동기화_③_특허(특허 명부)에서 넷폼알앤디 소유 번호만 자사 특허로 본다. 원천 특허 칸에 자사 번호가 적힌 공고 = '특허번호 기재', 나머지 = 'POUR 관련 후보'(확정 건수 제외)
  var PT = T('동기화_③_특허'); var OWN = {}; PT.rows.forEach(function (r) { if (/넷폼/.test(str(r[PT.c('업체명')]))) { var d7 = digits(r[PT.c('특허번호')]).slice(-7); if (d7.length === 7) OWN[d7] = 1; } });
  OUT.patentRef = { own: keys(OWN).length, registry: PT.n };
  function patsOf(s) { var m = str(s).match(/\d{2}-?\d{7}|\d{7}/g) || []; var o = []; m.forEach(function (x) { var d7 = x.replace(/\D/g, '').slice(-7); if (o.indexOf(d7) < 0) o.push(d7); }); return o; }
  function patInfo(txt, brand) { var p = patsOf(txt), own = p.filter(function (x) { return OWN[x]; }); if (own.length) return { pat: true, show: own.map(function (x) { return '10-' + x; }).join(', ') };
    var t = str(txt), why = p.length ? '자사 외 특허번호만 기재' : /pour|푸어|퓨어|포어/i.test(t) ? 'POUR 표기·특허번호 없음' : t ? '특허번호 없음' : '특허 칸 비어 있음'; return { pat: false, show: (brand ? '브랜드 ' + brand + ' · ' : '') + why + (t ? ' (' + t.slice(0, 28) + ')' : '') }; }
  // 목록 상태 코드: A 낙찰(업체 확인) O 타공법 낙찰 V 낙찰무효 T 계약해지 | F 유찰 C 공고 취소 M 수정 공고 | W 결과 대기(개찰 전) K 낙찰 확인 중 | G 자료 미확보(개찰일 지남·결과 미기재) N 자료 미확보(낙찰 표기·업체 미기재)
  function stCode(raw, firm, d, open) { var s = normSt(raw); if (s === '낙찰') return firm ? 'A' : 'N'; if (/타공법/.test(s)) return 'O'; if (/무효/.test(s)) return 'V'; if (/해지/.test(s)) return 'T'; if (/유찰/.test(s)) return 'F'; if (/수정공고/.test(s)) return 'M'; if (/취소/.test(s)) return 'C'; if (/확인중/.test(s)) return 'K'; if (open) return open < ASOF ? 'G' : 'W'; return dayDiff(d, ASOF) > 60 ? 'G' : 'W'; }
  function nm1(s) { return str(s).replace(/[\s().·,\-]|사업자|선정|입찰|공고/g, ''); }
  // K-apt 원문 대조(05_Kapt원문관측) — 공고ID, 또는 공고일+공사명으로 찾음
  var KAP = T('05_Kapt원문관측'), kapById = {}, kapByJob = {};
  KAP.rows.forEach(function (r) { var okv = bool(r[KAP.c('원문낙찰업체일치')]); jsonArr(r[KAP.c('source_awards')]).forEach(function (sa) { if (!sa) return; var v = okv ? 'K-apt 원문 낙찰업체 일치' : 'K-apt 원문 확인(표기 다름)'; if (sa['공고ID']) kapById[sa['공고ID']] = v; if (sa['공고일']) kapByJob[str(sa['공고일']) + '|' + nm1(sa['공사명'])] = v; }); });
  // 같은 공고 중복 방지 — 공고ID 외에 현장명+공고일+공사명이 같은 행도 한 번만 센다
  var seenKey = {}; OUT.noticeDupKey = 0;
  function dupKey(site, d, job) { var k = nm1(site) + '|' + d + '|' + nm1(job); if (seenKey[k]) { OUT.noticeDupKey++; return true; } seenKey[k] = 1; return false; }
  N.rows.forEach(function (r) { var d = ds(r[nc.d]); if (!d) return; var y = d.slice(0, 4); if (y > '2025' || y < '2022') return; var id = str(r[nc.id]); if (seenN[id]) { dupNotice++; return; } seenN[id] = 1; if (dupKey(r[nc.site], d, r[nc.job])) return;
    var pi = patInfo(r[N.c('특허원문')], ''), firm = str(r[nc.w]), open = ds(r[N.c('개찰일')]);
    NOTICES.push({ y: y, d: d, g: kindOf(r[nc.kind], r[nc.job]), pour: str(r[nc.pour]) === '확인', pat: pi.pat, patShow: pi.show, st: stCat(r[nc.st]), sc: stCode(r[nc.st], firm, d, open), open: open, firm: firm, fid: fixId(id, id09[id] || str(r[nc.wid])).id, fixg: (FIX[id] || [''])[0], amt: num(r[nc.amt]), regroup: str(r[nc.rg]), site: str(r[nc.site]), src: '보존_08', basis: '원본 공고 파일 낙찰 표기' + (kapById[id] ? ' · ' + kapById[id] : ' · K-apt 원문 대조 없음') + (FIX[id] && /^A/.test(FIX[id][0]) ? ' · 2024 업체코드 정정 적용' : '') }); });
  var P26 = T('동기화_③_26년 POUR 공고문 현황'); var pc = { st: P26.c('공고현황'), s: P26.c('_상태'), k: P26.c('_공식집계'), d: P26.c('공고일'), w: P26.c('낙찰업체'), wid: P26.c('_통합업체ID'), amt: P26.c('낙찰금액'), kind: P26.c('공종상세'), job: P26.c('공사명'), site: P26.c('단지명'), base: P26.c('_기준자료'), grade: P26.c('_업체연결등급'), key: P26.c('_키'), f: ['_①POUR특허포함', '_②낙찰업체확인', '_③ERP동일사업자번호', '_④메인자재구매확인', '_⑤POUR채택확정', '_⑥낙찰후구매확인'].map(function (x) { return P26.c(x); }) };
  var live = { rows: 0, deleted: 0, excluded: 0, future: 0, st: {}, stages: [{}, {}, {}, {}, {}, {}], newSinceBase: 0 };
  P26.rows.forEach(function (r) { if (str(r[pc.s]) === '원천삭제') { live.deleted++; return; } if (str(r[pc.k]) === 'N') { live.excluded++; return; } var d = ds(r[pc.d]); if (!d) return; if (d > ASOF) { live.future++; OUT.futureNoticesExcluded++; return; } var y = d.slice(0, 4); if (y !== '2026') return; if (dupKey(r[pc.site], d, r[pc.job])) return;
    live.rows++; inc(live.st, normSt(r[pc.st])); pc.f.forEach(function (ci, i) { if (ci >= 0) inc(live.stages[i], str(r[ci])); }); if (str(r[pc.base]) === '기준 이후 신규·누락') live.newSinceBase++;
    var pourTxt = pc.f[0] >= 0 ? str(r[pc.f[0]]) : '';
    var pi2 = patInfo(r[P26.c('특허번호')], /^확인 필요/.test(pourTxt) ? pourTxt.replace(/^확인 필요\(브랜드 |\)$/g, '') : ''), firm2 = str(r[pc.w]), open2 = ds(r[P26.c('개찰일')]), chk = ds(r[P26.c('낙찰조회')]), kj = kapByJob[d + '|' + nm1(r[pc.job])];
    NOTICES.push({ y: y, d: d, g: kindOf(r[pc.kind], r[pc.job]), pour: /^포함/.test(pourTxt), pat: pi2.pat, patShow: pi2.show, st: stCat(r[pc.st]), sc: stCode(r[pc.st], firm2, d, open2), open: open2, firm: firm2, fid: str(r[pc.wid]), amt: num(r[pc.amt]), regroup: '', site: str(r[pc.site]), src: '동기화_③', grade: str(r[pc.grade]), adopt: pc.f[4] >= 0 ? str(r[pc.f[4]]) : '', basis: '원천 시트 낙찰 표기' + (kj ? ' · ' + kj : ' · K-apt 원문 대조 전') + (chk ? ' · 낙찰조회 ' + chk : '') }); });
  OUT.live2026 = live;
  // 큐브: 연도×공종그룹 — 클라이언트 기간·공종 필터용(합계는 서버 값과 같아야 함)
  var CUBE = {};
  NOTICES.forEach(function (n) { var p = n.pat ? 'pat' : 'cand', k = n.y + '|' + n.g + '|' + p; var o = CUBE[k] = CUBE[k] || { y: n.y, g: n.g, p: p, n: 0, award: 0, awardNoFirm: 0, other: 0, fail: 0, cancel: 0, invalid: 0, checking: 0, open: 0, regroup: 0, amt: 0, ytdN: 0, ytdAward: 0, adopt: 0 };
    o.n++; if (n.d.slice(5) <= CUT_NOTICE) o.ytdN++;
    if (n.st === 'award') { if (n.firm) { o.award++; o.amt += n.amt; if (n.d.slice(5) <= CUT_NOTICE) o.ytdAward++; } else o.awardNoFirm++; } else o[n.st]++;
    if (n.regroup) o.regroup++; if (/^확정/.test(n.adopt || '')) o.adopt++; });
  OUT.noticeCube = keys(CUBE).sort().map(function (k) { var o = CUBE[k]; o.amt = r0(o.amt); return o; });
  // 연도 합계 — pour = POUR 특허번호 기재 공고(확정), cand = POUR 관련 후보(특허번호 미확인), 상태 칸은 특허번호 기재 공고 기준
  var NYK = ['award', 'awardNoFirm', 'other', 'fail', 'cancel', 'invalid', 'checking', 'open', 'regroup', 'amt', 'ytdAward', 'adopt'];
  OUT.noticeYear = YEARS.map(function (y) { var o = { year: y, src: y === '2026' ? '동기화_③ 실시간' : '보존_08', notices: 0, pour: 0, cand: 0, ytdPour: 0, ytdCand: 0, awardCand: 0, otherCand: 0 }; NYK.forEach(function (k) { o[k] = 0; });
    OUT.noticeCube.forEach(function (c2) { if (c2.y !== y) return; o.notices += c2.n; if (c2.p === 'pat') { o.pour += c2.n; o.ytdPour += c2.ytdN; NYK.forEach(function (k) { o[k] += c2[k]; }); } else { o.cand += c2.n; o.ytdCand += c2.ytdN; o.awardCand += c2.award; o.otherCand += c2.other; } });
    return o; });
  OUT.noticeYear.forEach(function (o, i) { var p = OUT.noticeYear[i - 1]; o.ytdYoy = p ? pct(o.ytdPour - p.ytdPour, p.ytdPour) : null; o.awardRate = pct(o.award, o.pour); });
  OUT.noticeCut = CUT_NOTICE; OUT.noticeDup = dupNotice;
  // 공고 목록(화면 3분류용) — [공고일, 현장명, 공종그룹 번호, 특허번호 기재 1/0, 특허 표시, 상태 코드, 낙찰업체, 낙찰금액, 개찰일, 낙찰 확인 근거, 같은 현장 표시]
  var gIdx = {}; GROUPS.forEach(function (g, i) { gIdx[g[0]] = i; });
  function siteKey(n) { return n.regroup ? 'R' + n.regroup : n.y + '|' + nm1(n.site) + '|' + n.g; }
  var siteAw = {}, siteBad = {}; NOTICES.forEach(function (n) { var k = siteKey(n); if (n.sc === 'A') siteAw[k] = maxS(siteAw[k], n.d); if (n.sc === 'V' || n.sc === 'T') siteBad[k] = maxS(siteBad[k], n.d); });
  OUT.noticeList = NOTICES.slice().sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : 0; }).map(function (n) { var k = siteKey(n), won = 'AOVT'.indexOf(n.sc) >= 0, flag = '';
    if (n.sc === 'A' && siteBad[k] && siteBad[k] <= n.d) flag = '재선정(무효·해지 후 낙찰)';
    else if (!won && siteAw[k]) flag = n.regroup ? '같은 재공고 묶음에서 낙찰 확인' : '같은 현장·공종의 다른 공고에서 낙찰 확인(이름 기준 참고)';
    return [n.d, n.site, gIdx[n.g], n.pat ? 1 : 0, n.patShow, n.sc, won ? n.firm : '', won ? r0(n.amt) : 0, n.open || '', won ? n.basis : '', flag]; });
  OUT.noticeStatus = { A: '낙찰(낙찰업체 확인)', O: '타공법 낙찰(POUR 아님)', V: '낙찰무효', T: '계약해지', F: '유찰(실제 미낙찰)', C: '공고 취소(실제 미낙찰)', M: '수정 공고(후속 공고로 대체)', W: '결과 대기(개찰 전)', K: '낙찰 확인 중', G: '자료 미확보(개찰일 지남·결과 미기재)', N: '자료 미확보(낙찰 표기·업체 미기재)' };
  // 시장 전체 공고 대비 POUR 포함(POUR + 다특허(PD)) — 2026 실시간 전체 공고문 + 2025 원본 사본(참고)
  var A26 = T('동기화_③_26년 전체 공고문'); var ac = { g: A26.c('구분'), d: A26.c('공고일'), s: A26.c('_상태') };
  function shareOf(rows, gi, di, sti, yr, pcols) { var o = { total: 0, pour: 0, pd: 0, ytdTotal: 0, ytdPour: 0, pat: 0, ytdPat: 0, byG: {} }; rows.forEach(function (r) { if (sti >= 0 && str(r[sti]) === '원천삭제') return; var d = ds(r[di]); if (yr && d && d.slice(0, 4) !== yr) return; if (d && d > ASOF) return; var g = str(r[gi]); o.total++; inc(o.byG, g || '미기재'); var p = g === 'POUR' || g === '다특허(PD)'; if (p) o.pour++; if (g === '다특허(PD)') o.pd++; var hp = (pcols || []).some(function (ci) { return patsOf(r[ci]).some(function (x) { return OWN[x]; }); }); if (hp) o.pat++; if (d && d.slice(5) <= CUT_NOTICE) { o.ytdTotal++; if (p) o.ytdPour++; if (hp) o.ytdPat++; } }); o.share = pct(o.pour, o.total); o.ytdShare = pct(o.ytdPour, o.ytdTotal); o.patShare = pct(o.pat, o.total); o.ytdPatShare = pct(o.ytdPat, o.ytdTotal); return o; }
  var mk = { '2026': shareOf(A26.rows, ac.g, ac.d, ac.s, '2026', [A26.c('특허번호')]) };
  var R25 = T('원본6_17_25년 전체 공고문'); if (R25.n) { var rr = R25.rows.map(function (r) { try { return JSON.parse(String(r[R25.c('셀원문_JSON')])); } catch (e) { return null; } }).filter(function (x) { return x && x.length > 26; }); var hi = -1; for (var q = 0; q < rr.length; q++) if (rr[q][1] === 'NO.') { hi = q; break; } var body = rr.slice(hi + 1).filter(function (x) { return x[1] !== null && x[1] !== '' && x[8] !== null; }); mk['2025'] = shareOf(body, 2, 26, -1, '', [9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]); }
  OUT.market = mk;

  // ── 4. 낙찰업체별 이력(2022~2025 보존_08, 2026 실시간) ──
  var AWF = {};
  NOTICES.forEach(function (n) { if (!n.pour || n.st !== 'award' || !n.firm) return; var key = n.fid || ('?' + n.firm); var a = AWF[key] = AWF[key] || { id: n.fid, name: '', raw: n.firm, y: {}, n: 0, amt: 0, last: '', kinds: {}, grades: {} }; a.n++; inc(a.y, n.y); a.amt += n.amt; a.last = maxS(a.last, n.d); inc(a.kinds, n.g); if (n.grade) inc(a.grades, n.grade); });
  OUT.awardFirms = keys(AWF).map(function (k) { var a = AWF[k]; var info = idInfo[a.id] || null; var biz = info ? info.biz : ''; var erp = biz && erpCodes[biz] !== undefined ? codeVendors[biz] : null;
    return { id: a.id || '', name: info ? info.name : a.raw, raw: a.raw, master: !!info, b2b: info ? info.b2b : false, n: a.n, y: YEARS.map(function (y) { return a.y[y] || 0; }), amt: r0(a.amt), last: a.last, topKind: keys(a.kinds).sort(function (x, z) { return a.kinds[z] - a.kinds[x]; })[0] || '',
      erpLink: erp ? '후보(이름→명부→ERP)' : (biz ? 'ERP 거래 없음' : '명부 사업자번호 없음'), erpNet: erp ? r0(erp.reduce(function (s, v) { return s + v.net; }, 0)) : null, erpMain: erp ? r0(erp.reduce(function (s, v) { return s + v.main; }, 0)) : null }; })
    .sort(function (a, b) { return b.n - a.n; });
  OUT.awardFirmCount = OUT.awardFirms.length;

  // ── 5. KPI④ 단계 — 이름 연결 후보(A)와 사업자번호 확인(B)을 따로 ──
  var A = T('보존_09_낙찰상태'); var wc = { st: A.c('공고상태'), pour: A.c('POUR판정'), id: A.c('통합업체ID'), biz: A.c('사업자번호_명부'), y: A.c('공고연도'), grade: A.c('업체식별등급'), conf: A.c('POUR계약확정'), match: A.c('업체매칭'), why: A.c('업체연결근거') };
  var FUN = {}; YEARS.concat(['전체']).forEach(function (y) { FUN[y] = { awards: 0, firms: {}, withBiz: {}, erpAny: {}, erpMain: {}, contract: 0 }; });
  A.rows.forEach(function (r) { if (normSt(r[wc.st]) !== '낙찰' || str(r[wc.pour]) !== '확인') return; var y = str(r[wc.y]); [y, '전체'].forEach(function (k) { var f = FUN[k]; if (!f) return; f.awards++; var fx = fixId(str(r[A.c('공고ID')]), str(r[wc.id])); var id = fx.id; if (!id) { f.unlinked = (f.unlinked || 0) + 1; return; } f.firms[id] = 1; var b = digits(r[wc.biz]); if (b.length === 10) { f.withBiz[id] = 1; if (erpCodes[b] !== undefined) f.erpAny[id] = 1; if (erpMainCodes[b]) f.erpMain[id] = 1; } if (bool(r[wc.conf])) f.contract++; }); });
  OUT.awardFunnel = YEARS.concat(['전체']).map(function (y) { var f = FUN[y]; return { year: y, awards: f.awards, firms: keys(f.firms).length, withBiz: keys(f.withBiz).length, erpAny: keys(f.erpAny).length, erpMain: keys(f.erpMain).length, contractConfirmed: f.contract }; });
  var V188 = T('04_낙찰188명칭검증'); var vb = { t: V188.c('target'), on: V188.c('award_original_numbers'), bc: V188.c('buyer_code_confirmed'), ad: V188.c('actual_POUR_adoption'), dt: V188.c('actual_award_date'), ap: V188.c('award_after_purchase') };
  var trackB = { targets: 0, kaptBiz: 0, erpConfirmed: 0, mainConfirmed: 0, adoption: 0, awardDate: 0, afterPurchase: 0 }, bcSeen = {};
  V188.rows.forEach(function (r) { trackB.targets++; if (jsonArr(r[vb.on]).length) trackB.kaptBiz++; var bc = digits(r[vb.bc]); if (bc.length === 10) { trackB.erpConfirmed++; if (erpMainCodes[bc]) trackB.mainConfirmed++; bcSeen[bc] = 1; } if (str(r[vb.ad])) trackB.adoption++; if (str(r[vb.dt])) trackB.awardDate++; if (str(r[vb.ap])) trackB.afterPurchase++; });
  trackB.erpConfirmedCodes = keys(bcSeen).length;
  OUT.kpi4 = { trackA: OUT.awardFunnel[OUT.awardFunnel.length - 1], trackB: trackB, live2026: null };
  // 낙찰 시공사 주요 자재 구매율(표시용 추가 값, 기존 값 무변경) — 분모: K-apt 원문 사업자번호로 확인된 낙찰 시공사(번호 단위), 분자: 그 번호가 검증된 구매계정과 일치하고 주요 자재 구매가 있는 업체
  var KB = {}, KBuy = {}; V188.rows.forEach(function (r) { jsonArr(r[vb.on]).forEach(function (x) { var b = digits(x); if (b.length === 10) KB[b] = str(r[vb.t]); }); var bc = digits(r[vb.bc]); if (bc.length === 10 && erpMainCodes[bc]) KBuy[bc] = str(r[vb.t]); });
  var mainOfCode = function (b) { return r0((codeVendors[b] || []).reduce(function (s, v) { return s + v.main; }, 0)); };
  var kbuy = keys(KBuy).filter(function (b) { return KB[b]; });
  OUT.kpi4.rate = { firms: keys(KB).length, buyers: kbuy.length, rate: pct(kbuy.length, keys(KB).length), mainNet: kbuy.reduce(function (s, b) { return s + mainOfCode(b); }, 0), unverified: keys(KB).length - kbuy.length, ledgerCodeMain: keys(KB).filter(function (b) { return erpMainCodes[b] && !KBuy[b]; }).length, targets: trackB.targets, noBiz: trackB.targets - trackB.kaptBiz, list: kbuy.map(function (b) { return [KBuy[b], mainOfCode(b)]; }).sort(function (a, b) { return b[1] - a[1]; }) };
  function stageCount(i, re) { var o = live.stages[i], n = 0; for (var k in o) if (re.test(k)) n += o[k]; return n; }
  OUT.kpi4.live2026 = { notices: live.rows, s1: stageCount(0, /^포함/), s1check: stageCount(0, /^확인 필요/), s2: stageCount(1, /^확인\(/), s2other: stageCount(1, /^타공법/), s3cand: stageCount(2, /^후보/), s3conf: stageCount(2, /^확정/), s3none: stageCount(2, /^ERP 거래 없음/), s3unk: stageCount(2, /^확인 불가/), s4cand: stageCount(3, /^후보/), s4conf: stageCount(3, /^확정/), s4no: stageCount(3, /^메인자재 구매 미확인/), s5conf: stageCount(4, /^확정/), s5no: stageCount(4, /^미확정/), s6conf: stageCount(5, /^확인/), s6na: stageCount(5, /^판정 불가/) };

  // ── 6. L3 서비스(보존_12 + 2026 실시간 신규분) ──
  var S = T('보존_12_L3서비스'); var sc = { t: S.c('업무유형'), d: S.c('요청일'), inc: S.c('L3요청집계포함'), id: S.c('통합업체ID'), nm: S.c('업체원문'), site: S.c('아파트명'), ev: S.c('이벤트ID') };
  var SYTD = {}, SY = {}, SM = {}, firmL3 = {}, firmL3Y = {}, firmNm = {}, F3 = {}, evSeen = {}, dupEv = 0; OUT.internalL3 = 0;
  S.rows.forEach(function (r) { var ev = str(r[sc.ev]); if (evSeen[ev]) { dupEv++; return; } evSeen[ev] = 1; if (!bool(r[sc.inc])) return; var d = ds(r[sc.d]); if (!d || d > ASOF) return; var y = d.slice(0, 4); var t = str(r[sc.t]);
    SY[y] = SY[y] || { 기술자문: 0, 컨설팅내역서: 0, '공법설명회(PT)': 0, 기타: 0, total: 0 }; if (SY[y][t] === undefined) t = '기타'; SY[y][t]++; SY[y].total++; var m = d.slice(0, 7); SM[m] = SM[m] || { 기술자문: 0, 컨설팅내역서: 0, '공법설명회(PT)': 0, 기타: 0 }; SM[m][t]++; if (d.slice(5) <= CUT_NOTICE) inc(SYTD, y);
    var id = str(r[sc.id]); if (id && INTERNAL.test(str(r[sc.nm]))) { OUT.internalL3++; id = ''; }
    if (id) { if (!firmNm[id]) firmNm[id] = str(r[sc.nm]); firmL3[id] = (firmL3[id] || 0) + 1; firmL3Y[y] = firmL3Y[y] || {}; firmL3Y[y][id] = 1;
      var f = F3[id] = F3[id] || { n: 0, tech: 0, consult: 0, pt: 0, first: '9999', last: '', recent: [], dates: [], ev: [] }; f.n++; if (t === '기술자문') f.tech++; else if (t === '컨설팅내역서') f.consult++; else if (t === '공법설명회(PT)') f.pt++; if (d < f.first) f.first = d; if (d > f.last) f.last = d; f.dates.push(d); f.recent.push([d, t, str(r[sc.site])]); f.ev.push([d, str(r[S.c('현장ID')]), str(r[S.c('현장식별등급')]), nm1(r[sc.site]), nm1(r[S.c('주소')]), t]); } });
  OUT.serviceYear = YEARS.map(function (y) { var o = SY[y] || { 기술자문: 0, 컨설팅내역서: 0, '공법설명회(PT)': 0, 기타: 0, total: 0 }; return { year: y, tech: o.기술자문, consult: o.컨설팅내역서, pt: o['공법설명회(PT)'], etc: o.기타, total: o.total, ytd: SYTD[y] || 0, firms: keys(firmL3Y[y] || {}).length }; });
  OUT.serviceMonth = keys(SM).sort().map(function (m) { var o = SM[m]; return { m: m, tech: o.기술자문, consult: o.컨설팅내역서, pt: o['공법설명회(PT)'], etc: o.기타 }; });
  var liveAdd = {}; [['동기화_②_기술자문문의', 'tech'], ['동기화_②_컨설팅요청_통합', 'consultReq'], ['동기화_②_공법설명회이력', 'pt']].forEach(function (x) { var t = T(x[0]); var b = t.c('_기준자료'), k = t.c('_공식집계'), s = t.c('_상태'); liveAdd[x[1]] = t.rows.filter(function (r) { return str(r[b]) === '기준 이후 신규·누락' && str(r[k]) === 'Y' && str(r[s]) !== '원천삭제'; }).length; });
  OUT.serviceLiveAdded = liveAdd;
  OUT.serviceTotals = { included: S.rows.filter(function (r) { return bool(r[sc.inc]); }).length, all: S.n, duplicateEvents: dupEv };

  // ── 7. 업체 단계(L1~L5, 통합업체ID 기준 — 이름 연결 추정 포함) ──
  var L1 = {}, L1last = {}; var I1 = T('보존_14_L1관심'); I1.rows.forEach(function (r) { var id = str(r[I1.c('통합업체ID')]); if (id && !INTERNAL.test(str(r[I1.c('업체원문')]))) { L1[id] = (L1[id] || 0) + 1; L1last[id] = maxS(L1last[id], ds(r[I1.c('발생일')])); } });
  var L4 = {}; A.rows.forEach(function (r) { if (normSt(r[wc.st]) === '낙찰' && str(r[wc.pour]) === '확인') { var id = fixId(str(r[A.c('공고ID')]), str(r[wc.id])).id; if (id) L4[id] = 1; } });
  var L5 = {}; keys(erpMainCodes).forEach(function (b) { if (bizToId[b]) L5[bizToId[b]] = 1; });
  var L5any = {}; keys(erpCodes).forEach(function (b) { if (bizToId[b]) L5any[bizToId[b]] = 1; });
  function both(a, b) { return keys(a).filter(function (k) { return b[k]; }).length; }
  OUT.stages = { L1: keys(L1).length, L2: null, L3: keys(firmL3).length, L4: keys(L4).length, L5main: keys(L5).length, L5any: keys(L5any).length, L3andL4: both(firmL3, L4), L4andL5main: both(L4, L5), L3andL5main: both(firmL3, L5), L3L4L5: keys(firmL3).filter(function (k) { return L4[k] && L5[k]; }).length };
  OUT.topL3Firms = keys(firmL3).map(function (k) { return { id: k, name: (idInfo[k] || {}).name || firmNm[k] || '', n: firmL3[k], b2b: /^B2B/.test(k), l4: !!L4[k], l5: !!L5[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 20);

  // ── 8. 협약업체·트래커 KPI 참고 ──
  var mou = keys(idInfo).filter(function (k) { return idInfo[k].b2b; }); var mouDated = mou.filter(function (k) { return idInfo[k].mou; });
  var newMou = mou.filter(function (k) { return /신규/.test(idInfo[k].nw); });
  function cnt(list, set) { return list.filter(function (k) { return set[k]; }).length; }
  OUT.mou = { b2b: mou.length, dated: mouDated.length, newWithin1y: newMou.length, l3: cnt(mou, firmL3), l4: cnt(mou, L4), buyAny: cnt(mou, L5any), buyMain: cnt(mou, L5), newL3: cnt(newMou, firmL3), newBuyAny: cnt(newMou, L5any), newBuyMain: cnt(newMou, L5) };
  // ① 협약 후 1년 이내 L3 이용 — 협약일이 기준일 1년 이내인 B2B 업체 중, 협약일~+365일 사이 L3 요청이 있는 업체(업체 연결은 정규화명 추정)
  var from1y = addDays(ASOF.slice(0, 10), -365);
  var coh = mou.filter(function (k) { var d = idInfo[k].mou; return d && d >= from1y && d <= ASOF; });
  var cohHit = coh.filter(function (k) { var f = F3[k]; if (!f) return false; var end = addDays(idInfo[k].mou, 365); return f.dates.some(function (d) { return d >= idInfo[k].mou && d <= end; }); });
  var cohDone = coh.filter(function (k) { return addDays(idInfo[k].mou, 365) <= ASOF; });
  var R17 = T('보존_17_반복요청참고'); var r17 = { a: R17.c('선행요청일'), b: R17.c('후행요청일'), x: R17.c('취소복합제외참고') }; var rep60 = 0, repAll = 0; R17.rows.forEach(function (r) { if (!bool(r[r17.x])) return; repAll++; var a = ds(r[r17.a]), b = ds(r[r17.b]); if (a && b && dayDiff(a, b) >= 0 && dayDiff(a, b) <= 60) rep60++; });
  OUT.trackerKpi = {
    newL3: { base: 50, target: 60, challenge: 70, official: null, status: '산출 대기', ref: { num: cohHit.length, den: coh.length, rate: pct(cohHit.length, coh.length), observedFull: cohDone.length, from: from1y, to: ASOF }, why: '협약일 일부 미확보(352곳 중 ' + mouDated.length + '곳만 협약일), L3 업체 연결이 정규화 이름 추정(법인 미확정)' },
    reuse: { base: 80, target: 85, challenge: 90, official: null, status: '산출 대기', ref: { repeatFirms: repAll, within60: rep60 }, why: '현장·공사 ID 미확정, 반복 요청과 실제 POUR 재사용 구분 증빙 없음(재사용 확정 0건)' },
    reach: { base: 30, target: 35, challenge: 40, official: null, status: '산출 대기', ref: { l2: null, l3Direct: keys(firmL3).length }, why: 'L2 영업보고 원천 미확보 — 0건은 "영업활동 없음"이 아니라 "자료 없음", 대상 업체 모집단 미확정' }
  };

  // ── 8b. 검증 반영 분석(2026-10-28 검증 결과) — 거래처 표기 단위(업체 아닌 거래 제외), 업체 연결은 명부 번호 후보 ──
  var EX = {};
  var vf = vend.filter(function (v) { return !NONFIRM.test(v.name); });
  vf.forEach(function (v) { v.firstY = v.first ? v.first.slice(0, 4) : ''; });
  EX.newVsExisting = YEARS.map(function (y) { var act = vf.filter(function (v) { return v.dateList.some(function (d) { return d.slice(0, 4) === y; }); }); var nw = act.filter(function (v) { return v.firstY === y; }), ex = act.filter(function (v) { return v.firstY && v.firstY < y; }); var sm = function (l) { return r0(l.reduce(function (t, v) { return t + (v.byY[y] || 0); }, 0)); }; return { year: y, newFirms: nw.length, newNet: sm(nw), exFirms: ex.length, exNet: sm(ex), newShare: pct(sm(nw), sm(nw) + sm(ex)), comparable: y !== YEARS[0] }; });
  var gm = vf.filter(function (v) { return v.buyDays >= 2; }).map(function (v) { return v.gapMed; });
  EX.gap = { repeatFirms: gm.length, buyers: vf.filter(function (v) { return v.buyDays > 0; }).length, medianOfMedians: median(gm), buckets: [['14일 이하', -1, 14], ['14일 초과~30일', 14, 30], ['30일 초과~90일', 30, 90], ['90일 초과', 90, 1e9]].map(function (b) { return { bucket: b[0], firms: gm.filter(function (g) { return g > b[1] && g <= b[2]; }).length }; }) };
  EX.mainGroupBuyers = ['2024', '2025', '2026'].map(function (y) { return { year: y, u: vf.filter(function (v) { return v.mgY['u' + y]; }).length, p: vf.filter(function (v) { return v.mgY['p' + y]; }).length, e: vf.filter(function (v) { return v.mgY['e' + y]; }).length }; });
  var grpN = function (v) { return ['u', 'p', 'e'].filter(function (g) { return v.mg[g] > 0; }).length; };
  EX.mainGroupTotal = { u: vf.filter(function (v) { return v.mg.u > 0; }).length, p: vf.filter(function (v) { return v.mg.p > 0; }).length, e: vf.filter(function (v) { return v.mg.e > 0; }).length, multi: vf.filter(function (v) { return grpN(v) >= 2; }).length, all3: vf.filter(function (v) { return grpN(v) === 3; }).length };
  // 업체ID 단위 구매(ERP 등록코드 = 명부 사업자번호인 경우만, 후보)
  var FP = {};
  vf.forEach(function (v) { var id = v.code && bizToId[v.code]; if (!id) return; var p = FP[id] = FP[id] || { days: {}, main: 0, mainFirst: '' }; v.dateList.forEach(function (d) { p.days[d] = 1; }); p.main += v.main; if (v.mainFirst && (!p.mainFirst || v.mainFirst < p.mainFirst)) p.mainFirst = v.mainFirst; });
  keys(FP).forEach(function (k) { FP[k].dl = keys(FP[k].days).sort(); });
  // 협약 후 기술지원
  var datedMou = mou.filter(function (k) { return idInfo[k].mou; });
  var firstAfter = function (k) { var md = idInfo[k].mou, best = ''; (F3[k] ? F3[k].dates : []).forEach(function (d) { if (d >= md && (!best || d < best)) best = d; }); return best; };
  var usedAfter = datedMou.filter(function (k) { return firstAfter(k); });
  var lags = usedAfter.map(function (k) { return dayDiff(idInfo[k].mou, firstAfter(k)); });
  EX.mouL3 = { mou: mou.length, dated: datedMou.length, usedAfter: usedAfter.length, rate: pct(usedAfter.length, datedMou.length), lagMedian: median(lags), beforeOnly: datedMou.filter(function (k) { return F3[k] && !firstAfter(k); }).length, none: datedMou.filter(function (k) { return !F3[k]; }).length,
    lagBuckets: [['30일 이내', -1, 30], ['31~90일', 30, 90], ['91~180일', 90, 180], ['181~365일', 180, 365], ['1년 초과', 365, 1e9]].map(function (b) { return { bucket: b[0], firms: lags.filter(function (g) { return g > b[1] && g <= b[2]; }).length }; }) };
  // 기술지원 이후 구매(후보 연결)
  var l3ids = keys(F3), linkedL3 = l3ids.filter(function (k) { return FP[k]; });
  EX.l3ThenBuy = { l3Firms: l3ids.length, erpLinked: linkedL3.length, buyWithin180: linkedL3.filter(function (k) { return FP[k].dl.some(function (d) { return d >= F3[k].first && dayDiff(F3[k].first, d) <= 180; }); }).length, firstBuyAfterL3: linkedL3.filter(function (k) { return FP[k].dl[0] >= F3[k].first; }).length, firstMainAfterL3: linkedL3.filter(function (k) { return FP[k].mainFirst && FP[k].mainFirst >= F3[k].first; }).length };
  // 장기 미활동(협약 코드 업체: L3·구매 기준) · 장기 미구매(거래처)
  var lastAct = function (k) { var a = F3[k] ? F3[k].last : '', b = FP[k] ? FP[k].dl[FP[k].dl.length - 1] : ''; return a > b ? a : b; };
  EX.inactive = { mou: mou.length, noRecord: mou.filter(function (k) { return !lastAct(k); }).length, over180: mou.filter(function (k) { return lastAct(k) && dayDiff(lastAct(k), ASOF) > 180; }).length, over365: mou.filter(function (k) { return lastAct(k) && dayDiff(lastAct(k), ASOF) > 365; }).length, vendorsOver180: vf.filter(function (v) { return v.last && dayDiff(v.last, maxD) > 180; }).length, vendorsAll: vf.filter(function (v) { return v.last; }).length };
  // 낙찰업체의 메인자재 구매 후보(2024 정정표 적용, 현장 사용 아님)
  var AWN = {};
  A.rows.forEach(function (r) { if (normSt(r[wc.st]) !== '낙찰' || str(r[wc.pour]) !== '확인') return; var id = fixId(str(r[A.c('공고ID')]), str(r[wc.id])).id; if (!id) return; AWN[id] = (AWN[id] || 0) + 1; });
  var awIds = keys(AWN), awLinked = awIds.filter(function (k) { return FP[k]; }), awMain = awLinked.filter(function (k) { return FP[k].main > 0; });
  EX.awardMain = { firms: awIds.length, withBiz: awIds.filter(function (k) { return idInfo[k] && idInfo[k].biz.length === 10; }).length, erpLinked: awLinked.length, mainBuyers: awMain.length, mainNet: r0(awMain.reduce(function (t, k) { return t + FP[k].main; }, 0)),
    top: awMain.sort(function (a, b) { return FP[b].main - FP[a].main; }).slice(0, 15).map(function (k) { return { name: (idInfo[k] || {}).name || k, awards: AWN[k], main: r0(FP[k].main), mainFirst: FP[k].mainFirst, mou: !!(idInfo[k] && idInfo[k].b2b) }; }) };
  // 업체별 단계 연결(L3·L4·L5)
  var allF = {}; l3ids.concat(awIds).concat(keys(FP)).forEach(function (k) { allF[k] = 1; });
  var combo = {}; keys(allF).forEach(function (k) { var c = []; if (F3[k]) c.push('L3'); if (AWN[k]) c.push('L4'); if (FP[k]) c.push('L5'); inc(combo, c.join('+')); });
  EX.stageLinks = { firms: keys(allF).length, combo: combo, mouAll3: mou.filter(function (k) { return F3[k] && AWN[k] && FP[k]; }).length, mouL3ThenMain: mou.filter(function (k) { return F3[k] && FP[k] && FP[k].mainFirst && FP[k].mainFirst >= F3[k].first; }).length };
  OUT.extra = EX;
  // 트래커 KPI 참고값(공식 아님) — 정의·분자·분모·기간·현장 기준을 함께 내보냄
  var cohortL3 = function (from, to) { var c = datedMou.filter(function (k) { return idInfo[k].mou >= from && idInfo[k].mou <= to; }); var hit = c.filter(function (k) { var md = idInfo[k].mou, end = addDays(md, 365); return F3[k] && F3[k].dates.some(function (d) { return d >= md && d <= end; }); }); return { from: from, to: to, num: hit.length, den: c.length, rate: pct(hit.length, c.length) }; };
  var reuseL3 = function (from, to, strict) { var den = 0, num = 0; mou.forEach(function (k) { if (!F3[k]) return; var l = F3[k].ev.filter(function (e) { return !strict || e[2] === '주소·명칭 일치'; }); var base = l.filter(function (e) { return e[0] >= from && e[0] <= to && addDays(e[0], 60) <= ASOF; }); if (!base.length) return; den++; if (base.some(function (b) { return l.some(function (o) { return o[1] && b[1] && o[1] !== b[1] && dayDiff(b[0], o[0]) > 0 && dayDiff(b[0], o[0]) <= 60; }); })) num++; }); return { from: from, to: to, num: num, den: den, rate: pct(num, den), siteRule: strict ? '현장식별등급 = 주소·명칭 일치만' : '현장ID(명칭 후보 포함)' }; };
  var TK = OUT.trackerKpi;
  TK.newL3.ref = cohortL3(addDays(ASOF.slice(0, 10), -730), addDays(ASOF.slice(0, 10), -366)); TK.newL3.ref.basis = '협약 후 365일 관측이 끝난 협약 코드 업체(협약일 있는 곳)'; TK.newL3.ongoing = cohortL3(from1y, ASOF); TK.newL3.y2024 = cohortL3('2024-01-01', '2024-12-31'); TK.newL3.y2023 = cohortL3('2023-01-01', '2023-12-31');
  TK.newL3.def = '분자: 협약일부터 365일 안에 L3(기술자문·컨설팅·PT·기타문의) 요청이 있는 업체 / 분모: 해당 기간 협약 코드 업체';
  TK.reuse.ref = reuseL3('2026-06-01', addDays(ASOF.slice(0, 10), -60), false); TK.reuse.strict = reuseL3('2026-06-01', addDays(ASOF.slice(0, 10), -60), true); TK.reuse.wide = reuseL3('2025-01-01', addDays(ASOF.slice(0, 10), -60), false);
  TK.reuse.def = '분자: 기준 L3 요청 후 60일 안에 다른 현장ID로 L3를 요청한 협약 코드 업체 / 분모: 60일 관측이 끝난 L3 요청이 있는 협약 코드 업체';
  TK.reach.def = '(L2 영업보고를 거쳐 L3에 도달한 업체 + L3 직접 진입 업체, 중복 없이) / 대상 업체 모집단';
  TK.reach.ref = { l2: null, l3Direct: keys(firmL3).length, mouL3: OUT.mou.l3, mou: OUT.mou.b2b };
  // ── 8c. 운영 KPI 산출 가능 기간 탐색 — 월 단위 코호트(업체는 한 달에만 속함 → 화면에서 기간을 골라 더해도 중복 없음) ──
  var L3MIN = {}, L3MAX = '', idMin = '', siteMin = '', addrMin = '';
  S.rows.forEach(function (r) { if (!bool(r[sc.inc])) return; var d = ds(r[sc.d]); if (!d || d > ASOF) return; var t = str(r[sc.t]); if (!L3MIN[t] || d < L3MIN[t]) L3MIN[t] = d; L3MAX = maxS(L3MAX, d); });
  var COVER_T = ['기술자문', '컨설팅내역서', '공법설명회(PT)'];
  var COVER = COVER_T.reduce(function (a, t) { return maxS(a, L3MIN[t] || '9999'); }, '');
  function mEnd(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7); return addDays((mo === 12 ? (y + 1) + '-01' : y + '-' + pad(mo + 1)) + '-01', -1); }
  function lastFullMonth(days) { var m = ASOF.slice(0, 7); while (m > '2019-01' && addDays(mEnd(m), days) > ASOF) { var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1; m = mo === 0 ? (y - 1) + '-12' : y + '-' + pad(mo); } return m; }
  mou.forEach(function (k) { if (!F3[k]) return; F3[k].ev.forEach(function (e) { idMin = idMin && idMin < e[0] ? idMin : e[0]; if (e[1]) siteMin = siteMin && siteMin < e[0] ? siteMin : e[0]; if (e[1] && e[2] === '주소·명칭 일치') addrMin = addrMin && addrMin < e[0] ? addrMin : e[0]; }); });
  var mouMin = datedMou.reduce(function (a, k) { return a && a < idInfo[k].mou ? a : idInfo[k].mou; }, '');
  // ① 신규 협약업체 L3 활성화율 — 협약월 코호트. ok = 협약일이 L3 3종 기록 시작(COVER) 이후이고 365일 관측 완료, obs = 관측 중(하한값), pre = L3 기록 시작 전 협약
  var K1 = {};
  datedMou.forEach(function (k) { var md = idInfo[k].mou; if (md > ASOF) return; var m = md.slice(0, 7), end = addDays(md, 365); var hit = !!(F3[k] && F3[k].dates.some(function (d) { return d >= md && d <= end; })); var c = md < COVER ? 'pre' : end > ASOF ? 'obs' : 'ok';
    var o = K1[m] = K1[m] || { ok: 0, okHit: 0, obs: 0, obsHit: 0, pre: 0, preHit: 0 }; o[c]++; if (hit) o[c + 'Hit']++; });
  // ② 다른 현장 L3 재사용률 — 협약 코드 업체의 첫 L3 이용월 코호트. 첫 이용 후 1~60일 안에 다른 현장ID로 L3 요청 → 재사용. 같은 아파트명·주소면 같은 현장 의심으로 재사용에서 뺌
  function sameSite(a, b) { return (a[3] && a[3] === b[3]) || (a[4] && a[4].length >= 6 && a[4] === b[4]); }
  var K2 = {};
  mou.forEach(function (k) { if (!F3[k]) return; var ev = F3[k].ev.slice().sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (b[1] ? 1 : 0) - (a[1] ? 1 : 0); }); var f0 = ev[0], m = f0[0].slice(0, 7);
    var o = K2[m] = K2[m] || { ok: 0, okHit: 0, obs: 0, obsHit: 0, pre: 0, preHit: 0, nosite: 0, sOk: 0, sHit: 0, sameSite: 0, sameOnly: 0 };
    if (!f0[1]) { o.nosite++; return; }
    var win = ev.filter(function (e) { var g = dayDiff(f0[0], e[0]); return g > 0 && g <= 60 && e[1]; });
    var diff = win.filter(function (e) { return e[1] !== f0[1] && !sameSite(e, f0); });
    var hit = diff.length > 0; var c = f0[0] < COVER ? 'pre' : addDays(f0[0], 60) > ASOF ? 'obs' : 'ok';
    o[c]++; if (hit) o[c + 'Hit']++;
    if (c === 'ok') { if (!hit && win.some(function (e) { return e[1] !== f0[1] && sameSite(e, f0); })) o.sameSite++; if (!hit && win.length && win.every(function (e) { return e[1] === f0[1]; })) o.sameOnly++;
      if (f0[2] === '주소·명칭 일치') { o.sOk++; if (diff.some(function (e) { return e[2] === '주소·명칭 일치'; })) o.sHit++; } } });
  // ③ L3 도달률 보조지표 — 업체별 첫 L3 이용월(L2 자료가 없어 지금은 모두 '직접 진입'으로 관측)
  var K3 = {}; keys(F3).forEach(function (k) { var m = F3[k].first.slice(0, 7); var o = K3[m] = K3[m] || { all: 0, mou: 0 }; o.all++; if (idInfo[k] && idInfo[k].b2b) o.mou++; });
  var J = T('동기화_②_여정_최종'), jL2 = {}; J.rows.forEach(function (r) { if (str(r[J.c('단계')]) === 'L2') inc(jL2, str(r[J.c('세부인정항목')]) || '(빈칸)'); });
  var L2T = T('보존_15_L2확정');
  function rowsOf(o, f) { return keys(o).sort().map(function (m) { return [m].concat(f.map(function (x) { return o[m][x]; })); }); }
  OUT.kpiPeriod = {
    asOf: ASOF, cover: COVER, l3Min: L3MIN, l3Max: L3MAX,
    newL3: { cols: ['ok', 'okHit', 'obs', 'obsHit', 'pre', 'preHit'], rows: rowsOf(K1, ['ok', 'okHit', 'obs', 'obsHit', 'pre', 'preHit']), undated: mou.length - datedMou.length, mou: mou.length,
      meta: { dataStart: '협약일 ' + mouMin + ' · L3 기록 ' + (L3MIN['기술자문'] || '') + '(기술자문)', idStart: idMin, obsDays: 365, firstCalc: COVER.slice(0, 7), lastCalc: lastFullMonth(365), coverNote: '컨설팅 기록이 ' + (L3MIN['컨설팅내역서'] || '') + '부터 있어 그 전 협약은 1년 관측 창이 L3 기록 시작 전에 걸립니다.' },
      conf: '중간 — 협약일 있는 협약 코드 업체만 포함, L3 요청의 업체 연결은 정규화 이름 추정(법인 확정 아님)' },
    reuse: { cols: ['ok', 'okHit', 'obs', 'obsHit', 'pre', 'preHit', 'nosite', 'sOk', 'sHit', 'sameSite', 'sameOnly'], rows: rowsOf(K2, ['ok', 'okHit', 'obs', 'obsHit', 'pre', 'preHit', 'nosite', 'sOk', 'sHit', 'sameSite', 'sameOnly']),
      meta: { dataStart: 'L3 기록 ' + (L3MIN['기술자문'] || ''), idStart: idMin, siteStart: siteMin, addrStart: addrMin, obsDays: 60, firstCalc: COVER.slice(0, 7), lastCalc: lastFullMonth(60) },
      conf: '중간 — 현장ID에 명칭 후보가 섞여 있음(주소 검증 기준을 함께 표시), 업체 연결은 이름 추정' },
    reach: { rows: rowsOf(K3, ['all', 'mou']), l2Rows: L2T.n, journeyL2: jL2, conf: '산출 대기 — L2 영업보고 원천 없음' }
  };
  // 이전 참고값(80.6%)과 주소 검증 기준(75.8%) 차이 분해 — 같은 기간·같은 방식(아무 L3 요청이나 기준)
  (function () { var from = TK.reuse.ref.from, to = TK.reuse.ref.to, c = { both: 0, baseNotAddr: 0, reuseNotAddr: 0, denOnlyDrop: 0, sameSuspect: 0 };
    mou.forEach(function (k) { if (!F3[k]) return; var l = F3[k].ev; var inWin = function (e) { return e[0] >= from && e[0] <= to && addDays(e[0], 60) <= ASOF; };
      var reuseOf = function (list, strictOnly) { return list.filter(inWin).some(function (b) { return list.some(function (o2) { return o2[1] && b[1] && o2[1] !== b[1] && dayDiff(b[0], o2[0]) > 0 && dayDiff(b[0], o2[0]) <= 60; }); }); };
      var dDen = l.some(inWin), dNum = dDen && reuseOf(l); var sl = l.filter(function (e) { return e[2] === '주소·명칭 일치'; }); var sDen = sl.some(inWin), sNum = sDen && reuseOf(sl);
      if (dNum && sNum) c.both++; else if (dNum && sDen) c.reuseNotAddr++; else if (dNum) c.baseNotAddr++; else if (dDen && !sDen) c.denOnlyDrop++;
      if (dNum && !l.filter(inWin).some(function (b) { return l.some(function (o2) { return o2[1] && b[1] && o2[1] !== b[1] && !sameSite(o2, b) && dayDiff(b[0], o2[0]) > 0 && dayDiff(b[0], o2[0]) <= 60; }); })) c.sameSuspect++; });
    TK.reuse.decomp = c; })();
  TK.newL3.status = '참고값'; TK.reuse.status = '참고값'; TK.reach.status = '산출 대기';
  // 2024 정정표 적용 요약(정정 전후 낙찰 시공사 수)
  var fc = {}; keys(FIX).forEach(function (k) { inc(fc, FIX[k][0]); });
  var vSrc = {}, vName = {}, vFix = {}, unSrc = 0, unFix = 0;
  A.rows.forEach(function (r) { if (normSt(r[wc.st]) !== '낙찰' || str(r[wc.pour]) !== '확인') return; var sk = str(r[A.c('시공사키')]), id = str(r[wc.id]); if (sk) vSrc[sk] = 1; else unSrc++; if (id) vName[id] = 1; var fx = fixId(str(r[A.c('공고ID')]), id); if (fx.id) vFix[fx.id] = 1; else unFix++; });
  var listOf = function (cls) { var o = {}; keys(FIX).forEach(function (k) { var x = FIX[k]; if (x[0] !== cls) return; var key = x[2] + '|' + (x[3] || ''); o[key] = o[key] || { firm: x[2], cand: x[3] || '', rows: 0 }; o[key].rows++; }); return keys(o).map(function (k) { return o[k]; }).sort(function (a, b) { return b.rows - a.rows; }); };
  OUT.fix2024 = { applied: keys(FIX).length > 0, rows: keys(FIX).length, byClass: fc, firmsSourceCode: keys(vSrc).length, unlinkedSourceCode: unSrc, firmsNameBased: keys(vName).length, firmsFixed: keys(vFix).length, unlinkedFixed: unFix, candidates: listOf('B'), unregistered: listOf('C'), confirmedFirms: listOf('A1').concat(listOf('A2')).length };
  // ── 9. 시공사 통합 색인(검색용) — 통합업체ID 단위, 이름만으로 합치지 않음 ──
  var FIRM = {};
  function fget(id, name, kind) { var f = FIRM[id]; if (!f) { var info = idInfo[id]; f = FIRM[id] = { i: id, n: info ? info.name : name, a: info ? info.al.slice(0, 4) : [], k: kind || (info ? (info.b2b ? 'B2B' : 'TMP') : 'TMP'), m: info && info.b2b ? [info.mou || '', info.nw] : 0, l1: 0, l3: 0, l4: 0, l5: 0, last: '' }; } return f; }
  keys(idInfo).forEach(function (id) { if (idInfo[id].b2b) fget(id); });
  keys(F3).forEach(function (id) { var f = fget(id, firmNm[id]); var x = F3[id]; x.recent.sort(function (p, q) { return p[0] < q[0] ? 1 : -1; }); f.l3 = [x.n, x.tech, x.consult, x.pt, x.first, x.last, x.recent.slice(0, 3)]; f.last = maxS(f.last, x.last); });
  keys(L1).forEach(function (id) { var f = fget(id, ''); f.l1 = L1[id]; f.last = maxS(f.last, L1last[id]); });
  var AW4 = {}; NOTICES.forEach(function (n) { if (!n.pour || !n.fid) return; if (n.st !== 'award' && n.st !== 'other') return; var a = AW4[n.fid] = AW4[n.fid] || { aw: 0, other: 0, last: '', amt: 0, list: [], raw: n.firm }; if (n.st === 'award') { a.aw++; a.amt += n.amt; } else a.other++; a.last = maxS(a.last, n.d); a.list.push([n.d, n.site, n.g, n.st === 'award' ? '낙찰' : '타공법 낙찰']); });
  keys(AW4).forEach(function (id) { var f = fget(id, AW4[id].raw); var a = AW4[id]; a.list.sort(function (p, q) { return p[0] < q[0] ? 1 : -1; }); f.l4 = [a.aw, a.other, a.last, r0(a.amt), a.list.slice(0, 5)]; f.last = maxS(f.last, a.last); });
  var erpN = 0; vend.forEach(function (v) { if (NONFIRM.test(v.name) || (!v.net && !v.main)) return; var id = v.code && bizToId[v.code] ? bizToId[v.code] : ''; var f, link; if (id) { f = fget(id, v.name); link = '사업자번호 후보(ERP 등록코드=명부 번호)'; } else { erpN++; f = fget('ERP-' + (erpN < 10 ? '00' : erpN < 100 ? '0' : '') + erpN, v.name, 'ERP'); link = v.code ? 'ERP 등록코드 있음·업체 마스터 미연결' : 'ERP 등록코드 없음'; }
    var p = f.l5 || [0, 0, '', '', 0, [], link]; p[0] += r0(v.net); p[1] += r0(v.main); p[2] = maxS(p[2], v.last); p[3] = maxS(p[3], v.mainLast); p[4] += v.buyDays; p[5].push(v.name); f.l5 = p; f.last = maxS(f.last, v.last); });
  // 임시 식별자(L3 요청 원문)는 담당자 이름이 섞여 있어 화면 표시명을 가린다 — 협약업체 이름으로 시작하면 '그 업체 관련 표기', 아니면 첫 낱말 뒤를 가림(업체 합치기는 하지 않음)
  function nm0(s) { return str(s).replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|[\s().·,-]/g, ''); }
  var COMPANY = /건설|이앤씨|씨앤씨|이엔씨|산업|개발|기업|공사|엔지|이앤지|ENG|E&C|C&C|건축|종합|방수|도장|컨설팅|㈜|\(주\)|주식회사|테크|솔루션|디자인|하우징|에코|플래닝|공영|엔텍|피앤|씨엔|건업|토건|시스템|코리아|인더스|홀딩스|리페어|케미칼|재료|상사|HD|SK|LH/i;
  var masterNames = keys(idInfo).filter(function (k) { return idInfo[k].b2b; }).map(function (k) { return [nm0(idInfo[k].name), idInfo[k].name]; }).filter(function (x) { return x[0].length >= 3; }).sort(function (a, b) { return b[0].length - a[0].length; });
  keys(FIRM).forEach(function (k) { var f = FIRM[k]; if (f.k !== 'TMP' || idInfo[k]) return; var raw = nm0(f.n); var hit = null; for (var i = 0; i < masterNames.length; i++) if (raw.indexOf(masterNames[i][0]) === 0 || raw.indexOf(nm0(masterNames[i][1]).replace(/^(주식회사)/, '')) === 0) { hit = masterNames[i]; break; } if (hit) { f.n = hit[1] + ' 관련 표기(담당자명 가림)'; f.hint = hit[1]; } else if (COMPANY.test(f.n.split(/ +/)[0])) { if (/\s/.test(f.n)) f.n = f.n.split(/\s+/)[0] + ' (뒤 표기 가림)'; } else { f.n = '이름 비공개 요청자'; f.hidden = 1; } f.masked = 1; });
  // ERP 거래처만 있는 항목 중 사람 이름처럼 보이는 짧은 표기(한글 2~3자)는 가린다
  keys(FIRM).forEach(function (k) { var f = FIRM[k]; if (f.k === 'ERP' && /^[가-힣]{2,3}$/.test(f.n) && !COMPANY.test(f.n)) { f.n = '이름 비공개 거래처'; f.hidden = 1; if (f.l5) f.l5[5] = ['(가림)']; } });
  OUT.firms = keys(FIRM).map(function (k) { return FIRM[k]; }).filter(function (f) { return !INTERNAL.test(f.n); });
  OUT.firmCount = { all: OUT.firms.length, b2b: OUT.firms.filter(function (f) { return f.k === 'B2B'; }).length, tmp: OUT.firms.filter(function (f) { return f.k === 'TMP'; }).length, erpOnly: OUT.firms.filter(function (f) { return f.k === 'ERP'; }).length };

  // ── 10. 데이터 검증 현황 ──
  var SYS = T('동기화_상태'); var sy = { t: SYS.c('일시'), src: SYS.c('원천'), tab: SYS.c('탭'), rows: SYS.c('원천행'), nw: SYS.c('신규'), md: SYS.c('수정'), rs: SYS.c('복구'), del: SYS.c('원천삭제'), dup: SYS.c('중복키'), hold: SYS.c('보류'), res: SYS.c('결과'), mode: SYS.c('모드') };
  var lastBy = {}, lastOk = '', lastAny = '', lastChange = '', changes7 = { nw: 0, md: 0, del: 0 }; var since7 = addDays(ASOF.slice(0, 10), -7);
  SYS.rows.forEach(function (r) { if (str(r[sy.mode]) !== 'live') return; var t = dts(r[sy.t]); var k = str(r[sy.src]) + '|' + str(r[sy.tab]); lastAny = maxS(lastAny, t); if (str(r[sy.res]) === '성공') { lastOk = maxS(lastOk, t); if (!lastBy[k] || t >= lastBy[k].t) lastBy[k] = { src: str(r[sy.src]), tab: str(r[sy.tab]), t: t, rows: num(r[sy.rows]), nw: num(r[sy.nw]), md: num(r[sy.md]), del: num(r[sy.del]), dup: num(r[sy.dup]), hold: num(r[sy.hold]), res: '성공' }; }
    var ch = num(r[sy.nw]) + num(r[sy.md]) + num(r[sy.rs]) + num(r[sy.del]); if (ch > 0) lastChange = maxS(lastChange, t); if (t.slice(0, 10) >= since7) { changes7.nw += num(r[sy.nw]); changes7.md += num(r[sy.md]); changes7.del += num(r[sy.del]); } });
  var failedLatest = SYS.rows.filter(function (r) { return str(r[sy.mode]) === 'live' && dts(r[sy.t]) === lastAny && str(r[sy.res]) !== '성공'; }).map(function (r) { return str(r[sy.src]) + ' ' + str(r[sy.tab]) + ': ' + str(r[sy.res]); });
  OUT.sync = { lastSuccess: lastOk, lastRun: lastAny, lastChange: lastChange, failedLatest: failedLatest, tabs: keys(lastBy).sort().map(function (k) { return lastBy[k]; }), changes7: changes7 };
  var CH = T('동기화_변경이력'); OUT.sync.recentChanges = CH.rows.filter(function (r) { return !/초기 적재/.test(str(r[CH.c('행요약')])); }).slice(-15).reverse().map(function (r) { return [dts(r[CH.c('일시')]), str(r[CH.c('원천')]) + ' ' + str(r[CH.c('탭')]), str(r[CH.c('유형')]), str(r[CH.c('변경열')])]; });
  var DR = T('동기화_중복위험'); OUT.sync.dupRiskRows = DR.n;

  var unlinked = {
    awardRows: A.rows.filter(function (r) { return /미연결/.test(str(r[wc.grade])); }).length, awardRowsAll: A.n,
    awardNameOnly: A.rows.filter(function (r) { return /추정/.test(str(r[wc.grade])); }).length,
    l3Rows: S.rows.filter(function (r) { return /미연결/.test(str(r[S.c('업체식별등급')])); }).length, l3RowsAll: S.n,
    erpVendorsNoCode: OUT.vendorNoCode.vendors, erpNetNoCode: OUT.vendorNoCode.net,
    erpCodesNotInMaster: keys(erpCodes).filter(function (b) { return !bizToId[b]; }).length, erpCodesAll: keys(erpCodes).length,
    live2026NoFirm: P26.rows.filter(function (r) { return str(r[pc.s]) !== '원천삭제' && /업체 미기재/.test(str(r[pc.grade])); }).length,
    live2026SameName: P26.rows.filter(function (r) { return str(r[pc.s]) !== '원천삭제' && /동명 복수/.test(str(r[pc.grade])); }).length
  };
  var E59 = T('03_ERP59계정_표본검증'); var e59conf = E59.rows.filter(function (r) { return /번호 충돌/.test(str(r[E59.c('MOU법인분류')])); }).map(function (r) { return str(r[E59.c('관측명칭')]); });
  var sameNameCodes = {}; A.rows.forEach(function (r) { var w = str(r[wc.why]); if (/동일 정규화명 복수 코드/.test(w)) sameNameCodes[str(r[A.c('낙찰업체원문')])] = 1; });
  var R11 = T('보존_11_현장거래연결'); var conf11 = R11.rows.filter(function (r) { return /충돌/.test(str(r[R11.c('업체식별판정')])); }).length;
  var cancelList = NOTICES.filter(function (n) { return n.pour && (n.st === 'invalid'); }).map(function (n) { return [n.d, n.site, '낙찰무효']; });
  var rgGroups = {}; NOTICES.forEach(function (n) { if (n.regroup) (rgGroups[n.regroup] = rgGroups[n.regroup] || []).push(n); });
  var KA = T('05_Kapt원문관측'); var kaMis = KA.rows.filter(function (r) { return !bool(r[KA.c('원문낙찰업체일치')]); }).map(function (r) { return [str(r[KA.c('target')]), str(r[KA.c('연결제외사유')]) || '원문 낙찰업체와 기존 표기 불일치']; });
  var E11 = T('08_11건추가대조'); var e11 = E11.rows.map(function (r) { return [str(r[E11.c('현장')]), str(r[E11.c('새업체명')]), jsonArr(r[E11.c('기존업체명')]).filter(function (x) { return x; }).join(', ') || '(기존 표기 없음)', str(r[E11.c('실제POUR채택')])]; });
  var H21 = T('보존_21_검토보류'); var gaps = {}; H21.rows.forEach(function (r) { var t = str(r[H21.c('유형')]); var g = gaps[t] = gaps[t] || { type: t, n: 0, text: str(r[H21.c('내용')]), action: str(r[H21.c('처리')]) }; g.n++; });
  var K10 = T('10_KPI4개'), K11 = T('11_트래커KPI3개');
  var CHK24 = T('보존_24_검증결과'), CHK20 = T('보존_20_금액KPI검산');
  OUT.verify = {
    unlinked: unlinked,
    bizConflicts: { codeMismatch: keys(codeMis).map(function (k) { return k + ' (' + codeMis[k] + '건)'; }), masterShared: bizConflicts, erpSample: e59conf, awardSameName: keys(sameNameCodes), siteTradeConflictRows: conf11 },
    awardIssues: { invalid: cancelList, cancelPour: OUT.noticeYear.reduce(function (s, y) { return s + y.cancel; }, 0), failPour: OUT.noticeYear.reduce(function (s, y) { return s + y.fail; }, 0), otherPour: OUT.noticeYear.reduce(function (s, y) { return s + y.other; }, 0), regroupGroups: keys(rgGroups).length, regroupNotices: keys(rgGroups).reduce(function (s, k) { return s + rgGroups[k].length; }, 0), regroupList: keys(rgGroups).slice(0, 12).map(function (k) { var l = rgGroups[k]; return [l[0].site, l.length, l.map(function (n) { return n.d; }).sort().join(', ')]; }), kaptMismatch: kaMis, added11: e11 },
    evidenceGaps: keys(gaps).map(function (k) { return gaps[k]; }),
    kpiNeeds: K10.rows.map(function (r) { return [str(r[0]), str(r[K10.c('제약')])]; }).concat(K11.rows.map(function (r) { return [str(r[0]), str(r[K11.c('필요')])]; })),
    checks: { c24: CHK24.n, c24pass: CHK24.rows.filter(function (r) { return str(r[CHK24.c('판정')]) === '통과'; }).length, c20: CHK20.n, c20match: CHK20.rows.filter(function (r) { return str(r[CHK20.c('판정')]) === '일치'; }).length },
    dedupe: { ledgerRows: L.n, ledgerUnique: keys(ids).length, noticeRows: N.n, noticeDupSkipped: dupNotice, l3Rows: S.n, l3DupSkipped: dupEv, l3SourceDupRemoved: S.rows.filter(function (r) { return num(r[S.c('원천ID중복제거수')]) > 0; }).length }
  };
  // 금액 검산용(보존_20 연도값과 대조) — 화면 '검증' 표시에 사용
  var chk = {}; CHK20.rows.forEach(function (r) { var k = str(r[0]), p = str(r[1]); if (/^\d{4}$/.test(p)) { chk[k] = chk[k] || {}; chk[k][p] = num(r[CHK20.c('독립재계산')]); } });
  OUT.verify.amountCheck = YEARS.map(function (y) { var s = OUT.salesYear[YEARS.indexOf(y)]; var t1 = (chk['전체 판매 순매출(VAT 제외)'] || {})[y], t2 = (chk['자재 순매출(확정 비자재 제외)'] || {})[y], t3 = (chk['메인 자재 순매출'] || {})[y];
    return { year: y, net: s.net, netRef: t1 === undefined ? null : t1, mat: s.mat, matRef: t2 === undefined ? null : t2, main: s.main, mainRef: t3 === undefined ? null : t3 }; });
  return OUT;
}
// 원본 행 조회(전체 데이터 조회 화면) — 탭 하나의 머리글·행을 받아 검색·기간 필터·페이지를 적용한다. 행은 합치거나 빼지 않고 원본 순서·행 번호를 유지한다.
// 사업자번호로 보이는 값은 가린다. 서버(Apps Script)와 로컬 시험이 같은 코드를 쓴다.
function browseRows(header, body, o) {
  o = o || {}; var size = Math.min(Math.max(+o.size || 50, 10), 200), page = Math.max(+o.page || 1, 1);
  var H = header.map(function (h) { return String(h === null || h === undefined ? '' : h); });
  var SENS = /사업자|등록코드|번호_명부|사업자번호|biz/i, AMT = /금액|가액|매출|단가|합계|부가세|수량|면적|물량|원$|순공급/;
  var DATE_PREF = ['거래일', '공고일', '요청일', '문의일자', '이벤트일자', '접수일자', '접수일시', '등록일자', '등록일', '가입일자', '발생일', '협약일', '첫 진행일', '최초 요청일', '첫 L3', '첫 영업활동일', '발행일시', '일자', '일시', '날짜', '개찰일', '최종 PT 예정일'];
  var isDateH = function (h) { return /일자|일시|날짜|요청일|거래일|공고일|개찰일|협약일|발생일|가입일|등록일|진행일|예정일|준공일|착공일|출고일|낙찰일|첫 L3|_최초동기화|_최종확인|_최종변경|최종검증일/.test(h); };
  var dc = -1; for (var i = 0; i < DATE_PREF.length && dc < 0; i++) dc = H.indexOf(DATE_PREF[i]); if (dc < 0) for (var j = 0; j < H.length; j++) if (isDateH(H[j]) && !/^_|검증일/.test(H[j])) { dc = j; break; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function serial(v) { var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000)); var s = d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); var hm = d.getUTCHours() * 60 + d.getUTCMinutes(); return hm ? s + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) : s; }
  function iso(s) { var t = new Date(s); if (isNaN(t.getTime())) return s; t = new Date(t.getTime() + 9 * 3600000); var x = t.toISOString(); return x.slice(0, 10) + (x.slice(11, 16) === '00:00' ? '' : ' ' + x.slice(11, 16)); }
  function cell(v, c) { if (v === null || v === undefined) return ''; var h = H[c] || '';
    if (typeof v === 'number') { if (isDateH(h) && v > 20000 && v < 80000) return serial(v); if (SENS.test(h) || (v >= 1e9 && v < 1e10 && !AMT.test(h) && /번호|코드/.test(h))) return '(사업자번호 가림)'; return v; }
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : iso(v.toISOString());
    var s = String(v); if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s)) return iso(s);
    if (SENS.test(h) && /\d{3}-?\d{2}-?\d{5}/.test(s)) return s.replace(/\d{3}-?\d{2}-?\d{5}/g, '(사업자번호 가림)');
    s = s.replace(/\b\d{3}-\d{2}-\d{5}\b/g, '(사업자번호 가림)'); if (!/ID|메시지|_키|해시|공고번호|입찰번호|bid|원문URL/i.test(h)) s = s.replace(/(^|[^\d])(\d{10})(?!\d)/g, function (m, a) { return a + '(번호 가림)'; });
    return s.length > 400 ? s.slice(0, 400) + '…' : s; }
  function dateOf(r) { if (dc < 0) return ''; var v = cell(r[dc], dc); var m = String(v).match(/^(\d{4})-(\d{2})/) || String(v).match(/(20\d{2})[-.\/년 ]+(\d{1,2})/); return m ? m[1] + '-' + p2(+m[2]) : ''; }
  var q = String(o.q || '').replace(/\s+/g, '').toLowerCase(), from = o.from || '', to = o.to || '';
  var empty = 0, matched = [], byYear = {}, noDate = 0;
  for (var r = 0; r < body.length; r++) { var row = body[r] || []; var any = false; for (var k = 0; k < row.length; k++) if (row[k] !== '' && row[k] !== null && row[k] !== undefined) { any = true; break; } if (!any) empty++;
    if (q) { var txt = ''; for (var k2 = 0; k2 < row.length; k2++) txt += String(row[k2] === null || row[k2] === undefined ? '' : row[k2]); if (txt.replace(/\s+/g, '').toLowerCase().indexOf(q) < 0) continue; }
    var dm = dateOf(row), y = dm ? dm.slice(0, 4) : '날짜 없음'; byYear[y] = (byYear[y] || 0) + 1;
    if (from || to) { if (!dm) { noDate++; continue; } if (from && dm < from) continue; if (to && dm > to) continue; }
    matched.push(r); }
  var pages = Math.max(1, Math.ceil(matched.length / size)); if (page > pages) page = pages;
  var out = matched.slice((page - 1) * size, page * size).map(function (ri) { var row = body[ri] || []; var a = [ri + 2]; for (var c = 0; c < H.length; c++) a.push(cell(row[c], c)); return a; });
  return { header: ['원본 행'].concat(H), total: body.length, empty: empty, matched: matched.length, noDateExcluded: noDate, byYear: byYear, dateCol: dc >= 0 ? H[dc] : '', page: page, pages: pages, size: size, rows: out };
}
if (typeof module !== 'undefined') module.exports = { analyzeB2B: analyzeB2B, browseRows: browseRows };
