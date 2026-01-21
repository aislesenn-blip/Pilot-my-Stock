import { supabase } from './supabase.js';

// 1. INVENTORY SERVICES
export async function getInventory(orgId) {
    const { data, error } = await supabase
        .from('inventory')
        .select('*, products(name, selling_price, cost_price, unit), locations(name, type)')
        .eq('organization_id', orgId);
    if (error) throw error;
    return data;
}

// 2. TRANSFER SERVICE (Hii ndiyo inahamisha mzigo Main -> Camp au Camp -> Kitchen)
export async function transferStock(productId, fromLocId, toLocId, quantity, userId, orgId) {
    // A. Hakikisha stock ipo ya kutosha
    const { data: sourceStock } = await supabase.from('inventory').select('*').eq('product_id', productId).eq('location_id', fromLocId).single();
    if (!sourceStock || sourceStock.quantity < quantity) throw new Error("Stock haitoshi kwa ajili ya transfer.");

    // B. Punguza kule inakotoka
    const newSourceQty = Number(sourceStock.quantity) - Number(quantity);
    await supabase.from('inventory').update({ quantity: newSourceQty }).eq('id', sourceStock.id);

    // C. Ongeza kule inakoenda
    const { data: destStock } = await supabase.from('inventory').select('*').eq('product_id', productId).eq('location_id', toLocId).single();
    
    if (destStock) {
        await supabase.from('inventory').update({ quantity: Number(destStock.quantity) + Number(quantity) }).eq('id', destStock.id);
    } else {
        await supabase.from('inventory').insert({
            organization_id: orgId,
            product_id: productId,
            location_id: toLocId,
            quantity: quantity
        });
    }

    // D. Rekodi Transaction kwa ajili ya Reports (Point 5)
    await supabase.from('transactions').insert({
        organization_id: orgId,
        user_id: userId,
        product_id: productId,
        from_location_id: fromLocId,
        to_location_id: toLocId,
        type: 'transfer',
        quantity: quantity,
        total_value: 0
    });
}

// 3. POS / BAR SALES SERVICE (Hii inakata stock na kurekodi mauzo)
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
            from_location_id: locationId, // Imetoka Bar
            type: 'sale',
            quantity: item.qty,
            total_value: saleValue
        });
    }
    return totalSaleValue;
}

// 4. APPROVALS SERVICE (Hii inashughulikia Approval Levels - Point 3)
export async function getPendingApprovals(orgId) {
    // Inavuta transactions ambazo ni 'pending' (kama ungetumia logic ya request)
    // Kwa sasa tunatumia direct transfer, lakini hii ni kwa ajili ya future requests
    const { data } = await supabase.from('transactions')
        .select('*, products(name)')
        .eq('organization_id', orgId)
        .eq('type', 'request_pending'); 
    return data || [];
}

export async function respondToApproval(transId, status, userId) {
    await supabase.from('transactions').update({ type: status, performed_by: userId }).eq('id', transId);
}

// 5. SETUP & UTILS
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
