import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

// Billion Dollar UX: Close modal when clicking outside
window.closeModalOutside = (e) => {
    if (e.target.id === 'modal') {
        document.getElementById('modal').classList.add('hidden');
    }
};

window.onload = async () => {
    const app = document.getElementById('app-view');
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = prof;

        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }

        document.getElementById('userName').innerText = profile.full_name || 'User';
        document.getElementById('userRole').innerText = profile.role.toUpperCase();
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        applyRolePermissions(profile.role);
        router('inventory');
    } catch (e) { logout(); }
};

function applyRolePermissions(role) {
    const menus = { inv: document.getElementById('nav-inventory'), bar: document.getElementById('nav-bar'), appr: document.getElementById('nav-approvals'), staff: document.getElementById('nav-staff'), sett: document.getElementById('nav-settings') };
    if (role === 'manager') return;
    if (role === 'finance') { menus.bar.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden'); }
    else if (role === 'barman') { menus.appr.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden'); }
    else if (role === 'storekeeper') { menus.bar.classList.add('hidden'); menus.appr.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden'); }
}

window.router = async (view) => {
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div></div>';
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    document.getElementById(`nav-${view}`)?.classList.add('nav-active');
    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// --- REAL-TIME DATA REFRESH LOGIC ---
async function renderInventory(c) {
    try {
        const data = await getInventory(profile.organization_id);
        const filtered = (profile.role === 'manager' || profile.role === 'finance') ? data : data.filter(x => x.location_id === profile.assigned_location_id);
        
        const rows = filtered.map(i => `
            <tr class="border-b border-gray-50 hover:bg-gray-50/50 transition">
                <td class="p-4 px-2 font-bold text-sm text-gray-900 uppercase">${i.products?.name}</td>
                <td class="p-4 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">${i.locations?.name}</td>
                <td class="p-4 px-2 font-mono font-bold text-gray-900">${i.quantity}</td>
                <td class="p-4 px-2 text-right">
                    ${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-black text-white px-3 py-2 rounded-xl uppercase tracking-tighter">Issue</button>` : ''}
                </td>
            </tr>`).join('');

        c.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <h1 class="text-xl font-bold uppercase tracking-tight">Enterprise Inventory</h1>
                <div class="flex gap-2">
                    ${profile.role === 'manager' ? `<button onclick="window.addProductModal()" class="bg-white border border-black px-4 py-2 rounded-xl text-[10px] font-bold uppercase">Register Item</button>` : ''}
                    <button onclick="window.addStockModal()" class="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest">+ Receive Stock</button>
                </div>
            </div>
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold border-b border-gray-100">
                        <tr><th class="p-4">SKU / Item</th><th class="p-4">Location</th><th class="p-4">Balance</th><th class="p-4 text-right">Action</th></tr>
                    </thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-400 font-bold">NO RECORDS FOUND.</td></tr>'}</tbody>
                </table>
            </div>`;
    } catch(e) {}
}

// --- DROP-DOWN FIX: PRIORITY Z-INDEX ---
window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Stock Reception</h3>
        <div class="modal-body">
            <div style="position: relative; z-index: 50;">
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">1. Select Product</label>
                <select id="sP" class="input-field">${prods.map(p=>`<option value="${p.id}">${p.name.toUpperCase()}</option>`).join('')}</select>
            </div>
            <div style="position: relative; z-index: 40;">
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">2. Store Location</label>
                <select id="sL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name.toUpperCase()}</option>`).join('')}</select>
            </div>
            <div style="position: relative; z-index: 30;">
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">3. Quantity</label>
                <input id="sQ" type="number" class="input-field" placeholder="0.00">
            </div>
            <button id="btnS" onclick="window.execAddStock()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase mt-2">Authorize Stock Entry</button>
        </div>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execAddStock = async () => {
    const btn = document.getElementById('btnS');
    const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value;
    if(!qty || qty <= 0) return alert("Enter quantity.");

    btn.innerText = "AUTHORIZING..."; btn.disabled = true;
    try {
        const { data: exist } = await supabase.from('inventory').select('*').eq('product_id', pid).eq('location_id', lid).maybeSingle();
        if(exist) await supabase.from('inventory').update({ quantity: parseFloat(exist.quantity) + parseFloat(qty) }).eq('id', exist.id);
        else await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id });
        
        await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty });
        
        document.getElementById('modal').classList.add('hidden');
        // FEEDBACK: Refresh table papo hapo
        await router('inventory');
    } catch(e) { alert(e.message); btn.innerText = "Authorize Stock Entry"; btn.disabled = false; }
}

// Data Registration Fix (Point 1 of Proposal)
window.addProductModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Register Item</h3>
        <div class="modal-body">
            <input id="pN" class="input-field" placeholder="PRODUCT NAME">
            <div class="grid grid-cols-2 gap-4">
                <input id="pC" type="number" class="input-field" placeholder="COST PRICE">
                <input id="pS" type="number" class="input-field" placeholder="SELL PRICE">
            </div>
            <button id="btnP" onclick="window.execAddProduct()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase mt-2">Authorize Product</button>
        </div>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execAddProduct = async () => {
    const btn = document.getElementById('btnP');
    const name = document.getElementById('pN').value, cost = document.getElementById('pC').value, sell = document.getElementById('pS').value;
    if(!name || !cost || !sell) return alert("Fill all fields.");
    
    btn.innerText = "REGISTERING..."; btn.disabled = true;
    try {
        await supabase.from('products').insert({ name, cost_price: cost, selling_price: sell, organization_id: profile.organization_id });
        document.getElementById('modal').classList.add('hidden');
        // LALIMISHA REFRESH
        await router('inventory');
    } catch(e) { alert(e.message); btn.innerText = "Authorize Product"; btn.disabled = false; }
}
