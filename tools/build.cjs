// Apps Script 배포 파일 만들기 — src/ 의 코드 + config.local.json(저장소에 올리지 않음)의 시트 ID·내장 자료 경로 → dist/
// 사용: node tools/build.cjs   (dist/Code.gs · dist/index.html · dist/appsscript.json 을 Apps Script 프로젝트에 붙여넣고 [배포 관리 → 수정 → 새 버전])
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), src = path.join(root, 'src'), dist = path.join(root, 'dist');
const cfgPath = path.join(root, 'config.local.json');
if (!fs.existsSync(cfgPath)) throw new Error('config.local.json 이 없습니다. config.example.json 을 복사해 값을 채우세요.');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
if (!cfg.sheetId || !cfg.webappUrl) throw new Error('config.local.json 에 sheetId 와 webappUrl 이 필요합니다.');
fs.mkdirSync(dist, { recursive: true });
const read = f => fs.readFileSync(f, 'utf8');
const analyze = read(path.join(src, 'analyze.js')).replace(/\nif \(typeof module[^\n]*\n?$/, '\n');
const server = read(path.join(src, 'server.gs')).replace(/'__SHEET_ID__';[^\n]*/, "'" + cfg.sheetId + "';");
// 비공개 자료(저장소 밖): 2024 업체코드 정정표, 로컬 엑셀 내장 자료(gzip+base64) — 없으면 넣지 않고 만든다
const fix = cfg.fix2024Path && fs.existsSync(cfg.fix2024Path) ? read(cfg.fix2024Path) : '';
const ext = cfg.extB64Path && fs.existsSync(cfg.extB64Path) ? read(cfg.extB64Path).trim() : '';
const code = server + (ext ? "\n// 내장 자료(build-ext.cjs: 잔디 L2 영업활동·PT 신청·진행, 126곳 매칭) — gzip+base64, 시트 권한 확인 후에만 열람\nvar EXT_DATA_B64 = '" + ext + "';\n" : '') + (fix ? '\n// 2024 업체코드 정정표(공고ID → [구분 A1·A2·B·C·D, 통합업체ID, 원본 낙찰업체, 이름 기준 업체]) — verify2/code-shift-2024.cjs 산출, 원본 무변경\nvar FIX_2024 = ' + fix + ';\n' : '') + analyze;
const ui = read(path.join(src, 'ui.template.html')).replace('__WEBAPP_URL__', cfg.webappUrl);
fs.writeFileSync(path.join(dist, 'Code.gs'), code);
fs.writeFileSync(path.join(dist, 'index.html'), ui);
fs.writeFileSync(path.join(dist, 'appsscript.json'), read(path.join(src, 'appsscript.json')));
for (const [n, t] of [['Code.gs', code], ['index.html', ui]]) {
  if (/\d{3}-\d{2}-\d{5}/.test(t)) throw new Error(n + ': 사업자번호 형식 포함');
  if (/BEGIN PRIVATE|AIza[0-9A-Za-z_-]{20}/.test(t)) throw new Error(n + ': 키 형식 포함');
  if (t.includes(String.fromCharCode(96))) throw new Error(n + ': 백틱 포함(편집기 붙여넣기 문제)');
}
console.log('dist 생성: Code.gs', code.length, '· index.html', ui.length, '· 정정표', !!fix, '· 내장 자료', !!ext);
