import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ArchiveFile, LibraryFilter } from "@index/shared";
import { formatBytes, formatDuration } from "@index/shared";
import { api, getCachedFiles } from "../api";
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
  const queryClient = useQueryClient();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCollections, setShowCollections] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [targetCollections, setTargetCollections] = useState<Set<string>>(new Set());
  const [newCollectionName, setNewCollectionName] = useState("");
  const queryParams = useMemo(() => ({ filter, q, collectionId, from, to }), [filter, q, collectionId, from, to]);
  const cached = useMemo(() => getCachedFiles(queryParams), [queryParams]);
  const query = useInfiniteQuery({
    queryKey: ["files", filter, q, collectionId, from, to],
    queryFn: ({ pageParam }) => api.files({ filter, q, collectionId, from, to, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    initialData: cached ? { pages: [cached.data], pageParams: [undefined] } : undefined,
    initialDataUpdatedAt: cached?.savedAt
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
  const collections = useQuery({ queryKey: ["collections"], queryFn: api.collections, enabled: showCollections });
  const createCollection = useMutation({
    mutationFn: () => api.createCollection(newCollectionName),
    onSuccess: async (collection) => {
      setNewCollectionName("");
      setTargetCollections((current) => new Set(current).add(collection.id));
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    }
  });
  const addToCollections = useMutation({
    mutationFn: () => api.addFilesToCollections([...selected], [...targetCollections]),
    onSuccess: async () => {
      setSelecting(false);
      setSelected(new Set());
      setTargetCollections(new Set());
      setNewCollectionName("");
      setShowCollections(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files"] }),
        queryClient.invalidateQueries({ queryKey: ["collections"] })
      ]);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    }
  });
  const deleteFiles = useMutation({
    mutationFn: () => api.deleteFiles([...selected]),
    onSuccess: async ({ telegramCleanup }) => {
      setShowDelete(false);
      setSelecting(false);
      setSelected(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files"] }),
        queryClient.invalidateQueries({ queryKey: ["collections"] })
      ]);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
      if (!telegramCleanup) window.Telegram?.WebApp.showAlert?.("Removed from INDEX. Telegram could not remove one or more older chat messages.");
    }
  });

  useEffect(() => {
    setSelecting(false);
    setSelected(new Set());
    setShowCollections(false);
    setShowDelete(false);
    setTargetCollections(new Set());
    setNewCollectionName("");
  }, [filter, q, collectionId, from, to]);

  const toggleFile = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
  };

  const handleFile = (file: ArchiveFile) => selecting ? toggleFile(file.id) : onOpen(file, files);

  if (query.isLoading) return <LibrarySkeleton />;
  if (query.isError) return <div className="empty-state"><p>LIBRARY UNAVAILABLE</p><button onClick={() => void query.refetch()}>TRY AGAIN</button></div>;
  if (!files.length) return (
    <div className="empty-state">
      <p>{q ? "NOTHING FOUND" : collectionId ? `NO ${filterLabel(filter)} IN THIS COLLECTION` : emptyLabel(filter)}</p>
      <span>{q ? "TRY A FILENAME, TYPE, TAG OR DATE." : "SEND OR FORWARD A FILE TO THE INDEX BOT."}</span>
    </div>
  );

  return (
    <div className="archive">
      <div className={`selection-toolbar${selecting ? " active" : ""}`}>
        <button onClick={() => {
          setSelecting((value) => !value);
          setSelected(new Set());
          setShowCollections(false);
          setShowDelete(false);
        }}>{selecting ? "CANCEL" : "SELECT"}</button>
        {selecting && <><span>{selected.size} SELECTED</span><div className="selection-actions"><button disabled={!selected.size} onClick={() => setShowCollections(true)}>ADD TO COLLECTION</button><button className="selection-delete" disabled={!selected.size} onClick={() => setShowDelete(true)}>DELETE</button></div></>}
      </div>
      {groups.map(([month, monthFiles]) => {
        const visual = monthFiles.filter((file) => file.type === "photo" || file.type === "video");
        const documents = monthFiles.filter((file) => file.type === "document" || file.type === "audio");
        return (
          <section className="date-group" key={month}>
            <h2>{month}</h2>
            {visual.length > 0 && <div className="media-grid">
              {visual.map((file) => (
                <button className={`media-tile${selected.has(file.id) ? " selected" : ""}`} aria-pressed={selecting ? selected.has(file.id) : undefined} key={file.id} onClick={() => handleFile(file)} style={{ aspectRatio: file.width && file.height ? `${file.width}/${file.height}` : "1/1" }}>
                  <PrivateImage fileId={file.id} alt={file.filename ?? (file.type === "photo" ? "Archived photo" : "Video thumbnail")} loading="lazy" />
                  {selecting && <span className="selection-mark">{selected.has(file.id) ? "✓" : ""}</span>}
                  {file.type === "video" && <span className="duration">{formatDuration(file.duration)}</span>}
                  {file.isFavorite && <span className="tile-favorite" aria-label="Favorite">●</span>}
                </button>
              ))}
            </div>}
            {documents.length > 0 && <div className="file-list">
              {documents.map((file) => <button className={`file-row${selected.has(file.id) ? " selected" : ""}`} aria-pressed={selecting ? selected.has(file.id) : undefined} key={file.id} onClick={() => handleFile(file)}>
                <span className="file-mark">{extension(file)}</span>
                <span className="file-name">{file.filename ?? "UNTITLED FILE"}<small>{formatBytes(file.fileSize)} · {dateFormatter.format(new Date(file.createdAt))}</small></span>
                <span className={selecting ? "file-selection-mark" : "file-arrow"}>{selecting ? (selected.has(file.id) ? "●" : "○") : "↗"}</span>
              </button>)}
            </div>}
          </section>
        );
      })}
      <div className="load-sentinel" ref={sentinel} aria-hidden="true">{query.isFetchingNextPage ? "LOADING" : ""}</div>
      {showCollections && <div className="bulk-sheet-backdrop" role="presentation" onClick={() => setShowCollections(false)}>
        <section className="bulk-sheet" role="dialog" aria-modal="true" aria-label="Add selected files to collections" onClick={(event) => event.stopPropagation()}>
          <header><span>ADD {selected.size} {selected.size === 1 ? "ITEM" : "ITEMS"} TO</span><button onClick={() => setShowCollections(false)}>CLOSE</button></header>
          <form className="bulk-create" onSubmit={(event) => {
            event.preventDefault();
            if (newCollectionName.trim()) createCollection.mutate();
          }}>
            <input value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} placeholder="NEW COLLECTION" maxLength={80} aria-label="New collection name" />
            <button disabled={!newCollectionName.trim() || createCollection.isPending}>{createCollection.isPending ? "CREATING" : "CREATE + SELECT"}</button>
          </form>
          {createCollection.error && <p className="bulk-error">{createCollection.error.message}</p>}
          <div className="bulk-collection-list">
            {collections.data?.map((collection) => {
              const active = targetCollections.has(collection.id);
              return <button className={active ? "active" : ""} key={collection.id} onClick={() => setTargetCollections((current) => {
                const next = new Set(current);
                if (next.has(collection.id)) next.delete(collection.id); else next.add(collection.id);
                return next;
              })}><span>{collection.name}</span><small>{active ? "●" : "○"}</small></button>;
            })}
            {!collections.isLoading && !collections.data?.length && <p>NO COLLECTIONS YET. CREATE ONE ABOVE.</p>}
          </div>
          {addToCollections.error && <p className="bulk-error">{addToCollections.error.message}</p>}
          <button className="bulk-confirm" disabled={!targetCollections.size || addToCollections.isPending} onClick={() => addToCollections.mutate()}>
            {addToCollections.isPending ? "ADDING" : `ADD TO ${targetCollections.size || "—"} ${targetCollections.size === 1 ? "COLLECTION" : "COLLECTIONS"}`}
          </button>
        </section>
      </div>}
      {showDelete && <div className="bulk-sheet-backdrop" role="presentation" onClick={() => setShowDelete(false)}>
        <section className="bulk-sheet bulk-delete-sheet" role="alertdialog" aria-modal="true" aria-label="Delete selected files" onClick={(event) => event.stopPropagation()}>
          <header><span>DELETE {selected.size} {selected.size === 1 ? "ITEM" : "ITEMS"}?</span><button onClick={() => setShowDelete(false)}>CLOSE</button></header>
          <p className="bulk-delete-copy">THESE FILES WILL BE REMOVED FROM INDEX, COLLECTIONS AND SHARED LINKS. TELEGRAM CHAT MESSAGES ARE ALSO REMOVED WHEN TELEGRAM ALLOWS IT; OLDER MESSAGES MAY REMAIN IN THE CHAT.</p>
          {deleteFiles.error && <p className="bulk-error">{deleteFiles.error.message}</p>}
          <button className="bulk-confirm destructive" disabled={deleteFiles.isPending} onClick={() => deleteFiles.mutate()}>
            {deleteFiles.isPending ? "DELETING" : "DELETE PERMANENTLY"}
          </button>
        </section>
      </div>}
    </div>
  );
}

function extension(file: ArchiveFile) {
  if (file.type === "audio") return "AUDIO";
  const value = file.filename?.split(".").at(-1)?.toUpperCase();
  return value && value.length <= 5 ? value : "FILE";
}

function filterLabel(filter: LibraryFilter) {
  return filter === "all" ? "ITEMS" : filter.toUpperCase();
}

function emptyLabel(filter: LibraryFilter) {
  if (filter === "all") return "YOUR INDEX IS EMPTY";
  if (filter === "favorites") return "NO FAVORITES YET";
  return `NO ${filter.toUpperCase()} YET`;
}

function LibrarySkeleton() {
  return <div className="archive skeleton-archive"><div className="skeleton-title" /><div className="media-grid">{[1, 2, 3, 4, 5, 6].map((item) => <div className="media-skeleton" key={item} style={{ aspectRatio: item % 3 === 0 ? "3/4" : "1/1" }} />)}</div></div>;
}
