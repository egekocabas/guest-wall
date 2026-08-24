export type Visibility = "public" | "private";

export interface Photo {
  id: string;
  created_at: string;
  visibility: Visibility;
  print_status: string;
  image_url: string;
}

export interface PhotoPage {
  items: Photo[];
  next_offset: number | null;
}

export interface Preview {
  preview_id: string;
  preview_url: string;
  expires_at: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: { message?: string; code?: string; retryable?: boolean } | string;
    } | null;
    const detail = payload?.detail;
    throw new ApiError(
      typeof detail === "object" && detail?.message
        ? detail.message
        : "Something went wrong. Please try again.",
      typeof detail === "object" && detail?.code ? detail.code : "request_failed",
      typeof detail === "object" && Boolean(detail?.retryable),
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  listPhotos(publicOnly: boolean, offset = 0, limit = 12): Promise<PhotoPage> {
    const base = publicOnly ? "/api/public/photos" : "/api/photos";
    return request(`${base}?offset=${offset}&limit=${limit}`);
  },
  listAdminPhotos(offset = 0): Promise<PhotoPage> {
    return request(`/api/admin/photos?offset=${offset}&limit=50`);
  },
  async createPreview(file: File, date?: string, time?: string): Promise<Preview> {
    const data = new FormData();
    data.append("image", file);
    if (date) data.append("date", date);
    if (time) data.append("time", time);
    return request("/api/previews", { method: "POST", body: data });
  },
  confirmPreview(previewId: string, visibility: Visibility, printPhoto = true): Promise<Photo> {
    return request(`/api/previews/${previewId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility, print: printPhoto }),
    });
  },
  deletePreview(previewId: string): Promise<void> {
    return request(`/api/previews/${previewId}`, { method: "DELETE" });
  },
  setVisibility(photoId: string, visibility: Visibility): Promise<Photo> {
    return request(`/api/admin/photos/${photoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility }),
    });
  },
  deletePhoto(photoId: string): Promise<void> {
    return request(`/api/admin/photos/${photoId}`, { method: "DELETE" });
  },
  reprint(photoId: string): Promise<void> {
    return request(`/api/admin/photos/${photoId}/reprint`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
  },
  printerStatus(): Promise<{ online: boolean }> {
    return request("/api/printer/status");
  },
};
