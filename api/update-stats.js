import Redis from 'ioredis';
import fetch from 'node-fetch'; // node-fetch@3 ESM
import fs from 'fs';
import path from 'path';

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const API_BASE_URL = 'https://open.faceit.com/data/v4';
const REDIS_URL = process.env.REDIS_URL; // Get Redis URL from env
const MATCH_COUNT = 20; // Anzahl der letzten Matches für die Berechnung
const API_DELAY = 600; // Millisekunden Pause zwischen Faceit API Calls (wichtig!)

// Input validation for REDIS_URL
if (!REDIS_URL) {
    console.error("FATAL: REDIS_URL environment variable is not set!");
    // Decide if the function can proceed without Redis
    // For a stats update job, Redis might be critical
    // throw new Error("REDIS_URL environment variable is not set!");
}

// Initialize Redis client only if REDIS_URL is available
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            connectTimeout: 10000,
            maxRetriesPerRequest: 3,
            // Add TLS options if necessary for Vercel Redis
            // tls: { rejectUnauthorized: false }
        });

        redis.on('error', (err) => {
            console.error('[Redis Client Error]', err);
        });

        redis.on('connect', () => {
            console.log('[Redis Client] Connected successfully.');
        });

    } catch (error) {
        console.error('[Redis Client] Failed to initialize:', error);
        redis = null;
    }
} else {
    console.warn('[Redis Client] Skipping initialization because REDIS_URL is not set.');
}

