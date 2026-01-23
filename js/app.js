import { getSession, logout } from './auth.js';
import { getInventory, createLocation, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

// --- GLOBAL VARIABLES ---
window.profile = null;
window.currentLogs = [];
window.cart = [];
window.baseCurrency = 'USD'; 
window.currencyRates = {};
window.selectedCurrency = 'USD';
window.activePosLocationId = null;
window.cachedLocations = [];
window.cachedSuppliers = [];
window.selectedPaymentMethod = 'cash'; 

const ALL_UNITS = ['Crate', 'Carton', 'Dozen', 'Pcs', 'Kg', 'Ltr', 'Box', 'Bag', 'Packet', 'Set', 'Roll', 'Tin', 'Bundle', 'Pallet'];
const ALL_CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX', 'RWF', 'ZAR', 'AED', 'CNY', 'INR', 'CAD', 'AUD', 'JPY', 'CHF', 'SAR', 'QAR'];

// --- UTILITIES ---
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

// --- CORE FUNCTIONS (DEFINED GLOBALLY) ---

window.renderSettings = async (c) => {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
    const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id);
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
                <table class="w-full text-left"><tbody>${locs.map(l => `<tr class="border-b last:border-0"><td class="py-3 font-bold text-sm uppercase text-slate-700">${l.name}</td><td class="text-xs text-slate-400 uppercase">${l.type}</td></tr>`).join('')}</tbody></table>
            </div>
            <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
                <div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Suppliers</h3><button onclick="window.openSupplierModal()" class="text-[10px] bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold">+ NEW</button></div>
                <table class="w-full text-left"><tbody>${(sups||[]).map(s => `<tr onclick="window.openSupplierModal('${s.id}')" class="border-b last:border-0 cursor-pointer hover:bg-slate-50 transition"><td class="py-3 font-bold text-sm uppercase text-slate-700">${s.name}</td><td class="text-xs text-slate-400 font-mono text-right">${s.tin || '-'}</td></tr>`).join('')}</tbody></table>
            </div>
        </div>
        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
            <div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Exchange Rates</h3></div>
            <div class="max-h-[500px] overflow-y-auto pr-2">${rateRows}</div>
            <button onclick="window.saveRates()" class="btn-primary mt-6">UPDATE RATES</button>
        </div>
    </div>`;
};

window.createPOModal = async () => { 
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', window.profile.organization_id).order('name'); 
    const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id); 
    if(!prods || !prods.length) return window.showNotification("No products found.", "error"); 
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">Create LPO</h3><div class="input-group"><label class="input-label">Supplier</label>${(sups && sups.length) ? `<select id="lpoSup" class="input-field">${sups.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>` : `<input id="lpoSupText" class="input-field" placeholder="Enter Supplier Name">`}</div><div class="bg-slate-50 p-4 rounded-xl border mb-4 max-h-60 overflow-y-auto">${prods.map(p => `<div class="flex items-center gap-2 mb-2"><input type="checkbox" class="lpo-check w-4 h-4" value="${p.id}" data-price="${p.cost_price}"><span class="flex-1 text-xs font-bold uppercase">${p.name}</span><input type="number" id="qty-${p.id}" class="w-16 input-field p-1 text-xs" placeholder="Qty"></div>`).join('')}</div><button onclick="window.execCreatePO()" class="btn-primary">GENERATE ORDER</button>`; 
    document.getElementById('modal').style.display = 'flex'; 
};

// --- INITIALIZATION ---
window.onload = async () => {
    window.logoutAction = logout;
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        let { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (!prof) { await new Promise(r => setTimeout(r, 1000)); let retry = await supabase.from('profiles').select('*').eq('id', session.user.id).single(); prof = retry.data; }
        if (!prof || !prof.organization_id) { window.location.href = 'setup.html'; return; }
        if (prof.status === 'suspended') { await logout(); alert("Account Suspended."); return; }

        window.profile = prof;
        const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
        window.cachedLocations = locs || [];
        const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id);
        window.cachedSuppliers = sups || [];
        await window.initCurrency();
        
        if (!window.profile.full_name || window.profile.full_name.length < 3 || !window.profile.phone) document.getElementById('name-modal').style.display = 'flex';

        const role = window.profile.role;
        const hide = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
        
        // 🔥 STRICT PERMISSIONS & VISIBILITY
        if (role === 'finance') hide(['nav-bar', 'nav-settings', 'nav-staff']); 
        else if (role === 'financial_controller' || role === 'overall_finance' || role === 'deputy_finance') hide(['nav-bar', 'nav-settings']); 
        else if (role === 'storekeeper') hide(['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings']);
        else if (role === 'barman') hide(['nav-inventory', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);

        // Redirect based on Role
        if (role === 'overall_storekeeper' || role === 'deputy_storekeeper') window.router('inventory');
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
        } catch (e) { 
            console.error(e); 
            app.innerHTML = `<div class="p-10 text-red-500 font-bold text-center">Error loading ${view}: ${e.message}</div>`; 
        } 
    }, 50); 
};

