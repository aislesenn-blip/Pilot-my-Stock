import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

// UX: Global Closing Mechanism
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
        
        document.getElementById('userName').innerText = profile.full_name || 'Administrator';
        document.getElementById('userRole').innerText = profile.role.toUpperCase();
        document.getElementById('avatar').innerText = (profile.full_name || 'A').charAt(0);
        window.logoutAction = logout;

        // FIXED: HAMBURGER MENU EVENT LISTENERS
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
    app.innerHTML = '<div class="flex h-full items-center justify-center flex-col gap-2"><div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div></div>';
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    document.getElementById(`nav-${view}`)?.classList.add('nav-active');
    
    // Close sidebar on mobile navigation
    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// --- DATA MANAGEMENT: INVENTORY & CATALOG ---
async function renderInventory(c) {
    try {
        // Fetch Catalog & Stock separately for verification
        const { data: masterCatalog } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
        const stockData = await getInventory(profile.organization_id);
        
        const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? stockData : stockData.filter(x => x.location_id === profile.assigned_location_id);
        
        const stockRows = filteredStock.map(i => `
            <tr class="border-b border-gray-50 hover:bg-gray-50 transition">
                <td class="p-4 px-2 font-bold text-sm text-gray-900 uppercase">${i.products?.name}</td>
                <td class="p-4 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">${i.locations?.name}</td>
                <td class="p-4 px-2 font-mono font-bold text-gray-900">${i.quantity}</td>
                <td class="p-4 px-2 text-right">
                    ${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-black text-white px-3 py-2 rounded-xl uppercase tracking-tighter">Move Stock</button>` : ''}
                </td>
            </tr>`).join('');

        const catalogRows = masterCatalog.map(p => `
            <tr class="border-b border-gray-50 text-[11px]">
                <td class="p-4 uppercase font-semibold text-gray-700">${p.name}</td>
                <td class="p-4 text-gray-400">$${p.cost_price} / $${p.selling_price}</td>
                <td class="p-4 text-right"><span class="bg-green-50 text-green-700 px-2 py-1 rounded-full text-[9px] font-bold uppercase">Ready</span></td>
            </tr>`).join('');

        c.innerHTML = `
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
                <h1 class="text-2xl font-bold uppercase tracking-tight">Stock Control Hub</h1>
                <div class="flex gap-2 w-full md:w-auto">
                    ${profile.role === 'manager' ? `<button onclick="window.addProductModal()" class="flex-1 md:flex-none border border-black px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Register Product</button>` : ''}
                    <button onclick="window.addStockModal()" class="flex-1 md:flex-none bg-black text-white px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Perform Inbound Entry</button>
                </div>
            </div>

            <div class="mb-12">
                <h3 class="text-[10px] font-bold text-gray-400 uppercase mb-4 tracking-widest">1. Current Storage Balances</h3>
                <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                    <table class="w-full text-left border-collapse">
                        <thead class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b">
                            <tr><th class="p-4">SKU / Description</th><th class="p-4">Hub Location</th><th class="p-4">Quantity</th><th class="p-4 text-right">Action</th></tr>
                        </thead>
                        <tbody>${stockRows.length ? stockRows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-300 font-bold uppercase tracking-widest">Physical stock record is empty.</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
            
            <div>
                <h3 class="text-[10px] font-bold text-gray-400 uppercase mb-4 tracking-widest">2. Master Product Catalog</h3>
                <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                    <table class="w-full text-left border-collapse">
                        <thead class="bg-gray-50/50 text-[9px] uppercase font-bold text-gray-400 border-b">
                            <tr><th class="p-4">Registered Item</th><th class="p-4">Standardized Pricing</th><th class="p-4 text-right">System Status</th></tr>
                        </thead>
                        <tbody>${catalogRows.length ? catalogRows : '<tr><td colspan="3" class="p-10 text-center text-xs text-gray-300 font-bold uppercase tracking-widest">No products registered in the master list.</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`;
    } catch(e) {}
}

// --- DROPDOWN FIX: LAYERED PRIORITY ---
window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');

    if(!prods || prods.length === 0) return alert("Catalog empty: Please register products first.");

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase tracking-tight">Perform Inbound Stock Entry</h3>
        <div class="modal-body">
            <div class="input-wrapper" style="z-index: 500;">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">1. Select Catalog Product</label>
                <select id="sP" class="input-field">${prods.map(p=>`<option value="${p.id}">${p.name.toUpperCase()}</option>`).join('')}</select>
            </div>
            <div class="input-wrapper" style="z-index: 400;">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">2. Destination Storage Hub</label>
                <select id="sL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name.toUpperCase()}</option>`).join('')}</select>
            </div>
            <div class="input-wrapper" style="z-index: 100;">
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">3. Transaction Quantity</label>
                <input id="sQ" type="number" class="input-field" placeholder="0.00">
            </div>
            <button id="btnSaveStock" onclick="window.execAddStock()" class="btn-black w-full py-4 uppercase text-[11px] tracking-widest mt-2 shadow-xl shadow-black/5">Authorize Transaction</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
}

window.execAddStock = async () => {
    const btn = document.getElementById('btnSaveStock');
    const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value;
    if(!qty || qty <= 0) return alert("Validation failed: Invalid Quantity.");

    btn.innerText = "AUTHORIZING..."; btn.disabled = true;
    try {
        const { data: exist } = await supabase.from('inventory').select('*').eq('product_id', pid).eq('location_id', lid).maybeSingle();
        if(exist) await supabase.from('inventory').update({ quantity: parseFloat(exist.quantity) + parseFloat(qty) }).eq('id', exist.id);
        else await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id });
        
        await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty });
        
        document.getElementById('modal').style.display = 'none';
        await router('inventory'); 
    } catch(e) { alert(e.message); btn.innerText = "Authorize Transaction"; btn.disabled = false; }
}

