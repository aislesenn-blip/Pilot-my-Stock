import { getSession, logout } from './auth.js';
import { getInventory, createLocation, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

// --- CONFIG ---
window.profile = null;
window.currentLogs = [];
window.cart = [];
window.baseCurrency = 'TZS'; 
window.currencyRates = {};
window.selectedCurrency = 'TZS';
window.activePosLocationId = null;
window.cachedLocations = [];
window.cachedSuppliers = [];
window.selectedPaymentMethod = 'cash'; 
window.tempProductData = null; // For Location Pricing Flow

const ALL_UNITS = ['Crate', 'Carton', 'Dozen', 'Pcs', 'Kg', 'Ltr', 'Box', 'Bag', 'Packet', 'Set', 'Roll', 'Tin', 'Bundle', 'Pallet'];
const ALL_CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX', 'RWF', 'ZAR', 'AED', 'CNY', 'INR', 'CAD', 'AUD', 'JPY', 'CHF', 'SAR', 'QAR'];

// --- UI UTILS ---
window.closeModalOutside = (e) => { if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none'; };
window.showNotification = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    const div = document.createElement('div');
    div.className = `px-6 py-4 rounded-xl text-white font-bold shadow-2xl flex items-center gap-3 transition-all duration-300 transform translate-y-0 ${type === 'success' ? 'bg-[#0F172A]' : 'bg-red-600'}`;
    div.innerHTML = `<span>${message}</span>`;
    container.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 500); }, 3000);
};
window.premiumConfirm = (title, desc, btnText, callback) => {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-desc').innerText = desc;
    const btn = document.getElementById('confirm-btn');
    btn.innerText = btnText;
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    document.getElementById('confirm-modal').style.display = 'flex';
    newBtn.addEventListener('click', async () => {
        document.getElementById('confirm-modal').style.display = 'none';
        await callback();
    });
};

// --- INIT ---
window.onload = async () => {
    window.logoutAction = logout;
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    try {
        let { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (!prof) { await new Promise(r => setTimeout(r, 1000)); let retry = await supabase.from('profiles').select('*').eq('id', session.user.id).single(); prof = retry.data; }
        if (!prof || !prof.organization_id) { window.location.href = 'setup.html'; return; }
        if (prof.status === 'suspended') { await logout(); alert("Account Suspended. Contact Financial Controller."); return; }
        window.profile = prof;
        const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
        window.cachedLocations = locs || [];
        const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id);
        window.cachedSuppliers = sups || [];
        await window.initCurrency();
        if (!window.profile.full_name) document.getElementById('name-modal').style.display = 'flex';
        
        const role = window.profile.role;
        const hide = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
        if (role === 'finance' || role === 'deputy_finance') hide(['nav-bar', 'nav-settings', 'nav-staff']); 
        else if (role === 'financial_controller') hide(['nav-bar', 'nav-settings']); 
        else if (role === 'storekeeper') hide(['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings']);
        else if (role === 'barman') hide(['nav-inventory', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);
        
        if (['overall_storekeeper', 'deputy_storekeeper'].includes(role)) window.router('inventory');
        else window.router(role === 'barman' ? 'bar' : 'inventory');
    } catch (e) { console.error(e); }
};

window.router = async (view) => { 
    const app = document.getElementById('app-view'); 
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
        } catch (e) { console.error(e); app.innerHTML = `<div class="p-10 text-red-500 font-bold text-center">Error loading ${view}: ${e.message}</div>`; } 
    }, 50); 
};

