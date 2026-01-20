import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

window.onload = async () => {
    const app = document.getElementById('app-view');
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = prof;

        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }

        // Sidebar Data Populating
        document.getElementById('userName').innerText = profile.full_name || 'System User';
        document.getElementById('userRole').innerText = profile.role.toUpperCase();
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        // Requirement 3: Access Rights Control
        applyRoleAccess(profile.role);

        // Sidebar Toggles
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => document.getElementById('sidebar').classList.remove('-translate-x-full'));
        document.getElementById('close-sidebar')?.addEventListener('click', () => document.getElementById('sidebar').classList.add('-translate-x-full'));

        // Load Default View
        if (profile.role === 'finance') router('approvals');
        else if (profile.role === 'barman') router('bar');
        else router('inventory');

    } catch (e) { logout(); }
};

function applyRoleAccess(role) {
    const menus = {
        inv: document.getElementById('nav-inventory'),
        bar: document.getElementById('nav-bar'),
        appr: document.getElementById('nav-approvals'),
        staff: document.getElementById('nav-staff'),
        sett: document.getElementById('nav-settings')
    };
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
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('bg-gray-100', 'text-black'));
    document.getElementById(`nav-${view}`)?.classList.add('bg-gray-100', 'text-black');

    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// --- REQUIREMENT 1 & 2: INVENTORY & CAMP ISSUING ---
async function renderInventory(c) {
    try {
        const data = await getInventory(profile.organization_id);
        const locations = await getLocations(profile.organization_id);
        
        // Filter based on assigned store (Point 2)
        const filtered = (profile.role === 'manager' || profile.role === 'finance') ? data : data.filter(x => x.location_id === profile.assigned_location_id);
        
        const rows = filtered.map(i => `
            <tr class="border-b border-gray-50 hover:bg-gray-50 transition">
                <td class="p-4 px-2 font-bold text-sm text-gray-900">${i.products?.name}</td>
                <td class="p-4 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">${i.locations?.name}</td>
                <td class="p-4 px-2 font-mono font-bold text-gray-900">${i.quantity}</td>
                <td class="p-4 px-2 text-right">
                    ${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-black text-white px-3 py-1.5 rounded-lg uppercase tracking-tighter">Issue Stock</button>` : ''}
                </td>
            </tr>`).join('');

        c.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <h1 class="text-xl font-bold tracking-tight uppercase">Master Inventory</h1>
                <div class="flex gap-2">
                    ${profile.role === 'manager' ? `<button onclick="window.addProductModal()" class="bg-white border border-black text-black px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest">+ Register Product</button>` : ''}
                    <button onclick="window.addStockModal()" class="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest">+ Receive Stock</button>
                </div>
            </div>
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold border-b">
                        <tr><th class="p-4">SKU / Item</th><th class="p-4">Location</th><th class="p-4">Balance</th><th class="p-4 text-right">Action</th></tr>
                    </thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-400 uppercase font-bold tracking-widest">No stock found in system.</td></tr>'}</tbody>
                </table>
            </div>`;
    } catch(e) {}
}

