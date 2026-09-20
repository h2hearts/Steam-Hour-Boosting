const fs = require('fs');
const path = require('path');

class TokenStorage {
    #directory;

    constructor(directory = path.join(__dirname, 'tokens')) {
        this.#directory = path.resolve(directory);
        if (!fs.existsSync(this.#directory)) {
            fs.mkdirSync(this.#directory, { recursive: true });
        }
    }

    #formatPath(key) {
        const safeKey = key.toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
        return path.join(this.#directory, `${safeKey}.token`);
    }

    async getToken(key) {
        const file = this.#formatPath(key);
        try {
            if (fs.existsSync(file)) {
                return await fs.promises.readFile(file, 'utf8');
            }
            return null;
        } catch (err) {
            console.error(`[TokenStorage] Read error (${key}):`, err.message);
            return null;
        }
    }

    async setToken(key, token) {
        const file = this.#formatPath(key);
        try {
            await fs.promises.writeFile(file, token, 'utf8');
        } catch (err) {
            console.error(`[TokenStorage] Save error (${key}):`, err.message);
        }
    }

    async deleteToken(key) {
        const file = this.#formatPath(key);
        try {
            if (fs.existsSync(file)) {
                await fs.promises.unlink(file);
            }
        } catch (err) {
            console.error(`[TokenStorage] Delete error (${key}):`, err.message);
        }
    }
}

module.exports = { TokenStorage };
