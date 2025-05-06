// api/faceit-data.js – Refactored
// -------------------------------------------------
// ◼ Nutzt zentrale Statistik-Berechnung aus /api/utils/stats.js
// ◼ Cache Version 7 (Erhöht wegen neuer Cache-Logik/Struktur)
// ◼ Implementiert Cache-Invalidierung basierend auf Spieler-Aktivität (Annahme: details.last_modified)
// ◼ Nutzt MATCHES_MAX Konstante
// ◼ Reduzierte Cache-TTL auf 1 Tag
// ◼ Detailliertes Logging
// -------------------------------------------------
import Redis from "ioredis";
import { calculateAverageStats } from './utils/stats.js'; // Stelle sicher, dass dieser Pfad korrekt ist

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL      = process.env.REDIS_URL;
const API_BASE_URL   = "https://open.faceit.com/data/v4";
const CACHE_VERSION = 13;
const MATCHES_MAX    = 15; // Anzahl der zu berücksichtigenden Matches << HIER ANPASSEN FALLS NÖTIG
const TARGET_MATCHES_COUNT = 15;
const CACHE_TTL_SECONDS = 24 * 60 * 60; // Cache-Ablaufzeit: 24 Stunden (als Fallback)

// --- Hilfs‑Fetch mit Error‑Throw ---
async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
        // Versuche, Fehlerdetails aus der Antwort zu lesen
        let errorBody = '';
        try { errorBody = await res.text(); } catch(e) {/* ignore */}
        console.error(`[Fetch Error] URL: ${url}, Status: ${res.status}, Body: ${errorBody}`);
        throw new Error(`Workspace ${url} → ${res.status}`);
    }
    return res.json();
}

// --- Funktion zur Berechnung der Form basierend auf den letzten MATCHES_MAX Matches ---
// Diese Funktion erhält die erfolgreich abgerufenen Match-Detaildaten
function calculateCurrentFormStats(matches) {
    // Sortiere nach Datum (neueste zuerst) und nimm die letzten TARGET_MATCHES_COUNT (was MATCHES_MAX used to be)
    const recent = matches
        .slice() // Kopie erstellen
        .sort((a,b)=> (new Date(b.CreatedAt).getTime() || 0) - (new Date(a.CreatedAt).getTime() || 0))
        .slice(0, TARGET_MATCHES_COUNT); // Begrenzung auf TARGET_MATCHES_COUNT

    if (recent.length === 0) {
        console.log("[Stats Calc] No matches provided to calculateCurrentFormStats.");
        return { stats: null, matchesCount: 0 };
    }

    const statsResult = calculateAverageStats(recent); // calculateAverageStats kommt aus utils/stats.js

    return {
        stats: statsResult,
        matchesCount: recent.length
    };
}

// --- Redis‑Init ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 10000,
            maxRetriesPerRequest: 2,
            showFriendlyErrorStack: true // Hilfreich für Debugging
        });
        redis.on("error", (err) => { console.error("[Redis FD] Connection error:", err.message); redis = null; });
        redis.on("connect", () => { console.log("[Redis FD] Connected successfully."); });
        // Optional: Einmalig verbinden versuchen, um Fehler früh zu sehen
        redis.connect().catch(err => console.error("[Redis FD] Initial connection attempt failed:", err.message));
    } catch(e) { console.error("[Redis FD] Initialization failed:", e); redis = null; }
} else { console.warn("[Redis FD] REDIS_URL not set. Caching disabled."); }

