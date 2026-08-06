// api/faceit-data.js – Refactored
// -------------------------------------------------
// ◼ Nutzt zentrale Statistik-Berechnung aus /api/utils/stats.js
// ◼ Cache Version 7 (Erhöht wegen neuer Cache-Logik/Struktur)
// ◼ Implementiert Cache-Invalidierung basierend auf Spieler-Aktivität (Annahme: details.last_modified)
// ◼ Reduzierte Cache-TTL auf 1 Tag
// ◼ Detailliertes Logging
// -------------------------------------------------
import Redis from "ioredis";
import { calculateAverageStats } from './utils/stats.js'; // Stelle sicher, dass dieser Pfad korrekt ist
import {
    extractSeasonElo,
    faceitLevelForElo,
    faceitSeasonId,
    findFaceitSeasonRecord,
    historicalEloFromMatchRounds,
    historicalEloFromPlayerStats,
    profileCalibrationStatus,
    resolveFaceitSeason
} from './utils/faceit-seasons.js';

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL      = process.env.REDIS_URL;
const API_BASE_URL   = "https://open.faceit.com/data/v4";
const FACEIT_PROFILE_BASE_URL = "https://api.faceit.com/users/v1";
const FACEIT_SEASON_BASE_URL = "https://www.faceit.com/api/statistics/v1/cs2";
const CACHE_VERSION = 16;
const TARGET_MATCHES_COUNT = 15;
const FETCH_BUFFER = 5;
const CACHE_TTL_SECONDS = 24 * 60 * 60; // Cache-Ablaufzeit: 24 Stunden (als Fallback)
const PLACEMENT_CACHE_TTL_SECONDS = 5 * 60;
const RANKED_CACHE_TTL_SECONDS = 30 * 60;
const HISTORICAL_ELO_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const MISSING_HISTORICAL_ELO_CACHE_TTL_SECONDS = 10 * 60;
const OPTIONAL_FETCH_TIMEOUT_MS = 8_000;

// --- Hilfs‑Fetch mit Error‑Throw ---
async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
        // Versuche, Fehlerdetails aus der Antwort zu lesen
        let errorBody = '';
        try { errorBody = await res.text(); } catch {/* ignore */}
        console.error(`[Fetch Error] URL: ${url}, Status: ${res.status}, Body: ${errorBody}`);
        throw new Error(`Workspace ${url} → ${res.status}`);
    }
    return res.json();
}

async function fetchOptionalJson(url, headers = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPTIONAL_FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok) {
            throw new Error(`${url} → ${response.status}`);
        }
        return response.json();
    } finally {
        clearTimeout(timer);
    }
}

const faceitBrowserHeaders = {
    Accept: "application/json",
    Origin: "https://www.faceit.com",
    Referer: "https://www.faceit.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36",
    ...(FACEIT_API_KEY ? { Authorization: `Bearer ${FACEIT_API_KEY}` } : {})
};

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

async function readRedisJson(key) {
    if (!redis || redis.status !== "ready") return null;
    try {
        const value = await redis.get(key);
        return value ? JSON.parse(value) : null;
    } catch (error) {
        console.warn(`[Cache FD] Could not read ${key}:`, error.message);
        return null;
    }
}

