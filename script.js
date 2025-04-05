document.addEventListener('DOMContentLoaded', () => {
    const playerListElement = document.getElementById('player-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');
    const chartCanvas = document.getElementById('eloChart');
    let eloChartInstance = null;

    // Farben für die Graphenlinien
    const chartColors = [
        '#FF5500', '#3498DB', '#2ECC71', '#F1C40F', '#9B59B6',
        '#E74C3C', '#1ABC9C', '#F39C12', '#8E44AD', '#34495E',
        '#D35400', '#2980B9', '#27AE60', '#D4AC0D', '#884EA0',
        '#C0392B', '#16A085', '#C67A11', '#7D3C98', '#2C3E50'
    ];
    // CSS-Variable --text-color als JS-String (für Chart.js Optionen)
    const chartTextColor = '#efeff1'; // <<< HIER den Farbwert direkt eintragen

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
        if (!chartCanvas) {
            console.error("Canvas Element für Chart nicht gefunden!");
            return;
        }
        const ctx = chartCanvas.getContext('2d');

        if (eloChartInstance) {
            eloChartInstance.destroy();
        }

        const validPlayers = playersData.filter(p => !p.error && p.eloHistory.length > 0);
        const maxHistoryLength = 50;
        const labels = Array.from({ length: maxHistoryLength + 1 }, (_, i) => {
            if (i === maxHistoryLength) return "Aktuell";
            return `M ${i + 1}`;
        });

        const datasets = validPlayers.map((player, index) => {
            const eloDataPoints = [...player.eloHistory];
            if (player.elo !== 'N/A') {
                eloDataPoints.push(player.elo);
            }
            // Optional: Fülle Daten auf 51 Punkte auf, wenn weniger vorhanden sind, damit Linien bis 'Aktuell' gehen
            // while(eloDataPoints.length < maxHistoryLength + 1) {
            //     eloDataPoints.unshift(null); // Füge 'null' am Anfang hinzu, um die Linie später starten zu lassen
            // }
            // Alternative: Nur vorhandene Daten nutzen (Linien können unterschiedlich lang sein)

            return {
                label: player.nickname,
                data: eloDataPoints,
                borderColor: chartColors[index % chartColors.length],
                backgroundColor: chartColors[index % chartColors.length] + '33',
                tension: 0.1,
                pointRadius: 3,
                pointHoverRadius: 6,
            };
        });

        eloChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    title: { display: false, },
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: chartTextColor // <<< KORRIGIERT
                        }
                    },
                    tooltip: { mode: 'index', intersect: false, }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Letzte Spiele (+ Aktuell)', color: chartTextColor }, // <<< KORRIGIERT
                        ticks: { color: chartTextColor, autoSkip: true, maxTicksLimit: 10 }, // <<< KORRIGIERT
                        grid: { color: '#444' }
                    },
                    y: {
                        title: { display: true, text: 'Faceit Elo', color: chartTextColor }, // <<< KORRIGIERT
                        ticks: { color: chartTextColor }, // <<< KORRIGIERT
                        grid: { color: '#444' }
                    }
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    }

    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        playerListElement.innerHTML = '';
        const chartContainer = document.getElementById('chart-container'); // Chart Container holen
        if(chartContainer) chartContainer.style.display = 'none'; // Chart erstmal verstecken

        if (eloChartInstance) {
            eloChartInstance.destroy();
            eloChartInstance = null;
        }

        let playerNicknames = [];

        try {
            const response = await fetch('/players.json');
            if (!response.ok) {
                throw new Error(`Fehler beim Laden der Spielerliste (players.json): ${response.status}`);
            }
            playerNicknames = await response.json();

            if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) {
                throw new Error("Spielerliste (players.json) ist leer oder im falschen Format.");
            }

            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));
            let playersData = await Promise.all(playerPromises);

            playersData.sort((a, b) => b.sortElo - a.sortElo);

            displayPlayerList(playersData);
            renderEloChart(playersData); // Rendere den Graphen

            // Zeige Chart-Container wieder an, wenn alles geklappt hat
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