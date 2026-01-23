import { getSession, logout } from './auth.js';
import { getInventory, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

// --- 1. GLOBAL CONFIGURATION & STATE ---
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
window.tempLocs = []; 

// System Constants
const ALL_UNITS = ['Crate', 'Carton', 'Dozen', 'Pcs', 'Kg', 'Ltr', 'Box', 'Bag', 'Packet', 'Set', 'Roll', 'Tin', 'Bundle', 'Pallet', 'Mita', 'Galoni'];
const ALL_CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX', 'RWF', 'ZAR', 'AED', 'CNY', 'INR', 'CAD', 'AUD', 'JPY', 'CHF', 'SAR', 'QAR'];

// --- 2. BRANDING ENFORCEMENT (IMMEDIATE) ---
(function enforceBranding() {
    document.title = "ugaviSmarT | Enterprise ERP";
    const brandElements = document.querySelectorAll('.brand-logo, .logo-text, h1');
    brandElements.forEach(el => {
        if(el.innerText.includes('Pilot')) el.innerText = "ugaviSmarT";
    });
})();

// --- 3. GLOBAL UTILITIES (MUST BE TOP LEVEL) ---
window.closeModalOutside = (e) => { if (e.target.classList.contains('modal-backdrop')) e.target.style.display = 'none'; };

window.showNotification = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    if(!container) return alert(message);
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

// 🔥 FIX: CURRENCY FUNCTIONS DEFINED GLOBALLY BEFORE USE
window.initCurrency = async () => { 
    if (!window.profile) return; 
    try { 
        const { data: org } = await supabase.from('organizations').select('base_currency').eq('id', window.profile.organization_id).single(); 
        window.baseCurrency = org?.base_currency || 'TZS'; 
        const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', window.profile.organization_id); 
        window.currencyRates = {}; 
        window.currencyRates[window.baseCurrency] = 1; 
        (rates||[]).forEach(r => window.currencyRates[r.currency_code] = Number(r.rate)); 
    } catch(e){ console.error("Currency Init Error", e); } 
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
    // Re-render current view
    const activeEl = document.querySelector('.nav-item.nav-active'); 
    if (activeEl) window.router(activeEl.id.replace('nav-', '')); 
};

window.getCurrencySelectorHTML = () => { 
    const options = ALL_CURRENCIES.map(c => `<option value="${c}" ${window.selectedCurrency === c ? 'selected' : ''}>${c}</option>`).join(''); 
    return `<select onchange="window.changeCurrency(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer ml-4 shadow-sm h-8">${options}</select>`; 
};

// --- 4. INITIALIZATION ---
window.onload = async () => {
    window.logoutAction = logout;
    const session = await getSession();
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
        
        // Setup Workflow
        if (!prof || !prof.organization_id) { 
            const setupCurr = document.getElementById('setupBaseCurr'); 
            if(setupCurr) setupCurr.innerHTML = ALL_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
            document.getElementById('name-modal').style.display = 'flex';
            if(session.user.user_metadata?.full_name) document.getElementById('userNameInput').value = session.user.user_metadata.full_name;
            return; 
        }
        
        if (prof.status === 'suspended') { await logout(); alert("Account Suspended."); return; }
        
        window.profile = prof;
        
        // Pre-load Cache
        const [locsRes, supsRes] = await Promise.all([
            supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id),
            supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id)
        ]);
        window.cachedLocations = locsRes.data || [];
        window.cachedSuppliers = supsRes.data || [];
        
        await window.initCurrency();
        
        // Navigation Control
        const role = window.profile.role;
        const hide = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
        
        if (role === 'finance' || role === 'deputy_finance') hide(['nav-bar', 'nav-settings', 'nav-staff']); 
        else if (role === 'financial_controller') hide(['nav-bar', 'nav-settings']); 
        else if (role === 'storekeeper' || role === 'deputy_storekeeper') hide(['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings']);
        else if (role === 'barman') hide(['nav-inventory', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);
        
        if (['overall_storekeeper', 'deputy_storekeeper', 'manager', 'deputy_manager'].includes(role)) window.router('inventory');
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

// --- CORE: SETUP (RPC) ---
window.saveName = async () => { 
    const orgName = document.getElementById('orgNameInput').value;
    const name = document.getElementById('userNameInput').value; 
    const phone = document.getElementById('userPhoneInput').value; 
    
    if (!orgName || !name) return window.showNotification("Fields Required", "error");

    const { data, error } = await supabase.rpc('create_setup_data', {
        p_org_name: orgName, p_full_name: name, p_phone: phone
    });

    if (error) return window.showNotification("Setup Error: " + error.message, "error");

    document.getElementById('name-modal').style.display = 'none';
    window.showNotification("Karibu ugaviSmarT", "success");
    location.reload(); 
};

// --- 5. INVENTORY (ACTIONS RESTORED) ---
window.renderInventory = async (c) => {
    const isPOView = window.currentInvView === 'po'; 
    const stock = await getInventory(window.profile.organization_id);
    let filteredStock = stock;
    
    // Role Filtering
    const role = window.profile.role;
    if (role === 'barman') filteredStock = stock.filter(x => x.location_id === window.profile.assigned_location_id && x.products.category === 'Beverage');
    else if (role.includes('storekeeper')) filteredStock = stock.filter(x => x.location_id === window.profile.assigned_location_id);
    
    const showPrice = ['manager', 'deputy_manager', 'financial_controller', 'overall_finance'].includes(role);
    // 🔥 RESTORED: Can Adjust Permission logic
    const canAdjust = ['manager', 'deputy_manager', 'financial_controller', 'overall_storekeeper'].includes(role);

    let content = '';
    
    // LPO VIEW
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
                    <td class="text-sm font-bold text-slate-800 uppercase">${p.suppliers?.name || p.supplier_name || 'Unknown'}</td>
                    <td class="text-sm font-mono font-bold text-slate-900">${window.formatPrice(p.total_cost)}</td>
                    <td><span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase ${p.status==='Pending'?'bg-yellow-50 text-yellow-600':'bg-green-50 text-green-600'}">${p.status}</span></td>
                    <td>${p.status!=='Received'?`<button onclick="window.openPartialReceive('${p.id}')" class="text-[10px] bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 font-bold">RECEIVE</button>`:'<span class="text-slate-300 text-[10px] font-bold">COMPLETED</span>'}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    } 
    // STOCK VIEW
    else {
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
    
    const canCreateLPO = ['manager', 'deputy_manager', 'overall_storekeeper'].includes(role);
    
    // Header Construction
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

// --- 6. STAFF MODULE (DEPUTY & ACTIONS RESTORED) ---
window.renderStaff = async (c) => {
    if(!['manager', 'financial_controller'].includes(window.profile.role)) return c.innerHTML = '<div class="p-20 text-center text-slate-400 font-bold">Access Restricted</div>';

    const [staffRes, inviteRes, locsRes] = await Promise.all([
        supabase.from('profiles').select('*, locations(name)').eq('organization_id', window.profile.organization_id),
        supabase.from('staff_invites').select('*, locations(name)').eq('organization_id', window.profile.organization_id).eq('status', 'pending'),
        supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id)
    ]);

    const staff = staffRes.data || [];
    const invites = inviteRes.data || [];
    window.tempLocs = locsRes.data || [];

    c.innerHTML = `
    <div class="flex justify-between items-center mb-8">
        <h1 class="text-3xl font-bold uppercase text-slate-900">Team Management</h1>
        <button onclick="window.inviteModal()" class="btn-primary w-auto px-6 shadow-lg bg-slate-900 text-white">INVITE</button>
    </div>

    <div class="bg-white rounded-3xl border shadow-sm overflow-hidden mb-8">
        <table class="w-full text-left">
            <thead class="bg-slate-50 border-b"><tr><th class="p-4 text-xs text-slate-400 uppercase">User</th><th class="text-xs text-slate-400 uppercase">Role</th><th class="text-xs text-slate-400 uppercase">Location</th><th class="text-xs text-slate-400 uppercase">Status</th><th class="text-xs text-slate-400 uppercase text-right pr-6">Actions</th></tr></thead>
            <tbody>${staff.map(s => `
                <tr class="border-b last:border-0 hover:bg-slate-50 transition group">
                    <td class="p-4 font-bold text-slate-700">${s.full_name || 'Pending'}<br><span class="text-[10px] text-slate-400 font-normal">${s.email}</span></td>
                    <td class="text-xs uppercase">${s.role.replace('_', ' ')}</td>
                    <td class="text-xs uppercase">${s.locations?.name || 'All'}</td>
                    <td class="text-xs uppercase ${s.status==='active'?'text-green-600':'text-red-600'}">${s.status}</td>
                    <td class="text-right pr-6">
                        ${s.id !== window.profile.id ? `
                        <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition">
                            <button onclick="window.viewStaffDetails('${s.id}')" class="text-[10px] border px-2 py-1 rounded hover:bg-slate-100">LOGS</button>
                            <button onclick="window.reassignModal('${s.id}', '${s.full_name}')" class="text-[10px] border px-2 py-1 rounded hover:bg-slate-100">MOVE</button>
                            <button onclick="window.toggleSuspend('${s.id}', '${s.status}')" class="text-[10px] border px-2 py-1 rounded ${s.status==='active'?'text-red-500':'text-green-500'}">${s.status==='active'?'SUSPEND':'ACTIVATE'}</button>
                        </div>` : '<span class="text-[10px] text-slate-300">YOU</span>'}
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>
    </div>
    
    ${invites.length ? `<h3 class="text-xs font-bold text-slate-400 uppercase mb-4">Pending Invites</h3><div class="bg-white rounded-3xl border shadow-sm p-4">${invites.map(i=>`<div class="flex justify-between py-2 border-b last:border-0"><span class="text-xs font-bold">${i.email}</span><span class="text-xs uppercase text-slate-500">${i.role.replace('_', ' ')}</span><button onclick="window.cancelInvite('${i.id}')" class="text-[10px] text-red-500 font-bold">CANCEL</button></div>`).join('')}</div>` : ''}`;
};

// --- STAFF MODALS (DEPUTY ROLES INCLUDED) ---
window.inviteModal = () => {
    const locOpts = window.tempLocs.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase text-center">Invite Staff</h3>
        <div class="input-group"><label class="input-label">Email</label><input id="iE" type="email" class="input-field"></div>
        <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="input-group mb-0"><label class="input-label">Role</label>
                <select id="iR" class="input-field">
                    <option value="storekeeper">Storekeeper</option>
                    <option value="deputy_storekeeper">Deputy Storekeeper</option>
                    <option value="barman">Barman</option>
                    <option value="finance">Finance</option>
                    <option value="deputy_finance">Deputy Finance</option>
                    <option value="financial_controller">Controller (Admin)</option>
                    <option value="deputy_manager">Deputy Manager</option>
                </select>
            </div>
            <div class="input-group mb-0"><label class="input-label">Assign To</label><select id="iL" class="input-field">${locOpts}</select></div>
        </div>
        <button onclick="window.execInvite()" class="btn-primary">SEND INVITE</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execInvite = async () => {
    const email = document.getElementById('iE').value;
    if(!email) return;
    await supabase.from('staff_invites').insert({
        organization_id: window.profile.organization_id,
        email, role: document.getElementById('iR').value,
        assigned_location_id: document.getElementById('iL').value,
        status: 'pending'
    });
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Invite Sent", "success");
    window.renderStaff(document.getElementById('app-view'));
};

window.viewStaffDetails = async (id) => {
    const [logs, p] = await Promise.all([
        supabase.from('audit_logs').select('*').eq('user_id', id).order('created_at', {ascending: false}).limit(5),
        supabase.from('profiles').select('*').eq('id', id).single()
    ]);
    const logData = logs.data || [];
    const prof = p.data;
    const logHtml = logData.length ? logData.map(l => `<div class="text-[10px] border-b py-2"><span class="font-bold">${l.action}</span> - ${new Date(l.created_at).toLocaleString()}</div>`).join('') : '<span class="text-xs text-slate-400">No logs.</span>';
    document.getElementById('modal-content').innerHTML = `<div class="text-center mb-4"><h3 class="font-bold text-lg">${prof.full_name}</h3><p class="text-xs text-slate-500">${prof.email}</p></div><h4 class="text-xs font-bold uppercase text-slate-400 mb-2">Activity</h4><div class="bg-slate-50 p-4 rounded-xl border mb-4">${logHtml}</div>`;
    document.getElementById('modal').style.display = 'flex';
};

window.reassignModal = (id, name) => {
    const locOpts = window.tempLocs.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-2 text-center">Move ${name}</h3><div class="input-group"><label class="input-label">New Location</label><select id="nL" class="input-field">${locOpts}</select></div><button onclick="window.doReassign('${id}')" class="btn-primary">CONFIRM</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.doReassign = async (id) => {
    await supabase.from('profiles').update({ assigned_location_id: document.getElementById('nL').value }).eq('id', id);
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Reassigned", "success");
    window.renderStaff(document.getElementById('app-view'));
};

window.toggleSuspend = async (id, status) => {
    const newStat = status === 'active' ? 'suspended' : 'active';
    await supabase.from('profiles').update({ status: newStat }).eq('id', id);
    window.showNotification("Status Updated", "success");
    window.renderStaff(document.getElementById('app-view'));
};

window.cancelInvite = async (id) => {
    await supabase.from('staff_invites').delete().eq('id', id);
    window.showNotification("Cancelled", "success");
    window.renderStaff(document.getElementById('app-view'));
};

// --- STOCK EDIT & DELETE LOGIC (RESTORED) ---
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
    window.showNotification("Adjustment Request Sent", "success");
};

window.requestDeleteProduct = async (id) => {
    window.premiumConfirm("Delete Product?", "This requires approval.", "Request Delete", async () => {
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

// --- SETTINGS (FULL HIERARCHY) ---
window.renderSettings = async (c) => {
    const [l, s] = await Promise.all([
        supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id),
        supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id)
    ]);
    window.cachedLocations = l.data || [];
    
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
                <div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Locations</h3><button onclick="window.addStoreModal()" class="text-[10px] bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold">+ ADD</button></div>
                <table class="w-full text-left"><tbody>${l.data.map(loc => `<tr class="border-b last:border-0"><td class="py-3 font-bold text-sm uppercase text-slate-700">${loc.name}</td><td class="text-xs text-slate-400 uppercase">${loc.type.replace('_', ' ')}</td></tr>`).join('')}</tbody></table>
            </div>
            <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
                <div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Suppliers</h3><button onclick="window.openSupplierModal()" class="text-[10px] bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold">+ NEW</button></div>
                <table class="w-full text-left"><tbody>${s.data.map(sup => `<tr class="border-b last:border-0"><td class="py-3 font-bold text-sm uppercase text-slate-700">${sup.name}</td><td class="text-xs text-slate-400 font-mono text-right">${sup.tin || '-'}</td></tr>`).join('')}</tbody></table>
            </div>
        </div>
        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
            <div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Exchange Rates</h3></div>
            <div class="max-h-[500px] overflow-y-auto pr-2">${rateRows}</div>
            <button onclick="window.saveRates()" class="btn-primary mt-6">UPDATE RATES</button>
        </div>
    </div>`;
};

window.addStoreModal = () => {
    // Generate parent list
    const parents = window.cachedLocations.filter(l => l.type !== 'department').map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase text-center">New Location</h3>
        <div class="input-group"><label class="input-label">Name</label><input id="locName" class="input-field uppercase"></div>
        <div class="input-group"><label class="input-label">Type</label><select id="locType" class="input-field" onchange="document.getElementById('pGrp').style.display=this.value==='main_store'?'none':'block'"><option value="sub_store">Sub Store / Camp</option><option value="department">Department (Bar/Kitchen)</option><option value="main_store">Main Store</option></select></div>
        <div id="pGrp" class="input-group"><label class="input-label">Parent</label><select id="locParent" class="input-field">${parents}</select></div>
        <button onclick="window.execAddStore()" class="btn-primary">CREATE</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execAddStore = async () => {
    const name = document.getElementById('locName').value;
    const type = document.getElementById('locType').value;
    const parent = type === 'main_store' ? null : document.getElementById('locParent').value;
    if(!name) return;
    await supabase.from('locations').insert({ organization_id: window.profile.organization_id, name, type, parent_location_id: parent });
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Location Created", "success");
    window.router('settings');
};

window.openSupplierModal = () => {
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Supplier</h3><div class="input-group"><label class="input-label">Name</label><input id="sN" class="input-field uppercase"></div><div class="input-group"><label class="input-label">TIN</label><input id="sT" class="input-field"></div><div class="input-group"><label class="input-label">Phone</label><input id="sP" class="input-field"></div><div class="input-group"><label class="input-label">Address</label><input id="sA" class="input-field"></div><button onclick="window.execAddSupplier()" class="btn-primary">SAVE</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execAddSupplier = async () => {
    const name = document.getElementById('sN').value;
    if(!name) return;
    await supabase.from('suppliers').insert({ organization_id: window.profile.organization_id, name, tin: document.getElementById('sT').value, contact: document.getElementById('sP').value, address: document.getElementById('sA').value });
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Saved", "success");
    window.router('settings');
};

// ... (Product Wizard & Other Functions from previous correct responses remain) ...
// Ensure Product Wizard calls window.finalizeProduct correctly with Location Prices
window.addProductModal = () => { 
    if(!['manager','overall_storekeeper'].includes(window.profile.role)) return; 
    const unitOpts = ALL_UNITS.map(u => `<option value="${u}">${u}</option>`).join(''); 
    const currOpts = ALL_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Product</h3><div class="input-group"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div><div class="grid grid-cols-2 gap-4 mb-4"><div class="input-group mb-0"><label class="input-label">Category</label><select id="pCat" class="input-field"><option value="Beverage">Beverage</option><option value="Food">Food</option><option value="Stationery">Stationery</option><option value="Linen">Linen</option><option value="Construction">Construction</option></select></div><div class="input-group mb-0"><label class="input-label">Unit</label><select id="pUnit" class="input-field">${unitOpts}</select></div></div><div class="input-group mb-4"><label class="input-label">Conversion</label><input id="pConv" type="number" class="input-field" value="1"></div><div class="input-group mb-4"><label class="input-label">Currency</label><select id="pCurrency" class="input-field">${currOpts}</select></div><div class="grid grid-cols-2 gap-4 mb-6"><div class="input-group mb-0"><label class="input-label">Cost</label><input id="pC" type="number" class="input-field"></div><div class="input-group mb-0"><label class="input-label">Selling</label><input id="pS" type="number" class="input-field"></div></div><button onclick="window.nextProductStep()" class="btn-primary">Next: Prices</button>`; 
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

// ... (Existing Functions for Reports, POS, etc. preserved) ...
