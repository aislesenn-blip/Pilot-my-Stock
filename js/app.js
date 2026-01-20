import { getSession, getCurrentProfile, logout } from './auth.js';
import { getInventory, getLocations, createLocation, updateLocation, processBarSale, getStaff, inviteStaff, getPendingApprovals, respondToApproval, transferStock } from './services.js';
import { supabase } from './supabase.js';

let profile = null;
let cart = [];

window.onload = async () => {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    try {
        // --- MASTER OVERRIDE ---
        // Tunalazimisha database kukuunganisha kabla ya kuangalia chochote
        const { data: status } = await supabase.rpc('claim_invite', { 
            user_email: session.user.email, 
            user_id: session.user.id 
        });

        // Sasa vuta profile iliyokamilika
        profile = await getCurrentProfile(session.user.id);

        // --- THE ONLY REDIRECT LOGIC YOU NEED ---
        if (!profile || !profile.organization_id) {
            // Kama RPC haijaona invite, na Profile haina kampuni, basi ni Manager mpya
            window.location.href = 'setup.html';
            return;
        }

        // --- DASHBOARD UI ---
        document.getElementById('userName').innerText = profile.full_name || 'User';
        document.getElementById('userRole').innerText = (profile.role || 'staff').replace('_', ' ');
        document.getElementById('avatar').innerText = (profile.full_name || 'U').charAt(0);
        window.logoutAction = logout;

        router('inventory');
    } catch (e) {
        console.error(e);
        logout();
    }
};

// --- ROUTER & UI FUNCTIONS ---
window.router = async (view) => {
    const app = document.getElementById('app-view');
    app.innerHTML = '<div class="flex h-full items-center justify-center"><div class="w-8 h-8 border-2 border-black border-b-transparent rounded-full animate-spin"></div></div>';
    
    if (view === 'inventory') await renderInventory(app);
    else if (view === 'settings') await renderSettings(app);
    else if (view === 'bar') await renderBar(app);
    else if (view === 'staff') await renderStaff(app);
    else if (view === 'approvals') await renderApprovals(app);
};

