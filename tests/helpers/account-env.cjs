const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function setup(shared = {}) {
    const local = shared.local || {};
    const session = shared.session || {};
    const records = shared.records || new Map();
    let permission = true;
    const area = data => ({
        async get(key) { return structuredClone({ [key]: data[key] }); },
        async set(value) { Object.assign(data, structuredClone(value)); },
        async remove(key) { delete data[key]; }
    });
    const chrome = {
        runtime: { id: 'extension-test', getURL: file => `chrome-extension://extension-test/${file}` },
        storage: { local: area(local), session: area(session) },
        permissions: { async contains() { return permission; } }
    };
    // Эмуляция асинхронных IDB-транзакций и structured clone CryptoKey.
    const indexedDB = { open() {
        const request = {};
        const db = {
            createObjectStore() {}, close() {},
            transaction() {
                const transaction = {};
                const operation = action => {
                    const result = {};
                    queueMicrotask(() => {
                        try { result.result = action(); transaction.oncomplete?.(); }
                        catch { transaction.onabort?.(); }
                    });
                    return result;
                };
                transaction.objectStore = () => ({
                    get: key => operation(() => structuredClone(records.get(key))),
                    put: (value, key) => operation(() => { records.set(key, structuredClone(value)); return key; }),
                    delete: key => operation(() => { records.delete(key); })
                });
                return transaction;
            }
        };
        queueMicrotask(() => { request.result = db; request.onupgradeneeded?.(); request.onsuccess?.(); });
        return request;
    } };
    const context = { chrome, indexedDB, crypto: webcrypto, TextEncoder, TextDecoder, URL };
    vm.createContext(context);
    for (const file of ['settings.js', 'credential-store.js', 'vault.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../../scripts', file), 'utf8'), context);
    }
    return {
        vault: context.MSGTPVault, local, session, records,
        revoke() { permission = false; },
        popup: { id: chrome.runtime.id, url: chrome.runtime.getURL('popup/popup.html') },
        page(url = 'https://cc.f5center.com/auth.php') { return { id: chrome.runtime.id, frameId: 0, url, tab: { url } }; }
    };
}

module.exports = { setup };
