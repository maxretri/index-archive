export const FILE_TYPES = ["photo", "video", "document", "audio"] as const;
export type FileType = (typeof FILE_TYPES)[number];

export type LibraryFilter = "all" | "photos" | "videos" | "files" | "audio" | "favorites";

export interface ArchiveFile {
  id: string;
  type: FileType;
  mimeType: string | null;
  filename: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: string;
  isFavorite: boolean;
  tags: string[];
  collectionIds: string[];
}

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
  itemCount: number;
  coverFileId: string | null;
  isShared: boolean;
}

export interface SharedCollectionPage {
  collection: { name: string; itemCount: number };
  items: ArchiveFile[];
  nextCursor: string | null;
}

export interface ReceivedCollection {
  id: string;
  name: string;
  ownerName: string;
  acceptedAt: string;
  itemCount: number;
  coverFileId: string | null;
}

export interface PaginatedFiles {
  items: ArchiveFile[];
  nextCursor: string | null;
}

export interface AppUser {
  id: string;
  telegramUserId: string;
  firstName: string;
  username: string | null;
}

export interface AuthResponse { token: string; expiresIn: number; user: AppUser }

export interface SubscriptionStatus {
  plan: "free" | "plus";
  priceStars: 299;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export function formatBytes(value: number | null): string {
  if (value === null) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = units[0]!;
  for (let index = 1; size >= 1024 && index < units.length; index += 1) {
    size /= 1024;
    unit = units[index]!;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${unit}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
