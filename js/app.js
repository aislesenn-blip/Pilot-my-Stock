import { getSession, logout } from './auth.js';
import { getInventory, processBarSale, getPendingApprovals, respondToApproval, transferStock, createLocation } from './services.js';
import { supabase } from './supabase.js';

// --- GLOBALS ---
window.profile = {};
window.currentLogs = [];
window.cart = [];
window.baseCurrency = 'TZS';
window.currencyRates = { 'TZS': 1 };
window.selectedCurrency = 'TZS';
window.activePosLocationId = null;
window.cachedLocations = [];
window.cachedSuppliers = [];
window.cachedStaff = [];
window.selectedPaymentMethod = 'cash';
window.tempProductData = null;
window.currentInvView = 'stock';
window.selectedDestinationId = null;

// --- CONSTANTS ---
const PRODUCT_CATEGORIES = ['Beverage', 'Food', 'Stationery', 'Linen', 'Construction', 'Electronics', 'Automotive', 'Cleaning', 'Furniture', 'IT Equipment', 'Kitchenware', 'Maintenance', 'Chemicals', 'Fuel', 'Medical', 'General'];
const ALL_UNITS = ['Pcs', 'Crate', 'Carton', 'Dozen', 'Kg', 'Ltr', 'Box', 'Bag', 'Packet', 'Set', 'Roll', 'Tin', 'Bundle', 'Pallet', 'Mita', 'Galoni', 'Trip', 'Bucket'];
const ALL_CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX', 'RWF', 'ZAR', 'AED', 'CNY', 'INR', 'CAD', 'AUD', 'JPY', 'CHF', 'SAR', 'QAR'];

// --- ERROR HANDLING ---
const handleError = (error, context) => {
    console.error(`[${context}] Error:`, error);
    if (window.showNotification) {
        window.showNotification(error.message || JSON.stringify(error), "error");
    } else {
        alert(`Error: ${error.message}`);
    }
};

// --- UTILS ---
window.closeModalOutside = function(e) { if (e.target.classList.contains('modal-backdrop')) e.target.style.display = 'none'; };

window.showNotification = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if(!container) return alert(message);
    const div = document.createElement('div');
    div.className = `px-6 py-4 rounded-xl text-white font-bold shadow-2xl flex items-center gap-3 transition-all duration-300 transform translate-y-0 ${type === 'success' ? 'bg-[#0F172A]' : 'bg-red-600'}`;
    div.innerHTML = `<span>${message}</span>`;
    container.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 500); }, 3000);
};

window.premiumConfirm = function(title, desc, btnText, callback) {
    const modal = document.getElementById('confirm-modal');
    if(!modal) return callback();
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-desc').innerText = desc;
    const btn = document.getElementById('confirm-btn');
    btn.innerText = btnText;
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    modal.style.display = 'flex';
    newBtn.addEventListener('click', async () => {
        modal.style.display = 'none';
        await callback();
    });
};

window.initCurrency = async function() {
    if (!window.profile?.organization_id) return;
    try {
        const { data: org } = await supabase.from('organizations').select('base_currency').eq('id', window.profile.organization_id).single();
        if(org) window.baseCurrency = org.base_currency;
        const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', window.profile.organization_id);
        window.currencyRates = { [window.baseCurrency]: 1 };
        (rates||[]).forEach(r => window.currencyRates[r.currency_code] = Number(r.rate));
    } catch(e){ console.warn("Currency Error", e); }
};

window.convertAmount = function(amount, fromCurr, toCurr) {
    if (!amount) return 0;
    const fromRate = window.currencyRates[fromCurr] || 1;
    const toRate = window.currencyRates[toCurr] || 1;
    return fromCurr === window.baseCurrency ? amount * toRate : amount / fromRate;
};

