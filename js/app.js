import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

window.onload = async () => {
    // LOADING UI
    const app = document.getElementById('app-view');
    if(app) app.innerHTML = '<div class="flex h-screen items-center justify-center flex-col"><div class="w-10 h-10 border-4 border-black border-t-transparent rounded-full animate-spin mb-4"></div><p class="text-xs font-bold text-gray-400">VERIFYING INVITE...</p></div>';

    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        const uEmail = session.user.email;
        const uId = session.user.id;

        // 1. THE MASTER HANDSHAKE: Database, huyu ana invite?
        const { data: handshakeStatus } = await supabase.rpc('claim_my_invite', { 
            email_to_check: uEmail, 
            user_id_to_link: uId 
        });

        // 2. FETCH PROFILE (Now updated if it was an invited staff)
        profile = await getCurrentProfile(uId);

        // 3. THE FINAL REDIRECT LOGIC
        if (handshakeStatus === 'LINKED_SUCCESS' || (profile && profile.organization_id)) {
            console.log("Access Verified. Loading Dashboard...");
            // Usiondoke hapa, endelea load Dashboard UI
        } else {
            // Hapa ndipo Manager mpya kweli anaingia
            console.log("No Organization Linked. Redirecting to Setup.");
            window.location.href = 'setup.html';
            return;
        }

        // 4. LOAD UI DATA
        document.getElementById('userName').innerText = profile.full_name || 'User';
        document.getElementById('userRole').innerText = (profile.role || 'staff').replace('_', ' ');
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        const sb = document.getElementById('sidebar');
        if(document.getElementById('mobile-menu-btn')) document.getElementById('mobile-menu-btn').addEventListener('click', () => sb.classList.remove('-translate-x-full'));
        if(document.getElementById('close-sidebar')) document.getElementById('close-sidebar').addEventListener('click', () => sb.classList.add('-translate-x-full'));

        router('inventory');

    } catch (e) {
        console.error("System Error:", e);
        logout();
    }
};

// --- ROUTER & OTHER FUNCTIONS (Copy & Paste standard logic below) ---
window.router = async (view) => {
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-8 h-8 border-2 border-black border-b-transparent rounded-full animate-spin"></div></div>';
    document.getElementById('sidebar').classList.add('-translate-x-full');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('bg-gray-50', 'text-black'));
    document.getElementById(`nav-${view}`)?.classList.add('bg-gray-50', 'text-black');

    if (view === 'inventory') await renderInventory(app);
    else if (view === 'settings') await renderSettings(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'approvals') await renderApprovals(app);
};

