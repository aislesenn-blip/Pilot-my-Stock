import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

// MOBILE MENU & MODAL UTILS
window.closeModalOutside = (e) => {
    if (e.target.id === 'modal') {
        document.getElementById('modal').style.display = 'none';
    }
};

window.onload = async () => {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    
    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = prof;
        
        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }
        
        // Populate Professional UI
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
    const activeNav = document.getElementById(`nav-${view}`);
    if(activeNav) activeNav.classList.add('nav-active');

    // Close mobile menu on navigate
    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// --- REQUIREMENT 1 & 2: INVENTORY & PRODUCT MASTER ---
async function renderInventory(c) {
    try {
        // Fetch both registered items and current inventory
        const { data: masterProducts } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
        const stockData = await getInventory(profile.organization_id);
        
        const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? stockData : stockData.filter(x => x.location_id === profile.assigned_location_id);
        
        const stockRows = filteredStock.map(i => `
            <tr class="border-b border-gray-50 hover:bg-gray-50 transition">
                <td class="p-4 px-2 font-bold text-sm text-gray-900 uppercase">${i.products?.name}</td>
                <td class="p-4 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">${i.locations?.name}</td>
                <td class="p-4 px-2 font-mono font-bold text-gray-900">${i.quantity}</td>
                <td class="p-4 px-2 text-right">
                    ${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-black text-white px-3 py-1.5 rounded-lg uppercase">Move Stock</button>` : ''}
                </td>
            </tr>`).join('');

        const masterRows = masterProducts.map(p => `
            <tr class="border-b text-[11px] text-gray-500">
                <td class="p-3 uppercase font-semibold text-gray-700">${p.name}</td>
                <td class="p-3">$${p.cost_price} (Cost) / $${p.selling_price} (Retail)</td>
                <td class="p-3 text-right text-black font-bold uppercase tracking-tighter">Registered</td>
            </tr>`).join('');

        c.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <h1 class="text-xl font-bold uppercase tracking-tight">Stock Management Dashboard</h1>
                <div class="flex gap-2">
                    ${profile.role === 'manager' ? `<button onclick="window.addProductModal()" class="border border-black px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Register New Product</button>` : ''}
                    <button onclick="window.addStockModal()" class="bg-black text-white px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Perform Inbound Entry</button>
                </div>
            </div>

            <h3 class="text-[10px] font-bold text-gray-400 uppercase mb-3 tracking-widest">1. Active Stock Balances</h3>
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm mb-12">
                <table class="w-full text-left border-collapse">
                    <thead class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b">
                        <tr><th class="p-4">SKU / Item Name</th><th class="p-4">Storage Hub</th><th class="p-4">Available Qty</th><th class="p-4 text-right">Operations</th></tr>
                    </thead>
                    <tbody>${stockRows.length ? stockRows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-300 font-bold uppercase">No physical stock recorded yet.</td></tr>'}</tbody>
                </table>
            </div>
            
            <h3 class="text-[10px] font-bold text-gray-400 uppercase mb-3 tracking-widest">2. Master Product Catalog (Ulichorejista)</h3>
            <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                <table class="w-full text-left border-collapse">
                    <thead class="bg-gray-50/50 text-[9px] uppercase font-bold text-gray-400 border-b">
                        <tr><th class="p-3">Product Description</th><th class="p-3">Standardized Pricing</th><th class="p-3 text-right">System Status</th></tr>
                    </thead>
                    <tbody>${masterRows.length ? masterRows : '<tr><td colspan="3" class="p-10 text-center text-gray-300 uppercase">Product catalog is empty.</td></tr>'}</tbody>
                </table>
            </div>`;
    } catch(e) {}
}

// --- BULLETPROOF DROP-DOWN STACKING ---
window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');

    if(!prods || prods.length === 0) return alert("Error: No items found in Catalog. Please register products first.");

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Inbound Stock Entry</h3>
        <div class="modal-body">
            <div class="z-priority-high">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">1. Select Catalog Item</label>
                <select id="sP" class="input-field">${prods.map(p=>`<option value="${p.id}">${p.name.toUpperCase()}</option>`).join('')}</select>
            </div>
            <div class="z-priority-mid">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">2. Target Storage Hub</label>
                <select id="sL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name.toUpperCase()}</option>`).join('')}</select>
            </div>
            <div class="z-priority-low">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">3. Received Quantity</label>
                <input id="sQ" type="number" class="input-field" placeholder="0.00">
            </div>
            <button id="btnSaveStock" onclick="window.execAddStock()" class="btn-black w-full py-4 uppercase text-[10px] tracking-widest mt-2 shadow-xl">Authorize Inbound Transaction</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
}

