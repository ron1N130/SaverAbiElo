// api/update-stats.js
import Redis from 'ioredis';
import fetch from 'node-fetch'; // Stelle sicher, dass die Version zu deiner package-lock.json passt (v2 oder v3)
import fs from 'fs'; // Verwende fs.promises für async/await
import path from 'path';

// --- HLTV Rating Calculation Functions (Korrekt hier platziert) ---

/**
 * Calculates HLTV Rating 2.0 and other stats based on a list of matches.
 * Requires matches to have 'Kills', 'Deaths', 'Rounds', 'K/R Ratio', 'ADR', 'Headshots', 'Assists', 'Win', 'CreatedAt' properties.
 * @param {Array<Object>} matches - An array of match stat objects for the player.
 * @returns {Object} - An object containing calculated average stats including rating, kast, impact etc.
 */
function calculateAverageStats(matches) {
    const DMG_PER_KILL = 105; // Standard damage estimate per kill if ADR is missing
    const TRADE_PERCENT = 0.2; // Estimated percentage of deaths that are traded

    const weight = matches.length; // Number of matches used for calculation

    if (weight === 0) {
        // Return default zero stats if no matches are provided
        return {
            kills: 0, deaths: 0, hs: 0, wins: 0, kd: 0, dpr: 0, kpr: 0, avgk: 0, adr: 0,
            hsp: 0, winRate: 0, apr: 0, kast: 0, impact: 0, rating: 0, weight,
        };
    }

    // Process each match to ensure stats are numbers and estimate ADR if necessary
    const matchStats = matches.map((match) => {
        // Die Feldnamen hier MÜSSEN denen entsprechen, die du im Hauptteil aus der API ziehst
        const kills = Number(match['Kills']) || 0;
        const deaths = Number(match['Deaths']) || 0;
        const rounds = Number(match['Rounds']) || 1; // Avoid division by zero
        const kpr = Number(match['K/R Ratio']) || 0; // Kills Per Round
        const headshots = Number(match['Headshots']) || 0;
        const assists = Number(match['Assists']) || 0;
        // ADR estimate/fallback
        const adr = Number(match['ADR']) || (kpr * DMG_PER_KILL);
        const win = Number(match['Win']) || 0;

        const validRounds = Math.max(1, rounds);
        return { kills, deaths, rounds: validRounds, kpr, adr, headshots, assists, win };
    });

    // Calculate totals
    const totalKills = matchStats.reduce((sum, stat) => sum + stat.kills, 0);
    const totalDeaths = matchStats.reduce((sum, stat) => sum + stat.deaths, 0);
    // const totalRounds = matchStats.reduce((sum, stat) => sum + stat.rounds, 0); // Nicht direkt für Formel gebraucht
    const totalHs = matchStats.reduce((sum, stat) => sum + stat.headshots, 0);
    const totalWins = matchStats.reduce((sum, stat) => sum + stat.win, 0);

    // Calculate averages and ratios needed for formulas
    const kd = totalDeaths === 0 ? totalKills : totalKills / totalDeaths;
    const kpr_avg = matchStats.reduce((sum, stat) => sum + stat.kpr, 0) / weight;
    const avgk = totalKills / weight;
    const adr_avg = matchStats.reduce((sum, stat) => sum + stat.adr, 0) / weight;
    const hsp = totalKills === 0 ? 0 : (totalHs / totalKills) * 100;
    const winRate = (totalWins / weight) * 100;

    // Calculate per-round stats needed for formulas
    const dpr = matchStats.reduce((sum, stat) => sum + (stat.deaths / stat.rounds), 0) / weight;
    const apr = matchStats.reduce((sum, stat) => sum + (stat.assists / stat.rounds), 0) / weight;

    // Calculate KAST (using the formula from the provided reference code exactly)
    const kast = matchStats.reduce((sum, stat) => {
        const survivedRounds = stat.rounds - stat.deaths;
        const tradedEstimate = TRADE_PERCENT * stat.rounds;
        const contributionSum = (stat.kills + stat.assists + survivedRounds + tradedEstimate) * 0.45;
        const kastValue = (contributionSum / stat.rounds) * 100;
        return sum + Math.min(kastValue, 100);
    }, 0) / weight;

    // Calculate Impact Rating
    const impact = Math.max(0, 2.13 * kpr_avg + 0.42 * apr - 0.41);

    // Calculate HLTV Rating 2.0
    const rating = Math.max(0,
        0.0073 * kast +
        0.3591 * kpr_avg +
        -0.5329 * dpr +
        0.2372 * impact +
        0.0032 * adr_avg +
        0.1587
    );

    // Return all calculated average stats, formatted
    return {
        // Du kannst hier auswählen, welche Stats du brauchst
        kills: totalKills, deaths: totalDeaths, hs: totalHs, wins: totalWins,
        kd: parseFloat(kd.toFixed(2)),
        dpr: parseFloat(dpr.toFixed(2)),
        kpr: parseFloat(kpr_avg.toFixed(2)),
        avgk: parseFloat(avgk.toFixed(2)),
        adr: parseFloat(adr_avg.toFixed(2)),
        hsp: parseFloat(hsp.toFixed(2)),
        winRate: parseFloat(winRate.toFixed(2)),
        apr: parseFloat(apr.toFixed(2)),
        kast: parseFloat(kast.toFixed(2)),
        impact: parseFloat(impact.toFixed(2)),
        rating: parseFloat(rating.toFixed(2)), // <-- Das wichtigste Ergebnis
        weight: weight, // Anzahl verwendeter Matches
    };
}

