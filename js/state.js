// ──────────────────────────────────────────────
//  SUPABASE 초기화 & 전역 상태
// ──────────────────────────────────────────────
const SUPABASE_URL = 'https://fqtnxrkxyzjrmaiaunqe.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MpZnq9JYoQLTXc9Uda_nmA_5OAybs0X';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ADMIN_EMAIL 제거됨 — 관리자 판별은 DB is_admin 필드로만 수행
const GACHA_COST    = 10;

// ── 이중 클릭 방지 (잠금) ──
const _busy = new Set();
async function withLock(key, fn) {
  if (_busy.has(key)) { return; }
  _busy.add(key);
  try { await fn(); }
  finally { _busy.delete(key); }
}
// 버튼 비활성화 헬퍼
function setBtnLoading(el, loading, text) {
  if (!el) return;
  el.disabled = loading;
  if (text !== undefined) el.textContent = loading ? '처리 중...' : text;
  el.style.opacity = loading ? '0.6' : '';
}
// KST(UTC+9) 기준 날짜 헬퍼
function _kstNow() {
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC+9
}
// TODAY, WEEK_KEY를 함수로 — 앱을 켜놓아도 자정/월요일 0시에 자동 갱신
function getToday() {
  return _kstNow().toISOString().slice(0, 10);
}
function getWeekKey() {
  const d = _kstNow();
  const day = d.getUTCDay() || 7;       // 일요일(0) → 7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  return 'W-' + monday.toISOString().slice(0, 10); // ex) "W-2026-02-16"
}
// 하위 호환: 기존 TODAY/WEEK_KEY 변수 참조 코드가 있을 경우를 위한 게터
Object.defineProperty(window, 'TODAY',    { get: getToday });
Object.defineProperty(window, 'WEEK_KEY', { get: getWeekKey });
const NOW_TS = () => new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

// ──────────────────────────────────────────────
//  세션 상태
// ──────────────────────────────────────────────
let session   = null;   // supabase auth session
let myProfile = null;   // public.users 프로필
let allUsers  = [];     // 관리자용 전체 유저 캐시
let allTxs    = [];     // 관리자용 전체 TX 캐시
let gachaPool = [];     // gacha_items 캐시
let reqFilter = 'all';
let storeProducts = []; // 상점 상품 캐시 (모달 즉시 오픈용)
