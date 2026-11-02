const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('categories preserve edits and module switches persist as booleans with backwards-compatible defaults', async () => {
    const elements = new Map();
    const stored = { msgtpSettings: { helpMentions: '@existing' } };
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            value: '', checked: false, hidden: false, attrs: {}, handlers: {},
            classList: { add() {}, remove() {}, toggle() {} },
            setAttribute(key, value) { this.attrs[key] = value; },
            focus() { this.focused = true; },
            addEventListener(key, callback) { this.handlers[key] = callback; },
            elements: { namedItem: name => element(name) }
        });
        return elements.get(id);
    }
    const context = {
        URL, console, document: { getElementById: element },
        chrome: {
            permissions: { async request() { return true; } },
            storage: { local: { async get(key) { return { [key]: stored[key] }; }, async set(value) { Object.assign(stored, value); } } },
            runtime: { async sendMessage(message) { return message.type === 'msgtp-sync-domains'
                ? { ok: true } : { ok: true, saved: false, enabled: true }; } }
        }
    };
    vm.createContext(context);
    for (const file of ['scripts/settings.js', 'popup/popup.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
    }
    const settle = () => new Promise(resolve => setImmediate(resolve));
    await settle();
    assert.equal(element('helpMentions').value, '@existing');
    assert.equal(element('transferEnabled').checked, true);
    assert.equal(element('helpAdvEnabled').checked, true);
    assert.equal(element('helpTehEnabled').checked, true);
    element('helpTehEnabled').checked = false;
    element('helpTehEnabled').handlers.change();
    assert.equal(element('helpTehEnabled-options').hidden, true);
    element('tab-autologin').handlers.click();
    assert.equal(element('settings-form').hidden, true);
    assert.equal(element('panel-autologin').hidden, false);
    element('tab-settings').handlers.click();
    assert.equal(element('settings-form').hidden, false);
    assert.equal(element('panel-settings').hidden, false);
    assert.equal(element('panel-pastes').hidden, true);
    assert.equal(element('helpTehEnabled').checked, false);
    element('settings-form').handlers.submit({ preventDefault() {} });
    await settle();
    assert.equal(stored.msgtpSettings.helpTehEnabled, false);
    assert.equal(stored.msgtpSettings.helpMentions, '@existing');
    assert.equal(stored.msgtpSettings.helpTehMentions, '@LGS_Teh_Sup @ghoultripless');
    element('tab-settings').handlers.keydown({ key: 'ArrowRight', preventDefault() {} });
    assert.equal(element('tab-pastes').attrs['aria-selected'], 'true');
    assert.equal(element('tab-pastes').focused, true);
    element('reset').handlers.click();
    await settle();
    assert.equal(stored.msgtpSettings.helpTehEnabled, true);
    assert.equal(element('helpTehEnabled-options').hidden, false);
    const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
    assert.ok(!html.includes('Тег сообщения (adv / teh)'));
    for (const key of Object.keys(context.MSGTPSettings.defaults)) assert.ok(html.includes(`name="${key}"`), key);
});
