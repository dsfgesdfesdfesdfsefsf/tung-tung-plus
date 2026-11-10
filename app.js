import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Upload } from "https://esm.sh/tus-js-client@4";

import { SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_BUCKET, SIGNED_URL_SECONDS } from "./config.js";

const $ = (id) => document.getElementById(id);
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const supabaseReady = SUPABASE_URL.startsWith("https://") && !SUPABASE_ANON_KEY.startsWith("INSERISCI_");
let supabase = null;
let isAdmin = false;
let authMode = "login";
let activeEpisode = null;
let episodesCache = [];

const views = ["setup-view", "auth-view", "app-view"];
function showView(id) {
  views.forEach((view) => $(view).classList.toggle("hidden", view !== id));
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
function setBusy(button, busy, label) {
  button.disabled = busy;
  if (label) button.textContent = busy ? "Attendi…" : label;
}

async function getRole() {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return false;
  const { data, error } = await supabase.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (error) throw error;
  return data?.role === "admin";
}

async function getSignedUrl(path) {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "0 MB";
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
  $("upload-progress-detail").textContent = `${formatFileSize(uploaded)} / ${formatFileSize(total)}`;
}

function friendlyUploadError(error) {
  const message = String(error?.message || error || "Errore sconosciuto");
  const lower = message.toLowerCase();
  if (error?.status === 413 || /too large|payload too large|maximum allowed size|exceeded.*size|file size limit/.test(lower)) {
    return "The file is too large";
  }
  return message;
}

async function uploadVideoResumable(file, path, onProgress) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error("Sessione scaduta. Accedi di nuovo.");

  const projectId = new URL(SUPABASE_URL).hostname.split(".")[0];
  const endpoint = `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`;

  await new Promise((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
        "x-upsert": "false"
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: STORAGE_BUCKET,
        objectName: path,
        contentType: file.type || "video/mp4",
        cacheControl: "3600"
      },
      onError: reject,
      onProgress: (bytesUploaded, bytesTotal) => onProgress(bytesUploaded, bytesTotal),
      onSuccess: resolve
    });
    upload.start();
  });
}

async function loadEpisodes() {
  $("loading").classList.remove("hidden");
  $("episode-grid").innerHTML = "";
  $("empty-state").classList.add("hidden");
  setMessage("catalog-message", "");
  const { data, error } = await supabase.from("episodes").select("*").order("created_at", { ascending: false });
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
    const cover = episode.cover_path ? await getSignedUrl(episode.cover_path).catch(() => "") : "";
    const card = document.createElement("article");
    card.className = "episode-card";
    card.innerHTML = `
      <button class="poster-button" type="button" aria-label="Guarda ${escapeHtml(episode.title)}">
        ${cover ? `<img class="poster" src="${escapeHtml(cover)}" alt="">` : `<div class="poster poster-placeholder"><span> T<span class="accent">+</span> </span></div>`}
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
  $("player-number").textContent = episode.episode_number ? `EPISODIO ${episode.episode_number}` : "TUNG TUNG+";
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

async function enterApp(session) {
  if (!session) {
    isAdmin = false;
    $("logout-btn").classList.add("hidden");
    $("user-label").textContent = "";
    showView("auth-view");
    return;
  }
  $("logout-btn").classList.remove("hidden");
  $("user-label").textContent = session.user.email || "";
  try {
    isAdmin = await getRole();
  } catch (error) {
    isAdmin = false;
    toast(`Errore profilo: ${error.message}`);
  }
  $("open-upload").classList.toggle("hidden", !isAdmin);
  showView("app-view");
  await loadEpisodes();
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
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  $("auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("auth-submit");
    setBusy(button, true);
    setMessage("auth-message", "");
    try {
      const email = $("email").value.trim();
      const password = $("password").value;
      if (authMode === "register") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setMessage("auth-message", "Registrazione completata. Controlla la tua email per confermare l'account.");
        else await enterApp(data.session);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await enterApp(data.session);
      }
    } catch (error) {
      setMessage("auth-message", error.message || "Accesso non riuscito.", true);
    } finally {
      setBusy(button, false, authMode === "register" ? "Crea account" : "Accedi");
    }
  });

  $("toggle-auth").addEventListener("click", () => {
    authMode = authMode === "login" ? "register" : "login";
    $("auth-submit").textContent = authMode === "register" ? "Crea account" : "Accedi";
    $("toggle-auth").textContent = authMode === "register" ? "Hai già un account? Accedi" : "Non hai un account? Registrati";
    $("password").autocomplete = authMode === "register" ? "new-password" : "current-password";
    setMessage("auth-message", "");
  });

  $("logout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    await enterApp(null);
  });
  $("open-upload").addEventListener("click", () => {
    $("upload-form").reset();
    setMessage("upload-message", "");
    $("upload-modal").classList.remove("hidden");
  });
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => {
    $(button.dataset.close).classList.add("hidden");
    if (button.dataset.close === "player-modal") {
      $("video-player").pause();
      $("video-player").removeAttribute("src");
      $("video-player").load();
    }
  }));
  document.querySelectorAll(".modal").forEach((modal) => modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.classList.add("hidden");
      if (modal.id === "player-modal") $("video-player").pause();
    }
  }));

  $("upload-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAdmin) return setMessage("upload-message", "Non sei autorizzato a pubblicare.", true);
    const video = $("episode-video").files[0];
    const cover = $("episode-cover").files[0];
    const title = $("episode-title").value.trim();
    if (!video || !title) return setMessage("upload-message", "Inserisci un titolo e seleziona un video.", true);
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
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError || new Error("Sessione scaduta.");

      setMessage("upload-message", "Caricamento video in corso. Non chiudere questa pagina.");
      await uploadVideoResumable(video, videoPath, (uploaded, total) => {
        setUploadProgress((uploaded / total) * 100, uploaded, total);
      });

      setUploadProgress(100, video.size, video.size, cover ? "Caricamento copertina…" : "Video caricato");
      if (cover) {
        const coverExt = (cover.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        coverPath = `covers/${id}.${coverExt}`;
        const { error: coverError } = await supabase.storage.from(STORAGE_BUCKET).upload(coverPath, cover, {
          contentType: cover.type || "image/jpeg", upsert: false
        });
        if (coverError) throw coverError;
      }
      const numberValue = $("episode-number").value.trim();
      const { error: dbError } = await supabase.from("episodes").insert({
        title, description: $("episode-description").value.trim(),
        episode_number: numberValue ? Number(numberValue) : null,
        video_path: videoPath, cover_path: coverPath, created_by: userData.user.id
      });
      if (dbError) throw dbError;
      $("upload-modal").classList.add("hidden");
      toast("Episodio pubblicato!");
      await loadEpisodes();
    } catch (error) {
      // Remove uploaded objects if a later step fails.
      await supabase.storage.from(STORAGE_BUCKET).remove([videoPath, ...(coverPath ? [coverPath] : [])]).catch(() => {});
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

  const { data: { session } } = await supabase.auth.getSession();
  await enterApp(session);
  supabase.auth.onAuthStateChange((_event, session) => {
    // Avoid blocking Supabase's auth event callback.
    setTimeout(() => enterApp(session), 0);
  });
}

init().catch((error) => {
  console.error(error);
  showView("auth-view");
  setMessage("auth-message", `Errore inizializzazione: ${error.message}`, true);
});
