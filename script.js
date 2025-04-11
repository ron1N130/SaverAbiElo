document.addEventListener('DOMContentLoaded', () => {
    const playerGridContainer = document.getElementById('player-grid'); // Container für Vorschau-Grid
    const detailCardContainer = document.getElementById('player-detail-card-container'); // Container für Detailkarte
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');

    let allPlayersData = []; // Globale Variable zum Speichern aller Spielerdaten

    // Funktion zum Abrufen von Spielerdaten (unverändert vom letzten Stand)
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
                displayError = errorData.error || displayError;
                throw new Error(displayError);
            }
            const playerData = await response.json();
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            return playerData;
        } catch (error) {
            console.error(`Fehler Daten ${nickname}:`, error);
            return { nickname: nickname, error: error.message, sortElo: 0 };
        }
    }

    // NEU: Funktion zum Anzeigen des Vorschau-Grids
    function displayPlayerGrid(players) {
        playerGridContainer.innerHTML = ''; // Grid leeren
        players.forEach((player) => {
            const previewItem = document.createElement('div');
            previewItem.classList.add('player-preview-item');
            // Speichere den Nickname im data-Attribut für den Klick-Handler
            previewItem.setAttribute('data-nickname', player.nickname);

            if (player.error) {
                previewItem.classList.add('error-item');
                previewItem.innerHTML = `
                    <span class="player-name">${player.nickname}</span>
                    <span style="font-size: 0.8em;">Fehler</span>
                `;
            } else {
                const avatarUrl = player.avatar || 'default_avatar.png';
                previewItem.innerHTML = `
                     <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                     <span class="player-name">${player.nickname}</span>
                 `;
            }
            playerGridContainer.appendChild(previewItem);
        });
    }

    // NEU: Funktion zum Anzeigen der Detail-Karte für EINEN Spieler
    function displayDetailCard(player) {
        if (!player || player.error) {
            // Zeige nichts oder eine Fehlermeldung im Detailbereich an
            detailCardContainer.innerHTML = `<div class="player-card-hltv error-card"><span class="error-message">Spielerdaten nicht verfügbar.</span></div>`;
            detailCardContainer.style.display = 'block'; // Sicherstellen, dass Container sichtbar ist
            return;
        }

        const cardElement = document.createElement('div');
        cardElement.classList.add('player-card-hltv'); // Klasse für die Karte

        const avatarUrl = player.avatar || 'default_avatar.png';
        const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http')
            ? player.faceitUrl
            : `https://${player.faceitUrl}`;
        const lastUpdatedText = player.lastUpdated
            ? `Stats vom ${new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}).format(new Date(player.lastUpdated))} Uhr`
            : 'Stats werden aktualisiert...';
        const matchesConsideredText = `Last ~${player.matchesConsidered || 0} M`;


        // Baue das HTML für die Detail-Karte
        cardElement.innerHTML = `
            <div class="card-header">
                <div class="player-info">
                    <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil öffnen">
                        <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                    </a>
                    <a href="${faceitProfileUrl}" target="_blank" class="player-name">
                        ${player.nickname}
                    </a>
                     <span style="font-size: 0.9em; color: #aaa;" title="Aktuelle Elo">(${player.elo || 'N/A'})</span>
                </div>
                <div class="stats-label" title="${lastUpdatedText}">${matchesConsideredText}</div>
            </div>
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="label" title="Berechnetes Perf. Rating (Basierend auf K/D, ADR, KPR, APR der letzten Matches)">Rating ≈</div>
                    <div class="value ${player.calculatedRating === 'N/A' || player.calculatedRating === 'Pending' ? 'na' : ''}">${player.calculatedRating || '...'}</div>
                    <div class="indicator-bar okay"><div class="bar-fill"></div></div> </div>
                <div class="stat-item">
                    <div class="label" title="K/D Ratio (Letzte Matches)">K/D</div>
                    <div class="value ${player.kd === 'N/A' || player.kd === 'Pending' ? 'na' : ''}">${player.kd || '...'}</div>
                     <div class="indicator-bar good"><div class="bar-fill"></div></div> </div>
                 <div class="stat-item">
                    <div class="label" title="Average Damage per Round (Letzte Matches)">ADR</div>
                    <div class="value ${player.adr === 'N/A' || player.adr === 'Pending' ? 'na' : ''}">${player.adr || '...'}</div>
                     <div class="indicator-bar okay"><div class="bar-fill"></div></div> </div>
                <div class="stat-item">
                    <div class="label" title="Win Rate % (Letzte Matches)">Win Rate</div>
                    <div class="value ${player.winRate === 'N/A' || player.winRate === 'Pending' ? 'na' : ''}">${player.winRate || '...'}%</div>
                     <div class="indicator-bar okay"><div class="bar-fill"></div></div> </div>
                 <div class="stat-item">
                    <div class="label" title="Headshot % (Letzte Matches)">HS %</div>
                    <div class="value ${player.hsPercent === 'N/A' || player.hsPercent === 'Pending' ? 'na' : ''}">${player.hsPercent || '...'}%</div>
                     <div class="indicator-bar good"><div class="bar-fill"></div></div> </div>
                <div class="stat-item">
                     <div class="label" title="Aktuelle Faceit Elo">Akt. Elo</div>
                     <div class="value ${player.elo === 'N/A' ? 'na' : ''}">${player.elo}</div>
                     <div class="indicator-bar good"><div class="bar-fill"></div></div> </div>
            </div>
         `;

        detailCardContainer.innerHTML = ''; // Alten Inhalt leeren
        detailCardContainer.appendChild(cardElement);
        detailCardContainer.style.display = 'block'; // Container anzeigen
        // Optional: Zum Detailbereich scrollen
        detailCardContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Alte Funktion zum direkten Anzeigen aller Karten ist nicht mehr nötig
    /* function displayPlayerCards(players) { ... } */


    // Hauptfunktion zum Laden aller Spieler
    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        playerGridContainer.innerHTML = ''; // Grid leeren
        detailCardContainer.style.display = 'none'; // Detailkarte verstecken
        detailCardContainer.innerHTML = ''; // Detailkarte leeren

        let playerNicknames = [];
        try {
            const response = await fetch('/players.json');
            if (!response.ok) { throw new Error(`Fehler Laden players.json: ${response.status}`); }
            playerNicknames = await response.json();
            if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) { throw new Error("players.json leer/falsches Format."); }

            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));
            // Speichere die Rohdaten global, nachdem alle Promises aufgelöst sind
            allPlayersData = await Promise.all(playerPromises);

            // Sortiere für die Grid-Reihenfolge (optional, Grid sortiert nicht visuell)
            // allPlayersData.sort((a, b) => b.sortElo - a.sortElo);

            // Zeige das Vorschau-Grid an
            displayPlayerGrid(allPlayersData);

        } catch (error) {
            console.error("Fehler Laden Spieler:", error);
            errorMessageElement.textContent = `Fehler: ${error.message}`;
            errorMessageElement.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none';
        }
    }

    // NEU: Event Listener für Klicks auf das Grid
    playerGridContainer.addEventListener('click', (event) => {
        // Finde das geklickte Vorschau-Item (oder ein Elternelement davon)
        const clickedItem = event.target.closest('.player-preview-item');

        if (clickedItem) {
            const nickname = clickedItem.dataset.nickname; // Hole Nickname aus data-Attribut
            if (nickname) {
                // Finde die Daten für den geklickten Spieler in unserem gespeicherten Array
                const playerData = allPlayersData.find(p => p.nickname === nickname);
                if (playerData) {
                    // Zeige die Detailkarte für diesen Spieler an
                    displayDetailCard(playerData);
                } else {
                    console.error("Konnte Spielerdaten für Klick nicht finden:", nickname);
                    // Zeige ggf. eine Fehlermeldung im Detailbereich an
                    displayDetailCard({ error: "Daten nicht gefunden." });
                }
            }
        }
    });

    // Lade die Spielerdaten initial, um das Grid zu füllen
    loadAllPlayers();
});