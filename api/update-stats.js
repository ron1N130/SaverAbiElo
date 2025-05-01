// api/update-stats.js – vollständig überarbeitet
// -------------------------------------------------
// ◼ MIT NEUER IMPACT BERECHNUNG & Cache Versionierung
// ◼ KAST Berechnung vereinheitlicht
// -------------------------------------------------

import Redis from "ioredis";
import fs from "fs";
import path from "path";

// --- Cache Version (muss mit faceit-data.js übereinstimmen!) ---
const CACHE_VERSION = 2; // Wichtig für Konsistenz beim Lesen/Schreiben

// --- Helpers -------------------------------------------------------------
/** simple async sleep */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// NEUE HILFSFUNKTION zur Berechnung des Impact Scores
// (Identisch zu faceit-data.js)
// ============================================================
/**
 * Berechnet einen neuen "Proxy" Impact Score basierend auf KPR, ADR und KAST.
 * Versucht, Spieler zu belohnen, die überdurchschnittlich in Kills und Schaden sind,
 * angepasst durch ihre Rundenkonstanz (KAST).
 *
 * @param {number} kpr_avg - Durchschnittliche Kills pro Runde
 * @param {number} adr_avg - Durchschnittlicher Schaden pro Runde
 * @param {number} kast_avg - KAST Rate in Prozent (z.B. 70 für 70%)
 * @returns {number} Der berechnete Impact Score
 */