// --- Haupt‑Handler ---
export default async function handler(req, res) {
    const nickname = req.query.nickname;
    if (!nickname) {
        return res.status(400).json({ error: "nickname fehlt" });
    }

    const handlerStartTime = Date.now();

    try {
        const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` };

        console.log(`[API FD] Fetching player details for ${nickname}...`);
        const details = await fetchJson(`${API_BASE_URL}/players?nickname=${encodeURIComponent(nickname)}`, headers);
        const playerId = details?.player_id;
        if (!playerId) throw new Error(`Player ${nickname} not found.`);

        const lastActivityTimestampISO = details.last_modified;
        console.log(`[API FD] Player details for ${nickname}: player_id=${playerId}, last_activity_timestamp='${lastActivityTimestampISO}' (raw)`);

        const resp = {
            nickname: details.nickname, avatar: details.avatar || "default_avatar.png",
            faceitUrl: details.faceit_url?.replace("{lang}", "en") ?? `https://faceit.com/en/players/${details.nickname}`,
            elo: details.games?.cs2?.faceit_elo ?? "N/A", level: details.games?.cs2?.skill_level ?? "N/A",
            sortElo: parseInt(details.games?.cs2?.faceit_elo, 10) || 0,
            calculatedRating: null, kd: null, dpr: null, kpr: null, adr: null,
            hsPercent: null, kast: null, impact: null, matchesConsidered: 0,
            lastUpdated: null, cacheStatus: 'miss', fetchDurationMs: null
           };

        let statsObj = null;
        let isCacheStaleByActivity = false;

        if (redis && redis.status === 'ready') {
            const cacheKey = `player_stats:${playerId}`;
            try {
                const raw = await redis.get(cacheKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed.version === CACHE_VERSION) {
                        statsObj = parsed;
                        resp.cacheStatus = 'hit';
                        console.log(`[Cache FD] Potential HIT for ${nickname} (v${parsed.version}). Cached at: ${parsed.lastUpdated}`);

                        if (lastActivityTimestampISO && statsObj.lastUpdated) {
                           try {
                               const activityDate = new Date(lastActivityTimestampISO);
                               const cacheDate = new Date(statsObj.lastUpdated);
                               if (!isNaN(activityDate) && !isNaN(cacheDate)) {
                                   if (activityDate > cacheDate) {
                                       console.log(`[Cache FD] STALE by activity for ${nickname}. Player Activity: ${activityDate.toISOString()} > Cache Timestamp: ${cacheDate.toISOString()}`);
                                       isCacheStaleByActivity = true;
                                       resp.cacheStatus = 'stale_by_activity';
                                       statsObj = null;
                                   } else {
                                       console.log(`[Cache FD] VALID HIT for ${nickname}. Player Activity not newer than Cache.`);
                                   }
                               } else {
                                    console.warn(`[Cache FD] Could not parse dates for activity check. Activity='${lastActivityTimestampISO}', Cache='${statsObj.lastUpdated}'`);
                               }
                           } catch (dateErr) {
                                console.error(`[Cache FD] Error comparing dates for ${nickname}:`, dateErr);
                           }
                        } else {
                             console.log(`[Cache FD] Skipping activity check for ${nickname} (missing lastActivityTimestamp or cached lastUpdated).`);
                        }

                        // --- NEW LOGIC: Check for minimum matches in cached data ---
                        if (statsObj && statsObj.matchesConsidered < TARGET_MATCHES_COUNT) {
                            console.log(`[Cache FD] STALE by min_matches for ${nickname}. Cached matches: ${statsObj.matchesConsidered}, Target: ${TARGET_MATCHES_COUNT}`);
                            isCacheStaleByActivity = true; // Use existing flag to trigger re-fetch
                            resp.cacheStatus = 'stale_min_matches'; // Specific status for this case
                            statsObj = null; // Invalidate cached data
                        }
                        // --- END NEW LOGIC ---

                    } else {
                        resp.cacheStatus = 'stale_version';
                        console.log(`[Cache FD] Stale cache version v${parsed.version} found for ${nickname} (expected v${CACHE_VERSION}).`);
                    }
                } else {
                    resp.cacheStatus = 'miss';
                    console.log(`[Cache FD] MISS for ${nickname}.`);
                }
            } catch (e) {
                console.error(`[Cache FD] Error GET/parse for ${nickname}:`, e);
                resp.cacheStatus = 'error';
                statsObj = null;
            }
        } else {
            resp.cacheStatus = redis ? `disabled (Redis status: ${redis.status})` : 'disabled (No Redis URL)';
            console.log(`[Cache FD] Caching disabled or Redis not ready for ${nickname}. Status: ${resp.cacheStatus}`);
        }

        // MODIFIED: Trigger re-fetch also if isCacheStaleByActivity is true (set by min_matches logic)
        if (resp.cacheStatus !== 'hit' || isCacheStaleByActivity) {
            console.log(`[API FD] Fetching new match data for ${nickname} because cache status is '${resp.cacheStatus}' (or forced by activity/min_matches)...`);
            let items = [];
            try {
                // --- NEW LOGIC: Fetch more matches to account for skips ---
                const effectiveFetchLimit = TARGET_MATCHES_COUNT + FETCH_BUFFER;
                const histUrl = `${API_BASE_URL}/players/${playerId}/history?game=cs2&limit=${effectiveFetchLimit}`;
                // --- END NEW LOGIC ---
                console.log(`[API FD] Fetching history (limit ${effectiveFetchLimit}): ${histUrl}`);
                const hist = await fetchJson(histUrl, headers);
                items = hist?.items || [];
            } catch (histErr) { console.warn(`[API FD] History fetch failed for ${nickname}:`, histErr.message); items = []; }

            let matchData = [];
            let skippedMatchCount = 0;
            if (items.length > 0) {
                const matchDataPromises = items.map(async (h) => {
                    const matchId = h.match_id;
                    try {
                        const statUrl = `${API_BASE_URL}/matches/${matchId}/stats`;
                        const stat = await fetchJson(statUrl, headers);
                        const round = stat?.rounds?.[0];

                        if (!round) {
                            console.warn(`[API FD] Skipping match ${matchId} for ${nickname}: No round data found.`);
                            skippedMatchCount++; return null;
                        }
                        const teamData = round.teams?.find(team => team.players?.some(p => p.player_id === playerId));
                        if (!teamData) {
                            console.warn(`[API FD] Skipping match ${matchId} for ${nickname}: Player ${playerId} not found in any team.`);
                             skippedMatchCount++; return null;
                        }
                        const p = teamData.players.find(p => p.player_id === playerId);
                        if (!p || !p.player_stats) {
                             console.warn(`[API FD] Skipping match ${matchId} for ${nickname}: Player stats missing for player ${playerId}.`);
                             skippedMatchCount++; return null;
                        }

                        return {
                            Kills: +p.player_stats.Kills || 0,
                            Deaths: +p.player_stats.Deaths || 0,
                            Assists: +p.player_stats.Assists || 0,
                            Headshots: +p.player_stats.Headshots || 0,
                            MVPs: +p.player_stats.MVPs || 0,
                            TripleKills: +p.player_stats["Triple Kills"] || 0,
                            QuadroKills: +p.player_stats["Quadro Kills"] || 0,
                            PentaKills: +p.player_stats["Penta Kills"] || 0,
                            KR_Ratio: +p.player_stats["K/R Ratio"] || 0,
                            KD_Ratio: +p.player_stats["K/D Ratio"] || 0,
                            ADR: +(p.player_stats.ADR ?? p.player_stats["Average Damage per Round"] ?? 0),
                            Rounds: +(round.round_stats?.Rounds || 0),
                            Win: round.round_stats?.Winner === teamData.team_id ? 1 : 0,
                            CreatedAt: h.started_at || new Date(0).toISOString()
                        };
                    } catch (matchErr) {
                         console.warn(`[API FD] Skipping match ${matchId} for ${nickname} due to fetch/processing error: ${matchErr.message}`);
                         skippedMatchCount++;
                        return null;
                    }
                });
                matchData = (await Promise.all(matchDataPromises)).filter(Boolean);
            }

            console.log(`[API FD] For ${nickname}: Fetched history for ${items.length} matches. Successfully processed details for ${matchData.length} matches. Skipped ${skippedMatchCount} matches.`);

            if (matchData.length > 0) {
                // calculateCurrentFormStats will internally sort by date and slice to TARGET_MATCHES_COUNT (15)
                // if its internal MATCHES_MAX is also 15.
                const { stats, matchesCount } = calculateCurrentFormStats(matchData); // Pass all validly fetched matches
                if (stats) {
                    statsObj = {
                        version: CACHE_VERSION,
                        calculatedRating: stats.rating, kd: stats.kd, dpr: stats.dpr,
                        kpr: stats.kpr, adr: stats.adr, hsPercent: stats.hsp,
                        kast: stats.kast, impact: stats.impact,
                        matchesConsidered: matchesCount, // This will be <= TARGET_MATCHES_COUNT
                        lastUpdated: new Date().toISOString()
                    };
                    console.log(`[API FD] Stats calculated for ${nickname}: Rating=${stats.rating}, KD=${stats.kd}, Matches=${matchesCount}`);

                    if (redis && redis.status === 'ready') {
                        try {
                            await redis.set(`player_stats:${playerId}`, JSON.stringify(statsObj), "EX", CACHE_TTL_SECONDS);
                            console.log(`[Cache FD] SET successful for ${nickname}. TTL: ${CACHE_TTL_SECONDS}s`);
                        } catch (cacheWriteErr) {
                            console.error(`[Cache FD] Failed SET for ${nickname}:`, cacheWriteErr);
                        }
                    }
                } else { console.log(`[API FD] Stats calculation returned null for ${nickname}.`); }
            } else { console.log(`[API FD] No valid match data found for ${nickname} to calculate stats.`); }
        }

        if (statsObj) {
            Object.assign(resp, {
                calculatedRating: statsObj.calculatedRating, kd: statsObj.kd, dpr: statsObj.dpr,
                kpr: statsObj.kpr, adr: statsObj.adr, hsPercent: statsObj.hsPercent,
                kast: statsObj.kast, impact: statsObj.impact, matchesConsidered: statsObj.matchesConsidered,
                lastUpdated: statsObj.lastUpdated
            });
        }

        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300, max-age=0");
        resp.fetchDurationMs = Date.now() - handlerStartTime;
        console.log(`[API FD] Responding for ${nickname}. Status: ${resp.error ? 'ERROR' : 'OK'}, Cache: ${resp.cacheStatus}, Matches Considered: ${resp.matchesConsidered}, Duration: ${resp.fetchDurationMs}ms`);
        return res.status(200).json(resp);

    } catch (err) {
        console.error(`[API FD] FATAL Error processing ${nickname}:`, err);
        const fetchDurationMs = Date.now() - handlerStartTime;
        return res.status(200).json({
            nickname: nickname || req.query.nickname,
            error: err.message || "Unbekannter Serverfehler.",
            calculatedRating: null, kd: null, dpr: null, kpr: null, adr: null, hsPercent: null,
            kast: null, impact: null, matchesConsidered: 0, lastUpdated: null,
            cacheStatus: 'error', fetchDurationMs: fetchDurationMs
        });
       }
}