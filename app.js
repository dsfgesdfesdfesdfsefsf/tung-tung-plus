import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  STORAGE_BUCKET,
  SIGNED_URL_SECONDS
} from "./config.js";

const ARCHIVE_EPISODES = [{
  id: "archive-session-1",
  identifier: "session1_Shorts_1080x1920",
  title: "Session 1 — Shorts 1080×1920",
  description: "Primo video pubblicato su TUNG TUNG+.",
  episode_number: null,
  created_at: "2026-11-15T00:00:00Z",
  archive_url: "https://archive.org/embed/session1_Shorts_1080x1920"
}];

const $ = (id) => document.getElementById(id);
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const SECRET_CODE = "Maurizio12@";
const supabaseReady =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_ANON_KEY.startsWith("INSERISCI_");

let supabase = null;
let isAdmin = false;
let activeEpisode = null;
let episodesCache = [];

function showView(id) {
  ["setup-view", "auth-view", "app-view"].forEach((view) => {
    const element = $(view);
    if (element) element.classList.toggle("hidden", view !== id);
  });
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("visible");
  window.setTimeout(() => $("toast").classList.remove("visible"), 3500);
}

function setMessage(id, message, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("error", error);
}

function formatFileSize(bytes) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatEpisodeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
}

function setUploadProgress(percent, uploaded, total, label = "Caricamento video…") {
  const safePercent = Math.max(0, Math.min(100, percent));
  $("upload-progress").classList.remove("hidden");
  $("upload-progress-label").textContent = label;
  $("upload-progress-percent").textContent = `${Math.round(safePercent)}%`;
  $("upload-progress-bar").style.width = `${safePercent}%`;
  $("upload-progress-detail").textContent =
    `${formatFileSize(uploaded)} / ${formatFileSize(total)}`;
}

function friendlyUploadError(error) {
  const message = String(error?.message || error || "Errore sconosciuto");
  const lower = message.toLowerCase();
  if (error?.status === 413 || /too large|payload too large|maximum allowed size|exceeded.*size|file size limit/.test(lower)) {
    return "The file is too large";
  }
  return message;
}

async function getSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

