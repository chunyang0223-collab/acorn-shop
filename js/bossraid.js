/* ================================================================
   🐉 협동 보스레이드 (bossraid.js)
   ================================================================
   - 2인 협동 보스전
   - 각자 다람쥐 2마리 선택 → 4마리 한 팀
   - Supabase Realtime으로 동기화
   - 전투는 서버(방장)가 시뮬레이션 → battle_log를 DB에 저장
   - 양쪽 클라이언트가 같은 battle_log를 재생
   ================================================================ */

// ── 설정 (DB에서 덮어씀) ──
var _brConfig = {
  enabled: true,
  weekly_limit: 3,
  sp_min: 3,
  sp_max: 10,
  bosses: [
    { name: '용암 드래곤', emoji: '🐲', lvMin: 12, lvMax: 18 },
    { name: '얼음 골렘', emoji: '🧊', lvMin: 10, lvMax: 15 },
    { name: '어둠의 군주', emoji: '👹', lvMin: 15, lvMax: 20 },
  ],
  boss_stat_mult: 2.5,
  lv_base_hp: 30, lv_base_atk: 8, lv_base_def: 3,
  lv_grow_hp: 12, lv_grow_atk: 2, lv_grow_def: 1.5,
  atk_multiplier: 1.0,     // 평타 데미지 배율 (1.0 = 기본)
  skill_multiplier: 1.65,
  skill_swing: 5,
  atk_swing: 3,
  mon_swing: 3,
  mon_def_effect: 38,
  sq_def_effect: 48,
  reward_weights: { C: 20, B: 45, A: 35 },
  reward_C: { acorns: [8, 15], itemChance: 0.3, items: ['🍄 버섯', '🌿 풀잎'] },
  reward_B: { acorns: [15, 30], itemChance: 0.6, items: ['🍎 사과', '🔮 마석', '🪵 나무'] },
  reward_A: { acorns: [30, 60], itemChance: 0.9, items: ['💎 보석', '⚗️ 비약', '🗡️ 단검'] },
  // 필살기
  ultimate_uses: 1,       // 다람쥐당 필살기 사용 횟수
  ultimate_mult: 2.0,     // 스킬 데미지 대비 배율
  // 패배 보상
  defeat_reward_enabled: false,
  defeat_acorns: [2, 5],
  defeat_itemChance: 0.1,
  defeat_items: [],
};

// ── 봇 프리셋 (관리자 테스트용) ──
var _brBotPresets = [
  {
    label: '1단계',
    desc: '일반~레어',
    emoji: '🤖',
    squirrels: [
      { name: '봇다람A', sprite: 'sq_acorn', stats: { hp: 55, atk: 9, def: 4 } },
      { name: '봇다람B', sprite: 'sq_acorn', stats: { hp: 65, atk: 11, def: 5 } },
    ]
  },
  {
    label: '2단계',
    desc: '레어~유일',
    emoji: '🤖',
    squirrels: [
      { name: '봇다람A', sprite: 'sq_acorn', stats: { hp: 85, atk: 14, def: 8 } },
      { name: '봇다람B', sprite: 'sq_acorn', stats: { hp: 95, atk: 16, def: 10 } },
    ]
  },
  {
    label: '3단계',
    desc: '희귀~레전드',
    emoji: '🤖',
    squirrels: [
      { name: '봇다람A', sprite: 'sq_acorn', stats: { hp: 105, atk: 18, def: 12 } },
      { name: '봇다람B', sprite: 'sq_acorn', stats: { hp: 115, atk: 19, def: 13 } },
    ]
  }
];

// ── 상태 ──
var _brState = null;   // 현재 레이드 상태
var _brSub = null;     // Realtime 구독
var _brReplayIdx = 0;  // 재생 인덱스
var _brReplayTimer = null;
var _brWeeklyDone = false; // 주간 횟수 중복 차감 방지 플래그
var _brLobbySeq = 0;      // 로비 렌더 race-condition 방지용 시퀀스
var _brResultRendered = false; // 결과 화면 중복 렌더 방지 플래그

// ── 설정 로드 ──
async function _brLoadConfig() {
  const { data } = await sb.from('app_settings')
    .select('value').eq('key', 'boss_raid_settings').maybeSingle();
  if (data?.value) Object.assign(_brConfig, data.value);
}

// ── 주간 참여 횟수 확인 ──
function _brGetWeekStart() {
  const d = _kstNow();                   // KST 기준
  const day = d.getUTCDay() || 7;        // 일요일(0) → 7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  return monday.toISOString().slice(0, 10); // KST 월요일 자정 기준
}

async function _brGetWeeklyCount() {
  const weekStart = _brGetWeekStart();
  const { data } = await sb.from('boss_raid_weekly')
    .select('raid_count')
    .eq('user_id', myProfile.id)
    .eq('week_start', weekStart)
    .limit(1);
  return (data && data.length > 0) ? (data[0].raid_count || 0) : 0;
}

async function _brIncrementWeekly() {
  const weekStart = _brGetWeekStart();
  const { data: rows } = await sb.from('boss_raid_weekly')
    .select('id, raid_count')
    .eq('user_id', myProfile.id)
    .eq('week_start', weekStart)
    .limit(1);
  const existing = (rows && rows.length > 0) ? rows[0] : null;
  if (existing) {
    await sb.from('boss_raid_weekly').update({ raid_count: existing.raid_count + 1 }).eq('id', existing.id);
  } else {
    await sb.from('boss_raid_weekly').insert({ user_id: myProfile.id, week_start: weekStart, raid_count: 1 });
  }
}

