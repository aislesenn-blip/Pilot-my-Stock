import { getSession, logout } from './auth.js';
import { getInventory, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

// ============================================================================
// 1. ENTERPRISE CONFIGURATION & CONSTANTS
// ============================================================================
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
window.tempProductData = null;
window.currentInvView = 'stock';
window.currentRepView = 'general';

// GLOBAL STANDARD CATEGORIES (EXPANDED)
const PRODUCT_CATEGORIES = [
    'Beverage', 'Food', 'Stationery', 'Linen', 
    'Construction', 'Electronics', 'Automotive', 'Cleaning', 
    'Furniture', 'IT Equipment', 'Kitchenware', 'Maintenance', 
    'Chemicals', 'Fuel', 'Medical', 'General'
];

const ALL_UNITS = ['Pcs', 'Crate', 'Carton', 'Dozen', 'Kg', 'Ltr', 'Box', 'Bag', 'Packet', 'Set', 'Roll', 'Tin', 'Bundle', 'Pallet', 'Mita', 'Galoni', 'Trip', 'Bucket'];
const ALL_CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX', 'RWF', 'ZAR', 'AED', 'CNY', 'INR', 'CAD', 'AUD', 'JPY', 'CHF', 'SAR', 'QAR'];

// ============================================================================
// 2. BRANDING ENFORCEMENT (DOM INTERCEPTOR)
// ============================================================================
(function enforceBranding() {
    // Badilisha Title Bar
    document.title = "ugaviSmarT | Enterprise ERP";
    
    // Tafuta na badilisha maandishi yote hata kwenye Login Screen
    const observer = new MutationObserver(() => {
        document.querySelectorAll('.brand-logo, .logo-text, h1, h2, title').forEach(el => {
            if (el.innerText.toLowerCase().includes('pilot')) {
                el.innerText = "ugaviSmarT";
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();

// ============================================================================
// 3. GLOBAL UTILITIES (CRITICAL FUNCTIONS)
// ============================================================================
window.closeModalOutside = (e) => { if (e.target.classList.contains('modal-backdrop')) e.target.style.display = 'none'; };

window.showNotification = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    if(!container) return alert(message); // Fallback protection
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

// Currency Logic (Defined Top-Level to prevent 'not a function' errors)
window.initCurrency = async () => { 
    if (!window.profile) return; 
    try { 
        const { data: org } = await supabase.from('organizations').select('base_currency').eq('id', window.profile.organization_id).single(); 
        window.baseCurrency = org?.base_currency || 'TZS'; 
        const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', window.profile.organization_id); 
        window.currencyRates = {}; 
        window.currencyRates[window.baseCurrency] = 1; 
        (rates||[]).forEach(r => window.currencyRates[r.currency_code] = Number(r.rate)); 
    } catch(e){ console.error("Currency Init Failed", e); } 
};

window.convertAmount = (amount, fromCurr, toCurr) => { 
    if (!amount) return 0; 
    const fromRate = window.currencyRates[fromCurr]; 
    const toRate = window.currencyRates[toCurr]; 
    if (!fromRate || !toRate) return null; 
    return fromCurr === window.baseCurrency ? amount * toRate : amount / fromRate; 
};

window.formatPrice = (amount) => { 
    if (!amount && amount !== 0) return '-'; 
    let converted = window.convertAmount(amount, window.baseCurrency, window.selectedCurrency); 
    return converted === null ? 'SET RATE' : `${window.selectedCurrency} ${Number(converted).toLocaleString(undefined, {minimumFractionDigits: 2})}`; 
};

window.changeCurrency = (curr) => { 
    window.selectedCurrency = curr; 
    localStorage.setItem('user_pref_currency', curr); 
    const activeEl = document.querySelector('.nav-item.nav-active'); 
    if (activeEl) window.router(activeEl.id.replace('nav-', '')); 
};

window.getCurrencySelectorHTML = () => { 
    const options = ALL_CURRENCIES.map(c => `<option value="${c}" ${window.selectedCurrency === c ? 'selected' : ''}>${c}</option>`).join(''); 
    return `<select onchange="window.changeCurrency(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer ml-4 shadow-sm h-8">${options}</select>`; 
};

// ============================================================================
// 4. SYSTEM INITIALIZATION & ROUTING
// ============================================================================
window.onload = async () => {
    window.logoutAction = logout;
    const session = await getSession();
    
    // Security Redirect
    if (!session) { 
        if(!window.location.href.includes('index.html')) window.location.href = 'index.html'; 
        return; 
    }

    try {
        let { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (!prof) { 
            await new Promise(r => setTimeout(r, 1000)); 
            let retry = await supabase.from('profiles').select('*').eq('id', session.user.id).single(); 
            prof = retry.data; 
        }
        
        // Setup Workflow Trigger
        if (!prof || !prof.organization_id) { 
            const setupCurr = document.getElementById('setupBaseCurr'); 
            if(setupCurr) setupCurr.innerHTML = ALL_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
            document.getElementById('name-modal').style.display = 'flex';
            if(session.user.user_metadata?.full_name) document.getElementById('userNameInput').value = session.user.user_metadata.full_name;
            return; 
        }
        
        if (prof.status === 'suspended') { await logout(); alert("Account Suspended. Contact Financial Controller."); return; }
        
        window.profile = prof;
        
        // Cache Critical Data
        const [locsRes, supsRes] = await Promise.all([
            supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id),
            supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id)
        ]);
        window.cachedLocations = locsRes.data || [];
        window.cachedSuppliers = supsRes.data || [];
        
        await window.initCurrency();
        
        // Role-Based UI Control
        const role = window.profile.role;
        const hide = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
        
        if (role === 'finance' || role === 'deputy_finance') hide(['nav-bar', 'nav-settings', 'nav-staff']); 
        else if (role === 'financial_controller') hide(['nav-bar', 'nav-settings']); // Controller sees Reports, Inventory, Staff
        else if (role === 'storekeeper' || role === 'deputy_storekeeper') hide(['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings']);
        else if (role === 'barman') hide(['nav-inventory', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);
        
        // Router Logic
        if (['overall_storekeeper', 'deputy_storekeeper', 'manager', 'deputy_manager', 'financial_controller'].includes(role)) window.router('inventory');
        else window.router(role === 'barman' ? 'bar' : 'inventory');

    } catch (e) { console.error("Init Error:", e); }
};

window.router = async (view) => { 
    const app = document.getElementById('app-view'); 
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div></div>'; 
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active')); 
    const navEl = document.getElementById(`nav-${view}`); 
    if(navEl) navEl.classList.add('nav-active'); 
    
    setTimeout(async () => { 
        try { 
            // All functions are defined below, safe to call
            if (view === 'inventory') await window.renderInventory(app); 
            else if (view === 'bar') await window.renderBar(app); 
            else if (view === 'approvals') await window.renderApprovals(app); 
            else if (view === 'reports') await window.renderReports(app); 
            else if (view === 'staff') await window.renderStaff(app); 
            else if (view === 'settings') await window.renderSettings(app); 
        } catch (e) { 
            console.error(e); 
            app.innerHTML = `<div class="p-10 text-red-500 font-bold text-center">System Error loading ${view}: ${e.message}</div>`; 
        } 
    }, 50); 
};

window.saveName = async () => { 
    const orgName = document.getElementById('orgNameInput').value;
    const name = document.getElementById('userNameInput').value; 
    const phone = document.getElementById('userPhoneInput').value; 
    if (!orgName || !name) return window.showNotification("All Fields Required", "error");
    const { data, error } = await supabase.rpc('create_setup_data', { p_org_name: orgName, p_full_name: name, p_phone: phone });
    if (error) return window.showNotification("Setup Error: " + error.message, "error");
    document.getElementById('name-modal').style.display = 'none';
    window.showNotification("Welcome to ugaviSmarT", "success");
    location.reload(); 
};

// ============================================================================
// 5. INVENTORY MANAGEMENT (Oracle Standard)
// ============================================================================
window.renderInventory = async (c) => {
    const isPOView = window.currentInvView === 'po'; 
    
    // LOGIC: Financial Controller sees ALL Stock regardless of location
    let stock = [];
    if (window.profile.role === 'financial_controller') {
        // Fetch ALL stock for Controller
        const res = await supabase.from('inventory').select('*, products(*), locations(name)').eq('organization_id', window.profile.organization_id);
        stock = res.data || [];
    } else {
        stock = await getInventory(window.profile.organization_id);
    }

    let filteredStock = stock;
    const role = window.profile.role;
    
    // Additional Filtering
    if (role === 'barman') filteredStock = stock.filter(x => x.location_id === window.profile.assigned_location_id && x.products.category === 'Beverage');
    else if (role.includes('storekeeper')) filteredStock = stock.filter(x => x.location_id === window.profile.assigned_location_id);
    
    const showPrice = ['manager', 'deputy_manager', 'financial_controller', 'overall_finance'].includes(role);
    const canAdjust = ['manager', 'deputy_manager', 'financial_controller', 'overall_storekeeper'].includes(role);
    const canCreateLPO = ['manager', 'deputy_manager', 'overall_storekeeper', 'financial_controller'].includes(role);

    let content = '';
    
    if (isPOView) {
        const { data: pos } = await supabase.from('purchase_orders').select('*, suppliers(name)').eq('organization_id', window.profile.organization_id).order('created_at', {ascending:false});
        content = `
        <table class="w-full text-left border-collapse">
            <thead class="bg-slate-50 border-b border-slate-100">
                <tr><th class="py-4 pl-4 text-xs text-slate-400 uppercase">Date</th><th class="text-xs text-slate-400 uppercase">Supplier</th><th class="text-xs text-slate-400 uppercase">Total</th><th class="text-xs text-slate-400 uppercase">Status</th><th class="text-xs text-slate-400 uppercase">Action</th></tr>
            </thead>
            <tbody>
                ${(pos||[]).map(p => `
                <tr class="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td class="py-4 pl-4 text-xs font-bold text-slate-500">${new Date(p.created_at).toLocaleDateString()}</td>
                    <td class="text-sm font-bold text-slate-800 uppercase">${p.suppliers?.name || 'Unknown'}</td>
                    <td class="text-sm font-mono font-bold text-slate-900">${window.formatPrice(p.total_cost)}</td>
                    <td><span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase ${p.status==='Pending'?'bg-yellow-50 text-yellow-600': p.status==='Partial'?'bg-blue-50 text-blue-600' :'bg-green-50 text-green-600'}">${p.status}</span></td>
                    <td>${p.status !== 'Received' ? `<button onclick="window.openReceiveModal('${p.id}')" class="text-[10px] bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 font-bold shadow-sm">RECEIVE (GRN)</button>` : '<span class="text-slate-300 text-[10px] font-bold">COMPLETED</span>'}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    } else {
        content = `
        <table class="w-full text-left border-collapse">
            <thead class="bg-slate-50 border-b border-slate-100">
                <tr><th class="py-4 pl-4 text-xs text-slate-400 uppercase">Item</th>${showPrice?`<th class="text-xs text-slate-400 uppercase">Cost</th>`:''} <th class="text-xs text-slate-400 uppercase">Store</th><th class="text-xs text-slate-400 uppercase">Stock</th><th class="text-xs text-slate-400 uppercase text-right pr-6">Action</th></tr>
            </thead>
            <tbody>
                ${filteredStock.map(i => `
                <tr class="border-b border-slate-50 hover:bg-slate-50 transition group">
                    <td class="py-4 pl-4"><div class="font-bold text-slate-800 uppercase text-sm">${i.products?.name}</div><div class="text-[10px] text-slate-400 font-bold uppercase mt-0.5">${i.products?.category}</div></td>
                    ${showPrice?`<td class="font-mono text-xs text-slate-500">${window.formatPrice(i.products.cost_price)}</td>`:''} 
                    <td class="text-xs font-bold text-slate-500 uppercase">${i.locations?.name}</td>
                    <td class="font-mono font-bold text-lg text-slate-900">${i.quantity} <span class="text-[10px] text-slate-400 font-sans">${i.products?.unit}</span></td>
                    <td class="text-right pr-6 flex justify-end gap-2 mt-3">
                        ${window.profile.role!=='barman'?`<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-900 hover:text-white transition">MOVE</button>`:''}
                        ${canAdjust ? `
                            <button onclick="window.openStockEdit('${i.id}', '${i.quantity}')" class="text-[10px] font-bold border border-slate-200 text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition">EDIT</button>
                            <button onclick="window.requestDeleteProduct('${i.products.id}')" class="text-[10px] font-bold border border-red-100 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50 transition">DEL</button>
                        ` : ''}
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    }
    
    c.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
        <div class="flex items-center gap-4">
            <h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">Inventory</h1>
            ${showPrice ? window.getCurrencySelectorHTML() : ''}
        </div>
        <div class="flex gap-1 bg-slate-100 p-1.5 rounded-xl">
            <button onclick="window.currentInvView='stock'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${!isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">STOCK</button>
            <button onclick="window.currentInvView='po'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">LPO</button>
        </div>
        <div class="flex gap-3">
            ${canCreateLPO?`<button onclick="window.createPOModal()" class="btn-primary w-auto px-6 shadow-lg shadow-blue-900/20 bg-blue-600 hover:bg-blue-700">Create LPO</button><button onclick="window.addProductModal()" class="btn-primary w-auto px-6 shadow-lg shadow-slate-900/10">New Item</button>`:''}
        </div>
    </div>
    <div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">${content}</div>`;
};

// ============================================================================
// 6. LPO & PRODUCT (PARTIAL RECEIVING & VALIDATION)
// ============================================================================

// A. Create LPO (Strict Supplier Check)
window.createPOModal = async () => { 
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', window.profile.organization_id).order('name'); 
    const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id); 
    
    if(!sups || sups.length === 0) return window.showNotification("No Suppliers Found. Register in Settings.", "error");
    if(!prods || prods.length === 0) return window.showNotification("No Products Found. Register Products first.", "error"); 
    
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-xl mb-6 uppercase text-center">Create LPO</h3>
        <div class="input-group mb-4">
            <label class="input-label">Select Supplier</label>
            <select id="lpoSup" class="input-field font-bold text-slate-800 border-2 border-slate-200 focus:border-slate-900">
                ${sups.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
            </select>
        </div>
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6 max-h-[300px] overflow-y-auto custom-scrollbar">
            ${prods.map(p => `
                <div class="flex items-center gap-3 bg-white p-3 rounded-lg border border-slate-100 mb-2">
                    <input type="checkbox" class="lpo-check w-5 h-5 accent-slate-900" value="${p.id}" data-price="${p.cost_price}">
                    <div class="flex-1"><span class="block text-xs font-bold uppercase">${p.name}</span><span class="text-[10px] text-slate-400">Cost: ${window.formatPrice(p.cost_price)}</span></div>
                    <input type="number" id="qty-${p.id}" class="w-20 input-field py-1 text-center font-bold" placeholder="Qty">
                </div>
            `).join('')}
        </div>
        <button onclick="window.execCreatePO()" class="btn-primary w-full">GENERATE ORDER</button>
    `; 
    document.getElementById('modal').style.display = 'flex'; 
};

window.execCreatePO = async () => { 
    const supSelect = document.getElementById('lpoSup');
    const supId = supSelect.value;
    const supName = supSelect.options[supSelect.selectedIndex].text;
    const checks = document.querySelectorAll('.lpo-check:checked'); 
    
    if(!supId || !checks.length) return window.showNotification("Invalid Selection", "error"); 
    
    let total = 0, items = []; 
    checks.forEach(c => { 
        const qty = document.getElementById(`qty-${c.value}`).value; 
        if(qty > 0) { 
            const cost = c.getAttribute('data-price'); 
            total += (qty * cost); 
            items.push({ product_id: c.value, quantity: qty, unit_cost: cost, received_qty: 0 }); // Init received_qty
        } 
    }); 
    
    if(items.length === 0) return window.showNotification("Quantity required for selected items", "error");

    const poData = { organization_id: window.profile.organization_id, created_by: window.profile.id, supplier_id: supId, supplier_name: supName, total_cost: total, status: 'Pending' }; 
    const { data: po, error } = await supabase.from('purchase_orders').insert(poData).select().single(); 
    
    if(error) return window.showNotification("Failed to create PO: " + error.message, "error");

    await supabase.from('po_items').insert(items.map(i => ({...i, po_id: po.id}))); 
    
    document.getElementById('modal').style.display = 'none'; 
    window.showNotification("LPO Created Successfully", "success"); 
    window.currentInvView = 'po'; 
    window.router('inventory'); 
};

// B. Partial Receiving (GRN Modal) - NEW ENTERPRISE FEATURE
window.openReceiveModal = async (poId) => {
    // Fetch items specifically for this PO
    const { data: items } = await supabase.from('po_items').select('*, products(name, unit)').eq('po_id', poId);
    
    if(!items || items.length === 0) return window.showNotification("No items found in this LPO", "error");

    const itemRows = items.map(i => {
        const remaining = i.quantity - (i.received_qty || 0);
        if(remaining <= 0) return ''; // Skip fully received items
        return `
        <div class="flex justify-between items-center mb-3 bg-slate-50 p-3 rounded-lg border">
            <div class="w-1/2">
                <span class="block text-xs font-bold uppercase text-slate-800">${i.products?.name}</span>
                <span class="text-[10px] text-slate-500">Ordered: ${i.quantity} | Received: ${i.received_qty}</span>
            </div>
            <div class="w-1/2 flex gap-2 items-center justify-end">
                <span class="text-[10px] font-bold text-slate-400">Receive Now:</span>
                <input type="number" class="receive-input w-20 input-field text-center font-bold text-blue-600" 
                       data-id="${i.id}" data-pid="${i.products.id}" data-cost="${i.unit_cost}" max="${remaining}" placeholder="${remaining}">
            </div>
        </div>`;
    }).join('');

    if(!itemRows) return window.showNotification("All items already received.", "success");

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-2 uppercase text-center">Goods Received Note (GRN)</h3>
        <p class="text-xs text-center text-slate-400 mb-6">LPO #${poId.split('-')[0]}</p>
        <div class="mb-6 max-h-[400px] overflow-y-auto custom-scrollbar">${itemRows}</div>
        <button onclick="window.execReceivePO('${poId}')" class="btn-primary w-full bg-blue-600 hover:bg-blue-700">CONFIRM RECEIPT</button>
    `;
    document.getElementById('modal').style.display = 'flex';
};

window.execReceivePO = async (poId) => {
    const inputs = document.querySelectorAll('.receive-input');
    const itemsToReceive = [];
    
    inputs.forEach(inp => {
        const qty = parseFloat(inp.value);
        if(qty > 0) {
            itemsToReceive.push({
                product_id: inp.dataset.pid,
                qty: qty,
                unit_cost: parseFloat(inp.dataset.cost)
            });
        }
    });

    if(itemsToReceive.length === 0) return window.showNotification("No quantities entered", "error");

    window.premiumConfirm("Confirm Goods Receipt", "This will update stock and WAC.", "Confirm", async () => {
        const { error } = await supabase.rpc('receive_stock_partial', {
            p_po_id: poId,
            p_user_id: window.profile.id,
            p_org_id: window.profile.organization_id,
            p_items: itemsToReceive // JSONB array
        });

        if(error) window.showNotification(error.message, "error");
        else {
            window.showNotification("Stock Received Successfully", "success");
            document.getElementById('modal').style.display = 'none';
            window.router('inventory');
        }
    });
};

// C. Product Wizard (Restored Categories)
window.addProductModal = () => { 
    if(!['manager','overall_storekeeper'].includes(window.profile.role)) return; 
    const unitOpts = ALL_UNITS.map(u => `<option value="${u}">${u}</option>`).join(''); 
    const catOpts = PRODUCT_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
    const currOpts = ALL_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase text-center">New Product</h3>
        <div class="input-group"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div>
        <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="input-group mb-0"><label class="input-label">Category</label><select id="pCat" class="input-field">${catOpts}</select></div>
            <div class="input-group mb-0"><label class="input-label">Unit</label><select id="pUnit" class="input-field">${unitOpts}</select></div>
        </div>
        <div class="input-group mb-4"><label class="input-label">Conversion</label><input id="pConv" type="number" class="input-field" value="1"></div>
        <div class="input-group mb-4"><label class="input-label">Currency</label><select id="pCurrency" class="input-field">${currOpts}</select></div>
        <div class="grid grid-cols-2 gap-4 mb-6">
            <div class="input-group mb-0"><label class="input-label">Cost</label><input id="pC" type="number" class="input-field"></div>
            <div class="input-group mb-0"><label class="input-label">Selling</label><input id="pS" type="number" class="input-field"></div>
        </div>
        <button onclick="window.nextProductStep()" class="btn-primary">Next: Prices</button>`; 
    document.getElementById('modal').style.display = 'flex'; 
};

window.nextProductStep = async () => {
    const name = document.getElementById('pN').value.toUpperCase();
    const cost = parseFloat(document.getElementById('pC').value);
    if(!name || isNaN(cost)) return window.showNotification("Invalid Input", "error");
    window.tempProductData = { name, category: document.getElementById('pCat').value, unit: document.getElementById('pUnit').value, conversion_factor: document.getElementById('pConv').value, currency: document.getElementById('pCurrency').value, cost, selling: parseFloat(document.getElementById('pS').value) };
    const campHtml = window.cachedLocations.map(l => `<div class="flex justify-between items-center mb-2 bg-slate-50 p-2 rounded"><span class="text-xs font-bold w-1/2">${l.name}</span><input type="number" class="loc-price-input input-field w-1/2 text-right" data-loc="${l.id}" value="${window.tempProductData.selling}"></div>`).join('');
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 text-center">Camp Pricing</h3><div class="mb-6 max-h-60 overflow-y-auto pr-1">${campHtml}</div><button onclick="window.finalizeProduct()" class="btn-primary">SAVE</button>`;
};

window.finalizeProduct = async () => {
    const d = window.tempProductData;
    const costBase = window.convertAmount(d.cost, d.currency, window.baseCurrency);
    const sellingBase = window.convertAmount(d.selling, d.currency, window.baseCurrency);
    const { data: prod, error } = await supabase.from('products').insert({ name: d.name, category: d.category, unit: d.unit, conversion_factor: d.conversion_factor, cost_price: costBase, selling_price: sellingBase, organization_id: window.profile.organization_id }).select().single();
    if(error) return window.showNotification(error.message, "error");
    const inputs = document.querySelectorAll('.loc-price-input');
    const prices = [];
    inputs.forEach(i => { if(i.value) prices.push({ organization_id: window.profile.organization_id, product_id: prod.id, location_id: i.dataset.loc, selling_price: window.convertAmount(parseFloat(i.value), d.currency, window.baseCurrency) }); });
    if(prices.length) await supabase.from('location_prices').insert(prices);
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Product Added", "success");
    window.router('inventory');
};

// ============================================================================
// 7. BAR / POS (UNIT SALES & PAYMENT MODES)
// ============================================================================
window.renderBar = async (c) => {
    const inv = await getInventory(window.profile.organization_id);
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).eq('type', 'department');
    if (window.profile.role === 'barman') window.activePosLocationId = window.profile.assigned_location_id;
    else if (!window.activePosLocationId && locs.length) window.activePosLocationId = locs[0].id;
    const items = inv.filter(x => x.location_id === window.activePosLocationId && x.products.category === 'Beverage');
    const storeSelect = (window.profile.role !== 'barman') ? `<div class="mb-8 flex items-center gap-4"><span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Active Counter:</span><select onchange="window.switchBar(this.value)" class="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-slate-900 cursor-pointer shadow-sm min-w-[200px]">${locs.map(l => `<option value="${l.id}" ${window.activePosLocationId===l.id?'selected':''}>${l.name}</option>`).join('')}</select></div>` : '';
    const payMethods = ['Cash', 'Mobile Money', 'Credit Card', 'Room Charge'].map(m => `<button onclick="window.setPaymentMethod('${m}')" class="pay-btn flex-1 py-2 text-[10px] font-bold uppercase rounded-lg border transition ${window.selectedPaymentMethod === m ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}">${m}</button>`).join('');
    
    c.innerHTML = `${storeSelect} <div class="flex flex-col lg:flex-row gap-8 h-[calc(100vh-140px)]"><div class="flex-1 overflow-y-auto pr-2"><div class="flex justify-between items-center mb-6 sticky top-0 bg-[#F8FAFC] py-2 z-10"><h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">POS Terminal</h1>${window.getCurrencySelectorHTML()}</div><div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 pb-20">${items.length ? items.map(x => `<div onclick="window.addCart('${x.products.name}', ${x.products.selling_price}, '${x.product_id}')" class="bg-white p-5 rounded-2xl border border-slate-100 cursor-pointer hover:border-slate-900 transition-all duration-200 hover:shadow-lg hover:-translate-y-1 group relative overflow-hidden"><div class="flex justify-between items-start mb-2"><div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 font-bold text-[10px] group-hover:bg-slate-900 group-hover:text-white transition">${x.products.name.charAt(0)}</div><span class="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full border border-slate-100 group-hover:border-slate-200">Qty: ${x.quantity}</span></div><p class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 truncate">${x.products.name}</p><p class="text-lg font-bold text-slate-900 font-mono">${window.formatPrice(x.products.selling_price)}</p></div>`).join('') : '<div class="col-span-full py-20 text-center border-2 border-dashed border-slate-200 rounded-3xl"><p class="text-slate-400 font-bold text-sm uppercase">No beverages available.</p></div>'}</div></div><div class="w-full lg:w-96 bg-white border border-slate-200 rounded-[32px] p-8 h-full flex flex-col shadow-2xl shadow-slate-200/50"><div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase text-slate-900 tracking-widest">Current Order</h3><button onclick="window.cart=[];window.renderCart()" class="text-[10px] font-bold text-red-500 hover:bg-red-50 px-2 py-1 rounded transition">CLEAR ALL</button></div><div id="cart-list" class="flex-1 overflow-y-auto space-y-3 pr-1"></div><div class="pt-6 border-t border-slate-100 mt-auto"><div class="mb-4"><p class="text-[10px] font-bold text-slate-400 uppercase mb-2">Payment Method</p><div class="flex gap-2 flex-wrap">${payMethods}</div></div><div class="flex justify-between items-end mb-6"><span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Amount</span><span id="cart-total" class="text-3xl font-bold text-slate-900 font-mono">${window.formatPrice(0)}</span></div><button onclick="window.confirmCheckout()" class="w-full bg-[#0F172A] text-white py-4 rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-slate-800 shadow-xl shadow-slate-900/20 active:scale-95 transition">Charge Sale</button></div></div></div>`;
    window.renderCart();
};
window.switchBar = (id) => { window.activePosLocationId = id; window.router('bar'); };
window.setPaymentMethod = (method) => { window.selectedPaymentMethod = method; window.router('bar'); };
window.addCart = (n,p,id) => { if(!window.cart) window.cart=[]; const x=window.cart.find(c=>c.id===id); if(x)x.qty++; else window.cart.push({name:n,price:p,id,qty:1}); window.renderCart(); };
window.renderCart = () => { const l=document.getElementById('cart-list'), t=document.getElementById('cart-total'); let sum=0; l.innerHTML=(window.cart||[]).map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100 group"><div class="flex flex-col"><span class="text-xs font-bold text-slate-800 uppercase">${i.name}</span><span class="text-[10px] text-slate-400 font-mono">${window.formatPrice(i.price)} x ${i.qty}</span></div><button onclick="window.remCart('${i.id}')" class="w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-500 transition">✕</button></div>`}).join(''); t.innerText=window.formatPrice(sum); };
window.remCart = (id) => { window.cart=window.cart.filter(c=>c.id!==id); window.renderCart(); };
window.confirmCheckout = () => { if(!window.cart.length) return; window.premiumConfirm(`Confirm ${window.selectedPaymentMethod.toUpperCase()} Sale?`, "Charge this amount.", "Charge", window.doCheckout); };
window.doCheckout = async () => { try { await processBarSale(window.profile.organization_id, window.activePosLocationId, window.cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), window.profile.id, window.selectedPaymentMethod); window.showNotification("Sale Completed Successfully", "success"); window.cart=[]; window.renderCart(); window.router('bar'); } catch(e) { window.showNotification(e.message, "error"); } };

// ============================================================================
// 8. APPROVALS & STAFF (HIERARCHY RESTORED)
// ============================================================================
window.renderApprovals = async (c) => {
    if(window.profile.role === 'storekeeper' || window.profile.role === 'barman') return c.innerHTML = '<div class="p-20 text-center text-slate-400 font-bold">Restricted Area</div>';
    const reqs = await getPendingApprovals(window.profile.organization_id);
    const { data: changes } = await supabase.from('change_requests').select('*, requester:requester_id(full_name)').eq('organization_id', window.profile.organization_id).eq('status', 'pending');
    c.innerHTML = `
    <h1 class="text-3xl font-bold mb-8 uppercase text-slate-900 tracking-tight">Pending Approvals</h1>
    <div class="mb-8"><h3 class="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Stock Transfers</h3><div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${reqs.length ? reqs.map(r => `<tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition"><td class="p-6"><div class="font-bold text-sm uppercase text-slate-900">${r.products?.name}</div><div class="text-xs text-slate-400 uppercase mt-1">From: ${r.from_loc?.name || 'Main'}</div></td><td class="p-6"><div class="text-blue-600 font-mono font-bold text-lg">${r.quantity}</div><div class="text-xs text-slate-400 uppercase mt-1">Requested</div></td><td class="p-6 text-xs font-bold text-slate-500 uppercase tracking-wider">To: ${r.to_loc?.name}</td><td class="p-6 text-right"><button onclick="window.confirmApprove('${r.id}')" class="text-[10px] bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800 transition shadow-lg">AUTHORIZE</button></td></tr>`).join('') : '<tr><td colspan="4" class="p-8 text-center text-xs font-bold text-slate-300 uppercase">No transfer requests.</td></tr>'}</tbody></table></div></div>
    <div><h3 class="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Admin Requests (Void/Adjust)</h3><div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${changes && changes.length ? changes.map(r => `<tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition"><td class="p-6"><div class="font-bold text-sm uppercase text-red-600">${r.action}</div><div class="text-xs text-slate-400 uppercase mt-1">By: ${r.requester?.full_name}</div></td><td class="p-6 text-xs font-mono text-slate-500">${new Date(r.created_at).toLocaleString()}</td><td class="p-6 text-right"><button onclick="window.approveChange('${r.id}')" class="text-[10px] bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-700 transition shadow-lg">APPROVE</button></td></tr>`).join('') : '<tr><td colspan="3" class="p-8 text-center text-xs font-bold text-slate-300 uppercase">No admin requests.</td></tr>'}</tbody></table></div></div>`;
};
window.confirmApprove = (id) => { window.premiumConfirm("Authorize Transfer?", "Move stock?", "Authorize", async () => { await respondToApproval(id, 'approved', window.profile.id); window.showNotification("Authorized", "success"); window.router('approvals'); }); };
window.approveChange = (id) => { window.premiumConfirm("Approve Change?", "Execute this request.", "Approve", async () => { await supabase.rpc('process_change_request', { p_request_id: id, p_status: 'approved', p_reviewer_id: window.profile.id }); window.showNotification("Executed", "success"); window.router('approvals'); }); };

window.renderStaff = async (c) => {
    if(!['manager', 'financial_controller'].includes(window.profile.role)) return c.innerHTML = '<div class="p-20 text-center text-slate-400 font-bold">Access Restricted</div>';
    const [staff, invites] = await Promise.all([
        supabase.from('profiles').select('*, locations(name)').eq('organization_id', window.profile.organization_id),
        supabase.from('staff_invites').select('*, locations(name)').eq('organization_id', window.profile.organization_id).eq('status', 'pending')
    ]);
    c.innerHTML = `
    <div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase">Team</h1><button onclick="window.inviteModal()" class="btn-primary w-auto px-6">INVITE</button></div>
    <div class="bg-white rounded-3xl border shadow-sm overflow-hidden mb-8">
        <table class="w-full text-left">
            <thead class="bg-slate-50 border-b"><tr><th class="p-4 text-xs text-slate-400 uppercase">User</th><th class="text-xs text-slate-400 uppercase">Role</th><th class="text-xs text-slate-400 uppercase">Loc</th><th class="text-xs text-slate-400 uppercase text-right pr-6">Action</th></tr></thead>
            <tbody>${staff.data.map(s => `
                <tr class="border-b last:border-0 hover:bg-slate-50 transition">
                    <td class="p-4 font-bold text-slate-700">${s.full_name}<br><span class="text-[10px] text-slate-400 font-normal">${s.email}</span></td>
                    <td class="text-xs uppercase">${s.role.replace('_', ' ')}</td>
                    <td class="text-xs uppercase">${s.locations?.name || 'Global'}</td>
                    <td class="text-right pr-6 flex justify-end gap-2 mt-3">
                        <button onclick="window.viewStaffDetails('${s.id}')" class="text-[10px] border px-2 py-1 rounded hover:bg-slate-100">LOGS</button>
                        <button onclick="window.reassignModal('${s.id}', '${s.full_name}')" class="text-[10px] border px-2 py-1 rounded hover:bg-slate-100">MOVE</button>
                        <button onclick="window.toggleSuspend('${s.id}', '${s.status}')" class="text-[10px] border px-2 py-1 rounded ${s.status==='active'?'text-red-500 hover:bg-red-50':'text-green-500 hover:bg-green-50'}">${s.status==='active'?'SUSPEND':'ACTIVATE'}</button>
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>
    </div>`;
};

window.inviteModal = () => {
    // Logic: If role is FC or Manager, they can invite Global roles (No Location)
    const locOpts = window.cachedLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase text-center">Invite Staff</h3>
        <div class="input-group"><label class="input-label">Email</label><input id="iE" type="email" class="input-field"></div>
        <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="input-group mb-0"><label class="input-label">Role</label>
                <select id="iR" class="input-field" onchange="window.toggleLocSelect(this.value)">
                    <option value="storekeeper">Storekeeper</option>
                    <option value="deputy_storekeeper">Deputy Storekeeper</option>
                    <option value="barman">Barman</option>
                    <option value="finance">Finance</option>
                    <option value="deputy_finance">Deputy Finance</option>
                    <option value="financial_controller">Financial Controller (Global)</option>
                    <option value="deputy_manager">Deputy Manager</option>
                </select>
            </div>
            <div class="input-group mb-0" id="locDiv"><label class="input-label">Assign To</label><select id="iL" class="input-field">${locOpts}</select></div>
        </div>
        <button onclick="window.execInvite()" class="btn-primary">SEND INVITE</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.toggleLocSelect = (role) => {
    // FC has no location assignment
    const div = document.getElementById('locDiv');
    if (role === 'financial_controller') div.style.display = 'none';
    else div.style.display = 'block';
};

window.execInvite = async () => {
    const email = document.getElementById('iE').value;
    const role = document.getElementById('iR').value;
    const loc = role === 'financial_controller' ? null : document.getElementById('iL').value;
    
    if(!email) return;
    await supabase.from('staff_invites').insert({
        organization_id: window.profile.organization_id,
        email, role, assigned_location_id: loc, status: 'pending'
    });
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Invite Sent", "success");
    window.renderStaff(document.getElementById('app-view'));
};

// Staff Action Helpers
window.viewStaffDetails = async (id) => { const [l,p] = await Promise.all([supabase.from('audit_logs').select('*').eq('user_id', id).limit(5), supabase.from('profiles').select('*').eq('id', id).single()]); document.getElementById('modal-content').innerHTML=`<h3 class="text-center font-bold mb-4">${p.data.full_name}</h3><div class="bg-slate-50 p-4 rounded">${l.data.map(x=>`<div>${x.action}</div>`).join('')}</div>`; document.getElementById('modal').style.display='flex'; };
window.reassignModal = (id, n) => { const opts=window.cachedLocations.map(l=>`<option value="${l.id}">${l.name}</option>`).join(''); document.getElementById('modal-content').innerHTML=`<h3 class="text-center font-bold mb-4">Move ${n}</h3><select id="nLoc" class="input-field mb-4">${opts}</select><button onclick="window.doReassign('${id}')" class="btn-primary">MOVE</button>`; document.getElementById('modal').style.display='flex'; };
window.doReassign = async (id) => { await supabase.from('profiles').update({assigned_location_id:document.getElementById('nLoc').value}).eq('id',id); document.getElementById('modal').style.display='none'; window.renderStaff(document.getElementById('app-view')); };
window.toggleSuspend = async (id, s) => { await supabase.from('profiles').update({status: s==='active'?'suspended':'active'}).eq('id', id); window.renderStaff(document.getElementById('app-view')); };
window.cancelInvite = async (id) => { await supabase.from('staff_invites').delete().eq('id',id); window.renderStaff(document.getElementById('app-view')); };

// ============================================================================
// 9. REPORTS & SETTINGS (COMPLETE)
// ============================================================================
window.renderReports = async (c) => {
    const isController = ['financial_controller', 'manager', 'overall_finance'].includes(window.profile.role);
    const isVariance = window.currentRepView === 'variance';
    
    if(isVariance) {
        const { data: takes } = await supabase.from('stock_takes').select('*, locations(name), profiles(full_name)').eq('organization_id', window.profile.organization_id).order('created_at', {ascending:false});
        c.innerHTML = `<div class="flex justify-between mb-8"><h1 class="text-3xl font-bold">Reconciliation</h1><div class="flex gap-2"><button onclick="window.currentRepView='general';window.router('reports')" class="px-4 py-2 border rounded">General</button><button class="px-4 py-2 bg-slate-900 text-white rounded">Variance</button></div><button onclick="window.newStockTakeModal()" class="btn-primary w-auto px-4">NEW AUDIT</button></div><table class="w-full text-left"><thead><tr class="bg-slate-50"><th class="p-4">Date</th><th>Location</th><th>Auditor</th><th>Action</th></tr></thead><tbody>${takes.map(t=>`<tr><td class="p-4">${new Date(t.created_at).toLocaleDateString()}</td><td>${t.locations?.name}</td><td>${t.profiles?.full_name}</td><td><button onclick="window.viewVariance('${t.id}')" class="text-blue-600 font-bold">VIEW</button></td></tr>`).join('')}</tbody></table>`;
    } else {
        // General Report Logic
        const { data: logs } = await supabase.from('transactions').select(`*, products(name, category), locations:to_location_id(name), from_loc:from_location_id(name), profiles:user_id(full_name)`).eq('organization_id', window.profile.organization_id).order('created_at', { ascending: false }).limit(500);
        window.currentLogs = logs || [];
        c.innerHTML = `
        <div class="flex flex-col gap-6 mb-8">
            <div class="flex justify-between items-center"><h1 class="text-3xl font-bold">Reports</h1><div class="flex gap-2"><button class="px-4 py-2 bg-slate-900 text-white rounded">General</button><button onclick="window.currentRepView='variance';window.router('reports')" class="px-4 py-2 border rounded">Variance</button></div></div>
            <div class="bg-white p-4 rounded-xl border flex gap-4 flex-wrap">
                <input type="date" id="rStart" class="input-field w-32" onchange="window.filterReport()">
                <input type="date" id="rEnd" class="input-field w-32" onchange="window.filterReport()">
                <select id="rType" class="input-field w-40" onchange="window.filterReport()"><option value="all">All Types</option><option value="sale">Sales</option><option value="receive">Received</option><option value="transfer">Transfers</option></select>
                <button onclick="window.exportCSV()" class="btn-primary w-auto px-4 bg-green-600">EXPORT CSV</button>
            </div>
        </div>
        <div class="bg-white rounded-xl border overflow-hidden"><table class="w-full text-left"><thead class="bg-slate-50"><tr><th class="p-4">Date</th><th>Type</th><th>Item</th><th>Flow</th><th>Detail</th><th class="text-right">Qty</th><th class="text-right">Value</th>${isController?'<th>Action</th>':''}</tr></thead><tbody id="logsBody"></tbody></table></div>`;
        window.filterReport();
    }
};

window.filterReport = () => {
    const start = document.getElementById('rStart')?.value;
    const end = document.getElementById('rEnd')?.value;
    const type = document.getElementById('rType')?.value;
    let f = window.currentLogs;
    if(start) f = f.filter(l => new Date(l.created_at) >= new Date(start));
    if(end) f = f.filter(l => new Date(l.created_at) <= new Date(end));
    if(type && type !== 'all') f = f.filter(l => l.type === type);
    
    const isController = ['financial_controller', 'manager'].includes(window.profile.role);
    document.getElementById('logsBody').innerHTML = f.map(l => `
        <tr class="border-b hover:bg-slate-50 ${l.status==='void'?'opacity-50 line-through':''}">
            <td class="p-4 text-xs font-bold text-slate-500">${new Date(l.created_at).toLocaleDateString()}</td>
            <td class="text-xs font-bold uppercase">${l.type}</td>
            <td class="text-xs">${l.products?.name}</td>
            <td class="text-xs text-slate-500">${l.from_loc?.name||'-'} -> ${l.locations?.name}</td>
            <td class="text-[10px] font-bold">${l.payment_method || l.reference || '-'}</td>
            <td class="text-right font-mono text-sm">${l.quantity}</td>
            <td class="text-right font-mono text-sm font-bold">${window.formatPrice(l.total_value)}</td>
            ${isController && l.status!=='void' ? `<td><button onclick="window.requestDeleteTransaction('${l.id}')" class="text-[9px] text-red-600 border border-red-200 px-2 rounded">VOID</button></td>` : '<td></td>'}
        </tr>`).join('');
};

window.renderSettings = async (c) => {
    const [l, s] = await Promise.all([
        supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id),
        supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id)
    ]);
    const rateRows = ALL_CURRENCIES.map(code => {
        const val = code === window.baseCurrency ? 1 : (window.currencyRates[code] || '');
        return `<div class="flex justify-between py-2 border-b"><span class="font-bold text-xs w-10">${code}</span><input id="rate-${code}" type="number" step="0.01" value="${val}" class="w-24 input-field py-1 text-right text-xs" placeholder="Rate"></div>`;
    }).join('');

    c.innerHTML = `
    <h1 class="text-3xl font-bold mb-8">Settings</h1>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
            <div class="flex justify-between mb-4"><h3 class="font-bold">Locations</h3><button onclick="window.addStoreModal()" class="text-xs bg-slate-900 text-white px-3 py-1 rounded">+ ADD</button></div>
            <div class="bg-white rounded border p-4">${l.data.map(x=>`<div class="border-b py-2 flex justify-between"><span>${x.name}</span><span class="text-xs text-slate-400">${x.type}</span></div>`).join('')}</div>
            <div class="flex justify-between mb-4 mt-8"><h3 class="font-bold">Suppliers</h3><button onclick="window.openSupplierModal()" class="text-xs bg-slate-900 text-white px-3 py-1 rounded">+ ADD</button></div>
            <div class="bg-white rounded border p-4">${s.data.map(x=>`<div class="border-b py-2 flex justify-between"><span>${x.name}</span><span class="text-xs text-slate-400">${x.tin || '-'}</span></div>`).join('')}</div>
        </div>
        <div class="bg-white rounded border p-6">
            <h3 class="font-bold mb-4">Exchange Rates</h3>
            <div class="max-h-[400px] overflow-y-auto">${rateRows}</div>
            <button onclick="window.saveRates()" class="btn-primary mt-4">UPDATE RATES</button>
        </div>
    </div>`;
};

// --- SETTINGS MODALS ---
window.addStoreModal = () => {
    const parents = window.cachedLocations.filter(l => l.type !== 'department').map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-4 text-center">Add Location</h3>
        <div class="input-group"><label class="input-label">Name</label><input id="lN" class="input-field uppercase"></div>
        <div class="input-group"><label class="input-label">Type</label><select id="lT" class="input-field" onchange="document.getElementById('pG').style.display=this.value==='main_store'?'none':'block'"><option value="sub_store">Camp / Sub-Store</option><option value="department">Department</option><option value="main_store">Main Store (HQ)</option></select></div>
        <div id="pG" class="input-group"><label class="input-label">Parent</label><select id="lP" class="input-field">${parents}</select></div>
        <button onclick="window.execAddStore()" class="btn-primary">CREATE</button>`;
    document.getElementById('modal').style.display = 'flex';
};
window.execAddStore = async () => {
    const n = document.getElementById('lN').value, t = document.getElementById('lT').value, p = t==='main_store'?null:document.getElementById('lP').value;
    if(!n) return;
    await supabase.from('locations').insert({organization_id:window.profile.organization_id, name:n, type:t, parent_location_id:p});
    document.getElementById('modal').style.display='none'; window.router('settings');
};
window.openSupplierModal = () => {
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 text-center">New Supplier</h3><div class="input-group"><label>Name</label><input id="sN" class="input-field"></div><div class="input-group"><label>TIN</label><input id="sT" class="input-field"></div><div class="input-group"><label>Phone</label><input id="sP" class="input-field"></div><div class="input-group"><label>Address</label><input id="sA" class="input-field"></div><button onclick="window.execAddSupplier()" class="btn-primary">SAVE</button>`;
    document.getElementById('modal').style.display='flex';
};
window.execAddSupplier = async () => {
    const n=document.getElementById('sN').value; if(!n) return;
    await supabase.from('suppliers').insert({organization_id:window.profile.organization_id, name:n, tin:document.getElementById('sT').value, contact:document.getElementById('sP').value, address:document.getElementById('sA').value});
    document.getElementById('modal').style.display='none'; window.router('settings');
};

// --- MISC ACTIONS ---
window.issueModal = async (name, id, fromLoc) => { 
    window.selectedDestinationId = null; 
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).neq('id', fromLoc); 
    const html = locs.map(l => `<div onclick="window.selectDest(this, '${l.id}')" class="dest-card border p-3 rounded cursor-pointer hover:bg-slate-50 text-center"><span class="font-bold text-xs uppercase">${l.name}</span></div>`).join(''); 
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Move: ${name}</h3><div class="grid grid-cols-2 gap-2 mb-4 max-h-40 overflow-y-auto">${html}</div><div class="input-group"><label class="input-label">Quantity</label><input id="tQty" type="number" class="input-field"></div><button onclick="window.execIssue('${id}', '${fromLoc}')" class="btn-primary">TRANSFER</button>`; 
    document.getElementById('modal').style.display = 'flex'; 
};
window.selectDest = (el, id) => { document.querySelectorAll('.dest-card').forEach(c => c.classList.remove('bg-slate-900', 'text-white')); el.classList.add('bg-slate-900', 'text-white'); window.selectedDestinationId = id; };
window.execIssue = async (pid, fromLoc) => { const qty = document.getElementById('tQty').value; if(!window.selectedDestinationId || qty <= 0) return window.showNotification("Invalid Selection", "error"); try { await transferStock(pid, fromLoc, window.selectedDestinationId, qty, window.profile.id, window.profile.organization_id); document.getElementById('modal').style.display = 'none'; window.showNotification("Request Sent", "success"); } catch(e) { window.showNotification(e.message, "error"); } };
window.requestDeleteTransaction = async (id) => { window.premiumConfirm("Void Transaction?", "This requires approval.", "Request", async () => { await supabase.from('change_requests').insert({ organization_id: window.profile.organization_id, requester_id: window.profile.id, target_table: 'transactions', target_id: id, action: 'VOID', status: 'pending' }); window.showNotification("Sent", "success"); }); };
window.requestDeleteProduct = async (id) => { window.premiumConfirm("Delete Product?", "Approval required.", "Request", async () => { await supabase.from('change_requests').insert({ organization_id: window.profile.organization_id, requester_id: window.profile.id, target_table: 'products', target_id: id, action: 'DELETE_PRODUCT', status: 'pending' }); window.showNotification("Sent", "success"); }); };
window.openStockEdit = (id, q) => { document.getElementById('modal-content').innerHTML=`<h3 class="text-center font-bold mb-4">Edit Stock</h3><input id="newQ" type="number" class="input-field mb-4" value="${q}"><textarea id="newR" class="input-field" placeholder="Reason"></textarea><button onclick="window.execStockEdit('${id}')" class="btn-primary mt-4">SUBMIT</button>`; document.getElementById('modal').style.display='flex'; };
window.execStockEdit = async (id) => { await supabase.from('change_requests').insert({organization_id:window.profile.organization_id, requester_id:window.profile.id, target_table:'inventory', target_id:id, action:'EDIT_INVENTORY', new_data:{new_qty:document.getElementById('newQ').value, reason:document.getElementById('newR').value}, status:'pending'}); document.getElementById('modal').style.display='none'; window.showNotification("Request Sent", "success"); };
window.exportCSV = () => { let rows=[["Date","Type","Item","Flow","Detail","Qty","Value"]]; window.currentLogs.forEach(l=>{ rows.push([new Date(l.created_at).toLocaleDateString(),l.type,l.products?.name,`${l.from_loc?.name||''}->${l.locations?.name||''}`,l.payment_method||'-',l.quantity,l.total_value]); }); let c="data:text/csv;charset=utf-8,"+rows.map(e=>e.join(",")).join("\n"); let link=document.createElement("a"); link.href=encodeURI(c); link.download="report.csv"; link.click(); };
window.newStockTakeModal = async () => { const locs = window.cachedLocations; document.getElementById('modal-content').innerHTML=`<h3 class="text-center font-bold mb-4">New Audit</h3><select id="stLoc" class="input-field mb-4">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select><button onclick="window.startStockTake()" class="btn-primary">START</button>`; document.getElementById('modal').style.display='flex'; };
window.startStockTake = async () => { const lid = document.getElementById('stLoc').value; const inv = await getInventory(window.profile.organization_id); const items = inv.filter(x=>x.location_id===lid); document.getElementById('modal-content').innerHTML=`<h3 class="text-center font-bold mb-4">Counting...</h3><div class="max-h-60 overflow-y-auto mb-4">${items.map(i=>`<div class="flex justify-between mb-2"><span class="w-1/2 text-xs">${i.products.name}</span><input type="number" class="st-input border w-20 text-center" data-id="${i.product_id}" data-sys="${i.quantity}"></div>`).join('')}</div><button onclick="window.saveStockTake('${lid}')" class="btn-primary">FINISH</button>`; };
window.saveStockTake = async (lid) => { const inps = document.querySelectorAll('.st-input'); const {data:st}=await supabase.from('stock_takes').insert({organization_id:window.profile.organization_id, location_id:lid, conducted_by:window.profile.id, status:'Completed'}).select().single(); const items=Array.from(inps).map(i=>({stock_take_id:st.id, product_id:i.dataset.id, system_qty:i.dataset.sys, physical_qty:i.value||0})); await supabase.from('stock_take_items').insert(items); document.getElementById('modal').style.display='none'; window.router('reports'); };
window.viewVariance = async (id) => { const {data:i}=await supabase.from('stock_take_items').select('*, products(name)').eq('stock_take_id',id); document.getElementById('modal-content').innerHTML=`<h3 class="text-center font-bold mb-4">Variance</h3><div class="max-h-60 overflow-y-auto"><table class="w-full text-xs"><thead><tr><th>Item</th><th>Sys</th><th>Phys</th><th>Var</th></tr></thead><tbody>${i.map(x=>`<tr><td>${x.products.name}</td><td>${x.system_qty}</td><td>${x.physical_qty}</td><td class="${x.variance<0?'text-red-500':''}">${x.variance}</td></tr>`).join('')}</tbody></table></div>`; document.getElementById('modal').style.display='flex'; };