// 1. INVENTORY (ADJUSTMENT & VISIBILITY)
window.renderInventory = async (c) => {
    const isPOView = window.currentInvView === 'po'; 
    const stock = await getInventory(window.profile.organization_id);
    
    let filteredStock = stock;
    const role = window.profile.role;
    
    // VISIBILITY LOGIC
    if (role === 'barman') filteredStock = stock.filter(x => x.location_id === window.profile.assigned_location_id && x.products.category === 'Beverage');
    else if (role === 'storekeeper') filteredStock = stock.filter(x => x.location_id === window.profile.assigned_location_id);
    else if (['overall_storekeeper', 'manager', 'deputy_manager', 'deputy_storekeeper'].includes(role)) filteredStock = stock; 

    const showPrice = ['manager','financial_controller','overall_finance','overall_storekeeper', 'deputy_manager', 'deputy_finance'].includes(role);
    const canAdjust = ['manager', 'financial_controller', 'overall_storekeeper', 'deputy_manager'].includes(role);

    let content = '';
    if (isPOView) {
        const { data: pos } = await supabase.from('purchase_orders').select('*, suppliers(name)').eq('organization_id', window.profile.organization_id).order('created_at', {ascending:false});
        content = `<table class="w-full text-left border-collapse"><thead class="bg-slate-50 border-b border-slate-100"><tr><th class="py-4 pl-4 text-xs text-slate-400 uppercase tracking-widest">Date</th><th class="text-xs text-slate-400 uppercase tracking-widest">Supplier</th><th class="text-xs text-slate-400 uppercase tracking-widest">Total</th><th class="text-xs text-slate-400 uppercase tracking-widest">Status</th><th class="text-xs text-slate-400 uppercase tracking-widest">Action</th></tr></thead><tbody>${(pos||[]).map(p => `<tr class="border-b border-slate-50 hover:bg-slate-50 transition"><td class="py-4 pl-4 text-xs font-bold text-slate-500">${new Date(p.created_at).toLocaleDateString()}</td><td class="text-sm font-bold text-slate-800 uppercase">${p.suppliers?.name || p.supplier_name || 'Unknown'}</td><td class="text-sm font-mono font-bold text-slate-900">${window.formatPrice(p.total_cost)}</td><td><span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${p.status==='Pending'?'bg-yellow-50 text-yellow-600 border border-yellow-100':'bg-green-50 text-green-600 border border-green-100'}">${p.status}</span></td><td>${p.status==='Pending'?`<button onclick="window.confirmReceive('${p.id}')" class="text-[10px] bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition shadow-sm font-bold">RECEIVE</button>`:'<span class="text-slate-300 text-[10px] font-bold">COMPLETED</span>'}</td></tr>`).join('')}</tbody></table>`;
    } else {
        content = `<table class="w-full text-left border-collapse"><thead class="bg-slate-50 border-b border-slate-100"><tr><th class="py-4 pl-4 text-xs text-slate-400 uppercase tracking-widest">Item</th>${showPrice?`<th class="text-xs text-slate-400 uppercase tracking-widest">Cost</th><th class="text-xs text-slate-400 uppercase tracking-widest">Price</th>`:''} <th class="text-xs text-slate-400 uppercase tracking-widest">Store</th><th class="text-xs text-slate-400 uppercase tracking-widest">Stock</th><th class="text-xs text-slate-400 uppercase tracking-widest text-right pr-6">Action</th></tr></thead><tbody>${filteredStock.map(i => `<tr class="border-b border-slate-50 hover:bg-slate-50 transition group"><td class="py-4 pl-4"><div class="font-bold text-slate-800 uppercase text-sm">${i.products?.name}</div><div class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">${i.products?.category}</div></td>${showPrice?`<td class="font-mono text-xs text-slate-500">${window.formatPrice(i.products.cost_price)}</td><td class="font-mono text-xs font-bold text-slate-900">${window.formatPrice(i.products.selling_price)}</td>`:''} <td class="text-xs font-bold text-slate-500 uppercase">${i.locations?.name}</td><td class="font-mono font-bold text-lg text-slate-900">${i.quantity} <span class="text-[10px] text-slate-400 font-sans">${i.products?.unit}</span></td><td class="text-right pr-6 flex justify-end gap-2 mt-3">${window.profile.role!=='barman'?`<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-900 hover:text-white hover:border-slate-900 transition">MOVE</button>`:''}${canAdjust ? `<button onclick="window.requestStockAdjust('${i.id}', '${i.quantity}')" class="text-[10px] font-bold border border-red-100 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50 transition">ADJUST</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
    }
    // LPO BUTTON LOGIC: Managers, Overall Storekeepers, and their Deputies can create LPO
    const canCreateLPO = ['manager', 'overall_storekeeper', 'deputy_manager', 'deputy_storekeeper'].includes(role);
    
    c.innerHTML = `<div class="flex flex-col md:flex-row justify-between items-center gap-6 mb-8"><div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">Inventory</h1>${showPrice ? window.getCurrencySelectorHTML() : ''}</div><div class="flex gap-1 bg-slate-100 p-1.5 rounded-xl"><button onclick="window.currentInvView='stock'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${!isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">STOCK</button><button onclick="window.currentInvView='po'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">LPO</button></div><div class="flex gap-3">${canCreateLPO?`<button onclick="window.createPOModal()" class="btn-primary w-auto px-6 shadow-lg shadow-blue-900/20 bg-blue-600 hover:bg-blue-700">Create LPO</button><button onclick="window.addProductModal()" class="btn-primary w-auto px-6 shadow-lg shadow-slate-900/10">New Item</button>`:''}</div></div><div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">${content}</div>`;
};

