import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

window.onload = async () => {
    // 1. Initial State (Loading)
    const app = document.getElementById('app-view');
    if(app) app.innerHTML = `
        <div class="flex h-full items-center justify-center">
            <div class="flex flex-col items-center gap-2">
                <div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                <span class="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Syncing System...</span>
            </div>
        </div>`;

    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        // 2. ATOMIC LINK (Unahakikisha Invited Users wameunganishwa kabla ya kuingia)
        await supabase.rpc('claim_my_invite', { 
            email_to_check: session.user.email, 
            user_id_to_link: session.user.id 
        });

        // 3. FETCH FULL PROFILE
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = prof;

        if (!profile || !profile.organization_id) {
            window.location.href = 'setup.html';
            return;
        }

        // 4. POPULATE SIDEBAR INFO
        document.getElementById('userName').innerText = profile.full_name || 'User';
        document.getElementById('userRole').innerText = profile.role.replace('_', ' ');
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        // 5. ROLE-BASED ACCESS CONTROL (Hapa ndipo tunapoficha Menu)
        applyRolePermissions(profile.role);

        // Sidebar Toggles for Mobile
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('-translate-x-full');
        });
        document.getElementById('close-sidebar')?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.add('-translate-x-full');
        });

        // 6. INITIAL ROUTING (Nchi gani ufungue kwanza?)
        if (profile.role === 'finance') router('approvals');
        else if (profile.role === 'barman') router('bar');
        else router('inventory');

    } catch (e) {
        console.error("Dashboard Load Error:", e);
        logout();
    }
};

// --- SECURITY & PERMISSIONS ENGINE ---
function applyRolePermissions(role) {
    const menus = {
        inventory: document.getElementById('nav-inventory'),
        bar: document.getElementById('nav-bar'),
        approvals: document.getElementById('nav-approvals'),
        staff: document.getElementById('nav-staff'),
        settings: document.getElementById('nav-settings')
    };

    // Manager: Anaona Kila Kitu
    if (role === 'manager') return; 

    // Finance Specialist
    if (role === 'finance') {
        menus.bar.classList.add('hidden');
        menus.staff.classList.add('hidden');
        menus.settings.classList.add('hidden');
    } 
    // Barman
    else if (role === 'barman') {
        menus.approvals.classList.add('hidden');
        menus.staff.classList.add('hidden');
        menus.settings.classList.add('hidden');
    }
    // Storekeeper
    else if (role === 'storekeeper') {
        menus.bar.classList.add('hidden');
        menus.approvals.classList.add('hidden');
        menus.staff.classList.add('hidden');
        menus.settings.classList.add('hidden');
    }
}

