// api/faceit-data.js – angepasst nach HLTV Rating 2.0 Formel
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
 * Berechnet alle Kennzahlen aus einem Match‑Array nach HLTV 2.0
 * matches: Array von Objekten mit den Keys
 *   Kills, Deaths, Assists, Headshots, 'K/R Ratio', ADR, Rounds, Win
 */
/**
 * Berechnet alle Kennzahlen aus einem Match‑Array nach HLTV 2.0
 */
function calculateAverageStats(matches) {
    const weight = matches.length;
    if (weight === 0) {
        return {
            kd: 0, dpr: 0, kpr: 0, adr: 0,
            winRate: 0, hsPercent: 0, kast: 0,
            impact: 0, rating: 0, weight
        };
    }

    let totalKills = 0, totalDeaths = 0, totalRounds = 0;
    let totalDamage = 0, totalHeadshots = 0, totalWins = 0;

    matches.forEach(m => {
        const kills  = Number(m.Kills)   || 0;
        const deaths = Number(m.Deaths)  || 0;
        const rounds = Number(m.Rounds)  || 1;
        const adr    = Number(m.ADR)     || (kills * 105);
        const hs     = Number(m.Headshots)|| 0;
        const win    = Number(m.Win)     || 0;

        totalKills    += kills;
        totalDeaths   += deaths;
        totalRounds   += rounds;
        totalDamage   += adr * rounds;
        totalHeadshots+= hs;
        totalWins     += win;
    });

    const kpr       = totalKills  / totalRounds;
    const dpr       = totalDeaths / totalRounds;
    const adrAvg    = totalDamage / totalRounds;
    const kd        = totalDeaths ? totalKills / totalDeaths : totalKills;
    const winRate   = (totalWins / weight) * 100;
    const hsPercent = totalKills ? (totalHeadshots / totalKills) * 100 : 0;

    // KAST nah approximiert
    let kastCount = 0;
    matches.forEach(m => {
        if (Number(m.Kills)>0 || Number(m.Assists)>0 || Number(m.Deaths)<Number(m.Rounds)) {
            kastCount++;
        }
    });
    const kast = (kastCount / weight) * 100;

    const impact =
        2.13 * kpr +
        0.42 * (totalKills / totalRounds) -
        0.41;

    const ratingRaw =
        0.0073 * kast +
        0.3591 * kpr -
        0.5329 * dpr +
        0.2372 * impact +
        0.0032 * adrAvg +
        0.1587;
    const rating = Math.max(0, ratingRaw);

    return {
        kd: +kd.toFixed(2),
        dpr: +dpr.toFixed(2),
        kpr: +kpr.toFixed(2),
        adr: +adrAvg.toFixed(1),
        winRate: +winRate.toFixed(1),
        hsPercent: +hsPercent.toFixed(1),
        kast: +kast.toFixed(1),
        impact: +impact.toFixed(2),
        rating: +rating.toFixed(2),
        weight
    };
}

/**
 * Wählt die letzten 10 Matches nach Datum aus und berechnet die Stats
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
    if (!nickname) {
        return res.status(400).json({ error: "nickname fehlt" });
    }

    const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` };
    // Faceit-Grunddaten
    const details = await fetchJson(
        `${API_BASE_URL}/players?nickname=${encodeURIComponent(nickname)}`,
        headers
    );

    // Antwort-Template
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

    // Stats aus Cache oder Live-Fallback
    if (redis) {
        const cacheKey = `player_stats:${details.player_id}`;
        const statsStr = await redis.get(cacheKey);
        if (statsStr) {
            Object.assign(resp, JSON.parse(statsStr));
        } else {
            // Live-Daten der letzten 10 Matches holen
            const history = await fetchJson(
                `${API_BASE_URL}/players/${details.player_id}/history?game=cs2&limit=10`,
                headers
            );
            const items = history.items || [];
            const matchData = (await Promise.all(
                items.map(async h => {
                    const stats = await fetchJson(
                        `${API_BASE_URL}/matches/${h.match_id}/stats`,
                        headers
                    );
                    const round = stats.rounds?.[0];
                    if (!round) return null;
                    const winner = round.round_stats.Winner;
                    const p = round.teams
                        .flatMap(t => t.players.map(p => ({ ...p, team_id: t.team_id })))
                        .find(p => p.player_id === details.player_id);
                    return p && {
                        Kills:   +p.player_stats.Kills,
                        Deaths:  +p.player_stats.Deaths,
                        Assists: +p.player_stats.Assists,
                        Headshots: +p.player_stats.Headshots,
                        'K/R Ratio': +p.player_stats['K/R Ratio'],
                        ADR: +(
                            p.player_stats.ADR ?? p.player_stats['Average Damage per Round']
                        ),
                        Rounds: +(round.round_stats.Rounds || 1),
                        Win: +(p.team_id === winner),
                        CreatedAt: h.started_at
                    };
                })
            )).filter(Boolean);

            const { stats: cf, matchesCount } = calculateCurrentFormStats(matchData);
            Object.assign(resp, cf);
            resp.matchesConsidered = matchesCount;
            resp.lastUpdated = new Date().toISOString();
        }
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
    res.status(200).json(resp);
}
