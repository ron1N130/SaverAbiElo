// api/uniliga-stats.js - Finale Version mit Bo2-Punkten (2-1-0) & Verarbeitung beider Maps

// --- Imports ---
import Redis from "ioredis";
import { calculateAverageStats } from './utils/stats.js'; // Pfad prüfen!
import fs from 'fs';
import path from 'path';

console.log('[API Uniliga - Punkte Final V5] Modul Imports geladen.'); // Log version updated again for debugging

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const UNILIGA_CHAMPIONSHIP_ID = "385c17da-3fe3-4b94-9c98-8686d66281df";
const CACHE_VERSION = 14; // Version erhöht für Debugging-Logs
const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 Stunden
const API_DELAY = 500;
const MATCH_DETAIL_BATCH_SIZE = 10;
const MAX_MATCHES_TO_FETCH = 500;

console.log('[API Uniliga - Punkte Final V5] Konstanten definiert.');

// --- Hilfsfunktionen (delay, fetchFaceitApi) ---
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchFaceitApi(endpoint, retries = 3) {
    await delay(API_DELAY);
    const url = `${API_BASE_URL}${endpoint}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}`, 'Accept': 'application/json' } });
        if (res.status === 429) { console.warn(`[API Uniliga] Rate limit hit (429)`); await delay(API_DELAY * 15); if (retries > 0) return fetchFaceitApi(endpoint, retries - 1); else throw new Error(`API Rate limit exceeded`); }
        if (res.status === 401) throw new Error(`API Authentication failed (401)`);
        if (res.status === 404) { console.warn(`[API Uniliga] Not found (404) for ${endpoint}.`); return null; }
        if (!res.ok) { const errBody = await res.text(); throw new Error(`API request failed ${endpoint} (${res.status}): ${errBody}`); }
        return await res.json();
    } catch (error) { console.error(`[API Uniliga] Fetch error for ${endpoint}: ${error.message}`); if (retries > 0) { await delay(API_DELAY * (5 - retries + 1)); return fetchFaceitApi(endpoint, retries - 1); } else throw error; }
}

console.log('[API Uniliga - Punkte Final V5] Hilfsfunktionen definiert.');

// --- Redis‑Initialisierung ---
let redis = null;
if (REDIS_URL) { try { redis = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 10000, maxRetriesPerRequest: 2, showFriendlyErrorStack: true }); redis.on("error", (err) => { console.error("[Redis Uniliga] Connection error:", err.message); redis = null; }); console.log("[Redis Uniliga] Client initialized."); } catch (e) { console.error("[Redis Uniliga] Initialization failed:", e); redis = null; } }
else { console.warn("[Redis Uniliga] REDIS_URL not set."); }

// --- Lade Team-Informationen aus JSON ---
let teamInfoMap = {}; let jsonLoadError = null; let calculatedJsonPath = "[Nicht berechnet]";
try {
    const jsonPath = path.join(__dirname, '..', "uniliga_teams.json"); calculatedJsonPath = jsonPath;
    console.log(`[API Uniliga] Attempting to load JSON from: ${jsonPath}`);
    if (!fs.existsSync(jsonPath)) { throw new Error(`File not found at path: ${jsonPath}.`); }
    const fileContent = fs.readFileSync(jsonPath, 'utf-8'); const teamsData = JSON.parse(fileContent);
    teamsData.forEach(team => { if (team.team_id && team.name) { teamInfoMap[team.team_id] = { name: team.name, icon: team.icon }; } });
    console.log(`[API Uniliga] Created teamInfoMap with ${Object.keys(teamInfoMap).length} teams.`);
} catch (e) { console.error(`[API Uniliga CRITICAL] Failed to load/parse JSON from '${calculatedJsonPath}':`, e); jsonLoadError = e; teamInfoMap = {}; }

console.log('[API Uniliga - Punkte Final V5] Modul-Setup abgeschlossen.');

