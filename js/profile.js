/* ================================================================
   👤 프로필 뷰어 (profile.js)
   ================================================================
   - openProfile(userId) → 모달로 프로필 표시
   - 다람쥐 컬렉션 (5x2 그리드, 등급순 정렬)
   - 미니게임 최고점수, 탐험/보스 통계, 농장 정보
   - 공개/비공개 설정 반영
   ================================================================ */

// ── 프로필 열기 ──
async function openProfile(userId) {
  showModal(`
    <div class="text-center py-6">
      <div class="spinner-sm"></div>
      <p class="text-xs mt-2" style="color:#fbbf24">프로필 불러오는 중...</p>
    </div>`);

  try {
    // 병렬로 데이터 로드
    const [userRes, privacyRes, squirrelRes, expRes, minigameRes, farmRes] = await Promise.all([
      sb.from('users').select('id,display_name,avatar_emoji,acorns,created_at').eq('id', userId).single(),
      sb.from('profile_privacy').select('*').eq('user_id', userId).maybeSingle(),
      sb.from('squirrels').select('*').eq('user_id', userId),
      sb.from('expeditions').select('id,status,loot').eq('user_id', userId),
      sb.from('minigame_plays').select('game_id,score').eq('user_id', userId),
      sb.from('farm_data').select('*').eq('user_id', userId).maybeSingle()
    ]);

    const user = userRes.data;
    if (!user) { closeModal(); toast('❌', '유저를 찾을 수 없어요'); return; }

    const privacy = privacyRes.data || { show_acorns:true, show_squirrels:true, show_minigame:true, show_expedition:true, show_farm:true };
    const squirrels = squirrelRes.data || [];
    const expeditions = expRes.data || [];
    const minigamePlays = minigameRes.data || [];
    const farmData = farmRes.data;

    // 본인 프로필인지 확인 (본인이면 모든 항목 공개)
    const isMe = userId === myProfile.id;

    // ── 프로필 HTML 빌드 ──
    let html = `<div class="pf-modal">`;

    // 헤더
    html += `
      <div class="pf-header">
        <span class="pf-avatar">${user.avatar_emoji || '🐿️'}</span>
        <div>
          <p class="pf-name">${_escHtml(user.display_name || '???')}</p>
          <p class="pf-joined">가입일: ${user.created_at ? new Date(user.created_at).toLocaleDateString('ko-KR') : '???'}</p>
        </div>
      </div>`;

    // 도토리
    if (isMe || privacy.show_acorns) {
      html += `
        <div class="pf-stat-row">
          <span class="pf-stat-icon">🌰</span>
          <span class="pf-stat-label">보유 도토리</span>
          <span class="pf-stat-value">${(user.acorns || 0).toLocaleString()}</span>
        </div>`;
    }

    // 다람쥐 컬렉션 (5x2 그리드)
    if (isMe || privacy.show_squirrels) {
      html += _buildSquirrelGrid(squirrels);
    }

    // 미니게임 최고점수
    if (isMe || privacy.show_minigame) {
      html += _buildMinigameStats(minigamePlays);
    }

    // 탐험 통계
    if (isMe || privacy.show_expedition) {
      html += _buildExpeditionStats(expeditions);
    }

    // 농장 정보
    if (isMe || privacy.show_farm) {
      html += _buildFarmStats(farmData);
    }

    // 본인 프로필: 공개 설정 버튼
    if (isMe) {
      html += `
        <div class="pf-privacy-btn-wrap">
          <button class="btn btn-primary px-4 py-2 text-xs" onclick="openPrivacySettings()">🔒 공개 설정</button>
        </div>`;
    } else {
      // 친구 삭제 버튼
      const friendship = _friendList.find(f => f.id === userId);
      if (friendship) {
        html += `
          <div class="pf-privacy-btn-wrap">
            <button class="btn px-4 py-2 text-xs" style="background:#fee2e2;color:#dc2626;font-weight:800" onclick="removeFriend('${friendship.friendshipId}')">친구 삭제</button>
          </div>`;
      }
    }

    html += `</div>`;
    showModal(html);

  } catch (e) {
    console.error('openProfile error:', e);
    closeModal();
    toast('❌', '프로필을 불러올 수 없어요');
  }
}

