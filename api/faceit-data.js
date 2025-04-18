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

// Rating‑Berechnung (letzte 10 Matches)
function calculateAverageStats(matches) { /* ... unverändert ... */
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
