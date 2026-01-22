import { getSession, logout } from './auth.js';
import { getInventory, createLocation, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null; 
let cart = []; 
let currentLogs = [];
let selectedDestinationId = null; 
let currentActionId = null; 
let activePosLocationId = null; 

// --- 🧠 CURRENCY INTELLIGENCE (SMART MATH) ---
let baseCurrency = 'USD'; 
let currencyRates = {};   
let selectedCurrency = 'USD'; 

// Hii list inasaidia mfumo kujua "Mkubwa Nani". 
// Kubwa kwenda Ndogo = ZIDISHA. Ndogo kwenda Kubwa = GAWANYA.
const STRONG_CURRENCIES = ['USD', 'EUR', 'GBP'];

window.closeModalOutside = (e) => { if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none'; };

// --- NOTIFICATIONS ---
window.showNotification = (message, type = 'success') => {
    const existing = document.getElementById('notif-toast');
    if(existing) existing.remove();
    const div = document.createElement('div');
    div.id = 'notif-toast';
    div.className = `fixed top-5 right-5 px-6 py-4 rounded-xl text-white font-bold shadow-2xl z-[10000] flex items-center gap-3 transition-all duration-300 transform translate-y-0`;
    div.style.backgroundColor = type === 'success' ? '#0f172a' : '#ef4444'; 
    div.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 3000);
};

// --- CONFIRMATION DIALOG HELPER ---
window.showConfirm = (title, desc, callback) => {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-desc').innerText = desc;
    document.getElementById('confirm-modal').style.display = 'flex';
    
    const btn = document.getElementById('confirm-btn');
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    newBtn.addEventListener('click', async () => {
        document.getElementById('confirm-modal').style.display = 'none';
        await callback();
    });
};

// --- 💰 CURRENCY ENGINE (DATABASE DRIVEN) ---
window.initCurrency = async () => {
    if (!profile) return;

    try {
        // 1. Vuta Base Currency
        const { data: org } = await supabase.from('organizations').select('base_currency').eq('id', profile.organization_id).single();
        if (org) {
            baseCurrency = org.base_currency;
            selectedCurrency = baseCurrency; 
        }

        // 2. Vuta Manual Rates
        const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', profile.organization_id);
        
        currencyRates = {};
        if (rates && rates.length > 0) {
            rates.forEach(r => currencyRates[r.currency_code] = r.rate);
        }
        currencyRates[baseCurrency] = 1;

        console.log(`Base: ${baseCurrency}`, currencyRates);
    } catch (e) {
        console.error("Currency Init Error:", e);
    }
};

// --- 🧮 THE SMART CONVERTER (HII NDIO MOYO WA HESABU) ---
window.convertAmount = (amount, fromCurr, toCurr) => {
    if (fromCurr === toCurr) return amount;

    // Tafuta rate ya foreign currency husika
    const foreignCurr = STRONG_CURRENCIES.includes(fromCurr) ? fromCurr : toCurr;
    const rate = currencyRates[foreignCurr];

    if (!rate) return null; // Rate haipo

    // SCENARIO 1: Strong (USD) -> Weak (TZS) ... ZIDISHA
    // Mfano: 1 USD * 2600 = 2600 TZS
    if (STRONG_CURRENCIES.includes(fromCurr) && !STRONG_CURRENCIES.includes(toCurr)) {
        return amount * rate;
    }

    // SCENARIO 2: Weak (TZS) -> Strong (USD) ... GAWANYA
    // Mfano: 2600 TZS / 2600 = 1 USD
    if (!STRONG_CURRENCIES.includes(fromCurr) && STRONG_CURRENCIES.includes(toCurr)) {
        return amount / rate;
    }

    // SCENARIO 3: Sawa kwa Sawa (Weak to Weak au Strong to Strong)
    // Hapa tunarudisha amount (Kwa sasa hatuna Cross-Rates complex, ili kuisimplefy)
    return amount; 
};

window.formatPrice = (amount) => {
    if (!amount && amount !== 0) return '-';
    
    // Amount hapa SIKU ZOTE ni Base Currency
    const converted = window.convertAmount(amount, baseCurrency, selectedCurrency);
    
    if (converted === null) return 'Set Rate!';

    // Format: Strong currencies (USD) decimals 2, Weak (TZS) decimals 0
    const decimals = STRONG_CURRENCIES.includes(selectedCurrency) ? 2 : 0;
    return `${selectedCurrency} ${Number(converted).toLocaleString(undefined, {minimumFractionDigits: decimals, maximumFractionDigits: decimals})}`;
};

window.changeCurrency = (curr) => {
    selectedCurrency = curr;
    const activeNav = document.querySelector('.nav-item.nav-active');
    if (activeNav) {
        const viewId = activeNav.id.replace('nav-', '');
        router(viewId);
    }
};

window.getCurrencySelectorHTML = () => {
    const commonCurrencies = ['TZS', 'USD', 'EUR', 'KES', 'GBP'];
    if(!commonCurrencies.includes(baseCurrency)) commonCurrencies.unshift(baseCurrency);

    const options = commonCurrencies.map(c => 
        `<option value="${c}" ${selectedCurrency === c ? 'selected' : ''}>${c}</option>`
    ).join('');

    return `
    <select onchange="window.changeCurrency(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer ml-4">
        ${options}
    </select>`;
};

// --- INITIALIZATION ---
window.onload = async () => {
    const style = document.createElement('style');
    style.innerHTML = `#modal, #modal-content, #name-modal { overflow: visible !important; }`;
    document.head.appendChild(style);

    const mobileBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    if(mobileBtn && sidebar) {
        mobileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.remove('-translate-x-full');
        });
    }

    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        
        let { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (!prof) {
            await new Promise(r => setTimeout(r, 1000));
            let retry = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
            prof = retry.data;
        }

        profile = prof;
        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }

        await window.initCurrency();

        const forbiddenNames = ['Manager', 'Storekeeper', 'Barman', 'Finance', 'User', 'Admin', 'Staff'];
        const currentName = profile.full_name ? profile.full_name.trim() : "";
        
        if (currentName.length < 3 || forbiddenNames.some(n => currentName.toLowerCase().includes(n.toLowerCase()))) {
            document.getElementById('name-modal').style.display = 'flex';
        } else {
            const userNameDisplay = document.querySelector('.font-bold.text-slate-700'); 
            if(userNameDisplay) userNameDisplay.innerText = profile.full_name;
        }
        
        window.logoutAction = logout;
        applyStrictPermissions(profile.role);
        router(profile.role === 'barman' ? 'bar' : 'inventory');
        
    } catch (e) { console.error(e); }
};