// --- Haupt‑Handler ---
export default async function handler(req, res) {
    console.log(`[API Uniliga - Punkte Final V5] Handler invoked. URL: ${req.url}`);
    if (jsonLoadError) { console.error("[API Uniliga] JSON Load Error detected."); } else { console.log(`[API Uniliga] Handler using teamInfoMap size: ${Object.keys(teamInfoMap).length}`); }

    const championshipId = UNILIGA_CHAMPIONSHIP_ID;
    // Update cache key to reflect the new cache version
    const cacheKey = `uniliga_stats:${championshipId}_v${CACHE_VERSION}`;

    // 1. Cache prüfen
    if (!req.url.includes('noCache=true') && redis && (redis.status === 'ready' || redis.status === 'connecting')) {
        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) { console.log(`[API Uniliga] Cache HIT.`); return res.status(200).json(JSON.parse(cachedData)); }
            else { console.log("[API Uniliga] Cache MISS."); res.setHeader("X-Cache-Status", "MISS"); }
        } catch (err) { console.error("[API Uniliga] Redis GET error:", err); res.setHeader("X-Cache-Status", "ERROR"); }
    } else { res.setHeader("X-Cache-Status", "SKIPPED"); }

    // 2. Live-Daten holen und verarbeiten
    try {
        console.log(`[API Uniliga] Fetching live data...`);
        let allMatches = []; let offset = 0; const limit = 100; let fetchMore = true;
        // Matchliste holen
        while (fetchMore && allMatches.length < MAX_MATCHES_TO_FETCH) {
            const endpoint = `/championships/${championshipId}/matches?type=past&offset=${offset}&limit=${limit}`;
            const matchResponse = await fetchFaceitApi(endpoint);
            // console.log(`[API Uniliga DEBUG] Raw response for ${endpoint}: ${JSON.stringify(matchResponse)?.substring(0, 300)}`); // Optional: Log für Matchliste
            if (!matchResponse?.items?.length) { fetchMore = false; }
            else { allMatches.push(...matchResponse.items); offset += matchResponse.items.length; if (matchResponse.items.length < limit || allMatches.length >= MAX_MATCHES_TO_FETCH) fetchMore = false; }
        }
        console.log(`[API Uniliga] Total matches found: ${allMatches.length}. Fetching details...`);

        // Datenstrukturen initialisieren
        const playerMatchStats = {};
        const teamStats = {}; // Will now also store match win/loss/draw counts
        const playerDetails = {};
        let processedMatchCount = 0;
        let skippedMatchCount = 0;
        let processedMapCount = 0;

        // Batches von Match-Details verarbeiten
        for (let i = 0; i < allMatches.length; i += MATCH_DETAIL_BATCH_SIZE) {
            const batchMatchIds = allMatches.slice(i, i + MATCH_DETAIL_BATCH_SIZE).map(m => m.match_id);
            const batchPromises = batchMatchIds.map(async (matchId) => { // Start Verarbeitung pro Match-ID
                try {
                    const stats = await fetchFaceitApi(`/matches/${matchId}/stats`);
                    // Add logging to see the full stats object for a match
                    // console.log(`[API Uniliga DEBUG] Full stats for Match ${matchId}:`, JSON.stringify(stats, null, 2));

                    const rounds = stats?.rounds; // Das Array der Karten für dieses Match
                    const roundsFound = rounds?.length ?? 0;

                    // Überspringe Match, wenn keine gültigen Rundendaten gefunden wurden
                    if (roundsFound === 0 || !Array.isArray(rounds)) {
                        console.warn(`[API Uniliga WARN] Skipping Match ${matchId}: No rounds array found or empty.`);
                        skippedMatchCount++;
                        return null;
                    }
                    processedMatchCount++; // Zähle verarbeitete Begegnungen

                    // --- Punkteberechnung für die gesamte Begegnung (matchId) ---
                    let teamId1 = null,
                        teamId2 = null;
                    let team1MapWins = 0,
                        team2MapWins = 0;
                    let teamIdsValidForPoints = false;
                    // Finde die beiden Team-IDs aus der ersten Karte
                    if (rounds[0]?.teams?.length === 2) {
                        teamId1 = rounds[0].teams[0]?.team_id;
                        teamId2 = rounds[0].teams[1]?.team_id;
                        if (teamId1 && teamId2) teamIdsValidForPoints = true;
                    }
                    // Zähle Kartensiege, wenn Teams gültig sind
                    if (teamIdsValidForPoints) {
                        for (const roundDataForPoints of rounds) { // Iteriere über die Karten NUR zum Zählen der Siege
                            const winnerMap = roundDataForPoints?.round_stats?.["Winner"];
                            // Add logging for each map winner
                            // console.log(`[API Uniliga DEBUG] Match ${matchId}, Map: Winner = ${winnerMap}`);
                            if (winnerMap === teamId1) team1MapWins++;
                            else if (winnerMap === teamId2) team2MapWins++;
                        }

                        // Add logging here to see map win counts per match
                        console.log(`[API Uniliga DEBUG] Match ${matchId}: Team1 Map Wins = ${team1MapWins}, Team2 Map Wins = ${team2MapWins}`);

                        // Punkte basierend auf Kartensiegen vergeben (Best of 2 Uniliga System - 2 für Sieg, 1 für Unentschieden)
                        let pointsTeam1 = 0,
                            pointsTeam2 = 0;
                        if (team1MapWins > team2MapWins) { // Team 1 hat mehr Karten gewonnen (muss 2-0 in Bo2 sein)
                            pointsTeam1 = 2; // 2 Punkte für den Sieger (korrigiert)
                            pointsTeam2 = 0; // 0 Punkte für den Verlierer
                        } else if (team2MapWins > team1MapWins) { // Team 2 hat mehr Karten gewonnen (muss 0-2 in Bo2 sein)
                            pointsTeam1 = 0; // 0 Punkte für den Verlierer
                            pointsTeam2 = 2; // 2 Punkte für den Sieger (korrigiert)
                        } else { // Karten sind gleich (muss 1-1 in Bo2 sein)
                            pointsTeam1 = 1; // 1 Punkt für beide Teams
                            pointsTeam2 = 1;
                        }

                        // Add logging here to see points awarded per match
                        console.log(`[API Uniliga DEBUG] Match ${matchId}: Points Team1 = ${pointsTeam1}, Points Team2 = ${pointsTeam2}`);


                        // Initialisiere Team-Stats (inkl. Punkte & Match-Outcome Felder) sicher, falls noch nicht geschehen
                        if (!teamStats[teamId1]) teamStats[teamId1] = { name: "TBD", mapWins: 0, mapLosses: 0, mapsPlayed: 0, points: 0, matchWins: 0, matchLosses: 0, matchDraws: 0, matchesPlayed: 0, players: new Set() };
                        if (!teamStats[teamId2]) teamStats[teamId2] = { name: "TBD", mapWins: 0, mapLosses: 0, mapsPlayed: 0, points: 0, matchWins: 0, matchLosses: 0, matchDraws: 0, matchesPlayed: 0, players: new Set() };

                        // Addiere Punkte zum Gesamtpunktestand des Teams
                        teamStats[teamId1].points = (teamStats[teamId1].points || 0) + pointsTeam1;
                        teamStats[teamId2].points = (teamStats[teamId2].points || 0) + pointsTeam2;

                        // Track match outcomes based on points (2 for win, 1 for draw, 0 for loss)
                        teamStats[teamId1].matchesPlayed++;
                        teamStats[teamId2].matchesPlayed++;

                        if (pointsTeam1 === 2) { // Team 1 won the match (2-0)
                            teamStats[teamId1].matchWins++;
                            teamStats[teamId2].matchLosses++;
                        } else if (pointsTeam2 === 2) { // Team 2 won the match (2-0)
                            teamStats[teamId2].matchWins++;
                            teamStats[teamId1].matchLosses++;
                        } else if (pointsTeam1 === 1 && pointsTeam2 === 1) { // Match was a draw (1-1)
                            teamStats[teamId1].matchDraws++;
                            teamStats[teamId2].matchDraws++;
                        }
                    } else {
                        console.warn(`[API Uniliga Punkte WARN] Match ${matchId}: Teams f. Punkte nicht identifiziert.`);
                    }
                    // --- Ende Punkteberechnung und Match-Outcome Tracking ---


                    // --- Verarbeitung der einzelnen Karten für Detail-Statistiken ---
                    // **** HIER IST DIE WICHTIGE SCHLEIFE ****
                    for (const roundData of rounds) {
                        const currentMapIndex = rounds.indexOf(roundData);
                        // Prüfungen für diese spezifische Karte
                        if (!roundData?.teams || roundData.teams.length === 0) { console.warn(`[API Uniliga WARN] Match ${matchId}, Map ${currentMapIndex + 1}: No team data.`); continue; }
                        const winningTeamIdMap = roundData.round_stats?.["Winner"];
                        const mapRoundsPlayed = parseInt(roundData.round_stats?.["Rounds"], 10);
                        if (isNaN(mapRoundsPlayed) || mapRoundsPlayed <= 0) { console.warn(`[API Uniliga WARN] Match ${matchId}, Map ${currentMapIndex + 1}: Invalid rounds (${mapRoundsPlayed}).`); continue; }
                        processedMapCount++; // Zähle erfolgreich verarbeitete Karten

                        // Verarbeite Teams DIESER KARTE
                        for (const team of roundData.teams) {
                            const teamId = team.team_id;
                            if (!teamId) { continue; } // Überspringe Team ohne ID
                            const localTeamInfo = teamInfoMap[teamId];
                            let finalTeamName;
                            // Finde Namen: Priorität hat der schon gesetzte Name (aus Punkteberechnung/vorheriger Karte), dann lokales Mapping, dann Fallback
                            if (teamStats[teamId] && teamStats[teamId].name !== "TBD") { finalTeamName = teamStats[teamId].name; }
                            else if (localTeamInfo) { finalTeamName = localTeamInfo.name; }
                            else { finalTeamName = `Unbekanntes Team (ID: ${teamId.substring(0, 8)}...)`; }

                            // Stelle sicher, dass der Teameintrag existiert (sollte durch Punkteberechnung oben schon passiert sein, aber sicher ist sicher)
                            if (!teamStats[teamId]) { teamStats[teamId] = { name: finalTeamName, mapWins: 0, mapLosses: 0, mapsPlayed: 0, points: 0, matchWins: 0, matchLosses: 0, matchDraws: 0, matchesPlayed: 0, players: new Set() }; }
                             else { teamStats[teamId].name = finalTeamName; teamStats[teamId].points = teamStats[teamId].points || 0; } // Setze Namen und stelle sicher, dass Punkte nicht überschrieben werden


                            // Zähle Karten-Ergebnisse für dieses Team (Diese Zählungen werden für die Map-Stats beibehalten, aber die Team-Tabelle im Frontend nutzt jetzt Match-Stats)
                             teamStats[teamId].mapsPlayed += 1 / roundData.teams.length; // Normalerweise +0.5
                             const isWinnerThisMap = teamId === winningTeamIdMap;
                             if (winningTeamIdMap) { if (isWinnerThisMap) teamStats[teamId].mapWins += 1 / roundData.teams.length; else teamStats[teamId].mapLosses += 1 / roundData.teams.length; }


                            // Verarbeite Spieler DIESER KARTE
                            for (const player of team.players) {
                               const playerId = player.player_id; const playerStats = player.player_stats;
                               if (!playerId || !playerStats || Object.keys(playerStats).length === 0) { continue; } // Überspringe ungültige Spielerdaten
                               if (!playerDetails[playerId]) playerDetails[playerId] = { nickname: player.nickname || '?', avatar: player.avatar || 'default_avatar.png' }; // Initialisiere Spielerdetails
                               teamStats[teamId].players.add(playerId); // Füge Spieler zum Set hinzu
                               if (!playerMatchStats[playerId]) playerMatchStats[playerId] = []; // Initialisiere Spieler-Stat-Array

                               // Sammle Stats für diese Karte
                               const mapStatData = { Kills: +(playerStats["Kills"] ?? 0), Deaths: +(playerStats["Deaths"] ?? 0), Assists: +(playerStats["Assists"] ?? 0), Headshots: +(playerStats["Headshots"] ?? 0), KR_Ratio: +(playerStats["K/R Ratio"] ?? 0), KD_Ratio: +(playerStats["K/D Ratio"] ?? 0), ADR: +(playerStats["ADR"] ?? playerStats["Average Damage per Round"] ?? 0), Rounds: mapRoundsPlayed, Win: winningTeamIdMap ? (isWinnerThisMap ? 1 : 0) : 0, MatchId: matchId, MapNumber: currentMapIndex + 1 };
                               playerMatchStats[playerId].push(mapStatData); // Füge Karten-Stats hinzu
                            } // Ende Spieler-Schleife
                        } // Ende Team-Schleife (pro Karte)
                    } // Ende Runden/Karten-Schleife <<<< HIER IST DIE KORREKTE SCHLEIFE
                    return true; // Match-ID erfolgreich verarbeitet
                } catch (matchError) { console.error(`[API Uniliga ERROR] Processing Match ${matchId}: ${matchError.message}`); skippedMatchCount++; return null; }
            }); // Ende batchPromises.map
            await Promise.all(batchPromises);
        } // Ende Batch-Schleife (über Match-IDs)
        console.log(`[API Uniliga] Finished processing details. Encounters: ${processedMatchCount}, Maps: ${processedMapCount}, Skipped: ${skippedMatchCount}`);

        // c) Spielerstatistiken aggregieren
        console.log("[API Uniliga] Aggregating player statistics...");
        const aggregatedPlayerStats = {};
        for (const playerId in playerMatchStats) {
            const calculatedStats = calculateAverageStats(playerMatchStats[playerId]);
            if (calculatedStats && calculatedStats.matchesPlayed > 0) {
                aggregatedPlayerStats[playerId] = { ...playerDetails[playerId], ...calculatedStats };
            } else { console.warn(`[API Uniliga WARN] calculateAverageStats returned null/0 matches for player ${playerId}`); }
        }
        const sortedPlayerStats = Object.values(aggregatedPlayerStats).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

        // d) Teamstatistiken finalisieren (mit Punkten und Match-Outcomes)
        console.log("[API Uniliga] Aggregating final team statistics...");
        const aggregatedTeamStats = {};
        for (const teamId in teamStats) {
             const team = teamStats[teamId];
             // Correct map counts (still calculated based on 0.5 per map)
             const mapsPlayedCorrected = Math.round(team.mapsPlayed * 2);
             const mapWinsCorrected = Math.round(team.mapWins * 2);
             const mapLossesCorrected = Math.round(team.mapLosses * 2);
             const mapWinRate = mapsPlayedCorrected > 0 ? (mapWinsCorrected / mapsPlayedCorrected) * 100 : 0;

             // Use the collected match stats directly
             const totalMatchesPlayed = team.matchesPlayed || 0;
             const totalMatchWins = team.matchWins || 0;
             const totalMatchLosses = team.matchLosses || 0;
             const totalMatchDraws = team.matchDraws || 0;
             // Match win rate is based on (Wins + 0.5 * Draws) / Total Matches, or simply Wins / Total Matches depending on definition. Let's use Wins / Total Matches for simplicity in the table header context (S, U, N).
             const matchWinPercentage = totalMatchesPlayed > 0 ? (totalMatchWins / totalMatchesPlayed) * 100 : 0;


             let avgTeamRating = 0; let playerCount = 0;
             team.players.forEach(playerId => { if (aggregatedPlayerStats[playerId]?.rating) { avgTeamRating += aggregatedPlayerStats[playerId].rating; playerCount++; } });
             avgTeamRating = playerCount > 0 ? avgTeamRating / playerCount : 0;

             aggregatedTeamStats[teamId] = {
                  id: teamId, name: team.name,
                  // Map stats (if needed elsewhere)
                  mapsPlayed: mapsPlayedCorrected, mapWins: mapWinsCorrected, mapLosses: mapLossesCorrected,
                  mapWinRate: +mapWinRate.toFixed(1), // Keep map win rate if needed
                  // Match stats for the table
                  matchesPlayed: totalMatchesPlayed,
                  matchWins: totalMatchWins,
                  matchLosses: totalMatchLosses,
                  matchDraws: totalMatchDraws,
                  matchWinRate: +matchWinPercentage.toFixed(1), // Use calculated match win percentage
                  avgRating: +avgTeamRating.toFixed(2),
                  points: team.points || 0 // Punkte
             };
         }
        // Sortiere Teams: Punkte > Match-Siege > Unentschieden > AvgRating
         const sortedTeamStats = Object.values(aggregatedTeamStats).sort((a, b) => {
             const pointsDiff = (b.points ?? 0) - (a.points ?? 0); if (pointsDiff !== 0) return pointsDiff;
             const winsDiff = (b.matchWins ?? 0) - (a.matchWins ?? 0); // Priorisiere Match-Siege
             if (winsDiff !== 0) return winsDiff;
             const drawsDiff = (b.matchDraws ?? 0) - (a.matchDraws ?? 0); // Dann Unentschieden
             if (drawsDiff !== 0) return drawsDiff;
             return (b.avgRating ?? 0) - (a.avgRating ?? 0); // Schließlich durchschnittliches Rating als Tie-Breaker
          });

         // +++ Logging vor Response +++
         console.log(`[API Uniliga DEBUG] Final sortedPlayerStats length = ${sortedPlayerStats?.length}`);
         console.log(`[API Uniliga DEBUG] Final sortedTeamStats length = ${sortedTeamStats?.length}`);
         // Log final team stats before sending
         console.log(`[API Uniliga DEBUG] Final sortedTeamStats:`, JSON.stringify(sortedTeamStats, null, 2));
         // +++ Ende Logging +++

        // e) Finale Antwort vorbereiten
        const responseData = {
            version: CACHE_VERSION, lastUpdated: new Date().toISOString(), championshipId: championshipId,
            players: sortedPlayerStats,
            teams: sortedTeamStats // Enthält jetzt .points, .matchesPlayed, .matchWins, .matchLosses, .matchDraws
        };

        // f) Im Cache speichern
        if (redis && (redis.status === 'ready' || redis.status === 'connecting')) { try { await redis.set(cacheKey, JSON.stringify(responseData), "EX", CACHE_TTL_SECONDS); console.log(`[API Uniliga] Stored stats in Redis.`); } catch (err) { console.error("[API Uniliga] Redis SET error:", err); } }

        // g) Erfolgreiche Antwort senden
        console.log("[API Uniliga] Sending calculated data.");
        res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
        return res.status(200).json(responseData);

    } catch (error) {
        console.error("[API Uniliga CRITICAL] Unhandled error in handler:", error);
        return res.status(500).json({ error: "Fehler beim Verarbeiten der Uniliga-Daten.", details: error.message });
    }
}

console.log('[API Uniliga - Punkte Final V5] Modul Ende erreicht.');