window.formatPrice = function(amount) {
    if (!amount && amount !== 0) return '-';
    let converted = window.convertAmount(amount, window.baseCurrency, window.selectedCurrency);
    return `${window.selectedCurrency} ${Number(converted).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
};

window.changeCurrency = function(curr) {
    window.selectedCurrency = curr;
    const activeEl = document.querySelector('.nav-item.nav-active');
    if (activeEl) window.router(activeEl.id.replace('nav-', ''));
};

window.getCurrencySelectorHTML = function() {
    const options = ALL_CURRENCIES.map(c => `<option value="${c}" ${window.selectedCurrency === c ? 'selected' : ''}>${c}</option>`).join('');
    return `<select onchange="window.changeCurrency(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer ml-4 shadow-sm h-8">${options}</select>`;
};

// --- INITIALIZATION ---
async function initApp() {
    console.log("🚀 Starting App...");
    window.logoutAction = logout;
    const session = await getSession();
    if (!session) {
        if(!window.location.href.includes('index.html')) window.location.href = 'index.html';
        return;
    }

    try {
        let { data: prof, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        
        // Handle Missing Profile
        if ((error && error.code === 'PGRST116') || !prof || !prof.organization_id) {
            console.warn("User has no profile/org.");
            const nm = document.getElementById('name-modal');
            if(nm) {
                nm.style.display = 'flex';
                if(session.user.user_metadata?.full_name) document.getElementById('userNameInput').value = session.user.user_metadata.full_name;
            }
            return;
        }

        if (prof.status === 'suspended') { await logout(); alert("Account Suspended."); return; }

        window.profile = prof;

        // Load Caches
        const [locsRes, supsRes, staffRes] = await Promise.all([
            supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id),
            supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id),
            supabase.from('profiles').select('id, full_name').eq('organization_id', window.profile.organization_id)
        ]);
        window.cachedLocations = locsRes.data || [];
        window.cachedSuppliers = supsRes.data || [];
        window.cachedStaff = staffRes.data || [];

        await window.initCurrency();

        // RBAC UI Cleanup
        const role = window.profile.role;
        const remove = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.remove(); });

        if (role === 'barman') {
            const sb = document.getElementById('sidebar');
            if(sb) sb.style.display = 'none';
            const main = document.querySelector('main');
            if(main) main.classList.remove('md:ml-72');
            window.router('bar');
            return;
        }

        if (role === 'finance' || role === 'deputy_finance') remove(['nav-bar', 'nav-settings', 'nav-staff']);
        else if (role === 'financial_controller') remove(['nav-bar', 'nav-settings']);
        else if (role === 'storekeeper' || role === 'deputy_storekeeper') remove(['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings']);

        window.router('inventory');

    } catch (e) { handleError(e, "Init Error"); }
}

window.onload = initApp;

// --- ROUTER ---
window.router = async function(view) {
    if(window.profile.role === 'barman' && view !== 'bar') view = 'bar';
    
    const app = document.getElementById('app-view');
    if(!app) return console.error("No app-view element");

    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div></div>';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    const navEl = document.getElementById(`nav-${view}`);
    if(navEl) navEl.classList.add('nav-active');

    setTimeout(async () => {
        try {
            if (view === 'inventory') await window.renderInventory(app);
            else if (view === 'bar') await window.renderBar(app);
            else if (view === 'approvals') await window.renderApprovals(app);
            else if (view === 'reports') await window.renderReports(app);
            else if (view === 'staff') await window.renderStaff(app);
            else if (view === 'settings') await window.renderSettings(app);
        } catch (e) {
            console.error(e);
            app.innerHTML = `<div class="p-10 text-red-500 font-bold text-center">Error loading ${view}<br><span class="text-xs">${e.message}</span></div>`;
        }
    }, 50);
};

// --- SETUP FUNCTIONS ---
window.saveName = async function() {
    const orgName = document.getElementById('orgNameInput').value;
    const name = document.getElementById('userNameInput').value;
    const phone = document.getElementById('userPhoneInput').value;
    if (!orgName || !name) return window.showNotification("Fields Required", "error");
    const { error } = await supabase.rpc('create_setup_data', { p_org_name: orgName, p_full_name: name, p_phone: phone });
    if (error) return window.showNotification(error.message, "error");
    document.getElementById('name-modal').style.display = 'none';
    window.showNotification("Setup Complete", "success");
    location.reload();
};

// --- INVENTORY FUNCTIONS ---
window.renderInventory = async function(c) {
    const isPOView = window.currentInvView === 'po';
    let stock = [];

    try {
        if (window.profile.role.includes('storekeeper') && !window.profile.role.includes('overall')) {
            stock = await getInventory(window.profile.organization_id, window.profile.assigned_location_id);
        } else {
            stock = await getInventory(window.profile.organization_id);
        }

        const showPrice = ['manager', 'deputy_manager', 'financial_controller', 'overall_finance'].includes(window.profile.role);
        const canCreateLPO = ['manager', 'deputy_manager', 'overall_storekeeper', 'financial_controller'].includes(window.profile.role);

        let content = '';
        if (isPOView) {
            const { data: pos } = await supabase.from('purchase_orders').select('*, suppliers(name)').eq('organization_id', window.profile.organization_id).order('created_at', {ascending:false});
            content = `<table class="w-full text-left border-collapse"><thead class="bg-slate-50 border-b"><tr><th class="p-4">Date</th><th>Supplier</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>${(pos||[]).map(p => `<tr class="border-b hover:bg-slate-50 transition"><td class="py-4 pl-4 text-xs font-bold text-slate-500">${new Date(p.created_at).toLocaleDateString()}</td><td class="text-sm font-bold uppercase">${p.suppliers?.name || 'Unknown'}</td><td class="text-sm font-mono font-bold text-slate-900">${window.formatPrice(p.total_cost)}</td><td><span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${p.status==='Pending'?'bg-yellow-100 text-yellow-700':p.status==='Partial'?'bg-blue-100 text-blue-700':'bg-green-100 text-green-700'}">${p.status}</span></td><td>${p.status!=='Received'?`<button onclick="window.openReceiveModal('${p.id}')" class="text-[10px] bg-slate-900 text-white px-3 py-1 rounded font-bold">RECEIVE</button>`:'<span class="text-xs text-slate-300 font-bold">DONE</span>'}</td></tr>`).join('')}</tbody></table>`;
        } else {
            content = `<table class="w-full text-left border-collapse"><thead class="bg-slate-50 border-b"><tr><th class="p-4">Item</th>${showPrice?'<th>Cost</th>':''}<th>Store</th><th>Stock</th><th>Action</th></tr></thead><tbody>${(stock||[]).map(i => `<tr class="border-b hover:bg-slate-50 transition group"><td class="py-4 pl-4"><div class="font-bold text-sm uppercase">${i.products?.name || 'Deleted'}</div><div class="text-[10px] text-slate-400 font-bold uppercase mt-0.5">${i.products?.category || '-'}</div></td>${showPrice?`<td class="font-mono text-xs text-slate-500">${window.formatPrice(i.products?.cost_price)}</td>`:''} <td class="text-xs font-bold text-slate-500 uppercase">${i.locations?.name || 'Unknown'}</td><td class="font-mono font-bold text-lg text-slate-900">${i.quantity} <span class="text-[10px] text-slate-400 font-sans">${i.products?.unit || ''}</span></td><td class="flex gap-2 p-4 justify-end"><button onclick="window.issueModal('${i.products?.name}','${i.product_id}','${i.location_id}')" class="text-[10px] border px-2 py-1 rounded hover:bg-slate-900 hover:text-white transition">MOVE</button></td></tr>`).join('')}</tbody></table>`;
        }

        c.innerHTML = `<div class="flex flex-col md:flex-row justify-between items-center gap-6 mb-8"><div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900">Inventory</h1>${showPrice?window.getCurrencySelectorHTML():''}</div><div class="flex gap-1 bg-slate-100 p-1 rounded-xl"><button onclick="window.currentInvView='stock'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${!isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">STOCK</button><button onclick="window.currentInvView='po'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">LPO</button></div><div class="flex gap-3">${canCreateLPO?`<button onclick="window.createPOModal()" class="btn-primary w-auto px-6 shadow-lg shadow-blue-900/20 bg-blue-600 hover:bg-blue-700">Create LPO</button><button onclick="window.addProductModal()" class="btn-primary w-auto px-6 shadow-lg shadow-slate-900/10">New Item</button>`:''}</div></div><div class="bg-white rounded-3xl border shadow-sm overflow-hidden min-h-[400px]">${content}</div>`;
    } catch(e) { handleError(e, "Render Inventory"); }
};

