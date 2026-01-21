import { getSession, logout } from './auth.js';
import { getInventory, createLocation, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null; let cart = []; let currentLogs = [];

// --- NOTIFICATIONS ---
window.showNotification = (message, type = 'success') => {
    const existing = document.getElementById('notif-toast');
    if(existing) existing.remove();
    const div = document.createElement('div');
    div.id = 'notif-toast';
    div.className = `fixed top-5 right-5 px-6 py-4 rounded-xl text-white font-bold shadow-2xl z-[10000] flex items-center gap-3 transition-all duration-300 transform translate-y-0`;
    div.style.backgroundColor = type === 'success' ? '#0f172a' : '#ef4444'; 
    div.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 3000);
};

// --- INITIALIZATION ---
window.onload = async () => {
    // 1. HAKIKISHA MODAL IKO NJE YA APP-VIEW (SAFETY CHECK)
    const modal = document.getElementById('modal');
    if (modal && modal.parentElement.id === 'app-view') {
        document.body.appendChild(modal); // Hamisha modal iende body direct kama haipo huko
        console.log("System Fixed: Modal moved to Body root.");
    }

    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    try {
        await supabase.rpc('claim_my_invite', { email_to_check: session.user.email, user_id_to_link: session.user.id });
        
        let { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (!prof) {
            await new Promise(r => setTimeout(r, 1000));
            let retry = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
            prof = retry.data;
        }

        profile = prof;
        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }

        // CHECK NAME
        const forbiddenNames = ['Manager', 'Storekeeper', 'Barman', 'Finance', 'User', 'Admin', 'Staff'];
        const currentName = profile.full_name ? profile.full_name.trim() : "";
        if (currentName.length < 3 || forbiddenNames.some(n => currentName.toLowerCase().includes(n.toLowerCase()))) {
            let newName = null;
            while (!newName || newName.length < 3) {
                newName = prompt(`⚠️ ACCOUNT ACTION:\n\nPlease enter your FULL LEGAL NAME to proceed:`);
            }
            await supabase.from('profiles').update({ full_name: newName }).eq('id', profile.id);
            profile.full_name = newName;
        }
        
        window.logoutAction = logout;
        const userNameDisplay = document.querySelector('.font-bold.text-slate-700'); 
        if(userNameDisplay) userNameDisplay.innerText = profile.full_name;

        applyStrictPermissions(profile.role);
        const defaultView = (profile.role === 'barman') ? 'bar' : 'inventory';
        router(defaultView);
        
    } catch (e) { console.error(e); }
};

