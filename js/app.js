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
window.cachedLocations = [];
window.cachedSuppliers = [];

const ALL_CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX', 'RWF', 'ZAR', 'AED', 'CNY', 'INR', 'CAD', 'AUD', 'JPY', 'CHF', 'SAR', 'QAR'];

// --- UTILITIES ---
window.closeModalOutside = (e) => { if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none'; };

window.showNotification = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    const div = document.createElement('div');
    div.className = `px-6 py-4 rounded-xl text-white font-bold shadow-2xl flex items-center gap-3 transition-all duration-300 transform translate-y-0 ${type === 'success' ? 'bg-[#0F172A]' : 'bg-red-600'}`;
    div.innerHTML = `<span>${message}</span>`;
    container.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 500); }, 3000);
};

window.premiumConfirm = (title, desc, btnText, callback) => {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-desc').innerText = desc;
    const btn = document.getElementById('confirm-btn');
    btn.innerText = btnText;
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    document.getElementById('confirm-modal').style.display = 'flex';
    newBtn.addEventListener('click', async () => {
        document.getElementById('confirm-modal').style.display = 'none';
        await callback();
    });
};

window.viewUserProfile = async (userId) => {
    if(!userId) return;
    try {
        const { data: user } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if(!user) return;
        const assignedLoc = window.cachedLocations.find(l => l.id === user.assigned_location_id)?.name || 'Unassigned';
        document.getElementById('pv-name').innerText = user.full_name || 'Unknown';
        document.getElementById('pv-role').innerText = `${user.role.replace('_', ' ')} • ${assignedLoc}`;
        document.getElementById('pv-initials').innerText = (user.full_name || 'U').charAt(0).toUpperCase();
        document.getElementById('pv-phone').innerText = user.phone || 'Not Provided';
        document.getElementById('pv-email').innerText = 'Staff Member'; 
        const statusEl = document.getElementById('pv-status');
        statusEl.innerText = `STATUS: ${user.status || 'ACTIVE'}`;
        statusEl.className = `block mt-2 text-[10px] font-bold uppercase ${user.status==='suspended'?'text-red-500':'text-green-500'}`;
        document.getElementById('profile-viewer').style.display = 'flex';
    } catch(e) { console.error(e); }
};

// --- INITIALIZATION ---
window.onload = async () => {
    window.logoutAction = logout;
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        let { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (!prof) { await new Promise(r => setTimeout(r, 1000)); let retry = await supabase.from('profiles').select('*').eq('id', session.user.id).single(); prof = retry.data; }
        if (!prof || !prof.organization_id) { window.location.href = 'setup.html'; return; }
        if (prof.status === 'suspended') { await logout(); alert("Account Suspended."); return; }

        window.profile = prof;
        const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
        window.cachedLocations = locs || [];
        const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id);
        window.cachedSuppliers = sups || [];
        await window.initCurrency();
        
        if (!window.profile.full_name || window.profile.full_name.length < 3 || !window.profile.phone) document.getElementById('name-modal').style.display = 'flex';

        const role = window.profile.role;
        const hide = (ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
        // PERMISSIONS MATRIX
        if (role === 'finance') hide(['nav-bar', 'nav-settings', 'nav-staff']); 
        else if (role === 'financial_controller') hide(['nav-bar', 'nav-settings']); // Controller anaona Team, Reports, Inventory
        else if (role === 'storekeeper') hide(['nav-bar', 'nav-approvals', 'nav-staff', 'nav-settings']);
        else if (role === 'barman') hide(['nav-inventory', 'nav-approvals', 'nav-reports', 'nav-staff', 'nav-settings']);

        window.router(role === 'barman' ? 'bar' : 'inventory');
    } catch (e) { console.error(e); }
};

window.saveName = async () => { /* ...Same as before... */ const name = document.getElementById('userNameInput').value; const phone = document.getElementById('userPhoneInput').value; if (name.length < 3) return window.showNotification("Enter Full Name", "error"); if (phone.length < 9) return window.showNotification("Enter Valid Phone", "error"); await supabase.from('profiles').update({ full_name: name, phone: phone }).eq('id', window.profile.id); document.getElementById('name-modal').style.display = 'none'; location.reload(); };
window.initCurrency = async () => { /* ...Same... */ if (!window.profile) return; try { const { data: org } = await supabase.from('organizations').select('base_currency').eq('id', window.profile.organization_id).single(); if (org) { window.baseCurrency = org.base_currency || 'USD'; if (!localStorage.getItem('user_pref_currency')) window.selectedCurrency = window.baseCurrency; } const { data: rates } = await supabase.from('exchange_rates').select('*').eq('organization_id', window.profile.organization_id); window.currencyRates = {}; window.currencyRates[window.baseCurrency] = 1; if (rates && rates.length > 0) rates.forEach(r => window.currencyRates[r.currency_code] = Number(r.rate)); } catch (e) { console.error(e); } };
window.convertAmount = (amount, fromCurr, toCurr) => { /* ...Same... */ if (!amount) return 0; const fromRate = window.currencyRates[fromCurr]; const toRate = window.currencyRates[toCurr]; if (fromCurr !== toCurr && (!fromRate || !toRate)) return null; if (fromCurr === window.baseCurrency) return amount * toRate; if (toCurr === window.baseCurrency) return amount / fromRate; return amount; };
window.formatPrice = (amount) => { if (!amount && amount !== 0) return '-'; let converted = window.convertAmount(amount, window.baseCurrency, window.selectedCurrency); if (converted === null) return `<button onclick="window.router('settings')" class="text-[9px] font-bold bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-100 cursor-pointer whitespace-nowrap">SET RATE</button>`; return `${window.selectedCurrency} ${Number(converted).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`; };
window.changeCurrency = (curr) => { window.selectedCurrency = curr; localStorage.setItem('user_pref_currency', curr); const activeEl = document.querySelector('.nav-item.nav-active'); if (activeEl) window.router(activeEl.id.replace('nav-', '')); };
window.getCurrencySelectorHTML = () => { const options = ALL_CURRENCIES.map(c => `<option value="${c}" ${window.selectedCurrency === c ? 'selected' : ''}>${c}</option>`).join(''); return `<select onchange="window.changeCurrency(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer ml-4">${options}</select>`; };
window.router = async (view) => { const app = document.getElementById('app-view'); app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div></div>'; document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-active')); const navEl = document.getElementById(`nav-${view}`); if(navEl) navEl.classList.add('nav-active'); setTimeout(async () => { try { if (view === 'inventory') await window.renderInventory(app); else if (view === 'bar') await window.renderBar(app); else if (view === 'approvals') await window.renderApprovals(app); else if (view === 'reports') await window.renderReports(app); else if (view === 'staff') await window.renderStaff(app); else if (view === 'settings') await window.renderSettings(app); } catch (e) { console.error(e); app.innerHTML = `<div class="p-10 text-red-500 font-bold text-center">Error loading ${view}: ${e.message}</div>`; } }, 50); };

