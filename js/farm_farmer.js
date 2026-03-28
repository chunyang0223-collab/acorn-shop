/* ================================================================
   🌾 다람쥐 농장 — 농부 관리 (farm_farmer.js)
   수습 농부 시스템 / 농부 장착·해제·교체 / 관리자 스킵
   ================================================================ */

// ================================================================
//  수습 농부 보내기 모달
// ================================================================
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
        <button onclick="closeModal()" class="btn flex-1" style="background:#f3f4f6;color:#6b7280;font-weight:800;font-size:13px;padding:12px;border-radius:14px;border:1.5px solid #e5e7eb">취소</button>
        <button onclick="closeModal();farmConfirmApprentice('${squirrelId}')" class="btn btn-primary flex-1">보내기!</button>
      </div>
    </div>
  `);
}

async function farmConfirmApprentice(squirrelId) {
  try {
    const { data, error } = await sb.rpc('farm_start_apprentice', {
      p_user_id: myProfile.id, p_squirrel_id: squirrelId
    });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }
    toast('🌾', '수습 농부로 출발했어요!');
    await _farmReloadAll();
    if (document.getElementById('sqFarmArea')) farmRenderMain();
    if (typeof sqRenderGrid === 'function') sqRenderGrid();
  } catch (e) {
    console.error('[farm]', e);
    toast('❌', '수습 시작 실패: ' + (e?.message || JSON.stringify(e)));
  }
}

// ── 결과 공개 연출 ──
async function farmRevealResult() {
  showModal(`
    <div id="farmRevealAnim" style="text-align:center;padding:20px 0">
      <div id="farmRevealIcon" style="font-size:56px;animation:sqCardShake 0.5s ease infinite">🌾</div>
      <div style="font-size:16px;font-weight:900;color:#78350f;margin-top:16px">결과 확인 중...</div>
      <div style="font-size:12px;color:#9ca3af;margin-top:4px">두근두근</div>
    </div>
  `);

  _playTone(220, 'sine', 0.12, 0.18);
  setTimeout(() => _playTone(220, 'sine', 0.12, 0.18), 200);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 400);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 600);
  setTimeout(() => _playTone(310, 'triangle', 0.2, 0.15), 800);
  setTimeout(() => _playTone(370, 'triangle', 0.2, 0.15), 1000);
  setTimeout(() => _playTone(440, 'triangle', 0.25, 0.15), 1200);
  setTimeout(() => _playTone(523, 'triangle', 0.3, 0.12), 1400);

  setTimeout(() => {
    const icon = document.getElementById('farmRevealIcon');
    if (icon) icon.style.animation = 'sqCardShake 0.2s ease infinite';
  }, 1000);

  setTimeout(() => {
    const el = document.getElementById('farmRevealAnim');
    if (el) { const r = el.getBoundingClientRect(); _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/2, true, 15); }
  }, 1600);

  let result;
  try {
    const { data, error } = await sb.rpc('farm_check_apprentice', { p_user_id: myProfile.id });
    if (error) throw error;
    result = data;
  } catch (e) {
    console.error('[farm]', e);
    setTimeout(() => { closeModal(); toast('❌', '결과 확인 실패: ' + (e?.message || '')); }, 2000);
    return;
  }

  setTimeout(() => {
    const success = result?.success === true;
    const sq = _sqSquirrels.find(s => s.id === _farmData?.apprentice_squirrel_id);
    const sqName = sq?.name || '다람쥐';
    const spriteFile = sq?.sprite || 'sq_acorn';

    if (success) {
      _sqPlayGrowSound();
      setTimeout(() => {
        const modal = document.querySelector('.modal-box') || document.querySelector('[class*="modal"]');
        if (modal) { const r = modal.getBoundingClientRect(); _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/3, true, 25); }
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
            ${success ? '확인' : '다시 도전하기'}
          </button>
        </div>
      `);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const img = document.querySelector('.modal-box img');
        if (img) { img.style.transition = 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)'; img.style.transform = 'scale(1.05)'; }
      }));
    }, 150);
  }, 2000);
}

async function farmAfterReveal(success) {
  if (!success && typeof updateAcornDisplay === 'function') updateAcornDisplay();
  if (window._sqApprenticeTimer) { clearInterval(window._sqApprenticeTimer); window._sqApprenticeTimer = null; }
  await _farmReloadAll();
  if (document.getElementById('sqFarmArea')) farmRenderMain();
  if (typeof sqRenderGrid === 'function') sqRenderGrid();
}

