const form = document.getElementById('settings-form');
const fields = document.getElementById('settings-fields');
const status = document.getElementById('status');
const categories = ['pastes', 'autologin', 'settings'];
const pasteSwitches = ['transferEnabled', 'helpAdvEnabled', 'helpTehEnabled'];

function selectCategory(category, focus = false) {
    for (const name of categories) {
        const selected = category === name;
        const tab = document.getElementById(`tab-${name}`);
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        document.getElementById(`panel-${name}`).hidden = !selected;
        if (selected && focus) tab.focus();
    }
    form.hidden = category === 'autologin';
}

for (const [index, category] of categories.entries()) {
    const tab = document.getElementById(`tab-${category}`);
    tab.addEventListener('click', () => selectCategory(category));
    tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % categories.length;
        else if (event.key === 'ArrowLeft') next = (index + categories.length - 1) % categories.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = categories.length - 1;
        else return;
        event.preventDefault();
        selectCategory(categories[next], true);
    });
}

function refreshPasteOptions() {
    for (const key of pasteSwitches) {
        document.getElementById(`${key}-options`).hidden = !document.getElementById(key).checked;
    }
}
for (const key of pasteSwitches) document.getElementById(key).addEventListener('change', refreshPasteOptions);

function showStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
}

function fillSettings(settings) {
    for (const [key, fallback] of Object.entries(MSGTPSettings.defaults)) {
        const control = form.elements.namedItem(key);
        if (typeof fallback === 'boolean') control.checked = settings[key];
        else control.value = settings[key];
    }
    refreshPasteOptions();
}

async function persist(settings, message) {
    fields.disabled = true;
    try {
        const normalized = MSGTPSettings.normalize(settings);
        const origins = MSGTPSettings.patterns(normalized.domains);
        // Запрос выполняется из обработчика нажатия, до первого await.
        if (origins.length && !await chrome.permissions.request({ origins })) {
            showStatus('Доступ к доменам не разрешён. Настройки не сохранены.', true);
            return;
        }
        await MSGTPSettings.save(normalized);
        fillSettings(normalized);
        const result = await chrome.runtime.sendMessage({ type: 'msgtp-sync-domains' });
        if (!result?.ok) {
            showStatus('Настройки сохранены, но домены не подключились. Сохраните ещё раз.', true);
            return;
        }
        showStatus(message);
    } catch (error) {
        console.error('MSGTP+: ошибка сохранения настроек:', error);
        showStatus(error.message || 'Не удалось сохранить. Попробуйте ещё раз.', true);
    } finally {
        fields.disabled = false;
    }
}

form.addEventListener('submit', event => {
    event.preventDefault();
    const settings = Object.fromEntries(Object.entries(MSGTPSettings.defaults).map(([key, fallback]) => {
        const control = form.elements.namedItem(key);
        return [key, typeof fallback === 'boolean' ? control.checked : control.value];
    }));
    void persist(settings, 'Настройки сохранены');
});

document.getElementById('reset').addEventListener('click', () => {
    void persist(MSGTPSettings.defaults, 'Настройки по умолчанию восстановлены');
});

form.addEventListener('input', () => showStatus('Есть несохранённые изменения'));

MSGTPSettings.load().then(settings => {
    fillSettings(settings);
    fields.disabled = false;
}).catch(error => {
    console.error('MSGTP+: ошибка загрузки настроек:', error);
    showStatus('Не удалось загрузить настройки. Откройте окно ещё раз.', true);
});

const vaultForm = document.getElementById('vault-form');
const vaultControls = document.getElementById('vault-controls');
const vaultStatus = document.getElementById('vault-status');
const vaultAccount = document.getElementById('vault-account');
const vaultAccountTitle = document.getElementById('vault-account-title');
const vaultAccountDetail = document.getElementById('vault-account-detail');
const vaultUsername = document.getElementById('vault-username');
const vaultPassword = document.getElementById('vault-password');
const vaultAutoOn = document.getElementById('vault-auto-on');
const vaultAutoOff = document.getElementById('vault-auto-off');
const vaultInactive = document.getElementById('vault-inactive');
let latestVaultState = null;

function renderVaultState(state) {
    latestVaultState = state;
    vaultAccount.hidden = !state.saved;
    vaultForm.hidden = state.saved || !state.enabled;
    vaultAccount.classList.toggle('connected', state.saved && !state.corrupt);
    vaultAccountTitle.textContent = state.username || (state.corrupt ? 'Аккаунт недоступен' : '');
    vaultAccountDetail.textContent = state.corrupt ? 'Удалите аккаунт и введите данные заново.'
        : state.enabled ? 'Аккаунт сохранён · автовход включён' : 'Аккаунт сохранён · блок выключен';
    vaultAutoOn.checked = state.enabled;
    vaultAutoOff.checked = !state.enabled;
    vaultInactive.hidden = state.enabled;
}

async function vaultAction(type, payload = {}, successMessage = '', clearInputs = false) {
    vaultControls.disabled = true;
    vaultStatus.textContent = '';
    vaultStatus.classList.remove('error');
    try {
        const response = await chrome.runtime.sendMessage({ type, ...payload });
        if (!response?.ok) throw new Error(response?.error || 'Не удалось выполнить действие. Попробуйте ещё раз.');
        renderVaultState(response);
        vaultStatus.textContent = response.needsReenter && response.enabled ? 'После обновления введите логин и пароль один раз.' : successMessage;
        if (clearInputs) vaultUsername.value = '';
    } catch (error) {
        vaultStatus.textContent = error.message || 'Не удалось открыть хранилище';
        vaultStatus.classList.add('error');
        if (latestVaultState) renderVaultState(latestVaultState);
    } finally {
        if (clearInputs) vaultPassword.value = '';
        vaultControls.disabled = false;
    }
}

vaultForm.addEventListener('submit', event => {
    event.preventDefault();
    void vaultAction('msgtp-vault-save', {
        username: vaultUsername.value, password: vaultPassword.value
    }, 'Аккаунт сохранён. Обновите страницу входа.', true);
});

for (const control of [vaultAutoOn, vaultAutoOff]) {
    control.addEventListener('change', () => {
        if (!control.checked) return;
        void vaultAction('msgtp-vault-toggle', { enabled: control === vaultAutoOn },
            control === vaultAutoOn ? 'Авто. вход на домен включён.' : '');
    });
}

document.getElementById('vault-delete').addEventListener('click', () => {
    void vaultAction('msgtp-vault-remove', {}, 'Аккаунт удалён. Можно ввести новые данные.', true);
});

void vaultAction('msgtp-vault-state');
