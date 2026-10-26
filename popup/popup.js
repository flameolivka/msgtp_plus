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
