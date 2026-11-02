const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/content.js'), 'utf8');

function setup() {
    let section;
    let copied;
    let title = 'Клуб <1>';
    function element() {
        return { children: [], style: {}, textContent: '', listeners: {},
            appendChild(child) { this.children.push(child); },
            setAttribute() {}, addEventListener(name, callback) { this.listeners[name] = callback; },
            querySelector(selector) {
                for (const child of this.children) {
                    if ((child.className || '').split(' ').includes(selector.slice(1))) return child;
                    const nested = child.querySelector?.(selector);
                    if (nested) return nested;
                }
                return null;
            } };
    }
    function card(ip, domain = 'club.example.org') {
        return {
            parentNode: { insertBefore(node) { section = node; } },
            querySelector(selector) {
                return selector.includes('Выбранный IP') && ip ? { textContent: ip } : null;
            },
            querySelectorAll() { return [{ textContent: domain, getAttribute: () => `https://${domain}/`, closest: () => null }]; }
        };
    }
    let currentCard = card('5.11.61.42');
    const context = {
        URL, Blob, console, setTimeout() {},
        userSettings: { questionTag: '#вопрос', helpMentions: '@LGS_adv_sup', helpTehMentions: '@LGS_Teh_Sup @ghoultripless' },
        window: { location: { hostname: 'msgtp.langame.ru', href: 'https://msgtp.langame.ru/im/chat/' } },
        document: { createElement: element, querySelector(selector) {
            if (selector === 'section.msgtp-info-card') return section;
            if (selector === 'section.clubInfo:not(.msgtp-info-card)') return currentCard;
            if (selector === '.clubTopMetaTitleRow strong') return { textContent: title };
            return null;
        } },
        navigator: { clipboard: { async write(items) { copied = items[0].data; } } },
        ClipboardItem: class { constructor(data) { this.data = data; } }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('function escapeHtml('), source.indexOf('// 2. КНОПКИ В ШАПКЕ')), context);
    context.createMSGTPSection(currentCard);
    return {
        context, get section() { return section; },
        async copy(index) {
            const row = section.children[index];
            await row.children[1].children[1].listeners.click({ stopPropagation() {} });
            return { plain: await copied['text/plain'].text(), html: await copied['text/html'].text() };
        },
        changeClub(ip, domain, name) { currentCard = card(ip, domain); title = name; },
        refresh() { context.createMSGTPSection(currentCard); }
    };
}

test('teh row follows adv and copies configured tags, domain and first IP as plain text', async () => {
    const env = setup();
    assert.equal(env.section.children[1].children[1].children[0].innerHTML, 'Помощь (adv)');
    assert.equal(env.section.children[2].children[1].children[0].innerHTML, 'Помощь (teh)');
    const teh = await env.copy(2);
    assert.equal(teh.plain, '#вопрос\n\n@LGS_Teh_Sup @ghoultripless\n\nКлуб <1>\nclub.example.org\n5.11.61.42\n\nСуть вопроса');
    assert.ok(teh.html.includes('Клуб &lt;1&gt;<br>club.example.org<br>5.11.61.42'));
    assert.ok(!/<a\b|href=/i.test(teh.html));
    const adv = await env.copy(1);
    assert.ok(adv.plain.includes('@LGS_adv_sup'));
    assert.ok(!adv.plain.includes('5.11.61.42'));
    env.context.userSettings.helpTehMentions = '@custom';
    env.changeClub('192.0.2.10', 'another.example.org', 'Другой клуб');
    const updated = await env.copy(2);
    assert.ok(updated.plain.includes('@custom'));
    assert.ok(updated.plain.includes('Другой клуб\nanother.example.org\n192.0.2.10'));
    assert.ok(!updated.plain.includes('5.11.61.42'));
});

test('help modules disable independently and retain tags when re-enabled', async () => {
    const env = setup();
    env.context.userSettings.helpAdvEnabled = false;
    env.refresh();
    assert.equal(env.section.children[1].hidden, true);
    assert.equal(env.section.children[2].hidden, false);
    assert.equal(env.section.hidden, false);
    env.context.userSettings.helpTehEnabled = false;
    env.refresh();
    assert.equal(env.section.hidden, true);
    env.context.userSettings.helpAdvEnabled = true;
    env.refresh();
    assert.equal(env.section.hidden, false);
    assert.equal(env.section.children[1].hidden, false);
    assert.equal(env.section.children[2].hidden, true);
    assert.ok((await env.copy(1)).plain.includes('@LGS_adv_sup'));
});

test('IP selection prioritizes first selected chip, falls back to copy title, rejects invalid IPv4', () => {
    const { context } = setup();
    const scope = (selected, copied) => ({ querySelector: selector => selector.includes('Выбранный IP')
        ? selected && { textContent: selected } : copied && { getAttribute: () => `Скопировать IP ${copied}` } });
    assert.equal(context.getClubFirstIp(scope('5.11.61.42', '192.0.2.20')), '5.11.61.42');
    assert.equal(context.getClubFirstIp(scope(null, '192.0.2.20')), '192.0.2.20');
    assert.equal(context.getClubFirstIp(scope('999.11.61.42', null)), '');
});

test('missing IP does not insert a fake IP line; settings migration preserves existing tags', async () => {
    const env = setup();
    env.changeClub('', 'club.example.org', 'Клуб');
    const copied = await env.copy(2);
    assert.ok(copied.plain.includes('Клуб\nclub.example.org\n\nСуть вопроса'));
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/settings.js'), 'utf8'), env.context);
    const settings = env.context.MSGTPSettings.normalize({ helpMentions: '@existing' });
    assert.equal(settings.helpMentions, '@existing');
    assert.equal(settings.helpTehMentions, '@LGS_Teh_Sup @ghoultripless');
    assert.ok(fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8').includes('name="helpTehMentions"'));
});
