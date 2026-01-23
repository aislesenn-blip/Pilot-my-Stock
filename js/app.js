import { getSession, logout } from './auth.js';
import { getInventory, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

// --- CONFIGURATION ---
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

const ALL_UNITS = ['Crate', 'Carton', 'Dozen', 'Pcs', 'Kg', 'Ltr', 'Box', 'Bag', 'Packet', 'Set', 'Roll', 'Tin', 'Bundle', 'Pallet', 'Mita', 'Galoni'];
// Full Currency List
const ALL_CURRENCIES = [
    'TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX', 'RWF', 'ZAR', 'AED', 'CNY', 'INR', 'CAD', 'AUD', 'JPY', 'CHF', 'SAR', 'QAR', 'OMR', 'KWD', 'BHD', 'NGN', 'GHS', 'ETB', 'ZMW', 'MWK', 'MZN'
];

// --- UI UTILITIES ---
window.closeModalOutside = (e) => { 
    if (e.target.classList.contains('modal-backdrop')) {
        e.target.style.display = 'none'; 
    }
};

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

// --- INITIALIZATION ---
window.onload = async () => {
    // 1. Force Premium Branding
    document.title = "ugaviSmarT";
    const brandEl = document.querySelector('.brand-logo'); // Assuming class exists or just rely on title
    if(brandEl) brandEl.innerText = "ugaviSmarT";

    window.logoutAction = logout;
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    
    try {
        let { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        
        // Retry logic for latency
        if (!prof) { 
            await new Promise(r => setTimeout(r, 1000)); 
            let retry = await supabase.from('profiles').select('*').eq('id', session.user.id).single(); 
            prof = retry.data; 
        }
        
        // Setup Logic
        if (!prof || !prof.organization_id) { 
            // Load Currency Options for Setup Modal
            const currSelect = document.getElementById('baseCurrencySetup'); // Add this ID to your HTML select if not present
            if(currSelect) {
                currSelect.innerHTML = ALL_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
            }
            
            document.getElementById('name-modal').style.display = 'flex';
            if(session.user.user_metadata?.full_name) {
                document.getElementById('userNameInput').value = session.user.user_metadata.full_name;
            }
            return; 
        }

        if (prof.status === 'suspended') { await logout(); alert("Account Suspended."); return; }
        
        window.profile = prof;
        
        // Load Core Data
        const [locsRes, supsRes] = await Promise.all([
            supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id),
            supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id)
        ]);
        
        window.cachedLocations = locsRes.data || [];
        window.cachedSuppliers = supsRes.data || [];
        
        await window.initCurrency();
        
        // Role Based Navigation Hiding
        const role = window.profile.role;
        const hide = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
        
        if (role === 'finance' || role === 'deputy_finance') hide(['nav-bar', 'nav-settings', 'nav-staff']); 
        else if (role === 'financial_controller') hide(['nav-bar', 'nav-settings']); 
        else if (role === 'storekeeper') hide(['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings']);
        else if (role === 'barman') hide(['nav-inventory', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);
        
        // Router
        if (['overall_storekeeper', 'deputy_storekeeper', 'manager'].includes(role)) window.router('inventory');
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
            else if (view === 'staff') await window.renderStaff(app); // FIXED: Function now exists
            else if (view === 'settings') await window.renderSettings(app); 
        } catch (e) { 
            console.error(e); 
            app.innerHTML = `<div class="p-10 text-red-500 font-bold text-center">Error loading ${view}: ${e.message}</div>`; 
        } 
    }, 50); 
};

// --- CORE SETUP (RPC) ---
window.saveName = async () => { 
    const orgName = document.getElementById('orgNameInput').value;
    const name = document.getElementById('userNameInput').value; 
    const phone = document.getElementById('userPhoneInput').value; 
    
    if (!orgName) return window.showNotification("Company Name Required", "error");
    if (!name) return window.showNotification("Full Name Required", "error");

    const { data, error } = await supabase.rpc('create_setup_data', {
        p_org_name: orgName,
        p_full_name: name,
        p_phone: phone
    });

    if (error) {
        console.error("RPC Error:", error);
        return window.showNotification("Setup Failed: " + error.message, "error");
    }

    document.getElementById('name-modal').style.display = 'none';
    window.showNotification("Workspace Created Successfully!", "success");
    location.reload(); 
};

