// Общие настройки для окна расширения и страниц сайта.
globalThis.MSGTPSettings = {
    key: 'msgtpSettings',
    defaults: {
        transferEnabled: true,
        helpAdvEnabled: true,
        helpTehEnabled: true,
        shiftWorkEnabled: true,
        shiftWeekendEnabled: true,
        transferMentions: '@tusovshicaaaa @LGS_adv_sup',
        helpMentions: '@LGS_adv_sup',
        helpTehMentions: '@LGS_Teh_Sup @ghoultripless',
        questionTag: '#вопрос',
        domains: 'langame.ru\nlangame-pr.ru\nlangame-soft.ru\nlangamepro.ru\ncls.expert\ncc.f5center.com\nlangamesftw.ru'
    },
    parseDomains(value) {
        const domains = String(value).split(/[\s,;]+/).filter(Boolean).map(entry => {
            const raw = entry.replace(/^\*\./, '');
            let url;
            try {
                url = new URL(raw.includes('://') ? raw : `https://${raw}`);
            } catch {
                throw new Error(`Некорректный домен: ${entry}`);
            }
            const domain = url.hostname.toLowerCase().replace(/\.$/, '');
            if (url.protocol !== 'https:' || url.port || url.username || url.password
                || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
                throw new Error(`Укажите HTTPS-домен без порта: ${entry}`);
            }
            return domain;
        });
        return [...new Set(domains)];
    },
    patterns(value) {
        return this.parseDomains(value).map(domain => `https://*.${domain}/*`);
    },
    matches(hostname, value) {
        return this.parseDomains(value).some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    },
    normalize(value = {}) {
        return Object.fromEntries(Object.entries(this.defaults).map(([key, fallback]) => {
            if (key === 'domains') return [key, this.parseDomains(typeof value?.[key] === 'string' ? value[key] : fallback).join('\n')];
            if (typeof fallback === 'boolean') return [key, typeof value?.[key] === 'boolean' ? value[key] : fallback];
            return [key, typeof value?.[key] === 'string' ? value[key].trim().replace(/\s+/g, ' ') : fallback];
        }));
    },
    async migrateDomains() {
        const migrationKey = 'msgtpLangamesftwDomainAdded';
        const stored = await chrome.storage.local.get([this.key, migrationKey]);
        if (stored[migrationKey]) return;
        const updates = { [migrationKey]: true };
        if (stored[this.key]) {
            const settings = this.normalize(stored[this.key]);
            settings.domains = [...new Set([...this.parseDomains(settings.domains), 'langamesftw.ru'])].join('\n');
            updates[this.key] = settings;
        }
        await chrome.storage.local.set(updates);
    },
    async load() {
        const stored = await chrome.storage.local.get(this.key);
        return this.normalize(stored[this.key]);
    },
    async save(value) {
        await chrome.storage.local.set({ [this.key]: this.normalize(value) });
    }
};
