/* ============================================================
   KAORU FURUBAYASHI — script.js
   Hero slideshow + Gallery lightbox + scroll fade-in
   ============================================================ */

// ── HERO SLIDESHOW PHOTOS ────────────────────────────────────
// hero/ フォルダに写真5枚を配置し、以下のパスを編集してください。
// HTMLの各 .hero-slide 内の <div class="hero-slide-placeholder"> を
// <img src="hero/photoX.jpg" alt=""> に差し替えるか、
// CSSの .hero-slide--N { background-image: url('hero/photoN.jpg'); ... } で設定できます。
//
// 例（CSS方式）:
//   .hero-slide--1 { background-image: url('hero/photo1.jpg'); background-size: cover; background-position: center; }
//
// 現在はプレースホルダー（暗いグレー）を表示しています。

// ── PHOTO LIST ───────────────────────────────────────────────
// 写真ファイルを photos/ フォルダに入れ、ここにファイル名を追加してください。
// 例: 'photos/IMG_001.jpg'
// プレースホルダー画像は差し替えるまでのデモ用です。

const photoList = [
  'photos/photo01.jpg',
  'photos/photo02.jpg',
  'photos/photo03.jpg',
  'photos/photo04.jpg',
  'photos/photo05.jpg',
  'photos/photo06.jpg',
  'photos/photo07.jpg',
  'photos/photo08.jpg',
  'photos/photo09.jpg',
  'photos/photo10.jpg',
  'photos/photo11.jpg',
  'photos/photo12.jpg',
  'photos/photo13.jpg',
  'photos/photo14.jpg',
  'photos/photo15.jpg',
  'photos/photo16.jpg',
  'photos/photo17.jpg',
  'photos/photo18.jpg',
  'photos/photo19.jpg',
];

// ── GALLERY ──────────────────────────────────────────────────
(function initGallery() {
  const mainImg   = document.getElementById('gallery-main-img');
  const thumbsEl  = document.getElementById('gallery-thumbs');
  const prevBtn   = document.getElementById('gallery-prev');
  const nextBtn   = document.getElementById('gallery-next');

  if (!mainImg || !thumbsEl) return;

  let currentIndex = 0;

  // メイン画像をphotoList[0]で初期化（ロード完了後に表示）
  mainImg.style.display = 'none';
  mainImg.onload = () => { mainImg.style.display = 'block'; };
  mainImg.src = photoList[0];

  // Build thumbnails
  photoList.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'gallery-thumb' + (i === 0 ? ' active' : '');
    wrap.dataset.index = i;

    const img = document.createElement('img');
    img.src = src;
    img.alt = `Photo ${i + 1}`;
    img.loading = 'lazy';

    wrap.appendChild(img);
    thumbsEl.appendChild(wrap);

    wrap.addEventListener('click', () => switchTo(i));
  });

  function switchTo(index) {
    if (index === currentIndex) return;
    mainImg.classList.add('fading');

    setTimeout(() => {
      currentIndex = (index + photoList.length) % photoList.length;
      mainImg.src = photoList[currentIndex];
      mainImg.classList.remove('fading');

      // Update active thumb（ギャラリー1のサムネイルのみ対象）
      thumbsEl.querySelectorAll('.gallery-thumb').forEach((t, i) => {
        t.classList.toggle('active', i === currentIndex);
      });

      // Scroll active thumb into view
      const activeThumb = thumbsEl.children[currentIndex];
      if (activeThumb) {
        activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }, 220);
  }

  prevBtn.addEventListener('click', () => switchTo(currentIndex - 1));
  nextBtn.addEventListener('click', () => switchTo(currentIndex + 1));

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    const worksSection = document.getElementById('works');
    const rect = worksSection.getBoundingClientRect();
    // Only if works section is roughly visible
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      if (e.key === 'ArrowLeft')  switchTo(currentIndex - 1);
      if (e.key === 'ArrowRight') switchTo(currentIndex + 1);
    }
  });

  // Touch/swipe support
  let touchStartX = 0;
  mainImg.parentElement.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].clientX;
  }, { passive: true });

  mainImg.parentElement.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) {
      switchTo(dx < 0 ? currentIndex + 1 : currentIndex - 1);
    }
  }, { passive: true });
})();





// ── GALLERY 2: BiSH ──────────────────────────────────────────
// 写真ファイルを photos2/ フォルダに入れ、ここにファイル名を追加してください。
const photoList2 = [
  'photos2/bish01.jpg',
  'photos2/bish02.jpg',
  'photos2/bish03.jpg',
  'photos2/bish04.jpg',
  'photos2/bish05.jpg',
  'photos2/bish06.jpg',
  'photos2/bish07.jpg',
  'photos2/bish08.jpg',
  'photos2/bish09.jpg',
  'photos2/bish10.jpg',
  'photos2/bish11.jpg',
  'photos2/bish12.jpg',
  'photos2/bish13.jpg',
];