async function writeRedisJson(key, value, ttlSeconds) {
    if (!redis || redis.status !== "ready") return;
    try {
        await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (error) {
        console.warn(`[Cache FD] Could not write ${key}:`, error.message);
    }
}

async function currentPlacementStatus(nickname, playerId, details) {
    const detailStatus = profileCalibrationStatus(details);
    if (detailStatus !== null) return detailStatus;

    const cacheKey = `faceit_placement:v1:${playerId}:9`;
    const cached = await readRedisJson(cacheKey);
    if (typeof cached?.isCalibrating === "boolean") return cached.isCalibrating;

    try {
        const profile = await fetchOptionalJson(
            `${FACEIT_PROFILE_BASE_URL}/nicknames/${encodeURIComponent(nickname)}`,
            faceitBrowserHeaders
        );
        const isCalibrating = profileCalibrationStatus(profile);
        if (typeof isCalibrating === "boolean") {
            await writeRedisJson(
                cacheKey,
                { isCalibrating, checkedAt: new Date().toISOString() },
                isCalibrating ? PLACEMENT_CACHE_TTL_SECONDS : RANKED_CACHE_TTL_SECONDS
            );
        }
        return isCalibrating;
    } catch (error) {
        console.warn(`[Season FD] Placement status unavailable for ${nickname}:`, error.message);
        return null;
    }
}

let faceitSeasonCatalogPromise = null;
let faceitSeasonCatalogValue = null;
let faceitSeasonCatalogExpiresAt = 0;

async function faceitSeasonCatalog() {
    if (Date.now() < faceitSeasonCatalogExpiresAt) return faceitSeasonCatalogValue;
    if (!faceitSeasonCatalogPromise) {
        faceitSeasonCatalogPromise = fetchOptionalJson(
            `${FACEIT_SEASON_BASE_URL}/seasons`,
            faceitBrowserHeaders
        ).then((catalog) => {
            faceitSeasonCatalogValue = catalog;
            faceitSeasonCatalogExpiresAt = Date.now() + 60 * 60 * 1000;
            return catalog;
        }).catch((error) => {
            console.warn("[Season FD] Season catalog unavailable:", error.message);
            faceitSeasonCatalogValue = null;
            faceitSeasonCatalogExpiresAt = Date.now() + 5 * 60 * 1000;
            return null;
        }).finally(() => {
            faceitSeasonCatalogPromise = null;
        });
    }
    return faceitSeasonCatalogPromise;
}

async function historicalSeasonElo(playerId, season, openDataHeaders) {
    const cacheKey = `faceit_season_elo:v2:${playerId}:${season.number}`;
    const cached = await readRedisJson(cacheKey);
    if (cached && Object.hasOwn(cached, "elo")) return cached;

    let elo = null;
    let source = null;
    let matchRoundSeason = season;
    let debugKeys = [];

    try {
        const catalog = await faceitSeasonCatalog();
        const seasonRecord = findFaceitSeasonRecord(catalog, season);
        const seasonId = faceitSeasonId(seasonRecord);
        if (seasonRecord) {
            matchRoundSeason = {
                ...season,
                startsAt: seasonRecord.starts_at
                    ?? seasonRecord.startsAt
                    ?? seasonRecord.start_date
                    ?? seasonRecord.startDate
                    ?? season.startsAt,
                endsAt: seasonRecord.ends_at
                    ?? seasonRecord.endsAt
                    ?? seasonRecord.end_date
                    ?? seasonRecord.endDate
                    ?? season.endsAt
            };
        }
        if (seasonId) {
            const seasonPayload = await fetchOptionalJson(
                `${FACEIT_SEASON_BASE_URL}/players/${encodeURIComponent(playerId)}/seasons/${encodeURIComponent(seasonId)}`,
                faceitBrowserHeaders
            );
            elo = extractSeasonElo(seasonPayload);
            if (elo !== null) source = "season";
        }
    } catch (error) {
        console.warn(`[Season FD] Season summary unavailable for ${playerId}:`, error.message);
    }

    if (elo === null) {
        try {
            const matchRounds = await fetchOptionalJson(
                `${FACEIT_SEASON_BASE_URL}/players/${encodeURIComponent(playerId)}/match-rounds?limit=100`,
                faceitBrowserHeaders
            );
            elo = historicalEloFromMatchRounds(matchRounds, matchRoundSeason);
            if (elo !== null) source = "match-rounds";
        } catch (error) {
            console.warn(`[Season FD] Match-round fallback unavailable for ${playerId}:`, error.message);
        }
    }

    if (elo === null) {
        try {
            const from = Date.parse(matchRoundSeason.startsAt);
            const to = Date.parse(matchRoundSeason.endsAt);
            const params = new URLSearchParams({
                offset: "0",
                limit: "100",
                from: String(from),
                to: String(to)
            });
            const playerStats = await fetchJson(
                `${API_BASE_URL}/players/${encodeURIComponent(playerId)}/games/cs2/stats?${params}`,
                openDataHeaders
            );
            debugKeys = [...new Set(
                (playerStats?.items || [])
                    .slice(0, 3)
                    .flatMap((item) => Object.keys(item?.stats || item || {}))
            )].sort();
            elo = historicalEloFromPlayerStats(playerStats, matchRoundSeason);
            if (elo !== null) source = "open-data";
        } catch (error) {
            console.warn(`[Season FD] Open Data fallback unavailable for ${playerId}:`, error.message);
        }
    }

    const result = {
        elo,
        available: elo !== null,
        source,
        debugKeys,
        checkedAt: new Date().toISOString()
    };
    await writeRedisJson(
        cacheKey,
        result,
        result.available
            ? HISTORICAL_ELO_CACHE_TTL_SECONDS
            : MISSING_HISTORICAL_ELO_CACHE_TTL_SECONDS
    );
    return result;
}

// --- Haupt‑Handler ---
export default async function handler(req, res) {
    const nickname = req.query.nickname;
    if (!nickname) {
        return res.status(400).json({ error: "nickname fehlt" });
    }
    const season = resolveFaceitSeason(req.query.season);

    const handlerStartTime = Date.now();

    try {
        const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` };

        console.log(`[API FD] Fetching player details for ${nickname}...`);
        const details = await fetchJson(`${API_BASE_URL}/players?nickname=${encodeURIComponent(nickname)}`, headers);
        const playerId = details?.player_id;
        if (!playerId) throw new Error(`Player ${nickname} not found.`);

        const lastActivityTimestampISO = details.last_modified;
        console.log(`[API FD] Player details for ${nickname}: player_id=${playerId}, last_activity_timestamp='${lastActivityTimestampISO}' (raw)`);

        const currentElo = Number.parseInt(details.games?.cs2?.faceit_elo, 10);
        let seasonElo = Number.isFinite(currentElo) ? currentElo : null;
        let seasonLevel = details.games?.cs2?.skill_level ?? null;
        let isCalibrating = false;
        let seasonAvailable = seasonElo !== null;
        let seasonSource = "current";
        let seasonDebug = null;

        if (season.current) {
            isCalibrating = await currentPlacementStatus(details.nickname || nickname, playerId, details);
            if (isCalibrating === true) {
                seasonElo = null;
                seasonLevel = null;
            }
        } else {
            const historical = await historicalSeasonElo(playerId, season, headers);
            seasonElo = historical.elo;
            seasonLevel = faceitLevelForElo(seasonElo);
            seasonAvailable = historical.available;
            seasonSource = historical.source;
            if (req.query.debug === "season-fields") {
                seasonDebug = historical.debugKeys;
            }
            isCalibrating = false;
        }

        const resp = {
            nickname: details.nickname, avatar: details.avatar || "default_avatar.png",
            faceitUrl: details.faceit_url?.replace("{lang}", "en") ?? `https://faceit.com/en/players/${details.nickname}`,
            steam64Id: details.steam_id_64 ?? null,
            elo: seasonElo,
            level: seasonLevel,
            sortElo: seasonElo,
            isUnranked: season.current && isCalibrating === true,
            placementStatus: season.current
                ? isCalibrating === true
                    ? "calibrating"
                    : isCalibrating === false
                        ? "ranked"
                        : "unknown"
                : "historical",
            seasonAvailable,
            seasonSource,
            season: {
                number: season.number,
                value: season.value,
                label: season.label,
                shortLabel: season.shortLabel,
                current: season.current
            },
            calculatedRating: null, kd: null, dpr: null, kpr: null, adr: null,
            hsPercent: null, kast: null, impact: null, matchesConsidered: 0,
            lastUpdated: null, cacheStatus: 'miss', fetchDurationMs: null
           };
        if (seasonDebug) resp.seasonDebug = seasonDebug;

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

        res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400, max-age=0");
        resp.fetchDurationMs = Date.now() - handlerStartTime;
        console.log(`[API FD] Responding for ${nickname}. Status: ${resp.error ? 'ERROR' : 'OK'}, Cache: ${resp.cacheStatus}, Matches Considered: ${resp.matchesConsidered}, Duration: ${resp.fetchDurationMs}ms`);
        return res.status(200).json(resp);

    } catch (err) {
        console.error(`[API FD] FATAL Error processing ${nickname}:`, err);
        const fetchDurationMs = Date.now() - handlerStartTime;
        return res.status(200).json({
            nickname: nickname || req.query.nickname,
            error: err.message || "Unbekannter Serverfehler.",
            season: {
                number: season.number,
                value: season.value,
                label: season.label,
                shortLabel: season.shortLabel,
                current: season.current
            },
            calculatedRating: null, kd: null, dpr: null, kpr: null, adr: null, hsPercent: null,
            kast: null, impact: null, matchesConsidered: 0, lastUpdated: null,
            cacheStatus: 'error', fetchDurationMs: fetchDurationMs
        });
       }
}
