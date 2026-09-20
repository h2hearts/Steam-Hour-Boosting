document.addEventListener('DOMContentLoaded', () => {
    const API_BASE = (window.location.port === '3001') ? '' : 'http://localhost:3001';
    const appState = {
        stats: {
            accountsRunning: 0,
            totalGamesBoosting: 0,
            totalAccountsHours: 0
        },
        accounts: []
    };

    let currentEditingUsername = null;
    let currentSettingsUsername = null;
    let tempModalGames = [];
    let searchDebounceTimer = null;

    const elements = {
        accountsRunning: document.getElementById('accounts-running'),
        totalGamesBoosting: document.getElementById('total-games-boosting'),
        totalAccountsHours: document.getElementById('total-accounts-hours'),

        statusDot: document.getElementById('status-dot'),
        statusText: document.getElementById('status-text'),

        accountsContainer: document.getElementById('accounts-container'),

        btnAddAccount: document.getElementById('btn-add-account'),
        accountModalOverlay: document.getElementById('account-modal-overlay'),
        accountModalCloseBtn: document.getElementById('account-modal-close-btn'),
        accountModalCancelBtn: document.getElementById('account-modal-cancel-btn'),
        formAddAccount: document.getElementById('form-add-account'),
        steamUsernameInput: document.getElementById('steam-username-input'),
        steamPasswordInput: document.getElementById('steam-password-input'),
        steamGuardInput: document.getElementById('steam-guard-input'),
        accountErrorMsg: document.getElementById('account-error-msg'),

        gamesModalOverlay: document.getElementById('games-modal-overlay'),
        modalCloseBtn: document.getElementById('modal-close-btn'),
        modalCancelBtn: document.getElementById('modal-cancel-btn'),
        modalSaveBtn: document.getElementById('modal-save-btn'),
        gameSearchInput: document.getElementById('game-search-input'),
        btnAddGame: document.getElementById('btn-add-game'),
        steamResultsContainer: document.getElementById('steam-results-container'),
        steamResultsList: document.getElementById('steam-results-list'),
        resultsLoader: document.getElementById('results-loader'),
        selectedGamesBox: document.getElementById('selected-games-box'),
        gamesModalCount: document.getElementById('games-modal-count'),

        guardModalOverlay: document.getElementById('guard-modal-overlay'),
        guardModalCloseBtn: document.getElementById('guard-modal-close-btn'),
        guardModalCancelBtn: document.getElementById('guard-modal-cancel-btn'),
        formGuardCode: document.getElementById('form-guard-code'),
        guardTargetUsername: document.getElementById('guard-target-username'),
        steamGuardCodeInput: document.getElementById('steam-guard-code-input'),

        settingsModalOverlay: document.getElementById('settings-modal-overlay'),
        settingsModalCloseBtn: document.getElementById('settings-modal-close-btn'),
        settingsModalCancelBtn: document.getElementById('settings-modal-cancel-btn'),
        formSettings: document.getElementById('form-settings'),
        settingCustomTitleToggle: document.getElementById('setting-custom-title-toggle'),
        settingCustomTitleInput: document.getElementById('setting-custom-title-input'),
        settingAwayMessageToggle: document.getElementById('setting-away-message-toggle'),
        settingAwayMessageInput: document.getElementById('setting-away-message-input'),
        settingAppearanceSelect: document.getElementById('setting-appearance-select'),
        settingDisplayModeSelect: document.getElementById('setting-display-mode-select')
    };

    // Local storage fallback
    function loadLocalAccounts() {
        try {
            const saved = localStorage.getItem('shb_accounts');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
        }
        return [];
    }

    function saveLocalAccounts() {
        try {
            localStorage.setItem('shb_accounts', JSON.stringify(appState.accounts));
        } catch (e) {
        }
    }

    // Format duration
    function formatDuration(ms) {
        if (!ms || ms <= 0) return '0s';
        const totalSecs = Math.floor(ms / 1000);
        const hours = Math.floor(totalSecs / 3600);
        const minutes = Math.floor((totalSecs % 3600) / 60);
        const seconds = totalSecs % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    }

    // Sync accounts with backend
    async function syncWithBackend() {
        try {
            const res = await fetch(`${API_BASE}/api/accounts`);
            if (res.ok) {
                const serverAccounts = await res.json();
                if (Array.isArray(serverAccounts)) {
                    appState.accounts = serverAccounts.map(acc => {
                        const existing = appState.accounts.find(a => a.username.toLowerCase() === acc.username.toLowerCase());
                        const isRunning = Boolean(acc.isRunning);

                        let startTime = acc.startTime;
                        if (isRunning && !startTime && existing?.startTime) {
                            startTime = existing.startTime;
                        } else if (isRunning && !startTime) {
                            startTime = Date.now();
                        }

                        let latestBoosting = '-';
                        if (!isRunning) {
                            latestBoosting = (acc.latestBoosting && acc.latestBoosting !== '-') ? acc.latestBoosting : (existing?.latestBoosting || '-');
                        }

                        return {
                            username: acc.username,
                            avatarUrl: acc.avatarUrl || existing?.avatarUrl || 'https://avatars.fastly.steamstatic.com/d30c2a3d712a4eb92ed2ac80b940f4da66f4bf4e_full.jpg',
                            isRunning: isRunning,
                            isToggling: existing?.isToggling || false,
                            startTime: startTime,
                            timeLeft: 'Unlimited',
                            games: acc.games || [],
                            settings: acc.settings || existing?.settings || {
                                customTitleEnabled: false,
                                customTitle: '',
                                awayMessageEnabled: false,
                                awayMessage: '',
                                appearance: 'online',
                                displayMode: 'normal'
                            },
                            uptime: isRunning ? (startTime ? formatDuration(Date.now() - startTime) : '0s') : '-',
                            latestBoosting: latestBoosting,
                            statusMessage: acc.statusMessage || (isRunning ? 'Boosting' : 'Disconnected'),
                            requiresSteamGuard: acc.requiresSteamGuard || false
                        };
                    });
                    renderAccountsList();

                    const needsGuard = appState.accounts.find(a => a.requiresSteamGuard);
                    if (needsGuard && (!elements.guardModalOverlay || !elements.guardModalOverlay.classList.contains('active'))) {
                        openSteamGuardModal(needsGuard.username);
                    }
                    return;
                }
            }
        } catch (err) {
            console.log('[Dashboard] Backend offline, running in offline/client mode.');
        }

        appState.accounts = loadLocalAccounts();
        renderAccountsList();
    }

    // Update stats cards
    function updateStatsUI() {
        const runningCount = appState.accounts.filter(a => a.isRunning).length;
        appState.stats.accountsRunning = runningCount;

        const totalGames = appState.accounts.reduce((sum, acc) => sum + (acc.games ? acc.games.length : 0), 0);
        appState.stats.totalGamesBoosting = totalGames;

        if (elements.accountsRunning) {
            elements.accountsRunning.textContent = appState.stats.accountsRunning.toLocaleString();
        }
        if (elements.totalGamesBoosting) {
            elements.totalGamesBoosting.textContent = appState.stats.totalGamesBoosting.toLocaleString();
        }
        if (elements.totalAccountsHours) {
            elements.totalAccountsHours.textContent = appState.stats.totalAccountsHours.toLocaleString();
        }
    }

    // Update header status
    function updateHeaderStatusUI() {
        const totalCount = appState.accounts.length;
        const runningCount = appState.accounts.filter(a => a.isRunning).length;

        if (elements.statusDot) {
            elements.statusDot.className = runningCount > 0 ? 'status-dot running' : 'status-dot stopped';
        }

        if (elements.statusText) {
            elements.statusText.className = runningCount > 0 ? 'status-text running' : 'status-text stopped';
            elements.statusText.textContent = `${runningCount} / ${totalCount} Running`;
        }
    }

    // Render accounts table
    function renderAccountsList() {
        if (!elements.accountsContainer) return;

        elements.accountsContainer.innerHTML = '';

        if (appState.accounts.length === 0) {
            elements.accountsContainer.innerHTML = `
                <div class="empty-accounts-state">
                    <div class="empty-title">No Steam Accounts Connected</div>
                    <div class="empty-desc">Click "+ Add Steam Account" above to connect your account credentials and start hour boosting.</div>
                </div>
            `;
            updateHeaderStatusUI();
            updateStatsUI();
            return;
        }

        appState.accounts.forEach(account => {
            const gamesCount = account.games ? account.games.length : 0;
            const row = document.createElement('div');
            row.className = 'account-row';
            row.id = `account-row-${account.username}`;

            row.innerHTML = `
                <div class="col-td col-username">
                    <div class="user-info">
                        <div class="avatar-wrapper">
                            <img src="${account.avatarUrl}" alt="${account.username}" class="user-avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'40\\' height=\\'40\\' viewBox=\\'0 0 40 40\\'><rect width=\\'40\\' height=\\'40\\' fill=\\'%231e293b\\'/><text x=\\'50%25\\' y=\\'55%25\\' font-size=\\'16\\' fill=\\'%2394a3b8\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-family=\\'sans-serif\\'>?</text></svg>'">
                        </div>
                        <div class="username-meta">
                            <span class="username-text">${account.username}</span>
                            <span class="user-status-meta ${account.isRunning ? (account.statusMessage && account.statusMessage.toLowerCase().startsWith('connecting') ? 'connecting' : 'boosting') : 'disconnected'}">
                                ${account.isRunning ? (account.statusMessage && account.statusMessage.toLowerCase().startsWith('connecting') ? 'Connecting' : 'Boosting') : 'Disconnected'}
                            </span>
                        </div>
                    </div>
                </div>
                <div class="col-td col-timeleft">
                    <span class="timeleft-value">${account.timeLeft}</span>
                </div>
                <div class="col-td col-games">
                    <span class="games-value">${gamesCount}</span>
                </div>
                <div class="col-td col-uptime" id="uptime-col-${account.username}">
                    ${account.isRunning ? `
                        <div class="uptime-ticker live">
                            <span class="uptime-text">${account.uptime || '0s'}</span>
                        </div>
                    ` : `
                        <span class="metric-dash">-</span>
                    `}
                </div>
                <div class="col-td col-latestboosting" id="latest-boosting-col-${account.username}">
                    ${(!account.isRunning && account.latestBoosting && account.latestBoosting !== '-') ? `
                        <span class="latest-boosting-badge">${account.latestBoosting}</span>
                    ` : `
                        <span class="metric-dash">-</span>
                    `}
                </div>
                <div class="col-td col-actions">
                    <div class="actions-group">
                        <button class="btn-action btn-toggle ${account.isRunning ? 'running' : 'stopped'} ${account.isToggling ? 'is-loading' : ''}"
                                data-username="${account.username}"
                                type="button"
                                ${account.isToggling ? 'disabled' : ''}
                                aria-label="Toggle Boosting for ${account.username}">
                            ${account.isToggling ?
                                `<span class="btn-spinner" aria-hidden="true"></span>` :
                                `<span class="btn-toggle-label">${account.isRunning ? 'Stop' : 'Start'}</span>`
                            }
                        </button>
                        <button class="btn-action btn-secondary ${account.isRunning ? 'btn-games-locked' : 'btn-open-games'}"
                                data-username="${account.username}"
                                type="button"
                                ${account.isRunning ? 'disabled title="Boosting in progress. Stop boosting to change games."' : 'title="Configure Games"'}>
                            <span class="btn-games-inner ${account.isRunning ? 'is-blurred' : ''}">
                                <svg class="icon-svg" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
                                </svg>
                                <span>Games</span>
                            </span>
                            ${account.isRunning ? `
                                <span class="lock-overlay" aria-hidden="true">
                                    <svg class="lock-icon" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
                                    </svg>
                                </span>
                            ` : ''}
                        </button>
                        <button class="btn-action btn-secondary ${account.isRunning ? 'btn-games-locked' : 'btn-open-settings'}"
                                data-username="${account.username}"
                                type="button"
                                ${account.isRunning ? 'disabled title="Boosting in progress. Stop boosting to change settings."' : 'title="Settings for ' + account.username + '"'}>
                            <span class="btn-games-inner ${account.isRunning ? 'is-blurred' : ''}">
                                <svg class="icon-svg" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
                                </svg>
                                <span>Settings</span>
                            </span>
                            ${account.isRunning ? `
                                <span class="lock-overlay" aria-hidden="true">
                                    <svg class="lock-icon" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
                                    </svg>
                                </span>
                            ` : ''}
                        </button>
                        <button class="btn-action btn-secondary btn-delete-account" data-username="${account.username}" type="button" title="Remove Account" style="color:#ef4444;">
                            <svg class="icon-svg" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </div>
                </div>
            `;


            const toggleBtn = row.querySelector('.btn-toggle');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => {
                    toggleAccountBoosting(account.username);
                });
            }

            const gamesBtn = row.querySelector('.btn-open-games');
            if (gamesBtn) {
                gamesBtn.addEventListener('click', () => {
                    openGamesModal(account.username);
                });
            }

            const settingsBtn = row.querySelector('.btn-open-settings');
            if (settingsBtn) {
                settingsBtn.addEventListener('click', () => {
                    openSettingsModal(account.username);
                });
            }

            const deleteBtn = row.querySelector('.btn-delete-account');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    if (confirm(`Remove Steam account "${account.username}"?`)) {
                        deleteAccount(account.username);
                    }
                });
            }

            elements.accountsContainer.appendChild(row);
        });

        updateHeaderStatusUI();
        updateStatsUI();
    }

    // Toast notification
    function showToast(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast-item toast-${type}`;

        let iconSvg = `
            <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" x2="10" y1="12" y2="12"/>
                <line x1="8" x2="8" y1="10" y2="14"/>
                <line x1="15" x2="15.01" y1="13" y2="13"/>
                <line x1="18" x2="18.01" y1="11" y2="11"/>
                <rect width="20" height="12" x="2" y="6" rx="2"/>
            </svg>
        `;
        if (type === 'error') {
            iconSvg = `
                <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="m15 9-6 6"/>
                    <path d="m9 9 6 6"/>
                </svg>
            `;
        }

        toast.innerHTML = `
            ${iconSvg}
            <span class="toast-message">${message}</span>
            <button type="button" class="toast-close" aria-label="Close">
                <svg class="toast-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6 6 18"/>
                    <path d="m6 6 12 12"/>
                </svg>
            </button>
        `;

        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => removeToast(toast));

        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        const timer = setTimeout(() => {
            removeToast(toast);
        }, 3500);

        function removeToast(el) {
            clearTimeout(timer);
            el.classList.remove('show');
            el.classList.add('hide');
            setTimeout(() => el.remove(), 250);
        }
    }

    // Toggle boosting
    async function toggleAccountBoosting(username) {
        const account = appState.accounts.find(a => a.username.toLowerCase() === username.toLowerCase());
        if (!account || account.isToggling) return;

        const willRun = !account.isRunning;
        if (willRun) {
            const gamesCount = (account.games || []).length;
            if (gamesCount === 0) {
                showToast('Please add at least one game before starting the booster.', 'info');
                const row = document.getElementById(`account-row-${account.username}`);
                const gamesBtn = row?.querySelector('.btn-open-games');
                if (gamesBtn) {
                    gamesBtn.classList.add('btn-highlight-pulse');
                    setTimeout(() => gamesBtn.classList.remove('btn-highlight-pulse'), 1500);
                }
                return;
            }

            account.isRunning = true;
            account.startTime = Date.now();
            account.uptime = '0s';
            account.latestBoosting = '-';
            account.statusMessage = 'Connecting...';
        } else {
            if (account.startTime) {
                const elapsed = Date.now() - account.startTime;
                account.latestBoosting = formatDuration(elapsed);
            }
            account.isRunning = false;
            account.startTime = null;
            account.uptime = '-';
            account.statusMessage = 'Disconnected';
        }

        account.isToggling = true;
        renderAccountsList();

        try {
            const endpoint = willRun ? 'start' : 'stop';
            const [res] = await Promise.all([
                fetch(`${API_BASE}/api/accounts/${encodeURIComponent(username)}/${endpoint}`, {
                    method: 'POST'
                }),
                new Promise(resolve => setTimeout(resolve, 400))
            ]);

            if (res.ok) {
                const data = await res.json();
                account.statusMessage = data.message || (willRun ? 'Boosting' : 'Disconnected');
                if (!willRun && data.latestBoosting) {
                    account.latestBoosting = data.latestBoosting;
                }
            } else {
                const errData = await res.json().catch(() => ({}));
                showToast(errData.error || 'Failed to start booster.', 'error');
                if (willRun) {
                    account.isRunning = false;
                    account.startTime = null;
                    account.uptime = '-';
                    account.statusMessage = 'Disconnected';
                }
            }
        } catch (err) {
            console.log(`[Dashboard] Backend request failed, toggled locally.`);
        } finally {
            account.isToggling = false;
            saveLocalAccounts();
            renderAccountsList();
        }
    }

    // Delete account
    async function deleteAccount(username) {
        try {
            await fetch(`${API_BASE}/api/accounts/${encodeURIComponent(username)}`, { method: 'DELETE' });
        } catch (e) {
        }

        appState.accounts = appState.accounts.filter(a => a.username.toLowerCase() !== username.toLowerCase());
        saveLocalAccounts();
        renderAccountsList();
    }

    // Add account modal

    function openAddAccountModal() {
        if (elements.accountErrorMsg) elements.accountErrorMsg.style.display = 'none';
        if (elements.formAddAccount) elements.formAddAccount.reset();

        if (elements.accountModalOverlay) {
            elements.accountModalOverlay.classList.add('active');
            elements.accountModalOverlay.setAttribute('aria-hidden', 'false');
        }
        setTimeout(() => {
            elements.steamUsernameInput?.focus();
        }, 100);
    }

    function closeAddAccountModal() {
        if (elements.accountModalOverlay) {
            elements.accountModalOverlay.classList.remove('active');
            elements.accountModalOverlay.setAttribute('aria-hidden', 'true');
        }
    }

    async function handleAddAccountSubmit(e) {
        e.preventDefault();
        const username = elements.steamUsernameInput?.value.trim();
        const password = elements.steamPasswordInput?.value;
        const steamGuardCode = elements.steamGuardInput?.value.trim() || null;

        if (!username || !password) return;

        if (appState.accounts.some(a => a.username.toLowerCase() === username.toLowerCase())) {
            showAccountError('An account with this username already exists.');
            return;
        }

        const newAcc = {
            username: username,
            avatarUrl: `https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg`,
            isRunning: false,
            startTime: null,
            timeLeft: 'Unlimited',
            games: [],
            settings: {
                customTitleEnabled: false,
                customTitle: '',
                awayMessageEnabled: false,
                awayMessage: '',
                appearance: 'online',
                displayMode: 'normal'
            },
            uptime: '-',
            latestBoosting: '-',
            statusMessage: steamGuardCode ? 'Connecting with Steam Guard...' : 'Ready'
        };

        try {
            const res = await fetch(`${API_BASE}/api/accounts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, games: [], steamGuardCode })
            });

            if (!res.ok) {
                const errData = await res.json();
                showAccountError(errData.error || 'Failed to add Steam account.');
                return;
            }
        } catch (err) {
            console.log('[Dashboard] Backend offline, saving locally.');
        }

        appState.accounts.push(newAcc);
        saveLocalAccounts();
        closeAddAccountModal();
        renderAccountsList();

        setTimeout(syncWithBackend, 1000);
    }

    function showAccountError(msg) {
        if (elements.accountErrorMsg) {
            elements.accountErrorMsg.textContent = msg;
            elements.accountErrorMsg.style.display = 'block';
        }
    }
    // Games modal

    function openGamesModal(username) {
        const account = appState.accounts.find(a => a.username.toLowerCase() === username.toLowerCase());
        if (!account || account.isRunning) return;

        currentEditingUsername = username;
        tempModalGames = (account.games || []).map(g => ({ ...g }));

        renderModalChips();
        clearSearch();

        if (elements.gamesModalOverlay) {
            elements.gamesModalOverlay.classList.add('active');
            elements.gamesModalOverlay.setAttribute('aria-hidden', 'false');
        }

        setTimeout(() => {
            elements.gameSearchInput?.focus();
        }, 100);
    }

    function closeGamesModal() {
        if (elements.gamesModalOverlay) {
            elements.gamesModalOverlay.classList.remove('active');
            elements.gamesModalOverlay.setAttribute('aria-hidden', 'true');
        }
        currentEditingUsername = null;
        tempModalGames = [];
        clearSearch();
    }

    function clearSearch() {
        if (elements.gameSearchInput) elements.gameSearchInput.value = '';
        if (elements.steamResultsContainer) elements.steamResultsContainer.style.display = 'none';
        if (elements.steamResultsList) elements.steamResultsList.innerHTML = '';
        if (elements.resultsLoader) elements.resultsLoader.style.display = 'none';
    }

    function renderModalChips() {
        if (!elements.selectedGamesBox) return;

        elements.selectedGamesBox.innerHTML = '';

        tempModalGames.forEach((game, index) => {
            const chip = document.createElement('div');
            chip.className = 'game-chip';
            const iconSrc = game.icon || game.logo || (game.appId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appId}/capsule_231x87.jpg` : '');

            chip.innerHTML = `
                <img src="${iconSrc}"
                     alt="${game.name}"
                     class="chip-icon"
                     onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'20\\' height=\\'20\\' viewBox=\\'0 0 20 20\\'><rect width=\\'20\\' height=\\'20\\' fill=\\'%231e293b\\'/><text x=\\'50%25\\' y=\\'55%25\\' font-size=\\'10\\' fill=\\'%2394a3b8\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\'>🎮</text></svg>'">
                <span class="chip-title">${game.name}</span>
                <button type="button" class="chip-remove-btn" data-index="${index}" aria-label="Remove ${game.name}">✕</button>
            `;

            chip.querySelector('.chip-remove-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                removeGameFromModal(index);
            });

            elements.selectedGamesBox.appendChild(chip);
        });

        if (elements.gamesModalCount) {
            elements.gamesModalCount.textContent = `${tempModalGames.length} ${tempModalGames.length === 1 ? 'Game' : 'Games'}`;
        }
    }

    // Search Steam store
    async function searchSteamGames(query) {
        const cleanQuery = query.trim();
        if (!cleanQuery) {
            clearSearch();
            return;
        }

        if (elements.resultsLoader) elements.resultsLoader.style.display = 'inline';
        if (elements.steamResultsContainer) elements.steamResultsContainer.style.display = 'block';

        let games = [];

        try {
            const res = await fetch(`${API_BASE}/api/steam/search?q=${encodeURIComponent(cleanQuery)}`);
            if (res.ok) {
                games = await res.json();
            }
        } catch (e) {
            try {
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(cleanQuery)}`)}`;
                const res = await fetch(proxyUrl);
                if (res.ok) {
                    const parsed = await res.json();
                    if (Array.isArray(parsed)) {
                        games = parsed.map(g => ({
                            appId: String(g.appid),
                            name: g.name,
                            icon: g.icon || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/capsule_231x87.jpg`,
                            logo: g.logo || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/capsule_231x87.jpg`
                        }));
                    }
                }
            } catch (err2) {
                console.log('[SteamSearch] Proxy error:', err2.message);
            }
        }

        if (elements.resultsLoader) elements.resultsLoader.style.display = 'none';
        renderSearchResults(games, cleanQuery);
    }

    function renderSearchResults(games, query) {
        if (!elements.steamResultsList) return;

        elements.steamResultsList.innerHTML = '';

        if (!games || games.length === 0) {
            if (/^\d+$/.test(query)) {
                const item = document.createElement('div');
                item.className = 'steam-result-item';
                item.innerHTML = `
                    <div class="result-info">
                        <img src="https://cdn.cloudflare.steamstatic.com/steam/apps/${query}/capsule_231x87.jpg" class="result-thumb" onerror="this.style.display='none'">
                        <div class="result-texts">
                            <span class="result-title">Steam AppID #${query}</span>
                            <span class="result-appid">AppID: ${query}</span>
                        </div>
                    </div>
                    <button class="btn-result-add" type="button">+ Add</button>
                `;
                item.addEventListener('click', () => {
                    addGameToModal({
                        appId: query,
                        name: `AppID: ${query}`,
                        icon: `https://cdn.cloudflare.steamstatic.com/steam/apps/${query}/capsule_231x87.jpg`
                    });
                });
                elements.steamResultsList.appendChild(item);
            } else {
                elements.steamResultsList.innerHTML = `
                    <div class="no-results-msg">Tidak ada game Steam yang cocok dengan "${query}". Coba nama lain atau AppID.</div>
                `;
            }
            return;
        }

        games.slice(0, 15).forEach(game => {
            const item = document.createElement('div');
            item.className = 'steam-result-item';
            const thumbUrl = game.icon || game.logo || `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appId}/capsule_231x87.jpg`;

            item.innerHTML = `
                <div class="result-info">
                    <img src="${thumbUrl}" class="result-thumb" alt="${game.name}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'32\\' height=\\'32\\' viewBox=\\'0 0 32 32\\'><rect width=\\'32\\' height=\\'32\\' fill=\\'%231e293b\\'/><text x=\\'50%25\\' y=\\'55%25\\' font-size=\\'12\\' fill=\\'%2394a3b8\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\'>🎮</text></svg>'">
                    <div class="result-texts">
                        <span class="result-title" title="${game.name}">${game.name}</span>
                        <span class="result-appid">AppID: ${game.appId}</span>
                    </div>
                </div>
                <button class="btn-result-add" type="button">+ Add</button>
            `;

            item.addEventListener('click', () => {
                addGameToModal(game);
            });

            elements.steamResultsList.appendChild(item);
        });
    }

    function addGameToModal(game) {
        const exists = tempModalGames.some(g => String(g.appId) === String(game.appId));
        if (!exists) {
            tempModalGames.push({
                appId: String(game.appId),
                name: game.name,
                icon: game.icon || game.logo || `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appId}/capsule_231x87.jpg`
            });
            renderModalChips();
        }
        clearSearch();
    }

    function removeGameFromModal(index) {
        tempModalGames.splice(index, 1);
        renderModalChips();
    }

    async function saveModalGames() {
        if (!currentEditingUsername) return;

        const account = appState.accounts.find(a => a.username.toLowerCase() === currentEditingUsername.toLowerCase());
        if (account) {
            account.games = [...tempModalGames];
            saveLocalAccounts();
            renderAccountsList();

            try {
                const appIds = account.games.map(g => Number(g.appId)).filter(n => !isNaN(n) && n > 0);
                await fetch(`${API_BASE}/api/accounts/${encodeURIComponent(account.username)}/games`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ games: appIds, gamesDetails: account.games })
                });
            } catch (e) {
                }
        }

        closeGamesModal();
    }
    // Event Listeners

    if (elements.btnAddAccount) elements.btnAddAccount.addEventListener('click', openAddAccountModal);
    if (elements.accountModalCloseBtn) elements.accountModalCloseBtn.addEventListener('click', closeAddAccountModal);
    if (elements.accountModalCancelBtn) elements.accountModalCancelBtn.addEventListener('click', closeAddAccountModal);
    if (elements.formAddAccount) elements.formAddAccount.addEventListener('submit', handleAddAccountSubmit);

    if (elements.modalCloseBtn) elements.modalCloseBtn.addEventListener('click', closeGamesModal);
    if (elements.modalCancelBtn) elements.modalCancelBtn.addEventListener('click', closeGamesModal);
    if (elements.modalSaveBtn) elements.modalSaveBtn.addEventListener('click', saveModalGames);

    if (elements.gameSearchInput) {
        elements.gameSearchInput.addEventListener('input', (e) => {
            clearTimeout(searchDebounceTimer);
            const val = e.target.value;
            if (!val.trim()) {
                clearSearch();
                return;
            }
            searchDebounceTimer = setTimeout(() => {
                searchSteamGames(val);
            }, 300);
        });

        elements.gameSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchSteamGames(elements.gameSearchInput.value);
            } else if (e.key === 'Escape') {
                closeGamesModal();
            }
        });
    }

    if (elements.btnAddGame) {
        elements.btnAddGame.addEventListener('click', () => {
            searchSteamGames(elements.gameSearchInput?.value || '');
        });
    }

    // Steam Guard modal
    function openSteamGuardModal(username) {
        if (elements.guardTargetUsername) {
            elements.guardTargetUsername.textContent = username;
        }
        if (elements.steamGuardCodeInput) {
            elements.steamGuardCodeInput.value = '';
        }
        if (elements.guardModalOverlay) {
            elements.guardModalOverlay.classList.add('active');
            elements.guardModalOverlay.setAttribute('aria-hidden', 'false');
            setTimeout(() => {
                elements.steamGuardCodeInput?.focus();
            }, 100);
        }
    }

    if (elements.guardModalCloseBtn) elements.guardModalCloseBtn.addEventListener('click', () => {
        elements.guardModalOverlay?.classList.remove('active');
        elements.guardModalOverlay?.setAttribute('aria-hidden', 'true');
    });
    if (elements.guardModalCancelBtn) elements.guardModalCancelBtn.addEventListener('click', () => {
        elements.guardModalOverlay?.classList.remove('active');
        elements.guardModalOverlay?.setAttribute('aria-hidden', 'true');
    });

    if (elements.formGuardCode) {
        elements.formGuardCode.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = elements.guardTargetUsername?.textContent;
            const code = elements.steamGuardCodeInput?.value.trim();
            if (!username || !code) return;

            try {
                const res = await fetch(`${API_BASE}/api/accounts/${encodeURIComponent(username)}/steam-guard`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code })
                });
                if (res.ok) {
                    console.log(`[SteamGuard] Submitted code for ${username}`);
                }
            } catch (err) {
                console.error(`[SteamGuard] Error submitting code:`, err.message);
            }
            elements.guardModalOverlay?.classList.remove('active');
            elements.guardModalOverlay?.setAttribute('aria-hidden', 'true');
            setTimeout(syncWithBackend, 1500);
        });
    }

    // Settings modal
    function openSettingsModal(username) {
        const account = appState.accounts.find(a => a.username.toLowerCase() === username.toLowerCase());
        if (!account || account.isRunning) return;

        currentSettingsUsername = username;
        if (elements.settingsTargetUsername) {
            elements.settingsTargetUsername.textContent = account.username;
        }

        const settings = account.settings || {
            customTitleEnabled: false,
            customTitle: '',
            awayMessageEnabled: false,
            awayMessage: '',
            appearance: 'online',
            displayMode: 'normal'
        };

        if (elements.settingCustomTitleToggle) {
            elements.settingCustomTitleToggle.checked = Boolean(settings.customTitleEnabled);
        }
        if (elements.settingCustomTitleInput) {
            elements.settingCustomTitleInput.value = settings.customTitle || '';
        }
        if (elements.settingAwayMessageToggle) {
            elements.settingAwayMessageToggle.checked = Boolean(settings.awayMessageEnabled);
        }
        if (elements.settingAwayMessageInput) {
            elements.settingAwayMessageInput.value = settings.awayMessage || '';
        }
        if (elements.settingAppearanceSelect) {
            elements.settingAppearanceSelect.value = settings.appearance || 'online';
        }
        if (elements.settingDisplayModeSelect) {
            elements.settingDisplayModeSelect.value = settings.displayMode || 'normal';
        }

        if (elements.settingsModalOverlay) {
            elements.settingsModalOverlay.classList.add('active');
            elements.settingsModalOverlay.setAttribute('aria-hidden', 'false');
        }
    }

    function closeSettingsModal() {
        if (elements.settingsModalOverlay) {
            elements.settingsModalOverlay.classList.remove('active');
            elements.settingsModalOverlay.setAttribute('aria-hidden', 'true');
        }
        currentSettingsUsername = null;
    }

    if (elements.settingsModalCloseBtn) elements.settingsModalCloseBtn.addEventListener('click', closeSettingsModal);
    if (elements.settingsModalCancelBtn) elements.settingsModalCancelBtn.addEventListener('click', closeSettingsModal);

    if (elements.formSettings) {
        elements.formSettings.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentSettingsUsername) return;

            const account = appState.accounts.find(a => a.username.toLowerCase() === currentSettingsUsername.toLowerCase());
            if (!account) return;

            const updatedSettings = {
                customTitleEnabled: elements.settingCustomTitleToggle ? elements.settingCustomTitleToggle.checked : false,
                customTitle: elements.settingCustomTitleInput ? elements.settingCustomTitleInput.value.trim() : '',
                awayMessageEnabled: elements.settingAwayMessageToggle ? elements.settingAwayMessageToggle.checked : false,
                awayMessage: elements.settingAwayMessageInput ? elements.settingAwayMessageInput.value.trim() : '',
                appearance: elements.settingAppearanceSelect ? elements.settingAppearanceSelect.value : 'online',
                displayMode: elements.settingDisplayModeSelect ? elements.settingDisplayModeSelect.value : 'normal'
            };

            account.settings = updatedSettings;
            saveLocalAccounts();

            try {
                const res = await fetch(`${API_BASE}/api/accounts/${encodeURIComponent(account.username)}/settings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedSettings)
                });
                if (res.ok) {
                    console.log(`[Settings] Successfully saved settings for ${account.username}`);
                }
            } catch (err) {
                console.log('[Settings] Backend offline, settings saved locally.');
            }

            closeSettingsModal();
            renderAccountsList();
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === elements.gamesModalOverlay) closeGamesModal();
        if (e.target === elements.accountModalOverlay) closeAddAccountModal();
        if (e.target === elements.guardModalOverlay) elements.guardModalOverlay?.classList.remove('active');
        if (e.target === elements.settingsModalOverlay) closeSettingsModal();
    });

    // 1s ticker for live uptime
    setInterval(() => {
        appState.accounts.forEach(account => {
            if (account.isRunning && account.startTime) {
                const elapsed = Math.max(0, Date.now() - account.startTime);
                account.uptime = formatDuration(elapsed);

                const uptimeCol = document.getElementById(`uptime-col-${account.username}`);
                if (uptimeCol) {
                    const textEl = uptimeCol.querySelector('.uptime-text');
                    if (textEl) {
                        textEl.textContent = account.uptime;
                    } else {
                        uptimeCol.innerHTML = `
                            <div class="uptime-ticker live">
                                <span class="uptime-text">${account.uptime}</span>
                            </div>
                        `;
                    }
                }

                const lbCol = document.getElementById(`latest-boosting-col-${account.username}`);
                if (lbCol && !lbCol.querySelector('.metric-dash')) {
                    lbCol.innerHTML = `<span class="metric-dash">-</span>`;
                }
            }
        });
    }, 1000);

    syncWithBackend();

    setInterval(syncWithBackend, 5000);

    window.SteamBooster = {
        state: appState,
        openGamesModal,
        openAddAccountModal,
        sync: syncWithBackend
    };
});
