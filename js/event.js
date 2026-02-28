//  EVENT DISCOUNT SYSTEM
// ──────────────────────────────────────────────
// localStorage 구조:
//   dotori_events_v2  → { store: EventObj, gacha: EventObj }  (기간 이벤트)
//   dotori_repeats    → [ RepeatObj, ... ]                    (요일반복 목록)
//   dotori_event_history → [ HistoryObj, ... ]                (기록)
//
// EventObj: { active, discountPct, startAt, endAt, createdAt }
// RepeatObj: { id, type, discountPct, weekDays[], startTime, endTime, validFrom, validUntil, active, createdAt }

const DOW_KR = ['일','월','화','수','목','금','토'];

// ── 이벤트 DB 캐시 (앱 로드 시 한 번 로드, 변경 시 갱신) ──
let _events = {};       // { store: {...}, gacha: {...} }
let _repeats = [];      // 요일반복 이벤트 배열

// DB에서 이벤트 전체 로드 → 캐시 갱신
async function _loadEventsFromDB() {
  const [{ data: evRows }, { data: repRows }] = await Promise.all([
    sb.from('events').select('*'),
    sb.from('repeat_events').select('*').order('created_at', { ascending: false })
  ]);
  _events = {};
  if (evRows) evRows.forEach(r => {
    _events[r.id] = {
      active: r.active,
      discountPct: r.discount_pct,
      startAt: r.start_at ? new Date(r.start_at).getTime() : null,
      endAt:   r.end_at   ? new Date(r.end_at).getTime()   : null,
    };
  });
  _repeats = (repRows || []).map(r => ({
    id: r.id,
    type: r.type,
    active: r.active,
    discountPct: r.discount_pct,
    weekDays: r.week_days || [],
    startTime: r.start_time,
    endTime: r.end_time,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    createdAt: new Date(r.created_at).getTime()
  }));
}

// 하위 호환 동기 래퍼 (캐시에서 읽기)
function _loadEvents() { /* 캐시 사용 — _loadEventsFromDB() 후 자동 갱신 */ }
function _loadRepeats() { return _repeats; }

// DB 저장
async function _saveEventToDB(type, data) {
  await sb.from('events').update({
    active: data.active,
    discount_pct: data.discountPct || 0,
    start_at: data.startAt ? new Date(data.startAt).toISOString() : null,
    end_at:   data.endAt   ? new Date(data.endAt).toISOString()   : null,
    updated_at: new Date().toISOString()
  }).eq('id', type);
}

// ── 할인 계산 (캐시 기반 동기 함수 — 앱 로드 시 캐시 갱신됨) ──
function getActiveEventDiscount(type) {
  const now = Date.now();
  let best = 0;

  // 1) 기간 이벤트
  const ev = _events[type];
  if (ev && ev.active) {
    if ((!ev.startAt || now >= ev.startAt) && (!ev.endAt || now <= ev.endAt)) {
      best = Math.max(best, ev.discountPct || 0);
    }
  }

  // 2) 요일반복 이벤트
  const kst  = new Date(now + 9 * 3600 * 1000);
  const dow  = kst.getUTCDay();
  const hhmm = kst.toISOString().slice(11, 16);
  const ds   = kst.toISOString().slice(0, 10);

  for (const r of _repeats) {
    if (!r.active || r.type !== type) continue;
    if (!r.weekDays.includes(dow)) continue;
    if (hhmm < r.startTime || hhmm > r.endTime) continue;
    if (r.validFrom  && ds < r.validFrom)  continue;
    if (r.validUntil && ds > r.validUntil) continue;
    best = Math.max(best, r.discountPct || 0);
  }

  return best;
}

