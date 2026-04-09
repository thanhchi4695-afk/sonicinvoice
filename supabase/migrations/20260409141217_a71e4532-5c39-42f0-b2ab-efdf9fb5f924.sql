-- Create storage bucket for compressed product images
INSERT INTO storage.buckets (id, name, public)
VALUES ('compressed-images', 'compressed-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access
CREATE POLICY "Compressed images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'compressed-images');

-- Authenticated users can upload to their own folder
CREATE POLICY "Users can upload compressed images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'compressed-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Users can update their own compressed images
CREATE POLICY "Users can update own compressed images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'compressed-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Users can delete their own compressed images
CREATE POLICY "Users can delete own compressed images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'compressed-images' AND auth.uid()::text = (storage.foldername(name))[1]);