window.saveName = async () => {
    const nameInput = document.getElementById('userNameInput').value;
    if (!nameInput || nameInput.length < 3) return window.showNotification("Invalid name", "error");
    const { error } = await supabase.from('profiles').update({ full_name: nameInput }).eq('id', profile.id);
    if (!error) {
        profile.full_name = nameInput;
        document.getElementById('name-modal').style.display = 'none';
        window.showNotification("Welcome " + nameInput, "success");
    }
};

function applyStrictPermissions(role) {
    const hide = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
    const show = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'flex'; });
    show(['nav-inventory', 'nav-bar', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);
    if (role === 'finance') hide(['nav-bar', 'nav-settings', 'nav-staff']); 
    else if (role === 'storekeeper') hide(['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings']);
    else if (role === 'barman') hide(['nav-inventory', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);
}

window.router = async (view) => {
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth < 768 && sidebar) sidebar.classList.add('-translate-x-full');

    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div></div>';
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    document.getElementById(`nav-${view}`)?.classList.add('nav-active');
    
    try {
        if (view === 'inventory') await renderInventory(app);
        else if (view === 'bar') await renderBar(app); 
        else if (view === 'approvals') await renderApprovals(app);
        else if (view === 'reports') await renderReports(app);
        else if (view === 'staff') await renderStaff(app);
        else if (view === 'settings') await renderSettings(app);
    } catch (err) { 
        console.error(err);
        app.innerHTML = `<div class="p-10 text-center"><p class="text-red-500 font-bold">Error loading view: ${err.message}</p></div>`;
    }
};

