import { getSession, logout } from './auth.js';
import { getInventory, getLocations, createLocation, processBarSale, getPendingApprovals, respondToApproval, transferStock, getStaff, inviteStaff } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

// GLOBAL UI HANDLER
window.closeModalOutside = (e) => { if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none'; };

window.onload = async () => {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    
    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        
        // FETCH PROFILE WITH CRITICAL CHECKS
        const { data: prof, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        
        if (error || !prof) { 
            console.error("Profile Error:", error);
            alert("System Error: Profile failed to load. Please relogin.");
            logout();
            return;
        }
        
        profile = prof;
        
        // UI POPULATION
        document.getElementById('userName').innerText = profile.full_name || 'Admin';
        document.getElementById('userRole').innerText = profile.role.toUpperCase();
        document.getElementById('avatar').innerText = (profile.full_name || 'A').charAt(0);
        window.logoutAction = logout;

        // SIDEBAR LOGIC
        const sidebar = document.getElementById('sidebar');
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => sidebar.classList.remove('-translate-x-full'));
        document.getElementById('close-sidebar')?.addEventListener('click', () => sidebar.classList.add('-translate-x-full'));

        applyPermissions(profile.role);
        
        // LOAD INITIAL VIEW
        router('inventory');

    } catch (e) { 
        alert("Critical Error: " + e.message); 
    }
};

