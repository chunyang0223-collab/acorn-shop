// ──────────────────────────────────────────────
//  QUEST HELPERS
// ──────────────────────────────────────────────
function getPeriodKey(repeatType) {
  if (repeatType === 'once')   return 'once';
  if (repeatType === 'daily')  return TODAY;
  if (repeatType === 'weekly') return WEEK_KEY;
  return 'once';
}

async function isQuestDone(questId, repeatType, targetCount = 1) {
  const key = getPeriodKey(repeatType);
  const { data } = await sb.from('quest_progress')
    .select('id, progress_count')
    .eq('user_id', myProfile.id).eq('quest_id', questId).eq('period_key', key)
    .maybeSingle();
  if (!data) return false;
  // 모든 퀘스트 progress_count >= targetCount 기준으로 완료 판단
  return (data.progress_count || 0) >= targetCount;
}

async function hasPendingQCR(questId, repeatType) {
  const key = getPeriodKey(repeatType);
  const { data } = await sb.from('quest_completion_requests')
    .select('id').eq('user_id', myProfile.id).eq('quest_id', questId)
    .eq('status', 'pending').eq('period_key', key).maybeSingle();
  return !!data;
}

// quest_progress upsert 전용 헬퍼
async function upsertQuestProgress(userId, questId, periodKey, progressCount) {
  // update 시도 (RLS: 본인 수정 정책 필요)
  const { data: updated } = await sb.from('quest_progress')
    .update({ progress_count: progressCount })
    .eq('user_id', userId).eq('quest_id', questId).eq('period_key', periodKey);

  // update 결과가 없으면(행 없음) insert 시도
  const updatedCount = Array.isArray(updated) ? updated.length : (updated ? 1 : 0);
  if (updatedCount === 0) {
    const { error } = await sb.from('quest_progress')
      .insert({ user_id: userId, quest_id: questId, period_key: periodKey, progress_count: progressCount });
    // insert도 실패(중복)하면 update 재시도
    if (error) {
      await sb.from('quest_progress')
        .update({ progress_count: progressCount })
        .eq('user_id', userId).eq('quest_id', questId).eq('period_key', periodKey);
    }
  }
}

async function markQuestDone(questId, repeatType) {
  const key = getPeriodKey(repeatType);
  // 1회성 퀘스트: progress_count를 target(1)으로 설정
  await upsertQuestProgress(myProfile.id, questId, key, 1);
}

