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
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div></div>';
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    document.getElementById(`nav-${view}`)?.classList.add('nav-active');
    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app);
    else if (view === 'reports') await renderReports(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// 1. INVENTORY (Buttons hazikatiki tena)
async function renderInventory(c) {
    try {
        const { data: catalog } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
        const stock = await getInventory(profile.organization_id);
        const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? stock : stock.filter(x => x.location_id === profile.assigned_location_id);
        
        const stockRows = filteredStock.map(i => `<tr class="transition"><td class="font-bold text-gray-800 uppercase">${i.products?.name}</td><td class="text-xs font-bold text-gray-500 uppercase tracking-widest">${i.locations?.name}</td><td class="font-mono font-bold text-gray-900">${i.quantity}</td><td class="text-right">${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-700 transition shadow-sm">MOVE</button>` : ''}</td></tr>`).join('');
        const catalogRows = (catalog && catalog.length) ? catalog.map(p => `<tr><td class="font-bold text-gray-700 uppercase">${p.name}</td><td class="font-mono text-gray-600">$${p.cost_price} / $${p.selling_price}</td><td class="text-right text-green-600 font-bold text-xs uppercase bg-green-50 px-2 py-1 rounded-full inline-block mt-2">Active</td></tr>`).join('') : `<tr><td colspan="3" class="text-center text-xs text-gray-400 py-10">Catalog is empty.</td></tr>`;

        // HEADER FIX: Flex-col kwenye mobile, Flex-row kwenye PC
        c.innerHTML = `
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                <h1 class="text-3xl font-bold uppercase tracking-tight text-slate-900">Stock Dashboard</h1>
                <div class="flex flex-wrap gap-3 w-full md:w-auto">
                    ${profile.role === 'manager' ? `<button onclick="window.addProductModal()" class="btn-primary bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 flex-1 md:flex-none shadow-sm">Register Item</button>` : ''}
                    <button onclick="window.addStockModal()" class="btn-primary flex-1 md:flex-none shadow-lg shadow-slate-900/20">Receive Stock</button>
                </div>
            </div>
            
            <div class="mb-12">
                <h3 class="text-xs font-bold text-slate-400 uppercase mb-4 tracking-widest">1. Physical Stock Balance</h3>
                <div class="table-card">
                    <div class="table-wrapper">
                        <table><thead><tr><th>Item</th><th>Location</th><th>Qty</th><th class="text-right">Action</th></tr></thead>
                        <tbody>${stockRows.length ? stockRows : '<tr><td colspan="4" class="text-center text-xs text-gray-400 py-12">No stock available in this location.</td></tr>'}</tbody></table>
                    </div>
                </div>
            </div>
            
            <div>
                <h3 class="text-xs font-bold text-slate-400 uppercase mb-4 tracking-widest">2. Master Product Catalog</h3>
                <div class="table-card">
                    <div class="table-wrapper">
                        <table><thead><tr><th>Product Name</th><th>Standard Pricing</th><th class="text-right">Status</th></tr></thead>
                        <tbody>${catalogRows}</tbody></table>
                    </div>
                </div>
            </div>`;
    } catch(e) { console.error(e); }
}

// ... (Functions zingine kama renderReports, renderStaff, etc. zinabaki vile vile kwa sababu logic yao ilikuwa sahihi)
// Hakikisha tu unatumia 'table-card' na 'table-wrapper' kwenye HTML zao kama hapo juu kwenye Inventory.

// HELPER: REPORTS (UI Fixed)
async function renderReports(c) {
    try {
        const { data: logs } = await supabase.from('transactions').select('*, products(name), locations:to_location_id(name), profiles:user_id(full_name)').eq('organization_id', profile.organization_id).order('created_at', { ascending: false }).limit(50);
        const totalSales = logs ? logs.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.total_value) || 0), 0) : 0;
        const totalProfit = logs ? logs.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.profit) || 0), 0) : 0;
        const rows = (logs && logs.length) ? logs.map(l => `<tr><td class="text-gray-500">${new Date(l.created_at).toLocaleDateString()}</td><td class="font-bold uppercase">${l.products?.name || 'N/A'}</td><td class="font-bold uppercase ${l.type.includes('sale') ? 'text-green-600' : 'text-blue-600'} text-xs tracking-wider">${l.type.replace('_', ' ')}</td><td class="font-mono font-bold">${l.quantity}</td><td class="text-gray-500 uppercase text-xs font-bold tracking-wide">${l.profiles?.full_name || 'System'}</td></tr>`).join('') : '';
        
        c.innerHTML = `
            <h1 class="text-3xl font-bold uppercase mb-10 text-slate-900">Reports & Financials</h1>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12"><div class="bg-white p-8 border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition"><p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Total Sales Revenue</p><p class="text-4xl font-bold font-mono text-slate-900 tracking-tight">$${totalSales.toLocaleString()}</p></div><div class="bg-white p-8 border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition"><p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Total Gross Profit</p><p class="text-4xl font-bold font-mono text-green-600 tracking-tight">$${totalProfit.toLocaleString()}</p></div></div>
            <h3 class="text-xs font-bold text-slate-400 uppercase mb-4 tracking-widest">Transaction Audit Trail</h3><div class="table-card"><div class="table-wrapper"><table><thead><tr><th>Date</th><th>Item</th><th>Action</th><th>Qty</th><th>User</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="text-center text-xs text-gray-400 py-12">No transactions recorded yet.</td></tr>'}</tbody></table></div></div>`;
    } catch(e) { c.innerHTML = '<p class="text-red-500">Error loading reports.</p>'; }
}

// ... (Endelea na Staff, Approvals, Settings na Modals kama zilivyokuwa kwenye jibu la awali, hakuna kilichobadilika kwenye logic, ni muonekano tu)
// Paste the rest of the app.js functions here (renderStaff, renderBar, etc.) using the exact same code as the previous "100% Guaranteed" response.
// The key fix was in the router/layout rendering and the CSS in dashboard.html.

async function renderStaff(c) {
    const { data: active } = await supabase.from('profiles').select('*').eq('organization_id', profile.organization_id);
    const { data: pending } = await supabase.from('staff_invites').select('*').eq('organization_id', profile.organization_id).eq('status', 'pending');
    c.innerHTML = `<div class="flex justify-between items-center mb-10"><h1 class="text-3xl font-bold uppercase text-slate-900">Team Management</h1><button onclick="window.inviteModal()" class="btn-primary w-auto px-8 py-3 text-xs shadow-lg shadow-slate-900/20">+ Invite User</button></div><div class="table-card"><div class="table-wrapper"><table><tbody>
    ${active.map(s=>`<tr><td class="font-bold text-slate-800 uppercase">${s.full_name}</td><td class="text-xs font-bold text-blue-600 uppercase tracking-wider">${s.role}</td><td class="text-right text-green-500 font-bold text-[10px] uppercase tracking-widest">ACTIVE</td></tr>`).join('')}
    ${pending.map(i=>`<tr class="bg-yellow-50/50"><td class="text-sm font-medium text-slate-600">${i.email}</td><td class="text-xs font-bold text-slate-400 uppercase tracking-wider">${i.role}</td><td class="text-right text-yellow-600 font-bold text-[10px] uppercase tracking-tighter">PENDING (PW: 123456)</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

async function renderBar(c) {
    const inv = await getInventory(profile.organization_id);
    const items = inv.filter(x => x.location_id === profile.assigned_location_id).map(x => `<div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border p-6 rounded-2xl cursor-pointer hover:border-slate-900 transition shadow-sm group hover:shadow-lg hover:-translate-y-1 duration-200"><h4 class="font-bold text-xs uppercase mb-3 text-slate-800 group-hover:text-slate-900 tracking-wide">${x.products.name}</h4><div class="flex justify-between items-center"><span class="font-bold font-mono text-sm text-slate-900">$${x.products.selling_price}</span><span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider bg-slate-50 px-2 py-1 rounded">Qty: ${x.quantity}</span></div></div>`).join('');
    c.innerHTML = `<div class="flex flex-col lg:flex-row h-full gap-10"><div class="flex-1 overflow-y-auto"><h1 class="text-3xl font-bold uppercase mb-8 text-slate-900">POS Terminal</h1><div class="grid grid-cols-2 md:grid-cols-3 gap-5">${items.length?items:'<p class="text-xs text-slate-400 font-bold">NO STOCK ASSIGNED TO BAR.</p>'}</div></div><div class="w-full lg:w-96 bg-white border border-slate-200 rounded-3xl p-8 shadow-xl h-fit sticky top-0"><h3 class="font-bold uppercase mb-6 text-sm tracking-widest text-slate-400">Current Ticket</h3><div id="cart-list" class="space-y-4 mb-8 min-h-[150px]"></div><div class="border-t border-slate-100 pt-6"><div class="flex justify-between font-bold mb-6 text-xl text-slate-900"><span>Total</span><span id="cart-total">$0.00</span></div><button onclick="window.checkout()" class="btn-primary w-full py-4 text-sm shadow-xl shadow-slate-900/10">Complete Sale</button></div></div></div>`;
    window.renderCart();
}

async function renderApprovals(c) {
    const q = await getPendingApprovals(profile.organization_id);
    const rows = q.map(x => `<tr><td class="font-bold text-sm uppercase">${x.products?.name}</td><td class="font-bold text-blue-600 font-mono">${x.quantity}</td><td class="text-xs text-slate-500 uppercase tracking-wide">To: ${x.to_loc?.name}</td><td class="text-right"><button onclick="window.approve('${x.id}','approved')" class="text-[10px] font-bold bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-700 transition shadow-sm">APPROVE</button></td></tr>`).join('');
    c.innerHTML = `<h1 class="text-3xl font-bold mb-10 uppercase text-slate-900">Approvals Center</h1><div class="table-card"><div class="table-wrapper"><table><tbody>${rows.length?rows:'<tr><td colspan="4" class="text-center text-xs text-slate-400 py-12">No pending approvals.</td></tr>'}</tbody></table></div></div>`;
}
window.approve=async(id,s)=>{ if(confirm('Confirm Approval?')) try { await respondToApproval(id,s,profile.id); router('approvals'); } catch(e){} }

async function renderSettings(c) { 
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id); 
    c.innerHTML = `<div class="flex justify-between items-center mb-10"><h1 class="text-3xl font-bold uppercase text-slate-900">System Config</h1><button onclick="window.addStoreModal()" class="btn-primary w-auto px-8 py-3 text-xs shadow-lg shadow-slate-900/20">+ Add Hub</button></div><div class="table-card"><div class="table-wrapper"><table><tbody>${locs.map(l=>`<tr><td class="font-bold text-sm uppercase">${l.name}</td><td class="text-green-600 font-bold text-[9px] text-right uppercase tracking-wider bg-green-50 px-3 py-1 rounded-full inline-block mt-1">ACTIVE</td></tr>`).join('')}</tbody></table></div></div>`; 
}

// MODALS (FIXED SPACING: GAP & MARGINS)
window.addProductModal = () => { 
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase tracking-tight text-center text-slate-800">Register New Item</h3>
        <div class="input-group"><label class="input-label">Product Name</label><input id="pN" class="input-field uppercase" placeholder="E.g. Safari Lager"></div>
        <div class="grid grid-cols-2 gap-5 mb-8">
            <div class="input-group mb-0"><label class="input-label">Cost Price</label><input id="pC" type="number" class="input-field" placeholder="0.00"></div>
            <div class="input-group mb-0"><label class="input-label">Selling Price</label><input id="pS" type="number" class="input-field" placeholder="0.00"></div>
        </div>
        <button onclick="window.execAddProduct()" class="btn-primary">Save Item</button>`;
    document.getElementById('modal').style.display = 'flex'; 
};

window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase tracking-tight text-center text-slate-800">Receive Stock</h3>
        <div class="input-group"><label class="input-label">Select Item</label><select id="sP" class="input-field">${prods.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
        <div class="input-group"><label class="input-label">Destination Store</label><select id="sL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
        <div class="input-group"><label class="input-label">Quantity Received</label><input id="sQ" type="number" class="input-field" placeholder="0"></div>
        <button onclick="window.execAddStock()" class="btn-primary">Confirm Entry</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.inviteModal = async () => { 
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id); 
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase tracking-tight text-center text-slate-800">Invite Team</h3>
        <div class="input-group"><label class="input-label">Email Address</label><input id="iE" class="input-field" placeholder="staff@company.com"></div>
        <div class="input-group"><label class="input-label">System Role</label><select id="iR" class="input-field"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance</option></select></div>
        <div class="input-group"><label class="input-label">Assigned Location</label><select id="iL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
        <button onclick="window.execInvite()" class="btn-primary">Send Invitation</button>`; 
    document.getElementById('modal').style.display = 'flex'; 
};

window.issueModal = async (name, id, fromLoc) => { 
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).neq('id', fromLoc); 
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase tracking-tight text-center text-slate-800">Move Stock</h3>
        <div class="input-group"><label class="input-label">Product</label><input value="${name}" disabled class="input-field bg-slate-50 font-bold uppercase text-slate-500"></div>
        <div class="input-group"><label class="input-label">Destination</label><select id="tTo" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
        <div class="input-group"><label class="input-label">Quantity</label><input id="tQty" type="number" class="input-field" placeholder="0"></div>
        <button onclick="window.execIssue('${id}','${fromLoc}')" class="btn-primary">Request Transfer</button>`; 
    document.getElementById('modal').style.display = 'flex'; 
};

window.addStoreModal=()=>{ document.getElementById('modal-content').innerHTML=`<h3 class="font-bold text-lg mb-8 uppercase tracking-tight text-center text-slate-800">Add Hub</h3><div class="input-group"><label class="input-label">Hub Name</label><input id="nN" class="input-field" placeholder="e.g. Kitchen"></div><div class="input-group"><label class="input-label">Hub Type</label><select id="nT" class="input-field"><option value="main_store">Main Store</option><option value="camp_store">Camp Store</option><option value="department">Department</option></select></div><button onclick="window.execAddStore()" class="btn-primary">Create</button>`; document.getElementById('modal').style.display = 'flex'; };

// Exec Functions (Standard)
window.execAddProduct = async () => { try { await supabase.from('products').insert({ name: document.getElementById('pN').value.toUpperCase(), cost_price: document.getElementById('pC').value, selling_price: document.getElementById('pS').value, organization_id: profile.organization_id }); document.getElementById('modal').style.display = 'none'; router('inventory'); } catch(e) { alert(e.message); } };
window.execAddStock = async () => { const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value; await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id }); await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty }); document.getElementById('modal').style.display = 'none'; router('inventory'); };
window.execInvite = async () => { const email = document.getElementById('iE').value; if(!email || !email.includes('@')) return alert("Invalid Email"); await supabase.from('staff_invites').insert({ email, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' }); document.getElementById('modal').style.display = 'none'; router('staff'); };
window.execIssue = async (pId, fId) => { try { await transferStock(pId, fId, document.getElementById('tTo').value, document.getElementById('tQty').value, profile.id, profile.organization_id); document.getElementById('modal').style.display = 'none'; alert("Request Sent."); router('inventory'); } catch(e){alert(e.message);}};
window.execAddStore=async()=>{ await createLocation(profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').style.display = 'none'; router('settings'); };
window.addCart=(n,p,id)=>{const x=cart.find(c=>c.id===id); if(x)x.qty++; else cart.push({name:n,price:p,id,qty:1}); window.renderCart();}
window.renderCart=()=>{ const l=document.getElementById('cart-list'), t=document.getElementById('cart-total'); if(!cart.length){l.innerHTML='<div class="text-center text-xs text-slate-300 py-8 font-bold uppercase tracking-widest">Empty Ticket</div>'; t.innerText='$0.00'; return;} let sum=0; l.innerHTML=cart.map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between text-xs font-bold uppercase text-slate-700"><span>${i.name} x${i.qty}</span><button onclick="window.remCart('${i.id}')" class="text-red-500 font-bold hover:text-red-700">X</button></div>`}).join(''); t.innerText='$'+sum.toFixed(2); }
window.remCart=(id)=>{cart=cart.filter(c=>c.id!==id); window.renderCart();}
window.checkout=async()=>{if(!cart.length) return; try{await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); alert('Sale Recorded.'); cart=[]; window.renderCart(); router('bar');}catch(e){alert(e.message);}}
