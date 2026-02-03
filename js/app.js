import { getSession, logout } from './auth.js';
import { getInventory, processBarSale, getPendingApprovals, respondToApproval, transferStock, createLocation } from './services.js';
import { supabase } from './supabase.js';

console.log("🚀 APP STARTING..."); // Debug 1

// --- GLOBAL VARIABLES ---
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

// --- CONSTANTS ---
const PRODUCT_CATEGORIES = ['Beverage', 'Food', 'Stationery', 'Linen', 'Construction', 'Electronics', 'Automotive', 'Cleaning', 'Furniture', 'IT Equipment', 'Kitchenware', 'Maintenance', 'Chemicals', 'Fuel', 'Medical', 'General'];
const ALL_UNITS = ['Pcs', 'Crate', 'Carton', 'Dozen', 'Kg', 'Ltr', 'Box', 'Bag', 'Packet', 'Set', 'Roll', 'Tin', 'Bundle', 'Pallet', 'Mita', 'Galoni', 'Trip', 'Bucket'];
const ALL_CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX', 'RWF', 'ZAR', 'AED', 'CNY', 'INR', 'CAD', 'AUD', 'JPY', 'CHF', 'SAR', 'QAR'];

// --- ERROR HANDLER ---
const handleError = (error, context) => {
    console.error(`❌ [${context}] Error:`, error);
    if (window.showNotification) {
        window.showNotification(error.message || JSON.stringify(error), "error");
    } else {
        alert(`System Error (${context}): ${error.message}`);
    }
};

// --- UTILITIES ---
window.closeModalOutside = function(e) { if (e.target.classList.contains('modal-backdrop')) e.target.style.display = 'none'; };

window.showNotification = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if(!container) { console.log("Toast:", message); return; }
    const div = document.createElement('div');
    div.className = `px-6 py-4 rounded-xl text-white font-bold shadow-2xl flex items-center gap-3 transition-all duration-300 transform translate-y-0 ${type === 'success' ? 'bg-[#0F172A]' : 'bg-red-600'}`;
    div.innerHTML = `<span>${message}</span>`;
    container.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 500); }, 3000);
};

window.premiumConfirm = function(title, desc, btnText, callback) {
    const modal = document.getElementById('confirm-modal');
    if(!modal) return callback(); // Bypass if modal missing
    
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
    } catch(e){ console.warn("Currency Init Warning (Non-fatal):", e); }
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

// --- MAIN INITIALIZATION ---
async function initApp() {
    console.log("🔄 Init App Triggered");
    window.logoutAction = logout;
    
    // 1. Check Session
    const session = await getSession();
    if (!session) {
        console.log("No Session -> Redirecting");
        if(!window.location.href.includes('index.html')) window.location.href = 'index.html';
        return;
    }
    console.log("✅ Session Found:", session.user.email);

    try {
        // 2. Fetch Profile
        let { data: prof, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        
        // Handle "Ghost User" or Missing Profile
        if ((error && error.code === 'PGRST116') || !prof || !prof.organization_id) {
            console.warn("⚠️ Profile incomplete. Attempting to show setup modal.");
            const nameModal = document.getElementById('name-modal');
            if(nameModal) {
                nameModal.style.display = 'flex';
                if(session.user.user_metadata?.full_name) document.getElementById('userNameInput').value = session.user.user_metadata.full_name;
            } else {
                alert("CRITICAL: Setup Modal Missing in HTML. Cannot continue setup.");
            }
            return;
        }

        if (error) throw error;
        if (prof.status === 'suspended') { await logout(); alert("Account Suspended."); return; }

        console.log("✅ Profile Loaded:", prof.role);
        window.profile = prof;

        // 3. Load Cache (Parallel)
        console.log("⏳ Loading Cache...");
        const [locsRes, supsRes, staffRes] = await Promise.all([
            supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id),
            supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id),
            supabase.from('profiles').select('id, full_name').eq('organization_id', window.profile.organization_id)
        ]);
        window.cachedLocations = locsRes.data || [];
        window.cachedSuppliers = supsRes.data || [];
        window.cachedStaff = staffRes.data || [];
        
        await window.initCurrency();
        console.log("✅ Cache Loaded");

        // 4. Permission / UI Cleanup
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

        // 5. Initial Route
        window.router('inventory');

    } catch (e) { handleError(e, "Init Error"); }
}

window.onload = initApp; // Bind to onload

// --- ROUTER ENGINE ---
window.router = async function(view) {
    console.log("Routing to:", view);
    
    // Safety check for HTML existence
    let app = document.getElementById('app-view');
    if (!app) {
        console.error("❌ CRITICAL: <div id='app-view'> NOT FOUND IN HTML!");
        alert("System Error: Main view container missing.");
        return;
    }

    if(window.profile.role === 'barman' && view !== 'bar') view = 'bar';

    // Highlight Nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    const navEl = document.getElementById(`nav-${view}`);
    if(navEl) navEl.classList.add('nav-active');

    // Show Loader
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div></div>';

    // Render Logic
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
            app.innerHTML = `<div class="p-10 text-red-500 font-bold text-center">Error loading ${view}<br><span class="text-xs text-black">${e.message}</span></div>`;
        }
    }, 50);
};

