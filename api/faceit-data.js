// Lade Umgebungsvariablen (relevant für lokal, Vercel nutzt eigene)
require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch'); // node-fetch@2
const cors = require('cors');

const app = express();
app.use(cors());

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const API_BASE_URL = 'https://open.faceit.com/data/v4';

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
        // === EINZIGER API CALL NÖTIG ===
        // Hole Spielerdetails (inkl. Elo/Level) direkt über den Nickname
        console.log(`[API Function] Fetching player details for: ${nickname}`);
        const playerDetailsResponse = await fetch(`${API_BASE_URL}/players?nickname=${nickname}`, { headers });
        console.log(`[API Function] Player Details Response Status for ${nickname}: ${playerDetailsResponse.status}`); // Log Status

        if (!playerDetailsResponse.ok) {
            if (playerDetailsResponse.status === 404) {
                console.log(`[API Function] Player not found: ${nickname}`);
                return res.status(404).json({ error: `Spieler "${nickname}" nicht gefunden.` });
            } else {
                // Logge anderen Fehlerstatus
                console.error(`[API Function] Faceit API error (Player Details): ${playerDetailsResponse.status} for ${nickname}`);
                throw new Error(`Faceit API error (Player Details): ${playerDetailsResponse.status}`);
            }
        }

        // Verarbeite die Spielerdaten direkt aus dieser Antwort
        const playerData = await playerDetailsResponse.json();
        console.log(`[API Function] Received PlayerData for ${nickname}`);
        // Optional: Logge das playerData Objekt, um die Struktur zu sehen, falls es immer noch nicht geht
        // console.log('[API Function] PlayerData Object:', JSON.stringify(playerData, null, 2));

        // Extrahiere die benötigten Daten (Elo/Level sind im 'games'-Objekt)
        const gameId = 'cs2'; // Oder 'csgo', falls doch nötig - jetzt einfacher zu ändern
        const gameData = playerData.games && playerData.games[gameId] ? playerData.games[gameId] : null;

        const responseData = {
            nickname: playerData.nickname,
            avatar: playerData.avatar || 'default_avatar.png',
            faceitUrl: playerData.faceit_url ? playerData.faceit_url.replace('{lang}', 'en') : '#', // Fallback für URL
            // Greife auf Elo und Level innerhalb des gameData-Objekts zu
            elo: gameData?.faceit_elo || 'N/A',
            level: gameData?.skill_level || 'N/A',
            levelImageUrl: gameData?.skill_level ? `https://cdn-frontend.faceit.com/web/960/src/app/assets/images-compress/skill-level/skill_level_${gameData.skill_level}_sm.png` : null
        };

        console.log(`[API Function] Sending data for ${nickname}: Elo=${responseData.elo}, Level=${responseData.level}`);
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        res.json(responseData);

    } catch (error) {
        console.error(`[API Function] CATCH BLOCK Error processing request for ${nickname}:`, error);
        // Gib spezifischere Fehlermeldung zurück, falls möglich
        res.status(500).json({ error: error.message || 'Internal server error fetching Faceit data' });
    }
});

module.exports = app;