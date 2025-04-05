document.addEventListener('DOMContentLoaded', () => {
    // --- Konfiguration ---
    // Liste der Faceit Nicknames, die du tracken möchtest
    const playerNicknames = [
        'NICKNAME_1', // Ersetze dies
        'NICKNAME_2', // Ersetze dies
        'NICKNAME_3'  // Füge weitere hinzu oder entferne welche
        // Beispiel: 's1mple', 'ron1N' <- Deinen Nickname hier eintragen!
    ];
    // --- Ende Konfiguration ---

    const playerListElement = document.getElementById('player-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');

    // Funktion zum Abrufen von Spielerdaten vom LOKALEN Server
    async function getPlayerData(nickname) {
        try {
            // Rufe DEINEN lokalen Server-Endpunkt auf (Port 3000 ist Standard in server.js)
            // encodeURIComponent stellt sicher, dass auch Nicknames mit Sonderzeichen funktionieren
            const response = await fetch(`http://localhost:3000/api/faceit-data?nickname=${encodeURIComponent(nickname)}`);

            if (!response.ok) {
                // Versuche, die Fehlermeldung vom Server zu bekommen
                const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }

            const playerData = await response.json();
            return playerData; // Der Server liefert das aufbereitete Objekt

        } catch (error) {
            console.error(`Fehler beim Abrufen von Daten für ${nickname} vom lokalen Server:`, error);
            // Gib ein Objekt zurück, das den Fehler enthält, damit er angezeigt werden kann
            return { nickname: nickname, error: error.message };
        }
    }

    // Funktion zum Anzeigen der Spielerdaten in der HTML-Liste
    function displayPlayer(player) {
        const card = document.createElement('div');
        card.classList.add('player-card');

        // Stelle sicher, dass der Default-Avatar angezeigt wird, falls keiner von der API kommt
        const avatarUrl = player.avatar || 'default_avatar.png'; // Du müsstest evtl. ein default_avatar.png Bild im Ordner haben

        if (player.error) {
            card.innerHTML = `
                <h2>${player.nickname}</h2>
                <p style="color: #ff6b6b;">Fehler: ${player.error}</p>
                <p style="font-size: 0.8em; color: #aaa;">(Prüfe Server-Logs & Nickname)</p>
            `;
        } else {
            // Füge eine Klasse für das Level hinzu (z.B. für spezifisches Styling)
            if (player.level && player.level !== 'N/A') {
                card.classList.add(`level-${player.level}`);
            }

            // Erstelle den Link zur Faceit-Profilseite (verwende 'https://' falls nicht vorhanden)
            const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http')
                ? player.faceitUrl
                : `https://${player.faceitUrl}`;

            card.innerHTML = `
                <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil von ${player.nickname} öffnen">
                    <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';"> </a>
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

    // Hauptfunktion zum Laden aller Spieler
    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block'; // Ladeanzeige einblenden
        errorMessageElement.style.display = 'none'; // Alte Fehlermeldungen ausblenden
        errorMessageElement.textContent = ''; // Text leeren
        playerListElement.innerHTML = ''; // Alte Liste leeren

        // Erstelle ein Array von Promises für alle API-Aufrufe an den lokalen Server
        const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));

        // Zeige Fehler direkt an, wenn die Serververbindung fehlschlägt
        try {
            // Warte auf alle API-Aufrufe
            const playersData = await Promise.all(playerPromises);

            // Zeige jeden Spieler an (auch die mit Fehlern)
            playersData.forEach(player => displayPlayer(player));

        } catch (error) {
            // Dieser Catch ist unwahrscheinlicher geworden, da Fehler pro Spieler behandelt werden,
            // aber gut für generelle Probleme (z.B. wenn Promise.all selbst fehlschlägt)
            console.error("Ein unerwarteter Fehler ist beim Laden der Spieler aufgetreten:", error);
            errorMessageElement.textContent = `Ein Fehler ist aufgetreten: ${error.message}. Läuft der lokale Server (node server.js)?`;
            errorMessageElement.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none'; // Ladeanzeige ausblenden
        }
    }

    // Lade die Spielerdaten, wenn die Seite geladen ist
    loadAllPlayers();
});