// --- PERMISSIONS ---
function applyStrictPermissions(role) {
    const hide = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
    const show = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'flex'; });
    show(['nav-inventory', 'nav-bar', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);
    if (role === 'finance') hide(['nav-bar', 'nav-settings', 'nav-staff']); 
    else if (role === 'storekeeper') hide(['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings']);
    else if (role === 'barman') hide(['nav-inventory', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);
}

window.router = async (view) => {
    if (profile.role === 'barman' && view !== 'bar') { window.showNotification("Access Denied: POS Only", "error"); return; }
    if (profile.role === 'storekeeper' && ['approvals', 'settings', 'staff'].includes(view)) { window.showNotification("Restricted Area", "error"); return; }
    
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div></div>';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    document.getElementById(`nav-${view}`)?.classList.add('nav-active');
    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    try {
        if (view === 'inventory') await renderInventory(app);
        else if (view === 'bar') await renderBar(app);
        else if (view === 'approvals') await renderApprovals(app);
        else if (view === 'reports') await renderReports(app);
        else if (view === 'staff') await renderStaff(app);
        else if (view === 'settings') await renderSettings(app);
    } catch (err) { console.error(err); }
};

// --- MODULES ---
async function renderInventory(c) {
    const { data: catalog } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const stock = await getInventory(profile.organization_id);
    const filteredStock = (profile.role === 'manager' || profile.role === 'finance') ? stock : stock.filter(x => x.location_id === profile.assigned_location_id);
    const showAdminActions = profile.role === 'manager';
    const stockRows = filteredStock.map(i => `<tr class="transition hover:bg-slate-50 border-b border-slate-100 last:border-0"><td class="font-bold text-gray-800 uppercase py-3 pl-4">${i.products?.name}</td><td class="text-xs font-bold text-gray-500 uppercase tracking-widest">${i.locations?.name}</td><td class="font-mono font-bold text-gray-900 text-lg">${i.quantity}</td><td class="text-right pr-4">${profile.role !== 'barman' ? `<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-white border border-slate-300 text-slate-700 px-3 py-1 rounded hover:bg-slate-100 transition shadow-sm">MOVE</button>` : ''}</td></tr>`).join('');
    c.innerHTML = `<div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8"><div><h1 class="text-3xl font-bold uppercase text-slate-900">Inventory</h1><p class="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">${profile.role === 'manager' ? 'All Locations' : 'My Store'}</p></div><div class="flex gap-3">${showAdminActions ? `<button onclick="window.addProductModal()" class="btn-primary bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-sm">Register Item</button><button onclick="window.addStockModal()" class="btn-primary shadow-lg shadow-slate-900/20">Receive Stock</button>` : ''}</div></div><div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left"><thead class="bg-slate-50 border-b border-slate-200"><tr><th class="py-3 pl-4 text-xs font-bold text-slate-400 uppercase">Item</th><th class="text-xs font-bold text-slate-400 uppercase">Location</th><th class="text-xs font-bold text-slate-400 uppercase">Qty</th><th class="text-right pr-4 text-xs font-bold text-slate-400 uppercase">Action</th></tr></thead><tbody>${stockRows.length ? stockRows : '<tr><td colspan="4" class="text-center text-xs text-gray-400 py-12">No stock available.</td></tr>'}</tbody></table></div></div>`;
}

async function renderBar(c) {
    try {
        if (!profile.assigned_location_id) { c.innerHTML = `<div class="p-10 text-center"><h3 class="text-red-500 font-bold">Configuration Error</h3><p>You are not assigned to any Bar Location.</p></div>`; return; }
        const inv = await getInventory(profile.organization_id);
        const items = inv.filter(x => x.location_id === profile.assigned_location_id);
        const itemCards = items.map(x => `<div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border p-6 rounded-2xl cursor-pointer hover:border-slate-900 transition shadow-sm group hover:shadow-lg hover:-translate-y-1"><h4 class="font-bold text-xs uppercase mb-3 text-slate-800 group-hover:text-slate-900">${x.products.name}</h4><div class="flex justify-between items-center"><span class="font-bold font-mono text-sm">$${x.products.selling_price}</span><span class="text-[10px] text-slate-400 font-bold uppercase bg-slate-50 px-2 py-1 rounded">Qty: ${x.quantity}</span></div></div>`).join('');
        c.innerHTML = `<div class="flex flex-col lg:flex-row h-full gap-10"><div class="flex-1 overflow-y-auto"><h1 class="text-3xl font-bold uppercase mb-8 text-slate-900">POS Terminal</h1><div class="grid grid-cols-2 md:grid-cols-3 gap-5">${items.length ? itemCards : '<div class="col-span-3 text-center py-10 text-slate-400 font-bold text-xs uppercase">No stock assigned to this Bar.</div>'}</div></div><div class="w-full lg:w-96 bg-white border border-slate-200 rounded-3xl p-8 shadow-xl h-fit sticky top-0"><h3 class="font-bold uppercase mb-6 text-sm tracking-widest text-slate-400">Current Ticket</h3><div id="cart-list" class="space-y-4 mb-8 min-h-[150px]"></div><div class="border-t border-slate-100 pt-6"><div class="flex justify-between font-bold mb-6 text-xl text-slate-900"><span>Total</span><span id="cart-total">$0.00</span></div><button onclick="window.checkout()" class="btn-primary w-full py-4 text-sm shadow-xl">Complete Sale</button></div></div></div>`;
        window.renderCart();
    } catch (e) { console.error("Bar Error:", e); c.innerHTML = `<div class="p-10 text-center"><h3 class="text-red-500 font-bold">System Error</h3><p>Could not load POS. Please contact admin.</p></div>`; }
}

async function renderReports(c) {
    try {
        const { data: logs } = await supabase.from('transactions').select('*, products(name), locations:to_location_id(name), from_loc:from_location_id(name), profiles:user_id(full_name, role)').eq('organization_id', profile.organization_id).order('created_at', { ascending: false }).limit(100);
        currentLogs = (profile.role === 'manager' || profile.role === 'finance') ? logs : logs.filter(l => l.from_location_id === profile.assigned_location_id || l.to_location_id === profile.assigned_location_id);
        const showFinancials = (profile.role === 'manager' || profile.role === 'finance');
        const totalSales = currentLogs.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.total_value) || 0), 0);
        const totalProfit = currentLogs.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.profit) || 0), 0);
        c.innerHTML = `<div class="flex flex-col md:flex-row justify-between items-center mb-10 gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900">Reports</h1><div class="flex gap-2">${showFinancials ? `<button onclick="window.exportCSV()" class="btn-primary bg-green-700 hover:bg-green-800 text-xs px-4 flex gap-2 items-center">EXPORT CSV</button>` : ''}</div></div>${showFinancials ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12"><div class="bg-white p-8 border border-slate-200 rounded-2xl shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Total Sales</p><p class="text-4xl font-bold font-mono text-slate-900">$${totalSales.toLocaleString()}</p></div><div class="bg-white p-8 border border-slate-200 rounded-2xl shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Gross Profit</p><p class="text-4xl font-bold font-mono text-green-600">$${totalProfit.toLocaleString()}</p></div></div>` : ''}<div class="flex flex-wrap gap-2 mb-6"><button onclick="window.filterLogs('all')" class="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-full">ALL</button><button onclick="window.filterLogs('sale')" class="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-full">SALES</button><button onclick="window.filterLogs('transfer')" class="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-full">TRANSFERS</button><button onclick="window.filterLogs('consumption')" class="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-full">CONSUMPTION</button></div><div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table id="reportTable" class="w-full text-left"><thead class="bg-slate-50 border-b border-slate-200"><tr><th class="py-3 pl-4 text-xs font-bold text-slate-400 uppercase">Time & Date</th><th class="text-xs font-bold text-slate-400 uppercase">User Identity</th><th class="text-xs font-bold text-slate-400 uppercase">Item</th><th class="text-xs font-bold text-slate-400 uppercase">Action</th><th class="text-xs font-bold text-slate-400 uppercase">Details</th><th class="text-xs font-bold text-slate-400 uppercase">Qty</th></tr></thead><tbody id="logsBody"></tbody></table></div></div>`;
        window.filterLogs('all');
    } catch(e) { c.innerHTML = '<p class="text-red-500">Error.</p>'; }
}
window.filterLogs=(t)=>{let f=currentLogs;if(t==='sale')f=currentLogs.filter(l=>l.type==='sale');else if(t==='transfer')f=currentLogs.filter(l=>['pending_transfer','transfer_completed','receive'].includes(l.type));else if(t==='consumption')f=currentLogs.filter(l=>l.to_location_id&&l.locations?.type==='department');const b=document.getElementById('logsBody');if(!f.length){b.innerHTML='<tr><td colspan="6" class="text-center text-xs text-gray-400 py-12">No records found.</td></tr>';return;}b.innerHTML=f.map(l=>{const d=new Date(l.created_at);let a=l.type.replace('_',' ').toUpperCase(),c='bg-blue-50 text-blue-600',det=`${l.from_loc?.name||'-'} ➜ ${l.locations?.name||'-'}`;if(l.type==='sale'){c='bg-green-50 text-green-600';det='POS Sale';}if(l.type==='receive'){c='bg-slate-100 text-slate-600';det='Supplier Entry';}if(l.locations?.type==='department'){a='CONSUMPTION';c='bg-orange-50 text-orange-600';}const u=l.profiles?.full_name||'System',r=l.profiles?.role||'Unknown';return `<tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition"><td class="py-3 pl-4"><div class="font-bold text-slate-700 text-xs">${d.toLocaleDateString()}</div><div class="text-[10px] text-slate-400 font-mono">${d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div></td><td><div class="flex items-center gap-2"><div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">${u.charAt(0)}</div><div><div class="font-bold text-slate-900 text-xs">${u}</div><div class="text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50 px-1 rounded inline-block">${r}</div></div></div></td><td class="font-bold uppercase text-xs text-slate-700">${l.products?.name}</td><td><span class="font-bold uppercase ${c} text-[9px] tracking-widest px-2 py-1 rounded-full">${a}</span></td><td class="text-xs uppercase text-gray-500 font-medium">${det}</td><td class="font-mono font-bold text-slate-900">${l.quantity}</td></tr>`}).join('');}
window.exportCSV=()=>{let r=[["Date","Time","User","Role","Item","Action","Details","Qty"]],t=document.getElementById("logsBody");if(!t)return;t.querySelectorAll("tr").forEach(tr=>{let d=[];tr.querySelectorAll("td").forEach(td=>d.push(td.innerText.replace('\n',' ')));if(d.length)r.push([d[0],d[0],d[1],d[1],d[2],d[3],d[4],d[5]])});let c="data:text/csv;charset=utf-8,"+r.map(e=>e.join(",")).join("\n"),l=document.createElement("a");l.setAttribute("href",encodeURI(c));l.setAttribute("download",`Report.csv`);document.body.appendChild(l);l.click();}
async function renderApprovals(c){if(profile.role==='storekeeper')return;const q=await getPendingApprovals(profile.organization_id);const r=q.map(x=>`<tr><td class="font-bold text-sm uppercase py-3 pl-4">${x.products?.name}</td><td class="font-bold text-blue-600 font-mono">${x.quantity}</td><td class="text-xs text-slate-500 uppercase tracking-wide">To: ${x.to_loc?.name}</td><td class="text-right pr-4"><button onclick="window.approve('${x.id}','approved')" class="text-[10px] font-bold bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-700 shadow-sm">APPROVE</button></td></tr>`).join('');c.innerHTML=`<h1 class="text-3xl font-bold mb-8 uppercase text-slate-900">Approvals</h1><div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left"><tbody>${r.length?r:'<tr><td colspan="4" class="text-center text-xs text-slate-400 py-12">No pending approvals.</td></tr>'}</tbody></table></div></div>`;}
window.approve=async(id,s)=>{if(confirm('Authorize?'))try{await respondToApproval(id,s,profile.id);window.showNotification("Authorized","success");router('approvals');}catch(e){window.showNotification(e.message,"error");}}
async function renderStaff(c){const{data:a}=await supabase.from('profiles').select('*').eq('organization_id',profile.organization_id);const{data:p}=await supabase.from('staff_invites').select('*').eq('organization_id',profile.organization_id).eq('status','pending');c.innerHTML=`<div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase text-slate-900">Team</h1><button onclick="window.inviteModal()" class="btn-primary w-auto px-6 py-3 text-xs">+ Invite</button></div><div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left"><tbody>${a.map(s=>`<tr class="border-b border-slate-50 last:border-0"><td class="font-bold uppercase py-3 pl-4 text-slate-700">${s.full_name}</td><td class="text-xs font-bold text-blue-600 uppercase">${s.role}</td><td class="text-right pr-4 text-green-500 font-bold text-[10px] uppercase">ACTIVE</td></tr>`).join('')}${p.map(i=>`<tr class="bg-yellow-50"><td class="text-sm font-medium text-slate-600 py-3 pl-4">${i.email}</td><td class="text-xs font-bold text-slate-400 uppercase">${i.role}</td><td class="text-right pr-4 text-yellow-600 font-bold text-[10px] uppercase">PENDING</td></tr>`).join('')}</tbody></table></div></div>`;}
async function renderSettings(c){const{data:l}=await supabase.from('locations').select('*').eq('organization_id',profile.organization_id);c.innerHTML=`<div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase text-slate-900">Locations</h1><button onclick="window.addStoreModal()" class="btn-primary w-auto px-6 py-3 text-xs">+ Add Hub</button></div><div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left"><tbody>${l.map(x=>`<tr class="border-b border-slate-50 last:border-0"><td class="font-bold text-sm uppercase py-3 pl-4 text-slate-700">${x.name}</td><td class="text-xs font-bold uppercase text-gray-400">${x.type.replace('_',' ')}</td><td class="text-green-600 font-bold text-[9px] text-right pr-4 uppercase"><span class="bg-green-50 px-3 py-1 rounded-full">ACTIVE</span></td></tr>`).join('')}</tbody></table></div></div>`;}