// --- REQUIREMENT 4: BAR & BEVERAGE MANAGEMENT ---
async function renderBar(c) {
    try {
        const inv = await getInventory(profile.organization_id);
        const barStock = inv.filter(x => x.location_id === profile.assigned_location_id);
        
        const items = barStock.map(x => `
            <div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border border-gray-100 p-5 rounded-2xl cursor-pointer hover:border-black transition active:scale-95 shadow-sm">
                <h4 class="font-bold text-sm text-gray-900 uppercase tracking-tight">${x.products.name}</h4>
                <div class="flex justify-between items-center mt-4">
                    <span class="text-xs font-bold text-gray-900 font-mono tracking-tighter">$${x.products.selling_price}</span>
                    <span class="text-[9px] font-bold text-gray-300 uppercase tracking-widest">Qty: ${x.quantity}</span>
                </div>
            </div>`).join('');

        c.innerHTML = `
            <div class="flex flex-col lg:flex-row h-full gap-8">
                <div class="flex-1 overflow-y-auto">
                    <h1 class="text-xl font-bold mb-8 uppercase tracking-widest text-gray-400">Bar Sales Portal</h1>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4">${items.length ? items : '<p class="text-xs text-gray-400 font-bold uppercase tracking-widest">No stock assigned to this Bar.</p>'}</div>
                </div>
                <div class="w-full lg:w-96 bg-white border border-gray-200 p-6 rounded-3xl shadow-xl flex flex-col h-fit sticky top-0">
                    <h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Active Ticket</h3>
                    <div id="cart-list" class="flex-1 space-y-4 max-h-[300px] overflow-y-auto mb-6"></div>
                    <div class="pt-6 border-t border-gray-100">
                        <div class="flex justify-between font-bold text-xl mb-6 text-gray-900 tracking-tighter"><span>Grand Total</span><span id="cart-total">$0.00</span></div>
                        <button onclick="window.checkout()" class="w-full bg-black text-white py-4 rounded-2xl font-bold text-sm uppercase tracking-widest shadow-lg shadow-black/10">Authorize Sale</button>
                    </div>
                </div>
            </div>`;
        window.renderCart();
    } catch(e) {}
}

