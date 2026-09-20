import SteamUser from 'steam-user';
import path from 'path';
import { fileURLToPath } from 'url';
import type { TokenStorage } from './tokens-storage.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGIN_TIMEOUT = 10 * 60 * 1000;

export interface BotSettings {
    customTitleEnabled: boolean;
    customTitle: string;
    awayMessageEnabled: boolean;
    awayMessage: string;
    appearance: string;
    displayMode: string;
}

export interface SteamBotOptions {
    username: string;
    password?: string;
    games?: number[];
    steamGuardCode?: string | null;
    avatarUrl?: string | null;
    latestBoosting?: string | null;
    customTitleEnabled?: boolean;
    customTitle?: string;
    awayMessageEnabled?: boolean;
    awayMessage?: string;
    appearance?: string;
    displayMode?: string;
    dataDirectory?: string;
    tokenStorage?: TokenStorage | null;
    online?: boolean;
    onStatusChange?: ((status: SteamBotStatus) => void) | null;
}

export interface SteamBotStatus {
    username: string;
    isRunning: boolean;
    isLoggedOn: boolean;
    isBlocked: boolean;
    statusMessage: string;
    requiresSteamGuard: boolean;
    games: number[];
    gamesCount: number;
    avatarUrl: string | null;
    settings: BotSettings;
    startTime: number | null;
    uptime: string;
    latestBoosting: string;
    uptimeMinutes: number;
}

export class SteamBot {
    #username: string;
    #password: string;
    #games: number[];
    #online: boolean;
    #steam: any;
    #tokenStorage: TokenStorage | null;
    #pauseErrors = false;
    #blocked = false;
    #isLoggedOn = false;
    #isRunning = false;
    #startTime: number | null = null;
    #totalBoostedMs = 0;
    #sessionStartTime: number | null = null;
    #latestBoostDuration: string | null = null;
    #avatarUrl: string | null = null;
    #steamGuardCallback: ((code: string) => void) | null = null;
    #steamGuardCode: string | null = null;
    #statusMessage = 'Disconnected';
    #customTitleEnabled = false;
    #customTitle = '';
    #awayMessageEnabled = false;
    #awayMessage = '';
    #appearance = 'online';
    #displayMode = 'normal';
    #repliedFriends = new Map<string, number>();
    #reconnectTimer: any = null;

    onStatusChange: ((status: SteamBotStatus) => void) | null = null;

