// Lade Umgebungsvariablen aus der .env Datei (nur für lokale Entwicklung relevant)
require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch'); // node-fetch@2 uses require
const cors = require('cors');

const app = express();
app.use(cors());

// Lese den API Key aus den Umgebungsvariablen (lokal aus .env, auf Vercel aus den Vercel Settings)
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const API_BASE_URL = 'https://open.faceit.com/data/v4';

app.get('/api/faceit-data', async (req, res) => {
    const nickname = req.query.nickname;
    // Log 1: Funktion gestartet?
    console.log(`[API Function] Handler started for nickname: ${nickname}`);

    if (!nickname) {
        return res.status(400).json({ error: 'Nickname query parameter is required' });
    }
    if (!FACEIT_API_KEY) {
        console.error("FEHLER: FACEIT_API_KEY nicht als Umgebungsvariable auf dem Server gefunden!");
        return res.status(500).json({ error: 'Server configuration error: API Key missing' });
    }

    const headers = { 'Authorization': `Bearer ${FACEIT_API_KEY}` };

    try {
        console.log(`[API Function] Fetching player ID for: ${nickname}`);
        const playerDetailsResponse = await fetch(`${API_BASE_URL}/players?nickname=${nickname}`, { headers });

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

        // Schritt 2: Stats (Elo) holen für CS2
        console.log(`[API Function] Fetching stats for: ${playerId} (Game: cs2)`); // <-- Sicherstellen, dass hier cs2 steht
        const statsResponse = await fetch(`${API_BASE_URL}/players/${playerId}/stats/cs2`, { headers }); // <-- Sicherstellen, dass hier cs2 steht

        // Log 2: Welchen Status-Code hat die Stats-Antwort?
        console.log(`[API Function] Stats Response Status for ${nickname}: ${statsResponse.status}`);

        let playerStats = {};
        if (statsResponse.ok) { // Status 200-299
            playerStats = await statsResponse.json();
            console.log(`[API Function] Found stats for: ${playerId}`);
            // NEU: Gib das empfangene Stats-Objekt im Log aus
            console.log('[API Function] Received playerStats Object:', JSON.stringify(playerStats, null, 2));
        } else if (statsResponse.status === 404) { // Status 404
            console.warn(`[API Function] No CS2 stats found for ${nickname} (${playerId}). Status: 404.`);
        } else { // Alle anderen Fehlerstatus
            console.error(`[API Function] Faceit API error (Player Stats): ${statsResponse.status} for ${playerId}`);
        }

        // Daten kombinieren und zurücksenden (bleibt erstmal gleich)
        const responseData = {
            nickname: playerData.nickname,
            avatar: playerData.avatar || 'default_avatar.png',
            faceitUrl: playerData.faceit_url.replace('{lang}', 'en'),
            elo: playerStats.lifetime?.faceit_elo || 'N/A',
            level: playerStats.lifetime?.skill_level || 'N/A',
            levelImageUrl: playerStats.lifetime?.skill_level ? `https://cdn-frontend.faceit.com/web/960/src/app/assets/images-compress/skill-level/skill_level_${playerStats.lifetime.skill_level}_sm.png` : null
        };

        console.log(`[API Function] Sending data for ${nickname}`);
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); // Cache für 5 Min erlaubt
        res.json(responseData);

    } catch (error) {
        console.error(`[API Function] CATCH BLOCK Error processing request for ${nickname}:`, error);
        res.status(500).json({ error: error.message || 'Internal server error fetching Faceit data' });
    }
});

module.exports = app;