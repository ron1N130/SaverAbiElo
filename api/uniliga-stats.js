// api/uniliga-stats.js - Refactored mit ID-basiertem Teamnamen-Mapping
// -------------------------------------------------
// ◼ Nutzt zentrale Statistik-Berechnung aus /api/utils/stats.js
// ◼ Lädt Teamnamen & Icons aus uniliga_teams.json basierend auf team_id
// ◼ Cache Version 7 (oder höher, falls Struktur geändert wurde)
// -------------------------------------------------

import Redis from "ioredis";
import { calculateAverageStats } from './utils/stats.js'; // Pfad prüfen!
import fs from 'fs'; // Hinzugefügt für Dateizugriff
import { fileURLToPath } from 'url';
import path from 'path'; // Hinzugefügt für Pfadverwaltung

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const UNILIGA_CHAMPIONSHIP_ID = "c1fcd6a9-34ef-4e18-8e92-b57af0667a40"; // Deine Turnier-ID
const CACHE_VERSION = 7; // Behalte Version 7 oder erhöhe bei Bedarf
const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 Stunden
const API_DELAY = 500; // Verzögerung zwischen API-Aufrufen
const MATCH_DETAIL_BATCH_SIZE = 10; // Anzahl der Match-Details pro Batch-Abfrage
const MAX_MATCHES_TO_FETCH = 500; // Maximale Anzahl Matches, die für die Statistik geholt werden

// --- Hilfsfunktionen ---
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchFaceitApi(endpoint, retries = 3) {
    await delay(API_DELAY);
    const url = `${API_BASE_URL}${endpoint}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}`, 'Accept': 'application/json' } });
        if (res.status === 429) {
            console.warn(`[API Uniliga] Rate limit hit (429) for ${endpoint} – sleeping...`);
            await delay(API_DELAY * 15); // Längere Pause bei Rate Limit
            if (retries > 0) return fetchFaceitApi(endpoint, retries - 1);
            else throw new Error(`API Rate limit exceeded for ${endpoint}`);
        }
        if (res.status === 401) throw new Error(`API Authentication failed (401)`);
        if (res.status === 404) { console.warn(`[API Uniliga] Not found (404) for ${endpoint}.`); return null; }
        if (!res.ok) { const errBody = await res.text(); throw new Error(`API request failed ${endpoint} (${res.status}): ${errBody}`); }
        return await res.json();
    } catch (error) {
        console.error(`[API Uniliga] Fetch error for ${endpoint}: ${error.message}`);
        if (retries > 0) { await delay(API_DELAY * (5 - retries + 1)); return fetchFaceitApi(endpoint, retries - 1); } // Retry mit Backoff
        else throw error; // Nach Retries Fehler weitergeben
    }
}

// --- Redis‑Initialisierung ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
             lazyConnect: true,
             connectTimeout: 10000, // 10s
             maxRetriesPerRequest: 2,
             showFriendlyErrorStack: true
            });
        redis.on("error", (err) => { console.error("[Redis Uniliga] Connection error:", err.message); redis = null; });
        console.log("[Redis Uniliga] Client initialized (lazy).");
    } catch (e) { console.error("[Redis Uniliga] Initialization failed:", e); redis = null; }
} else { console.warn("[Redis Uniliga] REDIS_URL not set. Caching disabled."); }