// --- Helper ---
function getPlayerNicknames() {
    try {
        const jsonPath = path.resolve(process.cwd(), 'players.json');
        if (fs.existsSync(jsonPath)) {
            const rawData = fs.readFileSync(jsonPath);
            return JSON.parse(rawData.toString());
        }
        return [];
    } catch (error) {
        console.error("Fehler Lesen players.json:", error);
        return [];
    }
}
// Kurze Pause Funktion
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Hauptfunktion für Cron Job ---
export default async function handler(req, res) {
    // Nur fortfahren, wenn der Aufruf vom Cron Job kommt (oder manuell mit dem Parameter)
    if (req.query.source !== 'cron') {
        return res.status(403).json({ error: 'Forbidden: Access denied.' });
    }
    if (!FACEIT_API_KEY) {
        console.error("[CRON UPDATE] FATAL: FACEIT_API_KEY fehlt!");
        return res.status(500).json({ error: 'Server config error: API Key missing' });
    }
    // Crucially, check if Redis is available before starting the loop
    if (!redis) {
        console.error("[CRON UPDATE] FATAL: Redis client not available. Cannot update stats.");
        return res.status(500).json({ error: 'Server configuration error: Database connection failed' });
    }

    const faceitHeaders = { 'Authorization': `Bearer ${FACEIT_API_KEY}` };

    console.log('[CRON UPDATE] Starting scheduled stats update...');
    const nicknames = getPlayerNicknames();
    if (!nicknames || nicknames.length === 0) {
        console.log('[CRON UPDATE] No players found in players.json. Exiting.');
        return res.status(200).json({ message: 'No players found.' });
    }

    let successCount = 0;
    let errorCount = 0;

    for (const nickname of nicknames) {
        console.log(`[CRON UPDATE] Processing: ${nickname}`);
        let playerId = null;
        let recentMatchesData = { kills: 0, deaths: 1, rounds: 0, adrSum: 0, hsCount: 0, wins: 0, matchesProcessed: 0, perfScoreSum: 0 };
        let calculationError = false;

        try {
            // 1. Player ID holen
            await delay(API_DELAY); // Pause *vor* dem Call
            const playerDetailsResponse = await fetch(`${API_BASE_URL}/players?nickname=${nickname}`, { headers: faceitHeaders });
            if (!playerDetailsResponse.ok) { throw new Error(`Failed to fetch player details (${playerDetailsResponse.status})`); }
            const playerData = await playerDetailsResponse.json();
            playerId = playerData.player_id;
            if (!playerId) { throw new Error('Player ID not found in response.'); }
            console.log(`[CRON UPDATE] Player ID for ${nickname}: ${playerId}`);

            // 2. Match History holen (letzte MATCH_COUNT Spiele)
            await delay(API_DELAY); // Pause
            const historyResponse = await fetch(`${API_BASE_URL}/players/${playerId}/history?game=cs2&limit=${MATCH_COUNT}`, { headers: faceitHeaders });
            if (!historyResponse.ok) { throw new Error(`Failed to fetch match history (${historyResponse.status})`); }
            const historyData = await historyResponse.json();

            if (!historyData || !Array.isArray(historyData.items) || historyData.items.length === 0) {
                console.warn(`[CRON UPDATE] No match history found for ${nickname}. Skipping detailed stats.`);
                calculationError = true; // Markieren, dass keine Stats berechnet werden konnten
            } else {
                console.log(`[CRON UPDATE] Fetched ${historyData.items.length} matches for ${nickname}. Getting details...`);
                // 3. Detail Stats für jedes Match holen
                for (const match of historyData.items) {
                    const matchId = match.match_id;
                    await delay(API_DELAY); // WICHTIG: Pause zwischen den Match-Detail Calls!
                    try {
                        const matchStatsResponse = await fetch(`${API_BASE_URL}/matches/${matchId}/stats`, { headers: faceitHeaders });
                        if (!matchStatsResponse.ok) {
                            console.warn(`[CRON UPDATE] Failed to fetch stats for match ${matchId} (${matchStatsResponse.status}). Skipping match.`);
                            continue; // Nächstes Match
                        }
                        const matchStatsData = await matchStatsResponse.json();

                        // Finde die Stats für unseren Spieler in diesem Match
                        const playerStatsInMatch = matchStatsData?.rounds?.[0]?.teams
                            ?.flatMap(team => team.players) // Flache Liste aller Spieler im Match
                            ?.find(p => p.player_id === playerId);

                        if (playerStatsInMatch?.player_stats) {
                            const stats = playerStatsInMatch.player_stats;
                            const k = parseInt(stats.Kills || 0, 10);
                            const d = parseInt(stats.Deaths || 0, 10);
                            const r = parseInt(stats.Rounds || 0, 10);
                            const hs = parseInt(stats.Headshots || 0, 10);
                            const dmg = parseInt(stats.Damage || 0, 10);
                            const win = stats.Result === "1"; // Annahme: Result "1" bedeutet Sieg

                            if (r > 0) { // Nur Matches mit Runden zählen
                                recentMatchesData.kills += k;
                                recentMatchesData.deaths += d; // Fange bei 1 an, damit K/D nie unendlich wird
                                recentMatchesData.rounds += r;
                                recentMatchesData.adrSum += (dmg / r); // ADR für dieses Match zur Summe addieren
                                recentMatchesData.hsCount += hs;
                                if(win) recentMatchesData.wins++;

                                // Berechne einfachen PerfScore für dieses Match
                                const matchKpr = k / r;
                                const matchAdrNorm = (dmg / r) / 100; // ADR normalisiert
                                const matchKD = k / Math.max(1, d);
                                // Einfache Beispiel-Formel (Gewichtung anpassen!)
                                const matchPerfScore = (matchKD * 0.5) + (matchAdrNorm * 0.3) + (matchKpr * 0.1);
                                recentMatchesData.perfScoreSum += matchPerfScore;

                                recentMatchesData.matchesProcessed++;
                            }
                        } else {
                            console.warn(`[CRON UPDATE] Player stats not found in match ${matchId} for ${nickname}.`);
                        }
                    } catch (matchError) {
                        console.error(`[CRON UPDATE] Error fetching stats for match ${matchId}:`, matchError);
                        // Fahre mit nächstem Match fort
                    }
                } // Ende Match-Loop
            }

            // 4. Berechne Durchschnittswerte (nur wenn Matches verarbeitet wurden)
            let calculatedStats = {};
            if (recentMatchesData.matchesProcessed > 0 && !calculationError) {
                const avgKD = (recentMatchesData.kills / Math.max(1, recentMatchesData.deaths)).toFixed(2);
                const avgADR = (recentMatchesData.adrSum / recentMatchesData.matchesProcessed).toFixed(1);
                const avgHS = ((recentMatchesData.hsCount / Math.max(1, recentMatchesData.kills)) * 100).toFixed(0);
                const winRate = ((recentMatchesData.wins / recentMatchesData.matchesProcessed) * 100).toFixed(0);
                const avgPerfRating = (recentMatchesData.perfScoreSum / recentMatchesData.matchesProcessed).toFixed(2);

                calculatedStats = {
                    calculatedRating: avgPerfRating,
                    kd: avgKD,
                    adr: avgADR,
                    winRate: winRate,
                    hsPercent: avgHS,
                    matchesConsidered: recentMatchesData.matchesProcessed,
                    lastUpdated: Date.now()
                };
                console.log(`[CRON UPDATE] Calculated stats for ${nickname}:`, calculatedStats);

                // 5. Speichere berechnete Stats in Redis
                const redisKey = `player_stats:${playerId}`;
                // Use Redis SET command. Set an expiration time (e.g., 1 week in seconds)
                // Expiration prevents stale data if updates fail later
                const expirationSeconds = 7 * 24 * 60 * 60; // 1 week
                await redis.set(redisKey, JSON.stringify(calculatedStats), 'EX', expirationSeconds);
                console.log(`[CRON UPDATE] Stored calculated stats in Redis for ${nickname} (Key: ${redisKey})`);
                successCount++;

            } else if (!calculationError) {
                console.warn(`[CRON UPDATE] No match details processed for ${nickname}. Cannot calculate stats.`);
                errorCount++;
            } else {
                // Fehler trat schon vorher auf (z.B. History nicht gefunden)
                console.warn(`[CRON UPDATE] Skipping stats calculation due to earlier error for ${nickname}.`);
                errorCount++;
            }

        } catch (error) {
            console.error(`[CRON UPDATE] Failed processing player ${nickname}:`, error);
            errorCount++;
        }
    } // Ende Player-Loop

    console.log(`[CRON UPDATE] Finished update cycle. Success: ${successCount}, Failed: ${errorCount}`);
    return res.status(200).json({ message: `Finished update. Success: ${successCount}, Failed: ${errorCount}` });
}
