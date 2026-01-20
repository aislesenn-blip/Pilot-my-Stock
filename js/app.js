import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, getStaff, inviteStaff, getPendingApprovals, respondToApproval, processBarSale } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = []; // Kikapu cha Bar

window.onload = async () => {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        profile = await getCurrentProfile(session.user.id);
        
        if (!profile || !profile.organization_id) {
            window.location.href = 'setup.html';
            return; 
        }

        document.getElementById('userName').innerText = profile.full_name || 'User';
        document.getElementById('userRole').innerText = (profile.role || 'staff').replace('_', ' ');
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        // Mobile Menu
        const menuBtn = document.getElementById('mobile-menu-btn');
        if(menuBtn) {
            menuBtn.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                sidebar.classList.toggle('hidden'); sidebar.classList.toggle('absolute'); sidebar.classList.toggle('inset-0'); sidebar.classList.toggle('bg-white'); sidebar.classList.toggle('z-50'); sidebar.classList.toggle('w-full');
            });
        }
        const closeBtn = document.getElementById('close-sidebar');
        if(closeBtn) {
            closeBtn.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                sidebar.classList.add('hidden'); sidebar.classList.remove('absolute', 'inset-0', 'bg-white', 'z-50', 'w-full');
            });
        }

        router('inventory');

    } catch (error) {
        console.error("Critical Error:", error);
        logout();
    }
};

window.router = async (view) => {
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex items-center justify-center h-full"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div></div>';
    
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('bg-gray-50', 'text-black'));
    document.getElementById(`nav-${view}`)?.classList.add('bg-gray-50', 'text-black');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'settings') await renderSettings(app);
    else if (view === 'bar') await renderBar(app);           // REAL BAR SYSTEM
    else if (view === 'staff') await renderStaff(app);       // REAL STAFF SYSTEM
    else if (view === 'approvals') await renderApprovals(app); // REAL APPROVALS SYSTEM
};

