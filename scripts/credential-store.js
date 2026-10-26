// IndexedDB расширения: страницы сайтов не имеют доступа к этой базе.
globalThis.MSGTPCredentialStore = {
    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('msgtp-credentials', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('account');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error('Не удалось открыть хранилище аккаунта'));
            request.onblocked = () => reject(new Error('Закройте другие окна настроек и попробуйте снова'));
        });
    },
    async transaction(mode, operation) {
        const db = await this.open();
        try {
            return await new Promise((resolve, reject) => {
                const transaction = db.transaction('account', mode);
                const request = operation(transaction.objectStore('account'));
                transaction.oncomplete = () => resolve(request.result);
                transaction.onabort = transaction.onerror = () => reject(new Error('Не удалось обновить хранилище аккаунта'));
            });
        } finally { db.close(); }
    },
    get() { return this.transaction('readonly', store => store.get('current')); },
    put(record) { return this.transaction('readwrite', store => store.put(record, 'current')); },
    remove() { return this.transaction('readwrite', store => store.delete('current')); }
};
