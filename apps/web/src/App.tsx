import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ArchiveFile, Collection, LibraryFilter } from "@index/shared";
import { api } from "./api";
import { AuthGate } from "./components/AuthGate";
import { Collections } from "./components/Collections";
import { Library } from "./components/Library";
import { Viewer } from "./components/Viewer";
import { CollectionShareControls } from "./components/CollectionShareControls";
import { SharedCollection } from "./components/SharedCollection";
import { Membership } from "./components/Membership";
import { SponsorSlot } from "./components/SponsorSlot";
import { ReceivedCollections } from "./components/ReceivedCollections";

type Screen = "library" | "search" | "collections" | "shared" | "membership";

export function App() {
  const sharedToken = collectionShareToken();
  return <AuthGate>{sharedToken ? <SharedCollection token={sharedToken} /> : <IndexApp />}</AuthGate>;
}

function IndexApp() {
  const initialGrantId = receivedGrantId();
  const [screen, setScreen] = useState<Screen>(initialGrantId ? "shared" : new URLSearchParams(window.location.search).get("screen") === "plus" ? "membership" : "library");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [collection, setCollection] = useState<Collection>();
  const [viewer, setViewer] = useState<{ id: string; files: ArchiveFile[] }>();
  const [search, setSearch] = useState({ draft: "", query: "", from: "", to: "" });

  const openLibrary = (next: LibraryFilter) => {
    clearReceivedGrant();
    setScreen("library"); setFilter(next); setCollection(undefined);
  };
  const openScreen = (next: Exclude<Screen, "library">) => {
    if (next !== "shared") clearReceivedGrant();
    setScreen(next);
    setCollection(undefined);
  };
  const openFile = (file: ArchiveFile, files: ArchiveFile[]) => setViewer({ id: file.id, files });

  return (
    <div className="app-shell">
      <header className="masthead">
        <button className="brand" onClick={() => openLibrary("all")}>INDEX</button>
        <div className="masthead-actions"><UploadButton /><span className="edition">PRIVATE ARCHIVE / 001</span></div>
      </header>

      <div className="workspace">
        <aside className="side-nav" aria-label="Archive navigation">
          <NavButton label="ALL" active={screen === "library" && filter === "all" && !collection} onClick={() => openLibrary("all")} />
          <NavButton label="PHOTOS" active={screen === "library" && filter === "photos"} onClick={() => openLibrary("photos")} />
          <NavButton label="VIDEOS" active={screen === "library" && filter === "videos"} onClick={() => openLibrary("videos")} />
          <NavButton label="FILES" active={screen === "library" && filter === "files"} onClick={() => openLibrary("files")} />
          <NavButton label="AUDIO" active={screen === "library" && filter === "audio"} onClick={() => openLibrary("audio")} />
          <NavButton label="FAVORITES" active={screen === "library" && filter === "favorites"} onClick={() => openLibrary("favorites")} />
          <div className="nav-break" />
          <NavButton label="SEARCH" active={screen === "search"} onClick={() => openScreen("search")} />
          <NavButton label="COLLECTIONS" active={screen === "collections"} onClick={() => openScreen("collections")} />
          <NavButton label="SHARED" active={screen === "shared"} onClick={() => openScreen("shared")} />
          <NavButton label="PLUS" active={screen === "membership"} onClick={() => openScreen("membership")} />
        </aside>

        <main className="main-content">
          {screen === "library" && <>
            <PageHeading title={collection?.name ?? filterLabel(filter)} meta={collection ? `COLLECTION / ${filterLabel(filter)}` : "CHRONOLOGICAL INDEX"} />
            {collection && <CollectionShareControls collection={collection} onChange={(isShared) => setCollection((current) => current ? { ...current, isShared } : current)} />}
            <LibraryFilters value={filter} onChange={setFilter} />
            <Library filter={filter} collectionId={collection?.id} onOpen={openFile} />
          </>}
          {screen === "search" && <>
            <PageHeading title="SEARCH" meta="METADATA INDEX" />
            <form className="search-form" onSubmit={(event) => { event.preventDefault(); setSearch((value) => ({ ...value, query: value.draft.trim() })); }}>
              <div className="search-line"><input autoFocus value={search.draft} onChange={(event) => setSearch((value) => ({ ...value, draft: event.target.value }))} placeholder="FILENAME, TYPE, TAG…" aria-label="Search archive" /><button>FIND</button></div>
              <div className="date-range"><label>FROM<input type="date" value={search.from} onChange={(event) => setSearch((value) => ({ ...value, from: event.target.value }))} /></label><label>TO<input type="date" value={search.to} onChange={(event) => setSearch((value) => ({ ...value, to: event.target.value }))} /></label></div>
            </form>
            {search.query ? <Library filter="all" q={search.query} from={toIso(search.from, false)} to={toIso(search.to, true)} onOpen={openFile} /> : <div className="search-prompt"><p>FIND WHAT YOU SENT.</p><span>SEARCH FILENAME, FILE TYPE, CAPTION, DATE OR TAG.</span></div>}
          </>}
          {screen === "collections" && <><PageHeading title="COLLECTIONS" meta="VIRTUAL GROUPS" /><Collections onOpen={(selected) => { setCollection(selected); setFilter("all"); setScreen("library"); }} /></>}
          {screen === "shared" && <ReceivedCollections initialGrantId={initialGrantId} />}
          {screen === "membership" && <><PageHeading title="PLUS" meta="INDEX MEMBERSHIP" /><Membership /></>}
          {screen !== "membership" && <SponsorSlot onOpenPlus={() => openScreen("membership")} />}
          <footer className="privacy-note">INDEX ONLY KNOWS WHAT YOU EXPLICITLY SEND, FORWARD OR UPLOAD. IT DOES NOT READ YOUR CHATS OR SAVED MESSAGES.</footer>
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Primary navigation">
        <button className={screen === "library" ? "active" : ""} onClick={() => openLibrary("all")}>INDEX</button>
        <button className={screen === "search" ? "active" : ""} onClick={() => openScreen("search")}>SEARCH</button>
        <button className={screen === "collections" ? "active" : ""} onClick={() => openScreen("collections")}>COLLECTIONS</button>
        <button className={screen === "shared" ? "active" : ""} onClick={() => openScreen("shared")}>SHARED</button>
        <button className={screen === "membership" ? "active" : ""} onClick={() => openScreen("membership")}>PLUS</button>
      </nav>
      {viewer && <Viewer initialId={viewer.id} files={viewer.files} onClose={() => setViewer(undefined)} />}
    </div>
  );
}

