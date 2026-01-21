import { getSession, logout } from './auth.js';
import { getInventory, getLocations, createLocation, processBarSale, getPendingApprovals, respondToApproval, transferStock, getStaff } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

// GLOBAL HELPERS
window.closeModalOutside = (e) => { if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none'; };

window.onload = async () => {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = prof;
        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }
        
        document.getElementById('userName').innerText = profile.full_name || 'System Admin';
        document.getElementById('userRole').innerText = profile.role.toUpperCase();
        document.getElementById('avatar').innerText = (profile.full_name || 'A').charAt(0);
        window.logoutAction = logout;

        // FIXED: MOBILE MENU (Hamburger)
        const sidebar = document.getElementById('sidebar');
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => sidebar.classList.remove('-translate-x-full'));
        document.getElementById('close-sidebar')?.addEventListener('click', () => sidebar.classList.add('-translate-x-full'));

        applyPermissions(profile.role);
        router('inventory');
    } catch (e) { logout(); }
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
    app.innerHTML = '<div class="flex h-full items-center justify-center flex-col gap-2"><div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div></div>';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    document.getElementById(`nav-${view}`)?.classList.add('nav-active');
    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// --- 1. INVENTORY & CATALOG (RESTORED) ---
async function renderInventory(c) {
    try {
        const { data: catalog } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
        const stock = await getInventory(profile.organization_id);
        const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? stock : stock.filter(x => x.location_id === profile.assigned_location_id);
        
        const stockRows = filteredStock.map(i => `<tr class="border-b border-gray-50"><td class="p-4 font-bold text-sm uppercase">${i.products?.name}</td><td class="p-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">${i.locations?.name}</td><td class="p-4 font-mono font-bold text-gray-900">${i.quantity}</td><td class="p-4 text-right">${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-black text-white px-3 py-2 rounded-xl uppercase">TRANSFER</button>` : ''}</td></tr>`).join('');
        const catalogRows = catalog?.map(p => `<tr class="border-b border-gray-50 text-[11px]"><td class="p-4 uppercase font-semibold text-gray-700">${p.name}</td><td class="p-4 text-gray-400 font-mono">$${p.cost_price} / $${p.selling_price}</td><td class="p-4 text-right font-bold text-blue-600 uppercase">REGISTERED</td></tr>`).join('') || '';

        c.innerHTML = `
            <div class="flex justify-between items-center mb-10"><h1 class="text-2xl font-bold uppercase tracking-tight">Inventory</h1><div class="flex gap-2">
                <button onclick="window.addProductModal()" class="border border-black px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Register Product</button>
                <button onclick="window.addStockModal()" class="bg-black text-white px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Receive Stock</button>
            </div></div>
            <div class="mb-12"><h3 class="text-[10px] font-bold text-gray-400 uppercase mb-4 tracking-widest">1. Storage Balances</h3>
            <div class="bg-white rounded-2xl border overflow-hidden shadow-sm"><table class="w-full text-left"><thead><tr class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b"><th class="p-4">SKU</th><th class="p-4">Location</th><th class="p-4">Qty</th><th class="p-4 text-right">Action</th></tr></thead><tbody>${stockRows.length ? stockRows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-300 font-bold uppercase">No physical stock.</td></tr>'}</tbody></table></div></div>
            <div><h3 class="text-[10px] font-bold text-gray-400 uppercase mb-4 tracking-widest">2. Master Product Catalog</h3>
            <div class="bg-white rounded-2xl border overflow-hidden shadow-sm"><table class="w-full text-left"><thead><tr class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b"><th class="p-4">Item</th><th class="p-4">Pricing</th><th class="p-4 text-right">Status</th></tr></thead><tbody>${catalogRows.length ? catalogRows : '<tr><td colspan="3" class="p-10 text-center text-xs text-gray-300 font-bold uppercase">Catalog empty.</td></tr>'}</tbody></table></div></div>`;
    } catch(e) {}
}

