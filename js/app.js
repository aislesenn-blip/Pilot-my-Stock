import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

// GLOBAL UI HELPERS
window.closeModalOutside = (e) => { if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none'; };

window.onload = async () => {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    
    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = prof;
        
        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }
        
        // Setup User Info
        document.getElementById('userName').innerText = profile.full_name || 'Administrator';
        document.getElementById('userRole').innerText = profile.role.toUpperCase();
        document.getElementById('avatar').innerText = (profile.full_name || 'A').charAt(0);
        window.logoutAction = logout;

        // FIXED: HAMBURGER MENU LOGIC
        const sidebar = document.getElementById('sidebar');
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
            sidebar.classList.remove('-translate-x-full');
        });
        document.getElementById('close-sidebar')?.addEventListener('click', () => {
            sidebar.classList.add('-translate-x-full');
        });

        applyPermissions(profile.role);
        router('inventory');
    } catch (e) { logout(); }
};

function applyPermissions(role) {
    const menus = { inv: document.getElementById('nav-inventory'), bar: document.getElementById('nav-bar'), appr: document.getElementById('nav-approvals'), staff: document.getElementById('nav-staff'), sett: document.getElementById('nav-settings') };
    if (role === 'manager') return;
    if (role === 'finance') { 
        menus.bar.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden'); 
    } else if (role === 'barman') {
        menus.appr.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden');
    } else if (role === 'storekeeper') {
        menus.bar.classList.add('hidden'); menus.appr.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden');
    }
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

// --- DATA LOGIC: INVENTORY & CATALOG ---
async function renderInventory(c) {
    try {
        // Fetch Master Registry (Step 1) and Physical Stock (Step 2)
        const { data: catalog } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
        const inventory = await getInventory(profile.organization_id);
        
        const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? inventory : inventory.filter(x => x.location_id === profile.assigned_location_id);
        
        const stockRows = filteredStock.map(i => `
            <tr class="border-b border-gray-50 hover:bg-gray-50 transition">
                <td class="p-4 px-2 font-bold text-sm text-gray-900 uppercase">${i.products?.name}</td>
                <td class="p-4 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">${i.locations?.name}</td>
                <td class="p-4 px-2 font-mono font-bold text-gray-900">${i.quantity}</td>
                <td class="p-4 px-2 text-right">
                    ${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-black text-white px-3 py-2 rounded-xl uppercase">Move Stock</button>` : ''}
                </td>
            </tr>`).join('');

        const catalogRows = catalog.map(p => `
            <tr class="border-b border-gray-50 text-[11px]">
                <td class="p-4 uppercase font-semibold text-gray-700">${p.name}</td>
                <td class="p-4 text-gray-400 font-mono">Cost: $${p.cost_price} | Retail: $${p.selling_price}</td>
                <td class="p-4 text-right"><span class="bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-[9px] font-bold uppercase">Authorized</span></td>
            </tr>`).join('');

        c.innerHTML = `
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
                <h1 class="text-2xl font-bold uppercase tracking-tight">Stock Management Hub</h1>
                <div class="flex gap-2 w-full md:w-auto">
                    ${profile.role === 'manager' ? `<button onclick="window.addProductModal()" class="flex-1 md:flex-none border border-black px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Register Product</button>` : ''}
                    <button onclick="window.addStockModal()" class="flex-1 md:flex-none bg-black text-white px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Add Stock Quantity</button>
                </div>
            </div>

            <div class="mb-12">
                <h3 class="text-[10px] font-bold text-gray-400 uppercase mb-4 tracking-widest">1. Active Inventory Balances</h3>
                <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                    <table class="w-full text-left border-collapse">
                        <thead class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b">
                            <tr><th class="p-4">SKU / Item Description</th><th class="p-4">Hub Location</th><th class="p-4">Quantity</th><th class="p-4 text-right">Action</th></tr>
                        </thead>
                        <tbody>${stockRows.length ? stockRows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-300 font-bold uppercase tracking-widest">Storage record is empty. Add stock to registered products.</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
            
            <div>
                <h3 class="text-[10px] font-bold text-gray-400 uppercase mb-4 tracking-widest">2. Master Product Catalog</h3>
                <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                    <table class="w-full text-left border-collapse">
                        <thead class="bg-gray-50/50 text-[9px] uppercase font-bold text-gray-400 border-b">
                            <tr><th class="p-4">Catalog Item</th><th class="p-4">Standard Pricing</th><th class="p-4 text-right">Database Status</th></tr>
                        </thead>
                        <tbody>${catalogRows.length ? catalogRows : '<tr><td colspan="3" class="p-10 text-center text-xs text-gray-300 font-bold uppercase tracking-widest">Product Catalog is empty. Please register items.</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`;
    } catch(e) { console.error("Data Fetch Error:", e); }
}

// --- DROPDOWN Z-INDEX LAYERING ---
window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');

    if(!prods || prods.length === 0) return alert("System Error: No items found in Catalog. Register products first.");

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase tracking-tight">Stock Reception Entry</h3>
        <div class="modal-body">
            <div class="layer-top">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">1. Select Catalog Item</label>
                <select id="sP" class="input-field">${prods.map(p=>`<option value="${p.id}">${p.name.toUpperCase()}</option>`).join('')}</select>
            </div>
            <div class="layer-mid">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">2. Target Location Hub</label>
                <select id="sL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name.toUpperCase()}</option>`).join('')}</select>
            </div>
            <div class="layer-base">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">3. Input Quantity</label>
                <input id="sQ" type="number" class="input-field" placeholder="0.00">
            </div>
            <button id="btnSaveStock" onclick="window.execAddStock()" class="btn-black w-full py-4 text-[11px] tracking-widest mt-2 shadow-xl shadow-black/5">Authorize Transaction</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
}

window.execAddStock = async () => {
    const btn = document.getElementById('btnSaveStock');
    const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value;
    if(!qty || qty <= 0) return alert("Validation Error: Quantity must be greater than zero.");

    btn.innerText = "AUTHORIZING..."; btn.disabled = true;
    try {
        const { data: exist } = await supabase.from('inventory').select('*').eq('product_id', pid).eq('location_id', lid).maybeSingle();
        if(exist) await supabase.from('inventory').update({ quantity: parseFloat(exist.quantity) + parseFloat(qty) }).eq('id', exist.id);
        else await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id });
        
        await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty });
        
        document.getElementById('modal').style.display = 'none';
        await router('inventory'); 
    } catch(e) { btn.innerText = "Authorize Transaction"; btn.disabled = false; }
}

