// api/update-stats.js – vollständig überarbeitet
// -------------------------------------------------
// ◼ Rating-Berechnung näher am Original, NEUE Impact-Formel beibehalten
// ◼ Cache Version erhöht (v3)
// ◼ KAST Berechnung, Logging, Fehlerbehandlung, Batching beibehalten
// -------------------------------------------------

import Redis from "ioredis";
import fs from "fs";
import path from "path";

// --- Cache Version (muss mit faceit-data.js übereinstimmen!) ---
const CACHE_VERSION = 3; // Erhöht wegen Logikänderung

// --- Helpers -------------------------------------------------------------
/** simple async sleep */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// NEUE HILFSFUNKTION zur Berechnung des Impact Scores
// (Bleibt bestehen)
// ============================================================
/**
 * Berechnet einen neuen "Proxy" Impact Score basierend auf KPR, ADR und KAST.
 * Versucht, Spieler zu belohnen, die überdurchschnittlich in Kills und Schaden sind,
 * angepasst durch ihre Rundenkonstanz (KAST).
 *
 * @param {number} kpr_avg - Durchschnittliche Kills pro Runde
 * @param {number} adr_avg - Durchschnittlicher Schaden pro Runde (einfacher Durchschnitt pro Match)
 * @param {number} kast_avg - KAST Rate in Prozent (Durchschnitt pro Match)
 * @returns {number} Der berechnete Impact Score
 */
function calculateNewImpact(kpr_avg, adr_avg, kast_avg) {
    // --- Definiere Baselines (Passe diese ggf. an die Durchschnittswerte deiner Spieler an!) ---
    const baseline_kpr = 0.70;
    const baseline_adr = 75.0; // Basis für einfachen Match-ADR Durchschnitt
    const baseline_kast = 68.0;

    // --- Berechne normalisierte Komponenten ---
    const norm_kpr = baseline_kpr !== 0 ? kpr_avg / baseline_kpr : kpr_avg;
    const norm_adr = baseline_adr !== 0 ? adr_avg / baseline_adr : adr_avg;

    // --- Berechne Konsistenz-Modifikator basierend auf KAST ---
    const consistency_modifier = 1.0 + (kast_avg - baseline_kast) * 0.01;
    const clamped_modifier = Math.max(0.7, Math.min(1.3, consistency_modifier));

    // --- Kombiniere Komponenten ---
    const core_impact = (norm_kpr * 0.6) + (norm_adr * 0.4);
    const final_impact = core_impact * clamped_modifier;

    return Math.max(0, final_impact);
}
// ============================================================
// ENDE NEUE HILFSFUNKTION
// ============================================================


// --- Stat Berechnung (Rating näher am Original, Impact neu) ----
/**
 * Berechnet Durchschnittsstatistiken aus einer Liste von Matches.
 * Verwendet die ursprüngliche Rating-Formelstruktur mit dem neuen Impact-Wert.
 * ADR wird als einfacher Durchschnitt pro Match berechnet.
 */
