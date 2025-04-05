document.addEventListener('DOMContentLoaded', () => {
    const playerListElement = document.getElementById('player-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageElement = document.getElementById('error-message');
    const chartCanvas = document.getElementById('eloChart');
    let eloChartInstance = null;

    const chartColors = [ '#FF5500', '#3498DB', '#2ECC71', '#F1C40F', '#9B59B6', '#E74C3C', '#1ABC9C', '#F39C12', '#8E44AD', '#34495E', '#D35400', '#2980B9', '#27AE60', '#D4AC0D', '#884EA0', '#C0392B', '#16A085', '#C67A11', '#7D3C98', '#2C3E50' ];
    const chartTextColor = '#efeff1';
    const AVATAR_SIZE = 24;
    const AVATAR_BORDER_WIDTH = 2;

    async function preloadAvatars(players) { /* ... unverändert ... */
        const promises = players.map(player => { if (player.error || !player.avatar || player.avatar === 'default_avatar.png') { player.avatarImage = null; return Promise.resolve(player); } return new Promise((resolve) => { const img = new Image(); img.width = AVATAR_SIZE; img.height = AVATAR_SIZE; img.onload = () => { player.avatarImage = img; resolve(player); }; img.onerror = () => { console.warn(`Avatar fail ${player.nickname}`); player.avatarImage = null; resolve(player); }; img.src = player.avatar; }); });
        return Promise.all(promises);
    }
    async function getPlayerData(nickname) { /* ... unverändert ... */
        try { const apiUrl = `/api/faceit-data?nickname=${encodeURIComponent(nickname)}`; const response = await fetch(apiUrl); if (!response.ok) { const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` })); let displayError = errorData.error || `Server error: ${response.status}`; if (response.status === 404 && displayError.includes("nicht gefunden")) { displayError = `Spieler "${nickname}" nicht gefunden.`; } else if (response.status === 500 && displayError.includes("API Key missing")) { displayError = "Server-Konfigurationsfehler (API Key)."; } throw new Error(displayError); } const playerData = await response.json(); playerData.sortElo = parseInt(playerData.elo, 10) || 0; playerData.eloHistory = Array.isArray(playerData.eloHistory) ? playerData.eloHistory : []; return playerData; } catch (error) { console.error(`Fehler Daten ${nickname}:`, error); return { nickname: nickname, error: error.message, elo: 'N/A', sortElo: 0, eloHistory: [] }; }
    }
    function displayPlayerList(players) { /* ... unverändert ... */
        playerListElement.innerHTML = ''; players.forEach((player) => { const listItem = document.createElement('li'); if (player.error) { listItem.classList.add('error-item'); listItem.innerHTML = `<span>${player.nickname} - Fehler: ${player.error}</span>`; } else { const avatarUrl = player.avatar || 'default_avatar.png'; const faceitProfileUrl = player.faceitUrl && player.faceitUrl.startsWith('http') ? player.faceitUrl : `https://${player.faceitUrl}`; listItem.innerHTML = `<div class="player-info"><a href="${faceitProfileUrl}" target="_blank" title="Profil ${player.nickname}"><img src="${avatarUrl}" alt="${player.nickname} Avatar" class="avatar" onerror="this.onerror=null; this.src='default_avatar.png';"></a><a href="${faceitProfileUrl}" target="_blank" class="player-name">${player.nickname}</a></div><div class="player-elo">${player.elo === 'N/A' ? 'N/A' : player.elo}</div>`; } playerListElement.appendChild(listItem); });
    }

    // RenderEloChart mit TESTDATEN (aktuelle Elo als flache Linie)
    function renderEloChart(playersData) {
        console.log('[Render Chart] Received playersData:', JSON.stringify(playersData.map(p => ({n:p.nickname, e:p.elo, h:p.eloHistory.length})), null, 0)); // Kompaktes Log

        if (!chartCanvas) { console.error("[Render Chart] Canvas Element nicht gefunden!"); return; }
        const ctx = chartCanvas.getContext('2d');
        if (eloChartInstance) { eloChartInstance.destroy(); }

        // Filtere Spieler ohne Fehler (History Länge ignorieren wir für den TEST)
        const validPlayers = playersData.filter(p => !p.error && p.elo !== 'N/A');
        console.log(`[Render Chart] Filtered ${validPlayers.length} valid players for chart test from ${playersData.length} total.`);

        if (validPlayers.length === 0) {
            console.warn("[Render Chart] Keine Spieler mit gültiger Elo gefunden, zeichne keinen Graphen.");
            ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height); ctx.fillStyle = chartTextColor; ctx.textAlign = 'center'; ctx.font = '16px ' + getComputedStyle(document.body).fontFamily; ctx.fillText("Keine Spielerdaten zum Anzeigen.", chartCanvas.width / 2, chartCanvas.height / 2);
            return;
        }

        const maxHistoryLength = 50;
        const labels = Array.from({ length: maxHistoryLength + 1 }, (_, i) => (i === maxHistoryLength) ? "Aktuell" : `M ${i + 1}`);

        const datasets = validPlayers.map((player, index) => {
            const playerColor = chartColors[index % chartColors.length];

            // === TEST: Erzeuge Array mit 51x der aktuellen Elo ===
            const eloDataPoints = Array(maxHistoryLength + 1).fill(player.elo);
            // ======================================================

            const pointStyles = Array(maxHistoryLength + 1).fill('circle');
            const pointRadii = Array(maxHistoryLength + 1).fill(0); // Mache alle Punkte erstmal unsichtbar
            const pointBorderColors = Array(maxHistoryLength + 1).fill(playerColor);
            const pointBorderWidths = Array(maxHistoryLength + 1).fill(1);
            const pointHoverRadii = Array(maxHistoryLength + 1).fill(5); // Hover Radius

            // Style nur den letzten Punkt ('Aktuell')
            const finalPointIndexOnAxis = maxHistoryLength;
            if (player.avatarImage) {
                pointStyles[finalPointIndexOnAxis] = player.avatarImage;
                pointRadii[finalPointIndexOnAxis] = AVATAR_SIZE / 2;
                pointBorderWidths[finalPointIndexOnAxis] = AVATAR_BORDER_WIDTH;
                pointHoverRadii[finalPointIndexOnAxis] = (AVATAR_SIZE / 2) + 2;
            } else { // Fallback ohne Avatar
                pointStyles[finalPointIndexOnAxis] = 'circle'; // Sicherstellen, dass es ein Kreis ist
                pointRadii[finalPointIndexOnAxis] = 6;
                pointHoverRadii[finalPointIndexOnAxis] = 8;
            }

            return {
                label: player.nickname,
                data: eloDataPoints, // Das TEST-Array mit aktueller Elo
                borderColor: playerColor,
                fill: false,
                tension: 0.1, // Keine Glättung für flache Linie nötig, aber schadet nicht
                pointStyle: pointStyles,
                radius: pointRadii,
                pointBorderColor: pointBorderColors,
                pointBorderWidth: pointBorderWidths,
                pointHoverRadius: pointHoverRadii,
                spanGaps: false
            };
        });

        console.log('[Render Chart] Chart datasets prepared (TEST DATA):', JSON.stringify(datasets.map(d => ({ label: d.label, data_length: d.data.length })), null, 0));

        eloChartInstance = new Chart(ctx, {
            type: 'line', data: { labels: labels, datasets: datasets },
            options: { /* ... Chart Optionen wie zuvor ... */
                responsive: true, maintainAspectRatio: true, plugins: { title: { display: false, }, legend: { position: 'bottom', labels: { color: chartTextColor } }, tooltip: { mode: 'index', intersect: false, callbacks: { title: function(tooltipItems) { const index = tooltipItems[0]?.dataIndex; if (index === maxHistoryLength) return "Aktuelle Elo"; if (index !== undefined) return `Nach Spiel ${index + 1}`; return ''; } } } }, scales: { x: { title: { display: true, text: 'Letzte Spiele (+ Aktuell)', color: chartTextColor }, ticks: { color: chartTextColor, autoSkip: true, maxTicksLimit: 10 }, grid: { color: '#444' } }, y: { title: { display: true, text: 'Faceit Elo', color: chartTextColor }, ticks: { color: chartTextColor }, grid: { color: '#444' } } }, interaction: { mode: 'nearest', axis: 'x', intersect: false }, layout: { padding: { top: (AVATAR_SIZE / 2) + AVATAR_BORDER_WIDTH + 5, right: (AVATAR_SIZE / 2) + AVATAR_BORDER_WIDTH + 5, bottom: 5, left: 5 } }
            }
        });
    }

    async function loadAllPlayers() { /* ... Ladelogik wie zuvor ... */
        loadingIndicator.style.display = 'block'; errorMessageElement.style.display = 'none'; errorMessageElement.textContent = ''; playerListElement.innerHTML = ''; const chartContainer = document.getElementById('chart-container'); if(chartContainer) chartContainer.style.display = 'none'; if (eloChartInstance) { eloChartInstance.destroy(); eloChartInstance = null; } let playerNicknames = [];
        try {
            const response = await fetch('/players.json'); if (!response.ok) { throw new Error(`Fehler Laden players.json: ${response.status}`); } playerNicknames = await response.json(); if (!Array.isArray(playerNicknames) || playerNicknames.length === 0) { throw new Error("players.json leer/falsches Format."); }
            const playerPromises = playerNicknames.map(nickname => getPlayerData(nickname)); let playersDataRaw = await Promise.all(playerPromises);
            console.log("[LoadAll] Preloading avatars..."); let playersData = await preloadAvatars(playersDataRaw); console.log("[LoadAll] Avatars preloaded.");
            playersData.sort((a, b) => b.sortElo - a.sortElo);
            displayPlayerList(playersData); renderEloChart(playersData); // Ruft jetzt die Test-Version auf
            if(chartContainer) chartContainer.style.display = 'block';
        } catch (error) { console.error("Fehler Laden Spieler:", error); errorMessageElement.textContent = `Fehler: ${error.message}`; errorMessageElement.style.display = 'block'; } finally { loadingIndicator.style.display = 'none'; }
    }

    loadAllPlayers();
});