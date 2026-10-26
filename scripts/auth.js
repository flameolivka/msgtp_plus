// Заполняем только форму авторизации на разрешённом HTTPS-сайте.
(() => {
    if (window.top !== window || location.protocol !== 'https:' || location.port || location.pathname !== '/auth.php') return;
    let visited = new WeakSet();
    let enabled = false;
    let featureEnabled = true;

    function visible(input) {
        return !input.disabled && !input.readOnly && input.getClientRects().length > 0;
    }

    function sameOriginAction(form, submitter) {
        try {
            const action = submitter?.hasAttribute('formaction')
                ? submitter.getAttribute('formaction') : form.getAttribute('action') || location.href;
            return form.method.toLowerCase() === 'post' && new URL(action, location.href).origin === location.origin
                && (!submitter?.hasAttribute('formmethod') || submitter.formMethod.toLowerCase() === 'post');
        } catch { return false; }
    }

    function findFields(form) {
        const inputs = Array.from(form.elements).filter(element => element instanceof HTMLInputElement && visible(element));
        const passwords = inputs.filter(input => input.type === 'password' && input.autocomplete !== 'new-password');
        if (passwords.length !== 1) return null;
        const password = passwords[0];
        const candidates = inputs.filter(input => ['text', 'email'].includes(input.type)
            && (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING));
        const username = candidates.find(input => input.autocomplete === 'username')
            || candidates.find(input => /^(login|username|user|email|account|user_login)$/i.test(input.name || input.id))
            || (candidates.length === 1 ? candidates[0] : null);
        const submitter = Array.from(form.elements).find(element =>
            ['submit', 'image'].includes(element.type) && !element.disabled);
        return username && sameOriginAction(form, submitter) ? { username, password, submitter } : null;
    }

    function notice(form, text) {
        let status = form.querySelector('.msgtp-auth-status');
        if (!status) {
            status = document.createElement('p');
            status.className = 'msgtp-auth-status';
            status.setAttribute('role', 'status');
            form.appendChild(status);
        }
        status.textContent = `MSGTP+: ${text}`;
    }

    function setInputValue(input, value) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function fill(form, fields) {
        if (fields.password.value) return;
        try {
            const data = await chrome.runtime.sendMessage({ type: 'msgtp-vault-fill' });
            if (!data?.ok) return;
            // Не заменяем пароль из браузера и данные, введённые вручную.
            if (!form.isConnected || !enabled || !featureEnabled || fields.password.value
                || fields.username.form !== form || fields.password.form !== form
                || !visible(fields.username) || !visible(fields.password)
                || (fields.username.value && fields.username.value !== data.username)
                || !sameOriginAction(form, fields.submitter)) return;
            setInputValue(fields.username, data.username);
            setInputValue(fields.password, data.password);
            notice(form, 'логин и пароль заполнены.');
            if (form.querySelector('[name*="captcha" i], .g-recaptcha, .h-captcha, [data-sitekey], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')) {
                notice(form, 'данные заполнены. Пройдите проверку и нажмите «Войти» вручную.');
                return;
            }
            if (!form.checkValidity() || !sameOriginAction(form, fields.submitter)) return;
            // При ошибке авторизации не зацикливаем повторные попытки.
            try {
                const key = 'msgtp-auto-login-at';
                const lastAttempt = Number(sessionStorage.getItem(key) || 0);
                if (Date.now() - lastAttempt < 10 * 60 * 1000) {
                    notice(form, 'автовход уже выполнялся. Проверьте данные и нажмите «Войти» вручную.');
                    return;
                }
                sessionStorage.setItem(key, String(Date.now()));
            } catch {
                return; // Без защиты от повторов только заполняем поля.
            }
            if (fields.submitter) fields.submitter.click();
            else HTMLFormElement.prototype.requestSubmit.call(form);
        } catch {
            notice(form, 'не удалось заполнить форму. Откройте настройки входа и попробуйте ещё раз.');
        }
    }

    function checkForms() {
        if (!enabled || !featureEnabled) return;
        for (const form of document.forms) {
            if (visited.has(form)) continue;
            const fields = findFields(form);
            if (!fields) continue;
            visited.add(form);
            void fill(form, fields);
        }
    }

    MSGTPSettings.load().then(settings => {
        enabled = MSGTPSettings.matches(location.hostname, settings.domains);
        if (!enabled) return;
        checkForms();
        new MutationObserver(checkForms).observe(document.body, { childList: true, subtree: true });
    }).catch(() => {});

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.msgtpDomainLoginEnabled) {
            featureEnabled = changes.msgtpDomainLoginEnabled.newValue !== false;
            if (featureEnabled) { visited = new WeakSet(); checkForms(); }
        }
        if (area === 'local' && changes[MSGTPSettings.key]) {
            enabled = MSGTPSettings.matches(location.hostname, MSGTPSettings.normalize(changes[MSGTPSettings.key].newValue).domains);
        }
    });
})();
