/* =========================================================
 * app.js —— 交互与渲染
 * ========================================================= */

const state = {
  games: GAMEPLAY_POOL.map(g => ({ ...g, picked: true })),
  share: 22,
  launchDate: "2026-11-06",
  windowDays: 14,
  minGap: 5,
  result: null
};

const $ = (s) => document.querySelector(s);
const fmt = (n) => {
  if (n == null || isNaN(n)) return "—";
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + "亿";
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + "万";
  return Math.round(n).toLocaleString();
};
const pct = (n, d = 1) => (n * 100).toFixed(d) + "%";

/* ---------- 上下文 ---------- */
function ctxNow() {
  return MODEL.buildContext({
    games: state.games.filter(g => g.picked),
    types: TYPES,
    layers: SNAPSHOT.layers,
    dauTotal: SNAPSHOT.dauTotal,
    newContentShare: state.share
  });
}

/* ---------- 渲染：DAU 区 ---------- */
function renderDau() {
  $("#dauNum").textContent = fmt(SNAPSHOT.dauTotal);
  $("#fetchedTag").textContent = "● 数据已同步 " + SNAPSHOT.fetchedAt;
  const maxDau = Math.max(...SNAPSHOT.layers.map(l => l.dau));
  $("#layerList").innerHTML = SNAPSHOT.layers.map(l => `
    <div class="layer">
      <i class="sw" style="background:${l.color}"></i>
      <span class="nm">${l.name}</span>
      <span class="bar"><span style="width:${(l.dau / maxDau * 100).toFixed(1)}%;background:${l.color}"></span></span>
      <span class="vv">${fmt(l.dau)} · ${l.avgMin}min</span>
    </div>`).join("");

  const budget = MODEL.sum(SNAPSHOT.layers.map(l => l.dau * l.avgMin)) * state.share / 100;
  $("#budgetVal").textContent = fmt(budget / 10000) + " 万人·分钟";
  $("#shareVal").textContent = state.share + "%";
  $("#shareRange").value = state.share;
  const cap = SNAPSHOT.dauTotal * 0.10 * 60;
  $("#budgetFill").style.width = Math.min(100, budget / cap * 100).toFixed(1) + "%";
}

/* ---------- 渲染：类型活跃分层 ---------- */
function renderTypes() {
  const head = `<div class="type-row head"><span>玩法类型</span>
    ${SNAPSHOT.layers.map(l => `<span style="text-align:right">${l.name}</span>`).join("")}
    <span style="text-align:right">合计</span></div>`;
  const rows = TYPES.map(t => {
    const a = MODEL.typeActive(t, SNAPSHOT.layers);
    return `<div class="type-row">
      <span class="tn">${t.icon} ${t.name}</span>
      ${SNAPSHOT.layers.map(l => `<span class="cell">${fmt(a[l.key])}</span>`).join("")}
      <span class="cell tot">${fmt(a.total)}</span>
    </div>`;
  }).join("");
  $("#typeTable").innerHTML = head + rows;
}

/* ---------- 渲染：玩法池 ---------- */
function renderGames() {
  $("#gameList").innerHTML = state.games.map(g => {
    const t = TYPES.find(x => x.key === g.type);
    const newP = g.expo * g.cvrDownload * g.cvrJoin;
    const bad = g.readiness < MODEL.CFG.MIN_READINESS;
    return `<div class="game ${g.picked ? "on" : "off"}" data-id="${g.id}">
      <div class="game-top">
        <input type="checkbox" ${g.picked ? "checked" : ""} data-act="pick" />
        <span class="g-name">${g.name}</span>
        <span class="g-type" style="color:${t.color};border-color:${t.color}44;background:${t.color}14">${t.name}</span>
        <span class="g-ready ${bad ? "bad" : ""}">就绪度 ${g.readiness.toFixed(2)}${bad ? " · 未达门槛" : ""}</span>
      </div>
      <div class="g-tags">${g.tags.map(x => `<span>${x}</span>`).join("")}</div>
      <div class="g-inputs">
        <div class="g-in"><label>日曝光</label><input type="number" data-f="expo" value="${g.expo}" step="10000" /></div>
        <div class="g-in"><label>曝光→下载</label><input type="number" data-f="cvrDownload" value="${g.cvrDownload}" step="0.001" /></div>
        <div class="g-in"><label>下载→参与</label><input type="number" data-f="cvrJoin" value="${g.cvrJoin}" step="0.01" /></div>
      </div>
      <div class="g-result">
        有效新进 <b>${fmt(newP)}</b>/日
        <span class="g-funnel">
          <em>${fmt(g.expo)}</em>→<em>${fmt(g.expo * g.cvrDownload)}</em>→<em>${fmt(newP)}</em>
        </span>
      </div>
    </div>`;
  }).join("");
  $("#pickedCount").textContent = state.games.filter(g => g.picked).length;
  $("#poolCount").textContent = state.games.length;
}

