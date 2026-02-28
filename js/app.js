
// ──────────────────────────────────────────────
//  탭바 드래그 스크롤 (PC 웹 대응)
// ──────────────────────────────────────────────
function initTabBarDragScroll(el) {
  if (!el) return;
  let isDown = false, startX = 0, scrollLeft = 0;
  el.addEventListener('mousedown', e => {
    isDown = true;
    el.style.cursor = 'grabbing';
    startX = e.pageX - el.offsetLeft;
    scrollLeft = el.scrollLeft;
  });
  el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = 'grab'; });
  el.addEventListener('mouseup',    () => { isDown = false; el.style.cursor = 'grab'; });
  el.addEventListener('mousemove',  e => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    el.scrollLeft = scrollLeft - (x - startX) * 1.2;
  });

  // 스크롤 힌트 (우측 화살표 표시)
  function checkScroll() {
    const wrap = el.closest('.tab-bar-wrap');
    if (!wrap) return;
    const canScroll = el.scrollWidth > el.clientWidth && el.scrollLeft < el.scrollWidth - el.clientWidth - 4;
    wrap.classList.toggle('can-scroll', canScroll);
  }
  el.addEventListener('scroll', checkScroll);
  new ResizeObserver(checkScroll).observe(el);
  setTimeout(checkScroll, 100);
}

// ──────────────────────────────────────────────
//  START
// ──────────────────────────────────────────────
boot();
