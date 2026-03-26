/* ================================================================
   🌾 다람쥐 농사 시스템 (farm.js)
   ================================================================
   - 농부 전직 (수습 농부 시스템)
   - 농사 상점 / 시세
   - 밭 관리 / 파종 / 수확
   - 인벤토리 / 예치금
   ================================================================ */

// ── 전역 상태 ──
var _farmData = null;      // farm_data 레코드
var _farmSettings = {};    // farm_settings
var _farmCrops = [];       // farm_crops 목록
var _farmPrices = [];      // 현재 시세
var _farmPlots = [];       // 내 밭 목록
var _farmInventory = [];   // 내 인벤토리
var _farmTimer = null;     // 수습/수확 타이머 인터벌

// ── 설정 로드 ──
async function farmLoadSettings() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'farm_settings').maybeSingle();
  _farmSettings = data?.value || {};
}

// ── 농사 탭 진입 ──
async function sqFarmInit() {
  const area = document.getElementById('sqFarmArea');
  if (!area) return;
  area.innerHTML = '<div class="text-center py-8 text-gray-400 text-sm">로딩 중...</div>';

  try {
    await farmLoadSettings();

    // 작물 목록 로드
    const { data: crops } = await sb.from('farm_crops').select('*').eq('enabled', true).order('sort_order');
    _farmCrops = crops || [];

    // 내 농장 데이터 로드
    const { data: farmData } = await sb.from('farm_data').select('*').eq('user_id', myProfile.id).maybeSingle();
    _farmData = farmData;

    // 분기: 농부가 없으면 전직 화면, 있으면 농장 메인
    if (!_farmData || _farmData.farmer_status === 'none') {
      farmRenderJobChange();
    } else if (_farmData.farmer_status === 'apprentice') {
      farmRenderApprentice();
    } else {
      farmRenderMain();
    }
  } catch (e) {
    console.error('[farm]', e);
    area.innerHTML = '<div class="text-center py-8 text-red-400 text-sm">농장 로딩 실패</div>';
  }
}

// ================================================================
//  농부 전직 화면
// ================================================================
function farmRenderJobChange() {
  const area = document.getElementById('sqFarmArea');
  if (!area) return;

  // 애완형 다람쥐 목록
  const petSquirrels = _sqSquirrels.filter(sq => sq.status === 'pet');

  area.innerHTML = `
    <div class="clay-card p-5 text-center mb-4">
      <div style="font-size:48px;margin-bottom:8px">🌾</div>
      <div class="title-font text-lg text-gray-700 mb-2">다람쥐 농장</div>
      <div class="text-sm text-gray-500 mb-4">농사를 시작하려면 농부 다람쥐가 필요해요!<br>애완형 다람쥐를 수습 농부로 보내보세요.</div>
    </div>
    <div class="clay-card p-5">
      <div class="title-font text-sm text-gray-700 mb-3">🐿️ 수습 농부 보내기</div>
      ${petSquirrels.length === 0 ? `
        <div class="text-center py-4">
          <div style="font-size:32px;margin-bottom:8px">😢</div>
          <div class="text-sm text-gray-400">애완형 다람쥐가 없어요.<br>펫샵에서 다람쥐를 분양받아 성장시켜주세요!</div>
        </div>
      ` : `
        <div class="text-xs text-gray-400 mb-3">수습 기간 ${_farmSettings.apprentice_hours || 4}시간 후, ${_farmSettings.apprentice_success_pct || 50}% 확률로 농부가 됩니다.<br>실패해도 도토리 ${(_farmSettings.apprentice_fail_reward || 500) / 100}개를 보상으로 받아요!</div>
        <div id="farmPetList" style="display:flex;flex-direction:column;gap:8px">
          ${petSquirrels.map(sq => {
            const grade = _sqCalcGrade(sq);
            const gs = _sqGradeStyle(grade);
            const spriteFile = sq.sprite || 'sq_acorn';
            return `
              <div onclick="farmStartApprentice('${sq.id}')" style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:white;border:2px solid #e5e7eb;cursor:pointer;transition:all .15s;box-shadow:0 2px 8px rgba(0,0,0,0.04)" onmouseover="this.style.borderColor='${gs.color}'" onmouseout="this.style.borderColor='#e5e7eb'">
                <div style="border-radius:12px;${gs.border};padding:2px;background:${gs.bg};flex-shrink:0">
                  <img src="images/squirrels/${spriteFile}.png" style="width:44px;height:44px;object-fit:contain;border-radius:10px;display:block" onerror="this.outerHTML='<div style=\\'font-size:32px;line-height:44px;text-align:center\\'>🐱</div>'">
                </div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:900;color:#1f2937">${sq.name}</div>
                  <div style="font-size:11px;font-weight:700;color:${gs.color}">${gs.label} · 애완형</div>
                  <div style="font-size:10px;color:#9ca3af">HP ${sq.hp_current} / ATK ${sq.stats?.atk || '?'} / DEF ${sq.stats?.def || '?'}</div>
                </div>
                <div style="font-size:12px;font-weight:800;color:#f59e0b">수습 보내기 →</div>
              </div>`;
          }).join('')}
        </div>
      `}
    </div>`;
}