// --- Lade Team-Informationen aus JSON ---
let teamInfoMap = {};
try {
    // --- NEUER PFAD ---
    // Ermittle den Pfad zum aktuellen Skript (__dirname Äquivalent für ES Module)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // Gehe eine Ebene hoch (..) und finde die JSON-Datei
    const jsonPath = path.join(__dirname, '..', "uniliga_teams.json");
    // --- ENDE NEUER PFAD ---

    console.log(`[API Uniliga] Attempting to load JSON from: ${jsonPath}`); // Logge den Pfad zum Debuggen

    const teamsData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    teamsData.forEach(team => {
        if (team.team_id) {
            teamInfoMap[team.team_id] = { name: team.name, icon: team.icon };
        } else {
             console.warn(`[API Uniliga] Team entry missing 'team_id' in uniliga_teams.json: ${team.name}`);
        }
    });
    console.log(`[API Uniliga] Loaded ${Object.keys(teamInfoMap).length} teams with IDs from uniliga_teams.json`);
} catch (e) {
    console.error("[API Uniliga] Failed to load or parse uniliga_teams.json:", e.message);
    // Logge den Fehler detaillierter, falls Pfad falsch ist
    if (e.code === 'ENOENT') {
        console.error(`[API Uniliga] Error details: File not found at path resolved to: ${path.resolve(jsonPath)}`);
    }
    teamInfoMap = {}; // Leere Map als Fallback
}