    constructor(options: SteamBotOptions) {
        this.#username = options.username.toLowerCase();
        this.#password = options.password || '';
        this.#games = (options.games || []).map(Number).filter(n => !isNaN(n) && n > 0);
        this.#steamGuardCode = options.steamGuardCode ? String(options.steamGuardCode).trim() : null;
        this.#avatarUrl = options.avatarUrl || null;
        this.#latestBoostDuration = options.latestBoosting || null;
        this.#customTitleEnabled = Boolean(options.customTitleEnabled);
        this.#customTitle = String(options.customTitle || '').trim();
        this.#awayMessageEnabled = Boolean(options.awayMessageEnabled);
        this.#awayMessage = String(options.awayMessage || '').trim();
        this.#appearance = options.appearance || 'online';
        this.#displayMode = options.displayMode || 'normal';
        this.#online = Boolean(options.online);
        this.#tokenStorage = options.tokenStorage || null;
        this.onStatusChange = options.onStatusChange || null;

        const dataDir = options.dataDirectory || path.join(__dirname, 'steam-data');

        this.#steam = new SteamUser({
            autoRelogin: true,
            dataDirectory: path.resolve(dataDir),
            protocol: SteamUser.EConnectionProtocol.WebSocket
        });

        this.#setupEvents();
    }

    get username(): string {
        return this.#username;
    }

    get games(): number[] {
        return [...this.#games];
    }

    get isRunning(): boolean {
        return this.#isRunning;
    }

    get isLoggedOn(): boolean {
        return this.#isLoggedOn;
    }

    get isBlocked(): boolean {
        return this.#blocked;
    }

    get requiresSteamGuard(): boolean {
        return this.#steamGuardCallback !== null;
    }

    get statusMessage(): string {
        return this.#statusMessage;
    }

    get startTime(): number | null {
        return this.#startTime;
    }

    get latestBoostDuration(): string | null {
        return this.#latestBoostDuration;
    }

    get avatarUrl(): string | null {
        return this.#avatarUrl;
    }

    get uptimeMinutes(): number {
        if (!this.#isRunning) return 0;
        const currentMs = this.#totalBoostedMs + (this.#isLoggedOn && this.#sessionStartTime ? (Date.now() - this.#sessionStartTime) : 0);
        return Math.floor(currentMs / 60000);
    }

    #log(msg: string) {
        console.info(`[SteamBot - ${this.#username}] ${msg}`);
    }

    #notifyStatus() {
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
            } catch (err: any) {
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

        this.#steam.on('disconnected', (eresult: any, msg: string) => {
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

        this.#steam.on('error', (err: Error) => {
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
        this.#steam.on('playingState', (blocked: boolean, playingApp: number) => {
            this.#blocked = blocked;
            if (!blocked && playingApp !== 0) return;

            this.#log(`Playing state changed: blocked=${blocked}, app=${playingApp}`);
            this.#play();
            this.#notifyStatus();
        });

        // 2FA / Steam Guard callback
        this.#steam.on('steamGuard', (domain: string, callback: (code: string) => void, lastCodeWrong: boolean) => {
            this.#statusMessage = lastCodeWrong ? 'Invalid Steam Guard Code' : 'Awaiting Steam Guard Code';
            this.#steamGuardCallback = callback;
            this.#notifyStatus();
        });

        // Save refresh token
        this.#steam.on('refreshToken', (refreshToken: string) => {
            if (this.#tokenStorage) {
                this.#tokenStorage.setToken(this.#username, refreshToken);
            }
        });

        // Auto-reply to chat
        this.#steam.on('friendMessage', (steamID: any, message: string) => {
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
                } catch (err: any) {
                    this.#log(`Failed to reply away message: ${err.message}`);
                }
            }
        });

        // User persona updates
        this.#steam.on('user', (sid: any, user: any) => {
            if (this.#steam.steamID && sid.getSteamID64() === this.#steam.steamID.getSteamID64()) {
                const avatar = user.avatar_url_full || user.avatar_url_medium;
                if (avatar && avatar !== this.#avatarUrl) {
                    this.#avatarUrl = avatar;
                    this.#notifyStatus();
                }
            }
        });
    }

    // Apply Steam persona appearance state
    #applyPersonaState() {
        if (!this.#isLoggedOn) return;
        const app = this.#appearance.toLowerCase();
        let stateCode = 1; // 1 = Online

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
        } catch (err: any) {
            this.#log(`Failed to set persona state: ${err.message}`);
        }
    }

    // Fetch avatar using getPersonas
    #fetchAvatar() {
        if (!this.#steam.steamID) return;
        const sid64 = this.#steam.steamID.getSteamID64();
        try {
            this.#steam.getPersonas([this.#steam.steamID], (err: any, res: any) => {
                if (!err && res) {
                    const personas = res.personas || res;
                    const data = personas[sid64];
                    if (data && (data.avatar_url_full || data.avatar_url_medium)) {
                        this.#avatarUrl = data.avatar_url_full || data.avatar_url_medium;
                        this.#notifyStatus();
                    }
                }
            });
        } catch {}
    }

    // Submit Steam Guard 2FA code
    submitSteamGuard(code: string) {
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

    // Start boosting
    async start(): Promise<void> {
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

    // Stop boosting
    async stop(): Promise<void> {
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
        } catch {}

        this.#isLoggedOn = false;
        this.#notifyStatus();
    }

    // Update boosting games
    updateGames(games: number[]) {
        this.#games = games.map(Number).filter(n => !isNaN(n) && n > 0);
        if (this.#isLoggedOn && !this.#blocked) {
            this.#play();
        }
        this.#notifyStatus();
    }

    async #createLoginDetails(): Promise<any> {
        const details: any = { renewRefreshTokens: true };
        const token = this.#tokenStorage ? await this.#tokenStorage.getToken(this.#username) : null;

        if (token) {
            return { refreshToken: token, ...details };
        }

        const credentials: any = {
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

    // Perform Steam login
    async #performLogin(): Promise<void> {
        const details = await this.#createLoginDetails();

        return new Promise((resolve, reject) => {
            let settled = false;

            const onLoggedOn = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
            };

            const onError = (err: Error) => {
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

    // Launch games and set custom title
    #play() {
        if (!this.#isLoggedOn) return;

        if (this.#blocked) {
            this.#steam.gamesPlayed([]);
            this.#statusMessage = 'Paused';
            return;
        }

        const apps: (number | string)[] = [];
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

    // Update account settings
    updateSettings(settings: Partial<BotSettings> = {}) {
        if (settings.customTitleEnabled !== undefined) this.#customTitleEnabled = Boolean(settings.customTitleEnabled);
        if (settings.customTitle !== undefined) this.#customTitle = String(settings.customTitle).trim();
        if (settings.awayMessageEnabled !== undefined) this.#awayMessageEnabled = Boolean(settings.awayMessageEnabled);
        if (settings.awayMessage !== undefined) this.#awayMessage = String(settings.awayMessage).trim();
        if (settings.appearance !== undefined) this.#appearance = String(settings.appearance).toLowerCase();
        if (settings.displayMode !== undefined) this.#displayMode = String(settings.displayMode);

        if (this.#isLoggedOn) {
            this.#applyPersonaState();
            this.#play();
        }

        this.#notifyStatus();
    }

    // Get current bot status
    getStatus(): SteamBotStatus {
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

export function formatDuration(ms: number): string {
    if (!ms || ms <= 0) return '0s';
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}
