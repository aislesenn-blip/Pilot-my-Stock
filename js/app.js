import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

window.onload = async () => {
    // 1. Loading UI
    const app = document.getElementById('app-view');
    if(app) app.innerHTML = '<div class="flex h-screen items-center justify-center flex-col"><div class="w-10 h-10 border-4 border-black border-t-transparent rounded-full animate-spin mb-4"></div><p class="text-xs font-bold text-gray-400 uppercase tracking-widest">LOADING SECURE PORTAL...</p></div>';

    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        // 2. MASTER HANDSHAKE (Inahakikisha Invited User anaunganishwa)
        await supabase.rpc('claim_my_invite', { 
            email_to_check: session.user.email, 
            user_id_to_link: session.user.id 
        });

        // 3. Vuta Profile ya uhakika
        const { data: freshProfile, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = freshProfile;

        // 4. CHECK KAMA ANA KAMPUNI
        if (!profile || !profile.organization_id) {
            window.location.href = 'setup.html';
            return;
        }

        // 5. JAZA TAARIFA ZA DASHBOARD
        document.getElementById('userName').innerText = profile.full_name || 'User';
        document.getElementById('userRole').innerText = (profile.role || 'staff').replace('_', ' ');
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        // 6. ROLE-BASED LANDING (HAPA NDIYO FIX YAKO)
        // Inampeleka kila mtu kwenye interface yake husika akishaingia tu
        if (profile.role === 'barman') {
            router('bar'); 
        } else if (profile.role === 'finance') {
            router('approvals'); // Finance wanaanza na Approvals/Reports
        } else {
            router('inventory'); // Manager na Storekeeper
        }

        // Mobile Menu Setup
        const sb = document.getElementById('sidebar');
        if(document.getElementById('mobile-menu-btn')) document.getElementById('mobile-menu-btn').addEventListener('click', () => sb.classList.remove('-translate-x-full'));
        if(document.getElementById('close-sidebar')) document.getElementById('close-sidebar').addEventListener('click', () => sb.classList.add('-translate-x-full'));

    } catch (e) {
        console.error("System Error:", e);
        logout();
    }
};

window.router = async (view) => {
    // ULINZI WA ROLE (Role Protection)
    // Zuia Barman au Finance wasiingie kwenye Settings au Team Management
    if ((view === 'settings' || view === 'staff') && profile.role !== 'manager') {
        alert("Access Denied: Managers Only.");
        return;
    }

    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-8 h-8 border-2 border-black border-b-transparent rounded-full animate-spin"></div></div>';
    
    // Funga sidebar kwenye mobile baada ya kuchagua
    if(document.getElementById('sidebar')) document.getElementById('sidebar').classList.add('-translate-x-full');

    // Update Active UI Tab
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('bg-gray-100', 'text-black', 'font-bold'));
    document.getElementById(`nav-${view}`)?.classList.add('bg-gray-100', 'text-black', 'font-bold');

    // Render Husika
    if (view === 'inventory') await renderInventory(app);
    else if (view === 'settings') await renderSettings(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'approvals') await renderApprovals(app);
};

// --- RENDER FUNCTIONS ---

async function renderInventory(c){
    try {
        const d = await getInventory(profile.organization_id); 
        const l = await getLocations(profile.organization_id); 
        const r = d.map(i => `
            <tr class="border-b border-gray-50">
                <td class="p-4 font-bold text-sm text-gray-900">${i.products?.name}</td>
                <td class="p-4 text-xs text-gray-500">${i.locations?.name}</td>
                <td class="p-4 font-mono font-bold text-gray-900">${Number(i.quantity).toFixed(1)} ${i.products?.unit}</td>
                <td class="p-4 text-right">
                    ${profile.role === 'manager' ? `<button onclick="window.openTransfer('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] bg-black text-white px-3 py-1.5 rounded-lg font-bold">Transfer</button>` : '<span class="text-gray-300 text-[10px]">Read Only</span>'}
                </td>
            </tr>`).join('');
        
        c.innerHTML = `
            <h1 class="text-2xl font-bold mb-6 text-gray-900">Live Inventory</h1>
            <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 tracking-widest font-bold">
                        <tr><th class="p-4">Product</th><th class="p-4">Location</th><th class="p-4">Balance</th><th class="p-4 text-right">Action</th></tr>
                    </thead>
                    <tbody>${r.length ? r : '<tr><td colspan="4" class="p-10 text-center text-gray-400">No stock records found.</td></tr>'}</tbody>
                </table>
            </div>
            <div id="transferModal" class="fixed inset-0 bg-black/50 hidden z-[100] flex items-center justify-center p-4">
                <div class="bg-white p-6 rounded-2xl w-full max-w-sm">
                    <h3 class="font-bold text-lg mb-4">Transfer Stock</h3>
                    <input id="tProdName" disabled class="w-full p-3 bg-gray-50 border rounded-xl mb-3 text-sm">
                    <input type="hidden" id="tProdId"><input type="hidden" id="tFromLoc">
                    <label class="text-[10px] font-bold text-gray-400 uppercase">Destination</label>
                    <select id="tToLoc" class="w-full p-3 border rounded-xl mb-4 bg-white">${l.map(x=>`<option value="${x.id}">${x.name}</option>`).join('')}</select>
                    <label class="text-[10px] font-bold text-gray-400 uppercase">Quantity</label>
                    <input id="tQty" type="number" class="w-full p-3 border rounded-xl mb-6" placeholder="0.00">
                    <button onclick="window.submitTransfer()" class="w-full bg-black text-white py-4 rounded-xl font-bold">Confirm Transfer</button>
                    <button onclick="document.getElementById('transferModal').classList.add('hidden')" class="w-full mt-2 text-sm text-gray-400 py-2">Cancel</button>
                </div>
            </div>`;
    } catch(e) { c.innerHTML = "Failed to load inventory."; }
}

