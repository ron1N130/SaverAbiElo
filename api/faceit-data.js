// api/faceit-data.js – bereinigt & vereinfacht
import Redis from "ioredis";

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";

let redis = null;
if (REDIS_URL) redis = new Redis(REDIS_URL);

export default async function handler(req, res) {
    const nickname = req.query.nickname;
    if (!nickname) return res.status(400).json({ error: "nickname fehlt" });

    const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` };
    const detailsRes = await fetch(`${API_BASE_URL}/players?nickname=${nickname}`, { headers });
    if (!detailsRes.ok) return res.status(detailsRes.status).json({ error: "Spieler nicht gefunden" });
    const details = await detailsRes.json();

    const resp = {
        nickname: details.nickname,
        avatar: details.avatar || "default_avatar.png",
        faceitUrl: details.faceit_url?.replace("{lang}", "en") ?? "#",
        elo: details.games?.cs2?.faceit_elo ?? "N/A",
        level: details.games?.cs2?.skill_level ?? "N/A",
        sortElo: parseInt(details.games?.cs2?.faceit_elo, 10) || 0,
        // HLTV Stats – werden ggf. durch Redis überschrieben
        calculatedRating: null,
        kd: null,
        adr: null,
        winRate: null,
        hsPercent: null,
        matchesConsidered: 0,
        lastUpdated: null,
    };

    // Redis‑Lookup (optional)
    if (redis) {
        const statsStr = await redis.get(`player_stats:${details.player_id}`);
        if (statsStr) {
            const s = JSON.parse(statsStr);
            Object.assign(resp, s);
        }
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
    res.status(200).json(resp);
}