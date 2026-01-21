import { getSession, logout } from './auth.js';
import { getInventory, createLocation, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null; let cart = []; let currentLogs = [];
window.closeModalOutside = (e) => { if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none'; };

// --- PREMIUM NOTIFICATIONS ---
window.showNotification = (message, type = 'success') => {
    const div = document.createElement('div');
    div.style.cssText = `position: fixed; top: 20px; right: 20px; padding: 16px 24px; border-radius: 12px; color: white; font-weight: bold; z-index: 9999; box-shadow: 0 10px 25px rgba(0,0,0,0.2); animation: fadeIn 0.3s ease-out;`;
    div.style.backgroundColor = type === 'success' ? '#0f172a' : '#dc2626'; // Slate-900 or Red-600
    div.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 4000);
};

// --- INITIALIZATION ---
window.onload = async () => {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    try {
        // 1. CLAIM INVITE KWANZA (CRITICAL)
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        
        // 2. VUTA PROFILE UPYA (Hakikisha tunapata Role mpya)
        let { data: prof, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        
        // Kama profile haipo (Delay ya network), jaribu tena mara moja
        if (!prof) {
            await new Promise(r => setTimeout(r, 1000));
            const retry = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
            prof = retry.data;
        }

        profile = prof;
        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }

        // 3. FORCE NAME ENTRY (LOGIC ILIYOKAZWA)
        // Kama jina ni tupu, au ni sawa na Role, au fupi sana -> LAZIMISHA
        const forbiddenNames = ['Manager', 'Storekeeper', 'Barman', 'Finance', 'User', 'Admin'];
        const currentName = profile.full_name || "";
        
        if (currentName.length < 3 || forbiddenNames.some(n => currentName.toLowerCase().includes(n.toLowerCase()))) {
            let newName = null;
            while (!newName || newName.length < 3) {
                newName = prompt(`SECURITY CHECK:\nWe noticed your profile is incomplete.\n\nPlease enter your LEGAL FULL NAME (e.g. Juma Hamisi):`);
            }
            
            // Save immediately
            const { error: updateErr } = await supabase.from('profiles').update({ full_name: newName }).eq('id', profile.id);
            if (!updateErr) {
                profile.full_name = newName;
                window.showNotification("Profile Identity Verified", "success");
            }
        }
        
        window.logoutAction = logout;
        
        // UI Helpers
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => document.getElementById('sidebar').classList.remove('-translate-x-full'));
        document.getElementById('close-sidebar')?.addEventListener('click', () => document.getElementById('sidebar').classList.add('-translate-x-full'));
        
        const userNameDisplay = document.querySelector('.font-bold.text-slate-700'); 
        if(userNameDisplay) userNameDisplay.innerText = profile.full_name;

        applyStrictPermissions(profile.role);
        const defaultView = (profile.role === 'barman') ? 'bar' : 'inventory';
        router(defaultView);
        
    } catch (e) { console.error(e); logout(); }
};

