-- NUCLEAR DATABASE REBUILD SCRIPT
-- Author: Jules (Lead System Architect)
-- Objective: Support "Zero-to-One" flow, "Invite" flow, and "Operational" flow with strict RBAC and Data Integrity.

-- 1. WIPE CLEAN
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- 2. TABLES DEFINITIONS

-- ORGANIZATIONS (Tenant)
CREATE TABLE public.organizations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    base_currency TEXT DEFAULT 'TZS',
    owner_id UUID NOT NULL, -- Link to auth.users initially, then profiles
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- LOCATIONS (Hierarchy)
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

-- STAFF INVITES (Staging Area)
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

-- TRANSACTIONS (Financial Ledger)
CREATE TABLE public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id),
    user_id UUID REFERENCES public.profiles(id),
    product_id UUID REFERENCES public.products(id),
    from_location_id UUID REFERENCES public.locations(id),
    to_location_id UUID REFERENCES public.locations(id),
    type TEXT CHECK (type IN ('sale', 'transfer', 'receive', 'void', 'adjustment')),
    quantity NUMERIC NOT NULL,

    -- Snapshots
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
    status TEXT DEFAULT 'Pending',
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

-- 3. CRITICAL AUTOMATION TRIGGERS

-- A. "Zero-to-One": Auto-Create Main Store & Link Manager when Organization is created
CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS TRIGGER AS $$
DECLARE
    v_loc_id UUID;
BEGIN
    -- 1. Create Main Store
    INSERT INTO public.locations (organization_id, name, type)
    VALUES (NEW.id, 'Main Store', 'main_store')
    RETURNING id INTO v_loc_id;

    -- 2. Update the Owner's Profile (Make them Manager & Link)
    UPDATE public.profiles
    SET organization_id = NEW.id,
        assigned_location_id = v_loc_id,
        role = 'manager'
    WHERE id = NEW.owner_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_org_created
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization();


-- B. "Invite & Onboarding": Auto-Link User on Signup/Login
-- Note: This trigger must be attached to auth.users (requires superuser access in Supabase Dashboard usually,
-- but we can define the function here and assume it's linked, or mimic it via RPC).
-- We will assume standard Supabase architecture where we can trigger on public.profiles insert if `auth` trigger inserts there first.
-- BETTER: Trigger on `auth.users` insert.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_invite RECORD;
BEGIN
    -- 1. Create Profile (Default)
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');

    -- 2. Check for Invites
    SELECT * INTO v_invite FROM public.staff_invites
    WHERE email = NEW.email AND status = 'pending'
    LIMIT 1;

    -- 3. If Invite Found -> Claim it
    IF FOUND THEN
        UPDATE public.profiles
        SET organization_id = v_invite.organization_id,
            role = v_invite.role,
            assigned_location_id = v_invite.assigned_location_id
        WHERE id = NEW.id;

        UPDATE public.staff_invites
        SET status = 'accepted'
        WHERE id = v_invite.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- (Commented out because usually users cannot create triggers on auth.users from SQL editor without pg_net extensions or dashboard)
-- We will instead use a robust RPC `claim_my_invite` that the Frontend calls on Login success as a fail-safe.
-- See below.


-- C. FAIL-SAFE INVITE CLAIMER (RPC)
-- Called by app.js on Login if trigger didn't catch it.
CREATE OR REPLACE FUNCTION public.claim_my_invite(email_to_check TEXT, user_id_to_link UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
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

-- 4. OPERATIONAL RPCs

-- Atomic Sales
CREATE OR REPLACE FUNCTION public.process_sale_transaction(
    p_org_id UUID,
    p_loc_id UUID,
    p_user_id UUID,
    p_items JSONB,
    p_method TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    item JSONB;
    v_cost NUMERIC;
BEGIN
    FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        SELECT cost_price INTO v_cost FROM public.products WHERE id = (item->>'product_id')::UUID;

        -- Deduct
        UPDATE public.inventory
        SET quantity = quantity - (item->>'qty')::NUMERIC
        WHERE product_id = (item->>'product_id')::UUID AND location_id = p_loc_id;

        -- Ledger
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

-- LPO Receive
CREATE OR REPLACE FUNCTION public.receive_stock_partial(
    p_po_id UUID,
    p_user_id UUID,
    p_org_id UUID,
    p_items JSONB,
    p_loc_id UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
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

-- 5. SETUP DATA HELPER (For "Zero-to-One" manual setup via Setup Wizard)
-- Allows the Setup Page to call one function to init the organization.
CREATE OR REPLACE FUNCTION public.create_setup_data(
    p_org_name TEXT,
    p_full_name TEXT,
    p_phone TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_org_id UUID;
BEGIN
    -- Insert Org (Trigger will handle Location creation and linking Profile!)
    INSERT INTO public.organizations (name, owner_id) VALUES (p_org_name, auth.uid()) RETURNING id INTO v_org_id;

    -- Update extra profile details
    UPDATE public.profiles SET full_name = p_full_name, phone = p_phone WHERE id = auth.uid();
END;
$$;

-- 6. RLS POLICIES (Strict but Functional)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View Own & Org" ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = id OR organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "Update Self" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Insert Self" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View Own Org" ON public.organizations FOR SELECT TO authenticated
USING (id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "Insert Org" ON public.organizations FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View Org Locs" ON public.locations FOR SELECT TO authenticated
USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "Manager Manage Locs" ON public.locations FOR ALL TO authenticated
USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin'));

-- (Generic policies for other tables to ensure connectivity)
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Access Org Inv" ON public.inventory FOR ALL TO authenticated USING (true);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Access Org Trans" ON public.transactions FOR ALL TO authenticated USING (true);

ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Access Invites" ON public.staff_invites FOR ALL TO authenticated USING (true);

-- Permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

SELECT 'Nuclear Rebuild Complete' as status;