window.addProductModal = function() {
    if(!['manager','overall_storekeeper'].includes(window.profile.role)) return;
    const unitOpts = ALL_UNITS.map(u => `<option value="${u}">${u}</option>`).join('');
    const catOpts = PRODUCT_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
    const currOpts = ALL_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-6 uppercase text-center">New Product</h3>
    <div class="input-group mb-6"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div>
    <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="input-group mb-0"><label class="input-label">Category</label><select id="pCat" class="input-field">${catOpts}</select></div>
        <div class="input-group mb-0"><label class="input-label">Unit</label><select id="pUnit" class="input-field">${unitOpts}</select></div>
    </div>
    <div class="input-group mb-6"><label class="input-label">Currency</label><select id="pCurrency" class="input-field">${currOpts}</select></div>
    <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="input-group mb-0"><label class="input-label">Cost</label><input id="pC" type="number" class="input-field"></div>
        <div class="input-group mb-0"><label class="input-label">Selling</label><input id="pS" type="number" class="input-field"></div>
    </div>
    <button onclick="window.nextProductStep()" class="btn-primary">Next: Prices</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.nextProductStep = async function() {
    const name = document.getElementById('pN').value.toUpperCase(), cost = parseFloat(document.getElementById('pC').value);
    if(!name || isNaN(cost)) return window.showNotification("Invalid Input", "error");
    window.tempProductData = { name, category: document.getElementById('pCat').value, unit: document.getElementById('pUnit').value, conversion_factor: 1, currency: document.getElementById('pCurrency').value, cost, selling: parseFloat(document.getElementById('pS').value) };
    const html = window.cachedLocations.map(l => `<div class="flex justify-between items-center mb-2 bg-slate-50 p-2 rounded"><span class="text-xs font-bold w-1/2">${l.name}</span><input type="number" class="loc-price-input input-field w-1/2 text-right" data-loc="${l.id}" value="${window.tempProductData.selling}"></div>`).join('');
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 text-center">Camp Pricing</h3><div class="mb-6 max-h-60 overflow-y-auto">${html}</div><button onclick="window.finalizeProduct()" class="btn-primary">SAVE</button>`;
};

window.finalizeProduct = async function() {
    try {
        const d = window.tempProductData;
        const cost = window.convertAmount(d.cost, d.currency, window.baseCurrency);
        const selling = window.convertAmount(d.selling, d.currency, window.baseCurrency);
        const { data: prod, error } = await supabase.from('products').insert({ name: d.name, category: d.category, unit: d.unit, conversion_factor: 1, cost_price: cost, selling_price: selling, organization_id: window.profile.organization_id }).select().single();
        if(error) throw error;
        const prices = []; document.querySelectorAll('.loc-price-input').forEach(i => { if(i.value) prices.push({ organization_id: window.profile.organization_id, product_id: prod.id, location_id: i.dataset.loc, selling_price: window.convertAmount(parseFloat(i.value), d.currency, window.baseCurrency) }); });
        if(prices.length) await supabase.from('location_prices').insert(prices);
        document.getElementById('modal').style.display = 'none'; window.showNotification("Product Added", "success"); window.router('inventory');
    } catch(e) { handleError(e, "Finalize Product"); }
};

window.createPOModal = async function() {
    try {
        const { data: prods } = await supabase.from('products').select('*').eq('organization_id', window.profile.organization_id).order('name');
        const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id);
        if(!sups || sups.length === 0) return window.showNotification("No Suppliers", "error");

        document.getElementById('modal-content').innerHTML = `
            <h3 class="font-bold text-xl mb-6 text-center">New Purchase Order</h3>
            <div class="input-group mb-6"><label class="input-label">Select Supplier</label><select id="lpoSup" class="input-field font-bold">${sups.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select></div>
            <div class="bg-slate-50 p-4 rounded-xl border mb-6 max-h-[300px] overflow-y-auto custom-scrollbar gap-4 grid grid-cols-1">
                ${prods.map(p => `<div class="flex items-center gap-3 bg-white p-3 rounded-lg border mb-2"><input type="checkbox" class="lpo-check w-5 h-5" value="${p.id}" data-price="${p.cost_price}"><div class="flex-1"><span class="block text-xs font-bold uppercase">${p.name}</span><span class="text-[10px] text-slate-400">Cost: ${window.formatPrice(p.cost_price)}</span></div><input type="number" id="qty-${p.id}" class="w-20 input-field py-1 text-center font-bold" placeholder="Qty"></div>`).join('')}
            </div>
            <button onclick="window.execCreatePO()" class="btn-primary w-full">GENERATE ORDER</button>`;
        document.getElementById('modal').style.display = 'flex';
    } catch(e) { handleError(e, "Create PO Modal"); }
};