// 1. INVENTORY & 2. BAR & 3. APPROVALS (Standard - Same as before)
window.renderInventory = async (c) => { const isPOView = window.currentInvView === 'po'; const stock = await getInventory(window.profile.organization_id); const filteredStock = (window.profile.role === 'manager' || window.profile.role.includes('finance') || window.profile.role === 'financial_controller') ? stock : stock.filter(x => x.location_id === window.profile.assigned_location_id); const showPrice = window.profile.role !== 'barman' && window.profile.role !== 'storekeeper'; let content = ''; if (isPOView) { const { data: pos } = await supabase.from('purchase_orders').select('*, suppliers(name)').eq('organization_id', window.profile.organization_id).order('created_at', {ascending:false}); content = `<table class="w-full text-left border-collapse"><thead class="bg-slate-50 border-b border-slate-100"><tr><th class="py-4 pl-4 text-xs text-slate-400 uppercase tracking-widest">Date</th><th class="text-xs text-slate-400 uppercase tracking-widest">Supplier</th><th class="text-xs text-slate-400 uppercase tracking-widest">Total</th><th class="text-xs text-slate-400 uppercase tracking-widest">Status</th><th class="text-xs text-slate-400 uppercase tracking-widest">Action</th></tr></thead><tbody>${(pos||[]).map(p => `<tr class="border-b border-slate-50 hover:bg-slate-50 transition"><td class="py-4 pl-4 text-xs font-bold text-slate-500">${new Date(p.created_at).toLocaleDateString()}</td><td class="text-sm font-bold text-slate-800 uppercase">${p.suppliers?.name || p.supplier_name || 'Unknown'}</td><td class="text-sm font-mono font-bold text-slate-900">${window.formatPrice(p.total_cost)}</td><td><span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${p.status==='Pending'?'bg-yellow-50 text-yellow-600 border border-yellow-100':'bg-green-50 text-green-600 border border-green-100'}">${p.status}</span></td><td>${p.status==='Pending'?`<button onclick="window.confirmReceive('${p.id}')" class="text-[10px] bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition shadow-sm font-bold">RECEIVE</button>`:'<span class="text-slate-300 text-[10px] font-bold">COMPLETED</span>'}</td></tr>`).join('')}</tbody></table>`; } else { content = `<table class="w-full text-left border-collapse"><thead class="bg-slate-50 border-b border-slate-100"><tr><th class="py-4 pl-4 text-xs text-slate-400 uppercase tracking-widest">Item</th>${showPrice?`<th class="text-xs text-slate-400 uppercase tracking-widest">Cost</th><th class="text-xs text-slate-400 uppercase tracking-widest">Price</th>`:''} <th class="text-xs text-slate-400 uppercase tracking-widest">Store</th><th class="text-xs text-slate-400 uppercase tracking-widest">Stock</th><th class="text-xs text-slate-400 uppercase tracking-widest text-right pr-6">Action</th></tr></thead><tbody>${filteredStock.map(i => `<tr class="border-b border-slate-50 hover:bg-slate-50 transition group"><td class="py-4 pl-4"><div class="font-bold text-slate-800 uppercase text-sm">${i.products?.name}</div><div class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">${i.products?.category}</div></td>${showPrice?`<td class="font-mono text-xs text-slate-500">${window.formatPrice(i.products.cost_price)}</td><td class="font-mono text-xs font-bold text-slate-900">${window.formatPrice(i.products.selling_price)}</td>`:''} <td class="text-xs font-bold text-slate-500 uppercase">${i.locations?.name}</td><td class="font-mono font-bold text-lg text-slate-900">${i.quantity} <span class="text-[10px] text-slate-400 font-sans">${i.products?.unit}</span></td><td class="text-right pr-6">${window.profile.role!=='barman'?`<button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold border border-slate-200 text-slate-600 px-4 py-2 rounded-lg hover:bg-slate-900 hover:text-white hover:border-slate-900 transition uppercase tracking-wider">Move</button>`:''}</td></tr>`).join('')}</tbody></table>`; } c.innerHTML = `<div class="flex flex-col md:flex-row justify-between items-center gap-6 mb-8"><div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">Inventory</h1>${showPrice ? window.getCurrencySelectorHTML() : ''}</div><div class="flex gap-1 bg-slate-100 p-1.5 rounded-xl"><button onclick="window.currentInvView='stock'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${!isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">STOCK</button><button onclick="window.currentInvView='po'; window.router('inventory')" class="px-6 py-2.5 text-xs font-bold rounded-lg transition ${isPOView?'bg-white shadow-sm text-slate-900':'text-slate-500 hover:text-slate-700'}">LPO</button></div><div class="flex gap-3">${window.profile.role==='manager'?`<button onclick="window.createPOModal()" class="btn-primary w-auto px-6 shadow-lg shadow-blue-900/20 bg-blue-600 hover:bg-blue-700">Create LPO</button><button onclick="window.addProductModal()" class="btn-primary w-auto px-6 shadow-lg shadow-slate-900/10">New Item</button>`:''}</div></div><div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">${content}</div>`; };
window.renderBar = async (c) => { const inv = await getInventory(window.profile.organization_id); const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).eq('type', 'department'); if (window.profile.role === 'barman') window.activePosLocationId = window.profile.assigned_location_id; else if (!window.activePosLocationId && locs.length) window.activePosLocationId = locs[0].id; const items = inv.filter(x => x.location_id === window.activePosLocationId && (x.products.category === 'Beverage' || !x.products.category)); const storeSelect = (window.profile.role !== 'barman') ? `<div class="mb-8 flex items-center gap-4"><span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Active Counter:</span><select onchange="window.switchBar(this.value)" class="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-slate-900 cursor-pointer shadow-sm min-w-[200px]">${locs.map(l => `<option value="${l.id}" ${window.activePosLocationId===l.id?'selected':''}>${l.name}</option>`).join('')}</select></div>` : ''; c.innerHTML = `${storeSelect} <div class="flex flex-col lg:flex-row gap-8 h-[calc(100vh-140px)]"><div class="flex-1 overflow-y-auto pr-2"><div class="flex justify-between items-center mb-6 sticky top-0 bg-[#F8FAFC] py-2 z-10"><h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">POS Terminal</h1>${window.getCurrencySelectorHTML()}</div><div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 pb-20">${items.length ? items.map(x => `<div onclick="window.addCart('${x.products.name}', ${x.products.selling_price}, '${x.product_id}')" class="bg-white p-5 rounded-2xl border border-slate-100 cursor-pointer hover:border-slate-900 transition-all duration-200 hover:shadow-lg hover:-translate-y-1 group relative overflow-hidden"><div class="flex justify-between items-start mb-2"><div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 font-bold text-[10px] group-hover:bg-slate-900 group-hover:text-white transition">${x.products.name.charAt(0)}</div><span class="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full border border-slate-100 group-hover:border-slate-200">Qty: ${x.quantity}</span></div><p class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 truncate">${x.products.name}</p><p class="text-lg font-bold text-slate-900 font-mono">${window.formatPrice(x.products.selling_price)}</p></div>`).join('') : '<div class="col-span-full py-20 text-center border-2 border-dashed border-slate-200 rounded-3xl"><p class="text-slate-400 font-bold text-sm uppercase">No products available here.</p></div>'}</div></div><div class="w-full lg:w-96 bg-white border border-slate-200 rounded-[32px] p-8 h-full flex flex-col shadow-2xl shadow-slate-200/50"><div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase text-slate-900 tracking-widest">Current Order</h3><button onclick="window.cart=[];window.renderCart()" class="text-[10px] font-bold text-red-500 hover:bg-red-50 px-2 py-1 rounded transition">CLEAR ALL</button></div><div id="cart-list" class="flex-1 overflow-y-auto space-y-3 pr-1"></div><div class="pt-6 border-t border-slate-100 mt-auto"><div class="flex justify-between items-end mb-6"><span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Amount</span><span id="cart-total" class="text-3xl font-bold text-slate-900 font-mono">${window.formatPrice(0)}</span></div><button onclick="window.confirmCheckout()" class="w-full bg-[#0F172A] text-white py-4 rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-slate-800 shadow-xl shadow-slate-900/20 active:scale-95 transition">Charge Sale</button></div></div></div>`; window.renderCart(); };
window.switchBar = (id) => { window.activePosLocationId = id; window.router('bar'); };
window.addCart = (n,p,id) => { if(!window.cart) window.cart=[]; const x=window.cart.find(c=>c.id===id); if(x)x.qty++; else window.cart.push({name:n,price:p,id,qty:1}); window.renderCart(); };
window.renderCart = () => { const l=document.getElementById('cart-list'), t=document.getElementById('cart-total'); let sum=0; l.innerHTML=(window.cart||[]).map(i=>{sum+=i.price*i.qty; return `<div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100 group"><div class="flex flex-col"><span class="text-xs font-bold text-slate-800 uppercase">${i.name}</span><span class="text-[10px] text-slate-400 font-mono">${window.formatPrice(i.price)} x ${i.qty}</span></div><button onclick="window.remCart('${i.id}')" class="w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-500 transition">✕</button></div>`}).join(''); t.innerText=window.formatPrice(sum); };
window.remCart = (id) => { window.cart=window.cart.filter(c=>c.id!==id); window.renderCart(); };
window.confirmCheckout = () => { if(!window.cart.length) return; window.premiumConfirm("Complete Sale?", "Confirm charging this amount.", "Charge", window.doCheckout); };
window.doCheckout = async () => { try { await processBarSale(window.profile.organization_id, window.activePosLocationId, window.cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), window.profile.id); window.showNotification("Sale Completed Successfully", "success"); window.cart=[]; window.renderCart(); window.router('bar'); } catch(e) { window.showNotification(e.message, "error"); } };
window.renderApprovals = async (c) => { if(window.profile.role === 'storekeeper') return c.innerHTML = '<div class="p-20 text-center text-slate-400 font-bold">Restricted Area</div>'; const reqs = await getPendingApprovals(window.profile.organization_id); c.innerHTML = `<h1 class="text-3xl font-bold mb-8 uppercase text-slate-900 tracking-tight">Pending Approvals</h1><div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-left"><tbody>${reqs.length ? reqs.map(r => `<tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition"><td class="p-6"><div class="font-bold text-sm uppercase text-slate-900">${r.products?.name}</div><div class="text-xs text-slate-400 uppercase mt-1">From: ${r.from_loc?.name || 'Main'}</div></td><td class="p-6"><div class="text-blue-600 font-mono font-bold text-lg">${r.quantity}</div><div class="text-xs text-slate-400 uppercase mt-1">Requested Qty</div></td><td class="p-6 text-xs font-bold text-slate-500 uppercase tracking-wider">To: ${r.to_loc?.name}</td><td class="p-6 text-right"><button onclick="window.confirmApprove('${r.id}')" class="text-[10px] bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800 transition shadow-lg shadow-slate-900/10">AUTHORIZE</button></td></tr>`).join('') : '<tr><td colspan="4" class="p-12 text-center text-xs font-bold text-slate-300 uppercase tracking-widest">No pending requests found.</td></tr>'}</tbody></table></div>`; };
window.confirmApprove = (id) => { window.premiumConfirm("Authorize Transfer?", "This will move stock permanently.", "Authorize", async () => { try{await respondToApproval(id, 'approved', window.profile.id); window.showNotification("Transfer Authorized", "success"); window.router('approvals');}catch(e){window.showNotification(e.message,"error");} }); };

// 4. REPORTS (WITH CONTROLLER POWERS)
window.renderReports = async (c) => {
    const isVariance = window.currentRepView === 'variance';
    if(isVariance) {
        const { data: takes } = await supabase.from('stock_takes').select('*, locations(name), profiles(full_name, role, phone, id, assigned_location_id)').eq('organization_id', window.profile.organization_id).order('created_at', {ascending:false});
        c.innerHTML = `<div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase text-slate-900">Reconciliation</h1><div class="flex gap-1 bg-slate-100 p-1 rounded-lg"><button onclick="window.currentRepView='general'; window.router('reports')" class="px-6 py-2 text-xs font-bold rounded-md text-slate-500 hover:text-slate-900 transition">GENERAL</button><button class="px-6 py-2 text-xs font-bold rounded-md bg-white shadow-sm text-slate-900 transition">VARIANCE</button></div><button onclick="window.newStockTakeModal()" class="btn-primary w-auto px-6 bg-red-600 hover:bg-red-700">NEW COUNT</button></div><div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-left"><thead><tr class="bg-slate-50 border-b border-slate-100"><th class="p-4 text-xs text-slate-400 uppercase">Date</th><th class="text-xs text-slate-400 uppercase">Location</th><th class="text-xs text-slate-400 uppercase">Conducted By</th><th class="text-xs text-slate-400 uppercase text-right pr-6">Report</th></tr></thead><tbody>${(takes||[]).map(t => { const locName = window.cachedLocations.find(l => l.id === t.profiles?.assigned_location_id)?.name || 'Unassigned'; return `<tr><td class="p-4 text-xs font-bold text-slate-500">${new Date(t.created_at).toLocaleDateString()}</td><td class="text-xs font-bold uppercase text-slate-800">${t.locations?.name}</td><td class="text-xs"><button onclick="window.viewUserProfile('${t.conducted_by}')" class="font-bold text-slate-900 hover:text-blue-600 transition flex flex-col text-left"><span class="uppercase">${t.profiles?.full_name}</span><span class="text-[9px] text-slate-400 uppercase tracking-wider">${t.profiles?.role} &bull; ${locName}</span></button></td><td class="text-right pr-6"><button onclick="window.viewVariance('${t.id}')" class="text-blue-600 font-bold text-[10px] hover:underline">VIEW</button></td></tr>`; }).join('')}</tbody></table></div>`;
    } else {
        const { data: logs } = await supabase.from('transactions').select(`*, products (name, category), locations:to_location_id (name), from_loc:from_location_id (name), profiles:user_id (full_name, role, phone, id, assigned_location_id)`).eq('organization_id', window.profile.organization_id).order('created_at', { ascending: false }).limit(500);
        window.currentLogs = logs || [];
        
        // CHECK IF IS FINANCIAL CONTROLLER (To Show Actions)
        const isController = window.profile.role === 'financial_controller';

        c.innerHTML = `<div class="flex flex-col gap-6 mb-8"><div class="flex justify-between items-center gap-4"><div class="flex items-center gap-4"><h1 class="text-3xl font-bold uppercase text-slate-900 tracking-tight">Reports</h1>${window.getCurrencySelectorHTML()}</div><div class="flex gap-1 bg-slate-100 p-1 rounded-lg"><button class="px-6 py-2 text-xs font-bold rounded-md bg-white shadow-sm text-slate-900 transition">GENERAL</button><button onclick="window.currentRepView='variance'; window.router('reports')" class="px-6 py-2 text-xs font-bold rounded-md text-slate-500 hover:text-slate-900 transition">VARIANCE</button></div></div><div class="bg-white p-4 rounded-2xl border border-slate-200 flex flex-wrap items-end gap-4 shadow-sm"><div class="flex-1"><label class="input-label">Start Date</label><input type="date" id="repStart" class="input-field" onchange="window.filterReport()"></div><div class="flex-1"><label class="input-label">End Date</label><input type="date" id="repEnd" class="input-field" onchange="window.filterReport()"></div><div class="flex-1"><label class="input-label">Location</label><select id="repLoc" class="input-field" onchange="window.filterReport()"><option value="all">Consolidated (All Camps)</option>${window.cachedLocations.map(l=>`<option value="${l.name}">${l.name}</option>`).join('')}</select></div><button onclick="window.exportCSV()" class="btn-primary w-auto px-6 h-[46px] bg-green-700 hover:bg-green-800">EXPORT</button></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8"><div class="bg-white p-8 border border-slate-200 rounded-[24px] shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Total Revenue</p><p class="text-4xl font-mono font-bold text-slate-900" id="repRev">...</p></div><div class="bg-white p-8 border border-slate-200 rounded-[24px] shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Gross Profit</p><p class="text-4xl font-mono font-bold text-green-600" id="repProf">...</p></div></div><div class="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left"><thead class="bg-slate-50 border-b border-slate-100"><tr><th class="p-4 pl-6 text-xs text-slate-400 uppercase tracking-widest">Date / Time</th><th class="text-xs text-slate-400 uppercase tracking-widest">User</th><th class="text-xs text-slate-400 uppercase tracking-widest">Item</th><th class="text-xs text-slate-400 uppercase tracking-widest">Type</th><th class="text-xs text-slate-400 uppercase tracking-widest">Qty</th>${isController?'<th class="text-xs text-slate-400 uppercase tracking-widest text-right pr-6">Controls</th>':''}</tr></thead><tbody id="logsBody"></tbody></table></div></div>`;
        window.filterReport();
    }
};

window.filterReport = () => {
    const start = document.getElementById('repStart')?.value;
    const end = document.getElementById('repEnd')?.value;
    const loc = document.getElementById('repLoc')?.value;
    let f = window.currentLogs;
    if(start) f = f.filter(l => new Date(l.created_at) >= new Date(start));
    if(end) f = f.filter(l => new Date(l.created_at) <= new Date(end + 'T23:59:59'));
    if(loc && loc !== 'all') f = f.filter(l => (l.locations?.name === loc || l.from_loc?.name === loc));
    
    // Totals
    const totalSales = f.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.total_value) || 0), 0);
    const totalProfit = f.filter(l => l.type === 'sale').reduce((sum, l) => sum + (Number(l.profit) || 0), 0);
    document.getElementById('repRev').innerHTML = window.formatPrice(totalSales);
    document.getElementById('repProf').innerHTML = window.formatPrice(totalProfit);

    const b = document.getElementById('logsBody');
    if(!b) return;
    
    const isController = window.profile.role === 'financial_controller';

    b.innerHTML = f.map(l => {
        let tag = l.type.toUpperCase(), badge='bg-slate-100 text-slate-500';
        if(l.type === 'sale') { tag='SALE'; badge='bg-green-50 text-green-700 border-green-100'; }
        if(l.type === 'receive') { tag='IN'; badge='bg-blue-50 text-blue-700 border-blue-100'; }
        
        return `<tr class="border-b border-slate-50 hover:bg-slate-50 transition group">
            <td class="p-4 pl-6 text-xs font-bold text-slate-500">${new Date(l.created_at).toLocaleDateString()}<span class="block text-[10px] opacity-50">${new Date(l.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></td>
            <td class="p-4 text-xs font-bold text-slate-800 uppercase">${l.profiles?.full_name || 'System'}</td>
            <td class="p-4 text-xs text-slate-600 font-medium">${l.products?.name}</td>
            <td class="p-4"><span class="text-[9px] font-bold px-2 py-1 rounded border ${badge}">${tag}</span></td>
            <td class="p-4 font-mono text-sm font-bold text-slate-900">${l.quantity}</td>
            ${isController ? `<td class="text-right pr-6 flex justify-end gap-2 mt-2">
                <button onclick="window.editTransaction('${l.id}', '${l.quantity}', '${l.total_value}')" class="text-[9px] bg-blue-50 text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-100">AMEND</button>
                <button onclick="window.deleteTransaction('${l.id}')" class="text-[9px] bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-100">VOID</button>
            </td>` : ''}
        </tr>`;
    }).join('');
};

