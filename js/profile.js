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
      <p class="text-xs mt-2" style="color:var(--p-amber-400)">프로필 불러오는 중...</p>
    </div>`);

  try {
    // 다람쥐 등급 계산에 필요한 설정 로드 (탭 미진입 시 기본값 문제 방지)
    if (typeof sqLoadSettings === 'function') await sqLoadSettings();

    // 병렬로 데이터 로드
    const [userRes, privacyRes, squirrelRes, expRes, minigameRes, farmRes, plotsRes, cropsRes] = await Promise.all([
      sb.from('users').select('id,display_name,avatar_emoji,profile_icon,acorns,created_at').eq('id', userId).single(),
      sb.from('profile_privacy').select('*').eq('user_id', userId).maybeSingle(),
      sb.from('squirrels').select('*').eq('user_id', userId),
      sb.from('expeditions').select('id,status,loot').eq('user_id', userId),
      sb.from('minigame_plays').select('game_id,score').eq('user_id', userId),
      sb.from('farm_data').select('*').eq('user_id', userId).maybeSingle(),
      sb.from('farm_plots').select('slot,crop_id,harvest_at').eq('user_id', userId).order('slot'),
      sb.from('farm_crops').select('id,name,emoji').eq('enabled', true)
    ]);

    const user = userRes.data;
    if (!user) { closeModal(); toast('❌', '유저를 찾을 수 없어요'); return; }

    const privacy = privacyRes.data || { show_acorns:true, show_squirrels:true, show_minigame:true, show_expedition:true, show_farm:true };
    const squirrels = squirrelRes.data || [];
    const expeditions = expRes.data || [];
    const minigamePlays = minigameRes.data || [];
    const farmData = farmRes.data;
    if (plotsRes.error) console.warn('[profile] farm_plots query error:', plotsRes.error.message);
    if (cropsRes.error) console.warn('[profile] farm_crops query error:', cropsRes.error.message);
    const farmPlots = plotsRes.data || [];
    const farmCrops = cropsRes.data || [];

    // 본인 프로필인지 확인 (본인이면 모든 항목 공개)
    const isMe = userId === myProfile.id;

    // ── 프로필 HTML 빌드 ──
    let html = `<div class="pf-modal">`;

    // 헤더 + 공개설정 버튼 (본인 프로필일 때 우측 배치)
    html += `
      <div class="pf-header">
        <span class="pf-avatar">${_avatarHtml(user, '3.5rem')}</span>
        <div class="pf-header-info">
          <div class="pf-name-row">
            <p class="pf-name" id="pfNameLabel">${_escHtml(user.display_name || '???')}</p>
            ${isMe ? '<button class="pf-edit-name-btn" onclick="openNicknameEditor()" title="닉네임 변경">✏️</button>' : ''}
          </div>
          <p class="pf-joined">가입일: ${user.created_at ? new Date(user.created_at).toLocaleDateString('ko-KR') : '???'}</p>
        </div>
        ${isMe ? '<button class="btn btn-primary px-4 py-2 text-xs pf-privacy-btn" onclick="openPrivacySettings()">🔒 공개 설정</button>' : ''}
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
      html += _buildFarmStats(farmData, farmPlots, farmCrops);
    }

    // 타인 프로필: 친구 삭제 버튼
    if (!isMe) {
      const friendship = _friendList.find(f => f.id === userId);
      if (friendship) {
        html += `
          <div class="pf-privacy-btn-wrap">
            <button class="btn px-4 py-2 text-xs" style="background:var(--bg-red-muted);color:var(--p-red-600);font-weight:800" onclick="removeFriend('${friendship.friendshipId}')">친구 삭제</button>
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
  const statusOrder = { exploring: 0, idle: 1, recovering: 2 };

  const sorted = [...squirrels].sort((a, b) => {
    const gA = a.type !== 'baby' ? _sqCalcGrade(a) : 'normal';
    const gB = b.type !== 'baby' ? _sqCalcGrade(b) : 'normal';
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
      const isBaby = sq.type === 'baby';
      const grade = isBaby ? null : _sqCalcGrade(sq);
      const gs = grade ? _sqGradeStyle(grade) : null;
      const spriteBase = sq.sprite || 'sq_acorn';
      const isDefeated = sq.status === 'recovering' || (sq.hp_current !== null && sq.hp_current !== undefined && sq.hp_current <= 0);
      const spriteFile = isDefeated ? spriteBase + '_defeat' : spriteBase;

      // 상태 뱃지
      let statusBadge = '';
      if (sq.status === 'exploring') statusBadge = '<span class="pf-sq-badge pf-sq-badge-exploring">⚔️</span>';
      else if (sq.status === 'recovering') statusBadge = '<span class="pf-sq-badge pf-sq-badge-recovering">😴</span>';
      else if (sq.type === 'pet') statusBadge = '<span class="pf-sq-badge pf-sq-badge-pet">🏡</span>';
      else if (sq.type === 'baby') statusBadge = '<span class="pf-sq-badge pf-sq-badge-baby">🍼</span>';

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
      gridHtml += `<div class="pf-sq-cell pf-sq-empty"></div>`;
    }
  }

  return `
    <div class="pf-section">
      <p class="pf-section-title">🐿️ 다람쥐 컬렉션 <span style="color:var(--p-green-300)">${squirrels.length}/${maxSlots}</span></p>
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
    const icon = gameNames[gid]?.split(' ')[0] || '🎮';
    const name = (gameNames[gid] || gid).replace(/^[^\s]+\s/, '');
    return `
      <div class="pf-mini-card">
        <span class="pf-mini-card-icon">${icon}</span>
        <span class="pf-mini-card-name">${name}</span>
        <span class="pf-mini-card-score">${score !== undefined ? score.toLocaleString() : '-'}</span>
      </div>`;
  }).join('');

  return `
    <div class="pf-section">
      <p class="pf-section-title">🎮 미니게임 최고점수</p>
      <div class="pf-mini-grid">${rows}</div>
    </div>`;
}

