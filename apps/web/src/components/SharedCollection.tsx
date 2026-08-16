import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ArchiveFile } from "@index/shared";
import { formatBytes, formatDuration } from "@index/shared";
import { api } from "../api";
import { useIntersection } from "../hooks";
import { SharedImage } from "./PrivateMedia";
import { Viewer } from "./Viewer";

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dateFormatter = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" });

export function SharedCollection({ token }: { token: string }) {
  const [viewer, setViewer] = useState<{ id: string; files: ArchiveFile[] }>();
  const query = useInfiniteQuery({
    queryKey: ["shared-collection", token],
    queryFn: ({ pageParam }) => api.sharedCollection(token, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });
  const files = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const collection = query.data?.pages[0]?.collection;
  const groups = useMemo(() => {
    const map = new Map<string, ArchiveFile[]>();
    for (const file of files) {
      const key = monthFormatter.format(new Date(file.createdAt));
      map.set(key, [...(map.get(key) ?? []), file]);
    }
    return [...map.entries()];
  }, [files]);
  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);
  const sentinel = useIntersection(loadMore, Boolean(query.hasNextPage));

  if (query.isLoading) return <SharedFrame><div className="gate-line" aria-label="Opening shared collection" /></SharedFrame>;
  if (query.isError || !collection) return <SharedFrame><div className="shared-unavailable"><p>COLLECTION UNAVAILABLE</p><span>THE LINK MAY HAVE EXPIRED OR SHARING WAS STOPPED.</span></div></SharedFrame>;

  return <div className="app-shell shared-app">
    <header className="masthead"><div className="brand">INDEX</div><span className="shared-label">SHARED / READ ONLY</span></header>
    <main className="shared-main">
      <header className="page-heading"><h1>{collection.name}</h1><span>{collection.itemCount} {collection.itemCount === 1 ? "ITEM" : "ITEMS"} · SHARED COLLECTION</span></header>
      {!files.length ? <div className="empty-state"><p>COLLECTION EMPTY</p></div> : groups.map(([month, monthFiles]) => {
        const visual = monthFiles.filter((file) => file.type === "photo" || file.type === "video");
        const documents = monthFiles.filter((file) => file.type === "document" || file.type === "audio");
        return <section className="date-group" key={month}>
          <h2>{month}</h2>
          {visual.length > 0 && <div className="media-grid">{visual.map((file) => <button className="media-tile" key={file.id} onClick={() => setViewer({ id: file.id, files })} style={{ aspectRatio: file.width && file.height ? `${file.width}/${file.height}` : "1/1" }}>
            <SharedImage fileId={file.id} shareToken={token} alt={file.filename ?? file.type} loading="lazy" />
            {file.type === "video" && <span className="duration">{formatDuration(file.duration)}</span>}
          </button>)}</div>}
          {documents.length > 0 && <div className="file-list">{documents.map((file) => <button className="file-row" key={file.id} onClick={() => setViewer({ id: file.id, files })}>
            <span className="file-mark">{extension(file)}</span>
            <span className="file-name">{file.filename ?? "UNTITLED FILE"}<small>{formatBytes(file.fileSize)} · {dateFormatter.format(new Date(file.createdAt))}</small></span>
            <span className="file-arrow">↗</span>
          </button>)}</div>}
        </section>;
      })}
      <div className="load-sentinel" ref={sentinel} aria-hidden="true">{query.isFetchingNextPage ? "LOADING" : ""}</div>
      <footer className="privacy-note">READ-ONLY COLLECTION SHARED THROUGH INDEX. NO OTHER FILES FROM THE OWNER'S ARCHIVE ARE ACCESSIBLE.</footer>
    </main>
    {viewer && <Viewer initialId={viewer.id} files={viewer.files} sharedToken={token} onClose={() => setViewer(undefined)} />}
  </div>;
}

function SharedFrame({ children }: { children: ReactNode }) {
  return <main className="gate"><div className="wordmark">INDEX</div>{children}</main>;
}

function extension(file: ArchiveFile) {
  if (file.type === "audio") return "AUDIO";
  const value = file.filename?.split(".").at(-1)?.toUpperCase();
  return value && value.length <= 5 ? value : "FILE";
}