function applyPermissions(role) {
    const menus = { inventory: 'nav-inventory', bar: 'nav-bar', approvals: 'nav-approvals', staff: 'nav-staff', settings: 'nav-settings' };
    if (role === 'manager') return;
    if (role === 'finance') ['nav-bar', 'nav-staff', 'nav-settings'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    else if (role === 'barman') ['nav-approvals', 'nav-staff', 'nav-settings'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    else if (role === 'storekeeper') ['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
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

// --- CORE: INVENTORY & CATALOG (THE FIX) ---
async function renderInventory(c) {
    try {
        console.log("Fetching Catalog for Org ID:", profile.organization_id);

        // 1. Fetch Catalog (Products)
        const { data: catalog, error: catError } = await supabase
            .from('products')
            .select('*')
            .eq('organization_id', profile.organization_id)
            .order('created_at', { ascending: false }); // Show newest first

        if (catError) console.error("Catalog Fetch Error:", catError);

        // 2. Fetch Physical Inventory
        const stock = await getInventory(profile.organization_id);
        const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? stock : stock.filter(x => x.location_id === profile.assigned_location_id);
        
        // HTML Generation
        const stockRows = filteredStock.map(i => `<tr class="border-b border-gray-50"><td class="p-4 font-bold text-sm uppercase">${i.products?.name}</td><td class="p-4 text-[10px] font-bold text-gray-400 uppercase">${i.locations?.name}</td><td class="p-4 font-mono font-bold text-gray-900">${i.quantity}</td><td class="p-4 text-right"><button class="text-[10px] font-bold bg-black text-white px-3 py-2 rounded-xl uppercase">TRANSFER</button></td></tr>`).join('');
        
        // Catalog Rows - Debugging Empty State
        const catalogRows = (catalog && catalog.length > 0) 
            ? catalog.map(p => `<tr class="border-b text-[11px]"><td class="p-4 uppercase font-semibold text-gray-700">${p.name}</td><td class="p-4 text-gray-400 font-mono">$${p.cost_price} / $${p.selling_price}</td><td class="p-4 text-right font-bold text-blue-600 uppercase">REGISTERED</td></tr>`).join('') 
            : `<tr><td colspan="3" class="p-10 text-center text-xs text-gray-300 font-bold uppercase">No products found. Please click 'Register Product'.</td></tr>`;

        c.innerHTML = `
            <div class="flex justify-between items-center mb-10">
                <h1 class="text-2xl font-bold uppercase tracking-tight">Stock Control</h1>
                <div class="flex gap-2">
                    <button onclick="window.addProductModal()" class="border border-black px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Register Product</button>
                    <button onclick="window.addStockModal()" class="bg-black text-white px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Receive Stock</button>
                </div>
            </div>

            <div class="mb-12">
                <h3 class="text-[10px] font-bold text-gray-400 uppercase mb-4 tracking-widest">1. Physical Stock Balance</h3>
                <div class="bg-white rounded-2xl border overflow-hidden shadow-sm">
                    <table class="w-full text-left">
                        <thead class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b"><tr><th class="p-4">SKU</th><th class="p-4">Location</th><th class="p-4">Qty</th><th class="p-4 text-right">Action</th></tr></thead>
                        <tbody>${stockRows.length ? stockRows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-300 font-bold uppercase">No physical stock entries.</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
            
            <div>
                <h3 class="text-[10px] font-bold text-gray-400 uppercase mb-4 tracking-widest">2. Master Product Catalog</h3>
                <div class="bg-white rounded-2xl border overflow-hidden shadow-sm">
                    <table class="w-full text-left">
                        <thead class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b"><tr><th class="p-4">Item Name</th><th class="p-4">Pricing (Cost/Sell)</th><th class="p-4 text-right">Status</th></tr></thead>
                        <tbody>${catalogRows}</tbody>
                    </table>
                </div>
            </div>`;
    } catch(e) { console.error(e); }
}

// --- STRICT REGISTRATION LOGIC ---
window.addProductModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase tracking-tight">Register New Item</h3>
        <div class="modal-body">
            <input id="pN" class="input-field uppercase" placeholder="PRODUCT NAME (e.g. SAFARI LAGER)">
            <div class="grid grid-cols-2 gap-4">
                <input id="pC" type="number" class="input-field" placeholder="COST PRICE">
                <input id="pS" type="number" class="input-field" placeholder="SELLING PRICE">
            </div>
            <button id="btnReg" onclick="window.execAddProduct()" class="btn-black w-full py-4 text-[11px] mt-2 uppercase tracking-widest">Save to Catalog</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
}

window.execAddProduct = async () => {
    const btn = document.getElementById('btnReg');
    const name = document.getElementById('pN').value;
    const cost = document.getElementById('pC').value;
    const sell = document.getElementById('pS').value;

    if(!name || !cost || !sell) return alert("Please fill all fields.");
    if(!profile || !profile.organization_id) return alert("System Error: Organization ID missing. Please relogin.");

    btn.innerText = "SAVING..."; btn.disabled = true;

    try {
        // DIRECT INSERT WITH DEBUGGING
        const { data, error } = await supabase.from('products').insert({ 
            name: name.toUpperCase(), 
            cost_price: Number(cost), 
            selling_price: Number(sell), 
            organization_id: Number(profile.organization_id) // FORCE NUMBER TYPE
        }).select();

        if (error) throw error;

        // SUCCESS
        document.getElementById('modal').style.display = 'none';
        
        // FORCE REFRESH
        await router('inventory'); 
        alert("Product Registered Successfully!");

    } catch(e) { 
        alert("Registration Failed: " + e.message); 
        btn.innerText = "Save to Catalog"; 
        btn.disabled = false; 
    }
}

// --- STOCK ENTRY LOGIC (FIXED DROPDOWNS) ---
window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');

    if(!prods || prods.length === 0) return alert("Catalog is Empty. Please register a product first!");

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase tracking-tight">Add Stock</h3>
        <div class="modal-body" style="overflow: visible !important;">
            <div style="z-index: 100; position: relative;">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">1. Select Product</label>
                <select id="sP" class="input-field">${prods.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select>
            </div>
            <div style="z-index: 90; position: relative;">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">2. Target Store</label>
                <select id="sL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select>
            </div>
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">3. Quantity</label>
                <input id="sQ" type="number" class="input-field" placeholder="0.00">
            </div>
            <button onclick="window.execAddStock()" class="btn-black w-full py-4 text-[11px] mt-2 uppercase tracking-widest">Update Balance</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
}

window.execAddStock = async () => {
    const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value;
    try {
        const { data: exist } = await supabase.from('inventory').select('*').eq('product_id', pid).eq('location_id', lid).maybeSingle();
        if(exist) await supabase.from('inventory').update({ quantity: Number(exist.quantity) + Number(qty) }).eq('id', exist.id);
        else await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id });
        
        await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty });
        
        document.getElementById('modal').style.display = 'none';
        await router('inventory');
    } catch(e) { alert(e.message); }
}

