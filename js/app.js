import { getSession, logout } from './auth.js';
import { getInventory, createLocation, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null; let cart = [];
window.closeModalOutside = (e) => { if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none'; };

window.onload = async () => {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = prof;
        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }
        
        window.logoutAction = logout;
        // Mobile Menu Logic
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => document.getElementById('sidebar').classList.remove('-translate-x-full'));
        document.getElementById('close-sidebar')?.addEventListener('click', () => document.getElementById('sidebar').classList.add('-translate-x-full'));
        
        applyPermissions(profile.role);
        router('inventory');
    } catch (e) { logout(); }
};

function applyPermissions(role) {
    const hide = (ids) => ids.forEach(id => document.getElementById(id)?.classList.add('hidden'));
    if (role === 'finance') hide(['nav-bar', 'nav-staff', 'nav-settings']);
    else if (role === 'barman') hide(['nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);
    else if (role === 'storekeeper') hide(['nav-bar', 'nav-staff', 'nav-settings']);
}

window.router = async (view) => {
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div></div>';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    document.getElementById(`nav-${view}`)?.classList.add('nav-active');
    
    // Close sidebar on mobile nav
    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app);
    else if (view === 'reports') await renderReports(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// 1. INVENTORY (POINT 1 & 2)
async function renderInventory(c) {
    try {
        const { data: catalog } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
        const stock = await getInventory(profile.organization_id);
        const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? stock : stock.filter(x => x.location_id === profile.assigned_location_id);
        
        const stockRows = filteredStock.map(i => `<tr class="border-b hover:bg-gray-50"><td class="p-4 font-bold text-sm uppercase">${i.products?.name}</td><td class="p-4 text-xs uppercase font-bold tracking-widest text-gray-500">${i.locations?.name}</td><td class="p-4 font-mono font-bold">${i.quantity}</td><td class="p-4 text-right">${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="btn-black py-2 px-3">MOVE</button>` : ''}</td></tr>`).join('');
        const catalogRows = (catalog && catalog.length) ? catalog.map(p => `<tr class="border-b text-[11px]"><td class="p-4 uppercase font-semibold">${p.name}</td><td class="p-4 font-mono">$${p.cost_price} / $${p.selling_price}</td><td class="p-4 text-right text-green-600 font-bold">ACTIVE</td></tr>`).join('') : `<tr><td colspan="3" class="p-8 text-center text-xs text-gray-400">Catalog empty.</td></tr>`;

        c.innerHTML = `
            <div class="flex justify-between items-center mb-8"><h1 class="text-2xl font-bold uppercase tracking-tight">Stock Dashboard</h1><div class="flex gap-2"><button onclick="window.addProductModal()" class="btn-black bg-white border border-gray-300 text-black hover:bg-gray-50">Register Item</button><button onclick="window.addStockModal()" class="btn-black">Receive Stock</button></div></div>
            <div class="mb-10"><h3 class="text-[10px] font-bold text-gray-400 uppercase mb-3 tracking-widest">1. Physical Stock</h3><div class="table-wrap"><table class="w-full text-left min-w-[600px]"><thead class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b"><tr><th class="p-4">Item</th><th class="p-4">Store</th><th class="p-4">Qty</th><th class="p-4 text-right">Action</th></tr></thead><tbody>${stockRows.length ? stockRows : '<tr><td colspan="4" class="p-8 text-center text-xs text-gray-400">No stock.</td></tr>'}</tbody></table></div></div>
            <div><h3 class="text-[10px] font-bold text-gray-400 uppercase mb-3 tracking-widest">2. Master Catalog</h3><div class="table-wrap"><table class="w-full text-left min-w-[600px]"><thead class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b"><tr><th class="p-4">Item</th><th class="p-4">Pricing</th><th class="p-4 text-right">Status</th></tr></thead><tbody>${catalogRows}</tbody></table></div></div>`;
    } catch(e) { console.error(e); }
}

// 2. REPORTS & CONTROLS (POINT 5 - FULLY IMPLEMENTED)
async function renderReports(c) {
    try {
        const { data: logs } = await supabase.from('transactions').select('*, products(name), locations:to_location_id(name), profiles:user_id(full_name)').eq('organization_id', profile.organization_id).order('created_at', { ascending: false }).limit(50);
        
        // Calculations for Valuation & Profit
        const totalSales = logs.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.total_value) || 0), 0);
        const totalProfit = logs.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.profit) || 0), 0);
        
        const rows = logs.map(l => `<tr class="border-b text-[11px]"><td class="p-4 text-gray-500">${new Date(l.created_at).toLocaleDateString()}</td><td class="p-4 font-bold uppercase">${l.products?.name || 'Unknown'}</td><td class="p-4 font-bold uppercase ${l.type.includes('sale') ? 'text-green-600' : 'text-blue-600'}">${l.type}</td><td class="p-4 font-mono">${l.quantity}</td><td class="p-4 text-gray-400 uppercase">${l.profiles?.full_name || 'System'}</td></tr>`).join('');
        
        c.innerHTML = `
            <h1 class="text-2xl font-bold uppercase mb-8">Reports & Financials</h1>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                <div class="stat-card p-6 border rounded-xl bg-white"><p class="text-[10px] font-bold text-gray-400 uppercase">Total Sales Revenue</p><p class="text-3xl font-bold font-mono text-gray-900">$${totalSales.toLocaleString()}</p></div>
                <div class="stat-card p-6 border rounded-xl bg-white"><p class="text-[10px] font-bold text-gray-400 uppercase">Total Gross Profit</p><p class="text-3xl font-bold font-mono text-green-600">$${totalProfit.toLocaleString()}</p></div>
            </div>
            <h3 class="text-[10px] font-bold text-gray-400 uppercase mb-3 tracking-widest">Transaction Audit Trail</h3>
            <div class="table-wrap shadow-sm"><table class="w-full text-left min-w-[600px]"><thead class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b"><tr><th class="p-4">Date</th><th class="p-4">Item</th><th class="p-4">Action</th><th class="p-4">Qty</th><th class="p-4">User</th></tr></thead><tbody>${rows.length ? rows : '<tr><td colspan="5" class="p-8 text-center text-xs text-gray-400">No activity.</td></tr>'}</tbody></table></div>`;
    } catch(e) {}
}