window.execCreatePO = async function() {
    const supSelect = document.getElementById('lpoSup');
    const items = []; let total = 0;
    document.querySelectorAll('.lpo-check:checked').forEach(c => { const qty = document.getElementById(`qty-${c.value}`).value; if(qty > 0) { total += (qty * c.dataset.price); items.push({ product_id: c.value, quantity: qty, unit_cost: c.dataset.price, received_qty: 0 }); } });
    if(!items.length) return window.showNotification("Select items & qty", "error");
    const { data: po, error } = await supabase.from('purchase_orders').insert({ organization_id: window.profile.organization_id, created_by: window.profile.id, supplier_id: supSelect.value, supplier_name: supSelect.options[supSelect.selectedIndex].text, total_cost: total, status: 'Pending' }).select().single();
    if(error) return window.showNotification(error.message, "error");
    await supabase.from('po_items').insert(items.map(i => ({...i, po_id: po.id})));
    document.getElementById('modal').style.display = 'none'; window.showNotification("LPO Created", "success"); window.currentInvView = 'po'; window.router('inventory');
};

window.openReceiveModal = async function(poId) {
    try {
        const { data: items, error } = await supabase.from('po_items').select('*, products(name)').eq('po_id', poId);
        if (error) throw error;
        const itemRows = items.map(i => {
            const rem = i.quantity - (i.received_qty || 0);
            if(rem <= 0) return '';
            return `<div class="flex justify-between items-center mb-3 bg-slate-50 p-3 rounded border"><div class="w-1/2"><span class="block text-xs font-bold uppercase">${i.products?.name || 'Unknown'}</span><span class="text-[10px] text-slate-500">Ord: ${i.quantity} | Rec: ${i.received_qty}</span></div><div class="w-1/2 flex justify-end gap-2"><span class="text-[10px] font-bold mt-2">Now:</span><input type="number" class="rec-inp w-20 input-field text-center text-blue-600 font-bold" data-id="${i.id}" data-pid="${i.product_id}" data-cost="${i.unit_cost}" max="${rem}" placeholder="${rem}"></div></div>`;
        }).join('');
        if(!itemRows) return window.showNotification("Fully Received", "success");
        document.getElementById('modal-content').innerHTML = `
            <h3 class="font-bold text-lg mb-4 text-center">Receive Stock (GRN)</h3>
            <p class="text-xs text-center text-slate-400 mb-6">PO: ${poId.split('-')[0]}</p>
            <div class="mb-6 max-h-[300px] overflow-y-auto">${itemRows}</div>
            <button onclick="window.execReceivePO('${poId}')" class="btn-primary w-full bg-blue-600">CONFIRM RECEIPT</button>`;
        document.getElementById('modal').style.display = 'flex';
    } catch (e) { handleError(e, "Open Receive Modal"); }
};

window.execReceivePO = async function(poId) {
    const items = [];
    document.querySelectorAll('.rec-inp').forEach(i => { if(i.value > 0) items.push({ product_id: i.dataset.pid, qty: parseFloat(i.value), unit_cost: parseFloat(i.dataset.cost) }); });
    if(!items.length) return;
    window.premiumConfirm("Confirm Receipt", "Update stock levels?", "Yes", async () => {
        const { error } = await supabase.rpc('receive_stock_partial', { p_po_id: poId, p_user_id: window.profile.id, p_org_id: window.profile.organization_id, p_items: items, p_loc_id: window.profile.assigned_location_id });
        if(error) window.showNotification(error.message, "error");
        else { window.showNotification("Received", "success"); document.getElementById('modal').style.display='none'; window.router('inventory'); }
    });
};

