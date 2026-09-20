import {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    type ChatInputCommandInteraction,
    type ButtonInteraction,
    type ModalSubmitInteraction
} from 'discord.js';

import {
    getAccounts,
    getAccount,
    addAccount,
    deleteAccount,
    startBoost,
    stopBoost,
    updateGames,
    updateSettings,
    submitSteamGuard,
    syncBotsWithConfig
} from '../steam/server.ts';

export const data = new SlashCommandBuilder()
    .setName('control')
    .setDescription('Steam Hour Boosting control')
    .addSubcommand(sub =>
        sub.setName('panel')
           .setDescription('Open Steam Hour Boosting Control Panel')
    );

export function buildPanelMessage(pageIndex = 0) {
    const accounts = getAccounts();
    const totalAccounts = accounts.length;
    const page = Math.max(0, Math.min(pageIndex, totalAccounts > 0 ? totalAccounts - 1 : 0));

    // Title header container
    const builder1 = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Steam Hour Boosting - Control Panel')
        );

    // Account info & status container
    const builder2 = new ContainerBuilder();

    let currentAccount: any = null;
    let botStatus: any = null;

    if (totalAccounts > 0) {
        currentAccount = accounts[page];
        const botData = getAccount(currentAccount.username);
        botStatus = botData?.status;

        const pfp = botStatus?.avatarUrl || currentAccount.avatarUrl || 'https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg';

        const gamesList = (botStatus?.games && botStatus.games.length > 0)
            ? botStatus.games.join(', ')
            : ((currentAccount.games && currentAccount.games.length > 0) ? currentAccount.games.join(', ') : 'None');

        let accountText = `### ${currentAccount.username}\n` +
            `**Status**: ${botStatus?.statusMessage || (botStatus?.isRunning ? 'Boosting' : 'Idle')}\n` +
            `**Appearance**: ${currentAccount.appearance || 'online'}\n` +
            `**Time Left**: Unlimited\n` +
            `**Games**: ${gamesList}\n` +
            `**Uptime**: ${botStatus?.uptime || '-'}\n` +
            `**Latest Boosting**: ${botStatus?.latestBoosting || currentAccount.latestBoosting || '-'}`;

        if (currentAccount.customTitle) {
            accountText += `\n**Custom Title**: ${currentAccount.customTitle}`;
        }
        if (currentAccount.awayMessage) {
            accountText += `\n**Away Message**: ${currentAccount.awayMessage}`;
        }

        const section = new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(accountText))
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(pfp));

        builder2.addSectionComponents(section);
    } else {
        builder2.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('**No Steam Accounts Connected**\nClick the **Add** button below to connect your account credentials and start hour boosting.')
        );
    }

    // Action buttons container
    const row1 = new ActionRowBuilder<ButtonBuilder>();
    const hasAccount = totalAccounts > 0 && currentAccount !== null;
    const isRunning = Boolean(botStatus?.isRunning);

    if (hasAccount) {
        row1.addComponents(
            new ButtonBuilder()
                .setCustomId(`btn_toggle_${currentAccount.username}_${page}`)
                .setLabel(isRunning ? 'Stop' : 'Start')
                .setStyle(isRunning ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`btn_games_${currentAccount.username}_${page}`)
                .setLabel('Games')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(isRunning),
            new ButtonBuilder()
                .setCustomId(`btn_settings_${currentAccount.username}_${page}`)
                .setLabel('Settings')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(isRunning),
            new ButtonBuilder()
                .setCustomId(`btn_delete_${currentAccount.username}_${page}`)
                .setLabel('Delete')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`btn_refresh_${currentAccount.username}_${page}`)
                .setLabel('Refresh')
                .setStyle(ButtonStyle.Secondary)
        );
    } else {
        row1.addComponents(
            new ButtonBuilder()
                .setCustomId('btn_toggle_disabled')
                .setLabel('Start')
                .setStyle(ButtonStyle.Success)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('btn_games_disabled')
                .setLabel('Games')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('btn_settings_disabled')
                .setLabel('Settings')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('btn_delete_disabled')
                .setLabel('Delete')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('btn_refresh_none_0')
                .setLabel('Refresh')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    const builder3 = new ContainerBuilder().addActionRowComponents(row1);

    // Pagination & add account container
    const row2 = new ActionRowBuilder<ButtonBuilder>();

    row2.addComponents(
        new ButtonBuilder()
            .setCustomId(`btn_prev_${page}`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),
        new ButtonBuilder()
            .setCustomId('btn_page_info')
            .setLabel(`${totalAccounts > 0 ? page + 1 : 0} / ${totalAccounts}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`btn_next_${page}`)
            .setLabel('▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalAccounts - 1),
        new ButtonBuilder()
            .setCustomId(`btn_add_${page}`)
            .setLabel('Add')
            .setStyle(ButtonStyle.Secondary)
    );

    const builder4 = new ContainerBuilder().addActionRowComponents(row2);

    return {
        components: [builder1, builder2, builder3, builder4] as any[],
        flags: MessageFlags.IsComponentsV2 as any
    };
}

// Slash command handler
export async function execute(interaction: ChatInputCommandInteraction) {
    const panel = buildPanelMessage(0);
    await interaction.reply(panel);
}

// Button interaction handler
export async function handleButton(interaction: ButtonInteraction) {
    const customId = interaction.customId;
    const parts = customId.split('_');
    const action = parts[1];

    if (action === 'prev') {
        const page = parseInt(parts[2], 10) || 0;
        const newPage = Math.max(0, page - 1);
        await interaction.update(buildPanelMessage(newPage));
        return;
    }

    if (action === 'next') {
        const page = parseInt(parts[2], 10) || 0;
        const accounts = getAccounts();
        const newPage = Math.min(accounts.length - 1, page + 1);
        await interaction.update(buildPanelMessage(newPage));
        return;
    }

    if (action === 'refresh') {
        const page = parseInt(parts[3], 10) || 0;
        syncBotsWithConfig();
        await interaction.update(buildPanelMessage(page));
        return;
    }

    if (action === 'toggle') {
        const username = parts[2];
        const page = parseInt(parts[3], 10) || 0;
        const account = getAccount(username);

        if (!account) {
            await interaction.reply({ content: 'Account not found.', flags: MessageFlags.Ephemeral });
            return;
        }

        if (account.status.isRunning) {
            await stopBoost(username);
            await interaction.update(buildPanelMessage(page));
        } else {
            if (!account.entry.games || account.entry.games.length === 0) {
                await interaction.reply({
                    content: 'Please add at least one game before starting the booster.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            await startBoost(username);
            await interaction.update(buildPanelMessage(page));
        }
        return;
    }

    if (action === 'games') {
        const username = parts[2];
        const page = parseInt(parts[3], 10) || 0;
        const account = getAccount(username);

        if (account?.status.isRunning) {
            await interaction.reply({
                content: 'Please stop boosting before editing games.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const currentGames = (account?.entry.games || []).join(', ');

        const modal = new ModalBuilder()
            .setCustomId(`modal_games_${username}_${page}`)
            .setTitle(`Games - ${username}`);

        const gamesInput = new TextInputBuilder()
            .setCustomId('games_input')
            .setLabel('Steam AppIDs (comma-separated)')
            .setPlaceholder('e.g. 730, 570, 440')
            .setValue(currentGames)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(gamesInput));
        await interaction.showModal(modal);
        return;
    }

    if (action === 'settings') {
        const username = parts[2];
        const page = parseInt(parts[3], 10) || 0;
        const account = getAccount(username);

        if (account?.status.isRunning) {
            await interaction.reply({
                content: 'Please stop boosting before editing settings.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId(`modal_settings_${username}_${page}`)
            .setTitle(`Settings - ${username}`);

        const customTitleInput = new TextInputBuilder()
            .setCustomId('custom_title')
            .setLabel('Custom In-Game Title')
            .setPlaceholder('e.g. Hour Boosting | github.com/h2hearts')
            .setValue(account?.entry.customTitle || '')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        const awayMessageInput = new TextInputBuilder()
            .setCustomId('away_message')
            .setLabel('Away Auto-Reply Message')
            .setPlaceholder("e.g. [Auto] I'm Currently Hour Boosting")
            .setValue(account?.entry.awayMessage || '')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        const appearanceInput = new TextInputBuilder()
            .setCustomId('appearance')
            .setLabel('Appearance (online/invisible/away/busy)')
            .setPlaceholder('online, invisible (offline), away, or busy')
            .setValue(account?.entry.appearance || 'online')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(customTitleInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(awayMessageInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(appearanceInput)
        );
        await interaction.showModal(modal);
        return;
    }

    if (action === 'guard') {
        const username = parts[2];
        const page = parseInt(parts[3], 10) || 0;

        const modal = new ModalBuilder()
            .setCustomId(`modal_guard_${username}_${page}`)
            .setTitle(`Steam Guard - ${username}`);

        const codeInput = new TextInputBuilder()
            .setCustomId('guard_code')
            .setLabel('Steam Guard Code (Mobile / Email)')
            .setPlaceholder('Enter code')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(codeInput));
        await interaction.showModal(modal);
        return;
    }

    if (action === 'add') {
        const page = parseInt(parts[2], 10) || 0;

        const modal = new ModalBuilder()
            .setCustomId(`modal_add_${page}`)
            .setTitle('Add Steam Account');

        const usernameInput = new TextInputBuilder()
            .setCustomId('add_username')
            .setLabel('Steam Username')
            .setPlaceholder('Account login name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const passwordInput = new TextInputBuilder()
            .setCustomId('add_password')
            .setLabel('Steam Password')
            .setPlaceholder('Account password')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const guardInput = new TextInputBuilder()
            .setCustomId('add_guard')
            .setLabel('Steam Guard Code (Optional)')
            .setPlaceholder('Leave blank if using mobile prompt')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(guardInput)
        );
        await interaction.showModal(modal);
        return;
    }

    if (action === 'delete') {
        const username = parts[2];
        const page = parseInt(parts[3], 10) || 0;

        await deleteAccount(username);
        const accounts = getAccounts();
        const newPage = Math.max(0, Math.min(page, accounts.length - 1));
        await interaction.update(buildPanelMessage(newPage));
        return;
    }
}

// Modal submit handler
export async function handleModal(interaction: ModalSubmitInteraction) {
    const customId = interaction.customId;
    const parts = customId.split('_');
    const type = parts[1];

    if (type === 'games') {
        const username = parts[2];
        const page = parseInt(parts[3], 10) || 0;
        const rawInput = interaction.fields.getTextInputValue('games_input') || '';

        const games = rawInput
            .split(/[\s,]+/)
            .map(s => parseInt(s.trim(), 10))
            .filter(n => !isNaN(n) && n > 0);

        updateGames(username, games);
        if (interaction.isFromMessage()) {
            await interaction.update(buildPanelMessage(page));
        } else {
            await interaction.reply({ ...buildPanelMessage(page), flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as any });
        }
        return;
    }

    if (type === 'settings') {
        const username = parts[2];
        const page = parseInt(parts[3], 10) || 0;
        const customTitle = (interaction.fields.getTextInputValue('custom_title') || '').trim();
        const awayMessage = (interaction.fields.getTextInputValue('away_message') || '').trim();
        let appearance = (interaction.fields.getTextInputValue('appearance') || 'online').toLowerCase().trim();

        if (appearance === 'offline') {
            appearance = 'invisible';
        }
        if (!['online', 'invisible', 'away', 'busy'].includes(appearance)) {
            appearance = 'online';
        }

        updateSettings(username, {
            customTitle,
            customTitleEnabled: Boolean(customTitle),
            awayMessage,
            awayMessageEnabled: Boolean(awayMessage),
            appearance
        });

        if (interaction.isFromMessage()) {
            await interaction.update(buildPanelMessage(page));
        } else {
            await interaction.reply({ ...buildPanelMessage(page), flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as any });
        }
        return;
    }

    if (type === 'guard') {
        const username = parts[2];
        const page = parseInt(parts[3], 10) || 0;
        const code = interaction.fields.getTextInputValue('guard_code') || '';

        submitSteamGuard(username, code);
        if (interaction.isFromMessage()) {
            await interaction.update(buildPanelMessage(page));
        } else {
            await interaction.reply({ ...buildPanelMessage(page), flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as any });
        }
        return;
    }

    if (type === 'add') {
        const username = (interaction.fields.getTextInputValue('add_username') || '').trim();
        const password = interaction.fields.getTextInputValue('add_password') || '';
        const guard = (interaction.fields.getTextInputValue('add_guard') || '').trim();

        addAccount({
            username,
            password,
            steamGuardCode: guard || null
        });

        const accounts = getAccounts();
        const newPage = Math.max(0, accounts.length - 1);
        if (interaction.isFromMessage()) {
            await interaction.update(buildPanelMessage(newPage));
        } else {
            await interaction.reply({ ...buildPanelMessage(newPage), flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as any });
        }
        return;
    }
}
