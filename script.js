document.addEventListener('DOMContentLoaded', () => {
    const playerListElement = document.getElementById('player-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');
    const chartCanvas = document.getElementById('eloChart'); // Canvas Element holen
    let eloChartInstance = null; // Globale Variable für die Chart Instanz

    // Farben für die Graphenlinien (mehr Farben hinzufügen bei Bedarf)
    const chartColors = [
        '#FF5500', '#3498DB', '#2ECC71', '#F1C40F', '#9B59B6',
        '#E74C3C', '#1ABC9C', '#F39C12', '#8E44AD', '#34495E',
        '#D35400', '#2980B9', '#27AE60', '#D4AC0D', '#884EA0',
        '#C0392B', '#16A085', '#C67A11', '#7D3C98', '#2C3E50'
    ];

    // Funktion zum Abrufen von Spielerdaten von der Vercel API Funktion
    // Erwartet jetzt auch das Feld 'eloHistory' in der Antwort
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
            // Stelle sicher, dass elo eine Zahl ist für die Sortierung, sonst 0
            playerData.sortElo = parseInt(playerData.elo, 10) || 0;
            // Stelle sicher, dass eloHistory ein Array ist
            playerData.eloHistory = Array.isArray(playerData.eloHistory) ? playerData.eloHistory : [];
            return playerData;
        } catch (error) {
            console.error(`Fehler beim Abrufen von Daten für ${nickname}:`, error);
            return { nickname: nickname, error: error.message, elo: 'N/A', sortElo: 0, eloHistory: [] };
        }
    }

    // Funktion zum Anzeigen der Spieler in der Liste (unverändert)
    function displayPlayerList(players) {
        playerListElement.innerHTML = ''; // Liste leeren
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
                    <div class="player-elo">${player.elo === 0 ? 'N/A' : player.elo}</div>
                 `;
            }
            playerListElement.appendChild(listItem);
        });
    }

    // NEUE Funktion zum Rendern des Elo-Graphen
    function renderEloChart(playersData) {
        if (!chartCanvas) {
            console.error("Canvas Element für Chart nicht gefunden!");
            return;
        }
        const ctx = chartCanvas.getContext('2d');

        // Zerstöre alte Chart-Instanz, falls vorhanden
        if (eloChartInstance) {
            eloChartInstance.destroy();
        }

        // Filtere Spieler ohne Fehler und mit History heraus
        const validPlayers = playersData.filter(p => !p.error && p.eloHistory.length > 0);

        // Finde die maximale Länge der Historie für die X-Achse (max 50)
        // const maxHistoryLength = Math.max(...validPlayers.map(p => p.eloHistory.length), 0);
        const maxHistoryLength = 50; // Feste Achse für 50 Spiele

        // Labels für die X-Achse (z.B. "M-49", "M-48", ..., "Aktuell")
        // Generiere Labels von 1 bis maxHistoryLength + 1 (für den aktuellen Punkt)
        const labels = Array.from({ length: maxHistoryLength + 1 }, (_, i) => {
            if (i === maxHistoryLength) return "Aktuell";
            // Zeigt die Nummer des Matches an (von 1 bis 50)
            // Wenn die History von Alt -> Neu kommt:
            return `M ${i + 1}`;
            // Wenn die History von Neu -> Alt käme (nach reverse):
            // return `M-${maxHistoryLength - 1 - i}`;
        });


        // Datasets für Chart.js erstellen
        const datasets = validPlayers.map((player, index) => {
            // Kombiniere History mit aktueller Elo (falls gültig)
            const eloDataPoints = [...player.eloHistory];
            if (player.elo !== 'N/A') {
                eloDataPoints.push(player.elo); // Füge aktuelle Elo am Ende hinzu
            }

            // Fülle ggf. mit null auf, falls weniger als 50 Spiele + Aktuell
            // const paddedData = Array(maxHistoryLength + 1).fill(null);
            // eloDataPoints.forEach((elo, idx) => {
            //      // Annahme: eloDataPoints ist von Alt -> Neu
            //     paddedData[idx] = elo;
            // });


            return {
                label: player.nickname,
                data: eloDataPoints, // Verwende die (potenziell umgedrehte) History + aktuelle Elo
                borderColor: chartColors[index % chartColors.length], // Farbe aus Palette wählen
                backgroundColor: chartColors[index % chartColors.length] + '33', // Leichte Füllfarbe (optional)
                tension: 0.1, // Leichte Kurvenglättung
                pointRadius: 3, // Kleine Punkte standardmäßig
                pointHoverRadius: 6, // Größerer Punkt bei Hover
                // pointStyle: 'circle', // Standard-Punktstil
                // Hier käme später die Logik für die Avatar-Punkte
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
                maintainAspectRatio: true, // Behält das Seitenverhältnis bei, wichtig mit max-height
                plugins: {
                    title: {
                        display: false, // Wir haben die H2 schon im HTML
                        // text: 'Elo-Verlauf (Letzte 50 Spiele)'
                    },
                    legend: {
                        position: 'bottom', // Legende unten anzeigen
                        labels: {
                            color: var(--text-color) // Textfarbe für Legende
    }
    },
        tooltip: {
            mode: 'index', // Zeigt Tooltip für alle Linien am selben X-Punkt
                intersect: false,
                callbacks: {
                // Optional: Tooltip-Titel anpassen
                // title: function(tooltipItems) {
                //    return `Nach Spiel ${tooltipItems[0].label}`;
                // }
            }
        }
    },
        scales: {
            x: {
                title: {
                    display: true,
                        text: 'Letzte Spiele (+ Aktuell)',
                        color: var(--text-color)
                },
                ticks: {
                    color: var(--text-color),
                    // Zeige weniger Ticks, wenn es zu voll wird
                    autoSkip: true,
                        maxTicksLimit: 10
                },
                grid: {
                    color: '#444' // Dunklere Gitterlinien
                }
            },
            y: {
                title: {
                    display: true,
                        text: 'Faceit Elo',
                        color: var(--text-color)
                },
                ticks: {
                    color: var(--text-color)
                },
                grid: {
                    color: '#444' // Dunklere Gitterlinien
                }
            }
        },
        interaction: { // Verbessert Hover-Verhalten
            mode: 'nearest',
                axis: 'x',
                intersect: false
        }
    }
    });
    }


    // Hauptfunktion zum Laden aller Spieler (ruft jetzt auch renderEloChart auf)
    async function loadAllPlayers() {
        loadingIndicator.style.display = 'block';
        errorMessageElement.style.display = 'none';
        errorMessageElement.textContent = '';
        playerListElement.innerHTML = '';
        // Alte Chart Instanz zerstören, falls vorhanden
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

            // Sortiere das Array absteigend nach sortElo
            playersData.sort((a, b) => b.sortElo - a.sortElo);

            // Zeige die sortierte Liste an
            displayPlayerList(playersData);

            // NEU: Rendere den Elo-Graphen
            renderEloChart(playersData);

        } catch (error) {
            console.error("Fehler beim Laden der Spieler:", error);
            errorMessageElement.textContent = `Fehler: ${error.message}`;
            errorMessageElement.style.display = 'block';
            // Verstecke Graphen-Container bei Fehler
            const chartContainer = document.getElementById('chart-container');
            if(chartContainer) chartContainer.style.display = 'none';
        } finally {
            loadingIndicator.style.display = 'none';
            // Zeige Graphen-Container wieder an (falls er versteckt wurde)
            const chartContainer = document.getElementById('chart-container');
            if(chartContainer) chartContainer.style.display = 'block';
        }
    }

    // Lade die Spielerdaten, wenn die Seite geladen ist
    loadAllPlayers();
});