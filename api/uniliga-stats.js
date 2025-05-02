// api/uniliga-stats.js - Refactored mit Debug Logging
// -------------------------------------------------
// ◼ Nutzt zentrale Statistik-Berechnung aus /api/utils/stats.js
// ◼ Cache Version 7
// -------------------------------------------------

import Redis from "ioredis";
// *** NEU: Importiere Berechnungsfunktionen ***
import { calculateAverageStats } from './utils/stats.js';

// --- Konfiguration & Konstanten ---
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const API_BASE_URL = "https://open.faceit.com/data/v4";
const UNILIGA_CHAMPIONSHIP_ID = "c1fcd6a9-34ef-4e18-8e92-b57af0667a40";
const CACHE_VERSION = 7; // <<<< Cache-Version (ggf. anpassen, falls andere Struktur)
const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 Stunden
const API_DELAY = 500; // Ggf. leicht erhöhen, wenn Rate Limits auftreten (z.B. 600)
const MATCH_DETAIL_BATCH_SIZE = 10;
const MAX_MATCHES_TO_FETCH = 500; // Ausreichend für die meisten Turniere

// --- Hilfsfunktionen ---
/** simple async sleep */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch Faceit API (unverändert zur letzten Version dieser Datei) */
async function fetchFaceitApi(endpoint, retries = 3) {
    await delay(API_DELAY);
    const url = `${API_BASE_URL}${endpoint}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}`, 'Accept': 'application/json' } });
        if (res.status === 429) {
            console.warn(`[API Uniliga] Rate limit hit (429) for ${endpoint} – sleeping...`);
            await delay(API_DELAY * 15); // Länger warten bei Rate Limit
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
        else throw error; // Fehler nach Retries weiterwerfen
    }
}

// --- Redis‑Initialisierung (unverändert) ---
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL, {
            lazyConnect: true,          // Wichtig!
            connectTimeout: 10000,      // 10 Sekunden Timeout
            maxRetriesPerRequest: 2,    // Weniger Retries
            showFriendlyErrorStack: true
        });
        redis.on("error", (err) => { console.error("[Redis Uniliga] Connection error:", err.message); redis = null; }); // Bei Fehler Verbindung als "weg" markieren
        console.log("[Redis Uniliga] Client initialized (lazy).");
    } catch (e) { console.error("[Redis Uniliga] Initialization failed:", e); redis = null; }
} else { console.warn("[Redis Uniliga] REDIS_URL not set. Caching disabled."); }


