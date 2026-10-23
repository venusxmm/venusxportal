import { useQuery } from "@tanstack/react-query";
import { signedImageUrl } from "@/lib/media";

export function CreatorAvatar({
  path,
  name,
  size = "md",
}: {
  path: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const photo = useQuery({
    enabled: !!path,
    queryKey: ["creator-photo", path],
    queryFn: () => signedImageUrl("creator-photos", path),
  });
  const sizeClass =
    size === "lg" ? "h-24 w-24 text-2xl" : size === "sm" ? "h-9 w-9 text-sm" : "h-12 w-12 text-lg";
  if (photo.data)
    return (
      <img
        src={photo.data}
        alt={`${name} internal photo`}
        className={`${sizeClass} rounded-full object-cover`}
      />
    );
  return (
    <div
      aria-label={`${name} avatar`}
      className={`${sizeClass} flex items-center justify-center rounded-full bg-gold-soft font-semibold text-gold`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
