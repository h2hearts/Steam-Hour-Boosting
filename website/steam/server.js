const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { SteamBot } = require('./bot');
const { TokenStorage } = require('./tokens-storage');

const app = express();
const PORT = process.env.PORT || 3001;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const TOKENS_DIR = path.join(__dirname, 'tokens');
const STEAM_DATA_DIR = path.join(__dirname, 'steam-data');

app.use(cors());
app.use(express.json());

// Serve static frontend files
const frontendPath = path.resolve(__dirname, '..');
app.use(express.static(frontendPath));

app.get('/', (req, res) => {
    res.redirect('/panel.html');
});

const tokenStorage = new TokenStorage(TOKENS_DIR);
const bots = new Map();

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('Failed to read config.json:', err.message);
    }
    return [];
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('Failed to save config.json:', err.message);
    }
}

// Extract SteamID64 from saved token
function getSteamIdFromToken(username) {
    try {
        const file = path.join(TOKENS_DIR, `${username.toLowerCase()}.token`);
        if (fs.existsSync(file)) {
            const raw = fs.readFileSync(file, 'utf8').trim();
            const parts = raw.split('.');
            if (parts.length >= 2) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                return payload.sub || null;
            }
        }
    } catch {}
    return null;
}

// Fetch avatar using public community XML
function fetchAvatarBySteamId64(steamId64) {
    return new Promise((resolve) => {
        if (!steamId64) return resolve(null);
        https.get(`https://steamcommunity.com/profiles/${steamId64}/?xml=1`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const match = data.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/) || data.match(/<avatarFull>(.*?)<\/avatarFull>/);
                resolve(match ? match[1] : null);
            });
        }).on('error', () => resolve(null));
    });
}

// Sync config with running bot instances
function syncBotsWithConfig() {
    const config = loadConfig();
    for (const entry of config) {
        if (!entry.username) continue;
        const username = entry.username.toLowerCase();
        if (!bots.has(username)) {
            const bot = new SteamBot({
                username: entry.username,
                password: entry.password,
                games: entry.games || [],
                avatarUrl: entry.avatarUrl || null,
                latestBoosting: entry.latestBoosting || null,
                customTitleEnabled: Boolean(entry.customTitleEnabled),
                customTitle: entry.customTitle || '',
                awayMessageEnabled: Boolean(entry.awayMessageEnabled),
                awayMessage: entry.awayMessage || '',
                appearance: entry.appearance || 'online',
                displayMode: entry.displayMode || 'normal',
                online: Boolean(entry.online),
                dataDirectory: STEAM_DATA_DIR,
                tokenStorage: tokenStorage,
                onStatusChange: (status) => {
                    if (status.avatarUrl && status.avatarUrl !== entry.avatarUrl) {
                        entry.avatarUrl = status.avatarUrl;
                        const cfg = loadConfig();
                        const target = cfg.find(c => c.username.toLowerCase() === username);
                        if (target) {
                            target.avatarUrl = status.avatarUrl;
                            saveConfig(cfg);
                        }
                    }
                }
            });
            bots.set(username, { bot, accountData: entry });

            if (!entry.avatarUrl) {
                const sid64 = getSteamIdFromToken(username);
                if (sid64) {
                    fetchAvatarBySteamId64(sid64).then(avatar => {
                        if (avatar) {
                            entry.avatarUrl = avatar;
                            const cfg = loadConfig();
                            const target = cfg.find(c => c.username.toLowerCase() === username);
                            if (target) {
                                target.avatarUrl = avatar;
                                saveConfig(cfg);
                            }
                        }
                    });
                }
            }
        }
    }
}

// Top dashboard stats
app.get('/api/status', (req, res) => {
    syncBotsWithConfig();
    let accountsRunning = 0;
    let totalGamesBoosting = 0;
    let totalUptimeMinutes = 0;

    bots.forEach(({ bot }) => {
        if (bot.isRunning) {
            accountsRunning++;
            totalGamesBoosting += (bot.games ? bot.games.length : 0);
            totalUptimeMinutes += bot.uptimeMinutes;
        }
    });

    res.json({
        totalAccounts: bots.size,
        accountsRunning,
        totalGamesBoosting,
        totalAccountsHours: Math.floor(totalUptimeMinutes / 60)
    });
});

