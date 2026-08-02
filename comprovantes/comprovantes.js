/* ============================================================
   palletoptimizer — Controle de Comprovantes

   Estrutura de salvamento:

   PASTA BASE
   └── CLIENTE
       └── março de 2026
           └── CLIENTE-NFE.pdf

   Regras:
   - Usa a Data de Embarque para identificar o mês e o ano.
   - Se a pasta do cliente já existir, ela será reutilizada.
   - Se a pasta do mês já existir, ela será reutilizada.
   - Se não existir, a pasta será criada automaticamente.
   - Pastas como "março 2026" e "março de 2026" são reconhecidas
     como a mesma pasta.
   - Salvamento automático disponível no Chrome e Edge.
============================================================ */

const DB_NAME = 'palletComprovantesDB';
const DB_VERSION = 2;
const STORE_RECORDS = 'records';
const STORE_META = 'meta';
const STORE_CARRIERS = 'carriers';

const DEFAULT_CARRIERS = [
    'SUA TRANSPORTADORA'
];

const MONTH_NAMES_PT_BR = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro'
];

let db = null;
let dirHandle = null;
let records = [];
let carriers = [];
let clientFolders = [];
let currentFilter = 'todos';
let currentSearch = '';
let editingId = null;
let pendingUploadId = null;
let toastTimeout = null;

const supportsFSAccess = 'showDirectoryPicker' in window;