// --- REQUIREMENT 5 & 6: REPORTING & AUDIT TRAIL ---
async function renderApprovals(c) {
    try {
        const q = await getPendingApprovals(profile.organization_id);
        const rows = q.map(x => `
            <tr class="border-b border-gray-50">
                <td class="p-4 font-bold text-sm text-gray-900 uppercase">${x.products?.name}</td>
                <td class="p-4 text-xs font-mono font-bold text-blue-600">${x.quantity}</td>
                <td class="p-4 text-xs text-gray-400 font-bold uppercase tracking-tighter">${x.profiles?.full_name}</td>
                <td class="p-4 text-right">
                    <button onclick="window.approve('${x.id}','approved')" class="bg-black text-white px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest">Authorize Movement</button>
                </td>
            </tr>`).join('');
        
        c.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <h1 class="text-xl font-bold uppercase tracking-widest text-gray-400">Finance & Controls</h1>
                <div class="text-right">
                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Stock Valuation</p>
                    <p class="text-lg font-bold text-gray-900 font-mono tracking-widest">$0.00</p>
                </div>
            </div>
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold border-b">
                        <tr><th class="p-4">Requested Item</th><th class="p-4">Qty</th><th class="p-4">Staff</th><th class="p-4 text-right">Control</th></tr>
                    </thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-400 font-bold tracking-widest uppercase">No pending financial controls.</td></tr>'}</tbody>
                </table>
            </div>`;
    } catch(e) {}
}

// --- CORE FUNCTIONS (ADDS, ISSUES, INVITES) ---

window.addProductModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight text-gray-900">Register Master Product</h3>
        <input id="pN" class="w-full p-3 border border-gray-200 rounded-xl mb-3 text-xs font-bold uppercase outline-none focus:border-black" placeholder="Product Name">
        <div class="grid grid-cols-2 gap-3 mb-6">
            <div><label class="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Unit Cost</label><input id="pC" type="number" class="w-full p-3 border border-gray-200 rounded-xl text-xs font-bold outline-none" placeholder="0.00"></div>
            <div><label class="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Sell Price</label><input id="pS" type="number" class="w-full p-3 border border-gray-200 rounded-xl text-xs font-bold outline-none" placeholder="0.00"></div>
        </div>
        <button onclick="window.execAddProduct()" class="w-full bg-black text-white py-4 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-xl shadow-black/5 hover:opacity-90">Register Product</button>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execAddProduct = async () => {
    const name = document.getElementById('pN').value;
    const cost = document.getElementById('pC').value;
    const sell = document.getElementById('pS').value;
    if(!name || !cost || !sell) return alert("Fill all required fields.");
    try {
        await supabase.from('products').insert({ name, cost_price: cost, selling_price: sell, organization_id: profile.organization_id });
        alert('Product Registered successfully.'); document.getElementById('modal').classList.add('hidden'); router('inventory');
    } catch(e) { alert(e.message); }
}

window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id);
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id);
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight text-gray-900">Receive Stock Entry</h3>
        <select id="sP" class="w-full p-3 border border-gray-200 rounded-xl mb-3 text-xs font-bold bg-white outline-none">${prods.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select>
        <select id="sL" class="w-full p-3 border border-gray-200 rounded-xl mb-3 text-xs font-bold bg-white outline-none">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select>
        <input id="sQ" type="number" class="w-full p-3 border border-gray-200 rounded-xl mb-6 text-xs font-bold outline-none" placeholder="Enter Received Quantity">
        <button onclick="window.execAddStock()" class="w-full bg-black text-white py-4 rounded-xl font-bold text-[10px] uppercase tracking-widest">Update Master Balance</button>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execAddStock = async () => {
    const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value;
    if(!qty) return alert("Enter valid quantity.");
    try {
        const { data: exist } = await supabase.from('inventory').select('*').eq('product_id', pid).eq('location_id', lid).maybeSingle();
        if(exist) await supabase.from('inventory').update({ quantity: parseFloat(exist.quantity) + parseFloat(qty) }).eq('id', exist.id);
        else await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id });
        
        // POINT 5: Record to Transaction Table (Audit Trail)
        await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty });
        
        alert('Stock received and logged.'); document.getElementById('modal').classList.add('hidden'); router('inventory');
    } catch(e) { alert(e.message); }
}

// UTILS (Issue, Cart, nk.)
window.issueModal=(name,id,from)=>{
    document.getElementById('modal-content').innerHTML=`
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Issue / Transfer Stock</h3>
        <input value="${name}" disabled class="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl mb-4 text-xs font-bold text-gray-900">
        <label class="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Target Location</label>
        <select id="tTo" class="w-full p-3 border border-gray-200 rounded-xl mb-4 bg-white text-xs font-bold outline-none"></select>
        <label class="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Quantity</label>
        <input id="tQty" type="number" class="w-full p-3 border border-gray-200 rounded-xl mb-6 text-xs font-bold outline-none" placeholder="0.00">
        <button onclick="window.execIssue('${id}','${from}')" class="w-full bg-black text-white py-4 rounded-xl font-bold text-[10px] uppercase tracking-widest">Authorize Movement</button>`;
    getLocations(profile.organization_id).then(locs => { document.getElementById('tTo').innerHTML = locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join(''); });
    document.getElementById('modal').classList.remove('hidden');
}

window.execIssue=async(id,from)=>{
    const to = document.getElementById('tTo').value, qty = document.getElementById('tQty').value;
    try { await transferStock(id, from, to, qty, profile.id, profile.organization_id); alert('Stock movement recorded.'); document.getElementById('modal').classList.add('hidden'); router('inventory'); } catch(e){alert(e.message);}
}

// Cart & POS logic
window.addCart=(n,p,id)=>{const x=cart.find(c=>c.id===id); if(x)x.qty++; else cart.push({name:n,price:p,id,qty:1}); window.renderCart();}
window.renderCart=()=>{
    const l=document.getElementById('cart-list'), t=document.getElementById('cart-total');
    if(!cart.length){l.innerHTML='<div class="text-center py-12 text-gray-300 text-[10px] font-bold uppercase tracking-widest">No active bill items.</div>'; t.innerText='$0.00'; return;}
    let sum = 0;
    l.innerHTML = cart.map(i => { sum += i.price * i.qty; return `<div class="flex justify-between items-center text-xs font-bold uppercase tracking-tighter"><span>${i.name} (x${i.qty})</span><button onclick="window.remCart('${i.id}')" class="text-red-500 font-bold">×</button></div>` }).join('');
    t.innerText = '$' + sum.toFixed(2);
}
window.remCart=(id)=>{cart = cart.filter(c => c.id !== id); window.renderCart();}
window.checkout=async()=>{if(!cart.length) return alert("Ticket Empty"); try{await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); alert('Sale successfully authorized.'); cart=[]; window.renderCart(); router('bar');}catch(e){alert(e.message);}}

// Settings & Staff
async function renderSettings(c) {
    const locs = await getLocations(profile.organization_id);
    const rows = locs.map(l => `<tr class="border-b"><td class="p-4 font-bold text-sm text-gray-900">${l.name}</td><td class="p-4 uppercase text-[10px] font-bold text-gray-400 tracking-widest">${l.type}</td><td class="p-4 text-right"><button onclick="window.editStoreModal('${l.id}','${l.name}','${l.type}')" class="text-blue-500 font-bold text-[10px] uppercase">Edit</button></td></tr>`).join('');
    c.innerHTML = `<div class="flex justify-between mb-8"><h1 class="text-xl font-bold uppercase tracking-tight">System Infrastructure</h1><button onclick="window.addStoreModal()" class="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest">+ Register Location</button></div><div class="bg-white rounded-2xl border overflow-hidden shadow-sm"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`;
}

window.addStoreModal=()=>{
    document.getElementById('modal-content').innerHTML=`
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight text-gray-900">Add New Enterprise Store</h3>
        <input id="nN" class="w-full p-3 border border-gray-200 rounded-xl mb-3 text-xs font-bold outline-none" placeholder="Store/Camp Name">
        <select id="nT" class="w-full p-3 border border-gray-200 rounded-xl mb-6 bg-white text-xs font-bold outline-none">
            <option value="main_store">Main Central Store</option>
            <option value="camp_store">Camp / Branch Store</option>
        </select>
        <button onclick="window.execAddStore()" class="w-full bg-black text-white py-4 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-xl shadow-black/5 hover:opacity-90">Authorize Store Registry</button>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execAddStore=async()=>{ try{ await createLocation(profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').classList.add('hidden'); router('settings'); }catch(e){alert(e.message);} }

async function renderStaff(c){
    try {
        const staff = await getStaff(profile.organization_id);
        const rows = staff.map(s=>`<tr class="border-b"><td class="p-4 text-sm font-bold text-gray-900">${s.full_name}</td><td class="p-4 text-xs text-gray-500 font-bold uppercase tracking-tight">${s.email}</td><td class="p-4 uppercase text-[10px] font-bold text-blue-600 tracking-widest">${s.role}</td></tr>`).join('');
        c.innerHTML = `<div class="flex justify-between mb-8"><h1 class="text-xl font-bold uppercase tracking-tight">Access Management</h1><button onclick="window.inviteModal()" class="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest">Grant Access</button></div><div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`;
    } catch(e){}
}

window.inviteModal=async()=>{
    const locs = await getLocations(profile.organization_id);
    document.getElementById('modal-content').innerHTML=`
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Invite Professional Staff</h3>
        <input id="iE" class="w-full p-3 border border-gray-200 rounded-xl mb-3 text-xs font-bold outline-none" placeholder="Email Address" type="email">
        <select id="iR" class="w-full p-3 border border-gray-200 rounded-xl mb-3 bg-white text-xs font-bold outline-none">
            <option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance Specialist</option>
        </select>
        <select id="iL" class="w-full p-3 border border-gray-200 rounded-xl mb-6 bg-white text-xs font-bold outline-none">
            ${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}
        </select>
        <button onclick="window.execInvite()" class="w-full bg-black text-white py-4 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-xl shadow-black/5 hover:opacity-90">Send Portal Invitation</button>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execInvite=async()=>{
    try { await supabase.from('staff_invites').insert({ email: document.getElementById('iE').value, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' }); alert('Portal invitation successfully dispatched.'); document.getElementById('modal').classList.add('hidden'); router('staff'); } catch(e){alert(e.message);}
}

window.approve=async(id,s)=>{ if(confirm('Approve this stock movement?')) try { await respondToApproval(id,s,profile.id); router('approvals'); } catch(e){alert(e.message);} }
