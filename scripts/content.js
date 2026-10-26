// =============================================================
// ОПТИМИЗАЦИЯ КАРТОЧЕК ПК ПО РОУТУ /all_clubs_pc/
// =============================================================

function optimizePCCards() {
    if (!window.location.pathname.includes('/all_clubs_pc')) return;

    // Находим все стандартные карточки ПК
    const pcForms = document.querySelectorAll('form.pc:not(.msgtp-optimized)');

    pcForms.forEach(form => {
        form.classList.add('msgtp-optimized');
        
        // Получаем UUID и имя ПК из старой структуры
        const uuid = form.id;
        const pcName = form.querySelector('.pc_name')?.textContent.trim() || 'PC';
        const mac = form.querySelector('.poweron')?.getAttribute('data-mac') || '';

        // Создаем компактный HTML
        const newTemplate = `
            <div class="card msgtp-pc-card">
                <!-- Шапка с именем и выпадающим меню -->
                <div class="msgtp-pc-header">
                    <span>${pcName}</span>
                    <div class="dropdown">
                        <i class="fa fa-cog dropdown-toggle" id="drop_${uuid}" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"></i>
                        <div class="dropdown-menu dropdown-menu-right" aria-labelledby="drop_${uuid}">
                            <button onclick="StartRemote('${uuid}')" class="dropdown-item btn-sm"><i class="fa fa-desktop"></i> Управлять</button>
                            <button onclick="OpenAlertButton()" class="dropdown-item btn-sm"><i class="fa fa-tasks"></i> Процессы ПК</button>
                            <button onclick="OpenAlertButton()" class="dropdown-item btn-sm"><i class="fa fa-folder-open"></i> Изм. файлы</button>
                            <button onclick="SetSessionPause('${uuid}')" class="dropdown-item btn-sm"><i class="fa fa-pause"></i> Пауза сессии</button>
                            <button onclick="Reboot('${uuid}')" class="dropdown-item btn-sm"><i class="fa fa-refresh"></i> Перезагрузка</button>
                            <button onclick="KillMaxLoadProcessGet('${uuid}')" class="dropdown-item btn-sm"><i class="fa fa-times-circle"></i> Завершить процесс</button>
                            <button onclick="historyPC('${uuid}')" class="dropdown-item btn-sm"><i class="fa fa-history"></i> История ПК</button>
                            <button onclick="ReloadiSCSI('${uuid}')" class="dropdown-item btn-sm"><i class="fa fa-hdd-o"></i> Перезапуск диска D</button>
                            <button onclick="SteamAutoUpdate('${uuid}')" class="dropdown-item btn-sm"><i class="fa fa-steam"></i> Steam Update</button>
                            <div class="dropdown-divider"></div>
                            <a href="/all_clubs_pc/logs/?uuid=${uuid}" target="_blank" class="dropdown-item btn-sm"><i class="fa fa-file-text-o"></i> Логи</a>
                        </div>
                    </div>
                </div>

                <!-- Статус соединения -->
                <div data-type="status" class="msgtp-pc-status">Соединение</div>

                <!-- Информация о времени/клиенте -->
                <div class="msgtp-pc-info pc_info">
                    <div class="remain"></div>
                    <div class="timeLock"></div>
                    <div class="fio text-truncate" title="ФИО">&nbsp;</div>
                </div>

                <!-- Чекбоксы в один ряд -->
                <div class="msgtp-pc-checks">
                    <title="Посадка"><input type="checkbox" class="god" id="chk_god_${uuid}" checked onchange="BlockChange('${uuid}',$(this))"> <label for="chk_god_${uuid}">Пос</label>
                    <title="Бронь"><input type="checkbox" id="chk_res_${uuid}" checked onchange="switchReservation(this, '${uuid}')"> <label for="chk_res_${uuid}">Бронь</label>
                    <title="Блокировка ввода"><input type="checkbox" id="chk_dev_${uuid}" disabled onchange="switchBlockInputDevices(this, '${uuid}')"> <label for="chk_dev_${uuid}">Ввод</label>
                </div>

                <!-- Быстрые компактные кнопки (Иконки) -->
                <div class="msgtp-pc-actions">
                    <button type="button" class="btn btn-success btn-sm poweron" data-mac="${mac}" onclick="PowerOn('${uuid}')" title="Включить"><i class="fa fa-power-off"></i></button>
                    <button type="button" class="btn btn-danger btn-sm shutdown" data-type="Shutdown" title="Выключить" disabled><i class="fa fa-power-off"></i></button>
                    <button type="button" class="btn btn-warning btn-sm text-white session_stop" onclick="sessionStop('${uuid}')" title="Сброс сессии" disabled><i class="fa fa-undo"></i></button>
                </div>

                <!-- Основное действие -->
                <button type="button" class="btn btn-primary btn-sm msgtp-pc-manage" onclick="StartRemote('${uuid}')" title="Управлять ПК">
                    <i class="fa fa-desktop"></i> Управлять
                </button>
            </div>
        `;

        // Заменяем внутренности формы новым шаблоном
        form.innerHTML = newTemplate;
    });
}

