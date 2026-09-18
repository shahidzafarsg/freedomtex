import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { call } from '../lib/api';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// pdf.js 6 frees documents through their loading task.
function destroyDoc(doc) {
  try {
    if (doc && doc.loadingTask) doc.loadingTask.destroy();
    else if (doc && typeof doc.destroy === 'function') doc.destroy();
  } catch {
    /* already destroyed */
  }
}

const CSS_UNITS = 96 / 72;
const GAP = 14;
const PAD = 18;

/**
 * Imperative PDF renderer. Pages are laid out immediately, canvases are rendered
 * lazily for pages near the viewport, and a reload keeps the reading position.
 */
class Viewer {
  constructor(scroll, pagesEl, cb) {
    this.scroll = scroll;
    this.pagesEl = pagesEl;
    this.cb = cb;
    this.doc = null;
    this.sizes = []; // viewport at scale 1 (PDF points)
    this.pageEls = [];
    this.scale = 1;
    this.zoom = 'page-width';
    this.renderedAt = new Map(); // index -> scale
    this.tasks = new Map();
    this.loadSeq = 0;
    this.onScroll = () => {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.update());
    };
    scroll.addEventListener('scroll', this.onScroll, { passive: true });
    this.ro = new ResizeObserver(() => {
      if (typeof this.zoom === 'string' && this.doc) this.applyZoom(this.zoom, true);
    });
    this.ro.observe(scroll);
  }

  destroy() {
    this.scroll.removeEventListener('scroll', this.onScroll);
    this.ro.disconnect();
    for (const t of this.tasks.values()) t.cancel();
    if (this.doc) destroyDoc(this.doc);
    this.doc = null;
  }

  anchor() {
    // Current page and how far into it we are, for restoring position.
    const top = this.scroll.scrollTop + 1;
    for (let i = 0; i < this.pageEls.length; i++) {
      const el = this.pageEls[i];
      if (el.offsetTop + el.offsetHeight + GAP / 2 > top) {
        return { index: i, ratio: (top - el.offsetTop) / el.offsetHeight, left: this.scroll.scrollLeft };
      }
    }
    return { index: 0, ratio: 0, left: 0 };
  }

  restore(a) {
    if (!a || !this.pageEls.length) return;
    const el = this.pageEls[Math.min(a.index, this.pageEls.length - 1)];
    this.scroll.scrollTop = el.offsetTop + a.ratio * el.offsetHeight - 1;
    this.scroll.scrollLeft = a.left;
  }

  computeScale(zoom) {
    if (typeof zoom === 'number') return zoom * CSS_UNITS;
    if (!this.sizes.length) return CSS_UNITS;
    const maxW = Math.max(...this.sizes.map((s) => s.width));
    const first = this.sizes[0];
    const availW = this.scroll.clientWidth - PAD * 2 - 4;
    const byWidth = availW / maxW;
    if (zoom === 'page-fit') {
      const availH = this.scroll.clientHeight - PAD * 2;
      return Math.max(0.1, Math.min(byWidth, availH / first.height));
    }
    return Math.max(0.1, byWidth);
  }

  async load(data, keepPosition) {
    const seq = ++this.loadSeq;
    const anchor = keepPosition && this.doc ? this.anchor() : null;
    let doc;
    try {
      doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
    } catch (e) {
      this.cb.onError && this.cb.onError(e);
      return;
    }
    if (seq !== this.loadSeq) {
      destroyDoc(doc);
      return;
    }
    const sizes = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const v = p.getViewport({ scale: 1 });
      sizes.push({ width: v.width, height: v.height });
    }
    if (seq !== this.loadSeq) {
      destroyDoc(doc);
      return;
    }
    const old = this.doc;
    for (const t of this.tasks.values()) t.cancel();
    this.tasks.clear();
    this.doc = doc;
    this.sizes = sizes;
    this.scale = this.computeScale(this.zoom);

    // Render the pages that will be visible before swapping, to avoid a blank flash.
    const fresh = sizes.map((s, i) => this.makePage(i, s));
    const frag = document.createDocumentFragment();
    fresh.forEach((el) => frag.appendChild(el));
    const oldEls = this.pageEls;
    this.pageEls = fresh;
    this.renderedAt.clear();

    if (old && anchor) {
      this.swapping = true;
      const target = Math.min(anchor.index, fresh.length - 1);
      const wanted = [target, target + 1].filter((i) => i < fresh.length);
      await Promise.all(wanted.map((i) => this.renderPage(i, true)));
      this.swapping = false;
      if (seq !== this.loadSeq) return;
    }
    this.pagesEl.replaceChildren(frag);
    oldEls.length = 0;
    if (anchor) this.restore(anchor);
    else this.scroll.scrollTop = 0;
    if (old) destroyDoc(old);
    this.cb.onPages && this.cb.onPages(doc.numPages);
    this.cb.onScale && this.cb.onScale(this.scale / CSS_UNITS);
    this.update();
  }

  makePage(i, size) {
    const el = document.createElement('div');
    el.className = 'pdf-page';
    el.dataset.index = String(i);
    el.style.width = `${Math.floor(size.width * this.scale)}px`;
    el.style.height = `${Math.floor(size.height * this.scale)}px`;
    return el;
  }

  applyZoom(zoom, keep = true) {
    this.zoom = zoom;
    if (!this.doc) return;
    const next = this.computeScale(zoom);
    if (Math.abs(next - this.scale) < 0.001) return;
    const a = keep ? this.anchor() : null;
    this.scale = next;
    this.pageEls.forEach((el, i) => {
      el.style.width = `${Math.floor(this.sizes[i].width * next)}px`;
      el.style.height = `${Math.floor(this.sizes[i].height * next)}px`;
    });
    if (a) this.restore(a);
    this.cb.onScale && this.cb.onScale(next / CSS_UNITS);
    this.update();
  }

  update() {
    if (!this.doc || !this.pageEls.length || this.swapping) return;
    const top = this.scroll.scrollTop;
    const bottom = top + this.scroll.clientHeight;
    const margin = this.scroll.clientHeight;
    let current = 0;
    const mid = top + this.scroll.clientHeight / 3;
    for (let i = 0; i < this.pageEls.length; i++) {
      const el = this.pageEls[i];
      const t = el.offsetTop;
      const b = t + el.offsetHeight;
      if (t <= mid) current = i;
      const near = b > top - margin && t < bottom + margin;
      if (near) {
        if (this.renderedAt.get(i) !== this.scale) this.renderPage(i);
      } else if (this.renderedAt.has(i) && (b < top - margin * 6 || t > bottom + margin * 6)) {
        // Free memory for pages far away.
        el.replaceChildren();
        this.renderedAt.delete(i);
      }
    }
    this.cb.onPage && this.cb.onPage(current + 1);
  }

  async renderPage(i, offscreen = false) {
    const doc = this.doc;
    const scale = this.scale;
    const el = this.pageEls[i];
    if (!doc || !el) return;
    this.renderedAt.set(i, scale);
    const prev = this.tasks.get(i);
    if (prev) prev.cancel();
    let page;
    try {
      page = await doc.getPage(i + 1);
    } catch {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const viewport = page.getViewport({ scale: scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
    this.tasks.set(i, task);
    try {
      await task.promise;
    } catch {
      return; // cancelled
    }
    this.tasks.delete(i);
    if (this.doc !== doc || this.renderedAt.get(i) !== scale) return;

    const cssViewport = page.getViewport({ scale });
    const text = document.createElement('div');
    text.className = 'textLayer';
    text.style.setProperty('--scale-factor', String(scale));
    text.style.setProperty('--total-scale-factor', String(scale));
    text.style.setProperty('--user-unit', '1');
    try {
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: cssViewport });
      await tl.render();
    } catch {
      /* text layer is optional */
    }
    let links = [];
    try {
      links = await this.linkLayer(page, cssViewport);
    } catch {
      /* links are optional */
    }
    const hl = [...el.querySelectorAll('.pdf-highlight')];
    el.replaceChildren(canvas, text, ...links, ...hl);
    void offscreen;
  }

  async linkLayer(page, viewport) {
    let annots = [];
    try {
      annots = await page.getAnnotations({ intent: 'display' });
    } catch {
      return [];
    }
    const out = [];
    for (const a of annots) {
      if (a.subtype !== 'Link' || (!a.url && !a.dest)) continue;
      const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]);
      const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]);
      const el = document.createElement('a');
      el.className = 'pdf-link';
      el.style.left = `${Math.min(x1, x2)}px`;
      el.style.top = `${Math.min(y1, y2)}px`;
      el.style.width = `${Math.abs(x2 - x1)}px`;
      el.style.height = `${Math.abs(y2 - y1)}px`;
      el.title = a.url || 'Go to location';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        if (a.url) call('app:openExternal', a.url).catch(() => {});
        else this.goToDest(a.dest);
      });
      out.push(el);
    }
    return out;
  }

  async goToDest(dest) {
    const doc = this.doc;
    if (!doc) return;
    let explicit = dest;
    if (typeof dest === 'string') explicit = await doc.getDestination(dest);
    if (!Array.isArray(explicit)) return;
    let index;
    try {
      index = typeof explicit[0] === 'object' ? await doc.getPageIndex(explicit[0]) : explicit[0];
    } catch {
      return;
    }
    const el = this.pageEls[index];
    if (!el) return;
    let y = 0;
    const kind = explicit[1] && explicit[1].name;
    if (kind === 'XYZ' && explicit[3] != null) y = (this.sizes[index].height - explicit[3]) * this.scale;
    else if ((kind === 'FitH' || kind === 'FitBH') && explicit[2] != null) y = (this.sizes[index].height - explicit[2]) * this.scale;
    this.scroll.scrollTop = el.offsetTop + Math.max(0, y) - 20;
  }

  goToPage(n) {
    const el = this.pageEls[n - 1];
    if (el) this.scroll.scrollTop = el.offsetTop - PAD + 4;
  }

  highlight(rects) {
    if (!rects || !rects.length || !this.doc) return;
    for (const el of this.pageEls) el.querySelectorAll('.pdf-highlight').forEach((h) => h.remove());
    const first = rects[0];
    const el = this.pageEls[first.page - 1];
    if (!el) return;
    const s = this.scale;
    for (const r of rects.filter((x) => x.page === first.page)) {
      const h = document.createElement('div');
      h.className = 'pdf-highlight';
      const w = r.W > 0 ? r.W : 40;
      const hh = r.H > 0 ? r.H : 12;
      h.style.left = `${(r.h - 2) * s}px`;
      h.style.top = `${(r.v - hh - 2) * s}px`;
      h.style.width = `${(w + 4) * s}px`;
      h.style.height = `${(hh + 5) * s}px`;
      el.appendChild(h);
      setTimeout(() => h.remove(), 2600);
    }
    const y = el.offsetTop + (first.v - (first.H || 12)) * s;
    this.scroll.scrollTo({ top: Math.max(0, y - this.scroll.clientHeight / 3), behavior: 'smooth' });
  }

  center() {
    if (!this.doc) return null;
    const y = this.scroll.scrollTop + this.scroll.clientHeight / 2;
    for (let i = 0; i < this.pageEls.length; i++) {
      const el = this.pageEls[i];
      if (el.offsetTop + el.offsetHeight >= y) return { page: i + 1, x: this.sizes[i].width / 2, y: Math.max(0, (y - el.offsetTop) / this.scale) };
    }
    return null;
  }

  pointToPdf(e) {
    const pageEl = e.target.closest && e.target.closest('.pdf-page');
    if (!pageEl) return null;
    const rect = pageEl.getBoundingClientRect();
    const index = Number(pageEl.dataset.index);
    return { page: index + 1, x: (e.clientX - rect.left) / this.scale, y: (e.clientY - rect.top) / this.scale };
  }
}