async function renderApprovals(c){
    try {
        const q = await getPendingApprovals(profile.organization_id); 
        const r = q.map(x => `
            <tr class="border-b border-gray-50">
                <td class="p-4 font-bold text-sm">${x.products?.name}</td>
                <td class="p-4 text-xs font-mono text-blue-600">${x.quantity}</td>
                <td class="p-4 text-xs text-gray-500">${x.profiles?.full_name}</td>
                <td class="p-4 text-right space-x-2">
                    <button onclick="window.approve('${x.id}','approved')" class="text-[10px] bg-green-500 text-white px-3 py-1.5 rounded font-bold">Approve</button>
                    <button onclick="window.approve('${x.id}','rejected')" class="text-[10px] bg-red-50 text-red-600 px-3 py-1.5 rounded font-bold">Reject</button>
                </td>
            </tr>`).join('');
        
        c.innerHTML = `
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-2xl font-bold text-gray-900">Finance & Approvals</h1>
                <div class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter">Finance Access</div>
            </div>
            <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] uppercase text-gray-400 font-bold">
                        <tr><th class="p-4">Item Requested</th><th class="p-4">Qty</th><th class="p-4">Staff</th><th class="p-4 text-right">Action</th></tr>
                    </thead>
                    <tbody>${r.length ? r : '<tr><td colspan="4" class="p-10 text-center text-gray-400">No pending approvals for today.</td></tr>'}</tbody>
                </table>
            </div>`;
    } catch(e) { c.innerHTML = "Error loading approvals."; }
}

async function renderBar(c){
    try {
        const s = await getInventory(profile.organization_id); 
        const i = s.filter(x => x.quantity > 0).map(x => `
            <div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border border-gray-100 p-5 rounded-2xl cursor-pointer hover:shadow-lg transition active:scale-95">
                <div class="h-10 w-10 bg-gray-50 rounded-full flex items-center justify-center mb-3">🍺</div>
                <h4 class="font-bold text-sm text-gray-900">${x.products.name}</h4>
                <div class="flex justify-between items-center mt-3">
                    <span class="text-xs font-bold text-gray-900">$${x.products.selling_price}</span>
                    <span class="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500">Stock: ${x.quantity}</span>
                </div>
            </div>`).join('');
        
        c.innerHTML = `
            <div class="flex flex-col lg:flex-row h-full gap-6">
                <div class="flex-1">
                    <h1 class="text-2xl font-bold mb-6">Bar POS</h1>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4">${i.length ? i : '<p class="text-gray-400">Inventory is empty.</p>'}</div>
                </div>
                <div class="w-full lg:w-80 bg-white border border-gray-200 p-6 flex flex-col rounded-2xl shadow-sm">
                    <h3 class="font-bold text-gray-900 border-b pb-4 mb-4">Current Bill</h3>
                    <div id="cart-list" class="flex-1 overflow-y-auto space-y-3"></div>
                    <div class="pt-4 border-t mt-4">
                        <div class="flex justify-between font-bold text-lg mb-4"><span>Total</span><span id="cart-total">$0.00</span></div>
                        <button onclick="window.checkout()" class="w-full bg-black text-white py-4 rounded-xl font-bold shadow-lg">Process Order</button>
                    </div>
                </div>
            </div>`;
        window.renderCart();
    } catch(e) { c.innerHTML = "Error loading Bar POS."; }
}

