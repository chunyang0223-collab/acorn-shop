
// ──────────────────────────────────────────────
//  탭바 드래그 스크롤 (translateX 방식 — overflow:visible 유지)
// ──────────────────────────────────────────────
function initTabBarDragScroll(el) {
  if (!el) return;

  let offset = 0;       // 현재 이동 거리
  let maxOffset = 0;    // 최대 이동 가능 거리
  let startX = 0;
  let startOffset = 0;
  let isDragging = false;

  function updateMax() {
    // 버튼 전체 너비 - 탭바 보이는 너비
    maxOffset = Math.max(0, el.scrollWidth - el.clientWidth);
  }

  function applyOffset(val) {
    offset = Math.max(0, Math.min(val, maxOffset));
    el.style.transform = `translateX(${-offset}px)`;

    // 스크롤 힌트
    const wrap = el.closest('.tab-bar-wrap');
    if (wrap) wrap.classList.toggle('can-scroll', offset < maxOffset - 4);
  }

  // 마우스
  el.addEventListener('mousedown', e => {
    isDragging = true;
    startX = e.pageX;
    startOffset = offset;
    el.style.cursor = 'grabbing';
    updateMax();
  });
  window.addEventListener('mouseup', () => {
    isDragging = false;
    el.style.cursor = 'grab';
  });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    e.preventDefault();
    applyOffset(startOffset - (e.pageX - startX));
  });

  // 터치
  el.addEventListener('touchstart', e => {
    startX = e.touches[0].pageX;
    startOffset = offset;
    updateMax();
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    applyOffset(startOffset - (e.touches[0].pageX - startX));
  }, { passive: true });

  new ResizeObserver(() => { updateMax(); applyOffset(offset); }).observe(el);
  setTimeout(() => { updateMax(); applyOffset(0); }, 100);
}

// ──────────────────────────────────────────────
//  START
// ──────────────────────────────────────────────
boot();