function UploadButton() {
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState("");
  const upload = async (file: File) => {
    setError(""); setProgress(0);
    try {
      await api.upload(file, setProgress);
      setProgress(1);
      await queryClient.invalidateQueries({ queryKey: ["files"] });
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
      setTimeout(() => setProgress(undefined), 800);
    } catch (uploadError) {
      setProgress(undefined);
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
    } finally { if (input.current) input.current.value = ""; }
  };
  return <div className="upload-control">
    <button onClick={() => input.current?.click()} disabled={progress !== undefined}>{progress === undefined ? "UPLOAD" : `${Math.round(progress * 100)}%`}</button>
    {progress !== undefined && <i style={{ transform: `scaleX(${progress})` }} />}
    <input ref={input} type="file" hidden multiple={false} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    {error && <button className="upload-error" onClick={() => setError("")} aria-label="Dismiss upload error">{error}</button>}
  </div>;
}

function NavButton({ label, active, onClick }: { label: string; active: boolean; onClick(): void }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{label}<span>{active ? "●" : ""}</span></button>;
}

const libraryFilters: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "ALL" },
  { value: "photos", label: "PHOTOS" },
  { value: "videos", label: "VIDEOS" },
  { value: "files", label: "FILES" },
  { value: "audio", label: "AUDIO" },
  { value: "favorites", label: "FAVORITES" }
];

function LibraryFilters({ value, onChange }: { value: LibraryFilter; onChange(filter: LibraryFilter): void }) {
  return <nav className="library-filters" aria-label="File type">
    {libraryFilters.map((item) => <button key={item.value} className={value === item.value ? "active" : ""} aria-pressed={value === item.value} onClick={() => onChange(item.value)}>{item.label}</button>)}
  </nav>;
}

function PageHeading({ title, meta }: { title: string; meta: string }) {
  return <header className="page-heading"><h1>{title}</h1><span>{meta}</span></header>;
}

function filterLabel(filter: LibraryFilter) {
  return filter === "all" ? "ALL" : filter.toUpperCase();
}

function toIso(value: string, end: boolean) {
  if (!value) return undefined;
  return new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}`).toISOString();
}

function collectionShareToken() {
  const startParam = window.Telegram?.WebApp.initDataUnsafe?.start_param
    ?? new URLSearchParams(window.location.search).get("tgWebAppStartParam")
    ?? new URLSearchParams(window.location.search).get("share");
  const match = startParam?.match(/^(?:collection_)?([A-Za-z0-9_-]{43})$/);
  return match?.[1];
}

function receivedGrantId() {
  const value = new URLSearchParams(window.location.search).get("shared");
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
}

function clearReceivedGrant() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("shared")) return;
  url.searchParams.delete("shared");
  window.history.replaceState({}, "", url);
}