window.issueModal = async (name, id, fromLoc) => { try { window.selectedDestinationId = null; const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).neq('id', fromLoc); const html = locs.map(l => `<div onclick="window.selectDest(this, '${l.id}')" class="dest-card border p-3 rounded cursor-pointer hover:bg-slate-50 text-center"><span class="font-bold text-xs uppercase">${l.name}</span></div>`).join(''); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Move: ${name}</h3><div class="grid grid-cols-2 gap-2 mb-4 max-h-40 overflow-y-auto">${html}</div><div class="input-group"><label class="input-label">Quantity</label><input id="tQty" type="number" class="input-field"></div><button onclick="window.execIssue('${id}', '${fromLoc}')" class="btn-primary">TRANSFER</button>`; document.getElementById('modal').style.display = 'flex'; } catch(e) { handleError(e, "Issue Modal"); } };
window.selectDest = (el, id) => { document.querySelectorAll('.dest-card').forEach(c => c.classList.remove('bg-slate-900', 'text-white')); el.classList.add('bg-slate-900', 'text-white'); window.selectedDestinationId = id; };
window.execIssue = async (pid, fromLoc) => { const qty = document.getElementById('tQty').value; if(!window.selectedDestinationId || qty <= 0) return window.showNotification("Invalid Selection", "error"); try { await transferStock(pid, fromLoc, window.selectedDestinationId, qty, window.profile.id, window.profile.organization_id); document.getElementById('modal').style.display = 'none'; window.showNotification("Request Sent", "success"); } catch(e) { window.showNotification(e.message, "error"); } };

// --- POS FUNCTIONS ---
window.renderBar = async function(c) {
    try {
        const inv = await getInventory(window.profile.organization_id);
        const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).eq('type', 'department');
        if (window.profile.role === 'barman') window.activePosLocationId = window.profile.assigned_location_id;
        else if (!window.activePosLocationId && locs.length) window.activePosLocationId = locs[0].id;

        const items = inv.filter(x => x.location_id === window.activePosLocationId && x.products?.category === 'Beverage');
        const storeSelect = (window.profile.role !== 'barman') ? `<div class="mb-8 flex items-center gap-4"><span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Active Counter:</span><select onchange="window.switchBar(this.value)" class="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-slate-900 cursor-pointer shadow-sm min-w-[200px]">${locs.map(l => `<option value="${l.id}" ${window.activePosLocationId===l.id?'selected':''}>${l.name}</option>`).join('')}</select></div>` : '';
        const payMethods = ['Cash', 'Mobile Money', 'Credit Card', 'Room Charge'].map(m => `<button onclick="window.setPaymentMethod('${m}')" class="pay-btn flex-1 py-2 text-[10px] font-bold uppercase rounded-lg border transition ${window.selectedPaymentMethod === m ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}">${m}</button>`).join('');

        c.innerHTML = `${storeSelect} <div class="flex flex-col lg:flex-row gap-8 h-[calc(100vh-140px)]"><div class="flex-1 overflow-y-auto pr-2"><div class="flex justify-between items-center mb-6 sticky top-0 bg-[#F8FAFC] py-2 z-10"><h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">POS Terminal</h1>${window.getCurrencySelectorHTML()}</div><div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 pb-20">${items.length ? items.map(x => `<div onclick="window.addCart('${x.products.name}', ${x.products.selling_price}, '${x.product_id}')" class="bg-white p-5 rounded-2xl border border-slate-100 cursor-pointer hover:border-slate-900 transition-all duration-200 hover:shadow-lg hover:-translate-y-1 group relative overflow-hidden"><div class="flex justify-between items-start mb-2"><div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 font-bold text-[10px] group-hover:bg-slate-900 group-hover:text-white transition">${x.products.name.charAt(0)}</div><span class="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full border border-slate-100 group-hover:border-slate-200">Qty: ${x.quantity}</span></div><p class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 truncate">${x.products.name}</p><p class="text-lg font-bold text-slate-900 font-mono">${window.formatPrice(x.products.selling_price)}</p></div>`).join('') : '<div class="col-span-full py-20 text-center border-2 border-dashed border-slate-200 rounded-3xl"><p class="text-slate-400 font-bold text-sm uppercase">No beverages available.</p></div>'}</div></div><div class="w-full lg:w-96 bg-white border border-slate-200 rounded-[32px] p-8 h-full flex flex-col shadow-2xl shadow-slate-200/50"><div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase text-slate-900 tracking-widest">Current Order</h3><button onclick="window.cart=[];window.renderCart()" class="text-[10px] font-bold text-red-500 hover:bg-red-50 px-2 py-1 rounded transition">CLEAR ALL</button></div><div id="cart-list" class="flex-1 overflow-y-auto space-y-3 pr-1"></div><div class="pt-6 border-t border-slate-100 mt-auto"><div class="mb-4"><p class="text-[10px] font-bold text-slate-400 uppercase mb-2">Payment Method</p><div class="flex gap-2 flex-wrap">${payMethods}</div></div><div class="flex justify-between items-end mb-6"><span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Amount</span><span id="cart-total" class="text-3xl font-bold text-slate-900 font-mono">${window.formatPrice(0)}</span></div><button onclick="window.confirmCheckout()" class="w-full bg-[#0F172A] text-white py-4 rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-slate-800 shadow-xl shadow-slate-900/20 active:scale-95 transition">Charge Sale</button></div></div></div>`;
        window.renderCart();
    } catch(e) { handleError(e, "Render Bar"); }
};
window.switchBar = function(id) { window.activePosLocationId = id; window.router('bar'); };
window.setPaymentMethod = function(method) { window.selectedPaymentMethod = method; window.router('bar'); };
window.addCart = function(n,p,id) { if(!window.cart) window.cart=[]; const x=window.cart.find(c=>c.id===id); if(x)x.qty++; else window.cart.push({name:n,price:p,id,qty:1}); window.renderCart(); };
window.renderCart = function() { const l=document.getElementById('cart-list'), t=document.getElementById('cart-total'); let sum=0; l.innerHTML=(window.cart||[]).map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100 group"><div class="flex flex-col"><span class="text-xs font-bold text-slate-800 uppercase">${i.name}</span><span class="text-[10px] text-slate-400 font-mono">${window.formatPrice(i.price)} x ${i.qty}</span></div><button onclick="window.remCart('${i.id}')" class="w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:text-red-500">✕</button></div>`}).join(''); t.innerText=window.formatPrice(sum); };
window.remCart = function(id) { window.cart=window.cart.filter(c=>c.id!==id); window.renderCart(); };
window.confirmCheckout = function() { if(!window.cart.length) return; window.premiumConfirm(`Confirm ${window.selectedPaymentMethod.toUpperCase()} Sale?`, "Charge this amount.", "Charge", window.doCheckout); };
window.doCheckout = async function() { try { await processBarSale(window.profile.organization_id, window.activePosLocationId, window.cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), window.profile.id, window.selectedPaymentMethod); window.showNotification("Sale Completed Successfully", "success"); window.cart=[]; window.renderCart(); window.router('bar'); } catch(e) { window.showNotification(e.message, "error"); } };

