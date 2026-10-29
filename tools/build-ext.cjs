// 로컬 엑셀(잔디 기술문의 = L2 영업활동, 잔디 PT 정밀교차검증 = L3 PT 신청·진행) + 126곳 매칭표 → 웹앱 서버에 넣을 내장 자료(ext.json, gzip+base64)
// 원본 무변경. 개인 연락처·잔디 원문은 넣지 않는다. 연결은 아파트명(정규화) + 주소 시·구 기준(시공사명 미사용).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const X = require(process.env.XLSX_PATH || 'xlsx');
const D = process.env.SRC_DIR || (function () { throw new Error('SRC_DIR(로컬 엑셀 폴더) 환경변수가 필요합니다'); })();
const R126 = process.env.R126 || '';
const rd = (f, s) => X.utils.sheet_to_json(X.readFile(D + f, { cellDates: true }).Sheets[s], { defval: '', raw: true });
const pad = n => (n < 10 ? '0' : '') + n;
const ds = v => { if (v instanceof Date) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate()); const m = String(v || '').match(/(20\d{2})[-.\/년 ]+(\d{1,2})[-.\/월 ]+(\d{1,2})/); return m ? m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]) : ''; };
const str = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
const key = s => str(s).replace(/\(.*?\)|아파트|apt|[\s·.,\-_]/gi, '').toLowerCase();
const gu = s => str(s).replace(/특별시|광역시|특별자치시|특별자치도/g, '').split(' ').filter(Boolean).slice(0, 2).join(' ').replace(/(경기|강원|충청|전라|경상|제주)도$/, '$1');
const noPhone = s => str(s).replace(/0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{3,4}/g, '(연락처 가림)');
const noPerson = s => noPhone(s).replace(/\s*[가-힣]{2,4}\s*(대표|과장|차장|이사|상무|전무|부장|사장|부사장|실장|소장|팀장|관리소장)님?/g, '').trim();

