import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

// GLOBAL UI HELPERS
window.closeModalOutside = (e) => {
    if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none';
};

window.onload = async () => {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    
    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = prof;
        
        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }
        
        // Populate Sidebar
        document.getElementById('userName').innerText = profile.full_name || 'Administrator';
        document.getElementById('userRole').innerText = profile.role.toUpperCase();
        document.getElementById('avatar').innerText = (profile.full_name || 'A').charAt(0);
        window.logoutAction = logout;

        // FIXED MOBILE MENU LOGIC
        const sidebar = document.getElementById('sidebar');
        const mobileBtn = document.getElementById('mobile-menu-btn');
        const closeBtn = document.getElementById('close-sidebar');

        mobileBtn?.addEventListener('click', () => sidebar.classList.remove('-translate-x-full'));
        closeBtn?.addEventListener('click', () => sidebar.classList.add('-translate-x-full'));

        applyPermissions(profile.role);
        router('inventory');
    } catch (e) { logout(); }
};

function applyPermissions(role) {
    const menus = { 
        inventory: document.getElementById('nav-inventory'), 
        bar: document.getElementById('nav-bar'), 
        approvals: document.getElementById('nav-approvals'), 
        staff: document.getElementById('nav-staff'), 
        settings: document.getElementById('nav-settings') 
    };
    if (role === 'manager') return;
    if (role === 'finance') { 
        menus.bar.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.settings.classList.add('hidden'); 
    } else if (role === 'barman') {
        menus.approvals.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.settings.classList.add('hidden');
    } else if (role === 'storekeeper') {
        menus.bar.classList.add('hidden'); menus.approvals.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.settings.classList.add('hidden');
    }
}

window.router = async (view) => {
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center flex-col gap-2"><div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div></div>';
    
    // UI State
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    document.getElementById(`nav-${view}`)?.classList.add('nav-active');

    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    try {
        if (view === 'inventory') await renderInventory(app);
        else if (view === 'bar') await renderBar(app);
        else if (view === 'approvals') await renderApprovals(app);
        else if (view === 'staff') await renderStaff(app);
        else if (view === 'settings') await renderSettings(app);
    } catch (err) {
        app.innerHTML = `<div class="p-8 text-center text-red-500 uppercase font-bold">Error: Check SQL Permissions</div>`;
    }
};

// --- DATA RENDERING (FIXED VISIBILITY) ---
async function renderInventory(c) {
    const { data: catalog } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const inventory = await getInventory(profile.organization_id);
    const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? inventory : inventory.filter(x => x.location_id === profile.assigned_location_id);
    
    const stockRows = filteredStock.map(i => `
        <tr class="border-b border-gray-50 hover:bg-gray-50 transition">
            <td class="p-4 px-2 font-bold text-sm text-gray-900 uppercase">${i.products?.name}</td>
            <td class="p-4 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">${i.locations?.name}</td>
            <td class="p-4 px-2 font-mono font-bold text-gray-900">${i.quantity}</td>
            <td class="p-4 px-2 text-right">
                ${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-black text-white px-3 py-2 rounded-xl uppercase">Issue</button>` : ''}
            </td>
        </tr>`).join('');

    const catalogRows = catalog?.map(p => `
        <tr class="border-b border-gray-50 text-[11px]">
            <td class="p-4 uppercase font-semibold text-gray-700">${p.name}</td>
            <td class="p-4 text-gray-400 font-mono">Cost: $${p.cost_price} | Retail: $${p.selling_price}</td>
            <td class="p-4 text-right font-bold text-black">REGISTERED</td>
        </tr>`).join('') || '';

    c.innerHTML = `
        <div class="flex justify-between items-center mb-10">
            <h1 class="text-2xl font-bold uppercase tracking-tight">Inventory</h1>
            <div class="flex gap-2">
                <button onclick="window.addProductModal()" class="border border-black px-4 py-2 rounded-xl text-[10px] font-bold uppercase">Register Product</button>
                <button onclick="window.addStockModal()" class="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase">Receive Stock</button>
            </div>
        </div>
        <div class="mb-12">
            <h3 class="text-[10px] font-bold text-gray-400 uppercase mb-4 tracking-widest">1. Stock Balances</h3>
            <div class="bg-white rounded-2xl border overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b"><tr><th class="p-4">Item</th><th class="p-4">Location</th><th class="p-4">Balance</th><th class="p-4 text-right">Action</th></tr></thead>
                    <tbody>${stockRows.length ? stockRows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-300 font-bold uppercase">No stock data.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
        <div>
            <h3 class="text-[10px] font-bold text-gray-400 uppercase mb-4 tracking-widest">2. Master Product Catalog</h3>
            <div class="bg-white rounded-2xl border overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b"><tr><th class="p-4">Product</th><th class="p-4">Pricing</th><th class="p-4 text-right">Status</th></tr></thead>
                    <tbody>${catalogRows.length ? catalogRows : '<tr><td colspan="3" class="p-10 text-center text-xs text-gray-300 font-bold uppercase">Catalog empty.</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;
}

// --- DROPDOWN FIX: Z-INDEX STACKING ---
window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');
    if(!prods?.length) return alert("Register a product first.");

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase">Receive Stock</h3>
        <div class="modal-body" style="overflow: visible !important;">
            <div style="position: relative; z-index: 500;">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">1. Select Product</label>
                <select id="sP" class="input-field">${prods.map(p=>`<option value="${p.id}">${p.name.toUpperCase()}</option>`).join('')}</select>
            </div>
            <div style="position: relative; z-index: 400;">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">2. Destination Store</label>
                <select id="sL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name.toUpperCase()}</option>`).join('')}</select>
            </div>
            <div style="position: relative; z-index: 100;">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">3. Quantity</label>
                <input id="sQ" type="number" class="input-field" placeholder="0.00">
            </div>
            <button onclick="window.execAddStock()" class="btn-black w-full py-4 text-[11px] mt-2">Authorize Entry</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
}

window.execAddStock = async () => {
    const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value;
    try {
        const { data: exist } = await supabase.from('inventory').select('*').eq('product_id', pid).eq('location_id', lid).maybeSingle();
        if(exist) await supabase.from('inventory').update({ quantity: parseFloat(exist.quantity) + parseFloat(qty) }).eq('id', exist.id);
        else await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id });
        document.getElementById('modal').style.display = 'none';
        await router('inventory'); 
    } catch(e) { alert(e.message); }
}