// --- POS / BAR MODULE ---
async function renderBar(c) {
    try {
        const inv = await getInventory(profile.organization_id);
        const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).eq('type', 'department');

        if (profile.role === 'barman') {
            activePosLocationId = profile.assigned_location_id;
        } else {
            if (!activePosLocationId && locs.length > 0) activePosLocationId = locs[0].id;
        }

        const storeSelector = (profile.role === 'manager' || profile.role === 'finance') ? `
            <div class="mb-6 bg-white p-4 rounded-xl border flex items-center gap-4 shadow-sm">
                <span class="text-xs font-bold text-slate-400 uppercase">Select Counter:</span>
                <select onchange="window.switchBar(this.value)" class="bg-transparent font-bold outline-none cursor-pointer text-sm">
                    <option value="">-- Choose --</option>
                    ${locs.map(l => `<option value="${l.id}" ${activePosLocationId === l.id ? 'selected' : ''}>${l.name}</option>`).join('')}
                </select>
            </div>` : '';

        const items = inv.filter(x => x.location_id === activePosLocationId);

        c.innerHTML = `
            ${storeSelector}
            <div class="flex flex-col lg:flex-row gap-8 h-[calc(100vh-140px)]">
                <div class="flex-1 overflow-y-auto pr-2">
                    <div class="flex justify-between items-center mb-6 sticky top-0 bg-slate-100 py-2 z-10">
                        <h1 class="text-2xl font-bold uppercase text-slate-900">POS Terminal</h1>
                        ${window.getCurrencySelectorHTML()} 
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4 pb-10">
                        ${items.length ? items.map(x => `
                            <div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" 
                                 class="bg-white p-5 border rounded-2xl cursor-pointer hover:border-slate-900 transition shadow-sm group relative overflow-hidden">
                                <div class="absolute top-0 right-0 bg-slate-100 px-2 py-1 rounded-bl-lg text-[10px] font-bold text-slate-500">Qty: ${x.quantity}</div>
                                <p class="text-[10px] font-bold text-slate-400 uppercase mb-1 tracking-wider">${x.products.name}</p>
                                <p class="font-bold text-xl text-slate-900">${window.formatPrice(x.products.selling_price)}</p>
                            </div>`).join('') : 
                            '<div class="col-span-3 text-center py-12 border-2 border-dashed border-slate-300 rounded-2xl"><p class="text-slate-400 font-bold text-xs uppercase">No stock found here.</p></div>'}
                    </div>
                </div>

                <div class="w-full lg:w-96 bg-white border border-slate-200 rounded-2xl p-6 h-full flex flex-col shadow-xl">
                    <div class="flex justify-between items-center mb-6">
                        <h3 class="font-bold text-xs uppercase text-slate-400 tracking-widest">Current Order</h3>
                        <button onclick="cart=[];window.renderCart()" class="text-[10px] text-red-500 font-bold hover:underline">CLEAR</button>
                    </div>
                    <div id="cart-list" class="flex-1 overflow-y-auto space-y-3 mb-4 pr-1"></div>
                    <div class="border-t border-slate-100 pt-6 mt-auto">
                        <div class="flex justify-between font-bold text-2xl mb-6 text-slate-900">
                            <span>Total</span>
                            <span id="cart-total">${window.formatPrice(0)}</span>
                        </div>
                        <button onclick="window.checkout()" class="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-slate-800 shadow-lg transform active:scale-95 transition">
                            Complete Sale
                        </button>
                    </div>
                </div>
            </div>`;
        window.renderCart();
    } catch (e) {
        console.error("POS Error:", e);
        c.innerHTML = `<div class="p-10 text-center bg-red-50 border border-red-200 rounded-2xl"><h2 class="text-red-600 font-bold text-lg mb-2">ERROR</h2><p class="text-xs text-slate-600 font-mono">${e.message}</p></div>`;
    }
}

