import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  STORAGE_BUCKET,
  SIGNED_URL_SECONDS
} from "./config.js";

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
  ["setup-view", "auth-view", "app-view"].forEach((view) =>
    $(view).classList.toggle("hidden", view !== id)
  );
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
  el.textContent = message || "";
  el.classList.toggle("error", error);
}

function formatFileSize(bytes) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
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
    // The public anon key is used because this version has no user accounts.
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

async function loadEpisodes() {
  $("loading").classList.remove("hidden");
  $("episode-grid").innerHTML = "";
  $("empty-state").classList.add("hidden");
  setMessage("catalog-message", "");

  const { data, error } = await supabase
    .from("episodes")
    .select("*")
    .order("created_at", { ascending: false });

  $("loading").classList.add("hidden");
  if (error) {
    setMessage("catalog-message", `Errore nel caricamento: ${error.message}`, true);
    return;
  }

  episodesCache = data || [];
  if (!episodesCache.length) {
    $("empty-state").classList.remove("hidden");
    return;
  }

  for (const episode of episodesCache) {
    const cover = episode.cover_path
      ? await getSignedUrl(episode.cover_path).catch(() => "")
      : "";
    const card = document.createElement("article");
    card.className = "episode-card";
    card.innerHTML = `
      <button class="poster-button" type="button" aria-label="Guarda ${escapeHtml(episode.title)}">
        ${cover
          ? `<img class="poster" src="${escapeHtml(cover)}" alt="">`
          : `<div class="poster poster-placeholder"><span>T<span class="accent">+</span></span></div>`}
        <span class="play-overlay"><span>▶</span></span>
      </button>
      <div class="episode-copy">
        <div class="episode-kicker">${episode.episode_number ? `EPISODIO ${escapeHtml(episode.episode_number)}` : "TUNG TUNG+"}</div>
        <h3>${escapeHtml(episode.title)}</h3>
        <p>${escapeHtml(episode.description || "Nessuna descrizione.")}</p>
      </div>`;
    card.querySelector(".poster-button").addEventListener("click", () => openEpisode(episode));
    $("episode-grid").appendChild(card);
  }
}

async function openEpisode(episode) {
  activeEpisode = episode;
  $("player-title").textContent = episode.title;
  $("player-number").textContent = episode.episode_number
    ? `EPISODIO ${episode.episode_number}`
    : "TUNG TUNG+";
  $("player-description").textContent = episode.description || "Nessuna descrizione.";
  $("delete-episode").classList.toggle("hidden", !isAdmin);
  $("player-modal").classList.remove("hidden");

  const video = $("video-player");
  video.pause();
  video.removeAttribute("src");
  video.load();

  try {
    const url = await getSignedUrl(episode.video_path);
    video.src = url;
    video.load();
    await video.play().catch(() => {});
  } catch (error) {
    toast(`Non riesco ad aprire il video: ${error.message}`);
  }
}

function enterApp(adminMode) {
  isAdmin = adminMode;
  $("open-upload").classList.toggle("hidden", !isAdmin);
  $("user-label").textContent = isAdmin ? "Amministratore" : "Visitatore";
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

  showView("auth-view");

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
      $(button.dataset.close).classList.add("hidden");
      if (button.dataset.close === "player-modal") {
        $("video-player").pause();
        $("video-player").removeAttribute("src");
        $("video-player").load();
      }
    });
  });

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.classList.add("hidden");
        if (modal.id === "player-modal") $("video-player").pause();
      }
    });
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
      await loadEpisodes();
      toast("Episodio eliminato.");
    } catch (error) {
      toast(`Errore durante l'eliminazione: ${error.message}`);
    }
  });
}

init().catch((error) => {
  console.error(error);
  showView("setup-view");
});