// ── 탐험 통계 ──
function _buildExpeditionStats(expeditions) {
  const totalCompleted = expeditions.filter(e => e.status === 'completed').length;
  const totalRetreated = expeditions.filter(e => e.status === 'retreated').length;

  // 몬스터 격퇴: 모든 탐험의 loot에서 battle 타입 카운트 (보스 포함 전체 전투 승리)
  let totalBattles = 0;
  for (const exp of expeditions) {
    if (Array.isArray(exp.loot)) {
      totalBattles += exp.loot.filter(l => l.type === 'battle').length;
    }
  }

  return `
    <div class="pf-section">
      <p class="pf-section-title">⚔️ 탐험 기록</p>
      <div class="pf-exp-stats">
        <div class="pf-exp-stat pf-exp-stat--boss">
          <span class="pf-exp-icon">⚔️</span>
          <span class="pf-exp-num">${totalBattles}</span>
          <span class="pf-exp-label">몬스터 격퇴</span>
        </div>
        <div class="pf-exp-stat pf-exp-stat--retreat">
          <span class="pf-exp-icon">🏃</span>
          <span class="pf-exp-num">${totalRetreated}</span>
          <span class="pf-exp-label">퇴각</span>
        </div>
        <div class="pf-exp-stat pf-exp-stat--clear">
          <span class="pf-exp-icon">🏆</span>
          <span class="pf-exp-num">${totalCompleted}</span>
          <span class="pf-exp-label">완료</span>
        </div>
      </div>
    </div>`;
}