// Accounts list
app.get('/api/accounts', (req, res) => {
    syncBotsWithConfig();
    const list = [];

    bots.forEach(({ bot, accountData }) => {
        const status = bot.getStatus();
        list.push({
            username: accountData.username,
            avatarUrl: status.avatarUrl || accountData.avatarUrl || 'https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg',
            online: accountData.online || false,
            isRunning: status.isRunning,
            isLoggedOn: status.isLoggedOn,
            isBlocked: status.isBlocked,
            statusMessage: status.statusMessage,
            requiresSteamGuard: status.requiresSteamGuard,
            games: accountData.gamesDetails || (accountData.games || []).map(appId => ({ appId: String(appId), name: `AppID: ${appId}` })),
            gamesCount: (accountData.games || []).length,
            settings: status.settings || {
                customTitleEnabled: Boolean(accountData.customTitleEnabled),
                customTitle: accountData.customTitle || '',
                awayMessageEnabled: Boolean(accountData.awayMessageEnabled),
                awayMessage: accountData.awayMessage || '',
                appearance: accountData.appearance || (accountData.online ? 'online' : 'invisible'),
                displayMode: accountData.displayMode || 'normal'
            },
            startTime: status.startTime,
            uptime: status.uptime,
            latestBoosting: status.latestBoosting
        });
    });

    res.json(list);
});

// Add or update account
app.post('/api/accounts', (req, res) => {
    const { username, password, games = [], online = false, steamGuardCode = null } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    const cleanUsername = username.trim().toLowerCase();

    if (bots.has(cleanUsername)) {
        const entry = bots.get(cleanUsername);
        entry.accountData.password = password;
        if (steamGuardCode) {
            entry.bot.submitSteamGuard(steamGuardCode);
        }
        return res.json({ success: true, message: 'Account updated.' });
    }

    const newEntry = {
        username: username.trim(),
        password: password,
        games: games.map(Number).filter(n => !isNaN(n) && n > 0),
        gamesDetails: req.body.gamesDetails || [],
        appearance: req.body.appearance || 'online',
        online: true
    };

    const config = loadConfig().filter(c => c.username.toLowerCase() !== cleanUsername);
    config.push(newEntry);
    saveConfig(config);

    const bot = new SteamBot({
        username: newEntry.username,
        password: newEntry.password,
        games: newEntry.games,
        appearance: newEntry.appearance,
        steamGuardCode: steamGuardCode || null,
        dataDirectory: STEAM_DATA_DIR,
        tokenStorage: tokenStorage
    });

    bots.set(cleanUsername, { bot, accountData: newEntry });
    res.status(201).json({ success: true, message: 'Account added successfully.' });
});

// Delete account
app.delete('/api/accounts/:username', async (req, res) => {
    const username = req.params.username.toLowerCase();
    const entry = bots.get(username);

    if (!entry) {
        return res.status(404).json({ error: 'Account not found.' });
    }

    try {
        await entry.bot.stop();
    } catch {}

    bots.delete(username);

    const config = loadConfig().filter(item => item.username.toLowerCase() !== username);
    saveConfig(config);

    await tokenStorage.deleteToken(username);
    res.json({ success: true, message: 'Account removed.' });
});

