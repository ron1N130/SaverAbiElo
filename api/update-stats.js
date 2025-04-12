import Redis from 'ioredis';
import fetch from 'node-fetch'; // node-fetch@3 ESM? Should be node-fetch@2 based on package-lock
import fs from 'fs';
import path from 'path';

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const API_BASE_URL = 'https://open.faceit.com/data/v4';
const REDIS_URL = process.env.REDIS_URL;
const MATCH_COUNT = 20;
const API_DELAY = 600; // Consider increasing if rate limits hit

console.log('[CRON START] Update Stats function initializing...'); // Log start

if (!FACEIT_API_KEY) {
    console.error("[CRON FATAL] FACEIT_API_KEY environment variable is not set!");
    // No point continuing without API key
    // We return a response in the handler, but logging the fatal error is important
}
if (!REDIS_URL) {
    console.error("[CRON FATAL] REDIS_URL environment variable is not set!");
    // If Redis is critical, we should stop. The handler checks redis instance later.
} else {
    // Log parts of Redis URL for debugging (AVOID LOGGING FULL URL/PASSWORD)
    try {
        const urlParts = new URL(REDIS_URL);
        console.log(`[CRON INFO] Attempting Redis connection to host: ${urlParts.hostname}, port: ${urlParts.port}, username: ${urlParts.username ? 'Yes' : 'No'}`);
    } catch (e) {
        console.error("[CRON WARN] Could not parse REDIS_URL for logging parts.");
    }
}

// Initialize Redis client
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            connectTimeout: 10000,
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                const delay = Math.min(times * 50, 2000); // Exponential backoff
                console.log(`[CRON Redis] Retry connection attempt ${times}, delaying for ${delay}ms`);
                return delay;
            },
            // Add TLS options if necessary for Vercel Redis - uncomment if needed
            // tls: { rejectUnauthorized: false } // Use with caution
        });

        redis.on('error', (err) => {
            console.error('[CRON Redis Client Error]', err);
            // Potentially set redis back to null or use a flag
            redis = null; // Ensure redis is null on persistent error
        });

        redis.on('connect', () => {
            console.log('[CRON Redis Client] Connected successfully.');
        });
        redis.on('reconnecting', () => {
            console.log('[CRON Redis Client] Reconnecting...');
        });
        redis.on('end', () => {
            console.log('[CRON Redis Client] Connection ended.');
            redis = null; // Ensure redis is null if connection ends
        });


    } catch (error) {
        console.error('[CRON Redis Client] Failed to initialize:', error);
        redis = null;
    }
} else {
    console.warn('[CRON Redis Client] Skipping initialization because REDIS_URL is not set.');
}

