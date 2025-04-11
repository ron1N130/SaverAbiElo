document.addEventListener('DOMContentLoaded', () => {
    const playerListContainer = document.getElementById('player-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');

    // Funktion zum Abrufen von Spielerdaten (erwartet jetzt berechnete Stats vom Backend)
    async function getPlayerData(nickname) {
        try {
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            const response = await fetch(apiUrl);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
                let displayError = errorData.error || `Server error: ${response.status}`;
                if (response.status === 404) { displayError = `Spieler "${nickname}" nicht gefunden.`; }
                else if (response.status === 500) { displayError = "Server-Konfigurationsfehler."; }
                else if (response.status === 403) { displayError = "Zugriff verweigert."; }
                // Versuche, eine Fehlermeldung aus dem Body zu lesen, falls vorhanden
                displayError = errorData.error || displayError;
                throw new Error(displayError);
            }
            const playerData = await response.json();
            // Sort Elo für die Liste
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            return playerData;
        } catch (error) {
            console.error(`Fehler Daten ${nickname}:`, error);
            // Sende Basis-Objekt bei Fehler
            return { nickname: nickname, error: error.message, sortElo: 0 };
        }
    }

    // Angepasste Funktion zum Anzeigen der Spielerkarten MIT berechneten Stats
    function displayPlayerCards(players) {
        playerListContainer.innerHTML = '';
        playerListContainer.className = 'player-card-grid';

        players.forEach((player) => {
            const cardElement = document.createElement('div');
            cardElement.classList.add('player-card-hltv'); // Klasse für die Karte

            if (player.error) {
                cardElement.classList.add('error-card');
                cardElement.innerHTML = `<span class="error-message">${player.nickname} - Fehler: ${player.error}</span>`;
            } else {
                const avatarUrl = player.avatar || 'default_avatar.png';
                const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http')
                    ? player.faceitUrl
                    : `https://${player.faceitUrl}`;

                // Zeitstempel der letzten Aktualisierung formatieren (falls vorhanden)
                let lastUpdatedText = '';
                if (player.lastUpdated) {
                    try {
                        // Nutze Intl.DateTimeFormat für lokale Zeitdarstellung
                        const date = new Date(player.lastUpdated);
                        const formatter = new Intl.DateTimeFormat('de-DE', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                        });
                        lastUpdatedText = `Stats vom ${formatter.format(date)} Uhr`;
                    } catch(e) { console.error("Error formatting date:", e); }
                }

                // Baue das HTML für die Karte - Zeige berechnete Stats an
                // Wir brauchen 6 Felder: Rating, K/D, ADR, Win Rate, HS%, Aktuelle Elo
                cardElement.innerHTML = `
                    <div class="card-header">
                        <div class="player-info">
                            <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil öffnen">
                                <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                            </a>
                            <a href="${faceitProfileUrl}" target="_blank" class="player-name">
                                ${player.nickname}
                            </a>
                        </div>
                        <div class="stats-label" title="${lastUpdatedText}">Recent Stats (Last ~${player.matchesConsidered || 0} M)</div>
                    </div>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="label" title="Berechnetes Perf. Rating (Basierend auf K/D, ADR, KPR, APR der letzten ~${player.matchesConsidered || 0} Matches)">Rating ≈</div>
                            <div class="value ${player.calculatedRating === 'N/A' || player.calculatedRating === 'Pending' ? 'na' : ''}">${player.calculatedRating || '...'}</div>
                            </div>
                        <div class="stat-item">
                            <div class="label" title="K/D Ratio (Letzte ~${player.matchesConsidered || 0} Matches)">K/D</div>
                            <div class="value ${player.kd === 'N/A' || player.kd === 'Pending' ? 'na' : ''}">${player.kd || '...'}</div>
                            </div>
                         <div class="stat-item">
                            <div class="label" title="Average Damage per Round (Letzte ~${player.matchesConsidered || 0} Matches)">ADR</div>
                            <div class="value ${player.adr === 'N/A' || player.adr === 'Pending' ? 'na' : ''}">${player.adr || '...'}</div>
                            </div>
                        <div class="stat-item">
                            <div class="label" title="Win Rate % (Letzte ~${player.matchesConsidered || 0} Matches)">Win Rate</div>
                            <div class="value ${player.winRate === 'N/A' || player.winRate === 'Pending' ? 'na' : ''}">${player.winRate || '...'}%</div>
                            </div>
                         <div class="stat-item">
                            <div class="label" title="Headshot % (Letzte ~${player.matchesConsidered || 0} Matches)">HS %</div>
                            <div class="value ${player.hsPercent === 'N/A' || player.hsPercent === 'Pending' ? 'na' : ''}">${player.hsPercent || '...'}%</div>
                            </div>
                        <div class="stat-item">
                            <div class="label">Aktuelle Elo</div>
                            <div class="value ${player.elo === 'N/A' ? 'na' : ''}">${player.elo}</div>
                            </div>
                    </div>
                 `;
                // Indikatorbalken vorerst weggelassen, da Benchmarks fehlen
            }
            playerListContainer.appendChild(cardElement);
        });
    }

    // Hauptfunktion zum Laden aller Spieler
    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        playerListContainer.innerHTML = '';

        let playerNicknames = [];
        try {
            const response = await fetch('/players.json');
            if (!response.ok) { throw new Error(`Fehler Laden players.json: ${response.status}`); }
            playerNicknames = await response.json();
            if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) { throw new Error("players.json leer/falsches Format."); }

            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));
            let playersData = await Promise.all(playerPromises);

            // Sortiere nach Elo für die interne Reihenfolge oder Anzeige falls gewünscht
            playersData.sort((a, b) => b.sortElo - a.sortElo);

            // Zeige die Karten an
            displayPlayerCards(playersData);

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