// Start boosting
app.post('/api/accounts/:username/start', async (req, res) => {
    const username = req.params.username.toLowerCase();
    const entry = bots.get(username);

    if (!entry) {
        return res.status(404).json({ error: 'Account not found.' });
    }

    if (!entry.bot.games || entry.bot.games.length === 0) {
        return res.status(400).json({ error: 'Please add at least one game before starting the booster.' });
    }

    try {
        entry.bot.start().catch(err => {
            console.error(`Error starting bot (${username}):`, err.message);
        });
        res.json({ success: true, message: 'Start Boosting' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Stop boosting
app.post('/api/accounts/:username/stop', async (req, res) => {
    const username = req.params.username.toLowerCase();
    const entry = bots.get(username);

    if (!entry) {
        return res.status(404).json({ error: 'Account not found.' });
    }

    try {
        await entry.bot.stop();
        const latestBoosting = entry.bot.latestBoostDuration || '-';
        entry.accountData.latestBoosting = latestBoosting;

        const config = loadConfig();
        const target = config.find(item => item.username.toLowerCase() === username);
        if (target) {
            target.latestBoosting = latestBoosting;
            saveConfig(config);
        }

        res.json({ success: true, message: 'Booster stopped.', latestBoosting });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update games
app.post('/api/accounts/:username/games', (req, res) => {
    const username = req.params.username.toLowerCase();
    const entry = bots.get(username);

    if (!entry) {
        return res.status(404).json({ error: 'Account not found.' });
    }

    const { games = [], gamesDetails = [] } = req.body;
    const cleanGames = games.map(Number).filter(n => !isNaN(n) && n > 0);

    entry.bot.updateGames(cleanGames);
    entry.accountData.games = cleanGames;
    entry.accountData.gamesDetails = gamesDetails;

    const config = loadConfig();
    const target = config.find(item => item.username.toLowerCase() === username);
    if (target) {
        target.games = cleanGames;
        target.gamesDetails = gamesDetails;
        saveConfig(config);
    }

    res.json({ success: true, message: 'Games updated.', games: cleanGames });
});

// Update settings
app.post('/api/accounts/:username/settings', (req, res) => {
    const username = req.params.username.toLowerCase();
    const entry = bots.get(username);

    if (!entry) {
        return res.status(404).json({ error: 'Account not found.' });
    }

    const {
        customTitleEnabled = false,
        customTitle = '',
        awayMessageEnabled = false,
        awayMessage = '',
        appearance = 'online',
        displayMode = 'normal'
    } = req.body;

    entry.accountData.customTitleEnabled = Boolean(customTitleEnabled);
    entry.accountData.customTitle = String(customTitle).trim();
    entry.accountData.awayMessageEnabled = Boolean(awayMessageEnabled);
    entry.accountData.awayMessage = String(awayMessage).trim();
    entry.accountData.appearance = String(appearance).toLowerCase();
    entry.accountData.displayMode = String(displayMode);
    entry.accountData.online = (appearance.toLowerCase() === 'online');

    entry.bot.updateSettings({
        customTitleEnabled: entry.accountData.customTitleEnabled,
        customTitle: entry.accountData.customTitle,
        awayMessageEnabled: entry.accountData.awayMessageEnabled,
        awayMessage: entry.accountData.awayMessage,
        appearance: entry.accountData.appearance,
        displayMode: entry.accountData.displayMode
    });

    const config = loadConfig();
    const target = config.find(item => item.username.toLowerCase() === username);
    if (target) {
        target.customTitleEnabled = entry.accountData.customTitleEnabled;
        target.customTitle = entry.accountData.customTitle;
        target.awayMessageEnabled = entry.accountData.awayMessageEnabled;
        target.awayMessage = entry.accountData.awayMessage;
        target.appearance = entry.accountData.appearance;
        target.displayMode = entry.accountData.displayMode;
        target.online = entry.accountData.online;
        saveConfig(config);
    }

    res.json({ success: true, message: 'Settings updated successfully.', settings: entry.accountData });
});

// Steam Guard 2FA verification
app.post('/api/accounts/:username/steam-guard', (req, res) => {
    const username = req.params.username.toLowerCase();
    const entry = bots.get(username);

    if (!entry) {
        return res.status(404).json({ error: 'Account not found.' });
    }

    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ error: 'Steam Guard code is required.' });
    }

    try {
        entry.bot.submitSteamGuard(code);
        res.json({ success: true, message: 'Steam Guard code submitted.' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Search Steam store for games
app.get('/api/steam/search', (req, res) => {
    const query = req.query.q ? String(req.query.q).trim() : '';
    if (!query) return res.json([]);

    const steamSearchUrl = `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(query)}`;

    https.get(steamSearchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    }, (steamRes) => {
        let rawData = '';
        steamRes.on('data', chunk => rawData += chunk);
        steamRes.on('end', () => {
            try {
                const parsed = JSON.parse(rawData);
                const games = Array.isArray(parsed) ? parsed.map(g => ({
                    appId: String(g.appid),
                    name: g.name,
                    icon: g.icon || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/capsule_231x87.jpg`,
                    logo: g.logo || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/capsule_231x87.jpg`
                })) : [];
                res.json(games);
            } catch {
                res.status(500).json({ error: 'Failed to parse response' });
            }
        });
    }).on('error', (err) => {
        res.status(500).json({ error: 'Steam API error', details: err.message });
    });
});

syncBotsWithConfig();

app.listen(PORT, () => {
    console.info(`-----------------------------------------------------`);
    console.info(` Web Dashboard: http://localhost:${PORT}/panel.html`);
    console.info(`-----------------------------------------------------`);
    console.info(`         Steam Hour Boosting`);
    console.info(` Github   : https://github.com/h2hearts`);
    console.info(` Guns.lol : https://guns.lol/0h2x`);
    console.info(`-----------------------------------------------------`);
});