// 🔥 CONTROLLER ACTIONS
window.editTransaction = (id, qty, val) => {
    document.getElementById('editTxId').value = id;
    document.getElementById('editQty').value = qty;
    document.getElementById('editVal').value = val;
    document.getElementById('amend-modal').style.display = 'flex';
};

window.saveTransactionEdit = async () => {
    const id = document.getElementById('editTxId').value;
    const qty = document.getElementById('editQty').value;
    const val = document.getElementById('editVal').value;
    
    // Simple update logic (In a real ERP this would be a reversing journal, but for this app direct update is fine)
    await supabase.from('transactions').update({ quantity: qty, total_value: val }).eq('id', id);
    
    document.getElementById('amend-modal').style.display = 'none';
    window.showNotification("Record Amended", "success");
    window.router('reports');
};

window.deleteTransaction = async (id) => {
    window.premiumConfirm("Void Transaction?", "This record will be permanently deleted.", "Void Record", async () => {
        await supabase.from('transactions').delete().eq('id', id);
        window.showNotification("Record Voided", "success");
        window.router('reports');
    });
};

window.exportCSV = () => { let rows=[["Date","Time","User Name","Role","Assigned Location","Item","Category","Transaction Type","Location Flow","Quantity","Value"]]; const start=document.getElementById('repStart')?.value, end=document.getElementById('repEnd')?.value, loc=document.getElementById('repLoc')?.value; let f=window.currentLogs; if(start) f=f.filter(l=>new Date(l.created_at)>=new Date(start)); if(end) f=f.filter(l=>new Date(l.created_at)<=new Date(end+'T23:59:59')); if(loc&&loc!=='all') f=f.filter(l=>(l.locations?.name===loc||l.from_loc?.name===loc)); f.forEach(l=>{ const locName=window.cachedLocations.find(loc=>loc.id===l.profiles?.assigned_location_id)?.name||'Unassigned'; rows.push([new Date(l.created_at).toLocaleDateString(),new Date(l.created_at).toLocaleTimeString(),l.profiles?.full_name,l.profiles?.role,locName,l.products?.name,l.products?.category,l.type,`${l.from_loc?.name||''}->${l.locations?.name||''}`,l.quantity,l.total_value||0]); }); let csvContent="data:text/csv;charset=utf-8,"+rows.map(e=>e.join(",")).join("\n"); let link=document.createElement("a"); link.setAttribute("href",encodeURI(csvContent)); link.setAttribute("download",`Report_${new Date().toISOString().split('T')[0]}.csv`); document.body.appendChild(link); link.click(); };
window.confirmReceive = (id) => { window.premiumConfirm("Confirm Receipt", "Are you sure you have physically received these items?", "Receive Stock", () => window.receivePO(id)); };

