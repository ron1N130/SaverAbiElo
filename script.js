document.addEventListener('DOMContentLoaded', () => {
    const playerList = document.getElementById('player-list');
    const detailCardContainer = document.getElementById('player-detail-card-container');
    const mainContentArea = document.getElementById('main-content-area');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');
    const playerListContainerEl = document.getElementById('player-list');

    let allPlayersData = [];
    let currentlyDisplayedNickname = null;

    // --- Thresholds Definition --- (Wird aktuell nicht verwendet)
    const thresholds = {
        // ... (thresholds bleiben definiert, werden aber in dieser Version weniger genutzt)
        elo: {bad: 1100, okay: 1700, good: 2200, max: 3500} // Nur für List Bar relevant
    };

    // --- API Call Function ---
    async function getPlayerData(nickname) {
        // (Unverändert)
        try {
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            const response = await fetch(apiUrl);
            if (!response.ok) { /* ... error handling ... */
                throw new Error(displayError);
            }
            const playerData = await response.json();
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            playerData.level = parseInt(playerData.level, 10) || 0;
            playerData.calculatedRating = parseFloat(playerData.calculatedRating) || null;
            if (playerData.calculatedRating === 'Pending') playerData.calculatedRating = null;
            playerData.kd = parseFloat(playerData.kd) || null;
            if (playerData.kd === 'Pending') playerData.kd = null;
            playerData.adr = parseFloat(playerData.adr) || null;
            if (playerData.adr === 'Pending') playerData.adr = null;
            playerData.winRate = parseFloat(playerData.winRate) || null;
            if (playerData.winRate === 'Pending') playerData.winRate = null;
            playerData.hsPercent = parseFloat(playerData.hsPercent) || null;
            if (playerData.hsPercent === 'Pending') playerData.hsPercent = null;
            return playerData;
        } catch (error) {
            console.error(`Fehler Daten ${nickname}:`, error);
            return {nickname: nickname, error: error.message, sortElo: -1, level: 0};
        }
    }

    // --- Set Threshold Markers (Helper) ---
    function setThresholdMarkers(containerElement, config) {
        // (Unverändert, wird aber nur für List Bar aufgerufen)
        if (!config || !containerElement) return;
        const okayMarkerPos = Math.min(100, Math.max(0, (config.okay / config.max) * 100));
        const goodMarkerPos = Math.min(100, Math.max(0, (config.good / config.max) * 100));
        containerElement.style.setProperty('--okay-marker-pos', `${okayMarkerPos}%`);
        containerElement.style.setProperty('--good-marker-pos', `${goodMarkerPos}%`);
    }

    // --- Elo Progress Bar Logic for List (Helper) ---
    function updateEloProgressBarForList(container) {
        // (Unverändert)
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
        setThresholdMarkers(container, config);
    }


    // --- Display Sorted Player List ---
    function displayPlayerList(players) {
        // (Unverändert)
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
                    <div class="player-list-right"><span class="player-elo">${player.elo || 'N/A'}</span><div class="elo-progress-container progress-container-base" data-elo="${player.sortElo || 0}"><div class="elo-progress-bar"></div></div></div>`;
                const progressBarContainer = listItem.querySelector('.elo-progress-container');
                if (progressBarContainer) {
                    updateEloProgressBarForList(progressBarContainer);
                }
            }
            playerListContainerEl.appendChild(listItem);
        });
    }


    // --- Helper Function to Update Stat Progress Bars AND Value Colors ---
    // (Komplett auskommentiert für diesen Test)
    /*
    function updateStatProgressBars(cardElement, player) {
        // ... (gesamte Funktion auskommentiert)
    }
    */


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
            const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http') ? player.faceitUrl : `https://www.faceit.com/en/players/${player.nickname}`;

            // --- Temporär vereinfachter innerHTML ---
            cardElement.innerHTML = `
                <div class="card-header">
                    <div class="player-info">
                        <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil öffnen">
                            <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar">
                        </a>
                        <a href="${faceitProfileUrl}" target="_blank" class="player-name"> ${player.nickname} </a>
                    </div>
                    <div class="stats-label">TEMP STATS</div>
                </div>
                <div style="padding: 2rem; text-align: center;">
                    Statistiken werden hier angezeigt (temporär deaktiviert).
                    <br>Elo: ${player.sortElo || 'N/A'}
                </div>
            `;
            // --- updateStatProgressBars Aufruf auskommentiert ---
            // updateStatProgressBars(cardElement, player);
        }
        detailCardContainer.appendChild(cardElement);
        cardElement.classList.remove('is-hiding');

        mainContentArea.classList.add('detail-visible');
        currentlyDisplayedNickname = player?.nickname;

        // Keep animation logic for the card itself
        requestAnimationFrame(() => {
            cardElement.style.opacity = '1';
            cardElement.style.transform = 'translateX(0)';
            setTimeout(() => {
                if (player && currentlyDisplayedNickname === player.nickname) {
                    cardElement.scrollIntoView({behavior: 'smooth', block: 'nearest'});
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

    // --- Load All Player Data ---
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
            displayPlayerList(allPlayersData); // <-- Diese Funktion sollte nun ohne Fehler durchlaufen
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

    // --- Refresh Button ---
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            console.log("Daten werden manuell neu geladen...");
            loadAllPlayers();
        });
    }
});