// ── 수습 시작 ──
async function farmStartApprentice(squirrelId) {
  const sq = _sqSquirrels.find(s => s.id === squirrelId);
  if (!sq) return;

  showModal(`
    <div style="text-align:center;padding:8px 0">
      <div style="font-size:40px;margin-bottom:8px">🌾</div>
      <div style="font-size:16px;font-weight:900;color:#1f2937;margin-bottom:8px">수습 농부 보내기</div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:16px">
        <strong>${sq.name}</strong>을(를) 수습 농부로 보낼까요?<br>
        ${_farmSettings.apprentice_hours || 4}시간 후 결과를 확인할 수 있어요.
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="closeModal()" class="btn flex-1" style="background:#f3f4f6;color:#6b7280;font-weight:800">취소</button>
        <button onclick="closeModal();farmConfirmApprentice('${squirrelId}')" class="btn btn-primary flex-1">보내기!</button>
      </div>
    </div>
  `);
}

async function farmConfirmApprentice(squirrelId) {
  try {
    const { data, error } = await sb.rpc('farm_start_apprentice', {
      p_user_id: myProfile.id,
      p_squirrel_id: squirrelId
    });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }

    toast('🌾', '수습 농부로 출발했어요!');
    // farm_data 다시 로드
    const { data: farmData } = await sb.from('farm_data').select('*').eq('user_id', myProfile.id).maybeSingle();
    _farmData = farmData;
    farmRenderApprentice();
  } catch (e) {
    console.error('[farm]', e);
    toast('❌', '수습 시작 실패: ' + (e?.message || JSON.stringify(e)));
  }
}

// ================================================================
//  수습 중 화면 (타이머)
// ================================================================
function farmRenderApprentice() {
  const area = document.getElementById('sqFarmArea');
  if (!area || !_farmData) return;

  const sq = _sqSquirrels.find(s => s.id === _farmData.farmer_squirrel_id);
  const sqName = sq?.name || '다람쥐';
  const spriteFile = sq?.sprite || 'sq_acorn';
  const until = new Date(_farmData.apprentice_until);
  const remaining = until - Date.now();

  if (remaining <= 0) {
    // 이미 수습 끝남 → 결과 확인 화면
    farmRenderApprenticeResult(sq);
    return;
  }

  area.innerHTML = `
    <div class="clay-card p-5 text-center">
      <div style="font-size:48px;margin-bottom:8px;animation:sqReadyBounce 2s ease-in-out infinite">🌾</div>
      <div class="title-font text-lg text-gray-700 mb-2">수습 농부 훈련 중...</div>
      <div style="display:inline-block;border-radius:16px;border:3px solid #fbbf24;padding:3px;background:#fffbeb;margin:12px 0">
        <img src="images/squirrels/${spriteFile}.png" style="width:64px;height:64px;object-fit:contain;border-radius:12px;display:block" onerror="this.outerHTML='<div style=\\'font-size:48px;line-height:64px\\'>🐱</div>'">
      </div>
      <div style="font-size:14px;font-weight:900;color:#1f2937;margin-bottom:4px">${sqName}</div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:16px">열심히 농사를 배우고 있어요!</div>
      <div style="background:#f9fafb;border-radius:14px;padding:16px;margin-bottom:12px">
        <div style="font-size:11px;color:#9ca3af;margin-bottom:4px">남은 시간</div>
        <div id="farmApprenticeTimer" style="font-size:28px;font-weight:900;color:#f59e0b;font-variant-numeric:tabular-nums">${_farmFmtTime(remaining)}</div>
      </div>
      <div class="text-xs text-gray-400">수습이 끝나면 결과를 확인할 수 있어요</div>
    </div>`;

  // 타이머 시작
  _farmClearTimer();
  _farmTimer = setInterval(() => {
    const rem = until - Date.now();
    const el = document.getElementById('farmApprenticeTimer');
    if (el) el.textContent = _farmFmtTime(rem);
    if (rem <= 0) {
      _farmClearTimer();
      farmRenderApprenticeResult(sq);
    }
  }, 1000);
}