// 3. STAFF
async function renderStaff(c) {
    const { data: active } = await supabase.from('profiles').select('*').eq('organization_id', profile.organization_id);
    const { data: pending } = await supabase.from('staff_invites').select('*').eq('organization_id', profile.organization_id).eq('status', 'pending');
    c.innerHTML = `<div class="flex justify-between mb-8"><h1 class="text-2xl font-bold uppercase">Team</h1><button onclick="window.inviteModal()" class="btn-black px-4 py-2">+ Invite</button></div>
    <div class="table-wrap shadow-sm"><table class="w-full text-left min-w-[600px]"><tbody>
    ${active.map(s=>`<tr class="border-b"><td class="p-4 text-sm font-bold uppercase">${s.full_name}</td><td class="p-4 text-[10px] font-bold text-blue-600 uppercase">${s.role}</td><td class="p-4 text-right text-green-500 font-bold text-[9px]">ACTIVE</td></tr>`).join('')}
    ${pending.map(i=>`<tr class="border-b bg-yellow-50"><td class="p-4 text-sm font-medium text-gray-500">${i.email}</td><td class="p-4 text-[10px] font-bold text-gray-400 uppercase">${i.role}</td><td class="p-4 text-right text-yellow-600 font-bold text-[9px]">PENDING (PW: 123456)</td></tr>`).join('')}
    </tbody></table></div>`;
}
window.inviteModal = async () => { const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase">Invite</h3><div class="modal-body"><input id="iE" class="input-field" placeholder="EMAIL"><select id="iR" class="input-field"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance</option></select><select id="iL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select><button onclick="window.execInvite()" class="btn-black w-full py-3">Send</button></div>`; document.getElementById('modal').style.display = 'flex'; };
window.execInvite = async () => { const email = document.getElementById('iE').value; if(!email || !email.includes('@')) return alert("Invalid Email"); await supabase.from('staff_invites').insert({ email, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' }); document.getElementById('modal').style.display = 'none'; router('staff'); };

// 4. BAR
async function renderBar(c) {
    const inv = await getInventory(profile.organization_id);
    const items = inv.filter(x => x.location_id === profile.assigned_location_id).map(x => `<div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border p-5 rounded-xl cursor-pointer hover:border-black shadow-sm"><h4 class="font-bold text-xs uppercase mb-2">${x.products.name}</h4><div class="flex justify-between items-center"><span class="font-bold font-mono text-sm">$${x.products.selling_price}</span><span class="text-[9px] text-gray-400 font-bold uppercase">Qty: ${x.quantity}</span></div></div>`).join('');
    c.innerHTML = `<div class="flex flex-col lg:flex-row h-full gap-8"><div class="flex-1 overflow-y-auto"><h1 class="text-xl font-bold uppercase mb-6 text-gray-400">POS</h1><div class="grid grid-cols-3 gap-4">${items.length?items:'<p class="text-xs text-gray-400 font-bold">NO STOCK.</p>'}</div></div><div class="w-full lg:w-80 bg-white border rounded-2xl p-6 shadow-xl h-fit sticky top-0"><h3 class="font-bold uppercase mb-6 text-sm">Ticket</h3><div id="cart-list" class="space-y-3 mb-6 min-h-[100px]"></div><div class="border-t pt-4"><div class="flex justify-between font-bold mb-4 text-lg"><span>Total</span><span id="cart-total">$0.00</span></div><button onclick="window.checkout()" class="btn-black w-full py-3">Sale</button></div></div></div>`;
    window.renderCart();
}
window.addCart=(n,p,id)=>{const x=cart.find(c=>c.id===id); if(x)x.qty++; else cart.push({name:n,price:p,id,qty:1}); window.renderCart();}
window.renderCart=()=>{ const l=document.getElementById('cart-list'), t=document.getElementById('cart-total'); if(!cart.length){l.innerHTML='<div class="text-center text-xs text-gray-300 py-4 font-bold uppercase">Empty</div>'; t.innerText='$0.00'; return;} let sum=0; l.innerHTML=cart.map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between text-xs font-bold uppercase"><span>${i.name} x${i.qty}</span><button onclick="window.remCart('${i.id}')" class="text-red-500">X</button></div>`}).join(''); t.innerText='$'+sum.toFixed(2); }
window.remCart=(id)=>{cart=cart.filter(c=>c.id!==id); window.renderCart();}
window.checkout=async()=>{if(!cart.length) return; try{await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); alert('Sale Confirmed.'); cart=[]; window.renderCart(); router('bar');}catch(e){alert(e.message);}}