// L2 영업활동 = 잔디 POUR공법기술문의
const L2raw = rd('잔디_POUR공법기술문의_전체목록.xlsx', '문의목록');
const L2 = L2raw.map(r => ({ no: str(r['번호']), d: ds(r['문의일자']), apt: str(r['아파트명']), kind: str(r['문의종류(공법)']), addr: str(r['주소']), sub: str(r['구분']), mid: str(r['메시지ID']) }));
// L3 PT 신청(전체 요청) · 진행 확정(A등급)
const PTF = 'POUR_PT_2022-2026_잔디정밀교차검증_최종검토.xlsx';
const SYNC = process.env.SYNC_JSON || (function () { throw new Error('SYNC_JSON(동기화 탭 덤프) 환경변수가 필요합니다'); })();
const TODAY = process.env.ASOF || '2026-10-28';
const gu2 = s => gu(s).replace(/^(서울|부산|대구|인천|광주|대전|울산|세종)시?/, '$1');
// PT 신청(잔디 통합목록) — 상태 5구분: 진행 완료(재검증 A) · 취소(D 또는 상태 취소) · 진행 확정(예정, 예정일이 기준일 이후) · 미확인
const stByNo = {}; rd('잔디_PT요청및일정_2022-2026_전체정리.xlsx', 'PT 최종 목록').forEach(r => { stByNo[str(r['번호'])] = str(r['PT 상태']); });
const PTreq = rd(PTF, '01_PT통합목록').map(r => ({ no: str(r['번호']), apt: str(r['아파트명']), addr: str(r['주소']), req: ds(r['최초 PT 요청일']) || ds(r['최초 PT 예정일']), plan: ds(r['최종 PT 예정일']) || ds(r['최초 PT 예정일']), job: str(r['공사명']), m: str(r['공법명(원문 키워드)']), firm: noPerson(r['요청 업체(분리)']), grade: str(r['재검증 등급']), gname: str(r['등급명']) }));
PTreq.forEach(r => { const s = stByNo[r.no] || ''; r.st = r.grade === 'A' || /진행 완료/.test(s) ? '진행 완료' : r.grade === 'D' || s === '취소' ? '취소' : (/예정|일정 변경/.test(s) && r.plan >= TODAY) ? '진행 확정(예정)' : '미확인'; });
// 실제 진행(아파트·월 단위 1회): 잔디 A + 2025 PT실적보고서 + 2026 플랫폼 '완료'
const REP = rd(PTF, '05_2025실적교차검증'); const repU = {}; REP.forEach(r => { const k = ds(r['날짜']) + '|' + key(r['현장명']); if (!repU[k]) repU[k] = { d: ds(r['날짜']), apt: str(r['현장명']), addr: str(r['주소']) }; });
const SY = JSON.parse(fs.readFileSync(SYNC, 'utf8')); const P = SY['동기화_②_공법설명회이력'], ph = P[0], pc = k => ph.indexOf(k);
const PLAT = P.slice(1).filter(r => str(r[pc('_상태')]) !== '원천삭제').map(r => ({ d: ds(r[pc('요청일')]), reg: ds(r[pc('등록일')]), apt: str(r[pc('현장명')]), addr: str(r[pc('주소')]), st: str(r[pc('상태')]) }));
const done = {}; const addDone = (d, apt, addr, src) => { if (!d || key(apt).length < 2) return; const k = d.slice(0, 7) + '|' + key(apt); if (!done[k]) done[k] = { d, apt, addr, src: [] }; if (done[k].src.indexOf(src) < 0) done[k].src.push(src); if (!done[k].addr && addr) done[k].addr = addr; };
PTreq.filter(r => r.grade === 'A').forEach(r => addDone(r.plan || r.req, r.apt, r.addr, '잔디 진행 확인(A)'));
Object.values(repU).forEach(r => addDone(r.d, r.apt, r.addr, '2025 PT실적보고서'));
PLAT.filter(r => r.st === '완료').forEach(r => addDone(r.d || r.reg, r.apt, r.addr, '2026 플랫폼 완료'));
const DONE = Object.values(done).sort((a, b) => a.d < b.d ? 1 : -1);
const plat26 = { 완료: 0, '진행중(날짜 지남·결과 미기록)': 0, '진행중(예정)': 0, '종료/취소': 0, '상태 빈칸': 0 }; PLAT.forEach(r => { const d = r.d || r.reg; if (r.st === '완료') plat26.완료++; else if (r.st === '진행중') plat26[d && d < TODAY ? '진행중(날짜 지남·결과 미기록)' : '진행중(예정)']++; else if (r.st === '종료/취소') plat26['종료/취소']++; else plat26['상태 빈칸']++; });
// 현장 묶기(이름 + 시·구, 주소 없으면 따로)와 L2→L3 연결: 확정 = 이름·시·구 일치 + 영업활동 뒤 실제 진행, 나머지 이름 일치는 후보
function group(list) { const o = {}; list.forEach(r => { const k = key(r.apt); if (k.length < 2) return; const g = gu2(r.addr); const id = k + '|' + (g || '?'); const s = o[id] = o[id] || { k, gu: g, apt: r.apt, first: '9999', n: 0 }; s.n++; if (r.d && r.d < s.first) s.first = r.d; }); return Object.values(o); }
const L2v = L2.filter(r => r.d && key(r.apt).length >= 2);
const S2 = group(L2v), S3 = group(DONE);
const link = []; let cand = 0, confirmed = 0; const lby = {};
S2.forEach(s => { const y = s.first.slice(0, 4); const o = lby[y] = lby[y] || { l2Sites: 0, cand: 0, confirmed: 0 }; o.l2Sites++; const nm = S3.filter(p => p.k === s.k); if (!nm.length) return; cand++; o.cand++;
  const ok = nm.filter(p => s.gu && p.gu && p.gu === s.gu && p.first >= s.first); let st, why;
  if (ok.length) { st = '확정'; why = '아파트명·주소(시·구) 일치, 영업활동 ' + s.first + ' 뒤 실제 진행 ' + ok[0].first; confirmed++; o.confirmed++; }
  else { st = '후보'; const p = nm[0]; why = !s.gu || !p.gu ? '한쪽 주소 없음 — 이름만 같음' : p.gu !== s.gu ? '이름은 같지만 주소(' + s.gu + ' / ' + p.gu + ')가 다름' : '실제 진행(' + p.first + ')이 영업활동(' + s.first + ')보다 먼저'; }
  link.push([st, s.apt, s.gu || '주소 없음', s.first, s.n, nm.map(p => p.apt + '(' + (p.gu || '주소 없음') + ')').join(' · '), nm.map(p => p.first).sort()[0], why]); });
