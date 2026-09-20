import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { data as controlCommand } from './slash-commands/panel.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const token = process.env.TOKEN_BOT;
const guildId = process.env.GUILD_ID;

if (!token || !guildId) {
    console.error('Missing TOKEN_BOT or GUILD_ID in .env file.');
    process.exit(1);
}

// Extract Client ID from Bot Token if not explicitly provided
let clientId = process.env.CLIENT_ID;
if (!clientId) {
    try {
        const firstPart = token.split('.')[0];
        clientId = Buffer.from(firstPart, 'base64').toString('utf8');
    } catch {
        console.error('Failed to extract CLIENT_ID from TOKEN_BOT.');
        process.exit(1);
    }
}

const commands = [
    controlCommand.toJSON()
];

const rest = new REST({ version: '10' }).setToken(token);

async function deploy() {
    try {
        console.log(`Deploying ${commands.length} slash command(s) to Guild ID: ${guildId}...`);

        const data: any = await rest.put(
            Routes.applicationGuildCommands(clientId!, guildId!),
            { body: commands }
        );

        console.log(`Successfully deployed ${data.length} slash command(s) to guild.`);
    } catch (error) {
        console.error('Error deploying commands:', error);
    }
}

deploy();