/**
 * Filters matches to include only those from the last 14 days and calculates average stats.
 * @param {Array<Object>} allMatches - Array of all match objects, each needing a 'CreatedAt' property.
 * @returns {Object} - Object with 'stats' (calculated average stats) and 'matchesCount' (number of recent matches).
 */
function calculateCurrentFormStats(allMatches) {
    if (!Array.isArray(allMatches)) {
        console.error("[HLTV Calc] Invalid input: allMatches must be an array.");
        return { stats: calculateAverageStats([]), matchesCount: 0 };
    }
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const recentMatches = allMatches.filter(match => {
        // Stelle sicher, dass 'CreatedAt' der richtige Feldname ist
        const createdAt = match['CreatedAt'];
        if (!createdAt) return false;
        try {
            const matchDate = new Date(Number(createdAt) ? Number(createdAt) * 1000 : createdAt); // Annahme: Unix Timestamp in Sekunden
            return matchDate instanceof Date && !isNaN(matchDate) && matchDate >= twoWeeksAgo;
        } catch (e) {
            console.warn("[HLTV Calc] Could not parse date for match:", match, e);
            return false;
        }
    });
    // console.log(`[HLTV Calc] Filtered ${allMatches.length} matches to ${recentMatches.length} (last 14 days).`);
    return {
        stats: calculateAverageStats(recentMatches), // Berechne Stats basierend auf gefilterten Matches
        matchesCount: recentMatches.length,
    };
}
// --- Ende HLTV Rating Calculation Functions ---


// --- Globale Konfiguration und Initialisierung (NUR EINMAL!) ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const API_BASE_URL = 'https://open.faceit.com/data/v4';
const REDIS_URL = process.env.REDIS_URL;
const MATCH_COUNT = 20; // Anzahl Matches aus History holen
const API_DELAY = 600; // Pause zwischen API Calls (ms)

console.log('[CRON START] Update Stats function initializing...');

if (!FACEIT_API_KEY) console.error("[CRON FATAL] FACEIT_API_KEY missing!");
if (!REDIS_URL) console.error("[CRON FATAL] REDIS_URL missing!");

// Redis Client Initialisierung (NUR EINMAL!)
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            connectTimeout: 10000,
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                const delay = Math.min(times * 100, 2000); // Angepasste Strategie
                console.log(`[CRON Redis] Retry attempt ${times}, delaying ${delay}ms`);
                return delay;
            },
            tls: { rejectUnauthorized: false } // Für Vercel Redis
        });
        redis.on('error', (err) => console.error('[CRON Redis Error]', err));
        redis.on('connect', () => console.log('[CRON Redis] Connected.'));
        redis.on('reconnecting', () => console.log('[CRON Redis] Reconnecting...'));
        // Optional: Handle 'end' if needed
    } catch (error) { console.error('[CRON Redis] Failed init:', error); redis = null; }
} else { console.warn('[CRON Redis] REDIS_URL not set.'); }

// --- Helper Funktionen ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Faceit API Abruf (wie zuvor)
async function fetchFaceitApi(endpoint) {
    await delay(API_DELAY);
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
        });
        // Fehlerbehandlung (Rate Limit, 404, andere Fehler)
        if (response.status === 429) {
            console.warn(`[CRON API] Rate limit hit for ${endpoint}. Waiting extra long...`);
            await delay(API_DELAY * 10);
            return fetchFaceitApi(endpoint); // Vorsicht bei Retries
        }
        if (!response.ok) {
            if (response.status === 404) return null; // Nicht gefunden ist ok
            console.error(`[CRON API] Error ${response.status} for ${endpoint}: ${await response.text()}`);
            throw new Error(`Faceit API error: ${response.status}`);
        }
        return response.json();
    } catch (error) {
        console.error(`[CRON API] Network or fetch error for ${endpoint}:`, error);
        throw error;
    }
}

