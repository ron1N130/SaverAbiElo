document.addEventListener('DOMContentLoaded', () => {
    // --- Konfiguration ---
    // Liste der Faceit Nicknames, die du tracken möchtest
    const playerNicknames = [
        'ron1N', // Beispiel: Deinen Nickname hier eintragen!
        'NICKNAME_2', // Ersetze dies
        'NICKNAME_3'  // Füge weitere hinzu oder entferne welche
        // Beispiel: 's1mple'
    ];
    // --- Ende Konfiguration ---

    const playerListElement = document.getElementById('player-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');

    // Funktion zum Abrufen von Spielerdaten von der Vercel API Funktion
    async function getPlayerData(nickname) {
        try {
            // Rufe den API Endpunkt auf Vercel über einen relativen Pfad auf.
            // Dies funktioniert, weil das Frontend (HTML/JS) und die API Funktion
            // auf derselben Vercel Domain gehostet werden.
            // Der Pfad muss mit dem Pfad übereinstimmen, den Vercel für deine Funktion verwendet!
            // Überprüfe dies ggf. im Vercel Dashboard. '/api/faceit-data' ist eine häufige Konvention.
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            console.log(`Workspaceing from: ${apiUrl}`); // Log zur Überprüfung des API-Pfads
            const response = await fetch(apiUrl);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
                // Versuche, eine spezifischere Fehlermeldung zu geben
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

    // Hauptfunktion zum Laden aller Spieler (unverändert)
    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        playerListElement.innerHTML = '';

        const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));

        try {
            const playersData = await Promise.all(playerPromises);
            playersData.forEach(player => displayPlayer(player));

        } catch (error) {
            console.error("Ein unerwarteter Fehler ist beim Laden der Spieler aufgetreten:", error);
            errorMessageElement.textContent = `Ein Fehler ist aufgetreten: ${error.message}.`;
            errorMessageElement.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none';
        }
    }

    // Lade die Spielerdaten, wenn die Seite geladen ist
    loadAllPlayers();
});