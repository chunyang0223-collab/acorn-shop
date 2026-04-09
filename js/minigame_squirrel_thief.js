// ──────────────────────────────────────────────
//  🐿️ 다람쥐 도둑 (Squirrel Thief) v1.0
//  주간 사이클 비동기 멀티플레이 단어 게임
// ──────────────────────────────────────────────

/* ═══════════════════════════════════════
   전역 상태
   ═══════════════════════════════════════ */
let _stState = null;     // 현재 게임 상태
let _stRoom = null;      // 현재 방 데이터
let _stPlayer = null;    // 현재 플레이어 데이터
let _stPlayers = [];     // 방의 모든 플레이어
let _stBlocks = [];      // 내 블록 인벤토리
let _stWords = [];       // 내 완성 단어 목록
let _stSub = null;       // Realtime subscription

// ── 관리자 테스트 모드 ──
let _stTestMode = false;           // 테스트 모드 활성화 여부
let _stTestPhase = null;           // 강제 페이즈 (null이면 실제 요일 사용)
let _stTestDay = 0;                // 테스트 가상 요일 인덱스 (0=월 ~ 6=일)
const _stTestDayLabels = ['월(모집)', '화(낚시)', '수(낚시)', '목(낚시)', '금(도둑)', '토(도둑)', '일(도둑→정산)'];
// _stTestPhaseMap은 ST_PHASE 선언 이후에 초기화 (temporal dead zone 방지)
let _stTestPhaseMap = null;

// 스펠링 블록 희귀도별 분포
const ST_LETTER_POOL = {
  common:   { letters: 'EEEEEAAAAIIIIOOOONNNRRRTTTLLLSSS', weight: 60 },
  uncommon: { letters: 'DDDGGGBBCCMMPPFFHHVVWWYY', weight: 30 },
  rare:     { letters: 'KKJJXXQQZZ', weight: 10 }
};

// 물고기 종류 (희귀도별)
const ST_FISH_TYPES = {
  common:   [
    { name: '붕어', emoji: '🐟' },
    { name: '미꾸라지', emoji: '🐠' },
    { name: '피라미', emoji: '🐟' }
  ],
  uncommon: [
    { name: '잉어', emoji: '🐡' },
    { name: '배스', emoji: '🐠' },
    { name: '메기', emoji: '🐟' }
  ],
  rare: [
    { name: '금붕어', emoji: '✨🐠' },
    { name: '무지개 송어', emoji: '🌈🐟' }
  ]
};

// 보상 테이블
const ST_REWARDS = {
  1: { acorns: 30, tickets: 2 },
  2: { acorns: 20, tickets: 0 },
  3: { acorns: 10, tickets: 0 },
  4: { acorns: 5, tickets: 0 }
};

// 게임 페이즈 스케줄 (요일별, 0=일 1=월 ~ 6=토)
const ST_PHASE = {
  RECRUITING: 'recruiting',   // 월
  FISHING:    'fishing',      // 화수목
  STEALING:   'stealing',     // 금토일(~오후6시)
  SCORING:    'scoring',      // 일 오후6시1분~자정
  FINISHED:   'finished'
};

// ST_PHASE 선언 후 초기화
_stTestPhaseMap = [
  ST_PHASE.RECRUITING,  // 월
  ST_PHASE.FISHING,     // 화
  ST_PHASE.FISHING,     // 수
  ST_PHASE.FISHING,     // 목
  ST_PHASE.STEALING,    // 금
  ST_PHASE.STEALING,    // 토
  ST_PHASE.STEALING     // 일 (오후6시 전)
];


/* ═══════════════════════════════════════
   유틸리티
   ═══════════════════════════════════════ */
function _stGetKSTNow() {
  const now = new Date();
  return new Date(now.getTime() + (9 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60000));
}

function _stGetWeekMonday() {
  const kst = _stGetKSTNow();
  const day = kst.getUTCDay() || 7; // 일=7
  const monday = new Date(kst);
  monday.setUTCDate(kst.getUTCDate() - (day - 1));
  return monday.toISOString().slice(0, 10);
}

function _stGetCurrentPhase() {
  // 테스트 모드: 강제 페이즈 사용
  if (_stTestMode && _stTestPhase !== null) return _stTestPhase;

  const kst = _stGetKSTNow();
  const dayOfWeek = kst.getUTCDay(); // 0=일 1=월 ~ 6=토
  const hour = kst.getUTCHours();

  if (dayOfWeek === 1) return ST_PHASE.RECRUITING;
  if (dayOfWeek >= 2 && dayOfWeek <= 4) return ST_PHASE.FISHING;
  if (dayOfWeek === 5 || dayOfWeek === 6) return ST_PHASE.STEALING;
  if (dayOfWeek === 0) {
    if (hour < 18) return ST_PHASE.STEALING;
    return ST_PHASE.SCORING;
  }
  return ST_PHASE.FISHING;
}

function _stGetPhaseLabel(phase) {
  switch (phase) {
    case ST_PHASE.RECRUITING: return '🎣 참가 모집 중 (월)';
    case ST_PHASE.FISHING:    return '🎣 낚시 진행 중 (화~목)';
    case ST_PHASE.STEALING:   return '🐿️ 도둑 출정 가능 (금~일 오후6시)';
    case ST_PHASE.SCORING:    return '🏆 순위 공개 중 (일 오후6시~자정)';
    case ST_PHASE.FINISHED:   return '✅ 이번 주 게임 종료';
    default: return '';
  }
}

let _stTestDateOffset = 0; // 테스트 모드에서 가상 날짜 오프셋 (일 단위)

// 테스트 모드에서는 가상 날짜 기반 ISO 문자열 반환, 아니면 실제 시간
function _stGetTimestamp() {
  if (_stTestMode) {
    return _stGetTodayKST() + 'T12:00:00.000Z';
  }
  return new Date().toISOString();
}

function _stGetTodayKST() {
  if (_stTestMode) {
    // 테스트 모드: 기준 월요일 + testDay 오프셋
    const base = new Date(_stRoom?.week_start || _stGetWeekMonday());
    base.setDate(base.getDate() + _stTestDay);
    return base.toISOString().slice(0, 10);
  }
  return _stGetKSTNow().toISOString().slice(0, 10);
}

function _stPickRarity() {
  const roll = Math.random() * 100;
  if (roll < ST_LETTER_POOL.rare.weight) return 'rare';
  if (roll < ST_LETTER_POOL.rare.weight + ST_LETTER_POOL.uncommon.weight) return 'uncommon';
  return 'common';
}

function _stPickLetter(rarity) {
  const pool = ST_LETTER_POOL[rarity].letters;
  return pool[Math.floor(Math.random() * pool.length)];
}

function _stPickFish(rarity) {
  const types = ST_FISH_TYPES[rarity];
  return types[Math.floor(Math.random() * types.length)];
}

function _stGetContainer() {
  return document.getElementById('minigame-play');
}


/* ═══════════════════════════════════════
   게임 진입점
   ═══════════════════════════════════════ */
async function startSquirrelThiefGame() {
  const hub = document.getElementById('minigame-hub');
  const play = document.getElementById('minigame-play');
  hub.classList.add('hidden');
  play.classList.remove('hidden');

  play.innerHTML = '<div class="clay-card p-6 text-center"><div class="text-2xl mb-2">🐿️</div><p class="text-sm text-gray-500">로딩 중...</p></div>';

  try {
    const weekStart = _stGetWeekMonday();
    const phase = _stGetCurrentPhase();

    // 현재 주의 내 방 찾기
    const { data: myPlayers } = await sb.from('sq_thief_players')
      .select('*, room:sq_thief_rooms(*)')
      .eq('user_id', myProfile.id)
      .eq('is_bot', false);

    const currentPlayer = myPlayers?.find(p => p.room?.week_start === weekStart);

    if (currentPlayer) {
      // 이미 참가한 방이 있음
      _stRoom = currentPlayer.room;
      _stPlayer = currentPlayer;
      await _stLoadRoomData();
      _stRenderMain();

      // 봇 턴 자동 처리 (백그라운드)
      _stProcessBotTurns().catch(e => console.warn('[다람쥐도둑] 봇 턴 처리 실패:', e));
    } else if (phase === ST_PHASE.RECRUITING) {
      // 모집 중 — 방 목록 보여주기
      _stRenderLobby();
    } else {
      // 모집 기간 아님
      _stRenderNoRoom(phase);
    }
  } catch (e) {
    console.error('[다람쥐도둑] 로드 실패:', e);
    play.innerHTML = `<div class="clay-card p-6 text-center">
      <p class="text-red-500 font-bold">로딩 중 오류가 발생했어요.</p>
      <button class="btn btn-gray mt-3" onclick="exitMinigame()">돌아가기</button>
    </div>`;
  }
}


/* ═══════════════════════════════════════
   방 데이터 로드
   ═══════════════════════════════════════ */
async function _stLoadRoomData() {
  if (!_stRoom) return;

  const [playersRes, blocksRes, wordsRes] = await Promise.all([
    sb.from('sq_thief_players').select('*').eq('room_id', _stRoom.id),
    sb.from('sq_thief_blocks').select('*').eq('room_id', _stRoom.id).eq('owner_id', _stPlayer.id),
    sb.from('sq_thief_words').select('*').eq('room_id', _stRoom.id).eq('player_id', _stPlayer.id)
  ]);

  _stPlayers = playersRes.data || [];
  _stBlocks = blocksRes.data || [];
  _stWords = wordsRes.data || [];
}


/* ═══════════════════════════════════════
   로비 화면 (방 목록 / 방 생성)
   ═══════════════════════════════════════ */
