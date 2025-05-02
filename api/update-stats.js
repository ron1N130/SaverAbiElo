// api/update-stats.js – Optimiert für 60s Timeout
// -------------------------------------------------
// ◼ Prüft Timestamp des letzten Matches vor Update
// ◼ Nutzt zentrale Statistik-Berechnung aus /api/utils/stats.js
// ◼ Cache Version 7
// -------------------------------------------------

import Redis from "ioredis";
import fs from "fs";
import path from "path";
import { calculateAverageStats } from './utils/stats.js'; // Pfad prüfen!

// --- Cache Version ---
const CACHE_VERSION = 7;

// --- Helpers ---
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Konfiguration ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const MATCH_COUNT = 15; // Max. History für Berechnung holen
const API_DELAY = 600;  // Verzögerung zwischen API-Aufrufen
const BATCH_SIZE = 5;   // Match-Details Batch-Größe

// --- Redis‑Initialisierung ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 10000, // 10s Timeout (kann man ggf. erhöhen, z.B. 15000)
            maxRetriesPerRequest: 2,
            showFriendlyErrorStack: true
        });
        redis.on("error", (err) => {
            console.error("[Redis Update] Connection error:", err.message);
            redis = null;
        });
        console.log("[Redis Update] Client initialized (lazy).");
    } catch (e) {
        console.error("[Redis Update] Initialization failed:", e);
        redis = null;
    }
} else {
    console.warn("[Redis Update] REDIS_URL not set. Caching disabled.");
}

// --- Hilfs‑Fetch ---
async function fetchFaceitApi(endpoint, retries = 3) {
    await delay(API_DELAY);
    const url = `${API_BASE_URL}${endpoint}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}`, 'Accept': 'application/json' } });
        if (res.status === 429) {
            console.warn(`[API Update] Rate limit hit (429) for ${endpoint} – sleeping...`);
            await delay(API_DELAY * 15);
            if (retries > 0) return fetchFaceitApi(endpoint, retries - 1);
            else throw new Error(`API Rate limit exceeded after retries for ${endpoint}`);
        }
        if (res.status === 401) throw new Error(`API Authentication failed (401)`);
        if (res.status === 404) { console.warn(`[API Update] Not found (404) for ${endpoint}.`); return null; }
        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`API request failed ${endpoint} (${res.status}): ${errBody}`);
        }
        return await res.json();
    } catch (error) {
        console.error(`[API Update] Fetch error for ${endpoint}: ${error.message}`);
        if (retries > 0) {
            await delay(API_DELAY * (5 - retries + 1));
            return fetchFaceitApi(endpoint, retries - 1);
        } else {
            console.error(`[API Update] Fetch failed for ${endpoint} after all retries.`);
            throw error;
        }
    }
}

// --- Funktion zur Berechnung der Form (Letzte 10 Matches) ---
function calculateCurrentFormStats(matches) {
    const sorted = [...matches].sort((a, b) => (Number(b.CreatedAt) || 0) - (Number(a.CreatedAt) || 0));
    const recent = sorted.slice(0, 10);
    if (recent.length === 0) return { stats: null, matchesCount: 0 };
    const statsResult = calculateAverageStats(recent);
    return {
        stats: statsResult,
        matchesCount: recent.length,
    };
}

