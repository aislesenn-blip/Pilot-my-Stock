import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

// UX: Funga modal ukibonyeza pembeni (Billion Dollar UX)
window.closeModalOutside = (e) => { if (e.target.id === 'modal') document.getElementById('modal').classList.add('hidden'); };

window.onload = async () => {
    const app = document.getElementById('app-view');
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = prof;

        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }

        // Sidebar Populating
        document.getElementById('userName').innerText = profile.full_name || 'System User';
        document.getElementById('userRole').innerText = profile.role.toUpperCase();
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        // Requirement 3: Role Security
        applyRoleSecurity(profile.role);

        // UI Toggles
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => document.getElementById('sidebar').classList.remove('-translate-x-full'));
        document.getElementById('close-sidebar')?.addEventListener('click', () => document.getElementById('sidebar').classList.add('-translate-x-full'));

        // Requirement 1, 2, 4: Routing
        if (profile.role === 'finance') router('approvals');
        else if (profile.role === 'barman') router('bar');
        else router('inventory');

    } catch (e) { logout(); }
};

function applyRoleSecurity(role) {
    const menus = { inv: document.getElementById('nav-inventory'), bar: document.getElementById('nav-bar'), appr: document.getElementById('nav-approvals'), staff: document.getElementById('nav-staff'), sett: document.getElementById('nav-settings') };
    if (role === 'manager') return;
    if (role === 'finance') { menus.bar.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden'); }
    else if (role === 'barman') { menus.appr.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden'); }
    else if (role === 'storekeeper') { menus.bar.classList.add('hidden'); menus.appr.classList.add('hidden'); menus.staff.classList.add('hidden'); menus.sett.classList.add('hidden'); }
}

window.router = async (view) => {
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div></div>';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active', 'bg-gray-100', 'text-black'));
    document.getElementById(`nav-${view}`)?.classList.add('nav-active', 'bg-gray-100', 'text-black');

    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app); // Hapa kuna Point 5 & 6
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// --- REQUIREMENT 1 & 2: MASTER INVENTORY ---
async function renderInventory(c) {
    try {
        const data = await getInventory(profile.organization_id);
        const filtered = (profile.role === 'manager' || profile.role === 'finance') ? data : data.filter(x => x.location_id === profile.assigned_location_id);
        
        const rows = filtered.map(i => `
            <tr class="border-b border-gray-50 hover:bg-gray-50 transition">
                <td class="p-4 px-2 font-bold text-sm text-gray-900 uppercase">${i.products?.name}</td>
                <td class="p-4 px-2 text-[10px] font-bold text-gray-400 uppercase">${i.locations?.name}</td>
                <td class="p-4 px-2 font-mono font-bold text-gray-900">${i.quantity}</td>
                <td class="p-4 px-2 text-right">
                    ${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-black text-white px-3 py-2 rounded-xl">Issue</button>` : ''}
                </td>
            </tr>`).join('');

        c.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <h1 class="text-2xl font-bold tracking-tight uppercase">Inventory Control</h1>
                <div class="flex gap-2">
                    ${profile.role === 'manager' ? `<button onclick="window.addProductModal()" class="border border-black px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Register Product</button>` : ''}
                    <button onclick="window.addStockModal()" class="bg-black text-white px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase">Receive Stock</button>
                </div>
            </div>
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold border-b">
                        <tr><th class="p-4">SKU / Item</th><th class="p-4">Location</th><th class="p-4">Balance</th><th class="p-4 text-right">Action</th></tr>
                    </thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-400 font-bold uppercase">No records found.</td></tr>'}</tbody>
                </table>
            </div>`;
    } catch(e) {}
}

// --- REQUIREMENT 4: BAR STOCK & PROFIT ---
async function renderBar(c) {
    const inv = await getInventory(profile.organization_id);
    const barItems = inv.filter(x => x.location_id === profile.assigned_location_id);
    const items = barItems.map(x => `
        <div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border border-gray-100 p-5 rounded-2xl cursor-pointer hover:border-black transition active:scale-95 shadow-sm">
            <h4 class="font-bold text-sm text-gray-900 uppercase">${x.products.name}</h4>
            <div class="flex justify-between items-center mt-4">
                <span class="text-xs font-bold text-gray-900 font-mono">$${x.products.selling_price}</span>
                <span class="text-[9px] font-bold text-gray-300 uppercase">Stock: ${x.quantity}</span>
            </div>
        </div>`).join('');
    c.innerHTML = `
        <div class="flex flex-col lg:flex-row gap-8 h-full">
            <div class="flex-1 overflow-y-auto pr-2">
                <h1 class="text-xl font-bold mb-8 uppercase tracking-widest text-gray-400">Bar POS Module</h1>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-4">${items.length ? items : 'No stock assigned to your bar.'}</div>
            </div>
            <div class="w-full lg:w-96 bg-white border p-6 rounded-3xl shadow-xl flex flex-col h-fit sticky top-0">
                <h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Active Bill</h3>
                <div id="cart-list" class="flex-1 space-y-4 mb-6"></div>
                <div class="pt-6 border-t">
                    <div class="flex justify-between font-bold text-xl mb-6 text-gray-900"><span>Grand Total</span><span id="cart-total">$0.00</span></div>
                    <button onclick="window.checkout()" class="w-full bg-black text-white py-4 rounded-2xl font-bold text-[10px] uppercase tracking-widest shadow-lg">Authorize Sale</button>
                </div>
            </div>
        </div>`;
    window.renderCart();
}

// --- REQUIREMENT 5: FINANCE & AUDIT TRAIL ---
async function renderApprovals(c) {
    try {
        const q = await getPendingApprovals(profile.organization_id);
        const { data: logs } = await supabase.from('transactions').select('*, products(name), profiles(full_name)').eq('organization_id', profile.organization_id).order('created_at', { ascending: false }).limit(10);
        
        const rRows = q.map(x => `<tr class="border-b border-gray-50"><td class="p-4 font-bold text-sm uppercase">${x.products?.name}</td><td class="p-4 text-xs font-bold text-blue-600">${x.quantity}</td><td class="p-4 text-right"><button onclick="window.approve('${x.id}','approved')" class="bg-black text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase">Authorize</button></td></tr>`).join('');
        const aRows = logs.map(l => `<tr class="border-b border-gray-50 text-[11px]"><td class="p-4 font-bold">${new Date(l.created_at).toLocaleDateString()}</td><td class="p-4">${l.products?.name}</td><td class="p-4 uppercase">${l.type}</td><td class="p-4 font-bold">${l.quantity}</td></tr>`).join('');

        c.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div>
                    <h1 class="text-xl font-bold mb-6 uppercase tracking-widest text-gray-400">Approval Queue (Point 3)</h1>
                    <div class="bg-white rounded-2xl border shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${rRows.length?rRows:'<tr><td class="p-12 text-center text-xs text-gray-300">Queue Clean</td></tr>'}</tbody></table></div>
                </div>
                <div>
                    <h1 class="text-xl font-bold mb-6 uppercase tracking-widest text-gray-400">Audit Trail (Point 5)</h1>
                    <div class="bg-white rounded-2xl border shadow-sm overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[9px] font-bold uppercase text-gray-400 border-b"><tr><th class="p-4">Date</th><th class="p-4">Item</th><th class="p-4">Action</th><th class="p-4">Qty</th></tr></thead><tbody>${aRows}</tbody></table></div>
                </div>
            </div>`;
    } catch(e) {}
}

