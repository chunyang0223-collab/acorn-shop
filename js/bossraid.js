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

// ── 설정 로드 ──
async function _brLoadConfig() {
  const { data } = await sb.from('app_settings')
    .select('value').eq('key', 'boss_raid_settings').maybeSingle();
  if (data?.value) Object.assign(_brConfig, data.value);
}

// ── 주간 참여 횟수 확인 ──
function _brGetWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // 월요일
  const mon = new Date(now.setDate(diff));
  return mon.toISOString().slice(0, 10);
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
    _brState = activeRaid;
    _brSubscribe(activeRaid.id);
    _brRenderLobby(container, activeRaid);
    return;
  }

  // 대기 중인 방 목록
  const { data: openRooms } = await sb.from('boss_raids')
    .select('id, host_id, created_at, users!boss_raids_host_id_fkey(display_name, avatar_emoji)')
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
                <span class="text-2xl">${host.avatar_emoji || '🐿️'}</span>
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

  // 상태가 바뀌었을 때만 처리
  const prevStatus = _brState?.status;
  const prevLog = _brState?.battle_log?.length || 0;
  _brState = data;

  if (data.status !== prevStatus || (data.battle_log?.length || 0) !== prevLog) {
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
      const { data } = await sb.from('users').select('display_name, avatar_emoji').eq('id', otherId).single();
      otherUser = data;
    }
  }

  if (seq !== _brLobbySeq) return; // 더 새로운 호출이 있으면 이전 것 폐기

  // 내 다람쥐 목록 로드 (탐험형만 출전 가능)
  const { data: rawSquirrels } = await sb.from('squirrels')
    .select('*')
    .eq('user_id', myProfile.id)
    .eq('status', 'explorer');

  if (seq !== _brLobbySeq) return; // 더 새로운 호출이 있으면 이전 것 폐기

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
          <div class="text-3xl mb-1">${myProfile.avatar_emoji || '🐿️'}</div>
          <p class="text-sm font-black">${myProfile.display_name}</p>
          <p class="text-xs font-bold ${myReady ? 'text-green-500' : 'text-gray-400'}">${myReady ? '✅ 준비완료' : '⏳ 준비 중'}</p>
        </div>

        <div class="br-vs-badge">VS</div>

        <!-- 상대 -->
        <div class="br-player-card ${otherReady ? 'br-ready' : ''}">
          ${otherUser ? `
            <div class="text-3xl mb-1">${otherUser.avatar_emoji || '🐿️'}</div>
            <p class="text-sm font-black">${otherUser.display_name}</p>
            <p class="text-xs font-bold ${otherReady ? 'text-green-500' : 'text-gray-400'}">${otherReady ? '✅ 준비완료' : '⏳ 준비 중'}</p>
          ` : `
            <div class="text-3xl mb-1 opacity-30">❓</div>
            <p class="text-sm font-bold text-gray-400">대기 중...</p>
          `}
        </div>
      </div>
    </div>`;

  // 다람쥐 선택 (상대가 들어온 경우)
  if (raid.guest_id && raid.status === 'selecting' && !myReady) {
    html += `
      <div class="clay-card p-5 mb-4">
        <p class="text-sm font-black text-gray-700 mb-3">🐿️ 다람쥐 2마리를 선택하세요</p>
        <div class="grid grid-cols-3 gap-2" id="brSquirrelGrid">
          ${(mySquirrels || []).map(sq => {
            const selected = mySelectedIds.includes(sq.id);
            const grade = sq.status !== 'baby' ? _sqCalcGrade(sq) : 'normal';
            const gs = _expGradeStyle(grade);
            return `
              <div class="br-sq-pick ${selected ? 'br-sq-selected' : ''}" onclick="_brToggleSquirrel('${sq.id}')" style="${gs.border};box-shadow:${gs.shadow}">
                <img src="images/squirrels/${sq.sprite || 'sq_acorn'}.png" class="br-sq-img" onerror="this.outerHTML='<div class=\\'text-2xl\\'>🐿️</div>'">
                <p class="text-xs font-black mt-1">${_escHtml(sq.name)}</p>
                <p class="text-xs text-gray-400">HP ${sq.stats?.hp || 0} ATK ${sq.stats?.atk || 0}</p>
              </div>`;
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
  if (myReady && !otherReady && raid.status === 'selecting') {
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

  // 파티 구성 (stats가 없을 경우 기본값)
  const ultiMax = _brConfig.ultimate_uses || 1;
  const party = squirrels.map(sq => {
    const stats = sq.stats || { hp: 50, atk: 10, def: 5 };
    return {
      id: sq.id,
      name: sq.name,
      sprite: sq.sprite || 'sq_acorn',
      owner: hostSqIds.includes(sq.id) ? 'host' : 'guest',
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
        dmg = Math.max(1, sq.atk - Math.floor(boss.def * _brConfig.mon_def_effect / 100)) + _brRand(-_brConfig.atk_swing, _brConfig.atk_swing);
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

  const boss = initEntry.boss;
  const party = initEntry.party;

  container.innerHTML = `
    <div class="br-battle-wrap">
      <!-- 보스 영역 -->
      <div class="br-boss-area">
        <div class="br-boss-emoji" id="brBossEmoji">${boss.emoji}</div>
        <div class="br-boss-info">
          <p class="text-sm font-black">${boss.name} <span class="text-xs text-gray-400">Lv.${boss.lv}</span></p>
          <div class="br-hp-track">
            <div class="br-hp-bar br-hp-boss" id="brBossHpBar" style="width:100%"></div>
          </div>
          <p class="text-xs text-gray-400" id="brBossHpText">${boss.hp} / ${boss.maxHp}</p>
        </div>
      </div>

      <!-- 파티 -->
      <div class="br-party-grid">
        ${party.map((sq, i) => `
          <div class="br-pc-card" id="brPc${i}">
            <img src="images/squirrels/${sq.sprite}.png" class="br-pc-img" onerror="this.outerHTML='<div class=\\'text-xl\\'>🐿️</div>'">
            <p class="text-xs font-black">${sq.name}</p>
            <div class="br-hp-track br-hp-sm">
              <div class="br-hp-bar br-hp-ally" id="brPcHp${i}" style="width:100%"></div>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- 로그 -->
      <div class="br-log-panel" id="brLogPanel"></div>

      <!-- SP -->
      <div class="text-center mt-2">
        <span class="text-xs font-bold text-amber-500" id="brSpText">✨ SP: ${initEntry.sp}</span>
      </div>
    </div>`;

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

  // init, msg 엔트리는 빠르게 스킵
  const skipTypes = ['init'];

  _brReplayTimer = setInterval(() => {
    if (idx >= log.length) {
      clearInterval(_brReplayTimer);
      _brReplayTimer = null;
      if (typeof _sndStopBGM === 'function') _sndStopBGM();
      // 전투 끝 → 결과 표시
      setTimeout(() => {
        if (_brState) _brRenderResult(document.getElementById('utab-bossraid'), _brState);
      }, 1200);
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
    } else if (entry.type === 'result') {
      if (typeof _btlSound === 'function') _btlSound(entry.result === 'victory' ? 'victory' : 'defeat');
    }

    // 보스 HP 업데이트
    if (entry.type === 'boss_hp') {
      const pct = Math.max(0, entry.hp / entry.maxHp * 100);
      const bar = document.getElementById('brBossHpBar');
      const txt = document.getElementById('brBossHpText');
      if (bar) bar.style.width = pct + '%';
      if (txt) txt.textContent = `${Math.max(0, entry.hp)} / ${entry.maxHp}`;

      // 보스 흔들림
      const bossEl = document.getElementById('brBossEmoji');
      if (bossEl) {
        bossEl.classList.add('br-shaking');
        setTimeout(() => bossEl.classList.remove('br-shaking'), 300);
      }
    }

    // 공격/스킬/필살기 시 공격자 하이라이트
    if (entry.type === 'attack' || entry.type === 'skill' || entry.type === 'ultimate') {
      const sqIdx = partyInit.findIndex(p => p.id === entry.sqId);
      if (sqIdx >= 0) {
        const card = document.getElementById('brPc' + sqIdx);
        if (card) {
          card.classList.add('br-attacking');
          if (entry.type === 'ultimate') card.classList.add('br-ultimate-glow');
          setTimeout(() => {
            card.classList.remove('br-attacking');
            card.classList.remove('br-ultimate-glow');
          }, entry.type === 'ultimate' ? 500 : 300);
        }
      }
      // SP 업데이트
      if (entry.type === 'skill' && entry.spLeft !== undefined) {
        const spEl = document.getElementById('brSpText');
        if (spEl) spEl.textContent = `✨ SP: ${entry.spLeft}`;
      }
    }

    // 보스 반격 시 타겟 피격
    if (entry.type === 'boss_attack') {
      const tIdx = partyInit.findIndex(p => p.id === entry.targetId);
      if (tIdx >= 0) {
        const card = document.getElementById('brPc' + tIdx);
        if (card) {
          card.classList.add('br-hit');
          setTimeout(() => card.classList.remove('br-hit'), 300);
        }
        // HP 바 업데이트
        const hpBar = document.getElementById('brPcHp' + tIdx);
        if (hpBar) {
          const pct = Math.max(0, entry.targetHp / entry.targetMaxHp * 100);
          hpBar.style.width = pct + '%';
        }
        // 사망 처리
        if (!entry.targetAlive) {
          if (card) card.classList.add('br-dead');
        }
      }
    }

  }, 470); // 1.7배속 (800 / 1.7 ≈ 470ms)
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
  if (_brReplayTimer) { clearInterval(_brReplayTimer); _brReplayTimer = null; }
  if (typeof _sndStopBGM === 'function') _sndStopBGM();

  const isHost = raid.host_id === myProfile.id;
  const myRewarded = isHost ? raid.host_rewarded : raid.guest_rewarded;
  const isVictory = raid.result === 'victory';

  // 결과 사운드
  if (typeof _btlSound === 'function') _btlSound(isVictory ? 'victory' : 'defeat');

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

  if (!isVictory) {
    // 패배 보상 여부 확인
    const defeatReward = _brConfig.defeat_reward_enabled;
    let defeatAcorns = 0;
    let defeatItem = null;
    if (defeatReward) {
      const dAcMin = (_brConfig.defeat_acorns || [2, 5])[0] || 0;
      const dAcMax = (_brConfig.defeat_acorns || [2, 5])[1] || 0;
      defeatAcorns = _brRand(dAcMin, dAcMax);
      const dItemCh = _brConfig.defeat_itemChance || 0;
      const dItems = _brConfig.defeat_items || [];
      if (Math.random() < dItemCh && dItems.length > 0) {
        const raw = dItems[Math.floor(Math.random() * dItems.length)];
        if (typeof raw === 'object' && raw.name) {
          defeatItem = { icon: raw.icon || '🎁', name: raw.name };
        } else {
          const parts = (raw + '').split(' ');
          defeatItem = { icon: parts[0], name: parts.slice(1).join(' ') };
        }
      }
    }

    const defeatRewardText = defeatReward
      ? `<p class="text-sm font-bold text-amber-400 mt-2">위로 보상: 🌰 ${defeatAcorns}개${defeatItem ? ' + ' + defeatItem.icon + ' ' + defeatItem.name : ''}</p>`
      : '';

    container.innerHTML = `
      <div class="clay-card p-6 text-center">
        <div class="text-5xl mb-3">💀</div>
        <h2 class="text-xl font-black mb-2" style="color:#ef4444">패배...</h2>
        <p class="text-sm text-gray-400 font-semibold mb-2">보스에게 패배했어요. 다음에 다시 도전하세요!</p>
        ${defeatRewardText}
        <button class="btn btn-primary px-8 py-3 mt-4" onclick="_brFinish()">돌아가기</button>
      </div>`;

    // 패배 처리 (중복 방지 플래그)
    if (!_brWeeklyDone) {
      _brWeeklyDone = true;
      await _brIncrementWeekly();

      // 패배 보상 지급
      if (defeatReward && defeatAcorns > 0) {
        await sb.rpc('adjust_acorns', {
          p_user_id: myProfile.id,
          p_amount: defeatAcorns,
          p_reason: '보스레이드 패배 위로 보상'
        });
        if (typeof updateAcornDisplay === 'function') updateAcornDisplay();
      }
      if (defeatReward && defeatItem) {
        const { data: product } = await sb.from('products')
          .select('id').eq('name', defeatItem.name).maybeSingle();
        await sb.from('inventory').insert({
          user_id: myProfile.id,
          product_id: product?.id || null,
          product_snapshot: { name: defeatItem.name, icon: defeatItem.icon, from: 'boss_raid_defeat' },
          from_gacha: false,
          status: 'held'
        });
      }

      await sb.from('boss_raids').update({
        [isHost ? 'host_rewarded' : 'guest_rewarded']: true,
        status: 'finished'
      }).eq('id', raid.id);
    }
    return;
  }

  // 승리 → 카드 뒤집기 보상
  const cards = [
    _brGenReward(_brPickGrade()),
    _brGenReward(_brPickGrade()),
    _brGenReward(_brPickGrade())
  ];

  container.innerHTML = `
    <div class="clay-card p-6 text-center">
      <div class="text-5xl mb-3">🎉</div>
      <h2 class="text-xl font-black mb-2" style="color:#22c55e">보스 격파!</h2>
      <p class="text-sm text-gray-400 font-semibold mb-4">카드를 선택해서 보상을 받으세요!</p>
      <div class="br-card-row">
        ${cards.map((c, i) => `
          <div class="br-reward-card" id="brCard${i}" onclick="_brSelectCard(${i})">
            <div class="br-card-back">🎁</div>
            <div class="br-card-front br-grade-${c.grade.toLowerCase()}">
              <p class="text-lg font-black">${c.grade}등급</p>
              ${c.item ? `<p class="text-sm">${c.item.icon} ${c.item.name}</p>` : ''}
              <p class="text-sm font-bold text-amber-500">🌰 ${c.acorns}</p>
            </div>
          </div>
        `).join('')}
      </div>
      <div id="brRewardResult" class="mt-4 hidden"></div>
    </div>`;

  // 카드 데이터를 임시 저장
  window._brCards = cards;
}

function _brPickGrade() {
  const w = _brConfig.reward_weights;
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

  // 카드 뒤집기 사운드 + 애니메이션
  if (typeof _btlSound === 'function') _btlSound('cardFlip');
  for (let i = 0; i < 3; i++) {
    const el = document.getElementById('brCard' + i);
    if (!el) continue;
    if (i === idx) {
      el.classList.add('br-card-chosen');
    } else {
      el.classList.add('br-card-unchosen');
    }
  }

  // 결과 표시
  const resultEl = document.getElementById('brRewardResult');
  if (resultEl) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `
      <p class="text-lg font-black mb-2" style="color:#fbbf24">${chosen.grade}등급 획득!</p>
      <p class="text-sm font-bold">${chosen.item ? chosen.item.icon + ' ' + chosen.item.name + ' + ' : ''}🌰 ${chosen.acorns}개</p>
      <button class="btn btn-primary px-8 py-3 mt-4" onclick="_brClaimReward(${idx})">보상 수령</button>
    `;
  }

  window._brCards = null; // 중복 클릭 방지
  window._brChosenCard = chosen;
}

async function _brClaimReward(idx) {
  const chosen = window._brChosenCard;
  if (!chosen || !_brState) return;

  const isHost = _brState.host_id === myProfile.id;

  // 도토리 지급
  await sb.rpc('adjust_acorns', {
    p_user_id: myProfile.id,
    p_amount: chosen.acorns,
    p_reason: '보스레이드 보상'
  });

  // 아이템 지급
  if (chosen.item) {
    // products에서 이름으로 검색, 없으면 스냅샷으로 저장
    const { data: product } = await sb.from('products')
      .select('id').eq('name', chosen.item.name).maybeSingle();

    await sb.from('inventory').insert({
      user_id: myProfile.id,
      product_id: product?.id || null,
      product_snapshot: { name: chosen.item.name, icon: chosen.item.icon, from: 'boss_raid' },
      from_gacha: false,
      status: 'held'
    });
  }

  // 주간 횟수 증가 (중복 방지)
  if (!_brWeeklyDone) {
    _brWeeklyDone = true;
    await _brIncrementWeekly();
  }

  // 보상 수령 완료 표시
  await sb.from('boss_raids').update({
    [isHost ? 'host_rewarded' : 'guest_rewarded']: true
  }).eq('id', _brState.id);

  // 양쪽 다 보상 수령했으면 finished
  const { data: latest } = await sb.from('boss_raids')
    .select('host_rewarded, guest_rewarded').eq('id', _brState.id).single();
  if (latest.host_rewarded && latest.guest_rewarded) {
    await sb.from('boss_raids').update({ status: 'finished' }).eq('id', _brState.id);
  }

  // 도토리 표시 갱신
  updateAcornDisplay();

  if (typeof _btlSound === 'function') _btlSound('reward');
  toast('🎉', `보상 수령 완료! 🌰 ${chosen.acorns}개${chosen.item ? ' + ' + chosen.item.icon + chosen.item.name : ''}`);
  _brFinish();
}

async function _brFinish() {
  _brUnsubscribe();
  _brState = null;
  _brWeeklyDone = false;
  _brBotSquirrels = null;
  window._brCards = null;
  window._brChosenCard = null;
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
          ' 공 ' + preview.atk + '~' + previewMax.atk + '</div>' +
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
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">' +
        '<div><label style="font-size:10px;color:#9ca3af">최소 Lv</label><input type="number" id="brBE_lvMin" value="' + b.lvMin + '" min="1" max="99" style="width:100%;padding:4px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;' + is + '"></div>' +
        '<div><label style="font-size:10px;color:#9ca3af">최대 Lv</label><input type="number" id="brBE_lvMax" value="' + b.lvMax + '" min="1" max="99" style="width:100%;padding:4px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;' + is + '"></div>' +
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
  const { error } = await sb.from('boss_raid_weekly')
    .update({ raid_count: 0 })
    .eq('week_start', weekStart);
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