async function _stRenderLobby() {
  const c = _stGetContainer();
  const weekStart = _stGetWeekMonday();

  // 모집 중인 방 목록
  const { data: rooms } = await sb.from('sq_thief_rooms')
    .select('*, players:sq_thief_players(id, user_id, is_bot)')
    .eq('week_start', weekStart)
    .eq('status', 'recruiting')
    .order('created_at', { ascending: false });

  const roomList = (rooms || []).map(r => {
    const humanCount = r.players.filter(p => !p.is_bot).length;
    const isFull = humanCount >= 4;
    const alreadyJoined = r.players.some(p => p.user_id === myProfile.id);

    return `<div class="clay-card p-4 mb-3" style="animation:clayPop .4s var(--ease-bounce)">
      <div class="flex items-center justify-between">
        <div>
          <span class="text-lg font-black">🏠 방 #${r.id.slice(0, 6)}</span>
          <p class="text-xs text-gray-500 mt-1">참가자 ${humanCount}/4명</p>
        </div>
        <div>
          ${alreadyJoined
            ? '<span class="text-xs font-bold text-green-600">참가 완료 ✅</span>'
            : isFull
              ? '<span class="text-xs font-bold text-gray-400">만석</span>'
              : `<button class="btn btn-primary px-4 py-2 text-sm" onclick="_stJoinRoom('${r.id}')">참가하기</button>`
          }
        </div>
      </div>
    </div>`;
  }).join('');

  c.innerHTML = `
    <div style="padding:4px">
      <div class="flex items-center justify-between mb-4">
        <button class="btn btn-gray px-3 py-2 text-sm" onclick="exitMinigame()">← 돌아가기</button>
        <span class="text-xs font-bold text-amber-600">${_stGetPhaseLabel(ST_PHASE.RECRUITING)}</span>
      </div>

      <div class="clay-card p-5 mb-4 text-center">
        <div class="text-4xl mb-2">🐿️</div>
        <h2 class="text-lg font-black text-gray-800 mb-1">다람쥐 도둑</h2>
        <p class="text-xs text-gray-500">스펠링을 낚고, 단어를 완성하고, 다람쥐를 보내 훔쳐오세요!</p>
      </div>

      ${roomList || '<p class="text-sm text-gray-400 text-center mb-4">아직 열린 방이 없어요.</p>'}

      <button class="btn btn-green w-full py-3 text-sm font-black" onclick="_stCreateRoom()">
        🏠 새 방 만들기
      </button>
    </div>`;
}

function _stRenderNoRoom(phase) {
  const c = _stGetContainer();
  c.innerHTML = `
    <div style="padding:4px">
      <button class="btn btn-gray px-3 py-2 text-sm mb-4" onclick="exitMinigame()">← 돌아가기</button>
      <div class="clay-card p-6 text-center">
        <div class="text-4xl mb-3">🐿️</div>
        <h2 class="text-lg font-black text-gray-800 mb-2">다람쥐 도둑</h2>
        <p class="text-sm text-gray-500 mb-2">이번 주에 참가한 방이 없어요.</p>
        <p class="text-xs text-gray-400">매주 월요일에 방에 참가할 수 있어요!</p>
        <p class="text-xs font-bold text-amber-600 mt-3">${_stGetPhaseLabel(phase)}</p>
      </div>
    </div>`;
}


/* ═══════════════════════════════════════
   방 생성 / 참가
   ═══════════════════════════════════════ */
async function _stCreateRoom() {
  try {
    const weekStart = _stGetWeekMonday();

    // 이미 이번 주에 참가한 방이 있는지 체크
    const { data: existing } = await sb.from('sq_thief_players')
      .select('id, room:sq_thief_rooms(week_start)')
      .eq('user_id', myProfile.id)
      .eq('is_bot', false);

    if (existing?.some(p => p.room?.week_start === weekStart)) {
      toast('⚠️', '이번 주에 이미 참가한 방이 있어요!');
      return;
    }

    // 방 생성
    const { data: room, error } = await sb.from('sq_thief_rooms')
      .insert({ week_start: weekStart, status: 'recruiting' })
      .select().single();

    if (error) throw error;

    // 방장으로 참가
    const { data: player } = await sb.from('sq_thief_players')
      .insert({ room_id: room.id, user_id: myProfile.id, is_bot: false })
      .select().single();

    _stRoom = room;
    _stPlayer = player;
    _stPlayers = [player];
    _stBlocks = [];
    _stWords = [];

    toast('🏠', '방을 만들었어요!');
    _stRenderMain();
  } catch (e) {
    console.error('[다람쥐도둑] 방 생성 실패:', e);
    toast('❌', '방 생성에 실패했어요.');
  }
}

async function _stJoinRoom(roomId) {
  try {
    const weekStart = _stGetWeekMonday();

    // 이미 참가한 방 체크
    const { data: existing } = await sb.from('sq_thief_players')
      .select('id, room:sq_thief_rooms(week_start)')
      .eq('user_id', myProfile.id)
      .eq('is_bot', false);

    if (existing?.some(p => p.room?.week_start === weekStart)) {
      toast('⚠️', '이번 주에 이미 참가한 방이 있어요!');
      return;
    }

    // 인원 수 체크
    const { data: players } = await sb.from('sq_thief_players')
      .select('id').eq('room_id', roomId).eq('is_bot', false);

    if ((players?.length || 0) >= 4) {
      toast('⚠️', '이미 만석이에요!');
      _stRenderLobby();
      return;
    }

    // 참가
    const { data: player } = await sb.from('sq_thief_players')
      .insert({ room_id: roomId, user_id: myProfile.id, is_bot: false })
      .select().single();

    const { data: room } = await sb.from('sq_thief_rooms')
      .select('*').eq('id', roomId).single();

    _stRoom = room;
    _stPlayer = player;
    await _stLoadRoomData();

    toast('✅', '방에 참가했어요!');
    _stRenderMain();
  } catch (e) {
    console.error('[다람쥐도둑] 방 참가 실패:', e);
    toast('❌', '참가에 실패했어요.');
  }
}

// 화요일 전환 시 봇 채우기 (방의 첫 접속자가 트리거)
async function _stFillBots() {
  if (!_stRoom) return;

  const humanCount = _stPlayers.filter(p => !p.is_bot).length;
  const existingBots = _stPlayers.filter(p => p.is_bot).length;
  const totalNeeded = 4 - humanCount - existingBots;

  if (totalNeeded <= 0) return;

  const botNames = ['다람이', '토리', '밤순이', '솔방울'];

  for (let i = 0; i < totalNeeded; i++) {
    await sb.from('sq_thief_players').insert({
      room_id: _stRoom.id,
      user_id: null,
      is_bot: true,
      bot_level: 'grade6'
    });
  }

  // 방 상태 업데이트
  await sb.from('sq_thief_rooms').update({
    status: 'fishing',
    updated_at: new Date().toISOString()
  }).eq('id', _stRoom.id);

  await _stLoadRoomData();
}


/* ═══════════════════════════════════════
   메인 게임 화면
   ═══════════════════════════════════════ */
function _stRenderMain() {
  const c = _stGetContainer();
  const phase = _stGetCurrentPhase();

  // 페이즈에 따라 방 상태 자동 업데이트 (필요시, 완료 후 리렌더)
  _stCheckPhaseTransition(phase).then(changed => {
    if (changed) _stRenderMain();
  }).catch(e => console.warn('[다람쥐도둑] 페이즈 전환 실패:', e));

  const inventoryBlocks = _stBlocks.filter(b => b.status === 'inventory');
  const lockedBlocks = _stBlocks.filter(b => b.status === 'locked');
  const hiddenBlock = _stBlocks.find(b => b.status === 'hidden');

  c.innerHTML = `
    <div style="padding:4px">
      <!-- 헤더 -->
      <div class="flex items-center justify-between mb-3">
        <button class="btn btn-gray px-3 py-2 text-sm" onclick="exitMinigame()">← 돌아가기</button>
        <span class="text-xs font-bold text-amber-600">${_stGetPhaseLabel(phase)}</span>
      </div>

      <!-- 게임 타이틀 카드 -->
      <div class="clay-card p-4 mb-3">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-base font-black text-gray-800">🐿️ 다람쥐 도둑</h2>
            <p class="text-xs text-gray-500">방 #${_stRoom.id.slice(0, 6)} · ${_stPlayers.filter(p => !p.is_bot).length}명 + 봇 ${_stPlayers.filter(p => p.is_bot).length}마리</p>
          </div>
          <div class="text-right">
            <p class="text-xs text-gray-400">완성 단어</p>
            <p class="text-lg font-black text-pink-500">${_stWords.length}개</p>
          </div>
        </div>
      </div>

      <!-- 탭 메뉴 -->
      <div class="flex gap-1 mb-3 overflow-x-auto" style="scrollbar-width:none">
        <button class="tab-btn st-tab active" onclick="_stSwitchTab('inventory',this)">📦 인벤토리</button>
        <button class="tab-btn st-tab" onclick="_stSwitchTab('fishing',this)">🎣 낚시터</button>
        <button class="tab-btn st-tab" onclick="_stSwitchTab('word',this)">📝 단어 만들기</button>
        <button class="tab-btn st-tab" onclick="_stSwitchTab('thief',this)">🐿️ 다람쥐 도둑</button>
        <button class="tab-btn st-tab" onclick="_stSwitchTab('shop',this)">🏪 상점</button>
      </div>

      <!-- 탭 컨텐츠 영역 -->
      <div id="st-tab-content"></div>
    </div>`;

  // 테스트 모드 바 표시
  if (_stTestMode) _stRenderTestBar();

  // 기본 탭: 인벤토리
  _stRenderInventoryTab();
}

function _stSwitchTab(tabId, btn) {
  document.querySelectorAll('.st-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  switch (tabId) {
    case 'inventory': _stRenderInventoryTab(); break;
    case 'fishing':   _stRenderFishingTab(); break;
    case 'word':      _stRenderWordTab(); break;
    case 'thief':     _stRenderThiefTab(); break;
    case 'shop':      _stRenderShopTab(); break;
  }
}


/* ═══════════════════════════════════════
   탭 1: 인벤토리
   ═══════════════════════════════════════ */