// --- 1. INVENTORY VIEW ---
async function renderInventory(container) {
    try {
        const data = await getInventory(profile.organization_id);
        const rows = data.map(i => `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="p-4 font-bold text-gray-900">${i.products?.name || 'Item'}</td>
                <td class="p-4 text-xs text-gray-500">${i.locations?.name || 'Loc'}</td>
                <td class="p-4 font-mono font-medium">${Number(i.quantity).toFixed(2)} ${i.products?.unit || ''}</td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="flex justify-between items-end mb-8 fade-in">
                <div><h1 class="text-2xl font-bold">Inventory</h1><p class="text-gray-500 text-sm">Real-time stock levels.</p></div>
            </div>
            <div class="glass rounded-2xl overflow-hidden shadow-sm">
                <table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold"><tr><th class="p-4">Item</th><th class="p-4">Location</th><th class="p-4">Qty</th></tr></thead>
                <tbody>${rows.length ? rows : '<tr><td colspan="3" class="p-8 text-center text-gray-400">No stock found.</td></tr>'}</tbody></table>
            </div>`;
    } catch (err) { container.innerHTML = `<div class="p-10 text-red-500">Error loading inventory.</div>`; }
}

// --- 2. SETTINGS VIEW ---
async function renderSettings(container) {
    try {
        const locations = await getLocations(profile.organization_id);
        const rows = locations.map(l => `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="p-4 font-bold text-gray-900">${l.name}</td>
                <td class="p-4"><span class="bg-gray-100 px-2 py-1 rounded text-[10px] uppercase font-bold">${l.type.replace('_', ' ')}</span></td>
                <td class="p-4 text-right"><button onclick="window.modalEditLocation('${l.id}', '${l.name}', '${l.type}')" class="text-xs font-bold text-gray-400 hover:text-black">Edit</button></td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="flex justify-between items-end mb-8 fade-in">
                <div><h1 class="text-2xl font-bold">Settings</h1><p class="text-gray-500 text-sm">Manage locations.</p></div>
                <button onclick="window.modalAddLocation()" class="btn-black px-5 py-2 text-sm font-bold shadow">+ Location</button>
            </div>
            <div class="glass rounded-2xl overflow-hidden shadow-sm">
                <table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold"><tr><th class="p-4">Name</th><th class="p-4">Type</th><th class="p-4 text-right">Action</th></tr></thead>
                <tbody>${rows.length ? rows : '<tr><td colspan="3" class="p-8 text-center text-gray-400">No locations found.</td></tr>'}</tbody></table>
            </div>`;
    } catch (err) { container.innerHTML = `<div class="p-10 text-red-500">Error loading settings.</div>`; }
}

// --- 3. BAR & POS SYSTEM (REAL) ---
async function renderBar(container) {
    try {
        // Vuta inventory yote (V2: Filter items zenye 'is_bar_item' = true)
        const data = await getInventory(profile.organization_id);
        
        // Render Product Cards
        const cards = data.map(i => `
            <div onclick="window.addToCart('${i.products.name}', ${i.products.selling_price || 0}, '${i.product_id}')" class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md cursor-pointer transition active:scale-95">
                <div class="h-20 bg-gray-50 rounded-lg mb-3 flex items-center justify-center text-2xl">🍺</div>
                <h4 class="font-bold text-sm text-gray-900 truncate">${i.products.name}</h4>
                <p class="text-xs text-gray-500 mb-1">${i.locations.name}</p>
                <div class="flex justify-between items-center">
                    <span class="font-bold text-xs">$${i.products.selling_price || 0}</span>
                    <span class="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-600">Stock: ${i.quantity}</span>
                </div>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="flex h-full gap-6 fade-in">
                <div class="flex-1 overflow-y-auto pr-2">
                    <h1 class="text-2xl font-bold mb-6">Bar & POS</h1>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
                        ${cards.length ? cards : '<p class="text-gray-400 col-span-3">No products available in stock.</p>'}
                    </div>
                </div>
                
                <div class="w-80 bg-white rounded-2xl shadow-lg border border-gray-100 flex flex-col">
                    <div class="p-5 border-b border-gray-100"><h3 class="font-bold">Current Order</h3></div>
                    <div class="flex-1 overflow-y-auto p-4 space-y-3" id="cart-items">
                        <p class="text-xs text-gray-400 text-center mt-10">Cart is empty</p>
                    </div>
                    <div class="p-5 bg-gray-50 border-t border-gray-100">
                        <div class="flex justify-between text-sm mb-4"><span class="text-gray-500">Total</span><span class="font-bold text-lg" id="cart-total">$0.00</span></div>
                        <button onclick="window.checkout()" class="btn-black w-full py-3 rounded-xl font-bold text-sm">Charge</button>
                    </div>
                </div>
            </div>
        `;
        window.renderCart();
    } catch (err) { container.innerHTML = `<div class="p-10 text-red-500">Error loading POS.</div>`; }
}

// --- 4. STAFF SYSTEM (REAL) ---
async function renderStaff(container) {
    try {
        const staff = await getStaff(profile.organization_id);
        const rows = staff.map(s => `
            <tr class="border-b border-gray-100">
                <td class="p-4 font-bold text-sm">${s.full_name}</td>
                <td class="p-4 text-xs text-gray-500">${s.email}</td>
                <td class="p-4"><span class="bg-blue-50 text-blue-700 px-2 py-1 rounded text-[10px] uppercase font-bold">${s.role}</span></td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="flex justify-between items-end mb-8 fade-in">
                <div><h1 class="text-2xl font-bold">Team</h1><p class="text-gray-500 text-sm">Manage staff access.</p></div>
                <button onclick="window.modalInvite()" class="btn-black px-5 py-2 text-sm font-bold shadow">+ Invite Staff</button>
            </div>
            <div class="glass rounded-2xl overflow-hidden shadow-sm">
                <table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold"><tr><th class="p-4">Name</th><th class="p-4">Email</th><th class="p-4">Role</th></tr></thead>
                <tbody>${rows.length ? rows : '<tr><td colspan="3" class="p-8 text-center text-gray-400">No staff found.</td></tr>'}</tbody></table>
            </div>`;
    } catch (err) { container.innerHTML = `<div class="p-10 text-red-500">Error loading staff.</div>`; }
}

// --- 5. APPROVALS SYSTEM (REAL) ---
async function renderApprovals(container) {
    try {
        const reqs = await getPendingApprovals(profile.organization_id);
        const rows = reqs.map(r => `
            <tr class="border-b border-gray-100">
                <td class="p-4 font-bold text-sm">${r.products.name}</td>
                <td class="p-4 text-xs">${r.quantity > 0 ? '+' : ''}${r.quantity}</td>
                <td class="p-4 text-xs text-gray-500">${r.profiles.full_name}</td>
                <td class="p-4 text-right space-x-2">
                    <button onclick="window.handleApproval('${r.id}', 'approved')" class="text-[10px] bg-green-100 text-green-700 px-3 py-1 rounded font-bold hover:bg-green-200">Approve</button>
                    <button onclick="window.handleApproval('${r.id}', 'rejected')" class="text-[10px] bg-red-50 text-red-600 px-3 py-1 rounded font-bold hover:bg-red-100">Reject</button>
                </td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="flex justify-between items-end mb-8 fade-in">
                <div><h1 class="text-2xl font-bold">Approvals</h1><p class="text-gray-500 text-sm">Pending stock adjustments.</p></div>
            </div>
            <div class="glass rounded-2xl overflow-hidden shadow-sm">
                <table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold"><tr><th class="p-4">Item</th><th class="p-4">Qty</th><th class="p-4">By</th><th class="p-4 text-right">Action</th></tr></thead>
                <tbody>${rows.length ? rows : '<tr><td colspan="4" class="p-8 text-center text-gray-400">No pending approvals.</td></tr>'}</tbody></table>
            </div>`;
    } catch (err) { container.innerHTML = `<div class="p-10 text-red-500">Error loading approvals.</div>`; }
}

// --- HELPER FUNCTIONS (CART & ACTIONS) ---

window.addToCart = (name, price, id) => {
    const existing = cart.find(c => c.product_id === id);
    if(existing) existing.qty++;
    else cart.push({ name, price, product_id: id, qty: 1 });
    window.renderCart();
};

window.renderCart = () => {
    const container = document.getElementById('cart-items');
    if(cart.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-400 text-center mt-10">Cart is empty</p>';
        document.getElementById('cart-total').innerText = '$0.00';
        return;
    }
    
    let total = 0;
    container.innerHTML = cart.map(item => {
        total += item.price * item.qty;
        return `
        <div class="flex justify-between items-center bg-gray-50 p-2 rounded-lg">
            <div class="overflow-hidden"><p class="text-xs font-bold truncate w-32">${item.name}</p><p class="text-[10px] text-gray-500">$${item.price} x ${item.qty}</p></div>
            <button onclick="window.removeFromCart('${item.product_id}')" class="text-red-400 hover:text-red-600 font-bold text-xs">x</button>
        </div>`;
    }).join('');
    document.getElementById('cart-total').innerText = '$' + total.toFixed(2);
};

window.removeFromCart = (id) => {
    cart = cart.filter(c => c.product_id !== id);
    window.renderCart();
};

window.checkout = async () => {
    if(cart.length === 0) return alert("Cart is empty");
    if(!confirm("Process sale?")) return;
    
    try {
        await processBarSale(profile.organization_id, profile.assigned_location_id || 1, cart, profile.id); // Assume loc ID 1 if null for now
        alert("Sale Recorded!");
        cart = [];
        window.renderCart();
        router('bar'); // Refresh stock
    } catch(e) { alert("Sale Error: " + e.message); }
};

window.handleApproval = async (id, status) => {
    if(!confirm(status === 'approved' ? "Approve this request?" : "Reject request?")) return;
    try {
        await respondToApproval(id, status, profile.id);
        router('approvals');
    } catch(e) { alert("Error: " + e.message); }
};

// --- MODALS FOR SETTINGS ---
// (Weka zile codes za Modal Add/Edit Location hapa chini kama zilivyokuwa mwanzo)
window.modalAddLocation = () => {
    const html = `<h3 class="font-bold mb-2">Add Loc</h3><form onsubmit="window.saveLocation(event)"><input id="nL" placeholder="Name" class="input-field w-full mb-2"><button class="btn-black w-full py-2">Save</button></form>`;
    document.getElementById('modal-content').innerHTML = html; document.getElementById('modal').classList.remove('hidden');
};
window.saveLocation = async (e) => {
    e.preventDefault(); try { await createLocation(profile.organization_id, document.getElementById('nL').value, 'camp_store'); document.getElementById('modal').classList.add('hidden'); router('settings'); } catch(err) { alert(err.message); }
};
// Add invite modal logic similarly...
window.modalInvite = () => {
    const html = `<h3 class="font-bold mb-2">Invite Staff</h3><form onsubmit="window.submitInvite(event)"><input id="iEmail" placeholder="Email" class="input-field w-full mb-2"><select id="iRole" class="input-field w-full mb-2"><option value="barman">Barman</option><option value="storekeeper">Storekeeper</option></select><button class="btn-black w-full py-2">Invite</button></form>`;
    document.getElementById('modal-content').innerHTML = html; document.getElementById('modal').classList.remove('hidden');
};
window.submitInvite = async (e) => {
    e.preventDefault(); try { await inviteStaff(document.getElementById('iEmail').value, document.getElementById('iRole').value, null, profile.organization_id); alert("Invite Sent!"); document.getElementById('modal').classList.add('hidden'); } catch(err) { alert(err.message); }
};