// 5. STAFF (RESTRICT CONTROLLER COUNT)
window.renderStaff = async (c) => {
    const { data: staff } = await supabase.from('profiles').select('*').eq('organization_id', window.profile.organization_id);
    const { data: inv } = await supabase.from('staff_invites').select('*').eq('organization_id', window.profile.organization_id).eq('status', 'pending');
    c.innerHTML = `
    <div class="flex justify-between items-center mb-8"><h1 class="text-3xl font-bold uppercase text-slate-900">Team</h1><button onclick="window.inviteModal()" class="btn-primary w-auto px-6">+ INVITE</button></div>
    <div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-left"><thead class="bg-slate-50 border-b border-slate-100"><tr><th class="p-6 text-xs text-slate-400 uppercase tracking-widest">Name & Role</th><th class="text-xs text-slate-400 uppercase tracking-widest">Contact</th><th class="text-xs text-slate-400 uppercase tracking-widest">Location</th><th class="text-xs text-slate-400 uppercase tracking-widest text-right pr-6">Action</th></tr></thead><tbody>
    ${staff.map(s => {
        const locName = window.cachedLocations.find(l => l.id === s.assigned_location_id)?.name || 'Unassigned';
        return `<tr class="border-b border-slate-50 hover:bg-slate-50 transition"><td class="p-6"><div class="font-bold text-sm uppercase text-slate-700">${s.full_name}</div><div class="text-[10px] uppercase font-bold text-blue-600 mt-1">${s.role.replace('_',' ')}</div></td><td class="text-xs font-medium text-slate-600"><div>${s.phone || '-'}</div><div class="text-[10px] text-slate-400 mt-0.5">user@email (Hidden)</div></td><td class="text-xs font-bold uppercase text-slate-500">${locName}</td><td class="text-right p-6">${s.status==='suspended'?`<button onclick="window.toggleUserStatus('${s.id}', 'active')" class="text-[9px] bg-green-100 text-green-800 px-3 py-1.5 rounded-full font-bold uppercase">Activate</button>`:`<button onclick="window.openReassignModal('${s.id}', '${s.role}', '${s.assigned_location_id}')" class="text-[9px] bg-red-100 text-red-800 px-3 py-1.5 rounded-full font-bold uppercase hover:bg-red-200 transition">Suspend</button>`}</td></tr>`;
    }).join('')}
    ${inv.map(i => {
        const locName = window.cachedLocations.find(l => l.id === i.assigned_location_id)?.name || 'Unassigned';
        return `<tr class="bg-yellow-50/50 border-b border-yellow-100"><td class="p-6"><div class="font-bold text-sm text-slate-600">${i.email}</div><div class="text-[10px] uppercase font-bold text-slate-400 mt-1">${i.role.replace('_',' ')}</div></td><td class="text-xs text-slate-400 italic">Pending Acceptance</td><td class="text-xs font-bold uppercase text-slate-400">${locName}</td><td class="text-right p-6"><span class="text-[9px] bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full font-bold">PENDING</span></td></tr>`;
    }).join('')}
    </tbody></table></div>`;
};

