// api/update-stats.js – Refactored
// -------------------------------------------------
// ◼ Nutzt zentrale Statistik-Berechnung aus /api/utils/stats.js
// ◼ Cache Version 6
// -------------------------------------------------

import Redis from "ioredis";
import fs from "fs";
import path from "path";
// *** NEU: Importiere Berechnungsfunktionen ***
// Annahme: utils liegt im selben api-Verzeichnis oder Pfad entsprechend anpassen
import { calculateAverageStats } from './utils/stats.js';

// --- Cache Version (muss mit anderen Dateien übereinstimmen!) ---
const CACHE_VERSION = 7; // Erhöht wegen Refactoring

// --- Helpers -------------------------------------------------------------
/** simple async sleep */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Konfiguration ------------------------------------------------------
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const MATCH_COUNT = 20; // Holt Historie für Berechnung
const API_DELAY = 600;
const BATCH_SIZE = 5;

// --- Redis‑Initialisierung ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true,          // Beibehalten!
            connectTimeout: 10000,      // 10s
            maxRetriesPerRequest: 2,    // 3 ist ok, 2 reicht vielleicht auch
            showFriendlyErrorStack: true // Hilfreich für Debugging
        });
        redis.on("error", (err) => {
            console.error("[Redis Update] Connection error:", err.message);
            // Wichtig: Bei Fehler hier null setzen, damit nicht versucht wird, redis zu nutzen
            redis = null;
        });
        // redis.connect().catch(err => { console.error("[Redis Update] Initial connection failed:", err.message); redis = null; }); // <-- DIESE ZEILE ENTFERNEN ODER AUSKOMMENTIEREN
        console.log("[Redis Update] Client initialized (lazy)."); // Angepasste Log-Nachricht
    } catch (e) {
        console.error("[Redis Update] Initialization failed:", e);
        redis = null;
    }
} else {
    console.warn("[Redis Update] REDIS_URL not set. Caching disabled.");
}

// --- Hilfs‑Fetch (unverändert) ---
async function fetchFaceitApi(endpoint, retries = 3) {
    await delay(API_DELAY);
    const url = `${API_BASE_URL}${endpoint}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}`, 'Accept': 'application/json' } });
        if (res.status === 429) {
            console.warn(`[API Update] Rate limit hit (429) for ${endpoint} – sleeping...`);
            await delay(API_DELAY * 15);
            if (retries > 0) return fetchFaceitApi(endpoint, retries - 1);
            else throw new Error(`API Rate limit exceeded for ${endpoint}`);
        }
        if (res.status === 401) throw new Error(`API Authentication failed (401)`);
        if (res.status === 404) { console.warn(`[API Update] Not found (404) for ${endpoint}.`); return null; }
        if (!res.ok) { const errBody = await res.text(); throw new Error(`API request failed ${endpoint} (${res.status}): ${errBody}`); }
        return await res.json();
    } catch (error) {
        console.error(`[API Update] Fetch error for ${endpoint}: ${error.message}`);
        if (retries > 0) { await delay(API_DELAY * 5); return fetchFaceitApi(endpoint, retries - 1); }
        else throw error;
    }
}

// --- Funktion zur Berechnung der Form basierend auf den letzten 10 Matches ---
// Diese Funktion bleibt hier, da sie spezifisch für diesen Endpunkt ist.
// Sie ruft die importierte calculateAverageStats auf.
function calculateCurrentFormStats(matches) {
    const sorted = [...matches].sort((a, b) => (Number(b.CreatedAt) || 0) - (Number(a.CreatedAt) || 0));
    const recent = sorted.slice(0, 10); // Nimm die letzten 10
    const statsResult = calculateAverageStats(recent); // *** Ruft importierte Funktion auf ***
    return {
        stats: statsResult, // Enthält jetzt alle berechneten Stats oder null
        matchesCount: recent.length,
    };
}