(function initGallery2() {
  const mainImg  = document.getElementById('gallery2-main-img');
  const thumbsEl = document.getElementById('gallery2-thumbs');
  const prevBtn  = document.getElementById('gallery2-prev');
  const nextBtn  = document.getElementById('gallery2-next');

  if (!mainImg || !thumbsEl) return;

  let currentIndex = 0;

  mainImg.style.display = 'none';
  mainImg.onload = () => { mainImg.style.display = 'block'; };
  mainImg.src = photoList2[0];

  photoList2.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'gallery-thumb' + (i === 0 ? ' active' : '');
    wrap.dataset.index = i;

    const img = document.createElement('img');
    img.src = src;
    img.alt = `BiSH Photo ${i + 1}`;
    img.loading = 'lazy';

    wrap.appendChild(img);
    thumbsEl.appendChild(wrap);
    wrap.addEventListener('click', () => switchTo2(i));
  });

  function switchTo2(index) {
    if (index === currentIndex) return;
    mainImg.classList.add('fading');
    setTimeout(() => {
      currentIndex = (index + photoList2.length) % photoList2.length;
      mainImg.src = photoList2[currentIndex];
      mainImg.classList.remove('fading');
      document.querySelectorAll('#gallery2-thumbs .gallery-thumb').forEach((t, i) => {
        t.classList.toggle('active', i === currentIndex);
      });
      const activeThumb = thumbsEl.children[currentIndex];
      if (activeThumb) {
        activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }, 220);
  }

  prevBtn.addEventListener('click', () => switchTo2(currentIndex - 1));
  nextBtn.addEventListener('click', () => switchTo2(currentIndex + 1));

  let touchStartX2 = 0;
  mainImg.parentElement.addEventListener('touchstart', e => {
    touchStartX2 = e.changedTouches[0].clientX;
  }, { passive: true });
  mainImg.parentElement.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX2;
    if (Math.abs(dx) > 40) switchTo2(dx < 0 ? currentIndex + 1 : currentIndex - 1);
  }, { passive: true });
})();

// ── SCROLL FADE-IN ────────────────────────────────────────────
(function initScrollFade() {
  const targets = document.querySelectorAll(
    '.about-block, .timeline li, .tag-list li, .gallery-main, .sns-btn, .section-desc'
  );

  targets.forEach(el => el.classList.add('fade-in'));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  targets.forEach(el => observer.observe(el));
})();


// ── STAGGER DELAY FOR LISTS ───────────────────────────────────
(function staggerLists() {
  document.querySelectorAll('.timeline li, .tag-list li').forEach((el, i) => {
    el.style.transitionDelay = `${i * 0.06}s`;
  });
})();



// ── LANGUAGE SWITCHER (JP / EN 両ボタン常時表示) ─────────────
(function initLangToggle() {
  const btnJp = document.getElementById('lang-jp');
  const btnEn = document.getElementById('lang-en');
  if (!btnJp || !btnEn) return;

  // 保存済みの言語を復元（デフォルト: ja）
  let currentLang = localStorage.getItem('lang') || 'ja';

  function applyLang(lang) {
    // data-ja / data-en を持つ要素のテキストを切り替え
    document.querySelectorAll('[data-ja][data-en]').forEach(el => {
      el.innerHTML = lang === 'en' ? el.dataset.en : el.dataset.ja;
    });

    // JP・EN ボタンのアクティブ状態を更新
    btnJp.classList.toggle('active', lang === 'ja');
    btnEn.classList.toggle('active', lang === 'en');

    // html[lang] 属性を更新
    document.documentElement.lang = lang === 'en' ? 'en' : 'ja';

    // 保存
    localStorage.setItem('lang', lang);
    currentLang = lang;
  }

  // 初期適用
  applyLang(currentLang);

  btnJp.addEventListener('click', () => applyLang('ja'));
  btnEn.addEventListener('click', () => applyLang('en'));
})();

// ── NAV ACTIVE HIGHLIGHT ON SCROLL ───────────────────────────
(function initNavHighlight() {
  const sections = document.querySelectorAll('section[id]');
  const links    = document.querySelectorAll('.nav a');

  function onScroll() {
    let current = '';
    sections.forEach(sec => {
      const top = sec.offsetTop - 120;
      if (window.scrollY >= top) current = sec.getAttribute('id');
    });
    links.forEach(link => {
      link.style.color = link.getAttribute('href') === '#' + current
        ? 'rgba(255,255,255,0.9)'
        : '';
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