// ── 수습 결과 확인 화면 ──
function farmRenderApprenticeResult(sq) {
  const area = document.getElementById('sqFarmArea');
  if (!area) return;
  _farmClearTimer();

  const sqName = sq?.name || '다람쥐';
  const spriteFile = sq?.sprite || 'sq_acorn';

  area.innerHTML = `
    <div class="clay-card p-5 text-center">
      <div style="font-size:48px;margin-bottom:8px;animation:sqReadyBounce 1s ease-in-out infinite">🎁</div>
      <div class="title-font text-lg text-gray-700 mb-2">수습이 끝났어요!</div>
      <div style="display:inline-block;border-radius:16px;border:3px solid #fbbf24;padding:3px;background:#fffbeb;margin:12px 0">
        <img src="images/squirrels/${spriteFile}.png" style="width:64px;height:64px;object-fit:contain;border-radius:12px;display:block" onerror="this.outerHTML='<div style=\\'font-size:48px;line-height:64px\\'>🐱</div>'">
      </div>
      <div style="font-size:14px;font-weight:900;color:#1f2937;margin-bottom:4px">${sqName}</div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:16px">과연 농부가 되었을까요?</div>
      <button onclick="farmRevealResult()" class="btn btn-primary" style="font-size:16px;padding:14px 32px">
        🌾 결과 확인하기!
      </button>
    </div>`;
}

// ── 결과 공개 연출 ──
async function farmRevealResult() {
  // Phase 1: 두근두근 모달
  showModal(`
    <div id="farmRevealAnim" style="text-align:center;padding:20px 0">
      <div id="farmRevealIcon" style="font-size:56px;animation:sqCardShake 0.5s ease infinite">🌾</div>
      <div style="font-size:16px;font-weight:900;color:#78350f;margin-top:16px">결과 확인 중...</div>
      <div style="font-size:12px;color:#9ca3af;margin-top:4px">두근두근</div>
    </div>
  `);

  // 사운드: 아기다람쥐 성장과 동일
  _playTone(220, 'sine', 0.12, 0.18);
  setTimeout(() => _playTone(220, 'sine', 0.12, 0.18), 200);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 400);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 600);
  setTimeout(() => _playTone(310, 'triangle', 0.2, 0.15), 800);
  setTimeout(() => _playTone(370, 'triangle', 0.2, 0.15), 1000);
  setTimeout(() => _playTone(440, 'triangle', 0.25, 0.15), 1200);
  setTimeout(() => _playTone(523, 'triangle', 0.3, 0.12), 1400);

  // 흔들림 강화
  setTimeout(() => {
    const icon = document.getElementById('farmRevealIcon');
    if (icon) icon.style.animation = 'sqCardShake 0.2s ease infinite';
  }, 1000);

  // 파티클
  setTimeout(() => {
    const el = document.getElementById('farmRevealAnim');
    if (el) {
      const r = el.getBoundingClientRect();
      _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/2, true, 15);
    }
  }, 1600);

  // Phase 2: 서버에서 결과 판정
  let result;
  try {
    const { data, error } = await sb.rpc('farm_check_apprentice', { p_user_id: myProfile.id });
    if (error) throw error;
    result = data;
  } catch (e) {
    console.error('[farm]', e);
    setTimeout(() => {
      closeModal();
      toast('❌', '결과 확인 실패: ' + (e?.message || ''));
    }, 2000);
    return;
  }

  // Phase 3: 결과 공개 (2초 후)
  setTimeout(() => {
    const success = result?.success === true;
    const sq = _sqSquirrels.find(s => s.id === _farmData?.farmer_squirrel_id);
    const sqName = sq?.name || '다람쥐';
    const spriteFile = sq?.sprite || 'sq_acorn';

    if (success) {
      _sqPlayGrowSound();
      // 성공 파티클
      setTimeout(() => {
        const modal = document.querySelector('.modal-box') || document.querySelector('[class*="modal"]');
        if (modal) {
          const r = modal.getBoundingClientRect();
          _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/3, true, 25);
        }
      }, 200);
    } else {
      _playTone(200, 'sine', 0.15, 0.3);
      setTimeout(() => _playTone(160, 'sine', 0.15, 0.4), 200);
    }

    closeModal();
    setTimeout(() => {
      showModal(`
        <div style="text-align:center;padding:8px 0">
          <div style="font-size:48px;margin-bottom:12px">${success ? '🎉' : '😅'}</div>
          <div style="font-size:18px;font-weight:900;color:${success ? '#16a34a' : '#9ca3af'};margin-bottom:8px">
            ${success ? '농부 전직 성공!' : '아쉽지만 실패...'}
          </div>
          <div style="display:inline-block;border-radius:16px;border:3px solid ${success ? '#22c55e' : '#d1d5db'};padding:3px;background:${success ? '#f0fdf4' : '#f9fafb'};margin:8px 0">
            <img src="images/squirrels/${spriteFile}.png" style="width:64px;height:64px;object-fit:contain;border-radius:12px;display:block" onerror="this.outerHTML='<div style=\\'font-size:48px;line-height:64px\\'>🐱</div>'">
          </div>
          <div style="font-size:14px;font-weight:900;color:#1f2937;margin-bottom:4px">${sqName}</div>
          ${success ? `
            <div style="font-size:13px;color:#16a34a;margin-bottom:16px">훌륭한 농부가 되었어요! 🌾</div>
          ` : `
            <div style="font-size:13px;color:#6b7280;margin-bottom:8px">농사가 아직 어려웠나봐요...</div>
            <div style="font-size:12px;color:#f59e0b;font-weight:700;margin-bottom:16px">🌰 보상으로 도토리 ${result?.reward_acorns || 5}개를 가져왔어요!</div>
          `}
          <button onclick="closeModal();farmAfterReveal(${success})" class="btn btn-primary w-full">
            ${success ? '농장으로 가기!' : '다시 도전하기'}
          </button>
        </div>
      `);

      // 팝인 애니메이션용
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const img = document.querySelector('.modal-box img');
        if (img) { img.style.transition = 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)'; img.style.transform = 'scale(1.05)'; }
      }));
    }, 150);
  }, 2000);
}

