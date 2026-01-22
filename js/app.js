import { getSession, logout } from './auth.js';
import { getInventory, createLocation, processBarSale, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

// --- GLOBAL VARIABLES ---
window.profile = null;
window.currentLogs = [];
window.cart = []; 
window.baseCurrency = 'USD'; 
window.currencyRates = {};   
window.selectedCurrency = 'USD'; 
window.activePosLocationId = null;
window.cachedLocations = []; // 🔥 HII MPYA: Kwa ajili ya kutambua majina ya stoo kwenye report

const STRONG_CURRENCIES = ['USD', 'EUR', 'GBP'];
const SUPPORTED_CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES'];

// --- PREMIUM UTILITIES (Hizi zinatibu UI bila kuguza Logic) ---
window.closeModalOutside = (e) => { 
    if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none'; 
};

window.showNotification = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    const div = document.createElement('div');
    div.className = `px-6 py-4 rounded-2xl text-white font-bold shadow-2xl flex items-center gap-3 transition-all duration-500 transform translate-y-0 ${type === 'success' ? 'bg-[#0F172A]' : 'bg-red-600'}`;
    div.innerHTML = `<span>${message}</span>`;
    container.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 500); }, 3000);
};

// 🔥 HII NDIO MPYA: Badala ya ile 'confirm()' ya kizamani
window.premiumConfirm = (title, desc, btnText, callback) => {
    document.getElementById('action-title').innerText = title;
    document.getElementById('action-desc').innerText = desc;
    const btn = document.getElementById('action-btn');
    btn.innerText = btnText;
    
    // Reset button listeners
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    document.getElementById('action-modal').style.display = 'flex';
    
    newBtn.addEventListener('click', async () => {
        document.getElementById('action-modal').style.display = 'none';
        await callback();
    });
};

// 🔥 HII NDIO MPYA: Kuona Profile ya mtu (Detailed)
window.viewUserProfile = async (userId) => {
    if(!userId) return;
    try {
        const { data: user } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if(!user) return;
        
        // Tafuta jina la stoo aliyo-assigned
        const assignedLoc = window.cachedLocations.find(l => l.id === user.assigned_location_id)?.name || 'Unassigned';

        document.getElementById('pv-name').innerText = user.full_name || 'Unknown';
        document.getElementById('pv-role').innerText = `${user.role} • ${assignedLoc}`;
        document.getElementById('pv-initials').innerText = (user.full_name || 'U').charAt(0).toUpperCase();
        document.getElementById('pv-phone').innerText = user.phone || 'Not Listed';
        document.getElementById('pv-email').innerText = "System User"; 

        document.getElementById('profile-viewer').style.display = 'flex';
    } catch(e) { console.error(e); }
};

// --- CURRENCY LOGIC (Hii ni ileile yako ya zamani) ---
window.initCurrency = async () => {
    if (!window.profile) return;
    try {
        const { data: org } = await supabase.from('organizations').select('base_currency').eq('id', window.profile.organization_id).single();
        if (org) {
            window.baseCurrency = org.base_currency;
            if (!localStorage.getItem('user_pref_currency')) window.selectedCurrency = window.baseCurrency; 
        }
        const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', window.profile.organization_id);
        window.currencyRates = {};
        window.currencyRates[window.baseCurrency] = 1;
        if (rates && rates.length > 0) rates.forEach(r => window.currencyRates[r.currency_code] = Number(r.rate));
    } catch (e) { console.error("Currency Error:", e); }
};

window.convertAmount = (amount, fromCurr, toCurr) => {
    if (!amount) return 0;
    const fromRate = window.currencyRates[fromCurr];
    const toRate = window.currencyRates[toCurr];
    if (fromCurr !== toCurr && (!fromRate || !toRate)) return null; 
    if (fromCurr === window.baseCurrency) return amount * toRate;
    if (toCurr === window.baseCurrency) return amount / fromRate;
    return amount; 
};