function calculateAverageStats(matches) {
    const totalMatches = matches.length;
    if (totalMatches === 0) {
        return {
           kd: 0, dpr: 0, kpr: 0, adr: 0, hsp: 0, winRate: 0, apr: 0,
           kast: 0, impact: 0, rating: 0, weight: 0
        };
    }

    const DMG_PER_KILL = 105;
    const TRADE_PERCENT = 0.2;
    const KAST_FACTOR = 0.45;

    let totalKills = 0;
    let totalDeaths = 0;
    let totalAssists = 0;
    let totalHeadshots = 0;
    let totalWins = 0;
    let totalRounds = 0;
    let simpleTotalAdrSum = 0; // Summe der ADR-Werte pro Match (für einfachen Durchschnitt)
    let totalKastPercentSum = 0;

    matches.forEach(m => {
        const kills = Number(m.Kills) || 0;
        const deaths = Number(m.Deaths) || 0;
        const rounds = Math.max(1, Number(m.Rounds) || 1);
        const kpr_match = kills / rounds;
        const adr_match = Number(m.ADR) || (kpr_match * DMG_PER_KILL); // ADR für DIESES Match
        const hs = Number(m.Headshots) || 0;
        const assists = Number(m.Assists) || 0;
        const win = Number(m.Win) || 0;

        totalKills += kills;
        totalDeaths += deaths;
        totalAssists += assists;
        totalHeadshots += hs;
        totalWins += win;
        totalRounds += rounds;
        simpleTotalAdrSum += adr_match; // Addiere den Match-ADR zur Summe

        // KAST % für dieses Match (wie gehabt)
        const survived = rounds - deaths;
        const traded = TRADE_PERCENT * rounds;
        const kastRaw = (kills + assists + survived + traded) * KAST_FACTOR;
        const kast_match_percent = rounds > 0 ? Math.min((kastRaw / rounds) * 100, 100) : 0;
        totalKastPercentSum += kast_match_percent;
    });

    // --- Berechne durchschnittliche Statistiken ---
    // Durchschnitt pro Runde
    const kpr_avg = totalRounds > 0 ? totalKills / totalRounds : 0;
    const dpr_avg = totalRounds > 0 ? totalDeaths / totalRounds : 0;
    const apr_avg = totalRounds > 0 ? totalAssists / totalRounds : 0;

    // *** ADR als einfacher Durchschnitt pro Match (näher am Original?) ***
    const adr_avg_simple = simpleTotalAdrSum / totalMatches;

    // Gesamt oder Durchschnitt pro Match
    const kd = totalDeaths === 0 ? totalKills : totalKills / totalDeaths;
    const hsp = totalKills === 0 ? 0 : (totalHeadshots / totalKills) * 100;
    const winRate = (totalWins / totalMatches) * 100;
    const kast_avg = totalKastPercentSum / totalMatches; // KAST % (Avg pro Match)

    // *** NEUE IMPACT BERECHNUNG (verwendet einfachen ADR-Avg) ***
    const impact_new = calculateNewImpact(kpr_avg, adr_avg_simple, kast_avg);

    // *** Rating Berechnung: Original-Formelstruktur mit akt. Avg-Werten & NEUEM Impact ***
    const ratingRaw = Math.max(
        0,
        0.0073 * kast_avg +       // KAST Avg (pro Match)
        0.3591 * kpr_avg +      // KPR Avg (pro Runde)
        -0.5329 * dpr_avg +       // DPR Avg (pro Runde)
        0.2372 * impact_new +     // <<<< NEUER Impact Wert
        0.0032 * adr_avg_simple + // <<<< Einfacher ADR Avg Wert
        0.2087
    );
    const rating_final = Math.max(0, ratingRaw);

    // Gib berechnete Stats zurück
    return {
        kd: +kd.toFixed(2),
        adr: +adr_avg_simple.toFixed(1), // ADR (Avg pro Match)
        winRate: +winRate.toFixed(1),
        hsp: +hsp.toFixed(1),
        kast: +kast_avg.toFixed(1),
        impact: +impact_new.toFixed(2),    // Impact (NEU)
        rating: +rating_final.toFixed(2), // Rating (Original-Struktur, neue Inputs)
        // Interne Werte optional
        kpr: +kpr_avg.toFixed(2),
        dpr: +dpr_avg.toFixed(2),
        apr: +apr_avg.toFixed(2),
        weight: totalMatches
    };
}


// Nimmt die letzten 10 Matches für die Form-Berechnung
function calculateCurrentFormStats(matches) {
    const sorted = [...matches].sort((a, b) => {
        const timeA = Number(a.CreatedAt) || 0;
        const timeB = Number(b.CreatedAt) || 0;
        return timeB - timeA;
    });
    const recent = sorted.slice(0, 10);
    return {
        stats: calculateAverageStats(recent),
        matchesCount: recent.length,
    };
}

// --- Konfiguration ------------------------------------------------------
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const MATCH_COUNT = 20;
const API_DELAY = 600;
const BATCH_SIZE = 5;

