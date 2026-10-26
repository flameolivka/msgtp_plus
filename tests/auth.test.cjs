const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/auth.js'), 'utf8');

async function setup(options = {}) {
    let requests = 0;
    let submissions = 0;
    let observer;
    let storageListener;
    const storage = options.storage || new Map();
    const location = new URL(options.url || 'https://cc.f5center.com/auth.php');
    class Input {
        constructor(type, name, value = '') { Object.assign(this, { type, name, _value: value, autocomplete: '', events: [] }); }
        get value() { return this._value; }
        set value(value) { this._value = value; }
        getClientRects() { return [{}]; }
        compareDocumentPosition() { return this.type === 'text' ? 4 : 0; }
        dispatchEvent(event) { this.events.push(event.type); }
    }
    const username = new Input('text', 'login', options.username || '');
    const password = new Input('password', 'password', options.password || '');
    const submitter = {
        type: 'submit', disabled: false,
        hasAttribute: name => name === 'formaction' && Boolean(options.submitAction),
        getAttribute: () => options.submitAction,
        click() { submissions++; }
    };
    let notice;
    const form = {
        elements: [username, password, submitter], method: options.method || 'post', isConnected: true,
        getAttribute: () => options.action || '/auth.php',
        querySelector: selector => selector === '.msgtp-auth-status' ? notice : options.captcha ? {} : null,
        appendChild(node) { notice = node; },
        checkValidity: () => true
    };
    username.form = password.form = form;
    const window = {};
    window.top = window;
    const context = {
        window, location, HTMLInputElement: Input, HTMLFormElement: class {}, Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
        URL, Event, Date,
        sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
        document: { forms: [form], body: {}, createElement: () => ({ setAttribute() {} }) },
        MSGTPSettings: { key: 'settings', async load() { return {}; }, matches: () => options.allowed !== false },
        chrome: {
            storage: { onChanged: { addListener(callback) { storageListener = callback; } } },
            runtime: { async sendMessage() {
                requests++;
                options.onRequest?.(form, username, password);
                return options.disabled || options.missing ? { ok: false }
                    : { ok: true, username: 'test-user', password: 'test-password' };
            } }
        }
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    await new Promise(resolve => setImmediate(resolve));
    return {
        username, password, storage, observer,
        changeEnabled(value) { storageListener({ msgtpDomainLoginEnabled: { newValue: value } }, 'local'); },
        get requests() { return requests; }, get submissions() { return submissions; },
        get notice() { return notice?.textContent || ''; }
    };
}

test('fills and automatically submits; repeated DOM mutations do not repeat login', async () => {
    const env = await setup();
    assert.equal(env.username.value, 'test-user');
    assert.equal(env.password.value, 'test-password');
    assert.deepEqual(env.password.events, ['input', 'change']);
    assert.equal(env.submissions, 1);
    env.observer();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.requests, 1);
});

test('autologin is limited across reloads and CAPTCHA remains manual', async () => {
    const first = await setup({ autoLogin: true });
    assert.equal(first.submissions, 1);
    const reload = await setup({ autoLogin: true, storage: first.storage });
    assert.equal(reload.submissions, 0);
    assert.match(reload.notice, /уже выполнялся/);
    const captcha = await setup({ autoLogin: true, captcha: true });
    assert.equal(captcha.password.value, 'test-password');
    assert.equal(captcha.submissions, 0);
});

test('refuses foreign actions, GET forms, wrong routes and disabled domains', async () => {
    for (const options of [
        { action: 'https://evil.example/login' },
        { submitAction: 'https://evil.example/login' },
        { method: 'get' },
        { allowed: false },
        { url: 'http://cc.f5center.com/auth.php' },
        { url: 'https://cc.f5center.com:8443/auth.php' },
        { url: 'https://cc.f5center.com/admins/' }
    ]) {
        const env = await setup(options);
        assert.equal(env.requests, 0);
        assert.equal(env.password.value, '');
    }
});

test('preserves browser/user input, rejects replaced fields, and handles missing account', async () => {
    const browser = await setup({ password: 'browser-password' });
    assert.equal(browser.password.value, 'browser-password');
    assert.equal(browser.requests, 0);
    const differentUser = await setup({ username: 'another-user' });
    assert.equal(differentUser.username.value, 'another-user');
    assert.equal(differentUser.password.value, '');
    const detached = await setup({ onRequest(form, username, password) { password.form = null; } });
    assert.equal(detached.password.value, '');
    const missing = await setup({ missing: true });
    assert.equal(missing.password.value, '');
    assert.equal(missing.submissions, 0);
});

test('disabled block does not fill; enabling retries the current form', async () => {
    const options = { disabled: true };
    const env = await setup(options);
    assert.equal(env.password.value, '');
    assert.equal(env.submissions, 0);
    env.changeEnabled(false);
    options.disabled = false;
    env.changeEnabled(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.password.value, 'test-password');
    assert.equal(env.submissions, 1);
});