// --- APPROVALS ---
window.renderApprovals = async function(c) {
    try {
        const reqs = await getPendingApprovals(window.profile.organization_id);
        const { data: changes } = await supabase.from('change_requests').select('*, requester:requester_id(full_name)').eq('organization_id', window.profile.organization_id).eq('status', 'pending');

        c.innerHTML = `
        <h1 class="text-3xl font-bold mb-8 uppercase text-slate-900 tracking-tight">Pending Approvals</h1>
        <div class="mb-8"><h3 class="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Stock Transfers</h3><div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${reqs.length ? reqs.map(r => `<tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition"><td class="p-6"><div class="font-bold text-sm uppercase text-slate-900">${r.products?.name}</div><div class="text-xs text-slate-400 uppercase mt-1">From: ${r.from_loc?.name || 'Main'}</div></td><td class="p-6"><div class="text-blue-600 font-mono font-bold text-lg">${r.quantity}</div><div class="text-xs text-slate-400 uppercase mt-1">Requested</div></td><td class="p-6 text-xs font-bold text-slate-500 uppercase tracking-wider">To: ${r.to_loc?.name}</td><td class="p-6 text-right"><button onclick="window.confirmApprove('${r.id}')" class="text-[10px] bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800 transition shadow-lg">AUTHORIZE</button></td></tr>`).join('') : '<tr><td colspan="4" class="p-8 text-center text-xs font-bold text-slate-300 uppercase">No transfer requests.</td></tr>'}</tbody></table></div></div>
        <div><h3 class="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Admin Requests (Void/Adjust)</h3><div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${(changes||[]).length ? changes.map(r => `<tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition"><td class="p-6"><div class="font-bold text-sm uppercase text-red-600">${r.action}</div><div class="text-xs text-slate-400 uppercase mt-1">By: ${r.requester?.full_name}</div></td><td class="p-6 text-xs font-mono text-slate-500">${new Date(r.created_at).toLocaleString()}</td><td class="p-6 text-right"><button onclick="window.approveChange('${r.id}')" class="text-[10px] bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-700 transition shadow-lg">APPROVE</button></td></tr>`).join('') : '<tr><td colspan="3" class="p-8 text-center text-xs font-bold text-slate-300 uppercase">No admin requests.</td></tr>'}</tbody></table></div></div>`;
    } catch(e) { handleError(e, "Render Approvals"); }
};
window.confirmApprove = function(id) { window.premiumConfirm("Authorize Transfer?", "Move stock?", "Authorize", async () => { await respondToApproval(id, 'approved', window.profile.id); window.showNotification("Authorized", "success"); window.router('approvals'); }); };
window.approveChange = function(id) { window.premiumConfirm("Approve Change?", "Execute this request.", "Approve", async () => { await supabase.rpc('process_change_request', { p_request_id: id, p_status: 'approved', p_reviewer_id: window.profile.id }); window.showNotification("Executed", "success"); window.router('approvals'); }); };

// --- STAFF ---
window.renderStaff = async function(c) {
    try {
        const { data: staff } = await supabase.from('profiles').select('*, locations(name)').eq('organization_id', window.profile.organization_id);
        c.innerHTML = `
        <div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase">Team</h1><button onclick="window.openInviteModal()" class="btn-primary w-auto px-6">INVITE</button></div>
        <div class="bg-white rounded-3xl border shadow-sm overflow-hidden mb-8">
            <table class="w-full text-left">
                <thead class="bg-slate-50 border-b"><tr><th class="p-4 text-xs text-slate-400 uppercase">User</th><th class="text-xs text-slate-400 uppercase">Role</th><th class="text-xs text-slate-400 uppercase">Loc</th><th class="text-xs text-slate-400 uppercase text-right pr-6">Action</th></tr></thead>
                <tbody>${(staff||[]).map(s => `<tr class="border-b last:border-0 hover:bg-slate-50 transition"><td class="p-4 font-bold text-slate-700">${s.full_name}<br><span class="text-[10px] text-slate-400 font-normal">${s.email}</span></td><td class="text-xs uppercase">${s.role.replace('_', ' ')}</td><td class="text-xs uppercase">${s.locations?.name || 'Global'}</td><td class="text-right pr-6"><button onclick="window.viewStaffDetails('${s.id}')" class="text-[10px] border px-2 py-1 rounded hover:bg-slate-100">LOGS</button></td></tr>`).join('')}</tbody>
            </table>
        </div>`;
    } catch(e) { handleError(e, "Render Staff"); }
};

window.openInviteModal = function() {
    const locSelect = document.getElementById('invite-location-select');
    locSelect.innerHTML = window.cachedLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    document.getElementById('invite-modal').style.display = 'flex';
};

window.toggleLocSelect = function(role) {
    document.getElementById('invite-loc-div').style.display = role === 'financial_controller' ? 'none' : 'block';
};

window.execInvite = async function() {
    try {
        const email = document.getElementById('invite-email').value;
        const role = document.getElementById('invite-role').value;
        const locSelect = document.getElementById('invite-location-select');
        let locId = locSelect.value;
        if (!email) return window.showNotification("Email required", "error");
        if (role !== 'financial_controller' && !locId) return window.showNotification("Select a Location", "error");
        if (role === 'financial_controller') locId = null;

        const { error } = await supabase.from('staff_invites').insert({
            organization_id: window.profile.organization_id,
            email, role, assigned_location_id: locId, status: 'pending', invited_by: window.profile.id
        });
        if (error) throw error;
        document.getElementById('invite-modal').style.display = 'none';
        window.showNotification("Invite Sent", "success");
        window.renderStaff(document.getElementById('app-view'));
    } catch(e) { handleError(e, "Exec Invite"); }
};

window.viewStaffDetails = async function(id) {
    try {
        const { data: logs } = await supabase.from('audit_logs').select('*').eq('user_id', id).order('created_at', {ascending: false}).limit(20);
        document.getElementById('activity-list').innerHTML = (logs||[]).map(l => `
            <div class="text-[10px] border-b border-slate-200 py-2">
                <span class="font-bold text-slate-700">${l.action}</span>
                <span class="block text-slate-500 italic">${l.description || 'No details'}</span>
                <span class="block text-slate-400 text-[9px]">${new Date(l.created_at).toLocaleString()}</span>
            </div>`).join('');
        document.getElementById('profile-viewer').style.display = 'flex';
    } catch(e) { handleError(e, "View Staff Details"); }
};