// --- INVENTORY MODULE ---
async function renderInventory(c) {
    const { data: catalog } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const stock = await getInventory(profile.organization_id);
    const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? stock : stock.filter(x => x.location_id === profile.assigned_location_id);
    const showAdmin = profile.role === 'manager';
    const showPrice = profile.role === 'manager' || profile.role === 'finance';

    const stockRows = filteredStock.map(i => `
        <tr class="transition hover:bg-slate-50 border-b border-slate-100 last:border-0 group">
            <td class="font-bold text-gray-800 uppercase py-3 pl-4">${i.products?.name}</td>
            ${showPrice ? `<td class="font-mono text-xs text-slate-500">${window.formatPrice(i.products.cost_price)}</td><td class="font-mono text-xs text-slate-900 font-bold">${window.formatPrice(i.products.selling_price)}</td>` : ''}
            <td class="text-xs font-bold text-gray-500 uppercase tracking-widest">${i.locations?.name}</td>
            <td class="font-mono font-bold text-gray-900 text-lg">${i.quantity}</td>
            <td class="text-right pr-4 flex justify-end gap-2 items-center py-3">
                ${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-white border border-slate-300 text-slate-700 px-3 py-1 rounded hover:bg-slate-100 transition shadow-sm uppercase">MOVE</button>` : ''}
                ${showAdmin ? `
                    <button onclick="window.openEditProduct('${i.products.id}', '${i.products.name}', ${i.products.cost_price}, ${i.products.selling_price})" class="text-slate-400 hover:text-blue-600"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
                    <button onclick="window.deleteProduct('${i.products.id}')" class="text-slate-400 hover:text-red-600"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                ` : ''}
            </td>
        </tr>`).join('');

    c.innerHTML = `
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div class="flex items-center">
                <h1 class="text-3xl font-bold uppercase text-slate-900">Inventory</h1>
                ${showPrice ? window.getCurrencySelectorHTML() : ''}
            </div>
            <div class="flex gap-3">${showAdmin ? `<button onclick="window.addProductModal()" class="btn-primary w-auto px-6">Register Item</button><button onclick="window.addStockModal()" class="btn-primary w-auto px-6 shadow-lg shadow-slate-900/20">Receive Stock</button>` : ''}</div>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left">
            <thead class="bg-slate-50 border-b border-slate-200"><tr>
                <th class="py-3 pl-4">Item</th>
                ${showPrice ? `<th>Cost</th><th>Price</th>` : ''}
                <th>Location</th><th>Qty</th><th>Action</th>
            </tr></thead>
            <tbody>${stockRows.length ? stockRows : '<tr><td colspan="6" class="text-center text-xs text-gray-400 py-12">No stock available.</td></tr>'}</tbody>
        </table></div></div>`;
}

// --- EDIT & DELETE LOGIC ---
window.openEditProduct = (id, name, cost, selling) => {
    document.getElementById('eName').value = name;
    document.getElementById('eCost').value = cost;
    document.getElementById('eSelling').value = selling;
    document.getElementById('edit-modal').style.display = 'flex';
    
    const saveBtn = document.getElementById('save-edit-btn');
    const newBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newBtn, saveBtn);
    
    newBtn.addEventListener('click', async () => {
        try {
            await supabase.from('products').update({
                name: document.getElementById('eName').value.toUpperCase(),
                cost_price: document.getElementById('eCost').value,
                selling_price: document.getElementById('eSelling').value
            }).eq('id', id);
            document.getElementById('edit-modal').style.display = 'none';
            window.showNotification("Product Updated", "success");
            router('inventory');
        } catch(e) { window.showNotification("Update failed", "error"); }
    });
};

window.deleteProduct = (id) => {
    window.showConfirm("Delete Product?", "This will delete the product history.", async () => {
        try {
            const { error } = await supabase.from('products').delete().eq('id', id);
            if (error) throw error;
            window.showNotification("Product Deleted", "success");
            router('inventory');
        } catch(e) { window.showNotification("Cannot delete used product", "error"); }
    });
};

// --- SETTINGS MODULE (WITH RATES MANAGER - FIXED) ---
async function renderSettings(c) {
    try {
        const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id);
        const { data: existingRates } = await supabase.from('exchange_rates').select('*').eq('organization_id', profile.organization_id);
        
        const rateMap = {};
        if(existingRates) existingRates.forEach(r => rateMap[r.currency_code] = r.rate);

        const supportedCurrencies = ['TZS', 'USD', 'EUR', 'GBP', 'KES'];

        const ratesHTML = supportedCurrencies.map(code => {
            const isBase = code === baseCurrency;
            const currentVal = isBase ? 1 : (rateMap[code] || ''); 
            
            return `
            <div class="flex items-center justify-between border-b border-slate-50 last:border-0 py-3">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-[10px] text-slate-600">${code.substring(0,1)}</div>
                    <div>
                        <p class="font-bold text-sm text-slate-700">${code}</p>
                        <p class="text-[10px] text-slate-400 font-medium">${isBase ? 'Base Currency' : 'Foreign'}</p>
                    </div>
                </div>
                <div>
                    ${isBase 
                        ? `<span class="font-mono font-bold text-slate-300 px-4">1.00</span>` 
                        : `<input id="rate-${code}" type="number" step="0.01" value="${currentVal}" placeholder="Ex. 2600" class="w-32 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-right font-mono font-bold text-slate-800 focus:border-slate-900 outline-none transition text-sm">`
                    }
                </div>
            </div>`;
        }).join('');

        c.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <h1 class="text-3xl font-bold uppercase text-slate-900">Settings</h1>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-fit">
                    <div class="p-6 border-b border-slate-100 flex justify-between items-center">
                        <h3 class="font-bold text-sm uppercase text-slate-800">Business Locations</h3>
                        <button onclick="window.addStoreModal()" class="text-[10px] font-bold bg-slate-900 text-white px-3 py-1.5 rounded hover:bg-slate-700">+ ADD NEW</button>
                    </div>
                    <div class="p-0">
                        <table class="w-full text-left">
                            <tbody>
                                ${locs.map(x => `
                                <tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                                    <td class="font-bold text-sm text-slate-700 py-4 pl-6">${x.name}</td>
                                    <td class="text-xs font-bold uppercase text-gray-400">${x.type.replace('_',' ')}</td>
                                    <td class="text-right pr-6"><span class="bg-green-50 text-green-600 px-2 py-1 rounded text-[9px] font-bold">ACTIVE</span></td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-fit">
                    <div class="p-6 border-b border-slate-100 bg-slate-50/50">
                        <h3 class="font-bold text-sm uppercase text-slate-800">Exchange Rates</h3>
                        <p class="text-[10px] text-slate-500 mt-1">1 Major Unit = How many Minor Units? (e.g. 1 USD = 2600 TZS)</p>
                    </div>
                    <div class="p-6 pt-2">
                        ${ratesHTML}
                        <button onclick="window.saveRates()" class="btn-primary w-full mt-6 justify-center">Update Rates</button>
                    </div>
                </div>
            </div>
        `;
    } catch(e) {
        console.error(e);
        c.innerHTML = `<div class="p-10 text-red-500">Error loading settings.</div>`;
    }
}

window.saveRates = async () => {
    const supportedCurrencies = ['TZS', 'USD', 'EUR', 'GBP', 'KES'];
    const updates = [];
    for (const code of supportedCurrencies) {
        if (code === baseCurrency) continue; 
        const input = document.getElementById(`rate-${code}`);
        if (input && input.value) {
            updates.push({
                organization_id: profile.organization_id,
                currency_code: code,
                rate: parseFloat(input.value)
            });
        }
    }
    if (updates.length === 0) return window.showNotification("No rates to update", "error");
    try {
        const { error } = await supabase.from('exchange_rates').upsert(updates, { onConflict: 'organization_id, currency_code' });
        if (error) throw error;
        await window.initCurrency(); 
        window.showNotification("Rates Updated Successfully", "success");
        renderSettings(document.getElementById('app-view')); 
    } catch(e) {
        window.showNotification(e.message, "error");
    }
};

// --- MODALS (SMART CURRENCY INPUT - FIXED MATH) ---
window.addProductModal = () => { 
    if(profile.role !== 'manager') return; 
    
    const currencyOptions = [baseCurrency, ...Object.keys(currencyRates).filter(c => c !== baseCurrency)]
        .map(c => `<option value="${c}">${c}</option>`)
        .join('');

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase text-center">New Product</h3>
        <div class="input-group"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div>
        <div class="input-group">
            <label class="input-label">Input Currency</label>
            <select id="pCurrency" class="input-field cursor-pointer bg-slate-50 font-bold text-slate-700">${currencyOptions}</select>
            <p class="text-[10px] text-slate-400 mt-1">* Auto-converts to ${baseCurrency}</p>
        </div>
        <div class="grid grid-cols-2 gap-5 mb-8">
            <div class="input-group mb-0"><label class="input-label">Cost</label><input id="pC" type="number" class="input-field" placeholder="0.00"></div>
            <div class="input-group mb-0"><label class="input-label">Selling</label><input id="pS" type="number" class="input-field" placeholder="0.00"></div>
        </div>
        <button onclick="window.execAddProduct()" class="btn-primary">Save Product</button>`;
    document.getElementById('modal').style.display = 'flex'; 
};

