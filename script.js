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

    // --- Centralized Thresholds ---
    const thresholds = {
        calculatedRating: { bad: 0.85, okay: 1.05, good: 1.25, max: 1.8 },
        kd: { bad: 0.8, okay: 1.0, good: 1.2, max: 2.0 },
        adr: { bad: 65, okay: 80, good: 95, max: 120 },
        winRate: { bad: 40, okay: 50, good: 60, max: 100 },
        hsPercent: { bad: 30, okay: 40, good: 50, max: 70 },
        elo: { bad: 1100, okay: 1700, good: 2200, max: 3500 } // Adjust!
    };

    // --- API Call Function --- (No changes needed)
    async function getPlayerData(nickname) {
        try {
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            const response = await fetch(apiUrl); if (!response.ok) { /* ... error handling ... */ throw new Error(displayError); }
            const playerData = await response.json();
            // --- Parsing --- (Keep as before)
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            playerData.level = parseInt(playerData.level, 10) || 0;
            playerData.calculatedRating = parseFloat(playerData.calculatedRating) || null;
            if (playerData.calculatedRating === 'Pending') playerData.calculatedRating = null;
            playerData.kd = parseFloat(playerData.kd) || null; if (playerData.kd === 'Pending') playerData.kd = null;
            playerData.adr = parseFloat(playerData.adr) || null; if (playerData.adr === 'Pending') playerData.adr = null;
            playerData.winRate = parseFloat(playerData.winRate) || null; if (playerData.winRate === 'Pending') playerData.winRate = null;
            playerData.hsPercent = parseFloat(playerData.hsPercent) || null; if (playerData.hsPercent === 'Pending') playerData.hsPercent = null;
            return playerData;
        } catch (error) { console.error(`Fehler Daten ${nickname}:`, error); return { nickname: nickname, error: error.message, sortElo: -1, level: 0 }; }
    }

    // --- Set Threshold Markers (Helper) ---
    function setThresholdMarkers(containerElement, config) {
        if (!config || !containerElement) return;
        const okayMarkerPos = Math.min(100, Math.max(0, (config.okay / config.max) * 100));
        const goodMarkerPos = Math.min(100, Math.max(0, (config.good / config.max) * 100));
        containerElement.style.setProperty('--okay-marker-pos', `${okayMarkerPos}%`);
        containerElement.style.setProperty('--good-marker-pos', `${goodMarkerPos}%`);
    }

    // --- Elo Progress Bar Logic for List (Helper) - UPDATED with Markers ---
    function updateEloProgressBarForList(container) {
        const elo = parseInt(container.dataset.elo || 0, 10);
        const bar = container.querySelector('.elo-progress-bar');
        if (!bar) return;

        const config = thresholds.elo; // Use the centralized Elo thresholds
        let percentage = 0;
        let barColor = 'var(--bar-color-bad)';

        if (elo !== null && !isNaN(elo) && elo > 0) {
            percentage = Math.min(100, Math.max(0, (elo / config.max) * 100));
            if (elo >= config.good) { barColor = 'var(--bar-color-good)'; }
            else if (elo >= config.okay) { barColor = 'var(--bar-color-okay)'; }
            else { barColor = 'var(--bar-color-bad)'; }
        } else { percentage = 0; barColor = 'var(--bar-background)'; }

        bar.style.width = `${percentage}%`;
        bar.style.backgroundColor = barColor;

        // Set marker positions using helper
        setThresholdMarkers(container, config);
    }


    // --- Display Sorted Player List --- (No changes needed)
    function displayPlayerList(players) {
        playerListContainerEl.innerHTML = '';
        players.forEach((player) => {
            const listItem = document.createElement('li'); listItem.setAttribute('data-nickname', player.nickname);
            if (player.error) { /* ... error handling ... */ }
            else {
                const avatarUrl = player.avatar || 'default_avatar.png';
                listItem.innerHTML = `
                    <span class="player-info"><img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';"><span class="player-name">${player.nickname}</span></span>
                    <div class="player-list-right"><span class="player-elo">${player.elo || 'N/A'}</span><div class="elo-progress-container progress-container-base" data-elo="${player.sortElo || 0}"><div class="elo-progress-bar"></div></div></div>`; // Added progress-container-base class
                const progressBarContainer = listItem.querySelector('.elo-progress-container');
                if (progressBarContainer) { updateEloProgressBarForList(progressBarContainer); }
            }
            playerListContainerEl.appendChild(listItem);
        });
    }


    // --- Helper Function to Update Stat Progress Bars AND Value Colors - UPDATED with Markers ---
    function updateStatProgressBars(cardElement, player) {
        const statItems = cardElement.querySelectorAll('.stat-item[data-stat]');

        statItems.forEach(item => {
            const statName = item.dataset.stat;
            const valueElement = item.querySelector('.value');
            const barContainer = item.querySelector('.stat-progress-container'); // Get container
            const barElement = item.querySelector('.stat-progress-bar');
            const labelElement = item.querySelector('.stat-indicator-label');

            // Ensure container exists for markers
            if (!statName || !thresholds[statName] || !valueElement || !barContainer) return;
            if (!barElement || !labelElement) return;

            const value = (statName === 'elo') ? player.sortElo : player[statName];
            const config = thresholds[statName];

            let percentage = 0; let barColor = 'var(--bar-color-bad)'; let indicatorText = '---'; let valueClass = 'bad';
            valueElement.classList.remove('good', 'okay', 'bad', 'na');

            if (value !== null && value !== undefined && !isNaN(value)) {
                percentage = Math.min(100, Math.max(0, (value / config.max) * 100));
                if (value >= config.good) { barColor = 'var(--bar-color-good)'; indicatorText = 'GOOD'; valueClass = 'good'; }
                else if (value >= config.okay) { barColor = 'var(--bar-color-okay)'; indicatorText = 'OKAY'; valueClass = 'okay'; }
                else { barColor = 'var(--bar-color-bad)'; indicatorText = 'BAD'; valueClass = 'bad'; }
                valueElement.classList.add(valueClass);
            } else {
                percentage = 5; barColor = 'var(--bar-color-bad)'; indicatorText = 'POOR'; valueClass = 'bad';
                valueElement.classList.add(valueClass);
            }

            barElement.style.width = `${percentage}%`; barElement.style.backgroundColor = barColor;
            labelElement.textContent = indicatorText;

            // Set marker positions using helper
            setThresholdMarkers(barContainer, config);
        });
    }


    // --- Display Detail Card - UPDATED Fallback & Added Class ---
    function displayDetailCard(player) {
        if (!detailCardContainer || !mainContentArea) return;
        const cardElement = document.createElement('div'); cardElement.classList.add('player-card-hltv');
        detailCardContainer.style.display = 'block'; detailCardContainer.innerHTML = '';

        if (!player || player.error) { /* ... error handling ... */ }
        else {
            const avatarUrl = player.avatar || 'default_avatar.png'; const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http') ? player.faceitUrl : `https://www.faceit.com/en/players/${player.nickname}`;
            const lastUpdatedText = player.lastUpdated ? `Stats vom ${new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(player.lastUpdated))} Uhr` : 'Stats werden aktualisiert...';
            const matchesConsideredText = player.matchesConsidered ? `Letzte ~${player.matchesConsidered} Matches` : 'Aktuelle Stats';

            // Added 'progress-container-base' class to stat progress containers
            cardElement.innerHTML = `
                <div class="card-header"><div class="player-info"><a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil öffnen"><img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';"></a><a href="${faceitProfileUrl}" target="_blank" class="player-name"> ${player.nickname} </a></div><div class="stats-label" title="${lastUpdatedText}">${matchesConsideredText}</div></div>
                <div class="stats-grid">
                    <div class="stat-item" data-stat="calculatedRating"><div class="stat-header"><div class="label" title="Berechnetes Perf. Rating (Letzte Matches)">Rating 2.0</div><div class="value">${player.calculatedRating !== null ? player.calculatedRating.toFixed(2) : '0.00'}</div></div><div class="stat-progress-container progress-container-base"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                    <div class="stat-item" data-stat="kd"><div class="stat-header"><div class="label" title="K/D Ratio (Letzte Matches)">K/D</div><div class="value">${player.kd !== null ? player.kd.toFixed(2) : '0.00'}</div></div><div class="stat-progress-container progress-container-base"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                    <div class="stat-item" data-stat="adr"><div class="stat-header"><div class="label" title="Average Damage per Round (Letzte Matches)">ADR</div><div class="value">${player.adr !== null ? player.adr.toFixed(1) : '0.0'}</div></div><div class="stat-progress-container progress-container-base"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                    <div class="stat-item" data-stat="winRate"><div class="stat-header"><div class="label" title="Win Rate % (Letzte Matches)">Win Rate</div><div class="value">${player.winRate !== null ? player.winRate.toFixed(0) + '%' : '0%'}</div></div><div class="stat-progress-container progress-container-base"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                    <div class="stat-item" data-stat="hsPercent"><div class="stat-header"><div class="label" title="Headshot % (Letzte Matches)">HS %</div><div class="value">${player.hsPercent !== null ? player.hsPercent.toFixed(0) + '%' : '0%'}</div></div><div class="stat-progress-container progress-container-base"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                    <div class="stat-item" data-stat="elo"><div class="stat-header"><div class="label">Elo</div><div class="value">${player.sortElo || 'N/A'}</div></div><div class="stat-progress-container progress-container-base"><div class="stat-progress-bar"></div><span class="stat-indicator-label">---</span></div></div>
                </div>`;
            updateStatProgressBars(cardElement, player);
        }
        detailCardContainer.appendChild(cardElement); cardElement.classList.remove('is-hiding');
        mainContentArea.classList.add('detail-visible'); currentlyDisplayedNickname = player?.nickname;
        requestAnimationFrame(() => { /* ... scroll into view logic ... */ });
    }


    // --- Hide Detail Card --- (No changes needed)
    function hideDetailCard() {
        if (!detailCardContainer || !mainContentArea) return;
        const cardElement = detailCardContainer.querySelector('.player-card-hltv');
        if (cardElement && mainContentArea.classList.contains('detail-visible')) {
            cardElement.style.opacity = '0'; cardElement.style.transform = 'translateX(20px)'; cardElement.classList.add('is-hiding');
            mainContentArea.classList.remove('detail-visible');
            const hidingNickname = currentlyDisplayedNickname; currentlyDisplayedNickname = null;
            const transitionDuration = 500;
            const transitionEndHandler = () => { if (currentlyDisplayedNickname === null && detailCardContainer.querySelector('.is-hiding')) { detailCardContainer.style.display = 'none'; if(cardElement) cardElement.classList.remove('is-hiding'); } else { if(cardElement) cardElement.classList.remove('is-hiding'); } };
            setTimeout(transitionEndHandler, transitionDuration);
        } else if (!mainContentArea.classList.contains('detail-visible')) { detailCardContainer.style.display = 'none'; if(cardElement) cardElement.classList.remove('is-hiding'); currentlyDisplayedNickname = null; }
    }


    // --- Load All Player Data --- (No changes needed)
    async function loadAllPlayers() { /* ... */ }


    // --- Event Listener for Player List Clicks --- (No changes needed)
    playerListContainerEl.addEventListener('click', (event) => { /* ... */ });


    // --- Initial Load ---
    loadAllPlayers();


    // --- Refresh Button --- (No changes needed)
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) { /* ... */ }
});