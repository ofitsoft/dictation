(() => {
  const app = document.getElementById("app");
  const LS = "dict:v1", LS_SPEED = "dict:speed";

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

  /* ---------- tiện ích ---------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  window.DICT = window.DICT || {};
  const cache = {};
  // Nạp dữ liệu bằng <script> (data/<khoá>.js) thay vì fetch, để mở thẳng index.html (file://) vẫn chạy.
  const getData = (key) => {
    if (!cache[key]) {
      cache[key] = new Promise((res, rej) => {
        if (DICT[key]) return res(DICT[key]);
        const sc = document.createElement("script");
        sc.src = `data/${key}.js`;
        sc.onload = () => (DICT[key] ? res(DICT[key]) : rej(new Error(`${sc.getAttribute("src")}: dữ liệu rỗng`)));
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

  /* ---------- router: #/  |  #/t/<chủ đề>  |  #/t/<chủ đề>/<bài>[/<câu>] ---------- */
  async function route() {
    cleanup(); cleanup = () => {};
    const h = location.hash;
    const lm = h.match(/^#\/t\/([\w-]+)\/([\w-]+)(?:\/(\d+))?/);
    const tm = h.match(/^#\/t\/([\w-]+)\/?$/);
    try {
      if (lm) await showLesson(lm[1], lm[2], lm[3] ? parseInt(lm[3], 10) - 1 : null);
      else if (tm) await showTopic(tm[1]);
      else await showHome();
    } catch (e) {
      app.innerHTML = `<div class="error">Không tải được dữ liệu: ${esc(e.message)}</div>`;
    }
  }
  addEventListener("hashchange", route);
  route();

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
        return { ...l, n, st: n === 0 ? "todo" : n >= l.parts ? "done" : "doing" };
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
              <div class="meta"><span>${l.parts} câu</span>${l.level ? `<span class="lvl">${esc(l.level)}</span>` : ""}</div>
              ${l.n ? `<div class="bar"><i style="width:${Math.min(100, Math.round((100 * l.n) / l.parts))}%"></i></div>` : ""}
            </a>`).join("")}</div></details>`;
      }).join("") : `<p class="empty">${lessons.length ? "Không có bài nào khớp bộ lọc." : "Chủ đề này chưa có bài nào."}</p>`;
    };
    app.querySelector("#q").addEventListener("input", (e) => { st.q = e.target.value; render(); });
    app.querySelector("#lv").addEventListener("change", (e) => { st.level = e.target.value; render(); });
    app.querySelector("#st").addEventListener("change", (e) => { st.status = e.target.value; render(); });
    render();
  }

  /* ---------- so khớp từ ---------- */
  const norm = (w) => w.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9']/g, "");

  function diff(text, typed) {
    const orig = text.split(/\s+/).filter(Boolean);
    const a = orig.map(norm);
    const rawTyped = typed.split(/\s+/).filter(Boolean);
    const b = rawTyped.map(norm);
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] && a[i] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const hit = new Array(a.length).fill(false);
    const used = new Array(b.length).fill(false);
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j] && a[i]) { hit[i] = used[j] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const extra = rawTyped.filter((_, k) => !used[k] && b[k]);
    return { orig, hit, extra, perfect: hit.every(Boolean) && extra.length === 0 };
  }

  /* ================= Cấp 3: bài nghe ================= */
  async function showLesson(topic, id, startIdx) {
    const [topics, lessons] = await Promise.all([getData("topics"), getData(`${topic}/lessons`)]);
    const tinfo = topics.find((t) => t.id === topic);
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
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("ended", () => setPlaying(false));
    document.title = `${meta.title} – ${tinfo.title} – Nghe chép`;

    app.innerHTML = `
      <nav class="crumbs"><a href="#/">Tất cả chủ đề</a> <span aria-hidden="true">/</span>
        <a href="#/t/${topic}">${esc(tinfo.title)}</a> <span aria-hidden="true">/</span> <span>${esc(meta.group)}</span></nav>
      <header class="lhead"><h1>${meta.no}. ${esc(meta.title)}</h1>${meta.level ? `<span class="lvl">${esc(meta.level)}</span>` : ""}</header>
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

    function stop() { cancelAnimationFrame(raf); audio.pause(); setPlaying(false); contState = "idle"; syncCont(); }
    function setPlaying(v) {
      const b = document.getElementById("play");
      if (b) b.textContent = v ? "Đang phát" : "Nghe lại";
    }
    function playSeg(k) {
      stop();
      const s = sents[k];
      if (tab === "full") { from = k; markCur(k); }
      audio.playbackRate = speed;
      audio.currentTime = s.start;
      audio.play().then(() => setPlaying(true)).catch(() => {});
      const tick = () => {
        if (audio.currentTime >= s.end - 0.02 || audio.ended) { audio.pause(); setPlaying(false); return; }
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
        </div>
        <div class="player">
          <button class="btn" id="play">Nghe</button>
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
      $pane.querySelector("#play").onclick = () => playSeg(i);
      $pane.querySelector("#speed").onchange = (e) => {
        speed = parseFloat(e.target.value);
        try { localStorage.setItem(LS_SPEED, speed); } catch {}
        audio.playbackRate = speed;
      };
      $pane.querySelector("#prev").onclick = () => goto(i - 1, true);
      $pane.querySelector("#nextArrow").onclick = () => goto(i + 1, true);
      $pane.querySelector("#check").onclick = () => (checked ? next() : check());
      $pane.querySelector("#skip").onclick = () => { setResult(s, "skip"); next(); };
      $ans.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); checked ? next() : check(); }
      });
      $ans.focus({ preventScroll: true });
    }

    function check() {
      const s = sents[i];
      const typed = $pane.querySelector("#ans").value;
      const d = diff(s.text, typed);
      checked = true;
      setResult(s, d.perfect ? "ok" : "bad");
      const wrong = d.hit.filter((h) => !h).length;
      $pane.querySelector("#result").innerHTML = `
        <div class="result ${d.perfect ? "ok" : "bad"}">
          <div class="status">${d.perfect ? "Chính xác" : typed.trim() ? `Chưa đúng, thiếu hoặc sai ${wrong} từ` : "Đáp án"}</div>
          <div class="sentence">${d.orig.map((w, k) => `<span class="w ${typed.trim() ? (d.hit[k] ? "ok" : "bad") : ""}">${esc(w)}</span>`).join("")}</div>
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
      for (let k = sents.length - 1; k > 0; k--) if (t >= sents[k].start - 0.05) return k;
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
      audio.currentTime = Math.max(0, sents[from].start - 0.05);
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
      audio.currentTime = Math.max(0, sents[k].start - 0.05);
    }

    function renderFull() {
      ensureFullStyle();
      cur = -1;
      $pane.innerHTML = `
        <div class="player fullbar">
          <button class="btn primary" id="playall"></button>
          <button class="btn" id="fromtop">⏮ Từ đầu</button>
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
      $pane.querySelector("#speedF").onchange = (e) => {
        speed = parseFloat(e.target.value);
        try { localStorage.setItem(LS_SPEED, speed); } catch {}
        audio.playbackRate = speed;
      };
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
    cleanup = () => { stop(); removeEventListener("keydown", onKey); audio.src = ""; };

    renderAll();
  }
})();
