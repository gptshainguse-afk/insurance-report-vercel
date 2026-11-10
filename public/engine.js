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

  // Print compatibility output is deliberately independent of createPdf:
  // one opaque JPEG in a new PDF, with no source objects or embedded fonts.
  const PRINT_DPI = 300;
  const PRINT_MAX_PIXELS = 12000000;
  function svgNumber(value) {
    if (!Number.isFinite(value)) throw new Error('列印版面含有無效座標，請還原欄位定位後再試。');
    return String(Number(value.toFixed(8)));
  }
  function xmlAttribute(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
    }[char]));
  }
  function printValidationError(issues) {
    const error = new Error(issues.map(issue => issue.label + '：' + issue.message).join('\n'));
    error.name = 'PdfValidationError'; error.issues = issues;
    return error;
  }
  function preparePrintSnapshot(options) {
    needFont();
    if (!options || typeof options !== 'object' || !options.template || !Array.isArray(options.template.fields)) {
      throw new Error('請先選擇報告範本。');
    }
    const template = options.template;
    const values = options.values || {};
    const settings = options.settings || {};
    const overrides = options.overrides || {};
    const pageWidth = number(template.width, number(template.pageWidth, 595.32));
    const pageHeight = number(template.height, number(template.pageHeight, 841.92));
    const width = Math.round(pageWidth * PRINT_DPI / 72);
    const height = Math.round(pageHeight * PRINT_DPI / 72);
    if (!(pageWidth > 0 && pageHeight > 0 && width > 0 && height > 0)
      || width * height > PRINT_MAX_PIXELS) {
      throw new Error('列印相容模式的頁面尺寸超出支援範圍，請使用單頁 A4 範本。');
    }
    const issues = validateForm(options);
    if (issues.length) throw printValidationError(issues);
    const exportFont = font;
    const color = /^#[\da-f]{6}$/i.test(settings.color || '') ? settings.color : '#000000';
    const paths = [];
    const warnings = [];
    const glyphPaths = new Map();
    // All layouts, glyph outlines, color and metadata are captured before any
    // background fetch, image decoding or other await can allow state changes.
    for (const field of template.fields) {
      const value = values[field.id];
      if (value === '' || value == null || value === false) continue;
      if (field.type === 'checkbox' && !value) continue;
      if (number(field.page, 0) !== 0) throw new Error('列印相容模式目前僅支援單頁範本。');
      if (field.type === 'checkbox') {
        const check = checkLayout(field, settings, overrides[field.id]);
        paths.push('<polyline points="' + check.points.map(point => point.map(svgNumber).join(',')).join(' ')
          + '" fill="none" stroke="' + color + '" stroke-width="' + svgNumber(check.thickness)
          + '" stroke-linecap="round" stroke-linejoin="round"/>');
        continue;
      }
      const layout = layoutText(field, value, settings, overrides[field.id]);
      if (layout.shrunk) warnings.push({ fieldId: field.id, label: field.label,
        code: 'font-shrunk', message: '已自動縮至 ' + layout.fontSize.toFixed(2) + ' pt。' });
      for (const line of layout.lines) {
        if (!line.text) continue;
        let run;
        try { run = exportFont.layout(line.text, FEATURES); }
        catch (_) { throw new Error('「' + field.label + '」無法轉成列印字形，請改用內附中文字型。'); }
        const scale = line.size / exportFont.unitsPerEm;
        let penX = 0, penY = 0;
        for (let i = 0; i < run.glyphs.length; i++) {
          const glyph = run.glyphs[i];
          const position = run.positions[i] || {};
          let outline = glyphPaths.get(glyph.id);
          if (outline === undefined) {
            try { outline = glyph.path.toSVG(); }
            catch (_) { throw new Error('「' + field.label + '」的字型沒有可列印輪廓，請改用內附中文字型。'); }
            if (typeof outline !== 'string') throw new Error('無法讀取列印字形輪廓，請改用內附中文字型。');
            glyphPaths.set(glyph.id, outline);
          }
          if (outline) {
            const x = line.x + (penX + number(position.xOffset, 0)) * scale;
            const y = line.baseline - (penY + number(position.yOffset, 0)) * scale;
            paths.push('<path d="' + xmlAttribute(outline) + '" fill="' + color
              + '" transform="translate(' + svgNumber(x) + ' ' + svgNumber(y) + ') scale('
              + svgNumber(scale) + ' ' + svgNumber(-scale) + ')"/>');
          } else if ((glyph.codePoints || []).some(code => !/\s/u.test(String.fromCodePoint(code)))) {
            throw new Error('「' + field.label + '」含有無法轉成輪廓的字形，請改用內附中文字型。');
          }
          penX += number(position.xAdvance, glyph.advanceWidth);
          penY += number(position.yAdvance, 0);
        }
      }
    }
    return { pageWidth, pageHeight, width, height, dpi: PRINT_DPI, warnings,
      title: template.title || '書面分析報告', paths: paths.join(''),
      backgroundPath: typeof template.printPreview === 'string' && template.printPreview.trim()
        ? template.printPreview : 'assets/' + template.id + '-print.png',
      provider: resourceProvider || defaultProvider };
  }
  function validatePrintPng(data, snapshot) {
    const bytes = bytesOf(data);
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 24 || bytes.length > 40 * 1024 * 1024
      || signature.some((value, index) => bytes[index] !== value)) {
      throw new Error('列印底圖不是有效的 PNG，請確認程式包含完整的 300 dpi 列印底圖。');
    }
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = header.getUint32(16, false), height = header.getUint32(20, false);
    if (!(width > 0 && height > 0) || width * height > PRINT_MAX_PIXELS
      || Math.abs(width - snapshot.width) > 2 || Math.abs(height - snapshot.height) > 2) {
      throw new Error('列印底圖尺寸與範本不符，請使用此範本專用的 300 dpi 列印底圖。');
    }
    return bytes;
  }
  function base64Of(bytes) {
    if (typeof root.btoa === 'function') {
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)));
      return root.btoa(chunks.join(''));
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    throw new Error('此環境無法處理列印底圖，請使用 Chrome 或 Edge。');
  }
  function bytesFromBase64(encoded) {
    if (typeof root.atob === 'function') {
      let binary;
      try { binary = root.atob(encoded); }
      catch (_) { throw new Error('列印底圖資料不完整。'); }
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(encoded, 'base64'));
    throw new Error('此環境無法處理列印底圖，請使用 Chrome 或 Edge。');
  }
  function printSvgFromSnapshot(snapshot, backgroundDataUrl) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + snapshot.width + '" height="' + snapshot.height
      + '" viewBox="0 0 ' + svgNumber(snapshot.pageWidth) + ' ' + svgNumber(snapshot.pageHeight) + '">'
      + '<rect width="100%" height="100%" fill="#ffffff"/>'
      + '<image x="0" y="0" width="' + svgNumber(snapshot.pageWidth) + '" height="' + svgNumber(snapshot.pageHeight)
      + '" preserveAspectRatio="none" href="' + backgroundDataUrl + '"/>' + snapshot.paths + '</svg>';
  }
  /** Synchronous QA helper: geometry and glyphs match the print export exactly. */
  function renderPrintSvg(options, backgroundDataUrl) {
    const snapshot = preparePrintSnapshot(options);
    if (typeof backgroundDataUrl !== 'string' || backgroundDataUrl.length > 56 * 1024 * 1024
      || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(backgroundDataUrl)) {
      throw new Error('列印底圖必須是內嵌的 PNG 資料。');
    }
    validatePrintPng(bytesFromBase64(backgroundDataUrl.slice(backgroundDataUrl.indexOf(',') + 1)), snapshot);
    return { svg: printSvgFromSnapshot(snapshot, backgroundDataUrl), width: snapshot.width, height: snapshot.height,
      pageWidth: snapshot.pageWidth, pageHeight: snapshot.pageHeight, dpi: snapshot.dpi, warnings: snapshot.warnings };
  }
  async function rasterizePrintSvg(svg, dimensions) {
    if (!root.document || typeof root.Image !== 'function' || !root.URL?.createObjectURL || typeof root.Blob !== 'function') {
      throw new Error('此環境沒有影像列印功能，請在 Chrome 或 Edge 開啟工具。');
    }
    const canvas = root.document.createElement('canvas');
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) { canvas.width = 1; canvas.height = 1; throw new Error('無法建立列印畫布，請關閉其他分頁後再試。'); }
    const image = new root.Image();
    let url = null, timeout = null;
    try {
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      url = root.URL.createObjectURL(new root.Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('無法合成列印影像，請重新載入工具後再試。'));
        timeout = root.setTimeout(() => reject(new Error('列印影像處理逾時，請關閉其他分頁後再試。')), 30000);
        image.src = url;
      });
      root.clearTimeout(timeout); timeout = null;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob && blob.type === 'image/jpeg' ? resolve(blob)
          : reject(new Error('無法產生列印 JPG，請使用最新版 Chrome 或 Edge。')), 'image/jpeg', 0.92);
      });
      return new Uint8Array(await jpeg.arrayBuffer());
    } finally {
      if (timeout !== null) root.clearTimeout(timeout);
      image.onload = null; image.onerror = null; image.src = '';
      if (url) root.URL.revokeObjectURL(url);
      canvas.width = 1; canvas.height = 1;
    }
  }
  /**
   * One opaque 300 dpi JPEG in a fresh PDF 1.4 with classic xref records.
   * Optional QA-only injection: rasterizeSvg(svg, {width, height}) -> JPEG bytes.
   */
  async function createPrintPdf(options) {
    const snapshot = preparePrintSnapshot(options);
    if (options.rasterizeSvg != null && typeof options.rasterizeSvg !== 'function') {
      throw new Error('列印影像處理器設定無效。');
    }
    const rasterizer = options.rasterizeSvg || rasterizePrintSvg;
    const lib = pdfLib();
    let background;
    try { background = validatePrintPng(await snapshot.provider(snapshot.backgroundPath), snapshot); }
    catch (error) { throw new Error('無法載入列印底圖：' + (error.message || '請確認程式檔案完整。')); }
    const svg = printSvgFromSnapshot(snapshot, 'data:image/png;base64,' + base64Of(background));
    let imageBytes;
    try { imageBytes = bytesOf(await rasterizer(svg, { width: snapshot.width, height: snapshot.height })); }
    catch (error) { throw new Error('無法產生列印影像：' + (error.message || '請重新開啟工具後再試。')); }
    if (imageBytes.length < 4 || imageBytes[0] !== 255 || imageBytes[1] !== 216 || imageBytes[2] !== 255) {
      throw new Error('列印影像必須是有效的 JPG，無法輸出 PDF。');
    }
    const document = await lib.PDFDocument.create();
    const jpeg = await document.embedJpg(imageBytes);
    if (jpeg.width !== snapshot.width || jpeg.height !== snapshot.height) {
      throw new Error('列印影像尺寸不正確，請重新輸出。');
    }
    const page = document.addPage([snapshot.pageWidth, snapshot.pageHeight]);
    page.drawImage(jpeg, { x: 0, y: 0, width: snapshot.pageWidth, height: snapshot.pageHeight });
    document.setTitle(snapshot.title + ' - 列印相容版');
    document.setCreator('保險書面分析報告填寫工具');
    document.setProducer('pdf-lib');
    const bytes = await document.save({ useObjectStreams: false });
    // pdf-lib's PDFWriter creates its own 1.7 header; changing context.header
    // does not affect these serialized bytes. This fresh image-only document
    // uses only PDF 1.4-compatible features and classic xref records. Replace
    // the minor-version digit in place so every byte offset stays unchanged.
    // Never apply this header change to imported/source PDFs or createPdf().
    const header = String.fromCharCode.apply(null, bytes.subarray(0, 8));
    if (header !== '%PDF-1.7' && header !== '%PDF-1.4') {
      throw new Error('列印相容 PDF 的版本標頭異常，請重新載入工具後再試。');
    }
    bytes[7] = 0x34;
    return { bytes, warnings: snapshot.warnings,
      imageBytes, imageMimeType: 'image/jpeg',
      printInfo: { dpi: snapshot.dpi, width: snapshot.width, height: snapshot.height } };
  }
  return { loadResources, setFontBytes, resetFont, getFontBytes, getFontInfo,
    measureText, missingGlyphs, layoutText, checkLayout, validateForm, createPdf,
    renderPrintSvg, createPrintPdf };
});