// --- SHARED ACTIONS (Product, Stock, Issues) ---
window.addProductModal = () => {
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase">Register Product</h3><input id="pN" class="input-field mb-3" placeholder="Product Name"><div class="grid grid-cols-2 gap-4 mb-6"><input id="pC" type="number" class="input-field" placeholder="Cost"><input id="pS" type="number" class="input-field" placeholder="Sell"></div><button onclick="window.execAddProduct()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase">Authorize Registration</button>`;
    document.getElementById('modal').classList.remove('hidden');
};
window.execAddProduct = async () => { try { await supabase.from('products').insert({ name: document.getElementById('pN').value, cost_price: document.getElementById('pC').value, selling_price: document.getElementById('pS').value, organization_id: profile.organization_id }); document.getElementById('modal').classList.add('hidden'); router('inventory'); } catch(e){alert(e.message);} };

window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id);
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id);
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase">Stock Entry</h3><select id="sP" class="input-field mb-3">${prods.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select><select id="sL" class="input-field mb-3">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select><input id="sQ" type="number" class="input-field mb-6" placeholder="Quantity"><button onclick="window.execAddStock()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase tracking-widest">Update Master Balance</button>`;
    document.getElementById('modal').classList.remove('hidden');
};
window.execAddStock = async () => {
    const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value;
    try {
        const { data: exist } = await supabase.from('inventory').select('*').eq('product_id', pid).eq('location_id', lid).maybeSingle();
        if(exist) await supabase.from('inventory').update({ quantity: parseFloat(exist.quantity) + parseFloat(qty) }).eq('id', exist.id);
        else await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id });
        await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty });
        document.getElementById('modal').classList.add('hidden'); router('inventory');
    } catch(e){alert(e.message);}
};

