document.addEventListener('DOMContentLoaded', () => {
    // Removed: const playerGridContainer = document.getElementById('player-grid');
    const playerList = document.getElementById('player-list'); // Container for the sorted list
    const detailCardContainer = document.getElementById('player-detail-card-container');
    const mainContentArea = document.getElementById('main-content-area');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');

    let allPlayersData = [];
    let currentlyDisplayedNickname = null;

    // --- Error Handling & Basic Checks ---
    if (!playerList || !detailCardContainer || !mainContentArea || !loadingIndicator || !errorMessageElement) {
        console.error("FEHLER: Wichtige HTML-Elemente (Liste, Detail, Layout, Ladeanzeige oder Fehlermeldung) fehlen!");
        errorMessageElement.textContent = "Fehler beim Initialisieren: Wichtige Seitenelemente nicht gefunden.";
        errorMessageElement.style.display = 'block';
        if(loadingIndicator) loadingIndicator.style.display = 'none';
        return; // Stop execution if essential elements are missing
    }

    // --- API Call Function ---
    async function getPlayerData(nickname) {
        try {
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            const response = await fetch(apiUrl);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
                let displayError = errorData.error || `Server error: ${response.status}`;
                // More specific error messages
                if (response.status === 404) displayError = `Spieler "${nickname}" nicht gefunden.`;
                else if (displayError.includes("API Key missing")) displayError = "Server-Konfigurationsfehler (API Key).";
                else if (displayError.includes("Database connection failed")) displayError = "Server-Konfigurationsfehler (DB).";
                else if (response.status === 500) displayError = "Interner Serverfehler.";

                throw new Error(displayError);
            }
            const playerData = await response.json();
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            return playerData;
        } catch (error) {
            console.error(`Fehler Daten ${nickname}:`, error);
            // Return error object compatible with list display
            return { nickname: nickname, error: error.message, sortElo: -1 }; // Errors sort last
        }
    }

    // --- Display Sorted Player List ---
    function displayPlayerList(players) {
        playerList.innerHTML = ''; // Clear previous list
        players.forEach((player) => {
            const listItem = document.createElement('li');
            listItem.setAttribute('data-nickname', player.nickname);

            if (player.error) {
                listItem.classList.add('error-item');
                listItem.innerHTML = `<span class="player-info" style="justify-content: flex-start;">${player.nickname} - Fehler: ${player.error}</span>`;
            } else {
                const avatarUrl = player.avatar || 'default_avatar.png'; // Use default if none
                listItem.innerHTML = `
                    <span class="player-info">
                        <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                        <span class="player-name">${player.nickname}</span>
                    </span>
                    <span class="player-elo">${player.elo || 'N/A'}</span>
                `;
            }
            playerList.appendChild(listItem);
        });
    }

    // --- Display Detail Card ---
    function displayDetailCard(player) {
        if (!detailCardContainer || !mainContentArea) return;
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
                : `https://www.faceit.com/en/players/${player.nickname}`; // Construct URL if needed
            const lastUpdatedText = player.lastUpdated
                ? `Stats vom ${new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'} ).format(new Date(player.lastUpdated))} Uhr`
                : 'Stats werden aktualisiert...';
            const matchesConsideredText = player.matchesConsidered ? `Last ~${player.matchesConsidered} M` : 'Recent Stats';

            cardElement.innerHTML = `
                <div class="card-header">
                     <div class="player-info">
                         <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil öffnen">
                             <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                         </a>
                         <a href="${faceitProfileUrl}" target="_blank" class="player-name"> ${player.nickname} </a>
                         <span style="font-size: 0.9em; color: #aaa;" title="Aktuelle Elo">(${player.elo || 'N/A'})</span>
                     </div>
                     <div class="stats-label" title="${lastUpdatedText}">${matchesConsideredText}</div>
                 </div>
                <div class="stats-grid">
                    <div class="stat-item"> <div class="label" title="Berechnetes Perf. Rating (Letzte Matches)">Rating 2.0 =</div> <div class="value ${!player.calculatedRating || player.calculatedRating === 'N/A' || player.calculatedRating === 'Pending' ? 'na' : ''}">${player.calculatedRating || '...'}</div></div>
                    <div class="stat-item"> <div class="label" title="K/D Ratio (Letzte Matches)">K/D</div> <div class="value ${!player.kd || player.kd === 'N/A' || player.kd === 'Pending' ? 'na' : ''}">${player.kd || '...'}</div></div>
                    <div class="stat-item"> <div class="label" title="Average Damage per Round (Letzte Matches)">ADR</div> <div class="value ${!player.adr || player.adr === 'N/A' || player.adr === 'Pending' ? 'na' : ''}">${player.adr || '...'}</div></div>
                    <div class="stat-item"> <div class="label" title="Win Rate % (Letzte Matches)">Win Rate</div> <div class="value ${!player.winRate || player.winRate === 'N/A' || player.winRate === 'Pending' ? 'na' : ''}">${player.winRate !== undefined ? player.winRate + '%' : '...'}</div></div>
                    <div class="stat-item"> <div class="label" title="Headshot % (Letzte Matches)">HS %</div> <div class="value ${!player.hsPercent || player.hsPercent === 'N/A' || player.hsPercent === 'Pending' ? 'na' : ''}">${player.hsPercent !== undefined ? player.hsPercent + '%' : '...'}</div></div>
                    <div class="stat-item"> <div class="label">Elo</div> <div class="value ${!player.elo || player.elo === 'N/A' ? 'na' : ''}">${player.elo}</div></div>
                </div>`;
        }

        detailCardContainer.appendChild(cardElement);
        detailCardContainer.style.display = 'block'; // Ensure it's block for transition
        mainContentArea.classList.add('detail-visible'); // Trigger layout shift/transition
        currentlyDisplayedNickname = player?.nickname;

        // Scroll into view smoothly after transition starts
        requestAnimationFrame(() => {
            setTimeout(() => { // Small delay to allow transition to start
                cardElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100); // Adjust delay if needed
        });
    }

    // --- Hide Detail Card ---
    function hideDetailCard() {
        if (!detailCardContainer || !mainContentArea) return;
        // detailCardContainer.innerHTML = ''; // Keep content during transition out
        mainContentArea.classList.remove('detail-visible'); // Trigger transition
        currentlyDisplayedNickname = null;

        // Optional: Clear content after transition ends
        // detailCardContainer.addEventListener('transitionend', () => {
        //    detailCardContainer.innerHTML = '';
        // }, { once: true });
    }

    // --- Load All Player Data ---
    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        playerList.innerHTML = ''; // Clear list initially
        hideDetailCard();
        let playerNicknames = [];

        try {
            // Fetch player list from players.json
            const response = await fetch('/players.json');
            if (!response.ok) {
                throw new Error(`Fehler Laden players.json: ${response.status}`);
            }
            playerNicknames = await response.json();
            if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) {
                throw new Error("players.json leer oder im falschen Format.");
            }

            // Fetch data for all players
            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));
            allPlayersData = await Promise.all(playerPromises);

            // Sort players by ELO (descending), errors last
            allPlayersData.sort((a, b) => {
                if (a.error && !b.error) return 1; // a has error, b doesn't -> a comes after b
                if (!a.error && b.error) return -1; // a doesn't have error, b does -> a comes before b
                return b.sortElo - a.sortElo; // Both have/don't have error, sort by ELO
            });

            // Display the sorted list
            displayPlayerList(allPlayersData);

        } catch (error) {
            console.error("Fehler Laden Spieler:", error);
            errorMessageElement.textContent = `Fehler: ${error.message}`;
            errorMessageElement.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none';
        }
    }

    // --- Event Listener for Player List Clicks ---
    playerList.addEventListener('click', (event) => {
        const clickedItem = event.target.closest('li'); // Find the clicked list item
        if (clickedItem && !clickedItem.classList.contains('error-item')) {
            const nickname = clickedItem.dataset.nickname;
            if (nickname) {
                if (nickname === currentlyDisplayedNickname) {
                    hideDetailCard(); // Clicked the same player, hide the card
                } else {
                    // Find the player data in the already fetched array
                    const playerData = allPlayersData.find(p => p.nickname === nickname);
                    if (playerData) {
                        displayDetailCard(playerData); // Display the new player's card
                    } else {
                        console.error("Daten nicht gefunden für:", nickname);
                        hideDetailCard(); // Hide card if data is somehow missing
                    }
                }
            }
        }
    });

    // --- Initial Load ---
    loadAllPlayers();
});