// --- Haupt‑Handler ---
export default async function handler(req, res) {
    console.log(`[API Uniliga] Received request at ${new Date().toISOString()}`);
    const championshipId = UNILIGA_CHAMPIONSHIP_ID;
    const cacheKey = `uniliga_stats:${championshipId}`;

    // 1. Cache prüfen
    if (redis) {
        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                const parsedData = JSON.parse(cachedData);
                if (parsedData.version === CACHE_VERSION) {
                    console.log(`[API Uniliga] Cache HIT (v${CACHE_VERSION}). Returning cached data.`);
                    res.setHeader("X-Cache-Status", "HIT");
                    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`); // Cache im Browser/CDN erlauben
                    return res.status(200).json(parsedData);
                } else { console.log(`[API Uniliga] Cache STALE (v${parsedData.version}, expected v${CACHE_VERSION}).`); res.setHeader("X-Cache-Status", "STALE"); }
            } else { console.log("[API Uniliga] Cache MISS."); res.setHeader("X-Cache-Status", "MISS"); }
        } catch (err) {
            console.error("[API Uniliga] Redis GET error:", err);
            res.setHeader("X-Cache-Status", "ERROR");
            redis = null; // Bei Redis-Fehler Caching für diesen Request deaktivieren
        }
    } else { res.setHeader("X-Cache-Status", "DISABLED"); }

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
                fetchMore = false; // Keine Matches mehr gefunden
            } else {
                allMatches.push(...matchResponse.items);
                offset += matchResponse.items.length; // Inkrementiere um die tatsächliche Anzahl
                if (matchResponse.items.length < limit) {
                    fetchMore = false; // Letzte Seite erreicht
                }
            }
        }
        console.log(`[API Uniliga] Total matches found: ${allMatches.length}. Fetching details...`);

        // b) Match-Details holen und Daten sammeln
        const playerMatchStats = {};
        const teamStats = {};
        const playerDetails = {};
        let processedMatchCount = 0; // Zähler für verarbeitete Matches
        let skippedMatchCount = 0;  // Zähler für übersprungene Matches

        for (let i = 0; i < allMatches.length; i += MATCH_DETAIL_BATCH_SIZE) {
            const batchMatchIds = allMatches.slice(i, i + MATCH_DETAIL_BATCH_SIZE).map(m => m.match_id);
            // DEBUG: Logge die Batch-IDs (optional, kann viele Logs erzeugen)
            // console.log(`[API Uniliga DEBUG] Processing Batch Match IDs: ${batchMatchIds.join(', ')}`);

            const batchPromises = batchMatchIds.map(async (matchId) => {
                 try { // Füge try-catch pro Match hinzu
                    const stats = await fetchFaceitApi(`/matches/${matchId}/stats`);

                    // Striktere Prüfung: Gibt es Runden-Daten UND Team-Daten?
                    if (!stats?.rounds?.[0]?.teams || stats.rounds[0].teams.length === 0) {
                        // DEBUG: Logge übersprungene Matches wegen fehlender Rundendaten/Teams
                        console.warn(`[API Uniliga DEBUG] Skipping Match ${matchId}: No stats.rounds[0].teams found or teams array empty.`);
                        skippedMatchCount++;
                        return null; // Wichtig: Gehe zum nächsten Match
                    }

                    const roundData = stats.rounds[0];
                    const winningTeamId = roundData.round_stats?.["Winner"]; // Kann null sein bei Unentschieden/Abbruch
                    const matchRounds = parseInt(roundData.round_stats?.["Rounds"], 10);

                    // Prüfe ob Rundenanzahl gültig ist
                    if (isNaN(matchRounds) || matchRounds <= 0) {
                        console.warn(`[API Uniliga DEBUG] Skipping Match ${matchId}: Invalid or zero rounds (${roundData.round_stats?.["Rounds"]}).`);
                        skippedMatchCount++;
                        return null;
                    }

                    // DEBUG: Logge erfolgreiche Verarbeitung eines Matches (optional)
                    // console.log(`[API Uniliga DEBUG] Processing stats for Match ${matchId} (${matchRounds} rounds)`);
                    processedMatchCount++; // Erfolgreich verarbeitet bis hierhin

                    for (const team of roundData.teams) {
                        const teamId = team.team_id;
                        const teamName = team.nickname;
                        // Team-Stats sammeln (unverändert)
                        // Innerhalb der Spieler-Schleife, wo playerDetails gesetzt wird:
                        if (!playerDetails[playerId]) {
                            // DEBUG: Logge die Avatar-URL beim ersten Mal
                            // console.log(`[API Uniliga DEBUG] Player <span class="math-inline">\{playerId\} \(</span>{player.nickname}) initial avatar URL: ${player.avatar}`);
                            playerDetails[playerId] = { nickname: player.nickname, avatar: player.avatar || '/default_avatar.png' }; // Pfad anpassen falls nötig
                        } else {
                            // ... Update Nickname ...
                            if (player.avatar && playerDetails[playerId].avatar !== player.avatar) {
                                // DEBUG: Logge Avatar-Änderung
                                // console.log(`[API Uniliga DEBUG] Player <span class="math-inline">\{playerId\} \(</span>{player.nickname}) updated avatar URL: ${player.avatar}`);
                                playerDetails[playerId].avatar = player.avatar;
                            }
                            // Sicherstellen, dass ein Fallback existiert, falls der Avatar später entfernt wird
                            if (!playerDetails[playerId].avatar) {
                                playerDetails[playerId].avatar = '/default_avatar.png'; // Pfad anpassen falls nötig
                            }
                        }
                        
                        if (!teamStats[teamId]) teamStats[teamId] = { name: teamName, wins: 0, losses: 0, matchesPlayed: 0, players: new Set() };
                        teamStats[teamId].name = teamName; // Immer Namen aktualisieren, falls er sich ändert
                        teamStats[teamId].matchesPlayed += 1 / team.players.length; // Teilen durch Spielerzahl für korrekte Zählung
                        const isWinner = teamId === winningTeamId;
                         if (winningTeamId) { // Nur zählen wenn es einen Gewinner gab
                            if (isWinner) teamStats[teamId].wins += 1 / team.players.length;
                            else teamStats[teamId].losses += 1 / team.players.length;
                        }

                        for (const player of team.players) {
                            const playerId = player.player_id;
                            const playerStats = player.player_stats;

                            // **Striktere Prüfung:** Hat der Spieler überhaupt Stats?
                            if (!playerStats || Object.keys(playerStats).length === 0) {
                                // DEBUG: Logge fehlende Spielerstats
                                console.warn(`[API Uniliga DEBUG] Skipping Player ${playerId} (${player.nickname}) in Match ${matchId}: Missing or empty player_stats.`);
                                continue; // Gehe zum nächsten Spieler
                            }

                            // Spielerdetails speichern/aktualisieren
                            if (!playerDetails[playerId]) playerDetails[playerId] = { nickname: player.nickname, avatar: player.avatar || 'default_avatar.png' };
                            else { // Update Avatar falls geändert
                                playerDetails[playerId].nickname = player.nickname; // Update Nickname falls geändert
                                if (player.avatar) playerDetails[playerId].avatar = player.avatar;
                            }
                            teamStats[teamId].players.add(playerId); // Spieler zum Team hinzufügen

                            // Spieler-Match-Statistik initialisieren
                            if (!playerMatchStats[playerId]) playerMatchStats[playerId] = [];

                             // DEBUG: Logge, wenn ein Stat für einen bestimmten Spieler hinzugefügt wird (Nickname anpassen!)
                              if (player.nickname === 'ron1N') { // Beispiel: Nur für ron1N loggen
                                 console.log(`[API Uniliga DEBUG] Adding Match ${matchId} stats for Player ${playerId} (${player.nickname})`);
                              }

                            // Statistik für DIESES Match hinzufügen
                            playerMatchStats[playerId].push({
                                // Explizit in Zahlen umwandeln und Fallbacks für fehlende Werte
                                Kills: +(playerStats["Kills"] ?? 0),
                                Deaths: +(playerStats["Deaths"] ?? 0),
                                Assists: +(playerStats["Assists"] ?? 0),
                                Headshots: +(playerStats["Headshots"] ?? 0),
                                "K/R Ratio": +(playerStats["K/R Ratio"] ?? 0), // Wird von calculateAverageStats nicht direkt verwendet
                                ADR: +(playerStats["ADR"] ?? playerStats["Average Damage per Round"] ?? 0),
                                Rounds: matchRounds, // Schon oben geprüft und geparst
                                Win: winningTeamId ? (isWinner ? 1 : 0) : 0, // 0 bei keinem Gewinner
                                MatchId: matchId // Zur Nachverfolgung
                            });
                        }
                    }
                    return true; // Erfolgreich verarbeitet
                 } catch (matchError) {
                     // DEBUG: Logge Fehler beim Verarbeiten eines einzelnen Matches
                     console.error(`[API Uniliga DEBUG] Error processing Match ${matchId}: ${matchError.message}`);
                     skippedMatchCount++;
                     return null; // Wichtig: Gehe zum nächsten Match bei Fehler
                 }
            });
            // Warte bis alle Promises im Batch fertig sind
            await Promise.all(batchPromises);
        }

        // DEBUG: Logge Gesamtanzahl verarbeiteter/übersprungener Matches
        console.log(`[API Uniliga DEBUG] Finished processing details. Processed: ${processedMatchCount}, Skipped: ${skippedMatchCount}, Total Found: ${allMatches.length}`);

        // c) Spielerstatistiken aggregieren
        console.log("[API Uniliga] Aggregating player statistics...");
        const aggregatedPlayerStats = {};
        for (const playerId in playerMatchStats) {
            // DEBUG: Logge die Anzahl der Matches pro Spieler VOR der Berechnung
            const matchCount = playerMatchStats[playerId].length;
            // Beispiel: Nur für bestimmte Spieler oder alle loggen
            // if (playerDetails[playerId]?.nickname === 'ron1N' || matchCount < 2) {
                console.log(`[API Uniliga DEBUG] Calculating stats for Player ${playerId} (${playerDetails[playerId]?.nickname ?? 'Unknown Nickname'}) based on ${matchCount} valid matches found.`);
            // }

            // Rufe zentrale Berechnungsfunktion auf
            const calculatedStats = calculateAverageStats(playerMatchStats[playerId]);

            if (calculatedStats && calculatedStats.matchesPlayed > 0) { // Stelle sicher, dass Stats berechnet wurden UND Matches vorhanden sind
                 aggregatedPlayerStats[playerId] = {
                     ...playerDetails[playerId], // Nickname, Avatar
                     ...calculatedStats         // rating, kpr, adr, kast, etc. & matchesPlayed
                 };
                 // DEBUG: Logge die berechnete Anzahl Matches (sollte mit matchCount übereinstimmen)
                 // if (playerDetails[playerId]?.nickname === 'ron1N') {
                      if (calculatedStats.matchesPlayed !== matchCount) {
                          console.error(`[API Uniliga DEBUG] Mismatch for ${playerId} (${playerDetails[playerId]?.nickname}): Found ${matchCount} matches, but calculatedStats has ${calculatedStats.matchesPlayed}`);
                      }
                 //      console.log(`[API Uniliga DEBUG] Player ${playerId} calculated stats: Matches Played = ${calculatedStats.matchesPlayed}`);
                 // }
            } else {
                 console.warn(`[API Uniliga DEBUG] Stats calculation returned null or 0 matches for Player ${playerId} (${playerDetails[playerId]?.nickname ?? 'Unknown Nickname'}) with ${matchCount} raw matches found.`);
            }
        }
        // Sortiere Spieler nach Rating (höchstes zuerst)
        const sortedPlayerStats = Object.values(aggregatedPlayerStats).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

        // d) Teamstatistiken aggregieren
        console.log("[API Uniliga] Aggregating team statistics...");
        const aggregatedTeamStats = {};
         for (const teamId in teamStats) {
             const team = teamStats[teamId];
             // Runde die geteilten Werte wieder auf ganze Zahlen
             const matchesPlayedCorrected = Math.round(team.matchesPlayed);
             const winsCorrected = Math.round(team.wins);
             const lossesCorrected = Math.round(team.losses);
             // Berechne Winrate nur, wenn Spiele vorhanden sind
             const winRate = matchesPlayedCorrected > 0 ? (winsCorrected / matchesPlayedCorrected) * 100 : 0;

             // Berechne Durchschnittsrating des Teams
             let avgTeamRating = 0; let playerCount = 0; let totalTeamMatches = 0;
             team.players.forEach(playerId => {
                 if (aggregatedPlayerStats[playerId]?.rating) {
                     avgTeamRating += aggregatedPlayerStats[playerId].rating;
                     playerCount++;
                     // Summiere die gespielten Matches der Spieler für eine alternative Zählung
                     totalTeamMatches += (aggregatedPlayerStats[playerId].matchesPlayed || 0);
                 }
             });
             avgTeamRating = playerCount > 0 ? avgTeamRating / playerCount : 0;

             // Konsistenzprüfung der Team-Matches
             // const avgMatchesPerPlayer = playerCount > 0 ? totalTeamMatches / playerCount : 0;
             // if (Math.abs(matchesPlayedCorrected - avgMatchesPerPlayer) > 1 && playerCount > 0) { // Toleranz von 1
             //     console.warn(`[API Uniliga DEBUG] Team ${team.name} (${teamId}): Mismatch in matches played. Calculated: ${matchesPlayedCorrected}, Avg from players: ${avgMatchesPerPlayer.toFixed(1)}`);
             // }


             aggregatedTeamStats[teamId] = {
                 id: teamId,
                 name: team.name,
                 matchesPlayed: matchesPlayedCorrected, // Gerundeter Wert
                 wins: winsCorrected,                   // Gerundeter Wert
                 losses: lossesCorrected,               // Gerundeter Wert
                 winRate: +winRate.toFixed(1),          // Auf eine Dezimalstelle
                 avgRating: +avgTeamRating.toFixed(2),    // Auf zwei Dezimalstellen
                 // playerIds: Array.from(team.players) // Optional: Spieler-IDs hinzufügen
             };
         }
        // Sortiere Teams nach Winrate (höchste zuerst), dann nach Avg. Rating
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
            players: sortedPlayerStats, // Spieler nach Rating sortiert
            teams: sortedTeamStats      // Teams nach WinRate/Rating sortiert
        };

        // f) Im Cache speichern (Nur wenn Redis verfügbar ist)
        if (redis) {
            try {
                await redis.set(cacheKey, JSON.stringify(responseData), "EX", CACHE_TTL_SECONDS);
                console.log(`[API Uniliga] Stored aggregated stats in Redis (Key: ${cacheKey}).`);
            }
            catch (err) {
                console.error("[API Uniliga] Redis SET error:", err);
                // Fehler beim Schreiben ist nicht kritisch für die Antwort, nur loggen
            }
        }

        // g) Senden
        console.log("[API Uniliga] Sending freshly calculated data.");
        res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`); // Erlaube Caching
        return res.status(200).json(responseData);

    } catch (error) {
        console.error("[API Uniliga] Unhandled error in handler:", error);
        // Sende generische Fehlermeldung oder spezifischere Infos, falls sicher
        return res.status(500).json({
             error: "Fehler beim Verarbeiten der Uniliga-Daten.",
             details: error.message // Sende Fehlermeldung nur im Entwicklungsmodus?
        });
    } finally {
        // Optional: Redis Verbindung schließen, wenn nicht lazyConnect?
        // Normalerweise nicht nötig mit ioredis und lazyConnect
        // if(redis) { redis.disconnect(); }
    }
}