window.toggleUserStatus = async (id, status) => {
    if(id === window.profile.id) return window.showNotification("Cannot suspend self", "error");
    window.premiumConfirm(`${status === 'suspended' ? 'Activate' : 'Suspend'} User?`, `User will ${status === 'suspended' ? 'regain' : 'lose'} access.`, "Confirm", async () => {
        await supabase.from('profiles').update({ status }).eq('id', id);
        window.showNotification("Status Updated", "success");
        window.router('staff');
    });
};

window.openReassignModal = (id, role, loc) => {
    document.getElementById('suspendUserId').value = id;
    document.getElementById('suspendUserRole').value = role;
    document.getElementById('suspendUserLoc').value = loc;
    document.getElementById('reassign-modal').style.display = 'flex';
};

window.executeReassign = async () => {
    const oldUserId = document.getElementById('suspendUserId').value;
    const role = document.getElementById('suspendUserRole').value;
    const loc = document.getElementById('suspendUserLoc').value;
    const newEmail = document.getElementById('reassignEmail').value;

    if(!newEmail) {
        window.toggleUserStatus(oldUserId, 'suspended');
        document.getElementById('reassign-modal').style.display = 'none';
        return;
    }

    await supabase.from('profiles').update({ status: 'suspended' }).eq('id', oldUserId);
    await supabase.from('staff_invites').insert({ email: newEmail, role: role, organization_id: window.profile.organization_id, assigned_location_id: loc, status: 'pending', replaced_user_id: oldUserId });
    document.getElementById('reassign-modal').style.display = 'none';
    window.showNotification("User Suspended & Replacement Invited", "success");
    window.router('staff');
};

