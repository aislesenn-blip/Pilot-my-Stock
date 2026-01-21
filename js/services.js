import { supabase } from './supabase.js';

// 1. INVENTORY & CATALOG SERVICES
export async function getInventory(orgId) {
    const { data, error } = await supabase
        .from('inventory')
        .select('*, products(name, selling_price, cost_price, unit), locations(name, type)')
        .eq('organization_id', orgId);
    if (error) throw error;
    return data;
}

// 2. TRANSFER SYSTEM (Updated to match Proposal: Request -> Approve -> Move)
export async function transferStock(productId, fromLocId, toLocId, quantity, userId, orgId) {
    // Badala ya kuhamisha moja kwa moja, tunatengeneza 'TRANSFER REQUEST'
    // Hii inatekeleza Pointi ya 3 (Approval Workflows)
    
    // 1. Hakikisha stock ipo kule inakotoka (Validation)
    const { data: sourceStock } = await supabase.from('inventory').select('quantity').eq('product_id', productId).eq('location_id', fromLocId).single();
    if (!sourceStock || sourceStock.quantity < quantity) throw new Error("Stock haitoshi kuanzisha request hii.");

    // 2. Rekodi Transaction kama 'PENDING' (Hii itaonekana kwenye Approvals Tab)
    const { error } = await supabase.from('transactions').insert({
        organization_id: orgId,
        user_id: userId,
        product_id: productId,
        from_location_id: fromLocId,
        to_location_id: toLocId,
        type: 'pending_transfer', // Sio 'transfer' tena, ni 'pending'
        quantity: quantity,
        total_value: 0
    });

    if (error) throw error;
    return "Request sent for approval.";
}

// 3. APPROVAL ENGINE (Hii ndiyo inayohamisha mzigo KWELI)
export async function getPendingApprovals(orgId) {
    // Inavuta requests zote ambazo hazijajibiwa
    const { data } = await supabase.from('transactions')
        .select('*, products(name), from_loc:from_location_id(name), to_loc:to_location_id(name)')
        .eq('organization_id', orgId)
        .eq('type', 'pending_transfer'); 
    return data || [];
}

export async function respondToApproval(transId, action, userId) {
    // 1. Pata taarifa za transaction hiyo
    const { data: trans } = await supabase.from('transactions').select('*').eq('id', transId).single();
    if (!trans) throw new Error("Transaction not found");

    if (action === 'approved') {
        // --- LOGIC YA KUHAMISHA MZIGO (Hii ilikosekana mwanzo) ---
        
        // A. Punguza 'From Location'
        const { data: sourceStock } = await supabase.from('inventory').select('*').eq('product_id', trans.product_id).eq('location_id', trans.from_location_id).single();
        if (!sourceStock || sourceStock.quantity < trans.quantity) throw new Error("Stock haitoshi kukamilisha approval.");
        
        await supabase.from('inventory').update({ quantity: Number(sourceStock.quantity) - Number(trans.quantity) }).eq('id', sourceStock.id);

        // B. Ongeza 'To Location'
        const { data: destStock } = await supabase.from('inventory').select('*').eq('product_id', trans.product_id).eq('location_id', trans.to_location_id).single();
        
        if (destStock) {
            await supabase.from('inventory').update({ quantity: Number(destStock.quantity) + Number(trans.quantity) }).eq('id', destStock.id);
        } else {
            await supabase.from('inventory').insert({
                organization_id: trans.organization_id,
                product_id: trans.product_id,
                location_id: trans.to_location_id,
                quantity: trans.quantity
            });
        }

        // C. Update Transaction Status
        await supabase.from('transactions').update({ type: 'transfer_completed', performed_by: userId }).eq('id', transId);
    
    } else if (action === 'rejected') {
        await supabase.from('transactions').update({ type: 'transfer_rejected', performed_by: userId }).eq('id', transId);
    }
}

// 4. POS / BAR SALES (Point 4 - Inakata Stock na Kuweka Rekodi)
export async function processBarSale(orgId, locationId, items, userId) {
    let totalSaleValue = 0;

    for (const item of items) {
        // A. Punguza Stock
        const { data: stock } = await supabase.from('inventory').select('*').eq('product_id', item.product_id).eq('location_id', locationId).single();
        if (!stock || stock.quantity < item.qty) throw new Error(`Stock haitoshi kwa ${item.name}`);
        
        await supabase.from('inventory').update({ quantity: Number(stock.quantity) - Number(item.qty) }).eq('id', stock.id);

        // B. Rekodi Transaction (Sale)
        const saleValue = item.price * item.qty;
        totalSaleValue += saleValue;

        await supabase.from('transactions').insert({
            organization_id: orgId,
            user_id: userId,
            product_id: item.product_id,
            from_location_id: locationId, 
            type: 'sale',
            quantity: item.qty,
            total_value: saleValue
        });
    }
    return totalSaleValue;
}

// 5. UTILS (Helpers)
export async function getLocations(orgId) {
    const { data } = await supabase.from('locations').select('*').eq('organization_id', orgId);
    return data;
}

export async function createLocation(orgId, name, type) {
    await supabase.from('locations').insert({ organization_id: orgId, name: name.toUpperCase(), type });
}

export async function getStaff(orgId) {
    const { data } = await supabase.from('profiles').select('*').eq('organization_id', orgId);
    return data;
}

export async function inviteStaff(email, role, orgId, locId) {
     await supabase.from('staff_invites').insert({ email, role, organization_id: orgId, assigned_location_id: locId, status: 'pending' });
}
