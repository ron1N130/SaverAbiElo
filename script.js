document.addEventListener('DOMContentLoaded', () => {
    // ... (Keep variable declarations and error checks as before) ...
    const playerList = document.getElementById('player-list');
    const detailCardContainer = document.getElementById('player-detail-card-container');
    const mainContentArea = document.getElementById('main-content-area');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');
    const playerListContainerEl = document.getElementById('player-list');

    let allPlayersData = [];
    let currentlyDisplayedNickname = null;

    const thresholds = {
        calculatedRating: {bad: 0.85, okay: 1.05, good: 1.25, max: 1.8},
        kd: {bad: 0.8, okay: 1.0, good: 1.2, max: 2.0},
        adr: {bad: 65, okay: 80, good: 95, max: 120},
        winRate: {bad: 40, okay: 50, good: 60, max: 100},
        hsPercent: {bad: 30, okay: 40, good: 50, max: 70},
        elo: {bad: 1100, okay: 1700, good: 2200, max: 3500}
    };

    // --- API Call Function --- (No changes needed)
    async function getPlayerData(nickname) {
        try {
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            const response = await fetch(apiUrl);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
                let displayError = errorData.error || `Server error: ${response.status}`;
                if (response.status === 404) displayError = `Spieler "${nickname}" nicht gefunden.`;
                else if (displayError.includes("API Key missing")) displayError = "Server-Konfigurationsfehler (API Key).";
                else if (displayError.includes("Database connection failed")) displayError = "Server-Konfigurationsfehler (DB).";
                else if (response.status === 500) displayError = "Interner Serverfehler.";
                throw new Error(displayError);
            }
            const playerData = await response.json();
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            playerData.level = parseInt(playerData.level, 10) || 0;
            playerData.calculatedRating = parseFloat(playerData.calculatedRating) || null;
            playerData.kd = parseFloat(playerData.kd) || null;
            playerData.adr = parseFloat(playerData.adr) || null;
            playerData.winRate = parseFloat(playerData.winRate) || null;
            playerData.hsPercent = parseFloat(playerData.hsPercent) || null;
            // Handle 'Pending' string specifically if it comes from API/Redis
            if (playerData.calculatedRating === 'Pending') playerData.calculatedRating = null;
            if (playerData.kd === 'Pending') playerData.kd = null;
            if (playerData.adr === 'Pending') playerData.adr = null;
            // etc. for other stats if needed
            return playerData;
        } catch (error) {
            console.error(`Fehler Daten ${nickname}:`, error);
            return {nickname: nickname, error: error.message, sortElo: -1, level: 0};
        }
    }


    // --- Elo Progress Bar Logic for List (Helper) --- (No changes needed)
    function updateEloProgressBarForList(container) {
        const elo = parseInt(container.dataset.elo || 0, 10);
        const bar = container.querySelector('.elo-progress-bar');
        if (!bar) return;
        const config = thresholds.elo;
        let percentage = 0;
        let barColor = 'var(--bar-color-bad)';
        if (elo !== null && !isNaN(elo) && elo > 0) {
            percentage = Math.min(100, Math.max(0, (elo / config.max) * 100));
            if (elo >= config.good) {
                barColor = 'var(--bar-color-good)';
            } else if (elo >= config.okay) {
                barColor = 'var(--bar-color-okay)';
            } else {
                barColor = 'var(--bar-color-bad)';
            }
        } else {
            percentage = 0;
            barColor = 'var(--bar-background)';
        }
        bar.style.width = `${percentage}%`;
        bar.style.backgroundColor = barColor;
    }


    // --- Display Sorted Player List --- (No changes needed)
    function displayPlayerList(players) {
        playerListContainerEl.innerHTML = '';
        players.forEach((player) => {
            const listItem = document.createElement('li');
            listItem.setAttribute('data-nickname', player.nickname);
            if (player.error) {
                listItem.classList.add('error-item');
                listItem.innerHTML = `<span class="player-info" style="justify-content: flex-start;">${player.nickname} - Fehler: ${player.error}</span>`;
            } else {
                const avatarUrl = player.avatar || 'default_avatar.png';
                listItem.innerHTML = `
                    <span class="player-info"><img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';"><span class="player-name">${player.nickname}</span></span>
                    <div class="player-list-right"><span class="player-elo">${player.elo || 'N/A'}</span><div class="elo-progress-container" data-elo="${player.sortElo || 0}"><div class="elo-progress-bar"></div></div></div>`;
                const progressBarContainer = listItem.querySelector('.elo-progress-container');
                if (progressBarContainer) {
                    updateEloProgressBarForList(progressBarContainer);
                }
            }
            playerListContainerEl.appendChild(listItem);
        });
    }


    // --- Helper Function to Update Stat Progress Bars AND Value Colors - UPDATED Fallback ---
    function updateStatProgressBars(cardElement, player) {
        const statItems = cardElement.querySelectorAll('.stat-item[data-stat]');

        statItems.forEach(item => {
            const statName = item.dataset.stat;
            const valueElement = item.querySelector('.value');
            const barElement = item.querySelector('.stat-progress-bar');
            const labelElement = item.querySelector('.stat-indicator-label');

            if (!statName || !thresholds[statName] || !valueElement) return;
            if (!barElement || !labelElement) return; // Ensure bar elements exist

            const value = (statName === 'elo') ? player.sortElo : player[statName];
            const config = thresholds[statName];

            let percentage = 0;
            let barColor = 'var(--bar-color-bad)';
            let indicatorText = '---';
            let valueClass = 'bad';

            valueElement.classList.remove('good', 'okay', 'bad', 'na');

            if (value !== null && value !== undefined && !isNaN(value)) {
                // Value is valid and numeric
                percentage = Math.min(100, Math.max(0, (value / config.max) * 100));
                if (value >= config.good) {
                    barColor = 'var(--bar-color-good)';
                    indicatorText = 'GOOD';
                    valueClass = 'good';
                } else if (value >= config.okay) {
                    barColor = 'var(--bar-color-okay)';
                    indicatorText = 'OKAY';
                    valueClass = 'okay';
                } else {
                    barColor = 'var(--bar-color-bad)';
                    indicatorText = 'BAD';
                    valueClass = 'bad'; // Changed from POOR to BAD
                }
                valueElement.classList.add(valueClass);
            } else {
                // --- Fallback logic for missing/pending stats ---
                percentage = 5; // Show a small sliver of the bar
                barColor = 'var(--bar-color-bad)'; // Make the sliver red
                indicatorText = 'POOR'; // Set indicator text to POOR
                valueClass = 'bad'; // Color the '0.00' value red
                valueElement.classList.add(valueClass);
                // Note: The '0.00' text is now set in displayDetailCard's innerHTML
            }

            barElement.style.width = `${percentage}%`;
            barElement.style.backgroundColor = barColor;
            labelElement.textContent = indicatorText;
        });
    }


    // --- Display Detail Card - UPDATED Fallback Values ---
    function displayDetailCard(player) {
        if (!detailCardContainer || !mainContentArea) return;
        const cardElement = document.createElement('div');
        cardElement.classList.add('player-card-hltv');
        detailCardContainer.style.display = 'block';
        detailCardContainer.innerHTML = '';

        if (!player || player.error) {
            cardElement.classList.add('error-card');
            const errorMessage = player ? player.error : "Spielerdaten konnten nicht geladen werden.";
            const nickname = player ? player.nickname : "Unbekannt";
            cardElement.innerHTML = `<span class="error-message">${nickname} - Fehler: ${errorMessage}</span>`;
        } else {
            const avatarUrl = player.avatar || 'default_avatar.png';
            const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http') ? player.faceitUrl : `https://www.faceit.com/en/players/${player.nickname}`;
            const lastUpdatedText = player.lastUpdated ? `Stats vom ${new Intl.DateTimeFormat('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).format(new Date(player.lastUpdated))} Uhr` : 'Stats werden aktualisiert...';
            const matchesConsideredText = player.matchesConsidered ? `Letzte ~${player.matchesConsidered} Matches` : 'Aktuelle Stats';

            // --- Updated innerHTML to show '0.00'/'0.0'/'0%' as fallback ---
            cardElement.innerHTML = `
                <div class="card-header"><div class="player-info"><a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil öffnen"><img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';"></a><a href="${faceitProfileUrl}" target="_blank" class="player-name"> ${player.nickname} </a></div><div class="stats-label" title="${lastUpdatedText}">${matchesConsideredText}</div></div>
                <div class="stats-grid">
                    <div class="stat-item" data-stat="calculatedRating"><div class="stat-header"><div class="label" title="Berechnetes Perf. Rating (Letzte Matches)">Rating 2.0</div><div class="value">${player.calculatedRating !== null ? player.calculatedRating.toFixed(2) : '0.00'}</div></div><div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                    <div class="stat-item" data-stat="kd"><div class="stat-header"><div class="label" title="K/D Ratio (Letzte Matches)">K/D</div><div class="value">${player.kd !== null ? player.kd.toFixed(2) : '0.00'}</div></div><div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                    <div class="stat-item" data-stat="adr"><div class="stat-header"><div class="label" title="Average Damage per Round (Letzte Matches)">ADR</div><div class="value">${player.adr !== null ? player.adr.toFixed(1) : '0.0'}</div></div><div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                    <div class="stat-item" data-stat="winRate"><div class="stat-header"><div class="label" title="Win Rate % (Letzte Matches)">Win Rate</div><div class="value">${player.winRate !== null ? player.winRate.toFixed(0) + '%' : '0%'}</div></div><div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                    <div class="stat-item" data-stat="hsPercent"><div class="stat-header"><div class="label" title="Headshot % (Letzte Matches)">HS %</div><div class="value">${player.hsPercent !== null ? player.hsPercent.toFixed(0) + '%' : '0%'}</div></div><div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                    <div class="stat-item" data-stat="elo"><div class="stat-header"><div class="label">Elo</div><div class="value">${player.sortElo || 'N/A'}</div></div><div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                </div>`;
            updateStatProgressBars(cardElement, player); // Call updater which handles coloring and bars
        }
        detailCardContainer.appendChild(cardElement);
        cardElement.classList.remove('is-hiding');
        mainContentArea.classList.add('detail-visible');
        currentlyDisplayedNickname = player?.nickname;
        requestAnimationFrame(() => {
            cardElement.style.opacity = '1';
            cardElement.style.transform = 'translateX(0)';
            setTimeout(() => {
                if (player && player.nickname === currentlyDisplayedNickname) {
                    cardElement.scrollIntoView({behavior: 'smooth', block: 'nearest'});
                }
            }, 100);
        });
    }


    // --- Hide Detail Card --- (No changes needed)
    function hideDetailCard() {
        if (!detailCardContainer || !mainContentArea) return;
        const cardElement = detailCardContainer.querySelector('.player-card-hltv');
        if (cardElement && mainContentArea.classList.contains('detail-visible')) {
            cardElement.style.opacity = '0';
            cardElement.style.transform = 'translateX(20px)';
            cardElement.classList.add('is-hiding');
            mainContentArea.classList.remove('detail-visible');
            const hidingNickname = currentlyDisplayedNickname;
            currentlyDisplayedNickname = null;
            const transitionDuration = 500;
            const transitionEndHandler = () => {
                if (currentlyDisplayedNickname === null && detailCardContainer.querySelector('.is-hiding')) {
                    detailCardContainer.style.display = 'none';
                    if (cardElement) cardElement.classList.remove('is-hiding');
                } else {
                    if (cardElement) cardElement.classList.remove('is-hiding');
                }
            };
            setTimeout(transitionEndHandler, transitionDuration);
        } else if (!mainContentArea.classList.contains('detail-visible')) {
            detailCardContainer.style.display = 'none';
            if (cardElement) cardElement.classList.remove('is-hiding');
            currentlyDisplayedNickname = null;
        }
    }


    // --- Load All Player Data --- (No changes needed)
    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        playerListContainerEl.innerHTML = '';
        hideDetailCard();
        allPlayersData = [];
        let playerNicknames = [];
        try {
            const response = await fetch('/players.json');
            if (!response.ok) {
                throw new Error(`Fehler Laden players.json: ${response.status}`);
            }
            playerNicknames = await response.json();
            if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) {
                throw new Error("players.json leer oder im falschen Format.");
            }
            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));
            const results = await Promise.allSettled(playerPromises);
            allPlayersData = results.map(result => {
                if (result.status === 'fulfilled') {
                    return result.value;
                } else {
                    console.error("Promise rejected:", result.reason);
                    const errorMessage = result.reason?.message || 'Unbekannter Fehler';
                    const match = errorMessage.match(/Spieler "([^"]+)" nicht gefunden/);
                    const nickname = match ? match[1] : 'Unbekannt';
                    return {nickname: nickname, error: errorMessage, sortElo: -1, level: 0};
                }
            });
            allPlayersData.sort((a, b) => {
                const aHasError = !!a.error;
                const bHasError = !!b.error;
                if (aHasError && !bHasError) return 1;
                if (!aHasError && bHasError) return -1;
                if (aHasError && bHasError) {
                    return a.nickname.localeCompare(b.nickname);
                }
                return (b.sortElo || 0) - (a.sortElo || 0);
            });
            displayPlayerList(allPlayersData);
        } catch (error) {
            console.error("Fehler Laden Spieler:", error);
            errorMessageElement.textContent = `Fehler: ${error.message}`;
            errorMessageElement.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none';
        }
    }


    // --- Event Listener for Player List Clicks --- (No changes needed)
    playerListContainerEl.addEventListener('click', (event) => {
        const clickedItem = event.target.closest('li');
        if (clickedItem && !clickedItem.classList.contains('error-item')) {
            const nickname = clickedItem.dataset.nickname;
            if (nickname) {
                if (nickname === currentlyDisplayedNickname) {
                    hideDetailCard();
                } else {
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


    // --- Initial Load ---
    loadAllPlayers();


    // --- Refresh Button --- (No changes needed)
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            console.log("Daten werden manuell neu geladen...");
            loadAllPlayers();
        });
    }
});