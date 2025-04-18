// api/faceit-data.js – angepasst: Live‑Fallback auch ohne Redis
import Redis from "ioredis";

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL       = process.env.REDIS_URL;
const API_BASE_URL    = "https://open.faceit.com/data/v4";

// Einfacher Fetch‐Helper
async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`);
    return res.json();
}

// Berechnet Stats aus den letzten 10 Matches
function calculateAverageStats(matches) {
    if (!matches.length) {
        return { kd:0, adr:0, winRate:0, hsPercent:0, kast:0, impact:0, rating:0, weight:0 };
    }
    let totalKills=0, totalDeaths=0, totalRounds=0, totalDamage=0, totalHS=0, totalWins=0;
    matches.forEach(m => {
        const kills   = +m.Kills   || 0;
        const deaths  = +m.Deaths  || 0;
        const rounds  = +m.Rounds  || 1;
        const adr     = +m.ADR     || kills*105;
        const hs      = +m.Headshots|| 0;
        const win     = +m.Win     || 0;
        totalKills  += kills;
        totalDeaths += deaths;
        totalRounds += rounds;
        totalDamage += adr * rounds;
        totalHS     += hs;
        totalWins   += win;
    });
    const kd        = totalDeaths ? totalKills/totalDeaths : totalKills;
    const adr_avg   = totalDamage/totalRounds;
    const dpr       = totalDeaths/totalRounds;
    const kpr       = totalKills/totalRounds;
    const winRate   = totalWins/matches.length * 100;
    const hsPercent = totalKills ? totalHS/totalKills*100 : 0;
    const kast      = winRate; // Platzhalter, kann durch echten KAST ersetzt werden
    const impact    = 2.13*kpr + 0.42*(totalKills/totalRounds) - 0.41;
    const rawRating = 0.0073*kast + 0.3591*kpr - 0.5329*dpr + 0.2372*impact + 0.0032*adr_avg + 0.1587;
    return {
        kd:        +kd.toFixed(2),
        adr:       +adr_avg.toFixed(1),
        winRate:   +winRate.toFixed(1),
        hsPercent: +hsPercent.toFixed(1),
        kast:      +kast.toFixed(1),
        impact:    +impact.toFixed(2),
        rating:    +Math.max(0, rawRating).toFixed(2),
        weight:    matches.length
    };
}

function calculateCurrentFormStats(matches) {
    const recent = matches
        .slice()
        .sort((a,b) => b.CreatedAt - a.CreatedAt)
        .slice(0,10);
    return { stats: calculateAverageStats(recent), matchesCount: recent.length };
}

// Redis optional
let redis = null;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL, { lazyConnect:true });
    redis.on("error",()=>{ redis=null });
}

export default async function handler(req, res) {
    const nickname = req.query.nickname;
    if (!nickname) return res.status(400).json({ error:"nickname fehlt" });

    const headers = { Authorization:`Bearer ${FACEIT_API_KEY}` };
    const details = await fetchJson(
        `${API_BASE_URL}/players?nickname=${encodeURIComponent(nickname)}`,
        headers
    );

    const resp = {
        nickname: details.nickname,
        avatar:   details.avatar      || "default_avatar.png",
        faceitUrl: details.faceit_url?.replace("{lang}","en") || "#",
        elo:      details.games?.cs2?.faceit_elo || "N/A",
        level:    details.games?.cs2?.skill_level || "N/A",
        sortElo:  parseInt(details.games?.cs2?.faceit_elo,10)||0,
        // Stats‑Platzhalter
        calculatedRating:null, kd:null, adr:null,
        winRate:null, hsPercent:null, kast:null,
        impact:null, matchesConsidered:0, lastUpdated:null
    };

    // 1) Versuche Cache
    let cached = null;
    if (redis) {
        const key = `player_stats:${details.player_id}`;
        const str = await redis.get(key);
        if (str) cached = JSON.parse(str);
    }

    // 2) Wenn Cache da, nehmen – sonst Live‑Fallback
    if (cached) {
        Object.assign(resp, cached);
    } else {
        // Live‐Holung der letzten 10 Matches
        const history = await fetchJson(
            `${API_BASE_URL}/players/${details.player_id}/history?game=cs2&limit=10`,
            headers
        );
        const matchData = (
            await Promise.all(
                (history.items||[]).map(async h => {
                    const stats = await fetchJson(
                        `${API_BASE_URL}/matches/${h.match_id}/stats`,
                        headers
                    );
                    const rnd = stats.rounds?.[0];
                    if (!rnd) return null;
                    const winner = rnd.round_stats.Winner;
                    const p = rnd.teams
                        .flatMap(t=>t.players.map(p=>({...p,team_id:t.team_id})))
                        .find(p=>p.player_id===details.player_id);
                    if (!p) return null;
                    return {
                        Kills:       +p.player_stats.Kills,
                        Deaths:      +p.player_stats.Deaths,
                        Assists:     +p.player_stats.Assists,
                        Headshots:   +p.player_stats.Headshots,
                        "K/R Ratio": +p.player_stats["K/R Ratio"],
                        ADR:         +(p.player_stats.ADR ?? p.player_stats["Average Damage per Round"]),
                        Rounds:      +rnd.round_stats.Rounds || 1,
                        Win:         +(p.team_id===winner),
                        CreatedAt:   h.started_at
                    };
                })
            )
        ).filter(Boolean);

        const { stats:cf, matchesCount } = calculateCurrentFormStats(matchData);
        Object.assign(resp, cf);
        resp.matchesConsidered = matchesCount;
        resp.lastUpdated       = new Date().toISOString();
    }

    res.setHeader("Cache-Control","s-maxage=60, stale-while-revalidate");
    res.status(200).json(resp);
}
