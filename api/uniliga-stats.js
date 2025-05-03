// /api/uniliga-stats.js - Minimaler Test

// Log 1: Wird dieses Modul überhaupt geladen?
console.log('[API Uniliga Minimal] Modul wurde geladen.');

export default async function handler(req, res) {
    // Log 2: Wird der Handler bei einer Anfrage erreicht?
    console.log(`[API Uniliga Minimal] Handler aufgerufen. Methode: ${req.method}, URL: ${req.url}`);

    // Sende eine einfache, feste Erfolgsantwort
    res.status(200).json({
        message: 'Minimaler Test für uniliga-stats war erfolgreich!',
        timestamp: new Date().toISOString()
    });
}

// Optional: Log am Ende des Moduls
console.log('[API Uniliga Minimal] Modul-Ende erreicht.');