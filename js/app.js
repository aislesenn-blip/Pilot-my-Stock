import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';

let profile = null;
let cart = [];

window.onload = async () => {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    try {
        profile = await getCurrentProfile(session.user.id);
        if (!profile || !profile.organization_id) { window.location.href = 'setup.html'; return; }

        document.getElementById('userName').innerText = profile.full_name || 'User';
        document.getElementById('userRole').innerText = (profile.role || 'staff').replace('_', ' ');
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        // Mobile Menu Logic
        const sidebar = document.getElementById('sidebar');
        const menuBtn = document.getElementById('mobile-menu-btn');
        const closeBtn = document.getElementById('close-sidebar');

        if(menuBtn) {
            menuBtn.addEventListener('click', () => {
                sidebar.classList.remove('-translate-x-full');
            });
        }
        if(closeBtn) {
            closeBtn.addEventListener('click', () => {
                sidebar.classList.add('-translate-x-full');
            });
        }

        router('inventory');
    } catch (e) { logout(); }
};

window.router = async (view) => {
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-8 h-8 border-2 border-black border-b-transparent rounded-full animate-spin"></div></div>';
    
    // Funga menu ya simu
    document.getElementById('sidebar').classList.add('-translate-x-full');

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('bg-gray-50', 'text-black'));
    document.getElementById(`nav-${view}`)?.classList.add('bg-gray-50', 'text-black');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'settings') await renderSettings(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'approvals') await renderApprovals(app);
};

// --- 1. INVENTORY ---
async function renderInventory(c) {
    try {
        const data = await getInventory(profile.organization_id);
        const locs = await getLocations(profile.organization_id);
        
        const modalHtml = `
            <div id="transferModal" class="fixed inset-0 bg-black/50 hidden z-[60] flex items-center justify-center p-4">
                <div class="bg-white p-6 rounded-xl w-full max-w-sm">
                    <h3 class="font-bold text-lg mb-4">Transfer Stock</h3>
                    <input id="tProdName" disabled class="input-field w-full mb-2 bg-gray-100">
                    <input type="hidden" id="tProdId">
                    <input type="hidden" id="tFromLoc">
                    <label class="text-xs font-bold text-gray-500">To Location:</label>
                    <select id="tToLoc" class="input-field w-full mb-2 bg-white border p-2 rounded">${locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select>
                    <label class="text-xs font-bold text-gray-500">Quantity:</label>
                    <input id="tQty" type="number" class="input-field w-full mb-4 border p-2 rounded" placeholder="Qty">
                    <button onclick="window.submitTransfer()" class="btn-black w-full py-3 rounded-xl font-bold">Transfer</button>
                    <button onclick="document.getElementById('transferModal').classList.add('hidden')" class="w-full mt-2 text-xs text-gray-500 py-2">Cancel</button>
                </div>
            </div>`;

        const rows = data.map(i => `
            <tr class="border-b border-gray-100">
                <td class="p-4 font-bold text-sm">${i.products?.name}</td>
                <td class="p-4 text-xs text-gray-500">${i.locations?.name}</td>
                <td class="p-4 font-mono font-bold">${Number(i.quantity).toFixed(1)} ${i.products?.unit}</td>
                <td class="p-4 text-right">
                    ${profile.role === 'manager' ? `<button onclick="window.openTransfer('${i.products.name}', '${i.product_id}', '${i.location_id}')" class="text-[10px] bg-black text-white px-2 py-1 rounded font-bold">Transfer</button>` : ''}
                </td>
            </tr>`).join('');
            
        c.innerHTML = `${modalHtml}<h1 class="text-2xl font-bold mb-6">Inventory Control</h1><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Item</th><th class="p-4">Loc</th><th class="p-4">Qty</th><th class="p-4 text-right">Action</th></tr></thead><tbody>${rows.length ? rows : '<tr><td colspan="4" class="p-6 text-center text-gray-400">No stock found.</td></tr>'}</tbody></table></div>`;
    } catch (e) { c.innerHTML = 'Error loading inventory'; }
}