// ── 다람쥐 컬렉션 그리드 빌드 ──
function _buildSquirrelGrid(squirrels) {
  // 정렬: 등급 높은 순 → 상태 (explorer > pet > baby) 순
  const gradeOrder = { legend: 0, unique: 1, epic: 2, rare: 3, normal: 4 };
  const statusOrder = { exploring: 0, explorer: 1, recovering: 2, pet: 3, baby: 4 };

  const sorted = [...squirrels].sort((a, b) => {
    const gA = a.status !== 'baby' ? _sqCalcGrade(a) : 'normal';
    const gB = b.status !== 'baby' ? _sqCalcGrade(b) : 'normal';
    const gDiff = (gradeOrder[gA] ?? 5) - (gradeOrder[gB] ?? 5);
    if (gDiff !== 0) return gDiff;
    return (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5);
  });

  // 10칸 고정 (빈 슬롯 포함)
  const maxSlots = _sqSettings?.max_squirrels || 10;
  let gridHtml = '';
  for (let i = 0; i < maxSlots; i++) {
    if (i < sorted.length) {
      const sq = sorted[i];
      const isBaby = sq.status === 'baby';
      const grade = isBaby ? null : _sqCalcGrade(sq);
      const gs = grade ? _sqGradeStyle(grade) : null;
      const spriteBase = sq.sprite || 'sq_acorn';
      const isDefeated = sq.status === 'recovering' || (sq.hp_current !== null && sq.hp_current !== undefined && sq.hp_current <= 0);
      const spriteFile = isDefeated ? spriteBase + '_defeat' : spriteBase;

      // 상태 뱃지
      let statusBadge = '';
      if (sq.status === 'exploring') statusBadge = '<span class="pf-sq-badge pf-sq-badge-exploring">⚔️</span>';
      else if (sq.status === 'recovering') statusBadge = '<span class="pf-sq-badge pf-sq-badge-recovering">😴</span>';
      else if (sq.status === 'pet') statusBadge = '<span class="pf-sq-badge pf-sq-badge-pet">🏡</span>';
      else if (sq.status === 'baby') statusBadge = '<span class="pf-sq-badge pf-sq-badge-baby">🍼</span>';

      // 등급 뱃지
      let gradeBadge = '';
      if (gs) {
        gradeBadge = `<span class="pf-sq-grade" style="color:${gs.color}">${gs.label}</span>`;
      }

      // 이미지
      let imgSrc = isBaby ? 'images/baby-squirrel.png' : `images/squirrels/${spriteFile}.png`;
      let borderStyle = gs ? `${gs.border};box-shadow:${gs.shadow}` : 'border:2px solid #e5e7eb';

      gridHtml += `
        <div class="pf-sq-cell" style="${borderStyle}">
          <img src="${imgSrc}" class="pf-sq-img" onerror="this.outerHTML='<div class=\\'pf-sq-emoji\\'>🐿️</div>'">
          ${statusBadge}
          ${gradeBadge}
          <p class="pf-sq-name">${_escHtml(sq.name || '???')}</p>
        </div>`;
    } else {
      // 빈 슬롯
      gridHtml += `<div class="pf-sq-cell pf-sq-empty"><span class="pf-sq-empty-icon">🫥</span></div>`;
    }
  }

  return `
    <div class="pf-section">
      <p class="pf-section-title">🐿️ 다람쥐 컬렉션 <span style="color:#86efac">${squirrels.length}/${maxSlots}</span></p>
      <div class="pf-sq-grid">${gridHtml}</div>
    </div>`;
}

// ── 미니게임 최고점수 ──
function _buildMinigameStats(plays) {
  const gameNames = { catch: '🎯 도토리 캐치', roulette: '🎰 룰렛', '2048': '🧩 2048' };
  const gameIds = ['catch', 'roulette', '2048'];
  const bestScores = {};

  for (const p of plays) {
    if (!bestScores[p.game_id] || p.score > bestScores[p.game_id]) {
      bestScores[p.game_id] = p.score;
    }
  }

  const rows = gameIds.map(gid => {
    const score = bestScores[gid];
    return `
      <div class="pf-mini-row">
        <span class="pf-mini-name">${gameNames[gid] || gid}</span>
        <span class="pf-mini-score">${score !== undefined ? score.toLocaleString() : '-'}</span>
      </div>`;
  }).join('');

  return `
    <div class="pf-section">
      <p class="pf-section-title">🎮 미니게임 최고점수</p>
      ${rows}
    </div>`;
}

