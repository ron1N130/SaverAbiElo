// api/update-stats.js
// -------------------------------------------------
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


// --- Cron Job Handler ---
export default async function handler(req, res) {
    console.log(`[CRON][${new Date().toISOString()}] Starting optimized stats update job...`);

    // Spielerliste laden
    const jsonPath = path.resolve(process.cwd(), "players.json");
    let playerList = [];
    try {
      playerList = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (!Array.isArray(playerList)) throw new Error("players.json is not a valid JSON array.");
      console.log(`[CRON] Loaded ${playerList.length} players.`);
    } catch (e) {
       console.error("[CRON] Failed to read/parse players.json:", e.message);
       // Wichtig: Hier abbrechen, da ohne Spielerliste nichts getan werden kann
       return res.status(500).json({ success: 0, failed: 0, skipped: 0, error: "Could not read/parse player list." });
    }

    if (!redis) {
        console.warn("[CRON] Redis not available. Stats will not be cached or checked for updates. Full update for all players will be attempted.");
    }

    let success = 0;
    let failed = 0;
    let skipped = 0; // Zähler für übersprungene (aktuell) Spieler

    // Schleife über alle Spieler
    for (const nickname of playerList) {
        console.log(`[CRON] Processing player: ${nickname}`);
        let playerNeedsUpdate = true; // Standard: Update nötig
        let lastKnownMatchTimestamp = null; // Timestamp aus Redis
        let latestMatchTimestamp = null;    // Timestamp des neuesten Matches von Faceit API
        let playerId = null;                // Spieler-ID
        let existingData = null;            // Daten aus Redis

        try {
            // Schritt a) Spieler-ID holen
            const details = await fetchFaceitApi(`/players?nickname=${encodeURIComponent(nickname)}`);
            playerId = details?.player_id;
            if (!playerId) {
                console.warn(`[CRON] Could not find player_id for ${nickname}. Skipping.`);
                failed++;
                continue; // Nächster Spieler
            }

            // Schritt b) Letzten bekannten Stand aus Redis holen
            if (redis) {
                const cacheKey = `player_stats:${playerId}`;
                try {
                    const raw = await redis.get(cacheKey);
                    if (raw) {
                        existingData = JSON.parse(raw);
                        // Prüfe Version und ob Timestamp vorhanden ist
                        if (existingData?.version === CACHE_VERSION && typeof existingData?.lastMatchTimestamp === 'number') {
                            lastKnownMatchTimestamp = existingData.lastMatchTimestamp;
                        } else {
                            console.log(`[CRON] Cache data for ${nickname} (ID: ${playerId}) is old version or missing timestamp. Forcing update.`);
                            lastKnownMatchTimestamp = null; // Update erzwingen
                        }
                    }
                } catch (redisError) {
                    console.error(`[CRON] Failed Redis GET for ${nickname} (ID: ${playerId}): ${redisError.message}. Assuming update needed.`);
                    // Bei Lesefehler Caching für diesen Request überspringen, aber Update trotzdem versuchen
                    lastKnownMatchTimestamp = null;
                    // redis = null; // Optional: Redis komplett deaktivieren bei Fehler? Eher nicht.
                }
            } else {
                lastKnownMatchTimestamp = null; // Kein Redis -> Update immer nötig
            }

            // Schritt c) Nur das *letzte* Match aus der History holen
            const latestHistory = await fetchFaceitApi(`/players/${playerId}/history?game=cs2&limit=1`);

            // Schritt d) Zeitstempel vergleichen
            if (latestHistory?.items?.[0]?.started_at) {
                latestMatchTimestamp = latestHistory.items[0].started_at; // Unix Timestamp in Sekunden

                // Wenn Redis verfügbar ist UND wir einen alten Zeitstempel haben UND der neueste Zeitstempel nicht neuer ist
                if (redis && lastKnownMatchTimestamp !== null && latestMatchTimestamp <= lastKnownMatchTimestamp) {
                    console.log(`[CRON] Player ${nickname} (ID: ${playerId}) is up-to-date (Last match timestamp: ${latestMatchTimestamp}). Skipping full update.`);
                    playerNeedsUpdate = false;
                    skipped++;
                } else {
                     // Update ist nötig (entweder neueres Match, kein alter Timestamp, oder kein Redis)
                     console.log(`[CRON] Player ${nickname} (ID: ${playerId}) needs update. Newest match ts: ${latestMatchTimestamp}. Last known ts: ${lastKnownMatchTimestamp ?? 'None'}.`);
                }
            } else {
                // Keine History für den Spieler gefunden
                console.log(`[CRON] No history found for ${nickname} (ID: ${playerId}). Skipping update.`);
                playerNeedsUpdate = false;
                // Skipped nur zählen, wenn es auch keine alten Daten gab (also wirklich nichts zu tun)
                if (!existingData) {
                    skipped++;
                } else {
                    // Hatte alte Daten, aber jetzt keine History? Sollte nicht passieren, aber wir zählen es nicht als Fehler.
                    skipped++;
                }
            }

            // Schritt e) Nur wenn Update nötig ist: Volle Verarbeitung
            if (playerNeedsUpdate) {
                console.log(`[CRON] Fetching full history (${MATCH_COUNT} matches) and details for ${nickname}...`);
                // Volle Historie holen
                const history = await fetchFaceitApi(`/players/${playerId}/history?game=cs2&limit=${MATCH_COUNT}`);
                // Prüfen, ob History Daten enthält (könnte theoretisch leer sein, obwohl limit=1 eins fand)
                if (!history || !Array.isArray(history.items) || history.items.length === 0) {
                     console.warn(`[CRON] No full history found for ${nickname} (ID: ${playerId}) during update attempt, although latest match was found. Skipping.`);
                     failed++; // Zählt als Fehler, da Update nicht durchgeführt werden konnte
                     continue;
                 }

                // Match-Details in Batches holen
                const matchesForCalc = [];
                for (let i = 0; i < history.items.length; i += BATCH_SIZE) {
                    const batchItems = history.items.slice(i, i + BATCH_SIZE);
                    const batchPromises = batchItems.map(async (h) => {
                         try {
                            const statsData = await fetchFaceitApi(`/matches/${h.match_id}/stats`);
                            if (!statsData?.rounds?.[0]?.teams) return null; // Keine Rundendaten

                            const roundStats = statsData.rounds[0].round_stats;
                            const winningTeamId = roundStats?.["Winner"];
                            const matchRounds = parseInt(roundStats?.["Rounds"], 10);

                            // Rundenanzahl prüfen
                            if (isNaN(matchRounds) || matchRounds <= 0) {
                                console.warn(`[CRON] Invalid rounds (${roundStats?.["Rounds"]}) for match ${h.match_id}, skipping detail fetch.`);
                                return null;
                            }

                            // Eigenen Spieler im Match finden
                            let playerTeamData = null;
                            let playerStatsData = null;
                            for (const team of statsData.rounds[0].teams) {
                                const player = team.players?.find((p) => p.player_id === playerId);
                                if (player) {
                                    playerTeamData = team;
                                    playerStatsData = player.player_stats;
                                    break;
                                }
                            }

                            // Prüfen ob Spieler & Stats gefunden wurden
                            if (!playerTeamData || !playerStatsData) return null;

                            // Statistiken extrahieren und zurückgeben
                            return {
                                Kills: +(playerStatsData["Kills"] ?? 0),
                                Deaths: +(playerStatsData["Deaths"] ?? 0),
                                Assists: +(playerStatsData["Assists"] ?? 0),
                                Headshots: +(playerStatsData["Headshots"] ?? 0),
                                "K/R Ratio": +(playerStatsData["K/R Ratio"] ?? 0), // Nicht direkt verwendet von calculateAverageStats
                                ADR: +(playerStatsData["ADR"] ?? playerStatsData["Average Damage per Round"] ?? 0),
                                Rounds: matchRounds,
                                Win: winningTeamId ? (playerTeamData.team_id === winningTeamId ? 1 : 0) : 0, // 0 wenn kein Gewinner
                                CreatedAt: h.started_at, // Unix Timestamp für Sortierung in calculateCurrentFormStats
                            };
                        } catch (matchErr) {
                             console.warn(`[CRON] Failed fetch/process match detail ${h.match_id} for ${nickname}: ${matchErr.message}`);
                             return null; // Bei Fehler dieses Match überspringen
                        }
                    });
                    // Auf Batch warten und gültige Ergebnisse sammeln
                    const batchResults = (await Promise.all(batchPromises)).filter(Boolean);
                    matchesForCalc.push(...batchResults);
                } // Ende Batch-Schleife

                // Prüfen, ob überhaupt gültige Match-Details geholt werden konnten
                if (matchesForCalc.length === 0) {
                    console.warn(`[CRON] No valid match details could be fetched for ${nickname} (ID: ${playerId}) during update attempt. Skipping calculation.`);
                    failed++;
                    continue;
                }

                // Schritt f) Stats berechnen (Letzte 10 aus den geholten Details)
                const { stats, matchesCount } = calculateCurrentFormStats(matchesForCalc);
                if (!stats) {
                    console.warn(`[CRON] Stats calculation returned null for ${nickname} (ID: ${playerId}). Skipping save.`);
                    failed++;
                    continue;
                }

                // Schritt g) Daten für Redis vorbereiten
                // Nimm den Timestamp des absolut neuesten Matches aus der vollen History (items[0])
                // Fallback auf den Timestamp aus der limit=1 Abfrage, falls history leer war (sollte nicht passieren wegen Check oben)
                const newestMatchTimestampInHistory = history.items[0]?.started_at ?? latestMatchTimestamp;

                const dataToStore = {
                    version: CACHE_VERSION,
                    calculatedRating: stats.rating,
                    kd: stats.kd,
                    adr: stats.adr,
                    winRate: stats.winRate,
                    hsPercent: stats.hsp,
                    kast: stats.kast,
                    impact: stats.impact,
                    matchesConsidered: matchesCount, // Anzahl Matches für Form-Berechnung (max 10)
                    lastUpdated: new Date().toISOString(),
                    // Zusätzliche Stats
                    kpr: stats.kpr,
                    dpr: stats.dpr,
                    apr: stats.apr ?? 0,
                    // Wichtig: Zeitstempel des neuesten Matches speichern
                    lastMatchTimestamp: newestMatchTimestampInHistory
                };

                // Schritt h) In Redis speichern
                if (redis) {
                    const cacheKey = `player_stats:${playerId}`;
                    try {
                        await redis.set(cacheKey, JSON.stringify(dataToStore), "EX", 7 * 24 * 60 * 60); // 7 Tage Ablaufzeit
                        console.log(`[CRON] Successfully updated stats for ${nickname} (ID: ${playerId}) in Redis.`);
                        success++;
                    } catch (redisError) {
                        console.error(`[CRON] Failed Redis SET for ${nickname} (ID: ${playerId}): ${redisError.message}.`);
                        failed++;
                        // redis = null; // Optional: Redis für Rest deaktivieren bei Schreibfehler? Eher nicht.
                    }
                } else {
                    // Zählen als Erfolg, da Berechnung/Fetch geklappt hat, nur Caching nicht
                    success++;
                }
            } // Ende if(playerNeedsUpdate)

        } catch (e) {
            // Allgemeiner Fehler bei der Verarbeitung dieses Spielers
            console.error(`[CRON] Processing failed unexpectedly for ${nickname} (PlayerID: ${playerId ?? 'unknown'}):`, e);
            failed++;
        }
    } // Ende der Spieler-Schleife (for...of playerList)

    console.log(`[CRON][${new Date().toISOString()}] Job finished. Success: ${success}, Failed: ${failed}, Skipped (Up-to-date): ${skipped}`);
    // Sende Antwort zurück an Vercel Cron
    res.status(200).json({
        message: `Cron job finished. Updated: ${success}, Failed: ${failed}, Skipped: ${skipped}`,
        success,
        failed,
        skipped
    });
}