// 5. APPROVALS
async function renderApprovals(c) {
    const q = await getPendingApprovals(profile.organization_id);
    const rows = q.map(x => `<tr class="border-b"><td class="p-4 font-bold text-sm uppercase">${x.products?.name}</td><td class="p-4 font-bold text-blue-600">${x.quantity}</td><td class="p-4 text-xs text-gray-500">To: ${x.to_loc?.name}</td><td class="p-4 text-right"><button onclick="window.approve('${x.id}','approved')" class="btn-black py-2 px-4">Approve</button></td></tr>`).join('');
    c.innerHTML = `<h1 class="text-xl font-bold mb-8 uppercase text-gray-400">Approvals</h1><div class="table-wrap shadow-sm"><table class="w-full text-left"><tbody>${rows.length?rows:'<tr><td class="p-12 text-center text-xs text-gray-400 uppercase font-bold">Queue clear.</td></tr>'}</tbody></table></div>`;
}
window.approve=async(id,s)=>{ if(confirm('Approve?')) try { await respondToApproval(id,s,profile.id); router('approvals'); } catch(e){} }

// UTILS (Issue/Add Stock/Register)
window.issueModal = async (name, id, fromLoc) => {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).neq('id', fromLoc);
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase">Move Stock</h3><div class="modal-body"><input value="${name}" disabled class="input-field bg-gray-50 font-bold uppercase"><div class="z-high"><label class="text-[10px] font-bold uppercase block mb-1">To (Camp/Dept)</label><select id="tTo" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div><div><label class="text-[10px] font-bold uppercase block mb-1">Qty</label><input id="tQty" type="number" class="input-field"></div><button onclick="window.execIssue('${id}','${fromLoc}')" class="btn-black w-full py-3">Request Transfer</button></div>`;
    document.getElementById('modal').style.display = 'flex';
};
window.execIssue = async (pId, fId) => { try { await transferStock(pId, fId, document.getElementById('tTo').value, document.getElementById('tQty').value, profile.id, profile.organization_id); document.getElementById('modal').style.display = 'none'; alert("Request Sent."); router('inventory'); } catch(e){alert(e.message);} };

