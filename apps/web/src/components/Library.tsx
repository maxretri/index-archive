import { useCallback, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ArchiveFile, LibraryFilter } from "@index/shared";
import { formatBytes, formatDuration } from "@index/shared";
import { api } from "../api";
import { useIntersection } from "../hooks";
import { PrivateImage } from "./PrivateMedia";

interface Props {
  filter: LibraryFilter;
  q?: string;
  collectionId?: string;
  from?: string;
  to?: string;
  onOpen(file: ArchiveFile, files: ArchiveFile[]): void;
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dateFormatter = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" });

export function Library({ filter, q, collectionId, from, to, onOpen }: Props) {
  const query = useInfiniteQuery({
    queryKey: ["files", filter, q, collectionId, from, to],
    queryFn: ({ pageParam }) => api.files({ filter, q, collectionId, from, to, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });
  const files = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const groups = useMemo(() => {
    const map = new Map<string, ArchiveFile[]>();
    for (const file of files) {
      const key = monthFormatter.format(new Date(file.createdAt));
      map.set(key, [...(map.get(key) ?? []), file]);
    }
    return [...map.entries()];
  }, [files]);
  const loadMore = useCallback(() => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }, [query]);
  const sentinel = useIntersection(loadMore, Boolean(query.hasNextPage));

  if (query.isLoading) return <LibrarySkeleton />;
  if (query.isError) return <div className="empty-state"><p>LIBRARY UNAVAILABLE</p><button onClick={() => void query.refetch()}>TRY AGAIN</button></div>;
  if (!files.length) return (
    <div className="empty-state">
      <p>{q ? "NOTHING FOUND" : collectionId ? "COLLECTION EMPTY" : "YOUR INDEX IS EMPTY"}</p>
      <span>{q ? "TRY A FILENAME, TYPE, TAG OR DATE." : "SEND OR FORWARD A FILE TO THE INDEX BOT."}</span>
    </div>
  );

  return (
    <div className="archive">
      {groups.map(([month, monthFiles]) => {
        const visual = monthFiles.filter((file) => file.type === "photo" || file.type === "video");
        const documents = monthFiles.filter((file) => file.type === "document" || file.type === "audio");
        return (
          <section className="date-group" key={month}>
            <h2>{month}</h2>
            {visual.length > 0 && <div className="media-grid">
              {visual.map((file) => (
                <button className="media-tile" key={file.id} onClick={() => onOpen(file, files)} style={{ aspectRatio: file.width && file.height ? `${file.width}/${file.height}` : "1/1" }}>
                  <PrivateImage fileId={file.id} alt={file.filename ?? (file.type === "photo" ? "Archived photo" : "Video thumbnail")} loading="lazy" />
                  {file.type === "video" && <span className="duration">{formatDuration(file.duration)}</span>}
                  {file.isFavorite && <span className="tile-favorite" aria-label="Favorite">●</span>}
                </button>
              ))}
            </div>}
            {documents.length > 0 && <div className="file-list">
              {documents.map((file) => <button className="file-row" key={file.id} onClick={() => onOpen(file, files)}>
                <span className="file-mark">{extension(file)}</span>
                <span className="file-name">{file.filename ?? "UNTITLED FILE"}<small>{formatBytes(file.fileSize)} · {dateFormatter.format(new Date(file.createdAt))}</small></span>
                <span className="file-arrow">↗</span>
              </button>)}
            </div>}
          </section>
        );
      })}
      <div className="load-sentinel" ref={sentinel} aria-hidden="true">{query.isFetchingNextPage ? "LOADING" : ""}</div>
    </div>
  );
}

function extension(file: ArchiveFile) {
  if (file.type === "audio") return "AUDIO";
  const value = file.filename?.split(".").at(-1)?.toUpperCase();
  return value && value.length <= 5 ? value : "FILE";
}

function LibrarySkeleton() {
  return <div className="archive skeleton-archive"><div className="skeleton-title" /><div className="media-grid">{[1, 2, 3, 4, 5, 6].map((item) => <div className="media-skeleton" key={item} style={{ aspectRatio: item % 3 === 0 ? "3/4" : "1/1" }} />)}</div></div>;
}