// ──────────────────────────────────────────────
//  AUTO QUEST TRIGGER
// ──────────────────────────────────────────────
// ── 퀘스트 자동완료 트리거 ──────────────────────
// triggerType 목록:
//   'attendance'  - 로그인/출석 시
//   'shopVisit'   - 상점 탭 방문 시
//   'gachaPlay'   - 뽑기 실행 시 (count: 뽑기 횟수)
//   'itemBuy'     - 상점에서 상품 구매 시
//   'itemUse'     - 인벤토리 아이템 사용 신청 시
//   'questSubmit' - 퀘스트 완료 제출 시
//
// 퀘스트 이름/설명에 키워드 포함 여부로 매칭:
//   attendance  → 이름: "출석"  / 설명: "접속","로그인"
//   shopVisit   → 이름: "상점","상품" / 설명: "상점","방문"
//   gachaPlay   → 이름: "뽑기" / 설명: "뽑기"
//   itemBuy     → 이름: "구매" / 설명: "구매","상점에서"
//   itemUse     → 이름: "사용","신청" / 설명: "아이템","사용신청"
//   questSubmit → 이름: "퀘스트","제출" / 설명: "퀘스트","제출"
//
// 횟수 기반 퀘스트: quests.target_count 컬럼 (NULL=1회, N=N회 누적 후 완료)
//   예) target_count=3, 뽑기 퀘스트 → 뽑기를 3번 트리거해야 완료
//       (5회 뽑기 1번 = gachaPlay 1회 카운트, 3이 돼야 완료)
async function triggerAutoQuest(triggerType, count = 1) {
  if (!myProfile || myProfile.is_admin) return;
  const { data: quests } = await sb.from('quests').select('*').eq('active', true).eq('completion_type', 'auto');
  if (!quests) return;

  for (const q of quests) {
    const match =
      (triggerType === 'attendance'    && (q.name.includes('출석') || q.description.includes('접속') || q.description.includes('로그인'))) ||
      (triggerType === 'shopVisit'     && (q.name.includes('상점') || q.name.includes('상품') || q.description.includes('상점') || q.description.includes('방문'))) ||
      (triggerType === 'gachaPlay'     && (q.name.includes('뽑기') || q.description.includes('뽑기'))) ||
      (triggerType === 'itemBuy'       && (q.name.includes('구매') || q.description.includes('구매') || q.description.includes('상점에서'))) ||
      (triggerType === 'itemUse'       && (q.name.includes('사용') || q.name.includes('신청') || q.description.includes('아이템') || q.description.includes('사용신청'))) ||
      (triggerType === 'questSubmit'   && (q.name.includes('퀘스트') || q.name.includes('제출') || q.description.includes('퀘스트') || q.description.includes('제출'))) ||
      (triggerType === 'questComplete' && (q.target_count||1) >= 2 && (q.name.includes('퀘스트') || q.description.includes('퀘스트') || q.description.includes('완료')));
    if (!match) continue;

    const done = await isQuestDone(q.id, q.repeat_type, q.target_count || 1);
    if (done) continue;

    // 횟수 기반 퀘스트 처리
    const target = q.target_count || 1;
    if (target > 1) {
      // quest_progress에서 현재 누적 횟수 확인
      const key = getPeriodKey(q.repeat_type);
      const { data: prog } = await sb.from('quest_progress')
        .select('id, progress_count')
        .eq('user_id', myProfile.id).eq('quest_id', q.id).eq('period_key', key)
        .maybeSingle();

      const current = (prog?.progress_count || 0) + count;
      if (current < target) {
        // 아직 목표 미달 → upsert로 안전하게 카운트 업데이트
        await upsertQuestProgress(myProfile.id, q.id, key, current);
        toast('📋', `${q.name} (${current}/${target})`);
        // 퀘스트 탭이 열려 있으면 즉시 갱신
        if (!document.getElementById('utab-quest')?.classList.contains('hidden')) renderQuests();
        continue;
      }
      // 목표 달성 → "수령 가능" 상태로 저장 (보상은 사용자가 직접 수령)
      await upsertQuestProgress(myProfile.id, q.id, key, target);
    } else {
      // 1회 완료 퀘스트 → "수령 가능" 상태로 저장
      await markQuestDone(q.id, q.repeat_type);
    }

    // 보상 수령 대기 알림 (자동 지급 X)
    await pushNotif(myProfile.id, 'quest', '퀘스트 달성! 🎉', `${q.icon} ${q.name} 달성! 퀘스트 탭에서 보상을 받으세요.`);
    setTimeout(() => toast('🎁', `${q.name} 달성! 퀘스트에서 보상 받기 버튼을 눌러주세요`, 3000), 400);
    // 퀘스트 탭이 열려 있으면 즉시 갱신
    if (!document.getElementById('utab-quest')?.classList.contains('hidden')) renderQuests();
  }
}

// ──────────────────────────────────────────────
//  QUEST (USER)
// ──────────────────────────────────────────────
const repLabel = { once:'1회성', daily:'일일', weekly:'주간' };
const repClass  = { once:'rep-once', daily:'rep-daily', weekly:'rep-weekly' };

