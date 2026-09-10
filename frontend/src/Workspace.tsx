import { useState } from "react";
import {
  Play,
  Square,
  Plus,
  ChevronDown,
  ChevronRight,
  Volume2,
  Link,
  Lock,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Trash2,
  FileText,
} from "lucide-react";
import type { Project, Clip, Idea, Track, Placement } from "./types";
import PublicationPreview from "./PublicationPreview";
import { chosenClip, words, orderedPlacements } from "./api";
type Props = {
  project: Project;
  view: string;
  selected: string | null;
  onSelect: (id: string) => void;
  onCreate: (
    trackId: string,
    slot: number,
    text?: string,
    title?: string,
  ) => void;
  onMove: (
    clipId: string,
    trackId: string,
    slot: number,
    copy: boolean,
  ) => void;
  onPlay: (id?: string, scope?: string) => void;
  onRow: (slot: number) => void;
  onTrack: (id: string) => void;
  onToggleTrack: (id: string, field: "muted" | "solo") => void;
  onVoice: (id: string, voice: string) => void;
  voices: { id: string; name: string }[];
  onAddTrack: () => void;
  onCollate: (id: string, sectionId?: string) => void;
  onPlacement: (id: string, action: string) => void;
  onAddSection: () => void;
  onSection: (id: string) => void;
  previewUrl: string;
  previewKey: number;
  onPreviewLoad?: () => void;
};
export default function Workspace(p: Props) {
  const { project, view, selected } = p;
  const [zoom, setZoom] = useState(1);
  const rowCount = Math.max(10, ...project.clips.map((c) => c.slot + 2));
  const drop = (e: React.DragEvent, trackId: string, slot: number) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/x-alder-idea");
    const clip = e.dataTransfer.getData("application/x-alder-clip");
    if (raw) {
      const idea: Idea = JSON.parse(raw);
      p.onCreate(trackId, slot, idea.word, idea.word);
    } else if (clip) p.onMove(clip, trackId, slot, e.ctrlKey);
  };
  if (view === "Page Preview")
    return (
      <PublicationPreview
        project={project}
        refreshKey={p.previewKey}
        htmlUrl={p.previewUrl}
      />
    );
  if (view === "Manuscript")
    return (
      <section className="workspace pane manuscript-workspace">
        <div className="workspace-heading">
          <FileText size={14} />
          Manuscript
          <span>
            {project.placements.filter((x) => x.include).length} included
            passages
          </span>
          <button onClick={p.onAddSection}>
            <Plus size={13} />
            Section
          </button>
        </div>
        <div
          className="manuscript-pages"
          style={{ fontFamily: project.settings.fontFamily }}
        >
          <article>
            <div className="manuscript-title">
              <small>{project.settings.author || "A WORK IN PROGRESS"}</small>
              <h1>{project.name}</h1>
            </div>
            {[...project.sections]
              .sort((a, b) => a.order - b.order)
              .map((s) => (
                <section key={s.id}>
                  <h2 onDoubleClick={() => p.onSection(s.id)}>{s.title}</h2>
                  {orderedPlacements(project)
                    .filter((x) => x.include && x.sectionId === s.id)
                    .map((place) => {
                      const clip = project.clips.find(
                        (c) => c.id === place.clipId,
                      );
                      if (!clip) return null;
                      return (
                        <div
                          key={place.id}
                          className={
                            "manuscript-passage " +
                            (selected === clip.id ? "chosen" : "")
                          }
                          onClick={() => p.onSelect(clip.id)}
                        >
                          <button
                            title="Edit this passage"
                            aria-label={`Edit ${clip.title}`}
                            onClick={() => p.onSelect(clip.id)}
                          >
                            <Link size={12} />
                          </button>
                          {(place.frozenText ?? chosenClip(clip).text)
                            .split("\n")
                            .map((text, i) => (
                              <p key={i}>{text || "\u00a0"}</p>
                            ))}
                        </div>
                      );
                    })}
                </section>
              ))}
            {!project.placements.length && (
              <p className="empty-small">
                Add a clip to the collation to begin assembling your manuscript.
              </p>
            )}
          </article>
        </div>
      </section>
    );
  if (view === "Collation") {
    const sections = [...project.sections].sort((a, b) => a.order - b.order);
    return (
      <section className="workspace pane arrangement">
        <div className="arrangement-overview">
          {orderedPlacements(project).map((place) => (
            <span
              key={place.id}
              style={{
                background: project.tracks.find(
                  (t) =>
                    t.id ===
                    project.clips.find((c) => c.id === place.clipId)?.trackId,
                )?.color,
                flex: 1,
              }}
            />
          ))}
          <div className="overview-window" />
        </div>
        <div className="arrangement-scroll">
          <div
            className="arrangement-content"
            style={{ minWidth: sections.length * 280 * zoom + 174 }}
          >
            <div className="structure-ruler">
              {sections.map((s) => (
                <div
                  key={s.id}
                  style={{ width: 280 * zoom }}
                  onDoubleClick={() => p.onSection(s.id)}
                >
                  <span>{s.order + 1}</span>
                  <strong>{s.title}</strong>
                  <small>{s.role}</small>
                </div>
              ))}
              <button onClick={p.onAddSection}>
                <Plus size={13} />
                Section
              </button>
            </div>
            {project.tracks.map((track, ti) => (
              <div className="arrangement-row" key={track.id}>
                <div className="arrangement-lane">
                  {sections.map((section) => (
                    <div
                      className="arrangement-section"
                      key={section.id}
                      style={{ width: 280 * zoom }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData(
                          "application/x-alder-clip",
                        );
                        if (id) p.onCollate(id, section.id);
                      }}
                    >
                      {orderedPlacements(project)
                        .filter(
                          (place) =>
                            place.sectionId === section.id &&
                            project.clips.find((c) => c.id === place.clipId)
                              ?.trackId === track.id,
                        )
                        .map((place) => {
                          const clip = project.clips.find(
                            (c) => c.id === place.clipId,
                          )!;
                          return (
                            <div
                              key={place.id}
                              className={
                                "arrangement-clip " +
                                (selected === clip.id ? "selected" : "") +
                                (!place.include ? " excluded" : "")
                              }
                              style={
                                {
                                  "--track-color": track.color,
                                } as React.CSSProperties
                              }
                              onClick={() => p.onSelect(clip.id)}
                            >
                              <header>
                                <button
                                  title="Read clip"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    p.onPlay(clip.id);
                                  }}
                                >
                                  <Play size={11} />
                                </button>
                                <span>{clip.title}</span>
                                {place.frozenDocument ? (
                                  <Lock size={10} />
                                ) : (
                                  <Link size={10} />
                                )}
                              </header>
                              <p>{place.frozenText ?? chosenClip(clip).text}</p>
                              <footer>
                                <span>#{place.order + 1}</span>
                                <button
                                  title="Move earlier"
                                  onClick={() => p.onPlacement(place.id, "up")}
                                >
                                  <ArrowUp size={10} />
                                </button>
                                <button
                                  title="Move later"
                                  onClick={() =>
                                    p.onPlacement(place.id, "down")
                                  }
                                >
                                  <ArrowDown size={10} />
                                </button>
                                <button
                                  title={
                                    place.include
                                      ? "Exclude from output"
                                      : "Include in output"
                                  }
                                  onClick={() =>
                                    p.onPlacement(place.id, "include")
                                  }
                                >
                                  {place.include ? "On" : "Off"}
                                </button>
                                <button
                                  title={
                                    place.frozenDocument
                                      ? "Unfreeze reference"
                                      : "Freeze revision"
                                  }
                                  onClick={() =>
                                    p.onPlacement(place.id, "freeze")
                                  }
                                >
                                  <Lock size={10} />
                                </button>
                                <button
                                  title="Remove placement"
                                  onClick={() =>
                                    p.onPlacement(place.id, "remove")
                                  }
                                >
                                  <Trash2 size={10} />
                                </button>
                              </footer>
                            </div>
                          );
                        })}
                    </div>
                  ))}
                </div>
                <div
                  className="arrangement-track"
                  style={{ background: track.color }}
                  onDoubleClick={() => p.onTrack(track.id)}
                >
                  <strong>
                    <ChevronDown size={13} />
                    {ti + 1} {track.name}
                  </strong>
                  <span>{track.role}</span>
                  <div>
                    <button
                      className={!track.muted ? "amber" : ""}
                      onClick={() => p.onToggleTrack(track.id, "muted")}
                    >
                      {ti + 1}
                    </button>
                    <button
                      className={track.solo ? "active" : ""}
                      onClick={() => p.onToggleTrack(track.id, "solo")}
                    >
                      S
                    </button>
                    <button onClick={() => p.onTrack(track.id)}>Edit</button>
                  </div>
                </div>
              </div>
            ))}
            <div
              className="arrangement-empty"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("application/x-alder-clip");
                if (id) p.onCollate(id);
              }}
            >
              Drop clips into a section to build the reading order
            </div>
          </div>
        </div>
        <div className="arrangement-footer">
          <span>Structure · {project.placements.length} placements</span>
          <button onClick={p.onAddTrack}>
            <Plus size={12} />
            Track
          </button>
          <label>
            Zoom{" "}
            <input
              aria-label="Arrangement zoom"
              type="range"
              min="0.65"
              max="1.6"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
        </div>
      </section>
    );
  }
  return (
    <section className="workspace pane session-workspace">
      <div className="session-scroll">
        <div className="session-tracks">
          {project.tracks.map((track, index) => (
            <div
              className={"track-column " + (track.muted ? "muted" : "")}
              key={track.id}
              style={{ "--track-color": track.color } as React.CSSProperties}
            >
              <header
                className="track-header"
                onDoubleClick={() => p.onTrack(track.id)}
              >
                <strong>
                  {index + 1} {track.name}
                </strong>
                <button
                  title={`Edit ${track.name} track`}
                  onClick={() => p.onTrack(track.id)}
                >
                  <ChevronDown size={13} />
                </button>
              </header>
              <div className="clip-slots">
                {Array.from({ length: rowCount }, (_, slot) => {
                  const clip = project.clips.find(
                    (c) => c.trackId === track.id && c.slot === slot,
                  );
                  return (
                    <div
                      key={slot}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        clip
                          ? `Clip ${clip.title}`
                          : `Empty slot ${slot + 1} in ${track.name}`
                      }
                      className={
                        "clip-slot " +
                        (clip ? "occupied" : "") +
                        (clip && selected === clip.id ? " selected" : "")
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          clip
                            ? p.onSelect(clip.id)
                            : p.onCreate(track.id, slot);
                      }}
                      draggable={!!clip}
                      onDragStart={(e) =>
                        clip &&
                        e.dataTransfer.setData(
                          "application/x-alder-clip",
                          clip.id,
                        )
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => drop(e, track.id, slot)}
                      onClick={() => clip && p.onSelect(clip.id)}
                      onDoubleClick={() =>
                        clip ? p.onSelect(clip.id) : p.onCreate(track.id, slot)
                      }
                    >
                      {clip ? (
                        <>
                          <button
                            title={`Read ${clip.title}`}
                            aria-label={`Read ${clip.title}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              p.onPlay(clip.id);
                            }}
                          >
                            <Play size={11} fill="currentColor" />
                          </button>
                          <span>{clip.title}</span>
                          {clip.variants.length > 0 && (
                            <small>{clip.variants.length + 1}</small>
                          )}
                        </>
                      ) : (
                        <>
                          <Square size={9} fill="currentColor" />
                          <span />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="track-stop">
                <Square size={11} fill="currentColor" />
                <span>
                  {project.clips.filter((c) => c.trackId === track.id).length}{" "}
                  clips
                </span>
              </div>
              <div className="track-routing">
                <label>Voice</label>
                <select
                  aria-label={`Voice for ${track.name}`}
                  value={track.voiceId}
                  onChange={(e) => p.onVoice(track.id, e.target.value)}
                >
                  {p.voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <label>Language To</label>
                <button
                  className="routing-select"
                  onClick={() => p.onTrack(track.id)}
                >
                  Main collation <ChevronDown size={11} />
                </button>
                <div className="monitor-options">
                  <span>Read</span>
                  <button
                    className={!track.muted ? "amber" : ""}
                    onClick={() => p.onToggleTrack(track.id, "muted")}
                  >
                    {track.muted ? "Off" : "Auto"}
                  </button>
                </div>
              </div>
              <div className="track-mixer">
                <div className="track-count">
                  <span>
                    {project.clips
                      .filter((c) => c.trackId === track.id)
                      .reduce((n, c) => n + words(chosenClip(c).text), 0)}
                  </span>
                  <small>words</small>
                </div>
                <div className="track-buttons">
                  <button
                    className={"track-number " + (!track.muted ? "amber" : "")}
                    aria-label={`Mute ${track.name}`}
                    title="Toggle audition mute"
                    onClick={() => p.onToggleTrack(track.id, "muted")}
                  >
                    {index + 1}
                  </button>
                  <button
                    className={track.solo ? "active" : ""}
                    aria-label={`Solo ${track.name}`}
                    title="Solo track for row audition"
                    onClick={() => p.onToggleTrack(track.id, "solo")}
                  >
                    S
                  </button>
                  <button
                    title="Create a clip"
                    aria-label={`New clip in ${track.name}`}
                    onClick={() =>
                      p.onCreate(
                        track.id,
                        project.clips
                          .filter((c) => c.trackId === track.id)
                          .reduce((n, c) => Math.max(n, c.slot + 1), 0),
                      )
                    }
                  >
                    ●
                  </button>
                </div>
                <div
                  className="track-device-count"
                  onClick={() => p.onTrack(track.id)}
                >
                  <span>{track.devices.filter((d) => d.enabled).length}</span>
                  <small>devices</small>
                </div>
              </div>
              <div className="track-color-strip" />
            </div>
          ))}
          <div
            className="session-empty"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => drop(e, project.tracks[0]?.id, 0)}
          >
            <p>Drop ideas and clips here</p>
            <button onClick={p.onAddTrack}>
              <Plus size={14} /> Add track
            </button>
          </div>
        </div>
      </div>
      <div className="main-column">
        <header>Main</header>
        <div className="scene-slots">
          {Array.from({ length: rowCount }, (_, slot) => (
            <button
              key={slot}
              title={`Read row ${slot + 1}`}
              aria-label={`Read row ${slot + 1}`}
              onClick={() => p.onRow(slot)}
            >
              <Play size={11} fill="currentColor" />
              <span>{slot + 1}</span>
            </button>
          ))}
        </div>
        <div className="track-stop">
          <Square size={11} fill="currentColor" />
          <span>Sequence</span>
        </div>
        <div className="main-output">
          <label>Output</label>
          <span>Written + spoken</span>
          <label>Reading order</label>
          <span>
            {project.placements.filter((p) => p.include).length} passages
          </span>
          <button onClick={() => p.onPlay(undefined, "collation")}>
            <Play size={12} />
            Read collation
          </button>
        </div>
        <div className="main-words">
          <strong>
            {project.clips.reduce((n, c) => n + words(chosenClip(c).text), 0)}
          </strong>
          <span>project words</span>
        </div>
        <div className="main-color-strip" />
      </div>
    </section>
  );
}