window.requestStockAdjust = (invId, currentQty) => {
    const newQty = prompt(`Current: ${currentQty}. Enter REAL Physical Quantity:`);
    if(newQty === null || newQty === currentQty) return;
    window.premiumConfirm("Request Adjustment?", "This requires approval.", "Request", async () => {
        await supabase.from('change_requests').insert({
            organization_id: window.profile.organization_id,
            requester_id: window.profile.id,
            target_table: 'inventory',
            target_id: invId,
            action: 'ADJUST_STOCK',
            new_data: { new_qty: Number(newQty) },
            status: 'pending'
        });
        window.showNotification("Adjustment Request Sent", "success");
    });
};

// 5. STAFF (🔥 FIXED DEPUTY APPOINTMENT & SUSPEND)
window.renderStaff = async (c) => {
    const { data: staff } = await supabase.from('profiles').select('*').eq('organization_id', window.profile.organization_id);
    const { data: inv } = await supabase.from('staff_invites').select('*').eq('organization_id', window.profile.organization_id).eq('status', 'pending');
    
    // Who can Appoint a Deputy?
    const canAppointDeputy = ['manager', 'financial_controller', 'overall_storekeeper'].includes(window.profile.role);

    c.innerHTML = `
    <div class="flex justify-between items-center mb-8">
        <h1 class="text-3xl font-bold uppercase text-slate-900">Team</h1>
        <div class="flex gap-3">
            ${canAppointDeputy ? `<button onclick="window.appointDeputyModal()" class="btn-primary w-auto px-6 bg-slate-800 hover:bg-slate-900">Appoint Deputy</button>` : ''}
            <button onclick="window.inviteModal()" class="btn-primary w-auto px-6">+ INVITE STAFF</button>
        </div>
    </div>
    <div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-left"><thead class="bg-slate-50 border-b border-slate-100"><tr><th class="p-6 text-xs text-slate-400 uppercase tracking-widest">Name & Role</th><th class="text-xs text-slate-400 uppercase tracking-widest">Contact</th><th class="text-xs text-slate-400 uppercase tracking-widest">Location</th><th class="text-xs text-slate-400 uppercase tracking-widest text-right pr-6">Action</th></tr></thead><tbody>
    ${staff.map(s => {
        const locName = window.cachedLocations.find(l => l.id === s.assigned_location_id)?.name || 'Unassigned';
        return `<tr class="border-b border-slate-50 hover:bg-slate-50 transition"><td class="p-6"><button onclick="window.viewUserProfile('${s.id}')" class="text-left"><div class="font-bold text-sm uppercase text-slate-700 hover:text-blue-600 transition">${s.full_name}</div><div class="text-[10px] uppercase font-bold text-blue-600 mt-1">${s.role.replace('_',' ')}</div></button></td><td class="text-xs font-medium text-slate-600"><div>${s.phone || '-'}</div><div class="text-[10px] text-slate-400 mt-0.5">${s.email}</div></td><td class="text-xs font-bold uppercase text-slate-500">${locName}</td><td class="text-right p-6">
            ${s.status==='suspended'?
                `<button onclick="window.toggleUserStatus('${s.id}', 'active')" class="text-[9px] bg-green-100 text-green-800 px-3 py-1.5 rounded-full font-bold uppercase mr-2">Activate</button>`:
                `<div class="flex justify-end gap-2">
                    <button onclick="window.toggleUserStatus('${s.id}', 'suspended')" class="text-[9px] bg-orange-100 text-orange-800 px-3 py-1.5 rounded-full font-bold uppercase hover:bg-orange-200 transition">Suspend</button>
                    <button onclick="window.openReassignModal('${s.id}', '${s.role}', '${s.assigned_location_id}')" class="text-[9px] bg-red-100 text-red-800 px-3 py-1.5 rounded-full font-bold uppercase hover:bg-red-200 transition">Reassign</button>
                </div>`
            }
        </td></tr>`;
    }).join('')}
    ${inv.map(i => {
        const locName = window.cachedLocations.find(l => l.id === i.assigned_location_id)?.name || 'Unassigned';
        return `<tr class="bg-yellow-50/50 border-b border-yellow-100"><td class="p-6"><div class="font-bold text-sm text-slate-600">${i.email}</div><div class="text-[10px] uppercase font-bold text-slate-400 mt-1">${i.role.replace('_',' ')}</div></td><td class="text-xs text-slate-400 italic">Pending Acceptance</td><td class="text-xs font-bold uppercase text-slate-400">${locName}</td><td class="text-right p-6"><span class="text-[9px] bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full font-bold">PENDING</span></td></tr>`;
    }).join('')}
    </tbody></table></div>`;
};

