// api/faceit-data.js – Refactored
// -------------------------------------------------
// ◼ Nutzt zentrale Statistik-Berechnung aus /api/utils/stats.js
// ◼ Cache Version 6
// -------------------------------------------------
import Redis from "ioredis";
// *** NEU: Importiere Berechnungsfunktionen ***
import { calculateAverageStats } from './utils/stats.js';

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL      = process.env.REDIS_URL;
const API_BASE_URL   = "https://open.faceit.com/data/v4";
const CACHE_VERSION  = 7; // <<<< Cache-Version erhöht auf 6

// --- Hilfs‑Fetch mit Error‑Throw ---
async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`);
    return res.json();
}

// --- Funktion zur Berechnung der Form basierend auf den letzten 15 Matches ---
// Diese Funktion bleibt hier, da sie spezifisch für diesen Endpunkt ist.
// Sie ruft die importierte calculateAverageStats auf.
function calculateCurrentFormStats(matches) {
    const recent = matches
        .slice()
        .sort((a,b)=> (new Date(b.CreatedAt).getTime() || 0) - (new Date(a.CreatedAt).getTime() || 0))
        .slice(0, 15); // Nimm die neuesten 15
    const statsResult = calculateAverageStats(recent); // *** Ruft importierte Funktion auf ***
    return {
        stats: statsResult, // Enthält jetzt alle berechneten Stats oder null
        matchesCount: recent.length
    };
}

// --- Redis‑Init (unverändert) ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 10000, maxRetriesPerRequest: 2 });
        redis.on("error", (err) => { console.error("[Redis FD] Connection error:", err.message); redis = null; });
        console.log("[Redis FD] Client initialized.");
    } catch(e) { console.error("[Redis FD] Initialization failed:", e); redis = null; }
} else { console.warn("[Redis FD] REDIS_URL not set. Caching disabled."); }

// --- Haupt‑Handler ---
export default async function handler(req, res) {
    const nickname = req.query.nickname;
    if (!nickname) {
        return res.status(400).json({ error: "nickname fehlt" });
    }

    try {
        const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` };
        // 1) Basis‑Daten holen
        const details = await fetchJson(`${API_BASE_URL}/players?nickname=${encodeURIComponent(nickname)}`, headers);
        const playerId = details?.player_id;
        if (!playerId) throw new Error(`Player ${nickname} not found.`);

        // 2) Grund‑Antwort vorbereiten
        const resp = {
            nickname: details.nickname, avatar: details.avatar || "default_avatar.png",
            faceitUrl: details.faceit_url?.replace("{lang}", "en") ?? `https://faceit.com/en/players/${details.nickname}`,
            elo: details.games?.cs2?.faceit_elo ?? "N/A", level: details.games?.cs2?.skill_level ?? "N/A",
            sortElo: parseInt(details.games?.cs2?.faceit_elo, 10) || 0,
            calculatedRating: null, kd: null, dpr: null, kpr: null, adr: null,
            hsPercent: null, kast: null, impact: null, matchesConsidered: 0,
            lastUpdated: null, cacheStatus: 'miss'
        };

        // 3) Cache prüfen
        let statsObj = null;
        if (redis) {
            const cacheKey = `player_stats:${playerId}`;
            try {
                const raw = await redis.get(cacheKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed.version === CACHE_VERSION) { // Prüft auf v6
                        statsObj = parsed; resp.cacheStatus = 'hit';
                    } else { resp.cacheStatus = 'stale'; console.log(`[Cache FD] Stale v${parsed.version} for ${nickname}`); }
                } else { resp.cacheStatus = 'miss'; }
            } catch (e) { console.error(`[Cache FD] Error GET/parse for ${nickname}:`, e); resp.cacheStatus = 'error'; }
        } else { resp.cacheStatus = 'disabled'; }

        // 4) Live‑Fallback
        if (resp.cacheStatus !== 'hit') {
            // console.log(`[API FD] Cache status ${resp.cacheStatus} for ${nickname}. Fetching live...`);
            let items = [];
            try {
                const hist = await fetchJson(`${API_BASE_URL}/players/${playerId}/history?game=cs2&limit=15`, headers);
                items = hist?.items || [];
            } catch (histErr) { console.warn(`[API FD] History fetch failed for ${nickname}:`, histErr.message); items = []; }

            let matchData = [];
            if (items.length > 0) {
                const matchDataPromises = items.map(async h => {
                    try {
                        const stat = await fetchJson(`${API_BASE_URL}/matches/${h.match_id}/stats`, headers);
                        const round = stat?.rounds?.[0];
                        if (!round) return null;
                        const teamData = round.teams?.find(team => team.players?.some(p => p.player_id === playerId));
                        if (!teamData) return null;
                        const p = teamData.players.find(p => p.player_id === playerId);
                        if (!p || !p.player_stats) return null;
                        return {
                            Kills: +p.player_stats.Kills, Deaths: +p.player_stats.Deaths,
                            Assists: +p.player_stats.Assists, Headshots: +p.player_stats.Headshots,
                            "K/R Ratio": +p.player_stats["K/R Ratio"],
                            ADR: +(p.player_stats.ADR ?? p.player_stats["Average Damage per Round"]),
                            Rounds: +(round.round_stats?.Rounds || 1),
                            Win: round.round_stats?.Winner === teamData.team_id ? 1 : 0, // Win Info hinzugefügt
                            CreatedAt: h.started_at
                        };
                    } catch (matchErr) { return null; }
                });
                matchData = (await Promise.all(matchDataPromises)).filter(Boolean);
            }

            if (matchData.length > 0) {
                const { stats, matchesCount } = calculateCurrentFormStats(matchData); // Ruft lokale Funktion auf
                if (stats) { // Nur wenn Stats berechnet wurden
                    statsObj = {
                        version:          CACHE_VERSION,
                        calculatedRating: stats.rating,
                        kd:               stats.kd,
                        dpr:              stats.dpr,
                        kpr:              stats.kpr,
                        adr:              stats.adr,
                        hsPercent:        stats.hsp, // Name konsistent!
                        kast:             stats.kast,
                        impact:           stats.impact,
                        // apr:              stats.apr, // Optional hinzufügen
                        matchesConsidered: matchesCount,
                        lastUpdated:      new Date().toISOString()
                    };
                    // Cache schreiben (wenn Redis verfügbar)
                    if (redis && resp.cacheStatus !== 'disabled') {
                        try {
                            await redis.set(`player_stats:${playerId}`, JSON.stringify(statsObj), "EX", 7 * 24 * 60 * 60);
                        } catch (cacheWriteErr) { console.error(`[Cache FD] Failed SET for ${nickname}:`, cacheWriteErr); }
                    }
                } else {
                     console.log(`[API FD] Stats calculation returned null for ${nickname}.`);
                }
            } else { console.log(`[API FD] No valid match data for ${nickname}.`); }
        } // Ende Live-Fallback

        // 5) Daten in Antwort übernehmen
        if (statsObj) {
            Object.assign(resp, {
                calculatedRating: statsObj.calculatedRating, kd: statsObj.kd, dpr: statsObj.dpr,
                kpr: statsObj.kpr, adr: statsObj.adr, hsPercent: statsObj.hsPercent,
                kast: statsObj.kast, impact: statsObj.impact, matchesConsidered: statsObj.matchesConsidered,
                lastUpdated: statsObj.lastUpdated
            });
        }

        // 6) Antwort senden
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300, max-age=0");
        return res.status(200).json(resp);

    } catch (err) {
        console.error(`[API FD] Error processing ${nickname}:`, err);
        return res.status(200).json({
          nickname: nickname || req.query.nickname, error: err.message || "Serverfehler.",
          calculatedRating: null, kd: null, dpr: null, kpr: null, adr: null, hsPercent: null,
          kast: null, impact: null, matchesConsidered: 0, lastUpdated: null, cacheStatus: 'error'
        });
    }
}