// --- 2. SETTINGS ---
async function renderSettings(c) {
    try {
        const locs = await getLocations(profile.organization_id);
        const rows = locs.map(l => `<tr class="border-b border-gray-100"><td class="p-4 font-bold text-sm">${l.name}</td><td class="p-4"><span class="bg-gray-100 text-[10px] font-bold px-2 py-1 rounded uppercase">${l.type.replace('_',' ')}</span></td><td class="p-4 text-right"><button onclick="window.editLoc('${l.id}','${l.name}','${l.type}')" class="text-xs font-bold text-gray-400 hover:text-black">Edit</button></td></tr>`).join('');
        c.innerHTML = `<div class="flex justify-between items-end mb-6"><h1 class="text-2xl font-bold">Settings</h1><button onclick="window.addLoc()" class="btn-black px-4 py-2 text-xs font-bold rounded-lg">+ Location</button></div><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Name</th><th class="p-4">Type</th><th class="p-4 text-right">Action</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } catch (e) { c.innerHTML = 'Error settings'; }
}

// --- 3. BAR SYSTEM ---
async function renderBar(c) {
    try {
        const stock = await getInventory(profile.organization_id);
        const items = stock.filter(i => i.quantity > 0).map(i => `<div onclick="window.addCart('${i.products.name}', ${i.products.selling_price}, '${i.product_id}')" class="bg-white border p-4 rounded-xl cursor-pointer hover:shadow-md active:scale-95 transition"><div class="h-12 w-12 bg-gray-100 rounded-full flex items-center justify-center mb-3 text-xl">🍺</div><h4 class="font-bold text-sm truncate">${i.products.name}</h4><div class="flex justify-between mt-2"><span class="text-xs font-bold">$${i.products.selling_price}</span><span class="text-[10px] text-gray-500">Qty: ${i.quantity}</span></div></div>`).join('');
        c.innerHTML = `<div class="flex flex-col md:flex-row h-full gap-4"><div class="flex-1 overflow-y-auto"><h1 class="text-2xl font-bold mb-4">Bar POS</h1><div class="grid grid-cols-2 md:grid-cols-3 gap-3">${items.length ? items : '<p class="col-span-3 text-gray-400">No stock available to sell.</p>'}</div></div><div class="w-full md:w-80 bg-white border md:border-l border-gray-200 p-4 flex flex-col rounded-xl"><h3 class="font-bold border-b pb-2 mb-2">Current Order</h3><div id="cart-list" class="flex-1 overflow-y-auto space-y-2 mb-2"><p class="text-center text-xs text-gray-400 mt-10">Empty Cart</p></div><div class="pt-2 border-t"><div class="flex justify-between font-bold mb-4"><span>Total</span><span id="cart-total">$0.00</span></div><button onclick="window.checkout()" class="btn-black w-full py-3 rounded-xl font-bold text-sm">Charge & Print</button></div></div></div>`;
        window.renderCart();
    } catch (e) { c.innerHTML = 'Error Bar'; }
}

// --- 4. STAFF SYSTEM ---
async function renderStaff(c) {
    try {
        const staff = await getStaff(profile.organization_id);
        const rows = staff.map(s => `<tr class="border-b border-gray-100"><td class="p-4 font-bold text-sm">${s.full_name}</td><td class="p-4 text-xs text-gray-500">${s.email}</td><td class="p-4"><span class="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-1 rounded uppercase">${s.role.replace('_', ' ')}</span></td></tr>`).join('');
        c.innerHTML = `<div class="flex justify-between items-end mb-6"><h1 class="text-2xl font-bold">Team</h1><button onclick="window.inviteModal()" class="btn-black px-4 py-2 text-xs font-bold rounded-lg">+ Invite</button></div><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Name</th><th class="p-4">Email</th><th class="p-4">Role</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } catch (e) { c.innerHTML = 'Error Staff'; }
}

// --- 5. APPROVALS ---
async function renderApprovals(c) {
    try {
        const reqs = await getPendingApprovals(profile.organization_id);
        const rows = reqs.map(r => `<tr class="border-b border-gray-100"><td class="p-4 font-bold text-sm">${r.products?.name}</td><td class="p-4 text-xs">${r.quantity}</td><td class="p-4 text-xs text-gray-500">${r.profiles?.full_name}</td><td class="p-4 text-right space-x-2"><button onclick="window.approve('${r.id}','approved')" class="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded font-bold">Approve</button><button onclick="window.approve('${r.id}','rejected')" class="text-[10px] bg-red-50 text-red-600 px-2 py-1 rounded font-bold">Reject</button></td></tr>`).join('');
        c.innerHTML = `<h1 class="text-2xl font-bold mb-6">Approvals</h1><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Item</th><th class="p-4">Qty</th><th class="p-4">By</th><th class="p-4 text-right">Action</th></tr></thead><tbody>${rows.length ? rows : '<tr><td colspan="4" class="p-6 text-center text-gray-400">No pending requests.</td></tr>'}</tbody></table></div>`;
    } catch (e) { c.innerHTML = 'Error Approvals'; }
}