// =============================================================
// 0. ЦЕНТРАЛЬНАЯ КОНФИГУРАЦИЯ РАСШИРЕНИЯ
// =============================================================

let userSettings = { ...MSGTPSettings.defaults };

function escapeHtml(text) {
    return text.replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function getClubLink(card) {
    const links = Array.from(card.querySelectorAll('a[href]')).map(anchor => {
        const raw = anchor.getAttribute('href')?.trim();
        if (!raw || /^(?:#|javascript:|mailto:|tel:)/i.test(raw)) return null;
        try {
            const href = new URL(/^[\w-]+(?:\.[\w-]+)+(?:[/:]|$)/.test(raw) ? `https://${raw}` : raw, window.location.href);
            if (!/^https?:$/.test(href.protocol)) return null;
            const row = anchor.closest('.kv');
            const label = row?.querySelector('b, dt, label')?.textContent || '';
            const text = anchor.textContent.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
            const score = (/домен|domain|сайт|website/i.test(label) ? 100 : 0)
                + (text.toLowerCase() === href.hostname.toLowerCase() ? 20 : 0)
                + (href.hostname !== window.location.hostname ? 10 : 0);
            return { href: href.href, score };
        } catch {
            return null;
        }
    }).filter(Boolean).sort((a, b) => b.score - a.score);

    const href = links[0]?.href || window.location.href;
    return { linkHref: href, cleanDisplayLink: href.replace(/^https?:\/\//i, '').replace(/\/$/, '') };
}

/**
 * Проверяет текущий хост по пользовательскому списку доменов.
 */
function isTargetDomain() {
    return MSGTPSettings.matches(window.location.hostname, userSettings.domains);
}


// =============================================================
// 1. ИНФОРМАЦИОННАЯ КАРТОЧКА MSGTP+ (Быстрые пасты)
// =============================================================

function createMSGTPSection(clubInfoCard) {
    if (document.querySelector('section.msgtp-info-card')) return;

    const msgtpSection = document.createElement('section');
    msgtpSection.className = 'clubInfo clubInfoCard msgtp-info-card';

    const headerRow = document.createElement('div');
    headerRow.className = 'kv msgtp-card-row';

    const headerLabel = document.createElement('b');
    headerLabel.className = 'msgtp-header-label';
    headerLabel.innerHTML = `<span>Расширение</span><span class="msgtp-badge">MSGTP+</span>`;

    const headerValue = document.createElement('span');
    headerValue.className = 'rightPanelCopyableText';

    headerRow.appendChild(headerLabel);
    headerRow.appendChild(headerValue);

    const copySvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display: block;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

    function createPasteRow(labelHTML, actionTitle, onCopyClick) {
        const row = document.createElement('div');
        row.className = 'kv msgtp-card-row';

        const label = document.createElement('b');
        label.textContent = 'PASTE';

        const value = document.createElement('span');
        value.className = 'rightPanelCopyableText';

        const mentionSpan = document.createElement('span');
        mentionSpan.className = 'msgtp-mention-text';
        mentionSpan.innerHTML = labelHTML;

        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'btnIcon btnGhost rightPanelCopyTextButton msgtp-action-btn';
        actionBtn.title = actionTitle;
        actionBtn.setAttribute('aria-label', actionTitle);
        actionBtn.innerHTML = copySvg;

        actionBtn.addEventListener('click', (e) => onCopyClick(e, actionBtn));

        value.appendChild(mentionSpan);
        value.appendChild(actionBtn);
        row.appendChild(label);
        row.appendChild(value);

        return row;
    }

    function getChatMeta() {
        const titleElement =
            document.querySelector('.clubTopMetaTitleRow strong') ||
            document.querySelector('.clubTopMetaTitleRow') ||
            document.querySelector('.chatPinnedHeaderTitle');

        const titleText = titleElement ? titleElement.textContent.trim() : 'Название не найдено';
        
        // При переключении чата сайт может заменить исходную карточку.
        const currentCard = document.querySelector('section.clubInfo:not(.msgtp-info-card)') || clubInfoCard;
        return { titleText, ...getClubLink(currentCard) };
    }

    async function copyToClipboard(plainText, htmlText, btn) {
        try {
            const blobHtml = new Blob([htmlText], { type: 'text/html' });
            const blobText = new Blob([plainText], { type: 'text/plain' });
            await navigator.clipboard.write([new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })]);

            btn.style.color = '#4ade80';
            setTimeout(() => { btn.style.color = ''; }, 1200);
        } catch (err) {
            console.error('Ошибка записи в буфер обмена:', err);
            await navigator.clipboard.writeText(plainText);
        }
    }

    const handleCopyAction = async (e, btn, tag, mention) => {
        e.stopPropagation();
        const { titleText, cleanDisplayLink } = getChatMeta();
        const plainText = `${tag}\n\n${mention}\n\n${titleText}\n${cleanDisplayLink}\n\nСуть вопроса`;
        const htmlText = `${escapeHtml(tag)}<br><br>${escapeHtml(mention)}<br><br>${escapeHtml(titleText)}<br>${escapeHtml(cleanDisplayLink)}<br><br>Суть вопроса`;
        await copyToClipboard(plainText, htmlText, btn);
    };

    const questionRow = createPasteRow(
        'Помощь (adv)',
        'Скопировать заготовку вопроса',
        (e, btn) => handleCopyAction(e, btn, userSettings.questionTag, userSettings.helpMentions)
    );

    msgtpSection.appendChild(headerRow);
    msgtpSection.appendChild(questionRow);

    clubInfoCard.parentNode.insertBefore(msgtpSection, clubInfoCard);
}


// =============================================================
// 2. КНОПКИ В ШАПКЕ САЙТА (Helpdesk / Админ. ПО)
// =============================================================

let closeAdminMenu = null;

function showAdminMenu(event, button) {
    event.preventDefault();
    event.stopPropagation();
    closeAdminMenu?.();

    const menu = document.createElement('div');
    menu.className = 'msgtp-admin-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Администрирование');
    const link = document.createElement('a');
    link.href = '/administrators/';
    link.textContent = 'Список администраторов';
    link.setAttribute('role', 'menuitem');
    menu.appendChild(link);
    document.body.appendChild(menu);
    const bounds = button.getBoundingClientRect();
    const x = event.clientX || bounds.left;
    const y = event.clientY || bounds.bottom;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
    button.setAttribute('aria-expanded', 'true');

    const controller = new AbortController();
    const options = { signal: controller.signal };
    closeAdminMenu = () => {
        controller.abort();
        menu.remove();
        button.setAttribute('aria-expanded', 'false');
        closeAdminMenu = null;
    };
    document.addEventListener('pointerdown', e => {
        if (!menu.contains(e.target)) closeAdminMenu?.();
    }, options);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeAdminMenu?.();
            button.focus();
        } else if (e.key === 'Tab') {
            closeAdminMenu?.();
            button.focus();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            link.focus();
        }
    }, options);
    window.addEventListener('resize', () => closeAdminMenu?.(), options);
    window.addEventListener('scroll', () => closeAdminMenu?.(), { ...options, capture: true });
    link.addEventListener('click', () => closeAdminMenu?.(), options);
    link.focus();
}