// --- MODALS (CLEAN & SIMPLE) ---

window.addProductModal = () => { 
    if(profile.role !== 'manager') return; 
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase text-center">New Product</h3>
        <div class="input-group"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div>
        <div class="grid grid-cols-2 gap-5 mb-8"><div class="input-group mb-0"><label class="input-label">Cost</label><input id="pC" type="number" class="input-field"></div><div class="input-group mb-0"><label class="input-label">Selling</label><input id="pS" type="number" class="input-field"></div></div>
        <button onclick="window.execAddProduct()" class="btn-primary">Save</button>`;
    document.getElementById('modal').style.display = 'flex'; 
};

window.addStockModal = async () => {
    if(profile.role !== 'manager') return;
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).order('name');
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase text-center">Receive from Supplier</h3>
        <div class="input-group"><label class="input-label">Item</label><select id="sP" class="input-field cursor-pointer">${prods.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
        <div class="input-group"><label class="input-label">Store</label><select id="sL" class="input-field cursor-pointer">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
        <div class="input-group"><label class="input-label">Qty</label><input id="sQ" type="number" class="input-field"></div>
        <button onclick="window.execAddStock()" class="btn-primary mt-6">Confirm Entry</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.issueModal = async (name, id, fromLoc) => { 
    let { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id).neq('id', fromLoc);
    if(profile.role === 'storekeeper') locs = locs.filter(l => l.type === 'department');

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase text-center">Move Stock</h3>
        <div class="input-group"><label class="input-label">Item</label><input value="${name}" disabled class="input-field bg-slate-50 uppercase text-gray-500"></div>
        <div class="input-group"><label class="input-label">To Destination</label><select id="tTo" class="input-field cursor-pointer hover:border-black">${locs.map(l=>`<option value="${l.id}">${l.name} (${l.type.replace('_',' ')})</option>`).join('')}</select></div>
        <div class="input-group"><label class="input-label">Quantity</label><input id="tQty" type="number" class="input-field"></div>
        <button onclick="window.execIssue('${id}','${fromLoc}')" class="btn-primary mt-6">Request Transfer</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.inviteModal = async () => { 
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id); 
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-8 uppercase text-center">Invite Staff</h3>
        <div class="input-group"><label class="input-label">Email</label><input id="iE" class="input-field" placeholder="email@company.com"></div>
        <div class="input-group"><label class="input-label">Role</label><select id="iR" class="input-field cursor-pointer"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance</option></select></div>
        <div class="input-group"><label class="input-label">Assign Location</label><select id="iL" class="input-field cursor-pointer">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
        <button onclick="window.execInvite()" class="btn-primary mt-6">Send Invitation</button>`; 
    document.getElementById('modal').style.display = 'flex'; 
};

