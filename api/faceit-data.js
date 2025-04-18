// api/faceit-data.js – angepasst nach HLTV Rating 2.0 Formel von faceitperf.pro
import Redis from "ioredis";

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL      = process.env.REDIS_URL;
const API_BASE_URL   = "https://open.faceit.com/data/v4";

// --- Hilfs‑Fetch mit Error‑Throw ----------------------------------------
async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`);
    return res.json();
}

/**
 * Berechnet alle Kennzahlen aus einem Match‑Array nach HLTV 2.0
 * matches: Array von Objekten mit den Keys
 *   Kills, Deaths, Assists, Headshots, 'K/R Ratio', ADR, Rounds
 */
function calculateAverageStats(matches) {
    const DMG_PER_KILL = 105;
    const TRADE_PERCENT = 0.2;
    const weight = matches.length;

    if (weight === 0) {
        return {
            kills: 0, deaths: 0, kd: 0, dpr: 0, kpr: 0, avgk: 0,
            adr: 0, hs: 0, hsp: 0, apr: 0, kast: 0, impact: 0,
            rating: 0, weight
        };
    }

    // Rohdaten umformen
    const matchStats = matches.map(m => {
        const kills   = +m.Kills   || 0;
        const deaths  = +m.Deaths  || 0;
        const rounds  = +m.Rounds  || 1;
        const kpr     = +m['K/R Ratio']   || 0;
        const adr     = +m.ADR    || (kpr * DMG_PER_KILL);
        const headshots = +m.Headshots || 0;
        const assists   = +m.Assists   || 0;
        return { kills, deaths, rounds, kpr, adr, headshots, assists };
    });

    // Summen
    const kills  = matchStats.reduce((s,x)=>s+x.kills,0);
    const deaths = matchStats.reduce((s,x)=>s+x.deaths,0);
    const kd     = deaths ? kills/deaths : 0;
    const dpr    = matchStats.reduce((s,x)=>s + x.deaths/x.rounds,0) / weight;
    const kpr    = matchStats.reduce((s,x)=>s + x.kpr,0) / weight;
    const avgk   = kills / weight;
    const adr    = matchStats.reduce((s,x)=>s + x.adr,0) / weight;
    const hs     = matchStats.reduce((s,x)=>s + x.headshots,0);
    const hsp    = kills ? (hs / kills) * 100 : 0;
    const apr    = matchStats.reduce((s,x)=>s + x.assists/x.rounds,0) / weight;

    // echtes KAST
    const kast = matchStats
        .reduce((sum, x) => {
            const survived = x.rounds - x.deaths;
            const traded   = TRADE_PERCENT * x.rounds;
            const raw      = (x.kills + x.assists + survived + traded) * 0.45;
            return sum + Math.min((raw / x.rounds) * 100, 100);
        }, 0) / weight;

    // Impact
    const impact = Math.max(2.13 * kpr + 0.42 * apr - 0.41, 0);

    // Rating 2.0
    const ratingRaw =
        0.0073 * kast +
        0.3591 * kpr +
        -0.5329 * dpr +
        0.2372 * impact +
        0.0032 * adr +
        0.1587;
    const rating = Math.max(0, ratingRaw);

    return {
        kills,
        deaths,
        kd: +kd.toFixed(2),
        dpr: +dpr.toFixed(2),
        kpr: +kpr.toFixed(2),
        avgk: +avgk.toFixed(2),
        adr: +adr.toFixed(1),
        hs,
        hsp: +hsp.toFixed(1),
        apr: +apr.toFixed(2),
        kast: +kast.toFixed(1),
        impact: +impact.toFixed(2),
        rating: +rating.toFixed(2),
        weight
    };
}

/**
 * Filtert die letzten 14 Tage und berechnet die Kennzahlen
 */
function calculateCurrentFormStats(matches) {
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recent = matches.filter(m =>
        new Date(m.CreatedAt).getTime() >= twoWeeksAgo
    );
    return {
        stats: calculateAverageStats(recent),
        matchesCount: recent.length
    };
}

// --- Redis‑Init (optional) --------------------------------------------
let redis = null;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL, { lazyConnect: true });
    redis.on("error", () => { redis = null; });
}

// --- Haupt‑Handler ----------------------------------------------------
export default async function handler(req, res) {
    const nickname = req.query.nickname;
    if (!nickname) {
        return res.status(400).json({ error: "nickname fehlt" });
    }

    try {
        const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` };
        // 1) Basis‑Details
        const details = await fetchJson(
            `${API_BASE_URL}/players?nickname=${encodeURIComponent(nickname)}`,
            headers
        );

        // 2) Aufbau der Antwort mit Platzhaltern
        const resp = {
            nickname: details.nickname,
            avatar: details.avatar || "default_avatar.png",
            faceitUrl: details.faceit_url?.replace("{lang}", "en") ?? "#",
            elo: details.games?.cs2?.faceit_elo ?? "N/A",
            level: details.games?.cs2?.skill_level ?? "N/A",
            sortElo: parseInt(details.games?.cs2?.faceit_elo, 10) || 0,

            // werden unten überschrieben
            calculatedRating: null,
            kd: null,
            dpr: null,
            kpr: null,
            adr: null,
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
            // Live‑Fallback: letzte Matches abrufen
            const history = await fetchJson(
                `${API_BASE_URL}/players/${details.player_id}/history?game=cs2&limit=50`,
                headers
            );
            const items = history.items || [];

            // Roh‑Matchdaten extrahieren
            const matchData = (await Promise.all(
                items.map(async h => {
                    const stat = await fetchJson(
                        `${API_BASE_URL}/matches/${h.match_id}/stats`,
                        headers
                    );
                    const round = stat.rounds?.[0];
                    if (!round) return null;
                    const winner = round.round_stats.Winner;
                    // Spieler‑Stats finden
                    const p = round.teams
                        .flatMap(t => t.players.map(p => ({ ...p, team_id: t.team_id })))
                        .find(p => p.player_id === details.player_id);
                    if (!p) return null;
                    return {
                        Kills:    +p.player_stats.Kills,
                        Deaths:   +p.player_stats.Deaths,
                        Assists:  +p.player_stats.Assists,
                        Headshots:+p.player_stats.Headshots,
                        "K/R Ratio": +p.player_stats["K/R Ratio"],
                        ADR:       +(
                            p.player_stats.ADR ??
                            p.player_stats["Average Damage per Round"]
                        ),
                        Rounds:   +(round.round_stats.Rounds || 1),
                        CreatedAt: h.started_at
                    };
                })
            )).filter(Boolean);

            // Stats berechnen
            const { stats, matchesCount } = calculateCurrentFormStats(matchData);

            statsObj = {
                calculatedRating: stats.rating,
                kd: stats.kd,
                dpr: stats.dpr,
                kpr: stats.kpr,
                adr: stats.adr,
                hsPercent: stats.hsp,
                kast: stats.kast,
                impact: stats.impact,
                matchesConsidered: matchesCount,
                lastUpdated: new Date().toISOString()
            };
        }

        // 4) Zusammenführen & zurückliefern
        Object.assign(resp, statsObj);
        res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
        return res.status(200).json(resp);

    } catch (err) {
        console.error(`[api/faceit-data] ${nickname} →`, err);
        return res.status(200).json({ nickname, error: err.message });
    }
}
