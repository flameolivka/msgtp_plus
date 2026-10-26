const form = document.getElementById('settings-form');
const fields = document.getElementById('settings-fields');
const status = document.getElementById('status');

function showStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
}

function fillSettings(settings) {
    for (const key of Object.keys(MSGTPSettings.defaults)) {
        form.elements.namedItem(key).value = settings[key];
    }
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
    const settings = Object.fromEntries(Object.keys(MSGTPSettings.defaults).map(key => [key, form.elements.namedItem(key).value]));
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
