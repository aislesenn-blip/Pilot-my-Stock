import { getSession, logout } from './auth.js';
import { getInventory, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

// --- GLOBAL CONFIGURATION ---
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

// --- 1. BRANDING & SECURITY ENFORCEMENT (IMMEDIATE EXECUTION) ---
// Hii inarun kabla ya kitu chochote ili kuondoa "Pilot My Stock"
(function enforceBranding() {
    document.title = "ugaviSmarT | Enterprise ERP";
    const brandElements = document.querySelectorAll('.brand-logo, .logo-text, h1');
    brandElements.forEach(el => {
        if(el.innerText.includes('Pilot')) el.innerText = "ugaviSmarT";
    });
})();

// --- UI UTILITIES ---
window.closeModalOutside = (e) => { if (e.target.classList.contains('modal-backdrop')) e.target.style.display = 'none'; };

window.showNotification = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    if(!container) return alert(message); // Fallback
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

// --- INITIALIZATION (DEEP LOADING) ---
window.onload = async () => {
    window.logoutAction = logout;
    const session = await getSession();
    
    // Redirect if no session (Security)
    if (!session) { 
        if(!window.location.href.includes('index.html')) window.location.href = 'index.html'; 
        return; 
    }

    try {
        // Fetch Profile with Retry Logic
        let { data: prof, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (error || !prof) { 
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
        
        // Security Check: Status
        if (prof.status === 'suspended') { await logout(); alert("Account Suspended. Contact Admin."); return; }
        
        window.profile = prof;
        
        // CACHE LOADING (CRITICAL FOR PERFORMANCE)
        const [locsRes, supsRes] = await Promise.all([
            supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id),
            supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id)
        ]);
        
        // ⚠️ SAFETY NET: Ensure arrays are never null to prevent .map() errors
        window.cachedLocations = locsRes.data || [];
        window.cachedSuppliers = supsRes.data || [];
        
        await window.initCurrency();
        
        // Role-Based UI Control
        const role = window.profile.role;
        const hide = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
        if (role === 'finance' || role === 'deputy_finance') hide(['nav-bar', 'nav-settings', 'nav-staff']); 
        else if (role === 'financial_controller') hide(['nav-bar', 'nav-settings']); 
        else if (role === 'storekeeper') hide(['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings']);
        else if (role === 'barman') hide(['nav-inventory', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);
        
        // Routing
        if (['overall_storekeeper', 'deputy_storekeeper', 'manager'].includes(role)) window.router('inventory');
        else window.router(role === 'barman' ? 'bar' : 'inventory');

    } catch (e) { console.error("Critical Init Error:", e); }
};

// --- ROUTER ENGINE ---
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
            app.innerHTML = `<div class="p-10 text-red-500 font-bold text-center">System Error loading ${view}.<br><span class="text-xs text-slate-400">${e.message}</span></div>`; 
        } 
    }, 50); 
};

// --- CORE: SETUP (RPC) ---
window.saveName = async () => { 
    const orgName = document.getElementById('orgNameInput').value;
    const name = document.getElementById('userNameInput').value; 
    const phone = document.getElementById('userPhoneInput').value; 

    if (!orgName || !name) return window.showNotification("Fields Required", "error");

    const { data, error } = await supabase.rpc('create_setup_data', {
        p_org_name: orgName,
        p_full_name: name,
        p_phone: phone
    });

    if (error) return window.showNotification("Setup Error: " + error.message, "error");

    document.getElementById('name-modal').style.display = 'none';
    window.showNotification("Welcome to ugaviSmarT", "success");
    location.reload(); 
};

