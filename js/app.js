import { getSession, logout } from './auth.js';
import { getInventory, createLocation, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

// --- GLOBAL ERROR HANDLER (HII ITATUAMBIA KAMA KUNA CRASH) ---
window.onerror = function(message, source, lineno, colno, error) {
    const app = document.getElementById('app-view');
    if(app) {
        app.innerHTML = `
        <div class="p-10 bg-red-50 border-2 border-red-500 rounded-xl text-center">
            <h1 class="text-2xl font-bold text-red-700 mb-4">SYSTEM CRASHED 🛑</h1>
            <p class="font-mono text-red-600 text-sm bg-white p-4 rounded border border-red-200 text-left mb-4">${message}</p>
            <p class="text-slate-600 mb-4">Location: Line ${lineno}</p>
            <button onclick="location.reload()" class="bg-slate-900 text-white px-6 py-3 rounded-lg font-bold">RELOAD SYSTEM</button>
        </div>`;
    }
};

// --- GLOBAL VARIABLES ---
let profile = null;
let cart = [];
let currentLogs = [];
let selectedDestinationId = null;
let activePosLocationId = null;

// --- CURRENCY SETTINGS ---
let baseCurrency = 'USD'; 
let currencyRates = {};   
let selectedCurrency = 'USD'; 
const STRONG_CURRENCIES = ['USD', 'EUR', 'GBP'];
const SUPPORTED_CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES'];

// --- CRITICAL: ATTACH FUNCTIONS TO WINDOW IMMEDIATELY ---
// Hii inazuia "Dead Buttons" hata kama init itachelewa
window.closeModalOutside = (e) => { if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none'; };
window.showNotification = (message, type = 'success') => {
    const container = document.getElementById('toast-container') || document.body;
    const div = document.createElement('div');
    div.className = `fixed top-5 right-5 px-6 py-4 rounded-xl text-white font-bold shadow-2xl z-[11000] flex items-center gap-3 transition-all duration-300 ${type === 'success' ? 'bg-slate-900' : 'bg-red-600'}`;
    div.innerHTML = `<span>${message}</span>`;
    container.appendChild(div);
    setTimeout(() => { div.remove(); }, 3000);
};

// --- 💰 CURRENCY ENGINE (SAFE MODE) ---
window.initCurrency = async () => {
    if (!profile) return;
    try {
        const { data: org } = await supabase.from('organizations').select('base_currency').eq('id', profile.organization_id).single();
        if (org) {
            baseCurrency = org.base_currency;
            if (!localStorage.getItem('user_pref_currency')) selectedCurrency = baseCurrency; 
        }

        const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', profile.organization_id);
        currencyRates = {};
        currencyRates[baseCurrency] = 1;

        if (rates && rates.length > 0) {
            rates.forEach(r => currencyRates[r.currency_code] = Number(r.rate));
        }
        console.log(`[SYSTEM] Currency Ready: ${baseCurrency}`);
    } catch (e) { 
        console.warn("Currency Warning (Not Critical):", e);
        // Hatufanyi throw error hapa ili mfumo usife
    }
};

window.convertAmount = (amount, fromCurr, toCurr) => {
    if (!amount) return 0;
    const fromRate = currencyRates[fromCurr];
    const toRate = currencyRates[toCurr];

    // Safe Fallback: Kama rate haipo, usife, rudisha null
    if (fromCurr !== toCurr && (!fromRate || !toRate)) return null; 

    if (fromCurr === baseCurrency) return amount * toRate;
    if (toCurr === baseCurrency) return amount / fromRate;
    return amount; 
};

window.formatPrice = (amount) => {
    if (!amount && amount !== 0) return '-';
    const converted = window.convertAmount(amount, baseCurrency, selectedCurrency);
    
    if (converted === null) return `<span class="text-red-500 font-bold text-[10px] bg-red-50 px-1 rounded">SET RATE</span>`;
    
    const isWeak = converted > 1000; 
    return `${selectedCurrency} ${Number(converted).toLocaleString(undefined, {minimumFractionDigits: isWeak?0:2, maximumFractionDigits: isWeak?0:2})}`;
};

window.changeCurrency = (curr) => {
    selectedCurrency = curr;
    const activeEl = document.querySelector('.nav-item.nav-active');
    if (activeEl) window.router(activeEl.id.replace('nav-', ''));
};

window.getCurrencySelectorHTML = () => {
    const options = SUPPORTED_CURRENCIES.map(c => `<option value="${c}" ${selectedCurrency === c ? 'selected' : ''}>${c}</option>`).join('');
    return `<select onchange="window.changeCurrency(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer ml-4">${options}</select>`;
};

// --- INITIALIZATION ---
window.onload = async () => {
    console.log("[SYSTEM] Booting up...");
    
    // Attach logout explicitly
    window.logoutAction = logout;

    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        // 1. Load Profile
        let { data: prof, error: profError } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        
        // Retry logic
        if (!prof) {
            await new Promise(r => setTimeout(r, 1000));
            let retry = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
            prof = retry.data;
        }

        if (!prof || !prof.organization_id) { 
            console.log("No profile found, redirecting to setup");
            window.location.href = 'setup.html'; 
            return; 
        }
        profile = prof;

        // 2. Load Currency (Await but don't crash if fails)
        await window.initCurrency();

        // 3. Setup UI
        applyStrictPermissions(profile.role);
        
        // 4. Start Router
        console.log("[SYSTEM] Starting Router...");
        window.router(profile.role === 'barman' ? 'bar' : 'inventory');

    } catch (e) {
        console.error("BOOT CRASH:", e);
        // Hapa ndipo tunakamata lile kosa la White Screen
        throw e; // Pass to global handler
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

// --- ROUTER ---
window.router = async (view) => {
    console.log(`[ROUTER] Loading ${view}...`);
    const app = document.getElementById('app-view');
    // Spinner
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div></div>';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    const navEl = document.getElementById(`nav-${view}`);
    if(navEl) navEl.classList.add('nav-active');
    
    // DELAY KIDOGO ILI UI ISI-FREEZE
    setTimeout(async () => {
        try {
            if (view === 'inventory') await renderInventory(app);
            else if (view === 'bar') await renderBar(app); 
            else if (view === 'approvals') await renderApprovals(app);
            else if (view === 'reports') await renderReports(app);
            else if (view === 'staff') await renderStaff(app);
            else if (view === 'settings') await renderSettings(app);
        } catch (err) { 
            console.error("View Render Error:", err);
            app.innerHTML = `<div class="p-10 text-center text-red-500 font-bold">Error: ${err.message}</div>`;
        }
    }, 50);
};

// --- MODULES ---

// 1. INVENTORY
async function renderInventory(c) {
    const isPOView = window.currentInvView === 'po'; 
    const { data: catalog } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const stock = await getInventory(profile.organization_id);
    const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? stock : stock.filter(x => x.location_id === profile.assigned_location_id);
    const showPrice = profile.role === 'manager' || profile.role === 'finance';

    let contentHTML = '';
    if (isPOView) {
        const { data: pos } = await supabase.from('purchase_orders').select('*').eq('organization_id', profile.organization_id).order('created_at', {ascending:false});
        const safePos = pos || [];
        contentHTML = `<table class="w-full text-left"><thead class="bg-slate-50 border-b border-slate-200"><tr><th class="py-3 pl-4">Date</th><th>Supplier</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>
        ${safePos.length ? safePos.map(po => `<tr><td class="py-3 pl-4 text-xs font-bold text-slate-600">${new Date(po.created_at).toLocaleDateString()}</td><td class="text-xs uppercase font-bold text-slate-800">${po.supplier_name}</td><td class="text-xs font-mono font-bold">${window.formatPrice(po.total_cost)}</td><td><span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${po.status === 'Pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}">${po.status}</span></td><td>${po.status === 'Pending' ? `<button onclick="window.receivePO('${po.id}')" class="text-[10px] bg-slate-900 text-white px-3 py-1 rounded hover:bg-slate-700">RECEIVE</button>` : '<span class="text-slate-400 text-[10px]">DONE</span>'}</td></tr>`).join('') : '<tr><td colspan="5" class="p-8 text-center text-xs text-slate-400">No LPOs found.</td></tr>'}</tbody></table>`;
    } else {
        contentHTML = `<table class="w-full text-left"><thead class="bg-slate-50 border-b border-slate-200"><tr><th class="py-3 pl-4">Item</th>${showPrice ? `<th>Cost</th><th>Price</th>` : ''}<th>Location</th><th>Qty</th><th>Action</th></tr></thead><tbody>
        ${filteredStock.length ? filteredStock.map(i => `<tr class="border-b border-slate-50 last:border-0"><td class="py-3 pl-4"><div class="font-bold text-gray-800 uppercase">${i.products?.name || 'Unknown'}</div><div class="text-[9px] text-slate-400 font-bold uppercase tracking-wider">${i.products?.category || 'General'}</div></td>${showPrice ? `<td class="font-mono text-xs text-slate-500">${window.formatPrice(i.products.cost_price)}</td><td class="font-mono text-xs text-slate-900 font-bold">${window.formatPrice(i.products.selling_price)}</td>` : ''}<td class="text-xs font-bold text-gray-500 uppercase tracking-widest">${i.locations?.name || '-'}</td><td class="font-mono font-bold text-gray-900 text-lg">${i.quantity} <span class="text-[10px] text-slate-400">${i.products?.unit || ''}</span></td><td class="text-right pr-4 flex justify-end gap-2 items-center py-3">${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-white border border-slate-300 text-slate-700 px-3 py-1 rounded hover:bg-slate-100 transition uppercase">MOVE</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="6" class="p-8 text-center text-xs text-slate-400">No stock available.</td></tr>'}</tbody></table>`;
    }

    c.innerHTML = `
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900">Inventory</h1>${showPrice ? window.getCurrencySelectorHTML() : ''}</div>
            <div class="flex gap-2 bg-slate-100 p-1 rounded-full">
                <button onclick="window.currentInvView='stock'; router('inventory')" class="px-5 py-2 text-xs font-bold rounded-full ${!isPOView ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}">STOCK</button>
                <button onclick="window.currentInvView='po'; router('inventory')" class="px-5 py-2 text-xs font-bold rounded-full ${isPOView ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}">LPO</button>
            </div>
            <div class="flex gap-3">${profile.role === 'manager' ? `<button onclick="window.createPOModal()" class="btn-primary w-auto px-6 bg-blue-600 hover:bg-blue-700">Create LPO</button><button onclick="window.addProductModal()" class="btn-primary w-auto px-6">New Item</button>` : ''}</div>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">${contentHTML}</div>`;
}

// 2. REPORTS
async function renderReports(c) {
    const isVarianceView = window.currentRepView === 'variance';
    const showFinancials = (profile.role === 'manager' || profile.role === 'finance');

    if (isVarianceView) {
        const { data: takes } = await supabase.from('stock_takes').select('*, locations(name), profiles(full_name)').eq('organization_id', profile.organization_id).order('created_at', {ascending:false});
        const safeTakes = takes || [];
        c.innerHTML = `
        <div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase text-slate-900">Reconciliation</h1>
            <div class="flex gap-2 bg-slate-100 p-1 rounded-full"><button onclick="window.currentRepView='general'; router('reports')" class="px-5 py-2 text-xs font-bold rounded-full text-slate-500">GENERAL</button><button class="px-5 py-2 text-xs font-bold rounded-full bg-white text-slate-900 shadow-sm">VARIANCE</button></div>
            <button onclick="window.newStockTakeModal()" class="btn-primary w-auto px-6 bg-red-600 hover:bg-red-700">NEW STOCK TAKE</button>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-left"><thead class="bg-slate-50 border-b"><tr><th class="py-3 pl-4">Date</th><th>Location</th><th>User</th><th>Status</th><th>Action</th></tr></thead><tbody>
        ${safeTakes.length ? safeTakes.map(t => `<tr><td class="py-3 pl-4 text-xs font-bold">${new Date(t.created_at).toLocaleDateString()}</td><td class="text-xs uppercase">${t.locations?.name || '-'}</td><td class="text-xs">${t.profiles?.full_name || '-'}</td><td><span class="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-1 rounded">DONE</span></td><td><button onclick="window.viewVariance('${t.id}')" class="text-blue-600 font-bold text-[10px] underline">VIEW</button></td></tr>`).join('') : '<tr><td colspan="5" class="p-8 text-center text-xs text-slate-400">No records.</td></tr>'}</tbody></table></div>`;
    } else {
        const { data: logs, error } = await supabase.from('transactions').select(`*, products (name, category), locations:to_location_id (name), from_loc:from_location_id (name), profiles:user_id (full_name, role)`).eq('organization_id', profile.organization_id).order('created_at', { ascending: false }).limit(100);
        if (error) throw error;
        currentLogs = logs || [];
        const totalSales = currentLogs.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.total_value) || 0), 0);
        
        c.innerHTML = `
        <div class="flex justify-between items-center mb-10 gap-4"><div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900">Reports</h1>${showFinancials ? window.getCurrencySelectorHTML() : ''}</div>
            <div class="flex gap-2 bg-slate-100 p-1 rounded-full"><button class="px-5 py-2 text-xs font-bold rounded-full bg-white text-slate-900 shadow-sm">GENERAL</button><button onclick="window.currentRepView='variance'; router('reports')" class="px-5 py-2 text-xs font-bold rounded-full text-slate-500 hover:text-slate-700">VARIANCE</button></div>
        </div>
        ${showFinancials ? `<div class="bg-white p-8 border border-slate-200 rounded-2xl shadow-sm mb-12"><p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Total Sales Revenue</p><p class="text-4xl font-bold font-mono text-slate-900">${window.formatPrice(totalSales)}</p></div>` : ''}
        <div class="flex gap-2 mb-6"><button onclick="window.filterLogs('all')" class="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-full">ALL</button><button onclick="window.filterLogs('sale')" class="px-4 py-2 bg-white border text-slate-600 text-xs font-bold rounded-full">SALES</button></div>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left"><thead class="bg-slate-50 border-b"><tr><th class="py-3 pl-4">Date</th><th>User</th><th>Item</th><th>Action</th><th>Details</th><th>Qty</th></tr></thead><tbody id="logsBody"></tbody></table></div></div>`;
        window.filterLogs('all');
    }
}

window.filterLogs=(t)=>{
    let f = currentLogs || [];
    if(t==='sale') f = f.filter(l=>l.type==='sale');
    const b = document.getElementById('logsBody');
    if(!b) return;
    if(!f.length){b.innerHTML='<tr><td colspan="6" class="text-center text-xs text-gray-400 py-12">No records found.</td></tr>';return;}
    b.innerHTML=f.map(l=>{
        const d=new Date(l.created_at);
        let a=l.type.replace('_',' ').toUpperCase(), det=`${l.from_loc?.name||'-'} ➜ ${l.locations?.name||'-'}`;
        if(l.type==='sale'){det='POS Sale';}
        return `<tr class="border-b border-slate-50 hover:bg-slate-50"><td class="py-3 pl-4"><div class="font-bold text-slate-700 text-xs">${d.toLocaleDateString()}</div></td><td><div class="font-bold text-slate-900 text-xs">${l.profiles?.full_name || 'System'}</div></td><td><div class="font-bold uppercase text-xs text-slate-700">${l.products?.name || 'Unknown'}</div></td><td><span class="font-bold uppercase bg-blue-50 text-blue-600 text-[9px] px-2 py-1 rounded">${a}</span></td><td class="text-xs text-gray-500">${det}</td><td class="font-mono font-bold text-slate-900">${l.quantity}</td></tr>`;
    }).join('');
}

// --- SETTINGS ---
async function renderSettings(c) {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id);
    const { data: existingRates } = await supabase.from('exchange_rates').select('*').eq('organization_id', profile.organization_id);
    const rateMap = {};
    if(existingRates) existingRates.forEach(r => rateMap[r.currency_code] = r.rate);
    const supportedCurrencies = ['TZS', 'USD', 'EUR', 'GBP', 'KES'];
    
    const ratesHTML = supportedCurrencies.map(code => {
        const isBase = code === baseCurrency;
        const currentVal = isBase ? 1 : (rateMap[code] || ''); 
        return `<div class="flex items-center justify-between border-b border-slate-50 last:border-0 py-3"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-[10px] text-slate-600">${code.substring(0,1)}</div><div><p class="font-bold text-sm text-slate-700">${code}</p><p class="text-[10px] text-slate-400 font-medium">${isBase ? 'Base Currency' : 'Foreign'}</p></div></div><div>${isBase ? `<span class="font-mono font-bold text-slate-300 px-4">1.00</span>` : `<input id="rate-${code}" type="number" step="0.01" value="${currentVal}" placeholder="Set Rate..." class="w-32 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-right font-mono font-bold text-slate-800 focus:border-slate-900 outline-none transition text-sm">`}</div></div>`;
    }).join('');

    c.innerHTML = `<div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase text-slate-900">Settings</h1></div><div class="grid grid-cols-1 lg:grid-cols-2 gap-8"><div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-fit"><div class="p-6 border-b border-slate-100 flex justify-between items-center"><h3 class="font-bold text-sm uppercase text-slate-800">Locations</h3><button onclick="window.addStoreModal()" class="text-[10px] font-bold bg-slate-900 text-white px-3 py-1.5 rounded">+ ADD</button></div><div class="p-0 overflow-x-auto"><table class="w-full text-left"><tbody>${locs.map(x => `<tr class="border-b border-slate-50 last:border-0"><td class="font-bold text-sm text-slate-700 py-4 pl-6">${x.name}</td><td class="text-xs font-bold uppercase text-gray-400">${x.type}</td><td class="text-right pr-6"><span class="bg-green-50 text-green-600 px-2 py-1 rounded text-[9px] font-bold">ACTIVE</span></td></tr>`).join('')}</tbody></table></div></div><div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-fit"><div class="p-6 border-b border-slate-100 bg-slate-50/50"><h3 class="font-bold text-sm uppercase text-slate-800">Exchange Rates</h3></div><div class="p-6 pt-2">${ratesHTML}<button onclick="window.saveRates()" class="btn-primary w-full mt-6 justify-center">Update Rates</button></div></div></div>`;
}

// --- GLOBAL FUNCTIONS ATTACHMENT (CRITICAL FOR BUTTONS) ---
window.addProductModal = window.addProductModal || (() => { if(profile.role !== 'manager') return; const currencyOptions = SUPPORTED_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join(''); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Product</h3><div class="input-group"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div><div class="grid grid-cols-2 gap-5 mb-4"><div class="input-group mb-0"><label class="input-label">Category</label><select id="pCat" class="input-field"><option value="Food">Food (Kitchen)</option><option value="Beverage">Beverage (Bar)</option><option value="Supplies">Supplies</option><option value="Maintenance">Maintenance</option></select></div><div class="input-group mb-0"><label class="input-label">Unit</label><select id="pUnit" class="input-field"><option value="Pcs">Pieces</option><option value="Box">Box/Crate</option><option value="Kg">Kilograms</option><option value="Ltr">Liters</option></select></div></div><div class="input-group mb-4"><label class="input-label">Input Currency</label><select id="pCurrency" class="input-field cursor-pointer bg-slate-50 font-bold text-slate-700">${currencyOptions}</select><p class="text-[10px] text-slate-400 mt-1">* Auto-converts to ${baseCurrency}</p></div><div class="grid grid-cols-2 gap-5 mb-8"><div class="input-group mb-0"><label class="input-label">Cost</label><input id="pC" type="number" class="input-field" placeholder="0.00"></div><div class="input-group mb-0"><label class="input-label">Selling</label><input id="pS" type="number" class="input-field" placeholder="0.00"></div></div><button onclick="window.execAddProduct()" class="btn-primary">Save Product</button>`; document.getElementById('modal').style.display = 'flex'; });
window.execAddProduct = window.execAddProduct || (async () => { try { const name = document.getElementById('pN').value.toUpperCase(); const category = document.getElementById('pCat').value; const unit = document.getElementById('pUnit').value; const inputCurrency = document.getElementById('pCurrency').value; let cost = parseFloat(document.getElementById('pC').value); let selling = parseFloat(document.getElementById('pS').value); if (!name || isNaN(cost) || isNaN(selling)) return window.showNotification("Invalid details", "error"); const costBase = window.convertAmount(cost, inputCurrency, baseCurrency); const sellingBase = window.convertAmount(selling, inputCurrency, baseCurrency); if (costBase === null) throw new Error(`Missing exchange rate for ${inputCurrency}`); await supabase.from('products').insert({ name: name, category: category, unit: unit, cost_price: costBase, selling_price: sellingBase, organization_id: profile.organization_id }); document.getElementById('modal').style.display = 'none'; window.showNotification(`Saved ${name}`, "success"); window.router('inventory'); } catch(e) { window.showNotification(e.message, "error"); } });
window.addStoreModal = window.addStoreModal || (() => { document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-8 uppercase text-center">Add Hub</h3><div class="input-group"><label class="input-label">Name</label><input id="nN" class="input-field"></div><div class="input-group"><label class="input-label">Type</label><select id="nT" class="input-field"><option value="main_store">Main Store</option><option value="camp_store">Camp Store</option><option value="department">Department</option></select></div><button onclick="window.execAddStore()" class="btn-primary mt-6">Create</button>`; document.getElementById('modal').style.display = 'flex'; });
window.execAddStore = window.execAddStore || (async () => { await createLocation(profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').style.display = 'none'; window.router('settings'); });
window.saveRates = window.saveRates;
window.filterLogs = window.filterLogs;
window.changeCurrency = window.changeCurrency;
window.createPOModal = window.createPOModal;
window.execCreatePO = window.execCreatePO;
window.receivePO = window.receivePO;
window.newStockTakeModal = window.newStockTakeModal;
window.startStockTake = window.startStockTake;
window.saveStockTake = window.saveStockTake;
window.viewVariance = window.viewVariance;
window.issueModal = window.issueModal || (async (name, id, fromLoc) => { selectedDestinationId = null; let { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).neq('id', fromLoc); if(profile.role === 'storekeeper') locs = locs.filter(l => l.type === 'department'); const gridHTML = locs.map(l => `<div onclick="window.selectDest(this, '${l.id}')" class="dest-card border border-slate-200 p-4 rounded-xl cursor-pointer hover:border-slate-900 hover:bg-slate-50 transition flex flex-col items-center justify-center gap-1 text-center"><span class="font-bold text-xs uppercase text-slate-800">${l.name}</span><span class="text-[9px] font-bold text-slate-400 tracking-wider uppercase">${l.type.replace('_',' ')}</span></div>`).join(''); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">Move Stock</h3><div class="input-group mb-6"><label class="input-label">Product</label><input value="${name}" disabled class="input-field bg-slate-50 uppercase text-slate-500 font-bold"></div><div class="mb-6"><label class="input-label mb-3 block">Select Destination</label><div class="grid grid-cols-2 gap-3 max-h-[200px] overflow-y-auto pr-1">${gridHTML || '<p class="text-xs text-slate-400 col-span-2 text-center py-4">No destinations available.</p>'}</div></div><div class="input-group"><label class="input-label">Quantity</label><input id="tQty" type="number" class="input-field" placeholder="0"></div><button onclick="window.execIssue('${id}','${fromLoc}')" class="btn-primary mt-4">Request Transfer</button>`; document.getElementById('modal').style.display = 'flex'; });
window.selectDest = window.selectDest || ((el, id) => { document.querySelectorAll('.dest-card').forEach(c => { c.classList.remove('bg-slate-900', 'border-slate-900', 'text-white'); c.querySelector('span').classList.remove('text-white'); c.querySelectorAll('span')[1].classList.remove('text-slate-300'); c.classList.add('border-slate-200', 'hover:border-slate-900', 'hover:bg-slate-50'); c.querySelector('span').classList.add('text-slate-800'); c.querySelectorAll('span')[1].classList.add('text-slate-400'); }); el.classList.remove('border-slate-200', 'hover:border-slate-900', 'hover:bg-slate-50'); el.classList.add('bg-slate-900', 'border-slate-900'); el.querySelector('span').classList.remove('text-slate-800'); el.querySelector('span').classList.add('text-white'); el.querySelectorAll('span')[1].classList.remove('text-slate-400'); el.querySelectorAll('span')[1].classList.add('text-slate-300'); selectedDestinationId = id; });
window.execIssue = window.execIssue || (async (pId, fId) => { try { const qty = document.getElementById('tQty').value; if (!selectedDestinationId) return window.showNotification("Select Destination", "error"); if (!qty || qty <= 0) return window.showNotification("Enter Quantity", "error"); await transferStock(pId, fId, selectedDestinationId, qty, profile.id, profile.organization_id); document.getElementById('modal').style.display = 'none'; window.showNotification("Transfer Requested", "success"); window.router('inventory'); } catch(e){ window.showNotification(e.message, "error"); } });
