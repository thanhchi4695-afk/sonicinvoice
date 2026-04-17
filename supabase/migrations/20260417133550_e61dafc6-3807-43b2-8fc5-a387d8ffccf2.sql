-- 1. Create the private bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-originals', 'invoice-originals', false)
ON CONFLICT (id) DO NOTHING;

-- 2. RLS policies on storage.objects scoped to this bucket
-- Files must be stored under <user_id>/... so the first folder name owns the file.

CREATE POLICY "Users can read own invoice originals"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'invoice-originals'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can upload own invoice originals"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'invoice-originals'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update own invoice originals"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'invoice-originals'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete own invoice originals"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'invoice-originals'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 3. Track the original file on each invoice_patterns row
ALTER TABLE public.invoice_patterns
  ADD COLUMN IF NOT EXISTS original_file_path text,
  ADD COLUMN IF NOT EXISTS original_file_mime text,
  ADD COLUMN IF NOT EXISTS original_filename  text;