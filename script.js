document.addEventListener('DOMContentLoaded', () => {
    const playerGridContainer = document.getElementById('player-grid'); // Container für Vorschau-Grid
    const detailCardContainer = document.getElementById('player-detail-card-container'); // Container für Detailkarte
    const mainContentArea = document.getElementById('main-content-area'); // Haupt-Layout-Container
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');

    let allPlayersData = []; // Globale Variable zum Speichern aller Spielerdaten
    let currentlyDisplayedNickname = null; // Speichert den Nickname des aktuell angezeigten Spielers

    // Funktion zum Abrufen von Spielerdaten (unverändert)
    async function getPlayerData(nickname) {
        try {
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            const response = await fetch(apiUrl);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
                let displayError = errorData.error || `Server error: ${response.status}`;
                if (response.status === 404 && displayError.includes("nicht gefunden")) { displayError = `Spieler "${nickname}" nicht gefunden.`; }
                else if (response.status === 500 && displayError.includes("API Key missing")) { displayError = "Server-Konfigurationsfehler."; } // Angepasst nach KV Fix
                else if (response.status === 403) { displayError = "Zugriff verweigert."; }
                else if (response.status === 500 && errorData.error?.includes("KV")) { displayError = "Fehler beim Zugriff auf Speicher."; } // Spezifischer KV Fehler
                else { displayError = errorData.error || `Serverfehler: ${response.status}`; } // Allgemeiner Serverfehler
                throw new Error(displayError);
            }
            const playerData = await response.json();
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            // History wird nicht mehr im Frontend gebraucht
            // playerData.eloTimeHistory = Array.isArray(playerData.eloTimeHistory) ? playerData.eloTimeHistory : [];
            return playerData;
        } catch (error) {
            console.error(`Fehler Daten ${nickname}:`, error);
            return { nickname: nickname, error: error.message, sortElo: 0 };
        }
    }

    // Funktion zum Anzeigen des Vorschau-Grids (unverändert)
    function displayPlayerGrid(players) {
        if (!playerGridContainer) return; // Abbruch, falls Grid nicht da
        playerGridContainer.innerHTML = '';
        players.forEach((player) => {
            const previewItem = document.createElement('div');
            previewItem.classList.add('player-preview-item');
            previewItem.setAttribute('data-nickname', player.nickname);
            if (player.error) {
                previewItem.classList.add('error-item');
                previewItem.innerHTML = `<span class="player-name">${player.nickname}</span><span style="font-size: 0.8em;">Fehler</span>`;
            } else {
                const avatarUrl = player.avatar || 'default_avatar.png';
                previewItem.innerHTML = `<img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';"><span class="player-name">${player.nickname}</span>`;
            }
            playerGridContainer.appendChild(previewItem);
        });
    }

    // Funktion zum Anzeigen der Detail-Karte (unverändert)
    function displayDetailCard(player) {
        if (!detailCardContainer || !mainContentArea) return; // Abbruch, falls Elemente fehlen
        detailCardContainer.innerHTML = '';

        if (!player) {
            console.error("Keine Spielerdaten zum Anzeigen übergeben.");
            detailCardContainer.style.display = 'none';
            mainContentArea.classList.remove('detail-visible');
            currentlyDisplayedNickname = null;
            return;
        }

        const cardElement = document.createElement('div');
        cardElement.classList.add('player-card-hltv');

        if (player.error) {
            cardElement.classList.add('error-card');
            cardElement.innerHTML = `<span class="error-message">${player.nickname} - Fehler: ${player.error}</span>`;
        } else {
            const avatarUrl = player.avatar || 'default_avatar.png';
            const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http')
                ? player.faceitUrl
                : `https://${player.faceitUrl}`;
            const lastUpdatedText = player.lastUpdated
                ? `Stats vom ${new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}).format(new Date(player.lastUpdated))} Uhr`
                : 'Stats werden aktualisiert...';
            const matchesConsideredText = player.matchesConsidered ? `Last ~${player.matchesConsidered} M` : 'Recent Stats';

            cardElement.innerHTML = `
                <div class="card-header"> <div class="player-info"> <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil öffnen"> <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';"> </a> <a href="${faceitProfileUrl}" target="_blank" class="player-name"> ${player.nickname} </a> <span style="font-size: 0.9em; color: #aaa;" title="Aktuelle Elo">(${player.elo || 'N/A'})</span> </div> <div class="stats-label" title="${lastUpdatedText}">${matchesConsideredText}</div> </div>
                <div class="stats-grid">
                    <div class="stat-item"> <div class="label" title="Berechnetes Perf. Rating (Letzte Matches)">Rating ≈</div> <div class="value ${player.calculatedRating === 'N/A' || player.calculatedRating === 'Pending' ? 'na' : ''}">${player.calculatedRating || '...'}</div> <div class="indicator-bar okay"><div class="bar-fill"></div></div> </div>
                    <div class="stat-item"> <div class="label" title="K/D Ratio (Letzte Matches)">K/D</div> <div class="value ${player.kd === 'N/A' || player.kd === 'Pending' ? 'na' : ''}">${player.kd || '...'}</div> <div class="indicator-bar good"><div class="bar-fill"></div></div> </div>
                    <div class="stat-item"> <div class="label" title="Average Damage per Round (Letzte Matches)">ADR</div> <div class="value ${player.adr === 'N/A' || player.adr === 'Pending' ? 'na' : ''}">${player.adr || '...'}</div> <div class="indicator-bar okay"><div class="bar-fill"></div></div> </div>
                    <div class="stat-item"> <div class="label" title="Win Rate % (Letzte Matches)">Win Rate</div> <div class="value ${player.winRate === 'N/A' || player.winRate === 'Pending' ? 'na' : ''}">${player.winRate || '...'}%</div> <div class="indicator-bar okay"><div class="bar-fill"></div></div> </div>
                    <div class="stat-item"> <div class="label" title="Headshot % (Letzte Matches)">HS %</div> <div class="value ${player.hsPercent === 'N/A' || player.hsPercent === 'Pending' ? 'na' : ''}">${player.hsPercent || '...'}%</div> <div class="indicator-bar good"><div class="bar-fill"></div></div> </div>
                    <div class="stat-item"> <div class="label">Aktuelle Elo</div> <div class="value ${player.elo === 'N/A' ? 'na' : ''}">${player.elo}</div> <div class="indicator-bar good"><div class="bar-fill"></div></div> </div>
                </div>`;
        }

        detailCardContainer.appendChild(cardElement);
        detailCardContainer.style.display = 'block';
        if (mainContentArea) mainContentArea.classList.add('detail-visible');
        currentlyDisplayedNickname = player?.nickname;

        requestAnimationFrame(() => {
            detailCardContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }

    // Funktion zum Schließen/Verstecken der Detailkarte (unverändert)
    function hideDetailCard() {
        if (!detailCardContainer || !mainContentArea) return;
        detailCardContainer.innerHTML = '';
        detailCardContainer.style.display = 'none';
        mainContentArea.classList.remove('detail-visible');
        currentlyDisplayedNickname = null;
    }

    // Hauptfunktion zum Laden aller Spieler (unverändert)
    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block'; errorMessageElement.style.display = 'none'; errorMessageElement.textContent = ''; if(playerGridContainer) playerGridContainer.innerHTML = ''; hideDetailCard(); let playerNicknames = [];
        try {
            const response = await fetch('/players.json'); if (!response.ok) { throw new Error(`Fehler Laden players.json: ${response.status}`); } playerNicknames = await response.json(); if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) { throw new Error("players.json leer/falsches Format."); }
            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));
            allPlayersData = await Promise.all(playerPromises); // Speichere global
            allPlayersData.sort((a, b) => b.sortElo - a.sortElo);
            displayPlayerGrid(allPlayersData); // Zeige Grid
        } catch (error) { console.error("Fehler Laden Spieler:", error); errorMessageElement.textContent = `Fehler: ${error.message}`; errorMessageElement.style.display = 'block'; } finally { loadingIndicator.style.display = 'none'; }
    }

    // Event Listener für Klicks auf das Grid (JETZT MIT NULL CHECK)
    if (playerGridContainer) { // <<< NEUE PRÜFUNG
        playerGridContainer.addEventListener('click', (event) => {
            const clickedItem = event.target.closest('.player-preview-item');
            if (clickedItem && !clickedItem.classList.contains('error-item')) {
                const nickname = clickedItem.dataset.nickname;
                if (nickname) {
                    if (nickname === currentlyDisplayedNickname) {
                        hideDetailCard(); // Schließen
                    } else {
                        const playerData = allPlayersData.find(p => p.nickname === nickname);
                        if (playerData) {
                            displayDetailCard(playerData); // Anzeigen
                        } else {
                            console.error("Daten nicht gefunden für:", nickname);
                            hideDetailCard();
                        }
                    }
                }
            }
        });
    } else {
        // Gib eine Fehlermeldung aus, wenn das Grid-Element fehlt
        console.error("FEHLER: Element mit ID 'player-grid' nicht im HTML gefunden!");
        errorMessageElement.textContent = "Fehler beim Initialisieren der Seite (Grid nicht gefunden).";
        errorMessageElement.style.display = 'block';
        loadingIndicator.style.display = 'none';
    }

    // Lade die Spielerdaten initial
    loadAllPlayers();
});