// The main project PDF registers itself so "PDF to code" can find the visible position.
let mainViewer = null;
export function pdfCenter() {
  return mainViewer ? mainViewer.center() : null;
}

const PdfView = forwardRef(function PdfView({ data, version, zoom = 'page-width', dark, onPages, onPage, onScale, onDoubleClick, syncTarget, onZoomRequest }, ref) {
  const scrollRef = useRef(null);
  const pagesRef = useRef(null);
  const viewer = useRef(null);
  const cbs = useRef({});
  cbs.current = { onPages, onPage, onScale, onZoomRequest };

  useEffect(() => {
    const v = new Viewer(scrollRef.current, pagesRef.current, {
      onPages: (n) => cbs.current.onPages && cbs.current.onPages(n),
      onPage: (n) => cbs.current.onPage && cbs.current.onPage(n),
      onScale: (s) => cbs.current.onScale && cbs.current.onScale(s),
    });
    v.zoom = zoom;
    viewer.current = v;
    if (onDoubleClick) mainViewer = v;
    // Ctrl+wheel zooms the PDF. React wheel listeners are passive, so attach natively.
    const onWheel = (e) => {
      if (!e.ctrlKey || !cbs.current.onZoomRequest) return;
      e.preventDefault();
      cbs.current.onZoomRequest(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    scrollRef.current.addEventListener('wheel', onWheel, { passive: false });
    const el = scrollRef.current;
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (mainViewer === v) mainViewer = null;
      v.destroy();
    };
  }, []);

  useEffect(() => {
    if (data && viewer.current) viewer.current.load(data, true);
  }, [version]);

  useEffect(() => {
    viewer.current && viewer.current.applyZoom(zoom);
  }, [zoom]);

  useEffect(() => {
    if (syncTarget && viewer.current) viewer.current.highlight(syncTarget.rects);
  }, [syncTarget]);

  useImperativeHandle(ref, () => ({
    goToPage: (n) => viewer.current && viewer.current.goToPage(n),
  }));

  return (
    <div
      ref={scrollRef}
      className={`pdf-scroll ${dark ? 'pdf-dark' : ''}`}
      tabIndex={0}
      onDoubleClick={(e) => {
        if (!onDoubleClick || !viewer.current) return;
        const p = viewer.current.pointToPdf(e);
        if (p) onDoubleClick(p.page, p.x, p.y);
      }}
    >
      <div ref={pagesRef} className="pdf-pages" />
    </div>
  );
});

export default PdfView;
