const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(initial = {}) {
    const stored = structuredClone(initial);
    const context = { URL, chrome: { storage: { local: {
        async get(keys) {
            return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]]));
        },
        async set(values) { Object.assign(stored, values); }
    } } } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/settings.js'), 'utf8'), context);
    return { settings: context.MSGTPSettings, stored };
}

test('new installations enable langamesftw.ru and its subdomains with manifest access', async () => {
    const { settings } = setup();
    await settings.migrateDomains();
    const loaded = await settings.load();
    assert.equal(settings.matches('langamesftw.ru', loaded.domains), true);
    assert.equal(settings.matches('club.langamesftw.ru', loaded.domains), true);
    assert.equal(settings.matches('otherlangamesftw.ru', loaded.domains), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
    assert.ok(manifest.host_permissions.includes('https://*.langamesftw.ru/*'));
});

test('migration preserves custom settings and runs once so users can remove the domain', async () => {
    const { settings, stored } = setup({ msgtpSettings: {
        domains: 'custom.example.org', helpMentions: '@existing', transferEnabled: false
    } });
    await settings.migrateDomains();
    assert.equal(stored.msgtpSettings.domains, 'custom.example.org\nlangamesftw.ru');
    assert.equal(stored.msgtpSettings.helpMentions, '@existing');
    assert.equal(stored.msgtpSettings.transferEnabled, false);
    await settings.save({ ...stored.msgtpSettings, domains: 'custom.example.org' });
    await settings.migrateDomains();
    assert.equal((await settings.load()).domains, 'custom.example.org');
});

test('migration does not duplicate an already configured domain', async () => {
    const { settings } = setup({ msgtpSettings: { domains: 'langamesftw.ru' } });
    await settings.migrateDomains();
    assert.equal((await settings.load()).domains, 'langamesftw.ru');
});
