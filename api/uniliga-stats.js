// api/uniliga-stats.js - Refactored mit Debug Logging
// -------------------------------------------------
// ◼ Nutzt zentrale Statistik-Berechnung aus /api/utils/stats.js
// ◼ Cache Version 7
// ◼ Detailliertes Logging für Teamnamen hinzugefügt
// -------------------------------------------------

import Redis from "ioredis";
import { calculateAverageStats } from './utils/stats.js'; // Pfad prüfen!

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const UNILIGA_CHAMPIONSHIP_ID = "c1fcd6a9-34ef-4e18-8e92-b57af0667a40";
const CACHE_VERSION = 7;
const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 Stunden
const API_DELAY = 500;
const MATCH_DETAIL_BATCH_SIZE = 10;
const MAX_MATCHES_TO_FETCH = 500;

// --- Hilfsfunktionen ---
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchFaceitApi(endpoint, retries = 3) {
    await delay(API_DELAY);
    const url = `${API_BASE_URL}${endpoint}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}`, 'Accept': 'application/json' } });
        if (res.status === 429) {
            console.warn(`[API Uniliga] Rate limit hit (429) for ${endpoint} – sleeping...`);
            await delay(API_DELAY * 15);
            if (retries > 0) return fetchFaceitApi(endpoint, retries - 1);
            else throw new Error(`API Rate limit exceeded for ${endpoint}`);
        }
        if (res.status === 401) throw new Error(`API Authentication failed (401)`);
        if (res.status === 404) { console.warn(`[API Uniliga] Not found (404) for ${endpoint}.`); return null; }
        if (!res.ok) { const errBody = await res.text(); throw new Error(`API request failed ${endpoint} (${res.status}): ${errBody}`); }
        return await res.json();
    } catch (error) {
        console.error(`[API Uniliga] Fetch error for ${endpoint}: ${error.message}`);
        if (retries > 0) { await delay(API_DELAY * 5); return fetchFaceitApi(endpoint, retries - 1); }
        else throw error;
    }
}

// --- Redis‑Initialisierung ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 10000, maxRetriesPerRequest: 2, showFriendlyErrorStack: true });
        redis.on("error", (err) => { console.error("[Redis Uniliga] Connection error:", err.message); redis = null; });
        console.log("[Redis Uniliga] Client initialized (lazy).");
    } catch (e) { console.error("[Redis Uniliga] Initialization failed:", e); redis = null; }
} else { console.warn("[Redis Uniliga] REDIS_URL not set. Caching disabled."); }

