const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/auth.js'), 'utf8');

async function setup(options = {}) {
    let requests = 0;
    let submissions = 0;
    let reloads = 0;
    const fetches = [];
    let observer;
    let storageListener;
    let domReady;
    let documentNode;
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
    const hidden = new Input('hidden', 'csrf_token', 'test-csrf-token');
    const submitter = {
        type: 'submit', disabled: false,
        hasAttribute: name => name === 'formaction' && Boolean(options.submitAction),
        getAttribute: () => options.submitAction,
        click() { submissions++; }
    };
    let notice;
    const form = {
        elements: [username, password, hidden, submitter], method: options.method || 'post', isConnected: true,
        getAttribute: () => options.action || '/auth.php',
        querySelector: selector => selector === '.msgtp-auth-status' ? notice : options.captcha ? {} : null,
        appendChild(node) { notice = node; },
        checkValidity: () => true
    };
    username.form = password.form = form;
    const window = {};
    window.top = window;
    window.location = location;
    location.reload = () => { reloads++; };
    const context = {
        window, location, HTMLInputElement: Input, HTMLFormElement: class {}, Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
        URL, URLSearchParams, AbortSignal, Event, Date,
        async fetch(url, init) {
            fetches.push({ url, ...init });
            assert.equal(init.method, 'POST', 'login must not issue verification GET requests');
            if (options.networkError === init.method) throw new Error('Network failure');
            if (init.method === 'POST' && options.disableDuringPost) {
                storageListener({ msgtpDomainLoginEnabled: { newValue: false } }, 'local');
            }
            return { ok: !options.postError && !options.postRedirect, type: options.postRedirect ? 'opaqueredirect' : 'basic' };
        },
        sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
        document: {
            readyState: options.loading ? 'loading' : 'interactive',
            addEventListener(name, callback) { if (name === 'DOMContentLoaded') domReady = callback; },
            forms: [form], createElement: () => ({ setAttribute() {} })
        },
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
    documentNode = context.document;
    vm.createContext(context);
    vm.runInContext(source, context);
    await new Promise(resolve => setImmediate(resolve));
    return {
        username, password, storage, observer, fetches,
        changeEnabled(value) { storageListener({ msgtpDomainLoginEnabled: { newValue: value } }, 'local'); },
        ready() { documentNode.readyState = 'interactive'; domReady(); },
        get requests() { return requests; }, get submissions() { return submissions; }, get reloads() { return reloads; },
        get notice() { return notice?.textContent || ''; }
    };
}

test('uses a single POST and immediately reloads without exposing password in DOM', async () => {
    const env = await setup();
    assert.equal(env.username.value, '');
    assert.equal(env.password.value, '');
    assert.deepEqual(env.password.events, []);
    assert.equal(env.submissions, 0);
    assert.equal(env.reloads, 1);
    assert.equal(env.fetches.length, 1);
    const post = env.fetches[0];
    assert.equal(post.url, '/auth.php');
    assert.equal(post.method, 'POST');
    assert.equal(post.credentials, 'same-origin');
    assert.equal(post.mode, 'same-origin');
    assert.equal(post.redirect, 'manual');
    assert.equal(post.body.get('login'), 'test-user');
    assert.equal(post.body.get('password'), 'test-password');
    assert.equal(post.body.get('csrf_token'), 'test-csrf-token');
    env.observer();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.requests, 1);
});

test('autologin is limited across reloads and CAPTCHA remains manual', async () => {
    const first = await setup({ autoLogin: true });
    assert.equal(first.reloads, 1);
    const reload = await setup({ autoLogin: true, storage: first.storage });
    assert.equal(reload.submissions, 0);
    assert.equal(reload.fetches.length, 0);
    assert.match(reload.notice, /уже выполнялся/);
    const captcha = await setup({ autoLogin: true, captcha: true });
    assert.equal(captcha.password.value, '');
    assert.equal(captcha.submissions, 0);
    assert.equal(captcha.fetches.length, 0);
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
    assert.equal(env.password.value, '');
    assert.equal(env.reloads, 1);
});

test('server and network errors never reload', async () => {
    for (const options of [
        { postError: true }, { networkError: 'POST' }
    ]) {
        const env = await setup(options);
        assert.equal(env.reloads, 0);
        assert.equal(env.password.value, '');
        assert.equal(env.fetches.filter(request => request.method === 'POST').length, 1);
    }
});

test('manual redirect reloads without following POST; disabling prevents reload', async () => {
    const success = await setup({ postRedirect: true });
    assert.equal(success.reloads, 1);
    assert.equal(success.fetches.length, 1);
    const disabled = await setup({ disableDuringPost: true });
    assert.equal(disabled.reloads, 0);
    assert.equal(disabled.fetches.length, 1);
});

test('early script waits only for DOM parsing, not document_idle', async () => {
    const env = await setup({ loading: true });
    assert.equal(env.requests, 0);
    env.ready();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.fetches.length, 1);
    assert.equal(env.reloads, 1);
});

test('HTTP 200 login rejection reloads once and cooldown prevents a login loop', async () => {
    const first = await setup();
    assert.equal(first.reloads, 1);
    const stillOnAuth = await setup({ storage: first.storage });
    assert.equal(stillOnAuth.fetches.length, 0);
    assert.equal(stillOnAuth.reloads, 0);
});
