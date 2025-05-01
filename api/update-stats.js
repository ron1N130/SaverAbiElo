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
const CACHE_VERSION = 6; // Erhöht wegen Refactoring

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

// --- Redis‑Initialisierung (unverändert) ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true, connectTimeout: 20000, maxRetriesPerRequest: 3,
        });
        redis.on("error", (err) => { console.error("[Redis Update] Connection error:", err.message); });
        redis.connect().catch(err => { console.error("[Redis Update] Initial connection failed:", err.message); redis = null; });
        console.log("[Redis Update] Client initialized.");
    } catch (e) { console.error("[Redis Update] Initialization failed:", e); redis = null; }
} else { console.warn("[Redis Update] REDIS_URL not set. Caching disabled."); }

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
    console.log(`[CRON][${new Date().toISOString()}] Starting stats update job...`);

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

    if (!redis) { console.warn("[CRON] Redis not available. Stats will not be cached."); }

    let success = 0;
    let failed = 0;

    for (const nickname of playerList) {
        console.log(`[CRON] Processing player: ${nickname}`);
        try {
            // a) Spieler‑Details holen
            const details = await fetchFaceitApi(`/players?nickname=${encodeURIComponent(nickname)}`);
            const playerId = details?.player_id;
            if (!playerId) throw new Error(`Could not find player_id for ${nickname}.`);
            // console.log(`[CRON] Found player_id: ${playerId} for ${nickname}`);

            // b) Match‑History holen
            const history = await fetchFaceitApi(`/players/${playerId}/history?game=cs2&limit=${MATCH_COUNT}`);
            if (!history || !Array.isArray(history.items) || history.items.length === 0) {
                console.log(`[CRON] No history for ${nickname}. Skipping.`);
                continue;
            }
            // console.log(`[CRON] Found ${history.items.length} matches for ${nickname}. Fetching details...`);

            // c) Detail-Stats holen (Batches)
            const matchesForCalc = [];
            for (let i = 0; i < history.items.length; i += BATCH_SIZE) {
                const batchItems = history.items.slice(i, i + BATCH_SIZE);
                const batchPromises = batchItems.map(async (h) => {
                     try {
                        const statsData = await fetchFaceitApi(`/matches/${h.match_id}/stats`); // Renamed variable
                        if (!statsData?.rounds?.[0]?.teams) return null;
                        const roundStats = statsData.rounds[0].round_stats;
                        const winningTeamId = roundStats?.["Winner"];
                        const matchRounds = parseInt(roundStats?.["Rounds"], 10) || 1;
                        let playerTeamData = null, playerStatsData = null;
                        for (const team of statsData.rounds[0].teams) {
                            const player = team.players?.find((p) => p.player_id === playerId);
                            if (player) { playerTeamData = team; playerStatsData = player.player_stats; break; }
                        }
                        if (!playerTeamData || !playerStatsData) return null;
                        return {
                            Kills: playerStatsData["Kills"], Deaths: playerStatsData["Deaths"],
                            Assists: playerStatsData["Assists"], Headshots: playerStatsData["Headshots"],
                            "K/R Ratio": playerStatsData["K/R Ratio"],
                            ADR: playerStatsData["ADR"] ?? playerStatsData["Average Damage per Round"],
                            Rounds: matchRounds, Win: playerTeamData.team_id === winningTeamId ? 1 : 0,
                            CreatedAt: h.started_at,
                        };
                    } catch (matchErr) { console.warn(`[CRON] Failed fetch match ${h.match_id} for ${nickname}: ${matchErr.message}`); return null; }
                });
                matchesForCalc.push(...(await Promise.all(batchPromises)).filter(Boolean));
            }

            if (matchesForCalc.length === 0) { console.log(`[CRON] No valid match details for ${nickname}. Skipping.`); continue; }

            // e) Stats berechnen (letzte 10)
            // console.log(`[CRON] Calculating stats for ${nickname} (using last 10 of ${matchesForCalc.length} valid matches).`);
            const { stats, matchesCount } = calculateCurrentFormStats(matchesForCalc); // Ruft lokale Funktion auf, die importierte aufruft

            // Prüfen ob Stats berechnet werden konnten
            if (!stats) {
                 console.warn(`[CRON] Stats calculation returned null for ${nickname}. Skipping.`);
                 failed++; // Zählen als Fehler, da Berechnung fehlschlug
                 continue;
            }

            // f) Daten für Redis vorbereiten (Felder müssen mit faceit-data.js übereinstimmen)
            const dataToStore = {
                version:          CACHE_VERSION,
                calculatedRating: stats.rating, // Name aus calculateAverageStats
                kd:               stats.kd,
                adr:              stats.adr,
                winRate:          stats.winRate,
                hsPercent:        stats.hsp,     // Name aus calculateAverageStats
                kast:             stats.kast,
                impact:           stats.impact,
                matchesConsidered: matchesCount,
                lastUpdated:      new Date().toISOString(),
                // Optional: Weitere Stats speichern
                 kpr:              stats.kpr,
                 dpr:              stats.dpr,
                 apr:              stats.apr ?? 0, // APR hinzufügen (aus calculateAverageStats)
            };

            // g) In Redis speichern
            if (redis) {
                const cacheKey = `player_stats:${playerId}`;
                try {
                    await redis.set(cacheKey, JSON.stringify(dataToStore), "EX", 7 * 24 * 60 * 60);
                    // console.log(`[CRON] Successfully updated stats for ${nickname} (Player ID: ${playerId}) in Redis.`);
                    success++;
                } catch (redisError) { console.error(`[CRON] Failed Redis SET for ${nickname}: ${redisError.message}`); failed++; }
            } else { success++; /* Berechnung war erfolgreich */ }

        } catch (e) { console.error(`[CRON] Processing failed for ${nickname}:`, e.message); failed++; }
    } // Ende Spieler-Loop

    console.log(`[CRON][${new Date().toISOString()}] Job finished. Success: ${success}, Failed: ${failed}`);
    res.status(200).json({ message: `Cron job finished. Updated: ${success}, Failed: ${failed}`, success, failed });
}