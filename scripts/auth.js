// Вход через POST /auth.php только на разрешённом HTTPS-сайте.
(() => {
    if (window.top !== window || location.protocol !== 'https:' || location.port || location.pathname !== '/auth.php') return;
    let visited = new WeakSet();
    let enabled = false;
    let featureEnabled = true;
    let requestInFlight = false;

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

    async function login(form, fields) {
        if (fields.password.value || requestInFlight) return;
        let ownsRequest = false;
        try {
            const data = await chrome.runtime.sendMessage({ type: 'msgtp-vault-fill' });
            if (!data?.ok) return;
            // Не заменяем пароль из браузера и данные, введённые вручную.
            if (!form.isConnected || !enabled || !featureEnabled || fields.password.value
                || fields.username.form !== form || fields.password.form !== form
                || !visible(fields.username) || !visible(fields.password)
                || (fields.username.value && fields.username.value !== data.username)
                || !sameOriginAction(form, fields.submitter)) return;
            if (form.querySelector('[name*="captcha" i], .g-recaptcha, .h-captcha, [data-sitekey], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')) {
                notice(form, 'пройдите проверку и войдите вручную.');
                return;
            }
            if (Array.from(form.elements).some(element => element !== fields.username && element !== fields.password
                && element.willValidate && !element.validity.valid)) return;
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
                notice(form, 'автовход недоступен. Войдите вручную.');
                return;
            }
            const body = new URLSearchParams();
            // Сохраняем скрытые параметры формы, например CSRF-токен.
            for (const element of form.elements) {
                if (element.type === 'hidden' && element.name && !element.disabled
                    && !['login', 'password'].includes(element.name)) body.append(element.name, element.value);
            }
            if (fields.submitter?.name && !['login', 'password'].includes(fields.submitter.name)) {
                body.append(fields.submitter.name, fields.submitter.value);
            }
            body.set('login', data.username);
            body.set('password', data.password);
            requestInFlight = true;
            ownsRequest = true;
            notice(form, 'выполняется вход…');
            const response = await fetch('/auth.php', {
                method: 'POST', credentials: 'same-origin', mode: 'same-origin', body,
                // Не пересылаем тело с паролем при перенаправлениях POST.
                redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000)
            });
            if (!response.ok && response.type !== 'opaqueredirect') {
                notice(form, 'сервер отклонил вход. Проверьте данные и войдите вручную.');
                return;
            }
            if (enabled && featureEnabled) window.location.reload();
        } catch {
            notice(form, 'не удалось выполнить вход. Проверьте соединение и войдите вручную.');
        } finally {
            if (ownsRequest) requestInFlight = false;
        }
    }

    function checkForms() {
        if (!enabled || !featureEnabled || document.readyState === 'loading') return;
        for (const form of document.forms) {
            if (visited.has(form)) continue;
            const fields = findFields(form);
            if (!fields) continue;
            visited.add(form);
            void login(form, fields);
        }
    }

    MSGTPSettings.load().then(settings => {
        enabled = MSGTPSettings.matches(location.hostname, settings.domains);
        if (!enabled) return;
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkForms, { once: true });
        checkForms();
        new MutationObserver(checkForms).observe(document, { childList: true, subtree: true });
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
