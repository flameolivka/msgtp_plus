// Без мастер-пароля: ключ хранится вместе с шифротекстом в профиле браузера.
// Это не защита от доступа к самому профилю или компрометации расширения.
globalThis.MSGTPVault = {
    preferenceKey: 'msgtpDomainLoginEnabled',
    async enabled() {
        const stored = await chrome.storage.local.get(this.preferenceKey);
        return stored[this.preferenceKey] !== false;
    },
    async read() {
        const record = await MSGTPCredentialStore.get();
        if (!record) return null;
        try {
            const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, record.key, record.ciphertext);
            const account = JSON.parse(new TextDecoder().decode(bytes));
            if (!account.username || !account.password) throw new Error();
            return account;
        } catch { throw new Error('Не удалось прочитать аккаунт. Удалите его и сохраните заново.'); }
    },
    async write(account) {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
            new TextEncoder().encode(JSON.stringify(account)));
        await MSGTPCredentialStore.put({ key, iv, ciphertext });
    },
    async clearLegacy() {
        for (const key of ['msgtpCredentialVault', 'msgtpAutoLogin']) await chrome.storage.local.remove(key);
        await chrome.storage.session.remove('msgtpUnlockedCredentials');
    },
    async migrate() {
        if (await MSGTPCredentialStore.get()) return;
        const stored = await chrome.storage.session.get('msgtpUnlockedCredentials');
        const session = stored.msgtpUnlockedCredentials;
        const legacy = await chrome.storage.local.get('msgtpCredentialVault');
        if (session?.expiresAt > Date.now() && session.recordId === legacy.msgtpCredentialVault?.iv
            && session.username && session.password) {
            await this.write({ username: session.username, password: session.password });
            await this.clearLegacy();
        } else if (session) {
            await chrome.storage.session.remove('msgtpUnlockedCredentials');
        }
    },
    async state() {
        await this.migrate();
        let account;
        try { account = await this.read(); }
        catch { return { saved: true, username: '', corrupt: true, enabled: await this.enabled() }; }
        const legacy = await chrome.storage.local.get('msgtpCredentialVault');
        return {
            saved: Boolean(account), username: account?.username || '', enabled: await this.enabled(),
            needsReenter: !account && Boolean(legacy.msgtpCredentialVault)
        };
    },
    async save({ username, password }) {
        const account = {
            username: typeof username === 'string' ? username.trim() : '',
            password: typeof password === 'string' ? password : ''
        };
        if (!account.username || !account.password) throw new Error('Укажите логин и пароль');
        if (account.username.length > 1024 || account.password.length > 4096) throw new Error('Слишком длинный логин или пароль');
        await this.write(account);
        await this.clearLegacy();
        return this.state();
    },
    async toggle(enabled) {
        if (typeof enabled !== 'boolean') throw new Error('Укажите состояние блока входа');
        await chrome.storage.local.set({ [this.preferenceKey]: enabled });
        return this.state();
    },
    async remove() {
        await MSGTPCredentialStore.remove();
        await this.clearLegacy();
        return this.state();
    },
    isPopup(sender) {
        return sender.id === chrome.runtime.id && !sender.tab
            && sender.url === chrome.runtime.getURL('popup/popup.html');
    },
    async handle(message, sender) {
        if (message.type === 'msgtp-vault-fill') {
            if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab) return { ok: false };
            let page;
            let tab;
            try { page = new URL(sender.url); tab = new URL(sender.tab.url); }
            catch { return { ok: false }; }
            const settings = await MSGTPSettings.load();
            if (page.protocol !== 'https:' || page.port || page.pathname !== '/auth.php'
                || page.origin !== tab.origin || tab.pathname !== '/auth.php'
                || !MSGTPSettings.matches(page.hostname, settings.domains)) return { ok: false };
            if (!await chrome.permissions.contains({ origins: [`${page.origin}/*`] })) return { ok: false };
            if (!await this.enabled()) return { ok: false, disabled: true };
            await this.migrate();
            const account = await this.read();
            if (!account) return { ok: false };
            return { ok: true, username: account.username, password: account.password };
        }
        if (!this.isPopup(sender)) return { ok: false };
        switch (message.type) {
            case 'msgtp-vault-state': return { ok: true, ...await this.state() };
            case 'msgtp-vault-save': return { ok: true, ...await this.save(message) };
            case 'msgtp-vault-toggle': return { ok: true, ...await this.toggle(message.enabled) };
            case 'msgtp-vault-remove': return { ok: true, ...await this.remove() };
            default: return { ok: false };
        }
    }
};