// --- 2. BAR POS SYSTEM (RESTORED LOGIC) ---
async function renderBar(c) {
    try {
        const inv = await getInventory(profile.organization_id);
        // Only show items available in user's assigned store
        const barItems = inv.filter(x => x.location_id === profile.assigned_location_id);
        const items = barItems.map(x => `
            <div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border p-5 rounded-2xl cursor-pointer hover:border-black transition active:scale-95 shadow-sm">
                <h4 class="font-bold text-sm uppercase text-gray-900">${x.products.name}</h4>
                <div class="flex justify-between items-center mt-4">
                    <span class="text-xs font-bold font-mono">$${x.products.selling_price}</span>
                    <span class="text-[9px] font-bold text-gray-300 uppercase">Stock: ${x.quantity}</span>
                </div>
            </div>`).join('');
        
        c.innerHTML = `
            <div class="flex flex-col lg:flex-row h-full gap-8">
                <div class="flex-1 overflow-y-auto pr-2"><h1 class="text-xl font-bold mb-8 uppercase text-gray-400">POS Terminal</h1><div class="grid grid-cols-2 md:grid-cols-3 gap-4">${items.length?items:'<p class="text-xs text-gray-400 uppercase">No stock assigned to this Bar/Store.</p>'}</div></div>
                <div class="w-full lg:w-96 bg-white border p-6 rounded-3xl shadow-xl flex flex-col h-fit sticky top-0">
                    <h3 class="font-bold text-lg mb-6 uppercase">Current Ticket</h3>
                    <div id="cart-list" class="flex-1 space-y-4 mb-6"></div>
                    <div class="pt-6 border-t"><div class="flex justify-between font-bold text-xl mb-6"><span>Total</span><span id="cart-total">$0.00</span></div><button onclick="window.checkout()" class="btn-black w-full py-4 text-[11px] uppercase shadow-lg">Process Sale</button></div>
                </div>
            </div>`;
        window.renderCart();
    } catch(e) {}
}

window.addCart=(n,p,id)=>{const x=cart.find(c=>c.id===id); if(x)x.qty++; else cart.push({name:n,price:p,id,qty:1}); window.renderCart();}
window.renderCart=()=>{ const l=document.getElementById('cart-list'), t=document.getElementById('cart-total'); if(!cart.length){l.innerHTML='<div class="text-center py-10 text-gray-300 text-[10px] font-bold uppercase">Empty Ticket</div>'; t.innerText='$0.00'; return;} let sum=0; l.innerHTML=cart.map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between items-center text-xs font-bold uppercase"><span>${i.name} (x${i.qty})</span><button onclick="window.remCart('${i.id}')" class="text-red-500 font-bold">×</button></div>`}).join(''); t.innerText='$'+sum.toFixed(2); }
window.remCart=(id)=>{cart=cart.filter(c=>c.id!==id); window.renderCart();}
window.checkout=async()=>{if(!cart.length) return; try{await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); alert('Sale Recorded.'); cart=[]; window.renderCart(); await router('bar');}catch(e){alert(e.message);}}