link.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const YY = ['2022', '2023', '2024', '2025', '2026'];
const yr = YY.map(y => { const rq = PTreq.filter(r => (r.req || r.plan).slice(0, 4) === y); const ev = DONE.filter(e => e.d.slice(0, 4) === y); const c = s => rq.filter(r => r.st === s).length; return { year: y, req: rq.length, reqDone: c('진행 완료'), reqPlan: c('진행 확정(예정)'), reqCancel: c('취소'), reqUnknown: c('미확인'), done: ev.length, doneA: ev.filter(e => e.src.indexOf('잔디 진행 확인(A)') >= 0).length, doneRepOnly: ev.filter(e => e.src.length === 1 && e.src[0] === '2025 PT실적보고서').length, donePlatOnly: ev.filter(e => e.src.length === 1 && e.src[0] === '2026 플랫폼 완료').length, l2Records: L2.filter(r => r.d.slice(0, 4) === y).length, l2Sites: (lby[y] || {}).l2Sites || 0, cand: (lby[y] || {}).cand || 0, confirmed: (lby[y] || {}).confirmed || 0 }; });
const cntSt = s => PTreq.filter(r => r.st === s).length;
const dmin = a => a.filter(Boolean).sort()[0] || '', dmax = a => a.filter(Boolean).sort().pop() || '';
const site = { asOf: TODAY, l2Records: L2.length, l2Usable: L2v.length, l2Orig: L2.filter(r => r.sub === '원글').length, l2Comment: L2.filter(r => r.sub === '댓글').length, l2Sites: S2.length, l2From: dmin(L2.map(r => r.d)), l2To: dmax(L2.map(r => r.d)),
  ptReqLast: dmax(PTreq.map(r => r.req).filter(d => d <= TODAY)), repLast: dmax(Object.values(repU).map(r => r.d)),
  ptReq: PTreq.length, reqDone: cntSt('진행 완료'), reqPlan: cntSt('진행 확정(예정)'), reqCancel: cntSt('취소'), reqUnknown: cntSt('미확인'),
  done: DONE.length, doneSites: S3.length, rep: { rows: REP.length, unique: Object.keys(repU).length }, plat26,
  cand, confirmed, candidate: cand - confirmed, rate: S2.length ? Math.round(confirmed / S2.length * 1000) / 10 : null, byYear: yr };
const r126 = fs.existsSync(R126) ? JSON.parse(fs.readFileSync(R126, 'utf8')) : [];
const tables = {
  '잔디_L2_영업활동(기술문의)': { group: 'l2', note: '기술문의 = 영업보고(같은 원천, 한 번만 셈). 내용별 영업활동 검증 전이라 참고 자료', header: ['번호', '문의일자', '아파트명', '공법', '주소', '구분', '메시지ID'], rows: L2.map(r => [r.no, r.d, r.apt, r.kind, r.addr, r.sub, r.mid]) },
  '잔디_PT_신청목록': { group: 'l3', note: 'PT 신청 1건 = 1행 · 상태 5구분(진행 완료=재검증 A, 진행 확정=앞으로 예정, 취소, 미확인)', header: ['번호', '아파트명', '주소', '최초 요청일', '최종 예정일', '상태', '공사명', '공법', '요청 업체', '검증 등급', '등급명'], rows: PTreq.map(r => [r.no, r.apt, r.addr, r.req, r.plan, r.st, r.job, r.m, r.firm, r.grade, r.gname]) },
  'PT_실제진행(아파트·월)': { group: 'l3', note: '실제 진행 = 잔디 A + 2025 PT실적보고서 + 2026 플랫폼 완료, 같은 아파트·같은 달은 1회', header: ['진행일', '아파트명', '주소', '근거 원천'], rows: DONE.map(e => [e.d, e.apt, e.addr, e.src.join(' + ')]) },
  '아파트_L2-L3_연결': { group: 'link', note: '확정 = 아파트명·주소(시·구) 일치 + 영업활동 뒤 실제 진행 · 후보 = 이름만 일치', header: ['판정', '영업활동 아파트', '시·구', '첫 영업활동일', '영업활동 건수', '같은 이름 PT 진행 현장', '첫 실제 진행일', '근거'], rows: link },
  '2026_L3신규126_매칭': { group: 'link', note: '2026년 L3 첫 이용 126곳의 업체 매칭(확정·후보·미확인)', header: ['통합업체ID', 'B2B 코드', '업체명', '요청 표기', '요청자 구분', '첫 L3', '유형', '현장', '매칭', '근거', '신뢰', '후보 업체', '경로 분류', '협약일', 'POUR 낙찰 표기', '구매'], rows: r126.map(x => [x.id, x.b2b, x.name, x.reqType === '시공사(업체명 기재)' ? noPerson(x.raw) : x.reqType, x.reqType, x.first, x.type, x.site, x.match, x.basis, x.conf, x.candB2B ? x.candB2B + ' ' + x.candName : '', x.path, x.mou, x.award, x.buy]) }
};
const ext = { builtAt: new Date().toISOString().slice(0, 10), site, tables };
const json = JSON.stringify(ext);
if (/\b\d{3}-\d{2}-\d{5}\b/.test(json)) throw new Error('사업자번호 형식 포함');
const b64 = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64');
const OUT = path.join(__dirname, '..', 'private'); fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'ext.b64'), b64);
fs.writeFileSync(path.join(OUT, 'ext.summary.json'), JSON.stringify(site, null, 1));
console.log('json', json.length, 'b64', b64.length, 'req', site.ptReq, site.reqDone, site.reqPlan, site.reqCancel, site.reqUnknown, 'done', site.done, 'conf', site.confirmed, 'cand', site.candidate, 'rate', site.rate);