// --- NEW DEPUTY FUNCTIONS ---
window.appointDeputyModal = () => {
    document.getElementById('deputy-modal').style.display = 'flex';
};

window.executeAppointDeputy = async () => {
    const email = document.getElementById('depEmail').value;
    if(!email) return window.showNotification("Email required", "error");
    
    // Determine Deputy Role based on Current User
    let deputyRole = '';
    if(window.profile.role === 'manager') deputyRole = 'deputy_manager';
    else if(window.profile.role === 'financial_controller') deputyRole = 'deputy_finance';
    else if(window.profile.role === 'overall_storekeeper') deputyRole = 'deputy_storekeeper';
    else return window.showNotification("You cannot appoint a deputy.", "error");

    await supabase.from('staff_invites').insert({
        email: email,
        role: deputyRole,
        organization_id: window.profile.organization_id,
        status: 'pending',
        is_deputy: true
    });

    document.getElementById('deputy-modal').style.display = 'none';
    window.showNotification(`Deputy Invitation Sent (${deputyRole})`, "success");
    window.router('staff');
};

// --- EXISTING FUNCTIONS (WITH FIXES) ---
window.toggleUserStatus = async (id, status) => {
    if(id === window.profile.id) return window.showNotification("Cannot suspend self", "error");
    const msg = status === 'suspended' ? 'Suspend temporarily? User can be reactivated.' : 'Activate user?';
    window.premiumConfirm(`${status === 'suspended' ? 'Suspend' : 'Activate'} User`, msg, "Confirm", async () => {
        await supabase.from('profiles').update({ status }).eq('id', id);
        window.showNotification("Status Updated", "success");
        window.renderStaff(document.getElementById('app-view'));
    });
};

window.openReassignModal = (id, role, loc) => {
    document.getElementById('suspendUserId').value = id;
    document.getElementById('suspendUserRole').value = role;
    document.getElementById('suspendUserLoc').value = loc;
    document.getElementById('reassign-modal').style.display = 'flex';
};

window.executeReassign = async () => {
    const oldUserId = document.getElementById('suspendUserId').value;
    const role = document.getElementById('suspendUserRole').value;
    const loc = document.getElementById('suspendUserLoc').value;
    const newEmail = document.getElementById('reassignEmail').value;
    if(!newEmail) return window.showNotification("Email required", "error");
    await supabase.from('profiles').update({ status: 'suspended' }).eq('id', oldUserId);
    await supabase.from('staff_invites').insert({ email: newEmail, role: role, organization_id: window.profile.organization_id, assigned_location_id: loc, status: 'pending', replaced_user_id: oldUserId });
    document.getElementById('reassign-modal').style.display = 'none';
    window.showNotification("User Replaced. Invite Sent.", "success");
    window.router('staff');
};

window.viewUserProfile = async (userId) => {
    if(!userId) return;
    try {
        const { data: user } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if(!user) return;
        const assignedLoc = window.cachedLocations.find(l => l.id === user.assigned_location_id)?.name || 'Unassigned';
        document.getElementById('pv-name').innerText = user.full_name || 'Unknown';
        document.getElementById('pv-role').innerText = `${user.role.replace('_', ' ')} • ${assignedLoc}`;
        document.getElementById('pv-initials').innerText = (user.full_name || 'U').charAt(0).toUpperCase();
        document.getElementById('pv-phone').innerText = user.phone || 'Not Provided';
        document.getElementById('pv-email').innerText = user.email || 'No Email'; 
        document.getElementById('pv-joined').innerText = new Date(user.created_at || Date.now()).toLocaleDateString();
        const statusEl = document.getElementById('pv-status');
        statusEl.innerText = user.status || 'ACTIVE';
        statusEl.className = `px-2 py-1 rounded text-[9px] font-bold uppercase ${user.status==='suspended'?'bg-red-500 text-white':'bg-green-500 text-white'}`;
        const { data: history } = await supabase.from('transactions').select('*, products(name)').eq('user_id', userId).order('created_at', {ascending:false}).limit(10);
        const histList = document.getElementById('activity-list');
        if(history && history.length > 0) {
            histList.innerHTML = history.map(h => `<div class="flex justify-between items-center py-2 border-b border-slate-50 last:border-0"><div><div class="font-bold text-slate-700 uppercase text-[10px]">${h.type}</div><div class="text-[9px] text-slate-400">${h.products?.name}</div></div><div class="text-[9px] text-slate-400 text-right"><div>${new Date(h.created_at).toLocaleDateString()}</div></div></div>`).join('');
        } else {
            histList.innerHTML = '<div class="text-center py-4 text-slate-300 italic">No recent activity.</div>';
        }
        document.getElementById('profile-viewer').style.display = 'flex';
        window.switchProfileTab('details');
    } catch(e) { console.error(e); }
};