// ── 탐험 통계 ──
function _buildExpeditionStats(expeditions) {
  const totalCompleted = expeditions.filter(e => e.status === 'completed').length;
  const totalRetreated = expeditions.filter(e => e.status === 'retreated').length;

  // 보스 격파 횟수: completed 탐험의 loot에서 boss battle 찾기
  let bossKills = 0;
  for (const exp of expeditions) {
    if (exp.status === 'completed' && exp.loot) {
      // completed = 마지막 보스 타일까지 클리어 = 보스 격파 1회
      bossKills++;
    }
  }

  return `
    <div class="pf-section">
      <p class="pf-section-title">⚔️ 탐험 기록</p>
      <div class="pf-exp-stats">
        <div class="pf-exp-stat">
          <span class="pf-exp-num" style="color:#4ade80">${totalCompleted}</span>
          <span class="pf-exp-label">완료</span>
        </div>
        <div class="pf-exp-stat">
          <span class="pf-exp-num" style="color:#fbbf24">${totalRetreated}</span>
          <span class="pf-exp-label">퇴각</span>
        </div>
        <div class="pf-exp-stat">
          <span class="pf-exp-num" style="color:#f87171">${bossKills}</span>
          <span class="pf-exp-label">보스 격파</span>
        </div>
      </div>
    </div>`;
}

// ── 농장 정보 ──
function _buildFarmStats(farmData) {
  if (!farmData) {
    return `
      <div class="pf-section">
        <p class="pf-section-title">🌾 농장</p>
        <p class="pf-empty-msg">아직 농장을 시작하지 않았어요</p>
      </div>`;
  }

  // farm_data에서 간단 정보 추출
  const level = farmData.level || 1;
  const gold = farmData.gold || 0;

  return `
    <div class="pf-section">
      <p class="pf-section-title">🌾 농장</p>
      <div class="pf-farm-row">
        <div class="pf-farm-stat">
          <span class="pf-farm-icon">⭐</span>
          <span class="pf-farm-label">레벨</span>
          <span class="pf-farm-val">${level}</span>
        </div>
        <div class="pf-farm-stat">
          <span class="pf-farm-icon">💰</span>
          <span class="pf-farm-label">골드</span>
          <span class="pf-farm-val">${gold.toLocaleString()}</span>
        </div>
      </div>
    </div>`;
}

// ══════════════════════════════════════════
//  🔒 공개/비공개 설정 모달
// ══════════════════════════════════════════
async function openPrivacySettings() {
  // 현재 설정 로드
  const { data } = await sb.from('profile_privacy')
    .select('*').eq('user_id', myProfile.id).maybeSingle();
  const p = data || { show_acorns:true, show_squirrels:true, show_minigame:true, show_expedition:true, show_farm:true };

  const fields = [
    { key: 'show_acorns', label: '🌰 보유 도토리', val: p.show_acorns },
    { key: 'show_squirrels', label: '🐿️ 다람쥐 컬렉션', val: p.show_squirrels },
    { key: 'show_minigame', label: '🎮 미니게임 점수', val: p.show_minigame },
    { key: 'show_expedition', label: '⚔️ 탐험 기록', val: p.show_expedition },
    { key: 'show_farm', label: '🌾 농장 정보', val: p.show_farm },
  ];

  showModal(`
    <div class="pf-privacy-modal">
      <h2 class="text-lg font-black mb-3" style="color:var(--text-primary,#1f2937)">🔒 프로필 공개 설정</h2>
      <p class="text-xs mb-4" style="color:#fbbf24">친구에게 어떤 정보를 보여줄지 선택하세요</p>
      <div class="space-y-3">
        ${fields.map(f => `
          <label class="pf-privacy-row">
            <span class="text-sm font-bold" style="color:var(--text-primary,#1f2937)">${f.label}</span>
            <input type="checkbox" class="pf-toggle" data-key="${f.key}" ${f.val ? 'checked' : ''}>
          </label>`).join('')}
      </div>
      <div class="flex gap-2 mt-4">
        <button class="btn btn-primary flex-1" onclick="savePrivacySettings()">저장</button>
        <button class="btn flex-1" onclick="openProfile('${myProfile.id}')">취소</button>
      </div>
    </div>`);
}

async function savePrivacySettings() {
  const toggles = document.querySelectorAll('.pf-toggle');
  const update = { updated_at: new Date().toISOString() };
  toggles.forEach(t => { update[t.dataset.key] = t.checked; });

  const { error } = await sb.from('profile_privacy').upsert({
    user_id: myProfile.id, ...update
  });

  if (error) { toast('❌', '저장 실패'); return; }
  toast('✅', '공개 설정을 저장했어요');
  closeModal();
}

// ── 내 프로필 보기 (마이페이지에서) ──
function openMyProfile() {
  openProfile(myProfile.id);
}