function calculateNewImpact(kpr_avg, adr_avg, kast_avg) {
    // --- Definiere Baselines (Passe diese ggf. an die Durchschnittswerte deiner Spieler an!) ---
    const baseline_kpr = 0.70; // Geschätzter Durchschnitts-KPR
    const baseline_adr = 75.0; // Geschätzter Durchschnitts-ADR
    const baseline_kast = 68.0; // Geschätzter Durchschnitts-KAST (%)

    // --- Berechne normalisierte Komponenten ---
    const norm_kpr = kpr_avg / baseline_kpr;
    const norm_adr = adr_avg / baseline_adr;

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

// --- Stat Berechnung (angepasst für neue Impact/KAST Logik) ----
function calculateAverageStats(matches) {
    const totalMatches = matches.length; // Anzahl der Matches
    if (totalMatches === 0) {
        // Standard-Nullwerte zurückgeben
        return {
           kd: 0, dpr: 0, kpr: 0, adr: 0, hsp: 0, winRate: 0, apr: 0,
           kast: 0, impact: 0, rating: 0, weight: 0
        };
    }

    // --- Berechne Summen und einfache Durchschnitte ---
    let totalKills = 0;
    let totalDeaths = 0;
    let totalAssists = 0;
    let totalHeadshots = 0;
    let totalWins = 0;
    let totalRounds = 0;
    let totalAdrSum = 0; // Für ADR-Durchschnitt
    let totalKastPercentSum = 0; // Für KAST-Durchschnitt

    const DMG_PER_KILL = 105; // Fallback für ADR
    const TRADE_PERCENT = 0.2; // Annahme für KAST
    const KAST_FACTOR = 0.45; // Faktor für KAST (aus anderer Datei übernommen)

    matches.forEach(m => {
        const kills = Number(m.Kills) || 0;
        const deaths = Number(m.Deaths) || 0;
        const rounds = Math.max(1, Number(m.Rounds) || 1);
        const kpr_match = kills / rounds;
        const adr_match = Number(m.ADR) || (kpr_match * DMG_PER_KILL);
        const hs = Number(m.Headshots) || 0;
        const assists = Number(m.Assists) || 0;
        const win = Number(m.Win) || 0;

        totalKills += kills;
        totalDeaths += deaths;
        totalAssists += assists;
        totalHeadshots += hs;
        totalWins += win;
        totalRounds += rounds;
        totalAdrSum += adr_match;

        // KAST % für dieses Match berechnen (Logik aus faceit-data.js übernommen)
        const survived = rounds - deaths;
        const traded = TRADE_PERCENT * rounds;
        const kastRaw = (kills + assists + survived + traded) * KAST_FACTOR;
        const kast_match_percent = rounds > 0 ? Math.min((kastRaw / rounds) * 100, 100) : 0;
        totalKastPercentSum += kast_match_percent;
    });

    // Berechne einfache Durchschnitte (pro Runde oder pro Match)
    const kpr_avg = totalRounds > 0 ? totalKills / totalRounds : 0;
    const dpr_avg = totalRounds > 0 ? totalDeaths / totalRounds : 0;
    const apr_avg = totalRounds > 0 ? totalAssists / totalRounds : 0;
    const adr_avg_final = totalRounds > 0 ? totalAdrSum / totalRounds : 0; // Durchschnittlicher ADR pro Runde
    const kd = totalDeaths === 0 ? totalKills : totalKills / totalDeaths;
    const hsp = totalKills === 0 ? 0 : (totalHeadshots / totalKills) * 100;
    const winRate = (totalWins / totalMatches) * 100;
    const kast_avg = totalKastPercentSum / totalMatches; // Durchschnittlicher KAST % pro Match

    // *** NEUE IMPACT BERECHNUNG ***
    const impact_new = calculateNewImpact(kpr_avg, adr_avg_final, kast_avg);

    // Rating 2.0 Berechnung (verwendet den *neuen* Impact-Wert)
    const ratingRaw = Math.max(
        0,
        0.0073 * kast_avg +       // KAST Avg
        0.3591 * kpr_avg +      // KPR Avg
        -0.5329 * dpr_avg +       // DPR Avg
        0.2372 * impact_new +     // <<<< NEUER Impact
        0.0032 * adr_avg_final +  // ADR Avg
        0.1587
    );
    const rating_final = Math.max(0, ratingRaw);

    // Gib berechnete Stats zurück (Namen sollten zu dataToStore passen)
    return {
        kd: +kd.toFixed(2),
        adr: +adr_avg_final.toFixed(1), // = adr
        winRate: +winRate.toFixed(1),   // = winRate
        hsp: +hsp.toFixed(1),           // = hsPercent
        kast: +kast_avg.toFixed(1),     // = kast
        impact: +impact_new.toFixed(2), // = impact (NEU)
        rating: +rating_final.toFixed(2),// = calculatedRating
        // Optional: Interne Durchschnitte für Debugging / zukünftige Verwendung
        kpr: +kpr_avg.toFixed(2),
        dpr: +dpr_avg.toFixed(2),
        apr: +apr_avg.toFixed(2),
        weight: totalMatches
    };
}


// Nimmt die letzten 10 Matches für die Form-Berechnung
function calculateCurrentFormStats(matches) {
    const sorted = [...matches].sort((a, b) => b.CreatedAt - a.CreatedAt);
    const recent = sorted.slice(0, 10); // Nur die letzten 10
    return {
        stats: calculateAverageStats(recent), // Ruft angepasste Funktion auf
        matchesCount: recent.length,
    };
}

// --- Konfiguration ------------------------------------------------------
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const MATCH_COUNT = 20; // Holt Historie der letzten 20 Matches
const API_DELAY = 600; // Verzögerung zwischen API-Aufrufen

// --- Redis‑Initialisierung mit Fehlertoleranz ---------------------------
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 20000,
            maxRetriesPerRequest: 3,
            // Optional: TLS für sichere Verbindungen (je nach Redis Anbieter)
            // tls: { rejectUnauthorized: false }
        });
        redis.on("error", (err) => {
            console.error("[Redis] connection error – continuing without Redis:", err.message);
            redis = null; // Setze redis auf null bei Verbindungsfehler
        });
        // Optional: Prüfen ob Verbindung hergestellt werden kann beim Start
        redis.connect().catch(err => {
             console.error("[Redis] Initial connection failed:", err.message);
             redis = null;
        });
    } catch (e) {
        console.error("[Redis] Initialization failed:", e);
        redis = null;
    }
} else {
    console.warn("[Redis] REDIS_URL not set. Cannot cache stats.");
}