window.execAddStock = async () => {
    const btn = document.getElementById('btnSaveStock');
    const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value;
    if(!qty || qty <= 0) return alert("Input validation failed: Invalid Quantity.");

    btn.innerText = "AUTHORIZING..."; btn.disabled = true;
    try {
        const { data: exist } = await supabase.from('inventory').select('*').eq('product_id', pid).eq('location_id', lid).maybeSingle();
        if(exist) await supabase.from('inventory').update({ quantity: parseFloat(exist.quantity) + parseFloat(qty) }).eq('id', exist.id);
        else await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id });
        
        await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty });
        
        document.getElementById('modal').style.display = 'none';
        await router('inventory'); 
    } catch(e) { alert(e.message); btn.innerText = "Authorize Inbound Transaction"; btn.disabled = false; }
}

// Product Registration (Point 1)
window.addProductModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Register New Catalog Item</h3>
        <div class="modal-body">
            <input id="pN" class="input-field uppercase" placeholder="PRODUCT DESCRIPTION">
            <div class="grid grid-cols-2 gap-4">
                <input id="pC" type="number" class="input-field" placeholder="UNIT COST">
                <input id="pS" type="number" class="input-field" placeholder="RETAIL PRICE">
            </div>
            <button id="btnSaveProd" onclick="window.execAddProduct()" class="btn-black w-full py-4 uppercase text-[10px] tracking-widest mt-2">Finalize Registry</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
}

window.execAddProduct = async () => {
    const btn = document.getElementById('btnSaveProd');
    const name = document.getElementById('pN').value, cost = document.getElementById('pC').value, sell = document.getElementById('pS').value;
    if(!name || !cost || !sell) return alert("Input validation failed: Required fields missing.");
    
    btn.innerText = "REGISTERING..."; btn.disabled = true;
    try {
        await supabase.from('products').insert({ name, cost_price: cost, selling_price: sell, organization_id: profile.organization_id });
        document.getElementById('modal').style.display = 'none';
        await router('inventory');
    } catch(e) { alert(e.message); btn.innerText = "Finalize Registry"; btn.disabled = false; }
}

// POS & Sales Logic (Point 4)
async function renderBar(c) {
    const inv = await getInventory(profile.organization_id);
    const barItems = inv.filter(x => x.location_id === profile.assigned_location_id);
    const items = barItems.map(x => `<div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border p-5 rounded-2xl cursor-pointer hover:border-black transition active:scale-95 shadow-sm"><h4 class="font-bold text-sm text-gray-900 uppercase tracking-tight">${x.products.name}</h4><div class="flex justify-between items-center mt-4"><span class="text-xs font-bold text-gray-900 font-mono tracking-tighter">$${x.products.selling_price}</span><span class="text-[9px] font-bold text-gray-300 uppercase tracking-widest">Stock: ${x.quantity}</span></div></div>`).join('');
    c.innerHTML = `<div class="flex flex-col lg:flex-row h-full gap-8"><div class="flex-1 overflow-y-auto pr-2"><h1 class="text-xl font-bold mb-8 uppercase tracking-widest text-gray-400">Sales Entry Portal</h1><div class="grid grid-cols-2 md:grid-cols-3 gap-4">${items.length?items:'Physical stock not assigned to this outlet.'}</div></div><div class="w-full lg:w-96 bg-white border p-6 rounded-3xl shadow-xl flex flex-col h-fit sticky top-0"><h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Active Ticket</h3><div id="cart-list" class="flex-1 space-y-4 mb-6"></div><div class="pt-6 border-t"><div class="flex justify-between font-bold text-xl mb-6 text-gray-900 tracking-tighter"><span>Total Due</span><span id="cart-total">$0.00</span></div><button onclick="window.checkout()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase shadow-lg shadow-black/10 transition uppercase tracking-widest">Authorize Sale</button></div></div></div>`;
    window.renderCart();
}

window.addCart=(n,p,id)=>{const x=cart.find(c=>c.id===id); if(x)x.qty++; else cart.push({name:n,price:p,id,qty:1}); window.renderCart();}
window.renderCart=()=>{
    const l=document.getElementById('cart-list'), t=document.getElementById('cart-total');
    if(!cart.length){l.innerHTML='<div class="text-center py-12 text-gray-300 text-[10px] font-bold uppercase tracking-widest">Empty Selection</div>'; t.innerText='$0.00'; return;}
    let sum=0; l.innerHTML=cart.map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between items-center text-xs font-bold uppercase tracking-tighter"><span>${i.name} (${i.qty})</span><button onclick="window.remCart('${i.id}')" class="text-red-500 font-bold">×</button></div>`}).join(''); t.innerText='$'+sum.toFixed(2);
}
window.remCart=(id)=>{cart=cart.filter(c=>c.id!==id); window.renderCart();}
window.checkout=async()=>{if(!cart.length) return; try{await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); alert('Success: Transaction authorized.'); cart=[]; window.renderCart(); await router('bar');}catch(e){}}