// ══════════════════════════════════════════════
//  메인 탭 렌더
// ══════════════════════════════════════════════
async function renderBossRaid() {
  const container = document.getElementById('utab-bossraid');
  if (!container) return;

  try {
  await _brLoadConfig();
  // 다람쥐 등급 계산에 필요한 설정 로드
  if (typeof sqLoadSettings === 'function') await sqLoadSettings();

  if (!_brConfig.enabled) {
    container.innerHTML = `
      <div class="clay-card p-6 text-center">
        <div class="text-5xl mb-3">🐉</div>
        <h2 class="text-xl font-black text-gray-800 mb-2">보스레이드</h2>
        <p class="text-sm text-gray-400 font-semibold">현재 보스레이드가 비활성화되어 있어요.</p>
      </div>`;
    return;
  }

  const weeklyCount = await _brGetWeeklyCount();
  const remaining = Math.max(0, _brConfig.weekly_limit - weeklyCount);

  // 진행 중인 레이드 확인
  const { data: activeRaids, error: activeErr } = await sb.from('boss_raids')
    .select('*')
    .or(`host_id.eq.${myProfile.id},guest_id.eq.${myProfile.id}`)
    .in('status', ['waiting', 'selecting', 'ready', 'battling'])
    .order('created_at', { ascending: false })
    .limit(1);
  const activeRaid = activeRaids && activeRaids.length > 0 ? activeRaids[0] : null;

  // 테이블이 아직 없으면 안내 표시
  if (activeErr && activeErr.code === '42P01') {
    container.innerHTML = `
      <div class="clay-card p-6 text-center">
        <div class="text-5xl mb-3">🐉</div>
        <h2 class="text-xl font-black text-gray-800 mb-2">보스레이드</h2>
        <p class="text-sm text-gray-400 font-semibold">DB 테이블 설정이 필요해요.<br>관리자에게 문의하세요.</p>
      </div>`;
    return;
  }

  if (activeRaid) {
    // 멈춘 레이드 자동 정리 (10분 이상 경과)
    const raidAge = Date.now() - new Date(activeRaid.created_at).getTime();
    const STALE_MS = 10 * 60 * 1000; // 10분
    if (raidAge > STALE_MS && ['waiting', 'selecting', 'ready', 'battling'].includes(activeRaid.status)) {
      await sb.from('boss_raids').update({ status: 'cancelled' }).eq('id', activeRaid.id);
      toast('⚠️', '오래된 레이드가 자동 정리되었어요');
      renderBossRaid();
      return;
    }

    // 이미 보상 수령한 레이드면 스킵 (재진입 방지)
    const _isHost = activeRaid.host_id === myProfile.id;
    const _myRewarded = _isHost ? activeRaid.host_rewarded : activeRaid.guest_rewarded;
    if (_myRewarded) {
      // 보상 수령 완료된 레이드 → 메인 화면으로 (재진입하지 않음)
    } else {
      _brState = activeRaid;
      _brSubscribe(activeRaid.id);
      _brOnStateChange(activeRaid);
      return;
    }
  }

  // 대기 중인 방 목록
  const { data: openRooms } = await sb.from('boss_raids')
    .select('id, host_id, created_at, users!boss_raids_host_id_fkey(display_name, avatar_emoji, profile_icon)')
    .eq('status', 'waiting')
    .is('guest_id', null)
    .neq('host_id', myProfile.id)
    .order('created_at', { ascending: false })
    .limit(10);

  container.innerHTML = `
    <div class="clay-card p-6 text-center mb-4">
      <div class="text-5xl mb-3">🐉</div>
      <h2 class="text-xl font-black text-gray-800 mb-1">협동 보스레이드</h2>
      <p class="text-sm text-gray-400 font-semibold mb-1">친구와 함께 강력한 보스에 도전하세요!</p>
      <p class="text-xs font-bold mb-4" style="color:${remaining > 0 ? '#22c55e' : '#ef4444'}">
        이번 주 남은 횟수: <span class="text-base">${remaining}</span> / ${_brConfig.weekly_limit}
      </p>
      <button class="btn btn-primary px-8 py-3 text-base" onclick="_brCreateRoom()" ${remaining <= 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}>
        🐉 방 만들기
      </button>
      ${myProfile?.is_admin ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px dashed rgba(128,128,128,0.2)">
          <p style="font-size:11px;font-weight:700;color:#9ca3af;margin-bottom:8px">🤖 관리자 테스트 (봇과 함께)</p>
          <div style="display:flex;gap:6px;justify-content:center">
            ${_brBotPresets.map((bp, i) => `
              <button onclick="_brCreateBotRoom(${i})" style="padding:6px 12px;border-radius:8px;border:none;font-size:11px;font-weight:700;cursor:pointer;background:rgba(139,92,246,0.1);color:#8b5cf6" ${remaining <= 0 ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>
                ${bp.emoji} ${bp.label}<br><span style="font-size:9px;color:#9ca3af">${bp.desc}</span>
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>

    ${openRooms && openRooms.length > 0 ? `
      <div class="clay-card p-5">
        <p class="text-sm font-black text-gray-700 mb-3">🏠 참가 가능한 방</p>
        <div class="space-y-2" id="brRoomList">
          ${openRooms.map(r => {
            const host = r.users || {};
            return `
              <div class="br-room-row" onclick="_brJoinRoom('${r.id}')">
                ${_avatarHtml(host, '2rem')}
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-black text-gray-800">${_escHtml(host.display_name || '???')}</p>
                  <p class="text-xs text-gray-400">대기 중...</p>
                </div>
                <span class="text-xs font-bold px-3 py-1 rounded-lg" style="background:rgba(34,197,94,0.1);color:#22c55e">참가</span>
              </div>`;
          }).join('')}
        </div>
      </div>` : `
      <div class="clay-card p-5 text-center">
        <p class="text-sm text-gray-400 font-semibold">현재 대기 중인 방이 없어요</p>
      </div>`}
  `;

  } catch (e) {
    console.error('renderBossRaid error:', e);
    container.innerHTML = `
      <div class="clay-card p-6 text-center">
        <div class="text-5xl mb-3">🐉</div>
        <h2 class="text-xl font-black text-gray-800 mb-2">보스레이드</h2>
        <p class="text-sm text-gray-400 font-semibold">불러오는 중 오류가 발생했어요.<br>DB 테이블 설정이 필요할 수 있어요.</p>
      </div>`;
  }
}

// ══════════════════════════════════════════════
//  방 생성 / 참가
// ══════════════════════════════════════════════
async function _brCreateRoom() {
  const weeklyCount = await _brGetWeeklyCount();
  if (weeklyCount >= _brConfig.weekly_limit) {
    toast('❌', '이번 주 레이드 횟수를 모두 사용했어요');
    return;
  }

  toast('⏳', '방을 만드는 중...');
  const { data, error } = await sb.from('boss_raids').insert({
    host_id: myProfile.id,
    status: 'waiting'
  }).select().single();

  if (error) { toast('❌', '방 생성 실패'); return; }

  _brState = data;
  _brSubscribe(data.id);
  _brRenderLobby(document.getElementById('utab-bossraid'), data);
  toast('✅', '방이 생성되었어요! 상대를 기다리는 중...');
}

async function _brJoinRoom(raidId) {
  const weeklyCount = await _brGetWeeklyCount();
  if (weeklyCount >= _brConfig.weekly_limit) {
    toast('❌', '이번 주 레이드 횟수를 모두 사용했어요');
    return;
  }

  toast('⏳', '참가하는 중...');
  const { data, error } = await sb.from('boss_raids')
    .update({ guest_id: myProfile.id, status: 'selecting' })
    .eq('id', raidId)
    .eq('status', 'waiting')
    .is('guest_id', null)
    .select()
    .single();

  if (error) { toast('❌', '참가 실패 (이미 가득 찼을 수 있어요)'); return; }

  _brState = data;
  _brSubscribe(data.id);
  _brRenderLobby(document.getElementById('utab-bossraid'), data);
  toast('✅', '참가했어요!');
}

// ── 봇과 함께 방 생성 (관리자 전용) ──
var _brBotSquirrels = null; // 현재 봇 다람쥐 정보 (전투 시뮬에서 사용)

async function _brCreateBotRoom(presetIdx) {
  if (!myProfile?.is_admin) return;
  const weeklyCount = await _brGetWeeklyCount();
  if (weeklyCount >= _brConfig.weekly_limit) {
    toast('❌', '이번 주 레이드 횟수를 모두 사용했어요');
    return;
  }

  const preset = _brBotPresets[presetIdx];
  if (!preset) return;

  toast('⏳', '봇과 함께 방을 만드는 중...');

  // 봇 다람쥐 가짜 UUID 생성 (DB UUID[] 컬럼 호환)
  const _ts = Date.now().toString(16).padStart(12, '0');
  const botSq1Id = 'b0700001-0000-4000-8000-' + _ts;
  const botSq2Id = 'b0700002-0000-4000-8000-' + _ts;

  // 방 생성: guest=자기자신(RLS용), 봇 다람쥐 ID를 guest측에 세팅
  const { data, error } = await sb.from('boss_raids').insert({
    host_id: myProfile.id,
    guest_id: myProfile.id,         // 자기 자신을 guest로 (RLS 통과용)
    guest_squirrel_ids: [botSq1Id, botSq2Id],
    guest_ready: true,              // 봇은 즉시 ready
    status: 'selecting'
  }).select().single();

  if (error) { toast('❌', '방 생성 실패: ' + (error.message || '')); return; }

  // 봇 다람쥐 정보를 메모리에 저장 (전투 시뮬레이션에서 사용)
  _brBotSquirrels = {};
  preset.squirrels.forEach((sq, i) => {
    const id = i === 0 ? botSq1Id : botSq2Id;
    _brBotSquirrels[id] = {
      id: id,
      name: sq.name,
      sprite: sq.sprite,
      stats: { ...sq.stats },
      status: 'explorer'
    };
  });

  _brState = data;
  _brSubscribe(data.id);
  _brRenderLobby(document.getElementById('utab-bossraid'), data);
  toast('🤖', preset.label + ' 봇이 참가했어요! 다람쥐를 선택하세요.');
}

// ══════════════════════════════════════════════
//  폴링 기반 동기화 (커스텀 클라이언트가 Realtime 미지원)
// ══════════════════════════════════════════════
var _brPollInterval = null;
var _brPollRaidId = null;

function _brSubscribe(raidId) {
  _brUnsubscribe();
  _brPollRaidId = raidId;
  _brPollInterval = setInterval(() => _brPoll(raidId), 2000); // 2초 폴링
}

function _brUnsubscribe() {
  if (_brPollInterval) {
    clearInterval(_brPollInterval);
    _brPollInterval = null;
  }
  _brPollRaidId = null;
  if (_brReplayTimer) {
    clearInterval(_brReplayTimer);
    _brReplayTimer = null;
  }
}

async function _brPoll(raidId) {
  const { data } = await sb.from('boss_raids').select('*').eq('id', raidId).maybeSingle();
  if (!data) return;

  // 변경 감지 (status, battle_log, guest_id, ready 상태)
  const prev = _brState;
  const changed = !prev
    || data.status !== prev.status
    || (data.battle_log?.length || 0) !== (prev.battle_log?.length || 0)
    || data.guest_id !== prev.guest_id
    || data.host_ready !== prev.host_ready
    || data.guest_ready !== prev.guest_ready;

  _brState = data;

  if (changed) {
    _brOnStateChange(data);
  }

  // 끝난 상태면 폴링 중지
  if (data.status === 'finished' || data.status === 'cancelled') {
    _brUnsubscribe();
  }
}

function _brOnStateChange(raid) {
  const container = document.getElementById('utab-bossraid');
  if (!container) return;

  switch (raid.status) {
    case 'waiting':
    case 'selecting':
      _brRenderLobby(container, raid);
      break;
    case 'ready':
      // 방장이 전투 시뮬레이션 시작
      if (raid.host_id === myProfile.id && !raid.battle_log?.length) {
        _brSimulateBattle(raid);
      }
      _brRenderLobby(container, raid);
      break;
    case 'battling':
      // 이미 리플레이 중이면 재렌더 방지
      if (_brReplayTimer) break;
      if (typeof _btlSound === 'function') _btlSound('battleStart');
      _brRenderBattle(container, raid);
      break;
    case 'finished':
      _brRenderResult(container, raid);
      break;
    case 'cancelled':
      _brUnsubscribe();
      _brState = null;
      toast('⚠️', '레이드가 취소되었어요');
      renderBossRaid();
      break;
  }
}

// ══════════════════════════════════════════════
//  로비 UI
// ══════════════════════════════════════════════
async function _brRenderLobby(container, raid) {
  const seq = ++_brLobbySeq; // race-condition 방지
  const isHost = raid.host_id === myProfile.id;
  const isGuest = raid.guest_id === myProfile.id;

  // 상대방 정보 로드 (봇 모드 대응)
  const isBotMode = !!_brBotSquirrels;
  let otherUser = null;
  if (isBotMode) {
    otherUser = { display_name: '🤖 테스트 봇', avatar_emoji: '🤖' };
  } else {
    const otherId = isHost ? raid.guest_id : raid.host_id;
    if (otherId) {
      const { data } = await sb.from('users').select('display_name, avatar_emoji, profile_icon').eq('id', otherId).single();
      otherUser = data;
    }
  }

  if (seq !== _brLobbySeq) return;

  // 내 다람쥐 목록 로드 (관리자는 전체, 일반유저는 탐험형만)
  let _brSqQuery = sb.from('squirrels').select('*').eq('user_id', myProfile.id);
  if (!myProfile?.is_admin) {
    _brSqQuery = _brSqQuery.eq('status', 'explorer');
  } else {
    _brSqQuery = _brSqQuery.in('status', ['explorer', 'pet', 'farmer']);
  }
  const { data: rawSquirrels } = await _brSqQuery;

  if (seq !== _brLobbySeq) return;

  // 등급 높은 순 정렬
  const _brGradeRank = { legend: 5, unique: 4, epic: 3, rare: 2, normal: 1 };
  const mySquirrels = (rawSquirrels || []).sort((a, b) => {
    const ga = _brGradeRank[_sqCalcGrade(a)] || 0;
    const gb = _brGradeRank[_sqCalcGrade(b)] || 0;
    return gb - ga;
  });

  const mySelectedIds = isHost ? (raid.host_squirrel_ids || []) : (raid.guest_squirrel_ids || []);
  const myReady = isHost ? raid.host_ready : raid.guest_ready;
  const otherReady = isHost ? raid.guest_ready : raid.host_ready;

  let html = `
    <div class="clay-card p-5 mb-4">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-black text-gray-800">🐉 보스레이드 로비</h2>
        ${raid.status === 'waiting' || (raid.status === 'selecting' && !myReady) ? `
          <button class="text-xs font-bold px-3 py-1 rounded-lg" style="background:rgba(239,68,68,0.1);color:#ef4444" onclick="_brLeaveRoom()">나가기</button>
        ` : ''}
      </div>

      <!-- 참가자 -->
      <div class="br-players-grid">
        <!-- 나 -->
        <div class="br-player-card ${myReady ? 'br-ready' : ''}">
          <div class="mb-1">${_avatarHtml(myProfile, '2.5rem')}</div>
          <p class="text-sm font-black">${myProfile.display_name}</p>
          <p class="text-xs font-bold ${myReady ? 'text-green-500' : 'text-gray-400'}">${myReady ? '✅ 준비완료' : '⏳ 준비 중'}</p>
        </div>

        <div class="br-vs-badge">VS</div>

        <!-- 상대 -->
        <div class="br-player-card ${otherReady ? 'br-ready' : ''}">
          ${otherUser ? `
            <div class="mb-1">${_avatarHtml(otherUser, '2.5rem')}</div>
            <p class="text-sm font-black">${otherUser.display_name}</p>
            <p class="text-xs font-bold ${otherReady ? 'text-green-500' : 'text-gray-400'}">${otherReady ? '✅ 준비완료' : '⏳ 준비 중'}</p>
          ` : `
            <div class="text-3xl mb-1 opacity-30">❓</div>
            <p class="text-sm font-bold text-gray-400">대기 중...</p>
          `}
        </div>
      </div>
    </div>`;

  // 다람쥐 선택 (호스트는 대기 중에도 선택 가능)
  if (['waiting', 'selecting'].includes(raid.status) && !myReady) {
    html += `
      <div class="clay-card p-5 mb-4">
        <p class="text-sm font-black text-gray-700 mb-3">🐿️ 다람쥐 2마리를 선택하세요</p>
        <div class="grid grid-cols-3 gap-2" id="brSquirrelGrid">
          ${(mySquirrels || []).map(sq => {
            try {
              const selected = mySelectedIds.includes(sq.id);
              const grade = (typeof _sqCalcGrade === 'function' && sq.status !== 'baby') ? _sqCalcGrade(sq) : 'normal';
              const gs = (typeof _sqGradeStyle === 'function') ? _sqGradeStyle(grade) : { border:'border:3px solid #788796', shadow:'0 0 4px rgba(120,135,150,.3)', color:'#9ca3af' };
              return '<div class="br-sq-pick ' + (selected ? 'br-sq-selected' : '') + '" onclick="_brToggleSquirrel(\'' + sq.id + '\')" style="' + gs.border + ';box-shadow:' + gs.shadow + '">' +
                '<img src="images/squirrels/' + (sq.sprite || 'sq_acorn') + '.png" class="br-sq-img" onerror="this.outerHTML=\'<div class=\\\'text-2xl\\\'>🐿️</div>\'">' +
                '<p class="text-xs font-black mt-1" style="color:' + gs.color + '">' + _escHtml(sq.name) + '</p>' +
                '<p class="text-xs text-gray-400">HP ' + (sq.stats?.hp || 0) + ' ATK ' + (sq.stats?.atk || 0) + '</p>' +
              '</div>';
            } catch(e) {
              console.error('br-sq-pick render error:', e);
              return '';
            }
          }).join('')}
        </div>
        ${mySelectedIds.length === 2 ? `
          <button class="btn btn-primary w-full mt-4 py-3" onclick="_brReady()">✅ 준비 완료</button>
        ` : `
          <p class="text-xs text-center text-gray-400 mt-3 font-bold">다람쥐를 2마리 선택해주세요 (${mySelectedIds.length}/2)</p>
        `}
      </div>`;
  }

  // 내가 준비완료인데 상대가 아직인 경우
  if (myReady && !otherReady && ['waiting', 'selecting'].includes(raid.status)) {
    html += `
      <div class="clay-card p-6 text-center">
        <div class="text-4xl mb-3" style="animation:pulse 1.5s ease-in-out infinite">⏳</div>
        <p class="text-sm font-black text-green-500 mb-1">준비완료!</p>
        <p class="text-xs text-gray-400 font-bold">상대방이 준비할 때까지 기다리는 중...</p>
      </div>`;
  }

  // 둘 다 Ready인 경우
  if (raid.host_ready && raid.guest_ready) {
    html += `
      <div class="clay-card p-6 text-center">
        <div class="spinner-sm mb-2"></div>
        <p class="text-sm font-bold text-amber-500">전투를 준비하는 중...</p>
      </div>`;
  }

  container.innerHTML = html;
}

// ── 다람쥐 선택 토글 ──
async function _brToggleSquirrel(sqId) {
  if (!_brState) return;
  const isHost = _brState.host_id === myProfile.id;
  const field = isHost ? 'host_squirrel_ids' : 'guest_squirrel_ids';
  let ids = isHost ? [...(_brState.host_squirrel_ids || [])] : [...(_brState.guest_squirrel_ids || [])];

  const idx = ids.indexOf(sqId);
  if (idx >= 0) {
    ids.splice(idx, 1);
  } else {
    if (ids.length >= 2) {
      toast('⚠️', '최대 2마리까지 선택할 수 있어요');
      return;
    }
    ids.push(sqId);
    if (typeof playSound === 'function') playSound('click');
  }

  await sb.from('boss_raids').update({ [field]: ids }).eq('id', _brState.id);
  _brState[field] = ids;
  _brRenderLobby(document.getElementById('utab-bossraid'), _brState);
}

// ── Ready 버튼 ──
async function _brReady() {
  if (!_brState) return;
  const isHost = _brState.host_id === myProfile.id;
  const field = isHost ? 'host_ready' : 'guest_ready';

  await sb.from('boss_raids').update({ [field]: true }).eq('id', _brState.id);
  _brState[field] = true;

  // 준비완료 사운드 + 토스트
  if (typeof playSound === 'function') playSound('approve');
  toast('✅', '준비완료! 상대를 기다리는 중...');

  // UI 즉시 갱신
  _brRenderLobby(document.getElementById('utab-bossraid'), _brState);

  // 양쪽 다 Ready인지 확인
  const { data: latest } = await sb.from('boss_raids').select('host_ready, guest_ready').eq('id', _brState.id).single();
  if (latest.host_ready && latest.guest_ready) {
    await sb.from('boss_raids').update({ status: 'ready' }).eq('id', _brState.id);
  }
}

// ── 방 나가기 ──
async function _brLeaveRoom() {
  if (!_brState) return;
  const isHost = _brState.host_id === myProfile.id;

  if (isHost) {
    await sb.from('boss_raids').update({ status: 'cancelled' }).eq('id', _brState.id);
  } else {
    await sb.from('boss_raids').update({
      guest_id: null,
      guest_squirrel_ids: [],
      guest_ready: false,
      status: 'waiting'
    }).eq('id', _brState.id);
  }

  _brUnsubscribe();
  _brState = null;
  _brBotSquirrels = null;
  renderBossRaid();
}

// ══════════════════════════════════════════════
//  전투 시뮬레이션 (방장만 실행)
// ══════════════════════════════════════════════
async function _brSimulateBattle(raid) {
  // 보스 생성 (활성 보스만)
  const activeBosses = (_brConfig.bosses || []).filter(b => b.active !== false);
  if (activeBosses.length === 0) { toast('❌', '활성화된 보스가 없어요'); return; }
  const bossTemplate = activeBosses[Math.floor(Math.random() * activeBosses.length)];
  const bossLv = _brRand(bossTemplate.lvMin, bossTemplate.lvMax);
  const bossStats = _brCalcStats(bossLv, true);

  // 다람쥐 4마리 로드 (봇 모드 대응)
  const hostSqIds = raid.host_squirrel_ids || [];
  const guestSqIds = raid.guest_squirrel_ids || [];
  const isBotMode = !!_brBotSquirrels;

  // 실제 다람쥐 (호스트측)
  const { data: realSquirrels } = await sb.from('squirrels').select('*').in('id', hostSqIds);

  // 봇 다람쥐 합치기
  let squirrels = [...(realSquirrels || [])];
  if (isBotMode && _brBotSquirrels) {
    guestSqIds.forEach(id => {
      if (_brBotSquirrels[id]) squirrels.push(_brBotSquirrels[id]);
    });
  } else if (!isBotMode) {
    // 일반 모드: guest 다람쥐도 DB에서 로드
    const { data: guestSqs } = await sb.from('squirrels').select('*').in('id', guestSqIds);
    if (guestSqs) squirrels = squirrels.concat(guestSqs);
  }

  if (squirrels.length < 4) {
    toast('❌', '다람쥐 정보를 불러올 수 없어요 (' + squirrels.length + '/4)');
    return;
  }

  // 오너 닉네임 로드
  let hostName = myProfile.display_name || '호스트';
  let guestName = '게스트';
  if (isBotMode) {
    guestName = '🤖 봇';
  } else {
    const gId = raid.guest_id;
    if (gId) {
      const { data: gu } = await sb.from('users').select('display_name').eq('id', gId).limit(1);
      if (gu && gu.length > 0) guestName = gu[0].display_name || '게스트';
    }
  }

  // 파티 구성 (stats가 없을 경우 기본값)
  const ultiMax = _brConfig.ultimate_uses || 1;
  const party = squirrels.map(sq => {
    const stats = sq.stats || { hp: 50, atk: 10, def: 5 };
    const isHostSq = hostSqIds.includes(sq.id);
    // 등급 색상 계산
    const grade = (typeof _sqCalcGrade === 'function') ? _sqCalcGrade(sq) : 'normal';
    const gradeStyle = (typeof _sqGradeStyle === 'function') ? _sqGradeStyle(grade) : { color: '#e2e8f0' };
    return {
      id: sq.id,
      name: sq.name,
      sprite: sq.sprite || 'sq_acorn',
      owner: isHostSq ? 'host' : 'guest',
      ownerName: isHostSq ? hostName : guestName,
      gradeColor: gradeStyle.color,
      hp: stats.hp || 50,
      maxHp: stats.hp || 50,
      atk: stats.atk || 10,
      def: stats.def || 5,
      alive: true,
      ultiLeft: ultiMax  // 필살기 잔여 횟수
    };
  });

  // SP 부여 (팀 공용)
  const sp = _brRand(_brConfig.sp_min, _brConfig.sp_max);
  let spLeft = sp;

  // 보스
  const boss = {
    name: bossTemplate.name,
    emoji: bossTemplate.emoji,
    lv: bossLv,
    hp: bossStats.hp,
    maxHp: bossStats.hp,
    atk: bossStats.atk,
    def: bossStats.def
  };

  const ultiMult = _brConfig.ultimate_mult || 2.0;

  // 전투 로그 생성
  const log = [];
  log.push({ type: 'init', boss: {...boss}, party: party.map(p => ({...p})), sp: sp, ultiMax: ultiMax });
  log.push({ type: 'msg', text: `🐉 ${boss.name}(Lv.${boss.lv})이(가) 나타났다!`, cls: 'em' });
  log.push({ type: 'msg', text: `✨ 스킬 포인트: ${sp}회 | 💥 필살기: 다람쥐당 ${ultiMax}회`, cls: '' });

  let turnCount = 0;
  const maxTurns = 80;

  while (boss.hp > 0 && party.some(p => p.alive) && turnCount < maxTurns) {
    turnCount++;

    // 각 살아있는 다람쥐가 한 번씩 행동
    for (const sq of party) {
      if (!sq.alive || boss.hp <= 0) continue;

      // 행동 결정: 필살기 > 스킬 > 일반공격
      // 필살기: 잔여 횟수 있고 25% 확률 (보스 HP가 40% 이하면 50%)
      const bossHpRatio = boss.hp / boss.maxHp;
      const useUlti = sq.ultiLeft > 0 && Math.random() < (bossHpRatio < 0.4 ? 0.5 : 0.25);
      const useSkill = !useUlti && spLeft > 0 && Math.random() < 0.4;
      let dmg;

      if (useUlti) {
        sq.ultiLeft--;
        dmg = Math.floor(sq.atk * _brConfig.skill_multiplier * ultiMult + _brRand(-_brConfig.skill_swing * 2, _brConfig.skill_swing * 2));
        dmg = Math.max(1, dmg);
        log.push({
          type: 'ultimate', sqId: sq.id, sqName: sq.name, dmg: dmg,
          text: `💥 ${sq.name}의 필살기! ${dmg} 데미지!`, cls: 'ultimate',
          ultiLeft: sq.ultiLeft
        });
      } else if (useSkill) {
        spLeft--;
        dmg = Math.floor(sq.atk * _brConfig.skill_multiplier + _brRand(-_brConfig.skill_swing, _brConfig.skill_swing));
        dmg = Math.max(1, dmg);
        log.push({
          type: 'skill', sqId: sq.id, sqName: sq.name, dmg: dmg,
          text: `✨ ${sq.name}의 스킬! ${dmg} 데미지!`, cls: 'skill',
          spLeft: spLeft
        });
      } else {
        dmg = Math.max(1, Math.floor(sq.atk * (_brConfig.atk_multiplier || 1.0)) - Math.floor(boss.def * _brConfig.mon_def_effect / 100)) + _brRand(-_brConfig.atk_swing, _brConfig.atk_swing);
        dmg = Math.max(1, dmg);
        const bigHit = dmg >= sq.atk * 0.9;
        log.push({
          type: 'attack', sqId: sq.id, sqName: sq.name, dmg: dmg, bigHit: bigHit,
          text: bigHit ? `💥 ${sq.name}의 강타! ${dmg} 데미지!` : `⚔️ ${sq.name}의 공격! ${dmg} 데미지!`,
          cls: 'atk'
        });
      }

      boss.hp = Math.max(0, boss.hp - dmg);
      log.push({ type: 'boss_hp', hp: boss.hp, maxHp: boss.maxHp });

      if (boss.hp <= 0) {
        log.push({ type: 'msg', text: `🎉 ${boss.name}을(를) 격파했다!`, cls: 'win' });
        break;
      }
    }

    // 보스 반격 (살아있는 다람쥐 중 랜덤 타겟)
    if (boss.hp > 0) {
      const aliveParty = party.filter(p => p.alive);
      if (aliveParty.length === 0) break;

      const target = aliveParty[Math.floor(Math.random() * aliveParty.length)];
      let eDmg = Math.max(1, boss.atk - Math.floor(target.def * _brConfig.sq_def_effect / 100)) + _brRand(-_brConfig.mon_swing, _brConfig.mon_swing);
      eDmg = Math.max(1, eDmg);

      target.hp = Math.max(0, target.hp - eDmg);
      if (target.hp <= 0) target.alive = false;

      log.push({
        type: 'boss_attack', targetId: target.id, targetName: target.name, dmg: eDmg,
        text: `${boss.emoji} ${boss.name}의 반격! ${target.name}에게 ${eDmg} 데미지!`,
        cls: 'em',
        targetHp: target.hp, targetMaxHp: target.maxHp, targetAlive: target.alive
      });

      if (target.hp <= 0) {
        log.push({ type: 'msg', text: `💀 ${target.name}이(가) 쓰러졌다!`, cls: 'lose' });
      }

      // 전멸 체크
      if (party.every(p => !p.alive)) {
        log.push({ type: 'msg', text: `💀 모든 다람쥐가 쓰러졌다...`, cls: 'lose' });
        break;
      }
    }
  }

  // 보스별 보상 가중치 메타 (없으면 글로벌 사용)
  if (bossTemplate.reward_weights) {
    log.push({ type: 'boss_meta', reward_weights: bossTemplate.reward_weights });
  }

  // 결과 판정
  const result = boss.hp <= 0 ? 'victory' : 'defeat';
  log.push({ type: 'result', result: result });

  // DB 업데이트 (보스 정보 + 전투 로그 + 상태)
  await sb.from('boss_raids').update({
    boss_name: boss.name,
    boss_emoji: boss.emoji,
    boss_lv: bossLv,
    boss_hp: bossStats.hp,
    boss_atk: bossStats.atk,
    boss_def: bossStats.def,
    battle_log: log,
    result: result,
    status: 'battling'
  }).eq('id', raid.id);
}

// ── 스탯 계산 ──
function _brCalcStats(lv, isBoss) {
  let hp  = Math.floor(_brConfig.lv_base_hp  + lv * _brConfig.lv_grow_hp);
  let atk = Math.floor(_brConfig.lv_base_atk + lv * _brConfig.lv_grow_atk);
  let def = Math.floor(_brConfig.lv_base_def + lv * _brConfig.lv_grow_def);
  if (isBoss) {
    const m = _brConfig.boss_stat_mult;
    hp = Math.floor(hp * m);
    atk = Math.floor(atk * m);
    def = Math.floor(def * m);
  }
  return { hp, atk, def };
}

function _brRand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ══════════════════════════════════════════════
//  전투 재생 UI
// ══════════════════════════════════════════════
function _brRenderBattle(container, raid) {
  const log = raid.battle_log || [];
  if (log.length === 0) return;

  const initEntry = log.find(e => e.type === 'init');
  if (!initEntry) return;

  // 배틀 재렌더 시 결과 플래그 초기화 (폴링 재호출 대비)
  _brResultRendered = false;

  // 보스별 보상 가중치 메타 추출
  const metaEntry = log.find(e => e.type === 'boss_meta');
  window._brBossRewardWeights = metaEntry ? metaEntry.reward_weights : null;

  const boss = initEntry.boss;
  const party = initEntry.party;
  const ultiMax = initEntry.ultiMax || 1;

  // 딜 미터기 초기화 데이터
  window._brDmgData = {};
  party.forEach(sq => { window._brDmgData[sq.id] = { name: sq.name, ownerName: sq.ownerName || (sq.owner === 'host' ? '호스트' : '게스트'), owner: sq.owner, gradeColor: sq.gradeColor || '#e2e8f0', dmg: 0 }; });

  container.innerHTML = `
    <div class="br-battle-wrap">
      <!-- 보스 영역 -->
      <div class="br-boss-area">
        <div class="br-boss-emoji" id="brBossEmoji">${boss.emoji}</div>
        <div class="br-boss-info">
          <p style="font-size:13px;font-weight:900;color:#f8fafc">${boss.name} <span style="font-size:11px;color:#94a3b8">Lv.${boss.lv}</span></p>
          <div class="br-hp-track">
            <div class="br-hp-bar br-hp-boss" id="brBossHpBar" style="width:100%"></div>
          </div>
          <p style="font-size:10px;color:#94a3b8" id="brBossHpText">${boss.hp} / ${boss.maxHp}</p>
        </div>
      </div>

      <!-- 팀 SP 바 (공용) -->
      <div class="br-team-sp">
        <span class="br-team-sp-label">✨ 팀 SP</span>
        <div class="br-sp-gauge-track">
          <div class="br-sp-gauge-fill" id="brSpGauge" style="width:100%"></div>
        </div>
        <span class="br-sp-count" id="brSpText">${initEntry.sp} / ${initEntry.sp}</span>
      </div>

      <!-- 파티 -->
      <div class="br-party-grid">
        ${party.map((sq, i) => `
          <div class="br-pc-card" id="brPc${i}">
            <div class="br-pc-owner" style="color:${sq.owner === 'host' ? '#86efac' : '#93c5fd'}">${_escHtml(sq.ownerName || (sq.owner === 'host' ? '호스트' : '게스트'))}</div>
            <div class="br-pc-sprite-wrap">
              <img src="images/squirrels/${sq.sprite}.png" class="br-pc-img" onerror="this.outerHTML='<div style=\\'font-size:22px\\'>🐿️</div>'">
              <div class="br-action-badge" id="brBadge${i}"></div>
            </div>
            <p style="font-size:10px;font-weight:900;color:${sq.gradeColor || '#e2e8f0'};margin:1px 0 0;text-shadow:0 1px 3px rgba(0,0,0,0.4)">${sq.name}</p>
            <div class="br-hp-track br-hp-sm" style="margin:3px 4px 2px">
              <div class="br-hp-bar br-hp-ally" id="brPcHp${i}" style="width:100%"></div>
            </div>
            <div class="br-pc-hp-text" id="brPcHpText${i}">${sq.hp}/${sq.maxHp}</div>
            <div class="br-pc-ulti-wrap">
              <span class="br-counter-ulti" id="brPcUlti${i}">💥 ${sq.ultiLeft || ultiMax}</span>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- 딜 미터기 -->
      <div class="br-dmg-meter" id="brDmgMeter">
        <div class="br-dmg-meter-title">⚔️ 딜 기여도</div>
        ${party.map(sq => `
          <div class="br-dmg-row" id="brDmgRow_${sq.id}">
            <div class="br-dmg-label">
              <span class="br-dmg-owner" style="color:${sq.owner === 'host' ? '#86efac' : '#93c5fd'}">${_escHtml(sq.ownerName || '')}</span>
              <span class="br-dmg-name" style="color:${sq.gradeColor || '#e2e8f0'}">${sq.name}</span>
            </div>
            <div class="br-dmg-bar-track">
              <div class="br-dmg-bar-fill ${sq.owner === 'host' ? 'br-dmg-host' : 'br-dmg-guest'}" id="brDmgBar_${sq.id}" style="width:0%">
                <span id="brDmgVal_${sq.id}">0</span>
              </div>
            </div>
            <div class="br-dmg-pct" id="brDmgPct_${sq.id}" style="color:${sq.owner === 'host' ? '#86efac' : '#93c5fd'}">0%</div>
          </div>
        `).join('')}
      </div>

      <!-- 로그 -->
      <div class="br-log-panel" id="brLogPanel"></div>

    </div>`;

  // SP 최대값 기억
  window._brSpMax = initEntry.sp;

  // 재생 시작
  _brReplayIdx = 0;
  _brStartReplay(log, party);
}

function _brStartReplay(log, partyInit) {
  if (_brReplayTimer) clearInterval(_brReplayTimer);

  // 배경음 재생
  if (typeof _sndPlayBGM === 'function') _sndPlayBGM('boss');

  const party = partyInit.map(p => ({...p}));
  let idx = 0;

  // init 엔트리는 스킵
  const skipTypes = ['init'];

  _brReplayTimer = setInterval(() => {
    if (idx >= log.length) {
      clearInterval(_brReplayTimer);
      _brReplayTimer = null;
      if (typeof _sndStopBGM === 'function') _sndStopBGM();
      // 파티 영역을 결과 카드로 교체
      setTimeout(() => {
        if (!_brState) return;
        const isVictory = _brState.result === 'victory';
        // ① 승리 판정: raid_victory BGM 반복재생 / 패배: 효과음만
        if (isVictory) {
          if (typeof _sndPlayBGM === 'function') _sndPlayBGM('raid_victory');
        } else {
          if (typeof _btlSound === 'function') _btlSound('defeat');
        }

        const partyGrid = document.querySelector('.br-party-grid');
        if (partyGrid) {
          partyGrid.innerHTML = `
            <div class="br-end-card">
              <div style="font-size:3rem;margin-bottom:4px">${isVictory ? '🎉' : '💀'}</div>
              <p style="font-size:22px;font-weight:900;color:${isVictory ? '#4ade80' : '#f87171'};margin-bottom:2px">${isVictory ? '보스 격파!' : '패배...'}</p>
              <div style="height:10px"></div>
              <button class="btn btn-primary px-8 py-3 text-sm font-black" onclick="_brGoToResult()" style="animation:br-badge-pop .4s ease">${isVictory ? '보상 받기' : '결과 확인'}</button>
            </div>
          `;
          partyGrid.className = 'br-party-grid br-end-mode';
        }
      }, 800);
      return;
    }

    const entry = log[idx];
    idx++;

    if (skipTypes.includes(entry.type)) return;

    // 로그 표시
    if (entry.text) {
      _brAddLog(entry.text, entry.cls || '');
    }

    // ── 효과음 ──
    if (entry.type === 'attack') {
      if (typeof _btlSound === 'function') _btlSound(entry.bigHit ? 'bigHit' : 'attack');
    } else if (entry.type === 'skill') {
      if (typeof _btlSound === 'function') _btlSound('skill');
    } else if (entry.type === 'ultimate') {
      if (typeof _btlSound === 'function') _btlSound('skill');
      if (typeof _btlSound === 'function') setTimeout(() => _btlSound('bigHit'), 150);
    } else if (entry.type === 'boss_attack') {
      if (typeof _btlSound === 'function') _btlSound('hit');
    }

    // ── 보스 HP 업데이트 + 데미지 팝업 on boss ──
    if (entry.type === 'boss_hp') {
      const pct = Math.max(0, entry.hp / entry.maxHp * 100);
      const bar = document.getElementById('brBossHpBar');
      const txt = document.getElementById('brBossHpText');
      if (bar) {
        bar.style.width = pct + '%';
        // 저 HP일 때 바 색상 변경
        if (pct <= 25) bar.style.background = 'linear-gradient(90deg, #dc2626, #ef4444)';
        else if (pct <= 50) bar.style.background = 'linear-gradient(90deg, #ef4444, #f97316)';
      }
      if (txt) txt.textContent = `${Math.max(0, entry.hp)} / ${entry.maxHp}`;

      // 보스 흔들림 (더 강하게)
      const bossEl = document.getElementById('brBossEmoji');
      if (bossEl) {
        bossEl.classList.add('br-boss-hit');
        setTimeout(() => bossEl.classList.remove('br-boss-hit'), 400);
      }
    }

    // ── 다람쥐 공격/스킬/필살기 → 액션 배지 + 데미지 팝업 + 애니메이션 ──
    if (entry.type === 'attack' || entry.type === 'skill' || entry.type === 'ultimate') {
      const sqIdx = partyInit.findIndex(p => p.id === entry.sqId);
      if (sqIdx >= 0) {
        const card = document.getElementById('brPc' + sqIdx);
        if (card) {
          // 타입별 애니메이션 클래스
          if (entry.type === 'ultimate') {
            card.classList.add('br-attacking-ulti', 'br-ultimate-glow');
            setTimeout(() => {
              card.classList.remove('br-attacking-ulti', 'br-ultimate-glow');
            }, 550);
          } else if (entry.type === 'skill') {
            card.classList.add('br-attacking-skill');
            setTimeout(() => card.classList.remove('br-attacking-skill'), 400);
          } else {
            card.classList.add(entry.bigHit ? 'br-attacking-big' : 'br-attacking');
            setTimeout(() => {
              card.classList.remove('br-attacking', 'br-attacking-big');
            }, 350);
          }
        }

        // 액션 배지 표시
        const badge = document.getElementById('brBadge' + sqIdx);
        if (badge) {
          let badgeText = '⚔️';
          let badgeCls = 'br-badge-atk';
          if (entry.type === 'skill') { badgeText = '✨'; badgeCls = 'br-badge-skill'; }
          else if (entry.type === 'ultimate') { badgeText = '💥'; badgeCls = 'br-badge-ulti'; }
          else if (entry.bigHit) { badgeText = '💢'; badgeCls = 'br-badge-big'; }
          badge.textContent = badgeText;
          badge.className = 'br-action-badge ' + badgeCls + ' br-badge-show';
          setTimeout(() => { badge.className = 'br-action-badge'; badge.textContent = ''; }, 450);
        }

        // 보스에 데미지 팝업
        _brShowDmgPopup('brBossEmoji', entry.dmg, entry.type);
      }

      // 딜 미터기 업데이트
      if (entry.dmg && entry.sqId && window._brDmgData) {
        const dd = window._brDmgData[entry.sqId];
        if (dd) {
          dd.dmg += entry.dmg;
          _brUpdateDmgMeter();
        }
      }

      // 팀 SP 바 업데이트
      if (entry.type === 'skill' && entry.spLeft !== undefined) {
        const spMax = window._brSpMax || 1;
        const spEl = document.getElementById('brSpText');
        if (spEl) spEl.textContent = entry.spLeft + ' / ' + spMax;
        const spGauge = document.getElementById('brSpGauge');
        if (spGauge) spGauge.style.width = Math.max(0, entry.spLeft / spMax * 100) + '%';
      }
      // 필살기 카운터 업데이트
      if (entry.type === 'ultimate' && entry.ultiLeft !== undefined) {
        const uC = document.getElementById('brPcUlti' + sqIdx);
        if (uC) {
          uC.textContent = '💥' + entry.ultiLeft;
          if (entry.ultiLeft <= 0) uC.style.opacity = '0.35';
        }
      }
    }

    // ── 보스 반격 → 타겟 피격 + 데미지 팝업 ──
    if (entry.type === 'boss_attack') {
      const tIdx = partyInit.findIndex(p => p.id === entry.targetId);
      if (tIdx >= 0) {
        const card = document.getElementById('brPc' + tIdx);
        if (card) {
          card.classList.add('br-hit');
          setTimeout(() => card.classList.remove('br-hit'), 400);
        }

        // 다람쥐에 데미지 팝업
        _brShowDmgPopup('brPc' + tIdx, entry.dmg, 'hit');

        // HP 바 + 텍스트 업데이트
        const hpBar = document.getElementById('brPcHp' + tIdx);
        if (hpBar) {
          const pct = Math.max(0, entry.targetHp / entry.targetMaxHp * 100);
          hpBar.style.width = pct + '%';
          if (pct <= 30) hpBar.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
          else if (pct <= 60) hpBar.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
        }
        const hpText = document.getElementById('brPcHpText' + tIdx);
        if (hpText) hpText.textContent = Math.max(0, entry.targetHp) + '/' + entry.targetMaxHp;

        // 사망 처리
        if (!entry.targetAlive) {
          if (card) card.classList.add('br-dead');
        }
      }
    }

  }, 470);
}

// ── 데미지 팝업 헬퍼 ──
function _brShowDmgPopup(parentId, dmg, type) {
  const parent = document.getElementById(parentId);
  if (!parent) return;
  const popup = document.createElement('div');
  let cls = 'br-dmg-float';
  if (type === 'ultimate') cls += ' br-dmg-ulti';
  else if (type === 'skill') cls += ' br-dmg-skill';
  else if (type === 'hit') cls += ' br-dmg-hit';
  else cls += ' br-dmg-atk';
  popup.className = cls;
  popup.textContent = (type === 'hit' ? '-' : '') + dmg;
  // 좌우 랜덤 오프셋
  const offsetX = Math.floor(Math.random() * 24) - 12;
  popup.style.left = 'calc(50% + ' + offsetX + 'px)';
  parent.style.position = 'relative';
  parent.appendChild(popup);
  setTimeout(() => popup.remove(), 900);
}

// ── 딜 미터기 갱신 ──
function _brUpdateDmgMeter() {
  const dd = window._brDmgData;
  if (!dd) return;
  const entries = Object.keys(dd).map(id => ({ id, ...dd[id] }));
  const totalDmg = entries.reduce((s, e) => s + e.dmg, 0) || 1;
  const maxDmg = Math.max(...entries.map(e => e.dmg), 1);

  // 딜 높은 순 정렬
  entries.sort((a, b) => b.dmg - a.dmg);

  const meter = document.getElementById('brDmgMeter');
  if (meter) {
    // FLIP 애니메이션: 1) 현재 위치 기록
    const oldPos = {};
    for (const e of entries) {
      const row = document.getElementById('brDmgRow_' + e.id);
      if (row) oldPos[e.id] = row.getBoundingClientRect().top;
    }

    // 2) DOM 재배치
    for (const e of entries) {
      const row = document.getElementById('brDmgRow_' + e.id);
      if (row) meter.appendChild(row);
    }

    // 3) 새 위치와 비교 → 역방향 offset 적용 후 transition으로 원래 위치로
    for (const e of entries) {
      const row = document.getElementById('brDmgRow_' + e.id);
      if (!row || oldPos[e.id] === undefined) continue;
      const newTop = row.getBoundingClientRect().top;
      const delta = oldPos[e.id] - newTop;
      if (Math.abs(delta) > 1) {
        row.style.transition = 'none';
        row.style.transform = 'translateY(' + delta + 'px)';
        // 강제 리플로우 후 transition 복원
        row.offsetHeight;
        row.style.transition = '';
        row.style.transform = '';
      }
    }

    // 1등 하이라이트
    for (let i = 0; i < entries.length; i++) {
      const row = document.getElementById('brDmgRow_' + entries[i].id);
      if (row) {
        if (i === 0 && entries[i].dmg > 0) row.classList.add('br-dmg-top');
        else row.classList.remove('br-dmg-top');
      }
    }
  }

  for (const e of entries) {
    const pct = Math.round(e.dmg / totalDmg * 100);
    const barW = Math.max(2, e.dmg / maxDmg * 100);
    const bar = document.getElementById('brDmgBar_' + e.id);
    const val = document.getElementById('brDmgVal_' + e.id);
    const pctEl = document.getElementById('brDmgPct_' + e.id);
    if (bar) bar.style.width = barW + '%';
    if (val) val.textContent = e.dmg;
    if (pctEl) pctEl.textContent = pct + '%';
  }
}

function _brGoToResult() {
  if (typeof _sndStopBGM === 'function') _sndStopBGM();
  if (_brState) _brRenderResult(document.getElementById('utab-bossraid'), _brState);
}

function _brAddLog(text, cls) {
  const panel = document.getElementById('brLogPanel');
  if (!panel) return;
  const row = document.createElement('div');
  row.className = 'br-log-row br-log-' + (cls || 'default');
  row.innerHTML = text;
  panel.appendChild(row);
  panel.scrollTop = panel.scrollHeight;
}

// ══════════════════════════════════════════════
//  결과 & 보상
// ══════════════════════════════════════════════
async function _brRenderResult(container, raid) {
  // 중복 렌더 방지 (폴링에 의한 재호출 차단)
  if (_brResultRendered) return;
  _brResultRendered = true;

  if (_brReplayTimer) { clearInterval(_brReplayTimer); _brReplayTimer = null; }
  if (typeof _sndStopBGM === 'function') _sndStopBGM();

  const isHost = raid.host_id === myProfile.id;
  const myRewarded = isHost ? raid.host_rewarded : raid.guest_rewarded;
  const isVictory = raid.result === 'victory';

  if (myRewarded) {
    // 이미 보상 수령 → 완료 화면
    container.innerHTML = `
      <div class="clay-card p-6 text-center">
        <div class="text-5xl mb-3">${isVictory ? '🎉' : '💀'}</div>
        <h2 class="text-xl font-black mb-2" style="color:${isVictory ? '#22c55e' : '#ef4444'}">${isVictory ? '보스 격파!' : '패배...'}</h2>
        <p class="text-sm text-gray-400 font-semibold mb-4">보상을 이미 수령했어요.</p>
        <button class="btn btn-primary px-8 py-3" onclick="_brFinish()">돌아가기</button>
      </div>`;
    return;
  }

  // ── 패배 / 승리 공통: 카드 뒤집기 보상 ──
  let cards;
  let resultEmoji, resultTitle, resultColor, resultDesc;

  if (!isVictory) {
    resultEmoji = '💀'; resultTitle = '패배...'; resultColor = '#ef4444';
    resultDesc = '';

    // 패배 보상이 비활성이면 카드 없이 종료
    if (!_brConfig.defeat_reward_enabled) {
      container.innerHTML = `
        <div class="clay-card p-6 text-center">
          <div class="text-5xl mb-3">💀</div>
          <h2 class="text-xl font-black mb-2" style="color:#ef4444">패배...</h2>
          <p class="text-sm text-gray-400 font-semibold mb-2">보스에게 패배했어요. 다음에 다시 도전하세요!</p>
          <button class="btn btn-primary px-8 py-3 mt-4" onclick="_brFinish()">돌아가기</button>
        </div>`;
      // 주간 횟수만 증가
      if (!_brWeeklyDone) {
        _brWeeklyDone = true;
        await _brIncrementWeekly();
        const _isBotMode = raid.host_id === raid.guest_id;
        if (_isBotMode) {
          await sb.from('boss_raids').update({
            host_rewarded: true, guest_rewarded: true, status: 'finished'
          }).eq('id', raid.id);
        } else {
          await sb.from('boss_raids').update({
            [isHost ? 'host_rewarded' : 'guest_rewarded']: true,
            status: 'finished'
          }).eq('id', raid.id);
        }
      }
      return;
    }

    // 패배 보상 카드 생성 (패배 전용 보상 풀)
    cards = [
      _brGenDefeatReward(),
      _brGenDefeatReward(),
      _brGenDefeatReward()
    ];
  } else {
    resultEmoji = '🎉'; resultTitle = '보스 격파!'; resultColor = '#22c55e';
    resultDesc = '카드를 선택해서 보상을 받으세요!';
    cards = [
      _brGenReward(_brPickGrade()),
      _brGenReward(_brPickGrade()),
      _brGenReward(_brPickGrade())
    ];
  }

  if (isVictory) {
    // ── 승리: 탐험 보상 카드 디자인 ──
    container.innerHTML = `
      <div class="clay-card p-6 text-center">
        <div class="text-5xl mb-3">${resultEmoji}</div>
        <h2 class="text-xl font-black mb-2" style="color:${resultColor}">${resultTitle}</h2>
        <p class="text-sm text-gray-400 font-semibold mb-4">카드를 선택해서 보상을 받으세요!</p>
        <div class="br-card-row">
          ${cards.map((c, i) => `
            <div class="btl-reward-card" id="brCard${i}" onclick="_brSelectCard(${i})">
              <div class="btl-card-back"><img src="images/baby-squirrel.png" class="btl-card-baby-bounce"></div>
            </div>
          `).join('')}
        </div>
        <div id="brRewardResult" class="mt-4 hidden"></div>
      </div>`;
  } else {
    // ── 패배: 리본 카드 디자인 ──
    container.innerHTML = `
      <div class="clay-card p-6 text-center">
        <div class="text-5xl mb-3">${resultEmoji}</div>
        <h2 class="text-xl font-black mb-2" style="color:${resultColor}">${resultTitle}</h2>
        <div class="mb-3"></div>
        <div class="br-card-row">
          ${cards.map((c, i) => `
            <div class="br-reward-card" id="brCard${i}" onclick="_brSelectCard(${i})">
              <div class="br-card-back">🎀</div>
              <div class="br-card-front br-grade-null">
                ${c.item ? `<p style="font-size:12px;font-weight:700;margin:2px 0">${c.item.icon} ${c.item.name}</p>` : ''}
                <p style="font-size:14px;font-weight:800;color:#f59e0b;margin:2px 0">🌰 ${c.acorns}</p>
              </div>
            </div>
          `).join('')}
        </div>
        <div id="brRewardResult" class="mt-4 hidden"></div>
      </div>`;
  }

  // ② 카드 화면 등장: explorer_card_reward 1회
  if (typeof _btlSound === 'function') _btlSound('reward');

  window._brCards = cards;
  window._brIsVictory = isVictory;
}

// ── 패배 전용 보상 생성 ──
function _brGenDefeatReward() {
  const dAcMin = (_brConfig.defeat_acorns || [2, 5])[0] || 0;
  const dAcMax = (_brConfig.defeat_acorns || [2, 5])[1] || 0;
  const acorns = _brRand(dAcMin, dAcMax);
  let item = null;
  const dItemCh = _brConfig.defeat_itemChance || 0;
  const dItems = _brConfig.defeat_items || [];
  if (Math.random() < dItemCh && dItems.length > 0) {
    const raw = dItems[Math.floor(Math.random() * dItems.length)];
    if (typeof raw === 'object' && raw.name) {
      item = { icon: raw.icon || '🎁', name: raw.name };
    } else {
      const parts = (raw + '').split(' ');
      item = { icon: parts[0], name: parts.slice(1).join(' ') };
    }
  }
  return { grade: null, acorns, item };
}

function _brPickGrade() {
  // 보스별 가중치 우선, 없으면 글로벌 설정 사용
  const w = window._brBossRewardWeights || _brConfig.reward_weights;
  const total = w.C + w.B + w.A;
  const r = Math.random() * total;
  if (r < w.C) return 'C';
  if (r < w.C + w.B) return 'B';
  return 'A';
}

function _brGenReward(grade) {
  const cfg = _brConfig['reward_' + grade];
  const acorns = _brRand(cfg.acorns[0], cfg.acorns[1]);
  let item = null;
  if (Math.random() < cfg.itemChance && cfg.items.length > 0) {
    const raw = cfg.items[Math.floor(Math.random() * cfg.items.length)];
    // items는 {name, icon} 객체 또는 "아이콘 이름" 문자열 (하위 호환)
    if (typeof raw === 'object' && raw.name) {
      item = { icon: raw.icon || '🎁', name: raw.name };
    } else {
      const parts = (raw + '').split(' ');
      item = { icon: parts[0], name: parts.slice(1).join(' ') };
    }
  }
  return { grade, acorns, item };
}

async function _brSelectCard(idx) {
  const cards = window._brCards;
  if (!cards) return;

  const chosen = cards[idx];
  const isVictory = window._brIsVictory;

  // ③ 카드 선택(뒤집기): explorer_complete_victory 1회
  if (typeof _btlSound === 'function') _btlSound('victory');

  if (isVictory) {
    // ── 승리: 탐험 카드 방식 ──
    for (let i = 0; i < 3; i++) {
      const el = document.getElementById('brCard' + i);
      if (!el) continue;

      if (i === idx) {
        el.innerHTML = _brBuildVictoryFront(cards[i], true);
        el.className = 'btl-reward-card btl-card-disabled btl-card-chosen';
      } else {
        el.classList.add('btl-card-disabled');
        (function(j) {
          setTimeout(function() {
            var oel = document.getElementById('brCard' + j);
            if (oel) {
              oel.innerHTML = _brBuildVictoryFront(cards[j], false);
              oel.className = 'btl-reward-card btl-card-disabled btl-card-unchosen';
            }
          }, j < idx ? j * 150 : (j - 1) * 150);
        })(i);
      }
    }
  } else {
    // ── 패배: 리본 카드 방식 ──
    for (let i = 0; i < 3; i++) {
      const el = document.getElementById('brCard' + i);
      if (!el) continue;
      const back = el.querySelector('.br-card-back');
      const front = el.querySelector('.br-card-front');

      if (i === idx) {
        el.classList.add('br-card-chosen');
        if (back) back.style.display = 'none';
        if (front) { front.style.backfaceVisibility = 'visible'; front.style.transform = 'none'; }
      } else {
        el.classList.add('br-card-unchosen');
        setTimeout(() => {
          if (back) back.style.display = 'none';
          if (front) { front.style.backfaceVisibility = 'visible'; front.style.transform = 'none'; }
        }, 400);
      }
    }
  }

  // 결과 표시
  const resultEl = document.getElementById('brRewardResult');
  if (resultEl) {
    resultEl.classList.remove('hidden');
    const gradeText = chosen.grade ? `${chosen.grade}등급 획득!` : '위로 보상!';
    resultEl.innerHTML = `
      <p class="text-lg font-black mb-2" style="color:#fbbf24">${gradeText}</p>
      <p class="text-sm font-bold">${chosen.item ? chosen.item.icon + ' ' + chosen.item.name + ' + ' : ''}🌰 ${chosen.acorns}개</p>
      <button class="btn btn-primary px-10 py-4 mt-4 text-base font-black" onclick="_brClaimReward(${idx})">보상 수령</button>
    `;
  }

  window._brCards = null;
  window._brChosenCard = chosen;
}

// 승리 카드 front HTML 빌더 (탐험 카드 디자인)
function _brBuildVictoryFront(r, chosen) {
  const gradeClass = 'btl-grade-' + r.grade.toLowerCase();
  const frontClass = chosen ? 'btl-card-front-chosen' : 'btl-card-front-unchosen';
  const animClass = chosen ? 'btl-chosen-front' : 'btl-unchosen-front';
  const rewardText = (r.item ? r.item.icon + ' ' + r.item.name + '<br>' : '') + '🌰 ' + r.acorns + '개';
  return '<div class="btl-card-front ' + frontClass + ' ' + gradeClass + ' ' + animClass + '">' +
    '<div class="btl-card-grade">' + r.grade + '등급</div>' +
    '<div class="btl-card-reward-icon">' + (r.item ? r.item.icon : '🌰') + '</div>' +
    '<div class="btl-card-reward-txt">' + rewardText + '</div>' +
  '</div>';
}

async function _brClaimReward(idx) {
  const chosen = window._brChosenCard;
  if (!chosen || !_brState) return;
  window._brChosenCard = null; // 중복 클릭 방지
  // ④ 보상 수령: raid_card_reward_pick 1회
  if (typeof _btlSound === 'function') _btlSound('raidPick');

  const isHost = _brState.host_id === myProfile.id;
  const wasVictory = window._brIsVictory;
  const rewardSource = wasVictory ? 'boss_raid' : 'boss_raid_defeat';

  // 도토리 지급
  if (chosen.acorns > 0) {
    await sb.rpc('adjust_acorns', {
      p_user_id: myProfile.id,
      p_amount: chosen.acorns,
      p_reason: wasVictory ? '보스레이드 보상' : '보스레이드 패배 위로 보상'
    });
    // 메모리 잔고 즉시 반영
    myProfile.acorns = (myProfile.acorns || 0) + chosen.acorns;
  }

  // 아이템 지급
  if (chosen.item) {
    const { data: product } = await sb.from('products')
      .select('id').eq('name', chosen.item.name).maybeSingle();

    await sb.from('inventory').insert({
      user_id: myProfile.id,
      product_id: product?.id || null,
      product_snapshot: { name: chosen.item.name, icon: chosen.item.icon, from: rewardSource },
      from_gacha: false,
      status: 'held'
    });
  }

  // 주간 횟수 증가 (중복 방지)
  if (!_brWeeklyDone) {
    _brWeeklyDone = true;
    await _brIncrementWeekly();
  }

  // 보상 수령 완료 표시 (봇 모드면 양쪽 다 처리)
  const isBotMode = _brState.host_id === _brState.guest_id;
  if (isBotMode) {
    await sb.from('boss_raids').update({
      host_rewarded: true, guest_rewarded: true, status: 'finished'
    }).eq('id', _brState.id);
  } else {
    await sb.from('boss_raids').update({
      [isHost ? 'host_rewarded' : 'guest_rewarded']: true
    }).eq('id', _brState.id);

    // 양쪽 다 보상 수령했으면 finished
    const { data: latest } = await sb.from('boss_raids')
      .select('host_rewarded, guest_rewarded').eq('id', _brState.id).single();
    if (latest && latest.host_rewarded && latest.guest_rewarded) {
      await sb.from('boss_raids').update({ status: 'finished' }).eq('id', _brState.id);
    }
  }

  // 도토리 표시 갱신
  if (typeof updateAcornDisplay === 'function') updateAcornDisplay();

  toast('🎉', `보상 수령 완료! 🌰 ${chosen.acorns}개${chosen.item ? ' + ' + chosen.item.icon + chosen.item.name : ''}`);
  _brFinish();
}

async function _brFinish() {
  _brUnsubscribe();
  _brState = null;
  _brWeeklyDone = false;
  _brResultRendered = false;
  _brBotSquirrels = null;
  window._brCards = null;
  window._brChosenCard = null;
  window._brIsVictory = null;
  window._brDmgData = null;
  window._brSpMax = null;
  window._brBossRewardWeights = null;
  if (typeof _sndStopBGM === 'function') _sndStopBGM();
  renderBossRaid();
}

// ══════════════════════════════════════════════
//  관리자: 보스레이드 설정
// ══════════════════════════════════════════════
// ── 관리자: products 캐시 ──
var _brProductsCache = [];

async function _brLoadProducts() {
  try {
    var res = await sb.from('products').select('id,name,icon,item_type,reward_type').order('sort_order');
    _brProductsCache = (res.data || []).filter(function(p) {
      var rt = p.reward_type || '';
      return rt !== 'AUTO_ACORN' && rt !== 'ACORN_TICKET' && rt !== 'GACHA_TICKET';
    });
  } catch(e) { _brProductsCache = []; }
}

// ── 아이템 칩 렌더 (탐험과 동일 방식) ──
function _brRenderItemChips(wrapId, selectedItems) {
  var wrap = document.getElementById(wrapId);
  if (!wrap) return;
  var seen = {};
  var unique = [];
  _brProductsCache.forEach(function(p) {
    if (!seen[p.name]) { seen[p.name] = true; unique.push(p); }
  });
  if (unique.length === 0) {
    wrap.innerHTML = '<div style="font-size:11px;color:#9ca3af;padding:6px">등록된 상품이 없어요</div>';
    return;
  }
  var selectedNames = new Set((selectedItems || []).map(function(s) {
    if (typeof s === 'object' && s.name) return s.name;
    return (s + '').replace(/^\S+\s*/, '').trim() || s;
  }));
  wrap.innerHTML = unique.map(function(p) {
    var isSel = selectedNames.has(p.name);
    return '<div class="exp-item-chip' + (isSel ? ' selected' : '') + '" ' +
      'data-wrap="' + wrapId + '" data-name="' + p.name + '" data-icon="' + (p.icon || '🎁') + '" ' +
      'onclick="this.classList.toggle(\'selected\')">' +
      '<span class="exp-item-chip-icon">' + (p.icon || '🎁') + '</span>' +
      '<span class="exp-item-chip-name">' + p.name + '</span>' +
    '</div>';
  }).join('');
}

function _brGetSelectedItems(wrapId) {
  var wrap = document.getElementById(wrapId);
  if (!wrap) return [];
  var chips = wrap.querySelectorAll('.exp-item-chip.selected');
  var items = [];
  chips.forEach(function(chip) {
    items.push({ name: chip.dataset.name, icon: chip.dataset.icon || '🎁' });
  });
  return items;
}

// ── 보스 목록 렌더 (활성/비활성 토글 + 편집) ──
function _brRenderBossList() {
  var wrap = document.getElementById('brAdmBossList');
  if (!wrap) return;
  var bosses = _brConfig.bosses || [];
  if (bosses.length === 0) {
    wrap.innerHTML = '<div style="font-size:11px;color:#9ca3af;padding:8px;text-align:center">등록된 보스가 없어요</div>';
    return;
  }
  var is = 'background:rgba(0,0,0,0.05);border:1px solid rgba(0,0,0,0.1)';
  wrap.innerHTML = bosses.map(function(b, i) {
    var active = b.active !== false;
    var preview = _brCalcStats(b.lvMin, true);
    var previewMax = _brCalcStats(b.lvMax, true);
    return '<div style="display:flex;align-items:center;gap:6px;padding:8px;border-radius:10px;background:rgba(255,255,255,0.04);margin-bottom:4px;opacity:' + (active ? '1' : '0.45') + '">' +
      '<div onclick="_brAdmToggleBoss(' + i + ')" style="width:22px;height:22px;border-radius:6px;border:2px solid ' + (active ? '#22c55e' : '#9ca3af') + ';background:' + (active ? '#22c55e' : 'transparent') + ';cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
        (active ? '<span style="color:#fff;font-size:12px;line-height:1">✓</span>' : '') +
      '</div>' +
      '<span style="font-size:18px;flex-shrink:0">' + b.emoji + '</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:11px;font-weight:900;color:var(--text-primary,#374151)">' + b.name + '</div>' +
        '<div style="font-size:10px;color:#9ca3af">Lv.' + b.lvMin + '~' + b.lvMax +
          ' | HP ' + preview.hp + '~' + previewMax.hp +
          ' 공 ' + preview.atk + '~' + previewMax.atk +
          (b.reward_weights ? ' | <span style="color:#f59e0b;font-weight:700">★</span>' : '') + '</div>' +
      '</div>' +
      '<button onclick="_brAdmEditBoss(' + i + ')" style="width:22px;height:22px;border-radius:6px;border:none;background:rgba(59,130,246,0.1);color:#3b82f6;font-size:10px;cursor:pointer;flex-shrink:0">✎</button>' +
    '</div>';
  }).join('');
}

function _brAdmToggleBoss(idx) {
  var b = _brConfig.bosses[idx];
  if (!b) return;
  b.active = b.active === false ? true : false;
  _brRenderBossList();
}

function _brAdmEditBoss(idx) {
  var b = _brConfig.bosses[idx];
  if (!b) return;
  var is = 'background:rgba(0,0,0,0.05);border:1px solid rgba(0,0,0,0.1)';
  var editArea = document.getElementById('brAdmBossEdit');
  if (!editArea) return;
  editArea.innerHTML =
    '<div style="padding:10px;border-radius:10px;background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15)">' +
      '<p style="font-size:11px;font-weight:900;color:#3b82f6;margin-bottom:6px">보스 편집 #' + (idx + 1) + '</p>' +
      '<div style="display:grid;grid-template-columns:40px 1fr;gap:6px;margin-bottom:6px">' +
        '<input type="text" id="brBE_emoji" value="' + b.emoji + '" style="text-align:center;font-size:16px;padding:4px;border-radius:8px;' + is + '">' +
        '<input type="text" id="brBE_name" value="' + b.name + '" style="padding:4px 8px;border-radius:8px;font-size:12px;font-weight:700;' + is + '">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">' +
        '<div><label style="font-size:10px;color:#9ca3af">최소 Lv</label><input type="number" id="brBE_lvMin" value="' + b.lvMin + '" min="1" max="99" style="width:100%;padding:4px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;' + is + '"></div>' +
        '<div><label style="font-size:10px;color:#9ca3af">최대 Lv</label><input type="number" id="brBE_lvMax" value="' + b.lvMax + '" min="1" max="99" style="width:100%;padding:4px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;' + is + '"></div>' +
      '</div>' +
      '<div style="margin-bottom:8px">' +
        '<p style="font-size:10px;color:#9ca3af;margin-bottom:3px">보상 등급 가중치 <span style="color:#d1d5db">(비우면 글로벌 설정)</span></p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px">' +
          '<div><label style="font-size:9px;color:#9ca3af">C등급</label><input type="number" id="brBE_rwC" value="' + (b.reward_weights ? b.reward_weights.C : '') + '" min="0" placeholder="' + _brConfig.reward_weights.C + '" style="width:100%;padding:3px;border-radius:6px;font-size:11px;font-weight:700;text-align:center;' + is + '"></div>' +
          '<div><label style="font-size:9px;color:#9ca3af">B등급</label><input type="number" id="brBE_rwB" value="' + (b.reward_weights ? b.reward_weights.B : '') + '" min="0" placeholder="' + _brConfig.reward_weights.B + '" style="width:100%;padding:3px;border-radius:6px;font-size:11px;font-weight:700;text-align:center;' + is + '"></div>' +
          '<div><label style="font-size:9px;color:#9ca3af">A등급</label><input type="number" id="brBE_rwA" value="' + (b.reward_weights ? b.reward_weights.A : '') + '" min="0" placeholder="' + _brConfig.reward_weights.A + '" style="width:100%;padding:3px;border-radius:6px;font-size:11px;font-weight:700;text-align:center;' + is + '"></div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
        '<button onclick="_brAdmSaveBossEdit(' + idx + ')" style="flex:1;padding:6px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-size:11px;font-weight:700;cursor:pointer">적용</button>' +
        '<button onclick="document.getElementById(\'brAdmBossEdit\').innerHTML=\'\'" style="flex:1;padding:6px;border-radius:8px;border:none;background:rgba(0,0,0,0.06);color:#9ca3af;font-size:11px;font-weight:700;cursor:pointer">취소</button>' +
      '</div>' +
    '</div>';
}

function _brAdmSaveBossEdit(idx) {
  var b = _brConfig.bosses[idx];
  if (!b) return;
  var el = function(id) { return document.getElementById(id); };
  b.emoji = el('brBE_emoji')?.value?.trim() || b.emoji;
  b.name = el('brBE_name')?.value?.trim() || b.name;
  b.lvMin = +(el('brBE_lvMin')?.value) || b.lvMin;
  b.lvMax = +(el('brBE_lvMax')?.value) || b.lvMax;
  if (b.lvMin > b.lvMax) { toast('⚠️', '최소 레벨이 최대보다 높아요'); return; }
  // 보스별 보상 가중치 (값이 있으면 저장, 없으면 삭제=글로벌 사용)
  var rwC = el('brBE_rwC')?.value, rwB = el('brBE_rwB')?.value, rwA = el('brBE_rwA')?.value;
  if (rwC !== '' && rwB !== '' && rwA !== '') {
    b.reward_weights = { C: +rwC || 0, B: +rwB || 0, A: +rwA || 0 };
  } else {
    delete b.reward_weights;
  }
  var editArea = document.getElementById('brAdmBossEdit');
  if (editArea) editArea.innerHTML = '';
  _brRenderBossList();
  toast('✅', b.name + ' 수정됨');
}

function _brAdmAddBoss() {
  _brConfig.bosses.push({ name: '새 보스', emoji: '👾', lvMin: 10, lvMax: 15, active: true });
  _brRenderBossList();
}

async function brAdminOpenSettings() {
  await _brLoadConfig();
  await _brLoadProducts();
  var c = _brConfig;
  var is = 'background:rgba(0,0,0,0.05);border:1px solid rgba(0,0,0,0.1)';

  showModal(`
    <div style="max-width:400px;margin:0 auto;max-height:80vh;overflow-y:auto;padding-right:2px">
      <h2 style="font-size:16px;font-weight:900;color:var(--text-primary,#374151);margin-bottom:12px">🐉 보스레이드 설정</h2>

      <!-- 기본 -->
      <div style="margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:13px;font-weight:700">활성화</span>
          <button id="brAdm_enabled" style="font-size:12px;font-weight:700;padding:3px 10px;border-radius:8px;border:none;cursor:pointer;background:${c.enabled ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'};color:${c.enabled ? '#22c55e' : '#ef4444'}" onclick="this.dataset.val=this.dataset.val==='true'?'false':'true';this.textContent=this.dataset.val==='true'?'ON':'OFF';this.style.background=this.dataset.val==='true'?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)';this.style.color=this.dataset.val==='true'?'#22c55e':'#ef4444'" data-val="${c.enabled}">${c.enabled ? 'ON' : 'OFF'}</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
          <div>
            <label style="font-size:10px;font-weight:700;color:#9ca3af">주간 제한</label>
            <input type="number" id="brAdm_weeklyLimit" value="${c.weekly_limit}" min="1" max="50" style="width:100%;margin-top:2px;padding:5px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;${is}">
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:#9ca3af">SP 최소</label>
            <input type="number" id="brAdm_spMin" value="${c.sp_min}" min="1" max="20" style="width:100%;margin-top:2px;padding:5px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;${is}">
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:#9ca3af">SP 최대</label>
            <input type="number" id="brAdm_spMax" value="${c.sp_max}" min="1" max="30" style="width:100%;margin-top:2px;padding:5px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;${is}">
          </div>
        </div>
        <div style="margin-top:6px">
          <label style="font-size:10px;font-weight:700;color:#9ca3af">보스 스탯 배율</label>
          <input type="number" id="brAdm_bossMult" value="${c.boss_stat_mult}" min="1" max="10" step="0.1" style="width:100%;margin-top:2px;padding:5px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;${is}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">
          <div>
            <label style="font-size:10px;font-weight:700;color:#9ca3af">평타 배율</label>
            <input type="number" id="brAdm_atkMult" value="${c.atk_multiplier || 1.0}" min="0.1" max="10" step="0.1" style="width:100%;margin-top:2px;padding:5px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;${is}">
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:#9ca3af">스킬 배율</label>
            <input type="number" id="brAdm_skillMult" value="${c.skill_multiplier}" min="0.1" max="10" step="0.05" style="width:100%;margin-top:2px;padding:5px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;${is}">
          </div>
        </div>
      </div>

      <!-- 보스 목록 -->
      <div style="margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <p style="font-size:13px;font-weight:900">🐲 보스 목록</p>
          <button onclick="_brAdmAddBoss()" style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:none;background:rgba(59,130,246,0.1);color:#3b82f6;cursor:pointer">+ 추가</button>
        </div>
        <div id="brAdmBossList"></div>
        <div id="brAdmBossEdit" style="margin-top:6px"></div>
      </div>

      <!-- 보상 등급 가중치 -->
      <div style="margin-bottom:12px">
        <p style="font-size:13px;font-weight:900;margin-bottom:6px">🎁 보상 등급 가중치</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
          <div style="text-align:center">
            <label style="font-size:10px;font-weight:700;color:#9ca3af">C등급</label>
            <input type="number" id="brAdm_wC" value="${c.reward_weights.C}" min="0" style="width:100%;margin-top:2px;padding:4px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;${is}">
          </div>
          <div style="text-align:center">
            <label style="font-size:10px;font-weight:700;color:#9ca3af">B등급</label>
            <input type="number" id="brAdm_wB" value="${c.reward_weights.B}" min="0" style="width:100%;margin-top:2px;padding:4px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;${is}">
          </div>
          <div style="text-align:center">
            <label style="font-size:10px;font-weight:700;color:#9ca3af">A등급</label>
            <input type="number" id="brAdm_wA" value="${c.reward_weights.A}" min="0" style="width:100%;margin-top:2px;padding:4px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;${is}">
          </div>
        </div>
      </div>

      <!-- 등급별 보상 -->
      ${['C', 'B', 'A'].map(function(g) {
        var rw = c['reward_' + g];
        return `
        <div style="padding:10px;border-radius:10px;background:rgba(0,0,0,0.03);margin-bottom:8px">
          <p style="font-size:11px;font-weight:900;color:var(--text-secondary,#6b7280);margin-bottom:6px">${g}등급 보상</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
            <div>
              <label style="font-size:10px;color:#9ca3af">도토리 최소</label>
              <input type="number" id="brAdm_r${g}_acMin" value="${rw.acorns[0]}" min="0" style="width:100%;margin-top:2px;padding:4px;border-radius:8px;font-size:11px;font-weight:700;text-align:center;${is}">
            </div>
            <div>
              <label style="font-size:10px;color:#9ca3af">도토리 최대</label>
              <input type="number" id="brAdm_r${g}_acMax" value="${rw.acorns[1]}" min="0" style="width:100%;margin-top:2px;padding:4px;border-radius:8px;font-size:11px;font-weight:700;text-align:center;${is}">
            </div>
          </div>
          <div style="margin-bottom:6px">
            <label style="font-size:10px;color:#9ca3af">아이템 확률 (%)</label>
            <input type="number" id="brAdm_r${g}_itemCh" value="${Math.round((rw.itemChance || 0) * 100)}" min="0" max="100" style="width:100%;margin-top:2px;padding:4px;border-radius:8px;font-size:11px;font-weight:700;text-align:center;${is}">
          </div>
          <div>
            <label style="font-size:10px;color:#9ca3af">드랍 아이템 (클릭으로 선택)</label>
            <div id="brAdm_r${g}_items" style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px"></div>
          </div>
        </div>`;
      }).join('')}

      <!-- 필살기 설정 -->
      <div style="padding:10px;border-radius:10px;background:rgba(0,0,0,0.03);margin-bottom:8px">
        <p style="font-size:11px;font-weight:900;color:var(--text-secondary,#6b7280);margin-bottom:6px">💥 필살기 설정</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div>
            <label style="font-size:10px;color:#9ca3af">다람쥐당 횟수</label>
            <input type="number" id="brAdm_ultiUses" value="${c.ultimate_uses || 1}" min="0" max="10" style="width:100%;margin-top:2px;padding:4px;border-radius:8px;font-size:11px;font-weight:700;text-align:center;${is}">
          </div>
          <div>
            <label style="font-size:10px;color:#9ca3af">데미지 배율 (스킬 x)</label>
            <input type="number" id="brAdm_ultiMult" value="${c.ultimate_mult || 2.0}" min="1" max="10" step="0.1" style="width:100%;margin-top:2px;padding:4px;border-radius:8px;font-size:11px;font-weight:700;text-align:center;${is}">
          </div>
        </div>
      </div>

      <!-- 패배 보상 -->
      <div style="padding:10px;border-radius:10px;background:rgba(0,0,0,0.03);margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <p style="font-size:11px;font-weight:900;color:var(--text-secondary,#6b7280)">💀 패배 보상</p>
          <button id="brAdm_defeatEnabled" style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;border:none;cursor:pointer;background:${c.defeat_reward_enabled ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'};color:${c.defeat_reward_enabled ? '#22c55e' : '#ef4444'}" onclick="this.dataset.val=this.dataset.val==='true'?'false':'true';this.textContent=this.dataset.val==='true'?'ON':'OFF';this.style.background=this.dataset.val==='true'?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)';this.style.color=this.dataset.val==='true'?'#22c55e':'#ef4444'" data-val="${!!c.defeat_reward_enabled}">${c.defeat_reward_enabled ? 'ON' : 'OFF'}</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
          <div>
            <label style="font-size:10px;color:#9ca3af">도토리 최소</label>
            <input type="number" id="brAdm_defAcMin" value="${(c.defeat_acorns || [2, 5])[0]}" min="0" style="width:100%;margin-top:2px;padding:4px;border-radius:8px;font-size:11px;font-weight:700;text-align:center;${is}">
          </div>
          <div>
            <label style="font-size:10px;color:#9ca3af">도토리 최대</label>
            <input type="number" id="brAdm_defAcMax" value="${(c.defeat_acorns || [2, 5])[1]}" min="0" style="width:100%;margin-top:2px;padding:4px;border-radius:8px;font-size:11px;font-weight:700;text-align:center;${is}">
          </div>
        </div>
        <div style="margin-bottom:6px">
          <label style="font-size:10px;color:#9ca3af">아이템 확률 (%)</label>
          <input type="number" id="brAdm_defItemCh" value="${Math.round((c.defeat_itemChance || 0) * 100)}" min="0" max="100" style="width:100%;margin-top:2px;padding:4px;border-radius:8px;font-size:11px;font-weight:700;text-align:center;${is}">
        </div>
        <div>
          <label style="font-size:10px;color:#9ca3af">드랍 아이템 (클릭으로 선택)</label>
          <div id="brAdm_defItems" style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px"></div>
        </div>
      </div>

      <!-- 횟수 리셋 -->
      <div style="padding:10px;border-radius:10px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.15);margin-bottom:8px">
        <p style="font-size:11px;font-weight:900;color:#ef4444;margin-bottom:6px">🔄 주간 참여횟수 리셋</p>
        <div style="display:flex;gap:6px">
          <button onclick="_brAdmResetWeeklyAll()" style="flex:1;padding:6px;border-radius:8px;border:none;background:#ef4444;color:#fff;font-size:11px;font-weight:700;cursor:pointer">전체 리셋</button>
          <button onclick="_brAdmResetWeeklySelf()" style="flex:1;padding:6px;border-radius:8px;border:none;background:rgba(239,68,68,0.15);color:#ef4444;font-size:11px;font-weight:700;cursor:pointer">내 횟수만 리셋</button>
        </div>
      </div>

      <button onclick="brAdminSaveSettings()" style="width:100%;margin-top:8px;padding:12px;border-radius:10px;border:none;background:var(--primary,#8b5cf6);color:#fff;font-size:14px;font-weight:900;cursor:pointer">💾 저장</button>
    </div>
  `);

  // 보스 목록 렌더
  _brRenderBossList();

  // 아이템 칩 렌더
  ['C', 'B', 'A'].forEach(function(g) {
    _brRenderItemChips('brAdm_r' + g + '_items', _brConfig['reward_' + g].items || []);
  });
  _brRenderItemChips('brAdm_defItems', _brConfig.defeat_items || []);
}

async function _brAdmResetWeeklyAll() {
  if (!confirm('모든 사용자의 이번 주 레이드 횟수를 리셋할까요?')) return;
  const weekStart = _brGetWeekStart();
  // RLS 때문에 직접 update 불가 → RPC 사용
  const { error } = await sb.rpc('reset_boss_raid_weekly_all', { p_week_start: weekStart });
  if (error) { toast('❌', '리셋 실패: ' + (error.message || '')); return; }
  toast('✅', '전체 사용자 레이드 횟수가 리셋되었어요');
}

async function _brAdmResetWeeklySelf() {
  const weekStart = _brGetWeekStart();
  const { error } = await sb.from('boss_raid_weekly')
    .update({ raid_count: 0 })
    .eq('user_id', myProfile.id)
    .eq('week_start', weekStart);
  if (error) { toast('❌', '리셋 실패'); return; }
  toast('✅', '내 레이드 횟수가 리셋되었어요');
}

async function brAdminSaveSettings() {
  var el = function(id) { return document.getElementById(id); };

  var settings = {
    ..._brConfig,
    enabled: el('brAdm_enabled').dataset.val === 'true',
    weekly_limit: +el('brAdm_weeklyLimit').value,
    sp_min: +el('brAdm_spMin').value,
    sp_max: +el('brAdm_spMax').value,
    boss_stat_mult: +el('brAdm_bossMult').value,
    atk_multiplier: +el('brAdm_atkMult').value || 1.0,
    skill_multiplier: +el('brAdm_skillMult').value || 1.65,
    // 필살기
    ultimate_uses: +el('brAdm_ultiUses').value || 1,
    ultimate_mult: +el('brAdm_ultiMult').value || 2.0,
    // 패배 보상
    defeat_reward_enabled: el('brAdm_defeatEnabled').dataset.val === 'true',
    defeat_acorns: [+(el('brAdm_defAcMin')?.value) || 0, +(el('brAdm_defAcMax')?.value) || 0],
    defeat_itemChance: (+(el('brAdm_defItemCh')?.value) || 0) / 100,
    defeat_items: _brGetSelectedItems('brAdm_defItems'),
    reward_weights: {
      C: +el('brAdm_wC').value,
      B: +el('brAdm_wB').value,
      A: +el('brAdm_wA').value
    }
  };

  // 등급별 보상 (아이템 칩에서 읽기)
  ['C', 'B', 'A'].forEach(function(g) {
    settings['reward_' + g] = {
      acorns: [+(el('brAdm_r' + g + '_acMin')?.value) || 0, +(el('brAdm_r' + g + '_acMax')?.value) || 0],
      itemChance: (+(el('brAdm_r' + g + '_itemCh')?.value) || 0) / 100,
      items: _brGetSelectedItems('brAdm_r' + g + '_items')
    };
  });

  var { error } = await sb.from('app_settings')
    .upsert({ key: 'boss_raid_settings', value: settings, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  if (error) { toast('❌', '저장 실패'); return; }

  Object.assign(_brConfig, settings);
  toast('✅', '보스레이드 설정 저장 완료');
  closeModal();
}