function injectLangameHeaderButtons() {
    if (!isTargetDomain() || document.querySelector('.msgtp-header-li')) return;

    const newLi = document.createElement('li');
    newLi.className = 'msgtp-header-li';

    const blockWrapper = document.createElement('div');
    blockWrapper.className = 'msgtp-header-block';

    const createBtn = (href, text) => {
        const btn = document.createElement('a');
        btn.className = 'msgtp-header-btn';
        btn.href = href;
        btn.textContent = text;
        return btn;
    };

    blockWrapper.appendChild(createBtn('/helpdesk', 'Helpdesk'));
    const adminsButton = createBtn('/admins/', 'Админ. ПО');
    adminsButton.title = 'Админ. ПО · ПКМ — список администраторов';
    adminsButton.setAttribute('aria-haspopup', 'menu');
    adminsButton.setAttribute('aria-expanded', 'false');
    adminsButton.addEventListener('contextmenu', event => showAdminMenu(event, adminsButton));
    blockWrapper.appendChild(adminsButton);
    newLi.appendChild(blockWrapper);

    const ticketButton = document.querySelector('a[data-target="#createTickedWindow"]');
    const ticketLi = ticketButton ? ticketButton.closest('li') : null;

    if (ticketLi) {
        ticketLi.parentNode.insertBefore(newLi, ticketLi);
        return;
    }

    const supportDiv = document.getElementById('js-write-to-support');
    const supportLi = supportDiv ? supportDiv.closest('li') : null;

    if (supportLi) {
        supportLi.parentNode.insertBefore(newLi, supportLi);
        return;
    }

    const headerControls = document.querySelector('.header-controls, .header__controls');
    if (headerControls) {
        headerControls.insertBefore(newLi, headerControls.firstChild);
    }
}


