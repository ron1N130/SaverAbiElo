document.addEventListener('DOMContentLoaded', () => {
    // Die Liste der Spieler wird aus players.json geladen.
    const playerListElement = document.getElementById('player-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');

    // Funktion zum Abrufen von Spielerdaten von der Vercel API Funktion
    async function getPlayerData(nickname) {
        try {
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            const response = await fetch(apiUrl);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
                let displayError = errorData.error || `Server error: ${response.status}`;
                if (response.status === 404 && displayError.includes("nicht gefunden")) {
                    displayError = `Spieler "${nickname}" nicht gefunden.`;
                } else if (response.status === 500 && displayError.includes("API Key missing")) {
                    displayError = "Server-Konfigurationsfehler (API Key).";
                }
                throw new Error(displayError);
            }
            const playerData = await response.json();
            // Stelle sicher, dass elo eine Zahl ist für die Sortierung, sonst 0
            // Wichtig: Wir speichern die Original-Elo (kann 'N/A' sein) für die Anzeige
            // und erstellen eine separate Eigenschaft für die Sortierung.
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            return playerData;
        } catch (error) {
            console.error(`Fehler beim Abrufen von Daten für ${nickname}:`, error);
            // Gib sortElo 0 zurück bei Fehler, damit Sortierung funktioniert
            return { nickname: nickname, error: error.message, elo: 'N/A', sortElo: 0 };
        }
    }

    // NEUE Funktion zum Anzeigen der Spieler in einer Liste
    function displayPlayerList(players) {
        playerListElement.innerHTML = ''; // Liste leeren

        players.forEach((player) => {
            // Wir brauchen den Rank nicht mehr explizit, da <ol> nummeriert
            const listItem = document.createElement('li');

            if (player.error) {
                listItem.classList.add('error-item');
                // Zeige nur Name und Fehler an
                listItem.innerHTML = `
                    <span>${player.nickname} - Fehler: ${player.error}</span>
                `;
            } else {
                const avatarUrl = player.avatar || 'default_avatar.png';
                const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http')
                    ? player.faceitUrl
                    : `https://${player.faceitUrl}`; // Fallback für Profil-URL

                listItem.innerHTML = `
                    <div class="player-info">
                       <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil von ${player.nickname} öffnen">
                          <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                       </a>
                       <a href="${faceitProfileUrl}" target="_blank" class="player-name">
                           ${player.nickname}
                       </a>
                    </div>
                    <div class="player-elo">${player.elo === 'N/A' ? 'N/A' : player.elo}</div>
                 `;
                // Kein Level-Bild oder Text mehr hier
            }
            playerListElement.appendChild(listItem);
        });
    }

    // Hauptfunktion zum Laden aller Spieler (MIT SORTIERUNG)
    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        playerListElement.innerHTML = '';

        let playerNicknames = [];

        try {
            const response = await fetch('/players.json');
            if (!response.ok) {
                throw new Error(`Fehler beim Laden der Spielerliste (players.json): ${response.status}`);
            }
            playerNicknames = await response.json();

            if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) {
                throw new Error("Spielerliste (players.json) ist leer oder im falschen Format.");
            }

            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));
            let playersData = await Promise.all(playerPromises);

            // === Sortiere das Array absteigend nach sortElo ===
            playersData.sort((a, b) => b.sortElo - a.sortElo); // Sortiert von hoch nach niedrig

            // Zeige die sortierte Liste an
            displayPlayerList(playersData);

        } catch (error) {
            console.error("Fehler beim Laden der Spieler:", error);
            errorMessageElement.textContent = `Fehler: ${error.message}`;
            errorMessageElement.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none';
        }
    }

    // Lade die Spielerdaten, wenn die Seite geladen ist
    loadAllPlayers();
});