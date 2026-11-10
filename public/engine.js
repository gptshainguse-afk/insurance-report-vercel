/* Insurance PDF Filler — shared browser / Node layout and PDF engine. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PdfEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  let fontBytes = null;
  let defaultFontBytes = null;
  let font = null;
  let resourceProvider = null;
  const sourceCache = new Map();
  const widthCache = new Map();
  const FEATURES = { liga: false, rlig: false, kern: false };

  function pdfLib() {
    if (!root.PDFLib) throw new Error('PDF 程式尚未載入，請重新開啟工具。');
    return root.PDFLib;
  }
  function fontKit() {
    if (!root.fontkit) throw new Error('中文字型程式尚未載入，請重新開啟工具。');
    return root.fontkit;
  }
  function bytesOf(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new Error('無法讀取檔案內容。');
  }
  async function defaultProvider(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error('無法載入 ' + path + '，請確認程式檔案完整。');
    return new Uint8Array(await response.arrayBuffer());
  }
  function templatePdfPath(template) {
    return typeof template.pdf === 'string' && template.pdf.trim()
      ? template.pdf : 'assets/' + template.id + '.pdf';
  }
  async function loadResources(provider) {
    const nextProvider = provider || resourceProvider || defaultProvider;
    const registry = root.TEMPLATES;
    const templates = registry && typeof registry === 'object'
      ? Object.entries(registry).filter(([, item]) => item && typeof item === 'object')
        .map(([key, item]) => ({ ...item, id: item.id || key }))
      : [];
    // A browser registry preloads every installed template. Standalone Node
    // callers without a registry only need the font; createPdf loads their
    // requested source lazily, preserving the original loadResources API.
    const results = await Promise.all([
      nextProvider('assets/CJK-Fallback.ttf'),
      ...templates.map(template => nextProvider(templatePdfPath(template))),
    ]);
    const nextFontBytes = bytesOf(results[0]);
    setFontBytes(nextFontBytes);
    resourceProvider = nextProvider;
    defaultFontBytes = nextFontBytes;
    sourceCache.clear();
    templates.forEach((template, index) => sourceCache.set(template.id, {
      path: templatePdfPath(template), bytes: bytesOf(results[index + 1]),
    }));
    return getFontInfo();
  }
  function setFontBytes(bytes) {
    const candidateBytes = bytesOf(bytes);
    let candidate;
    try { candidate = fontKit().create(candidateBytes); }
    catch (error) { throw new Error('無法使用這個字型，請選擇有效的 TTF 或 OTF 字型。'); }
    if (!candidate || typeof candidate.layout !== 'function' || !candidate.unitsPerEm) {
      throw new Error('請選擇單一 TTF 或 OTF 字型；此工具不支援 TTC 字型集合。');
    }
    fontBytes = candidateBytes;
    font = candidate;
    widthCache.clear();
    return getFontInfo();
  }
  function resetFont() {
    if (!defaultFontBytes) throw new Error('內建字型尚未載入。');
    return setFontBytes(defaultFontBytes);
  }
  function getFontBytes() { return fontBytes ? fontBytes.slice() : null; }
  function getFontInfo() {
    return font ? { name: font.fullName || font.familyName || '中文字型', unitsPerEm: font.unitsPerEm,
      ascent: font.ascent, descent: font.descent, glyphCount: font.characterSet.length } : null;
  }
  function needFont() { if (!font) throw new Error('字型尚未載入完成。'); }
  function number(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }
  function mergeField(field, settings, override) {
    const result = Object.assign({}, field, override || {});
    result.x = number(result.x, 0) + number(settings.offsetX, 0);
    result.y = number(result.y, 0) + number(settings.offsetY, 0);
    result.w = Math.max(0.1, number(result.w, 40));
    result.h = Math.max(0.1, number(result.h, 12));
    const overrideSize = override && override.fontSize != null ? number(override.fontSize, NaN) : NaN;
    result.fontSize = Number.isFinite(overrideSize) ? overrideSize : number(field.fontSize, 9) * number(settings.fontSize, 9) / 9;
    result.fontSize = clamp(result.fontSize, 1, 72);
    return result;
  }
  function normalizeText(value, multiline) {
    const text = String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
    return multiline ? text : text.replace(/\n/g, ' ');
  }
  function measureText(text, size) {
    needFont();
    if (!text) return 0;
    let width = widthCache.get(text);
    if (width === undefined) {
      // Match pdf-lib's CustomFontEmbedder.widthOfTextAtSize exactly.
      width = font.layout(text, FEATURES).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) / font.unitsPerEm;
      if (widthCache.size > 2500) widthCache.clear();
      widthCache.set(text, width);
    }
    return width * size;
  }
  function missingGlyphs(text) {
    needFont();
    return Array.from(new Set(Array.from(text).filter(char => !/[\n\r\t]/.test(char)
      && !font.hasGlyphForCodePoint(char.codePointAt(0)))));
  }
  function wrapLines(text, width, size) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      if (!paragraph) { lines.push(''); continue; }
      let line = '';
      for (const char of Array.from(paragraph)) {
        if (line && measureText(line + char, size) > width + 0.01) {
          lines.push(line);
          line = char;
        } else line += char;
      }
      lines.push(line);
    }
    return lines;
  }
  function layoutText(field, value, settings, override) {
    needFont();
    settings = settings || {};
    override = override || {};
    const f = mergeField(field, settings, override);
    const rect = { x: f.x, y: f.y, w: f.w, h: f.h };
    const text = normalizeText(value, !!f.multiline);
    const missing = missingGlyphs(text);
    const padding = Math.max(0, number(f.padding, 0.4));
    const innerW = Math.max(0.1, f.w - padding * 2);
    const innerH = Math.max(0.1, f.h - padding * 2);
    const asc = (font.ascent || font.bbox.maxY) / font.unitsPerEm;
    const desc = (font.descent || font.bbox.minY) / font.unitsPerEm;
    const heightUnit = asc - desc;
    const minSize = Math.min(f.fontSize, clamp(number(f.minFontSize, 6), 3, 24));
    const requestedSize = f.fontSize;
    let size = requestedSize;
    let strings = [];
    let lineHeight = 0;
    let totalHeight = 0;
    function compute() {
      strings = f.multiline ? wrapLines(text, innerW, size) : [text];
      lineHeight = size * Math.max(heightUnit, number(f.lineHeight, heightUnit));
      totalHeight = size * heightUnit + Math.max(0, strings.length - 1) * lineHeight;
      return totalHeight <= innerH + 0.01 && strings.every(line => measureText(line, size) <= innerW + 0.01);
    }
    let fits = compute();
    if (!fits && size > minSize) {
      // Bounded binary search chooses the largest fitting size without truncation.
      let lo = minSize, hi = size;
      size = lo;
      if (compute()) {
        for (let i = 0; i < 14; i++) {
          size = (lo + hi) / 2;
          if (compute()) lo = size; else hi = size;
        }
        size = Math.floor(lo * 100) / 100;
      } else size = minSize;
      fits = compute();
    }
    const top = f.y + padding + Math.max(0, (innerH - totalHeight) / 2);
    const lines = strings.map((line, index) => {
      const width = measureText(line, size);
      let x = f.x + padding;
      if (f.align === 'center') x += Math.max(0, (innerW - width) / 2);
      if (f.align === 'right') x += Math.max(0, innerW - width);
      const y = top + index * lineHeight;
      return { text: line, x, y, baseline: y + asc * size, size, width };
    });
    const warnings = [];
    if (!fits && text) warnings.push('內容太長，最小 ' + minSize + ' pt 仍無法放入欄位；請精簡內容或調整欄位範圍。');
    if (missing.length) warnings.push('目前字型沒有這些字：' + missing.join('、') + '；請載入支援的 TTF / OTF 字型。');
    return { rect, lines: text ? lines : [], fontSize: size, requestedFontSize: requestedSize,
      shrunk: size < requestedSize - 0.01, overflow: !!text && !fits, missingGlyphs: missing, warnings };
  }
  function checkLayout(field, settings, override) {
    settings = settings || {}; override = override || {};
    const f = mergeField(field, settings, override);
    const size = clamp(number(override.checkSize, number(settings.checkSize, number(field.checkSize, 8))), 2, 24);
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const x = cx - size / 2, y = cy - size / 2;
    return { rect: { x: f.x, y: f.y, w: f.w, h: f.h }, size,
      thickness: clamp(number(override.checkThickness, number(settings.checkThickness, size * 0.13)), 0.4, 4),
      points: [[x + size * 0.12, y + size * 0.52], [x + size * 0.40, y + size * 0.82], [x + size * 0.91, y + size * 0.13]] };
  }
  function validateForm(options) {
    const template = options.template;
    const pageWidth = number(template.width, number(template.pageWidth, 595.32));
    const pageHeight = number(template.height, number(template.pageHeight, 841.92));
    const values = options.values || {};
    const settings = options.settings || {};
    const overrides = options.overrides || {};
    const issues = [];
    for (const field of template.fields) {
      const value = values[field.id];
      if (value === '' || value == null || value === false) continue;
      if (field.type === 'checkbox') {
        if (!value) continue;
        const check = checkLayout(field, settings, overrides[field.id]);
        if (check.points.some(([x, y]) => x < 0 || y < 0 || x > pageWidth || y > pageHeight))
          issues.push({ fieldId: field.id, label: field.label, code: 'out-of-page', message: '勾選符號超出紙張範圍。' });
      } else {
        const layout = layoutText(field, value, settings, overrides[field.id]);
        if (layout.overflow) issues.push({ fieldId: field.id, label: field.label, code: 'overflow', message: layout.warnings[0] });
        if (layout.missingGlyphs.length) issues.push({ fieldId: field.id, label: field.label, code: 'missing-glyph',
          message: '字型缺少：' + layout.missingGlyphs.join('、') + '。請換用支援此字的字型。' });
        const r = layout.rect;
        if (r.x < 0 || r.y < 0 || r.x + r.w > pageWidth + 0.1 || r.y + r.h > pageHeight + 0.1)
          issues.push({ fieldId: field.id, label: field.label, code: 'out-of-page', message: '欄位範圍超出紙張。' });
      }
    }
    return issues;
  }
  function parseColor(value) {
    const hex = /^#([\da-f]{6})$/i.exec(value || '');
    if (!hex) return pdfLib().rgb(0, 0, 0);
    return pdfLib().rgb(parseInt(hex[1].slice(0, 2), 16) / 255,
      parseInt(hex[1].slice(2, 4), 16) / 255, parseInt(hex[1].slice(4, 6), 16) / 255);
  }
  async function createPdf(options) {
    needFont();
    const template = options.template;
    if (!template || !Array.isArray(template.fields)) throw new Error('請先選擇報告範本。');
    const values = options.values || {};
    const settings = options.settings || {};
    const overrides = options.overrides || {};
    const issues = validateForm(options);
    if (issues.length) {
      const error = new Error(issues.map(issue => issue.label + '：' + issue.message).join('\n'));
      error.name = 'PdfValidationError'; error.issues = issues;
      throw error;
    }
    // Capture a complete export transaction before the first await. A user can
    // edit values, calibration, color or font while PDF loading/embedding yields
    // to the browser; none of those edits may change this in-flight document.
    const exportFontBytes = fontBytes.slice();
    const exportFontkit = fontKit();
    const templateId = template.id;
    const sourcePath = templatePdfPath(template);
    const title = template.title || '書面分析報告';
    const provider = resourceProvider;
    const color = parseColor(settings.color || '#000000');
    const prepared = [];
    for (const field of template.fields) {
      const value = values[field.id];
      if (value === '' || value == null || value === false) continue;
      if (field.type === 'checkbox' && !value) continue;
      prepared.push({
        id: field.id, label: field.label, page: number(field.page, 0), type: field.type,
        layout: field.type === 'checkbox'
          ? checkLayout(field, settings, overrides[field.id])
          : layoutText(field, value, settings, overrides[field.id]),
      });
    }
    const cachedSource = sourceCache.get(templateId);
    let source = cachedSource && cachedSource.path === sourcePath ? cachedSource.bytes : null;
    if (!source) {
      if (!provider) throw new Error('原始 PDF 尚未載入。');
      source = bytesOf(await provider(sourcePath));
      sourceCache.set(templateId, { path: sourcePath, bytes: source });
    }
    const lib = pdfLib();
    const document = await lib.PDFDocument.load(source);
    document.registerFontkit(exportFontkit);
    // Full embedding is intentional. fontkit 1.1.1's subset output for the
    // bundled Droid CJK font loses visible glyphs in PDF renderers even when
    // ToUnicode text extraction looks correct. Both originals were visually
    // verified with this full-font path; do not replace it with subset:true.
    const embeddedFont = await document.embedFont(exportFontBytes, { subset: false, features: FEATURES });
    const warnings = [];
    for (const field of prepared) {
      const page = document.getPage(field.page);
      const height = page.getHeight();
      if (field.type === 'checkbox') {
        const check = field.layout;
        for (let i = 0; i < check.points.length - 1; i++) {
          page.drawLine({ start: { x: check.points[i][0], y: height - check.points[i][1] },
            end: { x: check.points[i + 1][0], y: height - check.points[i + 1][1] },
            thickness: check.thickness, color, lineCap: 1 });
        }
      } else {
        const layout = field.layout;
        for (const line of layout.lines) {
          if (!line.text) continue;
          page.drawText(line.text, { x: line.x, y: height - line.baseline, size: line.size, font: embeddedFont, color });
        }
        if (layout.shrunk) warnings.push({ fieldId: field.id, label: field.label,
          code: 'font-shrunk', message: '已自動縮至 ' + layout.fontSize.toFixed(2) + ' pt。' });
      }
    }
    document.setTitle(title + ' - 已填寫');
    document.setCreator('保險書面分析報告填寫工具');
    document.setProducer('pdf-lib');
    return { bytes: await document.save(), warnings };
  }
  return { loadResources, setFontBytes, resetFont, getFontBytes, getFontInfo,
    measureText, missingGlyphs, layoutText, checkLayout, validateForm, createPdf };
});