async function renderQuests(force = false) {
  const el = document.getElementById('questList');
  // 퀘스트 목록은 캐시, progress/completion은 항상 최신
  let quests = null;
  if (!force && window._questListCache) {
    quests = window._questListCache;
  } else {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">로딩 중...</p>';
    try {
      const token = session?.access_token || SUPABASE_KEY;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/quests?active=eq.true&order=sort_order.asc`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        }
      });
      quests = await res.json();
      if (!Array.isArray(quests)) quests = null;
    } catch(e) {
      const { data } = await sb.from('quests').select('*').eq('active', true).order('sort_order');
      quests = data;
    }
    window._questListCache = quests;
  }
  if (!quests?.length) { el.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">퀘스트가 없어요</p>'; return; }

  const cards = await Promise.all(quests.map(async q => {
    const ct   = q.completion_type || 'approval';
    const done = await isQuestDone(q.id, q.repeat_type, q.target_count || 1);
    const _done = done; // 정렬용
    // 횟수 기반 퀘스트 진행 현황
    let progCount = 0;
    if ((q.target_count||1) > 1) {
      const key = getPeriodKey(q.repeat_type);
      const { data: prog } = await sb.from('quest_progress')
        .select('progress_count')
        .eq('user_id', myProfile.id).eq('quest_id', q.id).eq('period_key', key)
        .maybeSingle();
      progCount = prog?.progress_count || 0;
    }

    if (ct === 'auto') {
      // "달성(보상 수령 가능)" 상태: progress_count >= target 이지만 아직 reward 미지급
      // "완료됨" 상태: quest_completions 테이블에 행 존재
      const key2 = getPeriodKey(q.repeat_type);
      const { data: comp } = await sb.from('quest_completions')
        .select('id').eq('user_id', myProfile.id).eq('quest_id', q.id).eq('period_key', key2)
        .limit(1);
      const claimed = comp && comp.length > 0;
      const claimable = done && !claimed; // 달성했지만 보상 미수령

      const target2 = q.target_count || 1;
      const displayCount = Math.min(progCount, target2);

      let iconBg, iconEmoji, cardStyle, nameClass, statusEl;
      if (claimed) {
        iconBg = 'bg-green-100'; iconEmoji = '✅';
        cardStyle = 'opacity:0.45;filter:grayscale(0.4)';
        nameClass = 'line-through text-gray-400';
        statusEl = '<span class="qs-done">완료됨</span>';
      } else if (claimable) {
        iconBg = 'bg-amber-100'; iconEmoji = '🎁';
        cardStyle = 'border:2px solid #f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,0.15)';
        nameClass = 'text-gray-800';
        statusEl = `<button class="btn btn-primary px-3 py-1.5 text-xs font-black" style="background:linear-gradient(135deg,#f59e0b,#ef4444);border:none" onclick="claimQuestReward('${q.id}')">🎁 보상 받기</button>`;
      } else {
        iconBg = 'bg-amber-50'; iconEmoji = '⚡';
        cardStyle = '';
        nameClass = 'text-gray-800';
        statusEl = '<span class="qs-inprogress">진행중</span>';
      }

      return { done: claimed, claimable, html: `<div class="clay-card p-4 flex items-center gap-3" style="${cardStyle}">
        <div class="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${iconBg}">
          <span class="text-xl">${iconEmoji}</span>
        </div>
        <div class="text-2xl flex-shrink-0">${q.icon}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5 flex-wrap">
            <p class="font-black text-sm ${nameClass}">${q.name}</p>
            <span class="rep-badge ${repClass[q.repeat_type]}">${repLabel[q.repeat_type]}</span>
            <span class="ct-auto">⚡ 자동</span>
          </div>
          <p class="text-xs text-gray-400 font-semibold">${q.description}</p>
          ${target2 > 1 ? `<div class="mt-1.5">
            <div style="background:var(--progress-track-bg);border-radius:999px;height:6px;overflow:hidden">
              <div style="background:${claimable?'#f59e0b':claimed?'#22c55e':'#f59e0b'};height:100%;width:${claimed||claimable?100:Math.min(100,Math.round((displayCount/target2)*100))}%;transition:width .3s;border-radius:999px"></div>
            </div>
            <p class="text-xs text-gray-400 mt-0.5 font-bold">${claimed||claimable?target2:displayCount} / ${target2}회</p>
          </div>` : ''}
        </div>
        <div class="text-right flex-shrink-0">
          <div class="font-black text-amber-600 text-sm">+${q.reward}🌰</div>
          ${statusEl}
        </div>
      </div>` };
    } else {
      const pending = done ? false : await hasPendingQCR(q.id, q.repeat_type);
      const canReq  = !done && !pending;
      return { done: _done, html: `<div class="clay-card p-4 flex items-center gap-3" style="${done?'opacity:0.45;filter:grayscale(0.4)':''}">
        <div class="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${done?'bg-green-100':pending?'bg-yellow-100':'bg-pink-50'}">
          <span class="text-xl">${done?'✅':pending?'⏳':'👤'}</span>
        </div>
        <div class="text-2xl flex-shrink-0">${q.icon}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5 flex-wrap">
            <p class="font-black text-sm ${done?'line-through text-gray-400':'text-gray-800'}">${q.name}</p>
            <span class="rep-badge ${repClass[q.repeat_type]}">${repLabel[q.repeat_type]}</span>
            <span class="ct-approval">👤 승인</span>
          </div>
          <p class="text-xs text-gray-400 font-semibold">${q.description}</p>
        </div>
        <div class="text-right flex-shrink-0 flex flex-col items-end gap-1">
          <div class="font-black text-amber-600 text-sm">+${q.reward}🌰</div>
          ${done?'<span class="qs-done">완료됨</span>':pending?'<span class="qs-pending">승인 대기</span>':canReq?`<button class="btn btn-pink px-3 py-1 text-xs" onclick="requestQuestCompletion('${q.id}')">✋ 완료 요청</button>`:'<span class="qs-inprogress">불가</span>'}
        </div>
      </div>` };
    }
  }));
  // 미완료 먼저, 완료 나중
  cards.sort((a, b) => {
    // 수령 가능 → 진행중 → 완료됨 순서
    const rank = x => x.claimable ? 0 : x.done ? 2 : 1;
    return rank(a) - rank(b);
  });
  el.innerHTML = cards.map(c => c.html).join('');
}

// ── 자동 퀘스트 보상 수령 ────────────────────────
async function claimQuestReward(questId) {
  const { data: q } = await sb.from('quests').select('*').eq('id', questId).maybeSingle();
  if (!q) return;

  // 달성 여부 재확인
  const done = await isQuestDone(questId, q.repeat_type, q.target_count || 1);
  if (!done) { toast('❌', '아직 퀘스트 조건을 달성하지 못했어요!'); return; }

  // 이미 수령했는지 확인
  const key = getPeriodKey(q.repeat_type);
  const { data: comp } = await sb.from('quest_completions')
    .select('id').eq('user_id', myProfile.id).eq('quest_id', questId).eq('period_key', key)
    .limit(1);
  if (comp && comp.length > 0) { toast('⏳', '이미 보상을 받았어요!'); return; }

  // 완료 기록 먼저 저장 (중복 수령 원천 차단 — unique 제약으로 실패 시 중단)
  const { error: insertErr } = await sb.from('quest_completions').insert({
    user_id: myProfile.id, quest_id: questId, period_key: key
  });
  if (insertErr) { toast('⏳', '이미 보상을 받았어요!'); return; }

  // 완료 기록 성공 후 보상 지급
  const res = await sb.rpc('adjust_acorns', {
    p_user_id: myProfile.id, p_amount: q.reward,
    p_reason: `퀘스트 완료 — ${q.name}`
  });
  if (!res.data?.success) { toast('❌', '처리 실패: ' + (res.data?.error || '')); return; }
  myProfile.acorns = res.data.balance;
  updateAcornDisplay();

  // 알림 + 효과
  await pushNotif(myProfile.id, 'quest', '퀘스트 완료! 🎉', `${q.icon} ${q.name} 완료! +${q.reward}🌰`);
  playSound('reward');
  toast('🎉', `${q.name} 완료! +${q.reward}🌰`);
  renderQuests();

  // "퀘스트 N회 완료하기" 퀘스트 카운트
  triggerAutoQuest('questComplete');
}

async function requestQuestCompletion(questId) {
  const { data: q } = await sb.from('quests').select('*').eq('id', questId).single();
  if (!q) return;
  const done    = await isQuestDone(questId, q.repeat_type);
  const pending = await hasPendingQCR(questId, q.repeat_type);
  if (done || pending) { toast('⏳', '이미 처리 중이에요!'); return; }

  const key = getPeriodKey(q.repeat_type);
  await sb.from('quest_completion_requests').insert({
    user_id: myProfile.id, quest_id: questId, status: 'pending', period_key: key
  });
  await pushNotif(myProfile.id, 'quest', '완료 요청 전송! ✋', `${q.icon} ${q.name} 완료 요청을 보냈어요.`);
  toast('✋', `${q.name} 완료 요청 전송!`);
  renderQuests();
}