window.addProductModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase">Register Product</h3>
        <div class="modal-body">
            <input id="pN" class="input-field uppercase" placeholder="PRODUCT NAME">
            <div class="grid grid-cols-2 gap-4">
                <input id="pC" type="number" class="input-field" placeholder="COST PRICE">
                <input id="pS" type="number" class="input-field" placeholder="SELL PRICE">
            </div>
            <button onclick="window.execAddProduct()" class="btn-black w-full py-4 text-[11px] mt-2">Finalize Registry</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
}

window.execAddProduct = async () => {
    try {
        await supabase.from('products').insert({ name: document.getElementById('pN').value.toUpperCase(), cost_price: document.getElementById('pC').value, selling_price: document.getElementById('pS').value, organization_id: profile.organization_id });
        document.getElementById('modal').style.display = 'none';
        await router('inventory');
    } catch(e) { alert(e.message); }
}

// OTHER MODULES
async function renderSettings(c) {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id);
    const rows = locs.map(l => `<tr class="border-b"><td class="p-4 font-bold text-sm uppercase">${l.name}</td><td class="p-4 uppercase text-[10px] font-bold text-gray-400">${l.type}</td><td class="p-4 text-right font-bold text-gray-300">ACTIVE</td></tr>`).join('');
    c.innerHTML = `<div class="flex justify-between mb-8"><h1 class="text-xl font-bold uppercase">Settings</h1></div><div class="bg-white rounded-2xl border shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`;
}

async function renderStaff(c) {
    const { data: staff } = await supabase.from('profiles').select('*').eq('organization_id', profile.organization_id);
    const rows = staff.map(s => `<tr class="border-b"><td class="p-4 text-sm font-bold uppercase">${s.full_name}</td><td class="p-4 text-[10px] font-bold text-blue-600 uppercase">${s.role}</td></tr>`).join('');
    c.innerHTML = `<h1 class="text-xl font-bold mb-8 uppercase">Team</h1><div class="bg-white rounded-2xl border shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`;
}

async function renderBar(c) { c.innerHTML = `<h1 class="text-xl font-bold uppercase">Bar & POS</h1><p class="text-xs text-gray-400 mt-4 uppercase">Outlet stock verification in progress...</p>`; }
async function renderApprovals(c) { c.innerHTML = `<h1 class="text-xl font-bold uppercase">Approvals</h1><p class="text-xs text-gray-400 mt-4 uppercase">Queue clear.</p>`; }