// ── 농장 정보 ──
function _buildFarmStats(farmData, plots, crops) {
  if (!farmData) {
    return `
      <div class="pf-section">
        <p class="pf-section-title">🌾 농장</p>
        <p class="pf-empty-msg">아직 농장을 시작하지 않았어요</p>
      </div>`;
  }

  const activePlots = (plots || []).filter(p => p.crop_id);
  const totalSlots = farmData.plots_unlocked || plots?.length || 4;

  let plotsHtml = '';
  if (activePlots.length === 0) {
    plotsHtml = '<p class="pf-empty-msg" style="margin:8px 0 0">현재 키우는 작물이 없어요</p>';
  } else {
    plotsHtml = '<div class="pf-farm-crop-grid">';
    for (const plot of activePlots) {
      const crop = (crops || []).find(c => c.id === plot.crop_id);
      const emoji = crop?.emoji || '🌱';
      const name = crop?.name || '작물';
      const now = Date.now();
      const harvestAt = plot.harvest_at ? new Date(plot.harvest_at).getTime() : 0;
      const ready = harvestAt > 0 && harvestAt <= now;
      const statusText = ready ? '수확 가능' : (harvestAt > 0 ? '성장 중' : '심은 직후');
      const statusColor = ready ? '#16a34a' : '#f59e0b';

      plotsHtml += `
        <div class="pf-farm-crop-card">
          <span style="font-size:24px;line-height:1">${emoji}</span>
          <span class="pf-farm-crop-name">${_escHtml(name)}</span>
          <span class="pf-farm-crop-status" style="color:${statusColor}">${statusText}</span>
        </div>`;
    }
    plotsHtml += '</div>';
  }

  return `
    <div class="pf-section">
      <p class="pf-section-title">🌾 농장 <span style="color:var(--p-green-300)">${activePlots.length}/${totalSlots} 칸 사용 중</span></p>
      ${plotsHtml}
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
      <h2 class="text-lg font-black mb-3 fr-text">🔒 프로필 공개 설정</h2>
      <p class="text-xs mb-4" style="color:var(--p-amber-400)">친구에게 어떤 정보를 보여줄지 선택하세요</p>
      <div class="space-y-3">
        ${fields.map(f => `
          <label class="pf-privacy-row">
            <span class="text-sm font-bold fr-text">${f.label}</span>
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

// ── 닉네임 변경 ──
function openNicknameEditor() {
  const cur = myProfile.display_name || '';
  showModal(`
    <div class="pf-nick-editor">
      <p class="pf-nick-title">닉네임 변경</p>
      <input id="nickInput" class="pf-nick-input" type="text" maxlength="12"
        value="${_escHtml(cur)}" placeholder="새 닉네임 입력" autocomplete="off" spellcheck="false">
      <p class="pf-nick-hint" id="nickHint">2~12자, 특수문자 불가</p>
      <div class="pf-nick-actions">
        <button class="pf-nick-cancel" onclick="openMyProfile()">취소</button>
        <button class="pf-nick-save" id="nickSaveBtn" onclick="saveNickname()">변경</button>
      </div>
    </div>`);
  const inp = document.getElementById('nickInput');
  if (inp) { inp.focus(); inp.select(); }
}

async function saveNickname() {
  const inp = document.getElementById('nickInput');
  const hint = document.getElementById('nickHint');
  const btn = document.getElementById('nickSaveBtn');
  if (!inp || !btn) return;

  const name = inp.value.trim();
  const cur = myProfile.display_name || '';

  // 유효성 검사
  if (name === cur) { hint.textContent = '현재 닉네임과 동일해요'; hint.className = 'pf-nick-hint error'; return; }
  if (name.length < 2 || name.length > 12) { hint.textContent = '2~12자로 입력해주세요'; hint.className = 'pf-nick-hint error'; return; }
  if (/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ _]/.test(name)) { hint.textContent = '한글, 영문, 숫자, 띄어쓰기만 가능해요'; hint.className = 'pf-nick-hint error'; return; }

  // 중복 검사
  btn.disabled = true;
  btn.textContent = '확인 중...';
  hint.textContent = '';
  hint.className = 'pf-nick-hint';

  const { data: existing } = await sb.from('users')
    .select('id').ilike('display_name', name).neq('id', myProfile.id).limit(1);

  if (existing && existing.length > 0) {
    hint.textContent = '이미 사용 중인 닉네임이에요';
    hint.className = 'pf-nick-hint error';
    btn.disabled = false; btn.textContent = '변경';
    return;
  }

  // 저장
  btn.textContent = '저장 중...';
  const { error } = await sb.from('users').update({ display_name: name }).eq('id', myProfile.id);
  if (error) {
    hint.textContent = '저장 실패: ' + (error.message || '');
    hint.className = 'pf-nick-hint error';
    btn.disabled = false; btn.textContent = '변경';
    return;
  }

  // 성공 → 로컬 프로필 갱신 + UI 반영
  myProfile.display_name = name;
  document.getElementById('headerUserLabel').textContent = name;
  closeModal();
  toast('✅', '닉네임이 변경되었어요!');
  if (typeof renderMypage === 'function') renderMypage();
}