// --- STAFF INVITES (FIXED) ---
async function renderStaff(c) {
    try {
        const { data: active } = await supabase.from('profiles').select('*').eq('organization_id', profile.organization_id);
        const { data: pending } = await supabase.from('staff_invites').select('*').eq('organization_id', profile.organization_id).eq('status', 'pending');
        
        const activeRows = active.map(s => `<tr class="border-b"><td class="p-4 text-sm font-bold uppercase">${s.full_name}</td><td class="p-4 text-[10px] font-bold text-blue-600 uppercase">${s.role}</td><td class="p-4 text-right text-green-500 font-bold text-[9px]">ACTIVE</td></tr>`).join('');
        const pendingRows = pending.map(i => `<tr class="border-b bg-yellow-50/20"><td class="p-4 text-sm font-medium text-gray-500">${i.email}</td><td class="p-4 text-[10px] font-bold text-gray-400 uppercase">${i.role}</td><td class="p-4 text-right text-yellow-600 font-bold text-[9px] uppercase">PENDING</td></tr>`).join('');

        c.innerHTML = `
            <div class="flex justify-between items-center mb-10"><h1 class="text-2xl font-bold uppercase tracking-tight">Personnel</h1><button onclick="window.inviteModal()" class="btn-black px-4 py-2.5 rounded-xl text-[10px] uppercase tracking-widest">+ Invite User</button></div>
            <div class="bg-white rounded-2xl border overflow-hidden shadow-sm"><table class="w-full text-left"><tbody>${activeRows}${pendingRows}</tbody></table></div>`;
    } catch(e) {}
}

window.inviteModal = async () => {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id);
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase">Invite Personnel</h3>
        <div class="modal-body" style="overflow: visible !important;">
            <div style="z-index: 100; position: relative;"><input id="iE" class="input-field" placeholder="EMAIL ADDRESS"></div>
            <div style="z-index: 90; position: relative;"><label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Role</label><select id="iR" class="input-field"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance Specialist</option></select></div>
            <div style="z-index: 80; position: relative;"><label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Assign to Store</label><select id="iL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name.toUpperCase()}</option>`).join('')}</select></div>
            <button onclick="window.execInvite()" class="btn-black w-full py-4 text-[10px] mt-2 uppercase tracking-widest">Send Invite</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execInvite = async () => {
    try {
        await supabase.from('staff_invites').insert({ email: document.getElementById('iE').value, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' });
        document.getElementById('modal').style.display = 'none';
        await router('staff');
    } catch(e) { alert(e.message); }
};

// --- OTHER MODULES ---
async function renderBar(c) { c.innerHTML = `<h1 class="text-xl font-bold uppercase text-gray-400">POS Center</h1><p class="text-xs text-gray-400 mt-4 uppercase">System Ready. Register Stock to begin.</p>`; }
async function renderApprovals(c) { c.innerHTML = `<h1 class="text-xl font-bold uppercase text-gray-400">Approvals</h1><p class="text-xs text-gray-400 mt-4 uppercase">Queue clear.</p>`; }
async function renderSettings(c) { c.innerHTML = `<h1 class="text-xl font-bold uppercase text-gray-400">Configuration</h1><p class="text-xs text-gray-400 mt-4 uppercase">Active.</p>`; }
