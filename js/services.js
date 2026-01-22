import { supabase } from './supabase.js';

// --- INVENTORY & STOCK ---
export async function getInventory(orgId) {
    const { data, error } = await supabase
        .from('inventory')
        .select(`
            id, quantity, location_id, product_id,
            products (id, name, cost_price, selling_price, category, unit),
            locations (id, name, type)
        `)
        .eq('organization_id', orgId);
    
    if (error) {
        console.error("Inventory Fetch Error:", error);
        return [];
    }
    return data;
}

export async function createLocation(orgId, name, type, parentId = null) {
    const { data, error } = await supabase.from('locations').insert({ organization_id: orgId, name: name.toUpperCase(), type, parent_location_id: parentId }).select().single();
    if (error) throw error;
    return data;
}

// --- POS & SALES ---
export async function processBarSale(orgId, locId, items, userId) {
    // Items: array of { product_id, qty, price }
    let total = 0;
    let profit = 0;

    for (const item of items) {
        // 1. Get Product Cost
        const { data: prod } = await supabase.from('products').select('cost_price').eq('id', item.product_id).single();
        const cost = prod?.cost_price || 0;
        const lineTotal = item.qty * item.price;
        const lineProfit = lineTotal - (item.qty * cost);

        total += lineTotal;
        profit += lineProfit;

        // 2. Reduce Stock (Using RPC for safety)
        const { error: stockError } = await supabase.rpc('deduct_stock', {
            p_product_id: item.product_id,
            p_location_id: locId,
            p_quantity: item.qty
        });
        if (stockError) throw new Error(`Insufficient stock for item ID: ${item.product_id}`);

        // 3. Record Transaction
        await supabase.from('transactions').insert({
            organization_id: orgId,
            user_id: userId,
            product_id: item.product_id,
            from_location_id: locId,
            type: 'sale',
            quantity: item.qty,
            total_value: lineTotal,
            profit: lineProfit
        });
    }
    return { success: true, total };
}

// --- TRANSFERS & APPROVALS ---
export async function transferStock(prodId, fromLoc, toLoc, qty, userId, orgId) {
    // 1. Check stock availability
    const { data: stock } = await supabase.from('inventory').select('quantity').eq('product_id', prodId).eq('location_id', fromLoc).single();
    if (!stock || stock.quantity < qty) throw new Error("Insufficient stock available for transfer");

    // 2. Create Pending Transfer Request
    const { error } = await supabase.from('stock_movements').insert({
        organization_id: orgId,
        product_id: prodId,
        from_location_id: fromLoc,
        to_location_id: toLoc,
        quantity: qty,
        requested_by: userId,
        status: 'pending'
    });
    
    if (error) throw error;
}

export async function getPendingApprovals(orgId) {
    const { data, error } = await supabase.from('stock_movements')
        .select(`*, products(name), from_loc:from_location_id(name), to_loc:to_location_id(name)`)
        .eq('organization_id', orgId)
        .eq('status', 'pending');
    if (error) {
        console.error("Approvals Error:", error);
        return [];
    }
    return data;
}

export async function respondToApproval(moveId, status, userId) {
    // status: 'approved' or 'rejected'
    if (status === 'approved') {
        const { data: move } = await supabase.from('stock_movements').select('*').eq('id', moveId).single();
        
        // Execute the move via RPC
        const { error } = await supabase.rpc('transfer_stock_safe', {
            p_product_id: move.product_id,
            p_from_loc: move.from_location_id,
            p_to_loc: move.to_location_id,
            p_qty: move.quantity
        });
        
        if (error) throw error;

        // Log Transaction
        await supabase.from('transactions').insert({
            organization_id: move.organization_id,
            user_id: userId,
            product_id: move.product_id,
            from_location_id: move.from_location_id,
            to_location_id: move.to_location_id,
            type: 'transfer_completed',
            quantity: move.quantity
        });
    }

    // Update Request Status
    await supabase.from('stock_movements').update({ status, approved_by: userId }).eq('id', moveId);
}
