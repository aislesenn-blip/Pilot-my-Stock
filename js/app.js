import { getSession, logout } from './auth.js';
import { getInventory, createLocation, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

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

// --- UTILITIES ---
window.closeModalOutside = (e) => { 
    if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none'; 
};

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

// --- 💰 CURRENCY ENGINE (DEEP LOGIC) ---
window.initCurrency = async () => {
    if (!profile) return;
    try {
        // 1. Get Organization Base Currency
        const { data: org } = await supabase.from('organizations').select('base_currency').eq('id', profile.organization_id).single();
        if (org) {
            baseCurrency = org.base_currency;
            // Default display to base currency initially
            if (!localStorage.getItem('user_pref_currency')) {
                selectedCurrency = baseCurrency; 
            }
        }

        // 2. Get Exchange Rates
        const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', profile.organization_id);
        
        currencyRates = {};
        // Reset base rate to 1
        currencyRates[baseCurrency] = 1;

        if (rates && rates.length > 0) {
            rates.forEach(r => {
                currencyRates[r.currency_code] = Number(r.rate);
            });
        }
        
        console.log(`[SYSTEM] Currency Initialized. Base: ${baseCurrency}`, currencyRates);
    } catch (e) { 
        console.error("Currency Init Error:", e); 
        window.showNotification("Failed to load currency rates", "error");
    }
};

window.convertAmount = (amount, fromCurr, toCurr) => {
    // Safety check
    if (amount === null || amount === undefined) return 0;
    
    // Get rates
    const fromRate = currencyRates[fromCurr];
    const toRate = currencyRates[toCurr];

    // CRITICAL CHECK: If any rate is missing/zero (except if it's the same currency), FAIL.
    if (fromCurr !== toCurr) {
        if (!fromRate || !toRate) return null; // Signal that rate is missing
    } else {
        return amount; // Same currency requires no conversion
    }

    // LOGIC: Convert 'from' to Base, then Base to 'to'
    // Step 1: To Base (Divide by fromRate) => Base Value
    // Step 2: To Target (Multiply by toRate) => Target Value
    // BUT our rates are stored as "1 Base = X Target".
    // So: Amount (in Base) * toRate = Target Amount.
    
    // Case 1: Base to Foreign (Displaying USD price in TZS)
    // Formula: Amount * Rate
    if (fromCurr === baseCurrency) {
        return amount * toRate;
    }

    // Case 2: Foreign to Base (Saving TZS input as USD)
    // Formula: Amount / Rate
    if (toCurr === baseCurrency) {
        return amount / fromRate;
    }

    // Case 3: Foreign to Foreign (TZS to KES) -> Not supported yet for safety
    return null;
};

window.formatPrice = (amount) => {
    if (!amount && amount !== 0) return '-';
    
    // Amount coming in is ALWAYS in Base Currency (from DB)
    // We want to show it in Selected Currency
    const converted = window.convertAmount(amount, baseCurrency, selectedCurrency);
    
    // If conversion failed (missing rate), show error
    if (converted === null) {
        return `<span class="text-red-600 bg-red-50 px-1 rounded text-[10px] font-bold border border-red-200">SET ${selectedCurrency} RATE</span>`;
    }
    
    const isWeak = converted > 1000; 
    return `${selectedCurrency} ${Number(converted).toLocaleString(undefined, {minimumFractionDigits: isWeak?0:2, maximumFractionDigits: isWeak?0:2})}`;
};

window.changeCurrency = (curr) => {
    console.log("Changing currency to:", curr);
    selectedCurrency = curr;
    // Refresh the active view to update prices
    const activeNav = document.querySelector('.nav-item.nav-active');
    if (activeNav) {
        const viewId = activeNav.id.replace('nav-', '');
        window.router(viewId);
    }
};

window.getCurrencySelectorHTML = () => {
    const options = SUPPORTED_CURRENCIES.map(c => 
        `<option value="${c}" ${selectedCurrency === c ? 'selected' : ''}>${c}</option>`
    ).join('');
    return `<select onchange="window.changeCurrency(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer ml-4 shadow-sm focus:ring-2 focus:ring-black">${options}</select>`;
};

// --- MAIN ROUTER & INIT ---
window.onload = async () => {
    console.log("[SYSTEM] Starting...");
    const style = document.createElement('style');
    style.innerHTML = `#modal, #modal-content, #name-modal { overflow: visible !important; }`;
    document.head.appendChild(style);

    const mobileBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    if(mobileBtn && sidebar) {
        mobileBtn.addEventListener('click', (e) => { e.stopPropagation(); sidebar.classList.remove('-translate-x-full'); });
    }

    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    
    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        
        let { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (!prof) {
            await new Promise(r => setTimeout(r, 1000)); // Retry
            let retry = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
            prof = retry.data;
        }
        
        profile = prof;
        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }

        console.log("[SYSTEM] Profile Loaded:", profile.role);

        // Load Currencies BEFORE rendering anything
        await window.initCurrency();

        window.logoutAction = logout;
        applyStrictPermissions(profile.role);
        
        // Start at Inventory
        window.router('inventory');
        
    } catch (e) { 
        console.error("Critical Init Error:", e);
        document.body.innerHTML = `<div class="p-20 text-center"><h1 class="text-red-600 font-bold text-2xl">System Error</h1><p class="mt-2 text-gray-600">${e.message}</p><button onclick="location.reload()" class="mt-4 btn-primary">Reload</button></div>`;
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
    console.log("[ROUTER] Navigating to:", view);
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div></div>';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    const navEl = document.getElementById(`nav-${view}`);
    if(navEl) navEl.classList.add('nav-active');
    
    try {
        if (view === 'inventory') await renderInventory(app);
        else if (view === 'bar') await renderBar(app); 
        else if (view === 'approvals') await renderApprovals(app);
        else if (view === 'reports') await renderReports(app);
        else if (view === 'staff') await renderStaff(app);
        else if (view === 'settings') await renderSettings(app);
    } catch (err) { 
        console.error("View Error:", err);
        app.innerHTML = `<div class="p-10 text-center"><p class="text-red-500 font-bold">Error loading view: ${err.message}</p></div>`;
    }
};

// --- VIEW 1: INVENTORY (STOCK & LPO) ---
async function renderInventory(c) {
    const isPOView = window.currentInvView === 'po'; 
    const { data: catalog } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const stock = await getInventory(profile.organization_id);
    
    // Filter stock based on role
    const filteredStock = (profile.role === 'manager' || profile.role === 'finance') 
        ? stock 
        : stock.filter(x => x.location_id === profile.assigned_location_id);
        
    const showPrice = profile.role === 'manager' || profile.role === 'finance';

    let contentHTML = '';
    
    if (isPOView) {
        // LPO VIEW
        const { data: pos } = await supabase.from('purchase_orders').select('*').eq('organization_id', profile.organization_id).order('created_at', {ascending:false});
        const safePos = pos || [];
        
        contentHTML = `
        <table class="w-full text-left">
            <thead class="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase"><tr><th class="py-3 pl-4">Date</th><th>Supplier</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
            ${safePos.length ? safePos.map(po => `
                <tr class="border-b border-slate-50 hover:bg-slate-50">
                    <td class="py-3 pl-4 text-xs font-bold text-slate-600">${new Date(po.created_at).toLocaleDateString()}</td>
                    <td class="text-xs uppercase font-bold text-slate-800">${po.supplier_name}</td>
                    <td class="text-xs font-mono font-bold">${window.formatPrice(po.total_cost)}</td>
                    <td><span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${po.status === 'Pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}">${po.status}</span></td>
                    <td>${po.status === 'Pending' ? `<button onclick="window.receivePO('${po.id}')" class="text-[10px] bg-slate-900 text-white px-3 py-1 rounded hover:bg-slate-700 font-bold">RECEIVE</button>` : '<span class="text-slate-400 text-[10px] font-bold">DONE</span>'}</td>
                </tr>`).join('') : '<tr><td colspan="5" class="p-8 text-center text-xs text-slate-400 uppercase tracking-widest">No Purchase Orders found.</td></tr>'}
            </tbody>
        </table>`;
    } else {
        // STOCK VIEW
        contentHTML = `
        <table class="w-full text-left">
            <thead class="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase"><tr><th class="py-3 pl-4">Item & Category</th>${showPrice ? `<th>Cost</th><th>Price</th>` : ''}<th>Location</th><th>Qty</th><th>Action</th></tr></thead>
            <tbody>
            ${filteredStock.length ? filteredStock.map(i => `
                <tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50 group">
                    <td class="py-3 pl-4">
                        <div class="font-bold text-gray-800 uppercase text-sm">${i.products?.name || 'Unknown'}</div>
                        <div class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">${i.products?.category || 'General'}</div>
                    </td>
                    ${showPrice ? `<td class="font-mono text-xs text-slate-500">${window.formatPrice(i.products.cost_price)}</td><td class="font-mono text-xs text-slate-900 font-bold">${window.formatPrice(i.products.selling_price)}</td>` : ''}
                    <td class="text-xs font-bold text-gray-500 uppercase tracking-widest">${i.locations?.name || '-'}</td>
                    <td class="font-mono font-bold text-gray-900 text-lg">${i.quantity} <span class="text-[10px] text-slate-400">${i.products?.unit || ''}</span></td>
                    <td class="text-right pr-4 flex justify-end gap-2 items-center py-3">
                        ${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-white border border-slate-300 text-slate-700 px-3 py-1 rounded hover:bg-slate-100 transition uppercase shadow-sm">MOVE</button>` : ''}
                    </td>
                </tr>`).join('') : '<tr><td colspan="6" class="p-12 text-center text-xs text-slate-400 uppercase tracking-widest border-2 border-dashed border-slate-100 rounded-xl m-4">No stock available.</td></tr>'}
            </tbody>
        </table>`;
    }

    c.innerHTML = `
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div class="flex items-center gap-4">
                <h1 class="text-3xl font-bold uppercase text-slate-900">Inventory</h1>
                ${showPrice ? window.getCurrencySelectorHTML() : ''}
            </div>
            <div class="flex gap-2 bg-slate-100 p-1 rounded-full">
                <button onclick="window.currentInvView='stock'; router('inventory')" class="px-5 py-2 text-xs font-bold rounded-full transition-all ${!isPOView ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}">STOCK</button>
                <button onclick="window.currentInvView='po'; router('inventory')" class="px-5 py-2 text-xs font-bold rounded-full transition-all ${isPOView ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}">PURCHASE ORDERS</button>
            </div>
            <div class="flex gap-3">
                ${profile.role === 'manager' ? `<button onclick="window.createPOModal()" class="btn-primary w-auto px-6 bg-blue-600 hover:bg-blue-700 text-xs shadow-lg shadow-blue-200">Create LPO</button><button onclick="window.addProductModal()" class="btn-primary w-auto px-6 text-xs shadow-lg shadow-slate-200">New Item</button>` : ''}
            </div>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">${contentHTML}</div>`;
}

// --- VIEW 2: REPORTS (AUDIT & VARIANCE) ---
async function renderReports(c) {
    try {
        const isVarianceView = window.currentRepView === 'variance';
        const showFinancials = (profile.role === 'manager' || profile.role === 'finance');

        if (isVarianceView) {
            // STOCK TAKE VIEW
            const { data: takes } = await supabase.from('stock_takes').select('*, locations(name), profiles(full_name)').eq('organization_id', profile.organization_id).order('created_at', {ascending:false});
            const safeTakes = takes || [];
            
            c.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <h1 class="text-3xl font-bold uppercase text-slate-900">Reconciliation</h1>
                <div class="flex gap-2 bg-slate-100 p-1 rounded-full">
                    <button onclick="window.currentRepView='general'; router('reports')" class="px-5 py-2 text-xs font-bold rounded-full transition-all text-slate-500 hover:text-slate-700">GENERAL</button>
                    <button class="px-5 py-2 text-xs font-bold rounded-full bg-white text-slate-900 shadow-sm">VARIANCE</button>
                </div>
                <button onclick="window.newStockTakeModal()" class="btn-primary w-auto px-6 bg-slate-900 hover:bg-slate-800 text-xs shadow-lg">NEW STOCK TAKE</button>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <table class="w-full text-left">
                    <thead class="bg-slate-50 border-b text-xs text-slate-500 uppercase"><tr><th class="py-3 pl-4">Date</th><th>Location</th><th>Conducted By</th><th>Status</th><th>Report</th></tr></thead>
                    <tbody>
                    ${safeTakes.length ? safeTakes.map(t => `
                        <tr class="border-b border-slate-50 hover:bg-slate-50">
                            <td class="py-3 pl-4 text-xs font-bold">${new Date(t.created_at).toLocaleDateString()}</td>
                            <td class="text-xs uppercase font-bold text-slate-700">${t.locations?.name || '-'}</td>
                            <td class="text-xs text-slate-500">${t.profiles?.full_name || '-'}</td>
                            <td><span class="text-[9px] font-bold bg-green-100 text-green-700 px-2 py-1 rounded border border-green-200">COMPLETED</span></td>
                            <td><button onclick="window.viewVariance('${t.id}')" class="text-blue-600 font-bold text-[10px] hover:underline flex items-center gap-1">VIEW REPORT <span>→</span></button></td>
                        </tr>`).join('') : '<tr><td colspan="5" class="p-8 text-center text-xs text-slate-400">No stock takes recorded yet.</td></tr>'}
                    </tbody>
                </table>
            </div>`;
        } else {
            // GENERAL AUDIT VIEW
            const { data: logs, error } = await supabase.from('transactions').select(`*, products (name, category), locations:to_location_id (name), from_loc:from_location_id (name), profiles:user_id (full_name, role)`).eq('organization_id', profile.organization_id).order('created_at', { ascending: false }).limit(100);
            
            if (error) throw error;
            currentLogs = logs || [];
            
            const totalSales = currentLogs.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.total_value) || 0), 0);
            const totalProfit = currentLogs.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.profit) || 0), 0);

            c.innerHTML = `
            <div class="flex justify-between items-center mb-10 gap-4">
                <div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900">Reports</h1>${showFinancials ? window.getCurrencySelectorHTML() : ''}</div>
                <div class="flex gap-2 bg-slate-100 p-1 rounded-full">
                    <button class="px-5 py-2 text-xs font-bold rounded-full bg-white text-slate-900 shadow-sm">GENERAL</button>
                    <button onclick="window.currentRepView='variance'; router('reports')" class="px-5 py-2 text-xs font-bold rounded-full text-slate-500 hover:text-slate-700">VARIANCE</button>
                </div>
            </div>
            
            ${showFinancials ? `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                <div class="bg-white p-8 border border-slate-200 rounded-2xl shadow-sm">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Total Sales Revenue</p>
                    <p class="text-4xl font-bold font-mono text-slate-900">${window.formatPrice(totalSales)}</p>
                </div>
                <div class="bg-white p-8 border border-slate-200 rounded-2xl shadow-sm">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Gross Profit</p>
                    <p class="text-4xl font-bold font-mono text-green-600">${window.formatPrice(totalProfit)}</p>
                </div>
            </div>` : ''}
            
            <div class="flex flex-wrap gap-2 mb-6">
                <button onclick="window.filterLogs('all')" class="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-full shadow-md hover:bg-slate-800 transition">ALL TRANSACTIONS</button>
                <button onclick="window.filterLogs('sale')" class="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-full hover:border-slate-900 hover:text-slate-900 transition">SALES ONLY</button>
                <button onclick="window.filterLogs('transfer')" class="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-full hover:border-slate-900 hover:text-slate-900 transition">TRANSFERS</button>
                <button onclick="window.filterLogs('consumption')" class="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-full hover:border-slate-900 hover:text-slate-900 transition">CONSUMPTION</button>
            </div>

            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="overflow-x-auto">
                    <table id="reportTable" class="w-full text-left">
                        <thead class="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase">
                            <tr><th class="py-3 pl-4">Date</th><th>User</th><th>Item</th><th>Action</th><th>Details</th><th>Qty</th></tr>
                        </thead>
                        <tbody id="logsBody"></tbody>
                    </table>
                </div>
            </div>`;
            window.filterLogs('all');
        }
    } catch(e) { console.error("REPORT ERROR:", e); c.innerHTML = `<div class="p-12 text-center border-2 border-red-100 rounded-xl bg-red-50"><h3 class="text-red-600 font-bold text-lg mb-2">SYSTEM ERROR</h3><p class="text-slate-700 font-mono text-xs bg-white p-4 border rounded inline-block text-left shadow-sm">${e.message || JSON.stringify(e)}</p></div>`; }
}

window.filterLogs=(t)=>{
    let f = currentLogs || [];
    if(t==='sale') f = f.filter(l=>l.type==='sale');
    if(t==='transfer') f = f.filter(l=>['pending_transfer','transfer_completed'].includes(l.type));
    if(t==='consumption') f = f.filter(l=>l.to_location_id && l.locations?.type === 'department');
    
    const b = document.getElementById('logsBody');
    if(!b) return;
    
    if(!f.length){b.innerHTML='<tr><td colspan="6" class="text-center text-xs text-gray-400 py-12 uppercase tracking-widest">No matching records found.</td></tr>';return;}
    
    b.innerHTML=f.map(l=>{
        const d=new Date(l.created_at);
        let a=l.type.replace('_',' ').toUpperCase(),c='bg-blue-50 text-blue-600',det=`${l.from_loc?.name||'-'} ➜ ${l.locations?.name||'-'}`;
        if(l.type==='sale'){c='bg-green-50 text-green-600';det='POS Sale';}
        if(l.type==='receive'){c='bg-slate-100 text-slate-600';det='Supplier Entry';}
        return `
        <tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition">
            <td class="py-3 pl-4">
                <div class="font-bold text-slate-700 text-xs">${d.toLocaleDateString()}</div>
                <div class="text-[10px] text-slate-400 font-mono">${d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
            </td>
            <td>
                <div class="font-bold text-slate-900 text-xs">${l.profiles?.full_name || 'System'}</div>
                <div class="text-[9px] font-bold text-slate-500 uppercase">${l.profiles?.role || '-'}</div>
            </td>
            <td>
                <div class="font-bold uppercase text-xs text-slate-700">${l.products?.name || 'Unknown'}</div>
                <div class="text-[9px] font-bold text-slate-400 uppercase">${l.products?.category || '-'}</div>
            </td>
            <td><span class="font-bold uppercase ${c} text-[9px] tracking-widest px-2 py-1 rounded-full border border-opacity-10">${a}</span></td>
            <td class="text-xs uppercase text-gray-500 font-medium">${det}</td>
            <td class="font-mono font-bold text-slate-900 text-sm">${l.quantity}</td>
        </tr>`;
    }).join('');
}

// --- MODAL ACTIONS (LPO, STOCK TAKE) ---
window.createPOModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-6 uppercase text-center">Create LPO</h3>
    <div class="input-group"><label class="input-label">Supplier Name</label><input id="lpoSup" class="input-field" placeholder="e.g. Serengeti Brewers"></div>
    <div class="bg-slate-50 p-4 rounded-xl mb-4 border border-slate-100 max-h-[300px] overflow-y-auto"><label class="input-label mb-2">Select Items</label>
    ${prods.map(p => `<div class="flex items-center gap-2 mb-2 p-2 bg-white rounded border border-slate-100"><input type="checkbox" class="lpo-check w-4 h-4 cursor-pointer" value="${p.id}" data-price="${p.cost_price}"><span class="flex-1 text-xs font-bold uppercase">${p.name}</span><input type="number" id="qty-${p.id}" class="w-16 input-field text-xs p-2" placeholder="Qty"></div>`).join('')}</div>
    <button onclick="window.execCreatePO()" class="btn-primary">Generate Order</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execCreatePO = async () => {
    const supplier = document.getElementById('lpoSup').value;
    const checks = document.querySelectorAll('.lpo-check:checked');
    if(!supplier || checks.length === 0) return window.showNotification("Enter supplier and select items", "error");
    let totalCost = 0; const items = [];
    checks.forEach(c => {
        const qty = document.getElementById(`qty-${c.value}`).value;
        if(qty > 0) { const cost = c.getAttribute('data-price') * qty; totalCost += cost; items.push({ product_id: c.value, quantity: qty, unit_cost: c.getAttribute('data-price') }); }
    });
    const { data: po, error } = await supabase.from('purchase_orders').insert({ organization_id: profile.organization_id, created_by: profile.id, supplier_name: supplier, total_cost: totalCost, status: 'Pending' }).select().single();
    if(error) return window.showNotification(error.message, "error");
    await supabase.from('po_items').insert(items.map(i => ({ ...i, po_id: po.id })));
    document.getElementById('modal').style.display = 'none'; window.showNotification("LPO Created", "success"); window.currentInvView='po'; router('inventory');
};

window.receivePO = async (id) => {
    if(!confirm("Receive stock from this LPO?")) return;
    const { data: items } = await supabase.from('po_items').select('*').eq('po_id', id);
    const mainStore = await supabase.from('locations').select('id').eq('organization_id', profile.organization_id).eq('type', 'main_store').single();
    for (const item of items) {
        await supabase.rpc('add_stock_safe', { p_product_id: item.product_id, p_location_id: mainStore.data.id, p_quantity: item.quantity, p_org_id: profile.organization_id });
        await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: item.product_id, to_location_id: mainStore.data.id, type: 'receive', quantity: item.quantity });
    }
    await supabase.from('purchase_orders').update({ status: 'Received' }).eq('id', id); window.showNotification("Stock Received Successfully", "success"); router('inventory');
};

window.newStockTakeModal = async () => {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id);
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Stock Take</h3><div class="input-group"><label class="input-label">Select Location</label><select id="stLoc" class="input-field">${locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select></div><button onclick="window.startStockTake()" class="btn-primary">Start Counting</button>`; document.getElementById('modal').style.display = 'flex';
};

window.startStockTake = async () => {
    const locId = document.getElementById('stLoc').value;
    const inv = await getInventory(profile.organization_id);
    const items = inv.filter(x => x.location_id === locId);
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Enter Physical Count</h3><div class="max-h-[300px] overflow-y-auto bg-slate-50 p-2 rounded mb-4"><table class="w-full text-left text-xs"><thead><tr><th>Item</th><th>System</th><th>Physical</th></tr></thead><tbody>${items.map(i => `<tr><td class="py-2 font-bold uppercase">${i.products.name}</td><td>${i.quantity}</td><td><input type="number" class="st-input w-20 border rounded p-2 font-bold text-center" data-id="${i.product_id}" data-sys="${i.quantity}"></td></tr>`).join('')}</tbody></table></div><button onclick="window.saveStockTake('${locId}')" class="btn-primary">Submit Variance Report</button>`;
};

window.saveStockTake = async (locId) => {
    const inputs = document.querySelectorAll('.st-input');
    const { data: st } = await supabase.from('stock_takes').insert({ organization_id: profile.organization_id, location_id: locId, conducted_by: profile.id, status: 'Completed' }).select().single();
    const items = Array.from(inputs).map(inp => ({ stock_take_id: st.id, product_id: inp.getAttribute('data-id'), system_qty: inp.getAttribute('data-sys'), physical_qty: inp.value || 0 }));
    await supabase.from('stock_take_items').insert(items);
    document.getElementById('modal').style.display = 'none'; window.showNotification("Stock Take Completed", "success"); window.currentRepView='variance'; router('reports');
};

window.viewVariance = async (id) => {
    const { data: items } = await supabase.from('stock_take_items').select('*, products(name)').eq('stock_take_id', id);
    let html = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Variance Report</h3><table class="w-full text-xs text-left border"><thead><tr class="bg-slate-100"><th>Item</th><th>System</th><th>Physical</th><th>Variance</th></tr></thead><tbody>`;
    items.forEach(i => { const vClass = i.variance < 0 ? 'text-red-600 font-bold' : (i.variance > 0 ? 'text-blue-600 font-bold' : 'text-slate-400'); html += `<tr class="border-b"><td class="p-2 font-bold uppercase">${i.products.name}</td><td>${i.system_qty}</td><td>${i.physical_qty}</td><td class="${vClass}">${i.variance}</td></tr>`; });
    html += `</tbody></table><button onclick="document.getElementById('modal').style.display='none'" class="btn-primary mt-4 w-full">Close</button>`; document.getElementById('modal-content').innerHTML = html; document.getElementById('modal').style.display = 'flex';
};

// --- SETTINGS ---
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
            return `<div class="flex items-center justify-between border-b border-slate-50 last:border-0 py-3"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-[10px] text-slate-600">${code.substring(0,1)}</div><div><p class="font-bold text-sm text-slate-700">${code}</p><p class="text-[10px] text-slate-400 font-medium">${isBase ? 'Base Currency' : 'Foreign'}</p></div></div><div>${isBase ? `<span class="font-mono font-bold text-slate-300 px-4">1.00</span>` : `<input id="rate-${code}" type="number" step="0.01" value="${currentVal}" placeholder="Set Rate..." class="w-32 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-right font-mono font-bold text-slate-800 focus:border-slate-900 outline-none transition text-sm">`}</div></div>`;
        }).join('');
        c.innerHTML = `<div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase text-slate-900">Settings</h1></div><div class="grid grid-cols-1 lg:grid-cols-2 gap-8"><div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-fit"><div class="p-6 border-b border-slate-100 flex justify-between items-center"><h3 class="font-bold text-sm uppercase text-slate-800">Business Locations</h3><button onclick="window.addStoreModal()" class="text-[10px] font-bold bg-slate-900 text-white px-3 py-1.5 rounded hover:bg-slate-700">+ ADD NEW</button></div><div class="p-0 overflow-x-auto"><table class="w-full text-left table-auto"><thead class="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-400"><tr><th class="py-3 pl-6">Name</th><th>Type</th><th class="pr-6 text-right">Status</th></tr></thead><tbody>${locs.map(x => `<tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50"><td class="font-bold text-sm text-slate-700 py-4 pl-6 whitespace-nowrap">${x.name}</td><td class="text-xs font-bold uppercase text-gray-400">${x.type.replace('_',' ')}</td><td class="text-right pr-6"><span class="bg-green-50 text-green-600 px-2 py-1 rounded text-[9px] font-bold">ACTIVE</span></td></tr>`).join('')}</tbody></table></div></div><div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-fit"><div class="p-6 border-b border-slate-100 bg-slate-50/50"><h3 class="font-bold text-sm uppercase text-slate-800">Exchange Rates</h3><p class="text-[10px] text-slate-500 mt-1">Define rates relative to 1 ${baseCurrency}</p></div><div class="p-6 pt-2">${ratesHTML}<button onclick="window.saveRates()" class="btn-primary w-full mt-6 justify-center">Update Rates</button></div></div></div>`;
    } catch(e) { console.error(e); c.innerHTML = `<div class="p-10 text-red-500">Error loading settings.</div>`; }
}

window.saveRates = async () => {
    const supportedCurrencies = ['TZS', 'USD', 'EUR', 'GBP', 'KES'];
    const updates = [];
    for (const code of supportedCurrencies) {
        if (code === baseCurrency) continue; 
        const input = document.getElementById(`rate-${code}`);
        if (input && input.value) {
            updates.push({ organization_id: profile.organization_id, currency_code: code, rate: parseFloat(input.value) });
        }
    }
    if (updates.length === 0) return window.showNotification("No rates to update", "error");
    try {
        const { error } = await supabase.from('exchange_rates').upsert(updates, { onConflict: 'organization_id, currency_code' });
        if (error) throw error;
        await window.initCurrency(); 
        window.showNotification("Rates Updated Successfully", "success");
        renderSettings(document.getElementById('app-view')); 
    } catch(e) { window.showNotification(e.message, "error"); }
};

// --- POS / BAR ---
async function renderBar(c) {
    try {
        const inv = await getInventory(profile.organization_id);
        const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).eq('type', 'department');
        if (profile.role === 'barman') { activePosLocationId = profile.assigned_location_id; } 
        else { if (!activePosLocationId && locs.length > 0) activePosLocationId = locs[0].id; }
        const storeSelector = (profile.role === 'manager' || profile.role === 'finance') ? `<div class="mb-6 bg-white p-4 rounded-xl border flex items-center gap-4 shadow-sm"><span class="text-xs font-bold text-slate-400 uppercase">Select Counter:</span><select onchange="window.switchBar(this.value)" class="bg-transparent font-bold outline-none cursor-pointer text-sm"><option value="">-- Choose --</option>${locs.map(l => `<option value="${l.id}" ${activePosLocationId === l.id ? 'selected' : ''}>${l.name}</option>`).join('')}</select></div>` : '';
        const items = inv.filter(x => x.location_id === activePosLocationId && (x.products.category === 'Beverage' || !x.products.category));
        c.innerHTML = `${storeSelector}<div class="flex flex-col lg:flex-row gap-8 h-[calc(100vh-140px)]"><div class="flex-1 overflow-y-auto pr-2"><div class="flex justify-between items-center mb-6 sticky top-0 bg-slate-100 py-2 z-10"><h1 class="text-2xl font-bold uppercase text-slate-900">POS Terminal</h1>${window.getCurrencySelectorHTML()}</div><div class="grid grid-cols-2 md:grid-cols-3 gap-4 pb-10">${items.length ? items.map(x => `<div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white p-5 border rounded-2xl cursor-pointer hover:border-slate-900 transition shadow-sm group relative overflow-hidden"><div class="absolute top-0 right-0 bg-slate-100 px-2 py-1 rounded-bl-lg text-[10px] font-bold text-slate-500">Qty: ${x.quantity}</div><p class="text-[10px] font-bold text-slate-400 uppercase mb-1 tracking-wider">${x.products.name}</p><p class="font-bold text-xl text-slate-900">${window.formatPrice(x.products.selling_price)}</p></div>`).join('') : '<div class="col-span-3 text-center py-12 border-2 border-dashed border-slate-300 rounded-2xl"><p class="text-slate-400 font-bold text-xs uppercase">No beverage stock found.</p></div>'}</div></div><div class="w-full lg:w-96 bg-white border border-slate-200 rounded-2xl p-6 h-full flex flex-col shadow-xl"><div class="flex justify-between items-center mb-6"><h3 class="font-bold text-xs uppercase text-slate-400 tracking-widest">Current Order</h3><button onclick="cart=[];window.renderCart()" class="text-[10px] text-red-500 font-bold hover:underline">CLEAR</button></div><div id="cart-list" class="flex-1 overflow-y-auto space-y-3 mb-4 pr-1"></div><div class="border-t border-slate-100 pt-6 mt-auto"><div class="flex justify-between font-bold text-2xl mb-6 text-slate-900"><span>Total</span><span id="cart-total">${window.formatPrice(0)}</span></div><button onclick="window.checkout()" class="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-slate-800 shadow-lg transform active:scale-95 transition">Complete Sale</button></div></div></div>`;
        window.renderCart();
    } catch (e) { console.error("POS Error:", e); c.innerHTML = `<div class="p-10 text-center bg-red-50 border border-red-200 rounded-2xl"><h2 class="text-red-600 font-bold text-lg mb-2">ERROR</h2><p class="text-xs text-slate-600 font-mono">${e.message}</p></div>`; }
}

async function renderApprovals(c){ if(profile.role==='storekeeper') return; const q=await getPendingApprovals(profile.organization_id); const r=q.map(x=>`<tr><td class="font-bold text-sm uppercase py-3 pl-4">${x.products?.name}</td><td class="font-bold text-blue-600 font-mono">${x.quantity}</td><td class="text-xs text-slate-500 uppercase tracking-wide">To: ${x.to_loc?.name}</td><td class="text-right pr-4"><button onclick="window.approve('${x.id}','approved')" class="text-[10px] font-bold bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-700 shadow-sm">APPROVE</button></td></tr>`).join(''); c.innerHTML=`<h1 class="text-3xl font-bold mb-8 uppercase text-slate-900">Approvals</h1><div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left"><tbody>${r.length?r:'<tr><td colspan="4" class="text-center text-xs text-slate-400 py-12">No pending approvals.</td></tr>'}</tbody></table></div></div>`; }
window.approve=async(id,s)=>{if(confirm('Authorize?'))try{await respondToApproval(id,s,profile.id);window.showNotification("Authorized","success");router('approvals');}catch(e){window.showNotification(e.message,"error");}}
async function renderStaff(c){ const{data:a}=await supabase.from('profiles').select('*').eq('organization_id',profile.organization_id); const{data:p}=await supabase.from('staff_invites').select('*').eq('organization_id',profile.organization_id).eq('status','pending'); c.innerHTML=`<div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase text-slate-900">Team</h1><button onclick="window.inviteModal()" class="btn-primary w-auto px-6 py-3 text-xs">+ Invite</button></div><div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left"><tbody>${a.map(s=>`<tr class="border-b border-slate-50 last:border-0"><td class="font-bold uppercase py-3 pl-4 text-slate-700">${s.full_name}</td><td class="text-xs font-bold text-blue-600 uppercase">${s.role}</td><td class="text-right pr-4 text-green-500 font-bold text-[10px] uppercase">ACTIVE</td></tr>`).join('')}${p.map(i=>`<tr class="bg-yellow-50"><td class="text-sm font-medium text-slate-600 py-3 pl-4">${i.email}</td><td class="text-xs font-bold text-slate-400 uppercase">${i.role}</td><td class="text-right pr-4 text-yellow-600 font-bold text-[10px] uppercase">PENDING</td></tr>`).join('')}</tbody></table></div></div>`; }
window.addProductModal=()=>{ if(profile.role !== 'manager') return; const currencyOptions = SUPPORTED_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join(''); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Product</h3><div class="input-group"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div><div class="grid grid-cols-2 gap-5 mb-4"><div class="input-group mb-0"><label class="input-label">Category</label><select id="pCat" class="input-field"><option value="Food">Food (Kitchen)</option><option value="Beverage">Beverage (Bar)</option><option value="Supplies">Supplies</option><option value="Maintenance">Maintenance</option></select></div><div class="input-group mb-0"><label class="input-label">Unit</label><select id="pUnit" class="input-field"><option value="Pcs">Pieces</option><option value="Box">Box/Crate</option><option value="Kg">Kilograms</option><option value="Ltr">Liters</option></select></div></div><div class="input-group mb-4"><label class="input-label">Input Currency</label><select id="pCurrency" class="input-field cursor-pointer bg-slate-50 font-bold text-slate-700">${currencyOptions}</select><p class="text-[10px] text-slate-400 mt-1">* Auto-converts to ${baseCurrency}</p></div><div class="grid grid-cols-2 gap-5 mb-8"><div class="input-group mb-0"><label class="input-label">Cost</label><input id="pC" type="number" class="input-field" placeholder="0.00"></div><div class="input-group mb-0"><label class="input-label">Selling</label><input id="pS" type="number" class="input-field" placeholder="0.00"></div></div><button onclick="window.execAddProduct()" class="btn-primary">Save Product</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddProduct=async()=>{ try { const name = document.getElementById('pN').value.toUpperCase(); const category = document.getElementById('pCat').value; const unit = document.getElementById('pUnit').value; const inputCurrency = document.getElementById('pCurrency').value; let cost = parseFloat(document.getElementById('pC').value); let selling = parseFloat(document.getElementById('pS').value); if (!name || isNaN(cost) || isNaN(selling)) return window.showNotification("Invalid details", "error"); const costBase = window.convertAmount(cost, inputCurrency, baseCurrency); const sellingBase = window.convertAmount(selling, inputCurrency, baseCurrency); if (costBase === null) throw new Error(`Missing exchange rate for ${inputCurrency}`); await supabase.from('products').insert({ name: name, category: category, unit: unit, cost_price: costBase, selling_price: sellingBase, organization_id: profile.organization_id }); document.getElementById('modal').style.display = 'none'; window.showNotification(`Saved ${name}`, "success"); router('inventory'); } catch(e) { window.showNotification(e.message, "error"); } };
window.addStockModal=()=>{ if(profile.role !== 'manager') return; const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name'); const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name'); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-8 uppercase text-center">Receive from Supplier</h3><div class="input-group"><label class="input-label">Item</label><select id="sP" class="input-field cursor-pointer">${prods.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div><div class="input-group"><label class="input-label">Store</label><select id="sL" class="input-field cursor-pointer">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div><div class="input-group"><label class="input-label">Qty</label><input id="sQ" type="number" class="input-field"></div><button onclick="window.execAddStock()" class="btn-primary mt-6">Confirm Entry</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddStock = async () => { try { const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value; if(!qty || qty <= 0) return window.showNotification("Invalid Quantity", "error"); const { error } = await supabase.rpc('add_stock_safe', { p_product_id: pid, p_location_id: lid, p_quantity: qty, p_org_id: profile.organization_id }); if(error) throw error; await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty }); document.getElementById('modal').style.display = 'none'; window.showNotification("Stock Updated Successfully", "success"); router('inventory'); } catch(e) { window.showNotification(e.message, "error"); } };
window.issueModal = async (name, id, fromLoc) => { selectedDestinationId = null; let { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).neq('id', fromLoc); if(profile.role === 'storekeeper') locs = locs.filter(l => l.type === 'department'); const gridHTML = locs.map(l => `<div onclick="window.selectDest(this, '${l.id}')" class="dest-card border border-slate-200 p-4 rounded-xl cursor-pointer hover:border-slate-900 hover:bg-slate-50 transition flex flex-col items-center justify-center gap-1 text-center"><span class="font-bold text-xs uppercase text-slate-800">${l.name}</span><span class="text-[9px] font-bold text-slate-400 tracking-wider uppercase">${l.type.replace('_',' ')}</span></div>`).join(''); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">Move Stock</h3><div class="input-group mb-6"><label class="input-label">Product</label><input value="${name}" disabled class="input-field bg-slate-50 uppercase text-slate-500 font-bold"></div><div class="mb-6"><label class="input-label mb-3 block">Select Destination</label><div class="grid grid-cols-2 gap-3 max-h-[200px] overflow-y-auto pr-1">${gridHTML || '<p class="text-xs text-slate-400 col-span-2 text-center py-4">No destinations available.</p>'}</div></div><div class="input-group"><label class="input-label">Quantity</label><input id="tQty" type="number" class="input-field" placeholder="0"></div><button onclick="window.execIssue('${id}','${fromLoc}')" class="btn-primary mt-4">Request Transfer</button>`; document.getElementById('modal').style.display = 'flex'; };
window.selectDest = (el, id) => { document.querySelectorAll('.dest-card').forEach(c => { c.classList.remove('bg-slate-900', 'border-slate-900', 'text-white'); c.querySelector('span').classList.remove('text-white'); c.querySelectorAll('span')[1].classList.remove('text-slate-300'); c.classList.add('border-slate-200', 'hover:border-slate-900', 'hover:bg-slate-50'); c.querySelector('span').classList.add('text-slate-800'); c.querySelectorAll('span')[1].classList.add('text-slate-400'); }); el.classList.remove('border-slate-200', 'hover:border-slate-900', 'hover:bg-slate-50'); el.classList.add('bg-slate-900', 'border-slate-900'); el.querySelector('span').classList.remove('text-slate-800'); el.querySelector('span').classList.add('text-white'); el.querySelectorAll('span')[1].classList.remove('text-slate-400'); el.querySelectorAll('span')[1].classList.add('text-slate-300'); selectedDestinationId = id; };
window.execIssue = async (pId, fId) => { try { const qty = document.getElementById('tQty').value; if (!selectedDestinationId) return window.showNotification("Select Destination", "error"); if (!qty || qty <= 0) return window.showNotification("Enter Quantity", "error"); await transferStock(pId, fId, selectedDestinationId, qty, profile.id, profile.organization_id); document.getElementById('modal').style.display = 'none'; window.showNotification("Transfer Requested", "success"); router('inventory'); } catch(e){ window.showNotification(e.message, "error"); } };
window.inviteModal = async () => { const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-8 uppercase text-center">Invite Staff</h3><div class="input-group"><label class="input-label">Email</label><input id="iE" class="input-field" placeholder="email@company.com"></div><div class="input-group"><label class="input-label">Role</label><select id="iR" class="input-field cursor-pointer"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance</option></select></div><div class="input-group"><label class="input-label">Assign Location</label><select id="iL" class="input-field cursor-pointer">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div><button onclick="window.execInvite()" class="btn-primary mt-6">Send Invitation</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execInvite = async () => { const email = document.getElementById('iE').value; if(!email.includes('@')) return window.showNotification("Invalid Email", "error"); await supabase.from('staff_invites').insert({ email, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' }); document.getElementById('modal').style.display = 'none'; window.showNotification("Invitation Sent", "success"); router('staff'); };
window.addStoreModal=()=>{ document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-8 uppercase text-center">Add Hub</h3><div class="input-group"><label class="input-label">Name</label><input id="nN" class="input-field"></div><div class="input-group"><label class="input-label">Type</label><select id="nT" class="input-field"><option value="main_store">Main Store</option><option value="camp_store">Camp Store</option><option value="department">Department</option></select></div><button onclick="window.execAddStore()" class="btn-primary mt-6">Create</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddStore=async()=>{ await createLocation(profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').style.display = 'none'; router('settings'); };
window.switchBar = (id) => { activePosLocationId = id; router('bar'); };
window.addCart=(n,p,id)=>{const x=cart.find(c=>c.id===id); if(x)x.qty++; else cart.push({name:n,price:p,id,qty:1}); window.renderCart();}
window.renderCart=()=>{ const l=document.getElementById('cart-list'), t=document.getElementById('cart-total'); if(!cart.length){l.innerHTML='<div class="text-center text-xs text-slate-300 py-8 font-bold uppercase tracking-widest">Empty Ticket</div>'; t.innerText=window.formatPrice(0); return;} let sum=0; l.innerHTML=cart.map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between text-xs font-bold uppercase text-slate-700"><span>${i.name} x${i.qty}</span><button onclick="window.remCart('${i.id}')" class="text-red-500 font-bold hover:text-red-700">X</button></div>`}).join(''); t.innerText=window.formatPrice(sum); }
window.remCart=(id)=>{cart=cart.filter(c=>c.id!==id); window.renderCart();}
window.checkout=async()=>{if(!cart.length) return; try{await processBarSale(profile.organization_id, activePosLocationId, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); window.showNotification("Sale Completed", "success"); cart=[]; window.renderCart(); router('bar');}catch(e){window.showNotification(e.message, "error");}}

// --- CRITICAL: ATTACH GLOBALS TO WINDOW ---
window.addProductModal = window.addProductModal;
window.execAddProduct = window.execAddProduct;
window.addStockModal = window.addStockModal;
window.execAddStock = window.execAddStock;
window.issueModal = window.issueModal;
window.selectDest = window.selectDest;
window.execIssue = window.execIssue;
window.inviteModal = window.inviteModal;
window.execInvite = window.execInvite;
window.addStoreModal = window.addStoreModal;
window.execAddStore = window.execAddStore;
window.switchBar = window.switchBar;
window.addCart = window.addCart;
window.renderCart = window.renderCart;
window.remCart = window.remCart;
window.checkout = window.checkout;
window.createPOModal = window.createPOModal;
window.execCreatePO = window.execCreatePO;
window.receivePO = window.receivePO;
window.newStockTakeModal = window.newStockTakeModal;
window.startStockTake = window.startStockTake;
window.saveStockTake = window.saveStockTake;
window.viewVariance = window.viewVariance;
window.saveRates = window.saveRates;
window.filterLogs = window.filterLogs;
window.changeCurrency = window.changeCurrency;