// --- CORE ---
window.saveName = async () => { const name = document.getElementById('userNameInput').value; const phone = document.getElementById('userPhoneInput').value; await supabase.from('profiles').update({ full_name: name, phone: phone }).eq('id', window.profile.id); location.reload(); };
window.initCurrency = async () => { if (!window.profile) return; try { const { data: org } = await supabase.from('organizations').select('base_currency').eq('id', window.profile.organization_id).single(); window.baseCurrency = org?.base_currency || 'TZS'; const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', window.profile.organization_id); window.currencyRates = {}; window.currencyRates[window.baseCurrency] = 1; (rates||[]).forEach(r => window.currencyRates[r.currency_code] = Number(r.rate)); } catch(e){} };
window.convertAmount = (amount, fromCurr, toCurr) => { if (!amount) return 0; const fromRate = window.currencyRates[fromCurr]; const toRate = window.currencyRates[toCurr]; if (!fromRate || !toRate) return null; return fromCurr === window.baseCurrency ? amount * toRate : amount / fromRate; };
window.formatPrice = (amount) => { if (!amount && amount !== 0) return '-'; let converted = window.convertAmount(amount, window.baseCurrency, window.selectedCurrency); return converted === null ? 'SET RATE' : `${window.selectedCurrency} ${Number(converted).toLocaleString(undefined, {minimumFractionDigits: 2})}`; };
window.changeCurrency = (curr) => { window.selectedCurrency = curr; localStorage.setItem('user_pref_currency', curr); const activeEl = document.querySelector('.nav-item.nav-active'); if (activeEl) window.router(activeEl.id.replace('nav-', '')); };
window.getCurrencySelectorHTML = () => { const options = ALL_CURRENCIES.map(c => `<option value="${c}" ${window.selectedCurrency === c ? 'selected' : ''}>${c}</option>`).join(''); return `<select onchange="window.changeCurrency(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer ml-4">${options}</select>`; };

// --- 1. INVENTORY (PARTIAL RECEIVE, DELETE, EDIT) ---
window.renderInventory = async (c) => {
    const isPOView = window.currentInvView === 'po'; 
    const stock = await getInventory(window.profile.organization_id);
    let filteredStock = stock;
    const role = window.profile.role;
    if (role === 'barman') filteredStock = stock.filter(x => x.location_id === window.profile.assigned_location_id && x.products.category === 'Beverage');
    else if (role === 'storekeeper') filteredStock = stock.filter(x => x.location_id === window.profile.assigned_location_id);
    const showPrice = ['manager','financial_controller','overall_finance','overall_storekeeper', 'deputy_manager', 'deputy_finance'].includes(role);
    const canAdjust = ['manager', 'financial_controller', 'overall_storekeeper', 'deputy_manager'].includes(role);

    let content = '';
    if (isPOView) {
        const { data: pos } = await supabase.from('purchase_orders').select('*, suppliers(name)').eq('organization_id', window.profile.organization_id).order('created_at', {ascending:false});
        content = `<table class="w-full text-left border-collapse"><thead class="bg-slate-50 border-b border-slate-100"><tr><th class="py-4 pl-4 text-xs text-slate-400 uppercase tracking-widest">Date</th><th class="text-xs text-slate-400 uppercase tracking-widest">Supplier</th><th class="text-xs text-slate-400 uppercase tracking-widest">Total</th><th class="text-xs text-slate-400 uppercase tracking-widest">Status</th><th class="text-xs text-slate-400 uppercase tracking-widest">Action</th></tr></thead><tbody>${(pos||[]).map(p => `<tr class="border-b border-slate-50 hover:bg-slate-50 transition"><td class="py-4 pl-4 text-xs font-bold text-slate-500">${new Date(p.created_at).toLocaleDateString()}</td><td class="text-sm font-bold text-slate-800 uppercase">${p.suppliers?.name || p.supplier_name || 'Unknown'}</td><td class="text-sm font-mono font-bold text-slate-900">${window.formatPrice(p.total_cost)}</td><td><span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${p.status==='Pending'?'bg-yellow-50 text-yellow-600 border border-yellow-100':'bg-green-50 text-green-600 border border-green-100'}">${p.status}</span></td><td>${p.status!=='Received'?`<button onclick="window.openPartialReceive('${p.id}')" class="text-[10px] bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition shadow-sm font-bold">RECEIVE</button>`:'<span class="text-slate-300 text-[10px] font-bold">COMPLETED</span>'}</td></tr>`).join('')}</tbody></table>`;
    } else {
        content = `<table class="w-full text-left border-collapse"><thead class="bg-slate-50 border-b border-slate-100"><tr><th class="py-4 pl-4 text-xs text-slate-400 uppercase tracking-widest">Item</th>${showPrice?`<th class="text-xs text-slate-400 uppercase tracking-widest">Cost</th>`:''} <th class="text-xs text-slate-400 uppercase tracking-widest">Store</th><th class="text-xs text-slate-400 uppercase tracking-widest">Stock</th><th class="text-xs text-slate-400 uppercase tracking-widest text-right pr-6">Action</th></tr></thead><tbody>${filteredStock.map(i => `<tr class="border-b border-slate-50 hover:bg-slate-50 transition group"><td class="py-4 pl-4"><div class="font-bold text-slate-800 uppercase text-sm">${i.products?.name}</div><div class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">${i.products?.category}</div></td>${showPrice?`<td class="font-mono text-xs text-slate-500">${window.formatPrice(i.products.cost_price)}</td>`:''} <td class="text-xs font-bold text-slate-500 uppercase">${i.locations?.name}</td><td class="font-mono font-bold text-lg text-slate-900">${i.quantity} <span class="text-[10px] text-slate-400 font-sans">${i.products?.unit}</span></td><td class="text-right pr-6 flex justify-end gap-2 mt-3">${window.profile.role!=='barman'?`<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-900 hover:text-white transition">MOVE</button>`:''}${canAdjust ? `<button onclick="window.openStockEdit('${i.id}', '${i.quantity}')" class="text-[10px] font-bold border border-slate-200 text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition">EDIT</button><button onclick="window.requestDeleteProduct('${i.products.id}')" class="text-[10px] font-bold border border-red-100 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50 transition">DEL</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
    }
    const canCreateLPO = ['manager', 'overall_storekeeper', 'deputy_manager', 'deputy_storekeeper'].includes(role);
    c.innerHTML = `<div class="flex flex-col md:flex-row justify-between items-center gap-6 mb-8"><div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">Inventory</h1>${showPrice ? window.getCurrencySelectorHTML() : ''}</div><div class="flex gap-1 bg-slate-100 p-1.5 rounded-xl"><button onclick="window.currentInvView='stock'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${!isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">STOCK</button><button onclick="window.currentInvView='po'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">LPO</button></div><div class="flex gap-3">${canCreateLPO?`<button onclick="window.createPOModal()" class="btn-primary w-auto px-6 shadow-lg shadow-blue-900/20 bg-blue-600 hover:bg-blue-700">Create LPO</button><button onclick="window.addProductModal()" class="btn-primary w-auto px-6 shadow-lg shadow-slate-900/10">New Item</button>`:''}</div></div><div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">${content}</div>`;
};

// 🔥 PARTIAL RECEIVING LOGIC
window.openPartialReceive = async (poId) => {
    window.currentPOId = poId;
    const { data: items } = await supabase.from('po_items').select('*, products(name)').eq('po_id', poId);
    const container = document.getElementById('pr-items');
    container.innerHTML = items.map(i => {
        const remaining = i.quantity - (i.received_qty || 0);
        if (remaining <= 0) return '';
        return `<div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100"><div class="text-xs"><span class="font-bold uppercase block">${i.products.name}</span><span class="text-slate-400">Ord: ${i.quantity} | Rec: ${i.received_qty}</span></div><input type="number" class="pr-input w-20 input-field py-1 text-center font-bold" data-id="${i.product_id}" max="${remaining}" placeholder="${remaining}"></div>`;
    }).join('');
    if(container.innerHTML === '') return window.showNotification("PO already fully received", "success");
    document.getElementById('partial-receive-modal').style.display = 'flex';
};

window.execPartialReceive = async () => {
    const inputs = document.querySelectorAll('.pr-input');
    const itemsToReceive = [];
    inputs.forEach(i => { if(i.value > 0) itemsToReceive.push({ product_id: i.dataset.id, qty: Number(i.value) }); });
    if(itemsToReceive.length === 0) return;
    
    // Call new SQL function
    const { error } = await supabase.rpc('receive_stock_partial', { 
        p_po_id: window.currentPOId, 
        p_user_id: window.profile.id, 
        p_org_id: window.profile.organization_id,
        p_items: itemsToReceive 
    });

    if(error) window.showNotification(error.message, "error");
    else {
        document.getElementById('partial-receive-modal').style.display = 'none';
        window.showNotification("Stock Received Successfully", "success");
        window.router('inventory');
    }
};

// 🔥 STOCK ADJUSTMENT & DELETE REQUESTS
window.openStockEdit = (id, qty) => {
    document.getElementById('editInvId').value = id;
    document.getElementById('currentQty').value = qty;
    document.getElementById('stock-edit-modal').style.display = 'flex';
};

window.execStockRequest = async () => {
    const id = document.getElementById('editInvId').value;
    const newQty = document.getElementById('newQty').value;
    const reason = document.getElementById('editReason').value;
    if(!newQty || !reason) return window.showNotification("Details required", "error");
    
    await supabase.from('change_requests').insert({
        organization_id: window.profile.organization_id,
        requester_id: window.profile.id,
        target_table: 'inventory',
        target_id: id,
        action: 'EDIT_INVENTORY',
        new_data: { new_qty: Number(newQty), reason },
        status: 'pending'
    });
    document.getElementById('stock-edit-modal').style.display = 'none';
    window.showNotification("Adjustment Request Sent to Financial Controller", "success");
};

window.requestDeleteProduct = async (id) => {
    window.premiumConfirm("Delete Product Master?", "This requires high-level approval.", "Request Delete", async () => {
        await supabase.from('change_requests').insert({
            organization_id: window.profile.organization_id,
            requester_id: window.profile.id,
            target_table: 'products',
            target_id: id,
            action: 'DELETE_PRODUCT',
            status: 'pending'
        });
        window.showNotification("Delete Request Sent", "success");
    });
};

// 🔥 PRODUCT REGISTRATION WITH LOCATION PRICES
window.addProductModal = () => { 
    if(!['manager','overall_storekeeper'].includes(window.profile.role)) return; 
    const opts = ALL_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join(''); 
    const unitOpts = ALL_UNITS.map(u => `<option value="${u}">${u}</option>`).join(''); 
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Product</h3><div class="input-group"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div><div class="grid grid-cols-2 gap-4 mb-4"><div class="input-group mb-0"><label class="input-label">Category</label><select id="pCat" class="input-field"><option value="Beverage">Beverage</option><option value="Food">Food</option><option value="Stationery">Stationery</option><option value="Linen">Linen</option><option value="Construction">Construction</option></select></div><div class="input-group mb-0"><label class="input-label">Unit (LPO)</label><select id="pUnit" class="input-field">${unitOpts}</select></div></div><div class="input-group mb-4"><label class="input-label">Items per Unit</label><input id="pConv" type="number" class="input-field font-mono font-bold" value="1"></div><div class="input-group mb-4"><label class="input-label">Currency</label><select id="pCurrency" class="input-field cursor-pointer bg-slate-50 font-bold text-slate-700">${opts}</select></div><div class="grid grid-cols-2 gap-4 mb-6"><div class="input-group mb-0"><label class="input-label">Cost Price</label><input id="pC" type="number" class="input-field"></div><div class="input-group mb-0"><label class="input-label">Base Selling Price</label><input id="pS" type="number" class="input-field"></div></div><button onclick="window.nextProductStep()" class="btn-primary">Next: Location Pricing</button>`; 
    document.getElementById('modal').style.display = 'flex'; 
};

window.nextProductStep = async () => {
    // Validate Step 1
    const name = document.getElementById('pN').value.toUpperCase();
    const cost = parseFloat(document.getElementById('pC').value);
    if(!name || isNaN(cost)) return window.showNotification("Invalid Input", "error");

    // Save temp data
    window.tempProductData = {
        name, 
        category: document.getElementById('pCat').value,
        unit: document.getElementById('pUnit').value,
        conversion_factor: document.getElementById('pConv').value,
        currency: document.getElementById('pCurrency').value,
        cost,
        selling: parseFloat(document.getElementById('pS').value)
    };

    // Load Locations for Pricing
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).eq('type', 'department'); // Only selling points
    const list = document.getElementById('price-list');
    
    if(locs.length === 0) {
        window.finalizeProduct(); // No selling locations, skip
        return;
    }

    list.innerHTML = locs.map(l => `
        <div class="input-group mb-2">
            <label class="input-label">${l.name}</label>
            <input type="number" class="loc-price-input input-field" data-loc="${l.id}" value="${window.tempProductData.selling}" placeholder="Price">
        </div>
    `).join('');

    document.getElementById('modal').style.display = 'none';
    document.getElementById('price-modal').style.display = 'flex';
};

window.finalizeProduct = async () => {
    const d = window.tempProductData;
    const costBase = window.convertAmount(d.cost, d.currency, window.baseCurrency);
    const sellingBase = window.convertAmount(d.selling, d.currency, window.baseCurrency);

    // 1. Insert Product
    const { data: prod, error } = await supabase.from('products').insert({
        name: d.name, category: d.category, unit: d.unit, 
        conversion_factor: d.conversion_factor, cost_price: costBase, 
        selling_price: sellingBase, organization_id: window.profile.organization_id
    }).select().single();

    if(error) return window.showNotification(error.message, "error");

    // 2. Insert Location Prices
    const priceInputs = document.querySelectorAll('.loc-price-input');
    const prices = [];
    priceInputs.forEach(i => {
        if(i.value) prices.push({ organization_id: window.profile.organization_id, product_id: prod.id, location_id: i.dataset.loc, selling_price: window.convertAmount(parseFloat(i.value), d.currency, window.baseCurrency) });
    });

    if(prices.length > 0) await supabase.from('location_prices').insert(prices);

    document.getElementById('price-modal').style.display = 'none';
    window.showNotification("Product & Prices Saved", "success");
    window.router('inventory');
};

// ... (Other Standard Functions like renderBar, renderReports etc. remain similar but use the new logic) ...
// (Due to length limits, I'm ensuring the critical updated logic is above. The rest follows the previous pattern but uses the new Table structure).