async function uploadVideoResumable(file, path, onProgress) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const endpoint = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(STORAGE_BUCKET)}/${encodedPath}`;

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint, true);
    xhr.setRequestHeader("authorization", `Bearer ${SUPABASE_ANON_KEY}`);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Errore upload (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText || "{}");
        message = body.message || body.error || body.msg || message;
      } catch (_) {
        if (xhr.responseText) message = xhr.responseText;
      }
      const error = new Error(message);
      error.status = xhr.status;
      reject(error);
    });
    xhr.addEventListener("error", () => reject(new Error("Errore di connessione durante il caricamento.")));
    xhr.addEventListener("abort", () => reject(new Error("Caricamento annullato.")));
    xhr.send(file);
  });
}

function createEpisodeCard(episode, coverUrl, variant = "landscape") {
  const card = document.createElement("article");
  card.className = `episode-card ${variant === "shorts" ? "episode-card-short" : ""}`;

  const posterButton = document.createElement("button");
  posterButton.className = "poster-button";
  posterButton.type = "button";
  posterButton.setAttribute("aria-label", `Guarda ${episode.title}`);

  if (coverUrl) {
    const image = document.createElement("img");
    image.className = "poster";
    image.src = coverUrl;
    image.alt = "";
    image.loading = "lazy";
    posterButton.appendChild(image);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "poster poster-placeholder";
    placeholder.innerHTML = 'TUNG TUNG<span style="color:#00d7e8">+</span>';
    posterButton.appendChild(placeholder);
  }

  const overlay = document.createElement("span");
  overlay.className = "play-overlay";
  overlay.innerHTML = "<span>▶</span>";
  posterButton.appendChild(overlay);

  const tag = document.createElement("span");
  tag.className = "episode-tag";
  tag.textContent = variant === "shorts" ? "▶ SHORT" : (episode.episode_number ? `EP. ${episode.episode_number}` : "TUNG TUNG+");
  posterButton.appendChild(tag);

  const copy = document.createElement("div");
  copy.className = "episode-copy";

  const title = document.createElement("h3");
  title.textContent = episode.title || "Episodio senza titolo";
  if (variant === "shorts") title.classList.add("short-title");

  const meta = document.createElement("p");
  const number = episode.episode_number ? `EP. ${episode.episode_number}` : "TUNG TUNG WAR";
  const date = formatEpisodeDate(episode.created_at);
  meta.textContent = [number, date].filter(Boolean).join(" · ");

  copy.append(title, meta);
  card.append(posterButton, copy);
  posterButton.addEventListener("click", () => openEpisode(episode));
  return card;
}

function renderRail(title, episodes, covers, suffix, variant = "landscape") {
  if (!episodes.length) return null;
  const section = document.createElement("section");
  section.className = `rail-section rail-${variant}`;

  const heading = document.createElement("div");
  heading.className = "section-heading";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const count = document.createElement("small");
  count.textContent = String(episodes.length);
  h2.appendChild(count);
  heading.appendChild(h2);

  const wrap = document.createElement("div");
  wrap.className = "rail-wrap";
  const rail = document.createElement("div");
  rail.className = `episode-rail ${variant === "shorts" ? "shorts-rail" : ""}`;
  rail.id = `rail-${suffix}`;

  episodes.forEach((episode) => {
    rail.appendChild(createEpisodeCard(episode, covers.get(episode.id) || "", variant));
  });

  const previous = document.createElement("button");
  previous.className = "rail-arrow prev";
  previous.type = "button";
  previous.setAttribute("aria-label", "Episodi precedenti");
  previous.textContent = "‹";
  previous.addEventListener("click", () => rail.scrollBy({ left: -rail.clientWidth * 0.8, behavior: "smooth" }));

  const next = document.createElement("button");
  next.className = "rail-arrow next";
  next.type = "button";
  next.setAttribute("aria-label", "Episodi successivi");
  next.textContent = "›";
  next.addEventListener("click", () => rail.scrollBy({ left: rail.clientWidth * 0.8, behavior: "smooth" }));

  wrap.append(previous, rail, next);
  section.append(heading, wrap);
  return section;
}

function getHiddenArchiveEpisodeIds() {
  try {
    return JSON.parse(localStorage.getItem("tung-tung-plus-hidden-archive-episodes") || "[]");
  } catch (_) {
    return [];
  }
}

function hideArchiveEpisodeLocally(episodeId) {
  const hidden = new Set(getHiddenArchiveEpisodeIds());
  hidden.add(String(episodeId));
  localStorage.setItem("tung-tung-plus-hidden-archive-episodes", JSON.stringify([...hidden]));
}

async function loadEpisodes() {
  $("loading").classList.remove("hidden");
  $("hero-slot").innerHTML = "";
  $("episode-rows").innerHTML = "";
  $("empty-state").classList.add("hidden");
  setMessage("catalog-message", "");

  let data = null;
  let error = null;

  if (supabase) {
    const result = await supabase
      .from("episodes")
      .select("*")
      .order("created_at", { ascending: false });
    data = result.data;
    error = result.error;
  } else {
    error = new Error("Archivio online non configurato: mostro gli episodi disponibili localmente.");
  }

  $("loading").classList.add("hidden");
  if (error) {
    episodesCache = ARCHIVE_EPISODES;
    setMessage("catalog-message", "Catalogo caricato da Internet Archive.");
  } else {
    episodesCache = (data && data.length) ? data : ARCHIVE_EPISODES;
  }
  const hiddenArchiveIds = new Set(getHiddenArchiveEpisodeIds());
  episodesCache = episodesCache.filter((episode) =>
    !hiddenArchiveIds.has(String(episode.id))
  );

  // Sort numbered episodes by episode number, not upload date.
  // Episodes without a number are placed after numbered episodes.
  episodesCache.sort((a, b) => {
    const numberA = Number(a.episode_number);
    const numberB = Number(b.episode_number);
    const hasA = a.episode_number !== null && a.episode_number !== undefined && String(a.episode_number).trim() !== "" && Number.isFinite(numberA);
    const hasB = b.episode_number !== null && b.episode_number !== undefined && String(b.episode_number).trim() !== "" && Number.isFinite(numberB);

    if (hasA && hasB) return numberB - numberA;
    if (hasA) return -1;
    if (hasB) return 1;

    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });

  $("episode-count").textContent = `${episodesCache.length} EPISODI`;

  if (!episodesCache.length) {
    $("empty-state").classList.remove("hidden");
    return;
  }

  const coverPairs = await Promise.all(episodesCache.map(async (episode) => {
    if (!episode.cover_path) return [episode.id, ""];
    const url = await getSignedUrl(episode.cover_path).catch(() => "");
    return [episode.id, url];
  }));
  const covers = new Map(coverPairs);

  const numberedEpisodes = episodesCache.filter((episode) => Number.isFinite(Number(episode.episode_number)) && episode.episode_number !== null && episode.episode_number !== undefined && String(episode.episode_number).trim() !== "");
  const latest = numberedEpisodes.length ? numberedEpisodes[0] : episodesCache[0];
  const hero = document.createElement("section");
  hero.className = "hero-dynamic";
  const latestCover = covers.get(latest.id);
  if (latestCover) {
    hero.style.backgroundImage = `linear-gradient(90deg,rgba(0,0,0,.94),rgba(0,0,0,.32)),url("${latestCover}")`;
  }

  const content = document.createElement("div");
  content.className = "hero-content";
  const kicker = document.createElement("div");
  kicker.className = "hero-kicker";
  kicker.innerHTML = '<span class="live-dot"></span> TUNG TUNG WAR · ULTIMO EPISODIO';

  const title = document.createElement("h1");
  title.textContent = latest.title || "TUNG TUNG WAR";

  const meta = document.createElement("div");
  meta.className = "hero-meta";
  const number = latest.episode_number ? `EPISODIO ${latest.episode_number}` : "NUOVO EPISODIO";
  const date = formatEpisodeDate(latest.created_at);
  meta.textContent = [number, date].filter(Boolean).join("  ·  ");

  const description = document.createElement("p");
  description.className = "hero-description";
  description.textContent = latest.description || "Guarda l'ultimo episodio di TUNG TUNG WAR.";

  const actions = document.createElement("div");
  actions.className = "hero-actions";
  const play = document.createElement("button");
  play.className = "button primary hero-play";
  play.type = "button";
  play.textContent = "▶  PLAY";
  play.addEventListener("click", () => openEpisode(latest));
  const badge = document.createElement("span");
  badge.className = "hero-number";
  badge.textContent = number;
  actions.append(play, badge);
  content.append(kicker, title, meta, description, actions);
  hero.appendChild(content);
  $("hero-slot").appendChild(hero);

  const shortEpisodes = episodesCache.filter((episode) =>
    /shorts/i.test(String(episode.identifier || "")) ||
    String(episode.video_path || "").startsWith("archive-short:") ||
    Boolean(episode.is_short)
  );
  const moreEpisodes = episodesCache.filter((episode) => episode.id !== latest.id).slice(0, 10);
  const exploreEpisodes = episodesCache.slice();

  const shorts = renderRail("SHORTS", shortEpisodes, covers, "shorts", "shorts");
  const more = renderRail("MORE TO WATCH", moreEpisodes, covers, "more", "landscape");
  const explore = renderRail("EXPLORE", exploreEpisodes, covers, "explore", "landscape");

  if (shorts) $("episode-rows").appendChild(shorts);
  if (more) $("episode-rows").appendChild(more);
  if (explore) $("episode-rows").appendChild(explore);
}

function openEditModal() {
  if (!isAdmin || !activeEpisode) return;
  $("edit-form").reset();
  $("edit-episode-title").value = activeEpisode.title || "";
  $("edit-episode-number").value = activeEpisode.episode_number ?? "";
  $("edit-episode-description").value = activeEpisode.description || "";
  setMessage("edit-message", "");
  $("edit-modal").classList.remove("hidden");
}

async function openEpisode(episode) {
  activeEpisode = episode;
  $("player-title").textContent = episode.title;
  $("player-number").textContent = episode.episode_number
    ? `TUNG TUNG WAR // EPISODIO ${episode.episode_number}`
    : "TUNG TUNG+ // PLAYER";
  $("player-description").textContent = episode.description || "Nessuna descrizione disponibile.";
  $("delete-episode").classList.toggle("hidden", !isAdmin);
  $("edit-episode").classList.toggle("hidden", !isAdmin);
  $("player-modal").classList.remove("hidden");

  const video = $("video-player");
  const archiveFrame = $("archive-player");
  video.pause();
  video.classList.add("hidden");
  video.removeAttribute("src");
  video.load();
  archiveFrame.classList.add("hidden");
  archiveFrame.removeAttribute("src");

  const videoPath = String(episode.video_path || "");
  if (episode.archive_url || videoPath.startsWith("archive-")) {
    const archiveIdentifier = videoPath.replace(/^archive-(?:short|video):/, "");
    archiveFrame.src = episode.archive_url || `https://archive.org/embed/${encodeURIComponent(archiveIdentifier)}`;
    archiveFrame.classList.remove("hidden");
    return;
  }

  try {
    let url;
    if (videoPath.startsWith("external-url:")) {
      url = videoPath.slice("external-url:".length);
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== "share.deepstorage.dev" ||
          !/\.(mp4|webm|m4v)(?:$|[?#])/i.test(url)) {
        throw new Error("Il link non è un video MP4/WebM supportato.");
      }
    } else {
      url = await getSignedUrl(videoPath);
    }
    video.classList.remove("hidden");
    video.src = url;
    video.load();
    video.onerror = () => toast("Il video non è riproducibile: verifica formato MP4 H.264/WebM e permessi del link.");
    await video.play().catch(() => {});
  } catch (error) {
    toast(`Non riesco ad aprire il video: ${error.message}`);
  }
}

