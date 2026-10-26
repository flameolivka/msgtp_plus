const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { setup } = require('./helpers/account-env.cjs');
const credentials = { username: 'test-user', password: 'sample site password <>&' };

test('save without master password, encryption and persistence across browser restarts', async () => {
    const env = setup();
    const state = await env.vault.save(credentials);
    assert.equal(state.saved, true);
    assert.equal(state.username, credentials.username);
    assert.equal(state.enabled, true);
    const record = env.records.get('current');
    assert.equal(record.key.extractable, false);
    await assert.rejects(webcrypto.subtle.exportKey('raw', record.key));
    assert.ok(!Buffer.from(record.ciphertext).includes(Buffer.from(credentials.password)));
    assert.ok(!JSON.stringify(env.local).includes(credentials.password));
    const restarted = setup({ records: env.records, local: env.local });
    assert.equal((await restarted.vault.state()).username, credentials.username);
    assert.equal((await restarted.vault.read()).password, credentials.password);
});

test('whole-block toggle stops credentials delivery while preserving saved login', async () => {
    const env = setup();
    await env.vault.save(credentials);
    const fill = () => env.vault.handle({ type: 'msgtp-vault-fill' }, env.page());
    assert.equal((await fill()).password, credentials.password);
    await env.vault.toggle(false);
    assert.equal((await fill()).disabled, true);
    assert.equal((await fill()).password, undefined);
    assert.equal((await env.vault.state()).username, credentials.username);
    const restarted = setup({ records: env.records, local: env.local });
    assert.equal((await restarted.vault.state()).enabled, false);
    await env.vault.toggle(true);
    assert.equal((await fill()).ok, true);
    await env.vault.remove();
    assert.equal((await env.vault.state()).saved, false);
    assert.equal(env.records.size, 0);
});

test('sender, HTTPS, whitelist, route, frame and permission gates', async () => {
    const env = setup();
    await env.vault.save(credentials);
    for (const sender of [
        env.page('https://evil.example/auth.php'), env.page('https://cc.f5center.com.evil.example/auth.php'),
        env.page('http://cc.f5center.com/auth.php'), env.page('https://cc.f5center.com:8443/auth.php'),
        env.page('https://cc.f5center.com/admins/'), { ...env.page(), frameId: 1 },
        { ...env.page(), id: 'other' }, { ...env.page(), tab: { url: 'https://evil.example/auth.php' } }
    ]) assert.equal((await env.vault.handle({ type: 'msgtp-vault-fill' }, sender)).ok, false);
    for (const type of ['msgtp-vault-state', 'msgtp-vault-save', 'msgtp-vault-remove', 'msgtp-vault-toggle']) {
        assert.equal((await env.vault.handle({ type, ...credentials, enabled: false }, env.page())).ok, false);
    }
    env.revoke();
    assert.equal((await env.vault.handle({ type: 'msgtp-vault-fill' }, env.page())).ok, false);
});

test('validation, fresh key/IV, corruption recovery and deletion', async () => {
    const env = setup();
    await assert.rejects(env.vault.save({ username: '', password: 'password' }));
    await assert.rejects(env.vault.save({ username: 'user', password: '' }));
    await env.vault.save(credentials);
    const first = env.records.get('current');
    await env.vault.save(credentials);
    const next = env.records.get('current');
    assert.notDeepEqual(next.iv, first.iv);
    new Uint8Array(next.ciphertext)[0] ^= 1;
    await assert.rejects(env.vault.read(), /прочитать/);
    assert.equal((await env.vault.state()).corrupt, true);
    await env.vault.remove();
    assert.equal((await env.vault.state()).saved, false);
});

test('migration keeps an unlocked account; locked legacy data requires one-time reentry', async () => {
    const env = setup();
    env.local.msgtpCredentialVault = { iv: 'legacy-id' };
    env.session.msgtpUnlockedCredentials = { ...credentials, recordId: 'legacy-id', expiresAt: Date.now() + 60000 };
    assert.equal((await env.vault.state()).username, credentials.username);
    assert.equal(env.local.msgtpCredentialVault, undefined);
    assert.equal(env.session.msgtpUnlockedCredentials, undefined);
    const locked = setup();
    locked.local.msgtpCredentialVault = { iv: 'locked-id' };
    assert.equal((await locked.vault.state()).needsReenter, true);
    await locked.vault.save(credentials);
    assert.equal(locked.local.msgtpCredentialVault, undefined);
    assert.equal((await locked.vault.state()).saved, true);
});
