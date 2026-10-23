import { supabase } from "@/integrations/supabase/client";

export const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function validateImage(file: File) {
  if (!(PROFILE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Choose a JPG, PNG, WEBP, or GIF image.");
  }
  if (file.size > PROFILE_IMAGE_MAX_BYTES) throw new Error("Images must be 5 MB or smaller.");
}

export async function uploadImage(bucket: string, path: string, file: File) {
  validateImage(file);
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: "3600",
  });
  if (error) throw error;
  return path;
}

export async function signedImageUrl(bucket: string, path: string | null) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
