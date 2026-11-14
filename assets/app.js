/* Hyakusho - application script.
   No dependencies. Every value that comes from books.xlsx / books.csv is treated as untrusted:
   it is validated, length-limited and written to the page with textContent only (never as HTML). */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ limits */
  const LIMITS = Object.freeze({
    fileBytes: 4 * 1024 * 1024,     // largest books.xlsx / books.csv accepted
    entryBytes: 12 * 1024 * 1024,   // largest single file inside the xlsx after decompression
    entries: 400,                   // files inside the xlsx
    rows: 5000, cols: 64,
    books: 300,
    title: 200, author: 120, genre: 40, review: 4000, url: 2000
  });
  const COLUMNS = ['id', 'title', 'author', 'genre', 'cover', 'amazonUrl', 'review'];
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  // Every failure carries a short code, so the error screen can say exactly what went wrong.
  const fail = (code, detail) => { const e = new Error(code + (detail ? ' ' + detail : '')); e.code = code; e.detail = detail || ''; return e; };
  const codeOf = (e) => (e && e.code) || (e instanceof TypeError ? 'network' : 'broken');

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const returning = document.documentElement.classList.contains('is-returning');   // set by boot.js
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  /* -------------------------------------------------------------- sanitizers */
  // Control characters, zero-width characters and bidi overrides (used to disguise text).
  const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

  function cleanText(value, max, multiline) {
    let s = String(value == null ? '' : value).replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(INVISIBLE, '');
    s = multiline ? s.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
    s = s.trim();
    if (s.length > max) s = Array.from(s).slice(0, max).join('') + '\u2026';
    return s;
  }

  // Purchase link: https only, no embedded credentials, a real host name, default port.
  function safeLink(value) {
    const s = String(value == null ? '' : value).trim();
    if (!s || s.length > LIMITS.url || !/^https:\/\//i.test(s)) return null;
    let u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const host = u.hostname;
    if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || /^[0-9.]+$/.test(host)) return null;
    return { href: u.href, host: host.replace(/^www\./, '') };
  }

  // Cover image: only a file directly inside the site's own cover/ folder.
  function safeCover(value) {
    const s = String(value == null ? '' : value).trim().replace(/^\.\//, '');
    return /^cover\/[A-Za-z0-9_-]{1,64}\.(?:jpe?g|png|webp|avif|gif)$/i.test(s) ? s : '';
  }

  const fold = (s) => s.normalize('NFKC').toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

  /* ------------------------------------------------------------- xlsx reader */
  // An .xlsx file is a zip of XML files. The browser's own DecompressionStream and DOMParser
  // are enough to read the one sheet we need, so no third-party library is loaded.

  function zipIndex(buf) {
    const dv = new DataView(buf), len = buf.byteLength;
    let eocd = -1;
    for (let i = len - 22, stop = Math.max(0, len - 65557); i >= stop; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) {
      // Password-protected workbooks and the old .xls format are OLE files, not zip files.
      const ole = len >= 8 && dv.getUint32(0) === 0xD0CF11E0 && dv.getUint32(4) === 0xA1B11AE1;
      throw fail(ole ? 'ole' : 'not-xlsx');
    }
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    if (count > LIMITS.entries || off === 0xFFFFFFFF) throw new Error('zip too complex');
    const names = new TextDecoder();
    const map = new Map();
    for (let i = 0; i < count; i++) {
      if (off + 46 > len || dv.getUint32(off, true) !== 0x02014b50) throw new Error('bad zip directory');
      const nameLen = dv.getUint16(off + 28, true);
      map.set(names.decode(new Uint8Array(buf, off + 46, nameLen)), {
        flags: dv.getUint16(off + 8, true),
        method: dv.getUint16(off + 10, true),
        csize: dv.getUint32(off + 20, true),
        usize: dv.getUint32(off + 24, true),
        local: dv.getUint32(off + 42, true)
      });
      off += 46 + nameLen + dv.getUint16(off + 30, true) + dv.getUint16(off + 32, true);
    }
    return map;
  }

  async function inflate(bytes, limit) {
    // Feed the compressed data in small slices and stop as soon as the output passes the limit,
    // so a "zip bomb" is abandoned after a few megabytes instead of being expanded in memory.
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter(), reader = ds.readable.getReader();
    const feed = (async () => {
      try {
        for (let i = 0; i < bytes.length; i += 4096) { await writer.ready; await writer.write(bytes.subarray(i, i + 4096)); }
        await writer.close();
      } catch (e) { return e; }
      return null;
    })();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        reader.cancel().catch(() => {});
        writer.abort().catch(() => {});
        throw new Error('decompressed data too large');
      }
      chunks.push(value);
    }
    const failed = await feed;
    if (failed) throw failed;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  async function zipText(buf, map, name) {
    const e = map.get(name);
    if (!e) return null;
    if ((e.flags & 1) || e.usize > LIMITS.entryBytes) throw new Error('unsupported zip entry');
    const dv = new DataView(buf);
    if (e.local + 30 > buf.byteLength || dv.getUint32(e.local, true) !== 0x04034b50) throw new Error('bad zip entry');
    const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
    if (start + e.csize > buf.byteLength) throw new Error('bad zip entry');
    const raw = new Uint8Array(buf, start, e.csize);
    let data;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = await inflate(raw, LIMITS.entryBytes);
    else throw new Error('unsupported compression');
    return new TextDecoder('utf-8').decode(data);
  }

  let xmlPolicy = null;
  function parseXml(str) {
    if (str == null) throw new Error('missing part');
    if (/<!DOCTYPE|<!ENTITY/i.test(str)) throw new Error('DTD not allowed'); // no entity expansion tricks
    let src = str;
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
      // The parsed XML stays in a detached document and is only read as text; it never reaches the page.
      xmlPolicy = xmlPolicy || window.trustedTypes.createPolicy('hyakusho-xml', { createHTML: (s) => s });
      src = xmlPolicy.createHTML(str);
    }
    const doc = new DOMParser().parseFromString(src, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('bad xml');
    return doc;
  }

  const tags = (node, name) => node.getElementsByTagNameNS('*', name);
  const unescapeOoxml = (s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));

  // Text of a string item, ignoring phonetic guides (furigana) that Excel stores alongside.
  function stringItem(node) {
    let s = '';
    for (const c of node.children) {
      if (c.localName === 't') s += c.textContent;
      else if (c.localName === 'r') for (const t of c.children) if (t.localName === 't') s += t.textContent;
    }
    return unescapeOoxml(s);
  }

  function columnIndex(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
      else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
      else break;
    }
    return n - 1;
  }

  async function readXlsx(buf) {
    if (buf.byteLength > LIMITS.fileBytes) throw fail('too-large');
    const map = zipIndex(buf);
    const workbook = parseXml(await zipText(buf, map, 'xl/workbook.xml'));
    const first = tags(workbook, 'sheet')[0];
    if (!first) throw new Error('no sheet');
    const rid = first.getAttributeNS(REL_NS, 'id') || first.getAttribute('r:id');
    const rels = parseXml(await zipText(buf, map, 'xl/_rels/workbook.xml.rels'));
    let target = '';
    for (const r of tags(rels, 'Relationship')) if (r.getAttribute('Id') === rid) target = r.getAttribute('Target') || '';
    target = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target;
    if (!/^xl\/worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(target)) throw new Error('unexpected sheet path');

    const sharedXml = await zipText(buf, map, 'xl/sharedStrings.xml');
    const shared = sharedXml ? Array.from(tags(parseXml(sharedXml), 'si'), stringItem) : [];

    const sheet = parseXml(await zipText(buf, map, target));
    const table = [];
    for (const row of tags(sheet, 'row')) {
      if (table.length >= LIMITS.rows) break;
      const cells = [];
      let next = 0;
      for (const c of row.children) {
        if (c.localName !== 'c') continue;
        const ref = c.getAttribute('r');
        const col = ref ? columnIndex(ref) : next;
        next = col + 1;
        if (col < 0 || col >= LIMITS.cols) continue;
        const type = c.getAttribute('t');
        let v = '';
        if (type === 'inlineStr') {
          const is = tags(c, 'is')[0];
          v = is ? stringItem(is) : '';
        } else {
          const vn = tags(c, 'v')[0];
          const raw = vn ? vn.textContent : '';
          if (type === 's') v = shared[parseInt(raw, 10)] || '';
          else if (type === 'e') v = '';
          else v = type === 'str' ? unescapeOoxml(raw) : raw;
        }
        cells[col] = v;
      }
      table.push(cells);
    }
    return table;
  }

  /* -------------------------------------------------------------- csv reader */
  function readCsv(text) {
    const raw = text.replace(/^\ufeff/, '');
    const table = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i], n = raw[i + 1];
      if (quoted) {
        if (c === '"' && n === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && n === '\n') i++;
        row.push(field); field = '';
        table.push(row); row = [];
        if (table.length >= LIMITS.rows) return table;
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); table.push(row); }
    return table;
  }

  /* ------------------------------------------------- table -> validated books */
  function toBooks(table) {
    const headAt = table.findIndex((r) => r && r.some((c) => String(c || '').trim().toLowerCase() === 'title'));
    if (headAt < 0) throw fail('no-header');
    const head = table[headAt].map((c) => String(c || '').trim().toLowerCase());
    const at = {};
    for (const name of COLUMNS) at[name] = head.indexOf(name.toLowerCase());   // only known columns are read
    const get = (r, name) => (at[name] >= 0 && r[at[name]] != null ? r[at[name]] : '');

    const books = [];
    const used = new Set();
    for (let i = headAt + 1; i < table.length && books.length < LIMITS.books; i++) {
      const r = table[i];
      if (!r) continue;
      const title = cleanText(get(r, 'title'), LIMITS.title);
      if (!title) continue;
      const idText = String(get(r, 'id')).trim();
      let no = /^\d{1,4}(?:\.0+)?$/.test(idText) ? parseInt(idText, 10) : 0;
      if (no < 1 || used.has(no)) no = 0;
      if (no) used.add(no);
      const author = cleanText(get(r, 'author'), LIMITS.author);
      books.push({
        no, title, author,
        genre: cleanText(get(r, 'genre'), LIMITS.genre),
        cover: safeCover(get(r, 'cover')),
        link: safeLink(get(r, 'amazonUrl')),
        review: cleanText(get(r, 'review'), LIMITS.review, true),
        key: fold(title + ' ' + author)
      });
    }
    let free = 1;
    for (const b of books) {
      if (!b.no) { while (used.has(free)) free++; b.no = free; used.add(free); }
      b.label = String(b.no).padStart(3, '0');
      Object.freeze(b);
    }
    if (!books.length) throw fail('no-rows');
    return books.sort((a, b) => a.no - b.no);
  }

  async function fetchLimited(path, as) {
    const res = await fetch(path, { cache: 'no-cache', credentials: 'same-origin' });
    if (!res.ok) throw fail('http', String(res.status));
    if (Number(res.headers.get('content-length') || 0) > LIMITS.fileBytes) throw fail('too-large');
    const buf = await res.arrayBuffer();
    if (buf.byteLength > LIMITS.fileBytes) throw fail('too-large');
    return as === 'text' ? new TextDecoder('utf-8').decode(buf) : buf;
  }

  // What happened while loading; shown on the error screen and in the "?check" panel.
  const diag = { local: location.protocol === 'file:', source: '', xlsx: null, csv: null };

  async function booksFromXlsx(buf) {
    if (!('DecompressionStream' in window)) throw fail('old-browser');
    return toBooks(await readXlsx(buf));
  }

  async function loadBooks() {
    try {
      const books = await booksFromXlsx(await fetchLimited('books.xlsx'));
      diag.source = 'books.xlsx';
      return books;
    } catch (e) {
      diag.xlsx = e;
      if (!diag.local) console.warn('[hyakusho] books.xlsx was not used (' + e.message + '); trying books.csv');
    }
    try {
      const books = toBooks(readCsv(await fetchLimited('books.csv', 'text')));
      diag.source = 'books.csv';
      return books;
    } catch (e) {
      diag.csv = e;
      throw fail(diag.local ? 'local' : 'data');
    }
  }

  // A file the visitor picks by hand (used when the page is opened straight from the computer).
  async function loadPicked(file) {
    if (file.size > LIMITS.fileBytes) throw fail('too-large');
    const buf = await file.arrayBuffer();
    const books = /\.csv$/i.test(file.name) ? toBooks(readCsv(new TextDecoder('utf-8').decode(buf))) : await booksFromXlsx(buf);
    diag.source = /\.csv$/i.test(file.name) ? 'books.csv' : 'books.xlsx';
    diag.xlsx = diag.csv = null;
    return books;
  }

  /* ------------------------------------------------------------------ covers */
  function typesetCover(book) {
    const fb = el('span', 'fb');
    fb.append(el('span', 'fb-title', book.title), el('span', 'fb-author', book.author));
    return fb;
  }
  function coverNode(book, lazy) {
    if (!book.cover) return typesetCover(book);
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    if (lazy) img.loading = 'lazy';
    img.draggable = false;
    img.addEventListener('error', () => { if (img.isConnected) img.replaceWith(typesetCover(book)); }, { once: true });
    img.src = book.cover;
    return img;
  }

  /* --------------------------------------------------------------------- app */
  const state = { books: [], byNo: new Map(), genre: '', q: '', view: 'list', visible: [] };
  const ui = {
    belts: $('belts'), readout: $('readout'), roNo: $('readout-no'), roTitle: $('readout-title'), roAuthor: $('readout-author'),
    count: $('count'), chips: $('chips'), q: $('q'), list: $('list'), grid: $('grid'),
    vList: $('view-list'), vGrid: $('view-grid'), loading: $('loading'), error: $('error'), empty: $('empty'), reset: $('reset'),
    errTitle: $('error-title'), errLead: $('error-lead'), errList: $('error-list'), errPick: $('error-pick'), pick: $('pick'), pickFile: $('pick-file'), check: $('check'),
    tools: document.querySelector('.tools'), qClear: $('q-clear'), peek: $('peek'), peekImg: $('peek-img'),
    dlg: $('book'), scroll: $('bk-scroll'), body: $('bk-body'), cover: $('bk-cover'), no: $('bk-no'), genre: $('bk-genre'),
    title: $('bk-title'), author: $('bk-author'), review: $('bk-review'), link: $('bk-link'), host: $('bk-host'),
    copy: $('bk-copy'), prev: $('bk-prev'), next: $('bk-next'), prevT: $('bk-prev-t'), nextT: $('bk-next-t'), close: $('bk-close')
  };
  const pageTitle = document.title;

  /* ---- belts: two rows of covers drifting in opposite directions; no book appears in both ---- */
  const belts = [];
  let beltsRunning = false, lastFrame = 0, scrollBoost = 1, lastScrollY = window.scrollY, lastScrollT = 0;

  function makeBelt(root, items, velocity) {
    const track = root.firstElementChild;
    const belt = { root, track, items, base: velocity, target: velocity, v: velocity, x: 0, setW: 0, drag: null, dragged: false, cards: [] };

    const card = (book) => {
      const c = el('div', 'bk is-match');
      c.dataset.no = String(book.no);
      c.append(coverNode(book, true));
      belt.cards.push(c);
      return c;
    };
    const layout = () => {
      belt.cards = [];
      track.replaceChildren(...items.map(card));
      if (reducedMotion.matches) { root.classList.add('is-static'); track.style.transform = ''; belt.setW = 0; return; }
      root.classList.remove('is-static');
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      belt.setW = track.scrollWidth + gap;
      const copies = Math.min(8, Math.max(2, Math.ceil((root.clientWidth * 2) / belt.setW) + 1));
      for (let i = 1; i < copies; i++) track.append(...items.map(card));
      if (velocity < 0) belt.x = belt.setW;
      markMatches();
    };
    belt.layout = layout;
    layout();

    const bookAt = (e) => {
      const c = e.target.closest ? e.target.closest('.bk') : null;
      return c ? state.byNo.get(Number(c.dataset.no)) : null;
    };
    root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') belt.target = 0; });
    root.addEventListener('pointerleave', () => { belt.target = belt.base; setReadout(null); });
    root.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse' && !belt.drag) setReadout(bookAt(e)); });

    root.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button !== 0 || !belt.setW) return;
      belt.drag = { id: e.pointerId, x0: e.clientX, start: belt.x, lastX: e.clientX, lastT: e.timeStamp, vx: 0, moved: false };
      belt.dragged = false;
    });
    root.addEventListener('pointermove', (e) => {
      const d = belt.drag;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x0;
      if (!d.moved && Math.abs(dx) > 6) {
        d.moved = true; belt.dragged = true;
        root.classList.add('is-dragging');
        try { root.setPointerCapture(d.id); } catch (err) { /* ignore */ }
      }
      if (!d.moved) return;
      belt.x = d.start - dx;
      const dt = Math.max(1, e.timeStamp - d.lastT);
      d.vx = d.vx * .7 + ((d.lastX - e.clientX) / dt) * 1000 * .3;
      d.lastX = e.clientX; d.lastT = e.timeStamp;
    });
    const release = (e) => {
      const d = belt.drag;
      if (!d || e.pointerId !== d.id) return;
      if (d.moved) belt.v = Math.max(-2400, Math.min(2400, d.vx));
      belt.drag = null;
      root.classList.remove('is-dragging');
      if (e.pointerType !== 'mouse') belt.target = belt.base;
    };
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
    root.addEventListener('click', (e) => {
      if (belt.dragged) { belt.dragged = false; return; }
      const book = bookAt(e);
      if (book) openBook(book, e.target.closest('.bk').firstElementChild);
    });
    return belt;
  }

  function frame(t) {
    if (!beltsRunning) return;
    const dt = Math.min(.05, (t - lastFrame) / 1000 || 0);
    lastFrame = t;
    scrollBoost += (1 - scrollBoost) * Math.min(1, dt * 3);
    for (const b of belts) {
      if (!b.setW) continue;
      if (!b.drag || !b.drag.moved) {
        b.v += (b.target * scrollBoost - b.v) * Math.min(1, dt * 3.2);
        b.x += b.v * dt;
      }
      b.x = ((b.x % b.setW) + b.setW) % b.setW;
      b.track.style.transform = 'translate3d(' + (-b.x).toFixed(2) + 'px,0,0)';
    }
    requestAnimationFrame(frame);
  }
  function runBelts(on) {
    on = on && !reducedMotion.matches && !document.hidden;
    if (on === beltsRunning) return;
    beltsRunning = on;
    if (on) { lastFrame = performance.now(); requestAnimationFrame(frame); }
  }

  function setReadout(book) {
    ui.readout.classList.toggle('is-idle', !book);
    ui.roNo.textContent = book ? book.label : '';
    ui.roTitle.textContent = book ? book.title : ui.roTitle.dataset.idle;
    ui.roAuthor.textContent = book ? book.author : '';
  }

  function buildBelts() {
    const rows = ui.belts.querySelectorAll('.belt');
    const upper = state.books.filter((b, i) => i % 2 === 0);   // each book goes to exactly one row
    const lower = state.books.filter((b, i) => i % 2 === 1);
    const speed = window.innerWidth < 760 ? 22 : 30;            // px per second
    belts.push(makeBelt(rows[0], upper, speed));
    if (lower.length) belts.push(makeBelt(rows[1], lower, -speed)); else rows[1].hidden = true;
    setReadout(null);
    // The belts arrive at speed as the title page appears, then settle to a slow drift.
    setTimeout(() => belts.forEach((b) => { b.v = b.base * 14; }), Math.max(0, (returning ? 200 : 1500) - performance.now()));

    let heroVisible = true;
    new IntersectionObserver((entries) => { heroVisible = entries[0].isIntersecting; runBelts(heroVisible); }).observe(ui.belts);
    document.addEventListener('visibilitychange', () => runBelts(heroVisible));
    let resizeTimer = 0, lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; belts.forEach((b) => b.layout()); } }, 200);
    });
    reducedMotion.addEventListener('change', () => { belts.forEach((b) => b.layout()); runBelts(heroVisible); });
    window.addEventListener('scroll', () => {
      const now = performance.now(), dy = Math.abs(window.scrollY - lastScrollY), dt = Math.max(16, now - lastScrollT);
      lastScrollY = window.scrollY; lastScrollT = now;
      scrollBoost = Math.min(5, Math.max(scrollBoost, 1 + (dy / dt) * 1.6));
    }, { passive: true });
    runBelts(true);
  }

  function markMatches() {
    const filtered = !!(state.genre || state.q);
    ui.belts.classList.toggle('is-filtered', filtered);
    const ok = new Set(state.visible.map((b) => b.no));
    for (const b of belts) for (const c of b.cards) c.classList.toggle('is-match', !filtered || ok.has(Number(c.dataset.no)));
  }

  /* ---- contents: list / grid, genre filter, search ---- */
  const rowEls = new Map(), tileEls = new Map();

  function buildList() {
    const frag = document.createDocumentFragment();
    for (const b of state.books) {
      const li = el('li');
      const btn = el('button', 'row');
      btn.type = 'button';
      btn.dataset.no = String(b.no);
      btn.append(el('span', 'row-no', b.label), el('span', 'row-title', b.title), el('span', 'row-author', b.author), el('span', 'row-genre', b.genre));
      li.append(btn);
      rowEls.set(b.no, li);
      frag.append(li);
    }
    ui.list.replaceChildren(frag);
  }
  function buildGrid() {
    if (tileEls.size) return;
    const frag = document.createDocumentFragment();
    for (const b of state.books) {
      const li = el('li');
      const btn = el('button', 'tile');
      btn.type = 'button';
      btn.dataset.no = String(b.no);
      const cover = el('span', 'tile-cover');
      cover.append(coverNode(b, true));
      btn.append(cover, el('span', 'tile-no', b.label), el('span', 'tile-title', b.title));
      li.append(btn);
      tileEls.set(b.no, li);
      frag.append(li);
    }
    ui.grid.replaceChildren(frag);
  }
  function buildChips() {
    const counts = new Map();
    for (const b of state.books) if (b.genre) counts.set(b.genre, (counts.get(b.genre) || 0) + 1);
    const chip = (label, value, n) => {
      const c = el('button', 'chip', label);
      c.type = 'button';
      c.dataset.genre = value;
      c.setAttribute('aria-pressed', String(value === state.genre));
      c.append(el('span', 'chip-n', String(n)));
      return c;
    };
    const sorted = Array.from(counts).sort((a, b) => b[1] - a[1]).slice(0, 24);
    ui.chips.replaceChildren(chip(ui.chips.dataset.all, '', state.books.length), ...sorted.map(([g, n]) => chip(g, g, n)));
  }

  function applyFilter() {
    const q = fold(cleanText(state.q, 60));
    state.visible = state.books.filter((b) => (!state.genre || b.genre === state.genre) && (!q || b.key.includes(q)));
    const ok = new Set(state.visible.map((b) => b.no));
    for (const [no, li] of rowEls) li.hidden = !ok.has(no);
    for (const [no, li] of tileEls) li.hidden = !ok.has(no);
    const total = state.books.length, n = state.visible.length;
    ui.count.textContent = n === total ? total + '\u518a' : n + ' / ' + total + '\u518a';
    ui.empty.hidden = n > 0;
    ui.list.hidden = state.view !== 'list' || n === 0;
    ui.grid.hidden = state.view !== 'grid' || n === 0;
    for (const c of ui.chips.children) c.setAttribute('aria-pressed', String(c.dataset.genre === state.genre));
    markMatches();
  }

  // When the visitor filters while far down the list, the list gets shorter and the page would
  // otherwise jump to the end. Keep the start of the results right under the sticky bar instead.
  function keepResultsInView() {
    const bar = ui.tools.getBoundingClientRect();
    const head = ui.tools.previousElementSibling.getBoundingClientRect();
    const naturalTop = head.bottom + window.scrollY + parseFloat(getComputedStyle(ui.tools).marginTop);
    if (window.scrollY > naturalTop + 1 && bar.top <= 1) window.scrollTo({ top: naturalTop, behavior: 'instant' });
  }

  function setView(view) {
    state.view = view;
    if (view === 'grid') buildGrid();
    ui.vList.setAttribute('aria-pressed', String(view === 'list'));
    ui.vGrid.setAttribute('aria-pressed', String(view === 'grid'));
    applyFilter();
  }

  /* ---- floating cover that follows the pointer over the list ---- */
  function initPeek() {
    // ty is the edge of the cover nearest the row; tsh shifts the cover up by its own height (-100%)
    // when it sits above the row, so covers of any proportion keep clear of the row.
    let tx = 0, ty = 0, tsh = 0, x = 0, y = 0, sh = 0, on = false, raf = 0, current = 0;
    const loop = () => {
      x += (tx - x) * .16; y += (ty - y) * .16; sh += (tsh - sh) * .2;
      ui.peek.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) translateY(' + sh.toFixed(2) + '%)';
      raf = on || Math.abs(tx - x) > .5 || Math.abs(ty - y) > .5 ? requestAnimationFrame(loop) : 0;
    };
    const hide = () => { on = false; current = 0; ui.peek.classList.remove('is-on'); };
    ui.peekImg.addEventListener('error', hide);
    ui.list.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !finePointer.matches || reducedMotion.matches) return;
      const row = e.target.closest('.row');
      const book = row ? state.byNo.get(Number(row.dataset.no)) : null;
      if (!book || !book.cover) { hide(); return; }
      // Float the cover beside the cursor but never over the hovered row: above it, or below when
      // there is no room above (under the sticky bar).
      // Use the side with more room and size the cover to fit it (covers are at most ~1.6 times taller than wide).
      const r = row.getBoundingClientRect(), barBottom = ui.tools.getBoundingClientRect().bottom;
      const roomAbove = r.top - 12 - (barBottom + 8), roomBelow = window.innerHeight - 12 - (r.bottom + 12);
      const above = roomAbove >= roomBelow;
      const w = Math.round(Math.max(112, Math.min(184, (above ? roomAbove : roomBelow) / 1.6)));
      ui.peek.style.width = w + 'px';
      tx = Math.max(16, Math.min(window.innerWidth - w - 16, e.clientX - w / 2));
      ty = above ? r.top - 12 : r.bottom + 12;
      tsh = above ? -100 : 0;
      if (current !== book.no) {
        current = book.no;
        ui.peekImg.src = book.cover;
        if (!on) { x = tx; y = ty; sh = tsh; }
      }
      on = true;
      ui.peek.classList.add('is-on');
      if (!raf) raf = requestAnimationFrame(loop);
    });
    ui.list.addEventListener('pointerleave', hide);
    window.addEventListener('scroll', hide, { passive: true });
  }

  /* ---- the opened book ---- */
  let currentBook = null, pushedState = false;
  const bookFromHash = () => {
    const m = /^#book-(\d{1,4})$/.exec(location.hash);
    return m ? state.byNo.get(Number(m[1])) || null : null;
  };
  const neighbours = (book) => {
    const pool = state.visible.includes(book) && state.visible.length > 1 ? state.visible : state.books;
    const i = pool.indexOf(book);
    return { prev: pool[(i - 1 + pool.length) % pool.length], next: pool[(i + 1) % pool.length] };
  };

  function fillBook(book) {
    currentBook = book;
    ui.cover.replaceChildren(coverNode(book, false));
    ui.no.textContent = book.label;
    ui.genre.textContent = book.genre;
    ui.title.textContent = book.title;
    ui.author.textContent = book.author;
    ui.review.textContent = book.review;
    ui.review.hidden = !book.review;
    ui.link.hidden = !book.link;
    if (book.link) { ui.link.href = book.link.href; ui.host.textContent = book.link.host; }
    else ui.link.removeAttribute('href');
    const nb = neighbours(book);
    ui.prevT.textContent = nb.prev.label + '\u3000' + nb.prev.title;
    ui.nextT.textContent = nb.next.label + '\u3000' + nb.next.title;
    ui.copy.textContent = ui.copy.dataset.label;
    ui.body.scrollTop = 0; ui.scroll.scrollTop = 0;
    document.title = book.title + ' | ' + pageTitle;
  }

  function openBook(book, source) {
    const wasOpen = ui.dlg.open;
    const show = () => { fillBook(book); if (!ui.dlg.open) ui.dlg.showModal(); };
    const canMorph = !wasOpen && source && source.tagName === 'IMG' && source.complete && source.naturalWidth > 0 &&
      document.startViewTransition && !reducedMotion.matches;
    if (canMorph) {
      // The cover the visitor picked travels into the opened book.
      source.style.viewTransitionName = 'cover';
      const vt = document.startViewTransition(() => {
        source.style.viewTransitionName = '';
        show();
        const big = ui.cover.firstElementChild;
        if (big) big.style.viewTransitionName = 'cover';
      });
      vt.finished.finally(() => { const big = ui.cover.firstElementChild; if (big) big.style.viewTransitionName = ''; });
    } else show();
    const hash = '#book-' + book.no;
    if (location.hash !== hash) {
      if (wasOpen) history.replaceState(null, '', hash);
      else { history.pushState(null, '', hash); pushedState = true; }
    }
  }

  function initBook() {
    ui.close.addEventListener('click', () => ui.dlg.close());
    ui.dlg.addEventListener('click', (e) => { if (e.target === ui.dlg) ui.dlg.close(); });   // click on the backdrop
    ui.dlg.addEventListener('close', () => {
      document.title = pageTitle;
      currentBook = null;
      if (/^#book-\d+$/.test(location.hash)) {
        if (pushedState) history.back();
        else history.replaceState(null, '', location.pathname + location.search);
      }
      pushedState = false;
    });
    window.addEventListener('popstate', () => {
      const book = bookFromHash();
      if (book) { fillBook(book); if (!ui.dlg.open) ui.dlg.showModal(); }
      else if (ui.dlg.open) { pushedState = false; ui.dlg.close(); }
    });
    const step = (dir) => { if (currentBook) openBook(neighbours(currentBook)[dir]); };
    ui.prev.addEventListener('click', () => step('prev'));
    ui.next.addEventListener('click', () => step('next'));
    ui.dlg.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step('prev'); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step('next'); }
    });
    if (navigator.clipboard && window.isSecureContext) {
      ui.copy.hidden = false;
      let timer = 0;
      ui.copy.addEventListener('click', () => {
        if (!currentBook) return;
        navigator.clipboard.writeText(location.origin + location.pathname + '#book-' + currentBook.no).then(() => {
          ui.copy.textContent = ui.copy.dataset.done;
          clearTimeout(timer);
          timer = setTimeout(() => { ui.copy.textContent = ui.copy.dataset.label; }, 1800);
        }).catch(() => { /* permission denied: leave the label as is */ });
      });
    }
  }

  /* ---- start ---- */
  function start(books) {
    state.books = books;
    state.byNo = new Map(books.map((b) => [b.no, b]));
    ui.loading.hidden = true;

    buildChips();
    buildList();
    applyFilter();
    buildBelts();
    initPeek();
    initBook();

    const pick = (e) => {
      const btn = e.target.closest('[data-no]');
      const book = btn ? state.byNo.get(Number(btn.dataset.no)) : null;
      if (book) openBook(book, btn.querySelector('img'));
    };
    ui.list.addEventListener('click', pick);
    ui.grid.addEventListener('click', pick);
    ui.chips.addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      if (state.genre === c.dataset.genre) return;
      state.genre = c.dataset.genre;
      applyFilter();
      keepResultsInView();
    });
    let typing = 0;
    const search = (value, now) => {
      clearTimeout(typing);
      ui.qClear.hidden = !value;
      const run = () => { state.q = value; applyFilter(); keepResultsInView(); };
      if (now) run(); else typing = setTimeout(run, 120);
    };
    ui.q.addEventListener('input', () => search(ui.q.value));
    ui.q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.q.value) { e.preventDefault(); ui.q.value = ''; search('', true); } });
    ui.qClear.addEventListener('click', () => { ui.q.value = ''; search('', true); ui.q.focus(); });
    ui.reset.addEventListener('click', () => { state.genre = ''; ui.q.value = ''; search('', true); ui.q.focus(); });
    ui.vList.addEventListener('click', () => setView('list'));
    ui.vGrid.addEventListener('click', () => setView('grid'));

    const linked = bookFromHash();
    if (linked) { fillBook(linked); ui.dlg.showModal(); }
  }

  /* ---- messages for the error screen and the "?check" panel ---- */
  const MSG = {
    localTitle: '\u3053\u306e\u958b\u304d\u65b9\u3067\u306f\u3001\u672c\u306e\u30c7\u30fc\u30bf\u3092\u81ea\u52d5\u3067\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3002',
    localLead: '\u30d1\u30bd\u30b3\u30f3\u306e\u4e2d\u306e index.html \u3092\u76f4\u63a5\u958b\u3044\u3066\u3044\u307e\u3059\u3002\u30d6\u30e9\u30a6\u30b6\u306f\u5b89\u5168\u306e\u305f\u3081\u3001\u3053\u306e\u958b\u304d\u65b9\u3067\u306f\u30da\u30fc\u30b8\u304c\u540c\u3058\u30d5\u30a9\u30eb\u30c0\u306e\u30d5\u30a1\u30a4\u30eb\u3092\u8aad\u3080\u3053\u3068\u3092\u8a31\u53ef\u3057\u3066\u3044\u307e\u305b\u3093\u3002books.xlsx \u306e\u7f6e\u304d\u5834\u6240\u304c\u9593\u9055\u3063\u3066\u3044\u308b\u308f\u3051\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002',
    localLead2: '\u4e0b\u306e\u30dc\u30bf\u30f3\u3067 books.xlsx \u3092\u9078\u3076\u3068\u3001\u3053\u306e\u5834\u3067\u8868\u793a\u3092\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002GitHub \u306b\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9\u3057\u3066\u516c\u958b\u3057\u305f\u30b5\u30a4\u30c8\u3067\u306f\u3001\u81ea\u52d5\u3067\u8aad\u307f\u8fbc\u307e\u308c\u307e\u3059\u3002',
    dataTitle: '\u672c\u306e\u30c7\u30fc\u30bf\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002',
    dataLead: 'index.html \u3068\u540c\u3058\u5834\u6240\u306e books.xlsx \u3068\u3001\u4e88\u5099\u306e books.csv \u3092\u9806\u306b\u8a66\u3057\u307e\u3057\u305f\u304c\u3001\u6b21\u306e\u7406\u7531\u3067\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002',
    showTitle: '\u8868\u793a\u306e\u9014\u4e2d\u3067\u30a8\u30e9\u30fc\u304c\u8d77\u304d\u307e\u3057\u305f\u3002',
    showLead: '\u30c7\u30fc\u30bf\u306f\u8aad\u307f\u8fbc\u3081\u307e\u3057\u305f\u304c\u3001\u753b\u9762\u3092\u7d44\u307f\u7acb\u3066\u308b\u9014\u4e2d\u3067\u6b62\u307e\u308a\u307e\u3057\u305f\u3002\u3053\u306e\u753b\u9762\u3092\u64ae\u3063\u3066\u77e5\u3089\u305b\u3066\u304f\u3060\u3055\u3044\u3002',
    pickTitle: '\u9078\u3093\u3060\u30d5\u30a1\u30a4\u30eb\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002',
    heroHint: '\u672c\u306e\u30c7\u30fc\u30bf\u3092\u307e\u3060\u8aad\u307f\u8fbc\u3081\u3066\u3044\u307e\u305b\u3093\u3002\u4e0b\u306e\u300c\u76ee\u6b21\u300d\u306b\u7406\u7531\u3068\u5bfe\u51e6\u3092\u8868\u793a\u3057\u3066\u3044\u307e\u3059\u3002',
    reason: {
      http404: '\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002\u30d5\u30a1\u30a4\u30eb\u540d\u304c\u534a\u89d2\u5c0f\u6587\u5b57\u3067\u6b63\u3057\u3044\u304b\u3001index.html \u3068\u540c\u3058\u968e\u5c64\u306b\u3042\u308b\u304b\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
      http: '\u30b5\u30fc\u30d0\u30fc\u304b\u3089\u30a8\u30e9\u30fc\u304c\u8fd4\u308a\u307e\u3057\u305f\uff08HTTP {d}\uff09\u3002',
      network: '\u8aad\u307f\u8fbc\u307f\u304c\u9014\u4e2d\u3067\u6b62\u307e\u308a\u307e\u3057\u305f\u3002\u901a\u4fe1\u306e\u72b6\u614b\u3092\u78ba\u8a8d\u3057\u3066\u3001\u3082\u3046\u4e00\u5ea6\u958b\u3044\u3066\u304f\u3060\u3055\u3044\u3002',
      'too-large': '\u30d5\u30a1\u30a4\u30eb\u304c\u5927\u304d\u3059\u304e\u307e\u3059\uff08\u4e0a\u9650 4MB\uff09\u3002\u753b\u50cf\u3092\u8cbc\u308a\u4ed8\u3051\u3066\u3044\u308b\u5834\u5408\u306f\u5916\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
      ole: '\u30d1\u30b9\u30ef\u30fc\u30c9\u3067\u4fdd\u8b77\u3055\u308c\u3066\u3044\u308b\u304b\u3001\u53e4\u3044\u5f62\u5f0f\uff08.xls\uff09\u3067\u3059\u3002Excel \u3067\u300cExcel \u30d6\u30c3\u30af\uff08.xlsx\uff09\u300d\u3068\u3057\u3066\u3001\u30d1\u30b9\u30ef\u30fc\u30c9\u306a\u3057\u3067\u4fdd\u5b58\u3057\u76f4\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
      'not-xlsx': 'Excel \u30d6\u30c3\u30af\uff08.xlsx\uff09\u306e\u5f62\u5f0f\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002Excel \u3067\u958b\u304d\u3001\u300cExcel \u30d6\u30c3\u30af\uff08.xlsx\uff09\u300d\u3067\u4fdd\u5b58\u3057\u76f4\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
      broken: '\u30d5\u30a1\u30a4\u30eb\u306e\u4e2d\u8eab\u3092\u8aad\u307f\u53d6\u308c\u307e\u305b\u3093\u3067\u3057\u305f\u3002Excel \u3067\u958b\u3044\u3066\u4fdd\u5b58\u3057\u76f4\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
      'no-header': '\u898b\u51fa\u3057\u306e\u884c\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002\u4e00\u756a\u5de6\u306e\u30b7\u30fc\u30c8\u306e1\u884c\u76ee\u3092 id / title / author / genre / cover / amazonUrl / review \u306b\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
      'no-rows': 'title \u5217\u306b\u5165\u529b\u306e\u3042\u308b\u884c\u304c\u3042\u308a\u307e\u305b\u3093\u3002',
      'old-browser': '\u3053\u306e\u30d6\u30e9\u30a6\u30b6\u306f Excel \u306e\u76f4\u63a5\u8aad\u307f\u8fbc\u307f\u306b\u5bfe\u5fdc\u3057\u3066\u3044\u307e\u305b\u3093\u3002'
    },
    check: {
      head: '\u8868\u793a\u306e\u70b9\u691c',
      openLocal: '\u958b\u304d\u65b9\uff1a\u30d1\u30bd\u30b3\u30f3\u306e\u4e2d\u306e\u30d5\u30a1\u30a4\u30eb\u3092\u76f4\u63a5\u958b\u3044\u3066\u3044\u307e\u3059',
      openWeb: '\u958b\u304d\u65b9\uff1a\u516c\u958b\u30b5\u30a4\u30c8\u3068\u3057\u3066\u958b\u3044\u3066\u3044\u307e\u3059',
      fromXlsx: '\u30c7\u30fc\u30bf\uff1abooks.xlsx \u304b\u3089 {n}\u518a\u3092\u8aad\u307f\u8fbc\u307f\u307e\u3057\u305f',
      fromCsv: '\u30c7\u30fc\u30bf\uff1a\u4e88\u5099\u306e books.csv \u304b\u3089 {n}\u518a\u3092\u8aad\u307f\u8fbc\u307f\u307e\u3057\u305f\uff08books.xlsx \u306f\u4f7f\u3048\u3066\u3044\u307e\u305b\u3093\uff09',
      coverWait: '\u66f8\u5f71\uff1a\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059',
      coverOk: '\u66f8\u5f71\uff1a{n}\u679a\u3059\u3079\u3066\u8868\u793a\u3067\u304d\u307e\u3059',
      coverBad: '\u66f8\u5f71\uff1a{n}\u679a\u306e\u3046\u3061 {m}\u679a\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\uff08{list}\uff09\u3002\u30d5\u30a1\u30a4\u30eb\u540d\u3068\u3001\u62e1\u5f35\u5b50\u304c\u5c0f\u6587\u5b57\u306e .jpg \u304b\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
      coverNone: '\u66f8\u5f71\u306e\u6307\u5b9a\u304c\u306a\u3044\u672c\uff1a{n}\u518a',
      linkNone: '\u300c\u5546\u54c1\u30da\u30fc\u30b8\u3078\u300d\u304c\u51fa\u306a\u3044\u672c\uff08amazonUrl \u304c\u7a7a\u304b https:// \u4ee5\u5916\uff09\uff1a{list}'
    }
  };
  const reasonText = (e) => {
    const code = codeOf(e);
    const key = code === 'http' && e.detail === '404' ? 'http404' : code;
    return (MSG.reason[key] || MSG.reason.broken).replace('{d}', (e && e.detail) || '');
  };

  function showError(err) {
    console.error('[hyakusho]', err);
    const code = codeOf(err);
    const lines = [];
    ui.errPick.hidden = true;
    if (code === 'local') {
      ui.errTitle.textContent = MSG.localTitle;
      ui.errLead.textContent = MSG.localLead;
      lines.push(MSG.localLead2);
      ui.errPick.hidden = false;
    } else if (code === 'data') {
      ui.errTitle.textContent = MSG.dataTitle;
      ui.errLead.textContent = MSG.dataLead;
      lines.push('books.xlsx\uff1a' + reasonText(diag.xlsx), 'books.csv\uff1a' + reasonText(diag.csv));
    } else if (err && err.picked) {
      ui.errTitle.textContent = MSG.pickTitle;
      ui.errLead.textContent = reasonText(err);
      ui.errPick.hidden = false;
    } else {
      ui.errTitle.textContent = MSG.showTitle;
      ui.errLead.textContent = MSG.showLead;
      lines.push(String((err && err.message) || err).slice(0, 200));
    }
    ui.errList.replaceChildren(...lines.map((t) => el('li', '', t)));
    ui.loading.hidden = true;
    ui.error.hidden = false;
    ui.belts.hidden = true;
    setReadout(null);
    ui.roTitle.textContent = MSG.heroHint;
  }

  // Adding "?check" to the address shows where the data came from and which covers are missing.
  function showCheck(books) {
    const c = MSG.check;
    const line = (t) => el('li', '', t);
    const items = [line(diag.local ? c.openLocal : c.openWeb),
      line((diag.source === 'books.csv' ? c.fromCsv : c.fromXlsx).replace('{n}', books.length))];
    if (diag.source === 'books.csv' && diag.xlsx) items.push(line('books.xlsx\uff1a' + reasonText(diag.xlsx)));
    const withCover = books.filter((b) => b.cover), noLink = books.filter((b) => !b.link);
    const coverLine = line(c.coverWait);
    items.push(coverLine);
    if (withCover.length < books.length) items.push(line(c.coverNone.replace('{n}', books.length - withCover.length)));
    if (noLink.length) items.push(line(c.linkNone.replace('{list}', noLink.slice(0, 12).map((b) => b.label).join('\u3001'))));
    const list = el('ul', 'state-list');
    list.append(...items);
    ui.check.replaceChildren(el('p', 'state-title', c.head), list);
    ui.check.hidden = false;
    let pending = withCover.length;
    const missing = [];
    const done = () => {
      if (--pending > 0) return;
      coverLine.textContent = missing.length
        ? c.coverBad.replace('{n}', withCover.length).replace('{m}', missing.length).replace('{list}', missing.slice(0, 8).join('\u3001') + (missing.length > 8 ? ' \u307b\u304b' : ''))
        : c.coverOk.replace('{n}', withCover.length);
    };
    if (!pending) coverLine.textContent = c.coverOk.replace('{n}', 0);
    for (const b of withCover) {
      const img = new Image();
      img.onload = done;
      img.onerror = () => { missing.push(b.cover); done(); };
      img.src = b.cover;
    }
  }

  let started = false;
  function begin(books) {
    if (started) return;
    ui.error.hidden = true;
    ui.belts.hidden = false;
    ui.readout.hidden = false;
    start(books);
    started = true;
    if (/^\?check\b/.test(location.search)) showCheck(books);
  }

  ui.pick.addEventListener('click', () => ui.pickFile.click());
  const usePicked = (file) => {
    if (!file || started) return;
    loadPicked(file).then(begin).catch((e) => { if (e && e.code) e.picked = true; showError(e); });
  };
  ui.pickFile.addEventListener('change', () => { usePicked(ui.pickFile.files[0]); ui.pickFile.value = ''; });
  ui.error.addEventListener('dragover', (e) => { if (diag.local) e.preventDefault(); });
  ui.error.addEventListener('drop', (e) => { if (!diag.local) return; e.preventDefault(); usePicked(e.dataTransfer.files[0]); });

  const splash = $('splash');
  if (splash) setTimeout(() => splash.remove(), returning ? 0 : 1700);

  loadBooks().then(begin).catch(showError);
})();
