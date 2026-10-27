/* 课表工具 · 界面与交互 */
(function () {
  'use strict';

  const App = window.App;
  const U = App.util;
  const esc = U.esc;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  const dom = {};
  const SEEDED_KEY = 'timetable.seeded';
  let editingId = null;
  let pendingImport = null;
  let lastSwipeTs = 0;
  let toastTimer = null;
  let seededOnce = false;

  /* ---------- 会话状态 ---------- */

  function state() {
    return App.state;
  }

  function week() {
    return App.view.week;
  }

  function setWeek(n) {
    const total = U.totalWeeks();
    const next = U.clamp(n, 1, total);
    if (next === week()) return;
    App.view.week = next;
    renderHeader();
    renderGrid();
  }

  function save() {
    App.store.save();
    applyTheme();
  }

  function toast(message, duration) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('is-on'), duration || 2200);
  }
  App.toast = toast;

  /* ---------- 主题 ---------- */

  function applyTheme() {
    const term = state() && state().term;
    const pref = (term && term.theme) || 'auto';
    const dark = pref === 'dark'
      || (pref === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0c0e12' : '#f4f5f7');
  }

  /* ---------- 顶栏 ---------- */

  function renderHeader() {
    const term = state().term;
    const w = week();
    const dates = U.weekDates(w);
    const cur = U.currentWeek();

    dom.termTitle.textContent = U.termLabel();
    dom.termSub.textContent = w === cur
      ? `第 ${w} 周 · 本周 · ${U.fmtRange(dates[0], dates[6])}`
      : `第 ${w} 周 · ${U.fmtRange(dates[0], dates[6])}`;
    dom.weekPill.textContent = `第 ${w} 周`;
    dom.btnPrev.disabled = w <= 1;
    dom.btnNext.disabled = w >= U.totalWeeks();
    dom.btnToday.classList.toggle('is-active', w === cur);
    dom.stage.dataset.periods = term.periods;
  }

  /* ---------- 课表网格 ---------- */

  function visibleDays() {
    return state().term.showWeekend ? 7 : 5;
  }

  function courseColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 100000;
    return App.COLORS[hash % App.COLORS.length];
  }

  function coursesOfDay(day) {
    const w = week();
    return state().courses.filter((c) => c.day === day && c.weeks.indexOf(w) !== -1);
  }

  /* 同一时段重叠的课并排显示 */
  function assignLanes(list) {
    const items = list.slice().sort((a, b) => a.start - b.start || b.end - a.end);
    const laneEnds = [];
    const maxAt = {};
    items.forEach((c) => {
      let lane = laneEnds.findIndex((end) => end < c.start);
      if (lane === -1) {
        laneEnds.push(c.end);
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = c.end;
      }
      c._lane = lane;
    });
    items.forEach((c) => {
      let max = 1;
      for (let p = c.start; p <= c.end; p += 1) {
        const n = items.filter((o) => o.start <= p && o.end >= p).length;
        if (n > max) max = n;
      }
      maxAt[c.id] = max;
      c._lanes = maxAt[c.id];
    });
    return items;
  }

  function courseNode(c) {
    const w = c._lanes || 1;
    const left = (c._lane || 0) * (100 / w);
    const span = c.end - c.start + 1;
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'course' + (span <= 2 ? ' is-short' : span >= 4 ? ' is-tall' : '');
    node.dataset.course = c.id;
    node.style.top = `calc(var(--period-h) * ${c.start - 1} + 2px)`;
    node.style.height = `calc(var(--period-h) * ${span} - 6px)`;
    node.style.left = `calc(${left}% + 2px)`;
    node.style.width = `calc(${100 / w}% - 4px)`;
    node.style.setProperty('--c', c.color);
    node.title = `${c.name}${c.place ? '\n' + c.place : ''}`;

    const name = document.createElement('span');
    name.className = 'c-name';
    name.textContent = c.name;
    node.appendChild(name);

    if (c.place && span >= 2) {
      const place = document.createElement('span');
      place.className = 'c-place';
      place.textContent = c.place;
      node.appendChild(place);
    }
    return node;
  }

  function renderGrid() {
    const term = state().term;
    const days = visibleDays();
    const w = week();
    const dates = U.weekDates(w);
    const todayCol = U.weekOf(new Date()) === w ? U.todayDay() : 0;

    dom.cal.style.setProperty('--cols', String(days));
    dom.cal.style.setProperty('--periods', String(term.periods));
    dom.stage.dataset.periods = String(term.periods);

    const head = document.createElement('div');
    head.className = 'cal-head';
    head.id = 'cal-head';
    head.appendChild(document.createElement('div'));
    for (let d = 1; d <= days; d += 1) {
      const cell = document.createElement('div');
      cell.className = 'dh' + (d === todayCol ? ' is-today' : '') + (d >= 6 ? ' is-weekend' : '');
      const dayName = document.createElement('b');
      dayName.textContent = App.DAY_NAMES[d - 1];
      const date = document.createElement('span');
      date.className = 'dh-date';
      date.textContent = U.fmtMD(dates[d - 1]);
      cell.appendChild(dayName);
      cell.appendChild(date);
      head.appendChild(cell);
    }

    const grid = document.createElement('div');
    grid.className = 'cal-grid';
    grid.id = 'cal-grid';

    const gutter = document.createElement('div');
    gutter.className = 'gutter';
    for (let p = 1; p <= term.periods; p += 1) {
      const cell = document.createElement('div');
      cell.className = 'g-cell';
      const num = document.createElement('b');
      num.textContent = String(p);
      const time = document.createElement('span');
      const t = U.periodTime(p);
      time.textContent = t.s || '';
      cell.appendChild(num);
      cell.appendChild(time);
      gutter.appendChild(cell);
    }
    grid.appendChild(gutter);

    const anyCourse = state().courses.some((c) => c.weeks.indexOf(w) !== -1);

    for (let d = 1; d <= days; d += 1) {
      const col = document.createElement('div');
      col.className = 'col' + (d === todayCol ? ' is-today' : '');
      col.dataset.day = String(d);
      const list = assignLanes(coursesOfDay(d));
      list.forEach((c) => col.appendChild(courseNode(c)));
      grid.appendChild(col);
    }

    dom.calHead.replaceWith(head);
    dom.calGrid.replaceWith(grid);
    dom.calHead = head;
    dom.calGrid = grid;

    dom.empty.hidden = anyCourse || state().courses.length > 0;
    dom.calGrid.hidden = !dom.empty.hidden;
  }

  function render() {
    applyTheme();
    renderHeader();
    renderGrid();
  }

  /* ---------- 弹层 ---------- */

  function openSheet(html) {
    // 每次都换一个新的容器，避免上一次弹层的监听器残留
    const body = document.createElement('div');
    body.className = 'sheet-scroll';
    body.id = 'sheet-body';
    body.innerHTML = html;
    dom.sheetBody.replaceWith(body);
    dom.sheetBody = body;
    dom.sheet.scrollTop = 0;
    dom.sheet.classList.add('is-open');
    dom.scrim.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    dom.sheet.classList.remove('is-open');
    dom.scrim.classList.remove('is-open');
    document.body.style.overflow = '';
    editingId = null;
  }

  function findCourse(id) {
    return state().courses.filter((c) => c.id === id)[0] || null;
  }

  /* ---------- 课程详情 ---------- */

  function openDetail(id) {
    const c = findCourse(id);
    if (!c) return;
    const times = U.timeRangeLabel(c.start, c.end);
    const weeks = U.weeksLabel(c.weeks);
    const rows = [
      ['时间', `${App.DAY_NAMES[c.day - 1]} 第 ${c.start}${c.end > c.start ? '-' + c.end : ''} 节${times ? ' · ' + times : ''}`],
      ['周次', weeks]
    ];
    if (c.place) rows.push(['地点', c.place]);
    if (c.teacher) rows.push(['教师', c.teacher]);

    openSheet(`
      <div class="sheet-grip"></div>
      <div class="sheet-body">
        <div class="detail-hero" style="--c:${esc(c.color)}">
          <div class="hero-bar"></div>
          <div style="min-width:0">
            <div class="hero-name">${esc(c.name)}</div>
            <div class="hero-sub">${esc(weeks)}${c.place ? ' · ' + esc(c.place) : ''}</div>
          </div>
        </div>
        <div class="meta-list">
          ${rows.map(([k, v]) => `<div class="meta-row"><span class="meta-key">${k}</span><span class="meta-val">${esc(v)}</span></div>`).join('')}
        </div>
        <div class="field">
          <label class="field-label" for="note-input">备注</label>
          <textarea class="textarea" id="note-input" placeholder="作业、考试、要带的东西…">${esc(c.note)}</textarea>
        </div>
        <div class="sheet-actions">
          <button class="btn" data-act="edit">编辑</button>
          <button class="btn btn-primary" data-act="done">完成</button>
        </div>
      </div>
    `);

    const note = $('#note-input');
    note.addEventListener('input', U.debounce(() => {
      const target = findCourse(id);
      if (!target) return;
      target.note = note.value;
      save();
    }, 350));

    dom.sheetBody.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (!act) return;
      const name = act.dataset.act;
      if (name === 'edit') {
        const target = findCourse(id);
        if (target) { target.note = note.value; save(); }
        openEditor(findCourse(id));
      } else if (name === 'done') {
        const target = findCourse(id);
        if (target) { target.note = note.value; save(); }
        closeSheet();
      }
    }, { once: false });
  }

  /* ---------- 编辑课程 ---------- */

  function parseWeekText(text) {
    const total = U.totalWeeks();
    const out = [];
    String(text || '').split(/[,，;；\s]+/).forEach((token) => {
      const raw = token.trim();
      if (!raw) return;
      const odd = /单/.test(raw);
      const even = /双/.test(raw);
      const nums = raw.replace(/[（(].*?[)）]/g, '').replace(/[^\d-]/g, '');
      let list = [];
      const range = nums.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) list.push(i);
      } else if (/^\d+$/.test(nums)) {
        list.push(Number(nums));
      }
      if (odd || even) {
        list = list.filter((n) => (odd ? n % 2 === 1 : n % 2 === 0));
      }
      out.push.apply(out, list);
    });
    return Array.from(new Set(out.filter((n) => n >= 1 && n <= total))).sort((a, b) => a - b);
  }

  function openEditor(course, preset) {
    const term = state().term;
    const isEdit = !!course;
    const c = course || {
      id: null,
      name: '',
      teacher: '',
      place: '',
      day: (preset && preset.day) || 1,
      start: (preset && preset.start) || 1,
      end: (preset && preset.end) || Math.min((preset && preset.start) || 1, term.periods),
      weeks: U.weeksFromMode('all', 1, term.weeks),
      color: App.COLORS[Math.floor(Math.random() * App.COLORS.length)],
      note: ''
    };
    editingId = c.id;

    let mode = U.weeksMode(c.weeks);
    if (mode !== 'all' && mode !== 'odd' && mode !== 'even') mode = 'custom';

    const dayOptions = App.DAY_NAMES.map((n, i) =>
      `<option value="${i + 1}"${c.day === i + 1 ? ' selected' : ''}>${n}</option>`).join('');
    const periodOptions = (selected) => {
      let html = '';
      for (let p = 1; p <= term.periods; p += 1) {
        html += `<option value="${p}"${p === selected ? ' selected' : ''}>第 ${p} 节</option>`;
      }
      return html;
    };

    openSheet(`
      <div class="sheet-grip"></div>
      <div class="sheet-body">
        <div class="sheet-title">${isEdit ? '编辑课程' : '添加课程'}</div>
        <div class="field">
          <label class="field-label" for="f-name">课程名称</label>
          <input class="input" id="f-name" value="${esc(c.name)}" placeholder="例如：医学微生物学">
        </div>
        <div class="row">
          <div class="field">
            <label class="field-label" for="f-teacher">教师</label>
            <input class="input" id="f-teacher" value="${esc(c.teacher)}" placeholder="选填">
          </div>
          <div class="field">
            <label class="field-label" for="f-place">地点</label>
            <input class="input" id="f-place" value="${esc(c.place)}" placeholder="选填">
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label class="field-label" for="f-day">星期</label>
            <select class="select" id="f-day">${dayOptions}</select>
          </div>
          <div class="field">
            <label class="field-label" for="f-start">开始节次</label>
            <select class="select" id="f-start">${periodOptions(c.start)}</select>
          </div>
          <div class="field">
            <label class="field-label" for="f-end">结束节次</label>
            <select class="select" id="f-end">${periodOptions(c.end)}</select>
          </div>
        </div>

        <div class="field">
          <span class="field-label">上课周次</span>
          <div class="segmented" id="f-mode">
            <button type="button" data-mode="all"${mode === 'all' ? ' class="is-on"' : ''}>每周</button>
            <button type="button" data-mode="odd"${mode === 'odd' ? ' class="is-on"' : ''}>单周</button>
            <button type="button" data-mode="even"${mode === 'even' ? ' class="is-on"' : ''}>双周</button>
            <button type="button" data-mode="custom"${mode === 'custom' ? ' class="is-on"' : ''}>自定义</button>
          </div>
        </div>

        <div class="row" id="f-range-row" ${mode === 'custom' ? 'hidden' : ''}>
          <div class="field">
            <label class="field-label" for="f-from">从第几周</label>
            <input class="input" id="f-from" type="number" min="1" max="${term.weeks}" value="${c.weeks[0] || 1}">
          </div>
          <div class="field">
            <label class="field-label" for="f-to">到第几周</label>
            <input class="input" id="f-to" type="number" min="1" max="${term.weeks}" value="${c.weeks[c.weeks.length - 1] || term.weeks}">
          </div>
        </div>

        <div class="field" id="f-custom-row" ${mode === 'custom' ? '' : 'hidden'}>
          <label class="field-label" for="f-weeks-text">周次（如 1-8,10-16 或 1-16单）</label>
          <input class="input" id="f-weeks-text" value="${esc(U.compressWeeks(c.weeks))}" placeholder="1-8,10-16">
        </div>

        <div class="field">
          <span class="field-label">颜色</span>
          <div class="swatches" id="f-colors">
            ${App.COLORS.map((col) => `<button type="button" class="swatch${col === c.color ? ' is-on' : ''}" data-color="${col}" style="background:${col}" aria-label="${col}"></button>`).join('')}
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="f-note">备注</label>
          <textarea class="textarea" id="f-note" placeholder="选填">${esc(c.note)}</textarea>
        </div>

        <div class="sheet-actions">
          <button class="btn" data-act="cancel">取消</button>
          <button class="btn btn-primary" data-act="save">保存</button>
        </div>
        ${isEdit ? '<button class="btn btn-ghost btn-block btn-danger" data-act="delete" style="margin-top:10px">删除这门课</button>' : ''}
      </div>
    `);

    let color = c.color;

    $$('#f-mode button').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        $$('#f-mode button').forEach((b) => b.classList.toggle('is-on', b === btn));
        $('#f-range-row').hidden = mode === 'custom' || mode === 'all';
        $('#f-custom-row').hidden = mode !== 'custom';
        if (mode === 'custom') {
          const list = U.weeksFromMode('range', Number($('#f-from').value), Number($('#f-to').value));
          $('#f-weeks-text').value = U.compressWeeks(list);
        }
      });
    });

    $$('#f-colors .swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        color = btn.dataset.color;
        $$('#f-colors .swatch').forEach((b) => b.classList.toggle('is-on', b === btn));
      });
    });

    $('#f-start').addEventListener('change', () => {
      const s = Number($('#f-start').value);
      const e = Number($('#f-end').value);
      if (e < s) $('#f-end').value = String(s);
    });

    dom.sheetBody.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (!act) return;
      const name = act.dataset.act;
      if (name === 'cancel') {
        closeSheet();
        return;
      }
      if (name === 'delete' && editingId) {
        if (!window.confirm('删除这门课？')) return;
        state().courses = state().courses.filter((x) => x.id !== editingId);
        save();
        closeSheet();
        render();
        toast('已删除');
        return;
      }
      if (name !== 'save') return;

      const title = $('#f-name').value.trim();
      if (!title) {
        toast('先填课程名称');
        $('#f-name').focus();
        return;
      }
      const start = Number($('#f-start').value);
      const end = Math.max(start, Number($('#f-end').value));
      let weeks;
      if (mode === 'custom') {
        weeks = parseWeekText($('#f-weeks-text').value);
      } else {
        weeks = U.weeksFromMode(mode, Number($('#f-from').value), Number($('#f-to').value));
      }
      if (!weeks.length) {
        toast('周次不能为空');
        return;
      }

      const data = {
        id: editingId || U.uid(),
        name: title,
        teacher: $('#f-teacher').value.trim(),
        place: $('#f-place').value.trim(),
        day: Number($('#f-day').value),
        start,
        end,
        weeks,
        color,
        note: $('#f-note').value
      };

      const list = state().courses.filter((x) => x.id !== data.id);
      const conflicts = U.overlapCourses(data, list);
      list.push(data);
      state().courses = list;
      save();
      closeSheet();
      render();
      toast(conflicts.length ? `已保存（与「${conflicts[0].name}」时间重叠）` : '已保存');
    });
  }

  /* ---------- 设置 ---------- */

  function settingsHtml() {
    const term = state().term;
    const times = term.times.map((t, i) => `
      <div class="time-row">
        <span>${i + 1}</span>
        <input class="input" type="time" data-time="s" data-index="${i}" value="${esc(t.s)}">
        <span>–</span>
        <input class="input" type="time" data-time="e" data-index="${i}" value="${esc(t.e)}">
      </div>`).join('');

    return `
      <div class="sheet-grip"></div>
      <div class="sheet-body">
        <div class="sheet-title">设置</div>

        <div class="field">
          <label class="field-label" for="s-start">开学第一周的周一</label>
          <input class="input" id="s-start" type="date" value="${esc(term.startDate)}">
        </div>

        <div class="row">
          <div class="field">
            <label class="field-label" for="s-weeks">学期总周数</label>
            <input class="input" id="s-weeks" type="number" min="1" max="30" value="${term.weeks}">
          </div>
          <div class="field">
            <label class="field-label" for="s-periods">每天节数</label>
            <input class="input" id="s-periods" type="number" min="1" max="16" value="${term.periods}">
          </div>
        </div>

        <div class="setting-row">
          <div class="sr-main">
            <div class="sr-title">显示周末</div>
            <div class="sr-sub">关闭后只显示周一到周五</div>
          </div>
          <button type="button" class="switch${term.showWeekend ? ' is-on' : ''}" id="s-weekend" aria-label="显示周末"></button>
        </div>

        <div class="setting-row">
          <div class="sr-main">
            <div class="sr-title">深色模式</div>
            <div class="sr-sub">跟随系统 / 始终浅色 / 始终深色</div>
          </div>
          <select class="select" id="s-theme" style="width:auto;min-width:104px">
            <option value="auto"${term.theme === 'auto' ? ' selected' : ''}>跟随系统</option>
            <option value="light"${term.theme === 'light' ? ' selected' : ''}>浅色</option>
            <option value="dark"${term.theme === 'dark' ? ' selected' : ''}>深色</option>
          </select>
        </div>

        <div class="section-title">作息时间</div>
        <div id="s-times">${times}</div>

        <div class="section-title">数据</div>
        <div class="sheet-actions">
          <button class="btn" data-act="export">导出备份</button>
          <button class="btn" data-act="import">导入备份</button>
        </div>
        <button class="btn btn-ghost btn-block btn-danger" data-act="clear" style="margin-top:10px">清空所有课程</button>
        <p class="note">数据只保存在这台设备的浏览器里（localStorage），不会上传。换设备可以「导出备份」再「导入备份」。</p>
      </div>
    `;
  }

  function openSettings() {
    openSheet(settingsHtml());

    $('#s-start').addEventListener('change', (e) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return;
      state().term.startDate = e.target.value;
      save();
      App.view.week = U.currentWeek();
      render();
    });

    $('#s-weeks').addEventListener('change', (e) => {
      const weeks = U.clamp(Number(e.target.value) || 20, 1, 30);
      state().term.weeks = weeks;
      e.target.value = String(weeks);
      App.view.week = U.clamp(App.view.week, 1, weeks);
      save();
      render();
    });

    $('#s-periods').addEventListener('change', (e) => {
      const periods = U.clamp(Number(e.target.value) || 12, 1, 16);
      state().term.periods = periods;
      e.target.value = String(periods);
      const times = [];
      for (let i = 0; i < periods; i += 1) {
        const old = state().term.times[i];
        times.push(old || { s: '', e: '' });
      }
      state().term.times = times;
      state().courses.forEach((c) => {
        c.end = Math.min(c.end, periods);
        c.start = Math.min(c.start, c.end);
      });
      save();
      render();
      openSettings();
    });

    $('#s-weekend').addEventListener('click', (e) => {
      state().term.showWeekend = !state().term.showWeekend;
      e.currentTarget.classList.toggle('is-on', state().term.showWeekend);
      save();
      render();
    });

    $('#s-theme').addEventListener('change', (e) => {
      state().term.theme = e.target.value;
      save();
    });

    $$('#s-times [data-time]').forEach((input) => {
      input.addEventListener('change', () => {
        const i = Number(input.dataset.index);
        const key = input.dataset.time;
        state().term.times[i] = state().term.times[i] || { s: '', e: '' };
        state().term.times[i][key] = input.value;
        save();
        renderHeader();
        renderGrid();
      });
    });

    dom.sheetBody.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (!act) return;
      const name = act.dataset.act;
      if (name === 'export') {
        const blob = new Blob([App.store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '课表备份.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('已导出备份文件');
      } else if (name === 'import') {
        dom.jsonInput.click();
      } else if (name === 'clear') {
        if (!window.confirm('清空所有课程？设置会保留。')) return;
        state().courses = [];
        save();
        closeSheet();
        render();
        toast('已清空课程');
      }
    });
  }

  /* ---------- PDF 导入 ---------- */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`无法加载 ${src}`));
      document.head.appendChild(s);
    });
  }

  let pdfReady = null;

  function ensurePdf() {
    if (pdfReady) return pdfReady;
    pdfReady = (async () => {
      if (!window.pdfjsLib) await loadScript('vendor/pdfjs/pdf.min.js');
      if (!window.pdfjsWorker) await loadScript('vendor/pdfjs/pdf.worker.min.js');
      if (!window.PdfCMaps) await loadScript('vendor/pdfjs/cmaps.js');

      // file:// 下 Web Worker 会被拦截，直接在主线程跑 worker 逻辑
      class EmbeddedCMapReaderFactory {
        fetch(params) {
          const data = window.PdfCMaps.get(params.name);
          if (!data) return Promise.reject(new Error(`缺少 CMap：${params.name}`));
          return Promise.resolve({ cMapData: data, compressionType: 1 });
        }
      }
      window.__CMapFactory = EmbeddedCMapReaderFactory;
      return window.pdfjsLib;
    })();
    return pdfReady;
  }

  async function readPdf(file) {
    const pdfjsLib = await ensurePdf();
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    }
    const buffer = await file.arrayBuffer();
    const task = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      CMapReaderFactory: window.__CMapFactory,
      cMapPacked: true,
      isEvalSupported: false
    });
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items = [];
      content.items.forEach((item) => {
        if (!item.str || !item.str.trim()) return;
        const tr = item.transform;
        items.push({
          text: item.str,
          x: tr[4],
          y: tr[5],
          width: item.width,
          size: Math.hypot(tr[2], tr[3])
        });
      });
      pages.push({ page: i, items });
    }
    return App.pdfParse.parsePages(pages);
  }

  function showPreview(result) {
    pendingImport = result;
    const term = state().term;
    const list = result.courses.map((c) => `
      <div class="preview-item" style="--c:${courseColor(c.name)}">
        <i></i>
        <div class="pv-main">
          <div class="pv-name">${esc(c.name)}</div>
          <div class="pv-sub">${App.DAY_NAMES[c.day - 1]} 第${c.start}${c.end > c.start ? '-' + c.end : ''}节 · ${esc(U.weeksLabel(c.weeks))}${c.place ? ' · ' + esc(c.place) : ''}</div>
        </div>
      </div>`).join('');

    openSheet(`
      <div class="sheet-grip"></div>
      <div class="sheet-body">
        <div class="sheet-title">识别到 ${result.courses.length} 门课</div>
        <div class="badge">最多到第 ${result.maxWeek} 周 · 每天 ${result.periodCount} 节</div>
        <div class="preview-list" style="margin-top:12px">${list}</div>
        <p class="note">导入后可再逐个点开修改；同名课程会自动使用同一种颜色。</p>
        <div class="sheet-actions" style="margin-top:14px">
          <button class="btn" data-act="cancel">取消</button>
          <button class="btn" data-act="append">追加</button>
          <button class="btn btn-primary" data-act="replace">替换</button>
        </div>
      </div>
    `);

    dom.sheetBody.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (!act) return;
      const name = act.dataset.act;
      if (name === 'cancel') { closeSheet(); return; }
      applyImport(name === 'replace' ? 'replace' : 'append');
    });
  }

  function applyImport(mode) {
    if (!pendingImport) return;
    const term = state().term;
    const parsed = pendingImport.courses;

    if (pendingImport.periodCount > term.periods) {
      term.periods = Math.min(16, pendingImport.periodCount);
      const times = [];
      for (let i = 0; i < term.periods; i += 1) times.push(term.times[i] || { s: '', e: '' });
      term.times = times;
    }
    if (pendingImport.maxWeek > term.weeks) term.weeks = Math.min(30, pendingImport.maxWeek);

    const made = parsed.map((p) => ({
      id: U.uid(),
      name: p.name,
      teacher: '',
      place: p.place || '',
      day: p.day,
      start: p.start,
      end: p.end,
      weeks: p.weeks && p.weeks.length ? p.weeks.slice() : U.weeksFromMode('all', 1, 1, term.weeks),
      color: courseColor(p.name),
      note: ''
    }));

    if (mode === 'replace') {
      state().courses = made;
    } else {
      const key = (c) => [c.day, c.start, c.end, c.name, c.weeks.join(',')].join('|');
      const exist = new Set(state().courses.map(key));
      made.forEach((c) => {
        if (!exist.has(key(c))) {
          exist.add(key(c));
          state().courses.push(c);
        }
      });
    }

    save();
    pendingImport = null;
    closeSheet();
    App.view.week = U.currentWeek();
    render();
    toast(mode === 'replace' ? `已载入 ${made.length} 门课` : '已添加到现有课表');
  }

  async function handleFile(file) {
    if (!file) return;
    toast('正在读取 PDF…', 8000);
    try {
      const result = await readPdf(file);
      if (!result.ok) {
        toast(result.reason || '没认出课表结构，可以手动添加课程', 4000);
        return;
      }
      if (!result.courses.length) {
        toast('没有解析到课程，可以手动添加', 3500);
        return;
      }
      showPreview(result);
    } catch (error) {
      console.error(error);
      toast(`解析失败：${error && error.message ? error.message : error}`, 4200);
    }
  }

  /* ---------- 周切换手势 ---------- */

  function bindSwipe() {
    let touch = null;

    dom.calBody.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) { touch = null; return; }
      touch = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        dx: 0,
        locked: false
      };
    }, { passive: true });

    dom.calBody.addEventListener('touchmove', (event) => {
      if (!touch) return;
      const dx = event.touches[0].clientX - touch.x;
      const dy = event.touches[0].clientY - touch.y;
      touch.dx = dx;
      if (!touch.locked && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        touch.locked = true;
      }
      if (touch.locked && event.cancelable) event.preventDefault();
    }, { passive: false });

    dom.calBody.addEventListener('touchend', () => {
      if (!touch) return;
      if (touch.locked && Math.abs(touch.dx) > 56) {
        lastSwipeTs = Date.now();
        setWeek(week() + (touch.dx < 0 ? 1 : -1));
      }
      touch = null;
    });

    let wheelTimer = null;
    dom.calBody.addEventListener('wheel', (event) => {
      if (Math.abs(event.deltaX) < Math.abs(event.deltaY) || Math.abs(event.deltaX) < 24) return;
      if (wheelTimer) return;
      wheelTimer = setTimeout(() => { wheelTimer = null; }, 320);
      setWeek(week() + (event.deltaX > 0 ? 1 : -1));
    }, { passive: true });
  }

  /* ---------- 事件绑定 ---------- */

  function bind() {
    dom.btnPrev.addEventListener('click', () => setWeek(week() - 1));
    dom.btnNext.addEventListener('click', () => setWeek(week() + 1));
    dom.btnToday.addEventListener('click', () => setWeek(U.currentWeek()));
    dom.btnSettings.addEventListener('click', openSettings);
    dom.btnImport.addEventListener('click', () => dom.pdfInput.click());
    dom.fab.addEventListener('click', () => openEditor(null));
    dom.scrim.addEventListener('click', closeSheet);

    dom.pdfInput.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      handleFile(file);
    });

    dom.jsonInput.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        App.store.importJSON(await file.text());
        closeSheet();
        App.view.week = U.currentWeek();
        render();
        toast('备份已导入');
      } catch (error) {
        toast('这个文件不是有效的课表备份');
      }
    });

    dom.empty.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'pdf') dom.pdfInput.click();
      if (act.dataset.act === 'manual') openEditor(null);
    });

    dom.cal.addEventListener('click', (event) => {
      if (Date.now() - lastSwipeTs < 280) return;
      const node = event.target.closest('.course');
      if (node) {
        openDetail(node.dataset.course);
        return;
      }
      const col = event.target.closest('.col');
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--period-h')) || 58;
      const period = U.clamp(Math.floor((event.clientY - rect.top) / h) + 1, 1, state().term.periods);
      openEditor(null, {
        day: Number(col.dataset.day),
        start: period,
        end: Math.min(period + 1, state().term.periods)
      });
    });

    document.addEventListener('keydown', (event) => {
      const tag = (event.target && event.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.key === 'Escape') closeSheet();
      if (event.key === 'ArrowLeft') setWeek(week() - 1);
      if (event.key === 'ArrowRight') setWeek(week() + 1);
    });

    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', applyTheme);
      else if (mq.addListener) mq.addListener(applyTheme);
    }

    bindSwipe();
  }

  /* ---------- 启动 ---------- */

  /* 首次打开时把 PDF 解析出来的课表预置进去，省得用户先导入一次 */
  function seedIfNeeded() {
    const seed = window.TIMETABLE_SEED;
    if (!seed || !Array.isArray(seed.courses) || !seed.courses.length) return;
    let decided = false;
    try {
      decided = localStorage.getItem(SEEDED_KEY) === '1';
    } catch (error) {
      decided = false;
    }
    if (decided) return;
    if (App.state.courses.length) {
      try { localStorage.setItem(SEEDED_KEY, '1'); } catch (error) { /* 忽略 */ }
      return;
    }
    App.state = App.store.importJSON(JSON.stringify({ version: 1, term: seed.term, courses: seed.courses }));
    App.state.courses.forEach((course) => {
      course.color = courseColor(course.name);
    });
    App.store.save();
    try { localStorage.setItem(SEEDED_KEY, '1'); } catch (error) { /* 忽略 */ }
    seededOnce = true;
  }

  function init() {
    dom.termTitle = $('#term-title');
    dom.termSub = $('#term-sub');
    dom.weekPill = $('#week-pill');
    dom.btnPrev = $('#btn-prev');
    dom.btnNext = $('#btn-next');
    dom.btnToday = $('#btn-today');
    dom.btnSettings = $('#btn-settings');
    dom.btnImport = $('#btn-import');
    dom.fab = $('#fab');
    dom.stage = $('#stage');
    dom.cal = $('#cal');
    dom.calBody = $('#cal-body');
    dom.empty = $('#empty');
    dom.sheet = $('#sheet');
    dom.sheetBody = $('#sheet-body');
    dom.scrim = $('#scrim');
    dom.toast = $('#toast');
    dom.pdfInput = $('#pdf-input');
    dom.jsonInput = $('#json-input');

    App.store.load();
    seedIfNeeded();
    App.view.week = U.currentWeek();

    bind();

    dom.calHead = $('#cal-head');
    dom.calGrid = $('#cal-grid');

    render();
    if (seededOnce) toast('已载入你的课表，左右滑动换周', 2600);
  }

  /* 调试/自动化测试入口（在控制台里也能用） */
  App.debug = {
    render,
    openEditor,
    openDetail,
    openSettings,
    showPreview,
    applyImport,
    setWeek,
    currentWeek: U.currentWeek
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