window.formatPrice = (amount) => {
    if (!amount && amount !== 0) return '-';
    const converted = window.convertAmount(amount, window.baseCurrency, window.selectedCurrency);
    if (converted === null) return `<span class="text-red-500 font-bold text-[10px] bg-red-50 px-1 rounded">SET RATE</span>`;
    return `${window.selectedCurrency} ${Number(converted).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
};

window.changeCurrency = (curr) => {
    window.selectedCurrency = curr;
    const activeEl = document.querySelector('.nav-item.nav-active');
    if (activeEl) window.router(activeEl.id.replace('nav-', ''));
};

window.getCurrencySelectorHTML = () => {
    const options = SUPPORTED_CURRENCIES.map(c => `<option value="${c}" ${window.selectedCurrency === c ? 'selected' : ''}>${c}</option>`).join('');
    return `<select onchange="window.changeCurrency(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer ml-4">${options}</select>`;
};

// --- INITIALIZATION (Updated to Cache Locations & Check Phone) ---
window.onload = async () => {
    window.logoutAction = logout;
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        let { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (!prof) {
            await new Promise(r => setTimeout(r, 1000));
            let retry = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
            prof = retry.data;
        }
        if (!prof || !prof.organization_id) { window.location.href = 'setup.html'; return; }
        
        window.profile = prof;

        // 🔥 FETCH LOCATIONS (Muhimu kwa report context)
        const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
        window.cachedLocations = locs || [];

        await window.initCurrency();
        
        // Permissions Logic (Yako ya zamani)
        const role = window.profile.role;
        const hide = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
        if (role === 'finance') hide(['nav-bar', 'nav-settings', 'nav-staff']); 
        else if (role === 'storekeeper') hide(['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings']);
        else if (role === 'barman') hide(['nav-inventory', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);

        // Check Name & Phone (Premium Setup)
        if ((window.profile.full_name || '').length < 3) document.getElementById('name-modal').style.display = 'flex';

        window.router(role === 'barman' ? 'bar' : 'inventory');

    } catch (e) { console.error("Boot Error:", e); }
};

// Updated Save Name (Includes Phone)
window.saveName = async () => {
    const name = document.getElementById('userNameInput').value;
    const phone = document.getElementById('userPhoneInput').value;
    
    if (name.length < 3) return window.showNotification("Invalid Name", "error");
    if (phone.length < 9) return window.showNotification("Invalid Phone", "error");

    await supabase.from('profiles').update({ full_name: name, phone: phone }).eq('id', window.profile.id);
    document.getElementById('name-modal').style.display = 'none';
    location.reload();
};

// --- ROUTER ---
window.router = async (view) => {
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div></div>';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active'));
    const navEl = document.getElementById(`nav-${view}`);
    if(navEl) navEl.classList.add('nav-active');

    setTimeout(async () => {
        try {
            if (view === 'inventory') await window.renderInventory(app);
            else if (view === 'bar') await window.renderBar(app);
            else if (view === 'approvals') await window.renderApprovals(app);
            else if (view === 'reports') await window.renderReports(app);
            else if (view === 'staff') await window.renderStaff(app);
            else if (view === 'settings') await window.renderSettings(app);
        } catch (e) {
            console.error(e);
            app.innerHTML = `<div class="p-10 text-red-500 font-bold text-center">Error loading ${view}: ${e.message}</div>`;
        }
    }, 50);
};

// ================= MODULES =================

// 1. INVENTORY (Added Premium Confirm for Receive)
window.renderInventory = async (c) => {
    const isPOView = window.currentInvView === 'po'; 
    const stock = await getInventory(window.profile.organization_id);
    const filteredStock = (window.profile.role === 'manager' || window.profile.role === 'finance') ? stock : stock.filter(x => x.location_id === window.profile.assigned_location_id);
    const showPrice = window.profile.role === 'manager' || window.profile.role === 'finance';

    let content = '';
    if (isPOView) {
        const { data: pos } = await supabase.from('purchase_orders').select('*').eq('organization_id', window.profile.organization_id).order('created_at', {ascending:false});
        content = `<table class="w-full text-left"><thead class="bg-slate-50 border-b"><tr><th class="py-3 pl-4">Date</th><th>Supplier</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>
        ${(pos||[]).map(p => `<tr><td class="py-3 pl-4 text-xs font-bold">${new Date(p.created_at).toLocaleDateString()}</td><td class="text-xs font-bold uppercase">${p.supplier_name}</td><td class="text-xs font-mono">${window.formatPrice(p.total_cost)}</td><td><span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${p.status==='Pending'?'bg-yellow-100 text-yellow-800':'bg-green-100 text-green-800'}">${p.status}</span></td><td>${p.status==='Pending'?`<button onclick="window.confirmReceive('${p.id}')" class="text-[10px] bg-slate-900 text-white px-3 py-1 rounded">RECEIVE</button>`:'-'}</td></tr>`).join('')}
        </tbody></table>`;
    } else {
        content = `<table class="w-full text-left"><thead class="bg-slate-50 border-b"><tr><th class="py-3 pl-4">Item</th>${showPrice?`<th>Cost</th><th>Price</th>`:''}<th>Store</th><th>Qty</th><th>Action</th></tr></thead><tbody>
        ${filteredStock.map(i => `<tr><td class="py-3 pl-4"><div class="font-bold uppercase text-xs">${i.products?.name}</div><div class="text-[9px] text-slate-400 font-bold uppercase">${i.products?.category}</div></td>${showPrice?`<td class="font-mono text-xs">${window.formatPrice(i.products.cost_price)}</td><td class="font-mono text-xs font-bold">${window.formatPrice(i.products.selling_price)}</td>`:''} <td class="text-xs font-bold text-gray-500 uppercase">${i.locations?.name}</td><td class="font-mono font-bold text-lg">${i.quantity} <span class="text-[9px] text-slate-400">${i.products?.unit}</span></td><td class="text-right pr-4">${window.profile.role!=='barman'?`<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold border px-3 py-1 rounded hover:bg-slate-50">MOVE</button>`:''}</td></tr>`).join('')}
        </tbody></table>`;
    }

    c.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-center gap-4 mb-8">
        <div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900">Inventory</h1>${showPrice ? window.getCurrencySelectorHTML() : ''}</div>
        <div class="flex gap-2 bg-slate-100 p-1 rounded-full">
            <button onclick="window.currentInvView='stock'; window.router('inventory')" class="px-5 py-2 text-xs font-bold rounded-full ${!isPOView?'bg-white shadow text-slate-900':'text-slate-500'}">STOCK</button>
            <button onclick="window.currentInvView='po'; window.router('inventory')" class="px-5 py-2 text-xs font-bold rounded-full ${isPOView?'bg-white shadow text-slate-900':'text-slate-500'}">LPO</button>
        </div>
        <div class="flex gap-2">${window.profile.role==='manager'?`<button onclick="window.createPOModal()" class="btn-primary w-auto px-4 bg-blue-600">Create LPO</button><button onclick="window.addProductModal()" class="btn-primary w-auto px-4">New Item</button>`:''}</div>
    </div>
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">${content}</div>`;
};

// 2. BAR (Logic Yako ya Zamani 100%)
window.renderBar = async (c) => {
    const inv = await getInventory(window.profile.organization_id);
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).eq('type', 'department');
    
    if (window.profile.role === 'barman') window.activePosLocationId = window.profile.assigned_location_id;
    else if (!window.activePosLocationId && locs.length) window.activePosLocationId = locs[0].id;

    const items = inv.filter(x => x.location_id === window.activePosLocationId && (x.products.category === 'Beverage' || !x.products.category));
    const storeSelect = (window.profile.role !== 'barman') ? `<select onchange="window.switchBar(this.value)" class="bg-white border rounded px-3 py-2 text-sm font-bold mb-4">${locs.map(l => `<option value="${l.id}" ${window.activePosLocationId===l.id?'selected':''}>${l.name}</option>`).join('')}</select>` : '';

    c.innerHTML = `
    ${storeSelect}
    <div class="flex flex-col lg:flex-row gap-6 h-[calc(100vh-140px)]">
        <div class="flex-1 overflow-y-auto">
            <div class="flex justify-between items-center mb-4 sticky top-0 bg-slate-50 py-2 z-10"><h1 class="text-2xl font-bold uppercase">POS Terminal</h1>${window.getCurrencySelectorHTML()}</div>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                ${items.map(x => `<div onclick="window.addCart('${x.products.name}', ${x.products.selling_price}, '${x.product_id}')" class="bg-white p-4 border rounded-xl cursor-pointer hover:border-slate-900 transition relative overflow-hidden shadow-sm"><div class="absolute top-0 right-0 bg-slate-100 px-2 py-1 text-[10px] font-bold rounded-bl-lg">Qty: ${x.quantity}</div><p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">${x.products.name}</p><p class="text-lg font-bold text-slate-900">${window.formatPrice(x.products.selling_price)}</p></div>`).join('')}
            </div>
        </div>
        <div class="w-full lg:w-96 bg-white border rounded-2xl p-6 h-full flex flex-col shadow-xl">
            <div class="flex justify-between items-center mb-4"><h3 class="font-bold text-sm uppercase">Ticket</h3><button onclick="window.cart=[];window.renderCart()" class="text-[10px] font-bold text-red-500">CLEAR</button></div>
            <div id="cart-list" class="flex-1 overflow-y-auto space-y-2"></div>
            <div class="pt-4 border-t mt-auto"><div class="flex justify-between text-xl font-bold mb-4"><span>Total</span><span id="cart-total">${window.formatPrice(0)}</span></div><button onclick="window.confirmCheckout()" class="btn-primary py-4 text-sm shadow-lg">CHARGE</button></div>
        </div>
    </div>`;
    window.renderCart();
};

window.switchBar = (id) => { window.activePosLocationId = id; window.router('bar'); };
window.addCart = (n,p,id) => { if(!window.cart) window.cart=[]; const x=window.cart.find(c=>c.id===id); if(x)x.qty++; else window.cart.push({name:n,price:p,id,qty:1}); window.renderCart(); };
window.renderCart = () => { 
    const l=document.getElementById('cart-list'), t=document.getElementById('cart-total'); 
    let sum=0; 
    l.innerHTML=(window.cart||[]).map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between text-xs font-bold p-2 bg-slate-50 rounded border border-slate-100"><span>${i.name} x${i.qty}</span><button onclick="window.remCart('${i.id}')" class="text-red-500">X</button></div>`}).join(''); 
    t.innerText=window.formatPrice(sum); 
};
window.remCart = (id) => { window.cart=window.cart.filter(c=>c.id!==id); window.renderCart(); };
// 🔥 NEW: Premium Checkout Confirmation
window.confirmCheckout = () => {
    if(!window.cart.length) return;
    window.premiumConfirm("Confirm Sale", "Process this transaction?", "Charge", window.doCheckout);
};
window.doCheckout = async () => {
    try {
        await processBarSale(window.profile.organization_id, window.activePosLocationId, window.cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), window.profile.id); 
        window.showNotification("Sale Complete", "success"); 
        window.cart=[]; window.renderCart(); window.router('bar');
    } catch(e) { window.showNotification(e.message, "error"); }
};

