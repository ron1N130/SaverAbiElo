document.addEventListener('DOMContentLoaded', () => {
    // Die Liste der Spieler wird jetzt aus players.json geladen.
    // const playerNicknames = [ ... ]; // <- Diese Zeile wird entfernt/ersetzt.

    const playerListElement = document.getElementById('player-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');

    // Funktion zum Abrufen von Spielerdaten von der Vercel API Funktion (unverändert)
    async function getPlayerData(nickname) {
        try {
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            // console.log(`Workspaceing from: ${apiUrl}`); // Log zur Überprüfung - kann auskommentiert werden
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
            return playerData;

        } catch (error) {
            console.error(`Fehler beim Abrufen von Daten für ${nickname} von Vercel API:`, error);
            return { nickname: nickname, error: error.message };
        }
    }

    // Funktion zum Anzeigen der Spielerdaten in der HTML-Liste (unverändert)
    function displayPlayer(player) {
        const card = document.createElement('div');
        card.classList.add('player-card');

        const avatarUrl = player.avatar || 'default_avatar.png';

        if (player.error) {
            card.innerHTML = `
                <h2>${player.nickname}</h2>
                <p style="color: #ff6b6b;">Fehler: ${player.error}</p>
                 <p style="font-size: 0.8em; color: #aaa;">(Prüfe Nickname & Vercel Logs)</p>
            `;
        } else {
            if (player.level && player.level !== 'N/A') {
                card.classList.add(`level-${player.level}`);
            }

            const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http')
                ? player.faceitUrl
                : `https://${player.faceitUrl}`;

            card.innerHTML = `
                <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil von ${player.nickname} öffnen">
                    <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                </a>
                <a href="${faceitProfileUrl}" target="_blank" style="color: inherit; text-decoration: none;" title="Faceit Profil von ${player.nickname} öffnen">
                    <h2>${player.nickname}</h2>
                </a>
                <div class="elo">${player.elo !== 'N/A' ? player.elo : '----'}</div>
                <div class="level">
                    ${player.levelImageUrl ? `<img src="${player.levelImageUrl}" alt="Level ${player.level}">` : ''}
                    Level ${player.level !== 'N/A' ? player.level : '-'}
                </div>
                 <a href="${faceitProfileUrl}" target="_blank" class="profile-link">Profil ansehen</a>
            `;
        }
        playerListElement.appendChild(card);
    }

    // Hauptfunktion zum Laden aller Spieler (JETZT MIT FETCH FÜR players.json)
    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        playerListElement.innerHTML = '';

        let playerNicknames = []; // Leeres Array für die Nicknames

        try {
            // Schritt 1: Lade die Liste der Nicknames aus players.json
            const response = await fetch('/players.json'); // Lädt die Datei aus dem Root-Verzeichnis
            if (!response.ok) {
                throw new Error(`Fehler beim Laden der Spielerliste (players.json): ${response.status}`);
            }
            playerNicknames = await response.json(); // Wandelt den Inhalt der Datei in ein JavaScript-Array um

            if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) {
                throw new Error("Spielerliste (players.json) ist leer oder im falschen Format.");
            }

            // Schritt 2: Erstelle Promises für alle API-Aufrufe basierend auf der geladenen Liste
            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));

            // Schritt 3: Warte auf alle API-Aufrufe und zeige die Daten an
            const playersData = await Promise.all(playerPromises);
            playersData.forEach(player => displayPlayer(player));

        } catch (error) {
            console.error("Fehler beim Laden der Spieler:", error);
            errorMessageElement.textContent = `Fehler: ${error.message}`;
            errorMessageElement.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none'; // Ladeanzeige ausblenden
        }
    }

    // Lade die Spielerdaten, wenn die Seite geladen ist
    loadAllPlayers();
});