const SteamUser = require('steam-user');
const path = require('path');

const LOGIN_TIMEOUT = 10 * 60 * 1000;

class SteamBot {
    #username;
    #password;
    #games;
    #online;
    #steam;
    #tokenStorage;
    #pauseErrors = false;
    #blocked = false;
    #isLoggedOn = false;
    #isRunning = false;
    #startTime = null;
    #totalBoostedMs = 0;
    #sessionStartTime = null;
    #latestBoostDuration = null;
    #avatarUrl = null;
    #steamGuardCallback = null;
    #steamGuardCode = null;
    #statusMessage = 'Disconnected';
    #customTitleEnabled = false;
    #customTitle = '';
    #awayMessageEnabled = false;
    #awayMessage = '';
    #appearance = 'online';
    #displayMode = 'normal';
    #repliedFriends = new Map();
    #reconnectTimer = null;

    constructor({
        username,
        password,
        games = [],
        steamGuardCode = null,
        avatarUrl = null,
        latestBoosting = null,
        customTitleEnabled = false,
        customTitle = '',
        awayMessageEnabled = false,
        awayMessage = '',
        appearance = 'online',
        displayMode = 'normal',
        dataDirectory = path.join(__dirname, 'steam-data'),
        tokenStorage = null,
        online = false,
        onStatusChange = null
    }) {
        this.#username = username.toLowerCase();
        this.#password = password;
        this.#games = games.map(Number).filter(n => !isNaN(n) && n > 0);
        this.#steamGuardCode = steamGuardCode ? String(steamGuardCode).trim() : null;
        this.#avatarUrl = avatarUrl || null;
        this.#latestBoostDuration = latestBoosting || null;
        this.#customTitleEnabled = Boolean(customTitleEnabled);
        this.#customTitle = String(customTitle || '').trim();
        this.#awayMessageEnabled = Boolean(awayMessageEnabled);
        this.#awayMessage = String(awayMessage || '').trim();
        this.#appearance = appearance || 'online';
        this.#displayMode = displayMode || 'normal';
        this.#online = Boolean(online);
        this.#tokenStorage = tokenStorage;
        this.onStatusChange = onStatusChange;

        this.#steam = new SteamUser({
            autoRelogin: true,
            dataDirectory: path.resolve(dataDirectory),
            protocol: SteamUser.EConnectionProtocol.WebSocket
        });

        this.#setupEvents();
    }

    get username() {
        return this.#username;
    }

    get games() {
        return [...this.#games];
    }

    get isRunning() {
        return this.#isRunning;
    }

    get isLoggedOn() {
        return this.#isLoggedOn;
    }

    get isBlocked() {
        return this.#blocked;
    }

    get requiresSteamGuard() {
        return this.#steamGuardCallback !== null;
    }

    get statusMessage() {
        return this.#statusMessage;
    }

    get startTime() {
        return this.#startTime;
    }

    get latestBoostDuration() {
        return this.#latestBoostDuration;
    }

    get avatarUrl() {
        return this.#avatarUrl;
    }

    get uptimeMinutes() {
        if (!this.#isRunning) return 0;
        const currentMs = this.#totalBoostedMs + (this.#isLoggedOn && this.#sessionStartTime ? (Date.now() - this.#sessionStartTime) : 0);
        return Math.floor(currentMs / 60000);
    }

    #log(msg) {
        console.info(`[SteamBot - ${this.#username}] ${msg}`);
    }

    #notifyStatus(extra = {}) {
        if (typeof this.onStatusChange === 'function') {
            this.onStatusChange(this.getStatus());
        }
    }

    #scheduleReconnect(delayMs = 5000) {
        if (!this.#isRunning || this.#isLoggedOn || this.#reconnectTimer) return;
        this.#statusMessage = 'Reconnecting...';
        this.#notifyStatus();
        this.#log(`Connection dropped. Auto-reconnecting in ${Math.round(delayMs / 1000)}s...`);

        this.#reconnectTimer = setTimeout(async () => {
            this.#reconnectTimer = null;
            if (!this.#isRunning || this.#isLoggedOn) return;
            if (this.#steam?.steamID || this.#steam?._connecting) {
                this.#log('Steam client is already reconnecting internally.');
                return;
            }
            try {
                this.#log('Attempting auto-reconnect now...');
                await this.#performLogin();
            } catch (err) {
                this.#log(`Auto-reconnect failed: ${err.message}. Retrying in 15s...`);
                if (this.#isRunning && !this.#isLoggedOn) {
                    this.#scheduleReconnect(15000);
                }
            }
        }, delayMs);
    }

    #setupEvents() {
        this.#steam.on('loggedOn', () => {
            if (this.#reconnectTimer) {
                clearTimeout(this.#reconnectTimer);
                this.#reconnectTimer = null;
            }
            this.#isLoggedOn = true;
            this.#sessionStartTime = Date.now();
            this.#statusMessage = 'Boosting';
            this.#steamGuardCallback = null;
            this.#log('Logged in successfully');

            this.#applyPersonaState();
            this.#fetchAvatar();
            this.#play();
            this.#notifyStatus();
        });

        this.#steam.on('disconnected', (eresult, msg) => {
            if (this.#sessionStartTime) {
                this.#totalBoostedMs += Date.now() - this.#sessionStartTime;
                this.#sessionStartTime = null;
            }
            this.#isLoggedOn = false;
            this.#statusMessage = this.#isRunning ? 'Reconnecting...' : 'Disconnected';
            this.#log(`Disconnected: ${eresult} - ${msg}`);
            this.#notifyStatus();

            if (this.#isRunning) {
                this.#scheduleReconnect(5000);
            }
        });

        this.#steam.on('error', (err) => {
            if (this.#sessionStartTime) {
                this.#totalBoostedMs += Date.now() - this.#sessionStartTime;
                this.#sessionStartTime = null;
            }
            this.#isLoggedOn = false;
            if (this.#pauseErrors) return;
            this.#statusMessage = this.#isRunning ? 'Reconnecting...' : 'Disconnected';
            this.#log(`Client error: ${err.message}`);
            this.#notifyStatus();

            if (this.#isRunning && !this.#isLoggedOn) {
                this.#scheduleReconnect(5000);
            }
        });

        // Pause boosting if user plays locally on desktop
        this.#steam.on('playingState', (blocked, playingApp) => {
            this.#blocked = blocked;
            if (!blocked && playingApp !== 0) return;

            this.#log(`Playing state changed: blocked=${blocked}, app=${playingApp}`);
            this.#play();
            this.#notifyStatus();
        });

        // 2FA / Steam Guard callback
        this.#steam.on('steamGuard', (domain, callback, lastCodeWrong) => {
            this.#statusMessage = lastCodeWrong ? 'Kode Steam Guard Salah' : 'Awaiting Steam Guard Code';
            this.#steamGuardCallback = callback;
            this.#notifyStatus({ requiresSteamGuard: true, domain, lastCodeWrong });
        });

        // Save refresh token
        this.#steam.on('refreshToken', (refreshToken) => {
            if (this.#tokenStorage) {
                this.#tokenStorage.setToken(this.#username, refreshToken);
            }
        });

        // Auto-reply to chat
        this.#steam.on('friendMessage', (steamID, message) => {
            if (!this.#awayMessageEnabled || !this.#awayMessage) return;
            if (!message || !message.trim()) return;

            const sid64 = steamID.getSteamID64();
            const now = Date.now();
            const lastReplied = this.#repliedFriends.get(sid64) || 0;

            // 5-minute cooldown per friend
            if (now - lastReplied > 5 * 60 * 1000) {
                this.#repliedFriends.set(sid64, now);
                try {
                    this.#steam.chatMessage(steamID, this.#awayMessage);
                } catch (err) {
                    this.#log(`Failed to reply away message: ${err.message}`);
                }
            }
        });

        // User persona updates
        this.#steam.on('user', (sid, user) => {
            if (this.#steam.steamID && sid.getSteamID64() === this.#steam.steamID.getSteamID64()) {
                const avatar = user.avatar_url_full || user.avatar_url_medium;
                if (avatar && avatar !== this.#avatarUrl) {
                    this.#avatarUrl = avatar;
                    this.#notifyStatus();
                }
            }
        });
    }

    #applyPersonaState() {
        if (!this.#isLoggedOn) return;
        const app = this.#appearance.toLowerCase();
        let stateCode = 1;

        if (app === 'online') {
            stateCode = 1;
        } else if (app === 'away') {
            stateCode = 3;
        } else if (app === 'busy') {
            stateCode = 2;
        } else if (app === 'invisible' || app === 'offline') {
            stateCode = 7;
        }

        this.#log(`Setting persona state to: ${app} (code: ${stateCode})`);
        try {
            this.#steam.setPersona(stateCode);
        } catch (err) {
            this.#log(`Failed to set persona state: ${err.message}`);
        }
    }

    #fetchAvatar() {
        if (!this.#steam.steamID) return;
        const sid64 = this.#steam.steamID.getSteamID64();
        try {
            this.#steam.getPersonas([this.#steam.steamID], (err, res) => {
                if (!err && res) {
                    const personas = res.personas || res;
                    const data = personas[sid64];
                    if (data && (data.avatar_url_full || data.avatar_url_medium)) {
                        this.#avatarUrl = data.avatar_url_full || data.avatar_url_medium;
                        this.#notifyStatus();
                    }
                }
            });
        } catch (e) {}
    }

    submitSteamGuard(code) {
        const cleanCode = code ? String(code).trim() : '';
        this.#steamGuardCode = cleanCode;

        if (this.#steamGuardCallback) {
            const cb = this.#steamGuardCallback;
            this.#steamGuardCallback = null;
            cb(cleanCode);
            this.#statusMessage = 'Connecting...';
            this.#notifyStatus();
        } else {
            this.#statusMessage = 'Connecting...';
            this.#notifyStatus();
            this.#performLogin().catch(err => {
                console.error(`[${this.#username}] Login error:`, err.message);
            });
        }
    }

    async start() {
        if (this.#isRunning) return;

        this.#isRunning = true;
        this.#totalBoostedMs = 0;
        this.#sessionStartTime = null;
        this.#startTime = Date.now();
        this.#statusMessage = 'Connecting...';
        this.#notifyStatus();

        try {
            await this.#performLogin();
        } catch (err) {
            this.#isRunning = false;
            this.#statusMessage = 'Disconnected';
            this.#notifyStatus();
            throw err;
        }
    }

    async stop() {
        if (this.#reconnectTimer) {
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
        this.#isRunning = false;
        this.#statusMessage = 'Disconnected';
        this.#steamGuardCallback = null;

        if (this.#sessionStartTime) {
            this.#totalBoostedMs += Date.now() - this.#sessionStartTime;
            this.#sessionStartTime = null;
        }

        if (this.#totalBoostedMs > 0) {
            this.#latestBoostDuration = formatDuration(this.#totalBoostedMs);
        } else if (this.#startTime) {
            const elapsed = Date.now() - this.#startTime;
            this.#latestBoostDuration = formatDuration(elapsed);
        }
        this.#totalBoostedMs = 0;
        this.#startTime = null;

        try {
            this.#steam.gamesPlayed([]);
            this.#steam.logOff();
        } catch (err) {}

        this.#isLoggedOn = false;
        this.#notifyStatus();
    }

    updateGames(games) {
        this.#games = games.map(Number).filter(n => !isNaN(n) && n > 0);
        if (this.#isLoggedOn && !this.#blocked) {
            this.#play();
        }
        this.#notifyStatus();
    }

    async #createLoginDetails() {
        const details = { renewRefreshTokens: true };
        const token = this.#tokenStorage ? await this.#tokenStorage.getToken(this.#username) : null;

        if (token) {
            return { refreshToken: token, ...details };
        }

        const credentials = {
            accountName: this.#username,
            password: this.#password,
            ...details
        };

        if (this.#steamGuardCode) {
            credentials.twoFactorCode = this.#steamGuardCode;
            credentials.authCode = this.#steamGuardCode;
        }

        return credentials;
    }

    async #performLogin() {
        const details = await this.#createLoginDetails();

        return new Promise((resolve, reject) => {
            let settled = false;

            const onLoggedOn = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
            };

            const onError = (err) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(err);
            };

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error('Login timed out'));
            }, LOGIN_TIMEOUT);

            const cleanup = () => {
                clearTimeout(timer);
                this.#steam.removeListener('loggedOn', onLoggedOn);
                this.#steam.removeListener('error', onError);
                this.#pauseErrors = false;
            };

            this.#pauseErrors = true;
            this.#steam.once('loggedOn', onLoggedOn);
            this.#steam.once('error', onError);
            this.#steam.logOn(details);
        });
    }

    #play() {
        if (!this.#isLoggedOn) return;

        if (this.#blocked) {
            this.#steam.gamesPlayed([]);
            this.#statusMessage = 'Paused';
            return;
        }

        const apps = [];
        if (this.#customTitleEnabled && this.#customTitle) {
            apps.push(this.#customTitle);
        }
        apps.push(...this.#games);

        if (apps.length > 0) {
            this.#steam.gamesPlayed(apps);
            this.#applyPersonaState();
            this.#statusMessage = 'Boosting';
            this.#log(`Boosting: [${apps.join(', ')}]`);
        } else {
            this.#steam.gamesPlayed([]);
            this.#applyPersonaState();
            this.#statusMessage = 'Idle';
        }
    }

    updateSettings({
        customTitleEnabled,
        customTitle,
        awayMessageEnabled,
        awayMessage,
        appearance,
        displayMode
    } = {}) {
        if (customTitleEnabled !== undefined) this.#customTitleEnabled = Boolean(customTitleEnabled);
        if (customTitle !== undefined) this.#customTitle = String(customTitle).trim();
        if (awayMessageEnabled !== undefined) this.#awayMessageEnabled = Boolean(awayMessageEnabled);
        if (awayMessage !== undefined) this.#awayMessage = String(awayMessage).trim();
        if (appearance !== undefined) this.#appearance = String(appearance).toLowerCase();
        if (displayMode !== undefined) this.#displayMode = String(displayMode);

        if (this.#isLoggedOn) {
            this.#applyPersonaState();
            this.#play();
        }

        this.#notifyStatus();
    }

    getStatus() {
        const currentUptimeMs = this.#totalBoostedMs + (this.#isLoggedOn && this.#sessionStartTime ? (Date.now() - this.#sessionStartTime) : 0);
        return {
            username: this.#username,
            isRunning: this.#isRunning,
            isLoggedOn: this.#isLoggedOn,
            isBlocked: this.#blocked,
            statusMessage: this.#statusMessage,
            requiresSteamGuard: this.requiresSteamGuard,
            games: this.games,
            gamesCount: this.#games.length,
            avatarUrl: this.#avatarUrl,
            settings: {
                customTitleEnabled: this.#customTitleEnabled,
                customTitle: this.#customTitle,
                awayMessageEnabled: this.#awayMessageEnabled,
                awayMessage: this.#awayMessage,
                appearance: this.#appearance,
                displayMode: this.#displayMode
            },
            startTime: this.#startTime,
            uptime: this.#isRunning ? formatDuration(currentUptimeMs) : '-',
            latestBoosting: this.#isRunning ? '-' : (this.#latestBoostDuration || '-'),
            uptimeMinutes: Math.floor(currentUptimeMs / 60000)
        };
    }
}

function formatDuration(ms) {
    if (!ms || ms <= 0) return '0s';
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

module.exports = { SteamBot, SteamClient: SteamBot, formatDuration };
