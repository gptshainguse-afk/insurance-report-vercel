(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  const defaults = () => ({ fontSize: 9, checkSize: 8, color: '#111111', offsetX: 0, offsetY: 0 });
  const STORAGE_LAYOUT = 'insurance-report-layout-v1';
  const STORAGE_DRAFT = 'insurance-report-draft-v1';
  const STORAGE_REMEMBER = 'insurance-report-remember-v1';
  const templateIds = Object.keys(window.TEMPLATES);
  const perTemplate = factory => Object.fromEntries(templateIds.map(id => [id, factory(id)]));
  const state = { templateId: window.TEMPLATES.unified ? 'unified' : templateIds[0], mode: 'fill', section: 'basic', selected: '', zoom: 'fit', ready: false,
    values: perTemplate(() => ({})), overrides: perTemplate(() => ({})), settings: perTemplate(defaults),
    demo: perTemplate(() => false), remember: false, guides: true, issues: [], customFont: '', dirty: false };
  let activeFontFace = null, toastTimer, drag = null, messageResolve = null, persistTimer, lastPdfUrl = null;
  const icons = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3z"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    person: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
    target: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/><circle cx="12" cy="12" r="2"/>',
    document: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7m-7 4h7"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>'
  };
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (icons[el.dataset.icon] || icons.document) + '</svg>'; });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const template = () => window.TEMPLATES[state.templateId];
  const values = () => state.values[state.templateId];
  const settings = () => state.settings[state.templateId];
  const overrides = () => state.overrides[state.templateId];
  const fieldById = id => template().fields.find(f => f.id === id);
  const hasData = id => Object.values(state.values[id] || {}).some(v => v !== '' && v != null && v !== false);
  const finite = (x, d) => Number.isFinite(Number(x)) ? Number(x) : d;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function getStored(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function putStored(key, value) { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); return true; } catch (_) { return false; } }
  function toast(text) { $('toast').textContent = text; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500); }
  function showMessage(title, body, { confirm = '確定', cancel = false } = {}) {
    if (messageResolve) { messageResolve(false); messageResolve = null; }
    $('messageTitle').textContent = title; $('messageBody').textContent = body;
    $('messageConfirm').textContent = confirm; $('messageCancel').classList.toggle('hidden', !cancel);
    if (!$('messageDialog').open) $('messageDialog').showModal();
    return new Promise(resolve => { messageResolve = resolve; });
  }
  function closeMessage(answer) { $('messageDialog').close(); if (messageResolve) { const resolve = messageResolve; messageResolve = null; resolve(answer); } }
  $('messageConfirm').addEventListener('click', () => closeMessage(true));
  $('messageCancel').addEventListener('click', () => closeMessage(false));
  $('messageDialog').addEventListener('cancel', event => { event.preventDefault(); closeMessage(false); });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.dataset.close === 'messageDialog' ? closeMessage(false) : $(b.dataset.close).close()));
  document.querySelector('.brand').addEventListener('click', e => { e.preventDefault(); $('formScroll').scrollTop = 0; });

  function snapshot(kind = 'draft') {
    const result = { format: 'insurance-report-studio', version: 2, kind, templateVersions: perTemplate(id => window.TEMPLATES[id].version), exportedAt: new Date().toISOString(), selectedTemplate: state.templateId, settings: state.settings, overrides: state.overrides };
    if (kind === 'draft') { result.values = state.values; result.demo = state.demo; }
    return result;
  }
  function persist() {
    hideExportResult();
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const ok = putStored(STORAGE_LAYOUT, JSON.stringify(snapshot('layout')));
      if (state.remember && !putStored(STORAGE_DRAFT, JSON.stringify(snapshot()))) { toast('此瀏覽器無法儲存草稿，請下載 JSON 備份。'); }
      if (!ok) document.querySelector('.autosave-status').textContent = '無法自動儲存，請下載定位設定備份';
    }, 180);
  }
  function cleanSettings(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return { fontSize: clamp(finite(raw.fontSize, 9), 5.85, 12.6), checkSize: clamp(finite(raw.checkSize, 8), 3, 16),
      color: /^#[0-9a-f]{6}$/i.test(raw.color || '') ? raw.color : '#111111', offsetX: clamp(finite(raw.offsetX, 0), -36, 36), offsetY: clamp(finite(raw.offsetY, 0), -36, 36) };
  }
  function snapshotTemplateIds(raw, kind) {
    if (!raw || raw.format !== 'insurance-report-studio' || ![1, 2].includes(raw.version)) throw new Error('檔案不是此工具支援的草稿或定位設定。');
    if (raw.kind !== kind || (kind === 'draft' && (!raw.values || typeof raw.values !== 'object' || Array.isArray(raw.values)))) throw new Error('請選擇「下載' + (kind === 'draft' ? '草稿' : '定位') + ' JSON」所產生的檔案。');
    const own = (object, key) => object && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
    const ids = templateIds.filter(id => (raw.version !== 1 || ['life', 'property'].includes(id)) && (own(raw.settings, id) || own(raw.overrides, id) || (kind === 'draft' && own(raw.values, id))));
    if (!ids.length) throw new Error('檔案沒有可匯入的報告範本。');
    for (const id of ids) {
      const version = raw.version === 1 ? raw.templateVersion : raw.templateVersions?.[id];
      if (version !== window.TEMPLATES[id].version) throw new Error(window.TEMPLATES[id].title + '的範本版本不符，無法套用定位。');
    }
    return ids;
  }
  function applySnapshot(raw, kind) {
    const ids = snapshotTemplateIds(raw, kind);
    for (const id of ids) {
      state.settings[id] = cleanSettings(raw.settings?.[id]);
      state.overrides[id] = {};
      const map = window.TEMPLATES[id];
      for (const f of map.fields) {
        const item = raw.overrides?.[id]?.[f.id];
        if (item && typeof item === 'object') {
          const o = {};
          for (const key of ['x','y','w','h','fontSize','checkSize']) if (typeof item[key] === 'number' && Number.isFinite(item[key])) {
            const ranges = {x:[0,map.width],y:[0,map.height],w:[2,map.width],h:[2,100],fontSize:[3,36],checkSize:[3,16]};
            o[key] = clamp(item[key], ...ranges[key]);
          }
          if (['left','center','right'].includes(item.align)) o.align = item.align;
          if (typeof item.multiline === 'boolean') o.multiline = item.multiline;
          state.overrides[id][f.id] = o;
        }
      }
      if (kind === 'draft') {
        state.values[id] = {};
        for (const f of map.fields) {
          const value = raw.values?.[id]?.[f.id];
          if (f.type === 'checkbox') { if (typeof value === 'boolean') state.values[id][f.id] = value; }
          else if ((typeof value === 'string' || typeof value === 'number') && (!f.options || f.options.includes(String(value)) || value === '')) state.values[id][f.id] = String(value).slice(0, 4000);
        }
        // A malformed import must not create contradictory radio-style answers.
        const seen = new Set();
        for (const f of map.fields) if (f.exclusive && f.group && state.values[id][f.id]) {
          if (seen.has(f.group)) state.values[id][f.id] = false; else seen.add(f.group);
        }
        state.demo[id] = !!raw.demo?.[id];
        mirrorApplicant(id);
      }
    }
    if (kind === 'draft' && ids.includes(raw.selectedTemplate)) state.templateId = raw.selectedTemplate;
  }
  function mirrorApplicant(id = state.templateId) {
    const v = state.values[id]; if (!v.insured_same) return;
    const fieldIds = new Set(window.TEMPLATES[id].fields.map(f => f.id));
    for (const key of ['name','representative','id','occupation','dob_y','dob_m','dob_d','sex_m','sex_f']) {
      if (fieldIds.has('insured_' + key) && fieldIds.has('applicant_' + key)) v['insured_' + key] = v['applicant_' + key] ?? (key.startsWith('sex_') ? false : '');
    }
  }
  function groupLabel(f) {
    if (f.groupLabel) return f.groupLabel;
    if (f.label.includes('：')) return f.label.split('：')[0];
    return ({category:'本次報告類別',insured_identity:'被保險人資料',relation:'要／被保人關係',purpose:'投保目的與需求',insurance_types:'欲投保保險種類',company_intro:'保險公司概況說明方式',recommend_reason:'建議保險公司理由',recommended_type:'保險商品／險種',coverage:'保障範圍'})[f.group] || '請選擇';
  }
  function shortLabel(f) { return f.label.includes('：') ? f.label.split('：').slice(1).join('：') : f.label; }
  function isMirrored(f) { return !!values().insured_same && /^insured_(name|representative|id|occupation|dob_[ymd]|sex_[mf])$/.test(f.id) && template().fields.some(source => source.id === f.id.replace(/^insured_/, 'applicant_')); }
  function textControl(f, compact = false) {
    const label = compact ? (f.id.endsWith('_y') ? '民國年' : f.id.endsWith('_m') ? '月' : '日') : f.label;
    const inputmode = /(_[ymd]|amount|premium|years|corporate_id)$/.test(f.id) ? ' inputmode="decimal"' : '';
    const multiline = (overrides()[f.id]?.multiline ?? f.multiline) === true;
    if (Array.isArray(f.options)) return '<div class="field-wrap' + (state.selected === f.id ? ' active-field' : '') + '" data-field-wrap="' + esc(f.id) + '"><label class="field-label" for="input-' + esc(f.id) + '">' + esc(label) + '</label><select id="input-' + esc(f.id) + '" data-field="' + esc(f.id) + '"><option value="">請選擇／留白</option>' + f.options.map(option => '<option value="' + esc(option) + '"' + (values()[f.id] === option ? ' selected' : '') + '>' + esc(option) + '</option>').join('') + '</select>' + (f.help ? '<p class="hint">' + esc(f.help) + '</p>' : '') + '</div>';
    return '<div class="field-wrap' + (state.selected === f.id ? ' active-field' : '') + '" data-field-wrap="' + esc(f.id) + '"><label class="field-label" for="input-' + esc(f.id) + '">' + esc(label) + '</label>' + (multiline ? '<textarea' : '<input type="text"') + ' id="input-' + esc(f.id) + '" data-field="' + esc(f.id) + '" autocomplete="off" maxlength="4000" placeholder="' + esc(f.placeholder || (compact ? label : '請輸入')) + '"' + inputmode + (isMirrored(f) ? ' disabled' : '') + (multiline ? '>' + esc(values()[f.id] || '') + '</textarea>' : ' value="' + esc(values()[f.id] || '') + '">') + (!compact && f.help ? '<p class="hint">' + esc(f.help) + '</p>' : '') + '</div>';
  }
  function checkboxGroup(fields, label) {
    if (!fields.length) return '';
    const single = fields.every(f => f.exclusive);
    return '<fieldset class="check-group"><legend>' + esc(label || groupLabel(fields[0])) + '<span class="group-hint">' + (single ? '單選，可取消' : fields.length > 1 ? '可複選' : '') + '</span></legend><div class="check-options">' + fields.map(f => '<label class="check-chip" data-field-wrap="' + esc(f.id) + '"><input type="checkbox" data-field="' + esc(f.id) + '" id="input-' + esc(f.id) + '"' + (values()[f.id] ? ' checked' : '') + (isMirrored(f) ? ' disabled' : '') + '><span>' + esc(shortLabel(f)) + '</span></label>').join('') + '</div></fieldset>';
  }
  function dateGroup(fields, heading) { return '<div class="date-block"><div class="field-label">' + esc(heading) + '</div><div class="date-row">' + fields.map(f => textControl(f, true)).join('') + '</div></div>'; }
  function groupFields(fields) {
    let html = ''; const used = new Set();
    for (const f of fields) {
      if (used.has(f.id)) continue;
      if (f.type === 'checkbox') {
        const group = fields.filter(g => g.type === 'checkbox' && (f.group ? g.group === f.group : g.id === f.id));
        group.forEach(g => used.add(g.id)); html += checkboxGroup(group);
      } else if (f.id.endsWith('_y') && fields.some(g => g.id === f.id.slice(0, -1) + 'm')) {
        const base = f.id.slice(0, -1); const group = ['y','m','d'].map(c => fields.find(g => g.id === base + c)).filter(Boolean);
        group.forEach(g => used.add(g.id));
        const heading = f.label.replace(/（年）|（民國）|\(民國\)/g,'').replace(/出生年$/, '出生日期').replace(/簽署年$/, '簽署日期');
        html += dateGroup(group, heading);
      } else { used.add(f.id); html += textControl(f); }
    }
    return html;
  }
  function basicFields(fields) {
    let html = '<p class="form-subtitle">依原稿欄位填寫，內容會即時顯示在右側。</p>';
    for (const [prefix, heading, number] of [['applicant','要保人','01'],['insured','被保險人','02']]) {
      html += '<div class="form-card"><h3 class="person-heading"><span class="person-index">' + number + '</span>' + heading + '</h3>';
      if (prefix === 'insured') html += checkboxGroup(fields.filter(f => ['insured_same','insured_roster'].includes(f.id)), '填寫方式');
      const ordinary = fields.filter(f => f.id.startsWith(prefix + '_') && !/_(dob_[ymd]|sex_[mf])$/.test(f.id) && !['insured_same','insured_roster'].includes(f.id));
      html += groupFields(ordinary.map(f => ({...f, label: f.label.replace(/^要保人|^被保險人/, '')})));
      const dateFields = ['y','m','d'].map(c => fields.find(f => f.id === prefix + '_dob_' + c)).filter(Boolean);
      if (dateFields.length) html += dateGroup(dateFields, '出生日期');
      const sexFields = fields.filter(f => f.id.startsWith(prefix + '_sex_')); if (sexFields.length) html += checkboxGroup(sexFields, '性別');
      html += '</div>';
    }
    html += '<div class="form-card">' + groupFields(fields.filter(f => !f.id.startsWith('applicant_') && !f.id.startsWith('insured_'))) + '</div>';
    return html;
  }
  function shortSection(s) { return ({category:'報告類別',basic:'基本資料',motor:'車籍資料',needs:'需求風險',premium:'保費支出',advice:'業務建議',recommendation:'業務建議',risk:'風險辨識',signature:'簽署資料'})[s.id] || s.title; }
  function renderNav() {
    $('sectionNav').innerHTML = template().sections.map((s,i) => '<button type="button" data-section="' + s.id + '" class="' + (state.section === s.id ? 'active' : '') + '"><span class="step">' + String(i + 1).padStart(2,'0') + '</span>' + esc(shortSection(s)) + '</button>').join('');
  }
  function renderForm() {
    const section = template().sections.find(s => s.id === state.section) || template().sections[0]; state.section = section.id;
    renderNav(); const fields = template().fields.filter(f => f.section === state.section);
    let html = '<div class="form-intro"><h2>' + esc(shortSection(section)) + '</h2><small>' + fields.length + ' 個欄位</small></div>';
    if (state.section === 'basic') html += basicFields(fields);
    else {
      if (state.section === 'signature') html += '<p class="notice-line">簽名與公司章欄可留白供列印後簽署。填入文字只會產生打字註記。</p>';
      if (state.section === 'category') html += '<p class="form-subtitle">勾選本次報告所屬類別。</p>';
      if (state.section === 'risk') html += '<p class="form-subtitle">依原表的各列問句選擇「是／否」，並自行確認客戶風險等級。</p>';
      html += groupFields(fields);
      if (state.section === 'signature') html += '<div class="inline-actions"><button type="button" class="text-button" id="todayButton">填入今天日期（民國）</button></div>';
    }
    $('formFields').innerHTML = html;
    $('todayButton')?.addEventListener('click', () => { const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date()); const d = Object.fromEntries(parts.map(p=>[p.type,p.value])); values().sign_y = String(Number(d.year) - 1911); values().sign_m = String(Number(d.month)); values().sign_d = String(Number(d.day)); dataChanged(); renderForm(); });
  }
  function renderFieldProperties() {
    const f = fieldById(state.selected); if (!f) { $('fieldProperties').innerHTML = '<p class="hint">點選右側的任意欄位開始校正。</p>'; return; }
    $('fieldSelect').value = f.id; const o = overrides()[f.id] || {}; const actual = {...f,...o};
    let html = '<span class="property-tag">' + (f.type === 'checkbox' ? '勾選欄位' : '文字欄位') + '</span><div class="settings-grid">';
    for (const [key,label] of [['x','水平位置 X'],['y','垂直位置 Y'],['w','欄位寬度'],['h','欄位高度']]) html += '<label>' + label + '<span>pt</span><input type="number" data-property="' + key + '" value="' + Number(actual[key]).toFixed(2) + '" step="0.1" min="' + (['w','h'].includes(key) ? 2 : 0) + '" max="' + (['x','w'].includes(key) ? template().width : template().height) + '"></label>';
    if (f.type === 'text') {
      html += '<label>本欄字級<span>pt</span><input type="number" data-property="fontSize" value="' + Number(o.fontSize ?? f.fontSize * settings().fontSize / 9).toFixed(1) + '" min="3" max="36" step="0.5"></label><label>文字對齊<select data-property="align"><option value="left"' + ((actual.align || 'left') === 'left' ? ' selected' : '') + '>靠左</option><option value="center"' + (actual.align === 'center' ? ' selected' : '') + '>置中</option><option value="right"' + (actual.align === 'right' ? ' selected' : '') + '>靠右</option></select></label>';
    } else html += '<label>本欄勾勾大小<span>pt</span><input type="number" data-property="checkSize" value="' + (o.checkSize ?? settings().checkSize) + '" min="3" max="16" step="0.5"></label>';
    html += '</div>';
    if (f.type === 'text') {
      html += '<label class="guide-control" style="margin-top:16px"><input type="checkbox" data-property="multiline"' + (actual.multiline ? ' checked' : '') + '>允許換行（需增加欄位高度）</label>';
      if (values()[f.id]) { const result = PdfEngine.layoutText(f,values()[f.id],settings(),o); html += '<p class="hint">實際輸出字級 ' + result.fontSize.toFixed(2) + ' pt' + (result.shrunk ? '，已配合欄位自動縮小。' : '。') + '</p>'; }
    }
    html += '<div class="inline-actions"><button type="button" class="text-button" id="resetFieldButton">還原此欄定位與大小</button></div>';
    $('fieldProperties').innerHTML = html;
    $('resetFieldButton').addEventListener('click', () => { delete overrides()[f.id]; renderFieldProperties(); renderPreview(); persist(); toast('已還原此欄設定'); });
  }
  function renderCalibration() {
    $('fieldSelect').innerHTML = template().sections.map(s => '<optgroup label="' + esc(s.title) + '">' + template().fields.filter(f => f.section === s.id).map(f => '<option value="' + f.id + '">' + esc(f.label) + '</option>').join('') + '</optgroup>').join('');
    if (!fieldById(state.selected)) state.selected = 'applicant_name';
    const s = settings(); $('fontScale').value = Math.round(s.fontSize / 9 * 100); $('fontScaleValue').value = $('fontScale').value + '%';
    $('checkSize').value = s.checkSize; $('offsetX').value = s.offsetX; $('offsetY').value = s.offsetY;
    if (![...$('inkColor').options].some(o => o.value === s.color)) { const o = new Option('自訂顏色',s.color); $('inkColor').add(o); }
    $('inkColor').value = s.color; renderFieldProperties();
  }
  function svgNode(type, attrs = {}, text = null) { const node = document.createElementNS(SVG,type); for (const [key,v] of Object.entries(attrs)) node.setAttribute(key,String(v)); if (text != null) node.textContent = text; return node; }
  function renderPreview() {
    if (!state.ready) return;
    const frag = document.createDocumentFragment(), t = template(), v = values(), s = settings(), os = overrides();
    let shrunk = 0;
    state.issues = PdfEngine.validateForm({template:t,values:v,settings:s,overrides:os}); const bad = new Set(state.issues.map(i=>i.fieldId));
    for (const f of t.fields) {
      const value = v[f.id]; const result = f.type === 'text' ? PdfEngine.layoutText(f,value || '',s,os[f.id]) : PdfEngine.checkLayout(f,s,os[f.id]); const r = result.rect;
      const group = svgNode('g',{'data-anchor':f.id,class:(state.selected === f.id ? 'field-selected ' : '') + (bad.has(f.id) ? 'field-problem' : '')});
      const rect = svgNode('rect',{x:r.x,y:r.y,width:r.w,height:r.h,rx:f.type === 'checkbox' ? .6 : .9,class:'field-hit'}); group.append(rect);
      group.append(svgNode('title',{},f.label + (value ? '：' + (f.type === 'checkbox' ? '已勾選' : value) : '')));
      if (value && f.type === 'text') {
        if (result.shrunk) shrunk++;
        for (const line of result.lines) group.append(svgNode('text',{x:line.x,y:line.baseline,'font-family':'ReportCJK','font-size':line.size,'font-kerning':'none','font-variant-ligatures':'none',fill:s.color},line.text));
      } else if (value && f.type === 'checkbox') group.append(svgNode('polyline',{points:result.points.map(p=>p.join(',')).join(' '),fill:'none',stroke:s.color,'stroke-width':result.thickness,'stroke-linecap':'round','stroke-linejoin':'round','pointer-events':'none'}));
      if (state.mode === 'calibrate' && state.selected === f.id) group.append(svgNode('rect',{x:r.x+r.w-2.5,y:r.y+r.h-2.5,width:5,height:5,rx:.5,class:'field-handle','data-resize':f.id}));
      frag.append(group);
    }
    $('overlay').replaceChildren(frag);
    $('paper').classList.toggle('show-guides',state.guides); $('paper').classList.toggle('calibrating',state.mode === 'calibrate');
    $('demoBadge').classList.toggle('hidden',!state.demo[state.templateId]);
    const filled = t.fields.filter(f => !!v[f.id]).length; $('filledCount').textContent = filled + ' 個已填';
    $('previewStatus').textContent = state.issues.length ? state.issues.length + ' 處需要調整 · 點「匯出 PDF」查看' : '已就緒 · ' + filled + ' / ' + t.fields.length + ' 個欄位已填' + (shrunk ? ' · ' + shrunk + ' 欄已自動縮字' : '');
    $('previewStatus').classList.toggle('warn',!!state.issues.length);
    $('selectedStatus').textContent = state.selected ? fieldById(state.selected)?.label || '' : '點選欄位即可填寫';
  }
  function hideExportResult() { $('exportResult').classList.add('hidden'); }
  function dataChanged() { mirrorApplicant(); state.dirty = true; hideExportResult(); renderPreview(); persist(); }
  function selectField(id, focusInput = false, scrollPreview = false) {
    const f = fieldById(id); if (!f) return; state.selected = id;
    if (state.mode === 'fill') {
      if (state.section !== f.section) { state.section = f.section; renderForm(); }
      document.querySelectorAll('.active-field').forEach(e=>e.classList.remove('active-field'));
      document.querySelector('[data-field-wrap="' + f.id + '"]')?.classList.add('active-field');
      if (focusInput) { const target = $('input-' + f.id); target?.scrollIntoView({block:'nearest',behavior:'smooth'}); if (target && !target.disabled) target.focus({preventScroll:true}); }
    } else renderFieldProperties();
    renderPreview();
    if (scrollPreview) { const g = $('overlay').querySelector('[data-anchor="' + f.id + '"]'); g?.scrollIntoView({block:'nearest',behavior:'smooth'}); }
  }
  function setMode(mode) {
    state.mode = mode; $('fillPanel').classList.toggle('hidden',mode !== 'fill'); $('calibrationPanel').classList.toggle('hidden',mode !== 'calibrate');
    document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode === mode));
    if (mode === 'calibrate') renderCalibration(); else { if (fieldById(state.selected)) state.section = fieldById(state.selected).section; renderForm(); }
    renderPreview();
  }
  function setTemplate(id) {
    if (!window.TEMPLATES[id]) return;
    state.templateId = id; state.section = window.TEMPLATES[id].sections[0].id; state.selected = ''; hideExportResult();
    document.querySelectorAll('[data-template]').forEach(b=>{ b.classList.toggle('active',b.dataset.template === id); b.setAttribute('aria-pressed',String(b.dataset.template === id)); });
    $('previewFileName').textContent = template().title + ' · ' + template().version + ' 版';
    const path = template().preview || 'assets/' + id + '.png'; $('templateImage').src = window.EMBEDDED_ASSETS?.[path] ? 'data:image/png;base64,' + window.EMBEDDED_ASSETS[path] : path;
    $('templateImage').alt = template().title + '原稿';
    $('overlay').setAttribute('viewBox','0 0 ' + template().width + ' ' + template().height);
    renderForm(); if (state.mode === 'calibrate') renderCalibration(); renderPreview(); resizePaper();
    $('formScroll').scrollTop = 0; $('previewScroll').scrollTop = 0;
  }
  function resizePaper() { const panelWidth = $('previewScroll').clientWidth; const available = Math.max(260,panelWidth - (window.innerWidth <= 760 ? 36 : 70)); const width = state.zoom === 'fit' ? Math.min(820,available) : template().width * (96 / 72) * Number(state.zoom) / 100; $('paper').style.width = Math.round(width) + 'px'; $('pageStage').style.justifyContent = width > available ? 'flex-start' : 'center'; }
  function setZoom(z) { state.zoom = z; $('zoomSelect').value = z; resizePaper(); }

  $('sectionNav').addEventListener('click', e => { const b = e.target.closest('[data-section]'); if (!b) return; state.section = b.dataset.section; renderForm(); $('formScroll').scrollTop = 0; });
  $('templateSwitch').innerHTML = templateIds.map(id => { const t = window.TEMPLATES[id]; return '<button type="button" class="template-tab" data-template="' + esc(id) + '" aria-pressed="false"><span>' + esc(t.shortTitle || t.title) + '<small class="template-version">' + esc(t.version) + ' 版</small></span><span class="mini-tag">' + t.fields.length + ' 欄</span></button>'; }).join('');
  $('templateSwitch').addEventListener('click',e=>{ const b = e.target.closest('[data-template]'); if (b) setTemplate(b.dataset.template); });
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
  $('formFields').addEventListener('input', e => {
    const id = e.target.dataset.field; const f = fieldById(id); if (!f || f.type === 'checkbox') return;
    values()[id] = e.target.value; dataChanged();
    if (id.startsWith('applicant_') && values().insured_same) { const input = $('input-' + id.replace(/^applicant_/,'insured_')); if (input) input.value = values()[id]; }
  });
  $('formFields').addEventListener('change', e => {
    const id = e.target.dataset.field; const f = fieldById(id); if (!f || f.type !== 'checkbox') return;
    if (f.exclusive && e.target.checked) for (const other of template().fields) if (other.group === f.group) values()[other.id] = false;
    values()[id] = e.target.checked;
    if (id === 'insured_same' && e.target.checked) { const rel = template().fields.find(g=>['relation_self','relationship_self'].includes(g.id)); if (rel) { for (const other of template().fields) if (other.group === rel.group) values()[other.id] = false; values()[rel.id] = true; } }
    dataChanged(); const scroll = $('formScroll').scrollTop; renderForm(); $('formScroll').scrollTop = scroll;
  });
  $('formFields').addEventListener('focusin', e => { if (e.target.dataset.field && state.selected !== e.target.dataset.field) selectField(e.target.dataset.field); });
  $('fieldSelect').addEventListener('change',e=>selectField(e.target.value,false,true));
  function updateFieldProperty(e) {
    const prop = e.target.dataset.property; if (!prop || !state.selected) return;
    if (e.type === 'input' && e.target.value === '' && !['multiline','align'].includes(prop)) return;
    let value = prop === 'multiline' ? e.target.checked : prop === 'align' ? e.target.value : finite(e.target.value,NaN);
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    const f = fieldById(state.selected), prior = {...f,...overrides()[state.selected]};
    if (['x','y','w','h'].includes(prop)) {
      const limits = {x:[0,template().width-prior.w],y:[0,template().height-prior.h],w:[2,template().width-prior.x],h:[2,Math.min(100,template().height-prior.y)]}; value = clamp(value,...limits[prop]);
    }
    if (prop === 'fontSize') value = clamp(value,3,36); if (prop === 'checkSize') value = clamp(value,3,16);
    overrides()[state.selected] = {...overrides()[state.selected],[prop]:value}; renderPreview(); if (e.type === 'change') renderFieldProperties(); persist();
  }
  $('fieldProperties').addEventListener('input',updateFieldProperty);
  $('fieldProperties').addEventListener('change',updateFieldProperty);
  for (const [id,key] of [['checkSize','checkSize'],['offsetX','offsetX'],['offsetY','offsetY'],['inkColor','color'],['fontScale','fontSize']]) {
    $(id).addEventListener('input',e => { let value = id === 'inkColor' ? e.target.value : Number(e.target.value); if (id === 'fontScale') { value = value / 100 * 9; $('fontScaleValue').value = e.target.value + '%'; } settings()[key] = value; state.settings[state.templateId] = cleanSettings(settings()); renderPreview(); persist(); });
    $(id).addEventListener('change',()=>renderFieldProperties());
  }
  $('showGuides').addEventListener('change', e=>{ state.guides = e.target.checked; renderPreview(); });
  $('zoomSelect').addEventListener('change',e=>setZoom(e.target.value));
  function zoomStep(direction) { const zs = [75,100,125,150]; const widthPercent = $('paper').clientWidth / (template().width * 96 / 72) * 100; const current = state.zoom === 'fit' ? widthPercent : Number(state.zoom); const next = direction > 0 ? zs.find(z=>z>current+.1) || 150 : [...zs].reverse().find(z=>z<current-.1) || 75; setZoom(String(next)); }
  $('zoomIn').addEventListener('click',()=>zoomStep(1)); $('zoomOut').addEventListener('click',()=>zoomStep(-1));
  new ResizeObserver(resizePaper).observe($('previewScroll'));

  $('overlay').addEventListener('pointerdown', e => {
    const anchor = e.target.closest('[data-anchor]'); if (!anchor) return;
    const id = anchor.dataset.anchor;
    if (state.mode !== 'calibrate') {
      selectField(id,true);
      const f = fieldById(id); if (f.type === 'checkbox' && !isMirrored(f)) {
        const checked = !values()[id]; if (checked && f.exclusive) for (const other of template().fields) if (other.group === f.group) values()[other.id] = false;
        values()[id] = checked;
        if (id === 'insured_same' && checked) { const rel = template().fields.find(f=>['relation_self','relationship_self'].includes(f.id)); if (rel) { for (const other of template().fields) if (other.group === rel.group) values()[other.id] = false; values()[rel.id] = true; } }
        dataChanged(); renderForm();
      }
      return;
    }
    e.preventDefault(); const f = fieldById(id); const o = {...f,...overrides()[id]};
    drag = { id, pointerId:e.pointerId, x:e.clientX,y:e.clientY, original:o, resize:!!e.target.dataset.resize, scale:$('paper').getBoundingClientRect().width / template().width };
    selectField(id); $('paper').focus({preventScroll:true}); $('overlay').setPointerCapture(e.pointerId);
  });
  $('overlay').addEventListener('pointermove', e => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = (e.clientX-drag.x) / drag.scale, dy = (e.clientY-drag.y) / drag.scale, f = drag.original;
    const change = drag.resize ? {w:clamp(f.w+dx,2,template().width-f.x),h:clamp(f.h+dy,2,Math.min(100,template().height-f.y))} : {x:clamp(f.x+dx,0,template().width-f.w),y:clamp(f.y+dy,0,template().height-f.h)};
    for (const key of Object.keys(change)) change[key] = Math.round(change[key]*100)/100;
    overrides()[drag.id] = {...overrides()[drag.id],...change}; renderPreview();
  });
  function finishDrag() { if (!drag) return; drag = null; renderFieldProperties(); persist(); }
  $('overlay').addEventListener('pointerup',finishDrag); $('overlay').addEventListener('pointercancel',finishDrag);
  $('paper').addEventListener('keydown', e => {
    if (state.mode !== 'calibrate' || !state.selected || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
    e.preventDefault(); const f = {...fieldById(state.selected),...overrides()[state.selected]}, step = e.shiftKey ? .1 : 1;
    const change = { x:clamp(f.x+({ArrowLeft:-step,ArrowRight:step}[e.key]||0),0,template().width-f.w), y:clamp(f.y+({ArrowUp:-step,ArrowDown:step}[e.key]||0),0,template().height-f.h) };
    overrides()[state.selected] = {...overrides()[state.selected],x:Math.round(change.x*100)/100,y:Math.round(change.y*100)/100}; renderPreview(); renderFieldProperties(); persist();
  });

  function download(bytes,name,type) { const blob = bytes instanceof Blob ? bytes : new Blob([bytes],{type}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000); }
  function dateStamp() { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replace(/-/g,''); }
  function fileSafe(s) { return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,45); }
  $('exportButton').addEventListener('click', async () => {
    if (!state.ready) return;
    if (state.issues.length) { const first = state.issues[0]; selectField(first.fieldId,true,true); await showMessage('請先調整這些欄位',state.issues.map(i=>'• '+i.label+'\n  '+i.message).join('\n\n') + '\n\n可縮短內容，或在「位置校正」調整欄位寬度、高度與字型。'); return; }
    if (state.demo[state.templateId] && !await showMessage('輸出範例報告？','這份報告由範例帶入，請確認資料已替換。輸出檔名會加上「範例」，方便辨識。',{confirm:'輸出範例 PDF',cancel:true})) return;
    const button = $('exportButton'); button.disabled = true; button.querySelector('span:last-child').textContent = '正在輸出…';
    const selectedTemplate = template(), selectedValues = {...values()}, selectedSettings = {...settings()}, selectedOverrides = JSON.parse(JSON.stringify(overrides())), isDemo = state.demo[state.templateId];
    try {
      await new Promise(r=>setTimeout(r,40));
      const result = await PdfEngine.createPdf({template:selectedTemplate,values:selectedValues,settings:selectedSettings,overrides:selectedOverrides});
      const name = (isDemo ? '範例_' : '') + selectedTemplate.title + '_' + selectedTemplate.version + (selectedValues.applicant_name ? '_' + fileSafe(selectedValues.applicant_name) : '') + '_' + dateStamp() + '.pdf';
      if (lastPdfUrl) URL.revokeObjectURL(lastPdfUrl);
      lastPdfUrl = URL.createObjectURL(new Blob([result.bytes],{type:'application/pdf'}));
      $('downloadPdfLink').href = lastPdfUrl; $('downloadPdfLink').download = name; $('openPdfLink').href = lastPdfUrl; $('exportFileName').textContent = name; $('exportResult').classList.remove('hidden');
      $('downloadPdfLink').click(); toast('PDF 已產生；可在下方重新下載或開啟檢查');
    } catch (error) { console.error(error); await showMessage('無法輸出 PDF',error.message || '輸出時發生錯誤，請重新開啟工具。'); }
    finally { button.disabled = false; button.querySelector('span:last-child').textContent = '匯出 PDF'; }
  });
  function updateCopySources() {
    const previous = $('copySourceSelect').value;
    const others = templateIds.filter(id => id !== state.templateId);
    $('copySourceSelect').innerHTML = others.map(id => '<option value="' + esc(id) + '">' + esc(window.TEMPLATES[id].shortTitle || window.TEMPLATES[id].title) + ' · ' + esc(window.TEMPLATES[id].version) + ' 版</option>').join('');
    $('copySourceSelect').value = others.includes(previous) ? previous : others.find(hasData) || others[0] || '';
  }
  $('manageButton').addEventListener('click',()=>{ $('rememberDraft').checked = state.remember; updateCopySources(); $('manageDialog').showModal(); });
  $('saveDraftButton').addEventListener('click',()=>{ download(JSON.stringify(snapshot(),null,2),'保險報告草稿_'+dateStamp()+'.json','application/json'); state.dirty = false; toast('已下載全部 ' + templateIds.length + ' 份報告的草稿'); });
  $('saveLayoutButton').addEventListener('click',()=>{ download(JSON.stringify(snapshot('layout'),null,2),'保險報告定位_多範本_'+dateStamp()+'.json','application/json'); toast('已下載定位設定，不包含填寫資料'); });
  $('loadDraftButton').addEventListener('click',()=>$('draftFile').click()); $('loadLayoutButton').addEventListener('click',()=>$('layoutFile').click());
  async function importFile(input,kind) {
    const file = input.files[0]; if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('JSON 檔案過大，請選擇由此工具產生的草稿或定位檔。');
      const raw = JSON.parse(await file.text());
      const ids = snapshotTemplateIds(raw,kind), names = ids.map(id => window.TEMPLATES[id].shortTitle || window.TEMPLATES[id].title).join('、');
      if (kind === 'draft' && ids.some(hasData) && !await showMessage('匯入並取代目前資料？','將取代：' + names + '的填寫資料與定位。檔案未包含的範本會保留。若要保留目前內容，請先下載草稿。',{confirm:'匯入並取代',cancel:true})) return;
      if (kind === 'layout' && !await showMessage('套用定位設定？','將套用：' + names + '的位置與大小設定。填寫資料及檔案未包含的範本會保留。',{confirm:'套用設定',cancel:true})) return;
      applySnapshot(raw,kind); persist(); setTemplate(state.templateId); $('manageDialog').close(); toast(kind === 'draft' ? '草稿已匯入' : '定位設定已套用');
    } catch (error) { await showMessage('無法匯入檔案',error.message || '檔案內容無法辨識。'); }
    finally { input.value = ''; }
  }
  $('draftFile').addEventListener('change',e=>importFile(e.target,'draft')); $('layoutFile').addEventListener('change',e=>importFile(e.target,'layout'));
  $('rememberDraft').addEventListener('change',e=>{ state.remember = e.target.checked; putStored(STORAGE_REMEMBER,state.remember ? 'yes' : null); if (!state.remember) putStored(STORAGE_DRAFT,null); else persist(); toast(state.remember ? '已開啟本機草稿記憶' : '已刪除本機儲存的草稿，目前畫面資料仍保留'); });
  $('clearButton').addEventListener('click',async()=>{ if (!hasData(state.templateId)) return toast('這份報告目前沒有填寫資料'); if (!await showMessage('清空這份報告？','僅清空「'+template().title+'」的填寫資料。其他報告與欄位定位設定會保留。',{confirm:'清空本表',cancel:true})) return; state.values[state.templateId] = {}; state.demo[state.templateId] = false; dataChanged(); renderForm(); toast('本表資料已清空'); });
  $('resetLayoutButton').addEventListener('click',async()=>{ if (!await showMessage('還原預設定位？','本表的位置、字級、勾勾大小與偏移會回到預先校對的設定。填寫資料會保留。',{confirm:'還原定位',cancel:true})) return; state.overrides[state.templateId] = {}; state.settings[state.templateId] = defaults(); renderCalibration(); renderPreview(); persist(); toast('本表定位已還原'); });
  $('copyBasicButton').addEventListener('click',async()=>{
    const other = $('copySourceSelect').value;
    if (!window.TEMPLATES[other] || other === state.templateId) return;
    if (!hasData(other)) return showMessage('來源報告尚無資料','請先填寫選定的來源報告，或選擇其他來源。');
    if (!await showMessage('帶入基本資料？','來源：' + (window.TEMPLATES[other].shortTitle || window.TEMPLATES[other].title) + '。本表的要保人、被保險人與簽署／業務員資料，會以對應內容覆寫。只帶入共用基本欄位，請確認新版與舊版關係選項的差異。',{confirm:'帶入基本資料',cancel:true})) return;
    const relMap = {relation_self:'relationship_self',relation_parent:'relationship_parents',relation_spouse:'relationship_spouse',relation_child:'relationship_children',relation_sibling:'relationship_siblings',relation_grandparent:'relationship_grandparents',relation_grandchild:'relationship_grandchildren',relation_employee:'relationship_employee',relation_representative:'relationship_representative',relation_other:'relationship_other',relation_other_text:'relationship_other_text'};
    const canonical = id => relMap[id] || id;
    const sourceFields = new Map(window.TEMPLATES[other].fields.map(f => [canonical(f.id), f]));
    const sourceValues = state.values[other];
    const sourceValue = id => sourceValues[sourceFields.get(id)?.id];
    const relationFields = template().fields.filter(f => /^relationship_|^relation_/.test(f.id));
    for (const f of relationFields) values()[f.id] = f.type === 'checkbox' ? false : '';
    for (const f of template().fields) {
      if (!['basic','signature'].includes(f.section) && f.id !== 'insured_id') continue;
      const source = sourceFields.get(canonical(f.id));
      if (source && source.type === f.type) values()[f.id] = sourceValues[source.id] ?? (f.type === 'checkbox' ? false : '');
    }
    // The older property form has only an insured ID. When it identifies the
    // same person as the applicant, seed the new applicant ID before mirroring.
    if (sourceValues.insured_same && !sourceFields.has('applicant_id') && sourceFields.has('insured_id') && template().fields.some(f => f.id === 'applicant_id')) values().applicant_id = sourceValue('insured_id') ?? '';
    let relationNeedsReview = false;
    for (const [combined, individual] of [['relationship_parents_children',['relationship_parents','relationship_children']],['relationship_grandparents_grandchildren',['relationship_grandparents','relationship_grandchildren']]]) {
      const target = relationFields.find(f => f.id === combined);
      if (target && individual.some(id => !!sourceValue(id))) values()[target.id] = true;
      if (!target && sourceValue(combined)) relationNeedsReview = true;
    }
    const seenGroups = new Set();
    for (const f of template().fields) if (f.exclusive && f.group && values()[f.id]) { if (seenGroups.has(f.group)) values()[f.id] = false; else seenGroups.add(f.group); }
    state.demo[state.templateId] = state.demo[other]; dataChanged(); renderForm(); $('manageDialog').close();
    if (relationNeedsReview) await showMessage('基本資料已帶入，請確認關係','新版把父母／子女、祖父母／孫子女合併為選項。舊版需要再區分，請在本表重新選擇對應關係。');
    else toast('基本資料已帶入');
  });
  $('sampleButton').addEventListener('click',async()=>{
    if (hasData(state.templateId) && !await showMessage('以範例取代本表資料？','目前填寫內容會被範例取代。若要保留，請先下載草稿。',{confirm:'帶入範例',cancel:true})) return;
    const common = {applicant_name:'王小明',applicant_dob_y:'80',applicant_dob_m:'6',applicant_dob_d:'15',applicant_sex_m:true,insured_same:true,purpose_protection:true,purpose_medical:true,senior_suitability_yes:false,sign_y:'115',sign_m:'11',sign_d:'10',sales_unit:'服務一部',sales_license:'A123456789'};
    const extra = state.templateId !== 'property' ? {applicant_occupation:'行政人員',relationship_self:true,company_specified_no:true,insurance_life:true,insurance_amount:'100',existing_policy_no:true,payment_yearly:true,premium_currency:'新臺幣',premium_estimate:'24,000',retirement_21_30:true,source_salary:true,recommended_company:'範例人壽',company_info_website:true,recommended_product:'定期壽險附加醫療保障',recommended_amount:'100萬元',recommended_premium:'24,000',term_20:true,coverage_proposal:true,reason_fit:true} : {category_motor:true,relation_self:true,insured_id:'A123456789',plate_number:'ABC-1234',vehicle_type:'自用小客車',insurance_compulsory:true,insurance_voluntary:true,designated_company_no:true,period_start_y:'115',period_start_m:'11',period_start_d:'10',period_end_y:'116',period_end_m:'11',period_end_d:'10',requested_amount:'300',existing_insurance_no:true,estimated_premium:'12,000',recommended_company:'範例',intro_company_web:true,recommend_reason_needs:true,recommended_other:true,recommended_product:'汽車第三人責任保險',recommended_amount:'300',recommended_premium:'12,000',coverage_proposal:true};
    const sample = {...common,...extra,...(template().sampleValues || {})};
    state.values[state.templateId] = Object.fromEntries(template().fields.filter(f => sample[f.id] !== undefined).map(f => [f.id, sample[f.id]])); state.demo[state.templateId] = true; dataChanged(); renderForm(); toast('範例已帶入，可查看文字與勾選位置');
  });
  async function loadBrowserFont() {
    const bytes = PdfEngine.getFontBytes(); const next = new FontFace('ReportCJK',bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)); await next.load(); if (activeFontFace) document.fonts.delete(activeFontFace); document.fonts.add(next); activeFontFace = next; await document.fonts.ready;
  }
  $('customFontButton').addEventListener('click',()=>$('fontFile').click());
  $('fontFile').addEventListener('change',async e=>{
    const file = e.target.files[0]; if (!file) return;
    const old = PdfEngine.getFontBytes();
    try { if (file.size > 30*1024*1024) throw new Error('字型超過 30 MB，請選擇較小的單一 TTF／OTF 字型。'); PdfEngine.setFontBytes(new Uint8Array(await file.arrayBuffer())); await loadBrowserFont(); state.customFont = file.name; $('fontLabel').textContent = '本次字型 · ' + file.name; renderPreview(); renderFieldProperties(); toast('自訂字型已載入'); }
    catch(error) { PdfEngine.setFontBytes(old); await showMessage('無法載入字型',error.message); }
    finally { e.target.value = ''; }
  });
  $('defaultFontButton').addEventListener('click',async()=>{ PdfEngine.resetFont(); await loadBrowserFont(); state.customFont = ''; $('fontLabel').textContent = '內附中文字型 · Droid Sans Fallback'; renderPreview(); renderFieldProperties(); toast('已還原內附中文字型'); });
  $('helpButton').addEventListener('click',()=>showMessage('使用說明','1. 選擇新版合併報告、原版壽險或產險，依段落輸入資料。點右側欄位可跳至對應輸入欄，方框也可直接點選。\n\n2. 日期使用民國年，金額依原表標示的元或萬元輸入；不需要的欄位留白即可。\n\n3. 點「位置校正」可拖曳欄位、拖右下角調整大小，或輸入 X、Y、寬、高與字級。1 pt 約 0.353 mm。\n\n4. 點「匯出 PDF」下載完成的報告。綠色欄位提示與校正框不會出現在 PDF。原稿與填寫文字保留在同一份 PDF。\n\n5. 草稿下載成 JSON，可下次匯入續填。若未開啟本機記憶，重新整理或關閉頁面後，未下載的填寫內容會消失。定位設定仍會保留於可用的瀏覽器儲存空間。\n\n6. 請以 PDF 閱讀器列印，設定 A4、實際大小／100%，關閉「符合頁面」縮放。\n\n7. 簽名欄輸入只會產生打字文字；需要親簽或用印時請留白。\n\n離線版：下載 HTML 後使用 Chrome 或 Edge 開啟，不需要安裝 Python，也不需連網載入字型。'));
  window.addEventListener('beforeunload',e=>{ const saved = state.remember && putStored(STORAGE_DRAFT,JSON.stringify(snapshot())); if (state.dirty && !saved) { e.preventDefault(); e.returnValue = ''; } });
  async function initialize() {
    try {
      const layout = getStored(STORAGE_LAYOUT); if (layout) { try { applySnapshot(JSON.parse(layout),'layout'); } catch (_) {} }
      state.remember = getStored(STORAGE_REMEMBER) === 'yes'; if (state.remember) { const draft = getStored(STORAGE_DRAFT); if (draft) { try { applySnapshot(JSON.parse(draft),'draft'); } catch (_) {} } }
      let provider;
      if (window.EMBEDDED_ASSETS) provider = async path => { const b64 = window.EMBEDDED_ASSETS[path]; if (!b64) throw new Error('離線檔案缺少資源：' + path); const binary = atob(b64), result = new Uint8Array(binary.length); for (let i=0;i<binary.length;i++) result[i] = binary.charCodeAt(i); return result; };
      await PdfEngine.loadResources(provider); await loadBrowserFont(); state.ready = true; setTemplate(state.templateId);
      if (window.EMBEDDED_ASSETS) $('offlineCard')?.classList.add('hidden');
      $('exportButton').disabled = false; $('loadingOverlay').classList.add('hidden');
    } catch(error) { console.error(error); $('loadingOverlay').classList.add('hidden'); $('previewStatus').textContent = '載入失敗'; await showMessage('工作台無法啟動',error.message + '\n\n若使用下載版本，請用 Chrome 或 Edge 開啟完整的 HTML 檔案。'); }
  }
  initialize();
})();
