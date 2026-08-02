/* ============================================================
   palletoptimizer — Controle de Comprovantes
   Persistência local via IndexedDB (registros + arquivos).
   Salvamento automático em pasta via File System Access API
   (Chrome/Edge). Em navegadores sem suporte, cai para download
   manual já com o nome correto de arquivo/pasta.
============================================================ */

const DB_NAME = 'palletComprovantesDB';
const DB_VERSION = 2;
const STORE_RECORDS = 'records';
const STORE_META = 'meta';
const STORE_CARRIERS = 'carriers';

const DEFAULT_CARRIERS = [
    'SUA TRANSPORTADORA',
    'SUA TRANSPORTADORA',
    'SUA TRANSPORTADORA',
    'SUA TRANSPORTADORA'
];

let db = null;
let dirHandle = null; // pasta base selecionada (File System Access API)
let records = [];     // cache em memória: {id, nfe, cliente, transportadora, dataEmbarque, status, fileBlob, fileName, savedAuto}
let carriers = [];    // cache em memória: {name, isDefault}
let currentFilter = 'todos';
let currentSearch = '';
let editingId = null;
let pendingUploadId = null;

const supportsFSAccess = 'showDirectoryPicker' in window;

/* ---------------- IndexedDB helpers ---------------- */

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const database = req.result;
            if (!database.objectStoreNames.contains(STORE_RECORDS)) {
                database.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains(STORE_META)) {
                database.createObjectStore(STORE_META, { keyPath: 'key' });
            }
            if (!database.objectStoreNames.contains(STORE_CARRIERS)) {
                const store = database.createObjectStore(STORE_CARRIERS, { keyPath: 'name' });
                store.transaction.oncomplete = async () => {
                    // seed com a lista padrão na primeira criação
                    const tx = database.transaction(STORE_CARRIERS, 'readwrite');
                    const s = tx.objectStore(STORE_CARRIERS);
                    DEFAULT_CARRIERS.forEach(name => s.put({ name, isDefault: true }));
                };
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function txStore(storeName, mode) {
    return db.transaction(storeName, mode).objectStore(storeName);
}

function idbGetAll(storeName) {
    return new Promise((resolve, reject) => {
        const req = txStore(storeName, 'readonly').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

function idbPut(storeName, value) {
    return new Promise((resolve, reject) => {
        const req = txStore(storeName, 'readwrite').put(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

function idbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
        const req = txStore(storeName, 'readwrite').delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

function idbGet(storeName, key) {
    return new Promise((resolve, reject) => {
        const req = txStore(storeName, 'readonly').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/* ---------------- Utilidades ---------------- */

function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10); // yyyy-mm-dd
}

function formatDateBR(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function sanitizeName(str) {
    return String(str || '')
        .trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

function folderNameFor(rec) {
    return `${sanitizeName(rec.cliente)}-${sanitizeName(rec.nfe)}`;
}

function uid() {
    return 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

let toastTimeout = null;
function showToast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ---------------- Pasta base (File System Access API) ---------------- */

async function initFolderUI() {
    const dot = document.getElementById('folder-dot');
    const label = document.getElementById('folder-label');
    const btn = document.getElementById('select-folder-btn');

    if (!supportsFSAccess) {
        btn.style.display = 'none';
        dot.classList.remove('ok');
        label.innerHTML = '<strong>Salvamento automático indisponível neste navegador.</strong> Use Chrome ou Edge para salvar direto na pasta — por enquanto os comprovantes serão baixados já com o nome correto.';
        return;
    }

    try {
        const meta = await idbGet(STORE_META, 'dirHandle');
        if (meta && meta.handle) {
            const granted = await meta.handle.queryPermission({ mode: 'readwrite' });
            if (granted === 'granted') {
                dirHandle = meta.handle;
            } else {
                dirHandle = meta.handle; // ainda guardamos, mas pediremos permissão no uso
            }
        }
    } catch (e) {
        dirHandle = null;
    }

    updateFolderLabel();
}

function updateFolderLabel() {
    const dot = document.getElementById('folder-dot');
    const label = document.getElementById('folder-label');
    if (dirHandle) {
        dot.classList.add('ok');
        label.innerHTML = `Pasta base: <strong>${dirHandle.name}</strong> — os comprovantes serão salvos automaticamente em subpastas "cliente-NFe".`;
    } else {
        dot.classList.remove('ok');
        label.innerHTML = '<strong>Nenhuma pasta base selecionada.</strong> Selecione uma pasta para salvar os comprovantes automaticamente.';
    }
}

async function selectBaseFolder() {
    if (!supportsFSAccess) return;
    try {
        const handle = await window.showDirectoryPicker();
        dirHandle = handle;
        await idbPut(STORE_META, { key: 'dirHandle', handle });
        updateFolderLabel();
        showToast('Pasta base selecionada com sucesso.');
    } catch (e) {
        // usuário cancelou o seletor — não é erro
    }
}

async function ensurePermission() {
    if (!dirHandle) return false;
    try {
        let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
            perm = await dirHandle.requestPermission({ mode: 'readwrite' });
        }
        return perm === 'granted';
    } catch (e) {
        return false;
    }
}

/* Salva o arquivo dentro de uma subpasta "cliente-NFe" na pasta base.
   Retorna { ok, savedAuto, path } */
async function saveFileToFolder(rec, file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const folder = folderNameFor(rec);
    const fileName = `${folder}.${ext}`;

    if (dirHandle && (await ensurePermission())) {
        try {
            const subDir = await dirHandle.getDirectoryHandle(folder, { create: true });
            const fileHandle = await subDir.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(file);
            await writable.close();
            return { ok: true, savedAuto: true, path: `${dirHandle.name}/${folder}/${fileName}` };
        } catch (e) {
            console.error(e);
            // cai para download manual
        }
    }

    // fallback: baixa o arquivo já com o nome correto
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { ok: true, savedAuto: false, path: `Downloads/${fileName} (mover para pasta "${folder}")` };
}

/* ---------------- Transportadoras ---------------- */

async function loadCarriers() {
    carriers = await idbGetAll(STORE_CARRIERS);
    if (carriers.length === 0) {
        // fallback caso o seed do upgrade não tenha rodado (ex: DB já existia sem a store)
        for (const name of DEFAULT_CARRIERS) {
            await idbPut(STORE_CARRIERS, { name, isDefault: true });
        }
        carriers = await idbGetAll(STORE_CARRIERS);
    }
    carriers.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    renderCarrierDatalist();
    renderCarriersModalList();
}

function renderCarrierDatalist() {
    const list = document.getElementById('carrier-list');
    list.innerHTML = carriers.map(c => `<option value="${c.name.replace(/"/g, '&quot;')}"></option>`).join('');
}

/* garante que uma transportadora digitada fique cadastrada para uso futuro */
async function ensureCarrierRegistered(name) {
    const clean = name.trim();
    if (!clean) return;
    const exists = carriers.some(c => c.name.toLowerCase() === clean.toLowerCase());
    if (!exists) {
        await idbPut(STORE_CARRIERS, { name: clean, isDefault: false });
        carriers.push({ name: clean, isDefault: false });
        carriers.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        renderCarrierDatalist();
        renderCarriersModalList();
    }
}

async function addCarrierManually(name) {
    const clean = name.trim();
    if (!clean) return;
    const exists = carriers.some(c => c.name.toLowerCase() === clean.toLowerCase());
    if (exists) {
        showToast('Essa transportadora já está cadastrada.', true);
        return;
    }
    await idbPut(STORE_CARRIERS, { name: clean, isDefault: false });
    carriers.push({ name: clean, isDefault: false });
    carriers.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    renderCarrierDatalist();
    renderCarriersModalList();
    showToast(`"${clean}" cadastrada.`);
}

async function removeCarrier(name) {
    const inUse = records.some(r => r.transportadora.toLowerCase() === name.toLowerCase());
    if (inUse && !confirm(`"${name}" está em uso em registros existentes. Remover mesmo assim da lista de sugestões?`)) return;
    await idbDelete(STORE_CARRIERS, name);
    carriers = carriers.filter(c => c.name !== name);
    renderCarrierDatalist();
    renderCarriersModalList();
    showToast(`"${name}" removida da lista.`);
}

function renderCarriersModalList() {
    const box = document.getElementById('carriers-list-box');
    if (!box) return;
    if (carriers.length === 0) {
        box.innerHTML = `<div style="font-family:var(--mono);font-size:12px;color:var(--muted);">Nenhuma transportadora cadastrada.</div>`;
        return;
    }
    box.innerHTML = carriers.map(c => `
        <div class="carrier-row">
            <span>${c.name}${c.isDefault ? '<span class="default-tag">padrão</span>' : ''}</span>
            <button class="icon-btn del" title="Remover" onclick="removeCarrier('${c.name.replace(/'/g, "\\'")}')">🗑️</button>
        </div>
    `).join('');
}

function openCarriersModal() {
    renderCarriersModalList();
    document.getElementById('carriers-modal').classList.add('show');
}

function closeCarriersModal() {
    document.getElementById('carriers-modal').classList.remove('show');
}

/* ---------------- Registros ---------------- */

async function loadRecords() {
    records = await idbGetAll(STORE_RECORDS);
    records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderAll();
}

async function addRecord(nfe, cliente, transportadora) {
    const rec = {
        id: uid(),
        nfe: nfe.trim(),
        cliente: cliente.trim(),
        transportadora: transportadora.trim(),
        dataEmbarque: todayISO(),
        status: 'pendente',
        fileBlob: null,
        fileName: null,
        savedAuto: false,
        savedPath: null,
        createdAt: Date.now()
    };
    await idbPut(STORE_RECORDS, rec);
    records.unshift(rec);
    await ensureCarrierRegistered(rec.transportadora);
    renderAll();
    showToast(`Registro ${rec.nfe} adicionado. Aguardando comprovante.`);
}

async function deleteRecord(id) {
    const rec = records.find(r => r.id === id);
    if (!rec) return;
    if (!confirm(`Excluir o registro da NF-e ${rec.nfe} (${rec.cliente})?`)) return;
    await idbDelete(STORE_RECORDS, id);
    records = records.filter(r => r.id !== id);
    renderAll();
    showToast('Registro excluído.');
}

function openEditModal(id) {
    const rec = records.find(r => r.id === id);
    if (!rec) return;
    editingId = id;
    document.getElementById('edit-nfe').value = rec.nfe;
    document.getElementById('edit-cliente').value = rec.cliente;
    document.getElementById('edit-transportadora').value = rec.transportadora;
    document.getElementById('edit-data').value = rec.dataEmbarque;
    document.getElementById('edit-modal').classList.add('show');
}

function closeEditModal() {
    editingId = null;
    document.getElementById('edit-modal').classList.remove('show');
}

async function saveEdit() {
    const rec = records.find(r => r.id === editingId);
    if (!rec) return;
    rec.nfe = document.getElementById('edit-nfe').value.trim() || rec.nfe;
    rec.cliente = document.getElementById('edit-cliente').value.trim() || rec.cliente;
    rec.transportadora = document.getElementById('edit-transportadora').value.trim() || rec.transportadora;
    rec.dataEmbarque = document.getElementById('edit-data').value || rec.dataEmbarque;
    await idbPut(STORE_RECORDS, rec);
    await ensureCarrierRegistered(rec.transportadora);
    closeEditModal();
    renderAll();
    showToast('Registro atualizado.');
    if (rec.fileBlob) {
        showToast('Atenção: nome da pasta/arquivo pode ter mudado. Reenvie o comprovante para salvar no local correto.', true);
    }
}

function requestUpload(id) {
    pendingUploadId = id;
    document.getElementById('file-input').click();
}

async function handleFileSelected(file) {
    if (!pendingUploadId) return;
    const rec = records.find(r => r.id === pendingUploadId);
    pendingUploadId = null;
    if (!rec) return;

    const allowed = ['image/png', 'image/jpeg', 'application/pdf'];
    if (!allowed.includes(file.type)) {
        showToast('Formato inválido. Use JPG, PNG ou PDF.', true);
        return;
    }

    const result = await saveFileToFolder(rec, file);

    rec.fileBlob = file;
    rec.fileName = `${folderNameFor(rec)}.${(file.name.split('.').pop() || '').toLowerCase()}`;
    rec.status = 'recebido';
    rec.savedAuto = result.savedAuto;
    rec.savedPath = result.path;

    await idbPut(STORE_RECORDS, rec);
    renderAll();

    if (result.savedAuto) {
        showToast(`Comprovante salvo automaticamente em: ${result.path}`);
    } else {
        showToast(`Comprovante baixado como "${rec.fileName}". Mova para a pasta "${folderNameFor(rec)}".`);
    }
}

function viewFile(id) {
    const rec = records.find(r => r.id === id);
    if (!rec || !rec.fileBlob) return;
    const url = URL.createObjectURL(rec.fileBlob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------------- Render ---------------- */

function matchesFilter(rec) {
    if (currentFilter !== 'todos' && rec.status !== currentFilter) return false;
    if (currentSearch) {
        const s = currentSearch.toLowerCase();
        return rec.nfe.toLowerCase().includes(s) ||
               rec.cliente.toLowerCase().includes(s) ||
               rec.transportadora.toLowerCase().includes(s);
    }
    return true;
}

function renderAll() {
    renderStats();
    renderTable();
}

function renderStats() {
    const total = records.length;
    const pendentes = records.filter(r => r.status === 'pendente').length;
    const recebidos = records.filter(r => r.status === 'recebido').length;
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pendente').textContent = pendentes;
    document.getElementById('stat-recebido').textContent = recebidos;
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    const filtered = records.filter(matchesFilter);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Nenhum registro encontrado.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(rec => {
        const isRecebido = rec.status === 'recebido';
        const compCell = isRecebido
            ? `<div class="comp-cell">
                   <button class="comp-link" onclick="viewFile('${rec.id}')">👁️ Ver</button>
                   <button class="comp-link" onclick="requestUpload('${rec.id}')">🔁 Trocar</button>
               </div>
               <div class="saved-tag">${rec.savedAuto ? '📁 salvo automaticamente' : '⬇️ baixado manualmente'}</div>`
            : `<button class="btn btn-green btn-small" onclick="requestUpload('${rec.id}')">📎 Anexar Comprovante</button>`;

        const badge = isRecebido
            ? `<span class="badge recebido"><span class="dot"></span>Recebido</span>`
            : `<span class="badge pendente"><span class="dot"></span>Pendente</span>`;

        return `
            <tr>
                <td class="data" data-label="Data de Embarque">${formatDateBR(rec.dataEmbarque)}</td>
                <td class="nfe" data-label="NF-e">${rec.nfe}</td>
                <td data-label="Cliente">${rec.cliente}</td>
                <td data-label="Transportadora">${rec.transportadora}</td>
                <td data-label="Comprovante">${compCell}</td>
                <td data-label="Status">${badge}</td>
                <td data-label="Ações">
                    <div class="actions-cell">
                        <button class="icon-btn edit" title="Editar" onclick="openEditModal('${rec.id}')">✏️</button>
                        <button class="icon-btn del" title="Excluir" onclick="deleteRecord('${rec.id}')">🗑️</button>
                    </div>
                </td>
            </tr>`;
    }).join('');
}

/* ---------------- Eventos ---------------- */

document.addEventListener('DOMContentLoaded', async () => {
    db = await openDB();
    await initFolderUI();
    await loadCarriers();
    await loadRecords();

    document.getElementById('select-folder-btn').addEventListener('click', selectBaseFolder);

    document.getElementById('manage-carriers-btn').addEventListener('click', openCarriersModal);
    document.getElementById('carriers-close').addEventListener('click', closeCarriersModal);
    document.getElementById('carriers-modal').addEventListener('click', (e) => {
        if (e.target.id === 'carriers-modal') closeCarriersModal();
    });
    document.getElementById('add-carrier-btn').addEventListener('click', async () => {
        const input = document.getElementById('new-carrier-input');
        await addCarrierManually(input.value);
        input.value = '';
        input.focus();
    });
    document.getElementById('new-carrier-input').addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('add-carrier-btn').click();
        }
    });

    document.getElementById('reg-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nfe = document.getElementById('f-nfe').value;
        const cliente = document.getElementById('f-cliente').value;
        const transportadora = document.getElementById('f-transportadora').value;
        if (!nfe.trim() || !cliente.trim() || !transportadora.trim()) {
            showToast('Preencha NF-e, Cliente e Transportadora.', true);
            return;
        }
        await addRecord(nfe, cliente, transportadora);
        e.target.reset();
        document.getElementById('f-nfe').focus();
    });

    document.getElementById('file-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (file) await handleFileSelected(file);
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
        currentSearch = e.target.value.trim();
        renderTable();
    });

    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilter = chip.dataset.filter;
            renderTable();
        });
    });

    document.getElementById('edit-cancel').addEventListener('click', closeEditModal);
    document.getElementById('edit-save').addEventListener('click', saveEdit);
    document.getElementById('edit-modal').addEventListener('click', (e) => {
        if (e.target.id === 'edit-modal') closeEditModal();
    });
});

// expõe funções usadas via onclick inline
window.requestUpload = requestUpload;
window.viewFile = viewFile;
window.openEditModal = openEditModal;
window.deleteRecord = deleteRecord;
window.removeCarrier = removeCarrier;