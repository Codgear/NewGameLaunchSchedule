/* =========================================================
 * model.js —— 上架节奏预估模型
 * 目标：在 k 个玩法的组合空间里，最大化「有效新进 − 覆盖缺口惩罚」
 * 结构：曝光漏斗 → 共享资源稀释（跨类型） → 同质化倾轧（同类型/标签） → 需求覆盖
 * ========================================================= */

const MODEL = (() => {

  const CFG = {
    EXPO_SLOTS_PER_USER: 3.2,   // 人均可分配新内容曝光位（次/日）
    LOAD_REF: 0.10,             // 单玩法典型注意力占用（归一化基准）
    GAMMA: 0.34,                // 同质化倾轧强度
    COVER_TARGET: 0.20,         // 单类型期望覆盖：该类型需求的 20% 由新内容承接
    LAMBDA_UNDER: 14,           // 覆盖缺口惩罚系数
    MIN_READINESS: 0.75,        // 上线门槛
    BATCH_CAP: 3,               // 单批次最多上架数
    SAME_TYPE_DAMP: 0.55        // 竞争强度中的同类型基础分
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  /* 受众重叠：类型在三分层上的活跃结构余弦相似度 */
  function typeOverlap(t1, t2, layers) {
    const a = typeActive(t1, layers), b = typeActive(t2, layers);
    let dot = 0, na = 0, nb = 0;
    layers.forEach(l => {
      const x = (a[l.key] || 0) / (a.total || 1);
      const y = (b[l.key] || 0) / (b.total || 1);
      dot += x * y; na += x * x; nb += y * y;
    });
    return dot / Math.sqrt(na * nb || 1);
  }

  /* 竞争强度 = 同类型/标签同质化 ⊕ 受众重叠（打标覆盖优先） */
  function competition(a, b, override, types, layers) {
    if (a.id === b.id) return 0;
    const key = [a.id, b.id].sort().join("|");
    if (override && override[key] != null) return override[key];
    const A = new Set(a.tags), B = new Set(b.tags);
    let inter = 0;
    A.forEach(t => { if (B.has(t)) inter++; });
    const jac = inter / (A.size + B.size - inter || 1);
    const sameType = a.type === b.type ? 1 : 0;
    const base = CFG.SAME_TYPE_DAMP * sameType + (1 - CFG.SAME_TYPE_DAMP) * jac;
    let ov = 0;
    if (types && layers) {
      const t1 = types.find(x => x.key === a.type), t2 = types.find(x => x.key === b.type);
      if (t1 && t2) ov = typeOverlap(t1, t2, layers);
    }
    return clamp(1 - (1 - base) * (1 - 0.42 * ov), 0, 1);
  }

  function buildCompMatrix(games, override, types, layers) {
    const m = {};
    games.forEach(a => {
      m[a.id] = {};
      games.forEach(b => { m[a.id][b.id] = competition(a, b, override, types, layers); });
    });
    return m;
  }

  function typeActive(type, layers) {
    const out = {};
    layers.forEach(l => { out[l.key] = (type.active[l.key] || 0) * l.dau; });
    out.total = sum(layers.map(l => out[l.key]));
    return out;
  }

  /* 上下文：入参预处理 */
  function buildContext(input) {
    const { games, types, layers, dauTotal, newContentShare } = input;
    const budgetMin = sum(layers.map(l => l.dau * l.avgMin)) * (newContentShare / 100);
    const expoCap = dauTotal * CFG.EXPO_SLOTS_PER_USER;

    const enriched = games.map(g => {
      const t = types.find(x => x.key === g.type) || types[0];
      const baseNew = g.expo * g.cvrDownload * g.cvrJoin;
      return {
        ...g,
        typeName: t.name, typeColor: t.color, typeIcon: t.icon,
        minPerNew: t.minPerNew, demand: t.demand,
        baseNew,
        load: (baseNew * t.minPerNew) / budgetMin,
        ready: g.readiness >= CFG.MIN_READINESS
      };
    });

    const typeStat = {};
    types.forEach(t => { typeStat[t.key] = typeActive(t, layers); });

    return { games: enriched, types, layers, dauTotal, budgetMin, expoCap, typeStat, newContentShare, unit: dauTotal / 1000 };
  }
  /* 核心评估 */
  function evaluate(ids, ctx, comp) {
    const picked = ids.map(id => ctx.games.find(g => g.id === id)).filter(Boolean);
    if (!picked.length) {
      return { ids: [], picked: [], k: 0, effNew: 0, baseNew: 0, utility: 0, gain: 0,
        underPenalty: 0, dilExpo: 1, dilLoad: 1, dilution: 1, totalLoad: 0,
        cannibalRate: 0, coverage: 0, coverageByType: {}, perGame: [], sumExpo: 0 };
    }

    const sumExpo = sum(picked.map(g => g.expo));
    const totalLoad = sum(picked.map(g => g.load));
    const dilExpo = Math.min(1, ctx.expoCap / sumExpo);
    const dilLoad = Math.min(1, 1 / totalLoad);
    const dilution = dilExpo * dilLoad;

    const relLoad = {};
    picked.forEach(g => { relLoad[g.id] = (g.load * dilution) / CFG.LOAD_REF; });

    const perGame = picked.map(g => {
      let pressure = 0;
      picked.forEach(o => {
        if (o.id === g.id) return;
        pressure += (comp[g.id] ? comp[g.id][o.id] || 0 : 0) * relLoad[o.id];
      });
      const damp = 1 / (1 + CFG.GAMMA * pressure);
      const afterDil = g.baseNew * dilution;
      const eff = afterDil * damp;
      return {
        ...g, pressure, damp, dilution,
        afterDil, effNew: eff,
        lostToCannibal: afterDil - eff,
        cannibalRate: afterDil > 0 ? (afterDil - eff) / afterDil : 0,
        qualityW: 0.55 + 0.45 * g.quality
      };
    });

    const effNew = sum(perGame.map(x => x.effNew));
    const gain = sum(perGame.map(x => x.effNew * x.qualityW)) / ctx.unit;

    const coverageByType = {};
    let under = 0;
    ctx.types.forEach(t => {
      const serve = sum(perGame.filter(x => x.type === t.key)
        .map(x => x.effNew * (0.55 + 0.45 * x.quality)));
      const target = ctx.dauTotal * t.demand * CFG.COVER_TARGET;
      const cover = target > 0 ? Math.min(1, serve / target) : 1;
      coverageByType[t.key] = { cover, serve, target, demand: t.demand, name: t.name, color: t.color };
      under += t.demand * Math.pow(1 - cover, 2);
    });
    const underPenalty = under * CFG.LAMBDA_UNDER;

    const avgCover = sum(ctx.types.map(t => coverageByType[t.key].demand * coverageByType[t.key].cover));
    const afterDilSum = sum(perGame.map(x => x.afterDil));
    const cannibalRate = sum(perGame.map(x => x.afterDil * x.cannibalRate)) / Math.max(1, afterDilSum);

    return {
      ids: picked.map(g => g.id), picked: perGame, k: picked.length,
      effNew, baseNew: sum(picked.map(g => g.baseNew)),
      gain, underPenalty, utility: gain - underPenalty,
      dilExpo, dilLoad, dilution, totalLoad, cannibalRate,
      coverage: avgCover, coverageByType, sumExpo
    };
  }

  /* 寻优：贪心构造 + 局部交换 */
  function greedy(k, pool, ctx, comp) {
    const chosen = [];
    while (chosen.length < k) {
      let best = null, bestScore = -Infinity;
      pool.forEach(g => {
        if (chosen.includes(g.id)) return;
        const s = evaluate([...chosen, g.id], ctx, comp).utility;
        if (s > bestScore) { bestScore = s; best = g.id; }
      });
      if (!best) break;
      chosen.push(best);
    }
    for (let pass = 0; pass < 6; pass++) {
      let improved = false;
      const cur = evaluate(chosen, ctx, comp).utility;
      for (let i = 0; i < chosen.length && !improved; i++) {
        for (const g of pool) {
          if (chosen.includes(g.id)) continue;
          const trial = chosen.slice(); trial[i] = g.id;
          if (evaluate(trial, ctx, comp).utility > cur + 1e-9) {
            chosen[i] = g.id; improved = true; break;
          }
        }
      }
      if (!improved) break;
    }
    return chosen;
  }

  function solve(ctx, comp) {
    const pool = ctx.games.filter(g => g.ready);
    const curve = [];
    for (let k = 0; k <= pool.length; k++) {
      const ids = k === 0 ? [] : greedy(k, pool, ctx, comp);
      curve.push({ k, ...evaluate(ids, ctx, comp) });
    }
    let best = curve[0];
    curve.forEach(c => { if (c.utility > best.utility + 1e-9) best = c; });
    return { curve, best, pool, candidates: pool.length,
      excluded: ctx.games.filter(g => !g.ready) };
  }
  /* 排期：按竞争强度做图着色分批，批次之间保持最小间隔 */
  function schedule(best, comp, launchDate, windowDays, minGap, batchCap) {
    const BATCH_CAP = batchCap || CFG.BATCH_CAP;
    const games = best.picked.slice()
      .sort((a, b) => (b.effNew * b.qualityW) - (a.effNew * a.qualityW));

    const batches = [];
    games.forEach(g => {
      let placed = false;
      for (const b of batches) {
        const conflict = b.games.some(o => (comp[g.id][o.id] || 0) >= 0.55);
        if (!conflict && b.games.length < BATCH_CAP) { b.games.push(g); placed = true; break; }
      }
      if (!placed) batches.push({ games: [g] });
    });

    const start = new Date(launchDate + "T00:00:00");
    return batches.map((b, i) => {
      const d = new Date(start.getTime() + i * minGap * 86400000);
      const inWindow = (d - start) / 86400000 <= windowDays;
      return {
        index: i + 1, date: d, inWindow,
        games: b.games,
        exposure: sum(b.games.map(x => x.expo)),
        effNew: sum(b.games.map(x => x.effNew))
      };
    });
  }

  return { CFG, competition, buildCompMatrix, typeActive, buildContext, evaluate, solve, schedule, clamp, sum };

})();