// Product Registration (Requirement 1)
window.addProductModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase tracking-tight">Register New Catalog Item</h3>
        <div class="modal-body">
            <input id="pN" class="input-field uppercase" placeholder="PRODUCT DESCRIPTION">
            <div class="grid grid-cols-2 gap-4">
                <input id="pC" type="number" class="input-field" placeholder="UNIT COST">
                <input id="pS" type="number" class="input-field" placeholder="RETAIL PRICE">
            </div>
            <button id="btnSaveProd" onclick="window.execAddProduct()" class="btn-black w-full py-4 uppercase text-[11px] tracking-widest mt-2 shadow-xl shadow-black/5">Finalize Master Registry</button>
        </div>`;
    document.getElementById('modal').style.display = 'flex';
}

window.execAddProduct = async () => {
    const btn = document.getElementById('btnSaveProd');
    const name = document.getElementById('pN').value, cost = document.getElementById('pC').value, sell = document.getElementById('pS').value;
    if(!name || !cost || !sell) return alert("Validation failed: All fields required.");
    
    btn.innerText = "REGISTERING..."; btn.disabled = true;
    try {
        await supabase.from('products').insert({ name, cost_price: cost, selling_price: sell, organization_id: profile.organization_id });
        document.getElementById('modal').style.display = 'none';
        await router('inventory');
    } catch(e) { alert(e.message); btn.innerText = "Finalize Master Registry"; btn.disabled = false; }
}

// Rest of modules (POS, Approvals, Staff) using same Professional UI logic
async function renderBar(c) {
    const inv = await getInventory(profile.organization_id);
    const barItems = inv.filter(x => x.location_id === profile.assigned_location_id);
    const items = barItems.map(x => `<div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border p-5 rounded-2xl cursor-pointer hover:border-black transition active:scale-95 shadow-sm"><h4 class="font-bold text-sm text-gray-900 uppercase tracking-tight">${x.products.name}</h4><div class="flex justify-between items-center mt-4"><span class="text-xs font-bold text-gray-900 font-mono tracking-tighter">$${x.products.selling_price}</span><span class="text-[9px] font-bold text-gray-300 uppercase tracking-widest">Qty: ${x.quantity}</span></div></div>`).join('');
    c.innerHTML = `<div class="flex flex-col lg:flex-row h-full gap-8"><div class="flex-1 overflow-y-auto pr-2"><h1 class="text-xl font-bold mb-8 uppercase tracking-widest text-gray-400">Sales Entry Portal</h1><div class="grid grid-cols-2 md:grid-cols-3 gap-4">${items.length?items:'Stock not assigned to this storage outlet.'}</div></div><div class="w-full lg:w-96 bg-white border border-gray-100 p-6 rounded-3xl shadow-xl flex flex-col h-fit sticky top-0"><h3 class="font-bold text-lg mb-6 uppercase tracking-tight text-gray-900">Current Ticket</h3><div id="cart-list" class="flex-1 space-y-4 mb-6"></div><div class="pt-6 border-t"><div class="flex justify-between font-bold text-xl mb-6 text-gray-900 tracking-tighter"><span>Total Due</span><span id="cart-total">$0.00</span></div><button onclick="window.checkout()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase shadow-lg shadow-black/5 tracking-widest">Authorize Final Sale</button></div></div></div>`;
    window.renderCart();
}