window.inviteModal = async () => {
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id);
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold text-lg mb-6 uppercase text-center">Invite Staff</h3>
    <div class="input-group"><label class="input-label">Email</label><input id="iE" class="input-field"></div>
    <div class="input-group"><label class="input-label">Role</label>
        <select id="iR" class="input-field">
            <option value="storekeeper">Storekeeper</option>
            <option value="barman">Barman</option>
            <option value="finance">Finance (Viewer)</option>
            <option value="financial_controller">Financial Controller (Admin)</option>
        </select>
    </div>
    <div class="input-group"><label class="input-label">Assign</label><select id="iL" class="input-field">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
    <button onclick="window.execInvite()" class="btn-primary">SEND INVITE</button>`;
    document.getElementById('modal').style.display = 'flex';
};

window.execInvite = async () => {
    const email = document.getElementById('iE').value;
    const role = document.getElementById('iR').value;
    if(!email) return;

    // 🔥 RULE: ONE CONTROLLER ONLY
    if(role === 'financial_controller') {
        const { data: existing } = await supabase.from('profiles').select('id').eq('organization_id', window.profile.organization_id).eq('role', 'financial_controller');
        const { data: pending } = await supabase.from('staff_invites').select('id').eq('organization_id', window.profile.organization_id).eq('role', 'financial_controller').eq('status', 'pending');
        
        if((existing && existing.length > 0) || (pending && pending.length > 0)) {
            return window.showNotification("Error: Only 1 Financial Controller allowed.", "error");
        }
    }

    await supabase.from('staff_invites').insert({ email, role, organization_id: window.profile.organization_id, assigned_location_id: document.getElementById('iL').value, status: 'pending' });
    document.getElementById('modal').style.display = 'none';
    window.showNotification("Sent", "success");
    window.router('staff');
};

// ... (Other functions: Settings, PO, Stock Take remain same) ...
window.renderSettings = async (c) => { const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id); const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id); const rateRows = ALL_CURRENCIES.map(code => { const isBase = code === window.baseCurrency; const val = isBase ? 1 : (window.currencyRates[code] || ''); return `<div class="flex justify-between items-center py-2 border-b last:border-0"><span class="font-bold text-xs w-10">${code}</span>${isBase ? '<span class="text-xs font-mono font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded">BASE</span>' : `<input id="rate-${code}" type="number" step="0.01" value="${val}" class="w-24 input-field py-1 text-right font-mono text-xs" placeholder="Rate">`}</div>`; }).join(''); c.innerHTML = `<h1 class="text-3xl font-bold uppercase text-slate-900 mb-8">Settings</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-8"><div class="space-y-8"><div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8"><div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Locations</h3><button onclick="window.addStoreModal()" class="text-[10px] bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold">+ ADD</button></div><table class="w-full text-left"><tbody>${locs.map(l => `<tr class="border-b last:border-0"><td class="py-3 font-bold text-sm uppercase text-slate-700">${l.name}</td><td class="text-xs text-slate-400 uppercase">${l.type}</td></tr>`).join('')}</tbody></table></div><div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8"><div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Suppliers</h3><button onclick="window.openSupplierModal()" class="text-[10px] bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold">+ NEW</button></div><table class="w-full text-left"><tbody>${(sups||[]).map(s => `<tr onclick="window.openSupplierModal('${s.id}')" class="border-b last:border-0 cursor-pointer hover:bg-slate-50 transition"><td class="py-3 font-bold text-sm uppercase text-slate-700">${s.name}</td><td class="text-xs text-slate-400 font-mono text-right">${s.tin || '-'}</td></tr>`).join('')}</tbody></table></div></div><div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-8"><div class="flex justify-between items-center mb-6"><h3 class="font-bold text-sm uppercase">Exchange Rates</h3></div><div class="max-h-[500px] overflow-y-auto pr-2">${rateRows}</div><button onclick="window.saveRates()" class="btn-primary mt-6">UPDATE RATES</button></div></div>`; };
window.saveRates = async () => { const updates = []; ALL_CURRENCIES.forEach(code => { if (code === window.baseCurrency) return; const el = document.getElementById(`rate-${code}`); if(el && el.value) { updates.push({ organization_id: window.profile.organization_id, currency_code: code, rate: parseFloat(el.value) }); } }); if(updates.length > 0) { await supabase.from('exchange_rates').upsert(updates, { onConflict: 'organization_id, currency_code' }); await window.initCurrency(); window.showNotification("Rates Updated", "success"); window.renderSettings(document.getElementById('app-view')); } };
window.openSupplierModal = async (id = null) => { document.getElementById('supId').value = id || ''; document.getElementById('supTitle').innerText = id ? 'Edit Supplier' : 'Register Supplier'; document.getElementById('btnDelSup').style.display = id ? 'block' : 'none'; if (id) { const sup = window.cachedSuppliers.find(s => s.id === id); if(sup) { document.getElementById('supName').value = sup.name; document.getElementById('supTIN').value = sup.tin; document.getElementById('supPhone').value = sup.contact; document.getElementById('supAddr').value = sup.address; } } else { document.getElementById('supName').value = ''; document.getElementById('supTIN').value = ''; document.getElementById('supPhone').value = ''; document.getElementById('supAddr').value = ''; } document.getElementById('supplier-modal').style.display = 'flex'; };
window.saveSupplier = async () => { const id = document.getElementById('supId').value; const name = document.getElementById('supName').value; const tin = document.getElementById('supTIN').value; const addr = document.getElementById('supAddr').value; const cont = document.getElementById('supPhone').value; if(!name) return window.showNotification("Name Required", "error"); const payload = { organization_id: window.profile.organization_id, name: name.toUpperCase(), tin, address: addr, contact: cont }; if(id) await supabase.from('suppliers').update(payload).eq('id', id); else await supabase.from('suppliers').insert(payload); document.getElementById('supplier-modal').style.display = 'none'; window.showNotification("Saved", "success"); window.router('settings'); };
window.deleteSupplier = async () => { const id = document.getElementById('supId').value; if(!id) return; window.premiumConfirm("Delete Supplier?", "History will remain.", "Delete", async () => { await supabase.from('suppliers').delete().eq('id', id); document.getElementById('supplier-modal').style.display = 'none'; window.showNotification("Deleted", "success"); window.router('settings'); }); };
window.addStoreModal = () => { document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">Add Location</h3><div class="input-group"><label class="input-label">Name</label><input id="nN" class="input-field"></div><div class="input-group"><label class="input-label">Type</label><select id="nT" class="input-field"><option value="main_store">Main Store</option><option value="camp_store">Camp Store</option><option value="department">Department</option></select></div><button onclick="window.execAddStore()" class="btn-primary">CREATE</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddStore = async () => { await createLocation(window.profile.organization_id, document.getElementById('nN').value, document.getElementById('nT').value); document.getElementById('modal').style.display = 'none'; window.router('settings'); };
window.createPOModal = async () => { const { data: prods } = await supabase.from('products').select('*').eq('organization_id', window.profile.organization_id).order('name'); const { data: sups } = await supabase.from('suppliers').select('*').eq('organization_id', window.profile.organization_id); if(!prods || !prods.length) return window.showNotification("No products found.", "error"); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">Create LPO</h3><div class="input-group"><label class="input-label">Supplier</label>${(sups && sups.length) ? `<select id="lpoSup" class="input-field">${sups.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>` : `<input id="lpoSupText" class="input-field" placeholder="Enter Supplier Name">`}</div><div class="bg-slate-50 p-4 rounded-xl border mb-4 max-h-60 overflow-y-auto">${prods.map(p => `<div class="flex items-center gap-2 mb-2"><input type="checkbox" class="lpo-check w-4 h-4" value="${p.id}" data-price="${p.cost_price}"><span class="flex-1 text-xs font-bold uppercase">${p.name}</span><input type="number" id="qty-${p.id}" class="w-16 input-field p-1 text-xs" placeholder="Qty"></div>`).join('')}</div><button onclick="window.execCreatePO()" class="btn-primary">GENERATE ORDER</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execCreatePO = async () => { const supSelect = document.getElementById('lpoSup'), supText = document.getElementById('lpoSupText'), supId = supSelect ? supSelect.value : null, supName = supSelect ? supSelect.options[supSelect.selectedIndex].text : supText.value, checks = document.querySelectorAll('.lpo-check:checked'); if(!supName || !checks.length) return window.showNotification("Invalid Order", "error"); let total = 0, items = []; checks.forEach(c => { const qty = document.getElementById(`qty-${c.value}`).value; if(qty > 0) { const cost = c.getAttribute('data-price'); total += (qty * cost); items.push({ product_id: c.value, quantity: qty, unit_cost: cost }); } }); const poData = { organization_id: window.profile.organization_id, created_by: window.profile.id, supplier_name: supName, total_cost: total, status: 'Pending' }; if(supId) poData.supplier_id = supId; const { data: po } = await supabase.from('purchase_orders').insert(poData).select().single(); await supabase.from('po_items').insert(items.map(i => ({...i, po_id: po.id}))); document.getElementById('modal').style.display = 'none'; window.showNotification("LPO Created", "success"); window.currentInvView = 'po'; window.router('inventory'); };
window.receivePO = async (id) => { const { data: items } = await supabase.from('po_items').select('*').eq('po_id', id); const { data: mainStore } = await supabase.from('locations').select('id').eq('organization_id', window.profile.organization_id).eq('type', 'main_store').single(); for(const item of items) { await supabase.rpc('add_stock_safe', { p_product_id: item.product_id, p_location_id: mainStore.id, p_quantity: item.quantity, p_org_id: window.profile.organization_id }); await supabase.from('transactions').insert({ organization_id: window.profile.organization_id, user_id: window.profile.id, product_id: item.product_id, to_location_id: mainStore.id, type: 'receive', quantity: item.quantity }); } await supabase.from('purchase_orders').update({ status: 'Received' }).eq('id', id); window.showNotification("Stock Received", "success"); window.router('inventory'); };
window.addStockModal = async () => { if(window.profile.role !== 'manager') return; const { data: prods } = await supabase.from('products').select('*').eq('organization_id', window.profile.organization_id).order('name'); const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">Receive Stock</h3><div class="input-group"><label class="input-label">Item</label><select id="sP" class="input-field">${prods.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div><div class="input-group"><label class="input-label">Store</label><select id="sL" class="input-field">${locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select></div><div class="input-group"><label class="input-label">Qty</label><input id="sQ" type="number" class="input-field"></div><button onclick="window.execAddStock()" class="btn-primary">CONFIRM</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddStock = async () => { const pid = document.getElementById('sP').value, lid = document.getElementById('sL').value, qty = document.getElementById('sQ').value; if(qty <= 0) return; await supabase.rpc('add_stock_safe', { p_product_id: pid, p_location_id: lid, p_quantity: qty, p_org_id: window.profile.organization_id }); await supabase.from('transactions').insert({ organization_id: window.profile.organization_id, user_id: window.profile.id, product_id: pid, to_location_id: lid, type: 'receive', quantity: qty }); document.getElementById('modal').style.display = 'none'; window.showNotification("Stock Added", "success"); window.router('inventory'); };
window.issueModal = async (name, id, fromLoc) => { window.selectedDestinationId = null; const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id).neq('id', fromLoc); const html = locs.map(l => `<div onclick="window.selectDest(this, '${l.id}')" class="dest-card border p-3 rounded cursor-pointer hover:bg-slate-50 text-center"><span class="font-bold text-xs uppercase">${l.name}</span></div>`).join(''); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Move: ${name}</h3><div class="grid grid-cols-2 gap-2 mb-4 max-h-40 overflow-y-auto">${html}</div><div class="input-group"><label class="input-label">Quantity</label><input id="tQty" type="number" class="input-field"></div><button onclick="window.execIssue('${id}', '${fromLoc}')" class="btn-primary">TRANSFER</button>`; document.getElementById('modal').style.display = 'flex'; };
window.selectDest = (el, id) => { document.querySelectorAll('.dest-card').forEach(c => c.classList.remove('bg-slate-900', 'text-white')); el.classList.add('bg-slate-900', 'text-white'); window.selectedDestinationId = id; };
window.execIssue = async (pid, fromLoc) => { const qty = document.getElementById('tQty').value; if(!window.selectedDestinationId || qty <= 0) return window.showNotification("Invalid Selection", "error"); try { await transferStock(pid, fromLoc, window.selectedDestinationId, qty, window.profile.id, window.profile.organization_id); document.getElementById('modal').style.display = 'none'; window.showNotification("Request Sent", "success"); } catch(e) { window.showNotification(e.message, "error"); } };
window.addProductModal = () => { if(window.profile.role !== 'manager') return; const opts = ALL_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join(''); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Product</h3><div class="input-group"><label class="input-label">Name</label><input id="pN" class="input-field uppercase"></div><div class="grid grid-cols-2 gap-4 mb-4"><div class="input-group mb-0"><label class="input-label">Category</label><select id="pCat" class="input-field"><option value="Food">Food</option><option value="Beverage">Beverage</option><option value="Supplies">Supplies</option></select></div><div class="input-group mb-0"><label class="input-label">Unit</label><select id="pUnit" class="input-field"><option value="Pcs">Pcs</option><option value="Kg">Kg</option><option value="Ltr">Ltr</option><option value="Box">Box</option></select></div></div><div class="input-group mb-4"><label class="input-label">Currency</label><select id="pCurrency" class="input-field cursor-pointer bg-slate-50 font-bold text-slate-700">${opts}</select></div><div class="grid grid-cols-2 gap-4 mb-6"><div class="input-group mb-0"><label class="input-label">Cost</label><input id="pC" type="number" class="input-field"></div><div class="input-group mb-0"><label class="input-label">Selling</label><input id="pS" type="number" class="input-field"></div></div><button onclick="window.execAddProduct()" class="btn-primary">SAVE PRODUCT</button>`; document.getElementById('modal').style.display = 'flex'; };
window.execAddProduct = async () => { const name = document.getElementById('pN').value.toUpperCase(), cat = document.getElementById('pCat').value, unit = document.getElementById('pUnit').value, curr = document.getElementById('pCurrency').value, cost = parseFloat(document.getElementById('pC').value), selling = parseFloat(document.getElementById('pS').value); if(!name || isNaN(cost)) return window.showNotification("Invalid input", "error"); const costBase = window.convertAmount(cost, curr, window.baseCurrency); const sellingBase = window.convertAmount(selling, curr, window.baseCurrency); if(costBase === null) return window.showNotification(`Set rate for ${curr} first`, "error"); await supabase.from('products').insert({ name, category: cat, unit, cost_price: costBase, selling_price: sellingBase, organization_id: window.profile.organization_id }); document.getElementById('modal').style.display = 'none'; window.showNotification("Product Added", "success"); window.router('inventory'); };
window.newStockTakeModal = async () => { const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', window.profile.organization_id); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-6 uppercase text-center">New Stock Take</h3><div class="input-group"><label class="input-label">Location</label><select id="stLoc" class="input-field">${locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select></div><button onclick="window.startStockTake()" class="btn-primary">START</button>`; document.getElementById('modal').style.display = 'flex'; };
window.startStockTake = async () => { const locId = document.getElementById('stLoc').value; const inv = await getInventory(window.profile.organization_id); const items = inv.filter(x => x.location_id === locId); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Count Items</h3><div class="bg-slate-50 p-2 rounded max-h-60 overflow-y-auto mb-4 border">${items.map(i => `<div class="flex justify-between items-center mb-2"><span class="text-xs font-bold w-1/2">${i.products.name}</span><input type="number" class="st-input w-20 border rounded p-1 text-center" data-id="${i.product_id}" data-sys="${i.quantity}" placeholder="${i.quantity}"></div>`).join('')}</div><button onclick="window.saveStockTake('${locId}')" class="btn-primary">SUBMIT VARIANCE</button>`; };
window.saveStockTake = async (locId) => { const inputs = document.querySelectorAll('.st-input'); const { data: st } = await supabase.from('stock_takes').insert({ organization_id: window.profile.organization_id, location_id: locId, conducted_by: window.profile.id, status: 'Completed' }).select().single(); const items = Array.from(inputs).map(i => ({ stock_take_id: st.id, product_id: i.getAttribute('data-id'), system_qty: i.getAttribute('data-sys'), physical_qty: i.value || 0 })); await supabase.from('stock_take_items').insert(items); document.getElementById('modal').style.display = 'none'; window.showNotification("Audit Complete", "success"); window.currentRepView = 'variance'; window.router('reports'); };
window.viewVariance = async (id) => { const { data: items } = await supabase.from('stock_take_items').select('*, products(name)').eq('stock_take_id', id); document.getElementById('modal-content').innerHTML = `<h3 class="font-bold text-lg mb-4 uppercase text-center">Variance Report</h3><table class="w-full text-xs text-left border"><thead><tr class="bg-slate-100"><th>Item</th><th>Sys</th><th>Phys</th><th>Var</th></tr></thead><tbody>${items.map(i => `<tr><td class="p-2 font-bold">${i.products.name}</td><td>${i.system_qty}</td><td>${i.physical_qty}</td><td class="${i.variance<0?'text-red-600 font-bold':''}">${i.variance}</td></tr>`).join('')}</tbody></table>`; document.getElementById('modal').style.display = 'flex'; };