// --- Cron Job Handler (Optimiert mit Timestamp-Check) ---
export default async function handler(req, res) {
    const startTime = Date.now();
    // Die Log-Nachricht wieder auf die ursprüngliche ändern (ohne STATEFUL)
    console.log(`[CRON][${new Date().toISOString()}] Starting optimized stats update job...`);

    // Spielerliste laden
    const jsonPath = path.resolve(process.cwd(), "players.json");
    let playerList = [];
    try {
        playerList = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        if (!Array.isArray(playerList) || playerList.length === 0) throw new Error("players.json is empty or not a valid JSON array.");
        console.log(`[CRON] Loaded ${playerList.length} players.`);
    } catch (e) {
        console.error("[CRON] Failed to read/parse players.json:", e.message);
        return res.status(500).json({ message: "Could not read/parse player list." });
    }

    if (!redis) {
        console.warn("[CRON] Redis not available. Stats will not be cached or checked for updates.");
    }

    let success = 0;
    let failed = 0;
    let skipped = 0;

    // Wieder eine einfache Schleife über alle Spieler
    for (const nickname of playerList) {
        console.log(`[CRON] Processing player: ${nickname}`);
        let playerNeedsUpdate = true;
        let currentLastKnownTimestamp = null;
        let latestMatchTimestamp = null;
        let playerId = null;
        let existingData = null;

        try {
            // a) Spieler-ID holen
            const details = await fetchFaceitApi(`/players?nickname=${encodeURIComponent(nickname)}`);
            playerId = details?.player_id;
            if (!playerId) {
                console.warn(`[CRON] Could not find player_id for ${nickname}. Skipping.`);
                failed++;
                continue; // Nächster Spieler
            }

            // b) Letzten Stand aus Redis lesen (falls Redis verfügbar)
            if (redis) {
                const cacheKey = `player_stats:${playerId}`;
                try {
                    const raw = await redis.get(cacheKey);
                    if (raw) {
                        existingData = JSON.parse(raw);
                        if (existingData?.version === CACHE_VERSION && typeof existingData?.lastMatchTimestamp === 'number') {
                            currentLastKnownTimestamp = existingData.lastMatchTimestamp;
                        } else {
                            console.log(`[CRON] Cache data for ${nickname} (ID: ${playerId}) is old version or missing timestamp. Forcing update.`);
                            currentLastKnownTimestamp = null;
                        }
                    }
                } catch (redisError) {
                    console.error(`[CRON] Failed Redis GET for ${nickname} (ID: ${playerId}): ${redisError.message}. Assuming update needed.`);
                    currentLastKnownTimestamp = null;
                }
            } else {
                currentLastKnownTimestamp = null;
            }

            // c) Letztes Match holen
            const latestHistory = await fetchFaceitApi(`/players/${playerId}/history?game=cs2&limit=1`);

            // d) Zeitstempel vergleichen
            if (latestHistory?.items?.[0]?.started_at) {
                latestMatchTimestamp = latestHistory.items[0].started_at;
                if (redis && currentLastKnownTimestamp !== null && latestMatchTimestamp <= currentLastKnownTimestamp) {
                    console.log(`[CRON] Player ${nickname} (ID: ${playerId}) is up-to-date (Last match timestamp: ${latestMatchTimestamp}). Skipping full update.`);
                    playerNeedsUpdate = false;
                    skipped++;
                } else {
                    console.log(`[CRON] Player ${nickname} (ID: ${playerId}) needs update. Newest match ts: ${latestMatchTimestamp}. Last known ts: ${currentLastKnownTimestamp ?? 'None'}.`);
                }
            } else {
                console.log(`[CRON] No history found for ${nickname} (ID: ${playerId}). Skipping update.`);
                playerNeedsUpdate = false;
                skipped++;
            }

            // e) Volles Update, wenn nötig
            if (playerNeedsUpdate) {
                console.log(`[CRON] Fetching full history (${MATCH_COUNT} matches) and details for ${nickname}...`);
                const history = await fetchFaceitApi(`/players/${playerId}/history?game=cs2&limit=${MATCH_COUNT}`);
                if (!history || !Array.isArray(history.items) || history.items.length === 0) {
                    console.warn(`[CRON] No full history found for ${nickname} (ID: ${playerId}) during update attempt. Skipping.`);
                    failed++;
                    continue;
                }

                // Match-Details holen
                const matchesForCalc = [];
                for (let batchStartIndex = 0; batchStartIndex < history.items.length; batchStartIndex += BATCH_SIZE) {
                    const batchItems = history.items.slice(batchStartIndex, batchStartIndex + BATCH_SIZE);
                    const batchPromises = batchItems.map(async (h) => {
                        try {
                            const statsData = await fetchFaceitApi(`/matches/${h.match_id}/stats`);
                            if (!statsData?.rounds?.[0]?.teams) return null;
                            const roundStats = statsData.rounds[0].round_stats;
                            const winningTeamId = roundStats?.["Winner"];
                            const matchRounds = parseInt(roundStats?.["Rounds"], 10);
                            if (isNaN(matchRounds) || matchRounds <= 0) return null; // Ungültige Runden überspringen
                            let playerTeamData = null, playerStatsData = null;
                            for (const team of statsData.rounds[0].teams) {
                                const player = team.players?.find((p) => p.player_id === playerId);
                                if (player) { playerTeamData = team; playerStatsData = player.player_stats; break; }
                            }
                            if (!playerTeamData || !playerStatsData) return null;
                            return {
                                Kills: +(playerStatsData["Kills"] ?? 0), Deaths: +(playerStatsData["Deaths"] ?? 0),
                                Assists: +(playerStatsData["Assists"] ?? 0), Headshots: +(playerStatsData["Headshots"] ?? 0),
                                "K/R Ratio": +(playerStatsData["K/R Ratio"] ?? 0),
                                ADR: +(playerStatsData["ADR"] ?? playerStatsData["Average Damage per Round"] ?? 0),
                                Rounds: matchRounds, Win: winningTeamId ? (playerTeamData.team_id === winningTeamId ? 1 : 0) : 0,
                                CreatedAt: h.started_at,
                            };
                        } catch (matchErr) {
                            console.warn(`[CRON] Failed fetch/process match detail ${h.match_id} for ${nickname}: ${matchErr.message}`);
                            return null;
                        }
                    });
                    const batchResults = (await Promise.all(batchPromises)).filter(Boolean);
                    matchesForCalc.push(...batchResults);
                } // Ende Batch-Schleife

                if (matchesForCalc.length === 0) {
                    console.warn(`[CRON] No valid match details could be fetched for ${nickname} (ID: ${playerId}). Skipping calculation.`);
                    failed++;
                    continue;
                }

                // f) Stats berechnen
                const { stats, matchesCount } = calculateCurrentFormStats(matchesForCalc);
                if (!stats) {
                    console.warn(`[CRON] Stats calculation returned null for ${nickname} (ID: ${playerId}). Skipping save.`);
                    failed++;
                    continue;
                }

                // g) Daten für Redis vorbereiten
                const newestMatchTimestampInHistory = history.items[0]?.started_at ?? latestMatchTimestamp;
                const dataToStore = {
                    version: CACHE_VERSION,
                    calculatedRating: stats.rating, kd: stats.kd, adr: stats.adr,
                    winRate: stats.winRate, hsPercent: stats.hsp, kast: stats.kast,
                    impact: stats.impact, matchesConsidered: matchesCount,
                    lastUpdated: new Date().toISOString(), kpr: stats.kpr, dpr: stats.dpr,
                    apr: stats.apr ?? 0, lastMatchTimestamp: newestMatchTimestampInHistory
                };

                // h) In Redis speichern
                if (redis) {
                    const cacheKey = `player_stats:${playerId}`;
                    try {
                        await redis.set(cacheKey, JSON.stringify(dataToStore), "EX", 7 * 24 * 60 * 60);
                        console.log(`[CRON] Successfully updated stats for ${nickname} (ID: ${playerId}) in Redis.`);
                        success++;
                    } catch (redisError) {
                        console.error(`[CRON] Failed Redis SET for ${nickname} (ID: ${playerId}): ${redisError.message}.`);
                        failed++;
                    }
                } else {
                    success++;
                }
            } else {
                 // Spieler wurde übersprungen (war aktuell)
                 // Der skipped-Zähler wurde bereits oben inkrementiert
            }

        } catch (e) {
            console.error(`[CRON] Processing failed unexpectedly for ${nickname} (PlayerID: ${playerId ?? 'unknown'}):`, e);
            failed++;
        }
    } // Ende Spieler-Loop

    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`[CRON][${new Date().toISOString()}] Job finished in ${duration}ms. Success: ${success}, Failed: ${failed}, Skipped (Up-to-date): ${skipped}`);

    // Wichtig: Auch wenn die Funktion länger als 10s läuft, sollte sie jetzt (mit 60s Limit)
    // normal beendet werden und eine 200er Antwort senden.
    res.status(200).json({
        message: `Cron job finished. Updated: ${success}, Failed: ${failed}, Skipped: ${skipped}`,
        success,
        failed,
        skipped,
        durationMs: duration
    });
}