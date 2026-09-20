import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class TokenStorage {
    #directory: string;

    constructor(directory = path.join(__dirname, 'tokens')) {
        this.#directory = path.resolve(directory);
        if (!fs.existsSync(this.#directory)) {
            fs.mkdirSync(this.#directory, { recursive: true });
        }
    }

    #formatPath(key: string): string {
        const safeKey = key.toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
        return path.join(this.#directory, `${safeKey}.token`);
    }

    async getToken(key: string): Promise<string | null> {
        const file = this.#formatPath(key);
        try {
            if (fs.existsSync(file)) {
                return await fs.promises.readFile(file, 'utf8');
            }
            return null;
        } catch (err: any) {
            console.error(`[TokenStorage] Read error (${key}):`, err.message);
            return null;
        }
    }

    async setToken(key: string, token: string): Promise<void> {
        const file = this.#formatPath(key);
        try {
            await fs.promises.writeFile(file, token, 'utf8');
        } catch (err: any) {
            console.error(`[TokenStorage] Save error (${key}):`, err.message);
        }
    }

    async deleteToken(key: string): Promise<void> {
        const file = this.#formatPath(key);
        try {
            if (fs.existsSync(file)) {
                await fs.promises.unlink(file);
            }
        } catch (err: any) {
            console.error(`[TokenStorage] Delete error (${key}):`, err.message);
        }
    }
}
