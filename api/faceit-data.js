// api/faceit-data.js – erweitert um Live‑Fallback für Rating
import Redis from "ioredis";

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL       = process.env.REDIS_URL;
const API_BASE_URL    = "https://open.faceit.com/data/v4";

// --- Hilfsfunktionen ---------------------------------------------------
async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`);
    return res.json();
}

/**
 * Berechnet alle Kennzahlen aus einem Match‑Array
 * Matches: [{ Kills, Deaths, Assists, Headshots, 'K/R Ratio', ADR, Rounds, Win }]
 */
function calculateAverageStats(matches) {
    const DMG_PER_KILL = 105;
    const weight = matches.length;
    if (weight === 0) {
        return { kd:0, adr:0, winRate:0, hsp:0, kast:0, impact:0, rating:0, weight };
    }
    const matchStats = matches.map(m => {
        const kills   = Number(m.Kills)   || 0;
        const deaths  = Number(m.Deaths)  || 0;
        const rounds  = Number(m.Rounds)  || 1;
        const kpr     = Number(m['K/R Ratio']) || 0;
        const adr     = Number(m.ADR)     || DMG_PER_KILL * kpr;
        const hs      = Number(m.Headshots)   || 0;
        const win     = Number(m.Win)     || 0;
        return { kills, deaths, rounds, kpr, adr, hs, win };
    });
    const totalKills  = matchStats.reduce((s,a)=>s+a.kills,   0);
    const totalDeaths = matchStats.reduce((s,a)=>s+a.deaths,  0);
    const kd    = totalDeaths===0 ? totalKills : totalKills/totalDeaths;
    const adr_avg = matchStats.reduce((s,a)=>s+a.adr,0)/weight;
    const dpr  = matchStats.reduce((s,a)=>s+(a.deaths/a.rounds),0)/weight;
    const kpr_avg = matchStats.reduce((s,a)=>s+a.kpr,0)/weight;
    const hsp  = totalKills>0 ? (matchStats.reduce((s,a)=>s+a.hs,0)/totalKills)*100 : 0;
    const winRate = (matchStats.reduce((s,a)=>s+a.win,0)/weight)*100;
    const kast = 100*(0.0073 + 0.3591*kpr_avg - 0.5329*dpr);
    const impact = 2.13*kpr_avg + 0.42*(totalKills/weight) - 0.41;
    const rating = Math.max(
        0,
        0.0073*kast + 0.3591*kpr_avg - 0.5329*dpr + 0.2372*impact + 0.0032*adr_avg + 0.1587
    );
    return {
        kd: +kd.toFixed(2),
        adr: +adr_avg.toFixed(1),
        winRate: +winRate.toFixed(1),
        hsp: +hsp.toFixed(1),
        kast: +kast.toFixed(1),
        impact: +impact.toFixed(2),
        rating: +rating.toFixed(2),
        weight,
    };
}

/**
 * Sortiert Matches nach Datum und wählt die letzten 10 aus
 */
function calculateCurrentFormStats(matches) {
    const sorted = [...matches].sort((a,b) => b.CreatedAt - a.CreatedAt);
    const recent = sorted.slice(0, 10);
    return {
        stats: calculateAverageStats(recent),
        matchesCount: recent.length
    };
}

// --- Redis‑Initialisierung ---------------------------------------------
let redis = null;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL, { lazyConnect: true });
    redis.on("error", () => { redis = null; });
}

// ------------------------------------------------------------------------
export default async function handler(req, res) {
    const nickname = req.query.nickname;
    if (!nickname) return res.status(400).json({ error: "nickname fehlt" });

    const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` };
    // Basis‑Daten von Faceit
    const details = await fetchJson(
        `${API_BASE_URL}/players?nickname=${encodeURIComponent(nickname)}`,
        headers
    );

    // Response‑Template
    const resp = {
        nickname: details.nickname,
        avatar:   details.avatar || "default_avatar.png",
        faceitUrl: details.faceit_url?.replace("{lang}", "en") ?? "#",
        elo:      details.games?.cs2?.faceit_elo ?? "N/A",
        level:    details.games?.cs2?.skill_level   ?? "N/A",
        sortElo:  parseInt(details.games?.cs2?.faceit_elo, 10) || 0,
        // Stats kommen aus Redis oder Fallback
        calculatedRating: null,
        kd:             null,
        adr:            null,
        winRate:        null,
        hsPercent:      null,
        matchesConsidered: 0,
        lastUpdated:       null,
    };

    // Optional: Redis‑Cache abfragen oder Live‑Fallback
    if (redis) {
        const cacheKey = `player_stats:${details.player_id}`;
        const statsStr = await redis.get(cacheKey);
        if (statsStr) {
            Object.assign(resp, JSON.parse(statsStr));
        } else {
            // Fallback: letze 10 Matches live abfragen und Rating berechnen
            const history = await fetchJson(
                `${API_BASE_URL}/players/${details.player_id}/history?game=cs2&limit=10`,
                headers
            );
            const items = history.items || [];
            // Match‑Daten mappen
            const matchData = await Promise.all(
                items.map(async h => {
                    const s = await fetchJson(
                        `${API_BASE_URL}/matches/${h.match_id}/stats`,
                        headers
                    );
                    const round = s.rounds?.[0];
                    if (!round) return null;
                    const winner = round.round_stats.Winner;
                    const playerStats = round.teams
                        .flatMap(t => t.players.map(p => ({ ...p, team_id: t.team_id })))
                        .find(p => p.player_id === details.player_id);
                    return playerStats && {
                        Kills:       +playerStats.player_stats.Kills,
                        Deaths:      +playerStats.player_stats.Deaths,
                        Assists:     +playerStats.player_stats.Assists,
                        Headshots:   +playerStats.player_stats.Headshots,
                        'K/R Ratio': +playerStats.player_stats['K/R Ratio'],
                        ADR:         +(playerStats.player_stats.ADR ?? playerStats.player_stats['Average Damage per Round']),
                        Rounds:      +round.round_stats.Rounds || 1,
                        Win:         +(playerStats.team_id === winner),
                        CreatedAt:   h.started_at,
                    };
                })
            );
            const filtered = matchData.filter(Boolean);
            const { stats: cf, matchesCount } = calculateCurrentFormStats(filtered);
            resp.calculatedRating = cf.rating;
            resp.kd         = cf.kd;
            resp.adr        = cf.adr;
            resp.winRate    = cf.winRate;
            resp.hsPercent  = cf.hsp;
            resp.matchesConsidered = matchesCount;
            resp.lastUpdated       = new Date().toISOString();
        }
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
    res.status(200).json(resp);
}