// 3. APPROVALS (Added Premium Confirm)
window.renderApprovals = async (c) => {
    if(window.profile.role === 'storekeeper') return c.innerHTML = '<div class="p-10 text-center">Access Denied</div>';
    const reqs = await getPendingApprovals(window.profile.organization_id);
    c.innerHTML = `
    <h1 class="text-3xl font-bold mb-8 uppercase text-slate-900">Pending Approvals</h1>
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>
    ${reqs.length ? reqs.map(r => `<tr class="border-b"><td class="p-4 font-bold text-sm uppercase">${r.products?.name}</td><td class="text-blue-600 font-mono font-bold">${r.quantity}</td><td class="text-xs uppercase text-slate-500">To: ${r.to_loc?.name}</td><td class="text-right p-4"><button onclick="window.confirmApprove('${r.id}')" class="text-[10px] bg-slate-900 text-white px-4 py-2 rounded font-bold">APPROVE</button></td></tr>`).join('') : '<tr><td colspan="4" class="p-8 text-center text-xs text-slate-400">No pending requests.</td></tr>'}
    </tbody></table></div>`;
};
window.confirmApprove = (id) => { window.premiumConfirm("Approve Transfer", "Authorize this stock movement?", "Authorize", async () => { try{await respondToApproval(id, 'approved', window.profile.id); window.showNotification("Approved","success"); window.router('approvals');}catch(e){window.showNotification(e.message,"error");} }); };