// ... (Functions za renderInventory, renderBar nk. zote zinabaki vilevile)
async function renderInventory(c){try{const d=await getInventory(profile.organization_id); const l=await getLocations(profile.organization_id); const r=d.map(i=>`<tr class="border-b border-gray-100"><td class="p-4 font-bold text-sm">${i.products?.name}</td><td class="p-4 text-xs text-gray-500">${i.locations?.name}</td><td class="p-4 font-mono font-bold">${Number(i.quantity).toFixed(1)} ${i.products?.unit}</td><td class="p-4 text-right">${profile.role==='manager'?`<button onclick="window.openTransfer('${i.products.name}','${i.product_id}','${i.location_id}')" class="text-[10px] bg-black text-white px-2 py-1 rounded font-bold">Transfer</button>`:''}</td></tr>`).join(''); c.innerHTML=`<div id="transferModal" class="fixed inset-0 bg-black/50 hidden z-[60] flex items-center justify-center p-4"><div class="bg-white p-6 rounded-xl w-full max-w-sm"><h3 class="font-bold text-lg mb-4">Transfer Stock</h3><input id="tProdName" disabled class="input-field w-full mb-2 bg-gray-100"><input type="hidden" id="tProdId"><input type="hidden" id="tFromLoc"><label class="text-xs font-bold text-gray-500">To Location:</label><select id="tToLoc" class="input-field w-full mb-2 bg-white border p-2 rounded">${l.map(x=>`<option value="${x.id}">${x.name}</option>`).join('')}</select><label class="text-xs font-bold text-gray-500">Quantity:</label><input id="tQty" type="number" class="input-field w-full mb-4 border p-2 rounded"><button onclick="window.submitTransfer()" class="btn-black w-full py-3 rounded-xl font-bold">Transfer</button><button onclick="document.getElementById('transferModal').classList.add('hidden')" class="w-full mt-2 text-xs text-gray-500 py-2">Cancel</button></div></div><h1 class="text-2xl font-bold mb-6">Inventory Control</h1><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Item</th><th class="p-4">Loc</th><th class="p-4">Qty</th><th class="p-4 text-right">Action</th></tr></thead><tbody>${r.length?r:'<tr><td colspan="4" class="p-6 text-center text-gray-400">No stock found.</td></tr>'}</tbody></table></div>`; }catch(e){c.innerHTML='Error loading inventory';}}
async function renderSettings(c){try{const l=await getLocations(profile.organization_id); const r=l.map(x=>`<tr class="border-b border-gray-100"><td class="p-4 font-bold text-sm">${x.name}</td><td class="p-4"><span class="bg-gray-100 text-[10px] font-bold px-2 py-1 rounded uppercase">${x.type.replace('_',' ')}</span></td><td class="p-4 text-right"><button onclick="window.editLoc('${x.id}','${x.name}','${x.type}')" class="text-xs font-bold text-gray-400 hover:text-black">Edit</button></td></tr>`).join(''); c.innerHTML=`<div class="flex justify-between items-end mb-6"><h1 class="text-2xl font-bold">Settings</h1><button onclick="window.addLoc()" class="btn-black px-4 py-2 text-xs font-bold rounded-lg">+ Location</button></div><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Name</th><th class="p-4">Type</th><th class="p-4 text-right">Action</th></tr></thead><tbody>${r}</tbody></table></div>`;}catch(e){c.innerHTML='Error settings';}}
async function renderBar(c){try{const s=await getInventory(profile.organization_id); const i=s.filter(x=>x.quantity>0).map(x=>`<div onclick="window.addCart('${x.products.name}',${x.products.selling_price},'${x.product_id}')" class="bg-white border p-4 rounded-xl cursor-pointer hover:shadow-md active:scale-95 transition"><div class="h-12 w-12 bg-gray-100 rounded-full flex items-center justify-center mb-3 text-xl">🍺</div><h4 class="font-bold text-sm truncate">${x.products.name}</h4><div class="flex justify-between mt-2"><span class="text-xs font-bold">$${x.products.selling_price}</span><span class="text-[10px] text-gray-500">Qty: ${x.quantity}</span></div></div>`).join(''); c.innerHTML=`<div class="flex flex-col md:flex-row h-full gap-4"><div class="flex-1 overflow-y-auto"><h1 class="text-2xl font-bold mb-4">Bar POS</h1><div class="grid grid-cols-2 md:grid-cols-3 gap-3">${i.length?i:'<p class="col-span-3 text-gray-400">No stock.</p>'}</div></div><div class="w-full md:w-80 bg-white border md:border-l border-gray-200 p-4 flex flex-col rounded-xl"><h3 class="font-bold border-b pb-2 mb-2">Current Order</h3><div id="cart-list" class="flex-1 overflow-y-auto space-y-2 mb-2"><p class="text-center text-xs text-gray-400 mt-10">Empty</p></div><div class="pt-2 border-t"><div class="flex justify-between font-bold mb-4"><span>Total</span><span id="cart-total">$0.00</span></div><button onclick="window.checkout()" class="btn-black w-full py-3 rounded-xl font-bold text-sm">Charge</button></div></div></div>`; window.renderCart();}catch(e){c.innerHTML='Error Bar';}}
async function renderStaff(c){try{const s=await getStaff(profile.organization_id); const r=s.map(x=>`<tr class="border-b border-gray-100"><td class="p-4 font-bold text-sm">${x.full_name}</td><td class="p-4 text-xs text-gray-500">${x.email}</td><td class="p-4"><span class="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-1 rounded uppercase">${x.role.replace('_',' ')}</span></td></tr>`).join(''); c.innerHTML=`<div class="flex justify-between items-end mb-6"><h1 class="text-2xl font-bold">Team</h1><button onclick="window.inviteModal()" class="btn-black px-4 py-2 text-xs font-bold rounded-lg">+ Invite</button></div><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Name</th><th class="p-4">Email</th><th class="p-4">Role</th></tr></thead><tbody>${r}</tbody></table></div>`;}catch(e){c.innerHTML='Error Staff';}}
async function renderApprovals(c){try{const q=await getPendingApprovals(profile.organization_id); const r=q.map(x=>`<tr class="border-b border-gray-100"><td class="p-4 font-bold text-sm">${x.products?.name}</td><td class="p-4 text-xs">${x.quantity}</td><td class="p-4 text-xs text-gray-500">${x.profiles?.full_name}</td><td class="p-4 text-right space-x-2"><button onclick="window.approve('${x.id}','approved')" class="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded font-bold">Approve</button><button onclick="window.approve('${x.id}','rejected')" class="text-[10px] bg-red-50 text-red-600 px-2 py-1 rounded font-bold">Reject</button></td></tr>`).join(''); c.innerHTML=`<h1 class="text-2xl font-bold mb-6">Approvals</h1><div class="glass rounded-xl overflow-hidden"><table class="w-full text-left"><thead class="bg-gray-50 text-[10px] uppercase text-gray-400"><tr><th class="p-4">Item</th><th class="p-4">Qty</th><th class="p-4">By</th><th class="p-4 text-right">Action</th></tr></thead><tbody>${r.length?r:'<tr><td colspan="4" class="p-6 text-center text-gray-400">No requests.</td></tr>'}</tbody></table></div>`;}catch(e){c.innerHTML='Error Approvals';}}
window.addCart=(n,p,i)=>{const x=cart.find(c=>c.id===i); if(x)x.qty++; else cart.push({name:n,price:p,id:i,qty:1}); window.renderCart();}
window.renderCart=()=>{const l=document.getElementById('cart-list'),t=document.getElementById('cart-total'); if(!cart.length){l.innerHTML='<p class="text-center text-xs text-gray-400 mt-10">Empty</p>';t.innerText='$0.00';return;} let tot=0; l.innerHTML=cart.map(i=>{tot+=i.price*i.qty; return `<div class="flex justify-between bg-gray-50 p-2 rounded mb-2"><div class="truncate w-24"><div class="text-xs font-bold">${i.name}</div><div class="text-[10px] text-gray-500">${i.qty} x $${i.price}</div></div><button onclick="window.remCart('${i.id}')" class="text-red-500 text-xs font-bold">x</button></div>`;}).join(''); t.innerText='$'+tot.toFixed(2);}
window.remCart=(i)=>{cart=cart.filter(c=>c.id!==i); window.renderCart();}
window.checkout=async()=>{if(!cart.length)return alert('Empty'); if(!confirm('Sale?'))return; try{await processBarSale(profile.organization_id, profile.assigned_location_id||1, cart.map(c=>({product_id:c.id,qty:c.qty,price:c.price})), profile.id); alert('Sold!'); cart=[]; window.renderCart(); router('bar');}catch(e){alert(e.message);}}
window.openTransfer=(n,i,f)=>{document.getElementById('tProdName').value=n;document.getElementById('tProdId').value=i;document.getElementById('tFromLoc').value=f;document.getElementById('transferModal').classList.remove('hidden');}
window.submitTransfer=async()=>{try{await transferStock(document.getElementById('tProdId').value, document.getElementById('tFromLoc').value, document.getElementById('tToLoc').value, document.getElementById('tQty').value, profile.id, profile.organization_id); alert('Success'); document.getElementById('transferModal').classList.add('hidden'); router('inventory');}catch(e){alert(e.message);}}
window.addLoc=()=>{document.getElementById('modal-content').innerHTML=`<h3 class="font-bold mb-2">New Loc</h3><form onsubmit="event.preventDefault();window.sL()"><input id="nL" class="input-field w-full mb-2" placeholder="Name"><button class="btn-black w-full py-2 rounded">Save</button></form>`;document.getElementById('modal').classList.remove('hidden');}
window.sL=async()=>{try{await createLocation(profile.organization_id, document.getElementById('nL').value, 'camp_store'); document.getElementById('modal').classList.add('hidden'); router('settings');}catch(e){alert(e.message);}}
window.editLoc=(i,n,t)=>{document.getElementById('modal-content').innerHTML=`<h3 class="font-bold mb-2">Edit</h3><form onsubmit="event.preventDefault();window.uL('${i}')"><input id="eL" value="${n}" class="input-field w-full mb-2"><button class="btn-black w-full py-2 rounded">Update</button></form>`;document.getElementById('modal').classList.remove('hidden');}
window.uL=async(i)=>{try{await updateLocation(i, {name:document.getElementById('eL').value}); document.getElementById('modal').classList.add('hidden'); router('settings');}catch(e){alert(e.message);}}
window.approve=async(i,s)=>{if(confirm(s+'?'))try{await respondToApproval(i,s,profile.id); router('approvals');}catch(e){alert(e.message);}}
window.inviteModal=()=>{document.getElementById('modal-content').innerHTML=`<h3 class="font-bold mb-2">Invite</h3><form onsubmit="event.preventDefault();window.sI()"><input id="iE" class="input-field w-full mb-2" placeholder="Email" required><select id="iR" class="input-field w-full mb-2 bg-white"><option value="storekeeper">Storekeeper</option><option value="barman">Barman</option><option value="finance">Finance</option></select><button class="btn-black w-full py-2 rounded">Send Invite</button></form>`;document.getElementById('modal').classList.remove('hidden');}
window.sI=async()=>{const e=document.getElementById('iE').value; if(!e) return alert("Email required"); try{await inviteStaff(e, document.getElementById('iR').value, profile.organization_id); alert('Sent'); document.getElementById('modal').classList.add('hidden');}catch(err){alert(err.message);}}
