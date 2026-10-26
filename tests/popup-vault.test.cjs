const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('account card replaces form; whole-block switch and account deletion need no master password', async () => {
    const elements = new Map();
    const messages = [];
    let saved = false;
    let enabled = true;
    let fail = false;
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            value: '', checked: false, hidden: false, disabled: false, textContent: '', handlers: {},
            classes: new Set(),
            classList: { add() {}, remove() {}, toggle(name, on) { element(id).classes[on ? 'add' : 'delete'](name); } },
            addEventListener(name, handler) { this.handlers[name] = handler; },
            elements: { namedItem: name => element(name) }
        });
        return elements.get(id);
    }
    const context = {
        console, document: { getElementById: element },
        MSGTPSettings: { defaults: {}, async load() { return {}; } },
        chrome: { runtime: { async sendMessage(message) {
            messages.push(message);
            if (fail) return { ok: false, error: 'Ошибка сохранения' };
            if (message.type === 'msgtp-vault-save') saved = true;
            if (message.type === 'msgtp-vault-toggle') enabled = message.enabled;
            if (message.type === 'msgtp-vault-remove') saved = false;
            return { ok: true, saved, username: saved ? 'test-user' : '', enabled };
        } } }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8'), context);
    const settle = () => new Promise(resolve => setImmediate(resolve));
    await settle();
    assert.equal(element('vault-form').hidden, false);
    assert.equal(element('vault-account').hidden, true);
    assert.equal(element('vault-inactive').hidden, true);
    element('vault-auto-off').checked = true;
    element('vault-auto-off').handlers.change();
    await settle();
    assert.equal(element('vault-form').hidden, true, 'disabled block hides the entire login form');
    assert.equal(element('vault-inactive').hidden, false);
    assert.equal(element('vault-status').textContent, '');
    element('vault-auto-on').checked = true;
    element('vault-auto-on').handlers.change();
    await settle();
    assert.equal(element('vault-form').hidden, false);
    assert.equal(element('vault-inactive').hidden, true);
    element('vault-username').value = 'test-user';
    element('vault-password').value = 'site-password';
    element('vault-form').handlers.submit({ preventDefault() {} });
    await settle();
    assert.equal(messages.at(-1).password, 'site-password');
    assert.equal('masterPassword' in messages.at(-1), false);
    assert.equal(element('vault-form').hidden, true);
    assert.equal(element('vault-account').hidden, false);
    assert.equal(element('vault-account-title').textContent, 'test-user');
    assert.ok(element('vault-account').classes.has('connected'));
    assert.equal(element('vault-password').value, '');
    element('vault-auto-off').checked = true;
    element('vault-auto-off').handlers.change();
    await settle();
    assert.equal(messages.at(-1).enabled, false);
    assert.ok(element('vault-account').classes.has('connected'), 'saved account remains green when feature is off');
    assert.equal(element('vault-form').hidden, true);
    assert.match(element('vault-account-detail').textContent, /блок выключен/);
    element('vault-delete').handlers.click();
    await settle();
    assert.equal(element('vault-form').hidden, true, 'removing an account while disabled keeps the form hidden');
    element('vault-auto-on').checked = true;
    element('vault-auto-on').handlers.change();
    await settle();
    assert.equal(element('vault-form').hidden, false);
    assert.equal(element('vault-account').hidden, true);
    fail = true;
    element('vault-password').value = 'new-secret';
    element('vault-form').handlers.submit({ preventDefault() {} });
    await settle();
    assert.equal(element('vault-password').value, '');
    assert.equal(element('vault-controls').disabled, false);
    assert.match(element('vault-status').textContent, /Ошибка/);
});
