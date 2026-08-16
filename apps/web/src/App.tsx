import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ArchiveFile, LibraryFilter } from "@index/shared";
import { api } from "./api";
import { AuthGate } from "./components/AuthGate";
import { Collections } from "./components/Collections";
import { Library } from "./components/Library";
import { Viewer } from "./components/Viewer";

type Screen = "library" | "search" | "collections";

export function App() {
  return <AuthGate><IndexApp /></AuthGate>;
}

function IndexApp() {
  const [screen, setScreen] = useState<Screen>("library");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [collection, setCollection] = useState<{ id: string; name: string }>();
  const [viewer, setViewer] = useState<{ id: string; files: ArchiveFile[] }>();
  const [search, setSearch] = useState({ draft: "", query: "", from: "", to: "" });

  const openLibrary = (next: LibraryFilter) => {
    setScreen("library"); setFilter(next); setCollection(undefined);
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
          <NavButton label="FAVORITES" active={screen === "library" && filter === "favorites"} onClick={() => openLibrary("favorites")} />
          <div className="nav-break" />
          <NavButton label="SEARCH" active={screen === "search"} onClick={() => { setScreen("search"); setCollection(undefined); }} />
          <NavButton label="COLLECTIONS" active={screen === "collections"} onClick={() => { setScreen("collections"); setCollection(undefined); }} />
        </aside>

        <main className="main-content">
          {screen === "library" && <>
            <PageHeading title={collection?.name ?? filterLabel(filter)} meta={collection ? "COLLECTION" : "CHRONOLOGICAL INDEX"} />
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
          {screen === "collections" && <><PageHeading title="COLLECTIONS" meta="VIRTUAL GROUPS" /><Collections onOpen={(id, name) => { setCollection({ id, name }); setFilter("all"); setScreen("library"); }} /></>}
          <footer className="privacy-note">INDEX ONLY KNOWS WHAT YOU EXPLICITLY SEND, FORWARD OR UPLOAD. IT DOES NOT READ YOUR CHATS OR SAVED MESSAGES.</footer>
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Primary navigation">
        <button className={screen === "library" ? "active" : ""} onClick={() => openLibrary("all")}>INDEX</button>
        <button className={screen === "search" ? "active" : ""} onClick={() => setScreen("search")}>SEARCH</button>
        <button className={screen === "collections" ? "active" : ""} onClick={() => setScreen("collections")}>COLLECTIONS</button>
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
