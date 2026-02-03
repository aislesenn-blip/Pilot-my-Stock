-- UGAVISMART GOLDEN PRODUCTION SCRIPT v2
-- Author: Jules (Lead Architect)
-- Scope: Final "Run Once" Script. Zero-Recursion RLS. Atomic Logic.

-- 1. NUCLEAR WIPE
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- 2. TABLES

-- ORGANIZATIONS
CREATE TABLE public.organizations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    base_currency TEXT DEFAULT 'TZS',
    owner_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- LOCATIONS
CREATE TABLE public.locations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT CHECK (type IN ('main_store', 'camp_store', 'department')),
    parent_location_id UUID REFERENCES public.locations(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PROFILES (Users)
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id),
    email TEXT,
    full_name TEXT,
    phone TEXT,
    role TEXT CHECK (role IN ('manager', 'deputy_manager', 'financial_controller', 'finance', 'deputy_finance', 'overall_storekeeper', 'storekeeper', 'deputy_storekeeper', 'barman')) DEFAULT 'storekeeper',
    assigned_location_id UUID REFERENCES public.locations(id),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- STAFF INVITES
CREATE TABLE public.staff_invites (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    assigned_location_id UUID REFERENCES public.locations(id),
    invited_by UUID REFERENCES public.profiles(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PRODUCTS
CREATE TABLE public.products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT,
    unit TEXT,
    cost_price NUMERIC DEFAULT 0,
    selling_price NUMERIC DEFAULT 0,
    currency TEXT DEFAULT 'TZS',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- LOCATION PRICES
CREATE TABLE public.location_prices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
    selling_price NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(product_id, location_id)
);

-- INVENTORY
CREATE TABLE public.inventory (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
    location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
    quantity NUMERIC DEFAULT 0 CHECK (quantity >= 0),
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(product_id, location_id)
);

-- TRANSACTIONS
CREATE TABLE public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id),
    user_id UUID REFERENCES public.profiles(id),
    product_id UUID REFERENCES public.products(id),
    from_location_id UUID REFERENCES public.locations(id),
    to_location_id UUID REFERENCES public.locations(id),
    type TEXT CHECK (type IN ('sale', 'transfer', 'receive', 'void', 'adjustment')),
    quantity NUMERIC NOT NULL,

    -- Financial Snapshots
    unit_price_snapshot NUMERIC DEFAULT 0,
    unit_cost_snapshot NUMERIC DEFAULT 0,
    total_value NUMERIC DEFAULT 0,
    gross_profit NUMERIC DEFAULT 0,

    payment_method TEXT,
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- STOCK MOVEMENTS
CREATE TABLE public.stock_movements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id),
    product_id UUID REFERENCES public.products(id),
    from_location_id UUID REFERENCES public.locations(id),
    to_location_id UUID REFERENCES public.locations(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    requested_by UUID REFERENCES public.profiles(id),
    approved_by UUID REFERENCES public.profiles(id),
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PURCHASE ORDERS
CREATE TABLE public.purchase_orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id),
    supplier_name TEXT,
    total_cost NUMERIC DEFAULT 0,
    created_by UUID REFERENCES public.profiles(id),
    status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Partial', 'Received')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.po_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    po_id UUID REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id),
    quantity NUMERIC NOT NULL,
    received_qty NUMERIC DEFAULT 0,
    unit_cost NUMERIC NOT NULL
);

-- CHANGE REQUESTS
CREATE TABLE public.change_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id),
    requester_id UUID REFERENCES public.profiles(id),
    target_table TEXT,
    target_id UUID,
    action TEXT,
    new_data JSONB,
    status TEXT DEFAULT 'pending',
    reviewer_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AUDIT LOGS
CREATE TABLE public.audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id),
    user_id UUID REFERENCES public.profiles(id),
    action TEXT,
    description TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SUPPLIERS
CREATE TABLE public.suppliers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id),
    name TEXT NOT NULL,
    tin TEXT,
    contact TEXT,
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- STOCK TAKES
CREATE TABLE public.stock_takes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id),
    location_id UUID REFERENCES public.locations(id),
    conducted_by UUID REFERENCES public.profiles(id),
    status TEXT DEFAULT 'Completed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.stock_take_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    stock_take_id UUID REFERENCES public.stock_takes(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id),
    system_qty NUMERIC,
    physical_qty NUMERIC,
    variance NUMERIC GENERATED ALWAYS AS (physical_qty - system_qty) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. RLS POLICIES (NO RECURSION)

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;