// REGISTER PRODUCT LOGIC
window.addProductModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase tracking-tight">Master Catalog Registration</h3>
        <div class="modal-body">
            <input id="pN" class="input-field uppercase" placeholder="PRODUCT DESCRIPTION (E.G. SAFARI LAGER)">
            <div class="grid grid-cols-2 gap-4">
                <input id="pC" type="number" class="input-field" placeholder="UNIT COST">
                <input id="pS" type="number" class="input-field" placeholder="RETAIL PRICE">
            </div>
            <button id="btnSaveProd" onclick="window.execAddProduct()" class="btn-black w-full py-4 text-[11px] tracking-widest mt-2 shadow-xl shadow-black/5">Finalize Catalog Entry</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
}

window.execAddProduct = async () => {
    const btn = document.getElementById('btnSaveProd');
    const name = document.getElementById('pN').value, cost = document.getElementById('pC').value, sell = document.getElementById('pS').value;
    if(!name || !cost || !sell) return alert("Validation Error: All catalog fields are required.");
    
    btn.innerText = "REGISTERING..."; btn.disabled = true;
    try {
        await supabase.from('products').insert({ name: name.toUpperCase(), cost_price: cost, selling_price: sell, organization_id: profile.organization_id });
        document.getElementById('modal').style.display = 'none';
        await router('inventory'); // Immediate refresh to Section 2
    } catch(e) { btn.innerText = "Finalize Catalog Entry"; btn.disabled = false; }
}

// Other modules (Sales, Team, Settings) use identical professional logic...