window.execAddProduct = async () => { 
    try { 
        const name = document.getElementById('pN').value.toUpperCase();
        const inputCurrency = document.getElementById('pCurrency').value; 
        let cost = parseFloat(document.getElementById('pC').value);
        let selling = parseFloat(document.getElementById('pS').value);

        if (!name || isNaN(cost) || isNaN(selling)) return window.showNotification("Invalid details", "error");

        // USE THE SMART CALCULATOR FOR INPUT
        // Tunataka kubadili FROM Input Currency TO Base Currency
        const costBase = window.convertAmount(cost, inputCurrency, baseCurrency);
        const sellingBase = window.convertAmount(selling, inputCurrency, baseCurrency);

        if (costBase === null) throw new Error(`Missing exchange rate for ${inputCurrency}`);

        await supabase.from('products').insert({ 
            name: name, 
            cost_price: costBase,     
            selling_price: sellingBase, 
            organization_id: profile.organization_id,
            unit: 'pcs' 
        }); 

        document.getElementById('modal').style.display = 'none'; 
        window.showNotification(`Saved (Base Value: ${baseCurrency} ${sellingBase.toFixed(2)})`, "success"); 
        router('inventory'); 
    } catch(e) { 
        window.showNotification(e.message, "error"); 
    } 
};