/* ---------- 渲染：竞争矩阵 ---------- */
function renderMatrix() {
  const list = state.games.filter(g => g.picked).slice(0, 10);
  const comp = MODEL.buildCompMatrix(state.games, COMP_OVERRIDE, TYPES, SNAPSHOT.layers);
  const cols = list.length + 1;
  let html = `<div class="h"></div>` + list.map(g => `<div class="h">${g.name}</div>`).join("");
  list.forEach(a => {
    html += `<div class="h" style="justify-content:flex-end;padding-right:4px">${a.name}</div>`;
    list.forEach(b => {
      const v = a.id === b.id ? null : comp[a.id][b.id];
      if (v == null) { html += `<div class="c" style="background:rgba(255,255,255,.03)">–</div>`; return; }
      const op = (0.08 + v * 0.85).toFixed(2);
      html += `<div class="c" style="background:${v > 0.55 ? `rgba(255,107,138,${op})` : `rgba(124,108,245,${op})`}">${v.toFixed(2)}</div>`;
    });
  });
  const m = $("#matrix");
  m.style.gridTemplateColumns = `86px repeat(${list.length}, 38px)`;
  m.innerHTML = html;
}
/* ---------- 运行模型 ---------- */
function runModel() {
  const ctx = ctxNow();
  const comp = MODEL.buildCompMatrix(state.games, COMP_OVERRIDE, TYPES, SNAPSHOT.layers);
  const res = MODEL.solve(ctx, comp);
  const sch = MODEL.schedule(res.best, comp, state.launchDate, state.windowDays, state.minGap, MODEL.CFG.BATCH_CAP);
  state.result = { ctx, comp, res, sch };
  renderHero(ctx, res);
  drawCurve(res);
  renderCombo(res);
  renderFunnel(res);
  renderTimeline(sch);
}

/* ---------- 结果：KPI ---------- */
function renderHero(ctx, res) {
  const b = res.best;
  $("#kpiCount").textContent = b.k;
  $("#kpiNew").textContent = fmt(b.effNew);
  $("#kpiLoad").textContent = pct(b.totalLoad, 0);
  $("#kpiCannibal").textContent = pct(b.cannibalRate, 0);
  $("#kpiCover").textContent = pct(b.coverage, 0);

  $("#heroDesc").innerHTML =
    `目标窗口 <b>${state.launchDate}</b> 起 ${state.windowDays} 天，候选 ${res.candidates} 个玩法中` +
    `建议上架 <b>${b.k}</b> 个；预估单日有效新进（仅计参与玩家）<b>${fmt(b.effNew)}</b> 人，` +
    `占用新内容注意力池 <b>${pct(b.totalLoad, 0)}</b>，曝光池溢出导致的平均稀释 <b>${pct(1 - b.dilExpo, 0)}</b>。`;

  const comp = state.result.comp;
  const tips = [];

  // 多上一个：在最优集合上加边际最优的候选
  let addBest = null;
  res.pool.forEach(g => {
    if (b.ids.includes(g.id)) return;
    const ev = MODEL.evaluate([...b.ids, g.id], ctx, comp);
    if (!addBest || ev.utility > addBest.ev.utility) addBest = { g, ev };
  });
  if (addBest) {
    const self = addBest.ev.picked.find(x => x.id === addBest.g.id);
    const sameType = b.picked.filter(x => x.type === addBest.g.type).length;
    tips.push(`再加 1 个「<b>${addBest.g.name}</b>」（${addBest.g.typeName}${sameType ? `，同类型已有 ${sameType} 个` : ""}）：` +
      `它自身只能拿到 <span class="down">${fmt(self.effNew)}</span> 有效新进（被倾轧掉 ${pct(self.cannibalRate, 0)}），` +
      `曝光需求升至池容的 ${pct(addBest.ev.sumExpo / ctx.expoCap, 0)}，全部 ${b.k + 1} 个玩法平均被稀释，` +
      `综合效用 ${b.utility.toFixed(1)} → <span class="down">${addBest.ev.utility.toFixed(1)}</span>。`);
  } else {
    tips.push(`候选池已全部纳入，注意力池仅占用 ${pct(b.totalLoad, 0)}，仍有余量，可扩充候选池。`);
  }

  // 少上一个：从最优集合里去掉边际贡献最小的那个
  if (b.k > 1) {
    let dropBest = null;
    b.picked.forEach(g => {
      const ev = MODEL.evaluate(b.ids.filter(i => i !== g.id), ctx, comp);
      if (!dropBest || ev.utility > dropBest.ev.utility) dropBest = { g, ev };
    });
    const tk = dropBest.g.type;
    const cBefore = b.coverageByType[tk], cAfter = dropBest.ev.coverageByType[tk];
    tips.push(`减去「<b>${dropBest.g.name}</b>」：${cBefore.name}类型覆盖达成度 ${pct(cBefore.cover, 0)} → <span class="up">${pct(cAfter.cover, 0)}</span>，` +
      `覆盖缺口惩罚 +${(dropBest.ev.underPenalty - b.underPenalty).toFixed(1)}，综合效用降到 ${dropBest.ev.utility.toFixed(1)}；` +
      `该类型玩家"玩不到想玩的"，会流向存量玩法或竞品。`);
  }
  $("#verdict").innerHTML = tips.map(t => "· " + t).join("<br/>");
  $("#verdict").style.display = tips.length ? "block" : "none";
}