// --- STAFF MODULE (ERROR PROOFED & RESTORED) ---
window.renderStaff = async (c) => {
    // 1. Permission Check
    if(!['manager', 'financial_controller'].includes(window.profile.role)) {
        return c.innerHTML = '<div class="flex h-full items-center justify-center text-slate-400 font-bold uppercase tracking-widest">Access Restricted</div>';
    }

    // 2. Safe Data Fetching
    const [staffRes, inviteRes] = await Promise.all([
        supabase.from('profiles').select('*, locations(name)').eq('organization_id', window.profile.organization_id),
        supabase.from('staff_invites').select('*, locations(name)').eq('organization_id', window.profile.organization_id).eq('status', 'pending')
    ]);

    // ⚠️ CRITICAL FIX: "Cannot read properties of null (reading 'map')"
    // We force [] if data is null.
    const staff = staffRes.data || [];
    const invites = inviteRes.data || [];

    // 3. Render
    c.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-center gap-4 mb-8">
        <div>
            <h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">Staff Management</h1>
            <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Total Users: ${staff.length}</p>
        </div>
        <button onclick="window.inviteModal()" class="btn-primary w-auto px-6 shadow-lg bg-slate-900 text-white">+ NEW USER</button>
    </div>

    <div class="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden mb-8">
        <table class="w-full text-left">
            <thead class="bg-slate-50 border-b border-slate-100">
                <tr>
                    <th class="p-4 text-[10px] uppercase text-slate-400">User</th>
                    <th class="text-[10px] uppercase text-slate-400">Role</th>
                    <th class="text-[10px] uppercase text-slate-400">Location</th>
                    <th class="text-[10px] uppercase text-slate-400">Status</th>
                    <th class="text-[10px] uppercase text-slate-400 text-right pr-6">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${staff.map(s => {
                    const isMe = s.id === window.profile.id;
                    return `
                    <tr class="border-b last:border-0 hover:bg-slate-50 transition group">
                        <td class="p-4">
                            <div class="font-bold text-slate-700 text-sm">${s.full_name || 'Pending Setup'}</div>
                            <div class="text-[10px] text-slate-400 font-mono">${s.email}</div>
                        </td>
                        <td class="p-4 text-xs font-bold text-slate-600 uppercase">${s.role.replace('_', ' ')}</td>
                        <td class="p-4 text-xs text-slate-500 uppercase">${s.locations?.name || 'Global Access'}</td>
                        <td class="p-4">
                            <span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${s.status==='active'?'text-green-600 bg-green-50':'text-red-600 bg-red-50'}">${s.status}</span>
                        </td>
                        <td class="p-4 text-right pr-6">
                            ${!isMe ? `
                            <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onclick="window.viewStaffDetails('${s.id}')" class="p-2 hover:bg-white text-slate-400 hover:text-blue-600 rounded transition" title="Activity Logs">👁️</button>
                                <button onclick="window.reassignModal('${s.id}', '${s.full_name}')" class="p-2 hover:bg-white text-slate-400 hover:text-orange-500 rounded transition" title="Reassign">📍</button>
                                <button onclick="window.toggleSuspend('${s.id}', '${s.status}')" class="p-2 hover:bg-white text-slate-400 ${s.status==='active'?'hover:text-red-600':'hover:text-green-600'} rounded transition" title="${s.status==='active'?'Suspend':'Activate'}">${s.status==='active'?'🚫':'✅'}</button>
                            </div>` : '<span class="text-[10px] text-slate-300 font-bold">YOU</span>'}
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    </div>

    ${invites.length > 0 ? `
    <h3 class="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Pending Invites</h3>
    <div class="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden">
        <table class="w-full text-left">
            <tbody>
                ${invites.map(i => `
                    <tr class="border-b last:border-0 hover:bg-slate-50">
                        <td class="p-4 font-mono text-xs text-slate-600">${i.email}</td>
                        <td class="p-4 text-xs font-bold text-slate-500 uppercase">${i.role}</td>
                        <td class="p-4 text-xs text-slate-400">Assigned: ${i.locations?.name || 'All'}</td>
                        <td class="p-4 text-right pr-6">
                            <button onclick="window.cancelInvite('${i.id}')" class="text-[10px] font-bold text-red-400 hover:text-red-600">CANCEL</button>
                        </td>
                    </tr>`).join('')}
            </tbody>
        </table>
    </div>` : ''}
    `;
};

// --- STAFF ACTIONS (RESTORED FULLY) ---
window.inviteModal = () => {
    // Populate locations
    const locOpts = window.cachedLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase text-center">Invite Staff</h3>
        <div class="input-group"><label class="input-label">Email</label><input id="iE" type="email" class="input-field"></div>
        <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="input-group mb-0"><label class="input-label">Role</label>
                <select id="iR" class="input-field">
                    <option value="storekeeper">Storekeeper</option>
                    <option value="barman">Barman</option>
                    <option value="finance">Finance</option>
                    <option value="financial_controller">Controller</option>
                </select>
            </div>
            <div class="input-group mb-0"><label class="input-label">Assign To</label>
                <select id="iL" class="input-field">${locOpts}</select>
            </div>
        </div>
        <button onclick="window.execInvite()" class="btn-primary">SEND INVITE</button>
    `;
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
    
    // Safety check for nulls
    const logData = logs.data || [];
    const prof = p.data;

    const logHtml = logData.length ? logData.map(l => `<div class="text-[10px] border-b py-2"><span class="font-bold">${l.action}</span> - ${new Date(l.created_at).toLocaleString()}</div>`).join('') : '<span class="text-xs text-slate-400">No logs.</span>';

    document.getElementById('modal-content').innerHTML = `
        <div class="text-center mb-4">
            <h3 class="font-bold text-lg">${prof.full_name}</h3>
            <p class="text-xs text-slate-500">${prof.email} | ${prof.phone || 'No Phone'}</p>
        </div>
        <h4 class="text-xs font-bold uppercase text-slate-400 mb-2">Recent Activity</h4>
        <div class="bg-slate-50 p-4 rounded-xl border mb-4">${logHtml}</div>
    `;
    document.getElementById('modal').style.display = 'flex';
};

window.reassignModal = (id, name) => {
    const locOpts = window.cachedLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-2 text-center">Move ${name}</h3>
        <div class="input-group"><label class="input-label">New Location</label><select id="nL" class="input-field">${locOpts}</select></div>
        <button onclick="window.doReassign('${id}')" class="btn-primary">CONFIRM</button>
    `;
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

// --- SETTINGS: LOCATIONS & SUPPLIERS (FULL DETAILS) ---
window.renderSettings = async (c) => {
    // Refresh cache to ensure we have latest
    const [l, s] = await Promise.all([
        supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id),
        supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id)
    ]);
    window.cachedLocations = l.data || [];
    window.cachedSuppliers = s.data || [];

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
                <table class="w-full text-left"><tbody>${window.cachedLocations.map(l => `<tr class="border-b last:border-0"><td class="py-3 font-bold text-sm uppercase text-slate-700">${l.name}</td><td class="text-xs text-slate-400 uppercase">${l.type.replace('_', ' ')}</td></tr>`).join('')}</tbody></table>
            </div>
            <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
                <div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Suppliers</h3><button onclick="window.openSupplierModal()" class="text-[10px] bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold">+ NEW</button></div>
                <table class="w-full text-left"><tbody>${window.cachedSuppliers.map(s => `<tr class="border-b last:border-0"><td class="py-3 font-bold text-sm uppercase text-slate-700">${s.name}</td><td class="text-xs text-slate-400 font-mono text-right">${s.tin || '-'}</td></tr>`).join('')}</tbody></table>
            </div>
        </div>
        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
            <div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Exchange Rates</h3></div>
            <div class="max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">${rateRows}</div>
            <button onclick="window.saveRates()" class="btn-primary mt-6">UPDATE RATES</button>
        </div>
    </div>`;
};

// --- ADD STORE MODAL (FULL HIERARCHY) ---
window.addStoreModal = () => {
    // Generate Parent Options (Only Main Stores or Sub Stores can be parents)
    const parents = window.cachedLocations.filter(l => l.type !== 'department').map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase text-center">Add Location</h3>
        <div class="input-group"><label class="input-label">Location Name</label><input id="locName" class="input-field uppercase"></div>
        <div class="input-group"><label class="input-label">Type</label>
            <select id="locType" class="input-field" onchange="document.getElementById('parentGrp').style.display = this.value === 'main_store' ? 'none' : 'block'">
                <option value="sub_store">Camp / Sub-Store</option>
                <option value="department">Department (Bar/Kitchen)</option>
                <option value="main_store">Main Store (HQ)</option>
            </select>
        </div>
        <div id="parentGrp" class="input-group">
            <label class="input-label">Parent Store (Linked To)</label>
            <select id="locParent" class="input-field">${parents}</select>
        </div>
        <button onclick="window.execAddStore()" class="btn-primary">CREATE LOCATION</button>
    `;
    document.getElementById('modal').style.display = 'flex';
};

window.execAddStore = async () => {
    const name = document.getElementById('locName').value;
    const type = document.getElementById('locType').value;
    const parent = type === 'main_store' ? null : document.getElementById('locParent').value;
    
    if(!name) return;

    // Direct Insert (Allowed by SQL v100)
    await supabase.from('locations').insert({ 
        organization_id: window.profile.organization_id, 
        name, type, parent_location_id: parent 
    });
    
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Location Created", "success");
    window.router('settings');
};

// --- ADD SUPPLIER (FULL DETAILS) ---
window.openSupplierModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase text-center">New Supplier</h3>
        <div class="input-group"><label class="input-label">Company Name</label><input id="sN" class="input-field uppercase"></div>
        <div class="input-group"><label class="input-label">TIN Number</label><input id="sT" class="input-field"></div>
        <div class="input-group"><label class="input-label">Phone Contact</label><input id="sP" class="input-field"></div>
        <div class="input-group"><label class="input-label">Physical Address</label><input id="sA" class="input-field" placeholder="e.g. Kariakoo, Mtaa wa Congo"></div>
        <button onclick="window.execAddSupplier()" class="btn-primary">SAVE SUPPLIER</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execAddSupplier = async () => {
    const name = document.getElementById('sN').value;
    if(!name) return;
    await supabase.from('suppliers').insert({ 
        organization_id: window.profile.organization_id, 
        name, 
        tin: document.getElementById('sT').value,
        contact: document.getElementById('sP').value,
        address: document.getElementById('sA').value // Captured
    });
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Supplier Saved", "success");
    window.router('settings');
};

// --- PRODUCT WIZARD (LOCATION PRICING RESTORED) ---
window.addProductModal = () => { 
    if(!['manager','overall_storekeeper'].includes(window.profile.role)) return; 
    const unitOpts = ALL_UNITS.map(u => `<option value="${u}">${u}</option>`).join(''); 
    const currOpts = ALL_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase text-center">New Product</h3>
        <div class="input-group"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div>
        <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="input-group mb-0"><label class="input-label">Category</label><select id="pCat" class="input-field"><option value="Beverage">Beverage</option><option value="Food">Food</option><option value="Stationery">Stationery</option><option value="Linen">Linen</option></select></div>
            <div class="input-group mb-0"><label class="input-label">Unit</label><select id="pUnit" class="input-field">${unitOpts}</select></div>
        </div>
        <div class="input-group mb-4"><label class="input-label">Conversion (Items per Unit)</label><input id="pConv" type="number" class="input-field" value="1"></div>
        <div class="input-group mb-4"><label class="input-label">Currency</label><select id="pCurrency" class="input-field">${currOpts}</select></div>
        <div class="grid grid-cols-2 gap-4 mb-6">
            <div class="input-group mb-0"><label class="input-label">Cost Price</label><input id="pC" type="number" class="input-field"></div>
            <div class="input-group mb-0"><label class="input-label">Base Selling Price</label><input id="pS" type="number" class="input-field"></div>
        </div>
        <button onclick="window.nextProductStep()" class="btn-primary">Next: Set Camp Prices</button>`; 
    document.getElementById('modal').style.display = 'flex'; 
};

window.nextProductStep = async () => {
    const name = document.getElementById('pN').value.toUpperCase();
    const cost = parseFloat(document.getElementById('pC').value);
    if(!name || isNaN(cost)) return window.showNotification("Invalid Data", "error");

    window.tempProductData = {
        name, category: document.getElementById('pCat').value,
        unit: document.getElementById('pUnit').value,
        conversion_factor: document.getElementById('pConv').value,
        currency: document.getElementById('pCurrency').value,
        cost, selling: parseFloat(document.getElementById('pS').value)
    };

    // Render Camp Inputs
    const campHtml = window.cachedLocations.map(l => `
        <div class="flex justify-between items-center mb-2 bg-slate-50 p-2 rounded">
            <span class="text-xs font-bold w-1/2">${l.name}</span>
            <input type="number" class="loc-price-input input-field w-1/2 text-right" data-loc="${l.id}" value="${window.tempProductData.selling}" placeholder="Price">
        </div>
    `).join('');

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-4 text-center">Camp Pricing</h3>
        <div class="mb-6 max-h-60 overflow-y-auto pr-1 custom-scrollbar">${campHtml}</div>
        <button onclick="window.finalizeProduct()" class="btn-primary">SAVE PRODUCT</button>
    `;
};

window.finalizeProduct = async () => {
    const d = window.tempProductData;
    const costBase = window.convertAmount(d.cost, d.currency, window.baseCurrency);
    const sellingBase = window.convertAmount(d.selling, d.currency, window.baseCurrency);

    // 1. Save Product
    const { data: prod, error } = await supabase.from('products').insert({
        name: d.name, category: d.category, unit: d.unit, 
        conversion_factor: d.conversion_factor, cost_price: costBase, 
        selling_price: sellingBase, organization_id: window.profile.organization_id
    }).select().single();

    if(error) return window.showNotification(error.message, "error");

    // 2. Save Location Prices (Batch)
    const inputs = document.querySelectorAll('.loc-price-input');
    const prices = [];
    inputs.forEach(i => {
        if(i.value) prices.push({ 
            organization_id: window.profile.organization_id, 
            product_id: prod.id, 
            location_id: i.dataset.loc, 
            selling_price: window.convertAmount(parseFloat(i.value), d.currency, window.baseCurrency) 
        });
    });

    if(prices.length) await supabase.from('location_prices').insert(prices);

    document.getElementById('modal').style.display = 'none';
    window.showNotification("Product Added", "success");
    window.router('inventory');
};

// ... (Standard Logic for Inventory, POS, Reports - No changes needed as they are generic) ...
window.renderInventory = async (c) => { /* Reuse Previous Logic */ 
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
        const { data: staff } = await supabase.from('profiles').select('id, full_name').eq('organization_id', window.profile.organization_id);
        const { data: locs } = await supabase.from('locations').select('name').eq('organization_id', window.profile.organization_id);
        
        c.innerHTML = `
        <div class="flex flex-col gap-6 mb-8">
            <div class="flex justify-between items-center gap-4"><div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">Reports</h1>${window.getCurrencySelectorHTML()}</div><div class="flex gap-1 bg-slate-100 p-1 rounded-lg"><button class="px-6 py-2 text-xs font-bold rounded-md bg-white shadow-sm text-slate-900 transition">GENERAL</button><button onclick="window.currentRepView='variance'; window.router('reports')" class="px-6 py-2 text-xs font-bold rounded-md text-slate-500 hover:text-slate-900 transition">VARIANCE</button></div></div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 flex flex-wrap items-end gap-4 shadow-sm">
                <div><label class="input-label">Start</label><input type="date" id="repStart" class="input-field w-32" onchange="window.filterReport()"></div>
                <div><label class="input-label">End</label><input type="date" id="repEnd" class="input-field w-32" onchange="window.filterReport()"></div>
                <div class="flex-1"><label class="input-label">Type</label><select id="repType" class="input-field" onchange="window.filterReport()"><option value="all">All Types</option><option value="sale">Sales</option><option value="receive">Received Stock</option><option value="transfer">Transfers</option></select></div>
                <div class="flex-1"><label class="input-label">Staff</label><select id="repStaff" class="input-field" onchange="window.filterReport()"><option value="all">All Staff</option>${staff.map(s=>`<option value="${s.id}">${s.full_name}</option>`).join('')}</select></div>
                <div class="flex-1"><label class="input-label">Category</label><select id="repCat" class="input-field" onchange="window.filterReport()"><option value="all">All Categories</option><option value="Beverage">Beverage</option><option value="Food">Food</option><option value="Stationery">Stationery</option></select></div>
                <div><label class="input-label">Status</label><select id="repStat" class="input-field w-32" onchange="window.filterReport()"><option value="all">All</option><option value="valid">Valid</option><option value="void">Void</option></select></div>
                <button onclick="window.exportCSV()" class="btn-primary w-auto px-6 h-[46px] bg-green-700 hover:bg-green-800">EXPORT</button>
            </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8"><div class="bg-white p-8 border border-slate-200 rounded-[24px] shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Total Revenue</p><p class="text-4xl font-mono font-bold text-slate-900" id="repRev">...</p></div><div class="bg-white p-8 border border-slate-200 rounded-[24px] shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Gross Profit</p><p class="text-4xl font-mono font-bold text-green-600" id="repProf">...</p></div></div>
        <div class="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left"><thead class="bg-slate-50 border-b border-slate-100"><tr><th class="p-4 pl-6 text-xs text-slate-400 uppercase tracking-widest">Date / Time</th><th class="text-xs text-slate-400 uppercase tracking-widest">Ref / Type</th><th class="text-xs text-slate-400 uppercase tracking-widest">Item / User</th><th class="text-xs text-slate-400 uppercase tracking-widest">Flow (From ➝ To)</th><th class="text-xs text-slate-400 uppercase tracking-widest">Detail</th><th class="text-xs text-slate-400 uppercase tracking-widest text-right">Qty</th><th class="text-xs text-slate-400 uppercase tracking-widest text-right">Amount</th>${isController?'<th class="text-xs text-slate-400 uppercase tracking-widest text-right pr-6">Action</th>':''}</tr></thead><tbody id="logsBody"></tbody></table></div></div>`;
        window.filterReport();
    }
};
window.filterReport = () => {
    const start = document.getElementById('repStart')?.value;
    const end = document.getElementById('repEnd')?.value;
    const type = document.getElementById('repType')?.value;
    const staff = document.getElementById('repStaff')?.value;
    const cat = document.getElementById('repCat')?.value;
    const stat = document.getElementById('repStat')?.value;

    let f = window.currentLogs;
    if(start) f = f.filter(l => new Date(l.created_at) >= new Date(start));
    if(end) f = f.filter(l => new Date(l.created_at) <= new Date(end + 'T23:59:59'));
    if(type && type !== 'all') f = f.filter(l => l.type === type);
    if(staff && staff !== 'all') f = f.filter(l => l.user_id === staff);
    if(cat && cat !== 'all') f = f.filter(l => l.products?.category === cat);
    if(stat && stat !== 'all') f = f.filter(l => l.status === stat);
    
    const activeTx = f.filter(l => l.status !== 'void');
    const totalSales = activeTx.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.total_value) || 0), 0);
    const totalProfit = activeTx.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.profit) || 0), 0);
    document.getElementById('repRev').innerHTML = window.formatPrice(totalSales);
    document.getElementById('repProf').innerHTML = window.formatPrice(totalProfit);

    const b = document.getElementById('logsBody');
    const isController = ['financial_controller', 'manager', 'overall_finance'].includes(window.profile.role);

    b.innerHTML = f.map(l => {
        const isVoid = l.status === 'void';
        let actionColor='text-slate-800', detail='-', flow='-';
        
        if(l.type === 'sale') { 
            actionColor='text-green-600'; 
            detail=`PAID: ${(l.payment_method||'CASH').toUpperCase()}`;
            flow = `${l.from_loc?.name || 'Store'} ➝ Client`;
        }
        else if(l.type === 'receive') { 
            actionColor='text-blue-600'; 
            detail=`LPO: ${l.reference || 'N/A'}`;
            flow = `Supplier ➝ ${l.locations?.name}`;
        }
        else if(l.type === 'transfer') { 
            actionColor='text-orange-600'; 
            detail='INTERNAL MOVE';
            flow = `${l.from_loc?.name} ➝ ${l.locations?.name}`;
        }

        return `<tr class="border-b border-slate-50 hover:bg-slate-50 transition group ${isVoid ? 'bg-slate-50 opacity-50 grayscale' : ''}">
            <td class="p-4 pl-6 text-xs font-bold text-slate-500 ${isVoid ? 'line-through' : ''}">${new Date(l.created_at).toLocaleDateString()}<br><span class="opacity-50">${new Date(l.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></td>
            <td class="p-4 text-xs font-bold ${actionColor} uppercase ${isVoid ? 'line-through' : ''}">${l.type}<br><span class="text-slate-400 text-[9px]">${l.reference || ''}</span></td>
            <td class="p-4 text-xs text-slate-600 font-medium ${isVoid ? 'line-through' : ''}"><div class="font-bold">${l.products?.name}</div><div class="text-[9px] text-slate-400">By: ${l.profiles?.full_name}</div></td>
            <td class="p-4 text-xs font-mono text-slate-500 uppercase ${isVoid ? 'line-through' : ''}">${flow}</td>
            <td class="p-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider ${isVoid ? 'line-through' : ''}">${detail}</td>
            <td class="p-4 text-right font-mono text-sm font-bold text-slate-900 ${isVoid ? 'line-through' : ''}">${l.quantity}</td>
            <td class="p-4 text-right font-mono text-sm font-bold text-slate-900 ${isVoid ? 'line-through' : ''}">${window.formatPrice(l.total_value)}</td>
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
window.exportCSV = () => { let rows=[["Date","Time","Action","Item","User","Flow","Detail","Status","Quantity","Value"]]; const f=window.currentLogs; f.forEach(l=>{ rows.push([new Date(l.created_at).toLocaleDateString(),new Date(l.created_at).toLocaleTimeString(),l.type,l.products?.name,l.profiles?.full_name,`${l.from_loc?.name||''}->${l.locations?.name||''}`,l.payment_method||'-',l.status||'valid',l.quantity,l.total_value||0]); }); let csvContent="data:text/csv;charset=utf-8,"+rows.map(e=>e.join(",")).join("\n"); let link=document.createElement("a"); link.setAttribute("href",encodeURI(csvContent)); link.setAttribute("download",`Report_${new Date().toISOString().split('T')[0]}.csv`); document.body.appendChild(link); link.click(); };
window.confirmReceive = (id) => { window.premiumConfirm("Confirm Receipt", "Are you sure you have physically received these items?", "Receive Stock", () => window.receivePO(id)); };
window.receivePO = async (id) => { const { error } = await supabase.rpc('receive_stock_wac', { p_po_id: id, p_user_id: window.profile.id, p_org_id: window.profile.organization_id }); if (error) window.showNotification(error.message, "error"); else { window.showNotification("Stock Received (WAC Updated)", "success"); window.router('inventory'); } };
window.addStockModal = async () => { if(window.profile.role !== 'manager' && window.profile.role !== 'overall_storekeeper') return; const { data: prods } = await supabase.from('products').select('*').eq('organization_id', window.profile.organization_id).order('name'); const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">Receive Stock</h3><div class="input-group"><label class="input-label">Item</label><select id="sP" class="input-field">${prods.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div><div class="input-group"><label class="input-label">Store</label><select id="sL" class="input-field">${locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select></div><div class="input-group"><label class="input-label">Qty</label><input id="sQ" type="number" class="input-field"></div><button onclick="window.execAddStock()" class="btn-primary">CONFIRM</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddStock = async () => { const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value; if(qty <= 0) return; await supabase.rpc('add_stock_safe', { p_product_id: pid, p_location_id: lid, p_quantity: qty, p_org_id: window.profile.organization_id }); await supabase.from('transactions').insert({ organization_id: window.profile.organization_id, user_id: window.profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty }); document.getElementById('modal').style.display = 'none'; window.showNotification("Stock Added", "success"); window.router('inventory'); };
window.issueModal = async (name, id, fromLoc) => { window.selectedDestinationId = null; const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).neq('id', fromLoc); const html = locs.map(l => `<div onclick="window.selectDest(this, '${l.id}')" class="dest-card border p-3 rounded cursor-pointer hover:bg-slate-50 text-center"><span class="font-bold text-xs uppercase">${l.name}</span></div>`).join(''); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Move: ${name}</h3><div class="grid grid-cols-2 gap-2 mb-4 max-h-40 overflow-y-auto">${html}</div><div class="input-group"><label class="input-label">Quantity</label><input id="tQty" type="number" class="input-field"></div><button onclick="window.execIssue('${id}', '${fromLoc}')" class="btn-primary">TRANSFER</button>`; document.getElementById('modal').style.display = 'flex'; };
window.selectDest = (el, id) => { document.querySelectorAll('.dest-card').forEach(c => c.classList.remove('bg-slate-900', 'text-white')); el.classList.add('bg-slate-900', 'text-white'); window.selectedDestinationId = id; };
window.execIssue = async (pid, fromLoc) => { const qty = document.getElementById('tQty').value; if(!window.selectedDestinationId || qty <= 0) return window.showNotification("Invalid Selection", "error"); try { await transferStock(pid, fromLoc, window.selectedDestinationId, qty, window.profile.id, window.profile.organization_id); document.getElementById('modal').style.display = 'none'; window.showNotification("Request Sent", "success"); } catch(e) { window.showNotification(e.message, "error"); } };
window.createPOModal = async () => { const { data: prods } = await supabase.from('products').select('*').eq('organization_id', window.profile.organization_id).order('name'); const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id); if(!prods || !prods.length) return window.showNotification("No products found.", "error"); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">Create LPO</h3><div class="input-group"><label class="input-label">Supplier</label>${(sups && sups.length) ? `<select id="lpoSup" class="input-field">${sups.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>` : `<input id="lpoSupText" class="input-field" placeholder="Enter Supplier Name">`}</div><div class="bg-slate-50 p-4 rounded-xl border mb-4 max-h-60 overflow-y-auto">${prods.map(p => `<div class="flex items-center gap-2 mb-2"><input type="checkbox" class="lpo-check w-4 h-4" value="${p.id}" data-price="${p.cost_price}"><span class="flex-1 text-xs font-bold uppercase">${p.name}</span><input type="number" id="qty-${p.id}" class="w-16 input-field p-1 text-xs" placeholder="Qty"></div>`).join('')}</div><button onclick="window.execCreatePO()" class="btn-primary">GENERATE ORDER</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execCreatePO = async () => { const supSelect = document.getElementById('lpoSup'), supText = document.getElementById('lpoSupText'), supId = supSelect ? supSelect.value : null, supName = supSelect ? supSelect.options[supSelect.selectedIndex].text : supText.value, checks = document.querySelectorAll('.lpo-check:checked'); if(!supName || !checks.length) return window.showNotification("Invalid Order", "error"); let total = 0, items = []; checks.forEach(c => { const qty = document.getElementById(`qty-${c.value}`).value; if(qty > 0) { const cost = c.getAttribute('data-price'); total += (qty * cost); items.push({ product_id: c.value, quantity: qty, unit_cost: cost }); } }); const poData = { organization_id: window.profile.organization_id, created_by: window.profile.id, supplier_name: supName, total_cost: total, status: 'Pending' }; if(supId) poData.supplier_id = supId; const { data: po } = await supabase.from('purchase_orders').insert(poData).select().single(); await supabase.from('po_items').insert(items.map(i => ({...i, po_id: po.id}))); document.getElementById('modal').style.display = 'none'; window.showNotification("LPO Created", "success"); window.currentInvView = 'po'; window.router('inventory'); };
window.newStockTakeModal = async () => { const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Stock Take</h3><div class="input-group"><label class="input-label">Location</label><select id="stLoc" class="input-field">${locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select></div><button onclick="window.startStockTake()" class="btn-primary">START</button>`; document.getElementById('modal').style.display = 'flex'; };
window.startStockTake = async () => { const locId = document.getElementById('stLoc').value; const inv = await getInventory(window.profile.organization_id); const items = inv.filter(x => x.location_id === locId); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Count Items</h3><div class="bg-slate-50 p-2 rounded max-h-60 overflow-y-auto mb-4 border">${items.map(i => `<div class="flex justify-between items-center mb-2"><span class="text-xs font-bold w-1/2">${i.products.name}</span><input type="number" class="st-input w-20 border rounded p-1 text-center font-bold text-slate-900" data-id="${i.product_id}" data-sys="${i.quantity}" placeholder="Count"></div>`).join('')}</div><button onclick="window.saveStockTake('${locId}')" class="btn-primary">SUBMIT VARIANCE</button>`; };
window.saveStockTake = async (locId) => { const inputs = document.querySelectorAll('.st-input'); const { data: st } = await supabase.from('stock_takes').insert({ organization_id: window.profile.organization_id, location_id: locId, conducted_by: window.profile.id, status: 'Completed' }).select().single(); const items = Array.from(inputs).map(i => ({ stock_take_id: st.id, product_id: i.getAttribute('data-id'), system_qty: i.getAttribute('data-sys'), physical_qty: i.value || 0 })); await supabase.from('stock_take_items').insert(items); document.getElementById('modal').style.display = 'none'; window.showNotification("Audit Complete", "success"); window.currentRepView = 'variance'; window.router('reports'); };
window.viewVariance = async (id) => { const { data: items } = await supabase.from('stock_take_items').select('*, products(name)').eq('stock_take_id', id); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Variance Report</h3><table class="w-full text-xs text-left border"><thead><tr class="bg-slate-100"><th>Item</th><th>Sys</th><th>Phys</th><th>Var</th></tr></thead><tbody>${items.map(i => `<tr><td class="p-2 font-bold">${i.products.name}</td><td>${i.system_qty}</td><td>${i.physical_qty}</td><td class="${i.variance<0?'text-red-600 font-bold':''}">${i.variance}</td></tr>`).join('')}</tbody></table>`; document.getElementById('modal').style.display = 'flex'; };