window.addStockModal = async () => {
    if(profile.role !== 'manager') return;
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase text-center">Receive from Supplier</h3>
        <div class="input-group"><label class="input-label">Item</label><select id="sP" class="input-field cursor-pointer">${prods.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
        <div class="input-group"><label class="input-label">Store</label><select id="sL" class="input-field cursor-pointer">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
        <div class="input-group"><label class="input-label">Qty</label><input id="sQ" type="number" class="input-field"></div>
        <button onclick="window.execAddStock()" class="btn-primary mt-6">Confirm Entry</button>`;
    document.getElementById('modal').style.display = 'flex';
};
window.execAddStock = async () => { try { const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value; if(!qty || qty <= 0) return window.showNotification("Invalid Quantity", "error"); const { error } = await supabase.rpc('add_stock_safe', { p_product_id: pid, p_location_id: lid, p_quantity: qty, p_org_id: profile.organization_id }); if(error) throw error; await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty }); document.getElementById('modal').style.display = 'none'; window.showNotification("Stock Updated Successfully", "success"); router('inventory'); } catch(e) { window.showNotification(e.message, "error"); } };
window.execInvite = async () => { const email = document.getElementById('iE').value; if(!email.includes('@')) return window.showNotification("Invalid Email", "error"); await supabase.from('staff_invites').insert({ email, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' }); document.getElementById('modal').style.display = 'none'; window.showNotification("Invitation Sent", "success"); router('staff'); };
window.execIssue = async (pId, fId) => { try { const qty = document.getElementById('tQty').value; if (!selectedDestinationId) return window.showNotification("Select Destination", "error"); if (!qty || qty <= 0) return window.showNotification("Enter Quantity", "error"); await transferStock(pId, fId, selectedDestinationId, qty, profile.id, profile.organization_id); document.getElementById('modal').style.display = 'none'; window.showNotification("Transfer Requested", "success"); router('inventory'); } catch(e){ window.showNotification(e.message, "error"); } };
window.execAddStore=async()=>{ await createLocation(profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').style.display = 'none'; router('settings'); };