// ── 결과 후 처리 ──
async function farmAfterReveal(success) {
  if (success) {
    // farm_data 다시 로드
    const { data } = await sb.from('farm_data').select('*').eq('user_id', myProfile.id).maybeSingle();
    _farmData = data;
    farmRenderMain();
  } else {
    // 도토리 표시 갱신
    if (typeof updateAcornDisplay === 'function') updateAcornDisplay();
    // farm_data 다시 로드 (status가 none으로 바뀌어 있음)
    const { data } = await sb.from('farm_data').select('*').eq('user_id', myProfile.id).maybeSingle();
    _farmData = data;
    farmRenderJobChange();
  }
}

// ================================================================
//  농장 메인 화면 (농부 있을 때) - 추후 확장
// ================================================================
function farmRenderMain() {
  const area = document.getElementById('sqFarmArea');
  if (!area) return;

  const sq = _sqSquirrels.find(s => s.id === _farmData?.farmer_squirrel_id);
  const sqName = sq?.name || '농부 다람쥐';
  const spriteFile = sq?.sprite || 'sq_acorn';
  const grade = sq ? _sqCalcGrade(sq) : 'normal';
  const gs = _sqGradeStyle(grade);

  area.innerHTML = `
    <div class="clay-card p-4 mb-4">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="border-radius:14px;${gs.border};padding:2px;background:${gs.bg};flex-shrink:0">
          <img src="images/squirrels/${spriteFile}.png" style="width:48px;height:48px;object-fit:contain;border-radius:10px;display:block" onerror="this.outerHTML='<div style=\\'font-size:36px;line-height:48px;text-align:center\\'>🐱</div>'">
        </div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:900;color:#1f2937">${sqName} <span style="font-size:11px;color:#16a34a;font-weight:700">🌾 농부</span></div>
          <div style="font-size:11px;font-weight:700;color:${gs.color}">${gs.label} · 애완형</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;color:#9ca3af">예치금</div>
          <div style="font-size:14px;font-weight:900;color:#78350f">🌰 ${_farmData?.deposit_acorns || 0}</div>
          <div style="font-size:10px;color:#9ca3af">${_farmData?.deposit_crumbs || 0} 부스러기</div>
        </div>
      </div>
    </div>
    <div class="clay-card p-5 text-center">
      <div style="font-size:36px;margin-bottom:8px">🚧</div>
      <div class="title-font text-base text-gray-700 mb-2">농장 준비 중</div>
      <div class="text-sm text-gray-400">농부가 밭을 정리하고 있어요!<br>곧 농사를 시작할 수 있습니다.</div>
    </div>`;
}

// ── 유틸리티 ──
function _farmFmtTime(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
}

function _farmClearTimer() {
  if (_farmTimer) { clearInterval(_farmTimer); _farmTimer = null; }
}