function _stRenderInventoryTab() {
  const tc = document.getElementById('st-tab-content');
  const inventoryBlocks = _stBlocks.filter(b => b.status === 'inventory');
  const hiddenBlock = _stBlocks.find(b => b.status === 'hidden');

  const blockHtml = inventoryBlocks.length > 0
    ? inventoryBlocks.map(b => {
        const rarityClass = b.rarity === 'rare' ? 'st-block-rare' :
                            b.rarity === 'uncommon' ? 'st-block-uncommon' : 'st-block-common';
        const stolenBadge = b.stolen_from_id ? '<span class="st-stolen-badge">🐿️</span>' : '';
        return `<div class="st-block ${rarityClass}" data-block-id="${b.id}" data-letter="${b.letter}">
          ${stolenBadge}
          <span class="st-block-letter">${b.letter}</span>
        </div>`;
      }).join('')
    : '<p class="text-xs text-gray-400 text-center py-4">아직 블록이 없어요. 낚시터에서 블록을 낚아보세요!</p>';

  const hiddenHtml = hiddenBlock
    ? `<div class="st-block st-block-hidden">
        <span class="st-block-letter">${hiddenBlock.letter}</span>
        <span class="text-xs">🔒 숨김</span>
       </div>`
    : '<p class="text-xs text-gray-400">아직 숨긴 블록이 없어요.</p>';

  // 완성 단어 목록
  const wordsHtml = _stWords.length > 0
    ? _stWords.map(w => `<div class="st-word-badge">${w.word} <span class="text-xs text-gray-400">(${w.letter_count}자)</span></div>`).join('')
    : '<p class="text-xs text-gray-400">아직 완성한 단어가 없어요.</p>';

  tc.innerHTML = `
    <div class="clay-card p-4 mb-3" style="animation:clayPop .3s var(--ease-bounce)">
      <p class="text-sm font-black text-gray-700 mb-2">📦 보유 블록 (${inventoryBlocks.length}개)</p>
      <div class="st-block-grid">${blockHtml}</div>
    </div>

    <div class="clay-card p-4 mb-3">
      <p class="text-sm font-black text-gray-700 mb-2">🔒 숨긴 블록</p>
      ${hiddenHtml}
      ${!hiddenBlock && inventoryBlocks.length > 0
        ? `<p class="text-xs text-blue-500 mt-2 cursor-pointer font-bold" onclick="_stShowHideBlockPicker()">블록을 하나 선택해서 숨기기 →</p>`
        : ''}
      ${hiddenBlock
        ? `<p class="text-xs text-red-400 mt-2 cursor-pointer font-bold" onclick="_stUnhideBlock('${hiddenBlock.id}')">숨기기 해제 →</p>`
        : ''}
    </div>

    <div class="clay-card p-4">
      <p class="text-sm font-black text-gray-700 mb-2">📖 완성 단어 (${_stWords.length}개)</p>
      <div class="flex flex-wrap gap-2">${wordsHtml}</div>
    </div>`;
}

async function _stShowHideBlockPicker() {
  const inventoryBlocks = _stBlocks.filter(b => b.status === 'inventory');

  showModal(`<div class="text-center">
    <div class="text-2xl mb-2">🔒</div>
    <h3 class="font-black text-gray-800 mb-3">숨길 블록을 선택하세요</h3>
    <div class="st-block-grid" style="justify-content:center">
      ${inventoryBlocks.map(b => {
        const rarityClass = b.rarity === 'rare' ? 'st-block-rare' :
                            b.rarity === 'uncommon' ? 'st-block-uncommon' : 'st-block-common';
        return `<div class="st-block ${rarityClass} cursor-pointer" onclick="_stHideBlock('${b.id}')">
          <span class="st-block-letter">${b.letter}</span>
        </div>`;
      }).join('')}
    </div>
    <button class="btn btn-gray mt-3 px-4 py-2" onclick="closeModal()">취소</button>
  </div>`);
}

async function _stHideBlock(blockId) {
  try {
    await sb.from('sq_thief_blocks').update({ status: 'hidden' }).eq('id', blockId);
    const block = _stBlocks.find(b => b.id === blockId);
    if (block) block.status = 'hidden';
    closeModal();
    toast('🔒', '블록을 숨겼어요!');
    _stRenderInventoryTab();
  } catch (e) {
    toast('❌', '숨기기 실패!');
  }
}

async function _stUnhideBlock(blockId) {
  try {
    await sb.from('sq_thief_blocks').update({ status: 'inventory' }).eq('id', blockId);
    const block = _stBlocks.find(b => b.id === blockId);
    if (block) block.status = 'inventory';
    toast('🔓', '숨기기를 해제했어요!');
    _stRenderInventoryTab();
  } catch (e) {
    toast('❌', '해제 실패!');
  }
}


/* ═══════════════════════════════════════
   탭 2: 낚시터
   ═══════════════════════════════════════ */
function _stRenderFishingTab() {
  const tc = document.getElementById('st-tab-content');
  const phase = _stGetCurrentPhase();
  const isFishingPhase = (phase === ST_PHASE.FISHING);
  const fishingMaint = getMgSetting('squirrelThief', 'fishingMaintenance');

  // 오늘 낚은 수 계산
  const today = _stGetTodayKST();
  const todayFished = _stBlocks.filter(b =>
    b.obtained_method === 'fished' &&
    b.obtained_at?.slice(0, 10) === today
  ).length;
  const maxDaily = 7;
  const remaining = Math.max(0, maxDaily - todayFished);

  if (fishingMaint) {
    tc.innerHTML = `
      <div class="clay-card p-6 text-center" style="animation:clayPop .3s var(--ease-bounce)">
        <div class="text-4xl mb-3">🔧</div>
        <h3 class="font-black text-gray-800 mb-2">낚시터 점검 중</h3>
        <p class="text-sm text-gray-500">잠시 후에 다시 방문해주세요!</p>
      </div>`;
    return;
  }

  if (!isFishingPhase) {
    tc.innerHTML = `
      <div class="clay-card p-6 text-center" style="animation:clayPop .3s var(--ease-bounce)">
        <div class="text-4xl mb-3">🎣</div>
        <h3 class="font-black text-gray-800 mb-2">낚시터</h3>
        <p class="text-sm text-gray-500 mb-2">낚시는 화~목요일에만 할 수 있어요!</p>
        <p class="text-xs text-gray-400">${_stGetPhaseLabel(phase)}</p>
      </div>`;
    return;
  }

  tc.innerHTML = `
    <div class="clay-card p-4 mb-3" style="animation:clayPop .3s var(--ease-bounce)">
      <div class="flex items-center justify-between mb-3">
        <p class="text-sm font-black text-gray-700">🎣 낚시터</p>
        <span class="text-xs font-bold text-amber-600">오늘 남은 횟수: ${remaining}/${maxDaily}</span>
      </div>

      <!-- 낚시 영역 -->
      <div id="st-fishing-area" class="st-fishing-pond">
        <div class="st-water-surface"></div>
        <div id="st-fishing-line" class="st-fishing-line" style="display:none">
          <div class="st-float"></div>
        </div>
        <div id="st-fish-splash" style="display:none"></div>
      </div>

      <!-- 낚시 버튼 -->
      <div class="text-center mt-3">
        ${remaining > 0
          ? `<button id="st-fish-btn" class="btn btn-blue px-6 py-3 text-sm font-black" onclick="_stStartFishing()">
              🎣 낚싯대 던지기
             </button>`
          : '<p class="text-sm font-bold text-gray-400">오늘 낚시 횟수를 모두 사용했어요!</p>'}
      </div>
    </div>

    <!-- 오늘 낚은 블록 -->
    <div class="clay-card p-4">
      <p class="text-sm font-black text-gray-700 mb-2">🐟 오늘 낚은 블록</p>
      <div class="st-block-grid" id="st-today-fished">
        ${_stRenderTodayFished(today)}
      </div>
    </div>`;
}

function _stRenderTodayFished(today) {
  const todayBlocks = _stBlocks.filter(b =>
    b.obtained_method === 'fished' &&
    b.obtained_at?.slice(0, 10) === today
  );

  if (todayBlocks.length === 0) return '<p class="text-xs text-gray-400 text-center py-2">아직 낚은 블록이 없어요.</p>';

  return todayBlocks.map(b => {
    const rarityClass = b.rarity === 'rare' ? 'st-block-rare' :
                        b.rarity === 'uncommon' ? 'st-block-uncommon' : 'st-block-common';
    return `<div class="st-block ${rarityClass}"><span class="st-block-letter">${b.letter}</span></div>`;
  }).join('');
}


/* ── 낚시 미니게임 로직 ── */
let _stFishingState = null;

async function _stStartFishing() {
  const btn = document.getElementById('st-fish-btn');
  if (!btn || _stFishingState) return;

  btn.disabled = true;
  btn.textContent = '⏳ 기다리는 중...';
  playSound('stCast');

  const fishingLine = document.getElementById('st-fishing-line');
  fishingLine.style.display = 'block';

  // 찌 애니메이션 시작
  const float = fishingLine.querySelector('.st-float');
  float.classList.add('st-float-idle');

  _stFishingState = { phase: 'waiting', timer: null };

  // 랜덤 시간 후 찌 반응 (3~12초)
  const waitTime = 3000 + Math.random() * 9000;

  _stFishingState.timer = setTimeout(() => {
    if (!_stFishingState) return;
    _stFishingState.phase = 'biting';

    // 찌가 물에 잠기는 애니메이션
    float.classList.remove('st-float-idle');
    float.classList.add('st-float-bite');

    playSound('stBite');
    btn.textContent = '🎣 지금! 잡아당기기!';
    btn.disabled = false;
    btn.onclick = () => _stCatchFish();

    // 타이밍 윈도우 (1.5초 내 클릭해야 함)
    _stFishingState.catchTimer = setTimeout(() => {
      if (_stFishingState?.phase === 'biting') {
        _stFishMissed();
      }
    }, 1500);
  }, waitTime);

  // 너무 빨리 클릭하면 실패
  btn.onclick = () => {
    if (_stFishingState?.phase === 'waiting') {
      _stFishTooEarly();
    }
  };
}

function _stFishTooEarly() {
  _stResetFishing();
  playSound('stMiss');
  toast('💨', '너무 빨라요! 물고기가 도망갔어요...');
  _stRenderFishingTab();
}

function _stFishMissed() {
  _stResetFishing();
  playSound('stMiss');
  toast('💨', '놓쳤어요! 물고기가 도망갔어요...');
  _stRenderFishingTab();
}