// Helper: Spielerliste laden (wie zuvor)
function getPlayerNicknames() {
    try {
        const jsonPath = path.resolve(process.cwd(), 'players.json');
        if (fs.existsSync(jsonPath)) {
            const rawData = fs.readFileSync(jsonPath); // Sync ist ok für Initialisierung
            const nicknames = JSON.parse(rawData.toString());
            console.log(`[CRON INFO] Found ${nicknames.length} players in players.json`);
            return nicknames;
        }
        console.error("[CRON ERROR] players.json not found at path:", jsonPath);
        return [];
    } catch (error) {
        console.error("[CRON ERROR] Error reading players.json:", error);
        return [];
    }
}

// --- Hauptfunktion für Cron Job ---
export default async function handler(req, res) {
    console.log('[CRON HANDLER INVOKED]');

    // --- Trigger-Validierung (wie zuvor) ---
    // Beispiel: Nur erlauben, wenn von Vercel Cron getriggert
    const bearer = req.headers.authorization;
    if (!bearer || bearer !== `Bearer ${process.env.CRON_SECRET}`) { // Verwende CRON_SECRET von Vercel
        console.warn('[CRON FORBIDDEN] Unauthorized: Missing or incorrect CRON secret.');
        return res.status(401).send('Unauthorized');
    }
    // --------------------------------

    if (!FACEIT_API_KEY || !redis) {
        console.error("[CRON HANDLER FATAL] API Key or Redis unavailable!");
        return res.status(500).json({ error: 'Server configuration error' });
    }

    const nicknames = getPlayerNicknames();
    if (!nicknames?.length) {
        console.log('[CRON UPDATE] No players found. Exiting.');
        return res.status(200).json({ message: 'No players found.' });
    }

    console.log('[CRON UPDATE] Starting scheduled stats update cycle...');
    let successCount = 0;
    let errorCount = 0;
    const totalPlayers = nicknames.length;

    // --- Spieler-Schleife ---
    for (let i = 0; i < totalPlayers; i++) {
        const nickname = nicknames[i];
        console.log(`\n[CRON UPDATE ${i + 1}/${totalPlayers}] Processing: ${nickname}`);
        let playerId = null;
        // Dieses Array wird die aufbereiteten Daten für die HLTV-Berechnung sammeln
        let matchesForHltvCalc = [];

        try {
            // 1. Player ID holen
            const playerDetails = await fetchFaceitApi(`/players?nickname=${nickname}`);
            if (!playerDetails?.player_id) { throw new Error('Player ID not found'); }
            playerId = playerDetails.player_id;
            console.log(`[CRON UPDATE ${nickname}] Player ID: ${playerId}`);

            // 2. Match History holen
            const historyData = await fetchFaceitApi(`/players/${playerId}/history?game=csgo&offset=0&limit=${MATCH_COUNT}`);
            if (!historyData?.items?.length) {
                console.log(`[CRON UPDATE ${nickname}] No recent match history found.`);
                // Keine Berechnung möglich, aber kein Fehler -> weiter zum nächsten Spieler
                continue;
            }
            console.log(`[CRON UPDATE ${nickname}] Fetched ${historyData.items.length} matches from history.`);

            // 3. Detail Stats für jedes Match holen und für HLTV-Calc aufbereiten
            console.log(`[CRON UPDATE ${nickname}] Fetching details for ${historyData.items.length} matches...`);
            for (const historyItem of historyData.items) {
                const matchId = historyItem.match_id;
                const matchDetails = await fetchFaceitApi(`/matches/${matchId}/stats`);
                if (!matchDetails?.rounds?.length) {
                    console.warn(`[CRON UPDATE ${nickname}] No detailed stats for match ${matchId}.`);
                    continue;
                }

                // Finde Spieler-Stats
                let playerStatsData = null;
                let teamWon = 0;
                const matchRounds = parseInt(matchDetails.rounds[0].round_stats['Rounds'], 10) || 1;
                const winningFaction = matchDetails.rounds[0].round_stats['Winner'];

                for (const team of matchDetails.rounds[0].teams) {
                    const foundPlayer = team.players.find(p => p.player_id === playerId);
                    if (foundPlayer) {
                        playerStatsData = foundPlayer.player_stats;
                        if (team.team_id === winningFaction) teamWon = 1;
                        break;
                    }
                }

                if (playerStatsData) {
                    // Füge Match-Daten zum Array für die HLTV-Berechnung hinzu
                    // !!! Stelle sicher, dass die Feldnamen hier exakt denen entsprechen,
                    // die `calculateAverageStats` in seinen `map`-Schritt erwartet !!!
                    matchesForHltvCalc.push({
                        Kills: playerStatsData.Kills,
                        Deaths: playerStatsData.Deaths,
                        Assists: playerStatsData.Assists,
                        Headshots: playerStatsData.Headshots,
                        'K/R Ratio': playerStatsData['K/R Ratio'], // <-- Wichtig!
                        ADR: playerStatsData.ADR,                   // <-- Wichtig! (Kann fehlen)
                        Rounds: matchRounds,
                        Win: teamWon,
                        CreatedAt: historyItem.started_at // Unix Timestamp (Sekunden)
                    });
                    console.log(`[CRON UPDATE ${nickname}] Added stats for match ${matchId} to calculation list.`);
                } else {
                    console.warn(`[CRON UPDATE ${nickname}] Player not found in match details ${matchId}.`);
                }
            } // Ende Match-Detail-Schleife

            // 4. HLTV Rating und Stats berechnen (NUR wenn Daten vorhanden)
            if (matchesForHltvCalc.length > 0) {
                console.log(`[CRON UPDATE ${nickname}] Calculating HLTV stats based on ${matchesForHltvCalc.length} collected matches.`);
                const formStatsResult = calculateCurrentFormStats(matchesForHltvCalc);
                const finalStats = formStatsResult.stats; // Das Objekt mit rating, kd, adr etc.
                const matchesConsideredRecent = formStatsResult.matchesCount; // Anzahl Matches der letzten 14 Tage

                if (matchesConsideredRecent === 0) {
                    console.log(`[CRON UPDATE ${nickname}] No matches found within the last 14 days. Storing 0/empty stats.`);
                    // Speichere leere/Standardwerte, wenn keine recent matches vorhanden
                    const emptyStats = calculateAverageStats([]); // Holt Standardwerte
                    const dataToStore = {
                        calculatedRating: emptyStats.rating, kd: emptyStats.kd, adr: emptyStats.adr,
                        winRate: emptyStats.winRate, hsPercent: emptyStats.hsp,
                        matchesConsidered: 0, kast: emptyStats.kast, impact: emptyStats.impact,
                        lastUpdated: new Date().toISOString()
                    };
                    const redisKey = `player_stats:${playerId}`;
                    await redis.set(redisKey, JSON.stringify(dataToStore), 'EX', 7 * 24 * 60 * 60); // 1 Woche TTL
                    console.log(`[CRON UPDATE ${nickname}] Stored empty stats in Redis (0 recent matches).`);
                    successCount++; // Zählt als Erfolg, da Prozess durchlief

                } else {
                    console.log(`[CRON UPDATE ${nickname}] Calculated HLTV stats (Last ${matchesConsideredRecent} matches): Rating=${finalStats.rating}, K/D=${finalStats.kd}, ADR=${finalStats.adr}`);

                    // 5. Ergebnis in Redis speichern
                    const redisKey = `player_stats:${playerId}`;
                    // Stelle sicher, dass die Struktur dem entspricht, was faceit-data.js liest
                    const dataToStore = {
                        calculatedRating: finalStats.rating, // <-- HLTV Rating 2.0
                        kd: finalStats.kd,
                        adr: finalStats.adr,
                        winRate: finalStats.winRate,
                        hsPercent: finalStats.hsp,
                        matchesConsidered: matchesConsideredRecent,
                        kast: finalStats.kast,
                        impact: finalStats.impact,
                        // Füge hier ggf. weitere Werte aus finalStats hinzu, die du brauchst
                        lastUpdated: new Date().toISOString()
                    };
                    await redis.set(redisKey, JSON.stringify(dataToStore), 'EX', 7 * 24 * 60 * 60); // 1 Woche TTL
                    console.log(`[CRON UPDATE ${nickname}] Stored calculated HLTV stats in Redis.`);
                    successCount++;
                }

            } else {
                console.warn(`[CRON UPDATE ${nickname}] No detailed match stats successfully collected. Cannot calculate HLTV rating.`);
                // Optional: Alte Stats löschen oder als N/A markieren
                // await redis.del(`player_stats:${playerId}`);
                errorCount++; // Zählt als Fehler, da keine Berechnung stattfand
            }

        } catch (error) {
            console.error(`[CRON UPDATE ${nickname}] FAILED processing player:`, error);
            errorCount++;
        }
    } // Ende Player-Loop

    console.log(`[CRON UPDATE] Finished update cycle. Success: ${successCount}, Failed: ${errorCount} (of ${totalPlayers} players)`);
    return res.status(200).json({ message: `Finished update. Success: ${successCount}, Failed: ${errorCount}` });
}