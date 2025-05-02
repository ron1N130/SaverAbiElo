// api/faceit-data.js – Refactored
// -------------------------------------------------
// ◼ Nutzt zentrale Statistik-Berechnung aus /api/utils/stats.js
// ◼ Cache Version 6
// ◼ *** DETAILLIERTES LOGGING für übersprungene Matches hinzugefügt ***
// -------------------------------------------------
import Redis from "ioredis";
import { calculateAverageStats } from './utils/stats.js';

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL      = process.env.REDIS_URL;
const API_BASE_URL   = "https://open.faceit.com/data/v4";
const CACHE_VERSION  = 6;
const MATCHES_MAX    = 10;

// --- Hilfs‑Fetch mit Error‑Throw ---
async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`);
    return res.json();
}

// --- Funktion zur Berechnung der Form basierend auf den letzten 15 Matches ---
function calculateCurrentFormStats(matches) {
    const recent = matches
        .slice()
        .sort((a,b)=> (new Date(b.CreatedAt).getTime() || 0) - (new Date(a.CreatedAt).getTime() || 0))
        // Verwende die Konstante MATCHES_MAX für das Slice
        .slice(0, MATCHES_MAX);
    const statsResult = calculateAverageStats(recent);
    return {
        stats: statsResult,
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
        const details = await fetchJson(`${API_BASE_URL}/players?nickname=${encodeURIComponent(nickname)}`, headers);
        const playerId = details?.player_id;
        if (!playerId) throw new Error(`Player ${nickname} not found.`);

        const resp = { /* ... (Grundgerüst wie gehabt) ... */
            nickname: details.nickname, avatar: details.avatar || "default_avatar.png",
            faceitUrl: details.faceit_url?.replace("{lang}", "en") ?? `https://faceit.com/en/players/${details.nickname}`,
            elo: details.games?.cs2?.faceit_elo ?? "N/A", level: details.games?.cs2?.skill_level ?? "N/A",
            sortElo: parseInt(details.games?.cs2?.faceit_elo, 10) || 0,
            calculatedRating: null, kd: null, dpr: null, kpr: null, adr: null,
            hsPercent: null, kast: null, impact: null, matchesConsidered: 0,
            lastUpdated: null, cacheStatus: 'miss'
         };

        let statsObj = null;
        if (redis) { /* ... (Cache-Prüfung wie gehabt) ... */
            const cacheKey = `player_stats:${playerId}`;
            try {
                const raw = await redis.get(cacheKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed.version === CACHE_VERSION) { statsObj = parsed; resp.cacheStatus = 'hit'; }
                    else { resp.cacheStatus = 'stale'; console.log(`[Cache FD] Stale v${parsed.version} for ${nickname}`); }
                } else { resp.cacheStatus = 'miss'; }
            } catch (e) { console.error(`[Cache FD] Error GET/parse for ${nickname}:`, e); resp.cacheStatus = 'error'; }
        } else { resp.cacheStatus = 'disabled'; }


        if (resp.cacheStatus !== 'hit') {
            let items = [];
            try {
                // Verwende die Konstante MATCHES_MAX im Limit-Parameter
                const hist = await fetchJson(`${API_BASE_URL}/players/${playerId}/history?game=cs2&limit=${MATCHES_MAX}`, headers);
                items = hist?.items || [];
            } catch (histErr) { console.warn(`[API FD] History fetch failed for ${nickname}:`, histErr.message); items = []; } 

            let matchData = [];
            let skippedMatchCount = 0; // Zähler für übersprungene Matches
            if (items.length > 0) {
                const matchDataPromises = items.map(async (h) => {
                    const matchId = h.match_id; // Match-ID für Logs speichern
                    try {
                        const stat = await fetchJson(`${API_BASE_URL}/matches/${matchId}/stats`, headers);
                        const round = stat?.rounds?.[0];
                        // *** NEUES LOGGING ***
                        if (!round) {
                            console.warn(`[API FD] Skipping match ${matchId} for ${nickname}: No round data found.`);
                            skippedMatchCount++;
                            return null;
                        }

                        const teamData = round.teams?.find(team => team.players?.some(p => p.player_id === playerId));
                        // *** NEUES LOGGING ***
                        if (!teamData) {
                            console.warn(`[API FD] Skipping match ${matchId} for ${nickname}: Player ${playerId} not found in any team.`);
                             skippedMatchCount++;
                            return null;
                        }
                        const p = teamData.players.find(p => p.player_id === playerId);
                         // *** NEUES LOGGING ***
                        if (!p || !p.player_stats) {
                             console.warn(`[API FD] Skipping match ${matchId} for ${nickname}: Player stats missing for player ${playerId}.`);
                             skippedMatchCount++;
                            return null;
                        }

                        // Gültige Daten gefunden, verarbeiten
                        return {
                            Kills: +p.player_stats.Kills, Deaths: +p.player_stats.Deaths,
                            Assists: +p.player_stats.Assists, Headshots: +p.player_stats.Headshots,
                            "K/R Ratio": +p.player_stats["K/R Ratio"],
                            ADR: +(p.player_stats.ADR ?? p.player_stats["Average Damage per Round"]),
                            Rounds: +(round.round_stats?.Rounds || 1),
                            Win: round.round_stats?.Winner === teamData.team_id ? 1 : 0,
                            CreatedAt: h.started_at
                        };
                    } catch (matchErr) {
                         // *** NEUES LOGGING ***
                         console.warn(`[API FD] Skipping match ${matchId} for ${nickname} due to fetch/processing error: ${matchErr.message}`);
                         skippedMatchCount++;
                        return null; // Überspringe bei Fehler
                    }
                });
                matchData = (await Promise.all(matchDataPromises)).filter(Boolean); // Nur gültige Ergebnisse behalten
            }

            // *** NEUES LOGGING ***
            console.log(`[API FD] For ${nickname}: Fetched history for ${items.length} matches. Successfully processed details for ${matchData.length} matches. Skipped ${skippedMatchCount} matches.`);

            if (matchData.length > 0) {
                const { stats, matchesCount } = calculateCurrentFormStats(matchData);
                if (stats) {
                    statsObj = {
                        version:          CACHE_VERSION,
                        calculatedRating: stats.rating, kd: stats.kd, dpr: stats.dpr,
                        kpr:              stats.kpr, adr: stats.adr, hsPercent: stats.hsp,
                        kast:             stats.kast, impact: stats.impact,
                        matchesConsidered: matchesCount, // Diese Zahl zeigt an, wie viele verwendet wurden (max 15)
                        lastUpdated:      new Date().toISOString()
                    };
                    if (redis && resp.cacheStatus !== 'disabled') { /* ... (Cache schreiben) ... */
                         try { await redis.set(`player_stats:${playerId}`, JSON.stringify(statsObj), "EX", 7 * 24 * 60 * 60); }
                         catch (cacheWriteErr) { console.error(`[Cache FD] Failed SET for ${nickname}:`, cacheWriteErr); }
                    }
                } else { console.log(`[API FD] Stats calculation returned null for ${nickname}.`); }
            } else { console.log(`[API FD] No valid match data found for ${nickname} to calculate stats.`); }
        }

        if (statsObj) { Object.assign(resp, { /* ... (Daten in resp übernehmen) ... */
            calculatedRating: statsObj.calculatedRating, kd: statsObj.kd, dpr: statsObj.dpr,
            kpr: statsObj.kpr, adr: statsObj.adr, hsPercent: statsObj.hsPercent,
            kast: statsObj.kast, impact: statsObj.impact, matchesConsidered: statsObj.matchesConsidered,
            lastUpdated: statsObj.lastUpdated
        }); }

        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300, max-age=0");
        return res.status(200).json(resp);

    } catch (err) { /* ... (Allgemeine Fehlerbehandlung) ... */
        console.error(`[API FD] Error processing ${nickname}:`, err);
        return res.status(200).json({
          nickname: nickname || req.query.nickname, error: err.message || "Serverfehler.",
          calculatedRating: null, kd: null, dpr: null, kpr: null, adr: null, hsPercent: null,
          kast: null, impact: null, matchesConsidered: 0, lastUpdated: null, cacheStatus: 'error'
        });
     }
}