async function _stCatchFish() {
  if (_stFishingState?.phase !== 'biting') return;

  clearTimeout(_stFishingState.catchTimer);
  _stFishingState.phase = 'caught';

  // 희귀도 결정
  const rarity = _stPickRarity();
  const letter = _stPickLetter(rarity);
  const fish = _stPickFish(rarity);

  const btn = document.getElementById('st-fish-btn');
  btn.disabled = true;
  btn.textContent = '🎉 잡았다!';
  playSound('stCatch');

  // 스플래시 효과
  const splash = document.getElementById('st-fish-splash');
  splash.style.display = 'block';
  splash.innerHTML = `<div class="st-catch-result" style="animation:bounceIn .4s var(--ease-bounce)">
    <span class="text-2xl">${fish.emoji}</span>
    <p class="text-sm font-black">${fish.name} 낚았다!</p>
    <div class="st-block st-block-${rarity} mx-auto mt-2">
      <span class="st-block-letter">${letter}</span>
    </div>
  </div>`;

  try {
    // DB에 블록 저장
    const { data: block } = await sb.from('sq_thief_blocks').insert({
      room_id: _stRoom.id,
      owner_id: _stPlayer.id,
      original_owner_id: _stPlayer.id,
      letter: letter,
      rarity: rarity,
      status: 'inventory',
      obtained_method: 'fished',
      obtained_at: _stGetTimestamp()
    }).select().single();

    if (block) _stBlocks.push(block);

    // 낚시 로그
    await sb.from('sq_thief_fishing_log').insert({
      room_id: _stRoom.id,
      player_id: _stPlayer.id,
      letter: letter,
      rarity: rarity,
      fish_type: fish.name,
      fished_at: _stGetTimestamp()
    });

    // 오늘 낚은 블록 목록 업데이트
    const todayEl = document.getElementById('st-today-fished');
    if (todayEl) {
      todayEl.innerHTML = _stRenderTodayFished(_stGetTodayKST());
    }
  } catch (e) {
    console.error('[다람쥐도둑] 낚시 저장 실패:', e);
  }

  // 2초 후 리셋
  setTimeout(() => {
    _stResetFishing();
    _stRenderFishingTab();
  }, 2000);
}

function _stResetFishing() {
  if (_stFishingState?.timer) clearTimeout(_stFishingState.timer);
  if (_stFishingState?.catchTimer) clearTimeout(_stFishingState.catchTimer);
  _stFishingState = null;
}


/* ═══════════════════════════════════════
   탭 3: 단어 만들기
   ═══════════════════════════════════════ */
let _stWordSlots = []; // 현재 슬롯에 배치된 블록 ID들 (10칸)

function _stRenderWordTab() {
  const tc = document.getElementById('st-tab-content');
  _stWordSlots = new Array(10).fill(null);

  const inventoryBlocks = _stBlocks.filter(b => b.status === 'inventory');

  tc.innerHTML = `
    <div class="clay-card p-4 mb-3" style="animation:clayPop .3s var(--ease-bounce)">
      <p class="text-sm font-black text-gray-700 mb-3">📝 단어 만들기</p>

      <!-- 10칸 슬롯 -->
      <div class="st-word-slots" id="st-word-slots">
        ${Array.from({ length: 10 }, (_, i) =>
          `<div class="st-word-slot" id="st-slot-${i}" data-index="${i}" onclick="_stRemoveFromSlot(${i})"></div>`
        ).join('')}
      </div>

      <div class="flex gap-2 mt-3 justify-center">
        <button class="btn btn-gray px-4 py-2 text-sm" onclick="_stClearSlots()">초기화</button>
        <button class="btn btn-primary px-6 py-2 text-sm font-black" onclick="_stSubmitWord()">제출하기</button>
      </div>

      <p class="text-xs text-gray-400 text-center mt-2">인벤토리 블록을 탭하여 슬롯에 배치하세요. 3~10글자 단어를 만들 수 있어요.</p>
    </div>

    <!-- 인벤토리 블록 -->
    <div class="clay-card p-4 mb-3">
      <p class="text-sm font-black text-gray-700 mb-2">📦 사용 가능한 블록 (${inventoryBlocks.length}개)</p>
      <div class="st-block-grid" id="st-word-inventory">
        ${inventoryBlocks.length > 0
          ? inventoryBlocks.map(b => {
              const rarityClass = b.rarity === 'rare' ? 'st-block-rare' :
                                  b.rarity === 'uncommon' ? 'st-block-uncommon' : 'st-block-common';
              const stolenBadge = b.stolen_from_id ? '<span class="st-stolen-badge">🐿️</span>' : '';
              return `<div class="st-block ${rarityClass} cursor-pointer" id="st-inv-${b.id}" data-block-id="${b.id}" onclick="_stAddToSlot('${b.id}')">
                ${stolenBadge}
                <span class="st-block-letter">${b.letter}</span>
              </div>`;
            }).join('')
          : '<p class="text-xs text-gray-400 text-center py-2">사용 가능한 블록이 없어요.</p>'
        }
      </div>
    </div>

    <!-- 완성 단어 목록 -->
    <div class="clay-card p-4">
      <p class="text-sm font-black text-gray-700 mb-2">📖 완성 단어 (${_stWords.length}개)</p>
      <div class="flex flex-wrap gap-2">
        ${_stWords.length > 0
          ? _stWords.map(w => `<div class="st-word-badge">${w.word} <span class="text-xs text-gray-400">(${w.letter_count}자)</span></div>`).join('')
          : '<p class="text-xs text-gray-400">아직 완성한 단어가 없어요.</p>'
        }
      </div>
    </div>`;
}

function _stAddToSlot(blockId) {
  // 이미 슬롯에 있는 블록인지 체크
  if (_stWordSlots.includes(blockId)) return;

  // 빈 슬롯 찾기
  const emptyIndex = _stWordSlots.findIndex(s => s === null);
  if (emptyIndex === -1) {
    toast('⚠️', '슬롯이 모두 찼어요!');
    return;
  }

  _stWordSlots[emptyIndex] = blockId;
  playSound('stBlockPlace');

  // UI 업데이트
  const block = _stBlocks.find(b => b.id === blockId);
  const slot = document.getElementById(`st-slot-${emptyIndex}`);
  if (slot && block) {
    const rarityClass = block.rarity === 'rare' ? 'st-block-rare' :
                        block.rarity === 'uncommon' ? 'st-block-uncommon' : 'st-block-common';
    slot.innerHTML = `<div class="st-block ${rarityClass} st-block-in-slot"><span class="st-block-letter">${block.letter}</span></div>`;
    slot.classList.add('st-slot-filled');
  }

  // 인벤토리에서 흐리게
  const invBlock = document.getElementById(`st-inv-${blockId}`);
  if (invBlock) invBlock.classList.add('st-block-used');
}

function _stRemoveFromSlot(index) {
  const blockId = _stWordSlots[index];
  if (!blockId) return;
  playSound('stBlockRemove');

  _stWordSlots[index] = null;

  // 슬롯 비우기
  const slot = document.getElementById(`st-slot-${index}`);
  if (slot) {
    slot.innerHTML = '';
    slot.classList.remove('st-slot-filled');
  }

  // 인벤토리 복원
  const invBlock = document.getElementById(`st-inv-${blockId}`);
  if (invBlock) invBlock.classList.remove('st-block-used');
}

function _stClearSlots() {
  for (let i = 0; i < 10; i++) {
    _stRemoveFromSlot(i);
  }
}

