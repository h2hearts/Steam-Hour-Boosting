import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { SteamBot, type SteamBotStatus, type BotSettings } from './bot.ts';
import { TokenStorage } from './tokens-storage.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AccountConfig {
    username: string;
    password?: string;
    games?: number[];
    gamesDetails?: any[];
    avatarUrl?: string | null;
    latestBoosting?: string | null;
    customTitleEnabled?: boolean;
    customTitle?: string;
    awayMessageEnabled?: boolean;
    awayMessage?: string;
    appearance?: string;
    displayMode?: string;
    online?: boolean;
}

const CONFIG_FILE = path.join(__dirname, 'config.json');
const TOKENS_DIR = path.join(__dirname, 'tokens');
const STEAM_DATA_DIR = path.join(__dirname, 'steam-data');

export const tokenStorage = new TokenStorage(TOKENS_DIR);
const bots = new Map<string, { bot: SteamBot; accountData: AccountConfig }>();

export function loadConfig(): AccountConfig[] {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (err: any) {
        console.error('[SteamServer] Read config.json error:', err.message);
    }
    return [];
}

export function saveConfig(config: AccountConfig[]) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err: any) {
        console.error('[SteamServer] Save config.json error:', err.message);
    }
}

// Extract SteamID64 from saved token
export function getSteamIdFromToken(username: string): string | null {
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
export function fetchAvatarBySteamId64(steamId64: string): Promise<string | null> {
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
export function syncBotsWithConfig() {
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

// Get all accounts
export function getAccounts(): AccountConfig[] {
    syncBotsWithConfig();
    return loadConfig();
}

// Get single account by username
export function getAccount(username: string): { entry: AccountConfig; bot: SteamBot; status: SteamBotStatus } | null {
    syncBotsWithConfig();
    const cleanUsername = username.toLowerCase();
    const item = bots.get(cleanUsername);
    if (!item) return null;
    return {
        entry: item.accountData,
        bot: item.bot,
        status: item.bot.getStatus()
    };
}

// Add or update account
export function addAccount(data: { username: string; password?: string; games?: number[]; steamGuardCode?: string | null }) {
    if (!data.username || !data.password) {
        return { success: false, message: 'Username and password are required.' };
    }

    const cleanUsername = data.username.trim().toLowerCase();
    syncBotsWithConfig();

    if (bots.has(cleanUsername)) {
        const item = bots.get(cleanUsername)!;
        item.accountData.password = data.password;
        if (data.steamGuardCode) {
            item.bot.submitSteamGuard(data.steamGuardCode);
        }
        const cfg = loadConfig();
        const target = cfg.find(c => c.username.toLowerCase() === cleanUsername);
        if (target) {
            target.password = data.password;
            saveConfig(cfg);
        }
        return { success: true, message: 'Account updated successfully.' };
    }

    const newEntry: AccountConfig = {
        username: data.username.trim(),
        password: data.password,
        games: (data.games || []).map(Number).filter(n => !isNaN(n) && n > 0),
        appearance: 'online',
        online: true
    };

    const cfg = loadConfig().filter(c => c.username.toLowerCase() !== cleanUsername);
    cfg.push(newEntry);
    saveConfig(cfg);

    const bot = new SteamBot({
        username: newEntry.username,
        password: newEntry.password,
        games: newEntry.games,
        appearance: 'online',
        steamGuardCode: data.steamGuardCode || null,
        dataDirectory: STEAM_DATA_DIR,
        tokenStorage: tokenStorage
    });

    bots.set(cleanUsername, { bot, accountData: newEntry });
    return { success: true, message: 'Account added successfully.' };
}

// Delete account
export async function deleteAccount(username: string): Promise<{ success: boolean; message: string }> {
    const cleanUsername = username.toLowerCase();
    syncBotsWithConfig();
    const item = bots.get(cleanUsername);

    if (!item) {
        return { success: false, message: 'Account not found.' };
    }

    try {
        await item.bot.stop();
    } catch {}

    bots.delete(cleanUsername);

    const cfg = loadConfig().filter(c => c.username.toLowerCase() !== cleanUsername);
    saveConfig(cfg);

    await tokenStorage.deleteToken(cleanUsername);
    return { success: true, message: 'Account deleted successfully.' };
}

// Start boosting
export async function startBoost(username: string): Promise<{ success: boolean; message: string }> {
    const cleanUsername = username.toLowerCase();
    syncBotsWithConfig();
    const item = bots.get(cleanUsername);

    if (!item) {
        return { success: false, message: 'Account not found.' };
    }

    if (!item.bot.games || item.bot.games.length === 0) {
        return { success: false, message: 'Please add at least one game before starting the booster.' };
    }

    try {
        item.bot.start().catch(err => {
            console.error(`[SteamServer] Bot start error (${username}):`, err.message);
        });
        return { success: true, message: 'Booster started.' };
    } catch (err: any) {
        return { success: false, message: err.message };
    }
}

// Stop boosting
export async function stopBoost(username: string): Promise<{ success: boolean; message: string; latestBoosting?: string }> {
    const cleanUsername = username.toLowerCase();
    syncBotsWithConfig();
    const item = bots.get(cleanUsername);

    if (!item) {
        return { success: false, message: 'Account not found.' };
    }

    try {
        await item.bot.stop();
        const latestBoosting = item.bot.latestBoostDuration || '-';
        item.accountData.latestBoosting = latestBoosting;

        const cfg = loadConfig();
        const target = cfg.find(c => c.username.toLowerCase() === cleanUsername);
        if (target) {
            target.latestBoosting = latestBoosting;
            saveConfig(cfg);
        }

        return { success: true, message: 'Booster stopped.', latestBoosting };
    } catch (err: any) {
        return { success: false, message: err.message };
    }
}

// Update games
export function updateGames(username: string, games: number[]) {
    const cleanUsername = username.toLowerCase();
    syncBotsWithConfig();
    const item = bots.get(cleanUsername);

    if (!item) {
        return { success: false, message: 'Account not found.' };
    }

    const cleanGames = games.map(Number).filter(n => !isNaN(n) && n > 0);
    item.bot.updateGames(cleanGames);
    item.accountData.games = cleanGames;

    const cfg = loadConfig();
    const target = cfg.find(c => c.username.toLowerCase() === cleanUsername);
    if (target) {
        target.games = cleanGames;
        saveConfig(cfg);
    }

    return { success: true, games: cleanGames };
}

// Update account settings
export function updateSettings(username: string, settings: Partial<BotSettings>) {
    const cleanUsername = username.toLowerCase();
    syncBotsWithConfig();
    const item = bots.get(cleanUsername);

    if (!item) {
        return { success: false, message: 'Account not found.' };
    }

    if (settings.customTitleEnabled !== undefined) item.accountData.customTitleEnabled = Boolean(settings.customTitleEnabled);
    if (settings.customTitle !== undefined) item.accountData.customTitle = String(settings.customTitle).trim();
    if (settings.awayMessageEnabled !== undefined) item.accountData.awayMessageEnabled = Boolean(settings.awayMessageEnabled);
    if (settings.awayMessage !== undefined) item.accountData.awayMessage = String(settings.awayMessage).trim();
    if (settings.appearance !== undefined) item.accountData.appearance = String(settings.appearance).toLowerCase();
    if (settings.displayMode !== undefined) item.accountData.displayMode = String(settings.displayMode);

    item.bot.updateSettings(settings);

    const cfg = loadConfig();
    const target = cfg.find(c => c.username.toLowerCase() === cleanUsername);
    if (target) {
        target.customTitleEnabled = item.accountData.customTitleEnabled;
        target.customTitle = item.accountData.customTitle;
        target.awayMessageEnabled = item.accountData.awayMessageEnabled;
        target.awayMessage = item.accountData.awayMessage;
        target.appearance = item.accountData.appearance;
        target.displayMode = item.accountData.displayMode;
        saveConfig(cfg);
    }

    return { success: true };
}

// Submit Steam Guard 2FA code
export function submitSteamGuard(username: string, code: string) {
    const cleanUsername = username.toLowerCase();
    syncBotsWithConfig();
    const item = bots.get(cleanUsername);

    if (!item) {
        return { success: false, message: 'Account not found.' };
    }

    item.bot.submitSteamGuard(code);
    return { success: true, message: 'Steam Guard code submitted.' };
}

// Initial sync
syncBotsWithConfig();
