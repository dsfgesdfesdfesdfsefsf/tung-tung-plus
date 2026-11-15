import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  STORAGE_BUCKET,
  SIGNED_URL_SECONDS
} from "./config.js";

const ARCHIVE_EPISODES = [{
  id: "archive-session-1",
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

async function loadEpisodes() {
  $("loading").classList.remove("hidden");
  $("hero-slot").innerHTML = "";
  $("episode-rows").innerHTML = "";
  $("empty-state").classList.add("hidden");
  setMessage("catalog-message", "");

  const { data, error } = await supabase
    .from("episodes")
    .select("*")
    .order("created_at", { ascending: false });

  $("loading").classList.add("hidden");
  if (error) {
    episodesCache = ARCHIVE_EPISODES;
    setMessage("catalog-message", "Catalogo caricato da Internet Archive.");
  } else {
    episodesCache = (data && data.length) ? data : ARCHIVE_EPISODES;
  }
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

  const latest = episodesCache[0];
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
    /short|shorts/i.test(`${episode.title || ""} ${episode.description || ""}`) ||
    Boolean(episode.is_short)
  );
  const moreEpisodes = episodesCache.length > 1
    ? episodesCache.slice(1, 11)
    : episodesCache.slice(0, 10);
  const exploreEpisodes = episodesCache.slice();

  const shorts = renderRail("SHORTS", shortEpisodes, covers, "shorts", "shorts");
  const more = renderRail("MORE TO WATCH", moreEpisodes, covers, "more", "landscape");
  const explore = renderRail("EXPLORE", exploreEpisodes, covers, "explore", "landscape");

  if (shorts) $("episode-rows").appendChild(shorts);
  if (more) $("episode-rows").appendChild(more);
  if (explore) $("episode-rows").appendChild(explore);
}

async function openEpisode(episode) {
  activeEpisode = episode;
  $("player-title").textContent = episode.title;
  $("player-number").textContent = episode.episode_number
    ? `TUNG TUNG WAR // EPISODIO ${episode.episode_number}`
    : "TUNG TUNG+ // PLAYER";
  $("player-description").textContent = episode.description || "Nessuna descrizione disponibile.";
  $("delete-episode").classList.toggle("hidden", !isAdmin);
  $("player-modal").classList.remove("hidden");

  const video = $("video-player");
  const archiveFrame = $("archive-player");
  video.pause();
  video.classList.add("hidden");
  video.removeAttribute("src");
  video.load();
  archiveFrame.classList.add("hidden");
  archiveFrame.removeAttribute("src");

  if (episode.archive_url) {
    archiveFrame.src = episode.archive_url;
    archiveFrame.classList.remove("hidden");
    return;
  }

  try {
    const url = await getSignedUrl(episode.video_path);
    video.classList.remove("hidden");
    video.src = url;
    video.load();
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
  if (!supabaseReady) {
    showView("setup-view");
    return;
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

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
    if (!isAdmin) {
      return setMessage("upload-message", "Inserisci il Secret Code per pubblicare.", true);
    }

    const video = $("episode-video").files[0];
    const cover = $("episode-cover").files[0];
    const title = $("episode-title").value.trim();

    if (!video || !title) {
      return setMessage("upload-message", "Inserisci un titolo e seleziona un video.", true);
    }
    if (video.size > MAX_VIDEO_SIZE) {
      $("upload-progress").classList.add("hidden");
      return setMessage("upload-message", "The file is too large — massimo 50 MB.", true);
    }

    const publish = $("publish-btn");
    publish.disabled = true;
    setMessage("upload-message", "Preparazione del caricamento…");
    setUploadProgress(0, 0, video.size);

    const id = crypto.randomUUID();
    const ext = (video.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
    const videoPath = `videos/${id}.${ext}`;
    let coverPath = null;

    try {
      setMessage("upload-message", "Caricamento video in corso. Non chiudere questa pagina.");
      await uploadVideoResumable(video, videoPath, (uploaded, total) => {
        setUploadProgress((uploaded / total) * 100, uploaded, total);
      });

      setUploadProgress(100, video.size, video.size, cover ? "Caricamento copertina…" : "Video caricato");

      if (cover) {
        const coverExt = (cover.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        coverPath = `covers/${id}.${coverExt}`;
        const { error: coverError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(coverPath, cover, {
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
        video_path: videoPath,
        cover_path: coverPath
      });
      if (dbError) throw dbError;

      $("upload-modal").classList.add("hidden");
      toast("Episodio pubblicato!");
      await loadEpisodes();
    } catch (error) {
      await supabase.storage.from(STORAGE_BUCKET)
        .remove([videoPath, ...(coverPath ? [coverPath] : [])]).catch(() => {});
      setMessage("upload-message", friendlyUploadError(error), true);
    } finally {
      publish.disabled = false;
      $("upload-progress").classList.add("hidden");
    }
  });

  $("delete-episode").addEventListener("click", async () => {
    if (!isAdmin || !activeEpisode) return;
    if (!confirm(`Eliminare "${activeEpisode.title}"? Questa operazione non si può annullare.`)) return;

    try {
      const paths = [activeEpisode.video_path, activeEpisode.cover_path].filter(Boolean);
      const { error: dbError } = await supabase.from("episodes").delete().eq("id", activeEpisode.id);
      if (dbError) throw dbError;
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
      if (storageError) throw storageError;

      $("player-modal").classList.add("hidden");
      $("video-player").pause();
      $("video-player").removeAttribute("src");
      $("video-player").load();
      await loadEpisodes();
      toast("Episodio eliminato.");
    } catch (error) {
      toast(`Errore durante l'eliminazione: ${error.message}`);
    }
  });

  // The public catalogue opens immediately; the admin code is requested only for publishing.
  enterApp(false);
}

init().catch((error) => {
  console.error(error);
  showView("setup-view");
});