window.addCart=(n,p,id)=>{const x=cart.find(c=>c.id===id); if(x)x.qty++; else cart.push({name:n,price:p,id,qty:1}); window.renderCart();}
window.renderCart=()=>{
    const l=document.getElementById('cart-list'), t=document.getElementById('cart-total');
    if(!cart.length){l.innerHTML='<div class="text-center py-12 text-gray-300 text-[10px] font-bold uppercase tracking-widest">Ticket Empty</div>'; t.innerText='$0.00'; return;}
    let sum=0; l.innerHTML=cart.map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between items-center text-xs font-bold uppercase tracking-tighter"><span>${i.name} (x${i.qty})</span><button onclick="window.remCart('${i.id}')" class="text-red-500 font-bold">×</button></div>`}).join(''); t.innerText='$'+sum.toFixed(2);
}
window.remCart=(id)=>{cart=cart.filter(c=>c.id!==id); window.renderCart();}
window.checkout=async()=>{if(!cart.length) return; try{await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); alert('Success: Transaction authorized.'); cart=[]; window.renderCart(); await router('bar');}catch(e){}}

window.issueModal=(name,id,from)=>{
    document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-8 uppercase tracking-tight">Authorize Stock Movement</h3><div class="modal-body"><input value="${name}" disabled class="input-field bg-gray-50 font-bold uppercase text-gray-400"><div style="z-index: 500; position: relative;"><label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">Target Hub</label><select id="tTo" class="input-field"></select></div><div style="z-index: 100; position: relative;"><label class="text-[10px] font-bold text-gray-400 uppercase mb-1 block tracking-widest">Movement Quantity</label><input id="tQty" type="number" class="input-field" placeholder="0.00"></div><button onclick="window.execIssue('${id}','${from}')" class="btn-black w-full py-4 uppercase text-[10px] tracking-widest shadow-xl">Confirm Transfer</button></div>`;
    getLocations(profile.organization_id).then(locs => { document.getElementById('tTo').innerHTML = locs.map(l=>`<option value="${l.id}">${l.name.toUpperCase()}</option>`).join(''); });
    document.getElementById('modal').style.display = 'flex';
}
window.execIssue=async(id,from)=>{ try { await transferStock(id, from, document.getElementById('tTo').value, document.getElementById('tQty').value, profile.id, profile.organization_id); document.getElementById('modal').style.display = 'none'; await router('inventory'); } catch(e){alert(e.message);} }

async function renderApprovals(c){
    try {
        const q = await getPendingApprovals(profile.organization_id);
        const r = q.map(x => `<tr class="border-b border-gray-50"><td class="p-4 font-bold text-sm text-gray-900 uppercase">${x.products?.name}</td><td class="p-4 font-bold text-blue-600">${x.quantity}</td><td class="p-4 text-right"><button onclick="window.approve('${x.id}','approved')" class="bg-black text-white px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest">Authorize</button></td></tr>`).join('');
        c.innerHTML = `<h1 class="text-xl font-bold mb-10 uppercase text-gray-400 tracking-widest">Security Authorization Queue</h1><div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm"><table class="w-full text-left"><tbody>${r.length?r:'<tr><td class="p-12 text-center text-xs text-gray-400 font-bold uppercase tracking-widest">Authorization queue clear.</td></tr>'}</tbody></table></div>`;
    } catch(e){}
}
window.approve=async(id,s)=>{ if(confirm('Final Authorization?')) try { await respondToApproval(id,s,profile.id); await router('approvals'); } catch(e){} }
