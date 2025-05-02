// api/update-stats.js – Stateful Cron Job (Komplett & Bereinigt)
// -------------------------------------------------
// ◼ Verarbeitet Spieler in Batches, um Timeout zu vermeiden
// ◼ Prüft Timestamp des letzten Matches vor Update
// ◼ Nutzt zentrale Statistik-Berechnung aus /api/utils/stats.js
// ◼ Cache Version 7
// -------------------------------------------------

import Redis from "ioredis";
import fs from "fs";
import path from "path";
import { calculateAverageStats } from './utils/stats.js'; // Stelle sicher, dass der Pfad stimmt

// --- Cache Version ---
const CACHE_VERSION = 7;

// --- Helpers ---
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Konfiguration ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const MATCH_COUNT = 20; // Max. History für Berechnung holen (relevant für calculateCurrentFormStats)
const API_DELAY = 600; // Verzögerung zwischen API-Aufrufen in ms
const BATCH_SIZE = 5;  // Wie viele Match-Details gleichzeitig abrufen

// --- NEUE KONSTANTEN für Stateful Cron ---
const PLAYERS_PER_RUN = 3; // WIE VIELE SPIELER MAXIMAL PRO CRON-AUFRUF? (Anpassen!)
const CRON_STATE_KEY = 'cron_update_stats_state'; // Redis Key für den Job-Status

// --- Redis‑Initialisierung ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 10000, // 10 Sekunden Timeout für Verbindung
            maxRetriesPerRequest: 2,
            showFriendlyErrorStack: true
        });
        redis.on("error", (err) => {
            console.error("[Redis Update] Connection error:", err.message);
            redis = null; // Bei Fehler Redis deaktivieren für diesen Lauf
        });
        // KEIN redis.connect() hier - lazyConnect wird verwendet
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
        if (res.status === 429) { // Rate Limit Handling
            console.warn(`[API Update] Rate limit hit (429) for ${endpoint} – sleeping...`);
            await delay(API_DELAY * 15); // Länger warten
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
            await delay(API_DELAY * (5 - retries + 1)); // Increase delay on retries
            return fetchFaceitApi(endpoint, retries - 1);
        } else {
            console.error(`[API Update] Fetch failed for ${endpoint} after all retries.`);
            throw error; // Fehler nach Retries weiterwerfen
        }
    }
}

// --- Funktion zur Berechnung der Form (Letzte 10 Matches) ---
function calculateCurrentFormStats(matches) {
    // Sortiere nach Unix-Timestamp (started_at), neueste zuerst
    const sorted = [...matches].sort((a, b) => (Number(b.CreatedAt) || 0) - (Number(a.CreatedAt) || 0));
    const recent = sorted.slice(0, 10); // Nimm die letzten 10 für die Form-Berechnung
    if (recent.length === 0) {
        return { stats: null, matchesCount: 0 }; // Keine Matches für Berechnung
    }
    const statsResult = calculateAverageStats(recent); // Ruft zentrale Funktion auf
    return {
        stats: statsResult, // Enthält berechnete Stats oder null
        matchesCount: recent.length, // Anzahl der tatsächlich verwendeten Matches (max 10)
    };
}