// --- REPORTS ---
window.renderReports = async function(c) {
    try {
        const { data: logs } = await supabase.from('transactions').select(`*, products(name, category), locations:to_location_id(name), from_loc:from_location_id(name), profiles:user_id(full_name)`).eq('organization_id', window.profile.organization_id).order('created_at', { ascending: false }).limit(2000);
        window.currentLogs = logs || [];

        const locOpts = window.cachedLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
        const staffOpts = window.cachedStaff.map(s => `<option value="${s.id}">${s.full_name}</option>`).join('');
        const template = document.getElementById('report-filters-template').content.cloneNode(true);
        c.innerHTML = `<h1 class="text-3xl font-bold mb-8 uppercase text-slate-900">Enterprise Reporting</h1>`;
        c.appendChild(template);
        document.getElementById('rLoc').innerHTML += locOpts;
        document.getElementById('rStaff').innerHTML += staffOpts;
        document.getElementById('rCat').innerHTML += PRODUCT_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('');

        c.insertAdjacentHTML('beforeend', `
            <div class="grid grid-cols-2 gap-4 mb-6">
                <div class="bg-white p-6 border rounded-xl shadow-sm"><span class="text-xs text-slate-400 font-bold uppercase tracking-widest">Total Sales</span><div id="repRev" class="text-3xl font-bold mt-1 text-slate-900">0.00</div></div>
                <div class="bg-white p-6 border rounded-xl shadow-sm"><span class="text-xs text-slate-400 font-bold uppercase tracking-widest">Gross Profit</span><div id="repProf" class="text-3xl font-bold mt-1 text-green-600">0.00</div></div>
            </div>
            <div class="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-slate-50 border-b"><tr><th class="p-4 text-xs font-bold uppercase text-slate-500">Date</th><th class="text-xs font-bold uppercase text-slate-500">Type</th><th class="text-xs font-bold uppercase text-slate-500">Item</th><th class="text-xs font-bold uppercase text-slate-500">Route</th><th class="text-right text-xs font-bold uppercase text-slate-500">Qty</th><th class="text-right text-xs font-bold uppercase text-slate-500">Cost</th><th class="text-right text-xs font-bold uppercase text-slate-500">Value</th><th class="text-right text-xs font-bold uppercase text-slate-500 pr-4">Profit</th></tr></thead>
                    <tbody id="logsBody"></tbody>
                </table>
            </div>`);
        window.filterReport();
    } catch(e) { handleError(e, "Render Reports"); }
};

window.filterReport = function() {
    const loc = document.getElementById('rLoc')?.value;
    const staff = document.getElementById('rStaff')?.value;
    const pay = document.getElementById('rPay')?.value;
    const cat = document.getElementById('rCat')?.value;
    const type = document.getElementById('rType')?.value;
    const search = document.getElementById('rSearch')?.value.toLowerCase();
    let f = window.currentLogs;
    const start = document.getElementById('rStart')?.value;
    const end = document.getElementById('rEnd')?.value;
    if(start) f = f.filter(l => new Date(l.created_at) >= new Date(start));
    if(end) f = f.filter(l => new Date(l.created_at) <= new Date(end + 'T23:59:59'));
    if(cat && cat !== 'all') f = f.filter(l => l.products?.category === cat);
    if(type && type !== 'all') f = f.filter(l => l.type === type);
    if(loc && loc !== 'all') f = f.filter(l => l.to_location_id === loc || l.from_location_id === loc);
    if(staff && staff !== 'all') f = f.filter(l => l.user_id === staff);
    if(pay && pay !== 'all') f = f.filter(l => (l.payment_method||'').includes(pay));
    if(search) f = f.filter(l => l.products?.name.toLowerCase().includes(search));

    const revenue = f.filter(l => l.type === 'sale' && l.status !== 'void').reduce((sum, l) => sum + (l.total_value || 0), 0);
    const profit = f.filter(l => l.type === 'sale' && l.status !== 'void').reduce((sum, l) => sum + (l.gross_profit || 0), 0);

    document.getElementById('repRev').innerHTML = window.formatPrice(revenue);
    document.getElementById('repProf').innerHTML = window.formatPrice(profit);
    document.getElementById('logsBody').innerHTML = f.map(l => `
        <tr class="border-b hover:bg-slate-50 ${l.status==='void'?'opacity-50 line-through':''} group">
            <td class="p-4 text-xs font-bold text-slate-500">${new Date(l.created_at).toLocaleDateString()}</td>
            <td class="text-xs font-bold uppercase"><span class="px-2 py-1 rounded bg-slate-100">${l.type}</span></td>
            <td class="text-xs font-bold text-slate-700">${l.products?.name}</td>
            <td class="text-xs text-slate-500 uppercase">${l.from_loc?.name || 'Unknown'} ➝ ${l.type === 'sale' ? 'Client' : l.locations?.name}</td>
            <td class="text-right font-mono text-xs">${l.quantity}</td>
            <td class="text-right font-mono text-xs text-slate-400">${window.formatPrice(l.unit_cost_snapshot)}</td>
            <td class="text-right font-mono text-xs font-bold text-slate-900">${window.formatPrice(l.total_value)}</td>
            <td class="text-right font-mono text-xs font-bold text-green-600 pr-4">${window.formatPrice(l.gross_profit)}</td>
            ${window.profile.role === 'financial_controller' && l.status !== 'void' ? `<td class="text-right"><button onclick="window.requestDeleteTransaction('${l.id}')" class="text-[10px] text-red-500 border border-red-200 px-2 py-1 rounded hover:bg-red-50">VOID</button></td>` : ''}
        </tr>`).join('');
};

window.exportCSV = () => {
    let rows=[["Date","Type","Item","From","To","Qty","Cost","Value","Profit"]];
    window.currentLogs.forEach(l=>{
        rows.push([new Date(l.created_at).toLocaleDateString(),l.type,l.products?.name,l.from_loc?.name,l.locations?.name,l.quantity,l.unit_cost_snapshot,l.total_value,l.gross_profit]);
    });
    let c="data:text/csv;charset=utf-8,"+rows.map(e=>e.join(",")).join("\n");
    let link=document.createElement("a"); link.href=encodeURI(c); link.download="report.csv"; link.click();
};