async function _stSubmitWord() {
  // 슬롯에서 단어 조합
  const usedBlocks = _stWordSlots.filter(s => s !== null);
  if (usedBlocks.length < 3) {
    toast('⚠️', '3글자 이상 단어를 만들어주세요!');
    return;
  }

  const word = usedBlocks.map(id => {
    const block = _stBlocks.find(b => b.id === id);
    return block?.letter || '';
  }).join('').toUpperCase();

  // 이미 제출한 단어인지 체크
  if (_stWords.some(w => w.word === word)) {
    toast('⚠️', '이미 완성한 단어예요!');
    return;
  }

  // API 유효성 검사
  toast('🔍', '단어 확인 중...');

  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`);

    if (!response.ok) {
      playSound('stWordFail');
      toast('❌', `"${word}"은(는) 유효한 단어가 아니에요!`);
      return;
    }

    // 유효한 단어! — DB에 저장
    const { data: wordData } = await sb.from('sq_thief_words').insert({
      room_id: _stRoom.id,
      player_id: _stPlayer.id,
      word: word,
      letter_count: word.length
    }).select().single();

    if (wordData) _stWords.push(wordData);

    // 사용된 블록 lock 처리
    let stolenCount = 0;
    for (const blockId of usedBlocks) {
      const block = _stBlocks.find(b => b.id === blockId);
      if (block) {
        if (block.stolen_from_id) stolenCount++;
        block.status = 'locked';
        block.used_in_word_id = wordData?.id;
        await sb.from('sq_thief_blocks').update({
          status: 'locked',
          used_in_word_id: wordData?.id
        }).eq('id', blockId);
      }
    }

    // 플레이어 통계 업데이트
    const totalLettersUsed = _stBlocks.filter(b => b.status === 'locked').length;
    const totalStolenUsed = _stBlocks.filter(b => b.status === 'locked' && b.stolen_from_id).length;
    await sb.from('sq_thief_players').update({
      words_completed: _stWords.length,
      letters_used: totalLettersUsed,
      stolen_letters_used: totalStolenUsed
    }).eq('id', _stPlayer.id);

    playSound('stWordSuccess');
    toast('🎉', `"${word}" 단어를 완성했어요!`);
    _stRenderWordTab();
  } catch (e) {
    console.error('[다람쥐도둑] 단어 제출 실패:', e);
    toast('❌', '단어 확인 중 오류가 발생했어요.');
  }
}


/* ═══════════════════════════════════════
   탭 4: 다람쥐 도둑 (출정 시스템)
   ═══════════════════════════════════════ */
let _stDispatchTargets = [null, null, null, null, null]; // 최대 5개 타겟

function _stRenderThiefTab() {
  const tc = document.getElementById('st-tab-content');
  const phase = _stGetCurrentPhase();
  const isStealingPhase = (phase === ST_PHASE.STEALING);
  const today = _stGetTodayKST();

  // 오늘 출정 횟수
  const todayDispatches = _stPlayer?.dispatch_counts?.[today] || 0;
  const maxDispatches = 2;
  const remaining = Math.max(0, maxDispatches - todayDispatches);

  _stDispatchTargets = [null, null, null, null, null];

  if (!isStealingPhase) {
    tc.innerHTML = `
      <div class="clay-card p-6 text-center" style="animation:clayPop .3s var(--ease-bounce)">
        <div class="text-4xl mb-3">🐿️</div>
        <h3 class="font-black text-gray-800 mb-2">다람쥐 도둑</h3>
        <p class="text-sm text-gray-500 mb-2">다람쥐 출정은 금~일(오후6시)에만 할 수 있어요!</p>
        <p class="text-xs text-gray-400">${_stGetPhaseLabel(phase)}</p>
      </div>`;
    return;
  }

  tc.innerHTML = `
    <div class="clay-card p-4 mb-3" style="animation:clayPop .3s var(--ease-bounce)">
      <div class="flex items-center justify-between mb-3">
        <p class="text-sm font-black text-gray-700">🐿️ 다람쥐 도둑</p>
        <span class="text-xs font-bold text-amber-600">오늘 출정: ${todayDispatches}/${maxDispatches}회</span>
      </div>

      <p class="text-xs text-gray-500 mb-3">다람쥐에게 훔쳐올 블록을 지정하세요. 최대 5개까지 우선순위를 정할 수 있어요.</p>

      <!-- 타겟 설정 슬롯 (A~E) -->
      <div class="flex gap-2 mb-3 justify-center" id="st-dispatch-targets">
        ${[0, 1, 2, 3, 4].map(i =>
          `<div class="st-dispatch-slot" id="st-target-${i}" onclick="_stSetTarget(${i})">
            <span class="text-xs text-gray-400">${i + 1}</span>
          </div>`
        ).join('')}
      </div>

      <div class="flex gap-2 justify-center">
        <button class="btn btn-gray px-4 py-2 text-sm" onclick="_stClearTargets()">초기화</button>
        ${remaining > 0
          ? `<button class="btn btn-primary px-6 py-2 text-sm font-black" onclick="_stDispatchSquirrel()">🐿️ 행동 개시!</button>`
          : '<span class="text-sm font-bold text-gray-400">오늘 출정 횟수를 모두 사용했어요!</span>'}
      </div>
    </div>

    <!-- 출정 로그 -->
    <div class="clay-card p-4" id="st-dispatch-log">
      <p class="text-sm font-black text-gray-700 mb-2">📋 출정 기록</p>
      <div id="st-dispatch-log-content">
        <p class="text-xs text-gray-400 text-center py-2">이번 라운드 출정 기록이 없어요.</p>
      </div>
    </div>`;

  _stLoadDispatchLogs();
}

function _stSetTarget(index) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const options = letters.split('').map(l =>
    `<div class="st-block st-block-common cursor-pointer" style="display:inline-flex;margin:3px" onclick="_stConfirmTarget(${index},'${l}')">
      <span class="st-block-letter">${l}</span>
    </div>`
  ).join('');

  showModal(`<div class="text-center">
    <h3 class="font-black text-gray-800 mb-3">우선순위 ${index + 1} 타겟 선택</h3>
    <div style="max-height:200px;overflow-y:auto">${options}</div>
    <button class="btn btn-gray mt-3 px-4 py-2" onclick="closeModal()">취소</button>
  </div>`);
}

function _stConfirmTarget(index, letter) {
  _stDispatchTargets[index] = letter;
  closeModal();

  const slot = document.getElementById(`st-target-${index}`);
  if (slot) {
    slot.innerHTML = `<span class="st-block-letter" style="font-size:1rem;font-weight:800">${letter}</span>`;
    slot.classList.add('st-target-filled');
  }
}

function _stClearTargets() {
  _stDispatchTargets = [null, null, null, null, null];
  for (let i = 0; i < 5; i++) {
    const slot = document.getElementById(`st-target-${i}`);
    if (slot) {
      slot.innerHTML = `<span class="text-xs text-gray-400">${i + 1}</span>`;
      slot.classList.remove('st-target-filled');
    }
  }
}

async function _stDispatchSquirrel() {
  const targets = _stDispatchTargets.filter(t => t !== null);
  if (targets.length === 0) {
    toast('⚠️', '최소 1개의 타겟을 지정해주세요!');
    return;
  }

  const today = _stGetTodayKST();
  const todayDispatches = _stPlayer?.dispatch_counts?.[today] || 0;
  if (todayDispatches >= 2) {
    toast('⚠️', '오늘 출정 횟수를 모두 사용했어요!');
    return;
  }

  // 다른 플레이어들의 인벤토리 블록 조회 (숨김 제외)
  const otherPlayerIds = _stPlayers
    .filter(p => p.id !== _stPlayer.id)
    .map(p => p.id);

  const { data: availableBlocks } = await sb.from('sq_thief_blocks')
    .select('*')
    .eq('room_id', _stRoom.id)
    .in('owner_id', otherPlayerIds)
    .eq('status', 'inventory'); // 숨김(hidden)과 잠김(locked) 제외

  const results = [];
  let stolenCount = 0;
  const maxStolen = 2;

  playSound('stDispatchStart');

  // 로그 영역에 실시간 출력
  const logContent = document.getElementById('st-dispatch-log-content');
  logContent.innerHTML = '<div id="st-dispatch-live"></div>';
  const liveLog = document.getElementById('st-dispatch-live');

  for (const targetLetter of targets) {
    if (stolenCount >= maxStolen) {
      playSound('stPocketFull');
      await _stLogLine(liveLog, `🐿️ 주머니가 무거워서 돌아가야 해요.`, 'text-amber-600');
      break;
    }

    // 해당 글자 블록 찾기
    await _stLogLine(liveLog, `[${targetLetter}] 블록을 찾는 중...`, 'text-gray-500');
    await _stDelay(800);

    const matchingBlocks = availableBlocks.filter(b => b.letter === targetLetter);

    if (matchingBlocks.length === 0) {
      playSound('stStealNotFound');
      await _stLogLine(liveLog, `[${targetLetter}] 블록을 찾을 수 없어요.`, 'text-red-400');
      results.push({ letter: targetLetter, found: false, message: `[${targetLetter}] 블록을 찾을 수 없어요.` });
      await _stDelay(600);
      continue;
    }

    playSound('stStealFound');
    await _stLogLine(liveLog, `[${targetLetter}] 블록을 찾았다!`, 'text-blue-500');
    await _stDelay(600);

    // 3회 시도 중 2회 성공 시 훔치기 성공 (각 시도 성공률 50%)
    const attempts = [];
    let successes = 0;
    for (let i = 0; i < 3; i++) {
      const success = Math.random() < 0.5;
      attempts.push(success);
      if (success) successes++;

      const icon = success ? '⭕' : '❌';
      await _stLogLine(liveLog, `  시도 ${i + 1}/3: ${icon}`, success ? 'text-green-500' : 'text-red-400');
      await _stDelay(400);
    }

    if (successes >= 2) {
      // 성공! 블록 훔쳐오기
      const targetBlock = matchingBlocks[0];
      const originalOwnerId = targetBlock.owner_id; // 원래 소유자 저장

      // DB 업데이트: 소유자 변경
      await sb.from('sq_thief_blocks').update({
        owner_id: _stPlayer.id,
        stolen_from_id: originalOwnerId,
        obtained_method: 'stolen',
        obtained_at: _stGetTimestamp()
      }).eq('id', targetBlock.id);

      // 로컬 상태 업데이트
      targetBlock.owner_id = _stPlayer.id;
      targetBlock.stolen_from_id = originalOwnerId;
      targetBlock.obtained_method = 'stolen';
      _stBlocks.push(targetBlock);

      // 가용 블록에서 제거
      const idx = availableBlocks.indexOf(targetBlock);
      if (idx > -1) availableBlocks.splice(idx, 1);

      stolenCount++;
      playSound('stStealSuccess');
      await _stLogLine(liveLog, `[${targetLetter}] 블록을 훔쳤다! 🎉`, 'text-green-600 font-black');
      results.push({ letter: targetLetter, found: true, success: true, attempts, stolen_from: originalOwnerId, message: `[${targetLetter}] 블록을 훔쳤다!` });
    } else {
      playSound('stStealFail');
      await _stLogLine(liveLog, `[${targetLetter}] 블록을 놓쳤다...`, 'text-red-500 font-bold');
      results.push({ letter: targetLetter, found: true, success: false, attempts, message: `[${targetLetter}] 블록을 놓쳤다...` });
    }

    await _stDelay(600);
  }

  // 출정 완료 메시지
  if (stolenCount === 0) {
    await _stLogLine(liveLog, `🐿️ 빈손으로 돌아왔어요...`, 'text-gray-500 font-bold');
  } else {
    await _stLogLine(liveLog, `🐿️ 블록 ${stolenCount}개를 가지고 돌아왔어요!`, 'text-green-600 font-black');
  }

  // DB에 출정 로그 저장
  await sb.from('sq_thief_dispatch_log').insert({
    room_id: _stRoom.id,
    player_id: _stPlayer.id,
    targets: targets,
    results: results,
    blocks_stolen: stolenCount
  });

  // 출정 횟수 업데이트
  const dispatchCounts = _stPlayer.dispatch_counts || {};
  dispatchCounts[today] = (dispatchCounts[today] || 0) + 1;
  _stPlayer.dispatch_counts = dispatchCounts;

  await sb.from('sq_thief_players').update({
    dispatch_counts: dispatchCounts
  }).eq('id', _stPlayer.id);

  // 블록 데이터 새로 로드
  const { data: freshBlocks } = await sb.from('sq_thief_blocks')
    .select('*').eq('room_id', _stRoom.id).eq('owner_id', _stPlayer.id);
  _stBlocks = freshBlocks || [];
}

function _stLogLine(container, text, colorClass) {
  return new Promise(resolve => {
    const line = document.createElement('p');
    line.className = `text-xs ${colorClass} mb-1`;
    line.style.animation = 'fadeIn .3s';
    line.textContent = text;
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
    resolve();
  });
}

function _stDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function _stLoadDispatchLogs() {
  try {
    const { data: logs } = await sb.from('sq_thief_dispatch_log')
      .select('*')
      .eq('room_id', _stRoom.id)
      .eq('player_id', _stPlayer.id)
      .order('dispatched_at', { ascending: false })
      .limit(5);

    if (!logs || logs.length === 0) return;

    const logContent = document.getElementById('st-dispatch-log-content');
    if (!logContent) return;

    logContent.innerHTML = logs.map(log => {
      const time = new Date(log.dispatched_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const resultSummary = log.results.map(r => {
        if (!r.found) return `<span class="text-gray-400">[${r.letter}]✖</span>`;
        return r.success
          ? `<span class="text-green-500">[${r.letter}]✔</span>`
          : `<span class="text-red-400">[${r.letter}]✖</span>`;
      }).join(' ');

      return `<div class="flex items-center justify-between text-xs py-1 border-b" style="border-color:var(--border-light)">
        <span class="text-gray-400">${time}</span>
        <span>${resultSummary}</span>
        <span class="font-bold ${log.blocks_stolen > 0 ? 'text-green-600' : 'text-gray-400'}">${log.blocks_stolen}개 획득</span>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('[다람쥐도둑] 출정 로그 로드 실패:', e);
  }
}