window.issueModal=(name,id,from)=>{
    document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Authorize Stock Movement</h3><div class="modal-body"><input value="${name}" disabled class="input-field bg-gray-50 font-bold uppercase text-gray-400"><div class="z-priority-high"><label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">Target Hub</label><select id="tTo" class="input-field"></select></div><div class="z-priority-mid"><label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">Movement Quantity</label><input id="tQty" type="number" class="input-field" placeholder="0.00"></div><button onclick="window.execIssue('${id}','${from}')" class="btn-black w-full py-4 uppercase text-[10px] tracking-widest">Confirm Transfer</button></div>`;
    getLocations(profile.organization_id).then(locs => { document.getElementById('tTo').innerHTML = locs.map(l=>`<option value="${l.id}">${l.name.toUpperCase()}</option>`).join(''); });
    document.getElementById('modal').style.display = 'flex';
}
window.execIssue=async(id,from)=>{ try { await transferStock(id, from, document.getElementById('tTo').value, document.getElementById('tQty').value, profile.id, profile.organization_id); document.getElementById('modal').style.display = 'none'; await router('inventory'); } catch(e){alert(e.message);} }

// Staff & Approvals (Point 3 & 5)
async function renderApprovals(c){
    try {
        const q = await getPendingApprovals(profile.organization_id);
        const r = q.map(x => `<tr class="border-b border-gray-50"><td class="p-4 font-bold text-sm uppercase">${x.products?.name}</td><td class="p-4 font-bold text-blue-600">${x.quantity}</td><td class="p-4 text-right"><button onclick="window.approve('${x.id}','approved')" class="bg-black text-white px-3 py-1.5 rounded-lg text-[10px] font-bold">AUTHORIZE</button></td></tr>`).join('');
        c.innerHTML = `<h1 class="text-xl font-bold mb-8 uppercase text-gray-400">Authorization Queue</h1><div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm"><table class="w-full text-left"><tbody>${r.length?r:'<tr><td class="p-12 text-center text-xs text-gray-400 font-bold uppercase tracking-widest">All movements cleared.</td></tr>'}</tbody></table></div>`;
    } catch(e){}
}
window.approve=async(id,s)=>{ if(confirm('Approve movement?')) try { await respondToApproval(id,s,profile.id); await router('approvals'); } catch(e){} }

async function renderStaff(c){
    try {
        const staff = await getStaff(profile.organization_id);
        const rows = staff.map(s=>`<tr class="border-b border-gray-50"><td class="p-4 text-sm font-bold text-gray-900 uppercase tracking-tight">${s.full_name}</td><td class="p-4 text-xs text-gray-400 font-bold uppercase">${s.role}</td></tr>`).join('');
        c.innerHTML = `<div class="flex justify-between mb-8"><h1 class="text-xl font-bold uppercase tracking-widest text-gray-400">Security & Personnel</h1><button onclick="window.inviteModal()" class="bg-black text-white px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">GRANT ACCESS</button></div><div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`;
    } catch(e){}
}

window.inviteModal=async()=>{
    const locs = await getLocations(profile.organization_id);
    document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Invite Professional Staff</h3><div class="modal-body"><input id="iE" class="input-field" placeholder="EMAIL ADDRESS"><select id="iR" class="input-field"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance Specialist</option></select><select id="iL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name.toUpperCase()}</option>`).join('')}</select><button onclick="window.execInvite()" class="btn-black w-full py-4 uppercase text-[10px] tracking-widest mt-2 shadow-xl shadow-black/10">SEND ACCESS INVITATION</button></div>`;
    document.getElementById('modal').style.display = 'flex';
};
window.execInvite=async()=>{ try { await supabase.from('staff_invites').insert({ email: document.getElementById('iE').value, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' }); document.getElementById('modal').style.display = 'none'; await router('staff'); } catch(e){alert(e.message);} };

async function renderSettings(c){
    const locs = await getLocations(profile.organization_id);
    const rows = locs.map(l => `<tr class="border-b"><td class="p-4 font-bold text-sm uppercase">${l.name}</td><td class="p-4 uppercase text-[10px] font-bold text-gray-400 tracking-widest">${l.type}</td><td class="p-3 text-right"><button class="text-gray-300 font-bold text-[10px] uppercase">Locked</button></td></tr>`).join('');
    c.innerHTML = `<div class="flex justify-between mb-8"><h1 class="text-xl font-bold uppercase tracking-widest text-gray-400">Enterprise Infrastructure</h1><button onclick="window.addStoreModal()" class="btn-black px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">+ Register Location</button></div><div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`;
}
window.addStoreModal=()=>{ document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-6 uppercase tracking-tight text-gray-900">Add Hub</h3><div class="modal-body"><input id="nN" class="input-field" placeholder="HUB NAME"><select id="nT" class="input-field"><option value="main_store">Main Store Hub</option><option value="camp_store">Camp / Remote Store</option></select><button onclick="window.execAddStore()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase">Authorize Registry</button></div>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddStore=async()=>{ try{ await createLocation(profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').style.display = 'none'; await router('settings'); }catch(e){alert(e.message);} };