/* ============================================================
   INDEXEDDB
============================================================ */

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;

            if (!database.objectStoreNames.contains(STORE_RECORDS)) {
                database.createObjectStore(STORE_RECORDS, {
                    keyPath: 'id'
                });
            }

            if (!database.objectStoreNames.contains(STORE_META)) {
                database.createObjectStore(STORE_META, {
                    keyPath: 'key'
                });
            }

            if (!database.objectStoreNames.contains(STORE_CARRIERS)) {
                const store = database.createObjectStore(STORE_CARRIERS, {
                    keyPath: 'name'
                });

                store.transaction.oncomplete = () => {
                    const transaction = database.transaction(
                        STORE_CARRIERS,
                        'readwrite'
                    );

                    const carrierStore = transaction.objectStore(
                        STORE_CARRIERS
                    );

                    DEFAULT_CARRIERS.forEach((name) => {
                        carrierStore.put({
                            name,
                            isDefault: true
                        });
                    });
                };
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function txStore(storeName, mode) {
    return db.transaction(storeName, mode).objectStore(storeName);
}

function idbGetAll(storeName) {
    return new Promise((resolve, reject) => {
        const request = txStore(storeName, 'readonly').getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

function idbGet(storeName, key) {
    return new Promise((resolve, reject) => {
        const request = txStore(storeName, 'readonly').get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function idbPut(storeName, value) {
    return new Promise((resolve, reject) => {
        const request = txStore(storeName, 'readwrite').put(value);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function idbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
        const request = txStore(storeName, 'readwrite').delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/* ============================================================
   UTILIDADES
============================================================ */

function todayISO() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function formatDateBR(value) {
    const parsed = parseDataEmbarque(value);

    if (!parsed) {
        return '—';
    }

    return `${String(parsed.day).padStart(2, '0')}/${String(parsed.month).padStart(2, '0')}/${parsed.year}`;
}

function parseDataEmbarque(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return {
            year: value.getFullYear(),
            month: value.getMonth() + 1,
            monthIndex: value.getMonth(),
            day: value.getDate()
        };
    }

    const raw = String(value || '').trim();

    if (!raw) {
        return null;
    }

    // Formato do input type="date": 2026-03-15
    let match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(raw);

    if (match) {
        return validateParsedDate(
            Number(match[1]),
            Number(match[2]),
            Number(match[3])
        );
    }

    // Formato brasileiro: 15/03/2026 ou 15-03-2026
    match = /^(\d{2})[\/-](\d{2})[\/-](\d{4})$/.exec(raw);

    if (match) {
        return validateParsedDate(
            Number(match[3]),
            Number(match[2]),
            Number(match[1])
        );
    }

    return null;
}

function validateParsedDate(year, month, day) {
    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        year < 1900 ||
        year > 9999 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31
    ) {
        return null;
    }

    const date = new Date(year, month - 1, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    return {
        year,
        month,
        monthIndex: month - 1,
        day
    };
}

function sanitizeFileName(value, fallback = 'SEM_NOME') {
    const clean = String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

    return clean || fallback;
}

function safeFolderName(value, fallback = 'SEM_NOME') {
    const clean = String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '');

    return clean || fallback;
}

function normalizedFolderKey(value) {
    return String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR')
        .replace(/[^a-z0-9]+/g, '');
}

function normalizedMonthFolderKey(value) {
    return String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR')
        .replace(/\bde\b/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

function clientFolderNameFor(record) {
    return safeFolderName(record.cliente, 'CLIENTE_SEM_NOME');
}

function fileBaseNameFor(record) {
    const client = sanitizeFileName(record.cliente, 'CLIENTE');
    const nfe = sanitizeFileName(record.nfe, 'SEM_NFE');

    return `${client}-${nfe}`;
}

function monthFolderNameFor(record) {
    const parsed = parseDataEmbarque(record.dataEmbarque);

    if (!parsed) {
        throw new Error(
            'A Data de Embarque está vazia ou inválida. Edite o registro e informe a data correta antes de anexar o comprovante.'
        );
    }

    return `${MONTH_NAMES_PT_BR[parsed.monthIndex]} de ${parsed.year}`;
}

function uid() {
    return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(message, isError = false) {
    const element = document.getElementById('toast');

    if (!element) {
        console.log(message);
        return;
    }

    element.textContent = message;
    element.classList.toggle('error', isError);
    element.classList.add('show');

    clearTimeout(toastTimeout);

    toastTimeout = setTimeout(() => {
        element.classList.remove('show');
    }, 4000);
}

/* ============================================================
   PASTA BASE E PASTAS DOS CLIENTES
============================================================ */

async function initFolderUI() {
    const dot = document.getElementById('folder-dot');
    const label = document.getElementById('folder-label');
    const button = document.getElementById('select-folder-btn');

    if (!supportsFSAccess) {
        if (button) {
            button.style.display = 'none';
        }

        if (dot) {
            dot.classList.remove('ok');
        }

        if (label) {
            label.innerHTML = '<strong>Salvamento automático indisponível.</strong> Use Google Chrome ou Microsoft Edge.';
        }

        return;
    }

    try {
        const meta = await idbGet(STORE_META, 'dirHandle');

        if (meta?.handle) {
            dirHandle = meta.handle;

            const permission = await dirHandle.queryPermission({
                mode: 'readwrite'
            });

            if (permission === 'granted') {
                await scanClientFolders();
            }
        }
    } catch (error) {
        console.warn('Não foi possível recuperar a pasta salva:', error);
        dirHandle = null;
    }

    updateFolderLabel();
}

function updateFolderLabel() {
    const dot = document.getElementById('folder-dot');
    const label = document.getElementById('folder-label');

    if (!dot || !label) {
        return;
    }

    if (dirHandle) {
        const text = clientFolders.length === 1
            ? '1 pasta de cliente encontrada'
            : `${clientFolders.length} pastas de clientes encontradas`;

        dot.classList.add('ok');
        label.innerHTML = `Pasta base: <strong>${escapeHTML(dirHandle.name)}</strong> — salvamento em <strong>CLIENTE / mês de ano</strong> (${text}).`;
    } else {
        dot.classList.remove('ok');
        label.innerHTML = '<strong>Nenhuma pasta base selecionada.</strong> Selecione a pasta que contém as pastas dos clientes.';
    }
}

function renderClientDatalist() {
    let list = document.getElementById('client-folder-list');

    if (!list) {
        list = document.createElement('datalist');
        list.id = 'client-folder-list';
        document.body.appendChild(list);
    }

    list.replaceChildren(
        ...clientFolders.map((clientFolder) => {
            const option = document.createElement('option');
            option.value = clientFolder.name;
            return option;
        })
    );

    ['f-cliente', 'edit-cliente'].forEach((inputId) => {
        const input = document.getElementById(inputId);

        if (input) {
            input.setAttribute('list', list.id);
        }
    });
}

async function scanClientFolders() {
    clientFolders = [];

    if (!dirHandle) {
        renderClientDatalist();
        updateFolderLabel();
        return;
    }

    try {
        for await (const [name, handle] of dirHandle.entries()) {
            if (handle.kind === 'directory' && !name.startsWith('.')) {
                clientFolders.push({
                    name,
                    handle,
                    key: normalizedFolderKey(name)
                });
            }
        }

        clientFolders.sort((first, second) =>
            first.name.localeCompare(second.name, 'pt-BR')
        );
    } catch (error) {
        console.warn('Não foi possível listar as pastas dos clientes:', error);
    }

    renderClientDatalist();
    updateFolderLabel();
}

async function selectBaseFolder() {
    if (!supportsFSAccess) {
        showToast('Use Google Chrome ou Microsoft Edge.', true);
        return;
    }

    try {
        dirHandle = await window.showDirectoryPicker();

        await idbPut(STORE_META, {
            key: 'dirHandle',
            handle: dirHandle
        });

        await scanClientFolders();

        showToast(
            `Pasta selecionada. ${clientFolders.length} pasta(s) de cliente encontrada(s).`
        );
    } catch (error) {
        console.log('Seleção de pasta cancelada.', error);
    }
}

async function ensurePermission() {
    if (!dirHandle) {
        return false;
    }

    try {
        let permission = await dirHandle.queryPermission({
            mode: 'readwrite'
        });

        if (permission !== 'granted') {
            permission = await dirHandle.requestPermission({
                mode: 'readwrite'
            });
        }

        return permission === 'granted';
    } catch (error) {
        console.error('Erro ao solicitar permissão da pasta:', error);
        return false;
    }
}

async function findExistingClientDirectory(parentHandle, desiredName) {
    const desiredKey = normalizedFolderKey(desiredName);

    for await (const [name, handle] of parentHandle.entries()) {
        if (
            handle.kind === 'directory' &&
            normalizedFolderKey(name) === desiredKey
        ) {
            return {
                name,
                handle
            };
        }
    }

    return null;
}

async function findExistingMonthDirectory(parentHandle, desiredName) {
    const desiredKey = normalizedMonthFolderKey(desiredName);

    for await (const [name, handle] of parentHandle.entries()) {
        if (
            handle.kind === 'directory' &&
            normalizedMonthFolderKey(name) === desiredKey
        ) {
            return {
                name,
                handle
            };
        }
    }

    return null;
}

async function getOrCreateClientDirectory(record) {
    const desiredName = clientFolderNameFor(record);
    const desiredKey = normalizedFolderKey(desiredName);

    let clientDirectory = clientFolders.find(
        (item) => item.key === desiredKey
    );

    if (!clientDirectory) {
        const existingOnDisk = await findExistingClientDirectory(
            dirHandle,
            desiredName
        );

        if (existingOnDisk) {
            clientDirectory = {
                name: existingOnDisk.name,
                handle: existingOnDisk.handle,
                key: normalizedFolderKey(existingOnDisk.name)
            };
        }
    }

    if (clientDirectory) {
        return clientDirectory;
    }

    const handle = await dirHandle.getDirectoryHandle(desiredName, {
        create: true
    });

    const created = {
        name: desiredName,
        handle,
        key: desiredKey
    };

    clientFolders.push(created);
    clientFolders.sort((first, second) =>
        first.name.localeCompare(second.name, 'pt-BR')
    );

    renderClientDatalist();
    updateFolderLabel();

    return created;
}

async function getOrCreateMonthDirectory(clientHandle, desiredMonthName) {
    const existingMonth = await findExistingMonthDirectory(
        clientHandle,
        desiredMonthName
    );

    if (existingMonth) {
        return existingMonth;
    }

    const handle = await clientHandle.getDirectoryHandle(
        desiredMonthName,
        {
            create: true
        }
    );

    return {
        name: desiredMonthName,
        handle
    };
}

/* ============================================================
   SALVAR COMPROVANTE
============================================================ */

async function saveFileToFolder(record, file) {
    const extension = (
        file.name.includes('.')
            ? file.name.split('.').pop()
            : ''
    ).toLowerCase() || 'arquivo';

    const fileName = `${fileBaseNameFor(record)}.${extension}`;
    const clientName = clientFolderNameFor(record);

    let monthName;

    try {
        monthName = monthFolderNameFor(record);
    } catch (error) {
        return {
            ok: false,
            savedAuto: false,
            error: error.message
        };
    }

    if (dirHandle && await ensurePermission()) {
        try {
            // Atualiza a lista caso novas pastas tenham sido criadas fora do sistema.
            await scanClientFolders();

            const clientDirectory = await getOrCreateClientDirectory(record);
            const monthDirectory = await getOrCreateMonthDirectory(
                clientDirectory.handle,
                monthName
            );

            const fileHandle = await monthDirectory.handle.getFileHandle(
                fileName,
                {
                    create: true
                }
            );

            const writable = await fileHandle.createWritable();
            await writable.write(file);
            await writable.close();

            return {
                ok: true,
                savedAuto: true,
                fileName,
                clientFolder: clientDirectory.name,
                monthFolder: monthDirectory.name,
                path: `${dirHandle.name}/${clientDirectory.name}/${monthDirectory.name}/${fileName}`
            };
        } catch (error) {
            console.error('Erro ao salvar o comprovante:', error);

            return {
                ok: false,
                savedAuto: false,
                error: 'Não foi possível criar a pasta ou salvar o comprovante. Selecione novamente a pasta principal e tente outra vez.'
            };
        }
    }

    // Em navegadores sem acesso direto às pastas, baixa o arquivo.
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 4000);

    return {
        ok: true,
        savedAuto: false,
        fileName,
        clientFolder: clientName,
        monthFolder: monthName,
        path: `Downloads/${fileName} (mover para ${clientName}/${monthName})`
    };
}

/* ============================================================
   TRANSPORTADORAS
============================================================ */

async function loadCarriers() {
    carriers = await idbGetAll(STORE_CARRIERS);

    if (carriers.length === 0) {
        for (const name of DEFAULT_CARRIERS) {
            await idbPut(STORE_CARRIERS, {
                name,
                isDefault: true
            });
        }

        carriers = await idbGetAll(STORE_CARRIERS);
    }

    carriers.sort((first, second) =>
        first.name.localeCompare(second.name, 'pt-BR')
    );

    renderCarrierDatalist();
    renderCarriersModalList();
}

function renderCarrierDatalist() {
    const list = document.getElementById('carrier-list');

    if (!list) {
        return;
    }

    list.replaceChildren(
        ...carriers.map((carrier) => {
            const option = document.createElement('option');
            option.value = carrier.name;
            return option;
        })
    );
}

async function ensureCarrierRegistered(name) {
    const cleanName = String(name || '').trim();

    if (!cleanName) {
        return;
    }

    const exists = carriers.some(
        (carrier) =>
            carrier.name.toLocaleLowerCase('pt-BR') ===
            cleanName.toLocaleLowerCase('pt-BR')
    );

    if (exists) {
        return;
    }

    const carrier = {
        name: cleanName,
        isDefault: false
    };

    await idbPut(STORE_CARRIERS, carrier);
    carriers.push(carrier);

    carriers.sort((first, second) =>
        first.name.localeCompare(second.name, 'pt-BR')
    );

    renderCarrierDatalist();
    renderCarriersModalList();
}

async function addCarrierManually(name) {
    const cleanName = String(name || '').trim();

    if (!cleanName) {
        showToast('Digite o nome da transportadora.', true);
        return;
    }

    const exists = carriers.some(
        (carrier) =>
            carrier.name.toLocaleLowerCase('pt-BR') ===
            cleanName.toLocaleLowerCase('pt-BR')
    );

    if (exists) {
        showToast('Essa transportadora já está cadastrada.', true);
        return;
    }

    const carrier = {
        name: cleanName,
        isDefault: false
    };

    await idbPut(STORE_CARRIERS, carrier);
    carriers.push(carrier);

    carriers.sort((first, second) =>
        first.name.localeCompare(second.name, 'pt-BR')
    );

    renderCarrierDatalist();
    renderCarriersModalList();

    showToast(`"${cleanName}" cadastrada.`);
}

async function removeCarrier(name) {
    const inUse = records.some(
        (record) =>
            record.transportadora.toLocaleLowerCase('pt-BR') ===
            name.toLocaleLowerCase('pt-BR')
    );

    if (
        inUse &&
        !confirm(`"${name}" está em uso. Remover mesmo assim da lista?`)
    ) {
        return;
    }

    await idbDelete(STORE_CARRIERS, name);
    carriers = carriers.filter((carrier) => carrier.name !== name);

    renderCarrierDatalist();
    renderCarriersModalList();

    showToast(`"${name}" removida.`);
}

function renderCarriersModalList() {
    const container = document.getElementById('carriers-list-box');

    if (!container) {
        return;
    }

    if (carriers.length === 0) {
        container.innerHTML = '<div style="font-family:var(--mono);font-size:12px;color:var(--muted);">Nenhuma transportadora cadastrada.</div>';
        return;
    }

    container.innerHTML = carriers.map((carrier) => {
        const escapedName = carrier.name
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'");

        const defaultTag = carrier.isDefault
            ? '<span class="default-tag">padrão</span>'
            : '';

        return `
            <div class="carrier-row">
                <span>${escapeHTML(carrier.name)}${defaultTag}</span>
                <button
                    class="icon-btn del"
                    title="Remover"
                    onclick="removeCarrier('${escapedName}')"
                >🗑️</button>
            </div>
        `;
    }).join('');
}

function openCarriersModal() {
    renderCarriersModalList();
    document.getElementById('carriers-modal')?.classList.add('show');
}

function closeCarriersModal() {
    document.getElementById('carriers-modal')?.classList.remove('show');
}

/* ============================================================
   REGISTROS
============================================================ */

async function loadRecords() {
    records = await idbGetAll(STORE_RECORDS);

    records.sort(
        (first, second) =>
            (second.createdAt || 0) -
            (first.createdAt || 0)
    );

    renderAll();
}

function getRegistrationDateValue() {
    const possibleIds = [
        'f-data',
        'f-data-embarque',
        'data-embarque',
        'dataEmbarque'
    ];

    for (const id of possibleIds) {
        const input = document.getElementById(id);

        if (input?.value && parseDataEmbarque(input.value)) {
            return input.value;
        }
    }

    return todayISO();
}

async function addRecord(nfe, cliente, transportadora, dataEmbarque) {
    const record = {
        id: uid(),
        nfe: nfe.trim(),
        cliente: cliente.trim(),
        transportadora: transportadora.trim(),
        dataEmbarque: dataEmbarque || todayISO(),
        status: 'pendente',
        fileBlob: null,
        fileName: null,
        savedAuto: false,
        savedPath: null,
        createdAt: Date.now()
    };

    await idbPut(STORE_RECORDS, record);
    records.unshift(record);

    await ensureCarrierRegistered(record.transportadora);

    renderAll();
    showToast(`Registro ${record.nfe} adicionado. Aguardando comprovante.`);
}

async function deleteRecord(id) {
    const record = records.find((item) => item.id === id);

    if (!record) {
        return;
    }

    if (!confirm(`Excluir a NF-e ${record.nfe} (${record.cliente})?`)) {
        return;
    }

    await idbDelete(STORE_RECORDS, id);
    records = records.filter((item) => item.id !== id);

    renderAll();
    showToast('Registro excluído.');
}

function openEditModal(id) {
    const record = records.find((item) => item.id === id);

    if (!record) {
        return;
    }

    editingId = id;

    const nfeInput = document.getElementById('edit-nfe');
    const clientInput = document.getElementById('edit-cliente');
    const carrierInput = document.getElementById('edit-transportadora');
    const dateInput = document.getElementById('edit-data');

    if (nfeInput) nfeInput.value = record.nfe;
    if (clientInput) clientInput.value = record.cliente;
    if (carrierInput) carrierInput.value = record.transportadora;
    if (dateInput) dateInput.value = record.dataEmbarque;

    document.getElementById('edit-modal')?.classList.add('show');
}

function closeEditModal() {
    editingId = null;
    document.getElementById('edit-modal')?.classList.remove('show');
}

async function saveEdit() {
    const record = records.find((item) => item.id === editingId);

    if (!record) {
        return;
    }

    const nfeValue = document.getElementById('edit-nfe')?.value.trim();
    const clientValue = document.getElementById('edit-cliente')?.value.trim();
    const carrierValue = document.getElementById('edit-transportadora')?.value.trim();
    const dateValue = document.getElementById('edit-data')?.value;

    if (dateValue && !parseDataEmbarque(dateValue)) {
        showToast('Informe uma Data de Embarque válida.', true);
        return;
    }

    record.nfe = nfeValue || record.nfe;
    record.cliente = clientValue || record.cliente;
    record.transportadora = carrierValue || record.transportadora;
    record.dataEmbarque = dateValue || record.dataEmbarque;

    await idbPut(STORE_RECORDS, record);
    await ensureCarrierRegistered(record.transportadora);

    closeEditModal();
    renderAll();

    showToast('Registro atualizado.');

    if (record.fileBlob) {
        showToast(
            'A data ou o cliente pode ter mudado. Anexe novamente o comprovante para salvá-lo na pasta correta.',
            true
        );
    }
}

/* ============================================================
   ANEXAR E VISUALIZAR COMPROVANTE
============================================================ */

function requestUpload(id) {
    pendingUploadId = id;
    document.getElementById('file-input')?.click();
}

async function handleFileSelected(file) {
    if (!pendingUploadId) {
        return;
    }

    const record = records.find((item) => item.id === pendingUploadId);
    pendingUploadId = null;

    if (!record) {
        return;
    }

    const allowedTypes = [
        'image/png',
        'image/jpeg',
        'application/pdf'
    ];

    if (!allowedTypes.includes(file.type)) {
        showToast('Formato inválido. Use JPG, PNG ou PDF.', true);
        return;
    }

    if (!parseDataEmbarque(record.dataEmbarque)) {
        showToast(
            'A Data de Embarque está inválida. Clique em Editar, informe a data e tente novamente.',
            true
        );
        return;
    }

    const result = await saveFileToFolder(record, file);

    if (!result.ok) {
        showToast(
            result.error || 'Não foi possível salvar o comprovante.',
            true
        );
        return;
    }

    record.fileBlob = file;
    record.fileName = result.fileName;
    record.status = 'recebido';
    record.savedAuto = result.savedAuto;
    record.savedPath = result.path;

    await idbPut(STORE_RECORDS, record);
    renderAll();

    if (result.savedAuto) {
        showToast(`Comprovante salvo em: ${result.path}`);
    } else {
        showToast(
            `Arquivo baixado como "${record.fileName}". Mova para ${result.clientFolder}/${result.monthFolder}.`
        );
    }
}

function viewFile(id) {
    const record = records.find((item) => item.id === id);

    if (!record?.fileBlob) {
        return;
    }

    const url = URL.createObjectURL(record.fileBlob);
    window.open(url, '_blank');

    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ============================================================
   FILTROS E TABELA
============================================================ */

function matchesFilter(record) {
    if (
        currentFilter !== 'todos' &&
        record.status !== currentFilter
    ) {
        return false;
    }

    if (currentSearch) {
        const search = currentSearch.toLocaleLowerCase('pt-BR');

        return (
            record.nfe.toLocaleLowerCase('pt-BR').includes(search) ||
            record.cliente.toLocaleLowerCase('pt-BR').includes(search) ||
            record.transportadora.toLocaleLowerCase('pt-BR').includes(search)
        );
    }

    return true;
}

function renderAll() {
    renderStats();
    renderTable();
}

function renderStats() {
    const total = records.length;
    const pending = records.filter(
        (record) => record.status === 'pendente'
    ).length;
    const received = records.filter(
        (record) => record.status === 'recebido'
    ).length;

    const totalElement = document.getElementById('stat-total');
    const pendingElement = document.getElementById('stat-pendente');
    const receivedElement = document.getElementById('stat-recebido');

    if (totalElement) totalElement.textContent = total;
    if (pendingElement) pendingElement.textContent = pending;
    if (receivedElement) receivedElement.textContent = received;
}

function renderTable() {
    const tableBody = document.getElementById('table-body');

    if (!tableBody) {
        return;
    }

    const filteredRecords = records.filter(matchesFilter);

    if (filteredRecords.length === 0) {
        tableBody.innerHTML = '<tr class="empty-row"><td colspan="7">Nenhum registro encontrado.</td></tr>';
        return;
    }

    tableBody.innerHTML = filteredRecords.map((record) => {
        const received = record.status === 'recebido';

        const receiptCell = received
            ? `
                <div class="comp-cell">
                    <button class="comp-link" onclick="viewFile('${record.id}')">👁️ Ver</button>
                    <button class="comp-link" onclick="requestUpload('${record.id}')">🔁 Trocar</button>
                </div>
                <div class="saved-tag">
                    ${record.savedAuto ? '📁 salvo automaticamente' : '⬇️ baixado manualmente'}
                </div>
            `
            : `
                <button class="btn btn-green btn-small" onclick="requestUpload('${record.id}')">
                    📎 Anexar Comprovante
                </button>
            `;

        const badge = received
            ? '<span class="badge recebido"><span class="dot"></span>Recebido</span>'
            : '<span class="badge pendente"><span class="dot"></span>Pendente</span>';

        return `
            <tr>
                <td class="data" data-label="Data de Embarque">${formatDateBR(record.dataEmbarque)}</td>
                <td class="nfe" data-label="NF-e">${escapeHTML(record.nfe)}</td>
                <td data-label="Cliente">${escapeHTML(record.cliente)}</td>
                <td data-label="Transportadora">${escapeHTML(record.transportadora)}</td>
                <td data-label="Comprovante">${receiptCell}</td>
                <td data-label="Status">${badge}</td>
                <td data-label="Ações">
                    <div class="actions-cell">
                        <button class="icon-btn edit" title="Editar" onclick="openEditModal('${record.id}')">✏️</button>
                        <button class="icon-btn del" title="Excluir" onclick="deleteRecord('${record.id}')">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/* ============================================================
   EVENTOS
============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
    try {
        db = await openDB();
        await initFolderUI();
        await loadCarriers();
        await loadRecords();

        document.getElementById('select-folder-btn')?.addEventListener(
            'click',
            selectBaseFolder
        );

        document.getElementById('manage-carriers-btn')?.addEventListener(
            'click',
            openCarriersModal
        );

        document.getElementById('carriers-close')?.addEventListener(
            'click',
            closeCarriersModal
        );

        document.getElementById('carriers-modal')?.addEventListener(
            'click',
            (event) => {
                if (event.target.id === 'carriers-modal') {
                    closeCarriersModal();
                }
            }
        );

        document.getElementById('add-carrier-btn')?.addEventListener(
            'click',
            async () => {
                const input = document.getElementById('new-carrier-input');

                if (!input) {
                    return;
                }

                await addCarrierManually(input.value);
                input.value = '';
                input.focus();
            }
        );

        document.getElementById('new-carrier-input')?.addEventListener(
            'keydown',
            (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    document.getElementById('add-carrier-btn')?.click();
                }
            }
        );

        document.getElementById('reg-form')?.addEventListener(
            'submit',
            async (event) => {
                event.preventDefault();

                const nfeInput = document.getElementById('f-nfe');
                const clientInput = document.getElementById('f-cliente');
                const carrierInput = document.getElementById('f-transportadora');

                if (!nfeInput || !clientInput || !carrierInput) {
                    showToast('Campos do cadastro não encontrados.', true);
                    return;
                }

                const nfe = nfeInput.value.trim();
                const client = clientInput.value.trim();
                const carrier = carrierInput.value.trim();
                const shippingDate = getRegistrationDateValue();

                if (!nfe || !client || !carrier) {
                    showToast('Preencha NF-e, Cliente e Transportadora.', true);
                    return;
                }

                await addRecord(
                    nfe,
                    client,
                    carrier,
                    shippingDate
                );

                event.target.reset();
                nfeInput.focus();
            }
        );

        document.getElementById('file-input')?.addEventListener(
            'change',
            async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';

                if (file) {
                    await handleFileSelected(file);
                }
            }
        );

        document.getElementById('search-input')?.addEventListener(
            'input',
            (event) => {
                currentSearch = event.target.value.trim();
                renderTable();
            }
        );

        document.querySelectorAll('.filter-chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('.filter-chip').forEach(
                    (otherChip) => otherChip.classList.remove('active')
                );

                chip.classList.add('active');
                currentFilter = chip.dataset.filter;
                renderTable();
            });
        });

        document.getElementById('edit-cancel')?.addEventListener(
            'click',
            closeEditModal
        );

        document.getElementById('edit-save')?.addEventListener(
            'click',
            saveEdit
        );

        document.getElementById('edit-modal')?.addEventListener(
            'click',
            (event) => {
                if (event.target.id === 'edit-modal') {
                    closeEditModal();
                }
            }
        );
    } catch (error) {
        console.error('Erro ao iniciar o sistema:', error);
        showToast('Erro ao iniciar o sistema. Consulte o console.', true);
    }
});

/* ============================================================
   FUNÇÕES UTILIZADAS PELO HTML
============================================================ */

window.requestUpload = requestUpload;
window.viewFile = viewFile;
window.openEditModal = openEditModal;
window.deleteRecord = deleteRecord;
window.removeCarrier = removeCarrier;