/* ═══════════════════════════════════════
   탭 5: 낚시 상점
   ═══════════════════════════════════════ */
function _stRenderShopTab() {
  const tc = document.getElementById('st-tab-content');
  const today = _stGetTodayKST();
  const alreadyPurchased = _stPlayer?.shop_purchases?.[today] || false;
  const acornCost = 3;

  tc.innerHTML = `
    <div class="clay-card p-4 mb-3" style="animation:clayPop .3s var(--ease-bounce)">
      <p class="text-sm font-black text-gray-700 mb-3">🏪 낚시 상점</p>

      <div class="clay-card p-4 text-center" style="background:linear-gradient(135deg,#fef3c7,#fed7aa)">
        <div class="text-3xl mb-2">📦</div>
        <h3 class="font-black text-gray-800 mb-1">스펠링 블록 구매</h3>
        <p class="text-xs text-gray-500 mb-2">원하는 스펠링 블록 1개를 구매할 수 있어요.</p>
        <p class="text-sm font-black text-amber-600 mb-3">🌰 ${acornCost} 도토리</p>
        <p class="text-xs text-gray-400 mb-3">1일 1개 구매 가능</p>

        ${alreadyPurchased
          ? '<p class="text-sm font-bold text-gray-400">오늘은 이미 구매했어요!</p>'
          : `<button class="btn btn-primary px-6 py-2 text-sm font-black" onclick="_stShowPurchasePicker()">구매하기</button>`
        }
      </div>
    </div>

    <div class="clay-card p-4">
      <p class="text-sm font-black text-gray-700 mb-2">💡 팁</p>
      <p class="text-xs text-gray-500">일요일 오후 6시까지는 서로의 단어 완성 현황을 볼 수 없어요. 투자할지 아낄지는 당신의 전략!</p>
    </div>`;
}

function _stShowPurchasePicker() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const options = letters.split('').map(l =>
    `<div class="st-block st-block-common cursor-pointer" style="display:inline-flex;margin:3px" onclick="_stPurchaseBlock('${l}')">
      <span class="st-block-letter">${l}</span>
    </div>`
  ).join('');

  showModal(`<div class="text-center">
    <div class="text-2xl mb-2">🏪</div>
    <h3 class="font-black text-gray-800 mb-3">구매할 블록을 선택하세요</h3>
    <p class="text-xs text-gray-500 mb-3">🌰 3 도토리가 차감됩니다.</p>
    <div style="max-height:200px;overflow-y:auto">${options}</div>
    <button class="btn btn-gray mt-3 px-4 py-2" onclick="closeModal()">취소</button>
  </div>`);
}

async function _stPurchaseBlock(letter) {
  closeModal();

  const acornCost = 3;
  if ((myProfile?.acorns || 0) < acornCost) {
    toast('❌', `도토리가 부족해요! (필요: 🌰${acornCost}, 보유: 🌰${myProfile?.acorns || 0})`);
    return;
  }

  try {
    // 도토리 차감
    const res = await sb.rpc('adjust_acorns', {
      p_user_id: myProfile.id,
      p_amount: -acornCost,
      p_reason: `다람쥐 도둑 낚시 상점 - [${letter}] 블록 구매`
    });

    if (!res.data?.success) {
      toast('❌', '도토리 차감 실패!');
      return;
    }
    myProfile.acorns = res.data.balance;
    updateAcornDisplay();

    // 블록 생성
    const { data: block } = await sb.from('sq_thief_blocks').insert({
      room_id: _stRoom.id,
      owner_id: _stPlayer.id,
      original_owner_id: _stPlayer.id,
      letter: letter,
      rarity: 'common',
      status: 'inventory',
      obtained_method: 'purchased',
      obtained_at: _stGetTimestamp()
    }).select().single();

    if (block) _stBlocks.push(block);

    // 구매 기록 업데이트
    const today = _stGetTodayKST();
    const shopPurchases = _stPlayer.shop_purchases || {};
    shopPurchases[today] = true;
    _stPlayer.shop_purchases = shopPurchases;

    await sb.from('sq_thief_players').update({
      shop_purchases: shopPurchases
    }).eq('id', _stPlayer.id);

    playSound('stPurchase');
    toast('🎉', `[${letter}] 블록을 구매했어요!`);
    _stRenderShopTab();
  } catch (e) {
    console.error('[다람쥐도둑] 상점 구매 실패:', e);
    toast('❌', '구매 중 오류가 발생했어요.');
  }
}


/* ═══════════════════════════════════════
   페이즈 전환 처리
   ═══════════════════════════════════════ */
async function _stCheckPhaseTransition(currentPhase) {
  if (!_stRoom) return false;
  if (_stTestMode) return false; // 테스트 모드에서는 수동 관리

  const roomStatus = _stRoom.status;
  let changed = false;

  // 월→화: recruiting → fishing (봇 채우기)
  if (roomStatus === 'recruiting' && currentPhase !== ST_PHASE.RECRUITING) {
    await _stFillBots();
    _stRoom.status = 'fishing';
    changed = true;
  }

  // 목→금: fishing → stealing
  if (roomStatus === 'fishing' && currentPhase === ST_PHASE.STEALING) {
    await sb.from('sq_thief_rooms').update({ status: 'stealing', updated_at: new Date().toISOString() }).eq('id', _stRoom.id);
    _stRoom.status = 'stealing';
    changed = true;
  }

  // 일 오후 6시: stealing → scoring
  if (roomStatus === 'stealing' && currentPhase === ST_PHASE.SCORING) {
    await sb.from('sq_thief_rooms').update({ status: 'scoring', updated_at: new Date().toISOString() }).eq('id', _stRoom.id);
    _stRoom.status = 'scoring';
    await _stCalculateRankings();
    changed = true;
  }

  return changed;
}


/* ═══════════════════════════════════════
   순위 정산 + 보상
   ═══════════════════════════════════════ */
async function _stCalculateRankings() {
  if (!_stRoom) return;

  // 전체 플레이어 데이터 로드
  const { data: players } = await sb.from('sq_thief_players')
    .select('*').eq('room_id', _stRoom.id);

  if (!players) return;

  // 봇의 단어 수도 필요 — 봇 AI가 이미 처리했다고 가정

  // 정렬: 1. 단어 수 → 2. 사용 스펠링 수 → 3. 뺏어온 블록 사용 수
  const sorted = players.sort((a, b) => {
    if (b.words_completed !== a.words_completed) return b.words_completed - a.words_completed;
    if (b.letters_used !== a.letters_used) return b.letters_used - a.letters_used;
    return b.stolen_letters_used - a.stolen_letters_used;
  });

  // 순위 매기기 (공동 순위 처리)
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr.words_completed !== prev.words_completed ||
          curr.letters_used !== prev.letters_used ||
          curr.stolen_letters_used !== prev.stolen_letters_used) {
        rank = i + 1;
      }
    }
    sorted[i]._rank = rank;
  }

  // 보상 지급
  for (const p of sorted) {
    const reward = ST_REWARDS[p._rank] || ST_REWARDS[4];

    await sb.from('sq_thief_players').update({
      final_rank: p._rank,
      reward_acorns: reward.acorns,
      reward_tickets: reward.tickets
    }).eq('id', p.id);

    // 봇이 아닌 경우에만 실제 보상 지급
    if (!p.is_bot && p.user_id && !p.rewarded) {
      if (reward.acorns > 0) {
        await sb.rpc('adjust_acorns', {
          p_user_id: p.user_id,
          p_amount: reward.acorns,
          p_reason: `다람쥐 도둑 ${p._rank}위 보상 +${reward.acorns}🌰`
        });
      }

      if (reward.tickets > 0) {
        // 뽑기 티켓 지급 (grantItem 사용)
        if (typeof grantItem === 'function') {
          await grantItem(p.user_id, '🎟️ 뽑기 티켓', reward.tickets);
        }
      }

      await sb.from('sq_thief_players').update({ rewarded: true }).eq('id', p.id);
    }
  }

  // 방 상태 완료
  await sb.from('sq_thief_rooms').update({
    status: 'finished',
    updated_at: new Date().toISOString()
  }).eq('id', _stRoom.id);

  _stRoom.status = 'finished';
  await _stLoadRoomData();

  // 스코어보드 표시
  _stRenderScoreboard(sorted);
}