// --- Haupt‑Handler ---
export default async function handler(req, res) {
    console.log(`[API Uniliga] Received request at ${new Date().toISOString()}`);
    const championshipId = UNILIGA_CHAMPIONSHIP_ID;
    const cacheKey = `uniliga_stats:${championshipId}`;

    // 1. Cache prüfen
    if (redis && (redis.status === 'ready' || redis.status === 'connecting')) { // Prüfen ob bereit oder am Verbinden
        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                const parsedData = JSON.parse(cachedData);
                if (parsedData.version === CACHE_VERSION) {
                    console.log(`[API Uniliga] Cache HIT (v${CACHE_VERSION}). Returning cached data.`);
                    res.setHeader("X-Cache-Status", "HIT");
                    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
                    return res.status(200).json(parsedData);
                } else {
                    console.log(`[API Uniliga] Cache STALE (v${parsedData.version}, expected v${CACHE_VERSION}). Fetching new data.`);
                    res.setHeader("X-Cache-Status", "STALE");
                }
            } else {
                console.log("[API Uniliga] Cache MISS. Fetching new data.");
                res.setHeader("X-Cache-Status", "MISS");
            }
        } catch (err) {
            console.error("[API Uniliga] Redis GET error:", err);
            res.setHeader("X-Cache-Status", "ERROR");
            // Nicht global deaktivieren, weitermachen und neu holen
        }
    } else {
        res.setHeader("X-Cache-Status", redis ? `DISABLED (Status: ${redis.status})` : "DISABLED (No REDIS_URL)");
    }

    // 2. Live-Daten holen und verarbeiten
    try {
        console.log(`[API Uniliga] Fetching matches for championship: ${championshipId}`);
        let allMatches = [];
        let offset = 0;
        const limit = 100; // Standard-Limit für Match-Abfragen
        let fetchMore = true;
        while (fetchMore && allMatches.length < MAX_MATCHES_TO_FETCH) {
            const matchResponse = await fetchFaceitApi(`/championships/${championshipId}/matches?type=past&offset=${offset}&limit=${limit}`);
            if (!matchResponse?.items?.length) {
                fetchMore = false; // Keine weiteren Matches gefunden
            } else {
                allMatches.push(...matchResponse.items);
                offset += matchResponse.items.length;
                // Stoppe, wenn weniger als das Limit zurückkam oder MAX_MATCHES erreicht ist
                if (matchResponse.items.length < limit || allMatches.length >= MAX_MATCHES_TO_FETCH) {
                    fetchMore = false;
                }
            }
        }
        console.log(`[API Uniliga] Total matches found: ${allMatches.length}. Fetching details in batches...`);

        const playerMatchStats = {}; // { playerId: [matchStat1, matchStat2, ...] }
        const teamStats = {};        // { teamId: { name: string, wins: number, losses: number, matchesPlayed: number, players: Set } }
        const playerDetails = {};    // { playerId: { nickname: string, avatar: string } }
        let processedMatchCount = 0;
        let skippedMatchCount = 0;

        // Match-Details in Batches holen und verarbeiten
        for (let i = 0; i < allMatches.length; i += MATCH_DETAIL_BATCH_SIZE) {
            const batchMatchIds = allMatches.slice(i, i + MATCH_DETAIL_BATCH_SIZE).map(m => m.match_id);
            const batchPromises = batchMatchIds.map(async (matchId) => {
                try {
                    const stats = await fetchFaceitApi(`/matches/${matchId}/stats`);
                    // Überprüfe, ob die notwendigen Daten vorhanden sind
                    if (!stats?.rounds?.[0]?.teams || stats.rounds[0].teams.length === 0) {
                        console.warn(`[API Uniliga DEBUG] Skipping Match ${matchId}: No stats.rounds[0].teams found or teams array empty.`);
                        skippedMatchCount++; return null; // Nächstes Promise im Batch
                    }
                    const roundData = stats.rounds[0];
                    const winningTeamId = roundData.round_stats?.["Winner"];
                    const matchRounds = parseInt(roundData.round_stats?.["Rounds"], 10);
                    if (isNaN(matchRounds) || matchRounds <= 0) {
                        console.warn(`[API Uniliga DEBUG] Skipping Match ${matchId}: Invalid or zero rounds (${roundData.round_stats?.["Rounds"]}).`);
                        skippedMatchCount++; return null; // Nächstes Promise im Batch
                    }
                    processedMatchCount++;

                    for (const team of roundData.teams) {
                        const teamId = team.team_id; // Team-ID aus der API
                        const apiTeamName = team.nickname; // Teamname aus der API (für Logs/Fallback)
                        const localTeamInfo = teamInfoMap[teamId]; // Suche in der geladenen JSON-Map

                        let finalTeamName;
                        if (localTeamInfo) {
                            finalTeamName = localTeamInfo.name; // Nutze den Namen aus deiner JSON
                            // Optional: Logge nur, wenn API-Name abweicht
                            // if (apiTeamName !== finalTeamName) {
                            //     console.log(`[API Uniliga DEBUG] Match ${matchId}, Team ID ${teamId}: Mapped to local name '${finalTeamName}' (API was '${apiTeamName}')`);
                            // }
                        } else {
                            // Fallback, wenn Team-ID nicht in deiner JSON gefunden wurde
                            finalTeamName = apiTeamName || `Team ID ${teamId}`; // Nimm API-Namen oder generiere Fallback
                            console.warn(`[API Uniliga WARN] Team ID ${teamId} not found in uniliga_teams.json. Using fallback name: '${finalTeamName}'`);
                        }

                        // Initialisiere oder aktualisiere Team-Statistiken mit dem finalen Namen
                        if (!teamStats[teamId]) {
                            teamStats[teamId] = { name: finalTeamName, wins: 0, losses: 0, matchesPlayed: 0, players: new Set() };
                        } else {
                            // Stelle sicher, dass der Name aktuell ist (falls vorher nur Fallback verwendet wurde)
                            teamStats[teamId].name = finalTeamName;
                        }

                        // Korrigierte Zählung für Siege/Niederlagen/gespielte Matches
                        // Teile durch Anzahl der Teams im Match (normalerweise 2), um doppeltes Zählen zu vermeiden
                        teamStats[teamId].matchesPlayed += 1 / roundData.teams.length;
                        const isWinner = teamId === winningTeamId;
                         if (winningTeamId) { // Nur zählen, wenn es einen Gewinner gab
                             if (isWinner) teamStats[teamId].wins += 1 / roundData.teams.length;
                             else teamStats[teamId].losses += 1 / roundData.teams.length;
                         }

                        // Spielerdaten für dieses Team verarbeiten
                        for (const player of team.players) {
                            const playerId = player.player_id;
                            const playerStats = player.player_stats;
                            if (!playerStats || Object.keys(playerStats).length === 0) {
                                console.warn(`[API Uniliga DEBUG] Skipping Player ${playerId} (${player.nickname}) in Match ${matchId}: Missing or empty player_stats.`);
                                continue; // Nächster Spieler
                            }

                            // Spielerdetails speichern/aktualisieren
                            if (!playerDetails[playerId]) {
                                playerDetails[playerId] = { nickname: player.nickname, avatar: player.avatar || 'default_avatar.png' };
                            } else {
                                // Update Nickname/Avatar, falls geändert
                                playerDetails[playerId].nickname = player.nickname;
                                if (player.avatar) playerDetails[playerId].avatar = player.avatar;
                            }
                            teamStats[teamId].players.add(playerId); // Spieler zum Team-Set hinzufügen

                            // Match-Statistiken für diesen Spieler sammeln
                            if (!playerMatchStats[playerId]) playerMatchStats[playerId] = [];
                            playerMatchStats[playerId].push({
                                Kills: +(playerStats["Kills"] ?? 0),
                                Deaths: +(playerStats["Deaths"] ?? 0),
                                Assists: +(playerStats["Assists"] ?? 0),
                                Headshots: +(playerStats["Headshots"] ?? 0),
                                KR_Ratio: +(playerStats["K/R Ratio"] ?? 0), // Behalten, falls von calculateAverageStats benötigt
                                KD_Ratio: +(playerStats["K/D Ratio"] ?? 0), // Behalten, falls benötigt
                                ADR: +(playerStats["ADR"] ?? playerStats["Average Damage per Round"] ?? 0),
                                Rounds: matchRounds,
                                Win: winningTeamId ? (isWinner ? 1 : 0) : 0, // 1 für Sieg, 0 sonst
                                MatchId: matchId // Optional für Debugging
                            });
                        } // Ende Spieler-Schleife
                    } // Ende Team-Schleife
                    return true; // Match erfolgreich verarbeitet
                } catch (matchError) {
                    console.error(`[API Uniliga DEBUG] Error processing Match ${matchId}: ${matchError.message}`);
                    skippedMatchCount++;
                    return null; // Fehler beim Verarbeiten dieses Matches
                }
            }); // Ende batchPromises.map
            await Promise.all(batchPromises); // Warte auf alle Promises im aktuellen Batch
            console.log(`[API Uniliga] Processed batch ending at index ${i + MATCH_DETAIL_BATCH_SIZE -1}. Current total processed: ${processedMatchCount}`);
        } // Ende Batch-Schleife

        console.log(`[API Uniliga DEBUG] Finished processing details. Successfully processed: ${processedMatchCount}, Skipped due to errors/missing data: ${skippedMatchCount}, Total matches initially found: ${allMatches.length}`);

        // c) Spielerstatistiken aggregieren (nutzt zentrale Funktion)
        console.log("[API Uniliga] Aggregating player statistics...");
        const aggregatedPlayerStats = {};
        for (const playerId in playerMatchStats) {
            const playerMatches = playerMatchStats[playerId];
            // Rufe die zentrale Berechnungsfunktion auf
            const calculatedStats = calculateAverageStats(playerMatches); // Nimmt Array von Match-Stats
            if (calculatedStats && calculatedStats.matchesPlayed > 0) {
                aggregatedPlayerStats[playerId] = {
                    ...playerDetails[playerId], // Füge Nickname und Avatar hinzu
                    ...calculatedStats // Füge berechnete Stats hinzu (rating, kd, adr, etc.)
                };
            } else {
                console.warn(`[API Uniliga DEBUG] Stats calculation returned null or 0 matches for Player ${playerId} (${playerDetails[playerId]?.nickname ?? 'Unknown Nickname'})`);
            }
        }
        // Sortiere Spieler nach Rating (absteigend)
        const sortedPlayerStats = Object.values(aggregatedPlayerStats).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

        // d) Teamstatistiken finalisieren und aggregieren
        console.log("[API Uniliga] Aggregating final team statistics...");
        const aggregatedTeamStats = {};
        for (const teamId in teamStats) {
            const team = teamStats[teamId]; // Enthält jetzt den 'finalTeamName'

             // Runde die geteilten Werte (wins, losses, matchesPlayed) auf ganze Zahlen
             // Multipliziere mit Anzahl Teams pro Match (Annahme: 2), um die Teilung rückgängig zu machen
             const matchesPlayedCorrected = Math.round(team.matchesPlayed * 2);
             const winsCorrected = Math.round(team.wins * 2);
             const lossesCorrected = Math.round(team.losses * 2);
             const winRate = matchesPlayedCorrected > 0 ? (winsCorrected / matchesPlayedCorrected) * 100 : 0;

             // Berechne das durchschnittliche Rating des Teams
             let avgTeamRating = 0;
             let playerCount = 0;
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
                  name: team.name, // <<< Nimmt den finalen Namen aus dem team-Objekt
                  matchesPlayed: matchesPlayedCorrected,
                  wins: winsCorrected,
                  losses: lossesCorrected,
                  winRate: +winRate.toFixed(1),
                  avgRating: +avgTeamRating.toFixed(2),
                  // points: team.points // Hier Punkte hinzufügen, falls sie berechnet/geholt werden
              };
             // console.log(`[API Uniliga DEBUG] Final aggregated team: ID=${teamId}, Name=${aggregatedTeamStats[teamId].name}, Wins=${winsCorrected}, Losses=${lossesCorrected}, Matches=${matchesPlayedCorrected}`);
          }
         // Sortiere Teams: z.B. nach Winrate, dann AvgRating
         const sortedTeamStats = Object.values(aggregatedTeamStats).sort((a, b) => {
             // Optional: Sortiere nach Punkten, falls vorhanden
             // const pointsDiff = (b.points ?? -1) - (a.points ?? -1);
             // if (pointsDiff !== 0) return pointsDiff;

             const wrDiff = (b.winRate ?? 0) - (a.winRate ?? 0);
             if (wrDiff !== 0) return wrDiff;
             return (b.avgRating ?? 0) - (a.avgRating ?? 0); // Sekundär nach Rating
         });

        // e) Finale Antwort vorbereiten
        const responseData = {
            version: CACHE_VERSION,
            lastUpdated: new Date().toISOString(),
            championshipId: championshipId,
            players: sortedPlayerStats, // Bereits sortiert
            teams: sortedTeamStats // Enthält jetzt korrekte Namen und ist sortiert
        };

        // f) Im Cache speichern (wenn Redis verfügbar und verbunden)
        if (redis && (redis.status === 'ready' || redis.status === 'connecting')) {
            try {
                await redis.set(cacheKey, JSON.stringify(responseData), "EX", CACHE_TTL_SECONDS);
                console.log(`[API Uniliga] Stored aggregated stats in Redis (Key: ${cacheKey}, TTL: ${CACHE_TTL_SECONDS}s).`);
            } catch (err) {
                console.error("[API Uniliga] Redis SET error:", err);
                // Fehler beim Schreiben nicht fatal für die Antwort
            }
        }

        // g) Erfolgreiche Antwort senden
        console.log("[API Uniliga] Sending freshly calculated data.");
        res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`); // Cache-Header für Client/CDN
        return res.status(200).json(responseData);

    } catch (error) {
        // Generelle Fehlerbehandlung im Handler
        console.error("[API Uniliga] Unhandled error in handler:", error);
        // Sende generische Fehlermeldung
        return res.status(500).json({
            error: "Fehler beim Verarbeiten der Uniliga-Daten.",
            details: error.message // Füge Fehlerdetails für Debugging hinzu
        });
    } finally {
         // Optional: Redis-Verbindung schließen, wenn nicht persistent gewünscht
         // if (redis && redis.status === 'ready') {
         //     redis.quit();
         // }
    }
}