// --- 3. STAFF & INVITATIONS (RESTORED LOGIC) ---
async function renderStaff(c) {
    try {
        const { data: active } = await supabase.from('profiles').select('*').eq('organization_id', profile.organization_id);
        const { data: pending } = await supabase.from('staff_invites').select('*').eq('organization_id', profile.organization_id).eq('status', 'pending');
        
        const activeRows = active.map(s => `<tr class="border-b"><td class="p-4 text-sm font-bold uppercase">${s.full_name}</td><td class="p-4 text-[10px] font-bold text-blue-600 uppercase">${s.role}</td><td class="p-4 text-right text-green-500 font-bold text-[9px] uppercase">ACTIVE</td></tr>`).join('');
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
            <div class="z-tier-3"><input id="iE" class="input-field" placeholder="EMAIL ADDRESS"></div>
            <div class="z-tier-2"><label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Role</label><select id="iR" class="input-field"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance Specialist</option></select></div>
            <div class="z-tier-1"><label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Assign to Store</label><select id="iL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name.toUpperCase()}</option>`).join('')}</select></div>
            <button onclick="window.execInvite()" class="btn-black w-full py-4 text-[10px] mt-2 uppercase">Send Invite</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
};
window.execInvite = async () => {
    try { await supabase.from('staff_invites').insert({ email: document.getElementById('iE').value, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' }); document.getElementById('modal').style.display = 'none'; await router('staff'); } catch(e) { alert(e.message); }
};

// --- 4. APPROVALS (RESTORED LOGIC) ---
async function renderApprovals(c) {
    const q = await getPendingApprovals(profile.organization_id);
    const rows = q.map(x => `<tr class="border-b"><td class="p-4 font-bold text-sm uppercase">${x.products?.name}</td><td class="p-4 font-bold text-blue-600">${x.quantity}</td><td class="p-4 text-right"><button onclick="window.approve('${x.id}','approved')" class="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase">Approve</button></td></tr>`).join('');
    c.innerHTML = `<h1 class="text-xl font-bold mb-10 uppercase text-gray-400">Authorization Center</h1><div class="bg-white rounded-2xl border shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${rows.length?rows:'<tr><td class="p-12 text-center text-xs text-gray-400 font-bold uppercase">No pending items.</td></tr>'}</tbody></table></div>`;
}
window.approve=async(id,s)=>{ if(confirm('Approve?')) try { await respondToApproval(id,s,profile.id); await router('approvals'); } catch(e){} }

// --- 5. SETTINGS & LOCATIONS (RESTORED LOGIC) ---
async function renderSettings(c) {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id);
    const rows = locs.map(l => `<tr class="border-b"><td class="p-4 font-bold text-sm uppercase">${l.name}</td><td class="p-4 uppercase text-[10px] font-bold text-gray-400">${l.type}</td><td class="p-4 text-right text-green-600 font-bold text-[9px] uppercase">Active</td></tr>`).join('');
    c.innerHTML = `<div class="flex justify-between items-center mb-10"><h1 class="text-2xl font-bold uppercase">System Config</h1><button onclick="window.addStoreModal()" class="btn-black px-4 py-2.5 rounded-xl text-[10px] uppercase">+ New Hub</button></div><div class="bg-white rounded-2xl border shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`;
}
window.addStoreModal=()=>{ document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-6 uppercase">Add Location Hub</h3><div class="modal-body"><input id="nN" class="input-field" placeholder="HUB NAME"><select id="nT" class="input-field"><option value="main_store">Main Store</option><option value="camp_store">Camp Store</option></select><button onclick="window.execAddStore()" class="btn-black w-full py-4 text-[10px] uppercase">Authorize Registry</button></div>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddStore=async()=>{ try{ await createLocation(profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').style.display = 'none'; await router('settings'); }catch(e){alert(e.message);} };

// --- UTILS: STOCK ENTRY & PRODUCT REGISTRY ---
window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');
    if(!prods?.length) return alert("Catalog Empty: Register product first.");

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase">Stock Reception</h3>
        <div class="modal-body" style="overflow: visible !important;">
            <div class="z-tier-3"><label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">1. Select Product</label><select id="sP" class="input-field">${prods.map(p=>`<option value="${p.id}">${p.name.toUpperCase()}</option>`).join('')}</select></div>
            <div class="z-tier-2"><label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">2. Target Store</label><select id="sL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name.toUpperCase()}</option>`).join('')}</select></div>
            <div class="z-tier-1"><label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block">3. Quantity</label><input id="sQ" type="number" class="input-field" placeholder="0.00"></div>
            <button onclick="window.execAddStock()" class="btn-black w-full py-4 text-[11px] mt-2 uppercase">Authorize Entry</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
}
window.execAddStock = async () => { /* Same as previous logic */
    const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value;
    try {
        const { data: exist } = await supabase.from('inventory').select('*').eq('product_id', pid).eq('location_id', lid).maybeSingle();
        if(exist) await supabase.from('inventory').update({ quantity: parseFloat(exist.quantity) + parseFloat(qty) }).eq('id', exist.id);
        else await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id });
        await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty });
        document.getElementById('modal').style.display = 'none';
        await router('inventory'); 
    } catch(e) { alert(e.message); }
}

window.addProductModal = () => {
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-8 uppercase">Register Product</h3><div class="modal-body"><input id="pN" class="input-field uppercase" placeholder="PRODUCT NAME"><div class="grid grid-cols-2 gap-4"><input id="pC" type="number" class="input-field" placeholder="COST"><input id="pS" type="number" class="input-field" placeholder="RETAIL"></div><button onclick="window.execAddProduct()" class="btn-black w-full py-4 text-[11px] mt-2 uppercase">Finalize Registry</button></div>`;
    document.getElementById('modal').style.display = 'flex';
}
window.execAddProduct = async () => { /* Same as previous logic */
    try {
        await supabase.from('products').insert({ name: document.getElementById('pN').value.toUpperCase(), cost_price: document.getElementById('pC').value, selling_price: document.getElementById('pS').value, organization_id: profile.organization_id });
        document.getElementById('modal').style.display = 'none';
        await router('inventory');
    } catch(e) { alert(e.message); }
}