// --- CURRENCY LOGIC ---
window.initCurrency = async () => { if (!window.profile) return; try { const { data: org } = await supabase.from('organizations').select('base_currency').eq('id', window.profile.organization_id).single(); window.baseCurrency = org?.base_currency || 'TZS'; const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', window.profile.organization_id); window.currencyRates = {}; window.currencyRates[window.baseCurrency] = 1; (rates||[]).forEach(r => window.currencyRates[r.currency_code] = Number(r.rate)); } catch(e){} };
window.convertAmount = (amount, fromCurr, toCurr) => { if (!amount) return 0; const fromRate = window.currencyRates[fromCurr]; const toRate = window.currencyRates[toCurr]; if (!fromRate || !toRate) return null; return fromCurr === window.baseCurrency ? amount * toRate : amount / fromRate; };
window.formatPrice = (amount) => { if (!amount && amount !== 0) return '-'; let converted = window.convertAmount(amount, window.baseCurrency, window.selectedCurrency); return converted === null ? 'SET RATE' : `${window.selectedCurrency} ${Number(converted).toLocaleString(undefined, {minimumFractionDigits: 2})}`; };
window.changeCurrency = (curr) => { window.selectedCurrency = curr; localStorage.setItem('user_pref_currency', curr); const activeEl = document.querySelector('.nav-item.nav-active'); if (activeEl) window.router(activeEl.id.replace('nav-', '')); };
window.getCurrencySelectorHTML = () => { const options = ALL_CURRENCIES.map(c => `<option value="${c}" ${window.selectedCurrency === c ? 'selected' : ''}>${c}</option>`).join(''); return `<select onchange="window.changeCurrency(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer ml-4">${options}</select>`; };

// --- STAFF MODULE (THE FIX) ---
window.renderStaff = async (c) => {
    if(!['manager', 'financial_controller'].includes(window.profile.role)) {
        return c.innerHTML = '<div class="p-20 text-center text-slate-400 font-bold">Access Restricted</div>';
    }

    const { data: staff } = await supabase.from('profiles').select('*').eq('organization_id', window.profile.organization_id);
    const { data: invites } = await supabase.from('staff_invites').select('*').eq('organization_id', window.profile.organization_id).eq('status', 'pending');

    c.innerHTML = `
    <div class="flex justify-between items-center mb-8">
        <h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">Team Management</h1>
        <button onclick="window.inviteModal()" class="btn-primary w-auto px-6 shadow-lg bg-slate-900 text-white">INVITE STAFF</button>
    </div>

    <div class="grid grid-cols-1 gap-8">
        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="p-6 border-b border-slate-100"><h3 class="font-bold text-sm uppercase text-slate-500">Active Staff</h3></div>
            <table class="w-full text-left">
                <thead class="bg-slate-50 border-b border-slate-100">
                    <tr><th class="p-4 text-xs uppercase text-slate-400">Name</th><th class="text-xs uppercase text-slate-400">Role</th><th class="text-xs uppercase text-slate-400">Status</th></tr>
                </thead>
                <tbody>
                    ${staff.map(s => `
                        <tr class="border-b last:border-0 hover:bg-slate-50 transition">
                            <td class="p-4 font-bold text-slate-700">${s.full_name}</td>
                            <td class="text-xs uppercase text-slate-500">${s.role.replace('_', ' ')}</td>
                            <td><span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase ${s.status==='active'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}">${s.status}</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        ${invites && invites.length > 0 ? `
        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="p-6 border-b border-slate-100"><h3 class="font-bold text-sm uppercase text-orange-500">Pending Invites</h3></div>
            <table class="w-full text-left">
                <tbody>
                    ${invites.map(i => `
                        <tr class="border-b last:border-0 hover:bg-slate-50">
                            <td class="p-4 font-bold text-slate-700">${i.email}</td>
                            <td class="text-xs uppercase text-slate-500">${i.role}</td>
                            <td class="text-xs text-slate-400 italic">Waiting to join...</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>` : ''}
    </div>`;
};

// --- SETTINGS (BUTTONS FIXED) ---
window.renderSettings = async (c) => {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
    const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id);
    
    // Currency Exchange UI
    const rateRows = ALL_CURRENCIES.map(code => {
        const isBase = code === window.baseCurrency;
        const val = isBase ? 1 : (window.currencyRates[code] || '');
        return `<div class="flex justify-between items-center py-2 border-b last:border-0"><span class="font-bold text-xs w-10">${code}</span>${isBase ? '<span class="text-xs font-mono font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded">BASE</span>' : `<input id="rate-${code}" type="number" step="0.01" value="${val}" class="w-24 input-field py-1 text-right font-mono text-xs" placeholder="Rate">`}</div>`;
    }).join('');

    c.innerHTML = `
    <h1 class="text-3xl font-bold uppercase text-slate-900 mb-8">Settings</h1>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div class="space-y-8">
            <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
                <div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Locations</h3><button onclick="window.addStoreModal()" class="text-[10px] bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-slate-800 transition">+ ADD</button></div>
                <table class="w-full text-left"><tbody>${locs.map(l => `<tr class="border-b last:border-0"><td class="py-3 font-bold text-sm uppercase text-slate-700">${l.name}</td><td class="text-xs text-slate-400 uppercase">${l.type.replace('_', ' ')}</td></tr>`).join('')}</tbody></table>
            </div>
            <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
                <div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Suppliers</h3><button onclick="window.openSupplierModal()" class="text-[10px] bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-slate-800 transition">+ NEW</button></div>
                <table class="w-full text-left"><tbody>${(sups||[]).map(s => `<tr class="border-b last:border-0"><td class="py-3 font-bold text-sm uppercase text-slate-700">${s.name}</td><td class="text-xs text-slate-400 font-mono text-right">${s.tin || '-'}</td></tr>`).join('')}</tbody></table>
            </div>
        </div>
        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
            <div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Exchange Rates</h3></div>
            <div class="max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">${rateRows}</div>
            <button onclick="window.saveRates()" class="btn-primary mt-6">UPDATE RATES</button>
        </div>
    </div>`;
};

// --- NEW MODAL FUNCTIONS (FIXED) ---
window.addStoreModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase text-center">Add Location</h3>
        <div class="input-group mb-4">
            <label class="input-label">Location Name</label>
            <input id="locName" class="input-field uppercase" placeholder="e.g. BAR COUNTER A">
        </div>
        <div class="input-group mb-6">
            <label class="input-label">Type</label>
            <select id="locType" class="input-field">
                <option value="main_store">Main Store</option>
                <option value="department">Department (Bar/Kitchen)</option>
            </select>
        </div>
        <button onclick="window.execAddStore()" class="btn-primary">CREATE LOCATION</button>
    `;
    document.getElementById('modal').style.display = 'flex';
};

window.execAddStore = async () => {
    const name = document.getElementById('locName').value;
    const type = document.getElementById('locType').value;
    if(!name) return window.showNotification("Name required", "error");

    const { error } = await supabase.from('locations').insert({
        organization_id: window.profile.organization_id,
        name: name,
        type: type,
        // Parent will be null for now, simple hierarchy
    });

    if(error) window.showNotification(error.message, "error");
    else {
        window.showNotification("Location Added", "success");
        document.getElementById('modal').style.display = 'none';
        window.router('settings');
    }
};

window.openSupplierModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase text-center">New Supplier</h3>
        <div class="input-group mb-4">
            <label class="input-label">Company Name</label>
            <input id="supName" class="input-field uppercase">
        </div>
        <div class="input-group mb-4">
            <label class="input-label">TIN Number</label>
            <input id="supTin" class="input-field font-mono">
        </div>
        <div class="input-group mb-6">
            <label class="input-label">Contact / Phone</label>
            <input id="supContact" class="input-field">
        </div>
        <button onclick="window.execAddSupplier()" class="btn-primary">SAVE SUPPLIER</button>
    `;
    document.getElementById('modal').style.display = 'flex';
};

window.execAddSupplier = async () => {
    const name = document.getElementById('supName').value;
    const tin = document.getElementById('supTin').value;
    const contact = document.getElementById('supContact').value;
    
    if(!name) return;

    const { error } = await supabase.from('suppliers').insert({
        organization_id: window.profile.organization_id,
        name, tin, contact
    });

    if(error) window.showNotification(error.message, "error");
    else {
        window.showNotification("Supplier Saved", "success");
        document.getElementById('modal').style.display = 'none';
        window.router('settings');
    }
};

// --- LPO & INVENTORY UI FIXES ---
window.createPOModal = async () => { 
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', window.profile.organization_id).order('name'); 
    const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id); 
    
    if(!prods || !prods.length) return window.showNotification("No products found. Register products first.", "error"); 
    
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-xl mb-8 uppercase text-center tracking-tight text-slate-800">Create Purchase Order (LPO)</h3>
        
        <div class="input-group mb-8">
            <label class="input-label mb-2 text-slate-500">Select Supplier</label>
            ${(sups && sups.length) ? `
                <select id="lpoSup" class="input-field py-3 text-lg font-bold text-slate-800 border-2 border-slate-200 focus:border-slate-900 transition">
                    ${sups.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
                </select>` 
                : `<input id="lpoSupText" class="input-field py-3" placeholder="Enter Supplier Name Manually">`
            }
        </div>

        <div class="bg-slate-50 p-6 rounded-2xl border border-slate-200 mb-8 max-h-[400px] overflow-y-auto custom-scrollbar shadow-inner">
            <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Select Products & Quantities</p>
            <div class="grid grid-cols-1 gap-4">
                ${prods.map(p => `
                    <div class="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:border-slate-300 transition">
                        <input type="checkbox" class="lpo-check w-5 h-5 accent-slate-900 cursor-pointer" value="${p.id}" data-price="${p.cost_price}">
                        <div class="flex-1">
                            <span class="block text-sm font-bold uppercase text-slate-800">${p.name}</span>
                            <span class="text-[10px] text-slate-400 font-mono">Last Cost: ${window.formatPrice(p.cost_price)}</span>
                        </div>
                        <input type="number" id="qty-${p.id}" class="w-24 input-field py-2 text-center font-bold font-mono text-slate-900 border-slate-200" placeholder="Qty">
                    </div>
                `).join('')}
            </div>
        </div>

        <button onclick="window.execCreatePO()" class="btn-primary w-full py-4 text-sm tracking-widest shadow-xl shadow-slate-900/20">GENERATE ORDER</button>
    `; 
    document.getElementById('modal').style.display = 'flex'; 
};

// ... (Rest of existing functions remain largely same, just ensuring correct calls) ...

window.renderInventory = async (c) => {
    // ... (Keep existing logic, ensure buttons use defined functions)
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

// ... (Retain standard logic for POS, Reports, etc. but ensure they use RPC where possible) ...

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
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).eq('type', 'department'); 
    const list = document.getElementById('price-list');
    
    if(locs.length === 0) {
        window.finalizeProduct(); 
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

    const { data: prod, error } = await supabase.from('products').insert({
        name: d.name, category: d.category, unit: d.unit, 
        conversion_factor: d.conversion_factor, cost_price: costBase, 
        selling_price: sellingBase, organization_id: window.profile.organization_id
    }).select().single();

    if(error) return window.showNotification(error.message, "error");

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

window.execCreatePO = async () => { 
    const supSelect = document.getElementById('lpoSup');
    const supText = document.getElementById('lpoSupText');
    const supId = supSelect ? supSelect.value : null;
    const supName = supSelect ? supSelect.options[supSelect.selectedIndex].text : supText.value;
    const checks = document.querySelectorAll('.lpo-check:checked'); 
    
    if(!supName || !checks.length) return window.showNotification("Invalid Order", "error"); 
    
    let total = 0, items = []; 
    checks.forEach(c => { 
        const qty = document.getElementById(`qty-${c.value}`).value; 
        if(qty > 0) { 
            const cost = c.getAttribute('data-price'); 
            total += (qty * cost); 
            items.push({ product_id: c.value, quantity: qty, unit_cost: cost }); 
        } 
    }); 
    
    const poData = { organization_id: window.profile.organization_id, created_by: window.profile.id, supplier_name: supName, total_cost: total, status: 'Pending' }; 
    if(supId) poData.supplier_id = supId; 
    
    const { data: po } = await supabase.from('purchase_orders').insert(poData).select().single(); 
    await supabase.from('po_items').insert(items.map(i => ({...i, po_id: po.id}))); 
    
    document.getElementById('modal').style.display = 'none'; 
    window.showNotification("LPO Created Successfully", "success"); 
    window.currentInvView = 'po'; 
    window.router('inventory'); 
};

window.inviteModal = async () => {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-6 uppercase text-center">Invite Staff</h3>
    <div class="input-group"><label class="input-label">Email</label><input id="iE" class="input-field"></div>
    <div class="input-group"><label class="input-label">Role</label>
        <select id="iR" class="input-field">
            <option value="storekeeper">Storekeeper</option>
            <option value="barman">Barman</option>
            <option value="finance">Finance (Viewer)</option>
            <option value="financial_controller">Financial Controller (Admin)</option>
        </select>
    </div>
    <div class="input-group"><label class="input-label">Assign</label><select id="iL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
    <button onclick="window.execInvite()" class="btn-primary">SEND INVITE</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execInvite = async () => {
    const email = document.getElementById('iE').value;
    const role = document.getElementById('iR').value;
    if(!email) return;
    
    await supabase.from('staff_invites').insert({ email, role, organization_id: window.profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' });
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Invitation Sent", "success");
    window.router('staff');
};

// ... (Other critical operational functions like POS remain) ...
window.renderBar = async (c) => {
    const inv = await getInventory(window.profile.organization_id);
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).eq('type', 'department');
    if (window.profile.role === 'barman') window.activePosLocationId = window.profile.assigned_location_id;
    else if (!window.activePosLocationId && locs.length) window.activePosLocationId = locs[0].id;
    const items = inv.filter(x => x.location_id === window.activePosLocationId && x.products.category === 'Beverage');
    const storeSelect = (window.profile.role !== 'barman') ? `<div class="mb-8 flex items-center gap-4"><span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Active Counter:</span><select onchange="window.switchBar(this.value)" class="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-slate-900 cursor-pointer shadow-sm min-w-[200px]">${locs.map(l => `<option value="${l.id}" ${window.activePosLocationId===l.id?'selected':''}>${l.name}</option>`).join('')}</select></div>` : '';
    const payMethods = ['cash', 'mobile', 'card', 'credit'].map(m => `<button onclick="window.setPaymentMethod('${m}')" class="pay-btn flex-1 py-2 text-[10px] font-bold uppercase rounded-lg border transition ${window.selectedPaymentMethod === m ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}">${m}</button>`).join('');
    c.innerHTML = `${storeSelect} <div class="flex flex-col lg:flex-row gap-8 h-[calc(100vh-140px)]"><div class="flex-1 overflow-y-auto pr-2"><div class="flex justify-between items-center mb-6 sticky top-0 bg-[#F8FAFC] py-2 z-10"><h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">POS Terminal</h1>${window.getCurrencySelectorHTML()}</div><div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 pb-20">${items.length ? items.map(x => `<div onclick="window.addCart('${x.products.name}', ${x.products.selling_price}, '${x.product_id}')" class="bg-white p-5 rounded-2xl border border-slate-100 cursor-pointer hover:border-slate-900 transition-all duration-200 hover:shadow-lg hover:-translate-y-1 group relative overflow-hidden"><div class="flex justify-between items-start mb-2"><div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 font-bold text-[10px] group-hover:bg-slate-900 group-hover:text-white transition">${x.products.name.charAt(0)}</div><span class="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full border border-slate-100 group-hover:border-slate-200">Qty: ${x.quantity}</span></div><p class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 truncate">${x.products.name}</p><p class="text-lg font-bold text-slate-900 font-mono">${window.formatPrice(x.products.selling_price)}</p></div>`).join('') : '<div class="col-span-full py-20 text-center border-2 border-dashed border-slate-200 rounded-3xl"><p class="text-slate-400 font-bold text-sm uppercase">No beverages available.</p></div>'}</div></div><div class="w-full lg:w-96 bg-white border border-slate-200 rounded-[32px] p-8 h-full flex flex-col shadow-2xl shadow-slate-200/50"><div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase text-slate-900 tracking-widest">Current Order</h3><button onclick="window.cart=[];window.renderCart()" class="text-[10px] font-bold text-red-500 hover:bg-red-50 px-2 py-1 rounded transition">CLEAR ALL</button></div><div id="cart-list" class="flex-1 overflow-y-auto space-y-3 pr-1"></div><div class="pt-6 border-t border-slate-100 mt-auto"><div class="mb-4"><p class="text-[10px] font-bold text-slate-400 uppercase mb-2">Payment Method</p><div class="flex gap-2">${payMethods}</div></div><div class="flex justify-between items-end mb-6"><span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Amount</span><span id="cart-total" class="text-3xl font-bold text-slate-900 font-mono">${window.formatPrice(0)}</span></div><button onclick="window.confirmCheckout()" class="w-full bg-[#0F172A] text-white py-4 rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-slate-800 shadow-xl shadow-slate-900/20 active:scale-95 transition">Charge Sale</button></div></div></div>`;
    window.renderCart();
};
window.switchBar = (id) => { window.activePosLocationId = id; window.router('bar'); };
window.setPaymentMethod = (method) => { window.selectedPaymentMethod = method; window.router('bar'); };
window.addCart = (n,p,id) => { if(!window.cart) window.cart=[]; const x=window.cart.find(c=>c.id===id); if(x)x.qty++; else window.cart.push({name:n,price:p,id,qty:1}); window.renderCart(); };
window.renderCart = () => { const l=document.getElementById('cart-list'), t=document.getElementById('cart-total'); let sum=0; l.innerHTML=(window.cart||[]).map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100 group"><div class="flex flex-col"><span class="text-xs font-bold text-slate-800 uppercase">${i.name}</span><span class="text-[10px] text-slate-400 font-mono">${window.formatPrice(i.price)} x ${i.qty}</span></div><button onclick="window.remCart('${i.id}')" class="w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-500 transition">✕</button></div>`}).join(''); t.innerText=window.formatPrice(sum); };
window.remCart = (id) => { window.cart=window.cart.filter(c=>c.id!==id); window.renderCart(); };
window.confirmCheckout = () => { if(!window.cart.length) return; window.premiumConfirm(`Confirm ${window.selectedPaymentMethod.toUpperCase()} Sale?`, "Charge this amount.", "Charge", window.doCheckout); };
window.doCheckout = async () => { try { await processBarSale(window.profile.organization_id, window.activePosLocationId, window.cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), window.profile.id, window.selectedPaymentMethod); window.showNotification("Sale Completed Successfully", "success"); window.cart=[]; window.renderCart(); window.router('bar'); } catch(e) { window.showNotification(e.message, "error"); } };
// ... (Retain other existing functions if any, but ensure above key functions are prioritized)
