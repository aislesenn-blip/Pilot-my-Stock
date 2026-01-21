import { supabase } from './supabase.js';

// 1. INVENTORY & CATALOG
export async function getInventory(orgId) {
    const { data, error } = await supabase
        .from('inventory')
        .select('*, products(name, selling_price, cost_price, unit), locations(name, type)')
        .eq('organization_id', orgId);
    if (error) throw error;
    return data;
}

// 2. TRANSFER REQUEST (Point 3 - Approval Workflow)
export async function transferStock(productId, fromLocId, toLocId, quantity, userId, orgId) {
    // A. Validate Stock
    const { data: source } = await supabase.from('inventory').select('quantity').eq('product_id', productId).eq('location_id', fromLocId).single();
    if (!source || Number(source.quantity) < Number(quantity)) throw new Error("Stock haitoshi.");

    // B. Create Pending Request (Sio Transfer kamili bado)
    const { error } = await supabase.from('transactions').insert({
        organization_id: orgId,
        user_id: userId,
        product_id: productId,
        from_location_id: fromLocId,
        to_location_id: toLocId,
        type: 'pending_transfer', // Status: Pending
        quantity: quantity,
        total_value: 0,
        profit: 0
    });
    if (error) throw error;
    return "Request Sent to Management";
}

// 3. APPROVAL PROCESS (Point 3 - Manager/Finance Action)
export async function getPendingApprovals(orgId) {
    const { data } = await supabase.from('transactions')
        .select('*, products(name), from_loc:from_location_id(name), to_loc:to_location_id(name)')
        .eq('organization_id', orgId)
        .eq('type', 'pending_transfer');
    return data || [];
}

export async function respondToApproval(transId, action, userId) {
    const { data: trans } = await supabase.from('transactions').select('*').eq('id', transId).single();
    if (!trans) throw new Error("Transaction Missing");

    if (action === 'approved') {
        // A. Kata Mzigo Stoo A
        const { data: source } = await supabase.from('inventory').select('*').eq('product_id', trans.product_id).eq('location_id', trans.from_location_id).single();
        if(Number(source.quantity) < Number(trans.quantity)) throw new Error("Stock Low");
        await supabase.from('inventory').update({ quantity: Number(source.quantity) - Number(trans.quantity) }).eq('id', source.id);

        // B. Ongeza Mzigo Stoo B (Camp/Kitchen)
        const { data: dest } = await supabase.from('inventory').select('*').eq('product_id', trans.product_id).eq('location_id', trans.to_location_id).single();
        if (dest) {
            await supabase.from('inventory').update({ quantity: Number(dest.quantity) + Number(trans.quantity) }).eq('id', dest.id);
        } else {
            await supabase.from('inventory').insert({ organization_id: trans.organization_id, product_id: trans.product_id, location_id: trans.to_location_id, quantity: trans.quantity });
        }
        
        // C. Update Transaction to 'Completed' (Audit Trail)
        await supabase.from('transactions').update({ type: 'transfer_completed', performed_by: userId }).eq('id', transId);
    } else {
        // D. Reject
        await supabase.from('transactions').update({ type: 'transfer_rejected', performed_by: userId }).eq('id', transId);
    }
}

// 4. BAR POS & PROFIT CALCULATION (Point 4)
export async function processBarSale(orgId, locId, items, userId) {
    for (const item of items) {
        // Pata Cost Price ili kupiga hesabu ya Faida
        const { data: product } = await supabase.from('products').select('cost_price').eq('id', item.product_id).single();
        
        // Kata Stock
        const { data: stock } = await supabase.from('inventory').select('*').eq('product_id', item.product_id).eq('location_id', locId).single();
        if (!stock || Number(stock.quantity) < Number(item.qty)) throw new Error(`Out of stock: ${item.name}`);
        
        await supabase.from('inventory').update({ quantity: Number(stock.quantity) - Number(item.qty) }).eq('id', stock.id);
        
        // Hesabu
        const salesValue = item.price * item.qty;
        const costValue = product.cost_price * item.qty;
        const profit = salesValue - costValue; // Hii ndio Point 4: Gross Profit
        
        // Rekodi
        await supabase.from('transactions').insert({
            organization_id: orgId,
            user_id: userId,
            product_id: item.product_id,
            from_location_id: locId,
            type: 'sale',
            quantity: item.qty,
            total_value: salesValue,
            profit: profit // Tunahifadhi faida
        });
    }
}

// 5. SETUP UTILS
export async function createLocation(orgId, name, type) {
    await supabase.from('locations').insert({ organization_id: orgId, name: name.toUpperCase(), type });
}
