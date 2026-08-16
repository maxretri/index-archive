import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ArchiveFile, ReceivedCollection } from "@index/shared";
import { formatBytes, formatDuration } from "@index/shared";
import { api } from "../api";
import { useIntersection } from "../hooks";
import { ReceivedImage } from "./PrivateMedia";
import { Viewer } from "./Viewer";

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dateFormatter = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" });

export function ReceivedCollections({ initialGrantId }: { initialGrantId?: string }) {
  const [selected, setSelected] = useState<string | undefined>(initialGrantId);
  if (selected) return <ReceivedCollectionView grantId={selected} onBack={() => {
    setSelected(undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete("shared");
    window.history.replaceState({}, "", url);
  }} />;
  return <ReceivedCollectionList onOpen={(collection) => setSelected(collection.id)} />;
}

function ReceivedCollectionList({ onOpen }: { onOpen(collection: ReceivedCollection): void }) {
  const query = useQuery({ queryKey: ["received-collections"], queryFn: api.receivedCollections });
  return <div className="received-collections">
    <header className="page-heading"><h1>SHARED</h1><span>COLLECTIONS SHARED WITH YOU</span></header>
    {query.isLoading ? <div className="collection-grid"><div className="collection-card media-skeleton" /></div>
      : query.isError ? <div className="empty-state"><p>SHARED LIBRARY UNAVAILABLE</p><button onClick={() => void query.refetch()}>TRY AGAIN</button></div>
        : !query.data?.length ? <div className="empty-state"><p>NOTHING SHARED WITH YOU YET</p><span>COLLECTIONS APPEAR HERE AFTER YOU ACCEPT AN INDEX INVITATION IN TELEGRAM.</span></div>
          : <><header className="section-intro"><span>SHARED WITH ME</span><p>Live, read-only collections accepted through INDEX Bot.</p></header><div className="collection-grid">
      {query.data.map((collection, index) => <article className="collection-card received-collection-card" key={collection.id}>
        <button className="collection-open" onClick={() => onOpen(collection)}>
          <div className="collection-cover">{collection.coverFileId
            ? <ReceivedImage grantId={collection.id} fileId={collection.coverFileId} loading="lazy" />
            : <span>{String(index + 1).padStart(2, "0")}</span>}</div>
          <strong>{collection.name}</strong>
          <small>{collection.itemCount} {collection.itemCount === 1 ? "ITEM" : "ITEMS"} · FROM {collection.ownerName}</small>
        </button>
        <div className="received-collection-status">READ ONLY</div>
      </article>)}
    </div></>}
  </div>;
}

function ReceivedCollectionView({ grantId, onBack }: { grantId: string; onBack(): void }) {
  const [viewer, setViewer] = useState<{ id: string; files: ArchiveFile[] }>();
  const query = useInfiniteQuery({
    queryKey: ["received-collection", grantId],
    queryFn: ({ pageParam }) => api.receivedCollection(grantId, pageParam),
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

  if (query.isLoading) return <div className="gate-line" aria-label="Opening shared collection" />;
  if (query.isError || !collection) return <div className="empty-state"><p>COLLECTION UNAVAILABLE</p><span>THE OWNER MAY HAVE STOPPED SHARING IT.</span><button onClick={onBack}>BACK TO SHARED</button></div>;

  return <div className="received-collection-view">
    <button className="shared-back" onClick={onBack}>← SHARED</button>
    <header className="page-heading"><h1>{collection.name}</h1><span>{collection.itemCount} {collection.itemCount === 1 ? "ITEM" : "ITEMS"} · READ ONLY</span></header>
    {!files.length ? <div className="empty-state"><p>COLLECTION EMPTY</p></div> : groups.map(([month, monthFiles]) => {
      const visual = monthFiles.filter((file) => file.type === "photo" || file.type === "video");
      const documents = monthFiles.filter((file) => file.type === "document" || file.type === "audio");
      return <section className="date-group" key={month}>
        <h2>{month}</h2>
        {visual.length > 0 && <div className="media-grid">{visual.map((file) => <button className="media-tile" key={file.id} onClick={() => setViewer({ id: file.id, files })} style={{ aspectRatio: file.width && file.height ? `${file.width}/${file.height}` : "1/1" }}>
          <ReceivedImage grantId={grantId} fileId={file.id} alt={file.filename ?? file.type} loading="lazy" />
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
    {viewer && <Viewer initialId={viewer.id} files={viewer.files} sharedGrantId={grantId} onClose={() => setViewer(undefined)} />}
  </div>;
}

function extension(file: ArchiveFile) {
  if (file.type === "audio") return "AUDIO";
  const value = file.filename?.split(".").at(-1)?.toUpperCase();
  return value && value.length <= 5 ? value : "FILE";
}