function _stRenderScoreboard(sorted) {
  const c = _stGetContainer();
  playSound('stRanking');

  const rankEmojis = { 1: '🥇', 2: '🥈', 3: '🥉', 4: '4️⃣' };

  const rows = sorted.map(p => {
    const isMe = p.id === _stPlayer.id;
    const rank = p.final_rank || p._rank; // DB에서 로드한 경우 final_rank, 계산 직후는 _rank
    const reward = ST_REWARDS[rank] || ST_REWARDS[4];
    const nameDisplay = p.is_bot ? `🤖 봇` : (isMe ? `⭐ 나` : `플레이어`);

    return `<div class="clay-card p-3 mb-2 ${isMe ? 'st-my-rank' : ''}" style="animation:clayPop .4s var(--ease-bounce)">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xl">${rankEmojis[rank] || '🏅'}</span>
          <div>
            <p class="font-black text-sm">${nameDisplay}</p>
            <p class="text-xs text-gray-500">${p.words_completed}단어 · ${p.letters_used}글자 · 🐿️${p.stolen_letters_used}</p>
          </div>
        </div>
        <div class="text-right">
          <p class="font-black text-amber-600">🌰 ${reward.acorns}</p>
          ${reward.tickets > 0 ? `<p class="text-xs text-pink-500">🎟️ ×${reward.tickets}</p>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  c.innerHTML = `
    <div style="padding:4px">
      <div class="flex items-center justify-between mb-4">
        <button class="btn btn-gray px-3 py-2 text-sm" onclick="exitMinigame()">← 돌아가기</button>
        <span class="text-xs font-bold text-amber-600">🏆 최종 결과</span>
      </div>

      <div class="clay-card p-5 mb-4 text-center">
        <div class="text-4xl mb-2">🏆</div>
        <h2 class="text-lg font-black text-gray-800 mb-1">다람쥐 도둑 — 이번 주 결과</h2>
        <p class="text-xs text-gray-500">방 #${_stRoom.id.slice(0, 6)}</p>
      </div>

      ${rows}
    </div>`;
}


/* ═══════════════════════════════════════
   봇 AI (초등학교 6학년 수준)
   ═══════════════════════════════════════ */
// 봇은 서버 사이드나 스케줄러에서 돌리는 것이 이상적이지만,
// 현재 구조(Vanilla JS + Supabase)에서는 사용자가 접속했을 때
// 봇의 턴을 자동으로 처리하는 방식으로 구현

const BOT_WORD_LIST = [
  // 3글자
  'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER',
  'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'HAD', 'HAS', 'HIS', 'HOW', 'ITS',
  'LET', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'BOY', 'DID',
  'GET', 'HIM', 'MAN', 'SAY', 'SHE', 'TOO', 'USE', 'BAD', 'BIG', 'CAT',
  'DOG', 'EAT', 'FUN', 'GOT', 'HOT', 'JOB', 'KEY', 'LOT', 'MOM', 'NET',
  'PEN', 'RUN', 'SIT', 'TOP', 'WIN', 'BAG', 'BED', 'CUP', 'EGG', 'FLY',
  // 4글자
  'THAT', 'WITH', 'HAVE', 'THIS', 'WILL', 'YOUR', 'FROM', 'THEY', 'BEEN',
  'SOME', 'COME', 'MAKE', 'LIKE', 'TIME', 'JUST', 'KNOW', 'TAKE', 'COME',
  'GOOD', 'GIVE', 'MOST', 'ONLY', 'TELL', 'VERY', 'WHEN', 'WHAT', 'WORK',
  'CALL', 'BACK', 'LONG', 'MUCH', 'NEED', 'HAND', 'HELP', 'KEEP', 'PLAY',
  'TURN', 'TREE', 'FISH', 'BIRD', 'BOOK', 'CAKE', 'DOOR', 'FACE', 'GAME',
  'HOME', 'KING', 'LOVE', 'MOON', 'NAME', 'PARK', 'RAIN', 'STAR', 'STOP',
  // 5글자
  'ABOUT', 'AFTER', 'AGAIN', 'BEING', 'COULD', 'EVERY', 'FIRST', 'FOUND',
  'GREAT', 'HOUSE', 'LARGE', 'LEARN', 'NEVER', 'OTHER', 'PLACE', 'PLANT',
  'POINT', 'RIGHT', 'SMALL', 'SOUND', 'SPELL', 'STILL', 'STUDY', 'THEIR',
  'THERE', 'THINK', 'THREE', 'WATER', 'WHERE', 'WORLD', 'WRITE', 'YOUNG',
  'APPLE', 'BEACH', 'CHAIR', 'DANCE', 'EARLY', 'EARTH', 'HAPPY', 'HEART',
  // 6글자
  'BEFORE', 'CHANGE', 'FAMILY', 'FRIEND', 'GARDEN', 'LETTER', 'LITTLE',
  'MOTHER', 'NUMBER', 'PEOPLE', 'SCHOOL', 'SHOULD', 'SISTER', 'SUMMER',
  'FATHER', 'FOLLOW', 'ANIMAL', 'AROUND', 'BETTER', 'DINNER', 'FLOWER'
];

async function _stRunBotTurn(botPlayer) {
  if (!botPlayer || !botPlayer.is_bot) return;

  // 봇의 블록 조회
  const { data: botBlocks } = await sb.from('sq_thief_blocks')
    .select('*').eq('room_id', _stRoom.id).eq('owner_id', botPlayer.id).eq('status', 'inventory');

  if (!botBlocks || botBlocks.length === 0) return;

  const availableLetters = botBlocks.map(b => b.letter);

  // 단어 찾기 시도 (초등 6학년 수준: 쉬운 단어만)
  const foundWords = BOT_WORD_LIST.filter(word => {
    const needed = word.split('');
    const available = [...availableLetters];
    for (const letter of needed) {
      const idx = available.indexOf(letter);
      if (idx === -1) return false;
      available.splice(idx, 1);
    }
    return true;
  });

  if (foundWords.length === 0) return;

  // 봇 전략: 6학년 수준이니 80% 확률로 가장 긴 단어, 20% 확률로 랜덤
  let chosenWord;
  if (Math.random() < 0.8) {
    foundWords.sort((a, b) => b.length - a.length);
    chosenWord = foundWords[0];
  } else {
    chosenWord = foundWords[Math.floor(Math.random() * foundWords.length)];
  }

  // 이미 제출한 단어인지 체크
  const { data: existingWords } = await sb.from('sq_thief_words')
    .select('word').eq('room_id', _stRoom.id).eq('player_id', botPlayer.id);

  if (existingWords?.some(w => w.word === chosenWord)) return;

  // 단어 제출
  const { data: wordData } = await sb.from('sq_thief_words').insert({
    room_id: _stRoom.id,
    player_id: botPlayer.id,
    word: chosenWord,
    letter_count: chosenWord.length
  }).select().single();

  // 블록 lock 처리
  const needed = chosenWord.split('');
  let stolenUsed = 0;
  for (const letter of needed) {
    const block = botBlocks.find(b => b.letter === letter && b.status === 'inventory');
    if (block) {
      if (block.stolen_from_id) stolenUsed++;
      block.status = 'locked';
      await sb.from('sq_thief_blocks').update({
        status: 'locked',
        used_in_word_id: wordData?.id
      }).eq('id', block.id);
    }
  }

  // 통계 업데이트
  const allBotWords = [...(existingWords || []), { word: chosenWord }];
  const allLockedBlocks = botBlocks.filter(b => b.status === 'locked');
  await sb.from('sq_thief_players').update({
    words_completed: allBotWords.length,
    letters_used: allLockedBlocks.length, // 이미 위 루프에서 lock 처리됨, 중복 합산 금지
    stolen_letters_used: (botPlayer.stolen_letters_used || 0) + stolenUsed
  }).eq('id', botPlayer.id);

  console.log(`[다람쥐도둑] 봇 ${botPlayer.id.slice(0, 6)} 단어 제출: ${chosenWord}`);
}

// 봇 낚시 (화~목에 호출)
async function _stRunBotFishing(botPlayer) {
  if (!botPlayer || !botPlayer.is_bot) return;

  // 봇은 하루에 5~7개 랜덤으로 낚시
  const count = 5 + Math.floor(Math.random() * 3);

  for (let i = 0; i < count; i++) {
    const rarity = _stPickRarity();
    const letter = _stPickLetter(rarity);

    await sb.from('sq_thief_blocks').insert({
      room_id: _stRoom.id,
      owner_id: botPlayer.id,
      original_owner_id: botPlayer.id,
      letter: letter,
      rarity: rarity,
      status: 'inventory',
      obtained_method: 'fished',
      obtained_at: _stGetTimestamp()
    });

    // 낚시 로그 (봇 중복 낚시 방지 체크용)
    await sb.from('sq_thief_fishing_log').insert({
      room_id: _stRoom.id,
      player_id: botPlayer.id,
      letter: letter,
      rarity: rarity,
      fished_at: _stGetTimestamp()
    });
  }

  console.log(`[다람쥐도둑] 봇 ${botPlayer.id.slice(0, 6)} 낚시 완료: ${count}개`);
}

// 봇 도둑질 (금~일에 호출)
async function _stRunBotStealing(botPlayer) {
  if (!botPlayer || !botPlayer.is_bot) return;

  // 봇은 출정 1~2회 (6학년이니까 때때로 빼먹음)
  const dispatchCount = Math.random() < 0.7 ? 2 : 1;

  for (let d = 0; d < dispatchCount; d++) {
    // 다른 플레이어의 인벤토리 블록
    const otherIds = _stPlayers.filter(p => p.id !== botPlayer.id).map(p => p.id);
    const { data: targets } = await sb.from('sq_thief_blocks')
      .select('*')
      .eq('room_id', _stRoom.id)
      .in('owner_id', otherIds)
      .eq('status', 'inventory');

    if (!targets || targets.length === 0) continue;

    // 봇 전략: 모음을 우선 타겟 (초등학생이니까 단순한 전략)
    const vowels = 'AEIOU';
    const targetLetters = [];

    // 모음 우선
    const vowelBlocks = targets.filter(t => vowels.includes(t.letter));
    const consonantBlocks = targets.filter(t => !vowels.includes(t.letter));

    const shuffled = [...vowelBlocks.sort(() => Math.random() - 0.5), ...consonantBlocks.sort(() => Math.random() - 0.5)];
    const uniqueLetters = [];
    for (const b of shuffled) {
      if (!uniqueLetters.includes(b.letter)) {
        uniqueLetters.push(b.letter);
        if (uniqueLetters.length >= 4) break; // 봇은 3~4개 타겟 설정
      }
    }

    let stolenCount = 0;
    const results = [];

    for (const letter of uniqueLetters) {
      if (stolenCount >= 2) break;

      const matching = targets.filter(t => t.letter === letter && t.status === 'inventory');
      if (matching.length === 0) {
        results.push({ letter, found: false });
        continue;
      }

      // 3회 시도 중 2회 성공
      let successes = 0;
      const attempts = [];
      for (let i = 0; i < 3; i++) {
        const success = Math.random() < 0.5;
        attempts.push(success);
        if (success) successes++;
      }

      if (successes >= 2) {
        const target = matching[0];
        await sb.from('sq_thief_blocks').update({
          owner_id: botPlayer.id,
          stolen_from_id: target.owner_id,
          obtained_method: 'stolen',
          obtained_at: _stGetTimestamp()
        }).eq('id', target.id);

        stolenCount++;
        results.push({ letter, found: true, success: true, attempts });
      } else {
        results.push({ letter, found: true, success: false, attempts });
      }
    }

    await sb.from('sq_thief_dispatch_log').insert({
      room_id: _stRoom.id,
      player_id: botPlayer.id,
      targets: uniqueLetters,
      results: results,
      blocks_stolen: stolenCount
    });

    console.log(`[다람쥐도둑] 봇 ${botPlayer.id.slice(0, 6)} 출정 ${d + 1}: ${stolenCount}개 훔침`);
  }
}

// 봇 턴 총괄 실행 (사용자 접속 시 트리거)
async function _stProcessBotTurns() {
  if (!_stRoom || !_stPlayers) return;

  const phase = _stGetCurrentPhase();
  const bots = _stPlayers.filter(p => p.is_bot);

  for (const bot of bots) {
    if (phase === ST_PHASE.FISHING) {
      // 오늘 봇이 이미 낚시했는지 체크
      const today = _stGetTodayKST();
      const { data: todayFish } = await sb.from('sq_thief_fishing_log')
        .select('id').eq('player_id', bot.id)
        .gte('fished_at', today + 'T00:00:00+09:00')
        .lte('fished_at', today + 'T23:59:59+09:00')
        .limit(1);

      if (!todayFish || todayFish.length === 0) {
        await _stRunBotFishing(bot);
      }

      // 단어 만들기 시도
      await _stRunBotTurn(bot);
    }

    if (phase === ST_PHASE.STEALING) {
      const today = _stGetTodayKST();
      const todayDispatches = bot.dispatch_counts?.[today] || 0;
      if (todayDispatches < 2) {
        await _stRunBotStealing(bot);

        // 출정 횟수 업데이트
        const counts = bot.dispatch_counts || {};
        counts[today] = (counts[today] || 0) + 1;
        await sb.from('sq_thief_players').update({ dispatch_counts: counts }).eq('id', bot.id);
      }

      // 도둑질 후 단어 만들기도 시도
      await _stRunBotTurn(bot);
    }
  }
}


/* ═══════════════════════════════════════
   스코어보드 탭 (일 오후 6시 이후)
   ═══════════════════════════════════════ */
async function _stRenderScoringTab() {
  const phase = _stGetCurrentPhase();

  if (phase === ST_PHASE.SCORING || _stRoom?.status === 'finished') {
    const { data: players } = await sb.from('sq_thief_players')
      .select('*').eq('room_id', _stRoom.id).order('final_rank', { ascending: true });

    if (players && players[0]?.final_rank) {
      _stRenderScoreboard(players);
    } else {
      // 아직 정산이 안 됐으면 정산 실행
      await _stCalculateRankings();
    }
  }
}


/* ═══════════════════════════════════════
   🧪 관리자 테스트 모드
   ═══════════════════════════════════════ */

// 관리자 패널에서 호출: 테스트 게임 즉시 시작
async function _stAdminTestStart() {
  try {
    _stTestMode = true;
    _stTestDay = 0;
    _stTestPhase = ST_PHASE.RECRUITING;

    const weekStart = _stGetWeekMonday();

    // 기존 테스트 방이 있으면 삭제 (week_start가 같고 status가 finished가 아닌 것)
    // → 안전을 위해 삭제하지 않고 새로 생성만

    // 방 생성
    const { data: room, error } = await sb.from('sq_thief_rooms')
      .insert({ week_start: weekStart, status: 'recruiting' })
      .select().single();
    if (error) throw error;

    // 관리자 참가
    const { data: player } = await sb.from('sq_thief_players')
      .insert({ room_id: room.id, user_id: myProfile.id, is_bot: false })
      .select().single();

    // 봇 3명 즉시 참가
    for (let i = 0; i < 3; i++) {
      await sb.from('sq_thief_players').insert({
        room_id: room.id,
        user_id: null,
        is_bot: true,
        bot_level: 'grade6'
      });
    }

    // 방 상태를 fishing으로 (모집 즉시 완료)
    await sb.from('sq_thief_rooms').update({
      status: 'fishing',
      updated_at: new Date().toISOString()
    }).eq('id', room.id);
    room.status = 'fishing';

    _stRoom = room;
    _stPlayer = player;
    await _stLoadRoomData();

    // 테스트는 화요일(낚시)부터 시작
    _stTestDay = 1;
    _stTestPhase = ST_PHASE.FISHING;

    toast('🧪', '테스트 모드 시작! 현재: 화요일 (낚시)');

    // 미니게임 화면으로 전환
    const hub = document.getElementById('minigame-hub');
    const play = document.getElementById('minigame-play');
    if (hub) hub.classList.add('hidden');
    if (play) play.classList.remove('hidden');

    _stRenderMain();
    _stRenderTestBar();

    // 봇 낚시 실행
    await _stProcessBotTurns();
  } catch (e) {
    console.error('[다람쥐도둑] 테스트 시작 실패:', e);
    toast('❌', '테스트 시작 실패: ' + e.message);
    _stTestMode = false;
  }
}

// 테스트 바 UI (게임 화면 상단에 고정)
function _stRenderTestBar() {
  if (!_stTestMode) return;

  // 기존 테스트 바 제거
  const old = document.getElementById('st-test-bar');
  if (old) old.remove();

  const phase = _stGetCurrentPhase();
  const dayLabel = _stTestDayLabels[_stTestDay] || '?';

  const isScoring = _stTestDay === 7; // 일요일 오후 6시 이후

  const bar = document.createElement('div');
  bar.id = 'st-test-bar';
  bar.className = 'clay-card';
  bar.style.cssText = 'padding:10px 16px;margin-bottom:12px;background:linear-gradient(135deg,#fef3c7,#fde68a);border:2px solid #f59e0b;';
  bar.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <span class="text-xs font-black text-amber-700">🧪 테스트 모드</span>
        <span class="text-xs font-bold text-amber-600 ml-2">📅 ${dayLabel}</span>
        <span class="text-xs text-amber-500 ml-1">(${_stGetPhaseLabel(phase)})</span>
      </div>
      <div class="flex gap-2">
        ${!isScoring
          ? `<button class="btn btn-primary px-3 py-1 text-xs" onclick="_stTestNextDay()">다음 날 →</button>`
          : `<button class="btn btn-primary px-3 py-1 text-xs" onclick="_stTestScoring()">🏆 정산하기</button>`
        }
        <button class="btn btn-red px-3 py-1 text-xs" onclick="_stTestEnd()">테스트 종료</button>
      </div>
    </div>`;

  const container = _stGetContainer();
  const wrapper = container?.querySelector('div');
  if (wrapper) {
    wrapper.insertBefore(bar, wrapper.firstChild);
  }
}

// 다음 날로 이동
async function _stTestNextDay() {
  _stTestDay++;

  if (_stTestDay > 7) {
    // 일주일 끝 → 정산
    await _stTestScoring();
    return;
  }

  // 페이즈 결정
  if (_stTestDay <= 6) {
    _stTestPhase = _stTestPhaseMap[_stTestDay];
  } else {
    // 7 = 일요일 오후 6시 이후
    _stTestPhase = ST_PHASE.SCORING;
  }

  // 방 상태 DB 동기화
  const statusMap = {
    [ST_PHASE.RECRUITING]: 'recruiting',
    [ST_PHASE.FISHING]: 'fishing',
    [ST_PHASE.STEALING]: 'stealing',
    [ST_PHASE.SCORING]: 'scoring'
  };
  const newStatus = statusMap[_stTestPhase] || _stRoom.status;
  if (newStatus !== _stRoom.status) {
    await sb.from('sq_thief_rooms').update({
      status: newStatus,
      updated_at: new Date().toISOString()
    }).eq('id', _stRoom.id);
    _stRoom.status = newStatus;
  }

  // 봇 턴 처리
  await _stProcessBotTurns();

  // 블록 데이터 새로 로드
  await _stLoadRoomData();

  const dayLabel = _stTestDay <= 6 ? _stTestDayLabels[_stTestDay] : '일(정산)';
  toast('📅', `${dayLabel}(으)로 이동했어요!`);

  _stRenderMain();
  _stRenderTestBar();
}

// 정산 실행
async function _stTestScoring() {
  _stTestPhase = ST_PHASE.SCORING;
  _stTestDay = 7;

  await sb.from('sq_thief_rooms').update({
    status: 'scoring',
    updated_at: new Date().toISOString()
  }).eq('id', _stRoom.id);
  _stRoom.status = 'scoring';

  toast('🏆', '정산을 시작합니다...');

  await _stCalculateRankings();
}

// 테스트 종료
function _stTestEnd() {
  _stTestMode = false;
  _stTestPhase = null;
  _stTestDay = 0;

  _stRoom = null;
  _stPlayer = null;
  _stPlayers = [];
  _stBlocks = [];
  _stWords = [];

  toast('🧪', '테스트 모드를 종료했어요.');
  exitMinigame();
}
