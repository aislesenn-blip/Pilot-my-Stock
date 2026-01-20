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

        document.getElementById('userName').innerText = profile.full_name || 'User';
        document.getElementById('userRole').innerText = profile.role.toUpperCase();
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        // Start at Inventory
        router('inventory');
    } catch (e) { console.error(e); logout(); }
};

window.router = async (view) => {
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div></div>';
    
    if (view === 'inventory') await renderInventory(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'approvals') await renderApprovals(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'settings') await renderSettings(app);
};

// --- INVENTORY & PRODUCT MANAGEMENT ---
async function renderInventory(c) {
    try {
        const data = await getInventory(profile.organization_id);
        const rows = data.map(i => `
            <tr class="border-b border-gray-50">
                <td class="p-4 font-bold text-sm">${i.products?.name}</td>
                <td class="p-4 text-xs font-bold text-gray-400 uppercase">${i.locations?.name}</td>
                <td class="p-4 font-mono font-bold text-gray-900">${i.quantity}</td>
                <td class="p-4 text-right">
                    <button onclick="window.issueModal('${i.products.name}','${i.product_id}','${i.location_id}')" class="bg-black text-white px-3 py-1.5 rounded-lg text-[10px] font-bold">Issue</button>
                </td>
            </tr>`).join('');

        c.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <h1 class="text-xl font-bold uppercase tracking-widest text-gray-400">Inventory Control</h1>
                <div class="flex gap-2">
                    <button onclick="window.addProductModal()" class="bg-white border border-black text-black px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest">+ Register Item</button>
                    <button onclick="window.addStockModal()" class="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest">+ Receive Stock</button>
                </div>
            </div>
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold border-b border-gray-100">
                        <tr><th class="p-4">SKU / Product</th><th class="p-4">Location</th><th class="p-4">Qty</th><th class="p-4 text-right">Action</th></tr>
                    </thead>
                    <tbody>${rows.length ? rows : '<tr><td colspan="4" class="p-12 text-center text-xs text-gray-400 font-bold">NO RECORDS. CLICK "+ REGISTER ITEM" TO START.</td></tr>'}</tbody>
                </table>
            </div>`;
    } catch(e) {}
}

// --- PRODUCT & STOCK FORMS ---

window.addProductModal = () => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Register New Item</h3>
        <input id="pN" class="w-full p-3 border rounded-xl mb-3 text-sm" placeholder="Product Name (e.g. Safari Lager)">
        <div class="grid grid-cols-2 gap-3 mb-6">
            <input id="pC" type="number" class="w-full p-3 border rounded-xl text-sm" placeholder="Cost Price">
            <input id="pS" type="number" class="w-full p-3 border rounded-xl text-sm" placeholder="Selling Price">
        </div>
        <button onclick="window.execAddProduct()" class="w-full bg-black text-white py-4 rounded-xl font-bold text-[10px] uppercase tracking-widest">Add to Master List</button>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execAddProduct = async () => {
    const name = document.getElementById('pN').value;
    const cost = document.getElementById('pC').value;
    const sell = document.getElementById('pS').value;
    if(!name || !cost || !sell) return alert("Fill all fields");

    try {
        await supabase.from('products').insert({
            name, cost_price: cost, selling_price: sell, organization_id: profile.organization_id
        });
        alert('Product Registered.');
        document.getElementById('modal').classList.add('hidden');
        router('inventory');
    } catch(e) { alert(e.message); }
}

window.addStockModal = async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('organization_id', profile.organization_id);
    const { data: locs } = await supabase.from('locations').select('*').eq('organization_id', profile.organization_id);

    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6 uppercase tracking-tight">Receive Initial Stock</h3>
        <select id="sP" class="w-full p-3 border rounded-xl mb-3 text-sm bg-white">${prods.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select>
        <select id="sL" class="w-full p-3 border rounded-xl mb-3 text-sm bg-white">${locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select>
        <input id="sQ" type="number" class="w-full p-3 border rounded-xl mb-6 text-sm" placeholder="Quantity">
        <button onclick="window.execAddStock()" class="w-full bg-black text-white py-4 rounded-xl font-bold text-[10px] uppercase tracking-widest">Update Balance</button>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.execAddStock = async () => {
    const pid = document.getElementById('sP').value;
    const lid = document.getElementById('sL').value;
    const qty = document.getElementById('sQ').value;
    if(!qty) return alert("Enter quantity");

    try {
        const { data: exist } = await supabase.from('inventory').select('*').eq('product_id', pid).eq('location_id', lid).maybeSingle();
        if(exist) {
            await supabase.from('inventory').update({ quantity: parseFloat(exist.quantity) + parseFloat(qty) }).eq('id', exist.id);
        } else {
            await supabase.from('inventory').insert({ product_id: pid, location_id: lid, quantity: qty, organization_id: profile.organization_id });
        }
        alert('Stock Updated.');
        document.getElementById('modal').classList.add('hidden');
        router('inventory');
    } catch(e) { alert(e.message); }
}

// --- SETTINGS: EDIT WORKS NOW ---
async function renderSettings(c) {
    const locs = await getLocations(profile.organization_id);
    const rows = locs.map(l => `
        <tr class="border-b">
            <td class="p-4 font-bold text-sm">${l.name}</td>
            <td class="p-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">${l.type}</td>
            <td class="p-4 text-right">
                <button onclick="window.editStoreModal('${l.id}','${l.name}','${l.type}')" class="text-blue-500 font-bold text-[10px] uppercase">Edit</button>
            </td>
        </tr>`).join('');
    c.innerHTML = `
        <div class="flex justify-between mb-8">
            <h1 class="text-xl font-bold">Store Configuration</h1>
            <button onclick="window.addStoreModal()" class="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-bold tracking-widest">+ New Store</button>
        </div>
        <div class="bg-white rounded-2xl border overflow-hidden shadow-sm"><table class="w-full text-left"><tbody>${rows}</tbody></table></div>`;
}

window.editStoreModal = (id, name, type) => {
    document.getElementById('modal-content').innerHTML = `
        <h3 class="font-bold text-lg mb-6">Edit Store</h3>
        <input id="eN" value="${name}" class="w-full p-3 border rounded-xl mb-4 text-sm">
        <select id="eT" class="w-full p-3 border rounded-xl mb-6 bg-white text-sm">
            <option value="main_store" ${type === 'main_store' ? 'selected' : ''}>Main Store</option>
            <option value="camp_store" ${type === 'camp_store' ? 'selected' : ''}>Camp Store</option>
        </select>
        <button onclick="window.updateStore('${id}')" class="w-full bg-black text-white py-4 rounded-xl font-bold text-xs uppercase tracking-widest">Save Changes</button>`;
    document.getElementById('modal').classList.remove('hidden');
}

window.updateStore = async (id) => {
    try {
        await updateLocation(id, { name: document.getElementById('eN').value, type: document.getElementById('eT').value });
        document.getElementById('modal').classList.add('hidden');
        router('settings');
    } catch(e) { alert(e.message); }
}

// --- BAR POS: REAL VALIDATION ---
async function renderBar(c) {
    const inv = await getInventory(profile.organization_id);
    const barItems = inv.filter(x => x.location_id === profile.assigned_location_id);
    const items = barItems.map(x => `
        <div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border p-5 rounded-2xl cursor-pointer hover:border-black shadow-sm">
            <h4 class="font-bold text-sm text-gray-900 uppercase">${x.products.name}</h4>
            <div class="flex justify-between items-center mt-3"><span class="text-xs font-bold">$${x.products.selling_price}</span><span class="text-[9px] font-bold text-gray-300 uppercase">Stock: ${x.quantity}</span></div>
        </div>`).join('');
    c.innerHTML = `
        <div class="flex flex-col lg:flex-row gap-8 h-full">
            <div class="flex-1 overflow-y-auto pr-2">
                <h1 class="text-xl font-bold mb-8 uppercase tracking-widest text-gray-400">Sales Entry</h1>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-4">${items.length ? items : 'No stock assigned to your bar.'}</div>
            </div>
            <div class="w-full lg:w-96 bg-white border p-6 rounded-3xl shadow-xl flex flex-col h-fit sticky top-0">
                <h3 class="font-bold text-lg mb-6 uppercase tracking-tight text-gray-900">Active Bill</h3>
                <div id="cart-list" class="flex-1 space-y-4 max-h-[300px] overflow-y-auto mb-6"></div>
                <div class="pt-6 border-t border-gray-100">
                    <div class="flex justify-between font-bold text-xl mb-6 text-gray-900 tracking-tighter"><span>Total</span><span id="cart-total">$0.00</span></div>
                    <button onclick="window.checkout()" class="w-full bg-black text-white py-4 rounded-2xl font-bold text-xs uppercase tracking-widest">Complete Sale</button>
                </div>
            </div>
        </div>`;
    window.renderCart();
}

window.checkout = async () => {
    if(!cart.length) return alert("Ticket is empty! Add products first.");
    try {
        await processBarSale(profile.organization_id, profile.assigned_location_id, cart.map(c => ({ product_id: c.id, qty: c.qty, price: c.price })), profile.id);
        alert('Sale Authenticated.'); cart = []; window.renderCart(); router('bar');
    } catch(e) { alert(e.message); }
}

// --- UTILS (RE-USING LOGIC) ---
window.addCart=(n,p,id)=>{const x=cart.find(c=>c.id===id); if(x)x.qty++; else cart.push({name:n,price:p,id,qty:1}); window.renderCart();}
window.renderCart=()=>{
    const l=document.getElementById('cart-list'), t=document.getElementById('cart-total');
    if(!cart.length){l.innerHTML='<div class="text-center py-10 text-gray-300 text-[10px] font-bold uppercase tracking-widest">No Selection</div>'; t.innerText='$0.00'; return;}
    let sum = 0;
    l.innerHTML = cart.map(i => { sum += i.price * i.qty; return `<div class="flex justify-between text-xs font-bold uppercase"><span>${i.name} (${i.qty})</span><button onclick="window.remCart('${i.id}')" class="text-red-400">×</button></div>` }).join('');
    t.innerText = '$' + sum.toFixed(2);
}
window.remCart=(id)=>{cart=cart.filter(c=>c.id!==id); window.renderCart();}