// --- CORE UTILS (HIZI HAZIJABADILIKA) ---
window.addCart=(n,p,i)=>{const x=cart.find(c=>c.id===i); if(x)x.qty++; else cart.push({name:n,price:p,id:i,qty:1}); window.renderCart();}
window.renderCart=()=>{const l=document.getElementById('cart-list'),t=document.getElementById('cart-total'); if(!cart.length){l.innerHTML='<p class="text-center text-xs text-gray-400 mt-10">Bill is empty</p>';t.innerText='$0.00';return;} let tot=0; l.innerHTML=cart.map(i=>{tot+=i.price*i.qty; return `<div class="flex justify-between items-center bg-gray-50 p-3 rounded-xl"><div class="truncate w-32"><div class="text-xs font-bold text-gray-900">${i.name}</div><div class="text-[10px] text-gray-500">${i.qty} x $${i.price}</div></div><button onclick="window.remCart('${i.id}')" class="text-red-500 font-bold text-xs">Remove</button></div>`;}).join(''); t.innerText='$'+tot.toFixed(2);}
window.remCart=(i)=>{cart=cart.filter(c=>c.id!==i); window.renderCart();}
window.checkout=async()=>{if(!cart.length)return alert('No items selected.'); if(!confirm('Finalize this sale?'))return; try{await processBarSale(profile.organization_id, profile.assigned_location_id||1, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); alert('Sale Completed!'); cart=[]; window.renderCart(); router('bar');}catch(e){alert(e.message);}}
window.openTransfer=(n,i,f)=>{document.getElementById('tProdName').value=n;document.getElementById('tProdId').value=i;document.getElementById('tFromLoc').value=f;document.getElementById('transferModal').classList.remove('hidden');}
window.submitTransfer=async()=>{try{await transferStock(document.getElementById('tProdId').value, document.getElementById('tFromLoc').value, document.getElementById('tToLoc').value, document.getElementById('tQty').value, profile.id, profile.organization_id); alert('Transfer Success'); document.getElementById('transferModal').classList.add('hidden'); router('inventory');}catch(e){alert(e.message);}}

// Settings & Staff (Only for Managers)
async function renderSettings(c){try{const l=await getLocations(profile.organization_id); const r=l.map(x=>`<tr class="border-b"><td class="p-4 font-bold">${x.name}</td><td class="p-4 text-xs uppercase">${x.type}</td></tr>`).join(''); c.innerHTML=`<div class="flex justify-between mb-6"><h1 class="text-2xl font-bold">Settings</h1><button onclick="window.addLoc()" class="bg-black text-white px-4 py-2 rounded-xl text-xs font-bold">+ New Location</button></div><div class="bg-white rounded-2xl border border-gray-100 overflow-hidden"><table class="w-full text-left"><tbody>${r}</tbody></table></div>`;}catch(e){}}
async function renderStaff(c){try{const s = await getStaff(profile.organization_id); const r=s.map(x=>`<tr class="border-b"><td class="p-4 font-bold text-sm">${x.full_name}</td><td class="p-4 text-xs text-gray-500">${x.email}</td><td class="p-4 uppercase text-[10px] font-bold">${x.role}</td></tr>`).join(''); c.innerHTML=`<div class="flex justify-between mb-6"><h1 class="text-2xl font-bold">Team</h1><button onclick="window.inviteModal()" class="bg-black text-white px-4 py-2 rounded-xl text-xs font-bold">+ Invite Staff</button></div><div class="bg-white rounded-2xl border border-gray-100 overflow-hidden"><table class="w-full text-left"><tbody>${r}</tbody></table></div>`;}catch(e){}}

window.inviteModal=()=>{document.getElementById('modal-content').innerHTML=`<h3 class="font-bold mb-4">Invite Staff</h3><input id="iE" class="w-full p-3 border rounded-xl mb-3" placeholder="Staff Email" type="email" required><select id="iR" class="w-full p-3 border rounded-xl mb-4 bg-white"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance</option></select><button onclick="window.sI()" class="w-full bg-black text-white py-3 rounded-xl font-bold">Send Invite</button>`;document.getElementById('modal').classList.remove('hidden');}
window.sI=async()=>{const e=document.getElementById('iE').value.trim(); try{await inviteStaff(e, document.getElementById('iR').value, profile.organization_id); alert('Invitation Sent! They can now Login.'); document.getElementById('modal').classList.add('hidden');}catch(err){alert(err.message);}}
window.approve=async(i,s)=>{if(confirm('Confirm '+s+'?'))try{await respondToApproval(i,s,profile.id); router('approvals');}catch(e){alert(e.message);}}
