/* =========================================================
 * model.js —— 上架节奏预估模型
 * 目标：在 k 个玩法的组合空间里，最大化「有效新进 − 覆盖缺口惩罚」
 * 结构：曝光漏斗 → 共享资源稀释（跨类型） → 同质化倾轧（同类型/标签） → 需求覆盖
 * ========================================================= */

const MODEL = (() => {

  const CFG = {
    EXPO_SLOTS_PER_USER: 3.2,   // 人均可分配新内容曝光位（次/日）
    LOAD_REF: 0.10,             // 单玩法典型注意力占用（归一化基准）
    GAMMA: 0.55,                // 同质化倾轧强度
    COVER_TARGET: 0.06,         // 单类型期望覆盖：该类型需求的 6% 由新内容承接
    LAMBDA_UNDER: 30,           // 覆盖缺口惩罚系数
    MIN_READINESS: 0.75,        // 上线门槛
    BATCH_CAP: 3,               // 单批次最多上架数
    SAME_TYPE_DAMP: 0.55        // 竞争强度中的同类型基础分
  };

  const WEEK_DAYS = 7;          // 周批次日历跨度

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  /* 单玩法「整个周期内的累计新进玩家数上限」：未填 = 不设上限 */
  const capOf = (g) => (g && g.capNew != null && g.capNew > 0 ? g.capNew : Infinity);

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
        cap: capOf(g),
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
      const eff = Math.min(afterDil * damp, capOf(g));   // 受周期累计上限约束
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

  /* =========================================================
   * 上新专区分批滚动模型
   * 规则：每周三 10:00 同时上架 X 个；每个玩法在专区曝光 14 天后退池
   *  => 任意时刻在池 = 本周批(B_w) + 上周批(B_{w-1})，共 2X 个（受专区槽位 S 约束）
   * ========================================================= */
  const ZONE = {
    RETENTION_DAYS: 14,   // 专区留存天数，到期退池
    DECAY: 0.55,          // 14 天末曝光权重（新鲜度衰减幅度）
    EXPO_PER_USER: 3.2,   // 人均每日可分配到「上新专区」的曝光次数
    SLOT_CAP: 12,         // 专区同时容纳的玩法槽位
    WEEKS: 4              // 规划周数
  };

  /* 单日新鲜度：第 1 天 1.0，第 14 天 1-DECAY */
  function freshness(day) {
    const n = ZONE.RETENTION_DAYS;
    return 1 - ZONE.DECAY * (day - 1) / (n - 1);
  }
  /* 两周各自的平均新鲜度（14 天 = 2 个周批） */
  const F1 = (() => { let s = 0; for (let d = 1; d <= 7; d++) s += freshness(d); return s / 7; })();
  const F2 = (() => { let s = 0; for (let d = 8; d <= 14; d++) s += freshness(d); return s / 7; })();

  /* 专区上下文：曝光池与槽位约束 */
  function buildZoneContext(input) {
    const ctx = buildContext(input);
    const slotCap = input.slotCap || ZONE.SLOT_CAP;
    const weeks = input.weeks || ZONE.WEEKS;
    const zoneExpo = input.dauTotal * (input.expoPerUser || ZONE.EXPO_PER_USER);
    // 14 天跨两个周批 → 单批上限由槽位对半分
    const maxBatch = Math.max(1, Math.floor(slotCap / 2));
    return { ...ctx, slotCap, weeks, zoneExpo, maxBatch, F1, F2 };
  }

  /* 某一周：本周批(batch) + 在池老批(elder)，算这一周的有效新进与拥挤情况
   * used: { gameId: 该玩法在此前各周已累计的新进量 } —— 用于扣减「周期累计上限」 */
  function evalWeek(batch, elder, ctx, comp, used) {
    const pool = [...batch.map(g => ({ g, f: F1 })), ...elder.map(g => ({ g, f: F2 }))];
    if (!pool.length) {
      return { effNew: 0, demand: 0, dil: 1, cannibal: 0, perGame: [], coverage: 0,
        coverageByType: {}, underPenalty: 0, gain: 0, effDay: 0, elderEff: 0,
        cappedEff: 0, cappedCount: 0 };
    }
    const demand = sum(pool.map(x => x.g.expo * x.f));
    const dil = Math.min(1, ctx.zoneExpo / (demand || 1));
    // 相对注意力份额：均分时 = 1，曝光抢得越多对同池玩法压力越大
    const N = pool.length;
    const rel = pool.map(x => ((x.g.expo * x.f) / (demand || 1)) * N);

    const perGame = pool.map((x, i) => {
      let pressure = 0;
      pool.forEach((o, j) => {
        if (i === j) return;
        pressure += (comp[x.g.id] ? comp[x.g.id][o.g.id] || 0 : 0) * rel[j];
      });
      const damp = 1 / (1 + CFG.GAMMA * pressure);
      const afterDil = x.g.expo * x.f * dil * x.g.cvrDownload * x.g.cvrJoin;   // 日均
      const eff = afterDil * damp;                                            // 扣倾轧后日均
      // —— 周期累计上限：曝光照旧占用专区，但触顶后不再产出新进
      const cap = capOf(x.g);
      const usedBefore = used ? (used[x.g.id] || 0) : 0;
      const remain = Math.max(0, cap - usedBefore);
      const effWeekRaw = eff * WEEK_DAYS;
      const effWeek = Math.min(effWeekRaw, remain);
      const cum = usedBefore + effWeek;
      return {
        ...x.g, f: x.f, ageWeek: x.f === F1 ? 1 : 2, isNew: x.f === F1,
        pressure, damp, dilution: dil, afterDil, effNew: eff,
        effWeek, effWeekRaw, cap, usedBefore, remain, cum,
        capRate: isFinite(cap) ? clamp(cum / cap, 0, 1) : 0,
        capped: effWeekRaw > remain + 1e-9,
        exhausted: remain <= 1e-9,
        cannibalRate: afterDil > 0 ? (afterDil - eff) / afterDil : 0,
        qualityW: 0.55 + 0.45 * x.g.quality
      };
    });

    const effDay = sum(perGame.map(x => x.effNew));
    const effNew = sum(perGame.map(x => x.effWeek));                          // 本周 7 天实际累计（受上限约束）
    const cappedEff = sum(perGame.map(x => x.effWeekRaw - x.effWeek));        // 被上限截掉的量
    const gain = sum(perGame.map(x => x.effWeek * x.qualityW)) / ctx.unit;

    const coverageByType = {};
    let under = 0;
    ctx.types.forEach(t => {
      const serve = sum(perGame.filter(x => x.type === t.key).map(x => x.effWeek * x.qualityW));
      const target = ctx.dauTotal * t.demand * CFG.COVER_TARGET * WEEK_DAYS;
      const cover = target > 0 ? Math.min(1, serve / target) : 1;
      coverageByType[t.key] = { cover, serve, target, demand: t.demand, name: t.name, color: t.color };
      under += t.demand * Math.pow(1 - cover, 2);
    });

    const newOnly = perGame.filter(x => x.isNew);
    const afterDilSum = sum(newOnly.map(x => x.afterDil));
    return {
      effNew, gain, demand, dil, perGame,
      cannibal: afterDilSum > 0 ? sum(newOnly.map(x => x.afterDil * x.cannibalRate)) / afterDilSum : 0,
      coverage: sum(ctx.types.map(t => coverageByType[t.key].demand * coverageByType[t.key].cover)),
      coverageByType, underPenalty: under * CFG.LAMBDA_UNDER, effDay,
      cappedEff, cappedCount: perGame.filter(x => x.capped).length,
      elderEff: sum(perGame.filter(x => !x.isNew).map(x => x.effWeek))
    };
  }

  /* 选本周批：在「在池老批」的约束下贪心选 X 个，使本周效用最大
   * 已触顶（累计新进 = 周期上限）的玩法边际产出为 0，不会被继续选中 */
  function pickBatch(weekIndex, X, stock, elder, ctx, comp, used) {
    const chosen = [];
    while (chosen.length < X) {
      let best = null, bestU = -Infinity;
      let base = chosen.length ? evalWeek(chosen, elder, ctx, comp, used) : null;
      const baseU = base ? base.gain - base.underPenalty : 0;
      stock.forEach(g => {
        if (chosen.includes(g)) return;
        if ((used && used[g.id] || 0) >= capOf(g) - 1e-9) return;   // 周期上限已用尽
        const ev = evalWeek([...chosen, g], elder, ctx, comp, used);
        const u = ev.gain - ev.underPenalty;
        if (u > bestU + 1e-9) { bestU = u; best = g; }
      });
      // 选满 X 个；若已选过且边际为负则停止，避免给更小的 X 重复计入
      if (!best || (chosen.length && bestU <= baseU + 1e-9)) break;
      chosen.push(best);
    }
    return chosen;
  }

  /* 滚动推演 W 周 */
  function rollout(X, pool, ctx, comp, launchDate) {
    let stock = pool.slice();
    let elder = [];
    const weeks = [];
    const used = {};        // 每个玩法在规划周期内已累计的新进量
    const cumByGame = {};   // 每个玩法的周期累计 vs 上限
    let totalEff = 0, totalGain = 0, totalUnder = 0, peakPool = 0, dilSum = 0, canSum = 0, cappedEff = 0;

    for (let w = 0; w < ctx.weeks; w++) {
      const batch = pickBatch(w, X, stock, elder, ctx, comp, used);
      stock = stock.filter(g => !batch.includes(g));
      const ev = evalWeek(batch, elder, ctx, comp, used);
      const d = weekDate(launchDate, w);
      weeks.push({
        index: w + 1, date: d, batch, elder: elder.slice(),
        inPool: batch.length + elder.length,
        effNew: ev.effNew, newEff: sum(ev.perGame.filter(x => x.isNew).map(x => x.effWeek)),
        elderEff: ev.elderEff, demand: ev.demand, dil: ev.dil,
        cannibal: ev.cannibal, coverage: ev.coverage,
        coverageByType: ev.coverageByType, underPenalty: ev.underPenalty,
        gain: ev.gain, perGame: ev.perGame, shortage: batch.length < X,
        cappedEff: ev.cappedEff, cappedCount: ev.cappedCount
      });
      // 结转累计量
      ev.perGame.forEach(p => {
        used[p.id] = p.cum;
        const prev = cumByGame[p.id];
        cumByGame[p.id] = {
          id: p.id, name: p.name, typeName: p.typeName, typeIcon: p.typeIcon, typeColor: p.typeColor,
          cap: p.cap, cum: p.cum, capRate: p.capRate,
          natural: p.baseNew * (F1 + F2) * WEEK_DAYS,   // 无稀释、无倾轧时的 14 天自然产出
          firstWeek: prev ? prev.firstWeek : w + 1,
          hitWeek: p.capped ? (prev && prev.hitWeek ? prev.hitWeek : w + 1) : (prev ? prev.hitWeek : null),
          capped: p.capped || (prev ? prev.capped : false),
          touched: true
        };
      });
      totalEff += ev.effNew; totalGain += ev.gain; totalUnder += ev.underPenalty;
      cappedEff += ev.cappedEff;
      peakPool = Math.max(peakPool, batch.length + elder.length);
      dilSum += ev.dil; canSum += ev.cannibal;
      elder = batch;
    }
    const cappedGames = Object.values(cumByGame)
      .filter(c => isFinite(c.cap) && c.cum >= c.cap - 1e-6)
      .sort((a, b) => b.capRate - a.capRate);
    return {
      X, weeks, totalTitles: sum(weeks.map(w => w.batch.length)),
      totalEff, gain: totalGain, underPenalty: totalUnder,
      utility: totalGain - totalUnder,
      peakPool, avgDil: dilSum / ctx.weeks, avgCannibal: canSum / ctx.weeks,
      coverage: weeks[weeks.length - 1] ? weeks[weeks.length - 1].coverage : 0,
      shortages: weeks.filter(w => w.shortage).length,
      cumByGame, cappedGames, cappedEff
    };
  }

  /* 首个上架日：默认取下一个周三 */
  function nextWednesday(from) {
    const d = from ? new Date(from + "T00:00:00") : new Date();
    const wd = d.getDay();
    const add = (3 - wd + 7) % 7;
    d.setDate(d.getDate() + add);
    return d;
  }
  function weekDate(launchDate, w) {
    const d = new Date(launchDate + "T10:00:00");
    d.setDate(d.getDate() + w * 7);
    return d;
  }

  /* 求解：遍历每周上架数 X，取四周累计效用最高者 */
  function solveZone(ctx, comp, launchDate) {
    const pool = ctx.games.filter(g => g.ready);
    const curve = [];
    const capX = Math.min(ctx.maxBatch, Math.max(1, pool.length));
    for (let X = 0; X <= capX; X++) {
      curve.push(rollout(X, pool, ctx, comp, launchDate));
    }
    let best = curve[0];
    curve.forEach(c => { if (c.utility > best.utility + 1e-9) best = c; });
    return {
      curve, best, pool, candidates: pool.length, maxBatch: ctx.maxBatch,
      excluded: ctx.games.filter(g => !g.ready),
      F1, F2
    };
  }

  return {
    CFG, ZONE, F1, F2, WEEK_DAYS, freshness, weekDate, nextWednesday, capOf,
    competition, buildCompMatrix, typeActive, buildContext, buildZoneContext,
    evaluate, evalWeek, rollout, solveZone, solve, schedule, clamp, sum
  };

})();