function enterApp(adminMode) {
  isAdmin = adminMode;
  $("auth-view").classList.add("hidden");
  $("open-upload").classList.toggle("hidden", !isAdmin);
  $("sign-in-open").classList.toggle("hidden", isAdmin);
  $("user-label").textContent = isAdmin ? "ADMIN" : "";
  showView("app-view");
  loadEpisodes();
}

async function init() {
  $("year").textContent = new Date().getFullYear();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  if (supabaseReady) {
    try {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    } catch (error) {
      console.error("Supabase non disponibile:", error);
      supabase = null;
    }
  }

  $("sign-in-open").addEventListener("click", () => {
    $("auth-view").classList.remove("hidden");
    $("auth-message").textContent = "";
    $("secret-code").value = "";
  });

  $("auth-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if ($("secret-code").value === SECRET_CODE) {
      setMessage("auth-message", "");
      $("secret-code").value = "";
      enterApp(true);
    } else {
      setMessage("auth-message", "Secret Code non corretto.", true);
      $("secret-code").select();
    }
  });

  $("visitor-entry").addEventListener("click", () => enterApp(false));

  $("open-upload").addEventListener("click", () => {
    if (!isAdmin) return;
    $("upload-form").reset();
    setMessage("upload-message", "");
    $("upload-progress").classList.add("hidden");
    $("upload-modal").classList.remove("hidden");
  });

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.close;
      $(target).classList.add("hidden");
      if (target === "player-modal") {
        $("video-player").pause();
        $("video-player").removeAttribute("src");
        $("video-player").load();
        $("archive-player").removeAttribute("src");
        $("archive-player").classList.add("hidden");
      }
    });
  });

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.classList.add("hidden");
        if (modal.id === "player-modal") {
          $("video-player").pause();
          $("video-player").removeAttribute("src");
          $("video-player").load();
          $("archive-player").removeAttribute("src");
          $("archive-player").classList.add("hidden");
        }
      }
    });
  });

  $("auth-view").addEventListener("click", (event) => {
    if (event.target === $("auth-view")) $("auth-view").classList.add("hidden");
  });

  $("upload-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAdmin) return setMessage("upload-message", "Inserisci il Secret Code per pubblicare.", true);

    const cover = $("episode-cover").files[0];
    const title = $("episode-title").value.trim();
    const videoLink = $("episode-video-link").value.trim();
    const videoType = $("episode-type").value;
    if (!title || !videoLink) return setMessage("upload-message", "Inserisci il titolo e il link del video.", true);

    let parsedUrl;
    try { parsedUrl = new URL(videoLink); }
    catch (_) { return setMessage("upload-message", "Inserisci un link valido di Internet Archive o Deep Storage.", true); }

    const isArchive = ["archive.org", "www.archive.org"].includes(parsedUrl.hostname);
    const isDeepStorage = ["deepstorage.dev", "www.deepstorage.dev", "share.deepstorage.dev"].includes(parsedUrl.hostname);
    if (!isArchive && !isDeepStorage) {
      return setMessage("upload-message", "Sono supportati i link di Internet Archive e Deep Storage.", true);
    }

    let externalVideoUrl = "";
    let identifier = "";
    if (isArchive) {
      const match = parsedUrl.pathname.match(/^\/(?:details|embed)\/([^/]+)/);
      if (!match) return setMessage("upload-message", "Usa il link /details/IDENTIFIER oppure /embed/IDENTIFIER.", true);
      identifier = decodeURIComponent(match[1]);
      if (!/^[a-zA-Z0-9._-]+$/.test(identifier)) {
        return setMessage("upload-message", "L'identifier del video non è valido.", true);
      }
    } else {
      if (parsedUrl.hostname === "deepstorage.dev" || parsedUrl.hostname === "www.deepstorage.dev") {
        if (parsedUrl.pathname !== "/watch") {
          return setMessage("upload-message", "Usa il link /watch di Deep Storage.", true);
        }
        const sharedUrl = parsedUrl.searchParams.get("id");
        if (!sharedUrl) return setMessage("upload-message", "Il link Deep Storage non contiene il video.", true);
        try {
          const shared = new URL(sharedUrl);
          if (shared.protocol !== "https:" || shared.hostname !== "share.deepstorage.dev") throw new Error();
          externalVideoUrl = shared.href;
        } catch (_) {
          return setMessage("upload-message", "Il link condiviso Deep Storage non è valido.", true);
        }
      } else {
        if (parsedUrl.protocol !== "https:") return setMessage("upload-message", "Usa un link HTTPS.", true);
        externalVideoUrl = parsedUrl.href;
      }
      if (!/\.(mp4|webm|m4v)(?:$|[?#])/i.test(externalVideoUrl)) {
        return setMessage("upload-message", "Il link AVI può essere salvato solo dopo la conversione: il player richiede MP4 H.264 o WebM.", true);
      }
    }

    const publish = $("publish-btn");
    publish.disabled = true;
    setMessage("upload-message", "Pubblicazione in corso…");
    $("upload-progress").classList.add("hidden");

    const id = crypto.randomUUID();
    let coverPath = null;
    const archivePath = isArchive
      ? "archive-" + videoType + ":" + identifier
      : "external-url:" + externalVideoUrl;

    try {
      if (cover) {
        const coverExt = (cover.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        coverPath = "covers/" + id + "." + coverExt;
        const { error: coverError } = await supabase.storage.from(STORAGE_BUCKET).upload(coverPath, cover, {
          contentType: cover.type || "image/jpeg",
          upsert: false
        });
        if (coverError) throw coverError;
      }

      const numberValue = $("episode-number").value.trim();
      const { error: dbError } = await supabase.from("episodes").insert({
        title,
        description: $("episode-description").value.trim(),
        episode_number: numberValue ? Number(numberValue) : null,
        video_path: archivePath,
        cover_path: coverPath
      });
      if (dbError) throw dbError;

      $("upload-modal").classList.add("hidden");
      toast(videoType === "short" ? "Short pubblicato!" : "Video pubblicato!");
      await loadEpisodes();
    } catch (error) {
      if (coverPath) await supabase.storage.from(STORAGE_BUCKET).remove([coverPath]).catch(() => {});
      setMessage("upload-message", friendlyUploadError(error), true);
    } finally {
      publish.disabled = false;
    }
  });

  $("edit-episode").addEventListener("click", openEditModal);

  $("edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAdmin || !activeEpisode) return;
    const saveButton = $("save-edit-btn");
    saveButton.disabled = true;
    setMessage("edit-message", "Salvataggio modifiche…");
    let newCoverPath = null;
    try {
      const cover = $("edit-episode-cover").files[0];
      const title = $("edit-episode-title").value.trim();
      const numberValue = $("edit-episode-number").value.trim();
      const description = $("edit-episode-description").value.trim();
      if (!title) throw new Error("Inserisci il titolo dell'episodio.");

      if (cover) {
        const ext = (cover.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        newCoverPath = "covers/" + crypto.randomUUID() + "." + ext;
        const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(newCoverPath, cover, {
          contentType: cover.type || "image/jpeg", upsert: false
        });
        if (error) throw error;
      }

      const isStaticArchive = Boolean(activeEpisode.archive_url) &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(activeEpisode.id));
      const values = {
        title,
        description,
        episode_number: numberValue ? Number(numberValue) : null,
        video_path: activeEpisode.video_path || ("archive-video:" + activeEpisode.identifier),
        cover_path: newCoverPath || activeEpisode.cover_path || null
      };

      let dbResult;
      if (isStaticArchive) {
        dbResult = await supabase.from("episodes").insert(values);
      } else {
        dbResult = await supabase.from("episodes").update(values).eq("id", activeEpisode.id);
      }
      if (dbResult.error) throw dbResult.error;

      if (newCoverPath && activeEpisode.cover_path) {
        await supabase.storage.from(STORAGE_BUCKET).remove([activeEpisode.cover_path]).catch(() => {});
      }
      $("edit-modal").classList.add("hidden");
      $("player-modal").classList.add("hidden");
      $("archive-player").removeAttribute("src");
      $("archive-player").classList.add("hidden");
      $("video-player").pause();
      $("video-player").removeAttribute("src");
      $("video-player").load();
      activeEpisode = null;
      await loadEpisodes();
      toast("Episodio aggiornato!");
    } catch (error) {
      if (newCoverPath) await supabase.storage.from(STORAGE_BUCKET).remove([newCoverPath]).catch(() => {});
      setMessage("edit-message", error.message || "Errore durante il salvataggio.", true);
    } finally {
      saveButton.disabled = false;
    }
  });

  $("delete-episode").addEventListener("click", async () => {
    if (!isAdmin || !activeEpisode) return;
    if (!confirm(`Rimuovere "${activeEpisode.title}" da TUNG TUNG+? Il video originale resterà online.`)) return;

    try {
      const isArchiveEpisode =
        Boolean(activeEpisode.archive_url) ||
        String(activeEpisode.video_path || "").startsWith("archive-");

      if (isArchiveEpisode && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(activeEpisode.id))) {
        // Static Internet Archive entries have no Supabase row: hide only this catalogue link.
        hideArchiveEpisodeLocally(activeEpisode.id);
      } else {
        // Remove the catalogue row. Never delete the video hosted on Internet Archive.
        const { error: dbError } = await supabase
          .from("episodes")
          .delete()
          .eq("id", activeEpisode.id);
        if (dbError) throw dbError;

        // Only remove a TUNG TUNG+ cover file; leave external video links untouched.
        if (activeEpisode.cover_path) {
          const { error: storageError } = await supabase
            .storage.from(STORAGE_BUCKET).remove([activeEpisode.cover_path]);
          if (storageError) throw storageError;
        }
      }

      $("player-modal").classList.add("hidden");
      $("video-player").pause();
      $("video-player").removeAttribute("src");
      $("video-player").load();
      $("archive-player").removeAttribute("src");
      $("archive-player").classList.add("hidden");
      activeEpisode = null;
      await loadEpisodes();
      toast("Collegamento rimosso da TUNG TUNG+. Il video originale non è stato eliminato.");
    } catch (error) {
      toast(`Errore durante l'eliminazione: ${error.message}`);
    }
  });

  // The public catalogue always opens; the admin code is requested only for publishing.
  enterApp(false);
}

init().catch((error) => {
  console.error("Errore di avvio TUNG TUNG+:", error);
  // Keep the site usable even if the online archive cannot initialize.
  supabase = null;
  showView("app-view");
  loadEpisodes();
  setMessage("catalog-message", "Archivio online non raggiungibile. Mostro i contenuti di riserva.", true);
});