// --- Cron Job Handler (Stateful) ---
export default async function handler(req, res) {
    const startTime = Date.now();
    console.log(`[CRON][${new Date().toISOString()}] Starting STATEFUL stats update job...`);

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

    // --- Status aus Redis lesen ---
    let lastProcessedIndex = -1;
    let stateReadError = false;
    if (redis) {
        try {
            const stateRaw = await redis.get(CRON_STATE_KEY);
            if (stateRaw) {
                const state = JSON.parse(stateRaw);
                if (typeof state?.lastProcessedIndex === 'number') {
                    lastProcessedIndex = state.lastProcessedIndex;
                }
            }
            console.log(`[CRON] Read state: lastProcessedIndex = ${lastProcessedIndex}`);
        } catch (e) {
            console.error(`[CRON] Failed to read or parse state from Redis key '${CRON_STATE_KEY}':`, e.message);
            // Fehler ist nicht kritisch, wir fangen einfach vorne an und loggen Warnung
            lastProcessedIndex = -1;
            stateReadError = true; // Merken, dass Lesen fehlschlug
        }
    } else {
        console.warn("[CRON] Redis not available. Cannot read state. Starting from index 0.");
        lastProcessedIndex = -1;
    }

    let success = 0;
    let failed = 0;
    let skipped = 0;
    let processedInThisRun = 0;
    let lastIndexProcessedInThisRun = -1; // Merken, bis wohin wir *in diesem Lauf* kamen

    const startIndex = (lastProcessedIndex + 1); // Berechne Startindex (kein Modulo hier nötig, da wir nur einen Teil bearbeiten)
    // Stelle sicher, dass der Startindex nicht außerhalb der Liste liegt
    if (startIndex >= playerList.length) {
        console.log("[CRON] Last run finished the list. Starting from index 0 again.");
        lastProcessedIndex = -1; // Setze zurück, damit der nächste Lauf von vorne beginnt
         // Speichere den zurückgesetzten Zustand sofort, falls dieser Lauf nichts tut
         if (redis && !stateReadError) {
             try {
                 await redis.set(CRON_STATE_KEY, JSON.stringify({ lastProcessedIndex: -1 }));
             } catch (e) { console.error(`[CRON] Failed to save reset state to Redis:`, e.message); }
         }
        const endTime = Date.now();
        const duration = endTime - startTime;
        console.log(`[CRON][${new Date().toISOString()}] Job finished immediately in ${duration}ms as list was completed previously.`);
        return res.status(200).json({ message: "Cron job cycle completed in previous run. Starting new cycle next time.", success: 0, failed: 0, skipped: 0, processedThisRun: 0, durationMs: duration });
    }

    console.log(`[CRON] Starting processing from index ${startIndex}. Max players this run: ${PLAYERS_PER_RUN}.`);

    // Schleife über einen Teil der Spielerliste
    for (let i = startIndex; i < playerList.length; i++) {
        // Aktuellen Index merken
        lastIndexProcessedInThisRun = i;
        const nickname = playerList[i];

        // Abbruchbedingung: Genug Spieler für diesen Lauf verarbeitet?
        if (processedInThisRun >= PLAYERS_PER_RUN) {
            console.log(`[CRON] Reached processing limit (${PLAYERS_PER_RUN}). Stopping loop.`);
            // Wichtig: Den Index des *vorherigen* Spielers als letzten merken
            lastIndexProcessedInThisRun = i - 1;
            break;
        }

        console.log(`[CRON] [${processedInThisRun + 1}/${PLAYERS_PER_RUN}] Processing player at index ${i}: ${nickname}`);

        // Variablen für diesen Spieler zurücksetzen
        let playerNeedsUpdate = true;
        let currentLastKnownTimestamp = null; // Renamed to avoid conflict
        let latestMatchTimestamp = null;
        let playerId = null;
        let existingData = null;

        try {
            // a) Spieler-Details holen
            const details = await fetchFaceitApi(`/players?nickname=${encodeURIComponent(nickname)}`);
            playerId = details?.player_id;
            if (!playerId) {
                console.warn(`[CRON] Could not find player_id for ${nickname}. Skipping.`);
                failed++;
                processedInThisRun++; // Zählen als verarbeitet für Batch-Fortschritt
                continue; // Nächster Spieler in der Schleife
            }

            // b) Letzten Stand aus Redis lesen
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
                skipped++; // Zählen als übersprungen, da nichts zu tun
            }

            // e) Volles Update, wenn nötig
            if (playerNeedsUpdate) {
                console.log(`[CRON] Fetching full history (${MATCH_COUNT} matches) and details for ${nickname}...`);
                const history = await fetchFaceitApi(`/players/${playerId}/history?game=cs2&limit=${MATCH_COUNT}`);
                if (!history || !Array.isArray(history.items) || history.items.length === 0) {
                    console.warn(`[CRON] No full history found for ${nickname} (ID: ${playerId}) during update attempt, although latest match may have been found. Skipping.`);
                    failed++;
                    processedInThisRun++; // Zählen für Batch-Fortschritt
                    continue;
                }

                // Match-Details in Batches holen
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
                            if (isNaN(matchRounds) || matchRounds <= 0) {
                                console.warn(`[CRON] Invalid rounds (${roundStats?.["Rounds"]}) for match ${h.match_id}, skipping detail fetch.`);
                                return null;
                            }
                            let playerTeamData = null, playerStatsData = null;
                            for (const team of statsData.rounds[0].teams) {
                                const player = team.players?.find((p) => p.player_id === playerId);
                                if (player) {
                                    playerTeamData = team;
                                    playerStatsData = player.player_stats;
                                    break;
                                }
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
                } // Ende Batch-Schleife für Match-Details

                if (matchesForCalc.length === 0) {
                    console.warn(`[CRON] No valid match details could be fetched for ${nickname} (ID: ${playerId}) during update attempt. Skipping calculation.`);
                    failed++;
                    processedInThisRun++; // Zählen für Batch-Fortschritt
                    continue;
                }

                // f) Stats berechnen (Letzte 10 aus den geholten Details)
                const { stats, matchesCount } = calculateCurrentFormStats(matchesForCalc);
                if (!stats) {
                    console.warn(`[CRON] Stats calculation returned null for ${nickname} (ID: ${playerId}). Skipping save.`);
                    failed++;
                    processedInThisRun++; // Zählen für Batch-Fortschritt
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
                        await redis.set(cacheKey, JSON.stringify(dataToStore), "EX", 7 * 24 * 60 * 60); // 7 Tage Ablaufzeit
                        console.log(`[CRON] Successfully updated stats for ${nickname} (ID: ${playerId}) in Redis.`);
                        success++;
                    } catch (redisError) {
                        console.error(`[CRON] Failed Redis SET for ${nickname} (ID: ${playerId}): ${redisError.message}.`);
                        failed++;
                    }
                } else {
                    success++; // Zählen als Erfolg, da Berechnung ok, nur Caching nicht
                }
            } // Ende if(playerNeedsUpdate)

             // Zählen, dass dieser Spieler-Slot im Batch abgearbeitet wurde (egal ob success, fail oder skip)
            processedInThisRun++;

        } catch (e) {
            // Allgemeiner Fehler bei der Verarbeitung dieses Spielers
            console.error(`[CRON] Processing failed unexpectedly for ${nickname} (PlayerID: ${playerId ?? 'unknown'}) at index ${i}:`, e);
            failed++;
            processedInThisRun++; // Auch fehlgeschlagene als "verarbeitet" zählen für den Batch-Fortschritt
        }
    } // Ende der Spieler-Schleife (for i...)

    // --- Neuen Status in Redis speichern ---
    // Speichere den Index des LETZTEN Spielers, der in dieser Runde GESTARTET wurde.
    // Wenn die Schleife vorzeitig wegen PLAYERS_PER_RUN abbrach, ist dies `lastIndexProcessedInThisRun`.
    // Wenn die Schleife normal durchlief bis zum Ende der Liste, setzen wir auf -1 für den Neustart.
    let finalIndexToStore = lastIndexProcessedInThisRun;
    if (lastIndexProcessedInThisRun === playerList.length - 1) {
        finalIndexToStore = -1; // Liste komplett durchlaufen
        console.log("[CRON] Finished processing the entire player list in this run or previous runs.");
    }

    if (redis && !stateReadError) { // Nur speichern, wenn Redis verfügbar ist und Lesen des alten Zustands ok war
         const newState = JSON.stringify({ lastProcessedIndex: finalIndexToStore });
        try {
            await redis.set(CRON_STATE_KEY, newState);
            console.log(`[CRON] Successfully saved state: lastProcessedIndex = ${finalIndexToStore}`);
        } catch (e) {
            console.error(`[CRON] Failed to save state to Redis key '${CRON_STATE_KEY}':`, e.message);
        }
    } else if (!redis) {
         console.warn("[CRON] Could not save state because Redis is unavailable.");
    } else if (stateReadError) {
         console.warn("[CRON] Could not save state because reading the initial state failed.");
    }


    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`[CRON][${new Date().toISOString()}] Job finished in ${duration}ms. Success: ${success}, Failed: ${failed}, Skipped: ${skipped}, Processed this run: ${processedInThisRun}`);

    res.status(200).json({
        message: `Cron job finished. Processed batch ending at index ${lastIndexProcessedInThisRun}. Updated: ${success}, Failed: ${failed}, Skipped: ${skipped}`,
        success,
        failed,
        skipped,
        processedThisRun: processedInThisRun,
        lastIndexProcessed: lastIndexProcessedInThisRun,
        durationMs: duration
    });
}