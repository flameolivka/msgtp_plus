const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/content.js'), 'utf8');

class Element {
    constructor(tag) { Object.assign(this, { tag, className: '', children: [], dataset: {}, listeners: {}, textContent: '' }); }
    appendChild(child) { this.children.push(child); child.parentElement = this; }
    setAttribute() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    get nextElementSibling() { return this.parentElement.children[this.parentElement.children.indexOf(this) + 1]; }
    before(child) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 0, child); child.parentElement = this.parentElement; }
    remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    matches(selector) {
        const field = selector.match(/^\[data-shift-paste="(.+)"\]$/);
        if (field) return this.dataset.shiftPaste === field[1];
        if (selector.includes('.')) {
            const [tag, name] = selector.split('.');
            return (!tag || tag === this.tag) && this.className.split(' ').includes(name);
        }
        return selector === this.tag;
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function setup() {
    const root = new Element('div');
    const save = new Element('button');
    save.className = 'shiftReportPage__btn shiftReportPage__btn--primary';
    save.textContent = 'Сохранить';
    root.appendChild(save);
    let copied;
    let fail = false;
    const context = {
        userSettings: {},
        window: { location: { hostname: 'msgtp.langame.ru', pathname: '/shift-report/db70d8d6-85f2-4c8f-8f52-b520bfee4adc' } },
        document: {
            createElement: tag => new Element(tag),
            querySelector: selector => root.querySelector(selector),
            querySelectorAll: selector => root.querySelectorAll(selector)
        },
        navigator: { clipboard: { async writeText(text) { if (fail) throw new Error('Denied'); copied = text; } } }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('const SHIFT_REPORT_PASTES'), source.indexOf('function checkAndInject(')), context);
    return {
        context, root, save, get copied() { return copied; }, setFail() { fail = true; },
        async click(key) {
            const button = root.querySelector(`[data-shift-paste="${key}"]`);
            await button.listeners.click({ preventDefault() {}, stopPropagation() {} });
            return button;
        }
    };
}

test('shift paste buttons are inserted immediately before Save and copy exact weekday/weekend templates', async () => {
    const env = setup();
    env.context.injectShiftReportPastes();
    env.context.injectShiftReportPastes();
    assert.equal(env.root.children.length, 2);
    assert.equal(env.root.children[1], env.save);
    assert.equal(env.root.children[0].querySelectorAll('button').length, 2);
    const button = await env.click('shiftWorkEnabled');
    assert.equal(button.textContent, 'Копир. (работа)');
    assert.equal(env.root.querySelector('.msgtp-shift-paste-status').textContent, '');
    assert.equal(button.type, 'button');
    assert.equal(button.disabled, false);
    assert.equal(env.copied, 'Отчёт за смену:\n\n-Работа в чатах MSGTP.\n\nПлан на сегодня:\n\n-В офис к 20:50.');
    const weekend = await env.click('shiftWeekendEnabled');
    assert.equal(weekend.textContent, 'Копир. (вых.)');
    assert.equal(env.root.querySelector('.msgtp-shift-paste-status').textContent, '');
    assert.equal(env.copied, 'Отчёт за смену:\n\n-Работа в чатах MSGTP.\n\nПлан на завтра и послезавтра:\n\n-Выходные.');
});

test('each paste can be disabled independently, both disabled remove the group, unrelated routes have no buttons', () => {
    const env = setup();
    env.context.userSettings.shiftWorkEnabled = false;
    env.context.injectShiftReportPastes();
    assert.equal(env.root.querySelector('[data-shift-paste="shiftWorkEnabled"]').hidden, true);
    assert.equal(env.root.querySelector('[data-shift-paste="shiftWeekendEnabled"]').hidden, false);
    env.context.userSettings.shiftWeekendEnabled = false;
    env.context.injectShiftReportPastes();
    assert.equal(env.root.children.length, 1);
    env.context.userSettings.shiftWorkEnabled = true;
    env.context.injectShiftReportPastes();
    assert.equal(env.root.children.length, 2);
    env.context.window.location.pathname = '/im/chat/';
    env.context.injectShiftReportPastes();
    assert.equal(env.root.children.length, 1);
});

test('clipboard failure is visible and restores button availability', async () => {
    const env = setup();
    env.context.injectShiftReportPastes();
    env.setFail();
    const button = await env.click('shiftWorkEnabled');
    assert.equal(button.disabled, false);
    assert.match(env.root.querySelector('.msgtp-shift-paste-status').textContent, /Не удалось/);
    assert.equal(env.copied, undefined);
});