// --- Haupt‑Handler ---
export default async function handler(req, res) {
    console.log(`[API Uniliga] Received request at ${new Date().toISOString()}`);
    const championshipId = UNILIGA_CHAMPIONSHIP_ID;
    const cacheKey = `uniliga_stats:${championshipId}`;

    // 1. Cache prüfen
    if (redis && redis.status === 'ready') { // Nur prüfen, wenn Redis verbunden
        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                const parsedData = JSON.parse(cachedData);
                if (parsedData.version === CACHE_VERSION) {
                    console.log(`[API Uniliga] Cache HIT (v${CACHE_VERSION}). Returning cached data.`);
                    res.setHeader("X-Cache-Status", "HIT");
                    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
                    return res.status(200).json(parsedData);
                } else { console.log(`[API Uniliga] Cache STALE (v${parsedData.version}, expected v${CACHE_VERSION}).`); res.setHeader("X-Cache-Status", "STALE"); }
            } else { console.log("[API Uniliga] Cache MISS."); res.setHeader("X-Cache-Status", "MISS"); }
        } catch (err) {
            console.error("[API Uniliga] Redis GET error:", err);
            res.setHeader("X-Cache-Status", "ERROR");
            // redis = null; // Nicht global deaktivieren, nur für diesen Request ggf. problematisch
        }
    } else { res.setHeader("X-Cache-Status", redis ? `DISABLED (Status: ${redis.status})` : "DISABLED"); }

    // 2. Live-Daten holen und verarbeiten
    try {
        console.log(`[API Uniliga] Fetching matches for championship: ${championshipId}`);
        let allMatches = [];
        let offset = 0;
        const limit = 100;
        let fetchMore = true;
        while (fetchMore && allMatches.length < MAX_MATCHES_TO_FETCH) {
            const matchResponse = await fetchFaceitApi(`/championships/${championshipId}/matches?type=past&offset=${offset}&limit=${limit}`);
            if (!matchResponse?.items?.length) {
                fetchMore = false;
            } else {
                allMatches.push(...matchResponse.items);
                offset += matchResponse.items.length;
                if (matchResponse.items.length < limit) fetchMore = false;
            }
        }
        console.log(`[API Uniliga] Total matches found: ${allMatches.length}. Fetching details...`);

        const playerMatchStats = {}; // { playerId: [matchStat1, matchStat2, ...] }
        const teamStats = {};        // { teamId: { name: string, wins: number, ... } }
        const playerDetails = {};    // { playerId: { nickname: string, avatar: string } }
        let processedMatchCount = 0;
        let skippedMatchCount = 0;

        for (let i = 0; i < allMatches.length; i += MATCH_DETAIL_BATCH_SIZE) {
            const batchMatchIds = allMatches.slice(i, i + MATCH_DETAIL_BATCH_SIZE).map(m => m.match_id);
            const batchPromises = batchMatchIds.map(async (matchId) => {
                try {
                    const stats = await fetchFaceitApi(`/matches/${matchId}/stats`);
                    if (!stats?.rounds?.[0]?.teams || stats.rounds[0].teams.length === 0) {
                        console.warn(`[API Uniliga DEBUG] Skipping Match ${matchId}: No stats.rounds[0].teams found or teams array empty.`);
                        skippedMatchCount++; return null;
                    }
                    const roundData = stats.rounds[0];
                    const winningTeamId = roundData.round_stats?.["Winner"];
                    const matchRounds = parseInt(roundData.round_stats?.["Rounds"], 10);
                    if (isNaN(matchRounds) || matchRounds <= 0) {
                        console.warn(`[API Uniliga DEBUG] Skipping Match ${matchId}: Invalid or zero rounds (${roundData.round_stats?.["Rounds"]}).`);
                        skippedMatchCount++; return null;
                    }
                    processedMatchCount++;

                    for (const team of roundData.teams) {
                        const teamId = team.team_id;
                        const teamName = team.nickname; // <<<<<< HIER WIRD DER NAME GEHOLT

                        // +++ NEUES LOGGING (1): Namen direkt beim Auslesen loggen +++
                        console.log(`[API Uniliga DEBUG] Match ${matchId}, Team ID ${teamId}, Found Name: '${teamName}'`);

                        if (!teamStats[teamId]) teamStats[teamId] = { name: teamName, wins: 0, losses: 0, matchesPlayed: 0, players: new Set() };
                        if (teamName) { // Nur updaten, wenn ein Name vorhanden ist
                           teamStats[teamId].name = teamName;
                        } else if (!teamStats[teamId].name) { // Setze Fallback, falls noch kein Name gespeichert wurde
                           teamStats[teamId].name = `Team ID ${teamId}`; // Fallback, falls Name nie kommt
                           console.warn(`[API Uniliga DEBUG] Match ${matchId}, Team ID ${teamId}: Missing team nickname from API. Using fallback name.`);
                        }

                        // Zählung korrigiert, um pro Match nur einmal zu zählen
                        // Wird später beim Aggregieren der Teams finalisiert
                        teamStats[teamId].matchesPlayed += 1 / roundData.teams.length; // Teile durch Anzahl Teams im Match (meist 2)
                        const isWinner = teamId === winningTeamId;
                         if (winningTeamId) { // Nur zählen wenn es einen Gewinner gab
                             if (isWinner) teamStats[teamId].wins += 1 / roundData.teams.length;
                             else teamStats[teamId].losses += 1 / roundData.teams.length;
                         }

                        for (const player of team.players) {
                            const playerId = player.player_id;
                            const playerStats = player.player_stats;
                            if (!playerStats || Object.keys(playerStats).length === 0) {
                                console.warn(`[API Uniliga DEBUG] Skipping Player ${playerId} (${player.nickname}) in Match ${matchId}: Missing or empty player_stats.`);
                                continue;
                            }
                            if (!playerDetails[playerId]) playerDetails[playerId] = { nickname: player.nickname, avatar: player.avatar || 'default_avatar.png' };
                            else {
                                playerDetails[playerId].nickname = player.nickname;
                                if (player.avatar) playerDetails[playerId].avatar = player.avatar;
                                if (!playerDetails[playerId].avatar) playerDetails[playerId].avatar = 'default_avatar.png';
                            }
                            teamStats[teamId].players.add(playerId);
                            if (!playerMatchStats[playerId]) playerMatchStats[playerId] = [];
                            playerMatchStats[playerId].push({
                                Kills: +(playerStats["Kills"] ?? 0), Deaths: +(playerStats["Deaths"] ?? 0),
                                Assists: +(playerStats["Assists"] ?? 0), Headshots: +(playerStats["Headshots"] ?? 0),
                                KR_Ratio: +(playerStats["K/R Ratio"] ?? 0), // Keep K/R if needed by calc
                                KD_Ratio: +(playerStats["K/D Ratio"] ?? 0), // Keep K/D if needed by calc
                                ADR: +(playerStats["ADR"] ?? playerStats["Average Damage per Round"] ?? 0),
                                Rounds: matchRounds, Win: winningTeamId ? (isWinner ? 1 : 0) : 0, MatchId: matchId
                            });
                        }
                    }
                    return true;
                } catch (matchError) {
                    console.error(`[API Uniliga DEBUG] Error processing Match ${matchId}: ${matchError.message}`);
                    skippedMatchCount++;
                    return null;
                }
            });
            await Promise.all(batchPromises);
        }
        console.log(`[API Uniliga DEBUG] Finished processing details. Processed: ${processedMatchCount}, Skipped: ${skippedMatchCount}, Total Found: ${allMatches.length}`);

        // c) Spielerstatistiken aggregieren
        console.log("[API Uniliga] Aggregating player statistics...");
        const aggregatedPlayerStats = {};
        for (const playerId in playerMatchStats) {
            const matchCount = playerMatchStats[playerId].length;
            // console.log(`[API Uniliga DEBUG] Calculating stats for Player ${playerId} (${playerDetails[playerId]?.nickname ?? 'Unknown Nickname'}) based on ${matchCount} valid matches found.`);
            const calculatedStats = calculateAverageStats(playerMatchStats[playerId]); // Uses central function
            if (calculatedStats && calculatedStats.matchesPlayed > 0) {
                aggregatedPlayerStats[playerId] = {
                    ...playerDetails[playerId],
                    ...calculatedStats
                };
                // Optional: Konsistenzcheck
                // if (calculatedStats.matchesPlayed !== matchCount) { console.error(`[API Uniliga DEBUG] Mismatch for ${playerId}: Found ${matchCount} matches, calc has ${calculatedStats.matchesPlayed}`); }
            } else {
                console.warn(`[API Uniliga DEBUG] Stats calculation returned null or 0 matches for Player ${playerId} (${playerDetails[playerId]?.nickname ?? 'Unknown Nickname'}) with ${matchCount} raw matches found.`);
            }
        }
        const sortedPlayerStats = Object.values(aggregatedPlayerStats).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

        // d) Teamstatistiken aggregieren
        console.log("[API Uniliga] Aggregating team statistics...");
        const aggregatedTeamStats = {};
        for (const teamId in teamStats) {
            const team = teamStats[teamId]; // team object from intermediate aggregation

            // +++ NEUES LOGGING (2): Logge das Team-Objekt VOR der Finalisierung +++
            console.log(`[API Uniliga DEBUG] Aggregating final stats for Team ID: ${teamId}, Intermediate Data:`, JSON.stringify(team, null, 2));

            // Runde die geteilten Werte auf ganze Zahlen
            const matchesPlayedCorrected = Math.round(team.matchesPlayed * 2); // Korrektur: Multipliziere mit 2, da durch 2 geteilt wurde
            const winsCorrected = Math.round(team.wins * 2);
            const lossesCorrected = Math.round(team.losses * 2);
            const winRate = matchesPlayedCorrected > 0 ? (winsCorrected / matchesPlayedCorrected) * 100 : 0;

            let avgTeamRating = 0; let playerCount = 0;
            team.players.forEach(playerId => {
                if (aggregatedPlayerStats[playerId]?.rating) {
                    avgTeamRating += aggregatedPlayerStats[playerId].rating;
                    playerCount++;
                }
            });
            avgTeamRating = playerCount > 0 ? avgTeamRating / playerCount : 0;

            // Erstelle das finale Objekt für die Antwort
            aggregatedTeamStats[teamId] = {
                 id: teamId,
                 name: team.name, // Hole den Namen aus dem zwischengespeicherten Objekt
                 matchesPlayed: matchesPlayedCorrected,
                 wins: winsCorrected,
                 losses: lossesCorrected,
                 winRate: +winRate.toFixed(1),
                 avgRating: +avgTeamRating.toFixed(2),
                 // points: team.points // Füge Punkte hinzu, sobald die Logik dafür da ist
             };

             // +++ NEUES LOGGING (3): Logge das finale Objekt für dieses Team +++
             console.log(`[API Uniliga DEBUG] Final object for Team ID ${teamId}:`, JSON.stringify(aggregatedTeamStats[teamId], null, 2));
         }
        // Sortiere Teams (hier nach alter Logik Winrate/Rating, später ggf. nach Punkten)
        const sortedTeamStats = Object.values(aggregatedTeamStats).sort((a, b) => {
            const wrDiff = (b.winRate ?? 0) - (a.winRate ?? 0);
            if (wrDiff !== 0) return wrDiff;
            return (b.avgRating ?? 0) - (a.avgRating ?? 0);
        });

        // e) Finale Antwort vorbereiten
        const responseData = {
            version: CACHE_VERSION,
            lastUpdated: new Date().toISOString(),
            championshipId: championshipId,
            players: sortedPlayerStats,
            teams: sortedTeamStats // Enthält jetzt hoffentlich die Namen
        };

        // f) Im Cache speichern
        if (redis && redis.status === 'ready') {
            try {
                await redis.set(cacheKey, JSON.stringify(responseData), "EX", CACHE_TTL_SECONDS);
                console.log(`[API Uniliga] Stored aggregated stats in Redis (Key: ${cacheKey}).`);
            } catch (err) { console.error("[API Uniliga] Redis SET error:", err); }
        }

        // g) Senden
        console.log("[API Uniliga] Sending freshly calculated data.");
        res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
        return res.status(200).json(responseData);

    } catch (error) {
        console.error("[API Uniliga] Unhandled error in handler:", error);
        return res.status(500).json({ error: "Fehler beim Verarbeiten der Uniliga-Daten.", details: error.message });
    }
}