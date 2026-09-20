import { Client, Events, MessageFlags } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { execute as executePanel, handleButton, handleModal } from './slash-commands/panel.ts';
import './steam/server.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const token = process.env.TOKEN_BOT;

if (!token) {
    console.error('Missing TOKEN_BOT in .env file.');
    process.exit(1);
}


const ALL_INTENTS_NUMBER = 32767;

function setupEventHandlers(botClient: Client) {
    botClient.once(Events.ClientReady, (readyClient) => {
        console.log(`-----------------------------------------------------`);
        console.log(` Bot Online : ${readyClient.user.tag}`);
        console.log(` Guild ID   : ${process.env.GUILD_ID || 'None'}`);
        console.log(`-----------------------------------------------------`);
        console.log(`         Steam Hour Boosting`);
        console.log(` Github   : https://github.com/h2hearts`);
        console.log(` Guns.lol : https://guns.lol/0h2x`);
        console.log(`-----------------------------------------------------`);
    });

    botClient.on(Events.InteractionCreate, async (interaction) => {
        try {
            if (interaction.isChatInputCommand()) {
                if (interaction.commandName === 'control') {
                    await executePanel(interaction);
                }
                return;
            }

            if (interaction.isButton()) {
                await handleButton(interaction);
                return;
            }

            if (interaction.isModalSubmit()) {
                await handleModal(interaction);
                return;
            }
        } catch (err: any) {
            console.error('Interaction error:', err);
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: `An error occurred: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    });
}

const client = new Client({
    intents: ALL_INTENTS_NUMBER
});

setupEventHandlers(client);

client.login(token).catch((err: any) => {
    if (err.message && err.message.includes('DISALLOWED_INTENTS')) {
        console.warn('\n[Warning] Privileged Gateway Intents are disabled in Discord Developer Portal.');
        console.warn('Logging in with unprivileged intents fallback (130815)...\n');

        const unprivilegedIntents = 32767 & ~(1 | (1 << 1) | (1 << 8) | (1 << 15));
        const fallbackClient = new Client({
            intents: unprivilegedIntents
        });

        setupEventHandlers(fallbackClient);
        fallbackClient.login(token).catch(fallbackErr => {
            console.error('Failed to log in with fallback intents:', fallbackErr);
        });
    } else {
        console.error('Failed to log in to Discord:', err);
    }
});
