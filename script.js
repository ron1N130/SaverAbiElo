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
    const chartTextColor = '#efeff1';
    const AVATAR_SIZE = 24; // Größe des Avatars im Graphen in Pixel
    const AVATAR_BORDER_WIDTH = 2; // Breite des farbigen Rands um den Avatar

    // --- NEU: Funktion zum Vorabladen der Avatare ---
    async function preloadAvatars(players) {
        const promises = players.map(player => {
            // Überspringe Spieler mit Fehlern oder ohne Avatar-URL
            if (player.error || !player.avatar || player.avatar === 'default_avatar.png') {
                player.avatarImage = null; // Setze explizit auf null
                return Promise.resolve(player); // Löse Promise direkt auf
            }

            return new Promise((resolve) => {
                const img = new Image();
                img.width = AVATAR_SIZE;
                img.height = AVATAR_SIZE;
                img.onload = () => {
                    player.avatarImage = img; // Speichere das geladene Bild-Objekt
                    resolve(player);
                };
                img.onerror = () => {
                    console.warn(`Konnte Avatar für ${player.nickname} nicht laden: ${player.avatar}`);
                    player.avatarImage = null; // Setze auf null bei Fehler
                    resolve(player); // Löse Promise trotzdem auf
                };
                img.src = player.avatar; // Starte das Laden
            });
        });
        // Warte bis alle Ladeversuche abgeschlossen sind
        return Promise.all(promises);
    }


    // Funktion zum Abrufen von Spielerdaten (unverändert)
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

    // Funktion zum Anzeigen der Spieler in der Liste (unverändert)
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

    // Funktion zum Rendern des Elo-Graphen (JETZT MIT AVATAR-VERSUCH)
    function renderEloChart(playersData) { // Nimmt jetzt Spieler mit preloaded avatarImage entgegen
        if (!chartCanvas) {
            console.error("Canvas Element für Chart nicht gefunden!");
            return;
        }
        const ctx = chartCanvas.getContext('2d');

        if (eloChartInstance) {
            eloChartInstance.destroy();
        }

        // Filtere Spieler ohne Fehler und mit History heraus
        const validPlayers = playersData.filter(p => !p.error && p.eloHistory.length > 0);
        const maxHistoryLength = 50; // Max. Spiele für die X-Achse

        // Labels: M1 bis M50 und "Aktuell" (51 Punkte)
        const labels = Array.from({ length: maxHistoryLength + 1 }, (_, i) => {
            if (i === maxHistoryLength) return "Aktuell";
            return `M ${i + 1}`;
        });

        // Datasets für Chart.js erstellen
        const datasets = validPlayers.map((player, index) => {
            const playerColor = chartColors[index % chartColors.length];

            // Kombiniere History mit aktueller Elo
            const eloDataPoints = [...player.eloHistory];
            if (player.elo !== 'N/A') {
                eloDataPoints.push(player.elo);
            }

            // Erzeuge Arrays für Punkt-Styling (gleiche Länge wie Labels!)
            const pointStyles = Array(maxHistoryLength + 1).fill('circle');
            const pointRadii = Array(maxHistoryLength + 1).fill(2); // Kleine Punkte standard
            const pointBorderColors = Array(maxHistoryLength + 1).fill(playerColor);
            const pointBorderWidths = Array(maxHistoryLength + 1).fill(1);
            const pointHoverRadii = Array(maxHistoryLength + 1).fill(5);

            // Wenn Datenpunkte vorhanden sind, style den letzten Punkt speziell
            const lastDataIndex = eloDataPoints.length - 1;
            if (lastDataIndex >= 0 && lastDataIndex < pointStyles.length) {
                // Verwende Avatar als Punkt, wenn er geladen wurde
                if (player.avatarImage) {
                    pointStyles[lastDataIndex] = player.avatarImage; // Das geladene Image Objekt
                    pointRadii[lastDataIndex] = AVATAR_SIZE / 2; // Radius ist halbe gewünschte Größe
                    pointBorderWidths[lastDataIndex] = AVATAR_BORDER_WIDTH; // Randbreite
                    pointHoverRadii[lastDataIndex] = (AVATAR_SIZE / 2) + 2; // Etwas größer bei Hover
                } else {
                    // Fallback: Größerer Kreis, wenn Avatar nicht geladen
                    pointRadii[lastDataIndex] = 6;
                    pointHoverRadii[lastDataIndex] = 8;
                }
            }
            // Fülle den Anfang der Daten mit 'null', wenn weniger als 50 Spiele + aktuell vorhanden sind
            // damit die Linie erst später beginnt und der Avatar am richtigen X-Punkt ('Aktuell') ist.
            while (eloDataPoints.length < maxHistoryLength + 1) {
                eloDataPoints.unshift(null);
            }


            return {
                label: player.nickname,
                data: eloDataPoints, // Aufgefüllte Daten
                borderColor: playerColor,
                // backgroundColor: playerColor + '33', // Füllung vielleicht weglassen
                fill: false, // Keine Fläche unter der Linie füllen
                tension: 0.1,
                pointStyle: pointStyles, // Array für individuelle Punkte
                radius: pointRadii,       // Array für individuelle Radien
                pointBorderColor: pointBorderColors, // Array oder einzelner Wert
                pointBorderWidth: pointBorderWidths, // Array oder einzelner Wert
                pointHoverRadius: pointHoverRadii,  // Array oder einzelner Wert
            };
        });

        // Chart erstellen
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
                        labels: { color: chartTextColor }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: { // Tooltip-Titel verbessern
                            title: function(tooltipItems) {
                                const index = tooltipItems[0]?.dataIndex;
                                if (index === maxHistoryLength) return "Aktuelle Elo";
                                if (index !== undefined) return `Nach Spiel ${index + 1}`;
                                return '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Letzte Spiele (+ Aktuell)', color: chartTextColor },
                        ticks: { color: chartTextColor, autoSkip: true, maxTicksLimit: 10 },
                        grid: { color: '#444' }
                    },
                    y: {
                        title: { display: true, text: 'Faceit Elo', color: chartTextColor },
                        ticks: { color: chartTextColor },
                        grid: { color: '#444' }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                },
                // Wichtig für Bilder als Punkte: Verhindert, dass sie abgeschnitten werden
                layout: {
                    padding: {
                        // Füge Padding hinzu, das mindestens dem halben Avatar-Radius + Rand entspricht
                        top: (AVATAR_SIZE / 2) + AVATAR_BORDER_WIDTH + 5,
                        right: (AVATAR_SIZE / 2) + AVATAR_BORDER_WIDTH + 5,
                        bottom: 5,
                        left: 5
                    }
                }
            }
        });
    }


    // Hauptfunktion zum Laden aller Spieler (ruft jetzt auch preloadAvatars auf)
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
            if (!response.ok) {
                throw new Error(`Fehler beim Laden der Spielerliste (players.json): ${response.status}`);
            }
            playerNicknames = await response.json();

            if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) {
                throw new Error("Spielerliste (players.json) ist leer oder im falschen Format.");
            }

            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname));
            let playersDataRaw = await Promise.all(playerPromises);

            // === NEU: Avatare vorab laden ===
            console.log("Preloading avatars...");
            let playersData = await preloadAvatars(playersDataRaw);
            console.log("Avatars preloaded (or failed).");

            // Sortiere das Array absteigend nach sortElo
            playersData.sort((a, b) => b.sortElo - a.sortElo);

            // Zeige die sortierte Liste an
            displayPlayerList(playersData);

            // Rendere den Elo-Graphen mit den Daten (inkl. geladenen Avataren)
            renderEloChart(playersData);

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