document.addEventListener('DOMContentLoaded', () => {
    // Removed: const playerGridContainer = document.getElementById('player-grid');
    const playerList = document.getElementById('player-list'); // Container for the sorted list items (ol)
    const detailCardContainer = document.getElementById('player-detail-card-container'); // Div containing the card
    const mainContentArea = document.getElementById('main-content-area'); // Main flex container
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');
    const playerListContainerEl = document.getElementById('player-list'); // Reference to the <ol> element (used correctly elsewhere)

    let allPlayersData = [];
    let currentlyDisplayedNickname = null;

    // --- Error Handling & Basic Checks ---
    if (!playerList || !detailCardContainer || !mainContentArea || !loadingIndicator || !errorMessageElement || !playerListContainerEl) {
        console.error("FEHLER: Wichtige HTML-Elemente (Liste, Detail-Container, Layout, Ladeanzeige, Fehlermeldung oder Listen-OL) fehlen!");
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
        playerListContainerEl.innerHTML = ''; // Clear the list <ol>
        players.forEach((player) => {
            const listItem = document.createElement('li');
            // WICHTIG: data-nickname Attribut hinzufügen!
            listItem.setAttribute('data-nickname', player.nickname);

            if (player.error) {
                listItem.classList.add('error-item');
                listItem.innerHTML = `<span class="player-info" style="justify-content: flex-start;">${player.nickname} - Fehler: ${player.error}</span>`;
            } else {
                const avatarUrl = player.avatar || 'default_avatar.png'; // Use default if none
                // Original innerHTML without progress bar for now
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
                // Update progress bar after adding to DOM (if needed, or directly set width)
                const progressBarContainer = listItem.querySelector('.elo-progress-container');
                if (progressBarContainer) {
                    updateEloProgressBar(progressBarContainer); // Call function to calculate and set width/color
                }
            }
            playerListContainerEl.appendChild(listItem); // Add the <li> to the <ol>
        });
    }

    // --- Elo Progress Bar Logic (Helper) ---
    function updateEloProgressBar(container) {
        const elo = parseInt(container.dataset.elo || 0, 10);
        const level = parseInt(container.dataset.level || 0, 10);
        const bar = container.querySelector('.elo-progress-bar');
        if (!bar || level === 0) return; // Exit if no bar or level 0

        // Simplified Elo ranges per level (adjust these based on Faceit's actual ranges if needed)
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
            10: [2001, Infinity] // Or a practical upper limit like 5000
        };

        // Level colors (from CSS variables, but needed here for logic)
        const levelColors = {
            1: 'var(--faceit-lvl-1-2-color)', // Grey
            2: 'var(--faceit-lvl-1-2-color)', // Grey
            3: 'var(--faceit-lvl-3-7-color)', // Yellow
            4: 'var(--faceit-lvl-3-7-color)',
            5: 'var(--faceit-lvl-3-7-color)',
            6: 'var(--faceit-lvl-3-7-color)',
            7: 'var(--faceit-lvl-3-7-color)',
            8: 'var(--faceit-lvl-8-9-color)', // Orange
            9: 'var(--faceit-lvl-8-9-color)', // Orange
            10: 'var(--faceit-lvl-10-color)'  // Red
        };

        let progressPercent = 0;
        let barColor = levelColors[1]; // Default to grey

        if (level >= 1 && level <= 9) {
            const [minElo, maxElo] = eloRanges[level];
            const nextLevelMinElo = eloRanges[level + 1][0];
            const rangeSize = nextLevelMinElo - minElo;
            const eloInLevel = Math.max(0, elo - minElo);
            progressPercent = Math.min(100, (eloInLevel / rangeSize) * 100);
            barColor = levelColors[level] || levelColors[1];
        } else if (level === 10) {
            // For level 10, show 100% progress or scale differently if desired
            progressPercent = 100;
            barColor = levelColors[10];
        }

        // Apply style
        bar.style.width = `${progressPercent}%`;
        bar.style.backgroundColor = barColor;
    }

    // --- Display Detail Card ---
    function displayDetailCard(player) {
        if (!detailCardContainer || !mainContentArea) return;

        // Create the card element
        const cardElement = document.createElement('div');
        cardElement.classList.add('player-card-hltv');

        // Ensure container is visible BEFORE adding card and triggering animation
        detailCardContainer.style.display = 'block'; // Set display BEFORE adding content
        detailCardContainer.innerHTML = ''; // Clear previous card

        if (!player) {
            console.error("Keine Spielerdaten zum Anzeigen übergeben.");
            detailCardContainer.style.display = 'none';
            mainContentArea.classList.remove('detail-visible');
            currentlyDisplayedNickname = null;
            return;
        }

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
            const matchesConsideredText = player.matchesConsidered ? `Letzte ~${player.matchesConsidered} Matches` : 'Aktuelle Stats'; // Changed text slightly

            // Original card structure
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
                    <div class="stat-item"> <div class="label" title="Berechnetes Perf. Rating (Letzte Matches)">Rating 2.0</div> <div class="value ${!player.calculatedRating || player.calculatedRating === 'N/A' || player.calculatedRating === 'Pending' ? 'na' : ''}">${player.calculatedRating || '...'}</div></div>
                    <div class="stat-item"> <div class="label" title="K/D Ratio (Letzte Matches)">K/D</div> <div class="value ${!player.kd || player.kd === 'N/A' || player.kd === 'Pending' ? 'na' : ''}">${player.kd || '...'}</div></div>
                    <div class="stat-item"> <div class="label" title="Average Damage per Round (Letzte Matches)">ADR</div> <div class="value ${!player.adr || player.adr === 'N/A' || player.adr === 'Pending' ? 'na' : ''}">${player.adr || '...'}</div></div>
                    <div class="stat-item"> <div class="label" title="Win Rate % (Letzte Matches)">Win Rate</div> <div class="value ${!player.winRate || player.winRate === 'N/A' || player.winRate === 'Pending' ? 'na' : ''}">${player.winRate !== undefined && player.winRate !== null ? player.winRate + '%' : '...'}</div></div>
                    <div class="stat-item"> <div class="label" title="Headshot % (Letzte Matches)">HS %</div> <div class="value ${!player.hsPercent || player.hsPercent === 'N/A' || player.hsPercent === 'Pending' ? 'na' : ''}">${player.hsPercent !== undefined && player.hsPercent !== null ? player.hsPercent + '%' : '...'}</div></div>
                    <div class="stat-item"> <div class="label">Elo</div> <div class="value ${!player.elo || player.elo === 'N/A' ? 'na' : ''}">${player.elo || 'N/A'}</div></div>
                </div>`;
            // Note: Progress bars for detail stats will be added in the next step
        }

        detailCardContainer.appendChild(cardElement);
        // Remove hiding class in case it was left over from a quick hide/show sequence
        cardElement.classList.remove('is-hiding');

        mainContentArea.classList.add('detail-visible'); // Trigger layout shift/transition
        currentlyDisplayedNickname = player?.nickname;

        // Animation/Scroll logic
        requestAnimationFrame(() => {
            // Trigger the transition defined in CSS by changing opacity/transform
            cardElement.style.opacity = '1';
            cardElement.style.transform = 'translateX(0)';

            // Scroll into view after a short delay
            setTimeout(() => {
                // Check if the card still belongs to the currently displayed player before scrolling
                if (player.nickname === currentlyDisplayedNickname) {
                    cardElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 100); // Adjust delay if needed
        });
    }


    // --- Hide Detail Card ---
    function hideDetailCard() {
        if (!detailCardContainer || !mainContentArea) return;

        const cardElement = detailCardContainer.querySelector('.player-card-hltv');

        if (cardElement && mainContentArea.classList.contains('detail-visible')) { // Only hide if visible
            console.log("Hiding card for:", currentlyDisplayedNickname);
            // 1. Start hiding transition on the card itself by changing styles
            cardElement.style.opacity = '0';
            cardElement.style.transform = 'translateX(20px)';
            cardElement.classList.add('is-hiding'); // Add class mainly as a status indicator

            // 2. Remove class from main area to trigger layout shift (list expands)
            mainContentArea.classList.remove('detail-visible');
            const hidingNickname = currentlyDisplayedNickname; // Store nickname before resetting
            currentlyDisplayedNickname = null; // Reset nickname immediately

            // 3. Wait for the card's transition to end, then hide the container
            const transitionDuration = 500; // Match CSS transition duration in ms
            const transitionEndHandler = () => {
                // Check if we are still supposed to be hiding this specific card
                // (i.e., no other card was opened in the meantime)
                if (currentlyDisplayedNickname === null && detailCardContainer.querySelector('.is-hiding')) {
                    console.log("Transition ended, hiding container for:", hidingNickname);
                    detailCardContainer.style.display = 'none'; // Hide container AFTER transition
                    if(cardElement) {
                        cardElement.classList.remove('is-hiding'); // Clean up class
                        // Optional: Clear content only if necessary
                        // detailCardContainer.innerHTML = '';
                    }
                } else {
                    console.log("Transition ended, but state changed, not hiding container.");
                    if(cardElement) cardElement.classList.remove('is-hiding');
                }
            };

            // Use setTimeout as the primary mechanism for reliability
            setTimeout(transitionEndHandler, transitionDuration);

            // Optional: Add transitionend listener as a secondary check (less reliable than timeout)
            /*
            cardElement.addEventListener('transitionend', (event) => {
                // Ensure it's the opacity or transform transition ending
                if (event.propertyName === 'opacity' || event.propertyName === 'transform') {
                     console.log("TransitionEnd event fired for:", event.propertyName);
                     transitionEndHandler();
                }
            }, { once: true });
            */

        } else if (!mainContentArea.classList.contains('detail-visible')) {
            // If already hidden, just ensure state is clean
            detailCardContainer.style.display = 'none';
            if(cardElement) cardElement.classList.remove('is-hiding');
            currentlyDisplayedNickname = null;
        }
    }


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
            const results = await Promise.allSettled(playerPromises); // Use allSettled

            allPlayersData = results.map(result => {
                if (result.status === 'fulfilled') {
                    return result.value;
                } else {
                    // Extract nickname from error if possible, or handle differently
                    console.error("Promise rejected:", result.reason);
                    // Attempt to return a basic error object if the reason contains info
                    // This part might need adjustment based on how getPlayerData throws errors
                    const errorMessage = result.reason?.message || 'Unbekannter Fehler';
                    // Try to find nickname in the error message (simple approach)
                    const match = errorMessage.match(/Spieler "([^"]+)" nicht gefunden/);
                    const nickname = match ? match[1] : 'Unbekannt';
                    return { nickname: nickname, error: errorMessage, sortElo: -1 };
                }
            });


            // Sort players by ELO (descending), errors last
            allPlayersData.sort((a, b) => {
                const aHasError = !!a.error;
                const bHasError = !!b.error;
                if (aHasError && !bHasError) return 1; // a has error, b doesn't -> a comes after b
                if (!aHasError && bHasError) return -1; // a doesn't have error, b does -> a comes before b
                if (aHasError && bHasError) return 0; // Both have errors, keep order or sort by name?
                return (b.sortElo || 0) - (a.sortElo || 0); // Both valid, sort by ELO
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
    playerListContainerEl.addEventListener('click', (event) => {
        const clickedItem = event.target.closest('li'); // Find the clicked list item
        if (clickedItem && !clickedItem.classList.contains('error-item')) {
            const nickname = clickedItem.dataset.nickname;
            console.log("Clicked list item for:", nickname);
            if (nickname) {
                if (nickname === currentlyDisplayedNickname) {
                    console.log("Clicked same player, hiding card.");
                    hideDetailCard(); // Clicked the same player, hide the card
                } else {
                    console.log("Clicked new player, showing card for:", nickname);
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
        } else if (clickedItem) {
            console.log("Clicked on an error item, doing nothing.");
        }
    });

    // --- Initial Load ---
    loadAllPlayers();

    // Refresh functionality (if button exists)
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            console.log("Daten werden manuell neu geladen...");
            loadAllPlayers(); // Reload all player data
        });
    }
});