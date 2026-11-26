import { apiFetch } from "../api";
export type UploadedImage = { id: string; url: string; mimeType: "image/webp"; size: number; width: number; height: number };

const allowedTypes = new Map([
  ["image/jpeg", [".jpg", ".jpeg"]],
  ["image/png", [".png"]],
  ["image/webp", [".webp"]],
]);

export async function uploadImage(file: File, purpose: "quest" | "completion" | "message"): Promise<UploadedImage> {
  const extensions = allowedTypes.get(file.type);
  const name = file.name.toLowerCase();
  if (!extensions || !extensions.some(extension => name.endsWith(extension)) || /\.[^.]+\.(?:jpg|jpeg|png|webp)$/i.test(name)) {
    throw new Error("Choose a JPEG, PNG, or WebP image with a matching file extension.");
  }
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error("Choose an image under 5 MB.");
  const data = new FormData();
  data.append("image", file, file.name);
  const response = await apiFetch(`/api/images?purpose=${purpose}`, { method: "POST", body: data });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.data?.id || !result?.data?.url) throw new Error(result?.msg ?? "Could not upload that image.");
  return result.data as UploadedImage;
}
