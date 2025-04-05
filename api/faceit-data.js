// Lade Umgebungsvariablen (relevant für lokal, Vercel nutzt eigene)
require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch'); // node-fetch@2
const cors = require('cors');

const app = express();
app.use(cors());

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const API_BASE_URL = 'https://open.faceit.com/data/v4';
const HISTORY_LIMIT = 50; // Anzahl der Matches für den Graphen

app.get('/api/faceit-data', async (req, res) => {
    const nickname = req.query.nickname;
    console.log(`[API Function] Handler started for nickname: ${nickname}`);

    if (!nickname) {
        return res.status(400).json({ error: 'Nickname query parameter is required' });
    }
    if (!FACEIT_API_KEY) {
        console.error("FEHLER: FACEIT_API_KEY nicht als Umgebungsvariable gefunden!");
        return res.status(500).json({ error: 'Server configuration error: API Key missing' });
    }

    const headers = { 'Authorization': `Bearer ${FACEIT_API_KEY}` };

    try {
        // === Schritt 1: Spielerdetails holen (wie bisher) ===
        console.log(`[API Function] Fetching player details for: ${nickname}`);
        const playerDetailsResponse = await fetch(`${API_BASE_URL}/players?nickname=${nickname}`, { headers });
        console.log(`[API Function] Player Details Response Status for ${nickname}: ${playerDetailsResponse.status}`);

        if (!playerDetailsResponse.ok) {
            if (playerDetailsResponse.status === 404) {
                console.log(`[API Function] Player not found: ${nickname}`);
                return res.status(404).json({ error: `Spieler "${nickname}" nicht gefunden.` });
            } else {
                console.error(`[API Function] Faceit API error (Player Details): ${playerDetailsResponse.status} for ${nickname}`);
                throw new Error(`Faceit API error (Player Details): ${playerDetailsResponse.status}`);
            }
        }
        const playerData = await playerDetailsResponse.json();
        const playerId = playerData.player_id;
        console.log(`[API Function] Found Player ID: ${playerId} for ${nickname}`);

        // === Schritt 2: Match-Historie holen (NEU) ===
        let eloHistory = []; // Leeres Array als Standardwert
        try {
            console.log(`[API Function] Fetching match history for: ${playerId} (Game: cs2, Limit: ${HISTORY_LIMIT})`);
            // &offset=0 ist Standard, kann weggelassen werden
            const historyResponse = await fetch(`${API_BASE_URL}/players/${playerId}/history?game=cs2&limit=${HISTORY_LIMIT}`, { headers });
            console.log(`[API Function] Match History Response Status for ${nickname}: ${historyResponse.status}`);

            if (historyResponse.ok) {
                const historyData = await historyResponse.json();
                // Annahme: Die API liefert ein Objekt mit einem 'items'-Array, jedes Item hat ein 'elo'-Feld.
                // Annahme: Die Liste ist von NEU nach ALT sortiert. Für den Graphen wollen wir ALT nach NEU.
                if (historyData && Array.isArray(historyData.items)) {
                    // Extrahiere nur die Elo-Werte und filtere ungültige Einträge (falls 'elo' fehlt/null ist)
                    eloHistory = historyData.items
                        .map(match => parseInt(match.elo, 10)) // Versuche Elo zu parsen
                        .filter(elo => !isNaN(elo)); // Behalte nur gültige Zahlen
                    eloHistory.reverse(); // Drehe die Reihenfolge um (Alt -> Neu)
                    console.log(`[API Function] Found ${eloHistory.length} valid Elo entries in history for ${nickname}`);
                } else {
                    console.warn(`[API Function] Match history items not found or not an array for ${nickname}`);
                }
            } else {
                // Logge Fehler beim History-Abruf, aber fahre fort (mit leerem eloHistory)
                console.error(`[API Function] Faceit API error (Match History): ${historyResponse.status} for ${playerId}`);
            }
        } catch(historyError) {
            // Logge Fehler beim History-Abruf, fahre aber fort
            console.error(`[API Function] CATCH BLOCK Error fetching/processing match history for ${nickname}:`, historyError);
        }


        // === Schritt 3: Daten kombinieren und zurücksenden ===
        const gameId = 'cs2';
        const gameData = playerData.games && playerData.games[gameId] ? playerData.games[gameId] : null;

        const responseData = {
            nickname: playerData.nickname,
            avatar: playerData.avatar || 'default_avatar.png',
            faceitUrl: playerData.faceit_url ? playerData.faceit_url.replace('{lang}', 'en') : '#',
            elo: gameData?.faceit_elo || 'N/A', // Aktuelle Elo
            level: gameData?.skill_level || 'N/A', // Aktuelles Level (wird nicht mehr angezeigt, aber gut zu haben)
            // levelImageUrl: gameData?.skill_level ? ... : null, // Nicht mehr benötigt im Frontend
            sortElo: parseInt(gameData?.faceit_elo, 10) || 0, // Für die Sortierung
            eloHistory: eloHistory // NEU: Array mit Elo-Werten aus der Historie
        };

        console.log(`[API Function] Sending data for ${nickname}: Elo=${responseData.elo}, Level=${responseData.level}, History points=${responseData.eloHistory.length}`);
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); // 5 Min Cache
        res.json(responseData);

    } catch (error) {
        // Fängt primär Fehler vom Spielerdetail-Abruf oder unerwartete Fehler ab
        console.error(`[API Function] CATCH BLOCK (MAIN) Error processing request for ${nickname}:`, error);
        res.status(500).json({ error: error.message || 'Internal server error fetching Faceit data' });
    }
});

module.exports = app;