window.requestDeleteTransaction = async (id) => { window.premiumConfirm("Void Transaction?", "This requires approval.", "Request", async () => { try { const { error } = await supabase.from('change_requests').insert({ organization_id: window.profile.organization_id, requester_id: window.profile.id, target_table: 'transactions', target_id: id, action: 'VOID', status: 'pending' }); if(error) throw error; window.showNotification("Sent", "success"); } catch(e) { handleError(e, "Delete Trans"); } }); };
window.requestDeleteProduct = async (id) => { window.premiumConfirm("Delete Product?", "Approval required.", "Request", async () => { try { const { error } = await supabase.from('change_requests').insert({ organization_id: window.profile.organization_id, requester_id: window.profile.id, target_table: 'products', target_id: id, action: 'DELETE_PRODUCT', status: 'pending' }); if(error) throw error; window.showNotification("Sent", "success"); } catch(e) { handleError(e, "Delete Prod"); } }); };
window.openStockEdit = (id, q) => { document.getElementById('modal-content').innerHTML=`<h3 class="text-center font-bold mb-4">Edit Stock</h3><input id="newQ" type="number" class="input-field mb-4" value="${q}"><textarea id="newR" class="input-field" placeholder="Reason"></textarea><button onclick="window.execStockEdit('${id}')" class="btn-primary mt-4">SUBMIT</button>`; document.getElementById('modal').style.display='flex'; };
window.execStockEdit = async (id) => { try { const {error} = await supabase.from('change_requests').insert({organization_id:window.profile.organization_id, requester_id:window.profile.id, target_table:'inventory', target_id:id, action:'EDIT_INVENTORY', new_data:{new_qty:document.getElementById('newQ').value, reason:document.getElementById('newR').value}, status:'pending'}); if(error) throw error; document.getElementById('modal').style.display='none'; window.showNotification("Request Sent", "success"); } catch(e) { handleError(e, "Stock Edit"); } };

// --- SETTINGS ---
window.renderSettings = async (c) => { const [l, s] = await Promise.all([supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id), supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id)]); window.cachedLocations = l.data || []; window.cachedSuppliers = s.data || []; const rateRows = ALL_CURRENCIES.map(code => { const val = code === window.baseCurrency ? 1 : (window.currencyRates[code] || ''); return `<div class="flex justify-between items-center py-2 border-b last:border-0"><span class="font-bold text-xs w-10">${code}</span>${code === window.baseCurrency ? '<span class="text-xs font-mono font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded">BASE</span>' : `<input id="rate-${code}" type="number" step="0.01" value="${val}" class="w-24 input-field py-1 text-right font-mono text-xs" placeholder="Rate">`}</div>`; }).join(''); c.innerHTML = `<h1 class="text-3xl font-bold uppercase text-slate-900 mb-8">Settings</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-8"><div class="space-y-8"><div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8"><div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Locations</h3><button onclick="window.addStoreModal()" class="text-[10px] bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold">+ ADD</button></div><table class="w-full text-left"><tbody>${window.cachedLocations.map(l => `<tr class="border-b last:border-0"><td class="py-3 font-bold text-sm uppercase text-slate-700">${l.name}</td><td class="text-xs text-slate-400 uppercase">${l.type.replace('_', ' ')}</td></tr>`).join('')}</tbody></table></div><div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8"><div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Suppliers</h3><button onclick="window.openSupplierModal()" class="text-[10px] bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold">+ NEW</button></div><table class="w-full text-left"><tbody>${window.cachedSuppliers.map(s => `<tr class="border-b last:border-0"><td class="py-3 font-bold text-sm uppercase text-slate-700">${s.name}</td><td class="text-xs text-slate-400 font-mono text-right">${s.tin || '-'}</td></tr>`).join('')}</tbody></table></div></div><div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8"><div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Exchange Rates</h3></div><div class="max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">${rateRows}</div><button onclick="window.saveRates()" class="btn-primary mt-6">UPDATE RATES</button></div></div>`; };
window.addStoreModal = () => { const parents = window.cachedLocations.filter(l => l.type !== 'department').map(l => `<option value="${l.id}">${l.name}</option>`).join(''); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">Add Location</h3><div class="input-group mb-6"><label class="input-label">Location Name</label><input id="locName" class="input-field uppercase"></div><div class="input-group mb-6"><label class="input-label">Type</label><select id="locType" class="input-field" onchange="document.getElementById('parentGrp').style.display = this.value === 'main_store' ? 'none' : 'block'"><option value="sub_store">Camp / Sub-Store</option><option value="department">Department (Bar/Kitchen)</option><option value="main_store">Main Store (HQ)</option></select></div><div id="parentGrp" class="input-group mb-6"><label class="input-label">Parent Store (Linked To)</label><select id="locParent" class="input-field">${parents}</select></div><button onclick="window.execAddStore()" class="btn-primary">CREATE LOCATION</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddStore = async () => { const name = document.getElementById('locName').value; const type = document.getElementById('locType').value; const parent = type === 'main_store' ? null : document.getElementById('locParent').value; if(!name) return; await createLocation(window.profile.organization_id, name, type, parent); document.getElementById('modal').style.display = 'none'; window.showNotification("Location Created", "success"); window.router('settings'); };
window.openSupplierModal = () => { document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Supplier</h3><div class="input-group mb-6"><label class="input-label">Company Name</label><input id="sN" class="input-field uppercase"></div><div class="input-group mb-6"><label class="input-label">TIN Number</label><input id="sT" class="input-field"></div><div class="input-group mb-6"><label class="input-label">Phone Contact</label><input id="sP" class="input-field"></div><div class="input-group mb-6"><label class="input-label">Physical Address</label><input id="sA" class="input-field"></div><button onclick="window.execAddSupplier()" class="btn-primary">SAVE SUPPLIER</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddSupplier = async () => { const name = document.getElementById('sN').value; if(!name) return; await supabase.from('suppliers').insert({ organization_id: window.profile.organization_id, name, tin: document.getElementById('sT').value, contact: document.getElementById('sP').value, address: document.getElementById('sA').value }); document.getElementById('modal').style.display = 'none'; window.showNotification("Supplier Saved", "success"); window.router('settings'); };