// ── 이벤트 탭 전환 ────────────────────────────────
function switchEvtTab(name, btn) {
  ['once','repeat','schedules'].forEach(n => {
    const p = document.getElementById(`evtPane-${n}`);
    if (p) p.classList.toggle('hidden', n !== name);
  });
  document.querySelectorAll('#atab-events .tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (name === 'schedules') renderScheduleList();
}

// ── 요일 체크박스 시각 피드백 ─────────────────────
function toggleDayBtn(checkbox) {
  // CSS의 input:checked + span이 자동 처리하므로 추가 작업 불필요
}

// ── 날짜 입력 초기화 ──────────────────────────────
function clearEventDates(type) {
  const start = document.getElementById(`${type}EventStart`);
  const end   = document.getElementById(`${type}EventEnd`);
  const sel   = document.getElementById(`${type}EventPreset`);
  if (start) start.value = '';
  if (end)   end.value   = '';
  if (sel)   sel.value   = '';
}

// ── 빠른 기간 프리셋 ──────────────────────────────
function applyEventPreset(type) {
  const val = document.getElementById(`${type}EventPreset`)?.value;
  if (!val) return;
  const hours = { '1h':1, '2h':2, '4h':4, '8h':8, '24h':24 }[val];
  if (!hours) return;
  const endDate = new Date(Date.now() + hours * 3600 * 1000);
  const local = new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  const endEl = document.getElementById(`${type}EventEnd`);
  if (endEl) endEl.value = local;
  setTimeout(() => { const s = document.getElementById(`${type}EventPreset`); if (s) s.value = ''; }, 50);
}

// ── 기간 이벤트 활성화 ────────────────────────────
async function activateEvent(type) {
  const pct = parseInt(document.getElementById(`${type}DiscountPct`)?.value || 0);
  if (!pct || pct < 1 || pct > 100) { toast('❌', '할인율을 1~100 사이로 입력해주세요'); return; }

  const startVal = document.getElementById(`${type}EventStart`)?.value;
  const endVal   = document.getElementById(`${type}EventEnd`)?.value;
  const startAt  = startVal ? new Date(startVal).getTime() : null;
  const endAt    = endVal   ? new Date(endVal).getTime()   : null;

  if (endAt && startAt && endAt <= startAt) { toast('❌', '종료 시각이 시작 시각보다 늦어야 해요'); return; }
  if (endAt && endAt <= Date.now())         { toast('❌', '종료 시각이 이미 지났어요'); return; }

  const evData = { active: true, discountPct: pct, startAt, endAt };
  await _saveEventToDB(type, evData);
  _events[type] = evData; // 캐시 즉시 갱신

  const label    = type === 'store' ? '상점' : '뽑기';
  const startStr = startAt ? new Date(startAt).toLocaleString('ko-KR', { timeZone:'Asia/Seoul' }) : '즉시';
  const endStr   = endAt   ? new Date(endAt).toLocaleString('ko-KR',   { timeZone:'Asia/Seoul' }) : '수동 종료까지';
  _addEvtHistory({ type, label, pct, mode:'기간', startStr, endStr });

  playSound('approve');
  toast('🎉', `${label} ${pct}% 할인 활성화!`);
  renderEventAdmin();
  renderShopEventBanner();
}

// ── 기간 이벤트 비활성화 ──────────────────────────
async function deactivateEvent(type) {
  if (_events[type]) _events[type].active = false;
  else _events[type] = { active: false, discountPct: 0, startAt: null, endAt: null };
  await _saveEventToDB(type, _events[type]);
  const label = type === 'store' ? '상점' : '뽑기';
  toast('⏹', `${label} 이벤트 비활성화`);
  renderEventAdmin();
  renderShopEventBanner();
}

// ── 요일반복 이벤트 추가 ──────────────────────────
async function addRepeatEvent() {
  const type      = document.getElementById('rpt-target')?.value;
  const pct       = parseInt(document.getElementById('rpt-pct')?.value || 0);
  const weekDays  = Array.from(document.querySelectorAll('#rpt-days input:checked')).map(c => parseInt(c.value));
  const startTime = document.getElementById('rpt-startTime')?.value || '00:00';
  const endTime   = document.getElementById('rpt-endTime')?.value   || '23:59';
  const validFrom = document.getElementById('rpt-validFrom')?.value  || null;
  const validUntil= document.getElementById('rpt-validUntil')?.value || null;

  if (!pct || pct < 1 || pct > 100) { toast('❌', '할인율을 1~100으로 입력하세요'); return; }
  if (!weekDays.length)  { toast('❌', '요일을 하나 이상 선택해주세요'); return; }
  if (endTime <= startTime) { toast('❌', '종료 시각이 시작 시각보다 늦어야 해요'); return; }
  if (validFrom && validUntil && validUntil < validFrom) { toast('❌', '반복 종료일이 시작일보다 빠릅니다'); return; }

  const { data: newRow, error } = await sb.from('repeat_events').insert({
    type, active: true,
    discount_pct: pct,
    week_days: weekDays,
    start_time: startTime,
    end_time: endTime,
    valid_from: validFrom || null,
    valid_until: validUntil || null
  }).select('*').single();

  if (error) { toast('❌', '저장 실패: ' + error.message); return; }

  // 캐시 즉시 갱신
  _repeats.unshift({
    id: newRow.id, type, active: true, discountPct: pct,
    weekDays, startTime, endTime, validFrom, validUntil,
    createdAt: Date.now()
  });

  const label   = type === 'store' ? '상점' : '뽑기';
  const daysStr = weekDays.map(d => DOW_KR[d]).join('/');
  _addEvtHistory({ type, label, pct, mode:'요일반복', startStr: `${daysStr} ${startTime}~${endTime}`, endStr: validUntil || '무기한' });

  // 폼 초기화
  if (document.getElementById('rpt-pct'))      document.getElementById('rpt-pct').value = '';
  document.querySelectorAll('#rpt-days input').forEach(c => c.checked = false);
  if (document.getElementById('rpt-startTime')) document.getElementById('rpt-startTime').value = '00:00';
  if (document.getElementById('rpt-endTime'))   document.getElementById('rpt-endTime').value   = '23:59';
  if (document.getElementById('rpt-validFrom')) document.getElementById('rpt-validFrom').value  = '';
  if (document.getElementById('rpt-validUntil'))document.getElementById('rpt-validUntil').value = '';

  playSound('approve');
  toast('🔄', `${label} 요일반복 이벤트 추가!`);
  renderEventAdmin();
  renderShopEventBanner();
  switchEvtTab('schedules', document.getElementById('evtTabSchedules'));
}

// ── 요일반복 이벤트 삭제/토글 ────────────────────
async function deleteRepeatEvent(id) {
  await sb.from('repeat_events').delete().eq('id', id);
  _repeats = _repeats.filter(r => r.id !== id);
  toast('🗑', '삭제되었어요');
  renderScheduleList();
  renderEventAdmin();
  renderShopEventBanner();
}
async function toggleRepeatEvent(id) {
  const r = _repeats.find(r => r.id === id);
  if (!r) return;
  r.active = !r.active;
  await sb.from('repeat_events').update({ active: r.active }).eq('id', id);
  renderScheduleList();
  renderEventAdmin();
  renderShopEventBanner();
}

// ── 요일반복 목록 렌더링 ──────────────────────────
function renderScheduleList() {
  const el = document.getElementById('scheduleList');
  if (!el) return;
  const repeats = _repeats;
  if (!repeats.length) { el.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">등록된 요일반복 이벤트 없음</p>'; return; }
  const now = Date.now();
  el.innerHTML = repeats.map(r => {
    const label    = r.type === 'store' ? '🛍️ 상점' : '🎲 뽑기';
    const daysStr  = (r.weekDays||[]).map(d => DOW_KR[d]).join(' ');
    const period   = (r.validFrom||r.validUntil) ? `${r.validFrom||'즉시'} ~ ${r.validUntil||'무기한'}` : '무기한';
    // 현재 활성인지 계산
    const kst  = new Date(now + 9*3600000);
    const dow  = kst.getUTCDay(), hhmm = kst.toISOString().slice(11,16), ds = kst.toISOString().slice(0,10);
    const isNowOn = r.active && r.weekDays.includes(dow) && hhmm >= r.startTime && hhmm <= r.endTime
      && (!r.validFrom||ds>=r.validFrom) && (!r.validUntil||ds<=r.validUntil);
    const badge = isNowOn
      ? 'background:#dcfce7;color:#166534'
      : r.active ? 'background:#fef9c3;color:#854d0e' : 'background:#fee2e2;color:#b91c1c';
    const badgeTxt = isNowOn ? '✅ 지금 활성' : r.active ? '📆 대기 중' : '⏸ 일시중지';
    return `<div class="p-3 rounded-2xl row-item-bg flex items-start gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <span class="text-sm font-black text-gray-800">${label} ${r.discountPct}% 할인</span>
          <span class="text-xs px-2 py-0.5 rounded-full font-black" style="${badge}">${badgeTxt}</span>
        </div>
        <p class="text-xs text-gray-500 font-bold">📅 ${daysStr} &nbsp;⏰ ${r.startTime}~${r.endTime}</p>
        <p class="text-xs text-gray-400">유효기간: ${period}</p>
      </div>
      <div class="flex flex-col gap-1 shrink-0">
        <button class="btn btn-gray text-xs px-3 py-1" onclick="toggleRepeatEvent('${r.id}')">${r.active?'⏸':'▶️'}</button>
        <button class="btn btn-gray text-xs px-3 py-1" onclick="deleteRepeatEvent('${r.id}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// ── 이력 추가 ─────────────────────────────────────
function _addEvtHistory({ type, label, pct, mode, startStr, endStr }) {
  try {
    const h = JSON.parse(localStorage.getItem('dotori_event_history') || '[]');
    h.unshift({ type, label, pct, mode, startStr, endStr, ts: Date.now() });
    if (h.length > 30) h.pop();
    localStorage.setItem('dotori_event_history', JSON.stringify(h));
  } catch(e) {}
}

// ── 관리자 이벤트 탭 전체 갱신 ───────────────────
function renderEventAdmin() {
  const now = Date.now();

  ['store','gacha'].forEach(type => {
    const ev = _events[type];
    const statusEl = document.getElementById(`${type}EventStatus`);
    if (!statusEl) return;

    let text = '비활성', bg = '#fee2e2', color = '#b91c1c';
    let evActive = false;

    // 기간 이벤트 상태
    if (ev && ev.active) {
      const started  = !ev.startAt || now >= ev.startAt;
      const notEnded = !ev.endAt   || now <= ev.endAt;
      if (started && notEnded) {
        evActive = true;
        text = `✅ 활성 ${ev.discountPct}%`;
        bg = '#dcfce7'; color = '#166534';
        if (ev.endAt) {
          text += ` (<span id="adminEvtTimer-${type}">${_fmtRemaining(ev.endAt - now)}</span> 남음)`;
        }
      } else if (ev.startAt && now < ev.startAt) {
        text = `⏳ 예약 ${ev.discountPct}% (<span id="adminEvtTimer-${type}">${_fmtRemaining(ev.startAt - now)}</span> 후 시작)`;
        bg = '#fef9c3'; color = '#854d0e';
      }
    }

    // 기간 이벤트가 비활성이면 요일반복 상태 확인
    if (!evActive) {
      const disc = getActiveEventDiscount(type);
      if (disc > 0) {
        text = `✅ 요일반복 ${disc}% 활성`; bg = '#dcfce7'; color = '#166534';
      } else {
        const hasRepeat = _repeats.some(r => r.active && r.type === type);
        if (hasRepeat) { text = '📆 요일반복 대기'; bg = '#fef9c3'; color = '#854d0e'; }
      }
    }

    statusEl.innerHTML = text;
    statusEl.style.background = bg;
    statusEl.style.color = color;
  });

  // 활성 배너
  const bannerEl = document.getElementById('activeEventsBanner');
  if (bannerEl) {
    const msgs = [];
    ['store','gacha'].forEach(t => {
      const d = getActiveEventDiscount(t);
      if (d > 0) {
        const endAt = _getEventEndAt(t);
        const timeStr = endAt ? ` <span id="adminTopTimer-${t}" style="font-size:11px;font-weight:700;opacity:0.8">⏱️ ${_fmtRemaining(endAt - Date.now())} 남음</span>` : '';
        msgs.push(`${t==='store'?'🛍️ 상점':'🎲 뽑기'} ${d}% 할인 중!${timeStr}`);
      }
    });
    bannerEl.innerHTML = msgs.length
      ? `<div class="clay-card p-3 mb-2 text-center font-black text-green-700" style="background:rgba(220,252,231,0.85);border:2px solid rgba(34,197,94,0.3)">🎉 ${msgs.join('&emsp;|&emsp;')}</div>`
      : '';
  }

  // 관리자 이벤트 카운트다운 타이머
  _clearAdminEvtTimer();
  const adminTimerNeeded = ['store','gacha'].some(type => {
    const ev = _events[type];
    return ev && ev.active && (ev.endAt || ev.startAt);
  });
  if (adminTimerNeeded) {
    window._adminEvtTimer = setInterval(() => {
      const n = Date.now();
      ['store','gacha'].forEach(type => {
        const ev = _events[type];
        // 상태 카드 타이머
        const el = document.getElementById(`adminEvtTimer-${type}`);
        if (el && ev) {
          const started = !ev.startAt || n >= ev.startAt;
          const target = started ? ev.endAt : ev.startAt;
          if (target) el.textContent = _fmtRemaining(target - n);
        }
        // 상단 배너 타이머
        const topEl = document.getElementById(`adminTopTimer-${type}`);
        if (topEl) {
          const endAt = _getEventEndAt(type);
          if (endAt) topEl.textContent = '⏱️ ' + _fmtRemaining(endAt - n) + ' 남음';
        }
      });
    }, 1000);
  }

  // 이벤트 기록
  const histEl = document.getElementById('eventHistoryList');
  if (histEl) {
    const history = JSON.parse(localStorage.getItem('dotori_event_history') || '[]');
    histEl.innerHTML = history.length
      ? history.map(h => `<div class="flex items-center gap-3 p-3 rounded-xl row-item-bg">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-black text-gray-800">${h.label==='상점'?'🛍️':'🎲'} ${h.label} ${h.pct}% <span class="text-xs font-bold text-gray-400">[${h.mode||''}]</span></p>
            <p class="text-xs text-gray-400 truncate">${h.startStr} ~ ${h.endStr}</p>
          </div>
          <span class="text-xs text-gray-400 shrink-0">${fmtTs(new Date(h.ts).toISOString())}</span>
        </div>`).join('')
      : '<p class="text-sm text-gray-400 text-center py-4">기록 없음</p>';
  }
}

// ── 상점 탭 이벤트 배너 ───────────────────────────
function _fmtRemaining(ms) {
  if (ms <= 0) return '곧 종료';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const ss = s % 60;
  const mm = m % 60;
  const hh = h % 24;
  if (d > 0)  return `${d}일 ${hh}시간 ${mm}분 남음`;
  if (h > 0)  return `${h}시간 ${mm}분 ${ss}초 남음`;
  if (m > 0)  return `${mm}분 ${ss}초 남음`;
  return `${s}초 남음`;
}

function _getEventEndAt(type) {
  const now = Date.now();
  const ev = _events[type];
  if (ev && ev.active && ev.endAt && (!ev.startAt || now >= ev.startAt) && now <= ev.endAt) {
    return ev.endAt;
  }
  // 요일 반복 이벤트는 당일 endTime 기준
  const kst  = new Date(now + 9 * 3600 * 1000);
  const dow  = kst.getUTCDay();
  const hhmm = kst.toISOString().slice(11, 16);
  const ds   = kst.toISOString().slice(0, 10);
  for (const r of _repeats) {
    if (!r.active || r.type !== type) continue;
    if (!r.weekDays.includes(dow)) continue;
    if (r.startTime && hhmm < r.startTime) continue;
    if (r.endTime   && hhmm > r.endTime)   continue;
    if (r.validFrom  && ds < r.validFrom)  continue;
    if (r.validUntil && ds > r.validUntil) continue;
    if (r.endTime) {
      const [eh, em] = r.endTime.split(':').map(Number);
      const end = new Date(kst);
      end.setUTCHours(eh - 9, em, 0, 0);
      return end.getTime();
    }
  }
  return null;
}

function renderShopEventBanner() {
  const storeEl = document.getElementById('utab-shop');
  if (!storeEl) return;
  let bannerEl = document.getElementById('shopEventBanner');
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.id = 'shopEventBanner';
    storeEl.insertBefore(bannerEl, storeEl.firstChild);
  }
  const sd = getActiveEventDiscount('store');
  const gd = getActiveEventDiscount('gacha');

  if (!sd && !gd) { bannerEl.innerHTML = ''; _clearBannerTimer(); return; }

  const now = Date.now();
  const banners = [];
  if (sd > 0) {
    const endAt = _getEventEndAt('store');
    const timeStr = endAt ? `<span id="evtTimer-store" style="font-size:11px;opacity:0.8;display:block;margin-top:2px">⏱️ ${_fmtRemaining(endAt - now)}</span>` : '';
    banners.push({ html: `<div class="clay-card p-3 mb-3 text-center font-black text-green-700" style="background:rgba(220,252,231,0.8);border:2px solid rgba(34,197,94,0.3)">🎉 🛍️ 상점 ${sd}% 할인 이벤트 진행 중!${timeStr}</div>`, endAt, timerEl: 'evtTimer-store' });
  }
  if (gd > 0) {
    const endAt = _getEventEndAt('gacha');
    const timeStr = endAt ? `<span id="evtTimer-gacha" style="font-size:11px;opacity:0.8;display:block;margin-top:2px">⏱️ ${_fmtRemaining(endAt - now)}</span>` : '';
    banners.push({ html: `<div class="clay-card p-3 mb-3 text-center font-black text-green-700" style="background:rgba(220,252,231,0.8);border:2px solid rgba(34,197,94,0.3)">🎉 🎲 뽑기 ${gd}% 할인 이벤트 진행 중!${timeStr}</div>`, endAt, timerEl: 'evtTimer-gacha' });
  }

  bannerEl.innerHTML = banners.map(b => b.html).join('');

  // 카운트다운 타이머
  _clearBannerTimer();
  const hasTimer = banners.some(b => b.endAt);
  if (hasTimer) {
    window._bannerTimer = setInterval(() => {
      const now2 = Date.now();
      let allExpired = true;
      banners.forEach(b => {
        if (!b.endAt) return;
        const el = document.getElementById(b.timerEl);
        if (el) {
          const rem = b.endAt - now2;
          if (rem > 0) { el.textContent = '⏱️ ' + _fmtRemaining(rem); allExpired = false; }
          else { el.textContent = '⏱️ 곧 종료'; }
        }
      });
      if (allExpired) { _clearBannerTimer(); renderShopEventBanner(); }
    }, 1000);
  }
}

function _clearBannerTimer() {
  if (window._bannerTimer) { clearInterval(window._bannerTimer); window._bannerTimer = null; }
}
function _clearAdminEvtTimer() {
  if (window._adminEvtTimer) { clearInterval(window._adminEvtTimer); window._adminEvtTimer = null; }
}

// ──────────────────────────────────────────────
