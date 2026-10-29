/* =========================================================
 * app.js —— 交互与渲染
 * ========================================================= */

const FIRST_WED = (() => {
  const d = MODEL.nextWednesday();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

const state = {
  games: GAMEPLAY_POOL.map(g => ({ ...g, picked: true })),
  share: 22,
  launchDate: FIRST_WED,   // 首个上架周三
  weeks: 4,                // 规划周数
  slotCap: 12,             // 专区同时容纳槽位
  zoneExpo: 3.2,           // 人均每日专区分到的曝光次数
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
  return MODEL.buildZoneContext({
    games: state.games.filter(g => g.picked),
    types: TYPES,
    layers: SNAPSHOT.layers,
    dauTotal: SNAPSHOT.dauTotal,
    newContentShare: state.share,
    slotCap: state.slotCap,
    weeks: state.weeks,
    expoPerUser: state.zoneExpo
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
  const res = MODEL.solveZone(ctx, comp, state.launchDate);
  state.result = { ctx, comp, res };
  renderHero(ctx, res);
  drawCurve(res);
  renderWeeks(res);
  renderFunnel(res);
  renderGantt(res);
}

/* ---------- 结果：KPI ---------- */
function renderHero(ctx, res) {
  const b = res.best;
  const next = res.curve[b.X + 1] || null;
  const prev = b.X > 0 ? res.curve[b.X - 1] : null;
  const d0 = MODEL.weekDate(state.launchDate, 0);
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  $("#kpiCount").textContent = b.X;
  $("#kpiNew").textContent = fmt(b.totalEff);
  $("#kpiPool").textContent = b.peakPool;
  $("#kpiCannibal").textContent = pct(b.avgCannibal, 0);
  $("#kpiCover").textContent = pct(b.coverage, 0);

  $("#heroDesc").innerHTML =
    `首个上架日 <b>${d0.getMonth() + 1}/${d0.getDate()} ${wd[d0.getDay()]} 10:00</b>，` +
    `按 7 天节奏连排 <b>${ctx.weeks}</b> 周、每周 <b>${b.X}</b> 个（共 ${b.totalTitles} 个）；` +
    `每批在专区曝光 14 天后退池，同时在池峰值 <b>${b.peakPool}</b> 个（槽位 ${ctx.slotCap}）。` +
    `${ctx.weeks} 周累计有效新进 <b>${fmt(b.totalEff)}</b> 人。`;

  const tips = [];

  if (next) {
    const dEff = next.totalEff - b.totalEff;
    const perSlot = dEff / Math.max(1, next.totalTitles - b.totalTitles);
    tips.push(`每周再加 1 个：同时在池升到 <span class="down">${next.peakPool}</span> 个，` +
      `同池倾轧把平均损耗推到 ${pct(next.avgCannibal, 0)}、曝光稀释 ${pct(1 - next.avgDil, 0)}，` +
      `新增位的边际产出${dEff >= 0 ? "仅 " + fmt(perSlot) : "转负（" + fmt(perSlot) + "）"}；` +
      `累计有效新进 ${fmt(next.totalEff)}（${dEff >= 0 ? "+" : "−"}${fmt(Math.abs(dEff))}），综合效用 ${b.utility.toFixed(1)} → <span class="down">${next.utility.toFixed(1)}</span>。`);
  } else {
    tips.push(`每周 ${b.X} 个已到可探索上限，更多批次只会摊薄单批曝光。`);
  }

  if (prev) {
    const coverWorse = prev.coverage < b.coverage;
    tips.push(`每周少上 1 个：合计少 ${b.totalTitles - prev.totalTitles} 个玩法，累计有效新进 ${fmt(prev.totalEff)}` +
      `${coverWorse ? `，覆盖达成度 ${pct(b.coverage, 0)} → <span class="up">${pct(prev.coverage, 0)}</span>、出现类型空档，玩家"玩不到想玩的"回流存量内容` : `，供给缺口只能由存量内容填补`}；` +
      `综合效用 ${b.utility.toFixed(1)} → <span class="up">${prev.utility.toFixed(1)}</span>。`);
  }

  if (b.X >= ctx.maxBatch) {
    tips.push(`当前受专区槽位约束：槽位 ${ctx.slotCap} 个、14 天留存 → 两批重叠，单批上限 = ⌊${ctx.slotCap}/2⌋ = ${ctx.maxBatch} 个。`);
  }
  if (b.shortages > 0) {
    const first = b.weeks.find(w => w.shortage);
    tips.push(`候选池库存仅 ${res.candidates} 个，第 ${first.index} 批起缺口 ${first.batch.length < b.X ? b.X - first.batch.length : 0} 个，需补充待上架玩法。`);
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
  const bi = res.best.X;
  const bx = X(bi), by = Y(res.best.utility);
  c.strokeStyle = "rgba(247,185,85,.5)"; c.setLineDash([3, 4]);
  c.beginPath(); c.moveTo(bx, padT); c.lineTo(bx, padT + h); c.stroke(); c.setLineDash([]);
  c.beginPath(); c.arc(bx, by, 5.5, 0, Math.PI * 2);
  c.fillStyle = "#f7b955"; c.fill();
  c.beginPath(); c.arc(bx, by, 10, 0, Math.PI * 2);
  c.fillStyle = "rgba(247,185,85,.16)"; c.fill();

  // axis labels
  c.fillStyle = "#65708c"; c.font = "10px -apple-system,sans-serif"; c.textAlign = "center";
  data.forEach((d, i) => { if (data.length <= 12 || i % 2 === 0) c.fillText(d.X, X(i), H - 10); });
  c.textAlign = "right";
  c.fillText(max.toFixed(0), padL - 6, padT + 4);
  c.fillText(min.toFixed(0), padL - 6, padT + h);
  c.textAlign = "left";
  c.fillStyle = "#f7b955";
  c.fillText(`最优 ${bi} 个/周`, Math.min(bx + 8, W - 92), Math.max(by - 12, 14));

  const dmax = data.length - 1;
  const note = bi >= dmax
    ? "每周上架数到顶仍未出现边际为负：专区曝光池与槽位仍有余量，可考虑扩容。"
    : `曲线在「每周 ${bi} 个」处取得峰值：再少 → 覆盖缺口惩罚上升（类型空档）；再多 → 同时在池 ${res.curve[bi + 1].peakPool} 个，曝光池被拆薄、同质倾轧加剧。`;
  $("#curveNote").textContent = note;
  renderSensitivity();
}

/* 敏感度：专区曝光池变化时最优「每周上架数」的漂移 */
function renderSensitivity() {
  const run = (f) => {
    const c2 = MODEL.buildZoneContext({
      games: state.games.filter(g => g.picked), types: TYPES, layers: SNAPSHOT.layers,
      dauTotal: SNAPSHOT.dauTotal, newContentShare: state.share,
      slotCap: state.slotCap, weeks: state.weeks, expoPerUser: state.zoneExpo * f
    });
    const comp = MODEL.buildCompMatrix(state.games, COMP_OVERRIDE, TYPES, SNAPSHOT.layers);
    return MODEL.solveZone(c2, comp, state.launchDate).best.X;
  };
  const lo = run(0.7), hi = run(1.3);
  const base = state.result ? state.result.res.best.X : lo;
  $("#sensNote").textContent = (lo === hi)
    ? `敏感度：专区曝光池 ±30% 区间内，最优节奏稳定在 ${lo} 个/周——当前瓶颈是槽位（${state.slotCap}）与候选池结构，而非曝光总量。`
    : `敏感度：专区曝光池 −30% → 最优 ${lo} 个/周；+30% → 最优 ${hi} 个/周（基准 ${base} 个/周）。最优节奏随活跃规模与曝光资源动态漂移，不是固定值。`;
}
/* ---------- 结果：周批次推荐 ---------- */
function renderWeeks(res) {
  const b = res.best;
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  if (!b.totalTitles) {
    $("#comboList").innerHTML = `<p class="hint">候选池中没有满足上线门槛（就绪度 ≥ ${MODEL.CFG.MIN_READINESS}）的玩法，请调整录入或勾选。</p>`;
    return;
  }
  $("#comboList").innerHTML = b.weeks.map(w => {
    const d = w.date;
    const chip = (g, cls, extra) => `<span class="wk-chip ${cls}">
        <b>${g.typeIcon} ${g.name}</b>
        <em>${g.typeName}${extra}</em>
      </span>`;
    const newChips = w.batch.map(g => {
      const pg = w.perGame.find(x => x.id === g.id);
      return chip(g, "new", ` · 本周新上 · 预估 ${fmt(pg ? pg.effWeek : 0)}/周`);
    }).join("");
    const oldChips = w.elder.map(g => {
      const pg = w.perGame.find(x => x.id === g.id);
      return chip(g, "old", ` · 在池第 2 周 · 残余 ${fmt(pg ? pg.effWeek : 0)}/周`);
    }).join("");
    const short = w.shortage ? `<span class="warn">库存不足 ${w.batch.length}/${b.X}</span>` : "";
    return `<div class="wk">
      <div class="wk-head">
        <span class="wk-date">${d.getMonth() + 1}/${d.getDate()} ${wd[d.getDay()]} 10:00</span>
        <span class="wk-idx">第 ${w.index} 批</span>
        <span class="wk-n">本批 ${w.batch.length} 个 · 在池 ${w.inPool} 个 ${short}</span>
      </div>
      <div class="wk-games">${newChips}${oldChips || ""}</div>
      <div class="wk-meta">
        <span>曝光需求 ${fmt(w.demand)} / 池容 ${fmt(state.result.ctx.zoneExpo)}</span>
        <span>稀释 <b class="${w.dil < 0.95 ? "down" : ""}">${pct(1 - w.dil, 0)}</b></span>
        <span>新批倾轧 <b class="${w.cannibal > 0.3 ? "down" : ""}">${pct(w.cannibal, 0)}</b></span>
        <span>本周有效新进 <b class="up">${fmt(w.effNew)}</b>（新批 ${fmt(w.newEff)} + 老批残余 ${fmt(w.elderEff)}）</span>
      </div>
    </div>`;
  }).join("");
}

/* ---------- 结果：漏斗（稳态周拆解） ---------- */
function renderFunnel(res) {
  const b = res.best;
  const wk = b.weeks.slice().sort((x, y) => y.inPool - x.inPool)[0];
  if (!wk || !wk.perGame.length) {
    $("#funnelSum").innerHTML = "等待有效候选";
    $("#funnelBars").innerHTML = "";
    return;
  }
  const W = 7;
  const cap = state.result.ctx.zoneExpo * W;
  const demand = wk.demand * W;
  const dl = MODEL.sum(wk.perGame.map(p => p.cvrJoin > 0 ? p.afterDil / p.cvrJoin : 0)) * W;
  const joinRaw = MODEL.sum(wk.perGame.map(p => p.afterDil)) * W;
  const eff = wk.effNew;

  $("#funnelSum").innerHTML = `稳态周（第 ${wk.index} 批，在池 ${wk.inPool} 个 · 7 天口径）
    <b>${fmt(eff)}</b>
    参与 ${fmt(joinRaw)} → 有效 ${fmt(eff)}（倾轧折损 ${pct(1 - eff / joinRaw, 0)}）`;

  const base = Math.max(cap, demand, 1);
  const rows = [
    { lab: "① 专区曝光池", v: cap, c: "#4fc3f7", note: `DAU × ${state.zoneExpo} 次/人/日 × 7 天` },
    { lab: "② 本周需求", v: demand, c: "#5c7cfa", note: `按新鲜度折减后（新批 ${MODEL.F1.toFixed(2)} / 老批 ${MODEL.F2.toFixed(2)}）` },
    { lab: "③ 下载/进入", v: dl, c: "#7c6cf5", note: "曝光→下载 " + pct(dl / Math.min(cap, demand), 1) },
    { lab: "④ 参与玩家", v: joinRaw, c: "#3ddc97", note: "下载→参与 " + pct(joinRaw / dl, 1) },
    { lab: "⑤ 有效新进", v: eff, c: "#f7b955", note: "扣除曝光稀释与倾轧" }
  ];
  $("#funnelBars").innerHTML = rows.map(r => `
    <div class="fb">
      <span class="lab">${r.lab}</span>
      <span class="track"><i style="width:${Math.max(2, Math.min(100, r.v / base * 100))}%;background:linear-gradient(90deg,${r.c},${r.c}66)"></i></span>
      <span class="val">${fmt(r.v)}<em>${r.note}</em></span>
    </div>`).join("");
}

/* ---------- 结果：专区在池甘特（14 天留存） ---------- */
function renderGantt(res) {
  const b = res.best;
  if (!b.totalTitles) {
    $("#timeline").innerHTML = `<p class="hint">无可排期玩法。</p>`;
    return;
  }
  const weeks = b.weeks;
  let html = `<div class="gantt" style="grid-template-columns:150px repeat(${weeks.length},1fr)">`;
  html += `<div class="gh"></div>` + weeks.map(w => `<div class="gh"><b>第 ${w.index} 周</b><em>${w.date.getMonth() + 1}/${w.date.getDate()} 周三</em></div>`).join("");
  weeks.forEach(w => {
    w.batch.forEach(g => {
      html += `<div class="gn"><i style="background:${g.typeColor}"></i>${g.name}</div>`;
      weeks.forEach(w2 => {
        if (w2.index === w.index) {
          html += `<div class="gc new" title="上架第 1 周：全量曝光">${g.typeIcon} 上架</div>`;
        } else if (w2.index === w.index + 1) {
          html += `<div class="gc old" title="在池第 2 周：新鲜度 ${MODEL.F2.toFixed(2)}，第 14 天退池">留存</div>`;
        } else {
          html += `<div class="gc"></div>`;
        }
      });
    });
  });
  html += `</div>`;
  $("#timeline").innerHTML = html;
}

/* ---------- 事件绑定 ---------- */
function bind() {
  $("#launchDate").value = state.launchDate;
  $("#weeks").value = state.weeks;
  $("#slotCap").value = state.slotCap;
  $("#zoneExpo").value = state.zoneExpo;

  $("#launchDate").addEventListener("change", e => { state.launchDate = e.target.value; runModel(); });
  $("#weeks").addEventListener("change", e => { state.weeks = Math.max(1, +e.target.value || 4); runModel(); });
  $("#slotCap").addEventListener("change", e => { state.slotCap = Math.max(2, +e.target.value || 12); runModel(); });
  $("#zoneExpo").addEventListener("change", e => { state.zoneExpo = Math.max(0.1, +e.target.value || 0.9); runModel(); });
  $("#shareRange").addEventListener("input", e => {
    state.share = +e.target.value;
    renderDau();
    runModel();
  });
  $("#btnRun").addEventListener("click", runModel);
  $("#btnReset").addEventListener("click", () => {
    state.games = GAMEPLAY_POOL.map(g => ({ ...g, picked: true }));
    state.share = 22; state.launchDate = FIRST_WED; state.weeks = 4; state.slotCap = 12; state.zoneExpo = 3.2;
    $("#launchDate").value = state.launchDate; $("#weeks").value = 4; $("#slotCap").value = 12; $("#zoneExpo").value = 3.2;
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