window.addStoreModal=()=>{ 
    document.getElementById('modal-content').innerHTML=`
    <h3 class="font-bold text-lg mb-8 uppercase text-center">Add Hub</h3>
    <div class="input-group"><label class="input-label">Name</label><input id="nN" class="input-field"></div>
    <div class="input-group"><label class="input-label">Type</label><select id="nT" class="input-field"><option value="main_store">Main Store</option><option value="camp_store">Camp Store</option><option value="department">Department</option></select></div>
    <button onclick="window.execAddStore()" class="btn-primary mt-6">Create</button>`; 
    document.getElementById('modal').style.display = 'flex'; 
};

// --- EXEC FUNCTIONS ---
window.execAddProduct = async () => { try { await supabase.from('products').insert({ name: document.getElementById('pN').value.toUpperCase(), cost_price: document.getElementById('pC').value, selling_price: document.getElementById('pS').value, organization_id: profile.organization_id }); document.getElementById('modal').style.display = 'none'; window.showNotification("Product Registered", "success"); router('inventory'); } catch(e) { window.showNotification(e.message, "error"); } };
window.execAddStock = async () => { try { const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value; if(!qty || qty <= 0) return window.showNotification("Invalid Quantity", "error"); await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id }); await supabase.from('transactions').insert({ organization_id: profile.organization_id, user_id: profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty }); document.getElementById('modal').style.display = 'none'; window.showNotification("Stock Received", "success"); router('inventory'); } catch(e) { window.showNotification(e.message, "error"); } };
window.execInvite = async () => { const email = document.getElementById('iE').value; if(!email.includes('@')) return window.showNotification("Invalid Email", "error"); await supabase.from('staff_invites').insert({ email, role: document.getElementById('iR').value, organization_id: profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' }); document.getElementById('modal').style.display = 'none'; window.showNotification("Invitation Sent", "success"); router('staff'); };
window.execIssue = async (pId, fId) => { try { await transferStock(pId, fId, document.getElementById('tTo').value, document.getElementById('tQty').value, profile.id, profile.organization_id); document.getElementById('modal').style.display = 'none'; window.showNotification("Transfer Requested", "success"); router('inventory'); } catch(e){ window.showNotification(e.message, "error"); }};
window.execAddStore=async()=>{ await createLocation(profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').style.display = 'none'; router('settings'); };
window.addCart=(n,p,id)=>{const x=cart.find(c=>c.id===id); if(x)x.qty++; else cart.push({name:n,price:p,id,qty:1}); window.renderCart();}
window.renderCart=()=>{ const l=document.getElementById('cart-list'), t=document.getElementById('cart-total'); if(!cart.length){l.innerHTML='<div class="text-center text-xs text-slate-300 py-8 font-bold uppercase tracking-widest">Empty Ticket</div>'; t.innerText='$0.00'; return;} let sum=0; l.innerHTML=cart.map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between text-xs font-bold uppercase text-slate-700"><span>${i.name} x${i.qty}</span><button onclick="window.remCart('${i.id}')" class="text-red-500 font-bold hover:text-red-700">X</button></div>`}).join(''); t.innerText='$'+sum.toFixed(2); }
window.remCart=(id)=>{cart=cart.filter(c=>c.id!==id); window.renderCart();}
window.checkout=async()=>{if(!cart.length) return; try{await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); window.showNotification("Sale Completed", "success"); cart=[]; window.renderCart(); router('bar');}catch(e){window.showNotification(e.message, "error");}}
