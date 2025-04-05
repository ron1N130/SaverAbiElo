document.addEventListener('DOMContentLoaded', () => {
    const playerListElement = document.getElementById('player-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');
    const chartCanvas = document.getElementById('eloChart');
    let eloChartInstance = null;

    const chartColors = [
        '#FF5500', '#3498DB', '#2ECC71', '#F1C40F', '#9B59B6',
        '#E74C3C', '#1ABC9C', '#F39C12', '#8E44AD', '#34495E',
        '#D35400', '#2980B9', '#27AE60', '#D4AC0D', '#884EA0',
        '#C0392B', '#16A085', '#C67A11', '#7D3C98', '#2C3E50'
    ];
    const chartTextColor = '#efeff1';
    const AVATAR_SIZE = 24;
    const AVATAR_BORDER_WIDTH = 2;

    async function preloadAvatars(players) {
        const promises = players.map(player => {
            if (player.error || !player.avatar || player.avatar === 'default_avatar.png') {
                player.avatarImage = null;
                return Promise.resolve(player);
            }
            return new Promise((resolve) => {
                const img = new Image();
                img.width = AVATAR_SIZE;
                img.height = AVATAR_SIZE;
                img.onload = () => {
                    player.avatarImage = img;
                    resolve(player);
                };
                img.onerror = () => {
                    console.warn(`Konnte Avatar für ${player.nickname} nicht laden: ${player.avatar}`);
                    player.avatarImage = null;
                    resolve(player);
                };
                img.src = player.avatar;
            });
        });
        return Promise.all(promises);
    }

    async function getPlayerData(nickname) {
        try {
            const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`;
            const response = await fetch(apiUrl);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
                let displayError = errorData.error || `Server error: ${response.status}`;
                if (response.status === 404 && displayError.includes("nicht gefunden")) {
                    displayError = `Spieler "${nickname}" nicht gefunden.`;
                } else if (response.status === 500 && displayError.includes("API Key missing")) {
                    displayError = "Server-Konfigurationsfehler (API Key).";
                }
                throw new Error(displayError);
            }
            const playerData = await response.json();
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            playerData.eloHistory = Array.isArray(playerData.eloHistory) ? playerData.eloHistory : [];
            return playerData;
        } catch (error) {
            console.error(`Fehler beim Abrufen von Daten für ${nickname}:`, error);
            return { nickname: nickname, error: error.message, elo: 'N/A', sortElo: 0, eloHistory: [] };
        }
    }

    function displayPlayerList(players) {
        playerListElement.innerHTML = '';
        players.forEach((player) => {
            const listItem = document.createElement('li');
            if (player.error) {
                listItem.classList.add('error-item');
                listItem.innerHTML = `<span>${player.nickname} - Fehler: ${player.error}</span>`;
            } else {
                const avatarUrl = player.avatar || 'default_avatar.png';
                const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http')
                    ? player.faceitUrl
                    : `https://${player.faceitUrl}`;
                listItem.innerHTML = `
                    <div class="player-info">
                       <a href="${faceitProfileUrl}" target="_blank" title="Faceit Profil von ${player.nickname} öffnen">
                          <img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';">
                       </a>
                       <a href="${faceitProfileUrl}" target="_blank" class="player-name">
                           ${player.nickname}
                       </a>
                    </div>
                    <div class="player-elo">${player.elo === 'N/A' ? 'N/A' : player.elo}</div>
                 `;
            }
            playerListElement.appendChild(listItem);
        });
    }

    function renderEloChart(playersData) {
        // NEU: Logge die Rohdaten, die ankommen
        console.log('[Render Chart] Received playersData:', JSON.stringify(playersData, null, 0));

        if (!chartCanvas) {
            console.error("[Render Chart] Canvas Element für Chart nicht gefunden!");
            return;
        }
        const ctx = chartCanvas.getContext('2d');

        if (eloChartInstance) {
            eloChartInstance.destroy();
        }

        // Filtere Spieler ohne Fehler UND mit History heraus
        const validPlayers = playersData.filter(p => !p.error && p.eloHistory.length > 0);
        // NEU: Logge das Ergebnis des Filters
        console.log(`[Render Chart] Filtered ${validPlayers.length} valid players for chart from ${playersData.length} total.`);

        if (validPlayers.length === 0) {
            console.warn("[Render Chart] Keine Spieler mit gültiger Elo-Historie gefunden, zeichne keinen Graphen.");
            // Optional: Nachricht im Chart-Bereich anzeigen
            ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height); // Canvas leeren
            ctx.fillStyle = chartTextColor;
            ctx.textAlign = 'center';
            ctx.fillText("Keine ausreichenden Verlaufsdaten zum Anzeigen.", chartCanvas.width / 2, 50);
            return; // Beende Funktion, wenn keine Daten da sind
        }


        const maxHistoryLength = 50;
        const labels = Array.from({ length: maxHistoryLength + 1 }, (_, i) => {
            if (i === maxHistoryLength) return "Aktuell";
            return `M ${i + 1}`;
        });

        const datasets = validPlayers.map((player, index) => {
            const playerColor = chartColors[index % chartColors.length];
            const eloDataPoints = [...player.eloHistory];
            if (player.elo !== 'N/A' && player.elo !== 0) { // Prüfe auch auf 0 falls 'N/A' zu 0 geparsed wird
                eloDataPoints.push(player.elo);
            } else {
                // Wenn aktuelle Elo fehlt, füge null hinzu, damit die Linie dort aufhört
                eloDataPoints.push(null);
            }

            const pointStyles = Array(maxHistoryLength + 1).fill('circle');
            const pointRadii = Array(maxHistoryLength + 1).fill(2);
            const pointBorderColors = Array(maxHistoryLength + 1).fill(playerColor);
            const pointBorderWidths = Array(maxHistoryLength + 1).fill(1);
            const pointHoverRadii = Array(maxHistoryLength + 1).fill(5);

            const lastDataIndex = eloDataPoints.length - 1; // Index des letzten Datenpunkts (kann < 50 sein!)

            // Fülle den Anfang der Daten mit 'null', wenn weniger als 50 Spiele + aktuell vorhanden sind
            // damit die Linie später beginnt und am richtigen X-Punkt endet.
            while (eloDataPoints.length < maxHistoryLength + 1) {
                eloDataPoints.unshift(null);
            }


            // Style den letzten existierenden Punkt (Index `maxHistoryLength` auf der X-Achse)
            const finalPointIndexOnAxis = maxHistoryLength; // Der 'Aktuell' Punkt
            if (player.avatarImage) {
                pointStyles[finalPointIndexOnAxis] = player.avatarImage;
                pointRadii[finalPointIndexOnAxis] = AVATAR_SIZE / 2;
                pointBorderWidths[finalPointIndexOnAxis] = AVATAR_BORDER_WIDTH;
                pointHoverRadii[finalPointIndexOnAxis] = (AVATAR_SIZE / 2) + 2;
            } else {
                pointRadii[finalPointIndexOnAxis] = 6;
                pointHoverRadii[finalPointIndexOnAxis] = 8;
            }
            // Alle anderen Punkte (wo keine History ist, also null) sollen unsichtbar sein
            for(let i = 0; i < eloDataPoints.length - 1; i++) { // Exklusive letzter Punkt
                if (eloDataPoints[i] === null) {
                    pointRadii[i] = 0; // Unsichtbar
                    pointHoverRadii[i] = 0;
                }
            }

            return {
                label: player.nickname,
                data: eloDataPoints, // Aufgefüllte Daten
                borderColor: playerColor,
                fill: false,
                tension: 0.1,
                pointStyle: pointStyles,
                radius: pointRadii,
                pointBorderColor: pointBorderColors,
                pointBorderWidth: pointBorderWidths,
                pointHoverRadius: pointHoverRadii,
                spanGaps: false // Unterbreche Linie bei 'null' Werten
            };
        });

        // NEU: Logge die finalen Datasets
        console.log('[Render Chart] Chart datasets prepared:', JSON.stringify(datasets.map(d => ({ label: d.label, data: d.data })), null, 0)); // Logge nur relevante Teile

        eloChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: { // Optionen bleiben gleich wie im letzten Schritt
                responsive: true,
                maintainAspectRatio: true,
                plugins: { /* ... */ },
                scales: { /* ... */ },
                interaction: { /* ... */ },
                layout: { /* ... */ }
            }
        });
    }

    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        playerListElement.innerHTML = '';
        const chartContainer = document.getElementById('chart-container');
        if(chartContainer) chartContainer.style.display = 'none';

        if (eloChartInstance) {
            eloChartInstance.destroy();
            eloChartInstance = null;
        }

        let playerNicknames = [];

        try {
            const response = await fetch('/players.json');
            if (!response.ok) { throw new Error(`Fehler beim Laden der Spielerliste (players.json): ${response.status}`); }
            playerNicknames = await response.json();

            if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) { throw new Error("Spielerliste (players.json) ist leer oder im falschen Format."); }

            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));
            let playersDataRaw = await Promise.all(playerPromises);

            console.log("[LoadAll] Preloading avatars...");
            let playersData = await preloadAvatars(playersDataRaw);
            console.log("[LoadAll] Avatars preloaded.");

            playersData.sort((a, b) => b.sortElo - a.sortElo);

            displayPlayerList(playersData);
            renderEloChart(playersData); // Rendere den Graphen

            if(chartContainer) chartContainer.style.display = 'block';

        } catch (error) {
            console.error("Fehler beim Laden der Spieler:", error);
            errorMessageElement.textContent = `Fehler: ${error.message}`;
            errorMessageElement.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none';
        }
    }

    loadAllPlayers();
});