window.switchProfileTab = (tab) => {
    document.querySelectorAll('.tab-active').forEach(t => t.classList.remove('tab-active', 'border-b-2', 'border-slate-900', 'text-slate-900'));
    document.getElementById(`tab-${tab}`).classList.add('tab-active', 'border-b-2', 'border-slate-900', 'text-slate-900');
    document.getElementById('view-details').style.display = tab === 'details' ? 'block' : 'none';
    document.getElementById('view-activity').style.display = tab === 'activity' ? 'block' : 'none';
};

window.saveName = async () => { const name = document.getElementById('userNameInput').value; const phone = document.getElementById('userPhoneInput').value; await supabase.from('profiles').update({ full_name: name, phone: phone }).eq('id', window.profile.id); location.reload(); };
window.initCurrency = async () => { if (!window.profile) return; try { const { data: org } = await supabase.from('organizations').select('base_currency').eq('id', window.profile.organization_id).single(); window.baseCurrency = org?.base_currency || 'USD'; const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', window.profile.organization_id); window.currencyRates = {}; window.currencyRates[window.baseCurrency] = 1; (rates||[]).forEach(r => window.currencyRates[r.currency_code] = Number(r.rate)); } catch(e){} };
window.convertAmount = (amount, fromCurr, toCurr) => { if (!amount) return 0; const fromRate = window.currencyRates[fromCurr]; const toRate = window.currencyRates[toCurr]; if (!fromRate || !toRate) return null; return fromCurr === window.baseCurrency ? amount * toRate : amount / fromRate; };
window.formatPrice = (amount) => { if (!amount && amount !== 0) return '-'; let converted = window.convertAmount(amount, window.baseCurrency, window.selectedCurrency); return converted === null ? 'SET RATE' : `${window.selectedCurrency} ${Number(converted).toLocaleString(undefined, {minimumFractionDigits: 2})}`; };
window.changeCurrency = (curr) => { window.selectedCurrency = curr; localStorage.setItem('user_pref_currency', curr); const activeEl = document.querySelector('.nav-item.nav-active'); if (activeEl) window.router(activeEl.id.replace('nav-', '')); };
window.getCurrencySelectorHTML = () => { const options = ALL_CURRENCIES.map(c => `<option value="${c}" ${window.selectedCurrency === c ? 'selected' : ''}>${c}</option>`).join(''); return `<select onchange="window.changeCurrency(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer ml-4">${options}</select>`; };

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

// 3. APPROVALS (CHANGE REQUESTS VISIBLE)
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

window.renderReports = async (c) => {
    const isController = ['financial_controller', 'manager', 'overall_finance', 'deputy_manager', 'deputy_finance'].includes(window.profile.role);
    const isVariance = window.currentRepView === 'variance';
    if(isVariance) {
        const { data: takes } = await supabase.from('stock_takes').select('*, locations(name), profiles(full_name, role, phone, id, assigned_location_id)').eq('organization_id', window.profile.organization_id).order('created_at', {ascending:false});
        c.innerHTML = `<div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase text-slate-900">Reconciliation</h1><div class="flex gap-1 bg-slate-100 p-1 rounded-lg"><button onclick="window.currentRepView='general'; window.router('reports')" class="px-6 py-2 text-xs font-bold rounded-md text-slate-500 hover:text-slate-900 transition">GENERAL</button><button class="px-6 py-2 text-xs font-bold rounded-md bg-white shadow-sm text-slate-900 transition">VARIANCE</button></div><button onclick="window.newStockTakeModal()" class="btn-primary w-auto px-6 bg-red-600 hover:bg-red-700">NEW COUNT</button></div><div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-left"><thead><tr class="bg-slate-50 border-b border-slate-100"><th class="p-4 text-xs text-slate-400 uppercase">Date</th><th class="text-xs text-slate-400 uppercase">Location</th><th class="text-xs text-slate-400 uppercase">Conducted By</th><th class="text-xs text-slate-400 uppercase text-right pr-6">Report</th></tr></thead><tbody>${(takes||[]).map(t => `<tr><td class="p-4 text-xs font-bold text-slate-500">${new Date(t.created_at).toLocaleDateString()}</td><td class="text-xs font-bold uppercase text-slate-800">${t.locations?.name}</td><td class="text-xs uppercase">${t.profiles?.full_name}</td><td class="text-right pr-6"><button onclick="window.viewVariance('${t.id}')" class="text-blue-600 font-bold text-[10px]">VIEW</button></td></tr>`).join('')}</tbody></table></div>`;
    } else {
        const { data: logs } = await supabase.from('transactions').select(`*, products (name, category), locations:to_location_id (name), from_loc:from_location_id (name), profiles:user_id (full_name, role, phone, id, assigned_location_id)`).eq('organization_id', window.profile.organization_id).order('created_at', { ascending: false }).limit(500);
        window.currentLogs = logs || [];
        
        c.innerHTML = `<div class="flex flex-col gap-6 mb-8"><div class="flex justify-between items-center gap-4"><div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">Reports</h1>${window.getCurrencySelectorHTML()}</div><div class="flex gap-1 bg-slate-100 p-1 rounded-lg"><button class="px-6 py-2 text-xs font-bold rounded-md bg-white shadow-sm text-slate-900 transition">GENERAL</button><button onclick="window.currentRepView='variance'; window.router('reports')" class="px-6 py-2 text-xs font-bold rounded-md text-slate-500 hover:text-slate-900 transition">VARIANCE</button></div></div><div class="bg-white p-4 rounded-2xl border border-slate-200 flex flex-wrap items-end gap-4 shadow-sm"><div><label class="input-label">Start</label><input type="date" id="repStart" class="input-field w-32" onchange="window.filterReport()"></div><div><label class="input-label">End</label><input type="date" id="repEnd" class="input-field w-32" onchange="window.filterReport()"></div><button onclick="window.exportCSV()" class="btn-primary w-auto px-6 h-[46px] bg-green-700 hover:bg-green-800">EXPORT</button></div></div><div class="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left"><thead class="bg-slate-50 border-b border-slate-100"><tr><th class="p-4 pl-6 text-xs text-slate-400 uppercase tracking-widest">Date / Time</th><th class="text-xs text-slate-400 uppercase tracking-widest">Action</th><th class="text-xs text-slate-400 uppercase tracking-widest">Item</th><th class="text-xs text-slate-400 uppercase tracking-widest">Detail</th><th class="text-xs text-slate-400 uppercase tracking-widest">Qty</th>${isController?'<th class="text-xs text-slate-400 uppercase tracking-widest text-right pr-6">Controls</th>':''}</tr></thead><tbody id="logsBody"></tbody></table></div></div>`;
        window.filterReport();
    }
};

window.filterReport = () => {
    const start = document.getElementById('repStart')?.value;
    const end = document.getElementById('repEnd')?.value;
    const isController = ['financial_controller', 'manager', 'overall_finance', 'deputy_manager'].includes(window.profile.role);

    let f = window.currentLogs;
    if(start) f = f.filter(l => new Date(l.created_at) >= new Date(start));
    if(end) f = f.filter(l => new Date(l.created_at) <= new Date(end + 'T23:59:59'));
    
    const b = document.getElementById('logsBody');
    b.innerHTML = f.map(l => {
        const isVoid = l.status === 'void';
        let actionColor='text-slate-800', detail='-';
        
        if(l.type === 'sale') { actionColor='text-green-600'; detail=`PAID: ${l.payment_method}`; }
        else if(l.type === 'receive') { actionColor='text-blue-600'; detail='FROM SUPPLIER'; }
        else if(l.type === 'transfer') { actionColor='text-orange-600'; detail=`${l.from_loc?.name} -> ${l.locations?.name}`; }

        return `<tr class="border-b border-slate-50 hover:bg-slate-50 transition group ${isVoid ? 'bg-slate-50 opacity-50 grayscale' : ''}">
            <td class="p-4 pl-6 text-xs font-bold text-slate-500 ${isVoid ? 'line-through' : ''}">${new Date(l.created_at).toLocaleDateString()} ${new Date(l.created_at).toLocaleTimeString()}</td>
            <td class="p-4 text-xs font-bold ${actionColor} uppercase ${isVoid ? 'line-through' : ''}">${l.type}</td>
            <td class="p-4 text-xs text-slate-600 font-medium ${isVoid ? 'line-through' : ''}">${l.products?.name}</td>
            <td class="p-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider ${isVoid ? 'line-through' : ''}">${detail}</td>
            <td class="p-4 font-mono text-sm font-bold text-slate-900 ${isVoid ? 'line-through' : ''}">${l.quantity}</td>
            ${isController && !isVoid ? `<td class="text-right pr-6"><button onclick="window.requestDeleteTransaction('${l.id}')" class="text-[9px] bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-100">VOID</button></td>` : isController ? `<td class="text-right pr-6"><span class="text-[9px] text-red-400 font-bold">VOIDED</span></td>` : ''}
        </tr>`;
    }).join('');
};

window.requestDeleteTransaction = async (id) => {
    window.premiumConfirm("Request Void?", "Admin must approve.", "Send Request", async () => {
        await supabase.from('change_requests').insert({ organization_id: window.profile.organization_id, requester_id: window.profile.id, target_table: 'transactions', target_id: id, action: 'VOID', status: 'pending' });
        window.showNotification("Request Sent", "success");
    });
};

/* ... EXPORT, CONFIRM RECEIVE, ADD STOCK ... SAME */
window.exportCSV = () => { let rows=[["Date","Time","Action","Item","User","Detail","Status","Quantity"]]; const f=window.currentLogs; f.forEach(l=>{ rows.push([new Date(l.created_at).toLocaleDateString(),new Date(l.created_at).toLocaleTimeString(),l.type,l.products?.name,l.profiles?.full_name,l.payment_method||'-',l.status||'valid',l.quantity]); }); let csvContent="data:text/csv;charset=utf-8,"+rows.map(e=>e.join(",")).join("\n"); let link=document.createElement("a"); link.setAttribute("href",encodeURI(csvContent)); link.setAttribute("download",`Report_${new Date().toISOString().split('T')[0]}.csv`); document.body.appendChild(link); link.click(); };
window.confirmReceive = (id) => { window.premiumConfirm("Confirm Receipt", "Are you sure you have physically received these items?", "Receive Stock", () => window.receivePO(id)); };
window.receivePO = async (id) => { const { error } = await supabase.rpc('receive_stock_wac', { p_po_id: id, p_user_id: window.profile.id, p_org_id: window.profile.organization_id }); if (error) window.showNotification(error.message, "error"); else { window.showNotification("Stock Received (WAC Updated)", "success"); window.router('inventory'); } };
window.addStockModal = async () => { if(window.profile.role !== 'manager' && window.profile.role !== 'overall_storekeeper') return; const { data: prods } = await supabase.from('products').select('*').eq('organization_id', window.profile.organization_id).order('name'); const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">Receive Stock</h3><div class="input-group"><label class="input-label">Item</label><select id="sP" class="input-field">${prods.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div><div class="input-group"><label class="input-label">Store</label><select id="sL" class="input-field">${locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select></div><div class="input-group"><label class="input-label">Qty</label><input id="sQ" type="number" class="input-field"></div><button onclick="window.execAddStock()" class="btn-primary">CONFIRM</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddStock = async () => { const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value; if(qty <= 0) return; await supabase.rpc('add_stock_safe', { p_product_id: pid, p_location_id: lid, p_quantity: qty, p_org_id: window.profile.organization_id }); await supabase.from('transactions').insert({ organization_id: window.profile.organization_id, user_id: window.profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty }); document.getElementById('modal').style.display = 'none'; window.showNotification("Stock Added", "success"); window.router('inventory'); };
window.issueModal = async (name, id, fromLoc) => { window.selectedDestinationId = null; const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).neq('id', fromLoc); const html = locs.map(l => `<div onclick="window.selectDest(this, '${l.id}')" class="dest-card border p-3 rounded cursor-pointer hover:bg-slate-50 text-center"><span class="font-bold text-xs uppercase">${l.name}</span></div>`).join(''); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Move: ${name}</h3><div class="grid grid-cols-2 gap-2 mb-4 max-h-40 overflow-y-auto">${html}</div><div class="input-group"><label class="input-label">Quantity</label><input id="tQty" type="number" class="input-field"></div><button onclick="window.execIssue('${id}', '${fromLoc}')" class="btn-primary">TRANSFER</button>`; document.getElementById('modal').style.display = 'flex'; };
window.selectDest = (el, id) => { document.querySelectorAll('.dest-card').forEach(c => c.classList.remove('bg-slate-900', 'text-white')); el.classList.add('bg-slate-900', 'text-white'); window.selectedDestinationId = id; };
window.execIssue = async (pid, fromLoc) => { const qty = document.getElementById('tQty').value; if(!window.selectedDestinationId || qty <= 0) return window.showNotification("Invalid Selection", "error"); try { await transferStock(pid, fromLoc, window.selectedDestinationId, qty, window.profile.id, window.profile.organization_id); document.getElementById('modal').style.display = 'none'; window.showNotification("Request Sent", "success"); } catch(e) { window.showNotification(e.message, "error"); } };

window.addProductModal = () => { if(window.profile.role !== 'manager' && window.profile.role !== 'overall_storekeeper') return; const opts = ALL_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join(''); const unitOpts = ALL_UNITS.map(u => `<option value="${u}">${u}</option>`).join(''); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Product</h3><div class="input-group"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div><div class="grid grid-cols-2 gap-4 mb-4"><div class="input-group mb-0"><label class="input-label">Category</label><select id="pCat" class="input-field"><option value="Beverage">Beverage (Vinywaji)</option><option value="Food">Food (Chakula)</option><option value="Stationery">Stationery</option><option value="Linen">Linen</option><option value="Construction">Construction</option></select></div><div class="input-group mb-0"><label class="input-label">Unit (LPO)</label><select id="pUnit" class="input-field">${unitOpts}</select></div></div><div class="input-group mb-4"><label class="input-label">Items per Unit (Conversion)</label><input id="pConv" type="number" class="input-field font-mono font-bold" value="1" placeholder="e.g 24 for Crate"></div><div class="input-group mb-4"><label class="input-label">Currency</label><select id="pCurrency" class="input-field cursor-pointer bg-slate-50 font-bold text-slate-700">${opts}</select></div><div class="grid grid-cols-2 gap-4 mb-6"><div class="input-group mb-0"><label class="input-label">Cost</label><input id="pC" type="number" class="input-field"></div><div class="input-group mb-0"><label class="input-label">Selling (Per Item)</label><input id="pS" type="number" class="input-field"></div></div><button onclick="window.execAddProduct()" class="btn-primary">SAVE PRODUCT</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddProduct = async () => { const name = document.getElementById('pN').value.toUpperCase(), cat = document.getElementById('pCat').value, unit = document.getElementById('pUnit').value, conv = document.getElementById('pConv').value || 1, curr = document.getElementById('pCurrency').value, cost = parseFloat(document.getElementById('pC').value), selling = parseFloat(document.getElementById('pS').value); if(!name || isNaN(cost)) return window.showNotification("Invalid input", "error"); const costBase = window.convertAmount(cost, curr, window.baseCurrency); const sellingBase = window.convertAmount(selling, curr, window.baseCurrency); if(costBase === null) return window.showNotification(`Set rate for ${curr} first`, "error"); await supabase.from('products').insert({ name, category: cat, unit, conversion_factor: conv, cost_price: costBase, selling_price: sellingBase, organization_id: window.profile.organization_id }); document.getElementById('modal').style.display = 'none'; window.showNotification("Product Added", "success"); window.router('inventory'); };
window.newStockTakeModal = async () => { const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Stock Take</h3><div class="input-group"><label class="input-label">Location</label><select id="stLoc" class="input-field">${locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select></div><button onclick="window.startStockTake()" class="btn-primary">START</button>`; document.getElementById('modal').style.display = 'flex'; };
window.startStockTake = async () => { const locId = document.getElementById('stLoc').value; const inv = await getInventory(window.profile.organization_id); const items = inv.filter(x => x.location_id === locId); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Count Items</h3><div class="bg-slate-50 p-2 rounded max-h-60 overflow-y-auto mb-4 border">${items.map(i => `<div class="flex justify-between items-center mb-2"><span class="text-xs font-bold w-1/2">${i.products.name}</span><input type="number" class="st-input w-20 border rounded p-1 text-center font-bold text-slate-900" data-id="${i.product_id}" data-sys="${i.quantity}" placeholder="Count"></div>`).join('')}</div><button onclick="window.saveStockTake('${locId}')" class="btn-primary">SUBMIT VARIANCE</button>`; };
window.saveStockTake = async (locId) => { const inputs = document.querySelectorAll('.st-input'); const { data: st } = await supabase.from('stock_takes').insert({ organization_id: window.profile.organization_id, location_id: locId, conducted_by: window.profile.id, status: 'Completed' }).select().single(); const items = Array.from(inputs).map(i => ({ stock_take_id: st.id, product_id: i.getAttribute('data-id'), system_qty: i.getAttribute('data-sys'), physical_qty: i.value || 0 })); await supabase.from('stock_take_items').insert(items); document.getElementById('modal').style.display = 'none'; window.showNotification("Audit Complete", "success"); window.currentRepView = 'variance'; window.router('reports'); };
window.viewVariance = async (id) => { const { data: items } = await supabase.from('stock_take_items').select('*, products(name)').eq('stock_take_id', id); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Variance Report</h3><table class="w-full text-xs text-left border"><thead><tr class="bg-slate-100"><th>Item</th><th>Sys</th><th>Phys</th><th>Var</th></tr></thead><tbody>${items.map(i => `<tr><td class="p-2 font-bold">${i.products.name}</td><td>${i.system_qty}</td><td>${i.physical_qty}</td><td class="${i.variance<0?'text-red-600 font-bold':''}">${i.variance}</td></tr>`).join('')}</tbody></table>`; document.getElementById('modal').style.display = 'flex'; };
