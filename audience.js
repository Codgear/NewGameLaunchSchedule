/* =========================================================
 * audience.js —— 人群名单层：画像宇宙 → 名单（bitset）→ 重叠度 → 获客可行性
 * 真实环境：把「宇宙生成」换成画像平台 / 名单服务返回的玩家 ID 集合，
 *          下面的重叠计算与可行性判断口径不变。
 * ========================================================= */

const AUD_MODEL = (() => {

  const CFG = {
    GRAY_TO_POTENTIAL: 9,  // 灰度参与人数 → 潜在人群规模 的放大倍数（灰度只触达早期尝鲜者）
    MIN_MAU_SHARE: 0.015,  // 潜在人群下限
    MAX_MAU_SHARE: 0.34,   // 潜在人群上限（占 MAU）
    W_LAYER: 0.40,         // 打分：分层亲和权重
    W_TAG: 0.44,           // 打分：标签余弦权重
    W_MASS: 0.16,          // 打分：大众人群成分（所有玩法共享，产生基础重叠）
    RIVAL_DISCOUNT: 0.45,  // 竞品覆盖带来的转化折损上限
    BATCH_DISCOUNT: 0.35,  // 同批人群重叠带来的内耗折损上限
    BINS: 240              // 分桶数（按打分直方图取阈值，O(N)）
  };

  /* ---------- 确定性伪随机 ---------- */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const count = (m) => { let c = 0; for (let i = 0; i < m.length; i++) if (m[i]) c++; return c; };
  function andCount(a, b) { let c = 0; for (let i = 0; i < a.length; i++) if (a[i] && b[i]) c++; return c; }
  function orInto(target, src) { for (let i = 0; i < src.length; i++) if (src[i]) target[i] = 1; return target; }
  function sub(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] && !b[i] ? 1 : 0; return o; }

  /* ---------- 1. 生成画像宇宙（模拟玩家名单） ---------- */
  function buildUniverse(opts) {
    const { games, liveGames, types, layers, universeN, mauTotal, seed } = opts;
    const N = universeN;
    const rand = mulberry32(seed || 20261104);
    const lexicon = [...new Set([...games, ...liveGames].flatMap(g => g.tags))];
    const L = lexicon.length;
    const tagIdx = {}; lexicon.forEach((t, i) => (tagIdx[t] = i));

    /* 标签热度：被多少玩法使用（越通用越容易被偏好） */
    const tagPop = lexicon.map(t => {
      const n = games.filter(g => g.tags.includes(t)).length * 0.8 +
        liveGames.filter(g => g.tags.includes(t)).length * 1.2;
      return Math.pow(n + 0.5, 0.75);
    });
    const tagPopSum = sum(tagPop);

    const layerDau = layers.map(l => l.dau);
    const layerSum = sum(layerDau);
    const layerP = layerDau.map(d => d / layerSum);
    const layerKey = layers.map(l => l.key);

    const mauProb = { core: 0.99, mid: 0.965, light: 0.87 };
    const winProb = { core: 0.985, mid: 0.93, light: 0.72 };

    const n = N;
    const layerOf = new Uint8Array(n);
    const tagMask = new Uint32Array(n);
    const baseDraw = new Float32Array(n);
    const mau = new Uint8Array(n);
    const win = new Uint8Array(n);

    const pickLayer = () => {
      let r = rand(), acc = 0;
      for (let i = 0; i < layerP.length; i++) { acc += layerP[i]; if (r <= acc) return i; }
      return layerP.length - 1;
    };

    for (let p = 0; p < n; p++) {
      const li = pickLayer();
      layerOf[p] = li;
      const lk = layerKey[li];
      /* 每个玩家 3~6 个偏好标签 */
      const k = 3 + Math.floor(rand() * 4);
      let mask = 0;
      for (let j = 0; j < k; j++) {
        /* 分层偏置：核心玩家更偏硬核/竞技/剧情，泛用户更偏休闲/单局短/社交 */
        let r = rand() * tagPopSum, acc = 0, picked = L - 1;
        for (let t = 0; t < L; t++) {
          let w = tagPop[t];
          const tag = lexicon[t];
          if (lk === "core" && ["硬核", "排位", "战术", "Roguelike", "剧情"].includes(tag)) w *= 1.9;
          if (lk === "light" && ["休闲", "单局短", "社交", "解谜", "养成"].includes(tag)) w *= 1.9;
          if (lk === "mid" && ["团队", "收集", "建造", "竞技"].includes(tag)) w *= 1.4;
          acc += w;
          if (r <= acc) { picked = t; break; }
        }
        mask |= 1 << picked;
      }
      tagMask[p] = mask;
      baseDraw[p] = rand();            // 大众人群成分（所有玩法共享，制造基础重叠）
      if (rand() < (mauProb[lk] || 0.9)) {
        mau[p] = 1;
        if (rand() < (winProb[lk] || 0.8)) win[p] = 1;
      }
    }

    /* 每个玩法的玩家名单：由「分层亲和 × 标签匹配 × 历史曝光规模」决定 */
    const typeByKey = {}; types.forEach(t => (typeByKey[t.key] = t));
    const maxActive = {}; types.forEach(t => (maxActive[t.key] = Math.max(...layers.map(l => t.active[l.key] || 0)) || 1));

    function makePlayed(game, base) {
      const mask = new Uint8Array(n);
      const t = typeByKey[game.type] || types[0];
      const gmask = game.tags.reduce((m, tg) => (tagIdx[tg] != null ? m | (1 << tagIdx[tg]) : m), 0);
      const gTags = game.tags.length;
      for (let p = 0; p < n; p++) {
        const li = layerOf[p];
        const lk = layerKey[li];
        const lf = (t.active[lk] || 0) / maxActive[game.type];
        let inter = 0, m = tagMask[p] & gmask;
        while (m) { inter += m & 1; m >>>= 1; }
        const fit = Math.min(1, inter / Math.max(2, Math.min(3, gTags)));
        const prob = base * lf * (0.25 + 0.95 * fit);
        if (prob > 0.001 && rand() < prob) mask[p] = 1;
      }
      return mask;
    }

    const played = {}, retained = {};
    games.forEach(g => { played[g.id] = makePlayed(g, 0.10 + 0.10 * (g.quality || 0.7)); });
    liveGames.forEach(g => {
      played[g.id] = makePlayed(g, 0.18 + 1.05 * g.reach);
      const r = new Uint8Array(n);
      for (let p = 0; p < n; p++) if (played[g.id][p] && mau[p] && rand() < g.retain) r[p] = 1;
      retained[g.id] = r;
    });

    /* 已上线留存玩家名单的并集（缓存，避免每次都重算） */
    const liveUnion = new Uint8Array(n);
    liveGames.forEach(g => orInto(liveUnion, retained[g.id]));

    const mauN = count(mau), winN = count(win);
    return {
      n, lexicon, tagIdx, layerOf, tagMask, baseDraw, mau, win, played, retained, liveUnion,
      mauN, winN,
      scale: mauTotal / Math.max(1, mauN),      // 宇宙 → 全量 MAU 的放大系数
      mauTotal, universeN: n
    };
  }

  /* ---------- 2. 潜在人群名单（lookalike） ---------- */
  const cache = new Map();
  const profileCache = new Map();

  function potentialOf(uni, game, rivals, gray) {
    const grayN = gray ? (gray.participants || 0) : 0;
    const key = game.id + "|" + rivals.join(",") + "|" + game.tags.join(",") + "|" + grayN;
    if (cache.has(key)) return cache.get(key);

    const N = uni.n, L = uni.lexicon.length;
    const seed = uni.played[game.id] || new Uint8Array(N);
    const arche = new Uint8Array(N);
    orInto(arche, seed);
    rivals.forEach(id => { if (uni.played[id]) orInto(arche, uni.played[id]); });

    /* 画像原型：标签直方图 + 分层结构 */
    const hist = new Float64Array(L);
    let archN = 0;
    const layerCnt = [0, 0, 0];
    for (let p = 0; p < N; p++) {
      if (!arche[p]) continue;
      archN++;
      layerCnt[uni.layerOf[p]]++;
      let m = uni.tagMask[p];
      for (let t = 0; t < L; t++) if ((m >>> t) & 1) hist[t] += 1;
    }
    if (!archN) {
      const empty = new Uint8Array(N);
      cache.set(key, { mask: empty, size: 0, layerMix: [0, 0, 0] });
      return cache.get(key);
    }
    histogramNormalize(hist);
    const layerShare = layerCnt.map(c => c / archN);

    /* 打分：0.45 分层亲和 + 0.55 标签余弦 */
    const score = new Float32Array(N);
    for (let p = 0; p < N; p++) {
      let dot = 0, na = 0;
      let m = uni.tagMask[p];
      for (let t = 0; t < L; t++) if ((m >>> t) & 1) { dot += hist[t]; na += 1; }
      const cos = na ? dot / Math.sqrt(na * 1) : 0;      // hist 已归一（||h||=1）
      const lf = layerShare[uni.layerOf[p]] / Math.max(...layerShare);
      score[p] = CFG.W_LAYER * lf + CFG.W_TAG * Math.min(1, cos / 0.62) + CFG.W_MASS * uni.baseDraw[p];
    }

    /* 目标名单规模：灰度期参与人数 × 放大倍数（灰度只触达早期尝鲜者），
       上下限约束在 MAU 的 1.5% ~ 34% */
    const rawTarget = grayN > 0
      ? (grayN / uni.mauTotal) * CFG.GRAY_TO_POTENTIAL
      : archN / Math.max(1, uni.mauN);
    const targetShare = Math.min(CFG.MAX_MAU_SHARE, Math.max(CFG.MIN_MAU_SHARE, rawTarget));
    const targetN = Math.floor(uni.mauN * targetShare);

    /* 阈值：按打分直方图从高到低累计到目标规模（O(N)，无需排序） */
    const BINS = CFG.BINS;
    const histo = new Int32Array(BINS + 1);
    for (let p = 0; p < N; p++) if (uni.mau[p]) histo[Math.min(BINS, Math.floor(score[p] * BINS))]++;
    let acc = 0, cut = BINS;
    while (cut > 0 && acc + histo[cut] < targetN) { acc += histo[cut]; cut--; }
    const theta = cut / BINS;

    /* 填名单：先装满阈值以上的桶，再从临界桶按索引顺序补足到目标规模（名单规模严格等于 targetN） */
    const mask = new Uint8Array(N);
    let c = 0;
    for (let p = 0; p < N; p++) {
      if (uni.mau[p] && score[p] >= theta + 1 / BINS) { mask[p] = 1; c++; }
    }
    for (let p = 0; p < N && c < targetN; p++) {
      if (!mask[p] && uni.mau[p] && score[p] >= theta) { mask[p] = 1; c++; }
    }

    const res = { mask, size: c, theta, targetShare, layerMix: layerShare, archeN: archN };
    cache.set(key, res);
    return res;
  }

  function histogramNormalize(h) {
    let nrm = 0;
    for (let i = 0; i < h.length; i++) nrm += h[i] * h[i];
    nrm = Math.sqrt(nrm) || 1;
    for (let i = 0; i < h.length; i++) h[i] /= nrm;
    return h;
  }

  /* ---------- 3. 重叠度 ---------- */
  function jaccard(a, b) {
    const i = andCount(a, b);
    const u = count(a) + count(b) - i;
    return u ? i / u : 0;
  }

  /* 单个待上架玩法的完整人群画像 */
  function profile(uni, game, input, liveIds) {
    const rivals = (input.rivals || []).map(id => ({ id, inPool: !!uni.played[id] }));
    const pkey = game.id + "|" + rivals.map(r => r.id).join(",") + "|" + (input.gray ? input.gray.participants : 0);
    if (profileCache.has(pkey)) return { ...profileCache.get(pkey), game };

    const pot = potentialOf(uni, game, rivals.map(r => r.id).filter(id => uni.played[id]), input.gray);

    const rivalAll = new Uint8Array(uni.n);
    rivals.forEach(r => { if (uni.retained[r.id]) orInto(rivalAll, uni.retained[r.id]); });

    const inMau = andCount(pot.mask, uni.mau);
    const inWin = andCount(pot.mask, uni.win);
    const withLive = andCount(pot.mask, uni.liveUnion);   // 与已上线玩法留存名单（并集）
    const withRival = andCount(pot.mask, rivalAll);
    const pureNew = pot.size - withLive;
    const s = uni.scale;

    const res = {
      game, size: pot.size * s, sizeRaw: pot.size, mask: pot.mask,
      shareOfMau: pot.size / Math.max(1, uni.mauN),
      mauOverlap: pot.size ? inMau / pot.size : 0,
      winOverlap: pot.size ? inWin / pot.size : 0,
      liveOverlap: pot.size ? withLive / pot.size : 0,
      rivalOverlap: pot.size ? withRival / pot.size : 0,
      pureNew: pureNew * s, pureNewRate: pot.size ? pureNew / pot.size : 0,
      reachWin: inWin * s,                       // 名单口径可触达（目标周期活跃）
      rivals: rivals.map(r => r.id)
    };
    profileCache.set(pkey, res);
    return res;
  }

  /* ---------- 4. 获客目标可行性 ---------- */
  function feasibility(uni, prof, game, input, batchProfiles) {
    const goal = input.goalNew || 0;
    const join = game.cvrJoin || 0.5;
    /* 同批内人群重叠（与本批其他玩法潜在人群的最大 Jaccard） */
    let maxJac = 0, maxWith = null;
    batchProfiles.forEach(o => {
      if (o.game.id === game.id) return;
      const j = jaccard(prof.mask, o.mask);
      if (j > maxJac) { maxJac = j; maxWith = o.game.name; }
    });
    /* 名单口径上限：目标周期活跃的潜在人群 × 灰度参与率 × 竞品分流 × 同批内耗 */
    const base = prof.reachWin * join;
    const rivalCut = 1 - CFG.RIVAL_DISCOUNT * prof.rivalOverlap;
    const batchCut = 1 - CFG.BATCH_DISCOUNT * maxJac;
    const capacity = base * rivalCut * batchCut;

    return {
      goal, join, capacity,
      rivalCut, batchCut, maxJac, maxWith,
      reachWin: prof.reachWin,
      rate: goal > 0 ? capacity / goal : null
    };
  }

  /* ---------- 5. 大盘与存量名单概览 ---------- */
  function universeSummary(uni, liveGames) {
    const s = uni.scale;
    const live = liveGames.map(g => {
      const played = count(uni.played[g.id]);
      const retained = count(uni.retained[g.id]);
      return {
        id: g.id, name: g.name, type: g.type,
        players: played * s, retained: retained * s,
        retainRate: played ? retained / played : 0,
        shareOfMau: retained / Math.max(1, uni.mauN)
      };
    });
    const liveAll = count(uni.liveUnion);
    return {
      mau: uni.mauN * s,
      win: uni.winN * s,
      winRate: uni.winN / Math.max(1, uni.mauN),
      liveRetained: liveAll * s,
      liveCoverage: liveAll / Math.max(1, uni.mauN),
      live
    };
  }

  return { CFG, buildUniverse, potentialOf, profile, feasibility, universeSummary, jaccard, andCount, count, sum };
})();
