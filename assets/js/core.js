/* 课表工具 · 基础层：日期、周次、存储、工具函数 */
(function () {
  'use strict';

  const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const DAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

  const COLORS = [
    '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
    '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6',
    '#f97316', '#64748b', '#3b82f6', '#84cc16'
  ];

  const DEFAULT_TIMES = [
    ['08:00', '08:40'], ['08:50', '09:30'],
    ['09:45', '10:25'], ['10:35', '11:15'],
    ['11:25', '12:05'], ['14:30', '15:10'],
    ['15:20', '16:00'], ['16:10', '16:50'],
    ['17:00', '17:40'], ['19:30', '20:10'],
    ['20:20', '21:00'], ['21:10', '21:50']
  ];

  const DEFAULT_START = '2026-09-07';
  const STORAGE_KEY = 'timetable.v1';

  /* ---------- 基础工具 ---------- */

  const pad2 = (n) => String(n).padStart(2, '0');

  function iso(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseDate(value) {
    const parts = String(value || '').split('-').map(Number);
    const y = parts[0] || 2026;
    const m = parts[1] || 1;
    const d = parts[2] || 1;
    return new Date(y, m - 1, d);
  }

  function addDays(date, n) {
    const x = new Date(date);
    x.setDate(x.getDate() + n);
    return x;
  }

  function dayNum(date) {
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  }

  function mondayOf(date) {
    const x = new Date(date);
    const shift = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - shift);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function fmtMD(date) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function fmtRange(start, end) {
    return `${fmtMD(start)} – ${fmtMD(end)}`;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function tint(hex, alpha) {
    const clean = String(hex || '#6366f1').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const num = parseInt(full, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  /* ---------- 学期 / 周次 ---------- */

  function termStart() {
    const state = App.state;
    const raw = state && state.term && state.term.startDate;
    return mondayOf(parseDate(raw || DEFAULT_START));
  }

  function totalWeeks() {
    return (App.state && App.state.term && App.state.term.weeks) || 20;
  }

  function weekOf(date) {
    const start = termStart();
    const target = mondayOf(date || new Date());
    return Math.floor((dayNum(target) - dayNum(start)) / 7) + 1;
  }

  function currentWeek() {
    return clamp(weekOf(new Date()), 1, totalWeeks());
  }

  function weekDates(week) {
    const start = addDays(termStart(), (week - 1) * 7);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  function dateOfDay(week, day) {
    return addDays(termStart(), (week - 1) * 7 + (day - 1));
  }

  function isToday(date) {
    const now = new Date();
    return date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
  }

  function todayDay() {
    const jsDay = new Date().getDay();
    return jsDay === 0 ? 7 : jsDay;
  }

  function termLabel() {
    const start = termStart();
    const year = start.getFullYear();
    const season = start.getMonth() + 1 >= 7 ? '秋季' : '春季';
    return `${year} ${season}学期`;
  }

  function periodTime(period) {
    const term = App.state && App.state.term;
    const list = (term && term.times) || [];
    const item = list[period - 1];
    if (!item) return { s: '', e: '' };
    return { s: item.s || '', e: item.e || '' };
  }

  function timeRangeLabel(start, end) {
    const a = periodTime(start);
    const b = periodTime(end);
    if (!a.s || !b.e) return '';
    return `${a.s} – ${b.e}`;
  }

  /* ---------- 周次显示 ---------- */

  function compressWeeks(weeks) {
    const list = Array.from(new Set(weeks.filter((n) => Number.isFinite(n)))).sort((a, b) => a - b);
    if (!list.length) return '';
    const runs = [];
    let begin = list[0];
    let prev = list[0];
    for (let i = 1; i < list.length; i += 1) {
      const n = list[i];
      if (n === prev + 1) {
        prev = n;
      } else {
        runs.push([begin, prev]);
        begin = n;
        prev = n;
      }
    }
    runs.push([begin, prev]);
    return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',');
  }

  function weeksLabel(weeks) {
    if (!weeks || !weeks.length) return '未设置周次';
    const list = Array.from(new Set(weeks)).sort((a, b) => a - b);
    const allOdd = list.every((n) => n % 2 === 1);
    const allEven = list.every((n) => n % 2 === 0);
    const text = compressWeeks(list);
    if (allOdd && allEven) return `第 ${text} 周`;
    if (allOdd && list.length > 1) return `第 ${text} 周(单)`;
    if (allEven && list.length > 1) return `第 ${text} 周(双)`;
    return `第 ${text} 周`;
  }

  function isEveryWeek(weeks) {
    const total = totalWeeks();
    if (!weeks || weeks.length !== total) return false;
    for (let i = 1; i <= total; i += 1) {
      if (!weeks.includes(i)) return false;
    }
    return true;
  }

  function weeksFromMode(mode, from, to) {
    const total = totalWeeks();
    const lo = clamp(Number(from) || 1, 1, total);
    const hi = clamp(Number(to) || total, 1, total);
    const a = Math.min(lo, hi);
    const b = Math.max(lo, hi);
    const out = [];
    if (mode === 'all') {
      for (let i = 1; i <= total; i += 1) out.push(i);
    } else if (mode === 'odd') {
      for (let i = a % 2 === 1 ? a : a + 1; i <= b; i += 2) out.push(i);
    } else if (mode === 'even') {
      for (let i = a % 2 === 0 ? a : a + 1; i <= b; i += 2) out.push(i);
    } else {
      for (let i = a; i <= b; i += 1) out.push(i);
    }
    return out;
  }

  function weeksMode(weeks) {
    if (isEveryWeek(weeks)) return 'all';
    const list = Array.from(new Set(weeks)).sort((a, b) => a - b);
    if (list.length > 1 && list.every((n) => n % 2 === 1) && list[list.length - 1] - list[0] === (list.length - 1) * 2) {
      return 'odd';
    }
    if (list.length > 1 && list.every((n) => n % 2 === 0) && list[list.length - 1] - list[0] === (list.length - 1) * 2) {
      return 'even';
    }
    const from = list[0] || 1;
    const to = list[list.length - 1] || totalWeeks();
    const range = [];
    for (let i = from; i <= to; i += 1) range.push(i);
    if (range.length === list.length) return 'range';
    return 'keep';
  }

  /* ---------- 数据存取 ---------- */

  function defaultTimes(periods) {
    const out = [];
    for (let i = 0; i < periods; i += 1) {
      const preset = DEFAULT_TIMES[i];
      out.push(preset ? { s: preset[0], e: preset[1] } : { s: '', e: '' });
    }
    return out;
  }

  function makeDefaults() {
    return {
      version: 1,
      term: {
        startDate: DEFAULT_START,
        weeks: 20,
        periods: 12,
        showWeekend: true,
        theme: 'auto',
        times: defaultTimes(12)
      },
      courses: []
    };
  }

  function normalizeCourse(raw) {
    const course = {
      id: raw && raw.id ? String(raw.id) : uid(),
      name: raw && raw.name ? String(raw.name).trim() : '未命名课程',
      teacher: raw && raw.teacher ? String(raw.teacher).trim() : '',
      place: raw && raw.place ? String(raw.place).trim() : '',
      day: clamp(Number(raw && raw.day) || 1, 1, 7),
      start: clamp(Number(raw && raw.start) || 1, 1, 16),
      end: clamp(Number(raw && raw.end) || 1, 1, 16),
      weeks: Array.isArray(raw && raw.weeks) ? raw.weeks.map(Number).filter((n) => n > 0) : [],
      color: raw && raw.color ? String(raw.color) : COLORS[0],
      note: raw && raw.note ? String(raw.note) : ''
    };
    if (course.end < course.start) course.end = course.start;
    course.weeks = Array.from(new Set(course.weeks)).sort((a, b) => a - b);
    return course;
  }

  function normalizeState(raw) {
    const base = makeDefaults();
    if (!raw || typeof raw !== 'object') return base;
    const term = Object.assign({}, base.term, raw.term || {});
    term.weeks = clamp(Number(term.weeks) || 20, 1, 30);
    term.periods = clamp(Number(term.periods) || 12, 1, 16);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(term.startDate || ''))) {
      term.startDate = DEFAULT_START;
    }
    const times = defaultTimes(term.periods);
    if (Array.isArray(raw.term && raw.term.times)) {
      raw.term.times.slice(0, term.periods).forEach((item, i) => {
        if (item && (item.s || item.e)) times[i] = { s: String(item.s || ''), e: String(item.e || '') };
      });
    }
    term.times = times;
    if (!['auto', 'light', 'dark'].includes(term.theme)) term.theme = 'auto';
    term.showWeekend = term.showWeekend !== false;

    const courses = Array.isArray(raw.courses) ? raw.courses.map(normalizeCourse) : [];
    courses.forEach((c) => {
      c.start = clamp(c.start, 1, term.periods);
      c.end = clamp(c.end, c.start, term.periods);
      // 周次允许超出 term.weeks（改小学期周数时不会把课程数据删掉）
      c.weeks = c.weeks.filter((w) => w >= 1 && w <= 30);
    });

    return { version: 1, term, courses };
  }

  const Store = {
    load() {
      let raw = null;
      try {
        raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      } catch (error) {
        raw = null;
      }
      const state = normalizeState(raw);
      App.state = state;
      return state;
    },
    save() {
      App.state = normalizeState(App.state);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state));
        return true;
      } catch (error) {
        if (window.App && App.toast) App.toast('保存失败：浏览器存储空间不足或被禁用');
        return false;
      }
    },
    reset() {
      App.state = makeDefaults();
      Store.save();
      return App.state;
    },
    exportJSON() {
      return JSON.stringify(App.state, null, 2);
    },
    importJSON(text) {
      const data = JSON.parse(text);
      App.state = normalizeState(data);
      Store.save();
      return App.state;
    }
  };

  /* ---------- 冲突检测 ---------- */

  function overlapCourses(course, list) {
    const weekSet = new Set(course.weeks);
    return (list || App.state.courses).filter((other) => {
      if (other.id === course.id) return false;
      if (other.day !== course.day) return false;
      if (other.end < course.start || other.start > course.end) return false;
      return other.weeks.some((w) => weekSet.has(w));
    });
  }

  /* ---------- 导出到全局 ---------- */

  const App = window.App || (window.App = {});
  App.state = null;
  App.view = { week: 1 };
  App.DAY_NAMES = DAY_NAMES;
  App.DAY_SHORT = DAY_SHORT;
  App.COLORS = COLORS;
  App.DEFAULT_START = DEFAULT_START;
  App.util = {
    pad2, iso, parseDate, addDays, dayNum, mondayOf, fmtMD, fmtRange,
    clamp, uid, esc, tint, debounce,
    termStart, totalWeeks, weekOf, currentWeek, weekDates, dateOfDay,
    isToday, todayDay, termLabel, periodTime, timeRangeLabel,
    weeksLabel, weeksFromMode, weeksMode, isEveryWeek, compressWeeks,
    overlapCourses
  };
  App.store = Store;
  App.storageKey = STORAGE_KEY;
})();
