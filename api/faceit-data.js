// api/faceit-data.js
import Redis from "ioredis";

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";

// Hilfs‑Fetch mit Error‑Throw
async function fetchJson(url, headers) {
    const res = await fetch(url, {headers});
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
}

/**
 * Berechnet HLTV-ähnliche Kennzahlen aus einem Array von Match-Objekten.
 * @param {Array} matches – Array von Objekten mit den Feldern:
 *   Kills, Deaths, Assists, Headshots, 'K/R Ratio', ADR, Rounds, Win
 * @returns {Object} { kd, adr, winRate, hsp, kast, impact, rating, weight }
 */
function calculateAverageStats(matches) {
    const DMG_PER_KILL = 105;
    const weight = matches.length;
    if (weight === 0) {
        return {
            kd: 0,
            adr: 0,
            winRate: 0,
            hsp: 0,
            kast: 0,
            impact: 0,
            rating: 0,
            weight
        };
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

    const totalKills  = matchStats.reduce((sum, s) => sum + s.kills, 0);
    const totalDeaths = matchStats.reduce((sum, s) => sum + s.deaths, 0);
    const kd    = totalDeaths === 0 ? totalKills : totalKills / totalDeaths;
    const adrAvg = matchStats.reduce((sum, s) => sum + s.adr, 0) / weight;
    const dpr   = matchStats.reduce((sum, s) => sum + (s.deaths / s.rounds), 0) / weight;
    const kprAvg = matchStats.reduce((sum, s) => sum + s.kpr, 0) / weight;
    const hsp   = totalKills > 0
        ? (matchStats.reduce((sum, s) => sum + s.hs, 0) / totalKills) * 100
        : 0;
    const winRate = (matchStats.reduce((sum, s) => sum + s.win, 0) / weight) * 100;
    const kast  = 100 * (0.0073 + 0.3591 * kprAvg - 0.5329 * dpr);
    const impact = 2.13 * kprAvg + 0.42 * (totalKills / weight) - 0.41;
    const rating = Math.max(
        0,
        0.0073 * kast +
        0.3591 * kprAvg -
        0.5329 * dpr +
        0.2372 * impact +
        0.0032 * adrAvg +
        0.1587
    );

    return {
        kd: +kd.toFixed(2),
        adr: +adrAvg.toFixed(1),
        winRate: +winRate.toFixed(1),
        hsp: +hsp.toFixed(1),
        kast: +kast.toFixed(1),
        impact: +impact.toFixed(2),
        rating: +rating.toFixed(2),
        weight
    };
}


function calculateCurrentFormStats(matches) {
    const sorted = [...matches].sort((a, b) => b.CreatedAt - a.CreatedAt);
    const recent = sorted.slice(0, 10);
    return {
        stats: calculateAverageStats(recent),
        matchesCount: recent.length
    };
}

// Redis initialisieren (optional)
let redis = null;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL, {lazyConnect: true});
    redis.on("error", () => {
        redis = null;
    });
}

export default async function handler(req, res) {
    const nickname = req.query.nickname;
    if (!nickname) {
        return res.status(400).json({error: "nickname fehlt"});
    }

    try {
        const headers = {Authorization: `Bearer ${FACEIT_API_KEY}`};
        // 1) Basis‑Details
        const details = await fetchJson(
            `${API_BASE_URL}/players?nickname=${encodeURIComponent(nickname)}`,
            headers
        );

        // 2) Response‑Template
        const resp = {
            nickname: details.nickname,
            avatar: details.avatar || "default_avatar.png",
            faceitUrl: details.faceit_url?.replace("{lang}", "en") ?? "#",
            elo: details.games?.cs2?.faceit_elo ?? "N/A",
            level: details.games?.cs2?.skill_level ?? "N/A",
            sortElo: parseInt(details.games?.cs2?.faceit_elo, 10) || 0,
            calculatedRating: null,
            kd: null,
            adr: null,
            winRate: null,
            hsPercent: null,
            kast: null,
            impact: null,
            matchesConsidered: 0,
            lastUpdated: null
        };

        // 3) Stats aus Redis‑Cache oder Live‑Fallback
        let statsObj = null;
        if (redis) {
            const cacheKey = `player_stats:${details.player_id}`;
            const cached = await redis.get(cacheKey);
            if (cached) {
                statsObj = JSON.parse(cached);
            }
        }

        if (!statsObj) {
            // Live‑Fallback: letzte 10 Matches abrufen und berechnen
            const hist = await fetchJson(
                `${API_BASE_URL}/players/${details.player_id}/history?game=cs2&limit=10`,
                headers
            );
            const items = hist.items || [];
            const matchData = await Promise.all(
                items.map(async h => {
                    const stat = await fetchJson(
                        `${API_BASE_URL}/matches/${h.match_id}/stats`,
                        headers
                    );
                    const r = stat.rounds?.[0];
                    if (!r) return null;
                    const winner = r.round_stats.Winner;
                    const playerStats = r.teams
                        .flatMap(t => t.players.map(p => ({...p, team_id: t.team_id})))
                        .find(p => p.player_id === details.player_id);
                    if (!playerStats) return null;
                    return {
                        Kills: +playerStats.player_stats.Kills,
                        Deaths: +playerStats.player_stats.Deaths,
                        Assists: +playerStats.player_stats.Assists,
                        Headshots: +playerStats.player_stats.Headshots,
                        "K/R Ratio": +playerStats.player_stats["K/R Ratio"],
                        ADR: +(playerStats.player_stats.ADR ?? playerStats.player_stats["Average Damage per Round"]),
                        Rounds: +r.round_stats.Rounds || 1,
                        Win: +(playerStats.team_id === winner),
                        CreatedAt: h.started_at
                    };
                })
            );
            const filtered = matchData.filter(Boolean);
            const {stats, matchesCount} = calculateCurrentFormStats(filtered);
            statsObj = {
                calculatedRating: stats.rating,
                kd: stats.kd,
                adr: stats.adr,
                winRate: stats.winRate,
                hsPercent: stats.hsp,
                kast: stats.kast,
                impact: stats.impact,
                matchesConsidered: matchesCount,
                lastUpdated: new Date().toISOString()
            };
        }

        // 4) Zusammenführen & antworten
        Object.assign(resp, statsObj);
        res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
        return res.status(200).json(resp);

    } catch (err) {
        console.error(`[api/faceit-data] ${nickname} →`, err);
        // immer JSON zurückliefern, auch bei Fehlern
        return res.status(200).json({nickname, error: err.message});
    }
}
