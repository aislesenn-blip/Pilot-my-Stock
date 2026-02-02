import { supabase } from './supabase.js';

// Helper for error handling
const handleError = (error, context) => {
    console.error(`[${context}] Full Error:`, error);
    if (typeof window !== 'undefined' && window.showNotification) {
        window.showNotification(error.message || JSON.stringify(error), "error");
    }
};

// --- INVENTORY & STOCK ---
export async function getInventory(orgId, locId = null) {
    try {
        let query = supabase
            .from('inventory')
            .select(`
                id, quantity, location_id, product_id,
                products (id, name, cost_price, selling_price, category, unit),
                locations (id, name, type)
            `)
            .eq('organization_id', orgId);

        if (locId) {
            query = query.eq('location_id', locId);
        }

        const { data, error } = await query;

        if (error) throw error;
        return data;
    } catch (error) {
        handleError(error, "Inventory Fetch");
        return [];
    }
}

export async function createLocation(orgId, name, type, parentId = null) {
    try {
        const { data, error } = await supabase
            .from('locations')
            .insert({
                organization_id: orgId,
                name: name.toUpperCase(),
                type,
                parent_location_id: parentId
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        handleError(error, "Create Location");
        throw error;
    }
}

// --- POS & SALES (WITH COST SNAPSHOT) ---
export async function processBarSale(orgId, locId, items, userId, paymentMethod) {
    try {
        let total = 0;
        let profit = 0;

        for (const item of items) {
            // 1. Get Product Cost (SNAPSHOT)
            const { data: prod, error: prodError } = await supabase.from('products').select('cost_price').eq('id', item.product_id).single();
            if (prodError) throw prodError;

            const costSnapshot = prod?.cost_price || 0;
            const lineTotal = item.qty * item.price;
            const lineCost = item.qty * costSnapshot;
            const lineProfit = lineTotal - lineCost;

            total += lineTotal;
            profit += lineProfit;

            // 2. Reduce Stock (RPC)
            const { error: stockError } = await supabase.rpc('deduct_stock', {
                p_product_id: item.product_id,
                p_location_id: locId,
                p_quantity: item.qty
            });
            if (stockError) throw new Error(`Insufficient stock for item ID: ${item.product_id} - ${stockError.message}`);

            // 3. Record Transaction (WITH SNAPSHOT)
            const { error: transError } = await supabase.from('transactions').insert({
                organization_id: orgId,
                user_id: userId,
                product_id: item.product_id,
                from_location_id: locId,
                type: 'sale',
                quantity: item.qty,
                unit_price_snapshot: item.price,
                unit_cost_snapshot: costSnapshot, // THE FIX
                total_value: lineTotal,
                gross_profit: lineProfit, // THE FIX
                payment_method: paymentMethod,
                status: 'completed'
            });
            if (transError) throw transError;
        }
        return { success: true, total };
    } catch (error) {
        handleError(error, "Process Sale");
        throw error;
    }
}

// --- TRANSFERS & APPROVALS ---
export async function transferStock(prodId, fromLoc, toLoc, qty, userId, orgId) {
    try {
        if (qty <= 0) throw new Error("Quantity must be positive");

        // 1. Check stock
        const { data: stock, error: stockCheckError } = await supabase.from('inventory').select('quantity').eq('product_id', prodId).eq('location_id', fromLoc).single();

        if (stockCheckError) throw stockCheckError;
        if (!stock || stock.quantity < qty) throw new Error("Insufficient stock available for transfer");

        // 2. Create Pending Request
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
    } catch (error) {
        handleError(error, "Transfer Stock");
        throw error;
    }
}

export async function getPendingApprovals(orgId) {
    try {
        // Using generic join if specific constraint names are unknown/reset
        // If constraints are strict, we might need !fk_ syntax, but standard is safer for 'reset' state unless we know schema details.
        // Assuming standard FKs from the reset schema.
        const { data, error } = await supabase.from('stock_movements')
            .select(`
                *,
                products (name),
                from_loc:from_location_id (name),
                to_loc:to_location_id (name)
            `)
            .eq('organization_id', orgId)
            .eq('status', 'pending');

        if (error) throw error;
        return data;
    } catch (error) {
        handleError(error, "Get Approvals");
        return [];
    }
}

export async function respondToApproval(moveId, status, userId) {
    try {
        const { error } = await supabase
            .from('stock_movements')
            .update({
                status: status,
                approved_by: userId
            })
            .eq('id', moveId);

        if (error) throw error;
        return { success: true };
    } catch (error) {
        handleError(error, "Respond Approval");
        throw error;
    }
}
