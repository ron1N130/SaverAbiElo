document.addEventListener('DOMContentLoaded', () => {
    const playerListElement = document.getElementById('player-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');
    // Keine Chart-Variablen mehr

    // Kein Avatar Preloading mehr nötig
    /* async function preloadAvatars(players) { ... } */

    // Funktion zum Abrufen von Spielerdaten (erwartet jetzt Stats vom Backend)
    async function getPlayerData(nickname) {
         try {
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            const response = await fetch(apiUrl);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
                let displayError = errorData.error || `Server error: ${response.status}`;
                 if (response.status === 404 && displayError.includes("nicht gefunden")) { displayError = `Spieler "${nickname}" nicht gefunden.`; }
                 else if (response.status === 500 && displayError.includes("API Key missing")) { displayError = "Server-Konfigurationsfehler (API Key)."; }
                throw new Error(displayError);
            }
            const playerData = await response.json();
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            // Keine History mehr
            return playerData;
         } catch (error) {
            console.error(`Fehler Daten ${nickname}:`, error);
            // Sende Basis-Objekt bei Fehler
            return { nickname: nickname, error: error.message, elo: 'N/A', sortElo: 0 };
         }
     }

    // Angepasste Funktion zum Anzeigen der Spieler in der Liste MIT Stats
    function displayPlayerList(players) {
        playerListElement.innerHTML = ''; // Liste leeren
        players.forEach((player) => {
            const listItem = document.createElement('li');
            if (player.error) {
                listItem.classList.add('error-item');
                // Optional: Mehr Platz für Fehlermeldung
                listItem.style.justifyContent = 'center';
                listItem.innerHTML = `<span>${player.nickname} - Fehler: ${player.error}</span>`;
            } else {
                 const avatarUrl = player.avatar || 'default_avatar.png';
                 const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http')
                                        ? player.faceitUrl
                                        : `https://${player.faceitUrl}`;

                 // Baue den HTML-String für das Listenelement mit Stats
                 listItem.innerHTML = `
                    <div class="player-info">
                       <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil von ${player.nickname} öffnen">
                          <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                       </a>
                       <a href="${faceitProfileUrl}" target="_blank" class="player-name">
                           ${player.nickname}
                       </a>
                    </div>
                    <div class="player-stats">
                        <span class="stat-item" title="Lifetime K/D Ratio">K/D: ${player.lifetimeKD || 'N/A'}</span>
                        <span class="stat-item" title="Lifetime Win Rate %">WR: ${player.lifetimeWinRate || 'N/A'}%</span>
                        <span class="stat-item impact-score" title="Vereinfachter Impact Score (basierend auf KPR/APR)">Impact: ${player.simplifiedImpact || 'N/A'}</span>
                    </div>
                    <div class="player-elo">${player.elo === 'N/A' ? 'N/A' : player.elo}</div>
                 `;
            }
            playerListElement.appendChild(listItem);
        });
    }

    // Keine renderChart Funktion mehr
    /* function renderEloTimeChart(playersData) { ... } */

     // Hauptfunktion zum Laden aller Spieler (vereinfacht)
     async function loadAllPlayers() {
         loadingIndicator.style.display = 'block';
         errorMessageElement.style.display = 'none';
         errorMessageElement.textContent = '';
         playerListElement.innerHTML = '';
         // Kein Chart Handling mehr

         let playerNicknames = [];
         try {
             const response = await fetch('/players.json');
             if (!response.ok) { throw new Error(`Fehler Laden players.json: ${response.status}`); }
             playerNicknames = await response.json();
             if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) { throw new Error("players.json leer/falsches Format."); }

             const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));
             let playersData = await Promise.all(playerPromises); // Holt jetzt auch die berechneten Stats

             // Kein Avatar Preloading mehr
             // console.log("[LoadAll] Preloading avatars...");
             // playersData = await preloadAvatars(playersDataRaw);
             // console.log("[LoadAll] Avatars preloaded.");

             playersData.sort((a, b) => b.sortElo - a.sortElo); // Sortieren

             // Zeige NUR die Liste an
             displayPlayerList(playersData);
             // KEIN Graph rendern
             // renderEloTimeChart(playersData);

         } catch (error) {
             console.error("Fehler Laden Spieler:", error);
             errorMessageElement.textContent = `Fehler: ${error.message}`;
             errorMessageElement.style.display = 'block';
         } finally {
             loadingIndicator.style.display = 'none';
         }
     }

    loadAllPlayers();
});