// --- PERMISSIONS ---
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
    if (profile.role === 'barman' && view !== 'bar') { window.showNotification("Access Denied: POS Only", "error"); return; }
    if (profile.role === 'storekeeper' && ['approvals', 'settings', 'staff'].includes(view)) { window.showNotification("Access Restricted", "error"); return; }
    
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div></div>';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    document.getElementById(`nav-${view}`)?.classList.add('nav-active');
    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app);
    else if (view === 'reports') await renderReports(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// --- MODULES ---

async function renderInventory(c) {
    const { data: catalog } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const stock = await getInventory(profile.organization_id);
    const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? stock : stock.filter(x => x.location_id === profile.assigned_location_id);
    const showAdminActions = profile.role === 'manager';

    const stockRows = filteredStock.map(i => `
        <tr class="transition hover:bg-slate-50 border-b border-slate-100 last:border-0">
            <td class="font-bold text-gray-800 uppercase py-3 pl-4">${i.products?.name}</td>
            <td class="text-xs font-bold text-gray-500 uppercase tracking-widest">${i.locations?.name}</td>
            <td class="font-mono font-bold text-gray-900 text-lg">${i.quantity}</td>
            <td class="text-right pr-4">
                ${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-white border border-slate-300 text-slate-700 px-3 py-1 rounded hover:bg-slate-100 transition shadow-sm">MOVE</button>` : ''}
            </td>
        </tr>`).join('');

    c.innerHTML = `
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div><h1 class="text-3xl font-bold uppercase text-slate-900">Inventory</h1><p class="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">${profile.role === 'manager' ? 'All Locations' : 'My Store'}</p></div>
            <div class="flex gap-3">${showAdminActions ? `<button onclick="window.addProductModal()" class="btn-primary bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-sm">Register Item</button><button onclick="window.addStockModal()" class="btn-primary shadow-lg shadow-slate-900/20">Receive Stock</button>` : ''}</div>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left">
            <thead class="bg-slate-50 border-b border-slate-200"><tr><th class="py-3 pl-4 text-xs font-bold text-slate-400 uppercase">Item</th><th class="text-xs font-bold text-slate-400 uppercase">Location</th><th class="text-xs font-bold text-slate-400 uppercase">Qty</th><th class="text-right pr-4 text-xs font-bold text-slate-400 uppercase">Action</th></tr></thead>
            <tbody>${stockRows.length ? stockRows : '<tr><td colspan="4" class="text-center text-xs text-gray-400 py-12">No stock available.</td></tr>'}</tbody>
        </table></div></div>`;
}

// ... (Ripoti na modules zingine zinabaki vile vile, ziko sawa) ...
// Nitaweka tu hizi Modals zenye Style Fix hapa chini

// --- FIXED MODALS (HARDCODED Z-INDEX STYLES) ---
// Hapa ndipo dawa ilipo. Nimetumia style="" attribute moja kwa moja.

window.addProductModal = () => { 
    if(profile.role !== 'manager') return; 
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase text-center">New Product</h3>
        
        <div class="input-group" style="position: relative; z-index: 100;">
            <label class="input-label">Name</label>
            <input id="pN" class="input-field uppercase">
        </div>
        
        <div class="grid grid-cols-2 gap-5 mb-8" style="position: relative; z-index: 50;">
            <div class="input-group mb-0">
                <label class="input-label">Cost</label>
                <input id="pC" type="number" class="input-field">
            </div>
            <div class="input-group mb-0">
                <label class="input-label">Selling</label>
                <input id="pS" type="number" class="input-field">
            </div>
        </div>
        <button onclick="window.execAddProduct()" class="btn-primary">Save</button>`;
    document.getElementById('modal').style.display = 'flex'; 
};

window.addStockModal = async () => {
    if(profile.role !== 'manager') return;
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');
    
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase text-center">Receive from Supplier</h3>
        
        <div class="input-group" style="position: relative; z-index: 100;">
            <label class="input-label">Item</label>
            <select id="sP" class="input-field cursor-pointer">${prods.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select>
        </div>

        <div class="input-group" style="position: relative; z-index: 80;">
            <label class="input-label">Store</label>
            <select id="sL" class="input-field cursor-pointer">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select>
        </div>

        <div class="input-group" style="position: relative; z-index: 10;">
            <label class="input-label">Quantity</label>
            <input id="sQ" type="number" class="input-field">
        </div>

        <button onclick="window.execAddStock()" class="btn-primary mt-6">Confirm Entry</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.issueModal = async (name, id, fromLoc) => { 
    let { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).neq('id', fromLoc);
    if(profile.role === 'storekeeper') locs = locs.filter(l => l.type === 'department');

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase text-center">Move Stock</h3>
        
        <div class="input-group" style="position: relative; z-index: 100;">
            <label class="input-label">Item</label>
            <input value="${name}" disabled class="input-field bg-slate-50 uppercase text-gray-500">
        </div>

        <div class="input-group" style="position: relative; z-index: 80;">
            <label class="input-label">To Destination</label>
            <select id="tTo" class="input-field cursor-pointer hover:border-black">
                ${locs.map(l=>`<option value="${l.id}">${l.name} (${l.type.replace('_',' ')})</option>`).join('')}
            </select>
        </div>

        <div class="input-group" style="position: relative; z-index: 10;">
            <label class="input-label">Quantity</label>
            <input id="tQty" type="number" class="input-field">
        </div>

        <button onclick="window.execIssue('${id}','${fromLoc}')" class="btn-primary mt-6">Request Transfer</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.inviteModal = async () => { 
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id); 
    
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase text-center">Invite Staff</h3>
        
        <div class="input-group" style="position: relative; z-index: 100;">
            <label class="input-label">Email</label>
            <input id="iE" class="input-field" placeholder="email@company.com">
        </div>

        <div class="input-group" style="position: relative; z-index: 80;">
            <label class="input-label">Role</label>
            <select id="iR" class="input-field cursor-pointer">
                <option value="storekeeper">Storekeeper</option>
                <option value="barman">Barman</option>
                <option value="finance">Finance</option>
            </select>
        </div>

        <div class="input-group" style="position: relative; z-index: 60;">
            <label class="input-label">Assign Location</label>
            <select id="iL" class="input-field cursor-pointer">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select>
        </div>

        <button onclick="window.execInvite()" class="btn-primary mt-6">Send Invitation</button>`; 
    document.getElementById('modal').style.display = 'flex'; 
};

// ... (Function za Add Store, Reports etc zinabaki vile vile)

// --- EXEC FUNCTIONS (No Alerts) ---
window.execAddProduct = async () => { try { await supabase.from('products').insert({ name: document.getElementById('pN').value.toUpperCase(), cost_price: document.getElementById('pC').value, selling_price: document.getElementById('pS').value, organization_id: profile.organization_id }); document.getElementById('modal').style.display = 'none'; window.showNotification("Item Registered Successfully", "success"); router('inventory'); } catch(e) { window.showNotification(e.message, "error"); } };

window.execAddStock = async () => { 
    try {
        const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value; 
        if(!qty || qty <= 0) return window.showNotification("Invalid Quantity", "error");
        await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id }); 
        await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty }); 
        document.getElementById('modal').style.display = 'none'; 
        window.showNotification("Stock Received", "success");
        router('inventory');
    } catch(e) { window.showNotification(e.message, "error"); }
};

window.execInvite = async () => { 
    const email = document.getElementById('iE').value; 
    if(!email.includes('@')) return window.showNotification("Invalid Email", "error"); 
    await supabase.from('staff_invites').insert({ email, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' }); 
    document.getElementById('modal').style.display = 'none'; 
    window.showNotification("Invitation Sent", "success");
    router('staff'); 
};

window.execIssue = async (pId, fId) => { 
    try { 
        await transferStock(pId, fId, document.getElementById('tTo').value, document.getElementById('tQty').value, profile.id, profile.organization_id); 
        document.getElementById('modal').style.display = 'none'; 
        window.showNotification("Transfer Request Sent", "success"); 
        router('inventory'); 
    } catch(e){ window.showNotification(e.message, "error"); }
};

// ... Functions za Cart na Checkout nazo zinatumia showNotification ...
window.checkout=async()=>{if(!cart.length) return; try{await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); window.showNotification("Sale Completed", "success"); cart=[]; window.renderCart(); router('bar');}catch(e){window.showNotification(e.message, "error");}}
