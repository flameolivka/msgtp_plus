const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/content.js'), 'utf8');

class Element {
    constructor(tag) { Object.assign(this, { tag, children: [], dataset: {}, listeners: {}, attrs: {}, value: '', className: '', text: '' }); }
    get firstElementChild() { return this.children[0]; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = value; this.children = []; }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    matches(selector) {
        if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
        if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
        const field = selector.match(/^\[data-transfer-field="(.+)"\]$/);
        if (field) return this.dataset.transferField === field[1];
        return this.tag === selector;
    }
    querySelectorAll(selector) {
        return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
        for (let element = this; element; element = element.parentElement) {
            if (selector.split(',').some(part => element.matches(part.trim()))) return element;
        }
        return null;
    }
}

function makeCard(id, title, domain) {
    const card = new Element('div');
    const header = new Element('div');
    const name = new Element('div');
    name.textContent = `#${id} · ${title}`;
    header.appendChild(name);
    const host = new Element('div');
    host.textContent = domain;
    const actions = new Element('div');
    const button = new Element('button');
    button.textContent = 'Открыть чат';
    actions.appendChild(button);
    card.append(header, host, actions);
    return card;
}

function setup() {
    const body = new Element('body');
    const modal = new Element('div');
    modal.className = 'sheetModalPlain';
    const footer = new Element('div');
    footer.className = 'sheetModalPlain__footer';
    const first = makeCard('CHAT1', 'Клуб <1>', 'club.example.org');
    const second = makeCard('CHAT2', 'Клуб 2', 'club.example.org');
    modal.append(first, second, footer);
    body.appendChild(modal);
    let copied;
    const context = {
        Blob, console, userSettings: { transferMentions: '@test' },
        window: { location: { hostname: 'msgtp.langame.ru', pathname: '/minmap' } },
        document: { body, createElement: tag => new Element(tag), querySelectorAll: selector => body.querySelectorAll(selector) },
        navigator: { clipboard: { async write(items) { copied = items[0].data; } } },
        ClipboardItem: class { constructor(data) { this.data = data; } }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('function escapeHtml('), source.indexOf('function getClubLink(')), context);
    vm.runInContext(source.slice(source.indexOf('const TRANSFER_FIELDS'), source.indexOf('const SHIFT_REPORT_PASTES')), context);
    return { context, first, second, modal, footer, get copied() { return copied; } };
}

test('transfer controls support minmap, excluding old chat routes and other hosts', () => {
    for (const pathname of ['/minmap', '/minmap/']) {
        const env = setup();
        env.context.window.location.pathname = pathname;
        env.context.injectTransferChatsButtons();
        assert.equal(env.footer.querySelectorAll('button').length, 1, pathname);
        assert.equal(env.first.querySelectorAll('textarea').length, 3, pathname);
    }
    for (const pathname of ['/minmap-other', '/im/chat', '/im/chat/', '/im/chats', '/']) {
        const env = setup();
        env.context.window.location.pathname = pathname;
        env.context.injectTransferChatsButtons();
        assert.equal(env.footer.querySelectorAll('button').length, 0, pathname);
    }
    const env = setup();
    env.context.window.location.pathname = '/minmap';
    env.context.window.location.hostname = 'other.langame.ru';
    env.context.injectTransferChatsButtons();
    assert.equal(env.footer.querySelectorAll('button').length, 0);
});

test('injects one editor per chat and copies live multiline notes with safe quote formatting', async () => {
    const env = setup();
    env.context.injectTransferChatsButtons();
    env.context.injectTransferChatsButtons();
    assert.equal(env.first.querySelectorAll('textarea').length, 3);
    assert.equal(env.second.querySelectorAll('textarea').length, 3);
    assert.equal(env.footer.querySelectorAll('button').length, 1);
    env.first.querySelector('[data-transfer-field="request"]').value = 'Не работает <ПК> & сеть\nВторая строка';
    env.first.querySelector('[data-transfer-field="work"]').value = 'Проверили кабель';
    env.first.querySelector('[data-transfer-field="remaining"]').value = 'Заменить кабель';
    env.second.querySelector('[data-transfer-field="request"]').value = 'Другой запрос';
    await env.footer.querySelector('button').listeners.click({ preventDefault() {}, stopPropagation() {} });
    const plain = await env.copied['text/plain'].text();
    const html = await env.copied['text/html'].text();
    assert.ok(plain.includes('Запрос клуба:\nНе работает <ПК> & сеть\nВторая строка'));
    assert.ok(plain.includes('Проделанная работа:\nПроверили кабель'));
    assert.ok(plain.includes('Осталось сделать:\nЗаменить кабель'));
    assert.equal(plain.split('Другой запрос').length, 2);
    assert.ok(html.includes('<b><u>Запрос клуба:</u></b><br>Не работает &lt;ПК&gt; &amp; сеть<br>Вторая строка'));
    assert.equal((html.match(/<blockquote>/g) || []).length, 2);
    assert.equal((html.match(/<b><u>/g) || []).length, 6);
    assert.ok(!html.includes('<b><u>Проверили кабель'));
});

test('drafts survive card recreation by chat ID and stay separate for chats of the same club', () => {
    const env = setup();
    env.context.injectTransferChatsButtons();
    const request = env.first.querySelector('[data-transfer-field="request"]');
    request.value = 'Черновик первого чата';
    request.listeners.input();
    env.first.remove();
    const replacement = makeCard('CHAT1', 'Новое имя клуба', 'club.example.org');
    env.modal.appendChild(replacement);
    env.context.injectTransferChatsButtons();
    assert.equal(replacement.querySelector('[data-transfer-field="request"]').value, 'Черновик первого чата');
    assert.equal(env.second.querySelector('[data-transfer-field="request"]').value, '');
    env.context.injectTransferChatsButtons();
    assert.equal(replacement.querySelectorAll('textarea').length, 3);
    replacement.firstElementChild.firstElementChild.textContent = '#CHAT3 · Другой чат';
    env.context.injectTransferChatsButtons();
    assert.equal(replacement.querySelector('[data-transfer-field="request"]').value, '');
});

test('empty notes preserve blank template fields', () => {
    const env = setup();
    const result = env.context.formatTransferChats([{ title: 'Клуб', domain: 'club.example.org' }]);
    assert.ok(result.plainText.endsWith('Запрос клуба:\n\nПроделанная работа:\n\nОсталось сделать:'));
    assert.ok(result.htmlText.includes('<blockquote><b><u>Запрос клуба:</u></b><br><br>'));
});

test('disabling transfers removes fields/button while re-enabling restores drafts', () => {
    const env = setup();
    env.context.injectTransferChatsButtons();
    const input = env.first.querySelector('[data-transfer-field="work"]');
    input.value = 'Черновик работы';
    input.listeners.input();
    env.context.userSettings.transferEnabled = false;
    env.context.injectTransferChatsButtons();
    assert.equal(env.first.querySelectorAll('textarea').length, 0);
    assert.equal(env.footer.querySelectorAll('button').length, 0);
    env.context.userSettings.transferEnabled = true;
    env.context.injectTransferChatsButtons();
    assert.equal(env.first.querySelector('[data-transfer-field="work"]').value, 'Черновик работы');
    assert.equal(env.footer.querySelectorAll('button').length, 1);
});
