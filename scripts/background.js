importScripts('settings.js', 'credential-store.js', 'vault.js');

const scriptId = 'msgtp-enabled-domains';
const authScriptId = 'msgtp-domain-auth';
let syncQueue = Promise.resolve();
let vaultQueue = Promise.resolve();

function runVaultTask(task) {
    vaultQueue = vaultQueue.catch(() => {}).then(task);
    return vaultQueue;
}

async function syncDomains() {
    const settings = await MSGTPSettings.load();
    const patterns = MSGTPSettings.patterns(settings.domains);
    const allowed = await Promise.all(patterns.map(async pattern =>
        await chrome.permissions.contains({ origins: [pattern] }) ? pattern : null
    ));
    const matches = allowed.filter(Boolean);
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId, authScriptId] });
    if (!matches.length) {
        if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map(script => script.id) });
        return;
    }
    const scripts = [{
        id: scriptId,
        matches,
        js: ['scripts/settings.js', 'scripts/content.js'],
        css: ['scripts/content.css'],
        runAt: 'document_idle',
        persistAcrossSessions: true
    }, {
        id: authScriptId,
        matches: matches.map(pattern => pattern.replace(/\/\*$/, '/auth.php*')),
        js: ['scripts/settings.js', 'scripts/auth.js'],
        runAt: 'document_start',
        persistAcrossSessions: true
    }];
    for (const script of scripts) {
        if (existing.some(entry => entry.id === script.id)) await chrome.scripting.updateContentScripts([script]);
        else await chrome.scripting.registerContentScripts([script]);
    }
}

function scheduleDomainSync() {
    syncQueue = syncQueue.catch(() => {}).then(syncDomains);
    syncQueue.catch(error => console.error('MSGTP+: ошибка подключения доменов:', error));
    return syncQueue;
}

chrome.runtime.onInstalled.addListener(() => {
    syncQueue = syncQueue.catch(() => {}).then(() => MSGTPSettings.migrateDomains());
    void scheduleDomainSync();
});
chrome.runtime.onStartup.addListener(() => { void scheduleDomainSync(); });
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[MSGTPSettings.key]) void scheduleDomainSync();
});
chrome.permissions.onAdded.addListener(() => { void scheduleDomainSync(); });
chrome.permissions.onRemoved.addListener(() => { void scheduleDomainSync(); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (typeof message?.type === 'string' && message.type.startsWith('msgtp-vault-')) {
        runVaultTask(() => MSGTPVault.handle(message, sender)).then(sendResponse, error => {
            sendResponse(MSGTPVault.isPopup(sender) ? { ok: false, error: error.message } : { ok: false });
        });
        return true;
    }
    if (message?.type !== 'msgtp-sync-domains') return;
    scheduleDomainSync().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
});