/* ---------- 结果：最优解曲线 ---------- */
function drawCurve(res) {
  const cv = $("#curveChart");
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = 240;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.height = H + "px";
  const c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);

  const data = res.curve;
  const padL = 42, padR = 18, padT = 18, padB = 30;
  const w = W - padL - padR, h = H - padT - padB;
  const vals = [];
  data.forEach(d => { vals.push(d.utility, d.gain, -d.underPenalty); });
  let min = Math.min(...vals, 0), max = Math.max(...vals, 1);
  const span = max - min || 1;
  const X = i => padL + (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w);
  const Y = v => padT + h - ((v - min) / span) * h;

  // grid
  c.strokeStyle = "rgba(255,255,255,.06)"; c.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (h / 4) * i;
    c.beginPath(); c.moveTo(padL, y); c.lineTo(padL + w, y); c.stroke();
  }
  // zero line
  if (min < 0) {
    c.strokeStyle = "rgba(255,255,255,.16)"; c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(padL, Y(0)); c.lineTo(padL + w, Y(0)); c.stroke();
    c.setLineDash([]);
  }

  const line = (key, color, width, fill) => {
    c.beginPath();
    data.forEach((d, i) => { const x = X(i), y = Y(key(d)); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.strokeStyle = color; c.lineWidth = width; c.lineJoin = "round"; c.stroke();
    if (fill) {
      c.lineTo(X(data.length - 1), Y(min)); c.lineTo(X(0), Y(min)); c.closePath();
      const g = c.createLinearGradient(0, padT, 0, padT + h);
      g.addColorStop(0, fill); g.addColorStop(1, "rgba(124,108,245,0)");
      c.fillStyle = g; c.fill();
    }
  };
  line(d => -d.underPenalty, "rgba(255,107,138,.55)", 1.4, null);
  line(d => d.gain, "rgba(61,220,151,.8)", 1.6, null);
  line(d => d.utility, "#7c6cf5", 2.6, "rgba(124,108,245,.22)");

  // best marker
  const bi = res.best.k;
  const bx = X(bi), by = Y(res.best.utility);
  c.strokeStyle = "rgba(247,185,85,.5)"; c.setLineDash([3, 4]);
  c.beginPath(); c.moveTo(bx, padT); c.lineTo(bx, padT + h); c.stroke(); c.setLineDash([]);
  c.beginPath(); c.arc(bx, by, 5.5, 0, Math.PI * 2);
  c.fillStyle = "#f7b955"; c.fill();
  c.beginPath(); c.arc(bx, by, 10, 0, Math.PI * 2);
  c.fillStyle = "rgba(247,185,85,.16)"; c.fill();

  // axis labels
  c.fillStyle = "#65708c"; c.font = "10px -apple-system,sans-serif"; c.textAlign = "center";
  data.forEach((d, i) => { if (data.length <= 12 || i % 2 === 0) c.fillText(d.k, X(i), H - 10); });
  c.textAlign = "right";
  c.fillText(max.toFixed(0), padL - 6, padT + 4);
  c.fillText(min.toFixed(0), padL - 6, padT + h);
  c.textAlign = "left";
  c.fillStyle = "#f7b955";
  c.fillText(`最优 k=${bi}`, Math.min(bx + 8, W - 62), Math.max(by - 12, 14));

  const note = res.best.k >= data.length - 1
    ? "候选池已被全部纳入，说明当前注意力/曝光资源仍有余量，可考虑扩充候选池。"
    : `曲线在 k=${res.best.k} 处取得峰值：k 更小 → 覆盖缺口惩罚上升；k 更大 → 曝光位被过度拆分、同质化倾轧加剧。`;
  $("#curveNote").textContent = note;
  renderSensitivity();
}

/* 敏感度：曝光位/注意力池变化时最优 k 的漂移 */
function renderSensitivity() {
  const orig = MODEL.CFG.EXPO_SLOTS_PER_USER;
  const run = (f) => {
    MODEL.CFG.EXPO_SLOTS_PER_USER = orig * f;
    const c2 = MODEL.buildContext({
      games: state.games.filter(g => g.picked), types: TYPES, layers: SNAPSHOT.layers,
      dauTotal: SNAPSHOT.dauTotal, newContentShare: state.share
    });
    const r = MODEL.solve(c2, MODEL.buildCompMatrix(state.games, COMP_OVERRIDE, TYPES, SNAPSHOT.layers));
    MODEL.CFG.EXPO_SLOTS_PER_USER = orig;
    return r.best.k;
  };
  const lo = run(0.7), hi = run(1.3);
  $("#sensNote").textContent =
    `敏感度：曝光位池 −30% → 最优 ${lo} 个；+30% → 最优 ${hi} 个。最优解随资源池与需求结构动态漂移，非固定值。`;
}
/* ---------- 结果：推荐组合 ---------- */
function renderCombo(res) {
  const b = res.best;
  if (!b.picked.length) {
    $("#comboList").innerHTML = `<p class="hint">候选池中没有满足上线门槛（就绪度 ≥ ${MODEL.CFG.MIN_READINESS}）的玩法，请调整录入或勾选。</p>`;
    return;
  }
  const sch = state.result.sch;
  const batchOf = {};
  sch.forEach(x => x.games.forEach(g => { batchOf[g.id] = x; }));
  const maxEff = Math.max(...b.picked.map(g => g.effNew), 1);
  const list = b.picked.slice().sort((x, y) => y.effNew * y.qualityW - x.effNew * x.qualityW);

  $("#comboList").innerHTML = list.map((g, i) => {
    const share = g.effNew / b.effNew;
    const bt = batchOf[g.id];
    return `<div class="combo">
      <div class="idx">${String(i + 1).padStart(2, "0")}</div>
      <div class="nm">${g.name}
        <small>${g.tags.slice(0, 3).join(" · ")}</small>
      </div>
      <div class="m">${fmt(g.effNew)}<span>有效新进</span></div>
      <div class="m">${fmt(g.baseNew)}<span>漏斗原始</span></div>
      <div>
        <div class="bar"><i style="width:${(g.effNew / maxEff * 100).toFixed(1)}%;background:linear-gradient(90deg,${g.typeColor},#7c6cf5)"></i></div>
        <div class="m" style="font-size:9.5px;color:#65708c;text-align:left;margin-top:3px">占 ${pct(share, 0)}</div>
      </div>
      <div class="m" style="color:${g.cannibalRate > .3 ? "#ff6b8a" : "#3ddc97"}">-${pct(g.cannibalRate, 0)}
        <span>倾轧 ${bt ? "· 第" + bt.index + "批" : ""}</span></div>
    </div>`;
  }).join("");
}

/* ---------- 结果：漏斗 ---------- */
function renderFunnel(res) {
  const p = res.best.picked;
  if (!p.length) {
    $("#funnelSum").innerHTML = "等待有效候选";
    $("#funnelBars").innerHTML = "";
    return;
  }
  const expo = MODEL.sum(p.map(g => g.expo));
  const dl = MODEL.sum(p.map(g => g.expo * g.cvrDownload));
  const joinRaw = MODEL.sum(p.map(g => g.expo * g.cvrDownload * g.cvrJoin));
  const eff = res.best.effNew;

  $("#funnelSum").innerHTML = `组合合计有效新进（日）
    <b>${fmt(eff)}</b>
    曝光利用率 ${pct(eff / expo, 2)}<br/>
    原始参与 ${fmt(joinRaw)} → 稀释+倾轧后 ${fmt(eff)}`;
  const rows = [
    { lab: "① 曝光人数", v: expo, c: "#4fc3f7", note: "运营位 + 推荐 + 自然流量" },
    { lab: "② 下载/进入", v: dl, c: "#7c6cf5", note: "曝光→下载 " + pct(dl / expo, 1) },
    { lab: "③ 参与玩家", v: joinRaw, c: "#3ddc97", note: "下载→参与 " + pct(joinRaw / dl, 1) },
    { lab: "④ 有效新进", v: eff, c: "#f7b955", note: "扣除曝光稀释与倾轧" }
  ];
  $("#funnelBars").innerHTML = rows.map(r => `
    <div class="fb">
      <span class="lab">${r.lab}</span>
      <span class="track"><i style="width:${Math.max(2, r.v / expo * 100)}%;background:linear-gradient(90deg,${r.c},${r.c}66)"></i></span>
      <span class="val">${fmt(r.v)}<em>${r.note}</em></span>
    </div>`).join("");
}

/* ---------- 结果：排期 ---------- */
function renderTimeline(sch) {
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  if (!sch.length) {
    $("#timeline").innerHTML = `<p class="hint">无可排期玩法。</p>`;
    return;
  }
  $("#timeline").innerHTML = sch.map(b => {
    const d = b.date;
    return `<div class="tl-item">
      <div class="tl-date"><b>${(d.getMonth() + 1)}/${d.getDate()}</b>${wd[d.getDay()]}${b.inWindow ? "" : " · 窗外"}</div>
      <div class="tl-axis"><span class="pin" style="${b.inWindow ? "" : "border-color:#65708c"}"></span></div>
      <div class="tl-body ${b.inWindow ? "" : "tl-out"}">
        <div class="tl-batch">第 ${b.index} 批 · ${b.games.length} 个 · 曝光 ${fmt(b.exposure)} · 有效新进 ${fmt(b.effNew)}${b.inWindow ? "" : " <em>超出排期窗口</em>"}</div>
        <div class="tl-games">${b.games.map(g => `<span class="tl-game">${g.typeIcon} ${g.name}<span>${g.typeName}</span></span>`).join("")}</div>
      </div>
    </div>`;
  }).join("");
}

/* ---------- 事件绑定 ---------- */
function bind() {
  $("#launchDate").value = state.launchDate;
  $("#windowDays").value = state.windowDays;
  $("#minGap").value = state.minGap;

  $("#launchDate").addEventListener("change", e => { state.launchDate = e.target.value; runModel(); });
  $("#windowDays").addEventListener("change", e => { state.windowDays = +e.target.value; runModel(); });
  $("#minGap").addEventListener("change", e => { state.minGap = +e.target.value; runModel(); });
  $("#shareRange").addEventListener("input", e => {
    state.share = +e.target.value;
    renderDau();
    runModel();
  });
  $("#btnRun").addEventListener("click", runModel);
  $("#btnReset").addEventListener("click", () => {
    state.games = GAMEPLAY_POOL.map(g => ({ ...g, picked: true }));
    state.share = 22; state.launchDate = "2026-11-06"; state.windowDays = 14; state.minGap = 5;
    $("#launchDate").value = state.launchDate; $("#windowDays").value = 14; $("#minGap").value = 5;
    renderDau(); renderGames(); renderMatrix(); runModel();
  });

  $("#gameList").addEventListener("change", e => {
    const card = e.target.closest(".game");
    if (!card) return;
    const g = state.games.find(x => x.id === card.dataset.id);
    if (e.target.dataset.act === "pick") {
      g.picked = e.target.checked;
    } else if (e.target.dataset.f) {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) g[e.target.dataset.f] = v;
    }
    renderGames(); renderMatrix(); runModel();
  });

  $("#btnAddGame").addEventListener("click", () => {
    const n = state.games.length + 1;
    state.games.push({
      id: "gx" + n, name: "新玩法 " + n, type: "pvp", quality: 0.7, readiness: 0.9,
      expo: 500000, cvrDownload: 0.05, cvrJoin: 0.5, tags: ["竞技", "快节奏"], picked: true
    });
    renderGames(); renderMatrix(); runModel();
  });

  window.addEventListener("resize", () => { if (state.result) drawCurve(state.result.res); });
}

/* ---------- 启动 ---------- */
renderDau();
renderTypes();
renderGames();
renderMatrix();
bind();
runModel();