// 4. REPORTS (🔥 HAPA NDIPO KUNA MABADILIKO MAKUBWA: Detailed)
window.renderReports = async (c) => {
    const isVariance = window.currentRepView === 'variance';
    const showFinancials = (window.profile.role === 'manager' || window.profile.role === 'finance');

    if(isVariance) {
        const { data: takes } = await supabase.from('stock_takes').select('*, locations(name), profiles(full_name, role, phone, id, assigned_location_id)').eq('organization_id', window.profile.organization_id).order('created_at', {ascending:false});
        c.innerHTML = `
        <div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase text-slate-900">Reconciliation</h1>
            <div class="flex gap-2 bg-slate-100 p-1 rounded-full"><button onclick="window.currentRepView='general'; window.router('reports')" class="px-5 py-2 text-xs font-bold rounded-full text-slate-500">GENERAL</button><button class="px-5 py-2 text-xs font-bold rounded-full bg-white shadow text-slate-900">VARIANCE</button></div>
            <button onclick="window.newStockTakeModal()" class="btn-primary w-auto px-6 bg-slate-900">NEW STOCK TAKE</button>
        </div>
        <div class="bg-white rounded-2xl border shadow-sm"><table class="w-full text-left"><thead><tr class="bg-slate-50 border-b"><th class="p-3 text-xs uppercase">Date</th><th>Location</th><th>User</th><th>Action</th></tr></thead><tbody>
        ${(takes||[]).map(t => {
            const locName = window.cachedLocations.find(l => l.id === t.profiles?.assigned_location_id)?.name || 'Unassigned';
            return `<tr><td class="p-3 text-xs font-bold">${new Date(t.created_at).toLocaleDateString()}</td><td class="text-xs uppercase">${t.locations?.name}</td><td class="text-xs"><button onclick="window.viewUserProfile('${t.conducted_by}')" class="font-bold text-slate-900 hover:text-blue-600 transition flex flex-col text-left"><span class="uppercase">${t.profiles?.full_name}</span><span class="text-[9px] text-slate-400 uppercase tracking-wider">${t.profiles?.role} &bull; ${locName}</span></button></td><td><button onclick="window.viewVariance('${t.id}')" class="text-blue-600 font-bold text-[10px] underline">VIEW</button></td></tr>`;
        }).join('')}
        </tbody></table></div>`;
    } else {
        const { data: logs } = await supabase.from('transactions').select(`*, products (name, category), locations:to_location_id (name), from_loc:from_location_id (name), profiles:user_id (full_name, role, phone, id, assigned_location_id)`).eq('organization_id', window.profile.organization_id).order('created_at', { ascending: false }).limit(200);
        window.currentLogs = logs || [];
        const totalSales = window.currentLogs.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.total_value) || 0), 0);
        const totalProfit = window.currentLogs.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.profit) || 0), 0);

        c.innerHTML = `
        <div class="flex justify-between items-center mb-8 gap-4"><div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900">Reports</h1>${showFinancials ? window.getCurrencySelectorHTML() : ''}</div>
            <div class="flex gap-2 bg-slate-100 p-1 rounded-full"><button class="px-5 py-2 text-xs font-bold rounded-full bg-white shadow text-slate-900">GENERAL</button><button onclick="window.currentRepView='variance'; window.router('reports')" class="px-5 py-2 text-xs font-bold rounded-full text-slate-500 hover:text-slate-700">VARIANCE</button></div>
            <button onclick="window.exportCSV()" class="btn-primary w-auto px-4 bg-green-700 hover:bg-green-800">EXPORT CSV</button>
        </div>
        ${showFinancials ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8"><div class="bg-white p-6 border rounded-2xl shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-2">Total Revenue</p><p class="text-3xl font-mono font-bold text-slate-900">${window.formatPrice(totalSales)}</p></div><div class="bg-white p-6 border rounded-2xl shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-2">Gross Profit</p><p class="text-3xl font-mono font-bold text-green-600">${window.formatPrice(totalProfit)}</p></div></div>` : ''}
        <div class="flex gap-2 mb-4 overflow-x-auto pb-2">
            <button onclick="window.filterLogs('all')" class="px-4 py-1.5 bg-slate-900 text-white text-[10px] font-bold rounded-full">ALL</button>
            <button onclick="window.filterLogs('sale')" class="px-4 py-1.5 bg-white border text-slate-600 text-[10px] font-bold rounded-full">SALES</button>
            <button onclick="window.filterLogs('transfer')" class="px-4 py-1.5 bg-white border text-slate-600 text-[10px] font-bold rounded-full">TRANSFERS</button>
            <button onclick="window.filterLogs('consumption')" class="px-4 py-1.5 bg-white border text-slate-600 text-[10px] font-bold rounded-full">CONSUMPTION</button>
        </div>
        <div class="bg-white rounded-2xl border shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left" id="reportTable"><thead class="bg-slate-50 border-b"><tr><th class="p-3 pl-4 text-xs uppercase">Date</th><th class="text-xs uppercase">User Profile</th><th class="text-xs uppercase">Item</th><th class="text-xs uppercase">Type</th><th class="text-xs uppercase">Detail</th><th class="text-xs uppercase">Qty</th></tr></thead><tbody id="logsBody"></tbody></table></div></div>`;
        window.filterLogs('all');
    }
};

window.filterLogs = (type) => {
    let f = window.currentLogs || [];
    if(type === 'sale') f = f.filter(l => l.type === 'sale');
    if(type === 'transfer') f = f.filter(l => ['pending_transfer', 'transfer_completed', 'receive'].includes(l.type));
    if(type === 'consumption') f = f.filter(l => l.to_location_id && l.locations?.type === 'department');
    
    const b = document.getElementById('logsBody');
    if(!b) return;
    b.innerHTML = f.map(l => {
        const locName = window.cachedLocations.find(loc => loc.id === l.profiles?.assigned_location_id)?.name || 'Unassigned';
        let tag = l.type.toUpperCase(), det = `${l.from_loc?.name||'-'} ➜ ${l.locations?.name||'-'}`;
        if(l.type === 'sale') { tag='SALE'; det='POS'; }
        if(l.type === 'receive') { tag='IN'; det='Supplier'; }
        return `<tr class="border-b hover:bg-slate-50"><td class="p-3 pl-4 text-xs font-bold text-slate-600">${new Date(l.created_at).toLocaleDateString()} <span class="block text-[10px] text-slate-400 font-normal">${new Date(l.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span></td>
        <td class="text-xs"><button onclick="window.viewUserProfile('${l.profiles?.id}')" class="font-bold text-slate-900 hover:text-blue-600 transition flex flex-col text-left"><span class="uppercase">${l.profiles?.full_name || 'System'}</span><span class="text-[9px] text-slate-400 uppercase tracking-wider">${l.profiles?.role || '-'} &bull; ${locName}</span></button></td>
        <td class="text-xs font-bold uppercase">${l.products?.name}</td><td><span class="text-[9px] font-bold px-2 py-1 rounded bg-slate-100 border border-slate-200">${tag}</span></td><td class="text-xs text-slate-500">${det}</td><td class="font-mono text-sm font-bold">${l.quantity}</td></tr>`;
    }).join('');
};

window.exportCSV = () => {
    let rows = [["Date","Time","User Name","Role","Assigned Location","Item","Category","Transaction Type","Location Flow","Quantity","Value"]];
    window.currentLogs.forEach(l => {
        const locName = window.cachedLocations.find(loc => loc.id === l.profiles?.assigned_location_id)?.name || 'Unassigned';
        rows.push([new Date(l.created_at).toLocaleDateString(), new Date(l.created_at).toLocaleTimeString(), l.profiles?.full_name, l.profiles?.role, locName, l.products?.name, l.products?.category, l.type, `${l.from_loc?.name||''}->${l.locations?.name||''}`, l.quantity, l.total_value||0]);
    });
    let csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    let link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `Full_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
};

window.confirmReceive = (id) => { window.premiumConfirm("Confirm Receipt", "Received stock from supplier?", "Receive", () => window.receivePO(id)); };

// 5. STAFF (Logic Yako)
window.renderStaff = async (c) => {
    const { data: staff } = await supabase.from('profiles').select('*').eq('organization_id', window.profile.organization_id);
    const { data: inv } = await supabase.from('staff_invites').select('*').eq('organization_id', window.profile.organization_id).eq('status', 'pending');
    c.innerHTML = `
    <div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase text-slate-900">Team</h1><button onclick="window.inviteModal()" class="btn-primary w-auto px-6">+ INVITE</button></div>
    <div class="bg-white rounded-2xl border shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>
    ${staff.map(s => `<tr class="border-b"><td class="p-4 font-bold text-sm uppercase">${s.full_name}</td><td class="text-xs uppercase font-bold text-blue-600">${s.role}</td><td class="text-right p-4"><span class="text-[9px] bg-green-100 text-green-800 px-2 py-1 rounded font-bold">ACTIVE</span></td></tr>`).join('')}
    ${inv.map(i => `<tr class="bg-yellow-50 border-b"><td class="p-4 text-sm font-medium text-slate-600">${i.email}</td><td class="text-xs uppercase text-slate-400">${i.role}</td><td class="text-right p-4"><span class="text-[9px] bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-bold">PENDING</span></td></tr>`).join('')}
    </tbody></table></div>`;
};

// 6. SETTINGS (Logic Yako)
window.renderSettings = async (c) => {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
    const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', window.profile.organization_id);
    const rateMap = {};
    if(rates) rates.forEach(r => rateMap[r.currency_code] = r.rate);
    const rateRows = ['TZS', 'USD', 'EUR', 'GBP', 'KES'].map(code => {
        const isBase = code === window.baseCurrency;
        const val = isBase ? 1 : (rateMap[code] || '');
        return `<div class="flex justify-between items-center border-b py-3 last:border-0"><div class="flex gap-3 items-center"><div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold">${code[0]}</div><div><p class="font-bold text-sm">${code}</p><p class="text-[10px] text-slate-400 font-bold">${isBase?'Base':'Foreign'}</p></div></div><div>${isBase?'<span class="font-mono px-4 text-slate-400">1.00</span>':`<input id="rate-${code}" type="number" value="${val}" placeholder="Rate..." class="w-24 border rounded px-2 py-1 text-right font-mono font-bold text-sm">`}</div></div>`;
    }).join('');

    c.innerHTML = `
    <h1 class="text-3xl font-bold uppercase text-slate-900 mb-8">Settings</h1>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div class="bg-white rounded-2xl border shadow-sm p-6">
            <div class="flex justify-between items-center mb-4 pb-4 border-b"><h3 class="font-bold text-sm uppercase">Locations</h3><button onclick="window.addStoreModal()" class="text-[10px] bg-slate-900 text-white px-3 py-1 rounded font-bold">+ ADD</button></div>
            <table class="w-full text-left"><tbody>${locs.map(l => `<tr class="border-b last:border-0"><td class="py-3 font-bold text-sm uppercase">${l.name}</td><td class="text-xs text-slate-400 uppercase">${l.type}</td><td class="text-right"><span class="text-[9px] bg-green-100 text-green-800 px-2 py-1 rounded font-bold">ACTIVE</span></td></tr>`).join('')}</tbody></table>
        </div>
        <div class="bg-white rounded-2xl border shadow-sm p-6">
            <div class="flex justify-between items-center mb-4 pb-4 border-b"><h3 class="font-bold text-sm uppercase">Exchange Rates</h3></div>
            ${rateRows}
            <button onclick="window.saveRates()" class="btn-primary mt-6">UPDATE RATES</button>
        </div>
    </div>`;
};

window.saveRates = async () => {
    const updates = [];
    ['TZS', 'USD', 'EUR', 'GBP', 'KES'].forEach(code => {
        if (code === window.baseCurrency) return;
        const val = document.getElementById(`rate-${code}`).value;
        if(val) updates.push({ organization_id: window.profile.organization_id, currency_code: code, rate: parseFloat(val) });
    });
    if(!updates.length) return;
    const { error } = await supabase.from('exchange_rates').upsert(updates, { onConflict: 'organization_id, currency_code' });
    if(error) return window.showNotification("Error updating rates", "error");
    await window.initCurrency();
    window.showNotification("Rates Updated", "success");
    window.renderSettings(document.getElementById('app-view'));
};

// --- MODALS (Logic Yako Zote) ---
window.addProductModal = () => {
    if(window.profile.role !== 'manager') return;
    const opts = SUPPORTED_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-6 uppercase text-center">New Product</h3>
    <div class="input-group"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div>
    <div class="grid grid-cols-2 gap-4 mb-4">
        <div class="input-group mb-0"><label class="input-label">Category</label><select id="pCat" class="input-field"><option value="Food">Food</option><option value="Beverage">Beverage</option><option value="Supplies">Supplies</option></select></div>
        <div class="input-group mb-0"><label class="input-label">Unit</label><select id="pUnit" class="input-field"><option value="Pcs">Pcs</option><option value="Kg">Kg</option><option value="Ltr">Ltr</option><option value="Box">Box</option></select></div>
    </div>
    <div class="input-group mb-4"><label class="input-label">Currency</label><select id="pCurrency" class="input-field cursor-pointer bg-slate-50 font-bold text-slate-700">${opts}</select></div>
    <div class="grid grid-cols-2 gap-4 mb-6"><div class="input-group mb-0"><label class="input-label">Cost</label><input id="pC" type="number" class="input-field"></div><div class="input-group mb-0"><label class="input-label">Selling</label><input id="pS" type="number" class="input-field"></div></div>
    <button onclick="window.execAddProduct()" class="btn-primary">SAVE PRODUCT</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execAddProduct = async () => {
    const name = document.getElementById('pN').value.toUpperCase();
    const cat = document.getElementById('pCat').value;
    const unit = document.getElementById('pUnit').value;
    const curr = document.getElementById('pCurrency').value;
    const cost = parseFloat(document.getElementById('pC').value);
    const selling = parseFloat(document.getElementById('pS').value);
    if(!name || isNaN(cost)) return window.showNotification("Invalid input", "error");
    const costBase = window.convertAmount(cost, curr, window.baseCurrency);
    const sellingBase = window.convertAmount(selling, curr, window.baseCurrency);
    if(costBase === null) return window.showNotification(`Set rate for ${curr} first`, "error");
    await supabase.from('products').insert({ name, category: cat, unit, cost_price: costBase, selling_price: sellingBase, organization_id: window.profile.organization_id });
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Product Added", "success");
    window.router('inventory');
};

window.createPOModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', window.profile.organization_id).order('name');
    if(!prods || !prods.length) return window.showNotification("No products found. Add items first.", "error");
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-6 uppercase text-center">Create LPO</h3>
    <div class="input-group"><label class="input-label">Supplier</label><input id="lpoSup" class="input-field"></div>
    <div class="bg-slate-50 p-4 rounded-xl border mb-4 max-h-60 overflow-y-auto">
        ${prods.map(p => `<div class="flex items-center gap-2 mb-2"><input type="checkbox" class="lpo-check w-4 h-4" value="${p.id}" data-price="${p.cost_price}"><span class="flex-1 text-xs font-bold uppercase">${p.name}</span><input type="number" id="qty-${p.id}" class="w-16 input-field p-1 text-xs" placeholder="Qty"></div>`).join('')}
    </div>
    <button onclick="window.execCreatePO()" class="btn-primary">GENERATE ORDER</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execCreatePO = async () => {
    const sup = document.getElementById('lpoSup').value;
    const checks = document.querySelectorAll('.lpo-check:checked');
    if(!sup || !checks.length) return window.showNotification("Invalid Order", "error");
    let total = 0, items = [];
    checks.forEach(c => {
        const qty = document.getElementById(`qty-${c.value}`).value;
        if(qty > 0) {
            const cost = c.getAttribute('data-price');
            total += (qty * cost);
            items.push({ product_id: c.value, quantity: qty, unit_cost: cost });
        }
    });
    const { data: po } = await supabase.from('purchase_orders').insert({ organization_id: window.profile.organization_id, created_by: window.profile.id, supplier_name: sup, total_cost: total, status: 'Pending' }).select().single();
    await supabase.from('po_items').insert(items.map(i => ({...i, po_id: po.id})));
    document.getElementById('modal').style.display = 'none';
    window.showNotification("LPO Created", "success");
    window.currentInvView = 'po'; window.router('inventory');
};

window.receivePO = async (id) => {
    // Note: Premium Confirm used here
    const { data: items } = await supabase.from('po_items').select('*').eq('po_id', id);
    const { data: mainStore } = await supabase.from('locations').select('id').eq('organization_id', window.profile.organization_id).eq('type', 'main_store').single();
    for(const item of items) {
        await supabase.rpc('add_stock_safe', { p_product_id: item.product_id, p_location_id: mainStore.id, p_quantity: item.quantity, p_org_id: window.profile.organization_id });
        await supabase.from('transactions').insert({ organization_id: window.profile.organization_id, user_id: window.profile.id, product_id: item.product_id, to_location_id: mainStore.id, type: 'receive', quantity: item.quantity });
    }
    await supabase.from('purchase_orders').update({ status: 'Received' }).eq('id', id);
    window.showNotification("Stock Received", "success");
    window.router('inventory');
};

window.addStockModal = async () => { 
    if(window.profile.role !== 'manager') return;
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', window.profile.organization_id).order('name');
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-6 uppercase text-center">Receive Stock</h3>
    <div class="input-group"><label class="input-label">Item</label><select id="sP" class="input-field">${prods.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
    <div class="input-group"><label class="input-label">Store</label><select id="sL" class="input-field">${locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
    <div class="input-group"><label class="input-label">Qty</label><input id="sQ" type="number" class="input-field"></div>
    <button onclick="window.execAddStock()" class="btn-primary">CONFIRM</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execAddStock = async () => {
    const pid = document.getElementById('sP').value;
    const lid = document.getElementById('sL').value;
    const qty = document.getElementById('sQ').value;
    if(qty <= 0) return;
    await supabase.rpc('add_stock_safe', { p_product_id: pid, p_location_id: lid, p_quantity: qty, p_org_id: window.profile.organization_id });
    await supabase.from('transactions').insert({ organization_id: window.profile.organization_id, user_id: window.profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty });
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Stock Added", "success");
    window.router('inventory');
};

window.issueModal = async (name, id, fromLoc) => {
    window.selectedDestinationId = null;
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).neq('id', fromLoc);
    const html = locs.map(l => `<div onclick="window.selectDest(this, '${l.id}')" class="dest-card border p-3 rounded cursor-pointer hover:bg-slate-50 text-center"><span class="font-bold text-xs uppercase">${l.name}</span></div>`).join('');
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-4 uppercase text-center">Move: ${name}</h3>
    <div class="grid grid-cols-2 gap-2 mb-4 max-h-40 overflow-y-auto">${html}</div>
    <div class="input-group"><label class="input-label">Quantity</label><input id="tQty" type="number" class="input-field"></div>
    <button onclick="window.execIssue('${id}', '${fromLoc}')" class="btn-primary">TRANSFER</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.selectDest = (el, id) => {
    document.querySelectorAll('.dest-card').forEach(c => c.classList.remove('bg-slate-900', 'text-white'));
    el.classList.add('bg-slate-900', 'text-white');
    window.selectedDestinationId = id;
};

window.execIssue = async (pid, fromLoc) => {
    const qty = document.getElementById('tQty').value;
    if(!window.selectedDestinationId || qty <= 0) return window.showNotification("Invalid Selection", "error");
    try {
        await transferStock(pid, fromLoc, window.selectedDestinationId, qty, window.profile.id, window.profile.organization_id);
        document.getElementById('modal').style.display = 'none';
        window.showNotification("Request Sent", "success");
    } catch(e) { window.showNotification(e.message, "error"); }
};

window.inviteModal = async () => {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-6 uppercase text-center">Invite Staff</h3>
    <div class="input-group"><label class="input-label">Email</label><input id="iE" class="input-field"></div>
    <div class="input-group"><label class="input-label">Role</label><select id="iR" class="input-field"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance</option></select></div>
    <div class="input-group"><label class="input-label">Assign</label><select id="iL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
    <button onclick="window.execInvite()" class="btn-primary">SEND INVITE</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execInvite = async () => {
    const email = document.getElementById('iE').value;
    if(!email) return;
    await supabase.from('staff_invites').insert({ email, role: document.getElementById('iR').value, organization_id: window.profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' });
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Sent", "success");
    window.router('staff');
};

window.addStoreModal = () => {
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-6 uppercase text-center">Add Location</h3>
    <div class="input-group"><label class="input-label">Name</label><input id="nN" class="input-field"></div>
    <div class="input-group"><label class="input-label">Type</label><select id="nT" class="input-field"><option value="main_store">Main Store</option><option value="camp_store">Camp Store</option><option value="department">Department</option></select></div>
    <button onclick="window.execAddStore()" class="btn-primary">CREATE</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execAddStore = async () => {
    await createLocation(window.profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value);
    document.getElementById('modal').style.display = 'none';
    window.router('settings');
};

// Stock Take
window.newStockTakeModal = async () => {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-6 uppercase text-center">New Stock Take</h3>
    <div class="input-group"><label class="input-label">Location</label><select id="stLoc" class="input-field">${locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
    <button onclick="window.startStockTake()" class="btn-primary">START</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.startStockTake = async () => {
    const locId = document.getElementById('stLoc').value;
    const inv = await getInventory(window.profile.organization_id);
    const items = inv.filter(x => x.location_id === locId);
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-4 uppercase text-center">Count Items</h3>
    <div class="bg-slate-50 p-2 rounded max-h-60 overflow-y-auto mb-4 border">
        ${items.map(i => `<div class="flex justify-between items-center mb-2"><span class="text-xs font-bold w-1/2">${i.products.name}</span><input type="number" class="st-input w-20 border rounded p-1 text-center" data-id="${i.product_id}" data-sys="${i.quantity}" placeholder="${i.quantity}"></div>`).join('')}
    </div>
    <button onclick="window.saveStockTake('${locId}')" class="btn-primary">SUBMIT VARIANCE</button>`;
};

window.saveStockTake = async (locId) => {
    const inputs = document.querySelectorAll('.st-input');
    const { data: st } = await supabase.from('stock_takes').insert({ organization_id: window.profile.organization_id, location_id: locId, conducted_by: window.profile.id, status: 'Completed' }).select().single();
    const items = Array.from(inputs).map(i => ({ stock_take_id: st.id, product_id: i.getAttribute('data-id'), system_qty: i.getAttribute('data-sys'), physical_qty: i.value || 0 }));
    await supabase.from('stock_take_items').insert(items);
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Audit Complete", "success");
    window.currentRepView = 'variance'; window.router('reports');
};

window.viewVariance = async (id) => {
    const { data: items } = await supabase.from('stock_take_items').select('*, products(name)').eq('stock_take_id', id);
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-4 uppercase text-center">Variance Report</h3>
    <table class="w-full text-xs text-left border"><thead><tr class="bg-slate-100"><th>Item</th><th>Sys</th><th>Phys</th><th>Var</th></tr></thead><tbody>
    ${items.map(i => `<tr><td class="p-2 font-bold">${i.products.name}</td><td>${i.system_qty}</td><td>${i.physical_qty}</td><td class="${i.variance<0?'text-red-600 font-bold':''}">${i.variance}</td></tr>`).join('')}
    </tbody></table>`;
    document.getElementById('modal').style.display = 'flex';
};
