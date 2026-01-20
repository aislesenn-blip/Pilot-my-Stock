import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

// Billion Dollar Feature: Funga modal ukibonyeza pembeni
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

        document.getElementById('userName').innerText = profile.full_name || 'System User';
        document.getElementById('userRole').innerText = profile.role.toUpperCase();
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        // Apply Permissions
        applyPermissions(profile.role);

        // Sidebar Toggles
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => document.getElementById('sidebar').classList.remove('-translate-x-full'));
        document.getElementById('close-sidebar')?.addEventListener('click', () => document.getElementById('sidebar').classList.add('-translate-x-full'));

        router('inventory');
    } catch (e) { logout(); }
};

function applyPermissions(role) {
    const menus = {
        inv: document.getElementById('nav-inventory'),
        bar: document.getElementById('nav-bar'),
        appr: document.getElementById('nav-approvals'),
        staff: document.getElementById('nav-staff'),
        sett: document.getElementById('nav-settings')
    };
    if (role === 'manager') return;
    if (role === 'finance') { menus.bar.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden'); }
    else if (role === 'barman') { menus.appr.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden'); }
    else if (role === 'storekeeper') { menus.bar.classList.add('hidden'); menus.appr.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden'); }
}

window.router = async (view) => {
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center flex-col gap-2"><div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div></div>';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active', 'bg-gray-100', 'text-black'));
    document.getElementById(`nav-${view}`)?.classList.add('nav-active', 'bg-gray-100', 'text-black');

    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// --- INVENTORY VIEW (FIXED UX) ---
async function renderInventory(c) {
    try {
        const data = await getInventory(profile.organization_id);
        const rows = data.map(i => `
            <tr class="border-b border-gray-50 hover:bg-gray-50/50 transition">
                <td class="py-4 px-2 font-bold text-sm text-gray-900 uppercase">${i.products?.name}</td>
                <td class="py-4 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">${i.locations?.name}</td>
                <td class="py-4 px-2 font-mono font-bold text-gray-900">${i.quantity}</td>
                <td class="py-4 px-2 text-right">
                    ${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-black text-white px-3 py-2 rounded-xl uppercase tracking-tighter">Issue</button>` : ''}
                </td>
            </tr>`).join('');

        c.innerHTML = `
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <h1 class="text-2xl font-bold tracking-tight">Master Inventory</h1>
                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Real-time Enterprise Stock</p>
                </div>
                <div class="flex gap-2 w-full md:w-auto">
                    ${profile.role === 'manager' ? `<button onclick="window.addProductModal()" class="flex-1 md:flex-none border border-black px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-50 transition">Register Product</button>` : ''}
                    <button onclick="window.addStockModal()" class="flex-1 md:flex-none bg-black text-white px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition">Receive Stock</button>
                </div>
            </div>
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold border-b border-gray-100">
                        <tr><th class="p-4">SKU / Item Name</th><th class="p-4">Location</th><th class="p-4">Balance</th><th class="p-4 text-right">Action</th></tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50">${rows.length ? rows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-400 font-bold uppercase tracking-widest">No stock found.</td></tr>'}</tbody>
                </table>
            </div>`;
    } catch(e) {}
}

// --- RECEIVE STOCK MODAL (FIXED UX) ---
window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id);
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id);

    document.getElementById('modal-content').innerHTML = `
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg uppercase tracking-tight">Receive Stock</h3>
            <button onclick="document.getElementById('modal').classList.add('hidden')" class="text-gray-400 hover:text-red-500">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
        <div class="space-y-4">
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Select Product</label>
                <select id="sP" class="input-field mt-1">${prods.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select>
            </div>
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Store Location</label>
                <select id="sL" class="input-field mt-1">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select>
            </div>
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Quantity</label>
                <input id="sQ" type="number" class="input-field mt-1" placeholder="Enter Amount Received">
            </div>
            <button onclick="window.execAddStock()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase tracking-widest mt-2 shadow-lg shadow-black/5">Update Master Balance</button>
        </div>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execAddStock = async () => {
    const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value;
    if(!qty || qty <= 0) return alert("Please enter a valid quantity.");

    try {
        const { data: exist } = await supabase.from('inventory').select('*').eq('product_id', pid).eq('location_id', lid).maybeSingle();
        if(exist) await supabase.from('inventory').update({ quantity: parseFloat(exist.quantity) + parseFloat(qty) }).eq('id', exist.id);
        else await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id });
        
        await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty });
        
        document.getElementById('modal').classList.add('hidden');
        router('inventory');
    } catch(e) { alert(e.message); }
}

// Register Product Modal (Fixed UX)
window.addProductModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg uppercase tracking-tight">Register Product</h3>
            <button onclick="document.getElementById('modal').classList.add('hidden')" class="text-gray-400 hover:text-red-500">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
        <div class="space-y-4">
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Item Name</label>
                <input id="pN" class="input-field mt-1" placeholder="e.g. Safari Lager 500ml">
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Unit Cost</label>
                    <input id="pC" type="number" class="input-field mt-1" placeholder="0.00">
                </div>
                <div>
                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sell Price</label>
                    <input id="pS" type="number" class="input-field mt-1" placeholder="0.00">
                </div>
            </div>
            <button onclick="window.execAddProduct()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase tracking-widest mt-2 shadow-lg shadow-black/5">Add to Item Master</button>
        </div>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execAddProduct = async () => {
    const name = document.getElementById('pN').value, cost = document.getElementById('pC').value, sell = document.getElementById('pS').value;
    if(!name || !cost || !sell) return alert("Fill all fields.");
    try {
        await supabase.from('products').insert({ name, cost_price: cost, selling_price: sell, organization_id: profile.organization_id });
        document.getElementById('modal').classList.add('hidden');
        router('inventory');
    } catch(e) { alert(e.message); }
}

// Zingine (Bar, Approvals, Team, Settings) zinabaki na UX hii hii ya Billion Dollar
async function renderBar(c) {
    try {
        const inv = await getInventory(profile.organization_id);
        const barStock = inv.filter(x => x.location_id === profile.assigned_location_id);
        const items = barStock.map(x => `<div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border border-gray-100 p-5 rounded-2xl cursor-pointer hover:border-black transition active:scale-95 shadow-sm"><h4 class="font-bold text-sm text-gray-900 uppercase">${x.products.name}</h4><div class="flex justify-between items-center mt-4"><span class="text-xs font-bold text-gray-900 font-mono">$${x.products.selling_price}</span><span class="text-[9px] font-bold text-gray-300 uppercase tracking-widest">Qty: ${x.quantity}</span></div></div>`).join('');
        c.innerHTML = `<div class="flex flex-col lg:flex-row h-full gap-8"><div class="flex-1"><h1>Bar Sales Module</h1><div class="grid grid-cols-2 md:grid-cols-3 gap-4">${items.length?items:'No Stock assigned.'}</div></div><div class="w-full lg:w-96 bg-white border p-6 rounded-3xl shadow-xl flex flex-col h-fit sticky top-0"><h3 class="font-bold mb-6 uppercase">Ticket</h3><div id="cart-list" class="flex-1 space-y-4 mb-6"></div><div class="pt-6 border-t"><div class="flex justify-between font-bold text-xl mb-6"><span>Total</span><span id="cart-total">$0.00</span></div><button onclick="window.checkout()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase tracking-widest">COMPLETE SALE</button></div></div></div>`;
        window.renderCart();
    } catch(e) {}
}

window.addCart=(n,p,id)=>{const x=cart.find(c=>c.id===id); if(x)x.qty++; else cart.push({name:n,price:p,id,qty:1}); window.renderCart();}
window.renderCart=()=>{
    const l=document.getElementById('cart-list'), t=document.getElementById('cart-total');
    if(!cart.length){l.innerHTML='<p class="text-center py-10 text-gray-300 text-[10px] font-bold uppercase">Empty Ticket</p>'; t.innerText='$0.00'; return;}
    let sum=0; l.innerHTML=cart.map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between items-center text-xs font-bold uppercase"><span>${i.name} (${i.qty})</span><button onclick="window.remCart('${i.id}')" class="text-red-500 font-bold">×</button></div>`}).join(''); t.innerText='$'+sum.toFixed(2);
}
window.remCart=(id)=>{cart=cart.filter(c=>c.id!==id); window.renderCart();}
window.checkout=async()=>{if(!cart.length) return; try{await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); alert('Sale successfully finalized.'); cart=[]; window.renderCart(); router('bar');}catch(e){}}

window.issueModal=(name,id,from)=>{
    document.getElementById('modal-content').innerHTML=`
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg uppercase tracking-tight">Issue Item</h3>
            <button onclick="document.getElementById('modal').classList.add('hidden')" class="text-gray-400 hover:text-red-500">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
        <div class="space-y-4">
            <input value="${name}" disabled class="input-field bg-gray-50 font-bold uppercase">
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Destination Store</label>
                <select id="tTo" class="input-field mt-1"></select>
            </div>
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Quantity</label>
                <input id="tQty" type="number" class="input-field mt-1" placeholder="0.00">
            </div>
            <button onclick="window.execIssue('${id}','${from}')" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase tracking-widest">Confirm Movement</button>
        </div>`;
    getLocations(profile.organization_id).then(locs => { document.getElementById('tTo').innerHTML = locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join(''); });
    document.getElementById('modal').classList.remove('hidden');
}

window.execIssue=async(id,from)=>{
    try { await transferStock(id, from, document.getElementById('tTo').value, document.getElementById('tQty').value, profile.id, profile.organization_id); document.getElementById('modal').classList.add('hidden'); router('inventory'); } catch(e){alert(e.message);}
}

// Baadhi ya Shared Functions (Settings, Staff, Approvals) hufanya kazi na UX hii hii
async function renderSettings(c){
    const locs = await getLocations(profile.organization_id);
    const rows = locs.map(l => `<tr class="border-b"><td class="p-4 font-bold text-sm">${l.name}</td><td class="p-4 uppercase text-[10px] font-bold text-gray-400 tracking-widest">${l.type}</td><td class="p-4 text-right"><button onclick="window.editStoreModal('${l.id}','${l.name}','${l.type}')" class="text-blue-500 font-bold text-[10px] uppercase">Edit</button></td></tr>`).join('');
    c.innerHTML = `<div class="flex justify-between mb-8"><h1 class="text-xl font-bold uppercase">Configuration</h1><button onclick="window.addStoreModal()" class="btn-black px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase">+ New Store</button></div><div class="bg-white rounded-2xl border shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`;
}

window.addStoreModal=()=>{
    document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-6 uppercase">Register Store</h3><input id="nN" class="input-field mb-3" placeholder="Store Name"><select id="nT" class="input-field mb-6"><option value="main_store">Main Store</option><option value="camp_store">Camp Store</option></select><button onclick="window.execAddStore()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase">Authorize Store</button>`;
    document.getElementById('modal').classList.remove('hidden');
}
window.execAddStore=async()=>{ try{ await createLocation(profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').classList.add('hidden'); router('settings'); }catch(e){alert(e.message);} }

async function renderStaff(c){
    try {
        const staff = await getStaff(profile.organization_id);
        const rows = staff.map(s=>`<tr class="border-b border-gray-50"><td class="p-4 text-sm font-bold text-gray-900">${s.full_name}</td><td class="p-4 text-xs text-gray-400 uppercase font-bold">${s.role}</td></tr>`).join('');
        c.innerHTML = `<div class="flex justify-between mb-8"><h1 class="text-xl font-bold uppercase tracking-widest text-gray-400">Team Access</h1><button onclick="window.inviteModal()" class="bg-black text-white px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">GRANT ACCESS</button></div><div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`;
    } catch(e){}
}
window.inviteModal=async()=>{
    const locs = await getLocations(profile.organization_id);
    document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-6 uppercase">Portal Access</h3><input id="iE" class="input-field mb-3" placeholder="Email Address"><select id="iR" class="input-field mb-3"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance Specialist</option></select><select id="iL" class="input-field mb-6">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select><button onclick="window.execInvite()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase">SEND INVITATION</button>`;
    document.getElementById('modal').classList.remove('hidden');
}
window.execInvite=async()=>{ try { await supabase.from('staff_invites').insert({ email: document.getElementById('iE').value, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' }); alert('Dispatched.'); document.getElementById('modal').classList.add('hidden'); router('staff'); } catch(e){alert(e.message);} }

async function renderApprovals(c){
    try {
        const q = await getPendingApprovals(profile.organization_id);
        const r = q.map(x => `<tr class="border-b border-gray-50"><td class="p-4 font-bold text-sm text-gray-900 uppercase">${x.products?.name}</td><td class="p-4 text-xs font-mono font-bold text-blue-600">${x.quantity}</td><td class="p-4 text-right"><button onclick="window.approve('${x.id}','approved')" class="bg-black text-white px-4 py-2 rounded-lg text-[10px] font-bold uppercase">Authorize</button></td></tr>`).join('');
        c.innerHTML = `<h1 class="text-xl font-bold mb-8 uppercase text-gray-400">Control Queue</h1><div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm"><table class="w-full text-left"><tbody>${r.length?r:'<tr><td class="p-12 text-center text-xs text-gray-400 font-bold uppercase tracking-widest">Clean</td></tr>'}</tbody></table></div>`;
    } catch(e){}
}
window.approve=async(id,s)=>{ if(confirm('Approve?')) try { await respondToApproval(id,s,profile.id); router('approvals'); } catch(e){alert(e.message);} }