// =============================================================
// 3. КНОПКА ВОЗВРАТА (Helpdesk / Админ. ПО)
// =============================================================

function injectBackToMainButton() {
    if (!isTargetDomain() || document.querySelector('.msgtp-back-to-main-btn')) return;
    const isAdmins = /^\/admins(?:\/|$)/.test(window.location.pathname);
    const isHelpdesk = /^\/helpdesk(?:\/|$)/.test(window.location.pathname);
    if (!isAdmins && !isHelpdesk) return;

    const helpdeskHeaderLink = isAdmins
        ? document.querySelector('.header_title')
        : document.querySelector('a[href="/helpdesk"].text-decoration-none, a[href="/helpdesk"], a[href="/helpdesk/"]');
    if (!helpdeskHeaderLink) return;

    if (!isAdmins && helpdeskHeaderLink.parentElement) {
        helpdeskHeaderLink.parentElement.classList.add('d-flex', 'align-items-center');
    }

    const backBtn = document.createElement('a');
    backBtn.className = 'btn btn-outline-secondary btn-sm ms-3 msgtp-back-to-main-btn d-inline-flex align-items-center gap-1';
    backBtn.href = '/';
    backBtn.style.whiteSpace = 'nowrap';
    backBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        <span>На главный сайт</span>
    `;

    helpdeskHeaderLink.after(backBtn);
}


// =============================================================
// 4. КОПИРОВАНИЕ ЧАТОВ ДЛЯ ПЕРЕДАЧИ
// =============================================================

function getTransferChats(scope) {
    return Array.from(scope.querySelectorAll('button'))
        .filter(button => button.textContent.trim() === 'Открыть чат')
        .map(button => {
            // Карточка: шапка (название + статус), домен, действия.
            const card = button.parentElement?.parentElement;
            const heading = card?.children[0]?.firstElementChild?.textContent.trim();
            const domain = card?.children[1]?.textContent.trim();
            if (!heading || !domain || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
                return null;
            }
            const title = heading.replace(/^#[^\s·]+\s*·\s*/, '').trim();
            return title ? { title, domain } : null;
        })
        .filter(Boolean);
}

function getTransferChatScope(footer) {
    // Не выходим за границы окна и не захватываем чаты под ним.
    const modal = footer.closest('.sheetModalPlain, [role="dialog"], [aria-modal="true"]');
    if (modal) return modal;

    // Поддерживаем обёртки окна без класса или роли.
    for (let parent = footer.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (getTransferChats(parent).length) return parent;
    }
    return null;
}

function formatTransferChats(chats) {
    const header = [userSettings.transferMentions, 'передай чаты, пожалуйста (передал на base):'].filter(Boolean).join('\n');
    const fields = ['Запрос клуба:', 'Проделанная работа:', 'Осталось сделать:'];

    const plainText = `${header}\n\n${chats.map(chat =>
        `${chat.title}\n${chat.domain}\n${fields.join('\n\n')}`
    ).join('\n\n')}`;
    // Поля каждого чата — единая цитата; переносы вне жирных/подчёркнутых подписей.
    const htmlText = `${escapeHtml(header).replace(/\n/g, '<br>')}<br><br>${chats.map(chat =>
        `${escapeHtml(chat.title)}<br>${escapeHtml(chat.domain)}<blockquote>${fields.map(field =>
            `<b><u>${escapeHtml(field)}</u></b>`
        ).join('<br><br>')}</blockquote>`
    ).join('<br><br>')}`;

    return { plainText, htmlText };
}

function injectTransferChatsButtons() {
    if (window.location.hostname !== 'msgtp.langame.ru' || !/^\/im\/chat(?:\/|$)/.test(window.location.pathname)) return;

    document.querySelectorAll('.sheetModalPlain__footer').forEach(footer => {
        if (footer.querySelector('.msgtp-transfer-chats-btn')) return;
        const scope = getTransferChatScope(footer);
        if (!scope || !getTransferChats(scope).length) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'upmSquashBtn upmSquashBtn--sm msgtp-transfer-chats-btn';
        button.textContent = 'Передать чаты';
        button.title = 'Скопировать шаблон передачи чатов из этого окна';

        const status = document.createElement('span');
        status.className = 'msgtp-transfer-chats-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            const currentScope = getTransferChatScope(footer);
            const chats = currentScope ? getTransferChats(currentScope) : [];
            if (!chats.length) {
                status.textContent = 'Нет чатов для копирования';
                return;
            }

            button.disabled = true;
            try {
                const { plainText, htmlText } = formatTransferChats(chats);
                await navigator.clipboard.write([new ClipboardItem({
                    'text/plain': new Blob([plainText], { type: 'text/plain' }),
                    'text/html': new Blob([htmlText], { type: 'text/html' })
                })]);
                status.textContent = `Скопировано чатов: ${chats.length}`;
            } catch (error) {
                console.error('MSGTP+: не удалось скопировать чаты:', error);
                status.textContent = 'Не удалось скопировать. Попробуйте ещё раз.';
            } finally {
                button.disabled = false;
            }
        });

        footer.append(button, status);
    });
}

// =============================================================
// 5. ИНИЦИАЛИЗАЦИЯ И НАБЛЮДАТЕЛЬ (DOM Observer)
// =============================================================

function checkAndInject() {
    if (!isTargetDomain()) {
        closeAdminMenu?.();
        document.querySelectorAll('.msgtp-info-card, .msgtp-header-li, .msgtp-back-to-main-btn, .msgtp-transfer-chats-btn, .msgtp-transfer-chats-status').forEach(element => element.remove());
        return;
    }
    const existingCard = document.querySelector('section.clubInfo:not(.msgtp-info-card)');
    if (existingCard) {
        createMSGTPSection(existingCard);
    }
    injectLangameHeaderButtons();
    injectBackToMainButton();
    injectTransferChatsButtons();
}

const observer = new MutationObserver(checkAndInject);
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[MSGTPSettings.key]) {
        userSettings = MSGTPSettings.normalize(changes[MSGTPSettings.key].newValue);
        checkAndInject();
    }
});
MSGTPSettings.load().then(settings => {
    userSettings = settings;
}).catch(error => {
    console.error('MSGTP+: не удалось загрузить настройки:', error);
}).finally(() => {
    checkAndInject();
    observer.observe(document.body, { childList: true, subtree: true });
});
