/* =========================================================
 * data.js —— 模拟数据层（真实环境下由数仓/画像服务返回）
 * ========================================================= */

const SNAPSHOT = {
  fetchedAt: "2026-10-29 08:12",
  source: "dws_gameplay_dau_d / dws_player_segment_profile",
  dauTotal: 1284000,
  layers: [
    { key: "core",  name: "核心玩家", dau: 196000, avgMin: 96, color: "#7c6cf5" },
    { key: "mid",   name: "次核心",   dau: 412000, avgMin: 54, color: "#3ddc97" },
    { key: "light", name: "泛用户",   dau: 676000, avgMin: 21, color: "#f7b955" }
  ],
  newContentShare: 0.22
};

/* 玩法类型：minPerNew = 每新增玩家日均投入分钟数（用于注意力核算）
   demandShare = 历史活跃结构反推的需求占比 */
const TYPES = [
  { key: "pvp",     name: "竞技对抗", icon: "⚔️", color: "#ff6b8a", minPerNew: 46, demand: 0.27,
    active: { core: 0.64, mid: 0.36, light: 0.15 } },
  { key: "coop",    name: "合作生存", icon: "🛡️", color: "#4fc3f7", minPerNew: 58, demand: 0.21,
    active: { core: 0.41, mid: 0.24, light: 0.09 } },
  { key: "casual",  name: "休闲解谜", icon: "🧩", color: "#3ddc97", minPerNew: 18, demand: 0.23,
    active: { core: 0.22, mid: 0.33, light: 0.31 } },
  { key: "story",   name: "剧情探索", icon: "📖", color: "#b388ff", minPerNew: 37, demand: 0.16,
    active: { core: 0.29, mid: 0.19, light: 0.08 } },
  { key: "collect", name: "收集养成", icon: "✨", color: "#f7b955", minPerNew: 26, demand: 0.13,
    active: { core: 0.18, mid: 0.21, light: 0.14 } }
];

/* 待上架玩法池
 * expo        : 预计单日曝光人数（运营位 + 推荐 + 自然流量）
 * cvrDownload : 曝光 → 下载/进入率
 * cvrJoin     : 下载 → 参与（完成新手引导并真正玩一局）率
 * 有效新进 = expo * cvrDownload * cvrJoin  ← 只有参与玩家计入 */
const GAMEPLAY_POOL = [
  { id: "g01", name: "星域突围",   type: "pvp",     quality: 0.86, readiness: 0.95, expo: 940000, cvrDownload: 0.062, cvrJoin: 0.48,
    tags: ["竞技", "团队", "排位", "快节奏", "科幻"],
    note: "赛季制 5v5，强竞技、社交裂变强" },
  { id: "g02", name: "荒原协议",   type: "coop",    quality: 0.79, readiness: 0.92, expo: 720000, cvrDownload: 0.048, cvrJoin: 0.55,
    tags: ["生存", "建造", "团队", "开放世界"],
    note: "PvE 生存 + 基地建造，单局长" },
  { id: "g03", name: "糖豆实验室", type: "casual",  quality: 0.83, readiness: 0.98, expo: 1080000, cvrDownload: 0.081, cvrJoin: 0.66,
    tags: ["休闲", "解谜", "单局短", "社交"],
    note: "轻量物理解谜，泛用户友好" },
  { id: "g04", name: "长夜列车",   type: "story",   quality: 0.91, readiness: 0.88, expo: 560000, cvrDownload: 0.055, cvrJoin: 0.52,
    tags: ["剧情", "解谜", "悬疑", "单局短"],
    note: "章节式叙事，口碑驱动" },
  { id: "g05", name: "萌宠图鉴",   type: "collect", quality: 0.74, readiness: 0.96, expo: 830000, cvrDownload: 0.069, cvrJoin: 0.61,
    tags: ["收集", "养成", "休闲", "社交"],
    note: "长线养成，留存型而非爆发型" },
  { id: "g06", name: "极限竞速23", type: "pvp",     quality: 0.81, readiness: 0.79, expo: 610000, cvrDownload: 0.052, cvrJoin: 0.44,
    tags: ["竞技", "竞速", "快节奏", "排位"],
    note: "单人竞速为主，与团队竞技部分重叠" },
  { id: "g07", name: "深渊回响",   type: "coop",    quality: 0.88, readiness: 0.85, expo: 480000, cvrDownload: 0.043, cvrJoin: 0.49,
    tags: ["Roguelike", "团队", "生存", "硬核"],
    note: "高难度 Roguelike，受众窄但黏性高" },
  { id: "g08", name: "小镇物语",   type: "casual",  quality: 0.69, readiness: 0.97, expo: 760000, cvrDownload: 0.058, cvrJoin: 0.58,
    tags: ["休闲", "建造", "养成", "社交"],
    note: "模拟经营，与萌宠图鉴争同一批泛用户" },
  { id: "g09", name: "赤色警戒线", type: "pvp",     quality: 0.77, readiness: 0.94, expo: 690000, cvrDownload: 0.049, cvrJoin: 0.41,
    tags: ["竞技", "团队", "战术", "硬核"],
    note: "战术射击，与星域突围高度同质" },
  { id: "g10", name: "纸鸢奇谈",   type: "story",   quality: 0.72, readiness: 0.99, expo: 430000, cvrDownload: 0.051, cvrJoin: 0.50,
    tags: ["剧情", "解谜", "国风", "单局短"],
    note: "短篇国风叙事" },
  { id: "g11", name: "星际贸易站", type: "collect", quality: 0.66, readiness: 0.83, expo: 520000, cvrDownload: 0.045, cvrJoin: 0.47,
    tags: ["收集", "建造", "科幻", "养成"],
    note: "经济系统偏重，新手流失偏高" },
  { id: "g12", name: "蹦蹦大乱斗", type: "casual",  quality: 0.64, readiness: 0.93, expo: 880000, cvrDownload: 0.071, cvrJoin: 0.60,
    tags: ["休闲", "竞技", "快节奏", "单局短"],
    note: "派对乱斗，与糖豆实验室同簇" },
  { id: "g13", name: "孤岛档案",   type: "coop",    quality: 0.70, readiness: 0.90, expo: 390000, cvrDownload: 0.040, cvrJoin: 0.46,
    tags: ["生存", "解谜", "悬疑", "开放世界"],
    note: "小体量生存解谜" },
  { id: "g14", name: "霓虹街区",   type: "story",   quality: 0.85, readiness: 0.71, expo: 640000, cvrDownload: 0.057, cvrJoin: 0.53,
    tags: ["剧情", "开放世界", "都市", "硬核"],
    note: "未达上线门槛（就绪度 < 0.75）" }
];

/* 打标数据里的显式竞争覆盖（人工/算法标注的强冲突对） */
const COMP_OVERRIDE = {
  "g01|g09": 0.95,
  "g03|g12": 0.92,
  "g05|g08": 0.78,
  "g02|g07": 0.74
};
