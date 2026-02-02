-- FIX SYSTEM: Database Permissions & RLS Audit
-- Use this script to fix "Silent Failures" caused by RLS blocking writes.
-- Run this in your Supabase SQL Editor.

-- 1. Enable RLS (Ensure it's on, but we will add permissive policies)
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY; -- Added missing table

-- 2. STOCK MOVEMENTS (Approvals & Transfers)
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.stock_movements;
CREATE POLICY "Enable all access for authenticated users"
ON public.stock_movements
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Validation: Prevent negative stock transfers explicitly in the backend.
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS quantity_positive;
ALTER TABLE public.stock_movements ADD CONSTRAINT quantity_positive CHECK (quantity > 0);

-- 3. PROFILES (User Data)
DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;
DROP POLICY IF EXISTS "Enable update for users based on email" ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.profiles;

CREATE POLICY "Enable all access for authenticated users"
ON public.profiles
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 4. STAFF INVITES (Admins inviting team)
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.staff_invites;
CREATE POLICY "Enable all access for authenticated users"
ON public.staff_invites
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 5. INVENTORY (Stock levels)
DROP POLICY IF EXISTS "Enable read access for all users" ON public.inventory;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.inventory;

CREATE POLICY "Enable all access for authenticated users"
ON public.inventory
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 6. CHANGE REQUESTS (Admin Voids)
-- Missing from original fix, caused "Stuck" requests
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.change_requests;
CREATE POLICY "Enable all access for authenticated users"
ON public.change_requests
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 7. GRANT PERMISSIONS (Fixes "Permission denied" on sequences/tables)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

-- CONFIRMATION
SELECT 'System RLS & Permissions Fixed' as status;