// --- Cron Job Handler ---
export default async function handler(req, res) {
    console.log(`[CRON][${new Date().toISOString()}] Starting optimized stats update job...`); // Nachricht angepasst

    const jsonPath = path.resolve(process.cwd(), "players.json");
    let playerList = [];
    try {
      playerList = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (!Array.isArray(playerList)) throw new Error("players.json is not a valid JSON array.");
      console.log(`[CRON] Loaded ${playerList.length} players.`);
    } catch (e) {
       console.error("[CRON] Failed to read/parse players.json:", e);
       return res.status(500).json({ success: 0, failed: 0, error: "Could not read/parse player list." });
    }

    if (!redis) { console.warn("[CRON] Redis not available. Stats will not be cached or checked for updates."); } // Angepasste Nachricht

    let success = 0;
    let failed = 0;
    let skipped = 0; // Zähler für übersprungene Spieler

    for (const nickname of playerList) {
        console.log(`[CRON] Processing player: ${nickname}`);
        let playerNeedsUpdate = true; // Standardmäßig annehmen, dass Update nötig ist
        let lastKnownMatchTimestamp = null;
        let latestMatchTimestamp = null;
        let playerId = null; // Spieler-ID hier definieren

        try {
            // a) Spieler-Details holen (immer nötig für player_id)
            const details = await fetchFaceitApi(`/players?nickname=${encodeURIComponent(nickname)}`);
            playerId = details?.player_id; // playerId hier setzen
            if (!playerId) {
                console.warn(`[CRON] Could not find player_id for ${nickname}. Skipping.`);
                failed++; // Zählen als Fehler
                continue; // Zum nächsten Spieler
            }

            // b) Letzten bekannten Stand aus Redis lesen (falls Redis verfügbar)
            let existingData = null;
            if (redis) {
                const cacheKey = `player_stats:${playerId}`;
                try {
                    const raw = await redis.get(cacheKey);
                    if (raw) {
                        existingData = JSON.parse(raw);
                        // Nur Timestamp holen, wenn Version übereinstimmt, sonst Update erzwingen
                        if (existingData?.version === CACHE_VERSION && existingData?.lastMatchTimestamp) {
                            lastKnownMatchTimestamp = existingData.lastMatchTimestamp;
                        } else {
                            console.log(`[CRON] Cache data for ${nickname} is old version or missing timestamp. Forcing update.`);
                            lastKnownMatchTimestamp = null; // Update erzwingen
                        }
                    }
                } catch (redisError) {
                    console.error(`[CRON] Failed Redis GET for ${nickname}: ${redisError.message}. Assuming update needed.`);
                    redis = null; // Bei Lesefehler Redis für diesen Job deaktivieren? Oder nur annehmen, dass Update nötig ist.
                    lastKnownMatchTimestamp = null;
                }
            } else {
                // Kein Redis -> Immer Update versuchen
                lastKnownMatchTimestamp = null;
            }

            // c) Nur das *letzte* Match aus der History holen, um Zeitstempel zu prüfen
            const latestHistory = await fetchFaceitApi(`/players/${playerId}/history?game=cs2&limit=1`);

            if (latestHistory?.items?.[0]?.started_at) {
                latestMatchTimestamp = latestHistory.items[0].started_at; // Unix Timestamp (Sekunden)

                // d) Zeitstempel vergleichen (nur wenn wir einen alten Timestamp UND Redis haben)
                if (redis && lastKnownMatchTimestamp && latestMatchTimestamp <= lastKnownMatchTimestamp) {
                    console.log(`[CRON] Player ${nickname} is up-to-date (Last match: ${new Date(latestMatchTimestamp * 1000).toISOString()}). Skipping full update.`);
                    playerNeedsUpdate = false;
                    skipped++;
                } else {
                     console.log(`[CRON] Player ${nickname} needs update. Newest match: ${new Date(latestMatchTimestamp * 1000).toISOString()}. Last known: ${lastKnownMatchTimestamp ? new Date(lastKnownMatchTimestamp * 1000).toISOString() : 'None'}.`);
                }
            } else {
                // Keine History gefunden -> braucht kein Update, es sei denn, es gab vorher auch keine Daten
                 if (!existingData) {
                    console.log(`[CRON] No history found for ${nickname} and no existing data. Skipping update.`);
                    playerNeedsUpdate = false;
                    skipped++; // Zählt als übersprungen, da keine Daten vorhanden/berechenbar
                 } else {
                     // Hatte Daten, aber jetzt keine History mehr? Seltsam, aber wir überspringen das Update.
                     console.log(`[CRON] No history found for ${nickname}, but had existing data. Skipping update.`);
                     playerNeedsUpdate = false;
                     skipped++;
                 }
            }

            // e) Nur wenn Update nötig ist: Volle History holen und verarbeiten
            if (playerNeedsUpdate) {
                console.log(`[CRON] Fetching full history and details for ${nickname}...`);
                const history = await fetchFaceitApi(`/players/${playerId}/history?game=cs2&limit=${MATCH_COUNT}`);
                if (!history || !Array.isArray(history.items) || history.items.length === 0) {
                     console.warn(`[CRON] No full history found for ${nickname} during update attempt. Skipping.`);
                     // Zählt als Fehler, da Update versucht wurde, aber fehlschlug
                     failed++;
                     continue;
                 }

                // *** Bestehende Logik zum Holen der Match-Details ***
                const matchesForCalc = [];
                 for (let i = 0; i < history.items.length; i += BATCH_SIZE) { /* ... alter Code ... */ }
                 // --> Hier dein bestehender Code zum Holen der Match-Details einfügen <--
                 // Beispiel (gekürzt):
                  const batchItems = history.items.slice(i, i + BATCH_SIZE);
                  const batchPromises = batchItems.map(async (h) => {
                      try {
                          const statsData = await fetchFaceitApi(`/matches/${h.match_id}/stats`);
                          if (!statsData?.rounds?.[0]?.teams) return null;
                          const roundStats = statsData.rounds[0].round_stats;
                          const winningTeamId = roundStats?.["Winner"];
                          const matchRounds = parseInt(roundStats?.["Rounds"], 10) || 1;
                          let playerTeamData = null, playerStatsData = null;
                          for (const team of statsData.rounds[0].teams) { /* ... Spieler finden ...*/ }
                          if (!playerTeamData || !playerStatsData) return null;
                          // Wichtig: Hier verwenden wir history.items[i].started_at nicht direkt,
                          // da wir später den Timestamp des *neuesten* Matches aus der History brauchen.
                          // Aber wir könnten das Match-Objekt komplett übergeben, wenn calculateAverageStats das braucht.
                          // Für calculateCurrentFormStats reicht das aktuelle Format.
                           return {
                               Kills: +(playerStatsData["Kills"] ?? 0), Deaths: +(playerStatsData["Deaths"] ?? 0),
                               Assists: +(playerStatsData["Assists"] ?? 0), Headshots: +(playerStatsData["Headshots"] ?? 0),
                               "K/R Ratio": +(playerStatsData["K/R Ratio"] ?? 0),
                               ADR: +(playerStatsData["ADR"] ?? playerStatsData["Average Damage per Round"] ?? 0),
                               Rounds: matchRounds, Win: playerTeamData.team_id === winningTeamId ? 1 : 0,
                               CreatedAt: h.started_at // Wichtig für calculateCurrentFormStats
                           };
                      } catch (matchErr) { console.warn(`[CRON] Failed fetch match ${h.match_id} for ${nickname}: ${matchErr.message}`); return null; }
                  });
                 matchesForCalc.push(...(await Promise.all(batchPromises)).filter(Boolean));
                 // <-- Ende des eingefügten Codes -->


                if (matchesForCalc.length === 0) {
                    console.warn(`[CRON] No valid match details found for ${nickname} during update attempt. Skipping.`);
                    failed++;
                    continue;
                }

                // f) Stats berechnen (letzte 10)
                const { stats, matchesCount } = calculateCurrentFormStats(matchesForCalc);
                if (!stats) {
                    console.warn(`[CRON] Stats calculation returned null for ${nickname}. Skipping.`);
                    failed++;
                    continue;
                }

                // g) Daten für Redis vorbereiten (inkl. neuem Timestamp)
                // Finde den Zeitstempel des neuesten Matches in der vollen History
                const newestMatchTimestampInHistory = history.items[0]?.started_at ?? latestMatchTimestamp; // Fallback auf Timestamp von limit=1 Abfrage

                const dataToStore = {
                    version: CACHE_VERSION,
                    calculatedRating: stats.rating,
                    kd: stats.kd,
                    adr: stats.adr,
                    winRate: stats.winRate,
                    hsPercent: stats.hsp,
                    kast: stats.kast,
                    impact: stats.impact,
                    matchesConsidered: matchesCount,
                    lastUpdated: new Date().toISOString(),
                    kpr: stats.kpr,
                    dpr: stats.dpr,
                    apr: stats.apr ?? 0,
                    lastMatchTimestamp: newestMatchTimestampInHistory // <<< NEUES FELD
                };

                // h) In Redis speichern (falls verfügbar)
                if (redis) {
                    const cacheKey = `player_stats:${playerId}`;
                    try {
                        await redis.set(cacheKey, JSON.stringify(dataToStore), "EX", 7 * 24 * 60 * 60); // 7 Tage Ablauf
                        console.log(`[CRON] Successfully updated stats for ${nickname} in Redis.`);
                        success++;
                    } catch (redisError) {
                        console.error(`[CRON] Failed Redis SET for ${nickname}: ${redisError.message}.`);
                        failed++;
                        redis = null; // Bei Schreibfehler Redis für den Rest des Laufs deaktivieren?
                    }
                } else {
                    success++; // Zählen als Erfolg, da Berechnung geklappt hat, nur Caching nicht
                }
            } // Ende if(playerNeedsUpdate)

        } catch (e) {
            console.error(`[CRON] Processing failed for ${nickname}:`, e.message);
            failed++;
        }
    } // Ende Spieler-Loop

    console.log(`[CRON][${new Date().toISOString()}] Job finished. Success: ${success}, Failed: ${failed}, Skipped (Up-to-date): ${skipped}`);
    res.status(200).json({ message: `Cron job finished. Updated: ${success}, Failed: ${failed}, Skipped: ${skipped}`, success, failed, skipped });
}