// --- GLOBAL ACTIONS ---
window.addCart = (n, p, id) => { const x = cart.find(c => c.id === id); if(x) x.qty++; else cart.push({name:n, price:p, id:id, qty:1}); window.renderCart(); };
window.renderCart = () => {
    const l = document.getElementById('cart-list'); const t = document.getElementById('cart-total');
    if(!cart.length) { l.innerHTML='<p class="text-center text-xs text-gray-400 mt-10">Empty</p>'; t.innerText='$0.00'; return; }
    let tot = 0; l.innerHTML = cart.map(i => { tot += i.price*i.qty; return `<div class="flex justify-between bg-gray-50 p-2 rounded mb-2"><div class="truncate w-24"><div class="text-xs font-bold">${i.name}</div><div class="text-[10px] text-gray-500">${i.qty} x $${i.price}</div></div><button onclick="window.remCart('${i.id}')" class="text-red-500 text-xs font-bold">x</button></div>`; }).join('');
    t.innerText = '$'+tot.toFixed(2);
};
window.remCart = (id) => { cart = cart.filter(c => c.id !== id); window.renderCart(); };
window.checkout = async () => { 
    if(!cart.length) return alert('Cart empty'); 
    if(!confirm('Confirm Sale?')) return;
    try { 
        const items = cart.map(c => ({ product_id: c.id, qty: c.qty, price: c.price }));
        await processBarSale(profile.organization_id, profile.assigned_location_id || 1, items, profile.id); 
        alert('Sale Recorded & Stock Deducted!'); cart=[]; window.renderCart(); router('bar'); 
    } catch(e) { alert(e.message); } 
};

window.openTransfer = (name, pid, floc) => {
    document.getElementById('tProdName').value = name;
    document.getElementById('tProdId').value = pid;
    document.getElementById('tFromLoc').value = floc;
    document.getElementById('transferModal').classList.remove('hidden');
};
window.submitTransfer = async () => {
    const pid = document.getElementById('tProdId').value;
    const floc = document.getElementById('tFromLoc').value;
    const tloc = document.getElementById('tToLoc').value;
    const qty = document.getElementById('tQty').value;
    try {
        await transferStock(pid, floc, tloc, qty, profile.id, profile.organization_id);
        alert('Transfer Successful!'); document.getElementById('transferModal').classList.add('hidden'); router('inventory');
    } catch(e) { alert(e.message); }
};

window.addLoc = () => { document.getElementById('modal-content').innerHTML = `<h3 class="font-bold mb-2">New Location</h3><form onsubmit="event.preventDefault(); window.subLoc()"><input id="nL" placeholder="Name" class="input-field w-full mb-2"><button class="btn-black w-full py-2 rounded">Create</button></form>`; document.getElementById('modal').classList.remove('hidden'); };
window.subLoc = async () => { try { await createLocation(profile.organization_id, document.getElementById('nL').value, 'camp_store'); document.getElementById('modal').classList.add('hidden'); router('settings'); } catch(e){alert(e.message)} };
window.editLoc = (id, n, t) => { document.getElementById('modal-content').innerHTML = `<h3 class="font-bold mb-2">Edit</h3><form onsubmit="event.preventDefault(); window.subEdit('${id}')"><input id="eL" value="${n}" class="input-field w-full mb-2"><button class="btn-black w-full py-2 rounded">Update</button></form>`; document.getElementById('modal').classList.remove('hidden'); };
window.subEdit = async (id) => { try { await updateLocation(id, {name: document.getElementById('eL').value}); document.getElementById('modal').classList.add('hidden'); router('settings'); } catch(e){alert(e.message)} };

// --- HII HAPA INVITE MODAL ILIYOREKEBISHWA ---
window.inviteModal = () => { 
    document.getElementById('modal-content').innerHTML = `
    <h3 class="font-bold mb-2">Invite Staff</h3>
    <form onsubmit="event.preventDefault(); window.subInv()">
        <input id="iE" placeholder="Email Address" class="input-field w-full mb-2">
        <label class="text-xs text-gray-500 font-bold">Assign Role:</label>
        <select id="iR" class="input-field w-full mb-2 bg-white">
            <option value="storekeeper">Camp Storekeeper</option>
            <option value="barman">Barman</option>
            <option value="dept_user">Department User (Kitchen/Housekeeping)</option>
            <option value="finance">Finance / Management</option>
        </select>
        <button class="btn-black w-full py-2 rounded font-bold">Send Invitation</button>
    </form>`; 
    document.getElementById('modal').classList.remove('hidden'); 
};

window.subInv = async () => { try { await inviteStaff(document.getElementById('iE').value, document.getElementById('iR').value, profile.organization_id); alert('Invitation Sent!'); document.getElementById('modal').classList.add('hidden'); } catch(e){alert(e.message)} };

window.approve = async (id, st) => { if(confirm(st+'?')) { try { await respondToApproval(id, st, profile.id); router('approvals'); } catch(e){alert(e.message)} } };
