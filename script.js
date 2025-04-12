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
    // (Keep API call function as is from previous step)
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
            playerData.level = parseInt(playerData.level, 10) || 0;
            playerData.calculatedRating = parseFloat(playerData.calculatedRating) || null;
            playerData.kd = parseFloat(playerData.kd) || null;
            playerData.adr = parseFloat(playerData.adr) || null;
            playerData.winRate = parseFloat(playerData.winRate) || null;
            playerData.hsPercent = parseFloat(playerData.hsPercent) || null;
            return playerData;
        } catch (error) {
            console.error(`Fehler Daten ${nickname}:`, error);
            return {nickname: nickname, error: error.message, sortElo: -1, level: 0};
        }
    }


    // --- Elo Progress Bar Logic for List (Helper) ---
    // (Keep this function as is from previous step)
    function updateEloProgressBarForList(container) {
        const elo = parseInt(container.dataset.elo || 0, 10);
        const level = parseInt(container.dataset.level || 0, 10);
        const bar = container.querySelector('.elo-progress-bar');
        if (!bar || level === 0) return;
        const eloRanges = {
            1: [1, 800],
            2: [801, 950],
            3: [951, 1100],
            4: [1101, 1250],
            5: [1251, 1400],
            6: [1401, 1550],
            7: [1551, 1700],
            8: [1701, 1850],
            9: [1851, 2000],
            10: [2001, 5000]
        };
        const levelColors = {
            1: '#808080',
            2: '#808080',
            3: '#FFC107',
            4: '#FFC107',
            5: '#FFC107',
            6: '#FFC107',
            7: '#FFC107',
            8: '#ff5e00',
            9: '#ff5e00',
            10: '#d60e00'
        };
        let progressPercent = 0;
        let barColor = levelColors[1];
        if (level >= 1 && level <= 9) {
            const nextLevelMinElo = eloRanges[level + 1] ? eloRanges[level + 1][0] : eloRanges[level][1];
            const currentLevelMinElo = eloRanges[level][0];
            const rangeSize = nextLevelMinElo - currentLevelMinElo;
            if (rangeSize > 0) {
                const eloInLevel = Math.max(0, elo - currentLevelMinElo);
                progressPercent = Math.min(100, (eloInLevel / rangeSize) * 100);
            } else {
                progressPercent = 100;
            }
            barColor = levelColors[level] || levelColors[1];
        } else if (level === 10) {
            const minElo10 = eloRanges[10][0];
            const scaleMaxElo10 = 3000;
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
        bar.style.backgroundColor = barColor;
    }


    // --- Display Sorted Player List ---
    // (Keep this function as is from previous step, calling updateEloProgressBarForList)
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
                const progressBarContainer = listItem.querySelector('.elo-progress-container');
                if (progressBarContainer) {
                    updateEloProgressBarForList(progressBarContainer);
                }
            }
            playerListContainerEl.appendChild(listItem);
        });
    }


    // --- Helper Function to Update Stat Progress Bars AND Value Colors ---
    function updateStatProgressBars(cardElement, player) {
        const statItems = cardElement.querySelectorAll('.stat-item[data-stat]');

        // Define thresholds (same as before)
        const thresholds = {
            calculatedRating: {bad: 0.85, okay: 1.05, good: 1.25, max: 1.8},
            kd: {bad: 0.8, okay: 1.0, good: 1.2, max: 2.0},
            adr: {bad: 65, okay: 80, good: 95, max: 120},
            winRate: {bad: 40, okay: 50, good: 60, max: 100},
            hsPercent: {bad: 30, okay: 40, good: 50, max: 70},
            elo: {bad: 1100, okay: 1700, good: 2200, max: 3500}
        };

        statItems.forEach(item => {
            const statName = item.dataset.stat;
            const valueElement = item.querySelector('.value');
            const barElement = item.querySelector('.stat-progress-bar');
            const labelElement = item.querySelector('.stat-indicator-label');

            if (!statName || !thresholds[statName] || !valueElement) { // Bar/Label might not exist for all stats if we hide them
                // console.warn(`Skipping progress bar update for item, missing elements or config:`, item);
                return;
            }
            // Ensure bar and label elements exist if we intend to update them
            if (!barElement || !labelElement) return;


            const value = (statName === 'elo') ? player.sortElo : player[statName];
            const config = thresholds[statName];

            let percentage = 0;
            let barColor = 'var(--bar-color-bad)';
            let indicatorText = '---';
            let valueClass = 'bad'; // Default class for value color

            // --- Reset classes first ---
            valueElement.classList.remove('good', 'okay', 'bad', 'na');

            if (value !== null && value !== undefined && !isNaN(value)) {
                // Value is valid and numeric
                percentage = Math.min(100, Math.max(0, (value / config.max) * 100));

                if (value >= config.good) {
                    barColor = 'var(--bar-color-good)';
                    indicatorText = 'GOOD';
                    valueClass = 'good'; // Set class for value color
                } else if (value >= config.okay) {
                    barColor = 'var(--bar-color-okay)';
                    indicatorText = 'OKAY';
                    valueClass = 'okay'; // Set class for value color
                } else {
                    barColor = 'var(--bar-color-bad)';
                    indicatorText = 'BAD';
                    valueClass = 'bad'; // Set class for value color
                }
                valueElement.classList.add(valueClass); // Add the determined class

            } else {
                // Handle N/A or Pending states
                percentage = 0;
                barColor = 'var(--bar-background)';
                indicatorText = 'N/A';
                if (valueElement.textContent === '...') indicatorText = '...';
                valueElement.classList.add('na'); // Add 'na' class for styling
            }


            // Apply styles and text
            barElement.style.width = `${percentage}%`;
            barElement.style.backgroundColor = barColor;
            labelElement.textContent = indicatorText;
        });
    }


    // --- Display Detail Card ---
    // (Keep structure mostly the same, ensure updateStatProgressBars is called)
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
                        <div class="stat-header"><div class="label" title="Berechnetes Perf. Rating (Letzte Matches)">Rating 2.0</div><div class="value">${player.calculatedRating !== null ? player.calculatedRating.toFixed(2) : '...'}</div></div>
                        <div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div>
                    </div>
                     <div class="stat-item" data-stat="kd">
                        <div class="stat-header"><div class="label" title="K/D Ratio (Letzte Matches)">K/D</div><div class="value">${player.kd !== null ? player.kd.toFixed(2) : '...'}</div></div>
                        <div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div>
                    </div>
                     <div class="stat-item" data-stat="adr">
                        <div class="stat-header"><div class="label" title="Average Damage per Round (Letzte Matches)">ADR</div><div class="value">${player.adr !== null ? player.adr.toFixed(1) : '...'}</div></div>
                        <div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div>
                    </div>
                    <div class="stat-item" data-stat="winRate">
                        <div class="stat-header"><div class="label" title="Win Rate % (Letzte Matches)">Win Rate</div><div class="value">${player.winRate !== null ? player.winRate.toFixed(0) + '%' : '...'}</div></div>
                        <div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div>
                    </div>
                    <div class="stat-item" data-stat="hsPercent">
                         <div class="stat-header"><div class="label" title="Headshot % (Letzte Matches)">HS %</div><div class="value">${player.hsPercent !== null ? player.hsPercent.toFixed(0) + '%' : '...'}</div></div>
                         <div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div>
                    </div>
                    <div class="stat-item" data-stat="elo">
                         <div class="stat-header"><div class="label">Elo</div><div class="value">${player.sortElo || 'N/A'}</div></div>
                          <div class="stat-progress-container"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div>
                    </div>
                </div>`;

            updateStatProgressBars(cardElement, player); // Call updater
        }

        detailCardContainer.appendChild(cardElement);
        cardElement.classList.remove('is-hiding');

        mainContentArea.classList.add('detail-visible'); // Trigger layout transforms
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
    // (Keep hideDetailCard function as is from previous step)
    function hideDetailCard() {
        if (!detailCardContainer || !mainContentArea) return;
        const cardElement = detailCardContainer.querySelector('.player-card-hltv');
        if (cardElement && mainContentArea.classList.contains('detail-visible')) {
            cardElement.style.opacity = '0';
            cardElement.style.transform = 'translateX(20px)';
            cardElement.classList.add('is-hiding');
            mainContentArea.classList.remove('detail-visible'); // Triggers transforms back
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


    // --- Load All Player Data ---
    // (Keep loadAllPlayers function as is from previous step)
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


    // --- Event Listener for Player List Clicks ---
    // (Keep event listener function as is from previous step)
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


    // --- Refresh Button ---
    // (Keep refresh button logic as is)
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            console.log("Daten werden manuell neu geladen...");
            loadAllPlayers();
        });
    }
});