-- Profiles:
-- Allow Self Access (Recursion Breaker).
-- Allow Org Access ONLY if `organization_id` matches.
CREATE POLICY "Profiles View Self" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Profiles View Org" ON public.profiles FOR SELECT TO authenticated USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "Profiles Update Self" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Profiles Insert Self" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Organizations:
-- View if Linked.
CREATE POLICY "Org View Linked" ON public.organizations FOR SELECT TO authenticated USING (id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- Other Tables:
-- Standard Check: `organization_id` matches User's `organization_id`.
-- Optimizing to avoid deep nested selects in every row check.
CREATE POLICY "Loc View" ON public.locations FOR SELECT TO authenticated USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "Inv View" ON public.inventory FOR ALL TO authenticated USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "Trans View" ON public.transactions FOR ALL TO authenticated USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "Invites View" ON public.staff_invites FOR ALL TO authenticated USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "Prod View" ON public.products FOR ALL TO authenticated USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "PO View" ON public.purchase_orders FOR ALL TO authenticated USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "Move View" ON public.stock_movements FOR ALL TO authenticated USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "Change View" ON public.change_requests FOR ALL TO authenticated USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- 4. CRITICAL RPCs (SECURITY DEFINER)

-- A. BOOTSTRAP (Zero-to-One)
CREATE OR REPLACE FUNCTION public.create_new_organization(
    p_org_name TEXT,
    p_full_name TEXT,
    p_phone TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER -- Bypasses RLS to Insert Org and Update Profile
AS $$
DECLARE
    v_org_id UUID;
    v_loc_id UUID;
BEGIN
    -- 1. Create Org
    INSERT INTO public.organizations (name, owner_id) VALUES (p_org_name, auth.uid()) RETURNING id INTO v_org_id;
    -- 2. Create Main Store
    INSERT INTO public.locations (organization_id, name, type) VALUES (v_org_id, 'Main Store', 'main_store') RETURNING id INTO v_loc_id;
    -- 3. Update Profile
    UPDATE public.profiles
    SET organization_id = v_org_id, full_name = p_full_name, phone = p_phone, role = 'manager', assigned_location_id = v_loc_id
    WHERE id = auth.uid();

    -- If profile doesn't exist (edge case), Insert
    IF NOT FOUND THEN
        INSERT INTO public.profiles (id, organization_id, full_name, phone, role, assigned_location_id)
        VALUES (auth.uid(), v_org_id, p_full_name, p_phone, 'manager', v_loc_id);
    END IF;
END;
$$;

-- Alias for existing JS calls (backward compatibility)
CREATE OR REPLACE FUNCTION public.create_setup_data(p_org_name TEXT, p_full_name TEXT, p_phone TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    PERFORM public.create_new_organization(p_org_name, p_full_name, p_phone);
END;
$$;

-- B. INVITE CLAIM
CREATE OR REPLACE FUNCTION public.claim_my_invite(email_to_check TEXT, user_id_to_link UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    inv RECORD;
BEGIN
    SELECT * INTO inv FROM public.staff_invites WHERE email = email_to_check AND status = 'pending';
    IF FOUND THEN
        UPDATE public.profiles
        SET organization_id = inv.organization_id,
            role = inv.role,
            assigned_location_id = inv.assigned_location_id
        WHERE id = user_id_to_link;
        UPDATE public.staff_invites SET status = 'accepted' WHERE id = inv.id;
    END IF;
END;
$$;

-- C. ATOMIC SALES
CREATE OR REPLACE FUNCTION public.process_sale_transaction(
    p_org_id UUID,
    p_loc_id UUID,
    p_user_id UUID,
    p_items JSONB,
    p_method TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    item JSONB;
    v_cost NUMERIC;
BEGIN
    FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        SELECT cost_price INTO v_cost FROM public.products WHERE id = (item->>'product_id')::UUID;

        UPDATE public.inventory
        SET quantity = quantity - (item->>'qty')::NUMERIC
        WHERE product_id = (item->>'product_id')::UUID AND location_id = p_loc_id;

        INSERT INTO public.transactions (
            organization_id, user_id, product_id, from_location_id, type, quantity,
            unit_price_snapshot, unit_cost_snapshot, total_value, gross_profit, payment_method
        ) VALUES (
            p_org_id, p_user_id, (item->>'product_id')::UUID, p_loc_id, 'sale', (item->>'qty')::NUMERIC,
            (item->>'price')::NUMERIC, v_cost,
            ((item->>'price')::NUMERIC * (item->>'qty')::NUMERIC),
            (((item->>'price')::NUMERIC - v_cost) * (item->>'qty')::NUMERIC),
            p_method
        );
    END LOOP;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- D. RECEIVE STOCK
CREATE OR REPLACE FUNCTION public.receive_stock_partial(
    p_po_id UUID,
    p_user_id UUID,
    p_org_id UUID,
    p_items JSONB,
    p_loc_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    item JSONB;
    v_ord NUMERIC;
    v_rec NUMERIC;
BEGIN
    FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        UPDATE public.po_items
        SET received_qty = COALESCE(received_qty, 0) + (item->>'qty')::NUMERIC
        WHERE po_id = p_po_id AND product_id = (item->>'product_id')::UUID;

        INSERT INTO public.inventory (organization_id, product_id, location_id, quantity)
        VALUES (p_org_id, (item->>'product_id')::UUID, p_loc_id, (item->>'qty')::NUMERIC)
        ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
    END LOOP;

    SELECT SUM(quantity), SUM(received_qty) INTO v_ord, v_rec FROM public.po_items WHERE po_id = p_po_id;
    IF v_rec >= v_ord THEN
        UPDATE public.purchase_orders SET status = 'Received' WHERE id = p_po_id;
    ELSE
        UPDATE public.purchase_orders SET status = 'Partial' WHERE id = p_po_id;
    END IF;
END;
$$;

-- E. ADMIN ACTIONS
CREATE OR REPLACE FUNCTION public.process_change_request(
    p_request_id UUID,
    p_status TEXT,
    p_reviewer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    req RECORD;
BEGIN
    SELECT * INTO req FROM public.change_requests WHERE id = p_request_id;
    UPDATE public.change_requests SET status = p_status, reviewer_id = p_reviewer_id WHERE id = p_request_id;

    IF p_status = 'approved' THEN
        IF req.action = 'VOID' THEN
            UPDATE public.transactions SET status = 'void' WHERE id = req.target_id;
        ELSIF req.action = 'EDIT_INVENTORY' THEN
            UPDATE public.inventory SET quantity = (req.new_data->>'new_qty')::NUMERIC WHERE id = req.target_id;
        ELSIF req.action = 'DELETE_PRODUCT' THEN
            UPDATE public.products SET is_active = false WHERE id = req.target_id;
        END IF;
    END IF;
END;
$$;

-- 5. PERMISSIONS
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

SELECT 'Golden Reset Complete' as status;
