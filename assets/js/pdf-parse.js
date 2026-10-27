/* 课表工具 · PDF 导入解析
 * 纯函数部分（parsePages）不依赖 DOM，可以在 Node 里直接测试。
 * 这份学校导出的 PDF 特征：每个格子内是若干“课程块”，格式为
 *   课程名（可能折行）
 *   (起-止节)周次/校区:xxx/场地:yyy   （可能折行）
 * 页面可能被旋转 90°，所以按“星期轴/行轴”自动判断方向。
 */
(function (root) {
  'use strict';

  const DAY_CHARS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

  const HEADER_RE = /^(?:星期|礼拜|周)\s*([一二三四五六日天])$/;
  const DETAIL_RE = /^[（(]\s*(\d{1,2})\s*[-–—－~～至]\s*(\d{1,2})\s*节\s*[）)]\s*(.*)$/;
  const DETAIL_PREFIX = /^[（(]\s*\d{1,2}\s*[-–—－~～至]\s*\d{1,2}\s*节/;
  const TIME_RE = /^\d{1,2}:\d{2}$/;

  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function compact(text) {
    return clean(text).replace(/\s+/g, '');
  }

  function median(list) {
    if (!list.length) return 0;
    const sorted = list.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /* 从“1-3周(单)/校区:东莞校区/场地:A4-3”里解析周次
   * 注意 (单)/(双) 只作用于它所在的那一段，例如 “4-6周(双),13周” */
  function parseWeeks(spec) {
    const raw = compact(spec || '');
    if (!raw) return [];
    const tokens = raw.replace(/第/g, '').split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean);
    const weeks = new Set();
    tokens.forEach((token) => {
      const odd = /单/.test(token);
      const even = /双/.test(token);
      const body = token.replace(/周/g, '').replace(/[单双]/g, '').replace(/[()（）]/g, '');
      const m = body.match(/^(\d{1,2})(?:\s*[-–—－~～至]\s*(\d{1,2}))?$/);
      if (!m) return;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) {
        if (i < 1 || i > 30) continue;
        if (odd && i % 2 === 0) continue;
        if (even && i % 2 === 1) continue;
        weeks.add(i);
      }
    });
    return Array.from(weeks).sort((a, b) => a - b);
  }

  /* 解析一条课程详情 */
  function parseDetail(text) {
    const m = String(text || '').match(DETAIL_RE);
    if (!m) return null;
    const start = Math.min(Number(m[1]), Number(m[2]));
    const end = Math.max(Number(m[1]), Number(m[2]));
    const rest = m[3] || '';
    let weeks = [];
    let place = '';
    let campus = '';
    rest.split('/').forEach((part) => {
      const piece = clean(part);
      if (!piece) return;
      if (/周/.test(piece)) {
        const found = parseWeeks(piece);
        if (found.length) weeks = found;
      } else if (/^(场地|地点|教室)[:：]/.test(piece)) {
        const value = clean(piece.replace(/^(场地|地点|教室)[:：]/, ''));
        place = /未排|待定|暂无/.test(value) ? '' : value;
      } else if (/^校区[:：]/.test(piece)) {
        campus = clean(piece.replace(/^校区[:：]/, ''));
      }
    });
    return { start, end, weeks, place, campus };
  }

  /* 识别星期表头，返回 { dayAxis, lineAxis, columns:[{day, center}] } */
  function detectColumns(items) {
    const headers = items
      .map((it) => {
        const m = HEADER_RE.exec(compact(it.text));
        if (!m) return null;
        return { day: DAY_CHARS[m[1]], x: it.x, y: it.y, width: it.width || 0 };
      })
      .filter(Boolean);

    if (headers.length < 3) return null;

    const xs = headers.map((h) => h.x);
    const ys = headers.map((h) => h.y);
    const spreadX = Math.max.apply(null, xs) - Math.min.apply(null, xs);
    const spreadY = Math.max.apply(null, ys) - Math.min.apply(null, ys);
    const dayAxis = spreadX >= spreadY ? 'x' : 'y';
    const lineAxis = dayAxis === 'x' ? 'y' : 'x';

    const seen = new Set();
    let columns = [];
    headers.forEach((h) => {
      if (seen.has(h.day)) return;
      seen.add(h.day);
      columns.push({ day: h.day, center: h[dayAxis] + h.width / 2 });
    });
    columns.sort((a, b) => a.center - b.center);
    if (columns.length < 5) return null;

    // 补全缺失的星期（用间隔推）
    const gaps = [];
    for (let i = 1; i < columns.length; i += 1) gaps.push(columns[i].center - columns[i - 1].center);
    const step = median(gaps) || 0;
    if (step > 0) {
      const full = [];
      for (let d = 1; d <= 7; d += 1) {
        const existing = columns.find((c) => c.day === d);
        if (existing) {
          full.push(existing);
        } else {
          const anchor = columns[0];
          full.push({ day: d, center: anchor.center + (d - anchor.day) * step, inferred: true });
        }
      }
      columns = full;
    }

    const bounds = columns.map((c, i) => {
      if (i === 0) return c.center - step / 2;
      return (columns[i - 1].center + c.center) / 2;
    });
    bounds.push(columns[columns.length - 1].center + step / 2);

    return { dayAxis, lineAxis, columns, bounds, step };
  }

  /* 把一页里的文字按列、按行整理 */
  function groupBlocks(items, layout) {
    const { dayAxis, lineAxis, bounds } = layout;
    const byDay = {};
    for (let d = 1; d <= 7; d += 1) byDay[d] = [];

    // 明显不是课程内容的文字（表头、页眉页脚、时间段等）
    const NOISE_RE = /^(学号|姓名|打印时间|时间段|节次|上午|下午|备注|说明)|课表$/;

    items.forEach((it) => {
      const text = compact(it.text);
      if (!text) return;
      if (HEADER_RE.test(text)) return;
      if (TIME_RE.test(text)) return;
      if (NOISE_RE.test(text)) return;
      const coord = it[dayAxis];
      let day = 0;
      for (let i = 0; i < 7; i += 1) {
        if (coord >= bounds[i] && coord < bounds[i + 1]) {
          day = i + 1;
          break;
        }
      }
      if (!day) return;
      byDay[day].push({
        page: it.page,
        line: it[lineAxis],
        day,
        text,
        size: it.size || 0
      });
    });

    const blocks = [];
    for (let day = 1; day <= 7; day += 1) {
      const list = byDay[day].sort((a, b) => (a.page - b.page) || (a.line - b.line));
      if (!list.length) continue;

      // 详情行的字号比课程名小，用它来区分“折行延续”和“下一门课的名字”
      const detailSizes = list
        .filter((e) => DETAIL_PREFIX.test(e.text))
        .map((e) => e.size)
        .filter((n) => n > 0);
      const detailSize = detailSizes.length ? median(detailSizes) : 0;

      const diffs = [];
      for (let i = 1; i < list.length; i += 1) {
        if (list[i].page !== list[i - 1].page) continue;
        const gap = list[i].line - list[i - 1].line;
        if (gap > 1 && gap < 40) diffs.push(gap);
      }
      const lineH = median(diffs) || 13;

      let pending = [];
      let pendingLast = null;
      let open = null;
      let lastName = '';

      // 课程名可能被拆成多行，分页时还会重复打印上半截
      const joinNames = () => {
        let out = '';
        pending.forEach((line) => {
          if (!out) out = line;
          else if (out.endsWith(line)) return;
          else if (line.startsWith(out) && line.length > out.length) out = line;
          else out += line;
        });
        return out;
      };

      const flush = () => {
        if (!open) return;
        const name = compact(open.name) || lastName;
        const parsed = parseDetail(open.detail);
        if (parsed && name) {
          blocks.push(Object.assign({ name, day, page: open.page }, parsed));
          lastName = name;
        }
        open = null;
      };

      list.forEach((entry) => {
        if (DETAIL_PREFIX.test(entry.text)) {
          flush();
          const name = joinNames();
          open = { name, detail: entry.text, page: entry.page };
          pending = [];
          pendingLast = null;
          return;
        }
        if (open && detailSize > 0 && entry.size > 0 && entry.size <= detailSize + 0.45) {
          open.detail += entry.text;
          return;
        }
        flush();
        // 同一页里隔得太远的“名字”多半是标题之类，丢掉
        if (pendingLast && pendingLast.page === entry.page && entry.line - pendingLast.line > lineH * 2.5) {
          pending = [];
        }
        pending.push(entry.text);
        pendingLast = { page: entry.page, line: entry.line };
      });
      flush();
    }

    return blocks;
  }

  /* 节次总数：时间列里的数字标签（1、2、3…） */
  function detectPeriodCount(items, layout) {
    const { dayAxis } = layout;
    const firstBound = layout.bounds[0];
    let maxLabel = 0;
    items.forEach((it) => {
      if (it[dayAxis] >= firstBound) return;
      const text = compact(it.text);
      if (!/^\d{1,2}$/.test(text)) return;
      const n = Number(text);
      if (n >= 1 && n <= 20 && n > maxLabel) maxLabel = n;
    });
    return maxLabel;
  }

  /* 合并同一门课被拆成多段的记录（周次并集） */
  function mergeBlocks(blocks) {
    const map = new Map();
    blocks.forEach((b) => {
      const name = compact(b.name);
      const place = compact(b.place);
      const key = [b.day, b.start, b.end, name, place, compact(b.campus)].join('|');
      const existing = map.get(key);
      if (existing) {
        existing.weeks = Array.from(new Set(existing.weeks.concat(b.weeks))).sort((x, y) => x - y);
      } else {
        map.set(key, {
          name,
          day: b.day,
          start: b.start,
          end: b.end,
          weeks: b.weeks.slice(),
          place,
          campus: compact(b.campus)
        });
      }
    });
    return Array.from(map.values());
  }

  /* 主入口：pages = [{page, items:[{text,x,y,width,size}]}] */
  function parsePages(pages) {
    const items = [];
    (pages || []).forEach((page) => {
      (page.items || []).forEach((it) => {
        const text = clean(it.text);
        if (!text) return;
        items.push({
          page: page.page,
          text,
          x: Number(it.x) || 0,
          y: Number(it.y) || 0,
          width: Number(it.width) || 0,
          size: Number(it.size) || 0
        });
      });
    });

    const out = {
      ok: false,
      reason: '',
      courses: [],
      periodCount: 0,
      maxWeek: 0,
      rawText: items.map((i) => i.text).join('\n'),
      stats: { items: items.length, blocks: 0 }
    };

    if (!items.length) {
      out.reason = '没有从 PDF 里读到文字，可能是扫描版（图片）PDF。';
      return out;
    }

    const layout = detectColumns(items);
    if (!layout) {
      out.reason = '没能识别出课表的星期列，可能不是标准的表格课表。';
      return out;
    }

    const blocks = groupBlocks(items, layout);
    out.stats.blocks = blocks.length;
    if (!blocks.length) {
      out.reason = '识别到了星期表头，但没有找到“(节次)周次/场地”格式的课程信息。';
      return out;
    }

    const courses = mergeBlocks(blocks);
    out.courses = courses;
    const allWeeks = [].concat.apply([], courses.map((c) => c.weeks));
    out.periodCount = Math.max(
      detectPeriodCount(items, layout) || 0,
      allWeeks.length || courses.length ? Math.max.apply(null, courses.map((c) => c.end)) : 0
    ) || 0;
    out.maxWeek = allWeeks.length ? Math.max.apply(null, allWeeks) : 0;
    out.ok = true;
    return out;
  }

  const api = {
    parsePages,
    parseWeeks,
    parseDetail,
    detectColumns,
    groupBlocks,
    detectPeriodCount,
    mergeBlocks,
    clean,
    compact
  };

  root.TimetablePdf = api;
  if (root.App) root.App.pdfParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
