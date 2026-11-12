(() => {
  const app = document.getElementById("app");
  const LS = "dict:v1", LS_SPEED = "dict:speed", LS_VOL = "dict:volume";

  /* ---------- tiến độ (localStorage), khoá = "<chủ đề>/<bài>" ---------- */
  let prog = {};
  try { prog = JSON.parse(localStorage.getItem(LS)) || {}; } catch {}
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(prog)); } catch {} };
  const P = (topic, id) => {
    const k = `${topic}/${id}`;
    if (!prog[k] && topic === "short-stories" && prog[id]) { prog[k] = prog[id]; delete prog[id]; } // tiến độ bản cũ
    return prog[k] || (prog[k] = { pos: 0, res: {} });
  };
  const nDone = (topic, id) => Object.keys((prog[`${topic}/${id}`] || (topic === "short-stories" && prog[id]) || { res: {} }).res).length;
  let speed = 1;
  try { speed = parseFloat(localStorage.getItem(LS_SPEED)) || 1; } catch {}
  let volume = 1;
  try {
    const v = parseFloat(localStorage.getItem(LS_VOL));
    if (Number.isFinite(v)) volume = Math.min(1, Math.max(0, v));
  } catch {}

  /* ---------- nhật ký Google Sheet (laptop và điện thoại dùng chung) ---------- */
  const LOG_CFG = "dict:log:cfg", LOG_QUEUE = "dict:log:queue", LOG_SUM = "dict:log:summary";
  let studySummary = {};
  try { studySummary = JSON.parse(localStorage.getItem(LOG_SUM) || "{}"); } catch {}
  let logBusy = false;

  function logCfg() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LOG_CFG) || "null"); } catch {}
    const file = window.STUDY_LOG || {};
    const src = saved && saved.url ? saved : file;
    return {
      url: String(src.url || "").trim().replace(/\/+$/, "").replace(/\?.*$/, ""),
      token: String(src.token || "").trim()
    };
  }
  function saveLogCfg(url, token) {
    localStorage.setItem(LOG_CFG, JSON.stringify({ url: url.trim(), token: token.trim() }));
  }
  function clearLogCfg() { localStorage.removeItem(LOG_CFG); }
  function studyTimes(topic, id) { return studySummary[`${topic}/${id}`] || null; }
  function rememberSummary(lessons) {
    studySummary = lessons || {};
    try { localStorage.setItem(LOG_SUM, JSON.stringify(studySummary)); } catch {}
  }
  function eventId() {
    try {
      const a = new Uint8Array(8);
      crypto.getRandomValues(a);
      return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch { return Math.random().toString(16).slice(2, 18); }
  }
  function readQueue() {
    try { return JSON.parse(localStorage.getItem(LOG_QUEUE) || "[]"); } catch { return []; }
  }
  function writeQueue(q) {
    try { localStorage.setItem(LOG_QUEUE, JSON.stringify(q.slice(-200))); } catch {}
  }
  function callSheet(params) {
    const cfg = logCfg();
    if (!cfg.url || !cfg.token) return Promise.reject(new Error("Chưa gắn Google Sheet"));
    const cb = "dictLog_" + eventId();
    return new Promise((resolve, reject) => {
      let settled = false;
      const s = document.createElement("script");
      const done = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        delete window[cb];
        s.remove();
        fn();
      };
      const timer = setTimeout(() => done(() => reject(new Error("Google Sheet không trả lời"))), 12000);
      window[cb] = (data) => done(() => resolve(data || {}));
      s.onerror = () => done(() => reject(new Error("Không gọi được Google Sheet")));
      const q = new URLSearchParams({ ...params, token: cfg.token, callback: cb });
      s.src = cfg.url + "?" + q.toString();
      document.head.appendChild(s);
    });
  }
  function flushLog() {
    const cfg = logCfg();
    if (!cfg.url || !cfg.token || logBusy) return Promise.resolve();
    const q = readQueue();
    if (!q.length) return Promise.resolve();
    logBusy = true;
    const row = q[0];
    return callSheet({
      action: "log", event_id: row.event_id, topic: row.topic, lesson: row.lesson,
      title: row.title, event: row.event, ok: row.ok ?? "", bad: row.bad ?? "",
      skip: row.skip ?? "", total: row.total ?? ""
    }).then((data) => {
      logBusy = false;
      if (data && data.ok === false) {
        writeQueue(readQueue().filter((x) => x.event_id !== row.event_id));
        throw new Error(data.error || "Sheet từ chối");
      }
      writeQueue(readQueue().filter((x) => x.event_id !== row.event_id));
      if (data && row.topic && row.lesson) {
        const k = `${row.topic}/${row.lesson}`;
        const prev = studySummary[k] || {};
        studySummary[k] = { ...prev, open: data.open ?? prev.open, done: data.done ?? prev.done, title: row.title };
        rememberSummary(studySummary);
      }
      if (readQueue().length) flushLog().catch(() => {});
      return data;
    }).catch((err) => { logBusy = false; throw err; });
  }
  function logStudy(row) {
    const item = { event_id: eventId(), ...row };
    writeQueue(readQueue().concat(item));
    return flushLog();
  }
  function refreshSummary() {
    return callSheet({ action: "summary" }).then((data) => {
      if (!data || data.ok === false) throw new Error((data && data.error) || "Không đọc được nhật ký");
      rememberSummary(data.lessons || {});
      return studySummary;
    });
  }

  /* ---------- tiện ích ---------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  window.DICT = window.DICT || {};
  const cache = {};
  // Nạp dữ liệu bằng <script> (data/<khoá>.js) thay vì fetch, để mở thẳng index.html (file://) vẫn chạy.
  // Tra DICT không phân biệt hoa/thường (khoá trong data/*.js có thể lệch hoa/thường so với đường dẫn)
  const findDict = (key) => {
    if (DICT[key]) return DICT[key];
    const k = Object.keys(DICT).find((x) => x.toLowerCase() === key.toLowerCase());
    return k ? DICT[k] : undefined;
  };
  const getData = (key) => {
    if (!cache[key]) {
      cache[key] = new Promise((res, rej) => {
        if (findDict(key)) return res(findDict(key));
        const sc = document.createElement("script");
        sc.src = `data/${key}.js`;
        sc.onload = () => (findDict(key) ? res(findDict(key)) : rej(new Error(`${sc.getAttribute("src")}: dữ liệu rỗng`)));
        sc.onerror = () => { delete cache[key]; rej(new Error(`không tải được ${sc.getAttribute("src")}`)); };
        document.head.appendChild(sc);
      });
    }
    return cache[key];
  };
  const starSvg = (done) =>
    `<svg class="star ${done ? "done" : "todo"}" viewBox="0 0 24 24" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2 6.3 20.3l1.2-6.4L2.8 9.5l6.4-.8z"/></svg>`;
  const initials = (t) => t.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  let cleanup = () => {};

  /* ---------- router: #/  |  #/log  |  #/t/<chủ đề>  |  #/t/<chủ đề>/<bài>[/<câu>] ---------- */
  async function route() {
    cleanup(); cleanup = () => {};
    const h = location.hash;
    const lm = h.match(/^#\/t\/([\w-]+)\/([\w-]+)(?:\/(\d+))?/);
    const tm = h.match(/^#\/t\/([\w-]+)\/?$/);
    try {
      if (h === "#/log") await showLog();
      else if (lm) await showLesson(lm[1], lm[2], lm[3] ? parseInt(lm[3], 10) - 1 : null);
      else if (tm) await showTopic(tm[1]);
      else await showHome();
    } catch (e) {
      app.innerHTML = `<div class="error">Không tải được dữ liệu: ${esc(e.message)}</div>`;
    }
  }
  addEventListener("hashchange", route);
  route();
  flushLog().catch(() => {});

  /* ================= Nhật ký: bài nào, bao nhiêu lần ================= */
  async function showLog() {
    document.title = "Nhật ký – Nghe chép";
    const cfg = logCfg();
    let alive = true;
    cleanup = () => { alive = false; };
    const paint = (note) => {
      if (!alive) return;
      const rows = Object.values(studySummary).sort((a, b) => String(b.last || "").localeCompare(String(a.last || "")));
      const c = logCfg();
      app.innerHTML = `
        <nav class="crumbs"><a href="#/">Tất cả chủ đề</a></nav>
        <h1 class="page">Nhật ký học</h1>
        <div class="logbox">
          <p class="muted">Mỗi lần mở một bài ghi một dòng «mở». Học đến hết bài ghi thêm một dòng «xong», kèm số câu đúng. Laptop và điện thoại gửi vào cùng một Google Sheet.</p>
          <ol class="steps">
            <li>Tạo một Google Sheet trống, chỉ để chứa nhật ký này.</li>
            <li>Extensions → Apps Script, xóa code cũ, dán file <code>tools/study-log.gs</code>. Đổi <code>TOKEN</code> thành một mật khẩu riêng (không dùng mật khẩu Google).</li>
            <li>Deploy → New deployment → Web app. Execute as: <b>Me</b>. Who has access: <b>Anyone</b>. Copy URL kết thúc bằng <code>/exec</code>.</li>
            <li>Dán URL và mật khẩu vào form dưới. Trên điện thoại mở cùng trang này và dán lại, hoặc điền vào <code>web/study-log-config.js</code> rồi đưa thư mục web lên mạng để hai máy dùng chung.</li>
          </ol>
          <form id="logform">
            <label>URL Web app<input id="logurl" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.url)}" required></label>
            <label>Mật khẩu TOKEN<input id="logtoken" type="text" autocomplete="off" value="${esc(c.token)}" required></label>
            <div class="actions">
              <button class="btn primary" type="submit">Lưu và thử</button>
              <button class="btn" type="button" id="logclear">Xóa trên máy này</button>
            </div>
          </form>
          <p id="lognote" class="muted">${esc(note || (c.url ? "Đang đọc sheet…" : "Chưa gắn sheet."))}</p>
          ${rows.length ? `<table class="logtable"><thead><tr><th>Bài</th><th>Mở</th><th>Xong</th><th>Gần nhất</th></tr></thead><tbody>
            ${rows.map((r) => `<tr><td>${esc(r.title || r.lesson)}<div class="muted">${esc(r.topic || "")}</div></td><td class="num">${r.open || 0}</td><td class="num">${r.done || 0}</td><td class="num">${esc(r.last || "")}</td></tr>`).join("")}
          </tbody></table>` : ""}
        </div>`;
      app.querySelector("#logform").onsubmit = (e) => {
        e.preventDefault();
        saveLogCfg(app.querySelector("#logurl").value, app.querySelector("#logtoken").value);
        paint("Đang thử kết nối…");
        refreshSummary().then(() => { if (alive) paint("Đã nối Google Sheet."); }).catch((err) => { if (alive) paint(err.message); });
      };
      app.querySelector("#logclear").onclick = () => { clearLogCfg(); paint("Đã xóa địa chỉ lưu trên máy này."); };
    };
    paint(cfg.url ? "Đang đọc sheet…" : "Chưa gắn sheet.");
    if (cfg.url && cfg.token) {
      refreshSummary().then(() => { if (alive) paint("Đã nối Google Sheet."); }).catch((err) => { if (alive) paint(err.message); });
    }
  }

  /* ================= Cấp 1: danh sách chủ đề ================= */
  async function showHome() {
    document.title = "Nghe chép";
    const topics = await getData("topics");
    const lists = await Promise.all(topics.map((t) => (t.lessons ? getData(`${t.id}/lessons`) : [])));
    app.innerHTML = `<h1 class="page">Tất cả chủ đề</h1><div class="tgrid">${topics.map((t, i) => {
      const L = lists[i];
      const done = L.filter((l) => nDone(t.id, l.id) >= l.parts).length;
      const pct = L.length ? Math.round((100 * done) / L.length) : 0;
      return `<a class="tcard ${t.lessons ? "" : "empty"}" href="#/t/${t.id}">
        <span class="ticon c${i % 5}" aria-hidden="true">${esc(initials(t.title))}</span>
        <span class="tbody">
          <span class="ttitle">${esc(t.title)}</span>
          <span class="tmeta">${t.levels ? `Trình độ ${esc(t.levels)}` : "Chưa có bài"}</span>
          <span class="tmeta">${t.lessons} bài, ${t.groups.filter((g) => g.count).length} nhóm${t.lessons ? `, xong ${done}` : ""}</span>
          ${t.lessons ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ""}
        </span></a>`;
    }).join("")}</div>`;
  }

  /* ================= Cấp 2: nhóm và các bài trong một chủ đề ================= */
  const listState = {};

  async function showTopic(topic) {
    const topics = await getData("topics");
    const tinfo = topics.find((t) => t.id === topic);
    if (!tinfo) throw new Error(`không có chủ đề ${topic}`);
    document.title = `${tinfo.title} – Nghe chép`;
    const lessons = tinfo.lessons ? await getData(`${topic}/lessons`) : [];
    const st = listState[topic] || (listState[topic] = { q: "", level: "", status: "" });
    const levels = [...new Set(lessons.map((l) => l.level).filter(Boolean))].sort();
    const groups = tinfo.groups.filter((g) => g.count);
    app.innerHTML = `
      <nav class="crumbs"><a href="#/">Tất cả chủ đề</a></nav>
      <h1 class="page">${esc(tinfo.title)}</h1>
      <div class="toolbar">
        <input id="q" type="search" placeholder="Tìm bài" aria-label="Tìm bài" value="${esc(st.q)}">
        <select id="lv" aria-label="Trình độ"><option value="">Mọi trình độ</option>${levels.map((l) => `<option ${l === st.level ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <select id="st" aria-label="Trạng thái">
          <option value="">Tất cả</option>
          <option value="todo" ${st.status === "todo" ? "selected" : ""}>Chưa làm</option>
          <option value="doing" ${st.status === "doing" ? "selected" : ""}>Đang làm</option>
          <option value="done" ${st.status === "done" ? "selected" : ""}>Đã xong</option>
        </select>
      </div>
      <div id="groups"></div>`;
    const $g = app.querySelector("#groups");
    const openState = {};
    $g.addEventListener("toggle", (e) => { if (e.target.dataset.g !== undefined) openState[e.target.dataset.g] = e.target.open; }, true);
    const render = () => {
      const q = st.q.trim().toLowerCase();
      const items = lessons.map((l) => {
        const n = nDone(topic, l.id);
        const times = studyTimes(topic, l.id);
        return { ...l, n, times, st: n === 0 ? "todo" : n >= l.parts ? "done" : "doing" };
      }).filter((l) =>
        (!q || l.title.toLowerCase().includes(q)) && (!st.level || l.level === st.level) && (!st.status || l.st === st.status));
      const sections = groups.map((g) => ({ g, items: items.filter((l) => l.group === g.title) })).filter((s) => s.items.length);
      $g.innerHTML = sections.length ? sections.map(({ g, items: its }, k) => {
        const done = its.filter((x) => x.st === "done").length;
        const all = lessons.filter((l) => l.group === g.title);
        const open = openState[g.title] ?? (groups.length <= 3 || k === 0 || its.some((x) => x.st === "doing") || !!q);
        return `<details class="section" data-g="${esc(g.title)}" ${open ? "open" : ""}>
          <summary>${esc(g.title)} <span class="count">${done}/${all.length} bài đã xong</span></summary>
          <div class="grid">${its.map((l) => `
            <a class="card" href="#/t/${topic}/${l.id}">
              <h3>${starSvg(l.st === "done")}<span>${l.no}. ${esc(l.title)}</span></h3>
              <div class="meta"><span>${l.parts} câu</span>${l.level ? `<span class="lvl">${esc(l.level)}</span>` : ""}${l.times && l.times.open ? `<span>Đã học ${l.times.open} lần</span>` : ""}</div>
              ${l.n ? `<div class="bar"><i style="width:${Math.min(100, Math.round((100 * l.n) / l.parts))}%"></i></div>` : ""}
            </a>`).join("")}</div></details>`;
      }).join("") : `<p class="empty">${lessons.length ? "Không có bài nào khớp bộ lọc." : "Chủ đề này chưa có bài nào."}</p>`;
    };
    app.querySelector("#q").addEventListener("input", (e) => { st.q = e.target.value; render(); });
    app.querySelector("#lv").addEventListener("change", (e) => { st.level = e.target.value; render(); });
    app.querySelector("#st").addEventListener("change", (e) => { st.status = e.target.value; render(); });
    render();
    let topicAlive = true;
    cleanup = () => { topicAlive = false; };
    if (logCfg().url) refreshSummary().then(() => { if (topicAlive) render(); }).catch(() => {});
  }

  /* ---------- so khớp từ ---------- */
  // Hoa/thường không tính. Nhãn người nói (Man:, Woman:, Ann:) không đưa vào so sánh.
  const norm = (w) => w.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9']/g, "");
  const touchUi = () => window.matchMedia("(hover: none), (pointer: coarse)").matches;

  function speakerBits(raw) {
    const m = /^([A-Za-z][A-Za-z'.-]{1,40}:)(.*)$/.exec(raw);
    if (!m || /\d/.test(m[1])) return [{ text: raw, skip: false }];
    const out = [{ text: m[1], skip: true }];
    const rest = m[2].trim();
    if (rest) out.push({ text: rest, skip: false });
    return out;
  }
  function expandWords(raw, keepLabels) {
    const out = [];
    for (const w of raw.split(/\s+/).filter(Boolean)) {
      for (const p of speakerBits(w)) {
        if (p.skip && !keepLabels) continue;
        out.push(p);
      }
    }
    return out;
  }

  function diff(text, typed) {
    const orig = expandWords(text, true);
    const typedWords = expandWords(typed, false).map((w) => w.text);
    const scored = [];
    orig.forEach((w, k) => { if (!w.skip) scored.push(k); });
    const a = scored.map((k) => norm(orig[k].text));
    const rawTyped = typedWords;
    const b = rawTyped.map(norm);
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] && a[i] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const scoredHit = new Array(a.length).fill(false);
    const used = new Array(b.length).fill(false);
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j] && a[i]) { scoredHit[i] = used[j] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const hit = orig.map((w, k) => w.skip || scoredHit[scored.indexOf(k)]);
    const extra = rawTyped.filter((_, k) => !used[k] && b[k]);
    const scoredOk = scored.every((k) => hit[k]);
    return { orig, hit, extra, perfect: scoredOk && extra.length === 0 };
  }

  /* ================= Cấp 3: bài nghe ================= */
  async function showLesson(topic, id, startIdx) {
    const [topics, lessons] = await Promise.all([getData("topics"), getData(`${topic}/lessons`)]);
    const tinfo = topics.find((t) => t.id.toLowerCase() === topic.toLowerCase());
    const li = lessons.findIndex((l) => l.id === id);
    if (li < 0) throw new Error(`không có bài ${topic}/${id}`);
    const meta = lessons[li];
    const nextLesson = lessons[li + 1];
    // dữ liệu bài nằm ở data/<chủ đề>/<trình độ>/<id>.*  (meta.dir = thư mục trình độ, có thể rỗng)
    const base = meta.dir ? `${topic}/${meta.dir}/${id}` : `${topic}/${id}`;
    const sents = await getData(base);
    const pr = P(topic, id);
    let i = Math.min(startIdx ?? pr.pos ?? 0, sents.length - 1);
    let checked = false, tab = "dict", raf = 0;
    // phát liên tục ở tab "Toàn bộ transcript"
    let contState = "idle";      // idle | play | pause
    let from = 0, cur = -1;      // from: câu sẽ phát khi bấm Phát; cur: câu đang được tô sáng
    let loopAll = false, autoScroll = true;
    const audio = new Audio(`data/${base}.mp3`);
    audio.preload = "auto";
    audio.volume = volume;
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("ended", () => setPlaying(false));
    document.title = `${meta.title} – ${tinfo.title} – Nghe chép`;

    app.innerHTML = `
      <nav class="crumbs"><a href="#/">Tất cả chủ đề</a> <span aria-hidden="true">/</span>
        <a href="#/t/${topic}">${esc(tinfo.title)}</a> <span aria-hidden="true">/</span> <span>${esc(meta.group)}</span></nav>
      <header class="lhead"><h1>${meta.no}. ${esc(meta.title)}</h1>${meta.level ? `<span class="lvl">${esc(meta.level)}</span>` : ""}<span class="muted" id="study-count"></span></header>
      <div class="segbar" id="bar" role="group" aria-label="Các câu trong bài"></div>
      <div class="legend"><span class="l-ok">Đúng</span><span class="l-bad">Chưa đúng</span><span class="l-skip">Bỏ qua</span></div>
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="dict" aria-selected="true">Chép chính tả</button>
        <button role="tab" data-tab="full" aria-selected="false">Toàn bộ transcript</button>
      </div>
      <section class="pane" id="pane"></section>`;
    const $bar = app.querySelector("#bar"), $pane = app.querySelector("#pane");

    function renderBar() {
      $bar.innerHTML = sents.map((s, k) => {
        const r = pr.res[s.id] || "";
        return `<button style="flex:${(s.end - s.start).toFixed(2)}" class="${r} ${k === i ? "cur" : ""}" data-k="${k}" aria-label="Câu ${k + 1}" aria-current="${k === i}"></button>`;
      }).join("");
    }
    $bar.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-k]");
      if (b) { tab = "dict"; goto(+b.dataset.k, true); }
    });

    // LEAD: phát sớm hơn đầu câu một chút (iOS khởi động âm thanh chậm + seek mp3 không chính xác tuyệt đối)
    // TAIL: phát muộn hơn cuối câu một chút để không cụt âm cuối.
    // Cả hai bị chặn ở end của câu trước / start của câu sau, để không nghe lẫn câu bên cạnh
    // (giữ tối thiểu MIN_LEAD cho iOS). review/<chủ đề>/<id>.html phát đúng theo cùng quy tắc này.
    const LEAD = 0.18, TAIL = 0.08, MIN_LEAD = 0.03;
    function playWin(k) {
      const s = sents[k], pe = k > 0 ? sents[k - 1].end : 0, ns = k < sents.length - 1 ? sents[k + 1].start : Infinity;
      const lead = Math.min(LEAD, Math.max(MIN_LEAD, s.start - pe)), tail = Math.min(TAIL, Math.max(0, ns - s.end));
      return [Math.max(0, s.start - lead), s.end + tail];
    }
    let playTok = 0;             // mỗi lần phát/dừng tăng 1, để callback của lần cũ tự bỏ qua
    let seg = null;              // {tok, t0, t1} khi đang phát một câu
    let endTimer = 0;
    let resumeRatio = null;      // tua trong câu rồi mới bấm nghe

    function fmtTime(sec) {
      const s = Math.max(0, Math.round(Number(sec) || 0));
      return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }
    function paintTime(elapsed, total) {
      const el = document.getElementById("ptime");
      if (el) el.textContent = fmtTime(elapsed) + " / " + fmtTime(total);
      const sk = document.getElementById("seek");
      if (!sk || document.activeElement === sk || !(total > 0)) return;
      sk.value = String(Math.max(0, Math.min(1000, Math.round(1000 * Math.max(0, elapsed) / total))));
    }
    function setSpeed(v) {
      speed = v;
      try { localStorage.setItem(LS_SPEED, String(speed)); } catch {}
      audio.playbackRate = speed;
      armEnd();
    }
    function setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      audio.volume = volume;
      try { localStorage.setItem(LS_VOL, String(volume)); } catch {}
    }
    function volControl() {
      return `<label>Âm lượng <span class="voln">${Math.round(volume * 100)}</span>%
        <input class="vol" type="range" min="0" max="100" step="1" value="${Math.round(volume * 100)}" aria-label="Âm lượng"></label>`;
    }
    function bindVolume(root) {
      const input = root.querySelector("input.vol");
      if (!input) return;
      input.addEventListener("input", () => {
        setVolume(input.value / 100);
        const n = input.parentElement.querySelector(".voln");
        if (n) n.textContent = String(Math.round(volume * 100));
      });
    }
    function armEnd() {
      clearTimeout(endTimer);
      if (!seg || seg.tok !== playTok) return;
      const tok = seg.tok;
      const total = seg.t1 - seg.t0;
      const now = audio.currentTime;
      const at = now >= seg.t0 - 0.05 && now <= seg.t1 + 0.05 ? now : seg.t0;
      const left = Math.max(0, seg.t1 - at);
      const ms = Math.max(80, (left / (audio.playbackRate || 1)) * 1000 + 150);
      endTimer = setTimeout(() => { if (tok === playTok) finishSeg(total); }, ms);
    }
    function finishSeg(total) {
      seg = null;
      playTok++;
      clearTimeout(endTimer);
      cancelAnimationFrame(raf);
      audio.pause();
      setPlaying(false);
      paintTime(total, total);
    }
    // requestAnimationFrame dừng khi mất focus, audio thì vẫn chạy — kẹp cuối câu bằng timeupdate + hẹn giờ
    audio.addEventListener("timeupdate", () => {
      if (!seg || seg.tok !== playTok || !seg.ready) return;
      const total = seg.t1 - seg.t0;
      const t = audio.currentTime;
      if (t + 0.02 < seg.t0) return;
      // lệch xa khỏi câu (seek chưa ăn) thì để vòng thử lại xử lý, không cắt nhầm
      if (t >= seg.t1 && t < seg.t1 + 0.35) finishSeg(total);
      else if (t < seg.t1) paintTime(t - seg.t0, total);
    });

    function stop() {
      playTok++; seg = null; clearTimeout(endTimer);
      cancelAnimationFrame(raf); audio.pause(); setPlaying(false); contState = "idle"; syncCont();
    }
    // Rời trang / sang cửa sổ khác thì dừng, kẻo file mp3 cả bài chạy tiếp sang các câu sau
    function pauseForBlur() {
      const segmentLive = !!(seg && seg.tok === playTok);
      const contLive = contState === "play";
      if (!segmentLive && !contLive) return;
      clearTimeout(endTimer);
      cancelAnimationFrame(raf);
      if (segmentLive) { seg = null; playTok++; }
      audio.pause();
      setPlaying(false);
      if (contLive) { contState = "pause"; syncCont(); }
    }
    function setPlaying(v) {
      const b = document.getElementById("play");
      if (b) b.textContent = v ? "Đang phát" : "Nghe lại";
    }
    function playSeg(k) {
      if (touchUi()) { const el = document.activeElement; if (el && el.id === "ans") el.blur(); }
      const ratio = resumeRatio;
      resumeRatio = null;
      stop();
      const tok = ++playTok;
      if (tab === "full") { from = k; markCur(k); }
      const [t0, t1] = playWin(k);
      const startAt = ratio == null ? t0 : Math.min(t1, Math.max(t0, t0 + (t1 - t0) * ratio));
      seg = { tok, t0, t1 };
      audio.playbackRate = speed;
      audio.volume = volume;
      let started = false, tries = 0;
      const seek = () => { try { audio.currentTime = startAt; } catch {} };
      // iOS: chưa có metadata thì currentTime bị bỏ qua và audio phát từ đầu file -> đợi metadata rồi seek lại
      if (audio.readyState >= 1) seek();
      else audio.addEventListener("loadedmetadata", () => { if (tok === playTok) seek(); }, { once: true });
      audio.addEventListener("playing", () => {
        if (tok !== playTok) return;
        started = true;
        if (seg && seg.tok === tok) seg.ready = true;
        armEnd();
      }, { once: true });
      audio.play().then(() => { if (tok === playTok) setPlaying(true); })
        .catch(() => { if (tok === playTok) { playTok++; seg = null; clearTimeout(endTimer); cancelAnimationFrame(raf); setPlaying(false); } });
      const tick = () => {
        if (tok !== playTok) return;
        const t = audio.currentTime;
        if (started && !audio.seeking && (t < t0 - 0.3 || t > t1 + 0.3)) {
          // seek không trúng (hay gặp trên iOS) -> thử lại tối đa 3 lần
          if (tries++ < 3) { seek(); raf = requestAnimationFrame(tick); return; }
          finishSeg(t1 - t0); return;
        }
        if (started && (t >= t1 || audio.ended)) { finishSeg(t1 - t0); return; }
        if (started) paintTime(t - t0, t1 - t0);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    function goto(k, autoplay) {
      i = Math.max(0, Math.min(sents.length - 1, k));
      pr.pos = i; save(); checked = false;
      renderAll();
      if (autoplay && tab === "dict") playSeg(i);
    }

    function setResult(sentence, r) {
      const prev = pr.res[sentence.id];
      if (r === "skip" && prev) return;
      if (r === "bad" && prev === "ok") return;
      pr.res[sentence.id] = r; save();
    }

    function renderDict() {
      const s = sents[i];
      $pane.innerHTML = `
        <div class="stepper">
          <button class="btn icon" id="prev" aria-label="Câu trước" ${i === 0 ? "disabled" : ""}>←</button>
          <b>${i + 1} / ${sents.length}</b>
          <button class="btn icon" id="nextArrow" aria-label="Câu sau" ${i === sents.length - 1 ? "disabled" : ""}>→</button>
          <button class="btn" id="restart" type="button">Từ đầu</button>
        </div>
        <div class="player">
          <button class="btn" id="play">Nghe</button>
          <span class="time" id="ptime">0:00 / 0:00</span>
          <input class="seek" id="seek" type="range" min="0" max="1000" value="0" aria-label="Vị trí trong câu">
          ${volControl()}
          <label>Tốc độ
            <select id="speed">${[0.5, 0.75, 1, 1.25].map((v) => `<option value="${v}" ${v === speed ? "selected" : ""}>${v}x</option>`).join("")}</select>
          </label>
        </div>
        <textarea id="ans" rows="3" placeholder="Gõ những gì bạn nghe được" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off"></textarea>
        <div class="actions">
          <button class="btn primary" id="check">Kiểm tra</button>
          <button class="btn" id="skip">Bỏ qua</button>
          <span class="hint">Enter: kiểm tra / câu tiếp. Ctrl+Space: nghe lại</span>
        </div>
        <div id="result" aria-live="polite"></div>`;
      const $ans = $pane.querySelector("#ans");
      const [win0, win1] = playWin(i);
      paintTime(0, win1 - win0);
      $pane.querySelector("#play").onclick = () => playSeg(i);
      $pane.querySelector("#restart").onclick = () => goto(0, true);
      $pane.querySelector("#speed").onchange = (e) => setSpeed(parseFloat(e.target.value));
      bindVolume($pane);
      const seekEl = $pane.querySelector("#seek");
      seekEl.addEventListener("input", (e) => {
        const ratio = e.target.value / 1000;
        const [a, b] = playWin(i);
        const total = b - a;
        paintTime(total * ratio, total);
        if (seg && seg.tok === playTok && !audio.paused) {
          try { audio.currentTime = a + total * ratio; } catch {}
          armEnd();
        }
      });
      seekEl.addEventListener("change", (e) => {
        if (seg && seg.tok === playTok && !audio.paused) return;
        resumeRatio = e.target.value / 1000;
        playSeg(i);
      });
      $pane.querySelector("#prev").onclick = () => goto(i - 1, true);
      $pane.querySelector("#nextArrow").onclick = () => goto(i + 1, true);
      $pane.querySelector("#check").onclick = () => (checked ? next() : check());
      $pane.querySelector("#skip").onclick = () => { setResult(s, "skip"); next(); };
      $ans.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); checked ? next() : check(); }
      });
      if (!touchUi()) $ans.focus({ preventScroll: true });
    }

    function check() {
      const s = sents[i];
      const typed = $pane.querySelector("#ans").value;
      const d = diff(s.text, typed);
      checked = true;
      setResult(s, d.perfect ? "ok" : "bad");
      const wrong = d.orig.filter((w, k) => !w.skip && !d.hit[k]).length;
      $pane.querySelector("#result").innerHTML = `
        <div class="result ${d.perfect ? "ok" : "bad"}">
          <div class="status">${d.perfect ? "Chính xác" : typed.trim() ? `Chưa đúng, thiếu hoặc sai ${wrong} từ` : "Đáp án"}</div>
          <div class="sentence">${d.orig.map((w, k) => `<span class="w ${w.skip ? "skip" : typed.trim() ? (d.hit[k] ? "ok" : "bad") : ""}">${esc(w.text)}</span>`).join("")}</div>
          ${d.extra.length ? `<div class="extra">Từ thừa: ${d.extra.map((w) => `<s>${esc(w)}</s>`).join("")}</div>` : ""}
        </div>`;
      $pane.querySelector("#check").textContent = i === sents.length - 1 ? "Hoàn thành" : "Câu tiếp";
      renderBar();
    }

    function next() {
      if (i < sents.length - 1) goto(i + 1, true);
      else showDone();
    }

    function showDone() {
      stop();
      const c = { ok: 0, bad: 0, skip: 0 };
      sents.forEach((s) => { const r = pr.res[s.id]; if (r) c[r]++; });
      $pane.innerHTML = `
        <div class="done-panel">
          <h2>Xong bài ${esc(meta.title)}</h2>
          <p class="muted">${c.ok} câu đúng, ${c.bad} câu chưa đúng, ${c.skip} câu bỏ qua.</p>
          <p class="muted" id="sheet-note">${logCfg().url ? "Đang ghi lần học này vào Google Sheet…" : "Chưa gắn Google Sheet — vào Nhật ký để lưu số lần học trên cả laptop và điện thoại."}</p>
          <div class="actions">
            ${nextLesson ? `<a class="btn primary" href="#/t/${topic}/${nextLesson.id}">Bài tiếp: ${esc(nextLesson.title)}</a>` : ""}
            ${c.bad + c.skip ? `<button class="btn" id="redo-bad">Làm lại câu chưa đúng</button>` : ""}
            <button class="btn" id="reset">Làm lại cả bài</button>
            <a class="btn" href="#/t/${topic}">Về danh sách bài</a>
          </div>
        </div>`;
      const again = $pane.querySelector("#redo-bad");
      if (again) again.onclick = () => {
        sents.forEach((s) => { if (pr.res[s.id] !== "ok") delete pr.res[s.id]; });
        const first = sents.findIndex((s) => !pr.res[s.id]);
        save(); goto(first < 0 ? 0 : first, true);
      };
      $pane.querySelector("#reset").onclick = () => { pr.res = {}; pr.pos = 0; save(); goto(0, true); };
      renderBar();
      logStudy({ topic, lesson: id, title: meta.title, event: "xong", ok: c.ok, bad: c.bad, skip: c.skip, total: sents.length })
        .then(() => { const n = document.getElementById("sheet-note"); if (n) n.textContent = "Đã ghi lần học xong vào Google Sheet."; })
        .catch((err) => { const n = document.getElementById("sheet-note"); if (n && logCfg().url) n.textContent = err.message; });
    }

    /* ---------- tab "Toàn bộ transcript": phát từ đầu đến cuối ---------- */
    function ensureFullStyle() {
      if (document.getElementById("full-style")) return;
      const st = document.createElement("style");
      st.id = "full-style";
      st.textContent = `
        .fullbar{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin:0 0 12px}
        .fullbar .chk{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
        .full li{cursor:pointer}
        .full li.cur{background:rgba(14,90,138,.13);box-shadow:inset 4px 0 0 #0e5a8a}
        .fullhint{margin:10px 0 0}`;
      document.head.appendChild(st);
    }
    function syncCont() {
      const b = document.getElementById("playall");
      if (!b) return;
      b.textContent = contState === "play" ? "⏸ Tạm dừng"
        : contState === "pause" ? "▶ Tiếp tục"
        : from > 0 ? `▶ Phát từ câu ${from + 1}` : "▶ Phát từ đầu đến cuối";
    }
    function markCur(k) {
      cur = k;
      const lis = $pane.querySelectorAll(".full li");
      lis.forEach((li, j) => li.classList.toggle("cur", j === k));
      if (autoScroll && lis[k]) lis[k].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    // câu đang đọc tại thời điểm t của audio
    function idxAt(t) {
      for (let k = sents.length - 1; k > 0; k--) if (t >= sents[k].start - LEAD) return k;
      return 0;
    }
    function runCont() {
      audio.playbackRate = speed;
      audio.play().catch(() => { contState = "idle"; syncCont(); });
      cancelAnimationFrame(raf);
      const tick = () => {
        const t = audio.currentTime, k = idxAt(t);
        if (k !== cur) markCur(k);
        if (audio.ended || t >= sents[sents.length - 1].end + 0.2) { finishCont(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    function playAll(k) {
      stop();
      from = Math.max(0, Math.min(sents.length - 1, k || 0));
      markCur(from);
      audio.currentTime = Math.max(0, sents[from].start - LEAD);
      contState = "play"; syncCont();
      runCont();
    }
    function finishCont() {
      cancelAnimationFrame(raf); audio.pause();
      if (loopAll && tab === "full") { playAll(0); return; }
      contState = "idle"; from = 0; syncCont();
    }
    function toggleCont() {
      if (contState === "play") { cancelAnimationFrame(raf); audio.pause(); contState = "pause"; syncCont(); }
      else if (contState === "pause") { contState = "play"; syncCont(); runCont(); }
      else playAll(from);
    }
    // nhảy tới câu k: đang phát/tạm dừng thì tua tới đó, còn không thì nghe riêng câu đó
    function jumpTo(k) {
      k = Math.max(0, Math.min(sents.length - 1, k));
      if (contState === "idle") { playSeg(k); return; }
      from = k; markCur(k);
      audio.currentTime = Math.max(0, sents[k].start - LEAD);
    }

    function renderFull() {
      ensureFullStyle();
      cur = -1;
      $pane.innerHTML = `
        <div class="player fullbar">
          <button class="btn primary" id="playall"></button>
          <button class="btn" id="fromtop">⏮ Từ đầu</button>
          ${volControl()}
          <label>Tốc độ
            <select id="speedF">${[0.5, 0.75, 1, 1.25].map((v) => `<option value="${v}" ${v === speed ? "selected" : ""}>${v}x</option>`).join("")}</select>
          </label>
          <label class="chk"><input type="checkbox" id="loopF" ${loopAll ? "checked" : ""}> Lặp lại cả bài</label>
          <label class="chk"><input type="checkbox" id="autoF" ${autoScroll ? "checked" : ""}> Tự cuộn</label>
        </div>
        <ol class="full">${sents.map((s, k) => `
          <li data-k="${k}"><span class="n">${k + 1}</span>
            <button class="btn icon p" data-play="${k}" aria-label="Nghe câu ${k + 1}">Nghe</button>
            <span class="t">${esc(s.text)}</span>
            <span class="dot ${pr.res[s.id] || ""}"></span></li>`).join("")}</ol>
        <p class="muted fullhint">Space: phát / tạm dừng. ← →: chuyển câu. Bấm vào một câu để nhảy tới đó, nút "Nghe" chỉ nghe riêng câu đó.</p>`;
      syncCont();
      $pane.querySelector("#playall").onclick = toggleCont;
      $pane.querySelector("#fromtop").onclick = () => playAll(0);
      $pane.querySelector("#speedF").onchange = (e) => setSpeed(parseFloat(e.target.value));
      bindVolume($pane);
      $pane.querySelector("#loopF").onchange = (e) => { loopAll = e.target.checked; };
      $pane.querySelector("#autoF").onchange = (e) => { autoScroll = e.target.checked; };
      $pane.onclick = (e) => {
        const b = e.target.closest("[data-play]");
        if (b) { playSeg(+b.dataset.play); return; }
        const li = e.target.closest("li[data-k]");
        if (li) jumpTo(+li.dataset.k);
      };
    }

    function renderAll() {
      renderBar();
      app.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
      $pane.onclick = null;
      tab === "dict" ? renderDict() : renderFull();
    }
    app.querySelector(".tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if (!b) return;
      stop(); tab = b.dataset.tab; renderAll();
    });

    const onKey = (e) => {
      if (tab === "full") {
        const tg = (e.target && e.target.tagName) || "";
        if (e.code === "Space" && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(tg)) { e.preventDefault(); toggleCont(); }
        else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !/INPUT|SELECT|TEXTAREA/.test(tg)) {
          e.preventDefault();
          jumpTo((cur >= 0 ? cur : from) + (e.key === "ArrowRight" ? 1 : -1));
        }
        return;
      }
      if (tab !== "dict") return;
      if (e.ctrlKey && e.code === "Space") { e.preventDefault(); playSeg(i); }
      else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goto(i - 1, true); }
      else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); goto(i + 1, true); }
    };
    addEventListener("keydown", onKey);
    const onHide = () => { if (document.visibilityState === "hidden") pauseForBlur(); };
    const onBlur = () => {
      // Chờ một nhịp: mở danh sách tốc độ cũng có thể làm cửa sổ mất focus trong chốc lát.
      setTimeout(() => {
        if (document.visibilityState === "hidden" || !document.hasFocus()) pauseForBlur();
      }, 0);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    cleanup = () => {
      stop();
      removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
      audio.src = "";
    };

    renderAll();
    const known = studyTimes(topic, id);
    const countEl = document.getElementById("study-count");
    if (countEl && known && known.open) countEl.textContent = `Đã mở ${known.open} lần`;
    logStudy({ topic, lesson: id, title: meta.title, event: "mở", total: sents.length })
      .then((data) => {
        const el = document.getElementById("study-count");
        const open = data && data.open;
        if (el && open) el.textContent = `Đã mở ${open} lần`;
      })
      .catch(() => {});
  }
})();