window.issueModal = (name,id,from) => {
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase">Issue Stock</h3><input value="${name}" disabled class="input-field mb-4 font-bold uppercase bg-gray-50"><select id="tTo" class="input-field mb-4"></select><input id="tQty" type="number" class="input-field mb-6" placeholder="0.00"><button onclick="window.execIssue('${id}','${from}')" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase">Authorize Issue</button>`;
    getLocations(profile.organization_id).then(locs => { document.getElementById('tTo').innerHTML = locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join(''); });
    document.getElementById('modal').classList.remove('hidden');
};
window.execIssue = async(id,from) => { try { await transferStock(id, from, document.getElementById('tTo').value, document.getElementById('tQty').value, profile.id, profile.organization_id); document.getElementById('modal').classList.add('hidden'); router('inventory'); } catch(e){alert(e.message);} };

// Standard POS Utils
window.addCart=(n,p,id)=>{ const x=cart.find(c=>c.id===id); if(x)x.qty++; else cart.push({name:n,price:p,id,qty:1}); window.renderCart(); };
window.renderCart=()=>{ const l=document.getElementById('cart-list'), t=document.getElementById('cart-total'); if(!cart.length){l.innerHTML='<p class="text-center py-10 text-gray-300 text-[10px] font-bold uppercase">Empty</p>'; t.innerText='$0.00'; return;} let sum=0; l.innerHTML=cart.map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between items-center text-xs font-bold uppercase"><span>${i.name} (x${i.qty})</span><button onclick="window.remCart('${i.id}')" class="text-red-500">×</button></div>`}).join(''); t.innerText='$'+sum.toFixed(2); };
window.remCart=(id)=>{cart=cart.filter(c=>c.id!==id); window.renderCart();};
window.checkout=async()=>{if(!cart.length) return; try{await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); alert('Success'); cart=[]; window.renderCart(); router('bar');} catch(e){alert(e.message);}};

// Team & Settings (Same UX)
async function renderStaff(c){ try { const staff = await getStaff(profile.organization_id); const rows = staff.map(s=>`<tr class="border-b"><td class="p-4 text-sm font-bold text-gray-900">${s.full_name}</td><td class="p-4 text-xs text-gray-400 uppercase font-bold">${s.role}</td></tr>`).join(''); c.innerHTML = `<div class="flex justify-between mb-8"><h1 class="text-xl font-bold uppercase text-gray-400">Team Control</h1><button onclick="window.inviteModal()" class="btn-black px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">Add User</button></div><div class="bg-white rounded-2xl border shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`; } catch(e){} }
window.inviteModal=async()=>{ const locs=await getLocations(profile.organization_id); document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-6 uppercase">Grant Portal Access</h3><input id="iE" class="input-field mb-3" placeholder="Email"><select id="iR" class="input-field mb-3"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance</option></select><select id="iL" class="input-field mb-6">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select><button onclick="window.execInvite()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase">Send Portal Invitation</button>`; document.getElementById('modal').classList.remove('hidden'); };
window.execInvite=async()=>{ try { await supabase.from('staff_invites').insert({ email: document.getElementById('iE').value, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' }); document.getElementById('modal').classList.add('hidden'); router('staff'); } catch(e){alert(e.message);} };

async function renderSettings(c){ const locs=await getLocations(profile.organization_id); const rows=locs.map(l=>`<tr class="border-b"><td class="p-4 font-bold text-sm text-gray-900 uppercase">${l.name}</td><td class="p-4 uppercase text-[10px] font-bold text-gray-400">${l.type}</td><td class="p-4 text-right"><button onclick="window.editStoreModal('${l.id}','${l.name}','${l.type}')" class="text-blue-500 font-bold text-[10px] uppercase">Edit</button></td></tr>`).join(''); c.innerHTML=`<div class="flex justify-between mb-8"><h1 class="text-xl font-bold uppercase text-gray-400">Enterprise Infrastructure</h1><button onclick="window.addStoreModal()" class="btn-black px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest">+ New Store</button></div><div class="bg-white rounded-2xl border shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`; }
window.addStoreModal=()=>{ document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-6 uppercase">Add Store</h3><input id="nN" class="input-field mb-3" placeholder="Name"><select id="nT" class="input-field mb-6"><option value="main_store">Main Store</option><option value="camp_store">Camp Store</option></select><button onclick="window.execAddStore()" class="btn-black w-full py-4 rounded-2xl font-bold text-[10px] uppercase">Authorize</button>`; document.getElementById('modal').classList.remove('hidden'); };
window.execAddStore=async()=>{ try{ await createLocation(profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').classList.add('hidden'); router('settings'); }catch(e){alert(e.message);} };

window.approve=async(id,s)=>{ if(confirm('Approve?')) try { await respondToApproval(id,s,profile.id); router('approvals'); } catch(e){} };
