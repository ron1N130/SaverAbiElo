document.addEventListener('DOMContentLoaded', () => {
    // Elemente holen
    const playerListContainerEl = document.getElementById('player-list'); // Das <ol> Element
    const detailCardContainerEl = document.getElementById('player-detail-card-container');
    const mainContentAreaEl = document.getElementById('main-content-area');
    const loadingIndicatorEl = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');

    let allPlayersData = []; // Speichert alle Spielerdaten
    let currentlyDisplayedNickname = null; // Speichert den aktuell angezeigten Spieler

    // Funktion zum Abrufen von Spielerdaten (Backend unverändert)
    async function getPlayerData(nickname) {
        try {
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            const response = await fetch(apiUrl);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
                let displayError = errorData.error || `Server error: ${response.status}`;
                if (response.status === 404) { displayError = `Spieler "${nickname}" nicht gefunden.`; }
                else if (response.status === 500 && displayError.includes("KV")) { displayError = "Fehler beim Laden der Stats."; }
                else if (response.status === 500) { displayError = "Server-Konfigurationsfehler."; }
                else if (response.status === 403) { displayError = "Zugriff verweigert."; }
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

    // Funktion zum Anzeigen der sortierten Spielerliste
    function displayPlayerList(players) {
        if (!playerListContainerEl) return;
        playerListContainerEl.innerHTML = '';
        players.forEach((player) => {
            const listItem = document.createElement('li');
            // WICHTIG: data-nickname Attribut hinzufügen!
            listItem.setAttribute('data-nickname', player.nickname);

            if (player.error) {
                listItem.classList.add('error-item');
                // Zeige nur Name und Fehler
                listItem.innerHTML = `
                    <div class="player-info" style="flex-grow: 1;">
                        <span class="player-name">${player.nickname}</span>
                    </div>
                    <span class="error-text" style="font-size: 0.85em; text-align: right;">${player.error}</span>
                `;
            } else {
                const avatarUrl = player.avatar || 'default_avatar.png';
                const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http')
                    ? player.faceitUrl
                    : `https://${player.faceitUrl}`;
                // Zeige nur Avatar, Name und Elo in der Liste
                listItem.innerHTML = `
                    <div class="player-info">
                       <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil von ${player.nickname} öffnen" tabindex="-1">
                          <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                       </a>
                       <span class="player-name">
                           ${player.nickname}
                       </span>
                    </div>
                    <div class="player-elo">${player.elo === 'N/A' ? 'N/A' : player.elo}</div>
                 `;
            }
            playerListContainerEl.appendChild(listItem);
        });
    }

    // Funktion zum Anzeigen der Detail-Karte (generiert HLTV-Karte)
    function displayDetailCard(player) {
        if (!detailCardContainerEl || !mainContentAreaEl) return;
        detailCardContainerEl.innerHTML = ''; // Leeren

        if (!player || player.error) {
            // Fehler in der Detailkarte anzeigen (falls nötig)
            const cardElement = document.createElement('div');
            cardElement.classList.add('player-card-hltv', 'error-card');
            cardElement.innerHTML = `<span class="error-message">${player?.nickname || 'Spieler'} - Fehler: ${player?.error || 'Unbekannt'}</span>`;
            detailCardContainerEl.appendChild(cardElement);
            detailCardContainerEl.style.display = 'block'; // Sicherstellen, dass Container sichtbar ist
            mainContentAreaEl.classList.add('detail-visible'); // Layout aktivieren
            currentlyDisplayedNickname = player?.nickname || null; // Merken, auch bei Fehler
            requestAnimationFrame(() => { detailCardContainerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
            return;
        }

        const cardElement = document.createElement('div');
        cardElement.classList.add('player-card-hltv');

        const avatarUrl = player.avatar || 'default_avatar.png';
        const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http')
            ? player.faceitUrl
            : `https://${player.faceitUrl}`;
        const lastUpdatedText = player.lastUpdated
            ? `Stats vom ${new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}).format(new Date(player.lastUpdated))} Uhr`
            : 'Stats werden aktualisiert...';
        const matchesConsideredText = player.matchesConsidered ? `Last ~${player.matchesConsidered} M` : 'Recent Stats';

        // Baue das HTML für die Detail-Karte
        cardElement.innerHTML = `
            <div class="card-header"> <div class="player-info"> <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil öffnen"> <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';"> </a> <a href="${faceitProfileUrl}" target="_blank" class="player-name"> ${player.nickname} </a> </div> <div class="stats-label" title="${lastUpdatedText}">${matchesConsideredText}</div> </div>
            <div class="stats-grid">
                <div class="stat-item"> <div class="label" title="Berechnetes Perf. Rating (Letzte Matches)">Rating ≈</div> <div class="value ${player.calculatedRating === 'N/A' || player.calculatedRating === 'Pending' ? 'na' : ''}">${player.calculatedRating || '...'}</div> <div class="indicator-bar okay"><div class="bar-fill"></div></div> </div>
                <div class="stat-item"> <div class="label" title="K/D Ratio (Letzte Matches)">K/D</div> <div class="value ${player.kd === 'N/A' || player.kd === 'Pending' ? 'na' : ''}">${player.kd || '...'}</div> <div class="indicator-bar good"><div class="bar-fill"></div></div> </div>
                <div class="stat-item"> <div class="label" title="Average Damage per Round (Letzte Matches)">ADR</div> <div class="value ${player.adr === 'N/A' || player.adr === 'Pending' ? 'na' : ''}">${player.adr || '...'}</div> <div class="indicator-bar okay"><div class="bar-fill"></div></div> </div>
                <div class="stat-item"> <div class="label" title="Win Rate % (Letzte Matches)">Win Rate</div> <div class="value ${player.winRate === 'N/A' || player.winRate === 'Pending' ? 'na' : ''}">${player.winRate || '...'}%</div> <div class="indicator-bar okay"><div class="bar-fill"></div></div> </div>
                <div class="stat-item"> <div class="label" title="Headshot % (Letzte Matches)">HS %</div> <div class="value ${player.hsPercent === 'N/A' || player.hsPercent === 'Pending' ? 'na' : ''}">${player.hsPercent || '...'}%</div> <div class="indicator-bar good"><div class="bar-fill"></div></div> </div>
                <div class="stat-item"> <div class="label">Aktuelle Elo</div> <div class="value ${player.elo === 'N/A' ? 'na' : ''}">${player.elo}</div> <div class="indicator-bar good"><div class="bar-fill"></div></div> </div>
            </div>`;

        detailCardContainerEl.appendChild(cardElement);
        detailCardContainerEl.style.display = 'block';
        mainContentAreaEl.classList.add('detail-visible');
        currentlyDisplayedNickname = player.nickname;

        requestAnimationFrame(() => {
            detailCardContainerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }

    // Funktion zum Schließen/Verstecken der Detailkarte
    function hideDetailCard() {
        if (!detailCardContainerEl || !mainContentAreaEl) return;
        detailCardContainerEl.innerHTML = '';
        // detailCardContainerEl.style.display = 'none'; // Wird durch Klassenwechsel gesteuert
        mainContentAreaEl.classList.remove('detail-visible');
        currentlyDisplayedNickname = null;
    }

    // Hauptfunktion zum Laden aller Spieler
    async function loadAllPlayers() {
        loadingIndicatorEl.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        if(playerListContainerEl) playerListContainerEl.innerHTML = '';
        hideDetailCard(); // Details initial verstecken/zurücksetzen

        let playerNicknames = [];
        try {
            const response = await fetch('/players.json');
            if (!response.ok) { throw new Error(`Fehler Laden players.json: ${response.status}`); }
            playerNicknames = await response.json();
            if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) { throw new Error("players.json leer/falsches Format."); }

            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));
            allPlayersData = await Promise.all(playerPromises); // Speichere global

            // Sortiere für die Anzeige in der Liste
            allPlayersData.sort((a, b) => b.sortElo - a.sortElo);

            // Zeige die sortierte Liste an
            displayPlayerList(allPlayersData);

        } catch (error) {
            console.error("Fehler Laden Spieler:", error);
            errorMessageElement.textContent = `Fehler: ${error.message}`;
            errorMessageElement.style.display = 'block';
        } finally {
            loadingIndicatorEl.style.display = 'none';
        }
    }

    // Event Listener für Klicks auf die Liste (Container <ol>)
    if (playerListContainerEl) {
        playerListContainerEl.addEventListener('click', (event) => {
            // Finde das geklickte Listenelement <li>
            const clickedListItem = event.target.closest('li');
            if (clickedListItem && !clickedListItem.classList.contains('error-item')) {
                const nickname = clickedListItem.dataset.nickname; // Hole Nickname
                if (nickname) {
                    if (nickname === currentlyDisplayedNickname) {
                        // Derselbe Spieler wurde erneut geklickt -> Karte schließen
                        hideDetailCard();
                    } else {
                        // Anderer Spieler geklickt -> neue Karte anzeigen
                        const playerData = allPlayersData.find(p => p.nickname === nickname);
                        if (playerData) {
                            displayDetailCard(playerData);
                        } else {
                            console.error("Daten nicht gefunden für:", nickname);
                            hideDetailCard();
                        }
                    }
                }
            }
        });
    } else {
        console.error("FEHLER: Element mit ID 'player-list' nicht im HTML gefunden!");
        errorMessageElement.textContent = "Fehler beim Initialisieren der Seite (Liste nicht gefunden).";
        errorMessageElement.style.display = 'block';
        loadingIndicatorEl.style.display = 'none';
    }

    // Lade die Spielerdaten initial
    loadAllPlayers();
});