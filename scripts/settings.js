// Общие настройки для окна расширения и страниц сайта.
globalThis.MSGTPSettings = {
    key: 'msgtpSettings',
    defaults: {
        transferMentions: '@tusovshicaaaa @LGS_adv_sup',
        helpMentions: '@LGS_adv_sup',
        questionTag: '#вопрос',
        domains: 'langame.ru\nlangame-pr.ru\nlangame-soft.ru\nlangamepro.ru\ncls.expert\ncc.f5center.com'
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
        return Object.fromEntries(Object.entries(this.defaults).map(([key, fallback]) => [
            key, key === 'domains'
                ? this.parseDomains(typeof value?.[key] === 'string' ? value[key] : fallback).join('\n')
                : typeof value?.[key] === 'string' ? value[key].trim().replace(/\s+/g, ' ') : fallback
        ]));
    },
    async load() {
        const stored = await chrome.storage.local.get(this.key);
        return this.normalize(stored[this.key]);
    },
    async save(value) {
        await chrome.storage.local.set({ [this.key]: this.normalize(value) });
    }
};