// ================================================================
//  농부 교체/해제 모달
// ================================================================
function farmShowChangeFarmer() {
  const hasGrowingCrop = (_farmPlots || []).some(p => p.crop_id != null);
  const canUnequip = _farmData?.active_farmer_id && !hasGrowingCrop;
  showModal(`
    <div style="padding:4px 0">
      <div style="font-size:15px;font-weight:900;color:#1f2937;margin-bottom:12px;text-align:center">🌾 농부 교체/해제</div>
      ${_farmRenderFarmerList()}
      ${_farmData?.active_farmer_id ? (canUnequip
        ? `<button onclick="farmUnequipFarmer()" class="btn w-full mt-3" style="background:#fef2f2;color:#ef4444;font-weight:800;font-size:11px">농부 해제하기</button>`
        : `<div class="w-full mt-3 text-center" style="font-size:10px;color:#9ca3af;font-weight:700;padding:8px 0">🌱 작물이 자라는 중에는 해제할 수 없어요</div>`
      ) : ''}
      <button onclick="closeModal()" class="btn w-full mt-2" style="background:#f3f4f6;color:#6b7280;font-size:13px;font-weight:800;padding:12px;border-radius:14px;border:1.5px solid #e5e7eb">닫기</button>
    </div>
  `);
}

function _farmRenderFarmerList() {
  const farmerSquirrels = _farmFarmers
    .map(f => _sqSquirrels.find(s => s.id === f.squirrel_id))
    .filter(Boolean);

  if (farmerSquirrels.length === 0) return '<div class="text-center py-4 text-xs text-gray-400">농부 자격이 있는 다람쥐가 없어요.</div>';

  return `<div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto">${farmerSquirrels.map(sq => {
    const grade = _sqCalcGrade(sq);
    const gs = _sqGradeStyle(grade);
    const spriteFile = sq.sprite || 'sq_acorn';
    const isActive = _farmData?.active_farmer_id === sq.id;
    return `
      <div onclick="${isActive ? '' : `farmEquipFarmer('${sq.id}')`}" style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:12px;background:${isActive ? '#f0fdf4' : 'white'};border:2px solid ${isActive ? '#22c55e' : '#e5e7eb'};cursor:${isActive ? 'default' : 'pointer'}">
        <div style="border-radius:8px;${gs.border};padding:2px;background:${gs.bg};flex-shrink:0">
          <img src="images/squirrels/${spriteFile}.png" style="width:30px;height:30px;object-fit:contain;border-radius:6px;display:block" onerror="this.outerHTML='<div style=\\'font-size:22px;line-height:30px;text-align:center\\'>🐱</div>'">
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:900;color:#1f2937">${sq.name}</div>
          <div style="font-size:9px;font-weight:700;color:${gs.color}">${gs.label}</div>
        </div>
        <div style="font-size:10px;font-weight:800;color:${isActive ? '#16a34a' : '#f59e0b'}">${isActive ? '장착 중' : '장착'}</div>
      </div>`;
  }).join('')}</div>`;
}

async function farmEquipFarmer(squirrelId) {
  try {
    const { data, error } = await sb.rpc('farm_set_active_farmer', { p_user_id: myProfile.id, p_squirrel_id: squirrelId });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }
    toast('🌾', '농부를 장착했어요!');
    closeModal();
    await _farmReloadAll();
    farmRenderMain();
  } catch (e) { console.error('[farm equip]', e); toast('❌', '장착 실패'); }
}

async function farmUnequipFarmer() {
  try {
    const { data, error } = await sb.rpc('farm_set_active_farmer', { p_user_id: myProfile.id, p_squirrel_id: null });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }
    toast('🌾', '농부를 해제했어요');
    closeModal();
    await _farmReloadAll();
    farmRenderMain();
  } catch (e) { console.error('[farm unequip]', e); toast('❌', '해제 실패'); }
}

// ================================================================
//  [관리자] 수습 시간 스킵
// ================================================================
async function farmSkipApprentice() {
  if (!myProfile?.is_admin) return;
  try {
    const { error } = await sb.from('farm_data')
      .update({ apprentice_until: new Date().toISOString() })
      .eq('user_id', myProfile.id);
    if (error) throw error;
    toast('⏩', '수습 시간 스킵!');
    _farmClearTimer();
    if (window._sqApprenticeTimer) { clearInterval(window._sqApprenticeTimer); window._sqApprenticeTimer = null; }
    await _farmReloadAll();
    if (document.getElementById('sqFarmArea')) farmRenderMain();
    if (typeof sqRenderGrid === 'function') sqRenderGrid();
  } catch (e) { console.error('[farm skip]', e); toast('❌', '스킵 실패'); }
}

// ================================================================
//  [관리자] 작물 성장 시간 스킵
// ================================================================
async function farmAdminSkipGrow(slot) {
  if (!myProfile?.is_admin) return;
  try {
    const { data, error } = await sb.rpc('farm_admin_skip_grow', {
      p_admin_id: myProfile.id, p_slot: slot
    });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }
    toast('⏩', `${slot}번 밭 성장 스킵!`);
    await _farmReloadAll();
    farmRenderMain();
  } catch (e) { console.error('[farm admin skip grow]', e); toast('❌', '스킵 실패'); }
}
