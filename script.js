document.addEventListener('DOMContentLoaded', () => {
    const playerList = document.getElementById('player-list');
    const detailCardContainer = document.getElementById('player-detail-card-container');
    const mainContentArea = document.getElementById('main-content-area');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');
    const playerListContainerEl = document.getElementById('player-list'); // The <ol> element

    let allPlayersData = [];
    let currentlyDisplayedNickname = null;

    // --- Error Handling & Basic Checks ---
    if (!playerList || !detailCardContainer || !mainContentArea || !loadingIndicator || !errorMessageElement || !playerListContainerEl) {
        console.error("FEHLER: Wichtige HTML-Elemente fehlen!");
        errorMessageElement.textContent = "Fehler beim Initialisieren: Wichtige Seitenelemente nicht gefunden.";
        errorMessageElement.style.display = 'block';
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        return;
    }

    // --- API Call Function ---
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
            // Ensure numeric types
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            // Store level also numerically if available
            playerData.level = parseInt(playerData.level, 10) || 0; // Added level parsing
            playerData.calculatedRating = parseFloat(playerData.calculatedRating) || null;
            playerData.kd = parseFloat(playerData.kd) || null;
            playerData.adr = parseFloat(playerData.adr) || null;
            playerData.winRate = parseFloat(playerData.winRate) || null;
            playerData.hsPercent = parseFloat(playerData.hsPercent) || null;
            return playerData;
        } catch (error) {
            console.error(`Fehler Daten ${nickname}:`, error);
            return {nickname: nickname, error: error.message, sortElo: -1, level: 0}; // Include level default
        }
    }

    // --- Elo Progress Bar Logic for List (Helper) ---
    function updateEloProgressBarForList(container) {
        const elo = parseInt(container.dataset.elo || 0, 10);
        const level = parseInt(container.dataset.level || 0, 10);
        const bar = container.querySelector('.elo-progress-bar');
        if (!bar || level === 0) return;

        // Simplified Elo ranges per level (adjust if needed)
        const eloRanges = {
            1: [1, 800], 2: [801, 950], 3: [951, 1100], 4: [1101, 1250],
            5: [1251, 1400], 6: [1401, 1550], 7: [1551, 1700], 8: [1701, 1850],
            9: [1851, 2000], 10: [2001, 5000] // Define a practical max for level 10 scaling if needed
        };
        // Faceit Level Colors (ensure these match CSS variables)
        const levelColors = {
            1: '#808080', 2: '#808080', 3: '#FFC107', 4: '#FFC107', 5: '#FFC107',
            6: '#FFC107', 7: '#FFC107', 8: '#ff5e00', 9: '#ff5e00', 10: '#d60e00'
        };

        let progressPercent = 0;
        let barColor = levelColors[1]; // Default grey

        if (level >= 1 && level <= 9) {
            const [minElo, maxElo] = eloRanges[level]; // Not really used here, next level matters
            const nextLevelMinElo = eloRanges[level + 1] ? eloRanges[level + 1][0] : eloRanges[level][1]; // Find start of next level
            const currentLevelMinElo = eloRanges[level][0];
            const rangeSize = nextLevelMinElo - currentLevelMinElo;
            if (rangeSize > 0) {
                const eloInLevel = Math.max(0, elo - currentLevelMinElo);
                progressPercent = Math.min(100, (eloInLevel / rangeSize) * 100);
            } else {
                progressPercent = 100; // Handle potential division by zero or invalid range
            }
            barColor = levelColors[level] || levelColors[1];
        } else if (level === 10) {
            // Option 1: Always 100% for Level 10
            // progressPercent = 100;
            // Option 2: Scale within Level 10 (e.g., 2001 to 3000 represents 0-100%)
            const minElo10 = eloRanges[10][0];
            const scaleMaxElo10 = 3000; // Example: Scale up to 3000 Elo
            const rangeSize10 = scaleMaxElo10 - minElo10;
            if (rangeSize10 > 0) {
                const eloInLevel10 = Math.max(0, elo - minElo10);
                progressPercent = Math.min(100, (eloInLevel10 / rangeSize10) * 100);
            } else {
                progressPercent = 100;
            }
            barColor = levelColors[10];
        }

        bar.style.width = `${progressPercent}%`;
        bar.style.backgroundColor = barColor; // Directly set color
    }

    // --- Display Sorted Player List ---
    function displayPlayerList(players) {
        playerListContainerEl.innerHTML = ''; // Clear the list <ol>
        players.forEach((player) => {
            const listItem = document.createElement('li');
            listItem.setAttribute('data-nickname', player.nickname);

            if (player.error) {
                listItem.classList.add('error-item');
                listItem.innerHTML = `<span class="player-info" style="justify-content: flex-start;">${player.nickname} - Fehler: ${player.error}</span>`;
            } else {
                const avatarUrl = player.avatar || 'default_avatar.png';
                // --- RE-ADDED Elo Progress Bar HTML ---
                listItem.innerHTML = `
                    <span class="player-info">
                        <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                        <span class="player-name">${player.nickname}</span>
                    </span>
                    <div class="player-list-right">
                          <span class="player-elo">${player.elo || 'N/A'}</span>
                           <div class="elo-progress-container" data-elo="${player.sortElo || 0}" data-level="${player.level || 0}">
                                <div class="elo-progress-bar"></div>
                           </div>
                     </div>
                `;
                // --- Update the list progress bar ---
                const progressBarContainer = listItem.querySelector('.elo-progress-container');
                if (progressBarContainer) {
                    updateEloProgressBarForList(progressBarContainer);
                }
            }
            playerListContainerEl.appendChild(listItem);
        });
    }

    // --- Helper Function to Update Stat Progress Bars in Detail Card ---
    function updateStatProgressBars(cardElement, player) {
        const statItems = cardElement.querySelectorAll('.stat-item[data-stat]'); // Select only items with data-stat

        // Define thresholds and ranges (adjust these values!)
        // Added Elo thresholds - based on common skill levels maybe?
        const thresholds = {
            calculatedRating: {bad: 0.85, okay: 1.05, good: 1.25, max: 1.8},
            kd: {bad: 0.8, okay: 1.0, good: 1.2, max: 2.0},
            adr: {bad: 65, okay: 80, good: 95, max: 120},
            winRate: {bad: 40, okay: 50, good: 60, max: 100},
            hsPercent: {bad: 30, okay: 40, good: 50, max: 70},
            elo: {bad: 1100, okay: 1700, good: 2200, max: 3500} // Elo thresholds - Adjust!
        };

        statItems.forEach(item => {
            const statName = item.dataset.stat;
            const valueElement = item.querySelector('.value');
            const barElement = item.querySelector('.stat-progress-bar');
            const labelElement = item.querySelector('.stat-indicator-label');

            // Ensure all elements exist AND the stat is in our thresholds config
            if (!statName || !thresholds[statName] || !barElement || !labelElement || !valueElement) {
                // console.warn(`Skipping progress bar update for item, missing elements or config:`, item);
                return;
            }

            // Use the potentially parsed numeric value from getPlayerData
            const value = (statName === 'elo') ? player.sortElo : player[statName];
            const config = thresholds[statName];

            let percentage = 0;
            let barColor = 'var(--bar-color-bad)';
            let indicatorText = '---';

            // Use valueElement.classList.contains('na') or check if value is null/undefined
            if (value !== null && value !== undefined && !valueElement.classList.contains('na')) {
                // Check if value is numeric after confirming it's not null/undefined
                if (!isNaN(value)) {
                    percentage = Math.min(100, Math.max(0, (value / config.max) * 100));

                    if (value >= config.good) {
                        barColor = 'var(--bar-color-good)';
                        indicatorText = 'GOOD';
                    } else if (value >= config.okay) {
                        barColor = 'var(--bar-color-okay)';
                        indicatorText = 'OKAY';
                    } else {
                        barColor = 'var(--bar-color-bad)';
                        indicatorText = 'BAD';
                        // Optional stricter bad check
                        // indicatorText = (value < config.bad) ? 'BAD' : 'POOR'; // Example
                    }
                } else {
                    // Value exists but is not a number (e.g., "Pending")
                    indicatorText = valueElement.textContent; // Show "Pending" or similar
                    barColor = 'var(--bar-background)';
                }

            } else {
                // Handle N/A states explicitly marked with 'na' class or null value
                percentage = 0;
                barColor = 'var(--bar-background)';
                indicatorText = 'N/A';
                if (valueElement.textContent === '...') indicatorText = '...';
            }


            barElement.style.width = `${percentage}%`;
            barElement.style.backgroundColor = barColor;
            labelElement.textContent = indicatorText;
        });
    }


    // --- Display Detail Card ---
    function displayDetailCard(player) {
        if (!detailCardContainer || !mainContentArea) return;

        const cardElement = document.createElement('div');
        cardElement.classList.add('player-card-hltv');

        detailCardContainer.style.display = 'block';
        detailCardContainer.innerHTML = ''; // Clear previous card

        if (!player || player.error) {
            cardElement.classList.add('error-card');
            const errorMessage = player ? player.error : "Spielerdaten konnten nicht geladen werden.";
            const nickname = player ? player.nickname : "Unbekannt";
            cardElement.innerHTML = `<span class="error-message">${nickname} - Fehler: ${errorMessage}</span>`;
        } else {
            const avatarUrl = player.avatar || 'default_avatar.png';
            const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http')
                ? player.faceitUrl
                : `https://www.faceit.com/en/players/${player.nickname}`;
            const lastUpdatedText = player.lastUpdated
                ? `Stats vom ${new Intl.DateTimeFormat('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(new Date(player.lastUpdated))} Uhr`
                : 'Stats werden aktualisiert...';
            const matchesConsideredText = player.matchesConsidered ? `Letzte ~${player.matchesConsidered} Matches` : 'Aktuelle Stats';

            // --- Updated HTML including Elo progress bar container ---
            cardElement.innerHTML = `
                <div class="card-header">
                     <div class="player-info">
                         <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil öffnen">
                             <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                         </a>
                         <a href="${faceitProfileUrl}" target="_blank" class="player-name"> ${player.nickname} </a>
                         </div>
                     <div class="stats-label" title="${lastUpdatedText}">${matchesConsideredText}</div>
                 </div>
                <div class="stats-grid">
                    <div class="stat-item" data-stat="calculatedRating">
                        <div class="stat-header">
                            <div class="label" title="Berechnetes Perf. Rating (Letzte Matches)">Rating 2.0</div>
                            <div class="value ${player.calculatedRating === null ? 'na' : ''}">${player.calculatedRating !== null ? player.calculatedRating.toFixed(2) : '...'}</div>
                        </div>
                        <div class="stat-progress-container">
                             <div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span>
                        </div>
                    </div>
                     <div class="stat-item" data-stat="kd">
                        <div class="stat-header">
                            <div class="label" title="K/D Ratio (Letzte Matches)">K/D</div>
                            <div class="value ${player.kd === null ? 'na' : ''}">${player.kd !== null ? player.kd.toFixed(2) : '...'}</div>
                        </div>
                        <div class="stat-progress-container">
                             <div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span>
                        </div>
                    </div>
                     <div class="stat-item" data-stat="adr">
                        <div class="stat-header">
                             <div class="label" title="Average Damage per Round (Letzte Matches)">ADR</div>
                            <div class="value ${player.adr === null ? 'na' : ''}">${player.adr !== null ? player.adr.toFixed(1) : '...'}</div>
                        </div>
                        <div class="stat-progress-container">
                             <div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span>
                        </div>
                    </div>
                    <div class="stat-item" data-stat="winRate">
                        <div class="stat-header">
                            <div class="label" title="Win Rate % (Letzte Matches)">Win Rate</div>
                            <div class="value ${player.winRate === null ? 'na' : ''}">${player.winRate !== null ? player.winRate.toFixed(0) + '%' : '...'}</div>
                        </div>
                        <div class="stat-progress-container">
                             <div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span>
                        </div>
                    </div>
                    <div class="stat-item" data-stat="hsPercent">
                         <div class="stat-header">
                             <div class="label" title="Headshot % (Letzte Matches)">HS %</div>
                             <div class="value ${player.hsPercent === null ? 'na' : ''}">${player.hsPercent !== null ? player.hsPercent.toFixed(0) + '%' : '...'}</div>
                         </div>
                         <div class="stat-progress-container">
                             <div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span>
                        </div>
                    </div>
                    <div class="stat-item" data-stat="elo">
                         <div class="stat-header">
                            <div class="label">Elo</div>
                            <div class="value ${!player.sortElo || player.sortElo === 0 ? 'na' : ''}">${player.sortElo || 'N/A'}</div>
                         </div>
                          <div class="stat-progress-container">
                             <div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span>
                        </div>
                    </div>
                </div>`;

            updateStatProgressBars(cardElement, player);
        }

        detailCardContainer.appendChild(cardElement);
        cardElement.classList.remove('is-hiding');

        mainContentArea.classList.add('detail-visible'); // This class now triggers the list's transform via CSS
        currentlyDisplayedNickname = player?.nickname;

        requestAnimationFrame(() => {
            cardElement.style.opacity = '1';
            cardElement.style.transform = 'translateX(0)';
            setTimeout(() => {
                if (player && player.nickname === currentlyDisplayedNickname) {
                    cardElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 100);
        });
    }


    // --- Hide Detail Card ---
    function hideDetailCard() {
        if (!detailCardContainer || !mainContentArea) return;
        const cardElement = detailCardContainer.querySelector('.player-card-hltv');

        if (cardElement && mainContentArea.classList.contains('detail-visible')) {
            cardElement.style.opacity = '0';
            cardElement.style.transform = 'translateX(20px)';
            cardElement.classList.add('is-hiding');

            mainContentArea.classList.remove('detail-visible'); // Triggers list transform back to center
            const hidingNickname = currentlyDisplayedNickname;
            currentlyDisplayedNickname = null;

            const transitionDuration = 500;
            const transitionEndHandler = () => {
                if (currentlyDisplayedNickname === null && detailCardContainer.querySelector('.is-hiding')) {
                    detailCardContainer.style.display = 'none';
                    if (cardElement) cardElement.classList.remove('is-hiding');
                } else {
                    if(cardElement) cardElement.classList.remove('is-hiding');
                }
            };
            setTimeout(transitionEndHandler, transitionDuration);
        } else if (!mainContentArea.classList.contains('detail-visible')) {
            detailCardContainer.style.display = 'none';
            if(cardElement) cardElement.classList.remove('is-hiding');
            currentlyDisplayedNickname = null;
        }
    }


    // --- Load All Player Data ---
    // Keep loadAllPlayers function as is from the previous step


    // --- Event Listener for Player List Clicks ---
    // Keep event listener function as is from the previous step


    // --- Initial Load ---
    // loadAllPlayers(); // Call loadAllPlayers as before

    // --- Load All Player Data ---
    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        playerListContainerEl.innerHTML = ''; // Clear the list <ol>
        hideDetailCard(); // Ensure detail card is hidden initially
        allPlayersData = []; // Clear previous data
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
                    // Ensure level is set for error objects too if needed elsewhere
                    return {nickname: nickname, error: errorMessage, sortElo: -1, level: 0};
                }
            });

            allPlayersData.sort((a, b) => {
                const aHasError = !!a.error;
                const bHasError = !!b.error;
                if (aHasError && !bHasError) return 1;
                if (!aHasError && bHasError) return -1;
                if (aHasError && bHasError) { // Sort errors alphabetically by name
                    return a.nickname.localeCompare(b.nickname);
                }
                // Both valid, sort by ELO descending
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

    // --- Event Listener for Player List Clicks ---
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


    // Refresh functionality (if button exists)
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            console.log("Daten werden manuell neu geladen...");
            loadAllPlayers();
        });
    }
});