window.router = async (view) => {
    // Force Security Check before Routing
    if ((view === 'staff' || view === 'settings') && profile.role !== 'manager') {
        alert("Restricted Access: Management Only.");
        return;
    }

    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div></div>';
    
    // Update Sidebar Active UI
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('bg-gray-100', 'text-black');
        el.classList.add('text-gray-500');
    });
    const activeNav = document.getElementById(`nav-${view}`);
    if(activeNav) {
        activeNav.classList.add('bg-gray-100', 'text-black');
        activeNav.classList.remove('text-gray-500');
    }

    if(window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');

    // Load Views
    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// --- RENDER MODULES (Using SVG Icons as requested) ---

async function renderInventory(c) {
    try {
        const data = await getInventory(profile.organization_id);
        const locations = await getLocations(profile.organization_id);
        
        const rows = data.map(i => `
            <tr class="border-b border-gray-50 hover:bg-gray-50/50 transition">
                <td class="py-4 px-2">
                    <p class="font-bold text-sm text-gray-900">${i.products?.name}</p>
                    <p class="text-[10px] text-gray-400 font-medium uppercase tracking-tighter">${i.products?.category || 'Standard'}</p>
                </td>
                <td class="py-4 px-2 text-xs font-semibold text-gray-500 uppercase">${i.locations?.name}</td>
                <td class="py-4 px-2 font-mono font-bold text-gray-900">${i.quantity} ${i.products?.unit}</td>
                <td class="py-4 px-2 text-right">
                    ${(profile.role === 'manager' || profile.role === 'storekeeper') ? `
                        <button onclick="window.openTransfer('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] font-bold bg-black text-white px-3 py-2 rounded-lg hover:opacity-80">Issue Item</button>
                    ` : '<span class="text-[10px] text-gray-300 font-bold uppercase">Locked</span>'}
                </td>
            </tr>`).join('');

        c.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-xl font-bold tracking-tight text-gray-900 uppercase tracking-widest">Inventory Management</h1>
                    <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Real-time Stock Synchronization</p>
                </div>
            </div>
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-400 font-bold border-b border-gray-100">
                        <tr><th class="p-4">SKU / Item</th><th class="p-4">Store Location</th><th class="p-4">Available Balance</th><th class="p-4 text-right">Action</th></tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50">${rows.length ? rows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-400 font-bold uppercase tracking-widest">No stock found in this organization.</td></tr>'}</tbody>
                </table>
            </div>`;
    } catch(e) { console.error(e); }
}

async function renderApprovals(c) {
    try {
        const requests = await getPendingApprovals(profile.organization_id);
        const rows = requests.map(x => `
            <tr class="border-b border-gray-50">
                <td class="py-4 px-4 font-bold text-sm text-gray-900">${x.products?.name}</td>
                <td class="py-4 px-4 text-xs font-mono font-bold text-blue-600">${x.quantity}</td>
                <td class="py-4 px-4 text-xs font-medium text-gray-500 uppercase">${x.profiles?.full_name}</td>
                <td class="py-4 px-4 text-right space-x-2">
                    <button onclick="window.approve('${x.id}','approved')" class="bg-black text-white px-4 py-2 rounded-lg text-[10px] font-bold hover:opacity-80">Approve</button>
                    <button onclick="window.approve('${x.id}','rejected')" class="bg-gray-100 text-gray-400 px-4 py-2 rounded-lg text-[10px] font-bold">Reject</button>
                </td>
            </tr>`).join('');

        c.innerHTML = `
            <h1 class="text-xl font-bold mb-8 uppercase tracking-widest text-gray-400">Finance Approval Queue</h1>
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold border-b border-gray-100">
                        <tr><th class="p-4">Requested Item</th><th class="p-4">Qty</th><th class="p-4">Requestor</th><th class="p-4 text-right">Control Action</th></tr>
                    </thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-400 font-bold uppercase tracking-widest">No pending financial approvals.</td></tr>'}</tbody>
                </table>
            </div>`;
    } catch(e) { console.error(e); }
}

async function renderBar(c) {
    try {
        const inventory = await getInventory(profile.organization_id);
        const items = inventory.map(x => `
            <div onclick="window.addToCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border border-gray-100 p-6 rounded-2xl cursor-pointer hover:border-black transition active:scale-95 shadow-sm">
                <h4 class="font-bold text-sm text-gray-900 uppercase tracking-tight">${x.products.name}</h4>
                <div class="flex justify-between items-center mt-4">
                    <span class="text-xs font-bold text-gray-900 font-mono tracking-tighter">$${x.products.selling_price}</span>
                    <span class="text-[9px] font-bold text-gray-300 uppercase tracking-widest">Stock: ${x.quantity}</span>
                </div>
            </div>`).join('');

        c.innerHTML = `
            <div class="flex flex-col lg:flex-row h-full gap-8">
                <div class="flex-1 overflow-y-auto">
                    <h1 class="text-xl font-bold mb-8 uppercase tracking-widest text-gray-400">Sales Entry Portal</h1>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4">${items}</div>
                </div>
                <div class="w-full lg:w-96 bg-white border border-gray-200 p-6 rounded-3xl shadow-xl flex flex-col h-fit sticky top-0">
                    <h3 class="font-bold text-lg text-gray-900 mb-6 uppercase tracking-tight">Active Ticket</h3>
                    <div id="cart-list" class="flex-1 space-y-4 max-h-[300px] overflow-y-auto mb-6"></div>
                    <div class="pt-6 border-t border-gray-100">
                        <div class="flex justify-between font-bold text-xl mb-6 text-gray-900 tracking-tighter">
                            <span>Grand Total</span>
                            <span id="cart-total">$0.00</span>
                        </div>
                        <button onclick="window.processCheckout()" class="w-full bg-black text-white py-4 rounded-2xl font-bold text-sm hover:opacity-90 shadow-lg shadow-black/5 transition uppercase tracking-widest">Authorize Sale</button>
                    </div>
                </div>
            </div>`;
        window.updateCartUI();
    } catch(e) { console.error(e); }
}

// --- SYSTEM CORE LOGIC (Utilities) ---

window.addToCart = (name, price, id) => {
    const existing = cart.find(c => c.id === id);
    if(existing) existing.qty++; else cart.push({ name, price, id, qty: 1 });
    window.updateCartUI();
}

window.updateCartUI = () => {
    const list = document.getElementById('cart-list'), total = document.getElementById('cart-total');
    if(!cart.length) { 
        list.innerHTML = '<div class="text-center py-12 text-gray-300 text-[10px] font-bold uppercase tracking-widest">No Selection</div>'; 
        total.innerText = '$0.00'; return; 
    }
    let sum = 0;
    list.innerHTML = cart.map(i => {
        sum += i.price * i.qty;
        return `<div class="flex justify-between items-center group">
            <div class="truncate">
                <div class="text-xs font-bold text-gray-900">${i.name}</div>
                <div class="text-[10px] font-bold text-gray-400 uppercase font-mono">${i.qty} units @ $${i.price}</div>
            </div>
            <button onclick="window.removeFromCart('${i.id}')" class="text-gray-300 hover:text-red-500 transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
        </div>`;
    }).join('');
    total.innerText = '$' + sum.toFixed(2);
}

window.removeFromCart = (id) => { cart = cart.filter(c => c.id !== id); window.updateCartUI(); }

window.processCheckout = async () => {
    if(!cart.length) return;
    try {
        await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c => ({ product_id: c.id, qty: c.qty, price: c.price })), profile.id);
        alert('Sale Authenticated Successfully.'); cart = []; window.updateCartUI(); router('bar');
    } catch(e) { alert(e.message); }
}

// --- ADMINISTRATIVE FUNCTIONS (Arusha Main Store Level) ---

window.openTransfer = (name, id, from) => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Stock Movement</h3>
        <div class="space-y-4">
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Selected Item</label>
                <input value="${name}" disabled class="w-full mt-1 p-3 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-900">
            </div>
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Target Location/Camp</label>
                <select id="tToLoc" class="w-full mt-1 p-3 border border-gray-200 rounded-xl text-xs bg-white font-bold outline-none focus:border-black"></select>
            </div>
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Quantity to Issue</label>
                <input id="tQty" type="number" class="w-full mt-1 p-3 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-black" placeholder="0.00">
            </div>
            <button onclick="window.execTransfer('${id}','${from}')" class="w-full bg-black text-white py-4 rounded-xl font-bold text-xs mt-4 uppercase tracking-widest">Confirm Movement</button>
        </div>`;
    
    getLocations(profile.organization_id).then(locs => {
        document.getElementById('tToLoc').innerHTML = locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    });
    document.getElementById('modal').classList.remove('hidden');
}

window.execTransfer = async (id, from) => {
    const to = document.getElementById('tToLoc').value, qty = document.getElementById('tQty').value;
    try {
        await transferStock(id, from, to, qty, profile.id, profile.organization_id);
        alert('Stock movement authorized.'); document.getElementById('modal').classList.add('hidden'); router('inventory');
    } catch(e) { alert(e.message); }
}

// Management Renderers
async function renderStaff(c) {
    try {
        const staff = await getStaff(profile.organization_id);
        const rows = staff.map(s => `
            <tr class="border-b border-gray-50">
                <td class="p-4 text-sm font-bold text-gray-900">${s.full_name}</td>
                <td class="p-4 text-xs text-gray-500 font-medium tracking-tight">${s.email}</td>
                <td class="p-4 uppercase text-[10px] font-bold text-blue-600 tracking-widest bg-blue-50/50">${s.role}</td>
            </tr>`).join('');
        c.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <h1 class="text-xl font-bold uppercase tracking-widest text-gray-400">Team Authorization</h1>
                <button onclick="window.inviteModal()" class="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest">Grant Access</button>
            </div>
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <table class="w-full text-left"><tbody>${rows}</tbody></table>
            </div>`;
    } catch(e) {}
}

window.inviteModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6">New User Access</h3>
        <input id="iE" class="w-full p-3 border border-gray-200 rounded-xl mb-3 text-xs font-bold outline-none" placeholder="Official Email Address" type="email">
        <select id="iR" class="w-full p-3 border border-gray-200 rounded-xl mb-6 bg-white text-xs font-bold outline-none">
            <option value="storekeeper">Storekeeper</option>
            <option value="barman">Barman</option>
            <option value="finance">Finance Specialist</option>
        </select>
        <button onclick="window.execInvite()" class="w-full bg-black text-white py-4 rounded-xl font-bold text-xs uppercase tracking-widest">Send Portal Invitation</button>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execInvite = async () => {
    const e = document.getElementById('iE').value.trim();
    try { await inviteStaff(e, document.getElementById('iR').value, profile.organization_id); alert('Success: Invitation sent.'); document.getElementById('modal').classList.add('hidden'); } catch(err) { alert(err.message); }
}

async function renderSettings(c) {
    try {
        const locs = await getLocations(profile.organization_id);
        const rows = locs.map(l => `
            <tr class="border-b border-gray-50">
                <td class="p-4 text-sm font-bold text-gray-900">${l.name}</td>
                <td class="p-4 text-[10px] font-bold uppercase text-gray-400 tracking-widest">${l.type}</td>
                <td class="p-4 text-right"><button class="text-[10px] font-bold text-gray-300">Edit Configuration</button></td>
            </tr>`).join('');
        c.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <h1 class="text-xl font-bold uppercase tracking-widest text-gray-400">Enterprise Configuration</h1>
                <button onclick="window.addLoc()" class="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest">Register New Store</button>
            </div>
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <table class="w-full text-left"><tbody>${rows}</tbody></table>
            </div>`;
    } catch(e) {}
}

window.addLoc = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 text-gray-900">Add Centralized Store</h3>
        <input id="nL" class="w-full p-3 border border-gray-200 rounded-xl mb-6 text-xs font-bold outline-none" placeholder="e.g. Mara River Camp Store">
        <button onclick="window.execAddLoc()" class="w-full bg-black text-white py-4 rounded-xl font-bold text-xs uppercase tracking-widest">Register Location</button>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execAddLoc = async () => {
    try { await createLocation(profile.organization_id, document.getElementById('nL').value, 'camp_store'); document.getElementById('modal').classList.add('hidden'); router('settings'); } catch(e) {}
}

window.approve = async (id, status) => { if(confirm('Are you sure you want to authorize this?')) try { await respondToApproval(id, status, profile.id); router('approvals'); } catch(e) { alert(e.message); } }