// --- Hilfs‑Fetch mit Rate‑Limit‑Pause -----------------------------------
async function fetchFaceitApi(endpoint) {
    await delay(API_DELAY); // Warte vor jedem Aufruf
    const url = `${API_BASE_URL}${endpoint}`;
    console.log(`[API] Fetching: ${url}`); // Logging des API-Aufrufs
    const res = await fetch(url, {
        headers: {Authorization: `Bearer ${FACEIT_API_KEY}`},
    });
    console.log(`[API] Status for ${url}: ${res.status}`); // Logging des Status

    if (res.status === 429) { // Rate Limit Handling
        console.warn("[API] Rate limit hit (429) – sleeping longer...");
        await delay(API_DELAY * 10); // Längere Pause
        return fetchFaceitApi(endpoint); // Erneuter Versuch
    }
    if (!res.ok) { // Andere API Fehler
        const errorBody = await res.text();
        console.error(`[API] Error ${res.status} for ${url}: ${errorBody}`);
        throw new Error(`[API] ${endpoint} → ${res.status}`);
    }
    return res.json(); // Erfolgreiche Antwort als JSON zurückgeben
}

// --- Cron Job Handler ---------------------------------------------------
export default async function handler(req, res) {
    console.log("[CRON] Starting stats update job...");
    const jsonPath = path.resolve(process.cwd(), "players.json");
    let playerList = [];
    try {
      playerList = JSON.parse(fs.readFileSync(jsonPath));
    } catch (e) {
       console.error("[CRON] Failed to read players.json:", e);
       return res.status(500).json({ success: 0, failed: 0, error: "Could not read player list." });
    }

    if (!redis) {
        console.error("[CRON] Redis client not available. Aborting job.");
        // Optional: Hier trotzdem 200 zurückgeben, damit der Cron nicht als fehlerhaft markiert wird?
        return res.status(500).json({ success: 0, failed: playerList.length, error: "Redis not available." });
    }


    let success = 0;
    let failed = 0;

    for (const nickname of playerList) {
        console.log(`[CRON] Processing player: ${nickname}`);
        try {
            // 1) Spieler‑Details holen
            const details = await fetchFaceitApi(`/players?nickname=${nickname}`);
            const playerId = details.player_id;
            if (!playerId) {
              throw new Error(`Could not find player_id for ${nickname}`);
            }
            console.log(`[CRON] Found player_id: ${playerId} for ${nickname}`);

            // 2) Match‑History holen (letzte MATCH_COUNT Spiele)
            const history = await fetchFaceitApi(
                `/players/${playerId}/history?game=cs2&limit=${MATCH_COUNT}`
            );
            if (!history.items?.length) {
                console.log(`[CRON] No match history found for ${nickname}. Skipping.`);
                // Zähle dies nicht als Fehler, sondern als übersprungen
                continue; // Gehe zum nächsten Spieler
            }
            console.log(`[CRON] Found ${history.items.length} matches in history for ${nickname}. Fetching details...`);

            // 3) Detail-Stats für jedes Match holen
            const matchesForCalc = [];
            // Limitierte parallele Anfragen, um Rate Limits zu vermeiden (optional, bei Bedarf)
            // Beispiel: Immer 5 Matches gleichzeitig holen
            const batchSize = 5;
            for (let i = 0; i < history.items.length; i += batchSize) {
                const batchItems = history.items.slice(i, i + batchSize);
                const batchPromises = batchItems.map(async (h) => {
                     try {
                        const stats = await fetchFaceitApi(`/matches/${h.match_id}/stats`);
                        if (!stats.rounds?.length) return null; // Match ohne Runden-Stats?

                        const winningTeamId = stats.rounds[0].round_stats["Winner"];
                        const matchRounds = parseInt(stats.rounds[0].round_stats["Rounds"], 10) || 1;

                        // Finde den Spieler in den Teams
                        let playerTeam = null;
                        let playerStats = null;
                        for (const team of stats.rounds[0].teams) {
                            const pl = team.players.find((p) => p.player_id === playerId);
                            if (pl) {
                                playerTeam = team;
                                playerStats = pl.player_stats;
                                break;
                            }
                        }

                        if (!playerTeam || !playerStats) return null; // Spieler nicht im Match gefunden?

                        // Sammle relevante Stats für die Berechnung
                        return {
                            Kills: playerStats["Kills"],
                            Deaths: playerStats["Deaths"],
                            Assists: playerStats["Assists"],
                            Headshots: playerStats["Headshots"],
                            "K/R Ratio": playerStats["K/R Ratio"],
                            ADR: playerStats["ADR"] ?? playerStats["Average Damage per Round"],
                            Rounds: matchRounds,
                            Win: playerTeam.team_id === winningTeamId ? 1 : 0,
                            CreatedAt: h.started_at, // Unix Timestamp für Sortierung
                        };
                    } catch (matchErr) {
                        console.warn(`[CRON] Failed to fetch stats for match ${h.match_id} for ${nickname}: ${matchErr.message}`);
                        return null; // Ignoriere Fehler bei einzelnen Matches
                    }
                });
                // Ergebnisse des Batches sammeln und gültige hinzufügen
                const batchResults = (await Promise.all(batchPromises)).filter(Boolean);
                matchesForCalc.push(...batchResults);
                console.log(`[CRON] Fetched batch ${i/batchSize + 1}, got ${batchResults.length} valid match details for ${nickname}.`);
            } // Ende Batch-Loop

            if (matchesForCalc.length === 0) {
              console.log(`[CRON] No valid match details could be fetched for ${nickname} after checking history. Skipping.`);
              continue;
            }

            // 4) Stats basierend auf den letzten 10 gültigen Matches berechnen
            console.log(`[CRON] Calculating stats for ${nickname} based on ${matchesForCalc.length} fetched matches.`);
            const {stats, matchesCount} = calculateCurrentFormStats(matchesForCalc); // Nimmt letzte 10

            // 5) Daten für Redis vorbereiten (inkl. Cache Version)
            const dataToStore = {
                version:          CACHE_VERSION, // <<<< Cache Version hinzugefügt
                calculatedRating: stats.rating,
                kd:               stats.kd,
                adr:              stats.adr,
                winRate:          stats.winRate,
                hsPercent:        stats.hsp, // Name muss zu faceit-data.js passen
                kast:             stats.kast,
                impact:           stats.impact, // <<<< Neuer Impact Wert
                // Optional: KPR/DPR/APR auch speichern, falls im Frontend benötigt
                // kpr:              stats.kpr,
                // dpr:              stats.dpr,
                // apr:              stats.apr,
                matchesConsidered: matchesCount, // Wie viele Matches wurden *berechnet* (max 10)
                lastUpdated:      new Date().toISOString(),
            };

            // 6) In Redis speichern
            const cacheKey = `player_stats:${playerId}`;
            await redis.set(cacheKey, JSON.stringify(dataToStore), "EX", 7 * 24 * 60 * 60); // 1 Woche Ablaufzeit
            console.log(`[CRON] Successfully updated stats for ${nickname} (Player ID: ${playerId}). Stored in Redis.`);
            success++;

        } catch (e) {
            // Fehlerbehandlung pro Spieler
            console.error(`[CRON] Processing failed for player ${nickname}:`, e.message, e.stack ? `\nStack: ${e.stack}` : '');
            failed++;
        }
    } // Ende Spieler-Loop

    console.log(`[CRON] Job finished. Success: ${success}, Failed: ${failed}`);
    // Gib Ergebnis zurück
    res.status(200).json({ success, failed });
}