window.addProductModal = () => { document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase">Register Item</h3><div class="modal-body"><input id="pN" class="input-field uppercase" placeholder="NAME"><div class="flex gap-4"><input id="pC" type="number" class="input-field" placeholder="COST"><input id="pS" type="number" class="input-field" placeholder="SELL"></div><button onclick="window.execAddProduct()" class="btn-black w-full py-3">Save</button></div>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddProduct = async () => { try { await supabase.from('products').insert({ name: document.getElementById('pN').value.toUpperCase(), cost_price: document.getElementById('pC').value, selling_price: document.getElementById('pS').value, organization_id: profile.organization_id }); document.getElementById('modal').style.display = 'none'; router('inventory'); } catch(e) { alert(e.message); } };

window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');
    document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase">Receive Stock</h3><div class="modal-body"><div class="z-high"><label class="text-[10px] font-bold uppercase block mb-1">Item</label><select id="sP" class="input-field">${prods.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div><div class="z-mid"><label class="text-[10px] font-bold uppercase block mb-1">Into</label><select id="sL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div><div><label class="text-[10px] font-bold uppercase block mb-1">Qty</label><input id="sQ" type="number" class="input-field"></div><button onclick="window.execAddStock()" class="btn-black w-full py-3">Save</button></div>`;
    document.getElementById('modal').style.display = 'flex';
};
window.execAddStock = async () => { 
    const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value;
    await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id }); 
    await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty });
    document.getElementById('modal').style.display = 'none'; router('inventory');
};

async function renderSettings(c) { const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id); c.innerHTML = `<div class="flex justify-between items-center mb-10"><h1 class="text-2xl font-bold uppercase">Settings</h1><button onclick="window.addStoreModal()" class="btn-black px-4 py-2">+ Hub</button></div><div class="table-wrap shadow-sm"><table class="w-full text-left min-w-[600px]"><tbody>${locs.map(l=>`<tr class="border-b"><td class="p-4 font-bold text-sm uppercase">${l.name}</td><td class="p-4 text-green-500 font-bold text-[9px] text-right">ACTIVE</td></tr>`).join('')}</tbody></table></div>`; }
window.addStoreModal=()=>{ document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-6 uppercase">Add Hub (Camp/Dept)</h3><div class="modal-body"><input id="nN" class="input-field" placeholder="NAME (e.g. Kitchen)"><select id="nT" class="input-field"><option value="camp_store">Camp Store</option><option value="main_store">Main Store</option><option value="department">Department</option></select><button onclick="window.execAddStore()" class="btn-black w-full py-3">Create</button></div>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddStore=async()=>{ await createLocation(profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').style.display = 'none'; router('settings'); };