// --- Redis‑Initialisierung mit Fehlertoleranz ---------------------------
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 20000,
            maxRetriesPerRequest: 3,
        });
        redis.on("error", (err) => {
            console.error("[Redis] Connection error during operation:", err.message);
        });
        redis.connect().catch(err => {
             console.error("[Redis] Initial connection failed. Stats will not be cached:", err.message);
             redis = null;
        });
        console.log("[Redis] Client initialized.");
    } catch (e) {
        console.error("[Redis] Initialization failed:", e);
        redis = null;
    }
} else {
    console.warn("[Redis] REDIS_URL environment variable not set. Stats calculation will proceed without caching.");
}


// --- Hilfs‑Fetch mit Rate‑Limit‑Pause -----------------------------------
async function fetchFaceitApi(endpoint) {
    await delay(API_DELAY);
    const url = `${API_BASE_URL}${endpoint}`;
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${FACEIT_API_KEY}`,
                'Accept': 'application/json'
            },
        });
        if (res.status === 429) {
            console.warn(`[API] Rate limit hit (429) for ${endpoint} – sleeping longer...`);
            await delay(API_DELAY * 10);
            return fetchFaceitApi(endpoint);
        }
        if (res.status === 401) {
             console.error(`[API] Authentication failed (401) for ${endpoint}. Check FACEIT_API_KEY.`);
             throw new Error(`API Authentication failed (401)`);
        }
        if (res.status === 404) {
             console.warn(`[API] Resource not found (404) for ${endpoint}.`);
             throw new Error(`API resource not found (404)`);
        }
        if (!res.ok) {
            const errorBody = await res.text();
            console.error(`[API] Error ${res.status} for ${endpoint}: ${errorBody}`);
            throw new Error(`API request failed for ${endpoint} with status ${res.status}`);
        }
        return await res.json();
    } catch (error) {
        console.error(`[API] Network or fetch error for ${endpoint}: ${error.message}`);
        throw error;
    }
}

// --- Cron Job Handler ---------------------------------------------------
export default async function handler(req, res) {
    console.log(`[CRON][${new Date().toISOString()}] Starting stats update job...`);

    // 1. Spielerliste laden
    const jsonPath = path.resolve(process.cwd(), "players.json");
    let playerList = [];
    try {
      playerList = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (!Array.isArray(playerList)) throw new Error("players.json is not a valid JSON array.");
      console.log(`[CRON] Loaded ${playerList.length} players from players.json.`);
    } catch (e) {
       console.error("[CRON] Failed to read or parse players.json:", e);
       return res.status(500).json({ success: 0, failed: 0, error: "Could not read or parse player list." });
    }

    // 2. Prüfen, ob Redis verfügbar ist
    if (!redis) {
        console.warn("[CRON] Redis client not available. Stats will be calculated but not cached.");
    }

    // 3. Statistiken für jeden Spieler aktualisieren
    let success = 0;
    let failed = 0;

    for (const nickname of playerList) {
        console.log(`[CRON] Processing player: ${nickname}`);
        try {
            // a) Spieler‑Details holen
            const details = await fetchFaceitApi(`/players?nickname=${encodeURIComponent(nickname)}`);
            const playerId = details?.player_id;
            if (!playerId) {
              throw new Error(`Could not find player_id for nickname ${nickname}.`);
            }
            console.log(`[CRON] Found player_id: ${playerId} for ${nickname}`);

            // b) Match‑History holen
            const history = await fetchFaceitApi(
                `/players/${playerId}/history?game=cs2&limit=${MATCH_COUNT}`
            );
            if (!history || !Array.isArray(history.items) || history.items.length === 0) {
                console.log(`[CRON] No valid match history found for ${nickname}. Skipping.`);
                continue;
            }
            console.log(`[CRON] Found ${history.items.length} matches in history for ${nickname}. Fetching details...`);

            // c) Detail-Stats für jedes Match holen (Batches)
            const matchesForCalc = [];
            for (let i = 0; i < history.items.length; i += BATCH_SIZE) {
                const batchItems = history.items.slice(i, i + BATCH_SIZE);
                const batchPromises = batchItems.map(async (h) => {
                     try {
                        const stats = await fetchFaceitApi(`/matches/${h.match_id}/stats`);
                        if (!stats || !Array.isArray(stats.rounds) || stats.rounds.length === 0 || !stats.rounds[0].teams) {
                             console.warn(`[CRON] Invalid stats structure for match ${h.match_id}. Skipping.`);
                             return null;
                        }
                        const roundStats = stats.rounds[0].round_stats;
                        const winningTeamId = roundStats?.["Winner"];
                        const matchRounds = parseInt(roundStats?.["Rounds"], 10) || 1;

                        let playerTeamData = null;
                        let playerStatsData = null;
                        for (const team of stats.rounds[0].teams) {
                            const player = team.players?.find((p) => p.player_id === playerId);
                            if (player) {
                                playerTeamData = team;
                                playerStatsData = player.player_stats;
                                break;
                            }
                        }
                        if (!playerTeamData || !playerStatsData) {
                            console.warn(`[CRON] Player ${playerId} not found in match ${h.match_id}. Skipping.`);
                            return null;
                        }
                        return {
                            Kills: playerStatsData["Kills"],
                            Deaths: playerStatsData["Deaths"],
                            Assists: playerStatsData["Assists"],
                            Headshots: playerStatsData["Headshots"],
                            "K/R Ratio": playerStatsData["K/R Ratio"],
                            ADR: playerStatsData["ADR"] ?? playerStatsData["Average Damage per Round"],
                            Rounds: matchRounds,
                            Win: playerTeamData.team_id === winningTeamId ? 1 : 0,
                            CreatedAt: h.started_at,
                        };
                    } catch (matchErr) {
                        console.warn(`[CRON] Failed fetch/process stats match ${h.match_id} for ${nickname}: ${matchErr.message}`);
                        return null;
                    }
                });
                const batchResults = await Promise.all(batchPromises);
                matchesForCalc.push(...batchResults.filter(Boolean));
            }

            // d) Prüfen, ob gültige Match-Daten vorhanden sind
            if (matchesForCalc.length === 0) {
              console.log(`[CRON] No valid match details fetched for ${nickname}. Skipping.`);
              continue;
            }

            // e) Stats berechnen (letzte 10)
            console.log(`[CRON] Calculating stats for ${nickname} (using last 10 of ${matchesForCalc.length} valid matches).`);
            const {stats, matchesCount} = calculateCurrentFormStats(matchesForCalc);

            // f) Daten für Redis vorbereiten
            const dataToStore = {
                version:          CACHE_VERSION, // Cache Version
                calculatedRating: stats.rating,   // Rating (Original-Struktur, neue Inputs)
                kd:               stats.kd,
                adr:              stats.adr,       // ADR (Avg pro Match)
                winRate:          stats.winRate,
                hsPercent:        stats.hsp,       // Name konsistent!
                kast:             stats.kast,
                impact:           stats.impact,    // Impact (NEU)
                matchesConsidered: matchesCount,
                lastUpdated:      new Date().toISOString(),
            };

            // g) In Redis speichern
            if (redis) {
                const cacheKey = `player_stats:${playerId}`;
                try {
                    await redis.set(cacheKey, JSON.stringify(dataToStore), "EX", 7 * 24 * 60 * 60);
                    console.log(`[CRON] Successfully updated stats for ${nickname} (Player ID: ${playerId}). Stored in Redis.`);
                    success++;
                } catch (redisError) {
                    console.error(`[CRON] Failed to store stats in Redis for ${nickname}: ${redisError.message}`);
                    failed++; // Fehler beim Speichern zählt als fehlgeschlagen
                }
            } else {
                 console.log(`[CRON] Calculated stats for ${nickname}, Redis not available for caching.`);
                 success++; // Berechnung erfolgreich, auch ohne Cache
            }

        } catch (e) {
            console.error(`[CRON] Processing failed for player ${nickname}:`, e.message, e.stack ? `\nStack: ${e.stack}` : '');
            failed++;
        }
    } // Ende Spieler-Loop

    console.log(`[CRON][${new Date().toISOString()}] Job finished. Success: ${success}, Failed: ${failed}`);
    res.status(200).json({
        message: `Cron job finished. Updated: ${success}, Failed: ${failed}`,
        success: success,
        failed: failed
    });
}