// --- Helper ---
function getPlayerNicknames() {
    try {
        const jsonPath = path.resolve(process.cwd(), 'players.json');
        console.log(`[CRON INFO] Reading players from: ${jsonPath}`); // Log path
        if (fs.existsSync(jsonPath)) {
            const rawData = fs.readFileSync(jsonPath);
            const nicknames = JSON.parse(rawData.toString());
            console.log(`[CRON INFO] Found ${nicknames.length} players in players.json`);
            return nicknames;
        }
        console.error("[CRON ERROR] players.json not found at path:", jsonPath);
        return [];
    } catch (error) {
        console.error("[CRON ERROR] Fehler Lesen players.json:", error);
        return [];
    }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Hauptfunktion für Cron Job ---
export default async function handler(req, res) {
    console.log(`[CRON HANDLER] Received request. Query: ${JSON.stringify(req.query || {})}`); // Log request query

    if (req.query.source !== 'cron') {
        console.warn('[CRON FORBIDDEN] Access denied. Request source not "cron".');
        return res.status(403).json({ error: 'Forbidden: Access denied.' });
    }
    if (!FACEIT_API_KEY) {
        // Already logged above, but good to check in handler too
        console.error("[CRON HANDLER FATAL] FACEIT_API_KEY missing!");
        return res.status(500).json({ error: 'Server config error: API Key missing' });
    }
    if (!redis) {
        console.error("[CRON HANDLER FATAL] Redis client not available or connection failed previously. Cannot update stats.");
        // Check if maybe it reconnected? Unlikely if nullified by error handler.
        // await delay(1000); // Small delay to allow potential late connection? Risky.
        // if (!redis) { // Double check
        return res.status(500).json({ error: 'Server configuration error: Database connection failed' });
        // }
        // console.log("[CRON HANDLER INFO] Redis client seems available now after delay."); // If it reconnects
    }

    const faceitHeaders = { 'Authorization': `Bearer ${FACEIT_API_KEY}` };
    console.log('[CRON UPDATE] Starting scheduled stats update cycle...');
    const nicknames = getPlayerNicknames();
    if (!nicknames || nicknames.length === 0) {
        console.log('[CRON UPDATE] No players found or error reading players.json. Exiting.');
        return res.status(200).json({message: 'No players found or error reading list.'});
    }

    let successCount = 0;
    let errorCount = 0;
    const totalPlayers = nicknames.length;

    for (let i = 0; i < totalPlayers; i++) {
        const nickname = nicknames[i];
        console.log(`[CRON UPDATE] Processing player ${i + 1}/${totalPlayers}: ${nickname}`);
        let playerId = null;
        let recentMatchesData = {
            kills: 0,
            deaths: 0,
            rounds: 0,
            adrSum: 0,
            hsCount: 0,
            wins: 0,
            matchesProcessed: 0,
            perfScoreSum: 0
        }; // Start deaths at 0
        let calculationError = false;

        try {
            // 1. Player ID holen
            await delay(API_DELAY);
            const playerDetailsResponse = await fetch(`${API_BASE_URL}/players?nickname=${nickname}`, { headers: faceitHeaders });
            console.log(`[CRON UPDATE ${nickname}] Fetch Player Details Status: ${playerDetailsResponse.status}`);
            if (!playerDetailsResponse.ok) { throw new Error(`Failed to fetch player details (${playerDetailsResponse.status})`); }
            const playerData = await playerDetailsResponse.json();
            playerId = playerData.player_id;
            if (!playerId) { throw new Error('Player ID not found in response.'); }
            // console.log(`[CRON UPDATE] Player ID for ${nickname}: ${playerId}`); // Logged below with history fetch

            // 2. Match History holen
            await delay(API_DELAY);
            console.log(`[CRON UPDATE ${nickname}] Fetching history for Player ID: ${playerId}`);
            const historyResponse = await fetch(`${API_BASE_URL}/players/${playerId}/history?game=cs2&limit=${MATCH_COUNT}`, { headers: faceitHeaders });
            console.log(`[CRON UPDATE ${nickname}] Fetch History Status: ${historyResponse.status}`);
            if (!historyResponse.ok) { throw new Error(`Failed to fetch match history (${historyResponse.status})`); }
            const historyData = await historyResponse.json();

            if (!historyData || !Array.isArray(historyData.items) || historyData.items.length === 0) {
                console.warn(`[CRON UPDATE ${nickname}] No recent match history found. Skipping detailed stats calc.`);
                calculationError = true; // Markieren, dass keine Stats berechnet werden konnten
            } else {
                console.log(`[CRON UPDATE ${nickname}] Fetched ${historyData.items.length} matches. Getting details...`);
                // 3. Detail Stats für jedes Match holen
                for (const match of historyData.items) {
                    const matchId = match.match_id;
                    await delay(API_DELAY); // Delay BEFORE fetching match stats
                    try {
                        // console.log(`[CRON UPDATE ${nickname}] Fetching stats for match ${matchId}`); // Can be verbose
                        const matchStatsResponse = await fetch(`${API_BASE_URL}/matches/${matchId}/stats`, { headers: faceitHeaders });
                        if (!matchStatsResponse.ok) {
                            console.warn(`[CRON UPDATE ${nickname}] Failed fetch stats for match ${matchId} (${matchStatsResponse.status}). Skipping match.`);
                            continue;
                        }
                        const matchStatsData = await matchStatsResponse.json();
                        const playerStatsInMatch = matchStatsData?.rounds?.[0]?.teams?.flatMap(team => team.players)?.find(p => p.player_id === playerId);

                        if (playerStatsInMatch?.player_stats) {
                            const stats = playerStatsInMatch.player_stats;
                            const k = parseInt(stats.Kills || 0, 10);
                            const d = parseInt(stats.Deaths || 0, 10);
                            const r = parseInt(stats.Rounds || 0, 10);
                            const hs = parseInt(stats['Headshots %'] || stats.Headshots || 0, 10); // Check both Headshots % and Headshots
                            const dmg = parseInt(stats.Damage || 0, 10); // Not standard, check if available in API response
                            const win = stats.Result === "1";

                            if (r > 0) { // Only count matches with rounds
                                recentMatchesData.kills += k;
                                recentMatchesData.deaths += d;
                                recentMatchesData.rounds += r;
                                // Use Headshots count if available, otherwise calculate from % if needed (more complex)
                                recentMatchesData.hsCount += parseInt(stats.Headshots || 0, 10); // Prefer direct count
                                if (win) recentMatchesData.wins++;

                                // ADR Calculation (Damage / Rounds)
                                const matchAdr = dmg / r;
                                recentMatchesData.adrSum += matchAdr;

                                // PerfScore Calculation
                                const matchKpr = k / r;
                                const matchAdrNorm = matchAdr / 100; // Normalize ADR
                                const matchKD = k / Math.max(1, d); // Avoid division by zero
                                const matchPerfScore = (matchKD * 0.5) + (matchAdrNorm * 0.3) + (matchKpr * 0.1); // Example weights
                                recentMatchesData.perfScoreSum += matchPerfScore;

                                recentMatchesData.matchesProcessed++;
                            }
                        } else {
                            console.warn(`[CRON UPDATE ${nickname}] Player stats not found in match ${matchId}.`);
                        }
                    } catch (matchError) {
                        console.error(`[CRON UPDATE ${nickname}] Error fetching/processing stats for match ${matchId}:`, matchError);
                    }
                } // Ende Match-Loop
            }

            // 4. Berechne Durchschnittswerte
            let calculatedStats = {};
            if (recentMatchesData.matchesProcessed > 0 && !calculationError) {
                // Use Math.max(1, ...) to avoid division by zero issues
                const avgKD = (recentMatchesData.kills / Math.max(1, recentMatchesData.deaths)).toFixed(2);
                const avgADR = (recentMatchesData.adrSum / recentMatchesData.matchesProcessed).toFixed(1);
                const avgHS = ((recentMatchesData.hsCount / Math.max(1, recentMatchesData.kills)) * 100).toFixed(0);
                const winRate = ((recentMatchesData.wins / recentMatchesData.matchesProcessed) * 100).toFixed(0);
                const avgPerfRating = (recentMatchesData.perfScoreSum / recentMatchesData.matchesProcessed).toFixed(2);

                calculatedStats = {
                    calculatedRating: avgPerfRating, kd: avgKD, adr: avgADR,
                    winRate: winRate, hsPercent: avgHS,
                    matchesConsidered: recentMatchesData.matchesProcessed,
                    lastUpdated: Date.now()
                };
                console.log(`[CRON UPDATE ${nickname}] Calculated stats:`, calculatedStats);

                // 5. Speichere in Redis
                if (!redis) {
                    console.error(`[CRON UPDATE ${nickname}] Redis client became unavailable. Cannot store stats.`);
                    errorCount++; // Count as error if we cannot store
                } else {
                    try {
                        const redisKey = `player_stats:${playerId}`;
                        const expirationSeconds = 7 * 24 * 60 * 60; // 1 week
                        await redis.set(redisKey, JSON.stringify(calculatedStats), 'EX', expirationSeconds);
                        console.log(`[CRON UPDATE ${nickname}] Stored calculated stats in Redis (Key: ${redisKey})`);
                        successCount++;
                    } catch (redisError) {
                        console.error(`[CRON UPDATE ${nickname}] Error storing stats in Redis:`, redisError);
                        errorCount++; // Count as error if storing fails
                    }
                }

            } else if (!calculationError) {
                console.warn(`[CRON UPDATE ${nickname}] No valid match details processed. Cannot calculate stats.`);
                errorCount++;
            } else {
                console.warn(`[CRON UPDATE ${nickname}] Skipping stats calculation due to history fetch error for ${nickname}.`);
                errorCount++;
            }

        } catch (error) {
            console.error(`[CRON UPDATE ${nickname}] FAILED processing player:`, error);
            errorCount++;
        }
    } // Ende Player-Loop

    console.log(`[CRON UPDATE] Finished update cycle. Success: ${successCount}, Failed: ${errorCount} (of ${totalPlayers} players)`);
    return res.status(200).json({ message: `Finished update. Success: ${successCount}, Failed: ${errorCount}` });
}