// ... (Zingine zote za Inventory, Staff, Bar zinaendelea hapa kama zilivyokuwa awali)
async function renderInventory(c){try{const d=await getInventory(profile.organization_id); const l=await getLocations(profile.organization_id); const r=d.map(i=>`<tr class="border-b border-gray-100"><td class="p-4 font-bold text-sm">${i.products?.name}</td><td class="p-4 text-xs text-gray-500">${i.locations?.name}</td><td class="p-4 font-mono font-bold">${Number(i.quantity).toFixed(1)} ${i.products?.unit}</td><td class="p-4 text-right">${profile.role==='manager'?`<button onclick="window.openTransfer('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] bg-black text-white px-2 py-1 rounded font-bold">Transfer</button>`:''}</td></tr>`).join(''); c.innerHTML=`<div id="transferModal" class="fixed inset-0 bg-black/50 hidden z-[60] flex items-center justify-center p-4"><div class="bg-white p-6 rounded-xl w-full max-w-sm"><h3 class="font-bold text-lg mb-4">Transfer Stock</h3><input id="tProdName" disabled class="input-field w-full mb-2 bg-gray-100"><input type="hidden" id="tProdId"><input type="hidden" id="tFromLoc"><label class="text-xs font-bold text-gray-500">To Location:</label><select id="tToLoc" class="input-field w-full mb-2 bg-white border p-2 rounded">${l.map(x=>`<option value="${x.id}">${x.name}</option>`).join('')}</select><label class="text-xs font-bold text-gray-500">Quantity:</label><input id="tQty" type="number" class="input-field w-full mb-4 border p-2 rounded"><button onclick="window.submitTransfer()" class="btn-black w-full py-3 rounded-xl font-bold">Transfer</button><button onclick="document.getElementById('transferModal').classList.add('hidden')" class="w-full mt-2 text-xs text-gray-500 py-2">Cancel</button></div></div><h1 class="text-2xl font-bold mb-6">Inventory Control</h1><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Item</th><th class="p-4">Loc</th><th class="p-4">Qty</th><th class="p-4 text-right">Action</th></tr></thead><tbody>${r.length?r:'<tr><td colspan="4" class="p-6 text-center text-gray-400">No stock found.</td></tr>'}</tbody></table></div>`; }catch(e){c.innerHTML='Error loading inventory';}}
async function renderSettings(c){try{const l=await getLocations(profile.organization_id); const r=l.map(x=>`<tr class="border-b border-gray-100"><td class="p-4 font-bold text-sm">${x.name}</td><td class="p-4"><span class="bg-gray-100 text-[10px] font-bold px-2 py-1 rounded uppercase">${x.type.replace('_',' ')}</span></td><td class="p-4 text-right"><button onclick="window.editLoc('${x.id}','${x.name}','${x.type}')" class="text-xs font-bold text-gray-400 hover:text-black">Edit</button></td></tr>`).join(''); c.innerHTML=`<div class="flex justify-between items-end mb-6"><h1 class="text-2xl font-bold">Settings</h1><button onclick="window.addLoc()" class="btn-black px-4 py-2 text-xs font-bold rounded-lg">+ Location</button></div><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Name</th><th class="p-4">Type</th><th class="p-4 text-right">Action</th></tr></thead><tbody>${r}</tbody></table></div>`;}catch(e){c.innerHTML='Error settings';}}
async function renderBar(c){try{const s=await getInventory(profile.organization_id); const i=s.filter(x=>x.quantity>0).map(x=>`<div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border p-4 rounded-xl cursor-pointer hover:shadow-md active:scale-95 transition"><div class="h-12 w-12 bg-gray-100 rounded-full flex items-center justify-center mb-3 text-xl">🍺</div><h4 class="font-bold text-sm truncate">${x.products.name}</h4><div class="flex justify-between mt-2"><span class="text-xs font-bold">$${x.products.selling_price}</span><span class="text-[10px] text-gray-500">Qty: ${x.quantity}</span></div></div>`).join(''); c.innerHTML=`<div class="flex flex-col md:flex-row h-full gap-4"><div class="flex-1 overflow-y-auto"><h1 class="text-2xl font-bold mb-4">Bar POS</h1><div class="grid grid-cols-2 md:grid-cols-3 gap-3">${i.length?i:'<p class="col-span-3 text-gray-400">No stock.</p>'}</div></div><div class="w-full md:w-80 bg-white border md:border-l border-gray-200 p-4 flex flex-col rounded-xl"><h3 class="font-bold border-b pb-2 mb-2">Current Order</h3><div id="cart-list" class="flex-1 overflow-y-auto space-y-2 mb-2"><p class="text-center text-xs text-gray-400 mt-10">Empty</p></div><div class="pt-2 border-t"><div class="flex justify-between font-bold mb-4"><span>Total</span><span id="cart-total">$0.00</span></div><button onclick="window.checkout()" class="btn-black w-full py-3 rounded-xl font-bold text-sm">Charge</button></div></div></div>`; window.renderCart();}catch(e){c.innerHTML='Error Bar';}}
async function renderStaff(c){try{const s=await getStaff(profile.organization_id); const r=s.map(x=>`<tr class="border-b border-gray-100"><td class="p-4 font-bold text-sm">${x.full_name}</td><td class="p-4 text-xs text-gray-500">${x.email}</td><td class="p-4"><span class="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-1 rounded uppercase">${x.role.replace('_',' ')}</span></td></tr>`).join(''); c.innerHTML=`<div class="flex justify-between items-end mb-6"><h1 class="text-2xl font-bold">Team</h1><button onclick="window.inviteModal()" class="btn-black px-4 py-2 text-xs font-bold rounded-lg">+ Invite</button></div><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Name</th><th class="p-4">Email</th><th class="p-4">Role</th></tr></thead><tbody>${r}</tbody></table></div>`;}catch(e){c.innerHTML='Error Staff';}}
async function renderApprovals(c){try{const q=await getPendingApprovals(profile.organization_id); const r=q.map(x=>`<tr class="border-b border-gray-100"><td class="p-4 font-bold text-sm">${x.products?.name}</td><td class="p-4 text-xs">${x.quantity}</td><td class="p-4 text-xs text-gray-500">${x.profiles?.full_name}</td><td class="p-4 text-right space-x-2"><button onclick="window.approve('${x.id}','approved')" class="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded font-bold">Approve</button><button onclick="window.approve('${x.id}','rejected')" class="text-[10px] bg-red-50 text-red-600 px-2 py-1 rounded font-bold">Reject</button></td></tr>`).join(''); c.innerHTML=`<h1 class="text-2xl font-bold mb-6">Approvals</h1><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Item</th><th class="p-4">Qty</th><th class="p-4">By</th><th class="p-4 text-right">Action</th></tr></thead><tbody>${r.length?r:'<tr><td colspan="4" class="p-6 text-center text-gray-400">No requests.</td></tr>'}</tbody></table></div>`;}catch(e){c.innerHTML='Error Approvals';}}
window.inviteModal=()=>{document.getElementById('modal-content').innerHTML=`<h3 class="font-bold mb-2">Invite</h3><form onsubmit="event.preventDefault();window.sI()"><input id="iE" class="input-field w-full mb-2" placeholder="Email" required><select id="iR" class="input-field w-full mb-2 bg-white"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance</option></select><button class="btn-black w-full py-2 rounded">Send Invite</button></form>`;document.getElementById('modal').classList.remove('hidden');}
window.sI=async()=>{const e=document.getElementById('iE').value; if(!e) return alert("Email required"); try{await inviteStaff(e, document.getElementById('iR').value, profile.organization_id); alert('Sent'); document.getElementById('modal').classList.add('hidden');}catch(err){alert(err.message);}}
