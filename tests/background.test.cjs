const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('registers early auth separately and removes it when domains are disabled', async () => {
    const scripts = new Map([['msgtp-enabled-domains', { id: 'msgtp-enabled-domains' }]]);
    let domains = 'example.org';
    const event = () => ({ addListener() {} });
    const context = {
        console, importScripts() {},
        MSGTPSettings: { key: 'settings', async load() { return { domains }; }, patterns: value => value ? ['https://*.example.org/*'] : [] },
        chrome: {
            permissions: { async contains() { return true; }, onAdded: event(), onRemoved: event() },
            runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
            storage: { onChanged: event() },
            scripting: {
                async getRegisteredContentScripts() { return [...scripts.values()]; },
                async registerContentScripts(entries) { for (const entry of entries) { assert.ok(!scripts.has(entry.id)); scripts.set(entry.id, entry); } },
                async updateContentScripts(entries) { for (const entry of entries) { assert.ok(scripts.has(entry.id)); scripts.set(entry.id, entry); } },
                async unregisterContentScripts({ ids }) { for (const id of ids) scripts.delete(id); }
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/background.js'), 'utf8'), context);
    await context.syncDomains();
    assert.equal(scripts.get('msgtp-domain-auth').runAt, 'document_start');
    assert.equal(scripts.get('msgtp-domain-auth').matches[0], 'https://*.example.org/auth.php*');
    assert.ok(!scripts.get('msgtp-enabled-domains').js.includes('scripts/auth.js'));
    await context.syncDomains();
    assert.equal(scripts.size, 2);
    domains = '';
    await context.syncDomains();
    assert.equal(scripts.size, 0);
});
