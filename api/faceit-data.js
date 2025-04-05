// Lade Umgebungsvariablen (relevant für lokal, Vercel nutzt eigene)
require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch'); // node-fetch@2
const cors = require('cors');

const app = express();
app.use(cors());

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const API_BASE_URL = 'https://open.faceit.com/data/v4';
const HISTORY_LIMIT = 50;

app.get('/api/faceit-data', async (req, res) => {
    const nickname = req.query.nickname;
    console.log(`[API Function] Handler started for nickname: ${nickname}`);

    if (!nickname) { return res.status(400).json({ error: 'Nickname query parameter is required' }); }
    if (!FACEIT_API_KEY) { console.error("FEHLER: FACEIT_API_KEY fehlt!"); return res.status(500).json({ error: 'Server configuration error: API Key missing' }); }

    const headers = { 'Authorization': `Bearer ${FACEIT_API_KEY}` };

    try {
        // === Schritt 1: Spielerdetails holen ===
        console.log(`[API Function] Fetching player details for: ${nickname}`);
        const playerDetailsResponse = await fetch(`${API_BASE_URL}/players?nickname=${nickname}`, { headers });
        console.log(`[API Function] Player Details Response Status for ${nickname}: ${playerDetailsResponse.status}`);

        if (!playerDetailsResponse.ok) { /* ... Fehlerbehandlung wie zuvor ... */
            if (playerDetailsResponse.status === 404) { return res.status(404).json({ error: `Spieler "${nickname}" nicht gefunden.` }); }
            else { throw new Error(`Faceit API error (Player Details): ${playerDetailsResponse.status}`); }
        }
        const playerData = await playerDetailsResponse.json();
        const playerId = playerData.player_id;
        console.log(`[API Function] Found Player ID: ${playerId} for ${nickname}`);

        // === Schritt 2: Match-Historie holen ===
        let eloHistory = [];
        try {
            console.log(`[API Function] Fetching match history for: ${playerId} (Game: cs2, Limit: ${HISTORY_LIMIT})`);
            const historyResponse = await fetch(`${API_BASE_URL}/players/${playerId}/history?game=cs2&limit=${HISTORY_LIMIT}`, { headers });
            console.log(`[API Function] Match History Response Status for ${nickname}: ${historyResponse.status}`);

            if (historyResponse.ok) {
                const historyData = await historyResponse.json();
                // NEU: Logge die rohe History-Antwort, um die Struktur zu sehen
                console.log('[API Function] Raw History Data for ' + nickname + ':', JSON.stringify(historyData, null, 2));

                if (historyData && Array.isArray(historyData.items)) {
                    // Extrahiere Elo-Werte (wir bleiben bei der Annahme 'match.elo', passen es ggf. nach Log-Analyse an)
                    eloHistory = historyData.items
                        .map(match => parseInt(match.elo, 10))
                        .filter(elo => !isNaN(elo));
                    eloHistory.reverse(); // Alt -> Neu
                    console.log(`[API Function] Found ${eloHistory.length} valid Elo entries in history for ${nickname}`);
                } else {
                    console.warn(`[API Function] Match history items not found or not an array for ${nickname}`);
                }
            } else {
                console.error(`[API Function] Faceit API error (Match History): ${historyResponse.status} for ${playerId}`);
            }
        } catch(historyError) {
            console.error(`[API Function] CATCH BLOCK Error fetching/processing match history for ${nickname}:`, historyError);
        }

        // === Schritt 3: Daten kombinieren ===
        const gameId = 'cs2';
        const gameData = playerData.games && playerData.games[gameId] ? playerData.games[gameId] : null;
        const responseData = {
            nickname: playerData.nickname,
            avatar: playerData.avatar || 'default_avatar.png',
            faceitUrl: playerData.faceit_url ? playerData.faceit_url.replace('{lang}', 'en') : '#',
            elo: gameData?.faceit_elo || 'N/A',
            level: gameData?.skill_level || 'N/A',
            sortElo: parseInt(gameData?.faceit_elo, 10) || 0,
            eloHistory: eloHistory
        };
        console.log(`[API Function] Sending responseData for ${nickname}:`, JSON.stringify(responseData, null, 0));
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        res.json(responseData);

    } catch (error) {
        console.error(`[API Function] CATCH BLOCK (MAIN) Error processing request for ${nickname}:`, error);
        res.status(500).json({ error: error.message || 'Internal server error fetching Faceit data' });
    }
});

module.exports = app;