// ... (Functions za Modal na Render zinabaki vile vile isipokuwa zimefungwa vizuri) ...
// (Kuhakikisha script haikatiki, hakikisha functions zote za chini zipo. Nimezipunguza hapa kwa ufupi lakini kwenye file yako ziache)

// --- RENDER FUNCTIONS (SAMPLE FIXES) ---
window.renderInventory = async function(c) {
    try {
        console.log("Rendering Inventory...");
        const isPOView = window.currentInvView === 'po';
        let stock = [];

        // Check Permissions
        if(!window.profile.organization_id) throw new Error("Organization ID Missing");

        if (window.profile.role.includes('storekeeper') && !window.profile.role.includes('overall')) {
            stock = await getInventory(window.profile.organization_id, window.profile.assigned_location_id);
        } else {
            stock = await getInventory(window.profile.organization_id);
        }

        const showPrice = ['manager', 'deputy_manager', 'financial_controller', 'overall_finance'].includes(window.profile.role);
        const canCreateLPO = ['manager', 'deputy_manager', 'overall_storekeeper', 'financial_controller'].includes(window.profile.role);
        
        // ... (Weka code yako ya Inventory render hapa kama ilivyokuwa, nimeihakiki iko sawa) ...
        // KWA USALAMA: Badilisha `stock.map` iwe `(stock || []).map` kuzuia crash kama stock ni null
        
        let content = '';
        if (isPOView) {
             const { data: pos } = await supabase.from('purchase_orders').select('*, suppliers(name)').eq('organization_id', window.profile.organization_id).order('created_at', {ascending:false});
             content = `<table class="w-full text-left border-collapse"><thead class="bg-slate-50 border-b"><tr><th class="p-4">Date</th><th>Supplier</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>${(pos||[]).map(p => `<tr class="border-b hover:bg-slate-50 transition"><td class="py-4 pl-4 text-xs font-bold text-slate-500">${new Date(p.created_at).toLocaleDateString()}</td><td class="text-sm font-bold uppercase">${p.suppliers?.name || 'Unknown'}</td><td class="text-sm font-mono font-bold text-slate-900">${window.formatPrice(p.total_cost)}</td><td><span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${p.status==='Pending'?'bg-yellow-100 text-yellow-700':p.status==='Partial'?'bg-blue-100 text-blue-700':'bg-green-100 text-green-700'}">${p.status}</span></td><td>${p.status!=='Received'?`<button onclick="window.openReceiveModal('${p.id}')" class="text-[10px] bg-slate-900 text-white px-3 py-1 rounded font-bold">RECEIVE</button>`:'<span class="text-xs text-slate-300 font-bold">DONE</span>'}</td></tr>`).join('')}</tbody></table>`;
        } else {
             // FIX: Handle items where 'products' relation might be null
             content = `<table class="w-full text-left border-collapse"><thead class="bg-slate-50 border-b"><tr><th class="p-4">Item</th>${showPrice?'<th>Cost</th>':''}<th>Store</th><th>Stock</th><th>Action</th></tr></thead><tbody>${(stock||[]).map(i => `<tr class="border-b hover:bg-slate-50 transition group"><td class="py-4 pl-4"><div class="font-bold text-sm uppercase">${i.products?.name || 'Deleted Product'}</div><div class="text-[10px] text-slate-400 font-bold uppercase mt-0.5">${i.products?.category || '-'}</div></td>${showPrice?`<td class="font-mono text-xs text-slate-500">${window.formatPrice(i.products?.cost_price)}</td>`:''} <td class="text-xs font-bold text-slate-500 uppercase">${i.locations?.name || 'Unknown'}</td><td class="font-mono font-bold text-lg text-slate-900">${i.quantity} <span class="text-[10px] text-slate-400 font-sans">${i.products?.unit || ''}</span></td><td class="flex gap-2 p-4 justify-end"><button onclick="window.issueModal('${i.products?.name}','${i.product_id}','${i.location_id}')" class="text-[10px] border px-2 py-1 rounded hover:bg-slate-900 hover:text-white transition">MOVE</button></td></tr>`).join('')}</tbody></table>`;
        }

        c.innerHTML = `<div class="flex flex-col md:flex-row justify-between items-center gap-6 mb-8"><div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900">Inventory</h1>${showPrice?window.getCurrencySelectorHTML():''}</div><div class="flex gap-1 bg-slate-100 p-1 rounded-xl"><button onclick="window.currentInvView='stock'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${!isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">STOCK</button><button onclick="window.currentInvView='po'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">LPO</button></div><div class="flex gap-3">${canCreateLPO?`<button onclick="window.createPOModal()" class="btn-primary w-auto px-6 shadow-lg shadow-blue-900/20 bg-blue-600 hover:bg-blue-700">Create LPO</button><button onclick="window.addProductModal()" class="btn-primary w-auto px-6 shadow-lg shadow-slate-900/10">New Item</button>`:''}</div></div><div class="bg-white rounded-3xl border shadow-sm overflow-hidden min-h-[400px]">${content}</div>`;

    } catch(e) { handleError(e, "Render Inventory"); }
};

// ... ZILE FUNCTIONS ZINGINE (addProductModal, renderBar, etc) ZINABAKI VILE VILE ...
// ... HAKIKISHA UNA-COPY ZILE ZA MWANZO KAMA ZILIVYO ... 
// ... ILA HAKIKISHA HUKU CHINI UMEFUNGA BRACKETS VIZURI ...
